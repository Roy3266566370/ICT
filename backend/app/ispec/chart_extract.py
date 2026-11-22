"""视觉模型通用图表截图提取：图片 → 标准 ``chart_data``，直通 :func:`app.ispec.builder._chart_ispec`。

设计约束：
- 复用已配置的视觉模型通道（``LivingVisionClient`` / ``LIVING_FIGURE_VISION_*``，如 Qwen3-VL-32B），
  未配置时静默返回 ``None``，不发起任何网络请求；
- 先做廉价前置过滤（尺寸、长宽比、OCR 数字/图表线索），避免对装饰图、公式小图或纯示意图浪费预算；
- 内容寻址缓存（``DATA_DIR/ocr/vchart_v1_<sha256>.json``），同一张图重复上传直接命中，不重复消耗额度；
- 严格校验输出结构：非统计图表、低置信度、类别/数值长度不一致或含非法数值时全部拒收，绝不伪造图表数据。
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import math
import re
from typing import Any, Mapping, Sequence

from PIL import Image

from ..settings import DATA_DIR

logger = logging.getLogger(__name__)

CHART_EXTRACT_VERSION = "v1"
MIN_CONFIDENCE = 0.7
MAX_CATEGORIES = 40
MAX_SERIES = 8
MAX_CHART_CALLS_PER_DECK = 6

_ALLOWED_CHART_TYPES = frozenset({
    "COLUMN_CLUSTERED",
    "BAR_CLUSTERED",
    "LINE",
    "PIE",
    "AREA",
    "XY_SCATTER",
})

_CHART_TYPE_ALIASES = {
    "bar": "BAR_CLUSTERED",
    "bar_clustered": "BAR_CLUSTERED",
    "horizontal_bar": "BAR_CLUSTERED",
    "column": "COLUMN_CLUSTERED",
    "column_clustered": "COLUMN_CLUSTERED",
    "vertical_bar": "COLUMN_CLUSTERED",
    "histogram": "COLUMN_CLUSTERED",
    "line": "LINE",
    "line_chart": "LINE",
    "pie": "PIE",
    "donut": "PIE",
    "doughnut": "PIE",
    "area": "AREA",
    "scatter": "XY_SCATTER",
    "xy_scatter": "XY_SCATTER",
}

_NUMBER_TOKEN_RE = re.compile(r"[-−+]?\d+(?:\.\d+)?%?")
_CHART_CUE_RE = re.compile(
    r"(?:柱状图|条形图|折线图|曲线图|饼图|散点图|面积图|趋势|占比|比例|分布|同比|环比|"
    r"增长|销量|营收|收入|成本|利润|预算|人数|评分|准确率|精度|误差|损失|"
    r"accuracy|loss|epoch|precision|recall|f1|score|rate|ratio|percent|"
    r"chart|plot|%|万元|亿元|千|万|亿|Q[1-4]|20\d{2}年)",
    re.I,
)
_MATH_DIAGRAM_CUE_RE = re.compile(
    r"(?:\\begin\{|\\frac|\\int|det\s*\(?|λ|\\lambda|σ|\\sigma|"
    r"特征向量|特征值|奇异值|单位圆|正交基|斜基|换基|行列式|逆矩阵|→|\\rightarrow)",
    re.I,
)

CHART_PROMPT = (
    "判断这张 PPT 截图是否为统计数据图表（柱状图/条形图/折线图/饼图/面积图/散点图）。\n"
    "如果只是几何示意图、矩阵公式、流程图、架构图、人物/风景照片或装饰图，必须返回 {\"is_chart\": false}。\n"
    "如果是统计数据图表，请提取底层数据，只返回 JSON，不要解释：\n"
    "{\n"
    '  "is_chart": true,\n'
    '  "chart_type": "COLUMN_CLUSTERED|BAR_CLUSTERED|LINE|PIE|AREA|XY_SCATTER",\n'
    '  "title": "图表标题（无标题时根据图例或上下文概括，不超过40字）",\n'
    '  "categories": ["分类1", "分类2", ...],\n'
    '  "series": [{"name": "系列名", "values": [数值1, 数值2, ...]}],\n'
    '  "confidence": 0.9\n'
    "}\n"
    "硬性规则：\n"
    "1. categories 必须为 2~40 个非空字符串；\n"
    "2. series 必须为 1~8 个系列，每个系列的 values 数量必须严格等于 categories 数量，且全部是纯数字（去掉 % 和单位）；\n"
    "3. 优先读取图中标注的精确数值；无标注时按坐标轴刻度谨慎估计并适当下调 confidence；\n"
    "4. 看不清或无法可靠还原数据时返回 {\"is_chart\": false}，不要编造。"
)


def looks_like_chart_candidate(
    blob: bytes,
    *,
    ocr_text: str = "",
    ocr_rows: Sequence[Mapping[str, Any]] = (),
    has_matrix: bool = False,
) -> bool:
    """廉价前置过滤：过滤明显不是统计图表的图片，减少无效视觉调用。"""
    if has_matrix:
        return False
    try:
        with Image.open(io.BytesIO(blob)) as image:
            width, height = image.size
    except Exception:  # noqa: BLE001
        return False
    if width < 160 or height < 100 or width * height > 20_000_000:
        return False
    ratio = width / max(1, height)
    if not (0.4 <= ratio <= 4.0):
        return False

    text = str(ocr_text or "").strip()
    numbers = _NUMBER_TOKEN_RE.findall(text)
    if _CHART_CUE_RE.search(text) and len(numbers) >= 2:
        return True
    if _MATH_DIAGRAM_CUE_RE.search(text):
        return False
    if any(isinstance(r, Mapping) and r.get("type") == "formula" for r in ocr_rows):
        return False
    if len(numbers) >= 4 and len(ocr_rows) >= 4:
        return True
    return False


def _normalize_chart_type(raw: Any) -> str:
    text = str(raw or "").strip().upper()
    if text in _ALLOWED_CHART_TYPES:
        return text
    return _CHART_TYPE_ALIASES.get(text.lower(), "COLUMN_CLUSTERED")


def validate_extracted_chart(raw: Any) -> dict[str, Any] | None:
    """校验视觉模型返回的 JSON，合法则规整为 ``_chart_ispec`` 期望的 ``chart_data``。"""
    if not isinstance(raw, Mapping):
        return None
    if raw.get("is_chart") is not True:
        return None
    try:
        confidence = float(raw.get("confidence", 0.0))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(confidence) or confidence < MIN_CONFIDENCE:
        return None

    raw_categories = raw.get("categories")
    if not isinstance(raw_categories, list):
        return None
    categories: list[str] = []
    seen_categories: set[str] = set()
    for item in raw_categories[:MAX_CATEGORIES]:
        label = re.sub(r"\s+", " ", str(item or "")).strip()[:60]
        if not label:
            return None
        if label in seen_categories:
            suffix = 2
            while f"{label} ({suffix})" in seen_categories:
                suffix += 1
            label = f"{label} ({suffix})"
        seen_categories.add(label)
        categories.append(label)
    if len(categories) < 2:
        return None

    raw_series = raw.get("series")
    if not isinstance(raw_series, list) or not raw_series:
        return None
    series: list[dict[str, Any]] = []
    for index, entry in enumerate(raw_series[:MAX_SERIES]):
        if not isinstance(entry, Mapping):
            continue
        raw_values = entry.get("values")
        if not isinstance(raw_values, list) or len(raw_values) != len(categories):
            continue
        values: list[float] = []
        valid = True
        for val in raw_values:
            if isinstance(val, bool):
                valid = False
                break
            try:
                num = float(val)
            except (TypeError, ValueError):
                valid = False
                break
            if not math.isfinite(num) or abs(num) > 1e12:
                valid = False
                break
            values.append(num)
        if not valid:
            continue
        name = re.sub(r"\s+", " ", str(entry.get("name") or f"系列{index + 1}")).strip()[:60]
        series.append({"name": name or f"系列{index + 1}", "values": values})

    if not series:
        return None

    title = re.sub(r"\s+", " ", str(raw.get("title") or "")).strip()[:80]
    if not title:
        title = " / ".join(item["name"] for item in series[:3])

    return {
        "title": title,
        "chart_type": _normalize_chart_type(raw.get("chart_type")),
        "categories": categories,
        "series": series,
        "extracted_by": "vision_chart",
        "confidence": round(confidence, 3),
    }


def _prepare_png(blob: bytes) -> bytes:
    with Image.open(io.BytesIO(blob)) as source:
        rgba = source.convert("RGBA")
        rgba.thumbnail((1400, 1400))
        canvas = Image.new("RGBA", rgba.size, "white")
        canvas.alpha_composite(rgba)
        out = io.BytesIO()
        canvas.convert("RGB").save(out, format="PNG")
        return out.getvalue()


def _cache_path(blob: bytes, model: str) -> Any:
    digest = hashlib.sha256()
    digest.update(blob)
    digest.update(f"|{CHART_EXTRACT_VERSION}|{model}".encode("utf-8"))
    return DATA_DIR / "ocr" / f"vchart_{CHART_EXTRACT_VERSION}_{digest.hexdigest()[:32]}.json"


def extract_chart_from_image(
    blob: bytes,
    *,
    ocr_text: str = "",
    ocr_rows: Sequence[Mapping[str, Any]] = (),
    has_matrix: bool = False,
    page_title: str = "",
    client: Any = None,
) -> tuple[dict[str, Any] | None, bool]:
    """尝试从位图提取统计图表数据，返回 ``(chart_data_or_None, used_live_call)``。

    ``used_live_call`` 为 ``True`` 表示真实消耗了一次视觉模型调用（缓存命中或前置过滤跳过均为 ``False``）。
    """
    if not looks_like_chart_candidate(
        blob, ocr_text=ocr_text, ocr_rows=ocr_rows, has_matrix=has_matrix,
    ):
        return None, False

    if client is None:
        from ..living.vision import LivingVisionClient

        client = LivingVisionClient()
    if not getattr(client, "available", False):
        return None, False

    model = str(getattr(getattr(client, "profile", None), "model", "") or "")
    target = _cache_path(blob, model)
    if target.exists():
        try:
            cached = json.loads(target.read_text(encoding="utf-8"))
            if isinstance(cached, dict):
                return cached.get("chart_data"), False
        except (OSError, ValueError):
            pass

    context_lines = []
    if page_title.strip():
        context_lines.append(f"所在幻灯片标题：{page_title.strip()[:120]}")
    if ocr_text.strip():
        context_lines.append(f"图中 OCR 文字线索：\n{ocr_text.strip()[:1200]}")
    prompt = CHART_PROMPT + ("\n\n" + "\n".join(context_lines) if context_lines else "")

    try:
        from ..ppt_ai.response_models import ChartDataExtract
        png_bytes = _prepare_png(blob)
        raw = client.generate_json(image_png=png_bytes, prompt=prompt, max_output_tokens=2048,
                                   response_model=ChartDataExtract)
    except Exception as exc:  # noqa: BLE001 - 视觉提取失败不阻断上传
        logger.warning("视觉图表提取调用失败，已跳过：%s", exc)
        return None, True

    chart_data = validate_extracted_chart(raw)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps({"version": CHART_EXTRACT_VERSION, "model": model, "chart_data": chart_data}, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError:
        pass
    return chart_data, True


__all__ = [
    "MAX_CHART_CALLS_PER_DECK",
    "extract_chart_from_image",
    "looks_like_chart_candidate",
    "validate_extracted_chart",
]

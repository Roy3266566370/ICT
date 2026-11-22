"""从解析产物直出 iSpec（``contracts/spec/ispec.schema.json`` 的 v1.0）。

输入是 :func:`app.parsers.pptx_parser.parse_pptx` 的第二个返回值（``slides.json``），
只读其中的**原生数据**，不依赖视觉识别、不依赖示例区域：

===================  ==================================================  ==================
来源                  判定与产出                                            iSpec ``kind``
===================  ==================================================  ==================
原生图表               ``element.chart_data`` 有分类且有数值系列            ``filter``
                     参数 ``category``（enum，含"全部"），视图 vega+table
原生表格               ``element.table_data`` 有非空表头                     ``filter``
                     参数 ``filter_column``，视图 table
OMML 公式              ``element.math_text`` 非空                            ``parametric``
                     参数取公式中的字母变量，视图 text（降级呈现）
其他                   ——                                                 不产出
===================  ==================================================  ==================

硬约束：

* 每条参数的 ``source`` 都带 ``page`` / ``element_id`` / ``excerpt``（原文片段）；
* 图表数值与 ``chart_data.series[].values`` **逐值一致**，生成前做抽样复核；
* 生成后逐条做 JSON Schema 校验，坏 spec 丢弃并记录，不影响其他条目；
* 无原生内容时返回空列表，**不回退到公共示例区域**。
"""

from __future__ import annotations

import base64
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from .llm import ISpecLLMProvider, LLMRequest, LLMResponse, parse_ispecs
from .llm.provider import LLMResponseInvalid
from .shared import apply_shared_keys, assign_shared_keys
from .text_structure import build_text_structure_specs
from .validator import validate_ispec
from .native_math import build_native_math_specs

#: iSpec 版本（Schema 冻结为 1.0）。
SPEC_VERSION = "1.0"
#: ``source.excerpt`` 上限，与 C-KO@1 SourceRef 的 160 字约束一致。
MAX_EXCERPT = 160
#: 无可用原生内容时的统一识别结论（前端据此显示"未识别到交互区域"）。
UNRECOGNIZED_REASON = (
    "未识别到交互区域：未发现带数据的原生图表、表格、OMML 公式或可恢复的文本表格"
    "（不回退到公共示例区域）"
)
#: 公式中不视为"变量"的常见函数名/算子名。
_RESERVED_FORMULA_WORDS = frozenset(
    {
        "det",
        "rank",
        "trace",
        "tr",
        "sin",
        "cos",
        "tan",
        "cot",
        "sec",
        "csc",
        "log",
        "ln",
        "exp",
        "max",
        "min",
        "sqrt",
        "frac",
        "sum",
        "prod",
        "lim",
        "abs",
        "mod",
    }
)
#: 希腊字母 → 合法参数 id（``^[A-Za-z_][A-Za-z0-9_]*$``）。
_GREEK_PARAMETER_IDS = {
    "α": "alpha",
    "β": "beta",
    "γ": "gamma",
    "δ": "delta",
    "ε": "epsilon",
    "ζ": "zeta",
    "η": "eta",
    "θ": "theta",
    "ι": "iota",
    "κ": "kappa",
    "λ": "lambda",
    "μ": "mu",
    "ν": "nu",
    "ξ": "xi",
    "π": "pi",
    "ρ": "rho",
    "σ": "sigma",
    "τ": "tau",
    "φ": "phi",
    "χ": "chi",
    "ψ": "psi",
    "ω": "omega",
    "Γ": "Gamma",
    "Δ": "Delta",
    "Θ": "Theta",
    "Λ": "Lambda",
    "Ξ": "Xi",
    "Π": "Pi",
    "Σ": "Sigma",
    "Φ": "Phi",
    "Ψ": "Psi",
    "Ω": "Omega",
}
#: 元素来源类型（只用于统计与识别结论，不写入 iSpec —— Schema 冻结）。
_ORIGIN_CHART = "chart"
_ORIGIN_TABLE = "table"
_ORIGIN_FORMULA = "formula"
_ORIGIN_HEURISTIC = "heuristic"
_ORIGIN_LABELS = {
    _ORIGIN_CHART: "个原生图表",
    _ORIGIN_TABLE: "个表格",
    _ORIGIN_FORMULA: "个公式",
    _ORIGIN_HEURISTIC: "个文本/OCR 启发式区域",
}

#: 未配置 LLM 时追加到识别结论的边界说明（P1-08）。
LLM_UNAVAILABLE_NOTE = "（LLM 未配置：图片仅做本地 OCR，未启用视觉模型理解）"
#: LLM 提示里允许的 iSpec ``kind``（与冻结 Schema 一致）。
SUPPORTED_KINDS = ("parametric", "filter", "step", "geometric", "branch")
#: 单份材料最多让 LLM 提议的 iSpec 条数。
LLM_MAX_SPECS = 8
#: 发给模型的单页原文与元素摘要上限（防止 prompt 过长）。
MAX_LLM_PAGE_TEXT = 4000
MAX_LLM_ELEMENT_SUMMARY = 800


@dataclass(frozen=True, slots=True)
class IspecBuildResult:
    """一次识别的完整结果：iSpec + 校验/降级诊断 + 前端识别结论。"""

    ispecs: list[dict[str, Any]] = field(default_factory=list)
    errors: list[dict[str, Any]] = field(default_factory=list)
    recognition: dict[str, Any] = field(default_factory=dict)
    #: 跨 iSpec 共享参数组（§9-4）：同一变量在多页出现时共用同一个 ``shared_key``。
    shared_groups: list[dict[str, Any]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# 通用助手
# ---------------------------------------------------------------------------


def _pages(parsed_material: Any) -> list[Mapping[str, Any]]:
    """从 ``slides.json`` 取页面列表（``slides`` 权威，``pages`` 兼容镜像）。"""
    if not isinstance(parsed_material, Mapping):
        return []
    raw = parsed_material.get("slides")
    if not isinstance(raw, list):
        raw = parsed_material.get("pages")
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, Mapping)]


def _material_id(parsed_material: Any, explicit: str | None) -> str:
    """材料 id：显式参数优先，其次解析产物，最后用 ``material`` 占位。"""
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    if isinstance(parsed_material, Mapping):
        raw = parsed_material.get("material_id")
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
    return "material"


def _safe_object_id(*parts: Any) -> str:
    """拼出符合 ``^[A-Za-z0-9_.:-]+$`` 的稳定 object_id。"""
    raw = "_".join(str(part) for part in parts if part not in (None, ""))
    cleaned = re.sub(r"[^A-Za-z0-9_.:-]", "_", raw)
    return (cleaned[:120].strip("_") or "ispec")


def _unique(items: Sequence[str]) -> list[str]:
    """保序去重（不排序，保持原文出现顺序）。"""
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def _excerpt(text: str) -> str:
    """截断到 160 字；只截断，不改写、不补全。"""
    return text.strip()[:MAX_EXCERPT]


def _source_ref(
    *,
    page: int,
    element_id: Any,
    excerpt: str,
    status: str = "original",
) -> dict[str, Any]:
    """参数的来源引用；``bbox`` 显式为 ``null``（EMU 与前端坐标系不一致，不在此转换）。"""
    return {
        "page": page,
        "element_id": element_id if isinstance(element_id, str) and element_id else None,
        "bbox": None,
        "status": status,
        "excerpt": excerpt,
    }


def _anchor_for(page: int, element: Mapping[str, Any]) -> dict[str, Any] | None:
    """图/表元素的整块锚点：前端据此在原位覆盖，而不是漂在页面中间。

    ``bbox`` 与 ``source_ref`` 不同——这里写的是元素真实位置（EMU），
    因为锚点只用于"在原位置放一个交互层"，不参与参数溯源。
    """

    bbox = element.get("bbox")
    element_id = element.get("element_id")
    if not isinstance(bbox, Mapping) or not isinstance(element_id, str) or not element_id:
        return None
    if any(not isinstance(bbox.get(key), (int, float)) for key in ("x", "y", "w", "h")):
        return None
    return {
        "page": page,
        "element_id": element_id,
        "bbox": {key: bbox[key] for key in ("x", "y", "w", "h")},
    }


def _json_number(text: str) -> float | int:
    """数字串 → int/float（整数值统一为 int，便于 JSON 阅读）。"""
    value = float(text)
    if value.is_integer():
        return int(value)
    return round(value, 10)


# ---------------------------------------------------------------------------
# LLM 请求构造（只在原生识别完全没有产出时使用）
# ---------------------------------------------------------------------------


def _page_text(page: Mapping[str, Any]) -> str:
    """取一页的**原文**，供 excerpt 核验使用。

    优先 ``text`` 字段；否则用解析产物的 ``paragraphs`` 按行拼接；
    最后退回 ``excerpt``。不做任何改写。
    """

    raw_text = page.get("text")
    if isinstance(raw_text, str) and raw_text.strip():
        return raw_text
    paragraphs = page.get("paragraphs")
    if isinstance(paragraphs, list):
        joined = "\n".join(str(item) for item in paragraphs if str(item).strip())
        if joined.strip():
            return joined
    excerpt = page.get("excerpt")
    return excerpt if isinstance(excerpt, str) else ""


def _element_summary(element: Mapping[str, Any]) -> str:
    """把一个原生元素压成一行摘要（只读直读字段，不推断）。"""

    parts = [
        f"{element.get('element_id') or '?'}（{element.get('kind') or 'unknown'}）",
    ]

    chart_data = element.get("chart_data")
    if isinstance(chart_data, Mapping):
        title = str(chart_data.get("title") or "").strip()
        if title:
            parts.append(f"图表标题：{title}")
        categories = chart_data.get("categories")
        if isinstance(categories, list) and categories:
            parts.append("分类：" + "、".join(str(item) for item in categories[:12]))
        series = chart_data.get("series")
        if isinstance(series, list):
            names = [
                str(item.get("name") or "").strip()
                for item in series
                if isinstance(item, Mapping)
            ]
            names = [name for name in names if name]
            if names:
                parts.append("系列：" + "、".join(names[:12]))

    table_data = element.get("table_data")
    if isinstance(table_data, Mapping):
        headers = table_data.get("headers")
        if isinstance(headers, list) and headers:
            parts.append("表头：" + " | ".join(str(item) for item in headers[:12]))
        rows = table_data.get("rows")
        if isinstance(rows, list):
            parts.append(f"数据行数：{len(rows)}")

    math_text = element.get("math_text")
    if isinstance(math_text, str) and math_text.strip():
        parts.append(f"公式：{math_text.strip()[:120]}")

    text = element.get("text")
    if isinstance(text, str) and text.strip():
        parts.append(f"文字：{text.strip()[:120]}")

    return "；".join(parts)[:MAX_LLM_ELEMENT_SUMMARY]


def _llm_request(pages: Sequence[Mapping[str, Any]], material_id: str | None = None) -> LLMRequest:
    """把页面转成 LLM 请求；只包含原文与元素摘要，不包含任何用户凭据。"""

    request_pages: list[dict[str, Any]] = []
    for page in pages:
        page_no = page.get("page_no")
        if isinstance(page_no, bool) or not isinstance(page_no, int) or page_no < 1:
            continue
        raw_elements = page.get("elements")
        summaries = (
            [_element_summary(element) for element in raw_elements if isinstance(element, Mapping)]
            if isinstance(raw_elements, list)
            else []
        )
        request_pages.append(
            {
                "page_no": page_no,
                "text": _page_text(page)[:MAX_LLM_PAGE_TEXT],
                "elements_summary": "；".join(summaries)[:MAX_LLM_ELEMENT_SUMMARY],
            }
        )

    return LLMRequest(
        material_id=material_id,
        pages=request_pages,
        hints={"supported_kinds": list(SUPPORTED_KINDS), "max_specs": LLM_MAX_SPECS},
    )


def _merge_llm_ispecs(
    native: Sequence[dict[str, Any]],
    proposed: Sequence[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    """把 LLM 提议并入原生结果：按 ``object_id`` 去重，原生结果优先。"""

    merged = list(native)
    seen = {
        spec.get("object_id")
        for spec in native
        if isinstance(spec.get("object_id"), str)
    }
    added = 0
    for spec in proposed:
        object_id = spec.get("object_id")
        if not isinstance(object_id, str) or object_id in seen:
            continue
        seen.add(object_id)
        annotated = dict(spec)
        annotated.setdefault(
            "model",
            {
                "used": True,
                "confidence": None,
                "provider": "ispec-llm",
                "note": "由模型提议并已通过原文证据与契约核验；模型未提供自评分。",
            },
        )
        merged.append(annotated)
        added += 1
    return merged, added



# ---------------------------------------------------------------------------
# 原生图表
# ---------------------------------------------------------------------------


def _chart_view_ref(chart_type: str) -> str:
    """图表类型 → 内置 vega 模板名（仅允许 line/bar/scatter，其余降级为 bar）。"""
    upper = chart_type.upper()
    if "LINE" in upper:
        return "line"
    if "SCATTER" in upper or "XY" in upper or "BUBBLE" in upper:
        return "scatter"
    return "bar"


def _chart_rows(
    chart_data: Mapping[str, Any],
) -> list[tuple[str, str, float | int]]:
    """把 ``chart_data`` 展平成 ``(category, series, value)`` 行（只读、不补值）。"""
    raw_categories = chart_data.get("categories")
    categories = [str(item) for item in raw_categories] if isinstance(raw_categories, list) else []
    rows: list[tuple[str, str, float | int]] = []
    raw_series = chart_data.get("series")
    if not isinstance(raw_series, list):
        return rows
    for series in raw_series:
        if not isinstance(series, Mapping):
            continue
        name = str(series.get("name") or "")
        values = series.get("values")
        if not isinstance(values, list):
            continue
        for index, value in enumerate(values):
            if index >= len(categories):
                break
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            rows.append((categories[index], name, value))
    return rows


def _chart_rows_match_source(
    chart_data: Mapping[str, Any],
    rows: Sequence[Sequence[Any]],
) -> bool:
    """严格复核：``datasets[].rows`` 必须与 ``chart_data.series[].values`` 逐值相等。

    容差为 0（``float`` 直接 ``==``），且行数、分类、系列名、数值位置都必须一一对应；
    任一不等即判定不一致——宁可不产出该 iSpec，也不把错数据交给运行时。
    """
    expected = _chart_rows(chart_data)
    if not expected or len(expected) != len(rows):
        return False
    for (expected_category, expected_series, expected_value), row in zip(expected, rows):
        if len(row) != 3:
            return False
        if str(row[0]) != expected_category or str(row[1]) != expected_series:
            return False
        value = row[2]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return False
        if float(value) != float(expected_value):
            return False
    return True


def _chart_ispec(
    *,
    element: Mapping[str, Any],
    page: int,
    material_id: str,
) -> tuple[dict[str, Any] | None, str | None]:
    """原生图表 → ``kind="filter"`` 的 iSpec。

    返回 ``(spec, skip_reason)``：数据不足或数值复核失败时 ``spec=None``，
    ``skip_reason`` 说明原因（由调用方写入识别诊断）。
    """
    chart_data = element.get("chart_data")
    if not isinstance(chart_data, Mapping):
        return None, "缺少 chart_data"

    raw_categories = chart_data.get("categories")
    raw_series = chart_data.get("series")
    categories = _unique(
        [str(item) for item in raw_categories if str(item).strip()]
        if isinstance(raw_categories, list)
        else []
    )
    series = [
        item
        for item in (raw_series if isinstance(raw_series, list) else [])
        if isinstance(item, Mapping) and item.get("values")
    ]
    if not categories or not series:
        return None, "图表缺少可直读的分类或数值系列"

    rows = [list(row) for row in _chart_rows(chart_data)]
    if not _chart_rows_match_source(chart_data, rows):
        return None, "datasets 数值与 chart_data.series[].values 不一致"

    title = str(chart_data.get("title") or "").strip()
    legend = [str(item.get("name") or "").strip() for item in series]
    legend = [item for item in legend if item]
    excerpt = _excerpt(title or " / ".join(legend) or " / ".join(categories[:8]))
    if not excerpt:
        return None, "图表标题与图例均为空，缺少可引用的原文片段"

    chart_type = str(chart_data.get("chart_type") or "")
    view_ref = _chart_view_ref(chart_type)
    element_id = element.get("element_id")
    series_count = len(series)
    dataset_id = f"chart_p{page:02d}"

    notes = (
        "识别方式: pptx_native_chart；数据由 python-pptx 的 "
        "chart.plots[].categories 与 series.values 直读，未经视觉识别；"
        f"共 {series_count} 个系列 × {len(categories)} 个分类；"
        f"datasets[0]={dataset_id} 的数值与源逐值相等（容差 0）。"
    )
    downgraded = (
        bool(chart_type)
        and view_ref == "bar"
        and "BAR" not in chart_type.upper()
        and "COLUMN" not in chart_type.upper()
    )
    if downgraded:
        notes += f"图表类型 {chart_type} 无专用内置模板，已降级为 bar。"

    spec: dict[str, Any] = {
        "spec_version": SPEC_VERSION,
        "object_id": _safe_object_id("ispec", material_id, element_id, "chart"),
        "title": title or "原生图表（直读数据）",
        "kind": "filter",
        "parameters": [
            {
                "id": "category",
                "label": "分类",
                "type": "enum",
                "unit": "",
                "default": "全部",
                "options": _unique(["全部", *categories]),
                "source": _source_ref(
                    page=page,
                    element_id=element_id,
                    excerpt=excerpt,
                    status="original",
                ),
            }
        ],
        "expressions": [],
        "datasets": [
            {
                "id": dataset_id,
                "columns": ["category", "series", "value"],
                "rows": rows,
                "source": {"page": page, "element_id": element_id},
            }
        ],
        "views": [
            {
                "type": "vega",
                "spec_ref": view_ref,
                "x": "category",
                "y": "value",
                "title": title or "系列数值",
                "dataset": dataset_id,
            },
            {
                "type": "table",
                "columns": ["category", "series", "value"],
                "title": "原始数据（只读，来自 PPTX chart）",
                "dataset": dataset_id,
            },
        ],
        "constraints": [],
        "checks": [
            {
                "id": "C1",
                "type": "source_match",
                "page": page,
                "expect": (
                    f"数值与 PPT 原生图表一致（{series_count} 个系列 × {len(categories)} 个分类，"
                    f"datasets 逐值复核通过）"
                ),
            },
            {"id": "C2", "type": "consistency", "expr": "true"},
        ],
        "notes": notes,
    }
    anchor = _anchor_for(page, element)
    if anchor is not None:
        spec["anchor"] = anchor
    return spec, None


# ---------------------------------------------------------------------------
# 原生表格
# ---------------------------------------------------------------------------


def _table_ispec(
    *,
    element: Mapping[str, Any],
    page: int,
    material_id: str,
    page_title: str,
) -> dict[str, Any] | None:
    """原生表格 → ``kind="filter"`` 的 iSpec（参数"筛选列"，视图 table）。"""
    table_data = element.get("table_data")
    if not isinstance(table_data, Mapping):
        return None
    raw_headers = table_data.get("headers")
    headers = [str(item) for item in raw_headers] if isinstance(raw_headers, list) else []
    if not any(header.strip() for header in headers):
        return None

    filter_columns = _unique([header for header in headers if header.strip()])
    if not filter_columns:
        return None

    rows = table_data.get("rows")
    body_rows = (
        [[str(cell) for cell in row] for row in rows if isinstance(row, list)]
        if isinstance(rows, list)
        else []
    )
    row_count = len(body_rows)
    element_id = element.get("element_id")
    # 解析层把表格行规范化为 ``a | b | c``（与 element.text 完全一致）。
    # 这里的 excerpt 取自这份规范文本，因此能与页面原文（page_layouts）逐字核验；
    # 它与“python-pptx 单元格直接拼接”不同，属于产品侧的表格行序列化口径。
    excerpt = _excerpt(" | ".join(headers))
    dataset_id = f"table_p{page:02d}"

    spec: dict[str, Any] = {
        "spec_version": SPEC_VERSION,
        "object_id": _safe_object_id("ispec", material_id, element_id, "table"),
        "title": page_title.strip() or "原生表格（直读单元格）",
        "kind": "filter",
        "parameters": [
            {
                "id": "filter_column",
                "label": "筛选列",
                "type": "enum",
                "unit": "",
                "default": "全部",
                "options": ["全部", *filter_columns],
                "source": _source_ref(
                    page=page,
                    element_id=element_id,
                    excerpt=excerpt,
                    status="original",
                ),
            }
        ],
        "expressions": [],
        "datasets": [
            {
                "id": dataset_id,
                "columns": headers,
                "rows": body_rows,
                "source": {"page": page, "element_id": element_id},
            }
        ],
        "views": [
            {
                "type": "table",
                "columns": headers,
                "title": "原始表格（只读，来自 PPTX table）",
                "dataset": dataset_id,
            }
        ],
        "constraints": [],
        "checks": [
            {
                "id": "C1",
                "type": "source_match",
                "page": page,
                "expect": f"表头与 {row_count} 行单元格文本来自 PPTX 表格原文",
            },
            {"id": "C2", "type": "consistency", "expr": "true"},
        ],
        "notes": (
            "识别方式: pptx_native_table；表头与单元格文本由 python-pptx 的 "
            "table.rows[].cells[].text 直读，未经视觉识别。"
            "excerpt 为解析层规范行文本（单元格以 \" | \" 连接），"
            "与页面 element.text 一致，不等同于原始单元格文本直接拼接。"
        ),
    }
    anchor = _anchor_for(page, element)
    if anchor is not None:
        spec["anchor"] = anchor
    return spec


# ---------------------------------------------------------------------------
# OMML 公式
# ---------------------------------------------------------------------------


def _formula_variables(text: str) -> list[tuple[str, str]]:
    """提取公式中的字母变量 → ``[(原文字符, 参数 id), ...]``（保序去重）。

    只接受单字母拉丁字母、两字母缩写或希腊字母；常见函数名（det/rank/trace…）
    不算变量，避免把 ``det A`` 里的 ``det`` 当成参数。
    """
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    for match in re.finditer(r"[A-Za-z]+|[\u0391-\u03c9]", text):
        token = match.group(0)
        if len(token) == 1 and ord(token) > 127:
            parameter_id = _GREEK_PARAMETER_IDS.get(token)
        elif token.isalpha() and len(token) <= 2 and token.lower() not in _RESERVED_FORMULA_WORDS:
            parameter_id = token
        else:
            continue
        if parameter_id is None or parameter_id in seen:
            continue
        seen.add(parameter_id)
        found.append((token, parameter_id))
    return found


def _variable_value(text: str, symbol: str) -> float | int | None:
    """从 ``符号 = 数值`` 形式的原文取默认值；无明确赋值返回 ``None``（不猜测）。

    ``det A = 3`` 这类"整体量的值"不算 A 的赋值：若符号前紧邻函数名则跳过，
    避免把行列式的值错当成变量 A 的默认值。
    """
    pattern = re.compile(rf"{re.escape(symbol)}\s*=\s*(?P<value>-?\d+(?:\.\d+)?)")
    for match in pattern.finditer(text):
        prefix = text[: match.start()].rstrip()
        lowered = prefix.lower()
        if any(lowered.endswith(name) for name in _RESERVED_FORMULA_WORDS):
            continue
        return _json_number(match.group("value"))
    return None


def _formula_ispec(
    *,
    element: Mapping[str, Any],
    page: int,
    material_id: str,
    page_title: str,
) -> dict[str, Any] | None:
    """OMML 公式 → ``kind="parametric"`` 的 iSpec。

    降级说明：OMML 只做文本/结构转换（上标、下标、分式、根式），不执行公式求值，
    因此视图固定为 ``text``；参数只取公式里出现的字母变量。
    """
    raw_text = element.get("math_text")
    if not isinstance(raw_text, str) or not raw_text.strip():
        return None
    text = raw_text.strip()
    variables = _formula_variables(text)
    if not variables:
        return None

    parameters: list[dict[str, Any]] = []
    inferred: list[str] = []
    for symbol, parameter_id in variables:
        value = _variable_value(text, symbol)
        status = "original"
        if value is None:
            status = "inferred"
            inferred.append(parameter_id)
            value = 0  # 占位：原文未给数值，来源状态已标记 inferred
        parameters.append(
            {
                "id": parameter_id,
                "label": f"变量 {symbol}",
                "type": "number",
                "unit": "",
                "default": value,
                "source": _source_ref(
                    page=page,
                    element_id=element.get("element_id"),
                    excerpt=_excerpt(text),
                    status=status,
                ),
            }
        )

    notes = (
        "识别方式: omml_formula；公式由 a14:m / m:oMath 提取并简化为 LaTeX 文本"
        "（上标/下标/分式/根式），视图仅以文本呈现（降级：不执行公式求值）。"
    )
    if inferred:
        notes += (
            f" 变量 {', '.join(inferred)} 在原文中没有明确的数值赋值，"
            "default=0 仅为占位，参数来源标记 inferred。"
        )

    return {
        "spec_version": SPEC_VERSION,
        "object_id": _safe_object_id("ispec", material_id, element.get("element_id"), "formula"),
        "title": f"公式（第 {page} 页）" if not page_title.strip() else page_title.strip(),
        "kind": "parametric",
        "parameters": parameters,
        "expressions": [],
        "datasets": [],
        "views": [
            {
                "type": "text",
                "template": f"公式：{text}",
                "title": "公式原文（OMML 直读）",
            }
        ],
        "constraints": [],
        "checks": [
            {
                "id": "C1",
                "type": "source_match",
                "page": page,
                "expect": "公式文本与 PPT 内嵌 OMML 原文一致",
            }
        ],
        "notes": notes,
    }


# ---------------------------------------------------------------------------
# 组装
# ---------------------------------------------------------------------------


def _spec_page(spec: Mapping[str, Any]) -> int | None:
    anchor = spec.get("anchor")
    if isinstance(anchor, Mapping) and isinstance(anchor.get("page"), int):
        return anchor["page"]
    for parameter in spec.get("parameters", []) if isinstance(spec.get("parameters"), list) else []:
        source = parameter.get("source") if isinstance(parameter, Mapping) else None
        if isinstance(source, Mapping) and isinstance(source.get("page"), int):
            return source["page"]
    return None


def _coverage_stats(pages: Sequence[Mapping[str, Any]], valid: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """按页统计结构覆盖：原生/启发式交互页、纯文字页、图片页与 OCR 状况。

    只用于识别结论与前端提示；不写入 iSpec，不影响执行资格。
    """

    interaction_pages = {
        page_no for spec in valid if (page_no := _spec_page(spec)) is not None
    }
    text_only: list[int] = []
    image_only: list[int] = []
    graphics_only: list[int] = []
    images = 0
    images_with_text = 0
    for page in pages:
        page_no = page.get("page_no")
        if not isinstance(page_no, int) or page_no < 1:
            continue
        elements = [item for item in page.get("elements", []) if isinstance(item, Mapping)] if isinstance(page.get("elements"), list) else []
        pictures = [item for item in elements if item.get("kind") == "picture"]
        images += len(pictures)
        ocr_texts = [
            str(item.get("text") or "")
            for item in pictures
            if item.get("recognition_method") == "local_ocr" and str(item.get("text") or "").strip()
        ]
        images_with_text += len(ocr_texts)
        if page_no in interaction_pages:
            continue
        has_text = any(
            item.get("kind") in ("text", "shape") and str(item.get("text") or "").strip()
            for item in elements
        )
        if has_text:
            text_only.append(page_no)
        elif pictures:
            image_only.append(page_no)
        elif elements:
            # 常见于把整套公式画成矢量图形的课件：无可读文字，也无可交互结构。
            graphics_only.append(page_no)
    return {
        "pages": len([page for page in pages if isinstance(page.get("page_no"), int)]),
        "pages_with_interactions": len(interaction_pages),
        "pages_text_only": len(text_only),
        "text_only_pages": text_only[:30],
        "pages_image_only": len(image_only),
        "image_only_pages": image_only[:30],
        "pages_graphics_only": len(graphics_only),
        "graphics_only_pages": graphics_only[:30],
        "images": images,
        "images_with_ocr_text": images_with_text,
    }


def _recognition_reason(
    *,
    counts: Mapping[str, int],
    valid_count: int,
    error_count: int,
    skipped_count: int,
    coverage: Mapping[str, Any] | None = None,
    llm_count: int = 0,
    note: str | None = None,
) -> str:
    """生成前端可直接展示的识别结论。"""
    coverage = coverage or {}
    if valid_count <= 0:
        reason = UNRECOGNIZED_REASON
    else:
        parts = [
            f"{counts.get(origin, 0)}{_ORIGIN_LABELS[origin]}"
            for origin in (_ORIGIN_CHART, _ORIGIN_TABLE, _ORIGIN_FORMULA, _ORIGIN_HEURISTIC)
            if counts.get(origin, 0) > 0
        ]
        if llm_count:
            parts.append(f"{llm_count} 个 LLM 提议（证据已核验）")
        if not parts:
            parts.append(f"{valid_count} 个交互区域")
        reason = f"识别到 {valid_count} 个交互区域：" + "、".join(parts)
    total_pages = int(coverage.get("pages") or 0)
    interactive_pages = int(coverage.get("pages_with_interactions") or 0)
    non_interactive = max(0, total_pages - interactive_pages)
    if non_interactive:
        reason += (
            f"；另有 {non_interactive} 页没有可恢复的交互结构（文字/位图/矢量图形），"
            "只保留原文阅读与讲解，不生成占位交互"
        )
    images_with_text = int(coverage.get("images_with_ocr_text") or 0)
    if images_with_text:
        reason += f"；已对 {images_with_text} 张图片做本地 OCR"
    if error_count:
        reason += f"；{error_count} 条 iSpec 未通过 schema 校验已丢弃"
    if skipped_count:
        reason += f"；{skipped_count} 个原生元素数据不完整，未生成 iSpec"
    if note:
        reason += note
    return reason


#: 单页图上限：超过就不发（避免把几十 MB 的页图塞进请求）。
MAX_LLM_IMAGE_BYTES = 12 * 1024 * 1024


def _llm_budget() -> int:
    """本次识别允许调用模型的页数（``LLM_MAX_CALLS``，默认 3，0 表示关闭）。"""

    try:
        from ..settings import get_settings

        return max(0, int(get_settings().llm_max_calls))
    except Exception:  # noqa: BLE001 - 配置读不到就当作关闭
        return 0


def _page_image_data_uri(material_id: str, page_no: int) -> str | None:
    """读渲染好的整页图并转成 data URI；不存在或过大返回 ``None``。"""

    try:
        from ..settings import RENDERS_DIR

        path = RENDERS_DIR / material_id / "pages" / f"s{page_no:02d}.png"
        if not path.is_file() or path.stat().st_size > MAX_LLM_IMAGE_BYTES:
            return None
        return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")
    except (OSError, ValueError):
        return None


def _page_llm_request(page: Mapping[str, Any], image_uri: str, material_id: str | None = None) -> LLMRequest:
    """为一页构造带图的请求：原文 + 该页图片里 OCR 到的文字都作为证据来源。"""

    page_no = page.get("page_no")
    base = _page_text(page)
    ocr_lines = [
        str(element.get("text") or "")
        for element in page.get("elements") or []
        if isinstance(element, Mapping)
        and element.get("kind") == "picture"
        and str(element.get("text") or "").strip()
    ]
    text = "\n".join(part for part in [base, "\n".join(ocr_lines)] if part).strip()
    summaries = [
        _element_summary(element)
        for element in page.get("elements") or []
        if isinstance(element, Mapping)
    ]
    return LLMRequest(
        material_id=material_id,
        pages=[
            {
                "page_no": page_no,
                "text": text[:MAX_LLM_PAGE_TEXT],
                "elements_summary": "；".join(summaries)[:MAX_LLM_ELEMENT_SUMMARY],
            }
        ],
        hints={"supported_kinds": list(SUPPORTED_KINDS), "max_specs": LLM_MAX_SPECS},
        images=[{"page_no": page_no, "data_uri": image_uri}],
    )


def build_ispecs_detailed(
    parsed_material: Any,
    *,
    material_id: str | None = None,
    llm: ISpecLLMProvider | None = None,
) -> IspecBuildResult:
    """生成 iSpec 并返回识别结论与校验错误（上传链路使用本函数）。

    识别优先级：**原生解析优先**（图表/表格/公式直读，确定性 100% 准）。
    只有原生一条 iSpec 都没有产出、且 ``llm.available()`` 为真时，才调用 LLM
    作为兜底；LLM 的每一条提议都必须通过 :func:`parse_ispecs` 的证据核验
    （``source.page`` + 能在该页原文中找到的 ``excerpt``），否则整条丢弃。

    :param parsed_material: ``parse_pptx`` 返回的 ``slides.json`` 字典。
    :param material_id: 材料 id；缺省取 ``parsed_material["material_id"]``。
    :param llm: 可选的 LLM provider；``None`` 等同未配置，识别层静默降级，
        不会发起任何网络请求。
    """
    pages = _pages(parsed_material)
    resolved_material = _material_id(parsed_material, material_id)

    generated: list[tuple[dict[str, Any], str]] = []
    skipped: list[str] = []

    for page in pages:
        page_no = page.get("page_no")
        if not isinstance(page_no, int) or page_no < 1:
            continue
        native_specs = build_native_math_specs(page, resolved_material)
        generated.extend((spec, _ORIGIN_FORMULA) for spec in native_specs)
        native_element_ids = {p['source']['element_id'] for spec in native_specs for p in spec['parameters']}
        page_title = str(page.get("title") or "")
        raw_elements = page.get("elements")
        if not isinstance(raw_elements, list):
            continue
        for element in raw_elements:
            if not isinstance(element, Mapping):
                continue
            kind = element.get("kind")
            element_id = element.get("element_id")
            if kind == "chart" or (kind == "picture" and isinstance(element.get("chart_data"), Mapping)):
                spec, chart_skip_reason = _chart_ispec(
                    element=element, page=page_no, material_id=resolved_material
                )
                origin = _ORIGIN_CHART
                if spec is None:
                    if kind == "chart":
                        skipped.append(
                            f"{element_id}: {chart_skip_reason or '图表缺少可直读的分类/数值'}"
                        )
                    continue
                if kind == "picture":
                    bbox = element.get("bbox")
                    if isinstance(bbox, Mapping):
                        spec["anchor"] = {"page": page_no, "element_id": element_id, "bbox": dict(bbox)}
                    spec["notes"] = "由视觉模型从原页图表截图提取，请结合原图核对关键数值。"
            elif kind == "table":
                spec = _table_ispec(
                    element=element,
                    page=page_no,
                    material_id=resolved_material,
                    page_title=page_title,
                )
                origin = _ORIGIN_TABLE
                if spec is None:
                    skipped.append(f"{element_id}: 表格缺少非空表头")
                    continue
            elif element.get("math_text"):
                if element_id in native_element_ids:
                    continue
                # 不再生成无图形、不执行求值的 OMML 降级空壳交互，直接保留原页阅读。
                skipped.append(f"{element_id}: OMML 公式未解析出可求值模型，已保留原文")
                continue
            else:
                continue
            generated.append((spec, origin))

    # 纯文字/位图课件的离线结构启发式：只对没有原生图表/表格的页补充文本表格，
    # 并跳过已被原生 iSpec 使用的元素。结果标记 inferred，等待用户核对。
    structured_pages: set[int] = set()
    covered_by_page: dict[int, set[str]] = {}
    for spec, origin in generated:
        page_no = _spec_page(spec)
        if page_no is None:
            continue
        if origin in (_ORIGIN_CHART, _ORIGIN_TABLE):
            structured_pages.add(page_no)
        for parameter in spec.get("parameters", []) if isinstance(spec.get("parameters"), list) else []:
            source = parameter.get("source") if isinstance(parameter, Mapping) else None
            if (
                isinstance(source, Mapping)
                and source.get("page") == page_no
                and isinstance(source.get("element_id"), str)
            ):
                covered_by_page.setdefault(page_no, set()).add(source["element_id"])
    for page in pages:
        page_no = page.get("page_no")
        if not isinstance(page_no, int) or page_no < 1 or page_no in structured_pages:
            continue
        heuristics = build_text_structure_specs(
            page,
            resolved_material,
            covered_element_ids=covered_by_page.get(page_no, set()),
        )
        generated.extend((spec, _ORIGIN_HEURISTIC) for spec in heuristics)

    # Source boxes use EMU, exactly like the native page model.
    page_map = {p.get('page_no'): p for p in pages}
    for spec, _origin in generated:
        for parameter in spec.get('parameters', []):
            source = parameter.get('source', {})
            source_page = page_map.get(source.get('page'), {})
            source_element = next((e for e in source_page.get('elements', [])
                                   if e.get('element_id') == source.get('element_id')), {})
            source['bbox'] = source_element.get('bbox')

    valid: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    counts: dict[str, int] = {origin: 0 for origin in _ORIGIN_LABELS}
    schema_error_count = 0
    for spec, origin in generated:
        messages = validate_ispec(spec)
        if messages:
            errors.append({"object_id": spec.get("object_id"), "errors": messages})
            schema_error_count += 1
            continue
        valid.append(spec)
        counts[origin] += 1

    for reason in skipped:
        errors.append({"object_id": None, "errors": [reason]})

    # --- LLM 兜底：逐页补识别（只对"本页没有任何原生 iSpec 且含图片"的页）---
    # 原实现是"整份材料一条都没产出才调模型"，导致有原生图表的材料永远不会用到模型；
    # 现在改成按页推进：已有交互对象的页跳过，剩下的页最多调用 LLM_MAX_CALLS 次。
    llm_count = 0
    llm_note: str | None = None
    llm_tried = 0
    page_owner = {
        spec["parameters"][0]["source"]["page"]
        for spec in valid
        if spec.get("parameters") and isinstance(spec["parameters"][0].get("source"), Mapping)
    }
    try:
        from .user_config import _concept_specs, _spatial_specs

        for page in pages:
            pno = page.get("page_no")
            if isinstance(pno, int) and not isinstance(pno, bool) and pno not in page_owner:
                if _spatial_specs(page) or _concept_specs(page):
                    page_owner.add(pno)
    except Exception:  # noqa: BLE001
        pass

    def _record(llm_errors: list[dict[str, Any]], code: str, message: str) -> None:
        llm_errors.append({"object_id": None, "code": code, "errors": [message]})

    if llm is None:
        llm_note = LLM_UNAVAILABLE_NOTE
    else:
        try:
            available = bool(llm.available())
        except Exception as exc:  # noqa: BLE001 - 探针失败按不可用处理
            available = False
            _record(errors, "MODEL_UNAVAILABLE", f"LLM 可用性探测失败：{type(exc).__name__}")

        if not available:
            llm_note = LLM_UNAVAILABLE_NOTE
        else:
            budget = _llm_budget()
            for page in pages:
                page_no = page.get("page_no")
                if isinstance(page_no, bool) or not isinstance(page_no, int) or page_no < 1:
                    continue
                if page_no in page_owner or budget <= 0:
                    continue
                if not any(
                    isinstance(element, Mapping) and element.get("kind") == "picture"
                    for element in page.get("elements") or []
                ):
                    continue  # 没有图片的页交给原生解析，不发图片请求
                image = _page_image_data_uri(resolved_material, page_no)
                if image is None:
                    continue
                budget -= 1
                llm_tried += 1
                request = _page_llm_request(page, image, resolved_material)
                try:
                    response = llm.propose(request)
                    if not isinstance(response, LLMResponse):
                        raise TypeError("provider 返回类型不是 LLMResponse")
                    # 证据仍以该页文字为准；图片里能读到的文字（OCR 结果）也算原文。
                    outcome = parse_ispecs(response.raw_text, pages=request.pages)
                except LLMResponseInvalid as exc:
                    _record(errors, "LLM_RESPONSE_INVALID", str(exc))
                    continue
                except Exception as exc:  # noqa: BLE001 - 调用失败不得拖垮原生结果
                    _record(errors, "MODEL_UNAVAILABLE", f"LLM 调用失败：{type(exc).__name__}")
                    llm_note = "（LLM 调用失败：MODEL_UNAVAILABLE，已仅保留原生识别结果）"
                    continue

                if not outcome.ok:
                    _record(errors, "LLM_RESPONSE_INVALID", outcome.reason or "LLM 响应无法解析")
                    llm_note = "（LLM 响应无法解析，未采用任何模型结论）"
                for item in outcome.rejected:
                    _record(errors, "LLM_EVIDENCE_REJECTED", f"第{page_no}页 #{item.get('index')}: {item.get('reason')}")
                valid, added = _merge_llm_ispecs(valid, outcome.ispecs)
                if added:
                    llm_count += added
                    page_owner.add(page_no)

            # 没有页图（离线解析、CLI 直跑）时退回整份材料的纯文本调用；
            # 已经走过图片兜底就不再重复调用，避免一次识别打两次模型。
            if not valid and not llm_tried:
                try:
                    request = _llm_request(pages, resolved_material)
                    response = llm.propose(request)
                    if not isinstance(response, LLMResponse):
                        raise TypeError("provider 返回类型不是 LLMResponse")
                    outcome = parse_ispecs(response.raw_text, pages=request.pages)
                except LLMResponseInvalid as exc:
                    _record(errors, "LLM_RESPONSE_INVALID", str(exc))
                    llm_note = "（LLM 修复重试后仍未返回有效响应）"
                except Exception as exc:  # noqa: BLE001 - 调用失败不得拖垮原生结果
                    _record(errors, "MODEL_UNAVAILABLE", f"LLM 调用失败：{type(exc).__name__}")
                    llm_note = "（LLM 调用失败：MODEL_UNAVAILABLE，已仅保留原生识别结果）"
                else:
                    if not outcome.ok:
                        _record(errors, "LLM_RESPONSE_INVALID", outcome.reason or "LLM 响应无法解析")
                        llm_note = "（LLM 响应无法解析，未采用任何模型结论）"
                    for item in outcome.rejected:
                        _record(errors, "LLM_EVIDENCE_REJECTED", f"#{item.get('index')}: {item.get('reason')}")
                    valid, added = _merge_llm_ispecs(valid, outcome.ispecs)
                    llm_count += added
                    if outcome.rejected and not added:
                        llm_note = f"（LLM 提议 {len(outcome.rejected)} 条证据不足，已全部拒收）"

            if llm_tried and not llm_count:
                llm_note = f"（LLM 已尝试 {llm_tried} 页，未产出通过证据核验的结论）"

    # §9-4 跨页参数同一性：在通过校验的 iSpec 之间识别同一变量并分配共享键。
    # 只在一条 iSpec 出现的参数不分配；默认值不同的组标记 conflict，交给用户确认。
    # Matching scalar symbols alone do not establish cross-page identity.
    shared = assign_shared_keys([spec for spec in valid if not spec['object_id'].startswith('native_')])
    if shared.assignments:
        valid = apply_shared_keys(valid, shared)

    coverage = _coverage_stats(pages, valid)
    return IspecBuildResult(
        ispecs=valid,
        errors=errors,
        recognition={
            "found": bool(valid),
            "reason": _recognition_reason(
                counts=counts,
                valid_count=len(valid),
                error_count=schema_error_count,
                skipped_count=len(skipped),
                coverage=coverage,
                llm_count=llm_count,
                note=llm_note,
            ),
            "coverage": coverage,
        },
        shared_groups=shared.shared_groups,
    )


def build_ispecs(
    parsed_material: Any,
    *,
    material_id: str | None = None,
) -> list[dict[str, Any]]:
    """从解析产物生成通过 Schema 校验的 iSpec 列表。

    :returns: 空列表表示"未识别到交互区域"，调用方**不得**回退到公共示例区域。
    """
    return build_ispecs_detailed(parsed_material, material_id=material_id).ispecs


__all__ = [
    "MAX_EXCERPT",
    "SPEC_VERSION",
    "UNRECOGNIZED_REASON",
    "IspecBuildResult",
    "build_ispecs",
    "build_ispecs_detailed",
]

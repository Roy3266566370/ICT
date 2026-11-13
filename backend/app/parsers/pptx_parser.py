"""PPTX 解析器（C-MAT@1，plan §2.2.10）。

把一份课程 PPTX 解析成 ``material.json`` 与 ``slides.json`` 两个字典：

* **纯读取**：只读源文件，不写入、不联网、不调用 Office 客户端；
* **元素标识稳定**：``p{page_no:02d}_s{shape_index:02d}``。``shape_index`` 是
  0 起的页内形状序号，与 ``fixtures/ppt/sXX_Y.png`` 的命名规则一致
  （本仓库 35 张图片已逐条比对 ``shape.image.blob`` 字节数，全部相等）；
* **bbox 单位**：EMU（English Metric Unit，1 英寸 = 914400 EMU，1 像素 = 9525 EMU），
  绝对坐标，不做缩放，键固定为 ``x / y / w / h``；
* **原生数据直读**：``has_chart`` 的图表读取 ``plots[].categories`` 与
  ``series.name / series.values``，写入 ``chart_data``；``has_table`` 的表格读取
  ``rows[].cells[].text``，写入 ``table_data``。读取失败才保留
  ``unsupported_reason`` 并写明原因。OMML 公式（``a14:m`` / ``m:oMath``）提取为
  ``math_text``（简化 LaTeX/Unicode）；
* **组合递归展开**：分组（group）保留自身元素，并把子形状按深度优先展开为独立
  元素，``element_id`` 形如 ``p07_s04_g0_2``、``group_path`` 形如 ``[0, 2]``；
  子形状 bbox 通过组合的 ``chOff/chExt`` 换算为幻灯片绝对 EMU 坐标；
* **不编造**：标题只取原文的首行文本；页面没有文字时 ``title`` 返回空串而不是
  用页号顶替；SmartArt / 3D / 媒体仍只标注 ``kind`` 与 ``unsupported_reason``，
  绝不丢弃所在页面。

``python-pptx`` 为可选依赖：模块可在未安装时导入（供上传链路降级为
``MODEL_UNAVAILABLE``），此时 :func:`parse_pptx` 抛 :class:`ParseError`。
"""

from __future__ import annotations

import hashlib
import math
import os
import re
from collections.abc import Iterator, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import PARSER_VERSION, ParseError

try:  # pragma: no cover - 依赖环境
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    _PPTX_IMPORT_ERROR: Exception | None = None
except Exception as exc:  # pragma: no cover - 依赖环境
    Presentation = None  # type: ignore[assignment]
    MSO_SHAPE_TYPE = None  # type: ignore[assignment]
    _PPTX_IMPORT_ERROR = exc


#: 单个材料允许的最大页数，超过即 ``LIMIT_EXCEEDED``（§2.2.10、settings.max_slide_pages）。
MAX_PAGES = 100

#: 图片元素相对仓库根目录的资源目录，文件名规则 ``s{page:02d}_{shape_index}.png``。
ASSET_DIR = "fixtures/ppt"

#: 仓库根目录（``backend/app/parsers/pptx_parser.py`` 向上 4 层）。
REPO_ROOT = Path(__file__).resolve().parents[3]

_DEFAULT_GENERATOR = "pptx_parser.py@1"

_A_NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_P_NS = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
_M_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/math}"
_URI_SMARTART = "http://schemas.openxmlformats.org/drawingml/2006/diagram"
_URI_CHART = "http://schemas.openxmlformats.org/drawingml/2006/chart"
_URI_TABLE = "http://schemas.openxmlformats.org/drawingml/2006/table"

#: 纯装饰性首行（页码、章节号、巨大数字、"→" 等）：不参与标题评选。
_DECORATIVE_RE = re.compile(r"^[\s0-9.,:：%×xX/·\-—–→⇒=]+$")

#: 标题候选优先取带中文的首行：防止把 "A = UΣVᵀ"、"3×2" 这类装饰/公式块当标题。
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")

#: ``excerpt`` 上限，与 C-KO@1 SourceRef.excerpt 的 160 字约束一致。
_MAX_EXCERPT = 160


def _now_utc() -> str:
    """当前 UTC 时间，ISO 8601 秒级精度（``2026-11-01T12:00:00Z``）。"""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_file(path: str | os.PathLike[str]) -> str:
    """流式计算文件 SHA-256（不一次性读入大文件）。"""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_shape_type(shape: Any) -> Any:
    """读取 ``shape.shape_type``；部分 GraphFrame 会返回 ``None``。"""
    try:
        return shape.shape_type
    except Exception:  # pragma: no cover - python-pptx 兼容性
        return None


def _graphic_uri(shape: Any) -> str | None:
    """取 ``<a:graphicData uri="...">``，用于识别 SmartArt / 图表 / 表格。"""
    element = getattr(shape, "_element", None)
    if element is None:
        return None
    try:
        data = element.find(".//" + _A_NS + "graphicData")
    except Exception:  # pragma: no cover - 非标准 XML
        return None
    if data is None:
        return None
    return data.get("uri")


def _has_3d_format(shape: Any) -> bool:
    """判断形状是否带 3D 模型属性（``a:sp3d``）；只标注，不解析几何。"""
    element = getattr(shape, "_element", None)
    if element is None:
        return False
    try:
        return element.find(".//" + _A_NS + "sp3d") is not None
    except Exception:  # pragma: no cover - 非标准 XML
        return False


def _classify(shape: Any) -> tuple[str, str | None]:
    """返回 ``(kind, unsupported_reason)``。

    ``kind`` 取值固定为 ``text | shape | picture | group | table | chart``。
    """
    uri = _graphic_uri(shape)
    if uri == _URI_SMARTART:
        return "shape", "smartart_not_parsed"
    if uri == _URI_CHART or getattr(shape, "has_chart", False) is True:
        return "chart", "chart_data_not_parsed"
    if uri == _URI_TABLE or getattr(shape, "has_table", False) is True:
        return "table", None

    shape_type = _safe_shape_type(shape)
    if MSO_SHAPE_TYPE is not None:
        if shape_type == MSO_SHAPE_TYPE.PICTURE:
            return "picture", None
        if shape_type == MSO_SHAPE_TYPE.GROUP:
            # 组合本身保留一条元素，子形状另行递归展开（见 _walk_shapes）。
            return "group", None
        # 少数环境下 GraphicFrame 的 shape_type 直接给出 CHART/TABLE/DIAGRAM
        if shape_type == MSO_SHAPE_TYPE.CHART:
            return "chart", "chart_data_not_parsed"
        if shape_type == MSO_SHAPE_TYPE.TABLE:
            return "table", None
        if shape_type == MSO_SHAPE_TYPE.DIAGRAM:
            return "shape", "smartart_not_parsed"
        if shape_type == MSO_SHAPE_TYPE.MEDIA:
            return "shape", "media_not_parsed"
        if _has_3d_format(shape):
            return "shape", "shape_3d_not_parsed"
        if shape_type in (MSO_SHAPE_TYPE.TEXT_BOX, MSO_SHAPE_TYPE.PLACEHOLDER):
            return "text", None
        return "shape", None

    if _has_3d_format(shape):  # pragma: no cover - 无 python-pptx 时不会走到
        return "shape", "shape_3d_not_parsed"
    if getattr(shape, "has_text_frame", False):  # pragma: no cover
        return "text", None
    return "shape", None  # pragma: no cover


def _shape_text(shape: Any) -> str | None:
    """取形状原文文本（保留换行）；表格按行拼 ``a | b``；无文字返回 ``None``。"""
    if getattr(shape, "has_text_frame", False):
        text = shape.text_frame.text
        return text if text.strip() else None
    if getattr(shape, "has_table", False) is True:
        rows: list[str] = []
        for row in shape.table.rows:
            rows.append(" | ".join(cell.text for cell in row.cells))
        joined = "\n".join(rows)
        return joined if joined.strip() else None
    return None


def _round_int(value: Any) -> int:
    """把 EMU 长度/坐标转成 int；``None`` 视作 0（占位符继承布局时会缺坐标）。"""
    if value is None:
        return 0
    return int(value)


def _bbox(shape: Any) -> dict[str, int]:
    """元素外接框，单位 EMU，绝对坐标。"""
    return {
        "x": _round_int(getattr(shape, "left", None)),
        "y": _round_int(getattr(shape, "top", None)),
        "w": _round_int(getattr(shape, "width", None)),
        "h": _round_int(getattr(shape, "height", None)),
    }


#: 形状坐标变换 ``(sx, sy, tx, ty)``，含义 ``x_abs = sx * x_rel + tx``。
Transform = tuple[float, float, float, float]
#: 顶层形状的恒等变换。
_IDENTITY_TRANSFORM: Transform = (1.0, 1.0, 0.0, 0.0)


def _local_name(tag: Any) -> str:
    """XML 标签的本地名（去掉 ``{namespace}`` 前缀）；非字符串返回空串。"""
    if not isinstance(tag, str):
        return ""
    return tag.rsplit("}", 1)[-1]


def _compose_transform(parent: Transform, child: Transform) -> Transform:
    """复合两级变换：先应用 ``child``（组合内部），再应用 ``parent``（外层）。"""
    psx, psy, ptx, pty = parent
    csx, csy, ctx, cty = child
    return (psx * csx, psy * csy, psx * ctx + ptx, psy * cty + pty)


def _group_child_transform(group: Any) -> Transform:
    """组合子坐标系 → 组合父坐标系的变换（读 ``a:xfrm`` 的 off/ext/chOff/chExt）。

    读取失败或 ``chExt`` 为 0 时返回恒等变换：宁可保留 python-pptx 的原始
    left/top，也不凭猜测缩放坐标。
    """
    element = getattr(group, "_element", None)
    if element is None:
        return _IDENTITY_TRANSFORM
    try:
        xfrm = element.find(f"{_P_NS}grpSpPr/{_A_NS}xfrm")
    except Exception:  # pragma: no cover - 非标准 XML
        return _IDENTITY_TRANSFORM
    if xfrm is None:
        return _IDENTITY_TRANSFORM
    off = xfrm.find(_A_NS + "off")
    ext = xfrm.find(_A_NS + "ext")
    child_off = xfrm.find(_A_NS + "chOff")
    child_ext = xfrm.find(_A_NS + "chExt")
    if off is None or ext is None or child_off is None or child_ext is None:
        return _IDENTITY_TRANSFORM
    try:
        off_x = float(off.get("x", 0))
        off_y = float(off.get("y", 0))
        ext_x = float(ext.get("cx", 0))
        ext_y = float(ext.get("cy", 0))
        child_x = float(child_off.get("x", 0))
        child_y = float(child_off.get("y", 0))
        child_cx = float(child_ext.get("cx", 0))
        child_cy = float(child_ext.get("cy", 0))
    except (TypeError, ValueError):  # pragma: no cover - 属性缺失/非数字
        return _IDENTITY_TRANSFORM
    if child_cx == 0 or child_cy == 0:
        return _IDENTITY_TRANSFORM
    scale_x = ext_x / child_cx
    scale_y = ext_y / child_cy
    return (scale_x, scale_y, off_x - child_x * scale_x, off_y - child_y * scale_y)


def _transform_bbox(bbox: dict[str, int], transform: Transform) -> dict[str, int]:
    """把形状 bbox 应用到组合变换，结果仍为 EMU 绝对坐标（四舍五入到 int）。"""
    scale_x, scale_y, translate_x, translate_y = transform
    return {
        "x": int(round(bbox["x"] * scale_x + translate_x)),
        "y": int(round(bbox["y"] * scale_y + translate_y)),
        "w": int(round(bbox["w"] * scale_x)),
        "h": int(round(bbox["h"] * scale_y)),
    }


def _walk_shapes(
    shapes: Sequence[Any],
    *,
    page_no: int,
    parent_transform: Transform,
    parent_element_id: str | None = None,
    parent_path: list[int] | None = None,
    top_index: int | None = None,
) -> Iterator[tuple[Any, int, str, list[int] | None, dict[str, int]]]:
    """深度优先展开页内形状，产出 ``(shape, shape_index, element_id, group_path, bbox)``。

    顶层元素 id 为 ``p07_s04``；组合子元素为 ``p07_s04_g0_2``（``group_path=[0, 2]``），
    嵌套组合继续追加 ``_gN``。``shape_index`` 始终记录顶层形状序号，保证既有
    ``s{page}_{shape_index}.png`` 资源命名不受影响。
    """
    for index, shape in enumerate(shapes):
        current_top = index if top_index is None else top_index
        bbox = _transform_bbox(_bbox(shape), parent_transform)
        if parent_element_id is None:
            element_id = f"p{page_no:02d}_s{index:02d}"
            group_path: list[int] | None = None
        else:
            element_id = f"{parent_element_id}_g{index}"
            group_path = [*(parent_path or []), index]
        yield shape, current_top, element_id, group_path, bbox

        shape_type = _safe_shape_type(shape)
        if (
            MSO_SHAPE_TYPE is not None
            and shape_type == MSO_SHAPE_TYPE.GROUP
            and hasattr(shape, "shapes")
        ):
            child_transform = _compose_transform(parent_transform, _group_child_transform(shape))
            yield from _walk_shapes(
                list(shape.shapes),
                page_no=page_no,
                parent_transform=child_transform,
                parent_element_id=element_id,
                parent_path=group_path,
                top_index=current_top,
            )


def _category_text(value: Any) -> str:
    """图表分类标签 → 字符串；整数值浮点写成 ``2020`` 而不是 ``2020.0``（不改写文本）。"""
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, (int, float)):
        number = float(value)
        if not math.isfinite(number):
            return ""
        return str(int(number)) if number.is_integer() else repr(number)
    return str(value)


def _number_value(value: Any) -> float | int | None:
    """图表数值 → JSON 数值；``None``/布尔/非有限值返回 ``None``（由调用方丢弃）。"""
    if value is None or isinstance(value, bool):
        return None
    if not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    return int(number) if number.is_integer() else round(number, 10)


def _chart_type_name(chart: Any) -> str:
    """``XlChartType`` 成员 → 稳定字符串（优先枚举名，退化到 ``str()``）。"""
    raw = getattr(chart, "chart_type", None)
    name = getattr(raw, "name", None)
    if isinstance(name, str) and name:
        return name
    return str(raw) if raw is not None else "unknown"


def _chart_title(chart: Any) -> str:
    """图表标题原文；没有标题或读取失败返回空串（不编造）。"""
    try:
        if getattr(chart, "has_title", False):
            return str(getattr(chart.chart_title, "text_frame").text or "").strip()
    except Exception:  # pragma: no cover - 标题结构异常
        return ""
    return ""


def _chart_data(shape: Any) -> tuple[dict[str, Any] | None, str | None]:
    """直读原生图表：``chart_type / categories / series[{name, values}] / title``。

    返回 ``(chart_data, unsupported_reason)``：读取成功时原因为 ``None``；
    读取失败时 ``chart_data`` 为 ``None``，原因以 ``chart_data_not_parsed`` 开头。
    """
    try:
        has_chart = getattr(shape, "has_chart", False) is True
    except Exception:  # pragma: no cover - GraphFrame 兼容性
        has_chart = False
    if not has_chart:
        return None, "chart_data_not_parsed: 形状未暴露 chart 接口"

    try:
        chart = shape.chart
        chart_type = _chart_type_name(chart)
        title = _chart_title(chart)
        categories: list[str] = []
        series_items: list[dict[str, Any]] = []
        for plot in chart.plots:
            if not categories:
                raw_categories = getattr(plot, "categories", None)
                if raw_categories:
                    categories = [_category_text(item) for item in raw_categories]
            for series in getattr(plot, "series", ()) or ():
                raw_name = getattr(series, "name", None)
                values: list[float | int] = []
                for item in getattr(series, "values", None) or ():
                    converted = _number_value(item)
                    if converted is not None:
                        values.append(converted)
                series_items.append(
                    {"name": "" if raw_name is None else str(raw_name), "values": values}
                )
    except Exception as exc:  # noqa: BLE001 - 读取失败只降级该元素，不影响整页
        return None, f"chart_data_not_parsed: 读取 chart 失败（{type(exc).__name__}: {exc}）"

    return (
        {
            "chart_type": chart_type,
            "categories": categories,
            "series": series_items,
            "title": title,
        },
        None,
    )


def _table_data(shape: Any) -> tuple[dict[str, Any] | None, str | None]:
    """直读表格：首行进 ``headers``，其余行进 ``rows``；单元格文本保持原文。"""
    try:
        has_table = getattr(shape, "has_table", False) is True
    except Exception:  # pragma: no cover - GraphFrame 兼容性
        has_table = False
    if not has_table:
        return None, "table_data_not_parsed: 形状未暴露 table 接口"

    try:
        rows = [
            [str(cell.text or "") for cell in row.cells] for row in shape.table.rows
        ]
    except Exception as exc:  # noqa: BLE001 - 读取失败只降级该元素
        return None, f"table_data_not_parsed: 读取 table 失败（{type(exc).__name__}: {exc}）"

    if not rows:
        return {"headers": [], "rows": []}, None
    return {"headers": rows[0], "rows": rows[1:]}, None


def _omml_node_text(node: Any) -> str:
    """把 OMML 节点转成简化的 LaTeX/Unicode 文本（上标/下标/分式/根式/括号）。"""
    local = _local_name(getattr(node, "tag", ""))
    if local == "t":
        return node.text or ""
    if not local or local.endswith("Pr"):
        return ""
    content = [
        child
        for child in node
        if _local_name(getattr(child, "tag", "")) and not _local_name(child.tag).endswith("Pr")
    ]
    if local == "sSup" and len(content) >= 2:
        return f"{_omml_node_text(content[0])}^{{{_omml_node_text(content[1])}}}"
    if local == "sSub" and len(content) >= 2:
        return f"{_omml_node_text(content[0])}_{{{_omml_node_text(content[1])}}}"
    if local == "sSubSup" and len(content) >= 3:
        base = _omml_node_text(content[0])
        sub = _omml_node_text(content[1])
        sup = _omml_node_text(content[2])
        return f"{base}_{{{sub}}}^{{{sup}}}"
    if local == "f" and len(content) >= 2:
        return (
            f"\\frac{{{_omml_node_text(content[0])}}}"
            f"{{{_omml_node_text(content[1])}}}"
        )
    if local == "rad":
        if len(content) >= 2:
            degree = _omml_node_text(content[0])
            body = _omml_node_text(content[1])
            return f"\\sqrt[{degree}]{{{body}}}" if degree else f"\\sqrt{{{body}}}"
        if content:
            return f"\\sqrt{{{_omml_node_text(content[0])}}}"
    if local == "d":
        inner = "".join(_omml_node_text(child) for child in content)
        return f"({inner})"
    if local == "nary":
        marker = _omml_nary_char(node)
        body = "".join(_omml_node_text(child) for child in content)
        return f"{marker}{body}"
    return "".join(_omml_node_text(child) for child in content)


def _omml_nary_char(node: Any) -> str:
    """求和/求积等 N 元运算符字符（``m:naryPr/m:chr/@m:val``），缺省为 ``∑``。"""
    element = node.find(f"{_M_NS}naryPr/{_M_NS}chr")
    if element is None:
        return "∑"
    value = element.get(_M_NS + "val") or element.get("val")
    return str(value) if value else "∑"


def _omml_text(shape: Any) -> str | None:
    """提取形状内的 OMML 公式文本（``m:oMath``，含 ``a14:m`` 包装形式）。

    只做文本/结构转换，不做数值求值；多条公式按出现顺序以空格连接。
    无公式时返回 ``None``。
    """
    element = getattr(shape, "_element", None)
    if element is None:
        return None
    try:
        nodes = element.findall(".//" + _M_NS + "oMath")
    except Exception:  # pragma: no cover - 非标准 XML
        return None
    texts = [
        text
        for text in (_omml_node_text(node).strip() for node in nodes)
        if text
    ]
    joined = " ".join(texts)
    return joined or None


def _max_font_pt(shape: Any) -> float:
    """形状内可见文本的最大字号（pt）；读不到字号返回 0。"""
    if not getattr(shape, "has_text_frame", False):
        return 0.0
    best = 0.0
    for paragraph in shape.text_frame.paragraphs:
        size = paragraph.font.size
        if size is not None:
            best = max(best, size.pt)
        for run in paragraph.runs:
            size = run.font.size
            if size is not None:
                best = max(best, size.pt)
    return best


def _first_line(shape: Any) -> str:
    """形状文本的首个非空行（去两端空白，不改写内容）。"""
    text = _shape_text(shape)
    if not text:
        return ""
    for line in text.split("\n"):
        if line.strip():
            return line.strip()
    return ""


def _pick_title(shapes: list[Any]) -> str:
    """页面标题：首选"带中文的最大字号文本框首行"，退化后再放宽到任意文本框。

    三轮选取（每轮都跳过 "01"、"1.618"、"100×" 这类纯装饰性编号行）：

    1. 首行含中文（CJK）的最大字号文本框 —— 避免把 ``A = UΣVᵀ``、``3×2``
       这种公式/装饰块误判成标题；
    2. 任意首行非装饰的最大字号文本框（纯拉丁标题页走这一轮）；
    3. 首个有文字的文本框首行。

    整页无文字时返回空串 —— 不用页号顶替，不编造标题。
    """
    candidates: list[tuple[float, int, str]] = []
    for index, shape in enumerate(shapes):
        if not getattr(shape, "has_text_frame", False):
            continue
        first = _first_line(shape)
        if not first or _DECORATIVE_RE.match(first):
            continue
        candidates.append((_max_font_pt(shape), index, first))

    for predicate in (
        lambda text: bool(_CJK_RE.search(text)),
        lambda text: True,
    ):
        pool = [item for item in candidates if predicate(item[2])]
        if pool:
            # 字号优先，同字号取页内更靠前的形状，保证结果稳定
            best = pool[0]
            for item in pool[1:]:
                if item[0] > best[0]:
                    best = item
            return best[2]

    for shape in shapes:
        if getattr(shape, "has_text_frame", False):
            first = _first_line(shape)
            if first:
                return first
    return ""


def _page_paragraphs(shapes: list[Any]) -> list[str]:
    """页面原文段落（按形状顺序展平，保留原有换行；仅去两端空白）。"""
    paragraphs: list[str] = []
    for shape in shapes:
        text = _shape_text(shape)
        if not text:
            continue
        for line in text.split("\n"):
            stripped = line.strip()
            if stripped:
                paragraphs.append(stripped)
    return paragraphs


def _page_excerpt(paragraphs: list[str]) -> str:
    """页面摘录：原文段落按行拼接后截断到 160 字（不重写、不补全）。"""
    return "\n".join(paragraphs)[:_MAX_EXCERPT]


def _asset_filename(page_no: int, shape_index: int) -> str:
    """图片资源的文件名：``s{页号两位}_{形状序号}.png``（序号不补零）。

    与仓库既有 ``fixtures/ppt/s06_3.png`` 命名逐字一致；``element_id`` 里的
    ``s03`` 是为了排序可读性补零，两者不是同一个用途。
    """
    return f"s{page_no:02d}_{shape_index}.png"


def _asset_relative_path(page_no: int, shape_index: int) -> str:
    """图片元素的固定资源路径（POSIX 分隔符），与 fixtures/ppt 命名一致。"""
    return f"{ASSET_DIR}/{_asset_filename(page_no, shape_index)}"


def _resolve_asset_root(asset_dir: str | os.PathLike[str] | None) -> Path:
    """解析图片资源目录的绝对路径。"""
    if asset_dir is None:
        return REPO_ROOT / ASSET_DIR
    candidate = Path(asset_dir)
    return candidate if candidate.is_absolute() else (REPO_ROOT / candidate)


def _element_of(
    *,
    page_no: int,
    shape_index: int,
    shape: Any,
    asset_root: Path,
    warnings: list[dict[str, Any]],
    element_id: str | None = None,
    group_path: list[int] | None = None,
    bbox: dict[str, int] | None = None,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """构建一条元素记录；图片元素额外返回一条 ``assets`` 条目。

    ``element_id / group_path / bbox`` 由 :func:`_walk_shapes` 给出：组合子元素
    使用 ``p07_s04_g0_2`` 形式，``bbox`` 已换算为幻灯片绝对 EMU 坐标。
    """
    resolved_id = element_id or f"p{page_no:02d}_s{shape_index:02d}"
    kind, unsupported_reason = _classify(shape)
    chart_data: dict[str, Any] | None = None
    table_data: dict[str, Any] | None = None
    if kind == "chart":
        chart_data, chart_error = _chart_data(shape)
        unsupported_reason = chart_error
    elif kind == "table":
        table_data, table_error = _table_data(shape)
        unsupported_reason = table_error

    text = _shape_text(shape)
    element: dict[str, Any] = {
        "element_id": resolved_id,
        "shape_index": shape_index,
        "name": getattr(shape, "name", "") or "",
        "kind": kind,
        "text": text,
        "bbox": dict(bbox) if bbox is not None else _bbox(shape),
        "image_path": None,
        "image_ext": None,
        "image_bytes": None,
        "asset_id": None,
        "unsupported_reason": unsupported_reason,
        # --- 以下为新增字段（既有字段与顺序保持不变）---
        "group_path": list(group_path) if group_path is not None else None,
        "chart_data": chart_data,
        "table_data": table_data,
        # 组合元素不重复提取公式：子形状会各自给出 math_text，避免同一条公式产出两份 iSpec。
        "math_text": None if kind == "group" else _omml_text(shape),
    }
    if kind != "picture":
        return element, None

    image = getattr(shape, "image", None)
    blob = b""
    image_ext: str | None = None
    if image is not None:
        try:
            # 外链图片无法取到 blob：按"无内嵌数据"处理，不让整页解析失败
            blob = image.blob
            image_ext = getattr(image, "ext", None)
        except Exception:  # pragma: no cover - 外链/异常图片
            blob = b""
    element["image_ext"] = image_ext
    element["image_bytes"] = len(blob)

    if group_path is not None:
        # 组合内图片没有对应的 fixtures/ppt/sNN_M.png 基线：只记内嵌字节，不伪造路径。
        return element, None

    relative = _asset_relative_path(page_no, shape_index)
    absolute = asset_root / _asset_filename(page_no, shape_index)
    if not absolute.is_file():
        # 上传链路不会有预置 png：这里只记 warning，不伪造 image_path
        warnings.append(
            {
                "page_no": page_no,
                "element_id": resolved_id,
                "reason": "asset_file_missing",
                "expected_file": relative,
            }
        )
        return element, None
    if blob and absolute.stat().st_size != len(blob):
        warnings.append(
            {
                "page_no": page_no,
                "element_id": resolved_id,
                "reason": "asset_size_mismatch",
                "expected_file": relative,
                "file_bytes": absolute.stat().st_size,
                "blob_bytes": len(blob),
            }
        )

    element["image_path"] = relative
    element["asset_id"] = resolved_id
    asset = {
        "asset_id": resolved_id,
        "page_no": page_no,
        "shape_index": shape_index,
        "file": relative,
        "bbox": element["bbox"],
        "image_ext": element["image_ext"],
        "image_bytes": len(blob),
        "sha256": hashlib.sha256(blob).hexdigest(),
    }
    return element, asset


def _core_timestamp(presentation: Any, attribute: str) -> str | None:
    """读 PPT 核心属性时间（created/modified），转为 ISO 8601 UTC 字符串。"""
    try:
        value = getattr(presentation.core_properties, attribute, None)
    except Exception:  # pragma: no cover - 非标准核心属性
        return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.strftime("%Y-%m-%dT%H:%M:%SZ")
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_material_dict(
    *,
    path: str,
    page_count: int,
    slide_width_emu: int,
    slide_height_emu: int,
    material_id: str,
    title: str,
    generator: str = _DEFAULT_GENERATOR,
    parsed_at: str | None = None,
    source_created_at: str | None = None,
    source_modified_at: str | None = None,
    sha256: str | None = None,
    size_bytes: int | None = None,
) -> dict[str, Any]:
    """构建 ``material.json``。

    主键用任务口径（``id`` / ``source_filename`` / ``status`` / ``generator`` /
    ``size_bytes`` / ``sha256`` / ``source_sha256``），同时保留 C-MAT@1 的
    ``material_id`` / ``source_file`` / ``slide_width_emu`` / ``slide_height_emu`` /
    ``parser_version`` / ``retention`` 兼容别名，两套取值由同一来源生成、始终相等。

    ``sha256`` / ``size_bytes`` 可由调用方传入以避免重复读盘（``parse_pptx`` 会传）。
    """
    resolved_size = os.path.getsize(path) if size_bytes is None else size_bytes
    digest = sha256_file(path) if sha256 is None else sha256
    return {
        "id": material_id,
        "material_id": material_id,
        "title": title,
        "source_filename": os.path.basename(path),
        "source_file": os.path.basename(path),
        "page_count": page_count,
        "slide_width_emu": int(slide_width_emu),
        "slide_height_emu": int(slide_height_emu),
        "size_bytes": resolved_size,
        "sha256": digest,
        "source_sha256": digest,
        "parsed_at": parsed_at or _now_utc(),
        "status": "ready",
        "generator": generator,
        "parser_version": PARSER_VERSION,
        "retention": "static_fixture",
        "source_created_at": source_created_at,
        "source_modified_at": source_modified_at,
    }


def parse_pptx(
    path: str | os.PathLike[str],
    *,
    material_id: str | None = None,
    title: str | None = None,
    generator: str = _DEFAULT_GENERATOR,
    asset_dir: str | os.PathLike[str] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """解析 PPTX，返回 ``(material_dict, slides_dict)``（结构见 plan §2.2.10）。

    :param path: 源 pptx 路径（只读）。
    :param material_id: 材料 id；缺省用 ``mat_`` + 内容 SHA-256 前 12 位（确定性）。
    :param title: 标题；缺省取 PPT 核心属性 title → 首页标题 → 文件名主干。
    :param generator: 写入 ``material.json.generator`` 的生成器标识。
    :param asset_dir: 图片资源目录；缺省 ``<repo>/fixtures/ppt``。
    :returns: 两个可直接 ``json.dumps`` 的字典。
    :raises ParseError: 文件缺失/为空 → ``INVALID_FILE``；损坏/加密/无页 →
        ``PARSE_FAILED``；页数 > 60 → ``LIMIT_EXCEEDED``。
    :
    ``slides_dict`` 的 ``slides`` 为权威列表，``pages`` 是同一列表的兼容镜像
    （C-MAT@1 用 ``pages``，C-API@1 ``MaterialDetail`` 用 ``slides``）；
    ``bbox`` 单位为 EMU；``assets`` 仅收录磁盘上真实存在且字节数与嵌入 blob
    一致的图片，缺失/不一致写入 ``warnings``。
    """
    if Presentation is None:
        raise ParseError(
            "PARSE_FAILED",
            f"python-pptx 不可用，无法解析 PPTX：{_PPTX_IMPORT_ERROR}",
        )

    source = os.fspath(path)
    if not source or not os.path.isfile(source):
        raise ParseError("INVALID_FILE", f"文件不存在或不可读：{source}")
    if os.path.getsize(source) == 0:
        raise ParseError("INVALID_FILE", f"文件为空：{source}")

    try:
        presentation = Presentation(source)
        slide_list = list(presentation.slides)
    except Exception as exc:  # python-pptx 对损坏/加密文件抛多种异常
        raise ParseError(
            "PARSE_FAILED",
            f"无法解析 PPTX（可能损坏、加密或不是 pptx）：{type(exc).__name__}",
        ) from None

    page_count = len(slide_list)
    if page_count == 0:
        raise ParseError("PARSE_FAILED", "演示文稿没有任何幻灯片")
    if page_count > MAX_PAGES:
        raise ParseError(
            "LIMIT_EXCEEDED",
            f"页数 {page_count} 超过上限 {MAX_PAGES}",
        )

    width = getattr(presentation, "slide_width", None)
    height = getattr(presentation, "slide_height", None)
    if not width or not height:
        raise ParseError("PARSE_FAILED", "演示文稿缺少页面尺寸（slide_width/height）")

    size_bytes = os.path.getsize(source)
    digest = sha256_file(source)
    material_id = material_id or f"mat_{digest[:12]}"
    asset_root = _resolve_asset_root(asset_dir)

    pages: list[dict[str, Any]] = []
    assets: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    for page_index, slide in enumerate(slide_list, start=1):
        shapes = list(slide.shapes)
        # 组合递归展开：组合自身一条元素 + 子形状按深度优先追加（含组合内文字）。
        walked = list(
            _walk_shapes(
                shapes,
                page_no=page_index,
                parent_transform=_IDENTITY_TRANSFORM,
            )
        )
        elements: list[dict[str, Any]] = []
        for shape, shape_index, element_id, group_path, bbox in walked:
            element, asset = _element_of(
                page_no=page_index,
                shape_index=shape_index,
                shape=shape,
                asset_root=asset_root,
                warnings=warnings,
                element_id=element_id,
                group_path=group_path,
                bbox=bbox,
            )
            elements.append(element)
            if asset is not None:
                assets.append(asset)

        flat_shapes = [item[0] for item in walked]
        paragraphs = _page_paragraphs(flat_shapes)
        first_picture = next((item for item in elements if item["kind"] == "picture"), None)
        pages.append(
            {
                "page_no": page_index,
                "width": int(width),
                "height": int(height),
                "title": _pick_title(flat_shapes),
                "paragraphs": paragraphs,
                "elements": elements,
                "excerpt": _page_excerpt(paragraphs),
                "image_url": first_picture["image_path"] if first_picture else None,
                "image_asset_id": first_picture["asset_id"] if first_picture else None,
            }
        )

    resolved_title = (
        title
        or (getattr(presentation.core_properties, "title", "") or "").strip()
        or (pages[0]["title"] if pages else "")
        or Path(source).stem
    )

    material = build_material_dict(
        path=source,
        page_count=page_count,
        slide_width_emu=int(width),
        slide_height_emu=int(height),
        material_id=material_id,
        title=resolved_title,
        generator=generator,
        source_created_at=_core_timestamp(presentation, "created"),
        source_modified_at=_core_timestamp(presentation, "modified"),
        sha256=digest,
        size_bytes=size_bytes,
    )

    slides: dict[str, Any] = {
        "schema_version": "0.2",
        "material_id": material_id,
        "slide_width_emu": int(width),
        "slide_height_emu": int(height),
        "bbox_unit": "EMU",
        "slides": pages,
        "pages": [dict(page) for page in pages],
        "assets": assets,
        "warnings": warnings,
    }
    return material, slides

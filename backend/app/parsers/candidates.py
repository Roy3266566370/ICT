"""规则化候选提取（C-MAT@1 P1 澄清，plan §2.2.10）。

定位：优先把 :func:`app.ispec.build_ispecs` 产出的 iSpec 转成候选（任意材料的
原生图表 / 表格 / OMML 公式都能得到候选）；只有**没有任何 iSpec** 时，才退回
原有矩阵正则扫描（``识别方式: regex_fallback``）。

三条硬约束：

1. **不编造**：只从原文正则抓取。由原文按线性性反推的量标
   ``source_status="inferred"`` 并在 ``reason`` 里写清依据；原文提到但没给数值的
   量保留 ``value=None``，绝不按知识库补齐。
2. **不自动合并同名符号**：同一符号在原文出现多个取值时保留为多条候选，由
   :func:`detect_merge_conflicts` 单独报告冲突（``merge_conflicts``）。
3. **不抛异常**：输入缺字段、为空或不是 dict 时返回空列表。

每个候选项包含（任务口径字段）::

    name / raw_text / value / unit / range / page / element_id / confidence /
    source_status / notes

以及可追溯性补充字段 ``kind`` / ``symbol`` / ``reason``；为兼容 plan §2.2.7 的
``CandidateObject``，另带 ``candidate_id`` / ``template_id`` / ``confidence_hint`` /
``fields`` 四个只读派生键。``element_id`` 为 ``None`` 表示该候选只来自页级段落
（页面没有元素列表时的兜底扫描）。
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Mapping, Sequence
from typing import Any

from ..ispec import build_ispecs

_NUMBER = r"[-+]?(?:\d+(?:\.\d+)?|\.\d+)"

#: ``(1, 0) → (2, 1)`` / ``(1,1)->(3,3)`` 形式的向量映射。
_PAIR_RE = re.compile(
    rf"\(\s*(?P<x1>{_NUMBER})\s*,\s*(?P<y1>{_NUMBER})\s*\)"
    rf"\s*(?:→|⇒|=>|->|—>)\s*"
    rf"\(\s*(?P<x2>{_NUMBER})\s*,\s*(?P<y2>{_NUMBER})\s*\)"
)

#: ``[[2,1],[1,2]]`` 或 ``A = [[2,1],[1,2]]`` 形式的矩阵字面量。
_MATRIX_RE = re.compile(
    rf"(?:(?P<symbol>[A-Za-z])\s*=\s*)?"
    rf"\[\s*\[\s*(?P<a11>{_NUMBER})\s*,\s*(?P<a12>{_NUMBER})\s*\]\s*,"
    rf"\s*\[\s*(?P<a21>{_NUMBER})\s*,\s*(?P<a22>{_NUMBER})\s*\]\s*\]"
)

#: ``λ = 3`` / ``特征值 λ = 3`` / ``特征值为 0``。
_EIGEN_RE = re.compile(rf"λ\s*=\s*(?P<eigen>{_NUMBER})")
_EIGEN_WORD_RE = re.compile(rf"特征值\s*(?:为|是|=|＝)\s*(?P<eigen>{_NUMBER})")

#: ``det A = 3`` / ``行列式 = 3`` / ``rank A = 2`` / ``trace A = 4`` 这类带数值的标量量。
_DET_VALUE_RE = re.compile(
    rf"(?:det\s*(?P<dsym>[A-Za-z])?\s*(?:=|＝)\s*(?P<dval>{_NUMBER}))"
    rf"|(?:行列式\s*(?:=|＝|为)\s*(?P<dval2>{_NUMBER}))"
)
_RANK_VALUE_RE = re.compile(
    rf"(?:rank\s*(?P<rsym>[A-Za-z])?\s*(?:=|＝|为)\s*(?P<rval>{_NUMBER}))"
    rf"|(?:秩\s*(?:=|＝|为)\s*(?P<rval2>{_NUMBER}))"
)
_TRACE_VALUE_RE = re.compile(
    rf"(?:trace\s*(?P<tsym>[A-Za-z])?\s*(?:=|＝|为)\s*(?P<tval>{_NUMBER}))"
    rf"|(?:迹\s*(?:=|＝|为)\s*(?P<tval2>{_NUMBER}))"
)

#: 只提到概念、没给数值的兜底匹配（``det A``、``秩``、``迹``）。
_DET_MENTION_RE = re.compile(r"det\s*(?P<msym>[A-Za-z])?|行列式")
_RANK_MENTION_RE = re.compile(r"rank\s*(?P<msym>[A-Za-z])?|秩")
_TRACE_MENTION_RE = re.compile(r"trace\s*(?P<msym>[A-Za-z])?|迹")

#: 矩阵 / 向量元素的参数范围，与 C-MX@1 规则 7 一致。
_ELEMENT_RANGE = {"min": -3, "max": 3, "step": 0.1}

#: 无 iSpec 时矩阵正则兜底使用的模板（C-API@1 ``TemplateId`` 四值之一）。
REGEX_FALLBACK_TEMPLATE_ID = "matrix_2d"
#: 兜底候选的识别方式标记（写入候选 ``notes``，准备页据此展示来源）。
REGEX_FALLBACK_NOTE = "识别方式: regex_fallback"
#: 兼容旧内部引用；非 iSpec 路径（正则兜底）仍使用该模板。
_TEMPLATE_ID = REGEX_FALLBACK_TEMPLATE_ID

#: iSpec ``kind`` → C-API@1 ``TemplateId`` 的映射。
#:
#: ``TemplateId`` 在契约里是四模板枚举（matrix_2d / force_2d / bfs_flow /
#: budget_compare），iSpec 的 ``object_id`` 不能直接作为 ``template_id``；
#: 这里按交互原语选最接近的既有模板，精确的 iSpec 标识写入候选 ``notes``。
_TEMPLATE_BY_ISPEC_KIND: dict[str, str] = {
    "filter": "budget_compare",
    "step": "bfs_flow",
    "geometric": "force_2d",
    "parametric": "matrix_2d",
    "branch": "matrix_2d",
}

_TOL = 1e-9


def _num(text: str) -> float | int:
    """把匹配到的数字串转成 int/float；整数值统一为 int（JSON 更可读）。"""
    value = float(text)
    if value == 0:
        return 0
    if value.is_integer():
        return int(value)
    return round(value, 10)


def _stable_value(value: Any) -> str:
    """值的稳定字符串表示，用于去重与冲突比对。"""
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _confidence_hint(confidence: float) -> str:
    """把数值置信度映射为 §2.2.7 的 ``confidence_hint`` 枚举。"""
    return "medium" if confidence >= 0.6 else "low"


def _fields_of(kind: str, name: str, value: Any) -> list[dict[str, str]]:
    """派生 CandidateObject.fields：候选覆盖到的参数字段及状态。"""
    status = "present" if value is not None else "missing"
    parameter_ids = {
        "vector_mapping": "vector_x",
        "matrix_literal": "matrix_A",
        "matrix_derived": "matrix_A",
        "eigenvalue": "matrix_A",
        "det": "matrix_A",
        "rank": "matrix_A",
        "trace": "matrix_A",
    }
    parameter_id = parameter_ids.get(kind)
    if parameter_id is None:  # pragma: no cover - 规则与上表同步维护
        return []
    return [{"parameter_id": parameter_id, "name": name, "status": status}]


def _candidate(
    *,
    kind: str,
    name: str,
    symbol: str | None,
    raw_text: str,
    value: Any,
    page: int,
    element_id: str | None,
    confidence: float,
    source_status: str = "original",
    reason: str | None = None,
    value_range: dict[str, Any] | None = None,
    template_id: str = REGEX_FALLBACK_TEMPLATE_ID,
    notes: str = REGEX_FALLBACK_NOTE,
) -> dict[str, Any]:
    """构造一条候选；字段顺序固定，便于 diff 与人工复核。"""
    return {
        "name": name,
        "raw_text": raw_text,
        "value": value,
        "unit": "1",
        "range": value_range,
        "page": page,
        "element_id": element_id,
        "confidence": round(float(confidence), 2),
        "source_status": source_status,
        "kind": kind,
        "symbol": symbol,
        "reason": reason,
        "notes": notes,
        "candidate_id": None,  # 由 _finalize 统一定稿
        "template_id": template_id,
        "confidence_hint": _confidence_hint(confidence),
        "fields": _fields_of(kind, name, value),
    }


def _emit_quantity(
    *,
    out: list[dict[str, Any]],
    text: str,
    page_no: int,
    element_id: str | None,
    kind: str,
    label_cn: str,
    label_sym: str,
    value_re: re.Pattern[str],
    symbol_group: str,
    value_groups: tuple[str, str],
    mention_re: re.Pattern[str],
) -> None:
    """提取标量量（det / rank / trace）：

    * 原文给出数值 → ``value=数值``、``confidence=0.8``；
    * 原文只提到概念 → ``value=None``、``confidence=0.3``（不按知识库补全）；
    * 已有数值命中时不再产出概念候选，避免同一行重复。
    """
    found = False
    for match in value_re.finditer(text):
        found = True
        raw_value = match[value_groups[0]]
        if raw_value is None:
            raw_value = match[value_groups[1]]
        symbol = (match[symbol_group] or "").upper()
        out.append(
            _candidate(
                kind=kind,
                name=f"{label_cn} {label_sym} {symbol}".strip(),
                symbol=f"{label_sym} {symbol}".strip(),
                raw_text=text,
                value=_num(raw_value),
                page=page_no,
                element_id=element_id,
                confidence=0.8,
                value_range=_ELEMENT_RANGE,
            )
        )
    if found:
        return
    for match in mention_re.finditer(text):
        symbol = (match["msym"] or "").upper()
        out.append(
            _candidate(
                kind=kind,
                name=f"{label_cn} {label_sym} {symbol}".strip(),
                symbol=f"{label_sym} {symbol}".strip(),
                raw_text=text,
                value=None,  # 原文只提到概念，没给数值：不补全
                page=page_no,
                element_id=element_id,
                confidence=0.3,
            )
        )


def _scan_line(
    *,
    page_no: int,
    element_id: str | None,
    line: str,
    out: list[dict[str, Any]],
) -> None:
    """扫描一行原文，把命中的规则写入 ``out``（不修改输入）。"""
    text = line.strip()
    if not text:
        return

    for match in _PAIR_RE.finditer(text):
        value = {
            "from": [_num(match["x1"]), _num(match["y1"])],
            "to": [_num(match["x2"]), _num(match["y2"])],
        }
        out.append(
            _candidate(
                kind="vector_mapping",
                name="向量映射",
                symbol=None,
                raw_text=text,
                value=value,
                page=page_no,
                element_id=element_id,
                confidence=0.9,
                value_range=None,
            )
        )

    for match in _MATRIX_RE.finditer(text):
        symbol = match["symbol"]
        value = [
            [_num(match["a11"]), _num(match["a12"])],
            [_num(match["a21"]), _num(match["a22"])],
        ]
        out.append(
            _candidate(
                kind="matrix_literal",
                name=f"矩阵 {symbol}" if symbol else "矩阵字面量",
                symbol=symbol.upper() if symbol else None,
                raw_text=text,
                value=value,
                page=page_no,
                element_id=element_id,
                confidence=0.85,
                value_range=_ELEMENT_RANGE,
            )
        )

    for match in _EIGEN_RE.finditer(text):
        out.append(
            _candidate(
                kind="eigenvalue",
                name="特征值 λ",
                symbol="λ",
                raw_text=text,
                value=_num(match["eigen"]),
                page=page_no,
                element_id=element_id,
                confidence=0.8,
                value_range=_ELEMENT_RANGE,
            )
        )
    for match in _EIGEN_WORD_RE.finditer(text):
        out.append(
            _candidate(
                kind="eigenvalue",
                name="特征值 λ",
                symbol="λ",
                raw_text=text,
                value=_num(match["eigen"]),
                page=page_no,
                element_id=element_id,
                confidence=0.7,
                value_range=_ELEMENT_RANGE,
            )
        )

    _emit_quantity(
        out=out,
        text=text,
        page_no=page_no,
        element_id=element_id,
        kind="det",
        label_cn="行列式",
        label_sym="det",
        value_re=_DET_VALUE_RE,
        symbol_group="dsym",
        value_groups=("dval", "dval2"),
        mention_re=_DET_MENTION_RE,
    )
    _emit_quantity(
        out=out,
        text=text,
        page_no=page_no,
        element_id=element_id,
        kind="rank",
        label_cn="秩",
        label_sym="rank",
        value_re=_RANK_VALUE_RE,
        symbol_group="rsym",
        value_groups=("rval", "rval2"),
        mention_re=_RANK_MENTION_RE,
    )
    _emit_quantity(
        out=out,
        text=text,
        page_no=page_no,
        element_id=element_id,
        kind="trace",
        label_cn="迹",
        label_sym="trace",
        value_re=_TRACE_VALUE_RE,
        symbol_group="tsym",
        value_groups=("tval", "tval2"),
        mention_re=_TRACE_MENTION_RE,
    )


def _normalize_matrix(matrix: list[list[float]]) -> list[list[float | int]]:
    """把浮点矩阵归一化：接近整数的元素写成 int，其余保留 10 位小数。"""
    normalized: list[list[float | int]] = []
    for row in matrix:
        cells: list[float | int] = []
        for cell in row:
            value = 0.0 if abs(cell) < _TOL else cell
            if abs(value - round(value)) < _TOL:
                cells.append(int(round(value)))
            else:
                cells.append(round(value, 10))
        normalized.append(cells)
    return normalized


def solve_matrix_from_mappings(mappings: list[dict[str, Any]]) -> list[list[Any]] | None:
    """由若干 ``(输入 → 输出)`` 映射按线性性反推 2×2 矩阵。

    输入既可以是候选字典（``value={"from","to"}``），也可以是 ``{"from","to"}``
    本身。取两条线性无关的输入向量解 ``A·V = W``，再用**全部**映射校验
    （容差 ``1e-9``）；不成立或映射不足返回 ``None`` —— 宁可不给，也不编造。
    """
    pairs: list[tuple[list[float], list[float]]] = []
    for mapping in mappings or []:
        if not isinstance(mapping, dict):
            return None
        payload = mapping.get("value")
        if not isinstance(payload, dict):
            payload = mapping
        try:
            source = [float(payload["from"][0]), float(payload["from"][1])]
            target = [float(payload["to"][0]), float(payload["to"][1])]
        except (KeyError, IndexError, TypeError, ValueError):
            return None
        pairs.append((source, target))

    if len(pairs) < 2:
        return None

    for first in range(len(pairs)):
        for second in range(first + 1, len(pairs)):
            v1, w1 = pairs[first]
            v2, w2 = pairs[second]
            det_v = v1[0] * v2[1] - v1[1] * v2[0]
            if abs(det_v) < _TOL:
                continue
            # A = W · V⁻¹，V 的列是 v1、v2
            inverse = [
                [v2[1] / det_v, -v2[0] / det_v],
                [-v1[1] / det_v, v1[0] / det_v],
            ]
            w_matrix = [[w1[0], w2[0]], [w1[1], w2[1]]]
            matrix = [
                [
                    w_matrix[0][0] * inverse[0][0] + w_matrix[0][1] * inverse[1][0],
                    w_matrix[0][0] * inverse[0][1] + w_matrix[0][1] * inverse[1][1],
                ],
                [
                    w_matrix[1][0] * inverse[0][0] + w_matrix[1][1] * inverse[1][0],
                    w_matrix[1][0] * inverse[0][1] + w_matrix[1][1] * inverse[1][1],
                ],
            ]
            if all(
                math.isclose(matrix[0][0] * src[0] + matrix[0][1] * src[1], dst[0], abs_tol=_TOL)
                and math.isclose(matrix[1][0] * src[0] + matrix[1][1] * src[1], dst[1], abs_tol=_TOL)
                for src, dst in pairs
            ):
                return _normalize_matrix(matrix)
    return None


def _append_derived_matrices(
    *,
    candidates: list[dict[str, Any]],
    pages: list[dict[str, Any]],
    material_id: str | None,
) -> None:
    """为"只给了映射、没给矩阵"的页面补一条 ``inferred`` 矩阵候选。"""
    del material_id  # 仅签名占位：派生结果与材料 id 无关
    by_page: dict[int, list[dict[str, Any]]] = {}
    for item in candidates:
        if item["kind"] == "vector_mapping" and isinstance(item.get("page"), int):
            by_page.setdefault(item["page"], []).append(item)

    pages_with_matrix = {
        item.get("page") for item in candidates if item["kind"] in ("matrix_literal", "matrix_derived")
    }
    for page_no in sorted(by_page):
        if page_no in pages_with_matrix:
            continue
        mappings = by_page[page_no]
        matrix = solve_matrix_from_mappings(mappings)
        if matrix is None:
            continue
        element_ids = {item.get("element_id") for item in mappings if item.get("element_id")}
        element_id = element_ids.pop() if len(element_ids) == 1 else None
        candidates.append(
            _candidate(
                kind="matrix_derived",
                name="矩阵（由映射反推）",
                symbol=None,
                raw_text=" / ".join(dict.fromkeys(item["raw_text"] for item in mappings)),
                value=matrix,
                page=page_no,
                element_id=element_id,
                confidence=0.75,
                source_status="inferred",
                reason=(
                    f"原文第 {page_no} 页只给出 {len(mappings)} 条 (输入→输出) 映射，"
                    "矩阵元素按线性性由映射反推，原文未直接印刷；未凭知识库补全"
                ),
                value_range=_ELEMENT_RANGE,
            )
        )


def _template_id_for_ispec(spec: Mapping[str, Any]) -> str:
    """按 iSpec 的交互原语选 C-API@1 模板（四值枚举，契约冻结不允许扩展）。"""
    kind = spec.get("kind")
    if isinstance(kind, str):
        return _TEMPLATE_BY_ISPEC_KIND.get(kind, REGEX_FALLBACK_TEMPLATE_ID)
    return REGEX_FALLBACK_TEMPLATE_ID


def _candidates_from_ispecs(
    ispecs: Sequence[Any],
    material_id: str | None,
) -> list[dict[str, Any]]:
    """iSpec → 候选：每条 iSpec 一条候选，覆盖图表 / 表格 / 公式。

    候选的 ``template_id`` 由 :func:`_template_id_for_ispec` 决定；参数的
    ``parameter_id`` / ``label`` / ``default`` 直接取 iSpec 定义。
    """
    del material_id  # iSpec 已带 object_id，候选不重复携带材料 id
    candidates: list[dict[str, Any]] = []
    for spec in ispecs:
        if not isinstance(spec, Mapping):
            continue
        parameters = [
            item for item in (spec.get("parameters") or []) if isinstance(item, Mapping)
        ]
        if not parameters:
            continue
        first = parameters[0]
        source = first.get("source")
        source = source if isinstance(source, Mapping) else {}
        page = source.get("page")
        element_id = source.get("element_id")
        excerpt = str(source.get("excerpt") or "")
        views = [item for item in (spec.get("views") or []) if isinstance(item, Mapping)]
        view_types = "/".join(str(item.get("type")) for item in views if item.get("type"))
        template_id = _template_id_for_ispec(spec)
        default = first.get("default")
        confidence = 0.95 if any(item.get("type") == "vega" for item in views) else 0.9

        candidate = _candidate(
            kind=str(spec.get("kind") or "filter"),
            name=str(spec.get("title") or spec.get("object_id") or "交互区域"),
            symbol=None,
            raw_text=excerpt,
            value=default,
            page=page if isinstance(page, int) and page >= 1 else 1,
            element_id=element_id if isinstance(element_id, str) else None,
            confidence=confidence,
            source_status=str(source.get("status") or "original"),
            reason=(
                f"识别方式: ispec（kind={spec.get('kind')}，视图 {view_types}）；"
                "参数与来源自原文原生数据提取"
            ),
            value_range=None,
            template_id=template_id,
            notes=(
                f"识别方式: ispec；iSpec object_id={spec.get('object_id')}；"
                f"视图 {view_types or '未知'}"
            ),
        )
        candidate["fields"] = [
            {
                "parameter_id": str(item.get("id") or f"p{index}"),
                "name": str(item.get("label") or item.get("id") or ""),
                "status": "missing" if item.get("default") is None else "present",
            }
            for index, item in enumerate(parameters)
        ]
        candidates.append(candidate)
    return candidates


def _resolve_slides(
    material_id_or_slides: Any,
    slides_dict: dict[str, Any] | None,
) -> dict[str, Any]:
    """兼容两种调用口径：``map_candidates(parsed)`` 与
    ``map_candidates(material_id, slides_dict)``（plan §2.2.10 签名）。"""
    if isinstance(material_id_or_slides, dict):
        return material_id_or_slides
    if isinstance(slides_dict, dict):
        return slides_dict
    return {}


def map_candidates(
    material_id: str | dict[str, Any],
    slides_dict: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """规则化提取候选（``provenance="inferred"`` 的候选已带 ``reason``）。

    流程：先由 :func:`app.ispec.build_ispecs` 从原生图表/表格/公式产出 iSpec，
    每条 iSpec 转一条候选（``notes`` 标注 ``识别方式: ispec``）；**没有任何
    iSpec** 时才退回矩阵正则扫描，并在 ``notes`` 标注
    ``识别方式: regex_fallback``。

    :param material_id: 材料 id，或直接传 ``slides_dict``（两种口径都支持）。
    :param slides_dict: ``parse_pptx`` 返回的第二个字典。
    :returns: 候选列表；无可用候选时返回空列表，**不抛异常**。
    :
    ``unit`` 固定 ``"1"``（无量纲）；``range`` 仅对矩阵/向量/特征值给
    ``[-3, 3]``、步长 0.1，其余为 ``None``。
    """
    slides = _resolve_slides(material_id, slides_dict)
    resolved_material = material_id if isinstance(material_id, str) else slides.get("material_id")
    pages = slides.get("slides") or slides.get("pages") or []
    if not isinstance(pages, list):
        return []

    try:
        ispecs = build_ispecs(slides)
    except Exception:  # noqa: BLE001 - 识别层失败不得让上传链路 500（兜底走正则）
        ispecs = []

    if ispecs:
        deduped = _candidates_from_ispecs(
            ispecs,
            resolved_material if isinstance(resolved_material, str) else None,
        )
        for index, item in enumerate(deduped, start=1):
            item["candidate_id"] = f"cand_{index:03d}"
        return deduped

    candidates: list[dict[str, Any]] = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        page_no = page.get("page_no")
        if not isinstance(page_no, int):
            continue

        scanned_element = False
        elements = page.get("elements") or []
        if isinstance(elements, list):
            for element in elements:
                if not isinstance(element, dict):
                    continue
                text = element.get("text")
                if not isinstance(text, str) or not text.strip():
                    continue
                scanned_element = True
                element_id = element.get("element_id")
                for line in text.split("\n"):
                    _scan_line(
                        page_no=page_no,
                        element_id=element_id if isinstance(element_id, str) else None,
                        line=line,
                        out=candidates,
                    )
        if not scanned_element:
            # 兜底：页面没有元素级文本时，退化为段落级扫描（element_id=None）
            paragraphs = page.get("paragraphs") or []
            if isinstance(paragraphs, list):
                for paragraph in paragraphs:
                    if isinstance(paragraph, str):
                        _scan_line(
                            page_no=page_no,
                            element_id=None,
                            line=paragraph,
                            out=candidates,
                        )

    _append_derived_matrices(
        candidates=candidates,
        pages=[page for page in pages if isinstance(page, dict)],
        material_id=resolved_material if isinstance(resolved_material, str) else None,
    )

    # 去重：同一页面/元素/原文/取值的同一类候选只留一份（保持首次出现顺序）
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for item in candidates:
        key = (
            item["kind"],
            item.get("page"),
            item.get("element_id"),
            item.get("raw_text"),
            _stable_value(item.get("value")),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    for index, item in enumerate(deduped, start=1):
        item["candidate_id"] = f"cand_{index:03d}"
    return deduped


def _symbol_key(candidate: dict[str, Any]) -> str | None:
    """冲突分组键：同名符号（矩阵用字母，映射对不参与）。"""
    kind = candidate.get("kind")
    if kind == "vector_mapping":
        return None
    if kind == "matrix_derived":
        return "矩阵（由映射反推）"
    if kind == "matrix_literal":
        symbol = candidate.get("symbol")
        return f"矩阵 {symbol}" if symbol else "矩阵字面量"
    return candidate.get("symbol")


def detect_merge_conflicts(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """检测"同名符号多取值"，**只报告不合并**。

    :returns: 冲突列表，每项含 ``symbol`` / ``reason`` / ``pages`` / ``occurrences``；
        无冲突时返回空列表。
    """
    groups: dict[str, list[dict[str, Any]]] = {}
    for item in candidates or []:
        if not isinstance(item, dict):
            continue
        key = _symbol_key(item)
        if not key:
            continue
        groups.setdefault(key, []).append(item)

    conflicts: list[dict[str, Any]] = []
    for symbol in sorted(groups):
        items = groups[symbol]
        distinct = {_stable_value(item.get("value")) for item in items if item.get("value") is not None}
        if len(distinct) < 2:
            continue
        conflicts.append(
            {
                "symbol": symbol,
                "reason": "同名符号在原文中出现多个不同取值；按契约不自动合并，全部候选保留待确认",
                "pages": sorted({item.get("page") for item in items if isinstance(item.get("page"), int)}),
                "occurrences": [
                    {
                        "candidate_id": item.get("candidate_id"),
                        "page": item.get("page"),
                        "element_id": item.get("element_id"),
                        "raw_text": item.get("raw_text"),
                        "value": item.get("value"),
                        "source_status": item.get("source_status"),
                    }
                    for item in items
                ],
            }
        )
    return conflicts


def map_candidates_with_conflicts(
    material_id: str | dict[str, Any],
    slides_dict: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """一次性返回 ``{"candidates": [...], "merge_conflicts": [...]}``。"""
    candidates = map_candidates(material_id, slides_dict)
    return {
        "candidates": candidates,
        "merge_conflicts": detect_merge_conflicts(candidates),
    }

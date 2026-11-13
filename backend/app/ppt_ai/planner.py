"""交互规划：区域语义 → 可修改方案（确定性规划优先，AI 只改问题表述）。

规划器只产出候选：算子必须已登记，参数范围/来源必须可追溯。没有可用能力时
明确标为 ``needs_review`` / ``explanation_only`` / ``unsupported``，绝不伪造交互。
"""

from __future__ import annotations

import logging
import math
import re
from typing import Any, Mapping, Sequence

from ..labs.expr import ExprError, FUNCTIONS, CONSTANTS, parse_expression
from ..settings import get_settings
from ..labs.recognize import RecognitionError, build_problem
from .client import PPTAIClient, PPTAIError
from .conditions import extract_conditions
from .contracts import validate_contract
from .evidence import build_anchor, build_provenance, excerpt_in_source
from .linking import group_same_parameter_candidates
from .matching import build_template_options, propose_matches, recall_candidates, resolve_match
from .recognition_types import MatchDecision
from .registry import REGISTRY, OperatorSpec
from .template_packs import TEMPLATE_CATALOG, TEMPLATES_BY_ID
from .types import (
    CallBudget,
    CoverageEntry,
    InteractionOption,
    InteractionPlan,
    LinkCandidate,
    ModelNode,
    ModelRelation,
    PlanParameter,
    PlanReviewItem,
    PlanView,
    Region,
    RegionExtractionResult,
    SemanticGraph,
    SourceSnapshot,
)
from .util import hash_json, new_id, now_iso, semantic_content_hash, stable_id

logger = logging.getLogger(__name__)

_RANGE_DEFAULT = 5.0
_LAB_OPERATORS = {
    ("calculus", "integral"): "lab.calculus.integral",
    ("calculus", "derivative"): "lab.calculus.derivative",
    ("algorithm", "bfs"): "algorithm.bfs",
    ("optimization", "gradient"): "lab.optimization.gradient",
    ("deep_learning", "forward"): "deep_learning.forward",
}
_PLAIN_NUMBER = re.compile(r"(?<![\d.])-?\d+(?:\.\d+)?(?![\d.])")


def _normal(text: Any) -> str:
    return re.sub(r"\s+", "", str(text or "")).casefold()


def _number_present(value: Any, text: str) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    candidates = {f"{float(value):g}", f"{float(value):.6g}"}
    if float(value).is_integer():
        candidates.add(str(int(float(value))))
    compact = re.sub(r"\s+", "", text)
    return any(candidate and candidate in compact for candidate in candidates)


def _region_anchor(region: Region, snapshot: SourceSnapshot, *, excerpt: str | None = None):
    return build_anchor(
        material_id=snapshot.material_id,
        page=region.page_no,
        bbox=region.bbox,
        excerpt=excerpt or (region.evidence[0].text if region.evidence else region.category),
        source_version=snapshot.document_revision,
        semantic_hash=region.semantic_content_hash,
        node_id=region.node_ids[0] if region.node_ids else None,
        element_id=region.element_ids[0] if region.element_ids else None,
    )


def _parameter(
    *,
    identifier: str,
    label: str,
    default: Any,
    source_text: str,
    anchor,
    concept_id: str,
    type_: str = "number",
    unit: str = "",
    minimum: float | None = None,
    maximum: float | None = None,
    step: float | None = None,
    options: list[str] | None = None,
    role: str = "parameter",
    origin_type: str | None = None,
    evidence: str = "",
) -> PlanParameter:
    present = _number_present(default, source_text) if isinstance(default, (int, float)) else False
    if type_ == "enum" or isinstance(default, str):
        present = str(default) in source_text
    if origin_type is not None:
        origin = origin_type
        present = origin == "native"
    else:
        origin = "native" if present else "teaching" if identifier in ("n", "steps", "samples") else "model_inference"
    provenance = build_provenance(
        origin,
        evidence=(evidence or str(default)) if present or evidence else "",
        inference="" if present or evidence else f"参数 {label} 的原值未在原文中明确给出，默认值待核对。",
        method="planner",
    )
    return PlanParameter(
        concept_id=concept_id,
        id=identifier,
        label=label,
        type=type_,  # type: ignore[arg-type]
        unit=unit,
        default=default,
        min=minimum,
        max=maximum,
        step=step,
        options=options or [],
        source=anchor,
        provenance=provenance,
    )


def _review_for_parameters(parameters: Sequence[PlanParameter]) -> list[PlanReviewItem]:
    items: list[PlanReviewItem] = []
    for parameter in parameters:
        if parameter.provenance.origin_type in ("model_inference", "teaching"):
            items.append(
                PlanReviewItem(
                    item_id=stable_id("option", "review", parameter.concept_id, "default"),
                    kind="initial_value",
                    prompt=f"确认「{parameter.label}」的初值 {parameter.default} 与范围（{parameter.min}—{parameter.max}）。",
                    required=True,
                )
            )
    return items


def _views_for(operator_id: str) -> list[PlanView]:
    definitions = {
        "lab.calculus.integral": [
            ("curve", "函数曲线与积分区域"),
            ("metrics", "数值结果"),
            ("table", "分割数与黎曼和"),
            ("text", "原稿依据"),
        ],
        "lab.calculus.derivative": [
            ("curve", "函数曲线与切线"),
            ("metrics", "导数与差商"),
            ("table", "差商随步长变化"),
            ("text", "原稿依据"),
        ],
        "lab.calculus.expression": [
            ("curve", "函数曲线"),
            ("metrics", "采样结果"),
            ("text", "原稿依据"),
        ],
        "native.chart.explore": [
            ("table", "原生数据"),
            ("metrics", "系列统计"),
            ("text", "原稿依据"),
        ],
        "native.table.explore": [
            ("table", "表格数据"),
            ("text", "原稿依据"),
        ],
        "algorithm.bfs": [
            ("table", "访问轨迹"),
            ("text", "算法条件"),
        ],
        "optimization.gradient": [
            ("curve", "目标函数与迭代"),
            ("table", "迭代轨迹"),
            ("metrics", "收敛状态"),
            ("text", "原稿依据"),
        ],
        "deep_learning.forward": [
            ("table", "前向与损失"),
            ("metrics", "训练状态"),
            ("text", "结构与来源"),
        ],
        "matrix.transform": [
            ("table", "矩阵与向量"),
            ("metrics", "行列式与结果"),
            ("text", "原稿依据"),
        ],
        "explain.text": [("text", "原文说明")],
    }
    return [
        PlanView(view_id=stable_id("view", operator_id, kind), type=kind, title=title)
        for kind, title in definitions.get(operator_id, [("text", "说明")])
    ]


def _bindings_for(parameters: Sequence[PlanParameter]) -> list[dict[str, str]]:
    return [
        {"view": "metrics", "source": parameter.concept_id, "mode": "readonly"}
        for parameter in parameters
        if parameter.type in ("number", "integer")
    ]


def _parse_matrix2(text: str) -> list[list[float]] | None:
    compact = re.sub(r"\s+", " ", text)
    candidates = re.findall(r"\[\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]\s*,\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]\s*\]", compact)
    if candidates:
        a, b, c, d = candidates[0]
        return [[float(a), float(b)], [float(c), float(d)]]
    candidates = re.findall(r"\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*;\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]", compact)
    if candidates:
        a, b, c, d = candidates[0]
        return [[float(a), float(b)], [float(c), float(d)]]
    return None


def _parse_vector2(text: str) -> list[float] | None:
    match = re.search(r"(?:v|V|y|x)\s*=\s*[\(\[]\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*[\)\]]", text)
    if match:
        return [float(match.group(1)), float(match.group(2))]
    return None


def _lab_option(region: Region, snapshot: SourceSnapshot) -> InteractionOption | None:
    text = str(region.semantic.get("text") or region.semantic.get("formula") or "").strip()
    formula = str(region.semantic.get("formula") or "").strip()
    source_text = "\n".join(part for part in (text, formula) if part).strip()
    if not source_text:
        return None
    problem: dict[str, Any] | None = None
    try:
        problem = build_problem(source_text, subject_hint=None)
    except (RecognitionError, ValueError, TypeError):
        problem = None
    if problem is None:
        return None
    model = problem.get("model")
    if not isinstance(model, Mapping):
        return None
    subject = str(model.get("subject") or "")
    kind = str(model.get("kind") or "")
    operator_id = _LAB_OPERATORS.get((subject, kind))
    if operator_id is None and subject == "calculus":
        operator_id = "lab.calculus.expression"
    if operator_id is None:
        return None

    anchor = _region_anchor(region, snapshot, excerpt=source_text[:160])
    raw_params = model.get("params") if isinstance(model.get("params"), list) else []
    defaults = model.get("defaults") if isinstance(model.get("defaults"), Mapping) else {}
    parameters: list[PlanParameter] = []
    for raw in raw_params[:20]:
        if not isinstance(raw, Mapping):
            continue
        identifier = str(raw.get("id") or "")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", identifier) or identifier not in defaults:
            continue
        raw_type = str(raw.get("kind") or "number")
        type_ = "integer" if raw_type == "integer" else "boolean" if raw_type == "boolean" else "enum" if raw.get("options") else "number"
        default = defaults[identifier]
        minimum = raw.get("min")
        maximum = raw.get("max")
        step = raw.get("step")
        parameters.append(
            _parameter(
                identifier=identifier,
                label=str(raw.get("label") or identifier),
                default=default,
                source_text=source_text,
                anchor=anchor,
                concept_id=stable_id("concept", region.region_id, identifier, _normal(raw.get("label") or identifier)),
                type_=type_,
                unit=str(raw.get("unit") or ""),
                minimum=float(minimum) if isinstance(minimum, (int, float)) else None,
                maximum=float(maximum) if isinstance(maximum, (int, float)) else None,
                step=float(step) if isinstance(step, (int, float)) and step > 0 else None,
                options=[str(item) for item in raw.get("options", [])] if isinstance(raw.get("options"), list) else None,
            )
        )
    if not parameters:
        return None
    support_status = "supported"
    support_reason = ""
    review_items = _review_for_parameters(parameters)
    if problem.get("status") == "needs_review":
        support_status = "needs_review"
        support_reason = "识别结果包含需要人工核对的歧义项；核对后才能执行。"
        for item in problem.get("recognition", {}).get("ambiguities", [])[:10]:
            if not isinstance(item, Mapping):
                continue
            review_items.append(
                PlanReviewItem(
                    item_id=stable_id("option", "review", region.region_id, item.get("id")),
                    kind="expression",
                    prompt=str(item.get("prompt") or item.get("message") or "确认公式含义")[:500],
                    required=str(item.get("severity")) == "blocking",
                )
            )
    elif review_items:
        support_status = "needs_review"
        support_reason = "部分参数的原值/范围在原文中没有明确给出，已标记待核对。"

    checks = REGISTRY.get(operator_id).checks
    return InteractionOption(
        option_id=stable_id("option", region.region_id, operator_id),
        region_id=region.region_id,
        title=str(problem.get("title") or f"第 {region.page_no} 页 · {region.category}")[:120],
        question=f"调参数后，{problem.get('title') or '该区域'}的结果会怎样变化？",
        purpose="让原稿中的关系可计算、可核对；图、表、结论读取同一次求值。",
        operator_id=operator_id,
        support_status=support_status,  # type: ignore[arg-type]
        support_reason=support_reason,
        parameters=parameters,
        views=_views_for(operator_id),
        bindings=_bindings_for(parameters),
        review_items=review_items[:40],
        provider={
            "kind": "lab",
            "subject": subject,
            "model": model,
            "problem_text": source_text[:4000],
            "checks": list(checks),
        },
        source=anchor,
        offline_supported=True,
    )


def _chart_option(region: Region, snapshot: SourceSnapshot) -> InteractionOption | None:
    chart = region.semantic.get("chart")
    if not isinstance(chart, Mapping):
        return None
    categories = [str(item) for item in chart.get("categories", []) if str(item).strip()]
    if not categories:
        return None
    anchor = _region_anchor(region, snapshot)
    parameter = _parameter(
        identifier="category",
        label="分类",
        default="全部",
        source_text=" ".join(categories),
        anchor=anchor,
        concept_id=stable_id("concept", region.region_id, "category"),
        type_="enum",
        options=["全部", *categories[:100]],
    )
    return InteractionOption(
        option_id=stable_id("option", region.region_id, "native.chart.explore"),
        region_id=region.region_id,
        title=str(chart.get("title") or "原生图表")[:120],
        question="筛选不同分类时，各系列数值如何比较？",
        purpose="直接使用 PPTX 原生 chart 的分类与数值，显示当前筛选结果。",
        operator_id="native.chart.explore",
        support_status="supported",
        support_reason="",
        parameters=[parameter],
        views=_views_for("native.chart.explore"),
        bindings=[{"view": "table", "source": parameter.concept_id}],
        review_items=[],
        provider={
            "kind": "chart",
            "chart": chart,
            "element_id": region.element_ids[0] if region.element_ids else None,
        },
        source=anchor,
        offline_supported=True,
    )


def _table_option(region: Region, snapshot: SourceSnapshot) -> InteractionOption | None:
    table = region.semantic.get("table")
    if not isinstance(table, Mapping):
        return None
    headers = [str(item) for item in table.get("headers", []) if str(item).strip()]
    if not headers:
        return None
    anchor = _region_anchor(region, snapshot)
    parameter = _parameter(
        identifier="filter_column",
        label="筛选列",
        default="全部",
        source_text=" ".join(headers),
        anchor=anchor,
        concept_id=stable_id("concept", region.region_id, "filter_column"),
        type_="enum",
        options=["全部", *headers[:50]],
    )
    return InteractionOption(
        option_id=stable_id("option", region.region_id, "native.table.explore"),
        region_id=region.region_id,
        title="原生表格",
        question="按不同列查看表格时，哪些字段与数值最相关？",
        purpose="保持原文单元格不变，只提供列筛选与行数统计。",
        operator_id="native.table.explore",
        support_status="supported",
        support_reason="",
        parameters=[parameter],
        views=_views_for("native.table.explore"),
        bindings=[{"view": "table", "source": parameter.concept_id}],
        review_items=[],
        provider={
            "kind": "table",
            "headers": headers,
            "rows": table.get("rows", []),
            "element_id": region.element_ids[0] if region.element_ids else None,
        },
        source=anchor,
        offline_supported=True,
    )


def _matrix_option(region: Region, snapshot: SourceSnapshot) -> InteractionOption | None:
    text = str(region.semantic.get("text") or "")
    matrix = region.semantic.get("matrix") if isinstance(region.semantic.get("matrix"), list) else _parse_matrix2(text)
    if not isinstance(matrix, list) or len(matrix) != 2 or any(not isinstance(row, list) or len(row) != 2 for row in matrix):
        return None
    vector = _parse_vector2(text)
    anchor = _region_anchor(region, snapshot, excerpt=text[:160])
    parameters: list[PlanParameter] = []
    for row in range(2):
        for column in range(2):
            identifier = f"a{row + 1}{column + 1}"
            parameters.append(
                _parameter(
                    identifier=identifier,
                    label=f"矩阵 a{row + 1}{column + 1}",
                    default=float(matrix[row][column]),
                    source_text=text,
                    anchor=anchor,
                    concept_id=stable_id("concept", region.region_id, identifier),
                    type_="number",
                    minimum=-1e6,
                    maximum=1e6,
                    step=1,
                )
            )
    if vector:
        for index, value in enumerate(vector):
            parameters.append(
                _parameter(
                    identifier=f"v{index + 1}",
                    label=f"向量 v{index + 1}",
                    default=float(value),
                    source_text=text,
                    anchor=anchor,
                    concept_id=stable_id("concept", region.region_id, f"v{index + 1}"),
                    type_="number",
                    minimum=-1e6,
                    maximum=1e6,
                    step=1,
                )
            )
    return InteractionOption(
        option_id=stable_id("option", region.region_id, "matrix.transform"),
        region_id=region.region_id,
        title="矩阵与向量变换",
        question="改变矩阵元素或向量时，行列式、乘积与可逆性如何变化？",
        purpose="矩阵元素来自原稿；奇异情形明确显示，不强行取逆。",
        operator_id="matrix.transform",
        support_status="supported",
        support_reason="",
        parameters=parameters,
        views=_views_for("matrix.transform"),
        bindings=_bindings_for(parameters),
        review_items=_review_for_parameters(parameters),
        provider={
            "kind": "matrix",
            "matrix": matrix,
            "vector": vector,
            "text": text[:2000],
        },
        source=anchor,
        offline_supported=True,
    )


def _change_of_basis_option(
    region: Region, snapshot: SourceSnapshot
) -> InteractionOption | None:
    """内容语义包含「换基/坐标」的矩阵区域，追加一个旋转基观察方案。"""

    text = str(region.semantic.get("text") or "")
    if not any(keyword in text for keyword in ("换基", "坐标", "基变换", "相似")):
        return None
    matrix = region.semantic.get("matrix") if isinstance(region.semantic.get("matrix"), list) else _parse_matrix2(text)
    if not isinstance(matrix, list) or len(matrix) != 2 or any(
        not isinstance(row, list) or len(row) != 2 for row in matrix
    ):
        return None
    anchor = _region_anchor(region, snapshot, excerpt=text[:160])
    parameters: list[PlanParameter] = []
    for row in range(2):
        for column in range(2):
            identifier = f"a{row + 1}{column + 1}"
            parameters.append(
                _parameter(
                    identifier=identifier,
                    label=f"矩阵 a{row + 1}{column + 1}",
                    default=float(matrix[row][column]),
                    source_text=text,
                    anchor=anchor,
                    concept_id=stable_id("concept", region.region_id, identifier),
                    type_="number",
                    minimum=-1e6,
                    maximum=1e6,
                    step=1,
                )
            )
    parameters.append(
        _parameter(
            identifier="basis_angle_deg",
            label="基旋转角度 θ（度）",
            default=0.0,
            source_text=text,
            anchor=anchor,
            concept_id=stable_id("concept", region.region_id, "basis_angle_deg"),
            type_="number",
            minimum=-180.0,
            maximum=180.0,
            step=15,
            origin_type="teaching",
            evidence="旋转基角度是教学探针，不声称原稿给出了该角度。",
        )
    )
    return InteractionOption(
        option_id=stable_id("option", region.region_id, "matrix.change_of_basis"),
        region_id=region.region_id,
        title="换基：同一变换的另一组坐标",
        question="换一组基后，同一个矩阵与同一个向量如何用新坐标表示？",
        purpose="A 与原稿一致；旋转角是教学探针。输出 P、P⁻¹、B=P⁻¹AP 与不变量。",
        operator_id="matrix.change_of_basis",
        support_status="needs_review",
        support_reason="旋转基角度是教学探针，默认 0°；请核对后再采用。",
        parameters=parameters,
        views=_views_for("matrix.change_of_basis"),
        bindings=_bindings_for(parameters),
        review_items=_review_for_parameters(parameters),
        provider={
            "kind": "change_of_basis",
            "matrix": matrix,
            "basis_angle_deg": 0.0,
            "vector": [1, 2],
            "text": text[:2000],
        },
        source=anchor,
        offline_supported=True,
    )


def _expression_option(region: Region, snapshot: SourceSnapshot) -> InteractionOption | None:
    text = str(region.semantic.get("formula") or region.semantic.get("text") or "").strip()
    expression_text = text
    match = re.search(r"(?:f\s*\(\s*x\s*\)\s*=|y\s*=)\s*(.+)", text)
    if match:
        expression_text = match.group(1).strip()
    elif any("\u4e00" <= char <= "\u9fff" for char in expression_text):
        return None
    tokens = re.findall(r"[A-Za-z_][A-Za-z0-9_]*", expression_text)
    variables = [
        name
        for name in dict.fromkeys(tokens)
        if name not in FUNCTIONS and name not in CONSTANTS and name not in {"e", "pi"}
    ]
    variables = variables[:6] or ["x"]
    try:
        parse_expression(expression_text, variables)
    except ExprError:
        return None
    anchor = _region_anchor(region, snapshot, excerpt=expression_text[:160])
    parameters: list[PlanParameter] = []
    for variable in variables:
        assigned = re.search(rf"\b{re.escape(variable)}\s*=\s*(-?\d+(?:\.\d+)?)", text)
        default = float(assigned.group(1)) if assigned else 1.0
        parameters.append(
            _parameter(
                identifier=variable,
                label=f"自变量 {variable}" if variable == "x" else f"参数 {variable}",
                default=default,
                source_text=text,
                anchor=anchor,
                concept_id=stable_id("concept", region.region_id, variable),
                type_="number",
                minimum=-10.0 if variable == "x" else -5.0,
                maximum=10.0 if variable == "x" else 5.0,
                step=0.1,
            )
        )
    return InteractionOption(
        option_id=stable_id("option", region.region_id, "lab.calculus.expression"),
        region_id=region.region_id,
        title="函数表达式探索",
        question="改变自变量或参数时，函数值与曲线如何变化？",
        purpose="只采样已识别的表达式；不把曲线外观拟合当成原稿函数。",
        operator_id="lab.calculus.expression",
        support_status="needs_review" if any(p.provenance.origin_type != "native" for p in parameters) else "supported",
        support_reason="参数原值未在原文中明确给出时，默认值待核对。" if any(p.provenance.origin_type != "native" for p in parameters) else "",
        parameters=parameters,
        views=_views_for("lab.calculus.expression"),
        bindings=_bindings_for(parameters),
        review_items=_review_for_parameters(parameters),
        provider={"kind": "expression", "expression": expression_text, "variables": variables},
        source=anchor,
        offline_supported=True,
    )


def _explain_option(region: Region, snapshot: SourceSnapshot) -> InteractionOption:
    text = str(region.semantic.get("text") or "")
    anchor = _region_anchor(region, snapshot)
    return InteractionOption(
        option_id=stable_id("option", region.region_id, "explain.text"),
        region_id=region.region_id,
        title=f"第 {region.page_no} 页 · 原文说明",
        question="这块内容在原稿中说明了什么？",
        purpose="只展示可核验原文与未识别原因；不生成假滑杆或计算结论。",
        operator_id="explain.text",
        support_status="explanation_only" if region.category not in ("image", "diagram") else "needs_review",
        support_reason=(
            "当前区域没有可恢复的计算关系，仅提供原文说明。"
            if region.category not in ("image", "diagram")
            else "图片/图形尚未读到可核验的计算关系，需人工核对或视觉理解。"
        ),
        parameters=[],
        views=_views_for("explain.text"),
        bindings=[],
        review_items=[
            PlanReviewItem(
                item_id=stable_id("option", "review", region.region_id, "explain"),
                kind="source",
                prompt="确认该区域是否需要补充计算关系或指定公式。",
                required=False,
            )
        ]
        if region.category in ("image", "diagram")
        else [],
        provider={"kind": "explain", "text": text[:4000]},
        source=anchor,
        offline_supported=True,
    )


def _option_for_region(region: Region, snapshot: SourceSnapshot) -> InteractionOption:
    if region.extraction_state == "visual" and region.category not in ("formula", "matrix", "algorithm", "optimization", "network"):
        return _explain_option(region, snapshot)
    try:
        if region.category == "chart":
            option = _chart_option(region, snapshot)
        elif region.category == "table":
            option = _table_option(region, snapshot)
        elif region.category == "matrix":
            option = _matrix_option(region, snapshot)
        elif region.category in ("formula", "algorithm", "optimization", "network"):
            option = _lab_option(region, snapshot)
            if option is None and region.category == "formula":
                option = _expression_option(region, snapshot)
        else:
            option = None
    except (ValueError, TypeError, KeyError):
        logger.exception("区域 %s 规划失败", region.region_id)
        option = None
    if option is None:
        return _explain_option(region, snapshot)
    errors = REGISTRY.validate_parameters(option.operator_id, option.parameters)
    if errors:
        option.support_status = "unsupported"
        option.support_reason = "；".join(errors)[:1000]
        option.parameters = []
    return option


def build_semantic_graph(options: Sequence[InteractionOption]) -> SemanticGraph:
    nodes: list[ModelNode] = []
    for option in options:
        if option.support_status not in ("supported", "needs_review"):
            continue
        for parameter in option.parameters:
            nodes.append(
                ModelNode(
                    concept_id=parameter.concept_id,
                    name=parameter.label,
                    type=parameter.type,
                    unit=parameter.unit,
                    dimension="scalar",
                    domain={"min": parameter.min, "max": parameter.max},
                    default=parameter.default,
                    source=parameter.source,
                    semantic_role="parameter",
                    provenance=parameter.provenance,
                )
            )
    candidates = group_same_parameter_candidates(nodes, limit=500)
    conflicts = [
        {
            "candidate_id": item.candidate_id,
            "note": item.conflict_note,
        }
        for item in candidates
        if item.conflict
    ]
    return SemanticGraph(
        nodes=nodes,
        relations=[],
        candidates=candidates,
        conflicts=conflicts,
        graph_revision=1,
    )


def _ai_refine(
    options: list[InteractionOption],
    regions: dict[str, Region],
    budget: CallBudget,
    client: PPTAIClient | None,
    on_model_attempt=None,
) -> int:
    """让模型改写学习问题；拒绝新数字、未知区域和任何算子/参数变更。"""

    if client is None or not client.available() or budget.remaining <= 0:
        return 0
    candidates = [option for option in options if option.support_status in ("supported", "needs_review")][:12]
    if not candidates:
        return 0
    payload = {
        "regions": [
            {
                "option_id": option.option_id,
                "region_id": option.region_id,
                "category": regions[option.region_id].category if option.region_id in regions else "",
                "excerpt": option.source.excerpt,
                "current_question": option.question,
                "current_purpose": option.purpose,
                "operator_id": option.operator_id,
            }
            for option in candidates
        ]
    }

    def validate(data: dict[str, Any]) -> None:
        items = data.get("options")
        if not isinstance(items, list):
            raise ValueError("options 必须是数组")
        allowed = {option.option_id: option for option in candidates}
        for item in items[:20]:
            if not isinstance(item, Mapping) or item.get("option_id") not in allowed:
                raise ValueError("未知 option_id")
            target = allowed[str(item["option_id"])]
            for field in ("question", "purpose"):
                value = str(item.get(field) or "")
                if len(value) < 3 or len(value) > 500:
                    raise ValueError(f"{field} 长度不合法")
                for number in _PLAIN_NUMBER.findall(value):
                    if not excerpt_in_source(number, target.source.excerpt, min_chars=1):
                        raise ValueError(f"{field} 含原文中没有的数字：{number}")

    try:
        response = client.generate_json(
            "plan_refine",
            payload,
            "ppt-ai.plan-refine.1",
            budget,
            validator=validate,
            instructions="只改进 question 与 purpose，不改变算子、参数、数值或来源；不得编造原文摘录。",
            on_attempt=on_model_attempt,
        )
    except PPTAIError as exc:
        logger.info("PPT AI 规划修饰跳过：%s", exc.kind)
        return 0
    items = response.data.get("options") or []
    updated = 0
    allowed = {option.option_id: option for option in candidates}
    for item in items:
        if not isinstance(item, Mapping) or item.get("option_id") not in allowed:
            continue
        option = allowed[str(item["option_id"])]
        option.question = str(item.get("question") or option.question)[:500]
        if item.get("purpose"):
            option.purpose = str(item["purpose"])[:1000]
        updated += 1
    return updated


_NEW_TEMPLATE_IDS = frozenset(template.template_id for template in TEMPLATE_CATALOG)


def _hybrid_layer(
    regions: RegionExtractionResult,
    snapshot: SourceSnapshot,
    budget: CallBudget,
    client: PPTAIClient | None,
    on_model_attempt=None,
) -> tuple[dict[str, InteractionOption], dict[str, MatchDecision], dict[str, Any]]:
    if not get_settings().ppt_ai_hybrid_matching_enabled:
        return {}, {}, {"enabled": False, "reason": "PPT_AI_HYBRID_MATCHING_ENABLED=false"}
    condition_sets = extract_conditions(snapshot, regions.regions)
    candidates_by_region = {
        condition_set.region_id: recall_candidates(condition_set, TEMPLATE_CATALOG)
        for condition_set in condition_sets
    }
    proposal_result = propose_matches(
        condition_sets,
        candidates_by_region,
        TEMPLATES_BY_ID,
        client,
        budget,
        on_attempt=on_model_attempt,
    )
    proposals = {proposal.region_id: proposal for proposal in proposal_result.get("proposals", [])}
    decisions = {
        condition_set.region_id: resolve_match(
            condition_set,
            candidates_by_region.get(condition_set.region_id, []),
            proposals.get(condition_set.region_id),
            TEMPLATES_BY_ID,
        )
        for condition_set in condition_sets
    }
    options = build_template_options(condition_sets, regions.regions, snapshot, decisions)
    diagnostics = {
        "enabled": True,
        "conditions": len(condition_sets),
        "candidate_regions": sum(1 for items in candidates_by_region.values() if items),
        "template_options": len(options),
        "supported": sum(1 for decision in decisions.values() if decision.status == "supported"),
        "needs_review": sum(1 for decision in decisions.values() if decision.status == "needs_review"),
        "abstained": sum(1 for decision in decisions.values() if decision.template_ref is None),
        "model_used": any(decision.model_used for decision in decisions.values()),
        "model_error": proposal_result.get("error"),
        "model_calls": proposal_result.get("used_calls", 0),
    }
    return options, decisions, diagnostics


def _use_template_option(
    region: Region,
    template_option: InteractionOption,
    decision: MatchDecision,
    legacy_option: InteractionOption,
    candidates: list[Any],
) -> bool:
    if decision.template_ref is None or decision.template_ref.id not in _NEW_TEMPLATE_IDS:
        return False
    if region.category in ("physics", "data_structure"):
        return True
    top = candidates[0] if candidates else None
    specific = bool(
        top
        and any(
            reason.startswith("命中术语") or reason.startswith("公式特征命中")
            for reason in top.reasons
        )
    )
    if decision.status == "supported" and (decision.rule_strong or specific):
        return True
    if legacy_option.support_status in ("explanation_only", "unsupported") and specific:
        return True
    return False


def plan_interactions(
    regions: RegionExtractionResult,
    snapshot: SourceSnapshot,
    graph: SemanticGraph | None = None,
    budget: CallBudget | None = None,
    *,
    client: PPTAIClient | None = None,
    purpose: str = "",
    on_model_attempt=None,
    hybrid_enabled: bool | None = None,
) -> InteractionPlan:
    budget = budget or CallBudget(max_calls=0)
    legacy_options = {region.region_id: _option_for_region(region, snapshot) for region in regions.regions}
    if hybrid_enabled is False:
        template_options, decisions, matching_diagnostics = {}, {}, {
            "enabled": False,
            "reason": "explicit legacy mode",
        }
    else:
        template_options, decisions, matching_diagnostics = _hybrid_layer(
            regions, snapshot, budget, client, on_model_attempt
        )
    options: list[InteractionOption] = []
    for region in regions.regions:
        legacy = legacy_options.get(region.region_id)
        template_option = template_options.get(region.region_id)
        decision = decisions.get(region.region_id)
        if (
            template_option is not None
            and legacy is not None
            and decision is not None
            and _use_template_option(region, template_option, decision, legacy, decision.candidates)
        ):
            options.append(template_option)
        elif legacy is not None:
            options.append(legacy)
        elif template_option is not None:
            options.append(template_option)
    for region in regions.regions:
        if region.category != "matrix":
            continue
        change = _change_of_basis_option(region, snapshot)
        if change is not None:
            options.append(change)
    by_region = {region.region_id: region for region in regions.regions}
    used = _ai_refine(options, by_region, budget, client, on_model_attempt)
    semantic_graph = graph or build_semantic_graph(options)
    if purpose:
        for option in options:
            if purpose.strip() and len(option.purpose) < 400:
                option.purpose = f"{option.purpose} 目标：{purpose.strip()[:200]}"
    plan = InteractionPlan(
        plan_id=new_id("plan"),
        plan_revision=1,
        material_id=snapshot.material_id,
        source_revision=snapshot.document_revision,
        source_hash=snapshot.source_hash,
        options=options,
        coverage=regions.coverage,
        issues=regions.issues,
        budget={
            "max_calls": budget.max_calls,
            "used_calls": budget.used_calls,
            "ai_used": used > 0 or bool(matching_diagnostics.get("model_used")),
            "ai_questions_updated": used,
            "planner": "hybrid-rule-semantic-model-adjudication+optional-ai-refine",
            "matching": matching_diagnostics,
        },
        created_at=now_iso(),
    )
    validate_contract("plan", plan.model_dump(mode="json"))
    return plan


def plan_content_hash(plan: InteractionPlan) -> str:
    return hash_json(plan.model_dump(mode="json"))


__all__ = [
    "build_semantic_graph",
    "plan_content_hash",
    "plan_interactions",
]

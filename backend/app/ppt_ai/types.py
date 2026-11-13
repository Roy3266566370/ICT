"""PPT AI 领域类型（公共签名的唯一权威定义）。

这些类型同时用于 API 请求、持久化文档和前端契约。字段必须与
``contracts/ppt-ai/*.schema.json`` 保持一致；新增字段时先改 Schema 和这里，
再由 ``app.ppt_ai.contracts`` 在边界做严格校验。

约定：

- 所有 bbox 为**相对原始页面**的 0—1 坐标；像素/EMU/网页坐标转换集中在
  ``regions.py`` / ``source_snapshot.py``。
- 时间统一使用 ISO 8601 UTC 字符串（与项目其它模块一致）。
- ``origin_type`` 记录最初来源；用户核对只追加 ``user_checks``，不改写来源。
- 任何模型输出都不得成为可执行脚本；可执行内容只能是登记算子或受限表达式。
"""

from __future__ import annotations

import math
from typing import Any, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import REGISTRY_VERSION, SCHEMA_VERSION, VIEW_CONTRACT_VERSION

OriginType = Literal[
    "native", "ocr", "model_inference", "user_input", "supplement", "teaching"
]
PlanSupportStatus = Literal["supported", "needs_review", "explanation_only", "unsupported"]
ExtractionState = Literal["native", "ocr", "visual", "manual_review", "skipped"]
ReviewStatus = Literal["candidate", "confirmed", "rejected", "split"]
BranchStatus = Literal["active", "candidate", "archived"]
BranchKind = Literal["baseline", "practice", "candidate"]
TaskStatus = Literal["queued", "running", "needs_review", "succeeded", "failed", "cancelled", "superseded"]
TaskKind = Literal[
    "ai_plan", "ai_rebuild", "ai_experiment", "ai_verify", "ai_codegen", "ai_target",
    "ai_learn_prepare", "ai_learn_explain", "ai_learn_question", "ai_learn_execute",
    "ai_learn_practice", "ai_learn_verify",
]
RelationType = Literal["same_parameter", "derived_from", "view_of", "step_of"]
ValueType = Literal[
    "number", "integer", "boolean", "string", "enum", "matrix2", "vector2",
    "number_list", "number_matrix",
]

ScalarValue: TypeAlias = float | int | bool | str
CanonicalValue: TypeAlias = ScalarValue | list[float] | list[list[float]]
CanonicalValues: TypeAlias = dict[str, CanonicalValue]


class StrictModel(BaseModel):
    """所有领域对象的共同约束：拒绝额外字段，禁止 NaN/Inf。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=False, protected_namespaces=())


def _finite(value: float) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError("必须是数值")
    if not math.isfinite(float(value)):
        raise ValueError("必须是有限数值")
    return float(value)


class BBox(StrictModel):
    """归一化矩形：相对原始页面的 0—1 坐标。"""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def _inside_page(self) -> "BBox":
        if self.x + self.w > 1.000001 or self.y + self.h > 1.000001:
            raise ValueError("bbox 超出页面范围")
        return self


class UserCheck(StrictModel):
    check_id: str = Field(min_length=1, max_length=96)
    decision: Literal["confirm", "edit", "reject"]
    note: str = Field(default="", max_length=500)
    checked_at: str = Field(min_length=10, max_length=32)
    before_hash: str = Field(default="", max_length=64)
    after_hash: str = Field(default="", max_length=64)


class Provenance(StrictModel):
    """来源记录：原始证据、推断说明与用户核对记录分开保存。"""

    origin_type: OriginType
    evidence: str = Field(default="", max_length=4000)
    inference: str = Field(default="", max_length=2000)
    user_checks: list[UserCheck] = Field(default_factory=list, max_length=50)
    method: str = Field(default="", max_length=120)

    @model_validator(mode="after")
    def _evidence_for_direct_source(self) -> "Provenance":
        if self.origin_type in ("native", "ocr", "user_input") and not self.evidence.strip():
            raise ValueError("native/ocr/user_input 来源必须给出证据")
        if self.origin_type == "model_inference" and not (self.inference.strip() or self.evidence.strip()):
            raise ValueError("模型推断必须说明依据")
        return self


class SourceAnchor(StrictModel):
    material_id: str = Field(min_length=1, max_length=96)
    page: int = Field(ge=1, le=500)
    node_id: str | None = Field(default=None, max_length=96)
    element_id: str | None = Field(default=None, max_length=96)
    bbox: BBox
    excerpt: str = Field(default="", max_length=160)
    source_version: int = Field(ge=0, default=0)
    semantic_content_hash: str = Field(min_length=8, max_length=64)


class RegionEvidence(StrictModel):
    source: Literal["native", "ocr", "model", "user"]
    method: str = Field(default="", max_length=120)
    element_id: str | None = Field(default=None, max_length=96)
    text: str = Field(default="", max_length=4000)
    note: str = Field(default="", max_length=1000)


class RegionIssue(StrictModel):
    code: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=500)
    severity: Literal["info", "warn", "error"] = "warn"


class Region(StrictModel):
    region_id: str = Field(min_length=1, max_length=96)
    page_no: int = Field(ge=1, le=500)
    node_ids: list[str] = Field(default_factory=list, max_length=200)
    element_ids: list[str] = Field(default_factory=list, max_length=200)
    bbox: BBox
    category: str = Field(min_length=1, max_length=48)
    extraction_state: ExtractionState
    evidence: list[RegionEvidence] = Field(default_factory=list, max_length=30)
    issues: list[RegionIssue] = Field(default_factory=list, max_length=30)
    semantic_content_hash: str = Field(min_length=8, max_length=64)
    provenance: Provenance
    semantic: dict[str, Any] = Field(default_factory=dict)


class CoverageEntry(StrictModel):
    page_no: int = Field(ge=1, le=500)
    native: list[str] = Field(default_factory=list)
    ocr: list[str] = Field(default_factory=list)
    visual: list[str] = Field(default_factory=list)
    manual_review: list[str] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)


class RegionExtractionResult(StrictModel):
    regions: list[Region]
    coverage: list[CoverageEntry]
    coordinate_system: dict[str, Any]
    issues: list[RegionIssue] = Field(default_factory=list)
    source_hash: str = Field(min_length=8, max_length=64)
    source_revision: int = Field(ge=0)


class ModelNode(StrictModel):
    concept_id: str = Field(min_length=1, max_length=96)
    name: str = Field(min_length=1, max_length=80)
    type: ValueType = "number"
    unit: str = Field(default="", max_length=24)
    dimension: str = Field(default="scalar", max_length=24)
    domain: dict[str, float | None] = Field(default_factory=dict)
    default: CanonicalValue
    source: SourceAnchor
    semantic_role: str = Field(default="parameter", max_length=64)
    provenance: Provenance


class ModelRelation(StrictModel):
    relation_id: str = Field(min_length=1, max_length=96)
    type: RelationType
    inputs: list[str] = Field(default_factory=list, max_length=500)
    outputs: list[str] = Field(default_factory=list, max_length=16)
    expression: str | None = Field(default=None, max_length=600)
    operator_id: str | None = Field(default=None, max_length=96)
    source: list[SourceAnchor] = Field(default_factory=list, max_length=16)
    review_status: ReviewStatus = "confirmed"
    note: str = Field(default="", max_length=500)


class LinkCandidate(StrictModel):
    candidate_id: str = Field(min_length=1, max_length=96)
    left_concept_id: str = Field(min_length=1, max_length=96)
    right_concept_id: str = Field(min_length=1, max_length=96)
    relation_type: RelationType = "same_parameter"
    reason: str = Field(min_length=1, max_length=500)
    confidence: float = Field(ge=0, le=1)
    conflict: bool = Field(default=False)
    conflict_note: str = Field(default="", max_length=500)
    # 分组候选：一次核对一个概念，而不是一对参数。
    concept_ids: list[str] = Field(default_factory=list, max_length=500)
    occurrences: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    normalized_name: str = Field(default="", max_length=80)
    source_node_id: str | None = Field(default=None, max_length=96)
    source_output: str | None = Field(default=None, max_length=80)
    target_node_id: str | None = Field(default=None, max_length=96)
    target_parameter_id: str | None = Field(default=None, max_length=96)
    declared_value: float | None = None


class SemanticGraph(StrictModel):
    nodes: list[ModelNode] = Field(default_factory=list, max_length=2000)
    relations: list[ModelRelation] = Field(default_factory=list, max_length=2000)
    candidates: list[LinkCandidate] = Field(default_factory=list, max_length=1000)
    conflicts: list[dict[str, Any]] = Field(default_factory=list, max_length=200)
    graph_revision: int = Field(default=1, ge=1)
    #: 编译期算好的拓扑序；旧 bundle 为空，读取时按编译顺序回退。
    dependency_order: list[str] = Field(default_factory=list, max_length=200)


class ParameterBinding(StrictModel):
    """参数取值来源：自由拖动，或链接到另一个概念（含派生输出）。"""

    mode: Literal["free", "linked"] = "free"
    concept_id: str = Field(default="", max_length=96)
    #: 派生值换算到本参数单位的比例；无单位或同单位时为 1。
    factor: float = 1.0

    @model_validator(mode="after")
    def _linked_has_target(self) -> "ParameterBinding":
        if self.mode == "linked" and not self.concept_id:
            raise ValueError("linked 绑定必须给出 concept_id")
        if not math.isfinite(float(self.factor)) or self.factor <= 0:
            raise ValueError("绑定换算比例必须为正的有限数值")
        return self


class PlanParameter(StrictModel):
    concept_id: str = Field(min_length=1, max_length=96)
    id: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    label: str = Field(min_length=1, max_length=80)
    type: ValueType = "number"
    unit: str = Field(default="", max_length=24)
    default: CanonicalValue
    min: float | None = None
    max: float | None = None
    step: float | None = None
    options: list[str] = Field(default_factory=list, max_length=100)
    shape: list[int] = Field(default_factory=list, max_length=4)
    source: SourceAnchor
    provenance: Provenance
    binding: ParameterBinding = Field(default_factory=ParameterBinding)

    @model_validator(mode="after")
    def _range(self) -> "PlanParameter":
        for key in ("min", "max", "step"):
            value = getattr(self, key)
            if value is not None:
                _finite(value)
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("参数最小值大于最大值")
        if self.step is not None and self.step <= 0:
            raise ValueError("参数步长必须为正")
        for size in self.shape:
            if not isinstance(size, int) or size < 1 or size > 1024:
                raise ValueError("参数 shape 必须是正整数")
        if self.type in ("number_list", "number_matrix", "matrix2", "vector2"):
            if self.min is not None or self.max is not None or self.step is not None:
                raise ValueError("数组/矩阵参数不设置 min/max/step")
            values = _array_values(self.type, self.default)
            if self.shape and list(values) != self.shape:
                raise ValueError("参数默认值形状与 shape 不一致")
        else:
            if self.shape:
                raise ValueError("标量参数不能声明 shape")
            if isinstance(self.default, (int, float)) and not isinstance(self.default, bool):
                value = float(self.default)
                if not math.isfinite(value):
                    raise ValueError("参数默认值必须是有限数值")
                if self.min is not None and value < self.min:
                    raise ValueError("参数默认值小于最小值")
                if self.max is not None and value > self.max:
                    raise ValueError("参数默认值大于最大值")
            if self.type == "enum" and self.options and str(self.default) not in self.options:
                raise ValueError("枚举默认值不在 options 中")
        return self


def _array_values(type_: str, value: CanonicalValue) -> list[int]:
    """校验数组默认值并返回其形状；非法值直接拒绝。"""
    if type_ == "number_list":
        if not isinstance(value, list) or not value or len(value) > 1024:
            raise ValueError("number_list 默认值必须是非空数值数组")
        if any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in value):
            raise ValueError("number_list 只能包含数值")
        if any(not math.isfinite(float(item)) for item in value):
            raise ValueError("number_list 只能包含有限数值")
        return [len(value)]
    if type_ == "vector2":
        if not isinstance(value, list) or len(value) != 2:
            raise ValueError("vector2 默认值必须是长度为 2 的数组")
        if any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in value):
            raise ValueError("vector2 只能包含数值")
        if any(not math.isfinite(float(item)) for item in value):
            raise ValueError("vector2 只能包含有限数值")
        return [2]
    if not isinstance(value, list) or not value or len(value) > 32:
        raise ValueError("number_matrix 默认值必须是二维数值数组")
    rows: list[list[float]] = []
    for row in value:
        if not isinstance(row, list) or not row or len(row) > 1024:
            raise ValueError("number_matrix 的每一行必须是非空数组")
        if any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in row):
            raise ValueError("number_matrix 只能包含数值")
        if any(not math.isfinite(float(item)) for item in row):
            raise ValueError("number_matrix 只能包含有限数值")
        rows.append([float(item) for item in row])
    if any(len(row) != len(rows[0]) for row in rows):
        raise ValueError("number_matrix 各行长度必须一致")
    if type_ == "matrix2" and (len(rows) != 2 or len(rows[0]) != 2):
        raise ValueError("matrix2 默认值必须是 2×2 矩阵")
    return [len(rows), len(rows[0])]


class PlanView(StrictModel):
    view_id: str = Field(min_length=1, max_length=96)
    type: Literal["curve", "table", "text", "metrics", "axes", "heatmap", "scene3d"]
    title: str = Field(min_length=1, max_length=120)
    binding: str = Field(default="", max_length=96)
    description: str = Field(default="", max_length=500)


class PlanReviewItem(StrictModel):
    item_id: str = Field(min_length=1, max_length=96)
    kind: Literal["range", "initial_value", "unit", "source", "expression", "link", "other"]
    prompt: str = Field(min_length=1, max_length=500)
    required: bool = True
    blocking: bool = False
    answer: str = Field(default="", max_length=500)


class InteractionOption(StrictModel):
    option_id: str = Field(min_length=1, max_length=96)
    region_id: str = Field(min_length=1, max_length=96)
    title: str = Field(min_length=1, max_length=120)
    question: str = Field(min_length=1, max_length=500)
    purpose: str = Field(default="", max_length=1000)
    operator_id: str = Field(min_length=1, max_length=96)
    support_status: PlanSupportStatus
    support_reason: str = Field(default="", max_length=1000)
    parameters: list[PlanParameter] = Field(default_factory=list, max_length=20)
    views: list[PlanView] = Field(default_factory=list, max_length=20)
    bindings: list[dict[str, str]] = Field(default_factory=list, max_length=40)
    review_items: list[PlanReviewItem] = Field(default_factory=list, max_length=40)
    provider: dict[str, Any] = Field(default_factory=dict)
    source: SourceAnchor
    offline_supported: bool = False
    learning: dict[str, Any] | None = None


class InteractionPlan(StrictModel):
    plan_id: str = Field(min_length=1, max_length=96)
    plan_revision: int = Field(ge=1, default=1)
    material_id: str = Field(min_length=1, max_length=96)
    source_revision: int = Field(ge=0)
    source_hash: str = Field(min_length=8, max_length=64)
    options: list[InteractionOption] = Field(default_factory=list, max_length=200)
    coverage: list[CoverageEntry] = Field(default_factory=list)
    issues: list[RegionIssue] = Field(default_factory=list)
    budget: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(min_length=10, max_length=32)


class OutputSpec(StrictModel):
    """算子声明的派生概念：只有登记过的输出才参与跨页联动。"""

    key: str = Field(min_length=1, max_length=64)
    concept_id: str = Field(min_length=1, max_length=96)
    name: str = Field(min_length=1, max_length=80)
    type: ValueType = "number"
    unit: str = Field(default="", max_length=24)


class CompiledNode(StrictModel):
    node_id: str = Field(min_length=1, max_length=96)
    option_id: str = Field(min_length=1, max_length=96)
    region_id: str = Field(min_length=1, max_length=96)
    operator_id: str = Field(min_length=1, max_length=96)
    title: str = Field(min_length=1, max_length=120)
    parameters: list[PlanParameter] = Field(default_factory=list, max_length=20)
    outputs: list[OutputSpec] = Field(default_factory=list, max_length=20)
    views: list[dict[str, Any]] = Field(default_factory=list, max_length=40)
    provider: dict[str, Any] = Field(default_factory=dict)
    checks: list[dict[str, Any]] = Field(default_factory=list, max_length=40)
    offline_supported: bool = False
    source: SourceAnchor
    learning: dict[str, Any] | None = None


class CompiledPayload(StrictModel):
    nodes: list[CompiledNode] = Field(default_factory=list, max_length=200)
    order: list[str] = Field(default_factory=list, max_length=200)
    ispecs: list[dict[str, Any]] = Field(default_factory=list, max_length=200)
    checks: list[dict[str, Any]] = Field(default_factory=list, max_length=200)
    resources: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    view_contract_version: str = VIEW_CONTRACT_VERSION


class InteractionBundle(StrictModel):
    bundle_id: str = Field(min_length=1, max_length=96)
    bundle_revision: int = Field(ge=1)
    # 旧 bundle 保留 ppt-ai.1；新 bundle 写 ppt-ai.2，缺少的 outputs/binding
    # 由模型默认值补成空列表/自由参数，旧数据读取行为不变。
    schema_version: Literal["ppt-ai.1", "ppt-ai.2"] = SCHEMA_VERSION
    material_id: str = Field(min_length=1, max_length=96)
    source_revision: int = Field(ge=0)
    source_hash: str = Field(min_length=8, max_length=64)
    registry_version: str = Field(default=REGISTRY_VERSION, max_length=64)
    status: Literal["draft", "active", "superseded"] = "active"
    content_hash: str = Field(min_length=8, max_length=64)
    plans: list[InteractionPlan] = Field(default_factory=list, max_length=100)
    graph: SemanticGraph = Field(default_factory=SemanticGraph)
    compiled: CompiledPayload = Field(default_factory=CompiledPayload)
    seed_values: CanonicalValues = Field(default_factory=dict)
    created_at: str = Field(min_length=10, max_length=32)


class EvaluationSnapshot(StrictModel):
    input_hash: str = Field(min_length=8, max_length=64)
    evaluation_hash: str = Field(min_length=8, max_length=64)
    branch_revision: int = Field(ge=1)
    values: CanonicalValues = Field(default_factory=dict)
    derived: dict[str, Any] = Field(default_factory=dict)
    #: 派生概念的求值结果，独立于用户输入值的命名空间。
    derived_values: CanonicalValues = Field(default_factory=dict)
    trace: list[dict[str, Any]] = Field(default_factory=list, max_length=5000)
    checks: list[dict[str, Any]] = Field(default_factory=list, max_length=200)
    violations: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    stop_reason: str = Field(default="evaluated", max_length=64)
    kernel_version: str = Field(min_length=1, max_length=64)


class BranchState(StrictModel):
    branch_id: str = Field(min_length=1, max_length=96)
    bundle_id: str = Field(min_length=1, max_length=96)
    material_id: str = Field(min_length=1, max_length=96)
    revision: int = Field(ge=1)
    status: BranchStatus = "active"
    kind: BranchKind = "candidate"
    title: str = Field(default="", max_length=200)
    parent_branch_id: str | None = Field(default=None, max_length=96)
    canonical_values: CanonicalValues
    #: 局部覆盖：{node_id: {concept_id: value}}；只影响该节点，不向下游传播。
    overrides: dict[str, CanonicalValues] = Field(default_factory=dict)
    evaluation: EvaluationSnapshot | None = None
    learning: dict[str, Any] = Field(default_factory=dict)
    updated_at: str = Field(min_length=10, max_length=32)


class FrozenContext(StrictModel):
    bundle_id: str = Field(min_length=1, max_length=96)
    bundle_revision: int = Field(ge=1)
    branch_id: str = Field(min_length=1, max_length=96)
    branch_revision: int = Field(ge=1)
    values: CanonicalValues
    evaluation_hash: str = Field(min_length=8, max_length=64)
    selection: dict[str, Any] = Field(default_factory=dict)
    source_projection: list[dict[str, Any]] = Field(default_factory=list, max_length=100)


class ExperimentRequest(StrictModel):
    question: str = Field(min_length=3, max_length=1000)
    recipe_hint: Literal["compare", "counterexample", "boundary", "sensitivity"] | None = None
    selection: dict[str, Any] = Field(default_factory=dict)
    allowed_variables: list[str] = Field(default_factory=list, max_length=20)
    ranges: dict[str, list[float]] = Field(default_factory=dict)
    expected_branch_revision: int | None = Field(default=None, ge=1)
    operation_id: str = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def _ranges(self) -> "ExperimentRequest":
        for concept_id, bounds in self.ranges.items():
            if len(bounds) != 2 or any(not math.isfinite(v) for v in bounds):
                raise ValueError(f"范围 {concept_id} 必须是两个有限数值")
            if bounds[0] > bounds[1]:
                raise ValueError(f"范围 {concept_id} 的下界大于上界")
        return self


class ExperimentCondition(StrictModel):
    concept_id: str
    label: str
    value: CanonicalValue
    origin_type: OriginType
    note: str = Field(default="", max_length=300)


class ExperimentCandidate(StrictModel):
    path_id: str = Field(min_length=1, max_length=96)
    label: str = Field(min_length=1, max_length=160)
    values: CanonicalValues
    output_value: float | None = None
    result: dict[str, Any] = Field(default_factory=dict)
    checks: list[dict[str, Any]] = Field(default_factory=list)
    witness: dict[str, Any] | None = None


class ExperimentDraft(StrictModel):
    draft_id: str = Field(min_length=1, max_length=96)
    experiment_id: str | None = Field(default=None, max_length=96)
    recipe_id: Literal["compare", "counterexample", "boundary", "sensitivity"]
    question: str = Field(min_length=1, max_length=1000)
    context: FrozenContext
    original_conditions: list[ExperimentCondition] = Field(default_factory=list)
    supplement_conditions: list[ExperimentCondition] = Field(default_factory=list)
    variables: list[str] = Field(default_factory=list, max_length=20)
    frozen_variables: list[str] = Field(default_factory=list)
    search_ranges: dict[str, list[float]] = Field(default_factory=dict)
    comparison_scale: str = Field(default="", max_length=300)
    stop_rule: str = Field(default="", max_length=300)
    predicate: dict[str, Any] | None = None
    candidates: list[ExperimentCandidate] = Field(default_factory=list, max_length=500)
    status: Literal["draft", "needs_review", "unsupported"] = "draft"
    review_items: list[PlanReviewItem] = Field(default_factory=list, max_length=40)
    notes: list[str] = Field(default_factory=list, max_length=40)
    result_hash: str = Field(default="", max_length=64)


class ExperimentResult(StrictModel):
    status: Literal["found", "not_found_in_scope", "unknown", "timeout", "infeasible_proven"]
    recipe_id: Literal["compare", "counterexample", "boundary", "sensitivity"]
    used_scope: dict[str, list[float]] = Field(default_factory=dict)
    candidate_count: int = Field(ge=0)
    paths: list[ExperimentCandidate] = Field(default_factory=list, max_length=500)
    checks: list[dict[str, Any]] = Field(default_factory=list, max_length=200)
    result_hash: str = Field(min_length=8, max_length=64)
    branch_id: str | None = Field(default=None, max_length=96)
    explanation: list[str] = Field(default_factory=list, max_length=40)
    stop_reason: str = Field(default="", max_length=200)


class Experiment(StrictModel):
    experiment_id: str = Field(min_length=1, max_length=96)
    material_id: str = Field(min_length=1, max_length=96)
    bundle_id: str = Field(min_length=1, max_length=96)
    branch_id: str | None = Field(default=None, max_length=96)
    parent_branch_id: str | None = Field(default=None, max_length=96)
    question: str = Field(min_length=1, max_length=1000)
    recipe_id: str = Field(min_length=1, max_length=32)
    draft: ExperimentDraft
    result: ExperimentResult | None = None
    status: Literal["draft", "running", "succeeded", "failed", "needs_review"] = "draft"
    created_at: str = Field(min_length=10, max_length=32)


class TargetRequest(StrictModel):
    node_id: str = Field(min_length=1, max_length=96)
    output: str = Field(min_length=1, max_length=80)
    target_value: float
    target_vector: list[float] | None = Field(default=None, min_length=2, max_length=4)
    variables: list[str] = Field(min_length=1, max_length=8)
    fixed: CanonicalValues = Field(default_factory=dict)
    constraints: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    ranges: dict[str, list[float]] = Field(default_factory=dict)
    tolerance: float = Field(default=1e-6, gt=0, le=1)
    max_iterations: int = Field(default=200, ge=1, le=2000)
    operation_id: str = Field(min_length=1, max_length=100)
    expected_branch_revision: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _finite_target(self) -> "TargetRequest":
        _finite(self.target_value)
        if self.target_vector is not None:
            for item in self.target_vector:
                _finite(item)
        for concept_id, bounds in self.ranges.items():
            if len(bounds) != 2 or any(not math.isfinite(v) for v in bounds):
                raise ValueError(f"范围 {concept_id} 必须是两个有限数值")
            if bounds[0] > bounds[1]:
                raise ValueError(f"范围 {concept_id} 的下界大于上界")
        return self


class TargetSolution(StrictModel):
    """显式解：不依赖候选值映射里恰好存在 ``v1/v2`` 参数。"""

    unknowns: list[str] = Field(min_length=1, max_length=8)
    values: list[float] = Field(min_length=1, max_length=8)
    classification: Literal["unique", "particular", "scalar_candidate"]
    exact_values: list[str] = Field(default_factory=list, max_length=8)
    free_variables: list[str] = Field(default_factory=list, max_length=8)
    nullspace_basis: list[list[float]] = Field(default_factory=list, max_length=8)
    equations: list[str] = Field(default_factory=list, max_length=16)
    verification: list[dict[str, Any]] = Field(default_factory=list, max_length=16)

    @model_validator(mode="after")
    def _aligned(self) -> "TargetSolution":
        if len(self.values) != len(self.unknowns):
            raise ValueError("solution.values 必须与 unknowns 等长")
        for value in self.values:
            _finite(value)
        if len(self.exact_values) not in (0, len(self.unknowns)):
            raise ValueError("exact_values 长度必须与 unknowns 一致")
        for row in self.nullspace_basis:
            if len(row) != len(self.unknowns):
                raise ValueError("nullspace_basis 每行长度必须与 unknowns 一致")
        return self


class TargetCandidate(StrictModel):
    values: CanonicalValues
    output_value: float | None
    residual: float | None
    method: str = Field(default="", max_length=120)
    solution: TargetSolution | None = None


class TargetResult(StrictModel):
    status: Literal["found", "multiple", "none_in_scope", "unknown", "timeout", "infeasible_proven"]
    output: str
    target_value: float
    candidates: list[TargetCandidate] = Field(default_factory=list, max_length=200)
    method: str = Field(default="", max_length=120)
    tolerance: float = Field(gt=0)
    atol: float = Field(default=1e-8, gt=0)
    rtol: float = Field(default=1e-6, gt=0)
    residual: float | None = None
    search_scope: dict[str, list[float]] = Field(default_factory=dict)
    iterations: int = Field(default=0, ge=0)
    stop_reason: str = Field(default="", max_length=200)
    checks: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    candidate_branch_id: str | None = Field(default=None, max_length=96)


class ValidationCase(StrictModel):
    case_id: str = Field(min_length=1, max_length=96)
    target: dict[str, Any] = Field(default_factory=dict)
    inputs: CanonicalValues = Field(default_factory=dict)
    actions: list[dict[str, Any]] = Field(default_factory=list, max_length=50)
    expected: dict[str, Any] = Field(default_factory=dict)
    tolerance: float = Field(default=1e-6, gt=0)
    evidence: list[str] = Field(default_factory=list, max_length=20)


class ValidationReport(StrictModel):
    report_id: str = Field(min_length=1, max_length=96)
    material_id: str = Field(min_length=1, max_length=96)
    bundle_id: str = Field(min_length=1, max_length=96)
    branch_id: str | None = Field(default=None, max_length=96)
    artifact_id: str | None = Field(default=None, max_length=96)
    bundle_hash: str = Field(min_length=8, max_length=64)
    branch_hash: str = Field(default="", max_length=64)
    kernel_version: str = Field(min_length=1, max_length=64)
    runtime_version: str = Field(min_length=1, max_length=64)
    status: Literal["passed", "needs_review", "failed", "stale"] = "needs_review"
    summary: dict[str, int] = Field(default_factory=dict)
    rules: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    semantic_review: list[PlanReviewItem] = Field(default_factory=list, max_length=100)
    browser: dict[str, Any] = Field(default_factory=dict)
    repair: dict[str, Any] | None = None
    created_at: str = Field(min_length=10, max_length=32)
    stale: bool = False


class GeneratedViewArtifact(StrictModel):
    artifact_id: str = Field(min_length=1, max_length=96)
    material_id: str = Field(min_length=1, max_length=96)
    bundle_id: str = Field(min_length=1, max_length=96)
    content_hash: str = Field(min_length=8, max_length=64)
    view_contract_version: str = Field(default=VIEW_CONTRACT_VERSION, max_length=64)
    program: str = Field(min_length=1, max_length=20000)
    program_language: Literal["javascript"] = "javascript"
    ast: dict[str, Any] = Field(default_factory=dict)
    resources: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    supported_interactions: list[str] = Field(default_factory=list, max_length=30)
    offline_supported: bool = False
    acceptance_status: Literal["pending", "accepted", "rejected"] = "pending"
    isolation: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(min_length=10, max_length=32)


class FrozenInteractionSnapshot(StrictModel):
    snapshot_version: Literal["ppt-ai.frozen.1", "ppt-ai.frozen.2"] = "ppt-ai.frozen.2"
    frozen_at: str = Field(min_length=10, max_length=32)
    document_revision: int = Field(ge=0)
    bundle_id: str = Field(min_length=1, max_length=96)
    bundle_revision: int = Field(ge=1)
    bundle_hash: str = Field(min_length=8, max_length=64)
    branch_id: str = Field(min_length=1, max_length=96)
    branch_revision: int = Field(ge=1)
    branch_hash: str = Field(min_length=8, max_length=64)
    runtime_version: str = Field(min_length=1, max_length=64)
    kernel_version: str = Field(min_length=1, max_length=64)
    registry_version: str = Field(min_length=1, max_length=64)
    bundle: dict[str, Any]
    branch: dict[str, Any]
    experiments: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    artifacts: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    reports: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    public_sources: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    resource_manifest: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    learning: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    capabilities: dict[str, Any] = Field(default_factory=dict)
    content_hash: str = Field(min_length=8, max_length=64)


class PptAITask(StrictModel):
    task_id: str = Field(min_length=1, max_length=96)
    material_id: str = Field(min_length=1, max_length=96)
    kind: TaskKind
    status: TaskStatus = "queued"
    stage: str = Field(default="queued", max_length=64)
    operation_id: str = Field(min_length=1, max_length=100)
    input_version: int = Field(default=0, ge=0)
    input_hash: str = Field(default="", max_length=64)
    budget_used: int = Field(default=0, ge=0)
    result: dict[str, Any] | None = None
    error_code: str | None = Field(default=None, max_length=64)
    error_message: str | None = Field(default=None, max_length=1000)
    attempt: int = Field(default=1, ge=1)
    created_at: str = Field(min_length=10, max_length=32)
    updated_at: str = Field(min_length=10, max_length=32)


class SourceSnapshot(StrictModel):
    material_id: str = Field(min_length=1, max_length=96)
    document_revision: int = Field(ge=0)
    source_hash: str = Field(min_length=8, max_length=64)
    pages: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    scene_document: dict[str, Any] | None = None
    parse_payload: dict[str, Any] | None = None
    page_count: int = Field(default=0, ge=0)
    title: str = Field(default="", max_length=255)


class LinkDecision(StrictModel):
    candidate_id: str = Field(min_length=1, max_length=96)
    decision: Literal["confirm", "reject", "split"]
    concept_id: str | None = Field(default=None, max_length=96)
    #: 合并组存在默认值冲突时，用户选择保留哪个值。
    value: CanonicalValue | None = None
    #: 所选值来自哪个概念（可能带不同单位），服务端会换算到合并后的单位。
    value_concept_id: str | None = Field(default=None, max_length=96)
    expected_graph_revision: int | None = Field(default=None, ge=1)
    note: str = Field(default="", max_length=500)


# 供 ``CallBudget`` 使用的轻量对象；LLM 客户端与规划器共享。
class CallBudget(StrictModel):
    max_calls: int = Field(default=0, ge=0, le=100)
    used_calls: int = Field(default=0, ge=0, le=100)
    deadline_s: float = Field(default=300.0, gt=0, le=3600)
    request_bytes_limit: int = Field(default=5 * 1024 * 1024, gt=0)
    output_tokens_limit: int = Field(default=4096, gt=0, le=32768)

    @property
    def remaining(self) -> int:
        return max(0, self.max_calls - self.used_calls)


__all__ = [
    "BBox",
    "BranchState",
    "CallBudget",
    "CanonicalValue",
    "CanonicalValues",
    "CompiledNode",
    "CompiledPayload",
    "CoverageEntry",
    "EvaluationSnapshot",
    "Experiment",
    "ExperimentCandidate",
    "ExperimentCondition",
    "ExperimentDraft",
    "ExperimentRequest",
    "ExperimentResult",
    "ExtractionState",
    "FrozenContext",
    "FrozenInteractionSnapshot",
    "GeneratedViewArtifact",
    "InteractionBundle",
    "InteractionOption",
    "InteractionPlan",
    "LinkCandidate",
    "LinkDecision",
    "ModelNode",
    "ModelRelation",
    "OriginType",
    "OutputSpec",
    "ParameterBinding",
    "PlanParameter",
    "PlanReviewItem",
    "PlanSupportStatus",
    "PlanView",
    "PptAITask",
    "Provenance",
    "Region",
    "RegionEvidence",
    "RegionExtractionResult",
    "RegionIssue",
    "RelationType",
    "SCHEMA_VERSION",
    "SemanticGraph",
    "SourceAnchor",
    "SourceSnapshot",
    "StrictModel",
    "BranchKind",
    "TargetCandidate",
    "TargetRequest",
    "TargetResult",
    "TargetSolution",
    "UserCheck",
    "ValidationCase",
    "ValidationReport",
]

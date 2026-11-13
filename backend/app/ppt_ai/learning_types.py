"""学习呈现层严格 DTO（契约版本 ``ppt-learning.1``）。

这些结构只描述「原页学习」的读模型、请求上下文、问题答复与答案卡。它们复用
``types.py`` 的 bbox/来源/目标解，不改变既有 ``ppt-ai.1`` 字段语义：

- 学习上下文由服务端复算 ``input_hash``，前端不得自行伪造；
- 模型只能提出目标与文案，数学事实、解类型和验证来自确定性求值；
- 公开/离线快照只带教学字段，不带 session、模型配置或私有管理信息。
"""

from __future__ import annotations

import math
from typing import Any, Literal

from pydantic import Field, field_validator, model_validator

from .types import (
    BBox,
    BranchKind,
    CanonicalValues,
    OriginType,
    StrictModel,
    TargetSolution,
)

LEARNING_CONTRACT_VERSION = "ppt-learning.1"

LearningGoal = Literal[
    "eigen_direction",
    "change_of_basis",
    "inverse_mapping",
    "registered_exploration",
    "explain",
]
LearningTemplate = Literal[
    "matrix.eigen_probe",
    "matrix.change_of_basis",
    "matrix.inverse",
    "generic.registered",
    "text.explain",
]
LearningState = Literal[
    "unprepared",
    "preparing",
    "ready",
    "needs_review",
    "explanation_only",
    "unsupported",
    "failed",
    "stale",
]
LearningReplyState = Literal[
    "answered", "needs_clarification", "action_ready", "unsupported", "stale"
]
LearningActionKind = Literal["run_experiment", "solve_target"]


class LearningContext(StrictModel):
    """每次提问/求解/保存的条件快照；服务端据此冻结计算上下文。"""

    contract_version: Literal["ppt-learning.1"] = LEARNING_CONTRACT_VERSION
    document_revision: int = Field(ge=0)
    source_hash: str = Field(min_length=8, max_length=64)
    bundle_id: str = Field(min_length=1, max_length=96)
    bundle_revision: int = Field(ge=1)
    page_no: int = Field(ge=1, le=500)
    node_id: str = Field(min_length=1, max_length=96)
    region_id: str = Field(min_length=1, max_length=96)
    branch_id: str = Field(min_length=1, max_length=96)
    branch_revision: int = Field(ge=1)
    draft_revision: int = Field(ge=0, default=0)
    client_request_id: str = Field(min_length=1, max_length=100)
    input_values: CanonicalValues = Field(default_factory=dict)
    input_hash: str | None = Field(default=None, max_length=64)

    @field_validator("input_values")
    @classmethod
    def _finite_inputs(cls, value: CanonicalValues) -> CanonicalValues:
        for item in value.values():
            if isinstance(item, float) and not math.isfinite(item):
                raise ValueError("input_values 不能包含 NaN/Inf")
            if isinstance(item, list):
                for nested in item:
                    if isinstance(nested, float) and not math.isfinite(nested):
                        raise ValueError("input_values 不能包含 NaN/Inf")
        return value


class LearningSourceRef(StrictModel):
    material_id: str = Field(default="", max_length=96)
    page_no: int = Field(ge=1, le=500)
    node_id: str | None = Field(default=None, max_length=96)
    region_id: str | None = Field(default=None, max_length=96)
    element_id: str | None = Field(default=None, max_length=96)
    bbox: BBox
    excerpt: str = Field(default="", max_length=160)
    semantic_content_hash: str = Field(min_length=8, max_length=64)
    origin_type: OriginType = "native"


class LearningControl(StrictModel):
    concept_id: str = Field(min_length=1, max_length=96)
    label: str = Field(min_length=1, max_length=80)
    role: Literal["fixed", "editable"]
    min: float | None = None
    max: float | None = None
    step: float | None = Field(default=None, gt=0)
    precision: int = Field(default=3, ge=0, le=12)
    unit: str = Field(default="", max_length=24)
    reason: str = Field(default="", max_length=300)


class LearningSuggestedAction(StrictModel):
    action_type: Literal["explain", "run_experiment", "solve_target", "compare", "counterexample"]
    label: str = Field(min_length=1, max_length=120)
    question: str = Field(min_length=1, max_length=500)


class LearningReviewItem(StrictModel):
    item_id: str = Field(min_length=1, max_length=96)
    field: str = Field(min_length=1, max_length=64)
    prompt: str = Field(min_length=1, max_length=500)
    current_value: str = Field(default="", max_length=300)
    basis: str = Field(default="", max_length=500)
    required: bool = True
    resolved: bool = False


class LearningDescriptor(StrictModel):
    contract_version: Literal["ppt-learning.1"] = LEARNING_CONTRACT_VERSION
    goal_id: LearningGoal
    title: str = Field(min_length=1, max_length=120)
    objective: str = Field(min_length=1, max_length=500)
    source_refs: list[LearningSourceRef] = Field(default_factory=list, max_length=40)
    template_id: LearningTemplate
    bindings: dict[str, str] = Field(default_factory=dict, max_length=60)
    fixed_roles: list[str] = Field(default_factory=list, max_length=40)
    editable_roles: list[str] = Field(default_factory=list, max_length=40)
    controls: list[LearningControl] = Field(default_factory=list, max_length=40)
    suggested_actions: list[LearningSuggestedAction] = Field(default_factory=list, max_length=3)
    review_items: list[LearningReviewItem] = Field(default_factory=list, max_length=40)
    notes: list[str] = Field(default_factory=list, max_length=20)


class LearningCapabilities(StrictModel):
    can_explain_online: bool = False
    can_ask_online: bool = False
    can_explore_locally: bool = True
    can_save_cloud: bool = False
    can_manage: bool = False


class LearningItem(StrictModel):
    item_id: str = Field(min_length=1, max_length=96)
    node_id: str = Field(min_length=1, max_length=96)
    region_id: str = Field(min_length=1, max_length=96)
    title: str = Field(min_length=1, max_length=120)
    state: LearningState
    support_status: str = Field(default="", max_length=32)
    descriptor: LearningDescriptor
    baseline_values: CanonicalValues = Field(default_factory=dict)
    explanation_ready: bool = False
    experiment_ready: bool = False
    manual_review_reason: str = Field(default="", max_length=1000)
    packaged_explanation: dict[str, Any] | None = None


class LearningPage(StrictModel):
    contract_version: Literal["ppt-learning.1"] = LEARNING_CONTRACT_VERSION
    material_id: str = Field(min_length=1, max_length=96)
    page_no: int = Field(ge=1, le=500)
    document_revision: int = Field(ge=0)
    source_hash: str = Field(min_length=8, max_length=64)
    bundle_id: str | None = Field(default=None, max_length=96)
    bundle_revision: int | None = Field(default=None, ge=1)
    branch_id: str | None = Field(default=None, max_length=96)
    branch_revision: int | None = Field(default=None, ge=1)
    branch_kind: BranchKind | None = None
    state: LearningState
    items: list[LearningItem] = Field(default_factory=list, max_length=40)
    pending_task_id: str | None = Field(default=None, max_length=96)
    capabilities: LearningCapabilities = Field(default_factory=LearningCapabilities)
    note: str = Field(default="", max_length=500)
    generated_at: str = Field(min_length=10, max_length=32)


class LearningCondition(StrictModel):
    concept_id: str = Field(min_length=1, max_length=96)
    label: str = Field(min_length=1, max_length=80)
    value: Any
    origin_type: OriginType
    note: str = Field(default="", max_length=300)


class LearningActionDraft(StrictModel):
    action_id: str = Field(min_length=1, max_length=96)
    kind: LearningActionKind
    context: LearningContext
    summary: str = Field(min_length=1, max_length=500)
    conditions: list[LearningCondition] = Field(default_factory=list, max_length=40)
    added_conditions: list[LearningCondition] = Field(default_factory=list, max_length=20)
    execution_payload: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(min_length=10, max_length=32)


class LearningVerification(StrictModel):
    label: str = Field(min_length=1, max_length=120)
    expected: str = Field(default="", max_length=300)
    actual: str = Field(default="", max_length=300)
    residual: float | None = None
    status: Literal["pass", "fail", "not_checked"] = "not_checked"


class LearningResultCard(StrictModel):
    card_id: str = Field(min_length=1, max_length=96)
    title: str = Field(min_length=1, max_length=120)
    conclusion: str = Field(min_length=1, max_length=2000)
    solution: TargetSolution | None = None
    steps: list[str] = Field(default_factory=list, max_length=8)
    verification: list[LearningVerification] = Field(default_factory=list, max_length=20)
    source_refs: list[LearningSourceRef] = Field(default_factory=list, max_length=40)
    scope: dict[str, Any] = Field(default_factory=dict)
    limitations: list[str] = Field(default_factory=list, max_length=20)
    next_actions: list[str] = Field(default_factory=list, max_length=10)
    input_hash: str = Field(min_length=8, max_length=64)
    request_hash: str = Field(min_length=8, max_length=64)
    task_id: str = Field(default="", max_length=96)
    result_kind: Literal["explanation", "experiment", "target"]
    stale: bool = False


class LearningReply(StrictModel):
    reply_id: str = Field(min_length=1, max_length=96)
    material_id: str = Field(min_length=1, max_length=96)
    page_no: int = Field(ge=1, le=500)
    node_id: str = Field(min_length=1, max_length=96)
    branch_id: str = Field(min_length=1, max_length=96)
    client_request_id: str = Field(min_length=1, max_length=100)
    draft_revision: int = Field(ge=0)
    input_hash: str = Field(min_length=8, max_length=64)
    request_hash: str = Field(min_length=8, max_length=64)
    state: LearningReplyState
    answer_card: LearningResultCard | None = None
    clarification: str = Field(default="", max_length=1000)
    action_draft: LearningActionDraft | None = None
    task_id: str = Field(default="", max_length=96)


class LearningPractice(StrictModel):
    practice_id: str = Field(min_length=1, max_length=96)
    branch_id: str = Field(min_length=1, max_length=96)
    title: str = Field(min_length=1, max_length=200)
    bundle_id: str = Field(min_length=1, max_length=96)
    node_id: str = Field(default="", max_length=96)
    page_no: int = Field(default=0, ge=0, le=500)
    revision: int = Field(ge=1)
    values: CanonicalValues = Field(default_factory=dict)
    context_input_hash: str = Field(default="", max_length=64)
    created_at: str = Field(min_length=10, max_length=32)
    updated_at: str = Field(min_length=10, max_length=32)
    branch_state: dict[str, Any] = Field(default_factory=dict)


class LearningPublishSelection(StrictModel):
    mode: Literal["baseline", "practice", "original_only"]
    bundle_id: str | None = Field(default=None, max_length=96)
    expected_bundle_revision: int | None = Field(default=None, ge=1)
    branch_id: str | None = Field(default=None, max_length=96)
    expected_branch_revision: int | None = Field(default=None, ge=1)
    expected_document_revision: int | None = Field(default=None, ge=0)
    selected_learning_item_ids: list[str] = Field(default_factory=list, max_length=200)
    selected_experiment_ids: list[str] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def _selection_consistent(self) -> "LearningPublishSelection":
        if self.mode == "original_only":
            if self.bundle_id or self.branch_id:
                raise ValueError("original_only 不选择 bundle/branch")
            return self
        if not self.bundle_id or not self.branch_id:
            raise ValueError("baseline/practice 必须明确选择 bundle 与 branch")
        if self.expected_branch_revision is None:
            raise ValueError("发布学习内容必须携带 expected_branch_revision")
        return self


__all__ = [
    "LEARNING_CONTRACT_VERSION",
    "LearningActionDraft",
    "LearningActionKind",
    "LearningCapabilities",
    "LearningCondition",
    "LearningContext",
    "LearningControl",
    "LearningDescriptor",
    "LearningGoal",
    "LearningItem",
    "LearningPage",
    "LearningPractice",
    "LearningPublishSelection",
    "LearningReply",
    "LearningReplyState",
    "LearningResultCard",
    "LearningReviewItem",
    "LearningSourceRef",
    "LearningState",
    "LearningSuggestedAction",
    "LearningTemplate",
    "LearningVerification",
]

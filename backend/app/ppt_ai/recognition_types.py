"""识别与模板匹配的内部契约（``ppt-ai.conditions.1`` / ``ppt-ai.match.1``）。

这些类型不进入公开的 ``ppt-ai.1`` 执行契约；它们是规则、模型与程序裁决之间的
版本化诊断层。最终可执行内容仍由 ``InteractionPlan`` / ``InteractionBundle`` 承载。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, model_validator

from .types import CanonicalValue, SourceAnchor, StrictModel

CONDITION_CONTRACT_VERSION = "ppt-ai.conditions.1"
TEMPLATE_CONTRACT_VERSION = "ppt-ai.template.1"
MATCH_CONTRACT_VERSION = "ppt-ai.match.1"

VariableRole = Literal[
    "independent", "dependent", "parameter", "constant", "state", "output",
    "control", "index", "unknown",
]
MatchStatus = Literal["supported", "needs_review", "explanation_only", "unsupported"]
RecallKind = Literal["rule", "semantic", "model", "fallback"]


class ConditionItem(StrictModel):
    """一条可追溯条件；原始值、规范化值与来源摘录分开保存。"""

    condition_id: str = Field(min_length=1, max_length=96)
    kind: Literal[
        "value", "formula", "interval", "number_list", "number_matrix",
        "operations", "assumption", "text",
    ] = "value"
    key: str = Field(default="", max_length=120)
    label: str = Field(default="", max_length=120)
    raw_value: Any = None
    value: CanonicalValue | None = None
    unit: str = Field(default="", max_length=32)
    normalized_unit: str = Field(default="", max_length=32)
    normalized_value: CanonicalValue | None = None
    origin_type: Literal["native", "ocr", "model_inference", "user_input", "supplement", "teaching"] = "native"
    excerpt: str = Field(default="", max_length=500)
    source: SourceAnchor
    confidence: float = Field(default=1.0, ge=0, le=1)
    roles: list[VariableRole] = Field(default_factory=list, max_length=8)
    shape: list[int] = Field(default_factory=list, max_length=4)
    note: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def _has_value_or_text(self) -> "ConditionItem":
        if self.value is None and not self.excerpt.strip():
            raise ValueError("条件必须包含 value 或 excerpt")
        return self


class VariableBinding(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    role: VariableRole = "unknown"
    type: str = Field(default="number", max_length=24)
    unit: str = Field(default="", max_length=32)
    condition_id: str | None = Field(default=None, max_length=96)
    note: str = Field(default="", max_length=500)


class ConditionUncertainty(StrictModel):
    code: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=500)
    severity: Literal["info", "warn", "blocking"] = "warn"
    condition_id: str | None = Field(default=None, max_length=96)


class ConditionSet(StrictModel):
    """一个区域的统一条件集合；匹配器只依赖此接口。"""

    contract_version: Literal["ppt-ai.conditions.1"] = CONDITION_CONTRACT_VERSION
    region_id: str = Field(min_length=1, max_length=96)
    page_no: int = Field(ge=1, le=500)
    category: str = Field(default="", max_length=48)
    text: str = Field(default="", max_length=8000)
    formula: str = Field(default="", max_length=4000)
    conditions: list[ConditionItem] = Field(default_factory=list, max_length=200)
    variables: list[VariableBinding] = Field(default_factory=list, max_length=100)
    assumptions: list[str] = Field(default_factory=list, max_length=40)
    uncertainties: list[ConditionUncertainty] = Field(default_factory=list, max_length=100)
    source_hash: str = Field(min_length=8, max_length=64)
    condition_hash: str = Field(default="", max_length=64)

    def values(self) -> dict[str, CanonicalValue]:
        """规范化值优先；同 key 后出现的条件不覆盖先出现的 native 条件。"""
        result: dict[str, CanonicalValue] = {}
        for condition in self.conditions:
            if not condition.key:
                continue
            value = condition.normalized_value if condition.normalized_value is not None else condition.value
            if value is None:
                continue
            if condition.key not in result or condition.origin_type == "native":
                result[condition.key] = value
        return result

    def by_key(self) -> dict[str, ConditionItem]:
        result: dict[str, ConditionItem] = {}
        for condition in self.conditions:
            if condition.key and (condition.key not in result or condition.origin_type == "native"):
                result[condition.key] = condition
        return result

    def blocking(self) -> list[ConditionUncertainty]:
        return [item for item in self.uncertainties if item.severity == "blocking"]


class TemplateRef(StrictModel):
    id: str = Field(min_length=1, max_length=96)
    version: str = Field(min_length=1, max_length=24)
    adapter_version: str = Field(default="1", min_length=1, max_length=24)

    def as_dict(self) -> dict[str, str]:
        return {"id": self.id, "version": self.version, "adapter_version": self.adapter_version}


class TemplateParameterSpec(StrictModel):
    name: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    label: str = Field(min_length=1, max_length=80)
    type: Literal[
        "number", "integer", "boolean", "string", "enum",
        "number_list", "number_matrix", "matrix2", "vector2",
    ] = "number"
    unit: str = Field(default="", max_length=32)
    required: bool = True
    default: CanonicalValue | None = None
    min: float | None = None
    max: float | None = None
    step: float | None = None
    options: list[str] = Field(default_factory=list, max_length=100)
    source_keys: list[str] = Field(default_factory=list, max_length=20)
    roles: list[VariableRole] = Field(default_factory=list, max_length=8)
    shape: list[int] = Field(default_factory=list, max_length=4)
    needs_review_on_default: bool = True
    description: str = Field(default="", max_length=300)

    @model_validator(mode="after")
    def _default_for_type(self) -> "TemplateParameterSpec":
        if self.type in ("number", "integer"):
            if self.type == "integer":
                if self.default is not None and (isinstance(self.default, bool) or not isinstance(self.default, (int, float))):
                    raise ValueError("整数参数默认值必须是数值")
            elif self.default is not None and (isinstance(self.default, bool) or not isinstance(self.default, (int, float))):
                raise ValueError("数值参数默认值必须是数值")
        if self.type == "enum" and self.default is not None and self.options and str(self.default) not in self.options:
            raise ValueError("枚举默认值不在 options 中")
        return self


class TemplateDescriptor(StrictModel):
    template_id: str = Field(pattern=r"^[a-z][a-z0-9_.]{2,95}$")
    version: str = Field(default="1.0", min_length=1, max_length=24)
    adapter_version: str = Field(default="1", min_length=1, max_length=24)
    operator_id: str = Field(min_length=1, max_length=96)
    renderer: str = Field(default="generic", min_length=1, max_length=48)
    title: str = Field(min_length=1, max_length=120)
    categories: tuple[str, ...] = Field(min_length=1)
    description: str = Field(default="", max_length=1000)
    aliases: tuple[str, ...] = Field(default_factory=tuple)
    keywords: tuple[str, ...] = Field(default_factory=tuple)
    formula_patterns: tuple[str, ...] = Field(default_factory=tuple)
    negative_keywords: tuple[str, ...] = Field(default_factory=tuple)
    required_conditions: tuple[str, ...] = Field(default_factory=tuple)
    optional_conditions: tuple[str, ...] = Field(default_factory=tuple)
    parameter_specs: tuple[TemplateParameterSpec, ...] = Field(default_factory=tuple)
    views: tuple[tuple[str, str], ...] = Field(default_factory=tuple)
    offline_supported: bool = True
    min_runtime_version: str = Field(default="ppt-ai.1", min_length=1, max_length=32)
    examples: tuple[str, ...] = Field(default_factory=tuple)
    eval_cases: tuple[str, ...] = Field(default_factory=tuple)
    legacy_builder: bool = False
    pilot: bool = True

    @property
    def ref(self) -> TemplateRef:
        return TemplateRef(id=self.template_id, version=self.version, adapter_version=self.adapter_version)


class MatchCandidate(StrictModel):
    template_ref: TemplateRef
    score: float = Field(ge=0, le=1)
    recalls: list[RecallKind] = Field(default_factory=list, max_length=4)
    reasons: list[str] = Field(default_factory=list, max_length=20)
    missing: list[str] = Field(default_factory=list, max_length=40)
    conflicts: list[str] = Field(default_factory=list, max_length=40)
    strong_rule: bool = False


class ModelParameterProposal(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    value: Any = None
    source_condition_id: str | None = Field(default=None, max_length=96)
    origin_type: Literal["native", "ocr", "model_inference", "user_input", "supplement", "teaching"] = "model_inference"
    note: str = Field(default="", max_length=300)


class ModelCandidateProposal(StrictModel):
    template_ref: TemplateRef
    parameters: list[ModelParameterProposal] = Field(default_factory=list, max_length=40)
    missing: list[str] = Field(default_factory=list, max_length=40)
    conflicts: list[str] = Field(default_factory=list, max_length=40)
    rationale: str = Field(default="", max_length=1000)
    confidence: float = Field(default=0.5, ge=0, le=1)


class ModelProposal(StrictModel):
    region_id: str = Field(min_length=1, max_length=96)
    abstain: bool = False
    candidates: list[ModelCandidateProposal] = Field(default_factory=list, max_length=5)
    reason: str = Field(default="", max_length=500)


class MatchDecision(StrictModel):
    region_id: str = Field(min_length=1, max_length=96)
    status: MatchStatus
    template_ref: TemplateRef | None = None
    condition_hash: str = Field(default="", max_length=64)
    parameters: dict[str, Any] = Field(default_factory=dict)
    origin_types: dict[str, str] = Field(default_factory=dict)
    condition_ids: list[str] = Field(default_factory=list, max_length=40)
    missing: list[str] = Field(default_factory=list, max_length=40)
    conflicts: list[str] = Field(default_factory=list, max_length=40)
    candidates: list[MatchCandidate] = Field(default_factory=list, max_length=10)
    model_used: bool = False
    reason: str = Field(default="", max_length=1000)
    rule_strong: bool = False

    def template_ref_dict(self) -> dict[str, str] | None:
        return self.template_ref.as_dict() if self.template_ref is not None else None


__all__ = [
    "CONDITION_CONTRACT_VERSION",
    "MATCH_CONTRACT_VERSION",
    "TEMPLATE_CONTRACT_VERSION",
    "ConditionItem",
    "ConditionSet",
    "ConditionUncertainty",
    "MatchCandidate",
    "MatchDecision",
    "ModelCandidateProposal",
    "ModelParameterProposal",
    "ModelProposal",
    "TemplateDescriptor",
    "TemplateParameterSpec",
    "TemplateRef",
    "VariableBinding",
]

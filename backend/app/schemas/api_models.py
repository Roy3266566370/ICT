"""``C-API@1`` 请求/响应模型的 Pydantic v2 实现（plan §2.2.7）。

与 ``contracts/openapi.yaml`` 的 ``components/schemas`` 逐字对应，字段名全部 snake_case，
全部 ``extra="forbid"``；``request_id`` 不在业务模型内（它在响应顶层，见 ``schemas/common.py``）。

本文件只放"传输形状"，不放业务逻辑；材料/任务/示例的装配在 ``app.api.routes_*``。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .errors import ErrorCode
from .knowledge_object import KnowledgeObject, TemplateId
from .run import RunSnapshot, ValidationReport

#: 材料对外状态（§2.2.7 MaterialStatus）。
MaterialStatus = Literal["processing", "awaiting_confirmation", "ready", "failed"]
#: 任务种类（§2.2.7 JobStatus.kind）。
JobKind = Literal["upload", "compile", "validate"]
#: 任务阶段（§2.2.7 JobStage），顺序即状态机顺序（R3-AC3）。
JobStage = Literal[
    "queued",
    "parsing",
    "rendering",
    "extracting",
    "awaiting_confirmation",
    "compiling",
    "validating",
    "ready",
    "failed",
]
#: 任务阶段的有序集合（不含 ``failed``，失败可从任意阶段进入）。
JOB_STAGE_ORDER: tuple[str, ...] = (
    "queued",
    "parsing",
    "rendering",
    "extracting",
    "awaiting_confirmation",
    "compiling",
    "validating",
    "ready",
)
#: 前端轮询终止阶段（R3-AC5）。
TERMINAL_STAGES: frozenset[str] = frozenset({"ready", "failed"})
#: 候选对象的置信度提示（§2.2.7 CandidateObject）。
ConfidenceHint = Literal["low", "medium"]
#: 候选字段状态（§2.2.7 CandidateObject.fields）。
CandidateFieldStatus = Literal["present", "missing", "inferred"]
#: 幻灯片元素类型（§2.2.7 SlideElement）。
ElementKind = Literal["text", "picture", "shape", "chart", "table", "group"]


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, protected_namespaces=())


# ---------------------------------------------------------------------------
# 会话与模板
# ---------------------------------------------------------------------------


class SessionInfo(_StrictModel):
    """端点 #1/#2 的响应体；``csrf_token`` 只经响应体下发，写请求回传到 ``X-CSRF-Token``。"""

    session_id: str = Field(min_length=1)
    expires_at: str = Field(min_length=1)
    csrf_token: str = Field(min_length=1)
    retention_hours: int = Field(ge=1)


class TemplateDescriptor(_StrictModel):
    """端点 #3 的元素：四个白名单模板各一条（R12-AC3）。"""

    template_id: TemplateId
    name: str = Field(min_length=1)
    scenario_slug: Literal["matrix", "force", "bfs", "budget"]
    kernel_version: Literal["linear_v1", "force_v1", "bfs_v1", "budget_v1"]
    validation_profile: str = Field(min_length=1)
    example_id: str = Field(min_length=1)
    limits: dict[str, str]
    schema_path: str


# ---------------------------------------------------------------------------
# 材料与页面
# ---------------------------------------------------------------------------


class MaterialSummary(_StrictModel):
    """材料列表项（端点 #6/#7 共用）。"""

    material_id: str = Field(min_length=1)
    title: str
    status: MaterialStatus
    page_count: int = Field(ge=0)
    created_at: str
    expires_at: str
    object_count: int = Field(ge=0)
    #: P1 可选追加（向后兼容）：材料最终确认的知识对象模板；未确定时省略该键。
    template_id: TemplateId | None = None
    #: P1 可选追加（向后兼容）：该材料下运行快照总数；未统计时省略该键。
    run_count: int | None = Field(default=None, ge=0)


class MaterialList(_StrictModel):
    """端点 #6 的响应体。"""

    items: list[MaterialSummary]
    retention_expires_at: str


class BboxPayload(_StrictModel):
    """元素外接框（EMU 绝对坐标）。"""

    x: float
    y: float
    w: float
    h: float


class SlideElement(_StrictModel):
    """页内元素；``asset_id`` 非空时前端经受鉴权端点取图（R4-AC2）。"""

    element_id: str = Field(min_length=1)
    kind: ElementKind
    name: str
    bbox: BboxPayload
    text: str | None
    asset_id: str | None


class SlidePage(_StrictModel):
    """单页结构化还原（首版不做整页位图，见 D1）。"""

    page_no: int = Field(ge=1)
    title: str
    paragraphs: list[str]
    elements: list[SlideElement]
    excerpt: str
    #: §2.2.7 的 TS 声明为 ``string | null``，因此这里允许 None（契约缺口见回报）。
    image_url: str | None
    #: 整页图字节数，前端用作缩略图/整页图的不可变缓存版本（``?v=``）。
    render_bytes: int | None = None
    width: float = 12192000
    height: float = 6858000


class CandidateField(_StrictModel):
    """候选对象的一个字段及其来源状态。"""

    parameter_id: str = Field(min_length=1)
    name: str
    status: CandidateFieldStatus


class CandidateObject(_StrictModel):
    """规则化候选对象（``provenance=inferred``，§2.2.10 ``map_candidates``）。"""

    candidate_id: str = Field(min_length=1)
    template_id: TemplateId
    confidence_hint: ConfidenceHint
    fields: list[CandidateField]


# ---------------------------------------------------------------------------
# 任务
# ---------------------------------------------------------------------------


class JobError(_StrictModel):
    """失败任务记录的 ``code`` / ``message``（不含堆栈，R12-AC5）。"""

    code: ErrorCode
    message: str


class JobStatus(_StrictModel):
    """端点 #10/#11 的任务事实；``rendering`` 阶段 ``progress_pct`` 必须为 null。"""

    job_id: str = Field(min_length=1)
    material_id: str = Field(min_length=1)
    kind: JobKind
    stage: JobStage
    attempt: int = Field(ge=1)
    #: schema 中属 required（值可为 null）：rendering 阶段必须显式为 null。
    progress_pct: int | None = Field(ge=0, le=100)
    error: JobError | None
    updated_at: str


# ---------------------------------------------------------------------------
# 材料详情
# ---------------------------------------------------------------------------


class MaterialDetail(_StrictModel):
    """端点 #7：``awaiting_confirmation`` 阶段返回原文与候选对象（R3-AC6）。"""

    material: MaterialSummary
    slides: list[SlidePage]
    objects: list[KnowledgeObject]
    candidates: list[CandidateObject]
    job: JobStatus | None


# ---------------------------------------------------------------------------
# 端点级请求/响应体
# ---------------------------------------------------------------------------


class CloneResult(_StrictModel):
    """端点 #4：示例克隆结果。"""

    material_id: str = Field(min_length=1)
    object_id: str = Field(min_length=1)


class UploadAccepted(_StrictModel):
    """端点 #5：已受理，任务排队中。"""

    material_id: str = Field(min_length=1)
    job_id: str = Field(min_length=1)


class RetryAccepted(_StrictModel):
    """端点 #11：重试后的新 attempt。"""

    job_id: str = Field(min_length=1)
    attempt: int = Field(ge=1)


class CompileAccepted(_StrictModel):
    """端点 #14：编译任务已受理（T10 使用）。"""

    job_id: str = Field(min_length=1)


class ObjectEnvelope(_StrictModel):
    """端点 #13：``{"object": KnowledgeObject}``。"""

    object: KnowledgeObject


class ObjectWithChecks(_StrictModel):
    """端点 #12：对象与其最新校验报告。"""

    object: KnowledgeObject
    checks_summary: ValidationReport | None


class RunList(_StrictModel):
    """端点 #16：历史运行列表。"""

    items: list[RunSnapshot]


class CheckList(_StrictModel):
    """端点 #19：历史校验报告列表。"""

    items: list[ValidationReport]


class PutModelRequest(_StrictModel):
    """端点 #13 请求体；``expected_version`` 与库中不一致 → ``VERSION_CONFLICT``。"""

    expected_version: int = Field(ge=1)
    object: KnowledgeObject


class CompileRequest(_StrictModel):
    """端点 #14 请求体。"""

    model_version: int = Field(ge=1)


class CreateRunRequest(_StrictModel):
    """端点 #15 请求体；``result`` 仅为对比入参，服务端必定重算覆盖。"""

    model_version: int = Field(ge=1)
    revision: int = Field(ge=0)
    input_snapshot: KnowledgeObject
    result: Any | None = None


class ValidateRequest(_StrictModel):
    """端点 #18 请求体。"""

    model_version: int = Field(ge=1)
    revision: int = Field(ge=0)


__all__ = [
    "BboxPayload",
    "CandidateField",
    "CandidateObject",
    "CheckList",
    "CloneResult",
    "CompileAccepted",
    "CompileRequest",
    "ConfidenceHint",
    "CreateRunRequest",
    "ElementKind",
    "JOB_STAGE_ORDER",
    "JobError",
    "JobKind",
    "JobStage",
    "JobStatus",
    "MaterialDetail",
    "MaterialList",
    "MaterialStatus",
    "MaterialSummary",
    "ObjectEnvelope",
    "ObjectWithChecks",
    "PutModelRequest",
    "RetryAccepted",
    "RunList",
    "SessionInfo",
    "SlideElement",
    "SlidePage",
    "TERMINAL_STAGES",
    "TemplateDescriptor",
    "UploadAccepted",
    "ValidateRequest",
]

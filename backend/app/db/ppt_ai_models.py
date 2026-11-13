"""PPT AI 七张表的 ORM 模型（``ppt-ai.1``）。

设计要点：

- 内容文档（plan / bundle / branch / experiment / artifact / report）整体存 JSON，
  由 ``app.ppt_ai.types`` 与 ``contracts/ppt-ai`` 校验，不在 SQL 层重复建模。
- ``ppt_ai_tasks`` 是**持久任务事实**：租约、幂等键、输入哈希与错误都落库，
  重启后可由独立 worker 继续推进；GET 接口不会触发模型调用。
- 材料/会话归属通过现有 ``owned_material`` 校验，不信任请求体自报的 owner。
- 时间沿用项目约定：ISO 8601 UTC 字符串。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .account_models import MYSQL_TABLE_OPTIONS
from .base import Base

ID_LENGTH = 64
TIMESTAMP_LENGTH = 32


class PptAiTaskRecord(Base):
    __tablename__ = "ppt_ai_tasks"
    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "material_id",
            "kind",
            "operation_id",
            name="uq_ppt_ai_tasks_operation",
        ),
        Index("ix_ppt_ai_tasks_material_created", "material_id", "created_at"),
        Index("ix_ppt_ai_tasks_status_lease", "status", "lease_expires_at"),
        MYSQL_TABLE_OPTIONS,
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    material_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("materials.id"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    stage: Mapped[str] = mapped_column(String(64), nullable=False, default="queued")
    operation_id: Mapped[str] = mapped_column(String(100), nullable=False)
    input_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    input_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    budget_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    lease_expires_at: Mapped[str | None] = mapped_column(String(TIMESTAMP_LENGTH), nullable=True)
    heartbeat_at: Mapped[str | None] = mapped_column(String(TIMESTAMP_LENGTH), nullable=True)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)


class PptAiPlanRecord(Base):
    __tablename__ = "ppt_ai_plans"
    __table_args__ = (
        Index("ix_ppt_ai_plans_material_created", "material_id", "created_at"),
        MYSQL_TABLE_OPTIONS,
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    material_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("materials.id"), nullable=False
    )
    plan_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    source_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    document: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)


class PptAiBundleRecord(Base):
    __tablename__ = "ppt_ai_bundles"
    __table_args__ = (
        UniqueConstraint(
            "material_id", "bundle_revision", name="uq_ppt_ai_bundles_material_revision"
        ),
        Index("ix_ppt_ai_bundles_material_created", "material_id", "created_at"),
        MYSQL_TABLE_OPTIONS,
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    material_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("materials.id"), nullable=False
    )
    bundle_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    schema_version: Mapped[str] = mapped_column(String(24), nullable=False, default="ppt-ai.1")
    source_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    registry_version: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    document: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)


class PptAiBranchRecord(Base):
    __tablename__ = "ppt_ai_branches"
    __table_args__ = (
        Index("ix_ppt_ai_branches_bundle_created", "bundle_id", "created_at"),
        Index("ix_ppt_ai_branches_material", "material_id"),
        MYSQL_TABLE_OPTIONS,
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    material_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("materials.id"), nullable=False
    )
    bundle_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("ppt_ai_bundles.id"), nullable=False
    )
    parent_branch_id: Mapped[str | None] = mapped_column(String(ID_LENGTH), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="candidate")
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    canonical_values: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    overrides_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    evaluation: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    learning_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    applied_operations: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)


class PptAiExperimentRecord(Base):
    __tablename__ = "ppt_ai_experiments"
    __table_args__ = (
        Index("ix_ppt_ai_experiments_bundle_created", "bundle_id", "created_at"),
        Index("ix_ppt_ai_experiments_material", "material_id"),
        MYSQL_TABLE_OPTIONS,
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    material_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("materials.id"), nullable=False
    )
    bundle_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("ppt_ai_bundles.id"), nullable=False
    )
    branch_id: Mapped[str | None] = mapped_column(String(ID_LENGTH), nullable=True)
    parent_branch_id: Mapped[str | None] = mapped_column(String(ID_LENGTH), nullable=True)
    question: Mapped[str] = mapped_column(Text, nullable=False, default="")
    recipe_id: Mapped[str] = mapped_column(String(24), nullable=False, default="sensitivity")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    draft: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    result_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)


class PptAiArtifactRecord(Base):
    __tablename__ = "ppt_ai_artifacts"
    __table_args__ = (
        Index("ix_ppt_ai_artifacts_bundle_created", "bundle_id", "created_at"),
        Index("ix_ppt_ai_artifacts_material", "material_id"),
        MYSQL_TABLE_OPTIONS,
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    material_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("materials.id"), nullable=False
    )
    bundle_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("ppt_ai_bundles.id"), nullable=False
    )
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    view_contract_version: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    program: Mapped[str] = mapped_column(Text, nullable=False, default="")
    ast: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    resources: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    supported_interactions: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    offline_supported: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    acceptance_status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    isolation: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)


class PptAiValidationReportRecord(Base):
    __tablename__ = "ppt_ai_validation_reports"
    __table_args__ = (
        Index("ix_ppt_ai_reports_bundle_created", "bundle_id", "created_at"),
        Index("ix_ppt_ai_reports_material", "material_id"),
        MYSQL_TABLE_OPTIONS,
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    material_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("materials.id"), nullable=False
    )
    bundle_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("ppt_ai_bundles.id"), nullable=False
    )
    branch_id: Mapped[str | None] = mapped_column(String(ID_LENGTH), nullable=True)
    artifact_id: Mapped[str | None] = mapped_column(String(ID_LENGTH), nullable=True)
    bundle_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    branch_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    kernel_version: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    runtime_version: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="needs_review")
    report: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    stale: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)


PPT_AI_TABLE_NAMES: tuple[str, ...] = (
    "ppt_ai_tasks",
    "ppt_ai_plans",
    "ppt_ai_bundles",
    "ppt_ai_branches",
    "ppt_ai_experiments",
    "ppt_ai_artifacts",
    "ppt_ai_validation_reports",
)

__all__ = [
    "PPT_AI_TABLE_NAMES",
    "PptAiArtifactRecord",
    "PptAiBranchRecord",
    "PptAiBundleRecord",
    "PptAiExperimentRecord",
    "PptAiPlanRecord",
    "PptAiTaskRecord",
    "PptAiValidationReportRecord",
]

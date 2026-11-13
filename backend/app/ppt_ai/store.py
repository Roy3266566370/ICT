"""PPT AI 持久化读写（所有权校验在这里统一完成）。"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..db.ppt_ai_models import (
    PptAiArtifactRecord,
    PptAiBranchRecord,
    PptAiBundleRecord,
    PptAiExperimentRecord,
    PptAiPlanRecord,
    PptAiTaskRecord,
    PptAiValidationReportRecord,
)
from ..schemas.errors import resource_unavailable
from .types import (
    Experiment,
    ExperimentDraft,
    ExperimentResult,
    GeneratedViewArtifact,
    InteractionBundle,
    InteractionPlan,
    PptAITask,
    ValidationReport,
)
from .util import now_iso

# ---------------------------------------------------------------------------
# 规划
# ---------------------------------------------------------------------------


def save_plan(
    db: Session, *, session_id: str, material_id: str, plan: InteractionPlan
) -> PptAiPlanRecord:
    row = PptAiPlanRecord(
        id=plan.plan_id,
        session_id=session_id,
        material_id=material_id,
        plan_revision=plan.plan_revision,
        source_revision=plan.source_revision,
        source_hash=plan.source_hash,
        document=plan.model_dump(mode="json"),
        created_at=now_iso(),
    )
    db.add(row)
    db.flush()
    return row


def get_plan(
    db: Session, plan_id: str, session_id: str, material_id: str
) -> PptAiPlanRecord:
    row = db.get(PptAiPlanRecord, plan_id)
    if row is None or row.session_id != session_id or row.material_id != material_id:
        raise resource_unavailable()
    return row


def plan_from_row(row: PptAiPlanRecord) -> InteractionPlan:
    return InteractionPlan.model_validate(row.document)


# ---------------------------------------------------------------------------
# Bundle
# ---------------------------------------------------------------------------


def save_bundle(
    db: Session,
    *,
    session_id: str,
    material_id: str,
    bundle: InteractionBundle,
) -> PptAiBundleRecord:
    previous = db.scalars(
        select(PptAiBundleRecord).where(
            PptAiBundleRecord.material_id == material_id,
            PptAiBundleRecord.session_id == session_id,
            PptAiBundleRecord.status == "active",
        )
    ).all()
    for item in previous:
        item.status = "superseded"
    row = PptAiBundleRecord(
        id=bundle.bundle_id,
        session_id=session_id,
        material_id=material_id,
        bundle_revision=bundle.bundle_revision,
        schema_version=bundle.schema_version,
        source_revision=bundle.source_revision,
        source_hash=bundle.source_hash,
        registry_version=bundle.registry_version,
        content_hash=bundle.content_hash,
        status=bundle.status,
        document=bundle.model_dump(mode="json"),
        created_at=bundle.created_at,
    )
    db.add(row)
    db.flush()
    return row


def get_bundle(
    db: Session,
    bundle_id: str,
    session_id: str | None = None,
    material_id: str | None = None,
) -> InteractionBundle:
    row = db.get(PptAiBundleRecord, bundle_id)
    if row is None:
        raise resource_unavailable()
    if session_id is not None and row.session_id != session_id:
        raise resource_unavailable()
    if material_id is not None and row.material_id != material_id:
        raise resource_unavailable()
    return InteractionBundle.model_validate(row.document)


def get_bundle_row(
    db: Session, bundle_id: str, session_id: str, material_id: str
) -> PptAiBundleRecord:
    row = db.get(PptAiBundleRecord, bundle_id)
    if row is None or row.session_id != session_id or row.material_id != material_id:
        raise resource_unavailable()
    return row


def latest_bundle_row(
    db: Session, session_id: str, material_id: str
) -> PptAiBundleRecord | None:
    return db.scalar(
        select(PptAiBundleRecord)
        .where(
            PptAiBundleRecord.session_id == session_id,
            PptAiBundleRecord.material_id == material_id,
            PptAiBundleRecord.status == "active",
        )
        .order_by(PptAiBundleRecord.created_at.desc(), PptAiBundleRecord.bundle_revision.desc())
        .limit(1)
    )


def latest_bundle(db: Session, session_id: str, material_id: str) -> InteractionBundle | None:
    row = latest_bundle_row(db, session_id, material_id)
    return InteractionBundle.model_validate(row.document) if row is not None else None


def reactivate_bundle(
    db: Session, *, session_id: str, material_id: str, bundle_id: str
) -> PptAiBundleRecord:
    """把一个历史 bundle 重新设为唯一活跃版本（撤销后续的关联决策）。

    bundle 本身不可变；回退只改状态位。分支不跟随迁移：新 bundle 上创建的分支
    保留在原 bundle 上，回退后从总览不可达（与回退语义一致）。
    """

    row = db.get(PptAiBundleRecord, bundle_id)
    if row is None or row.session_id != session_id or row.material_id != material_id:
        raise resource_unavailable()
    active_rows = db.scalars(
        select(PptAiBundleRecord).where(
            PptAiBundleRecord.session_id == session_id,
            PptAiBundleRecord.material_id == material_id,
            PptAiBundleRecord.status == "active",
        )
    ).all()
    for item in active_rows:
        item.status = "superseded"
    if row.status != "active":
        row.status = "active"
    db.flush()
    return row


def repoint_branch_bundle(
    db: Session, *, session_id: str, material_id: str, from_bundle_id: str, to_bundle_id: str
) -> int:
    """仅记录拒绝/拆分时把旧 bundle 的分支挂到新 bundle 上。

    compiled 载荷完全一致，分支的求值快照与 revision 仍然有效；
    不重建分支 = 不丢用户已调的参数值。
    """

    rows = db.scalars(
        select(PptAiBranchRecord).where(
            PptAiBranchRecord.bundle_id == from_bundle_id,
            PptAiBranchRecord.session_id == session_id,
            PptAiBranchRecord.material_id == material_id,
        )
    ).all()
    for row in rows:
        row.bundle_id = to_bundle_id
    db.flush()
    return len(rows)


def list_bundles(db: Session, session_id: str, material_id: str) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(PptAiBundleRecord)
        .where(
            PptAiBundleRecord.session_id == session_id,
            PptAiBundleRecord.material_id == material_id,
        )
        .order_by(PptAiBundleRecord.created_at.desc())
        .limit(20)
    ).all()
    result = []
    for row in rows:
        document = row.document if isinstance(row.document, Mapping) else {}
        compiled = document.get("compiled") if isinstance(document.get("compiled"), Mapping) else {}
        result.append(
            {
                "bundle_id": row.id,
                "bundle_revision": row.bundle_revision,
                "status": row.status,
                "source_revision": row.source_revision,
                "source_hash": row.source_hash,
                "content_hash": row.content_hash,
                "created_at": row.created_at,
                "node_count": len(compiled.get("nodes", [])) if isinstance(compiled.get("nodes"), list) else 0,
            }
        )
    return result


# ---------------------------------------------------------------------------
# 分支
# ---------------------------------------------------------------------------


def get_branch_row(
    db: Session, branch_id: str, session_id: str, material_id: str
) -> PptAiBranchRecord:
    row = db.get(PptAiBranchRecord, branch_id)
    if row is None or row.session_id != session_id or row.material_id != material_id:
        raise resource_unavailable()
    return row


def latest_branch_row(
    db: Session, bundle_id: str, session_id: str, material_id: str
) -> PptAiBranchRecord | None:
    return db.scalar(
        select(PptAiBranchRecord)
        .where(
            PptAiBranchRecord.bundle_id == bundle_id,
            PptAiBranchRecord.session_id == session_id,
            PptAiBranchRecord.material_id == material_id,
            PptAiBranchRecord.status == "active",
        )
        .order_by(PptAiBranchRecord.created_at.asc())
        .limit(1)
    )


def baseline_branch_row(
    db: Session, bundle_id: str, session_id: str, material_id: str
) -> PptAiBranchRecord | None:
    """课件基准：优先显式 ``kind=baseline``，旧数据退回最早的活动根分支。

    不取「最后创建的任意分支」：练习/候选探索不能成为阅读和发布基准。
    """

    row = db.scalar(
        select(PptAiBranchRecord)
        .where(
            PptAiBranchRecord.bundle_id == bundle_id,
            PptAiBranchRecord.session_id == session_id,
            PptAiBranchRecord.material_id == material_id,
            PptAiBranchRecord.kind == "baseline",
        )
        .order_by(PptAiBranchRecord.created_at.asc())
        .limit(1)
    )
    if row is not None:
        return row
    return latest_branch_row(db, bundle_id, session_id, material_id)


def list_practice_branches(
    db: Session, session_id: str, material_id: str, *, bundle_id: str | None = None
) -> list[PptAiBranchRecord]:
    conditions = [
        PptAiBranchRecord.session_id == session_id,
        PptAiBranchRecord.material_id == material_id,
        PptAiBranchRecord.kind == "practice",
    ]
    if bundle_id:
        conditions.append(PptAiBranchRecord.bundle_id == bundle_id)
    return list(
        db.scalars(
            select(PptAiBranchRecord)
            .where(*conditions)
            .order_by(PptAiBranchRecord.updated_at.desc())
            .limit(100)
        ).all()
    )


def list_branches(
    db: Session, bundle_id: str, session_id: str, material_id: str
) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(PptAiBranchRecord)
        .where(
            PptAiBranchRecord.bundle_id == bundle_id,
            PptAiBranchRecord.session_id == session_id,
            PptAiBranchRecord.material_id == material_id,
        )
        .order_by(PptAiBranchRecord.created_at.asc())
    ).all()
    return [
        {
            "branch_id": row.id,
            "bundle_id": row.bundle_id,
            "revision": row.revision,
            "status": row.status,
            "kind": getattr(row, "kind", "candidate") or "candidate",
            "title": getattr(row, "title", "") or "",
            "parent_branch_id": row.parent_branch_id,
            "updated_at": row.updated_at,
            "evaluation_hash": (row.evaluation or {}).get("evaluation_hash")
            if isinstance(row.evaluation, Mapping)
            else None,
        }
        for row in rows
    ]


# ---------------------------------------------------------------------------
# 实验
# ---------------------------------------------------------------------------


def save_experiment(
    db: Session,
    *,
    session_id: str,
    material_id: str,
    experiment: Experiment,
) -> PptAiExperimentRecord:
    existing = db.get(PptAiExperimentRecord, experiment.experiment_id)
    if existing is not None:
        existing.status = experiment.status
        existing.draft = experiment.draft.model_dump(mode="json")
        existing.result = experiment.result.model_dump(mode="json") if experiment.result else None
        existing.result_hash = experiment.result.result_hash if experiment.result else ""
        existing.branch_id = experiment.branch_id
        existing.updated_at = now_iso()
        db.flush()
        return existing
    row = PptAiExperimentRecord(
        id=experiment.experiment_id,
        session_id=session_id,
        material_id=material_id,
        bundle_id=experiment.bundle_id,
        branch_id=experiment.branch_id,
        parent_branch_id=experiment.parent_branch_id,
        question=experiment.question,
        recipe_id=experiment.recipe_id,
        status=experiment.status,
        draft=experiment.draft.model_dump(mode="json"),
        result=experiment.result.model_dump(mode="json") if experiment.result else None,
        result_hash=experiment.result.result_hash if experiment.result else "",
        created_at=experiment.created_at,
        updated_at=now_iso(),
    )
    db.add(row)
    db.flush()
    return row


def get_experiment_row(
    db: Session, experiment_id: str, session_id: str, material_id: str
) -> PptAiExperimentRecord:
    row = db.get(PptAiExperimentRecord, experiment_id)
    if row is None or row.session_id != session_id or row.material_id != material_id:
        raise resource_unavailable()
    return row


def experiment_from_row(row: PptAiExperimentRecord) -> Experiment:
    return Experiment(
        experiment_id=row.id,
        material_id=row.material_id,
        bundle_id=row.bundle_id,
        branch_id=row.branch_id,
        parent_branch_id=row.parent_branch_id,
        question=row.question,
        recipe_id=row.recipe_id,
        draft=ExperimentDraft.model_validate(row.draft),
        result=ExperimentResult.model_validate(row.result) if row.result else None,
        status=row.status,  # type: ignore[arg-type]
        created_at=row.created_at,
    )


# ---------------------------------------------------------------------------
# 报告与产物
# ---------------------------------------------------------------------------


def save_report(
    db: Session, *, session_id: str, report: ValidationReport
) -> PptAiValidationReportRecord:
    row = PptAiValidationReportRecord(
        id=report.report_id,
        session_id=session_id,
        material_id=report.material_id,
        bundle_id=report.bundle_id,
        branch_id=report.branch_id,
        artifact_id=report.artifact_id,
        bundle_hash=report.bundle_hash,
        branch_hash=report.branch_hash,
        kernel_version=report.kernel_version,
        runtime_version=report.runtime_version,
        status=report.status,
        report=report.model_dump(mode="json"),
        stale=report.stale,
        created_at=report.created_at,
    )
    db.add(row)
    db.flush()
    return row


def get_report_row(
    db: Session, report_id: str, session_id: str, material_id: str
) -> PptAiValidationReportRecord:
    row = db.get(PptAiValidationReportRecord, report_id)
    if row is None or row.session_id != session_id or row.material_id != material_id:
        raise resource_unavailable()
    return row


def latest_report_row(
    db: Session, bundle_id: str, session_id: str, material_id: str
) -> PptAiValidationReportRecord | None:
    return db.scalar(
        select(PptAiValidationReportRecord)
        .where(
            PptAiValidationReportRecord.bundle_id == bundle_id,
            PptAiValidationReportRecord.session_id == session_id,
            PptAiValidationReportRecord.material_id == material_id,
        )
        .order_by(PptAiValidationReportRecord.created_at.desc())
        .limit(1)
    )


def save_artifact(
    db: Session, *, session_id: str, artifact: GeneratedViewArtifact
) -> PptAiArtifactRecord:
    row = PptAiArtifactRecord(
        id=artifact.artifact_id,
        session_id=session_id,
        material_id=artifact.material_id,
        bundle_id=artifact.bundle_id,
        content_hash=artifact.content_hash,
        view_contract_version=artifact.view_contract_version,
        program=artifact.program,
        ast=artifact.ast,
        resources=artifact.resources,
        supported_interactions=artifact.supported_interactions,
        offline_supported=artifact.offline_supported,
        acceptance_status=artifact.acceptance_status,
        isolation=artifact.isolation,
        created_at=artifact.created_at,
    )
    db.add(row)
    db.flush()
    return row


def get_artifact_row(
    db: Session, artifact_id: str, session_id: str, material_id: str
) -> PptAiArtifactRecord:
    row = db.get(PptAiArtifactRecord, artifact_id)
    if row is None or row.session_id != session_id or row.material_id != material_id:
        raise resource_unavailable()
    return row


def artifact_from_row(row: PptAiArtifactRecord) -> GeneratedViewArtifact:
    return GeneratedViewArtifact(
        artifact_id=row.id,
        material_id=row.material_id,
        bundle_id=row.bundle_id,
        content_hash=row.content_hash,
        view_contract_version=row.view_contract_version,
        program=row.program,
        ast=row.ast,
        resources=row.resources,
        supported_interactions=row.supported_interactions,
        offline_supported=row.offline_supported,
        acceptance_status=row.acceptance_status,  # type: ignore[arg-type]
        isolation=row.isolation,
        created_at=row.created_at,
    )


def mark_reports_stale(db: Session, bundle_id: str) -> None:
    db.execute(
        update(PptAiValidationReportRecord)
        .where(PptAiValidationReportRecord.bundle_id == bundle_id)
        .values(stale=True, status="stale")
    )


def task_from_row(row: PptAiTaskRecord) -> PptAITask:
    from .tasks import to_task

    return to_task(row)


__all__ = [
    "artifact_from_row",
    "baseline_branch_row",
    "experiment_from_row",
    "get_artifact_row",
    "get_branch_row",
    "get_bundle",
    "get_bundle_row",
    "get_experiment_row",
    "get_plan",
    "get_report_row",
    "latest_branch_row",
    "latest_bundle",
    "latest_bundle_row",
    "latest_report_row",
    "list_branches",
    "list_bundles",
    "list_practice_branches",
    "mark_reports_stale",
    "plan_from_row",
    "save_artifact",
    "save_bundle",
    "save_experiment",
    "save_plan",
    "save_report",
    "task_from_row",
]

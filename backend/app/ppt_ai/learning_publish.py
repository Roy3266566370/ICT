"""发布选择、接收者预览与学习快照冻结（``ppt-learning.1`` §6.2/§8.2/§8.3）。

预览与正式发布共用同一冻结函数，避免“预览一套、分享另一套”。学习内容只能在
明确选择 bundle/branch 且验收报告仍对应当前版本时发布；未覆盖浏览器验证时
明确提示可选择 ``original_only``，不自动伪造通过。
"""

from __future__ import annotations

import logging
from typing import Any, Mapping

from sqlalchemy.orm import Session

from ..db.models import MaterialRecord
from .branches import branch_hash, derived_kind
from .learning_context import document_revision_for
from .learning_types import LearningPublishSelection
from .snapshots import (
    SnapshotConflict,
    freeze_interactions,
    public_projection,
)
from .store import (
    get_branch_row,
    get_bundle,
    latest_report_row,
)
from .util import now_iso

logger = logging.getLogger(__name__)


class PublishSelectionError(ValueError):
    def __init__(self, message: str, *, status_code: int = 409) -> None:
        super().__init__(message)
        self.status_code = status_code


def _check_report(
    db: Session, *, bundle_id: str, branch, session_id: str, material_id: str
) -> tuple[bool, list[dict[str, Any]]]:
    row = latest_report_row(db, bundle_id, session_id, material_id)
    if row is None:
        return False, [
            {
                "id": "browser_validation",
                "status": "not_covered",
                "message": "尚未运行受信浏览器验证；可选择只分享原稿（original_only），或先完成验收。",
            }
        ]
    report = row.report if isinstance(row.report, Mapping) else {}
    browser = report.get("browser") if isinstance(report.get("browser"), Mapping) else {}
    from .learning_validation import SCRIPT_VERSION  # 局部导入，避免模块级循环

    # 只接受 ai_learn_verify 服务端浏览器任务产出的报告：runtime_version 由后端
    # 在受信任务内写入，通用验收接口无法伪造；自报的 passed/server_verified 不算数。
    trusted_browser = (
        row.runtime_version == SCRIPT_VERSION
        and browser.get("status") == "passed"
        and browser.get("server_verified") is True
    )
    checks: list[dict[str, Any]] = [
        {"id": "report_exists", "status": "pass", "message": f"报告 {row.id}"},
        {
            "id": "report_fresh",
            "status": "fail" if row.stale else "pass",
            "message": "报告已过期，需重新验收。" if row.stale else "报告未标记过期。",
        },
        {
            "id": "report_branch",
            "status": "pass" if row.branch_hash == branch_hash(branch) else "fail",
            "message": "报告绑定当前分支版本。"
            if row.branch_hash == branch_hash(branch)
            else "报告对应的分支版本已变化，不能作为当前发布依据。",
        },
        {
            "id": "browser_validation",
            "status": "pass" if trusted_browser else "not_covered",
            "message": "服务端受信浏览器验证通过。"
            if trusted_browser
            else "缺少服务端真实浏览器操作证据；前端自报的 passed 不算验收通过。",
        },
    ]
    passed = all(item["status"] == "pass" for item in checks)
    return passed, checks


def _validate_selection(
    db: Session,
    *,
    material: MaterialRecord,
    session_id: str,
    selection: LearningPublishSelection,
) -> tuple[Any, Any, list[dict[str, Any]], bool]:
    if selection.mode == "original_only":
        return None, None, [
            {
                "id": "ai_excluded",
                "status": "pass",
                "message": "仅分享原稿；AI 学习内容、练习与候选实验均不进入公开快照。",
            }
        ], True
    current_revision = document_revision_for(material.id)
    if (
        selection.expected_document_revision is not None
        and selection.expected_document_revision != current_revision
    ):
        raise PublishSelectionError(
            f"文档已更新（当前 revision={current_revision}）；请重新预览后再发布"
        )
    bundle = get_bundle(db, selection.bundle_id or "", session_id, material.id)
    if (
        selection.expected_bundle_revision is not None
        and selection.expected_bundle_revision != bundle.bundle_revision
    ):
        raise PublishSelectionError(
            f"bundle 已更新（当前 revision={bundle.bundle_revision}）"
        )
    branch = get_branch_row(db, selection.branch_id or "", session_id, material.id)
    if branch.bundle_id != bundle.bundle_id:
        raise PublishSelectionError("分支不属于选定 bundle")
    if (
        selection.expected_branch_revision is not None
        and selection.expected_branch_revision != branch.revision
    ):
        raise PublishSelectionError(f"分支已更新（当前 revision={branch.revision}）")
    kind = derived_kind(branch)
    if selection.mode == "baseline" and kind != "baseline":
        raise PublishSelectionError("baseline 模式必须选择课件基准分支，不能发布练习或候选分支")
    if selection.mode == "practice" and kind != "practice":
        raise PublishSelectionError("practice 模式必须选择已保存的练习分支")
    node_ids = {node.node_id for node in bundle.compiled.nodes}
    missing_nodes = [item for item in selection.selected_learning_item_ids if item not in node_ids]
    if missing_nodes:
        raise PublishSelectionError(
            "选中的学习内容不属于该 bundle：" + ", ".join(missing_nodes[:5]), status_code=422
        )
    from ..db.ppt_ai_models import PptAiExperimentRecord

    from sqlalchemy import select

    experiment_ids = set(
        db.scalars(
            select(PptAiExperimentRecord.id).where(
                PptAiExperimentRecord.bundle_id == bundle.bundle_id,
                PptAiExperimentRecord.session_id == session_id,
                PptAiExperimentRecord.material_id == material.id,
            )
        ).all()
    )
    missing_experiments = [item for item in selection.selected_experiment_ids if item not in experiment_ids]
    if missing_experiments:
        raise PublishSelectionError(
            "选中的实验不属于该 bundle：" + ", ".join(missing_experiments[:5]), status_code=422
        )
    passed, checks = _check_report(
        db,
        bundle_id=bundle.bundle_id,
        branch=branch,
        session_id=session_id,
        material_id=material.id,
    )
    return bundle, branch, checks, passed


def freeze_for_selection(
    db: Session,
    *,
    material: MaterialRecord,
    session_id: str,
    selection: LearningPublishSelection,
) -> dict[str, Any]:
    bundle, branch, checks, passed = _validate_selection(
        db, material=material, session_id=session_id, selection=selection
    )
    result: dict[str, Any] = {
        "selection": selection.model_dump(mode="json"),
        "checks": checks,
        "can_publish": passed,
        "previewed_at": now_iso(),
        "snapshot": None,
        "content_hash": "",
        "pdf_note": "",
    }
    if selection.mode == "original_only":
        return result
    if not passed:
        result["blocked_reason"] = "学习内容尚未通过受信浏览器验证；可改用 original_only 只分享原稿。"
        return result
    try:
        snapshot = freeze_interactions(
            db,
            material=material,
            session_id=session_id,
            bundle_id=bundle.bundle_id,
            branch_id=branch.id,
            expected_revision=selection.expected_branch_revision,
            expected_bundle_revision=selection.expected_bundle_revision,
            learning_item_ids=selection.selected_learning_item_ids,
            experiment_ids=selection.selected_experiment_ids,
            capabilities={
                "can_explain_online": False,
                "can_ask_online": False,
                "can_explore_locally": True,
                "can_save_cloud": False,
                "can_manage": False,
            },
        )
    except SnapshotConflict as exc:
        raise PublishSelectionError(str(exc)) from exc
    if snapshot is None:
        result["blocked_reason"] = "没有可冻结的交互内容。"
        result["can_publish"] = False
        return result
    projection = public_projection(snapshot)
    result.update(
        snapshot=projection,
        content_hash=snapshot.content_hash,
        mode=selection.mode,
        public_item_count=len(snapshot.learning),
        public_experiment_count=len(snapshot.experiments),
    )
    return result


def preview_publication(
    db: Session,
    *,
    material: MaterialRecord,
    session_id: str,
    selection: LearningPublishSelection,
) -> dict[str, Any]:
    return freeze_for_selection(
        db, material=material, session_id=session_id, selection=selection
    )


__all__ = [
    "PublishSelectionError",
    "freeze_for_selection",
    "preview_publication",
]

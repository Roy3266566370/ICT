"""个人探索：保存/重开独立 practice 分支（``ppt-learning.1`` §5.7/§6.2）。

练习通过显式保存生成 ``kind=practice`` 分支；课件基准 ``baseline`` 不因练习而改变。
保存时重新校验上下文并重新求值，客户端不能自报基准，也不能把旧条件写进新版本。
"""

from __future__ import annotations

import logging
from typing import Any, Mapping

from sqlalchemy.orm import Session

from ..db.models import MaterialRecord
from ..db.ppt_ai_models import PptAiBranchRecord, PptAiTaskRecord
from .branches import create_branch, to_state
from .learning import descriptor_for_node
from .learning_context import LearningContextError, validate_learning_context
from .learning_types import LearningContext, LearningPractice
from .store import list_practice_branches

logger = logging.getLogger(__name__)


class PracticeError(ValueError):
    pass


def validate_practice_kind(kind: str) -> None:
    if kind != "practice":
        raise PracticeError("练习只能创建为 practice 分支；课件基准不接受客户端自报。")


def _title_for(frozen, title: str) -> str:
    cleaned = title.strip()
    if cleaned:
        return cleaned[:200]
    return f"第 {frozen.context.page_no} 页 · {frozen.node.title}"[:200]


def create_practice(
    db: Session,
    *,
    material: MaterialRecord,
    session_id: str,
    frozen,
    title: str = "",
    operation_id: str = "",
) -> PptAiBranchRecord:
    validate_practice_kind("practice")
    descriptor = descriptor_for_node(frozen.node)
    record = create_branch(
        db,
        session_id=session_id,
        material_id=material.id,
        bundle=frozen.bundle,
        values=frozen.effective_values,
        parent_branch_id=frozen.branch.id,
        status="active",
        kind="practice",
        title=_title_for(frozen, title),
        learning={
            "node_id": frozen.node.node_id,
            "region_id": frozen.node.region_id,
            "page_no": frozen.context.page_no,
            "goal_id": descriptor.goal_id,
            "template_id": descriptor.template_id,
            "context_input_hash": frozen.input_hash,
            "draft_revision": frozen.context.draft_revision,
            "operation_id": operation_id,
        },
    )
    return record


def practice_from_row(record: PptAiBranchRecord) -> LearningPractice:
    learning = record.learning_json if isinstance(record.learning_json, Mapping) else {}
    return LearningPractice(
        practice_id=record.id,
        branch_id=record.id,
        title=record.title or "未命名探索",
        bundle_id=record.bundle_id,
        node_id=str(learning.get("node_id") or ""),
        page_no=int(learning.get("page_no") or 0),
        revision=record.revision,
        values=record.canonical_values or {},
        context_input_hash=str(learning.get("context_input_hash") or ""),
        created_at=record.created_at,
        updated_at=record.updated_at,
        branch_state=to_state(record).model_dump(mode="json"),
    )


def list_practices(
    db: Session, *, session_id: str, material_id: str, bundle_id: str | None = None
) -> list[LearningPractice]:
    return [
        practice_from_row(row)
        for row in list_practice_branches(
            db, session_id, material_id, bundle_id=bundle_id
        )
    ]


def handle_learning_practice_task(
    db: Session,
    material: MaterialRecord,
    task: PptAiTaskRecord,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    context = LearningContext.model_validate(payload.get("context") or {})
    title = str(payload.get("title") or "")[:200]
    try:
        frozen = validate_learning_context(
            db, material=material, session_id=task.session_id, context=context
        )
    except LearningContextError as exc:
        raise PracticeError(str(exc)) from exc
    record = create_practice(
        db,
        material=material,
        session_id=task.session_id,
        frozen=frozen,
        title=title,
        operation_id=task.operation_id,
    )
    practice = practice_from_row(record)
    return {
        "__status__": "succeeded",
        "__stage__": "practice_saved",
        "practice": practice.model_dump(mode="json"),
        "branch": to_state(record).model_dump(mode="json"),
        "input_hash": frozen.input_hash,
    }


__all__ = [
    "PracticeError",
    "create_practice",
    "handle_learning_practice_task",
    "list_practices",
    "practice_from_row",
    "validate_practice_kind",
]

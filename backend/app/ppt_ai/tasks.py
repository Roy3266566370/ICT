"""持久任务、租约与独立 worker 入口。

任务事实写入 ``ppt_ai_tasks``；``POST`` 只在事务中入队（幂等键 ``operation_id``），
耗时工作由本进程执行器或独立 ``scripts/run_ppt_ai_worker.py`` 领取。GET 任务状态
只读数据库，不会触发模型调用。执行器可为空实现（本地确定性路径），AI 只提交候选。
"""

from __future__ import annotations

import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Mapping

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db.ppt_ai_models import PptAiTaskRecord
from ..db.session import session_scope
from ..settings import get_settings
from .client import PPTAIError
from .contracts import ContractError
from .types import PptAITask
from .util import new_id, now_iso

logger = logging.getLogger(__name__)

OPERATION_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")
TERMINAL_STATUSES = frozenset({"succeeded", "needs_review", "failed", "cancelled", "superseded"})

_EXECUTOR: ThreadPoolExecutor | None = None
_EXECUTOR_LOCK = threading.Lock()


class TaskConflict(ValueError):
    pass


def _lease_until(seconds: float) -> str:
    value = datetime.now(tz=timezone.utc).replace(microsecond=0) + timedelta(seconds=seconds)
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def to_task(row: PptAiTaskRecord) -> PptAITask:
    return PptAITask(
        task_id=row.id,
        material_id=row.material_id,
        kind=row.kind,  # type: ignore[arg-type]
        status=row.status,  # type: ignore[arg-type]
        stage=row.stage,
        operation_id=row.operation_id,
        input_version=row.input_version,
        input_hash=row.input_hash,
        budget_used=row.budget_used,
        result=row.result,
        error_code=row.error_code,
        error_message=row.error_message,
        attempt=row.attempt,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def find_by_operation(
    db: Session, session_id: str, material_id: str, kind: str, operation_id: str
) -> PptAiTaskRecord | None:
    return db.scalar(
        select(PptAiTaskRecord).where(
            PptAiTaskRecord.session_id == session_id,
            PptAiTaskRecord.material_id == material_id,
            PptAiTaskRecord.kind == kind,
            PptAiTaskRecord.operation_id == operation_id,
        )
    )


def enqueue_task(
    db: Session,
    *,
    session_id: str,
    material_id: str,
    kind: str,
    operation_id: str,
    input_version: int = 0,
    input_hash: str = "",
    input_json: Mapping[str, Any] | None = None,
) -> PptAiTaskRecord:
    """幂等入队；重复 ``operation_id`` 返回已有任务，不重复生成。"""

    if OPERATION_PATTERN.match(operation_id or "") is None:
        raise TaskConflict("操作标识不合法")
    existing = find_by_operation(db, session_id, material_id, kind, operation_id)
    if existing is not None:
        if input_json is not None and dict(input_json) != dict(existing.input_json or {}):
            raise TaskConflict("同一操作标识已用于不同输入，请更换 operation_id")
        return existing

    created = now_iso()
    row = PptAiTaskRecord(
        id=new_id("task"),
        session_id=session_id,
        material_id=material_id,
        kind=kind,
        status="queued",
        stage="queued",
        operation_id=operation_id,
        input_version=max(0, int(input_version)),
        input_hash=input_hash,
        input_json=dict(input_json or {}),
        budget_used=0,
        result=None,
        error_code=None,
        error_message=None,
        attempt=1,
        lease_expires_at=None,
        heartbeat_at=None,
        created_at=created,
        updated_at=created,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = find_by_operation(db, session_id, material_id, kind, operation_id)
        if existing is None:
            raise
        return existing
    logger.info("PPT AI 任务入队：%s kind=%s material=%s", row.id, kind, material_id)
    return row


def _executor() -> ThreadPoolExecutor:
    global _EXECUTOR
    with _EXECUTOR_LOCK:
        if _EXECUTOR is None:
            _EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ppt-ai")
        return _EXECUTOR


def dispatch_async(task_id: str) -> None:
    """立即唤醒本进程执行器；任务已持久化，崩溃后可由独立 worker 恢复。"""

    if not get_settings().ppt_ai_inline_dispatch:
        return
    _executor().submit(_run_in_new_session, task_id)


def _run_in_new_session(task_id: str) -> None:
    try:
        with session_scope() as db:
            row = db.get(PptAiTaskRecord, task_id)
            if row is None:
                return
            run_task(db, row)
    except Exception:  # noqa: BLE001 - 后台线程不得让进程退出
        logger.exception("PPT AI 任务执行线程异常：%s", task_id)


def _claim(db: Session, row: PptAiTaskRecord, *, force: bool = False) -> bool:
    """原子领取：以 ``updated_at`` 为乐观锁，避免多 worker 同时执行同一任务。"""

    if row.status in TERMINAL_STATUSES:
        return False
    lease = row.lease_expires_at
    current = now_iso()
    if not force and row.status == "running" and lease and lease > current:
        return False
    expected_updated = row.updated_at
    expected_status = row.status
    attempt = max(1, int(row.attempt or 1))
    if row.status == "running":
        attempt += 1
    result = db.execute(
        update(PptAiTaskRecord)
        .where(
            PptAiTaskRecord.id == row.id,
            PptAiTaskRecord.updated_at == expected_updated,
            PptAiTaskRecord.status == expected_status,
        )
        .values(
            status="running",
            stage="running",
            lease_expires_at=_lease_until(float(get_settings().ppt_ai_task_timeout_s)),
            heartbeat_at=current,
            updated_at=current,
            attempt=attempt,
        )
    )
    if result.rowcount != 1:
        db.rollback()
        return False
    db.commit()
    db.refresh(row)
    return True


def _still_owner(db: Session, row: PptAiTaskRecord, claimed_attempt: int) -> bool:
    with db.no_autoflush:
        attempt = db.scalar(
            select(PptAiTaskRecord.attempt).where(PptAiTaskRecord.id == row.id)
        )
    return int(attempt or 0) == claimed_attempt


def run_task(db: Session, row: PptAiTaskRecord, *, force: bool = False) -> PptAiTaskRecord:
    """执行一个持久任务；调用方负责提供 session，执行结果在同一事务中落库。"""

    if not _claim(db, row, force=force):
        return row
    claimed_attempt = int(row.attempt or 1)
    started = now_iso()
    try:
        result = _dispatch(db, row, row.input_json or {})
        status = str(result.pop("__status__", "succeeded"))
        stage = str(result.pop("__stage__", status))
        row.result = result
        row.status = status if status in TERMINAL_STATUSES else "succeeded"
        row.stage = stage
        row.error_code = None
        row.error_message = None
        row.budget_used = int(result.get("budget_used") or row.budget_used or 0)
    except PPTAIError as exc:
        db.rollback()
        row = db.get(PptAiTaskRecord, row.id) or row
        row.status = "failed"
        row.stage = "failed"
        row.error_code = exc.code
        row.error_message = str(exc)[:1000]
    except ContractError as exc:
        db.rollback()
        row = db.get(PptAiTaskRecord, row.id) or row
        row.status = "failed"
        row.stage = "failed"
        row.error_code = "MISSING_FIELD"
        row.error_message = f"契约校验失败：{exc}"[:1000]
    except ValueError as exc:
        db.rollback()
        row = db.get(PptAiTaskRecord, row.id) or row
        row.status = "failed"
        row.stage = "failed"
        row.error_code = "MISSING_FIELD"
        row.error_message = str(exc)[:1000]
    except Exception as exc:  # noqa: BLE001 - 统一结构化失败，不裸抛到线程
        logger.exception("PPT AI 任务失败：%s kind=%s", row.id, row.kind)
        db.rollback()
        row = db.get(PptAiTaskRecord, row.id) or row
        row.status = "failed"
        row.stage = "failed"
        row.error_code = "MODEL_UNAVAILABLE"
        row.error_message = f"任务执行失败：{type(exc).__name__}"[:1000]
    finally:
        if not _still_owner(db, row, claimed_attempt):
            # 租约过期后已被其他 worker 接管：旧 worker 的结果不能覆盖新执行。
            db.rollback()
            row = db.get(PptAiTaskRecord, row.id) or row
            logger.warning("PPT AI 任务迟到结果被拒收：%s attempt=%s", row.id, row.attempt)
            return row
        row.lease_expires_at = None
        row.heartbeat_at = now_iso()
        row.updated_at = now_iso()
        db.commit()
    logger.info(
        "PPT AI 任务结束：%s kind=%s status=%s started=%s",
        row.id,
        row.kind,
        row.status,
        started,
    )
    return row


def _dispatch(db: Session, row: PptAiTaskRecord, payload: Mapping[str, Any]) -> dict[str, Any]:
    from ..db.models import MaterialRecord

    material = db.get(MaterialRecord, row.material_id)
    if material is None:
        raise ValueError("材料不存在或已过期")
    handlers: dict[str, Callable[[Session, MaterialRecord, PptAiTaskRecord, Mapping[str, Any]], dict[str, Any]]] = {}
    from . import (
        experiments,
        generated_views,
        learning,
        learning_explanations,
        learning_practices,
        learning_questions,
        learning_validation,
        pipeline,
        targets,
        validation,
    )

    handlers["ai_plan"] = pipeline.handle_plan_task
    handlers["ai_rebuild"] = pipeline.handle_rebuild_task
    handlers["ai_experiment"] = experiments.handle_experiment_task
    handlers["ai_target"] = targets.handle_target_task
    handlers["ai_verify"] = validation.handle_verify_task
    handlers["ai_codegen"] = generated_views.handle_codegen_task
    handlers["ai_learn_prepare"] = learning.handle_learning_prepare_task
    handlers["ai_learn_explain"] = learning_explanations.handle_learning_explain_task
    handlers["ai_learn_question"] = learning_questions.handle_learning_question_task
    handlers["ai_learn_execute"] = learning_questions.handle_learning_execute_task
    handlers["ai_learn_practice"] = learning_practices.handle_learning_practice_task
    handlers["ai_learn_verify"] = learning_validation.handle_learning_verify_task
    handler = handlers.get(row.kind)
    if handler is None:
        raise ValueError(f"不支持的任务类型：{row.kind}")
    return handler(db, material, row, payload)


def run_pending(db: Session, limit: int = 5) -> list[str]:
    """领取并执行排队/租约过期的任务；供独立 worker 或测试调用。"""

    now = now_iso()
    rows = db.scalars(
        select(PptAiTaskRecord)
        .where(
            PptAiTaskRecord.status.in_(("queued", "running")),
        )
        .order_by(PptAiTaskRecord.created_at.asc())
        .limit(max(1, int(limit)))
    ).all()
    executed: list[str] = []
    for row in rows:
        if row.status == "running" and row.lease_expires_at and row.lease_expires_at > now:
            continue
        run_task(db, row, force=True)
        executed.append(row.id)
    return executed


__all__ = [
    "OPERATION_PATTERN",
    "TERMINAL_STATUSES",
    "TaskConflict",
    "dispatch_async",
    "enqueue_task",
    "find_by_operation",
    "run_pending",
    "run_task",
    "to_task",
]

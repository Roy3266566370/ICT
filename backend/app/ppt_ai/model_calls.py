"""模型调用预算的持久占用。

预算在**发出 HTTP 请求之前**占用并提交到任务行；失败、超时、无效 JSON 与重试
都计数。使用独立 session，避免任务后续回滚把预算恢复。
"""

from __future__ import annotations

import logging
from typing import Callable

from ..db.ppt_ai_models import PptAiTaskRecord
from ..db.session import session_scope

logger = logging.getLogger(__name__)


def persist_attempt(task_id: str, used_calls: int) -> None:
    try:
        with session_scope() as db:
            row = db.get(PptAiTaskRecord, task_id)
            if row is None:
                return
            row.budget_used = max(int(row.budget_used or 0), int(used_calls))
            db.commit()
    except Exception:  # noqa: BLE001 - 持久化失败只记录，不掩盖模型调用结果
        logger.exception("PPT AI 预算持久化失败：task=%s used=%s", task_id, used_calls)


def attempt_callback(task_id: str) -> Callable[[int], None]:
    def _callback(used_calls: int) -> None:
        persist_attempt(task_id, used_calls)

    return _callback


__all__ = ["attempt_callback", "persist_attempt"]

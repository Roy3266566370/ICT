"""工坊作品的装配、列表摘要、发布快照与 ID。"""

from __future__ import annotations

import secrets
from typing import Any, Mapping

from ..schemas.common import to_iso, utc_now


def new_work_id() -> str:
    return f"wk_{secrets.token_hex(12)}"


def new_share_id() -> str:
    return secrets.token_urlsafe(12)


def summary(row: Any) -> dict[str, Any]:
    """列表卡片所需的最小信息（不加载 document）。"""

    return {
        "work_id": row.id,
        "title": row.title,
        "node_count": row.node_count,
        "revision": row.revision,
        "forked_from_share": row.forked_from_share,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def share_summary(row: Any) -> dict[str, Any]:
    return {
        "share_id": row.share_id,
        "title": row.title,
        "node_count": row.node_count,
        "forks": row.forks,
        "published_at": row.created_at,
    }


def snapshot(work: Any, *, share_id: str) -> dict[str, Any]:
    """发布快照：冻结 document，附元数据；不含会话与内部字段。"""

    import copy

    doc = copy.deepcopy(work.document or {})
    return {
        "share_id": share_id,
        "work_id": work.id,
        "title": work.title,
        "published_at": to_iso(utc_now()),
        "document": doc,
    }


__all__ = ["new_share_id", "new_work_id", "share_summary", "snapshot", "summary"]

"""数据库层统一出口（``app/db/**``，T7 范围）。

``app.db`` 暴露的最小 API（供 T10 的 ``routes_objects``/``routes_runs``/``routes_checks`` 复用）::

    from app.db import get_db, session_scope, init_db
    from app.db import SessionRecord, MaterialRecord, JobRecord, ...

约定：ORM 记录类以 ``*Record`` 结尾，避免与 ``app/schemas`` 的 Pydantic 领域模型同名。
"""

from __future__ import annotations

from .base import Base
from .init_db import init_db
from .models import (
    TABLE_NAMES,
    CheckRecord,
    ElementRecord,
    JobRecord,
    KnowledgeObjectRecord,
    MaterialRecord,
    ObjectVersionRecord,
    PageRecord,
    RunRecord,
    SessionRecord,
)
from .session import (
    get_db,
    get_engine,
    get_session_factory,
    reset_engine_cache,
    session_scope,
)

__all__ = [
    "Base",
    "CheckRecord",
    "ElementRecord",
    "JobRecord",
    "KnowledgeObjectRecord",
    "MaterialRecord",
    "ObjectVersionRecord",
    "PageRecord",
    "RunRecord",
    "SessionRecord",
    "TABLE_NAMES",
    "get_db",
    "get_engine",
    "get_session_factory",
    "init_db",
    "reset_engine_cache",
    "session_scope",
]

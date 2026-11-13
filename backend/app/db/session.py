"""引擎与会话管理（SQLAlchemy 2.x + SQLite 单文件，§2.1.1；MySQL 见 ``C-DB@1``）。

- ``DATABASE_URL`` 可覆盖数据库地址；默认 ``backend/data/xiangsheng.db``。
- SQLite 打开外键约束（``PRAGMA foreign_keys=ON``），并允许跨线程（``BackgroundTasks``）。
- MySQL 显式启用 ``pool_pre_ping`` 与可配置连接池（仅当 URL 指向 MySQL 时）。
- 每个请求一个 ``Session``；后台任务用 ``session_scope()`` 自管事务，互不共享连接。
- 日志只打印脱敏后的连接描述（``redact_database_url``），禁止回显凭据。
"""

from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from functools import lru_cache
from pathlib import PurePosixPath
from typing import Iterator

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from ..settings import DATA_DIR, UPLOAD_DIR, get_settings

logger = logging.getLogger(__name__)

#: 保护懒加载的 engine/factory，避免并发首请求重复创建。
_LOCK = threading.Lock()

#: 连接串无法解析时的固定占位串（绝不回显原始输入）。
UNPARSED_DATABASE_URL = "<unparsed-database-url>"


def redact_database_url(url: str) -> str:
    """返回可安全写日志的连接描述：``dialect://host:port/database``。

    - 使用 ``sqlalchemy.engine.make_url`` 解析；用户名、密码、查询参数一律丢弃。
    - SQLite 等无 host 的形式返回 ``dialect:///<database 的 basename>``。
    - 解析抛错时返回 ``"<unparsed-database-url>"``，绝不回显原始串。
    """

    try:
        parsed = make_url(url)
        backend = parsed.get_backend_name()
        database = parsed.database or ""
        host = parsed.host or ""
        if not host:
            # SQLite 的 ``database`` 可能是绝对路径或 ``:memory:``，只保留 basename。
            basename = PurePosixPath(database.replace("\\", "/")).name if database else ""
            return f"{backend}:///{basename}"
        port = parsed.port
        host_part = f"{host}:{port}" if port is not None else host
        return f"{backend}://{host_part}/{database}"
    except Exception:  # noqa: BLE001 - 任何解析失败都不得泄露原始串
        return UNPARSED_DATABASE_URL


def _ensure_sqlite_directory(url: str) -> None:
    """SQLite 使用文件 DSN 时先建目录，否则首次连接会报 ``unable to open database file``。"""

    if not url.startswith("sqlite"):
        return
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _enable_sqlite_foreign_keys(engine: Engine) -> None:
    """SQLite 默认不校验外键；显式打开，配合路由中的级联删除。"""

    if engine.dialect.name != "sqlite":
        return

    @event.listens_for(engine, "connect")
    def _set_pragma(dbapi_connection: object, _connection_record: object) -> None:
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
        finally:
            cursor.close()


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """返回进程内单例 ``Engine``（首次调用时才建目录与连接池）。

    - SQLite：保持既有行为（``check_same_thread=False`` + 外键 PRAGMA）；
    - MySQL：显式 ``pool_pre_ping=True`` 与 ``DB_*`` 连接池参数；
    - 其他方言：沿用最简 ``create_engine(url, future=True)``。
    """

    with _LOCK:
        settings = get_settings()
        url = settings.database_url
        _ensure_sqlite_directory(url)
        connect_args: dict[str, object] = {}
        if url.startswith("sqlite"):
            # BackgroundTasks 在线程中推进任务，连接会跨线程复用。
            connect_args["check_same_thread"] = False
            engine = create_engine(url, future=True, connect_args=connect_args)
            _enable_sqlite_foreign_keys(engine)
        elif make_url(url).get_backend_name() == "mysql":
            engine = create_engine(
                url,
                future=True,
                pool_pre_ping=True,
                pool_size=settings.db_pool_size,
                max_overflow=settings.db_max_overflow,
                pool_timeout=settings.db_pool_timeout_seconds,
                pool_recycle=settings.db_pool_recycle_seconds,
            )
        else:
            engine = create_engine(url, future=True)
        logger.info("数据库已就绪：%s", redact_database_url(url))
        return engine


@lru_cache(maxsize=1)
def get_session_factory() -> sessionmaker[Session]:
    """返回绑定到单例 engine 的 session 工厂。"""

    return sessionmaker(
        bind=get_engine(),
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
        future=True,
    )


def get_db() -> Iterator[Session]:
    """FastAPI 依赖：每请求一个会话，异常时回滚并始终关闭。"""

    factory = get_session_factory()
    db = factory()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """后台任务/脚本使用的事务作用域：成功提交、异常回滚、最后关闭。"""

    factory = get_session_factory()
    db = factory()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def reset_engine_cache() -> None:
    """测试或切换 ``DATABASE_URL`` 时清空单例（不关闭既有连接）。"""

    global _LOCK
    get_session_factory.cache_clear()
    get_engine.cache_clear()
    _LOCK = threading.Lock()


__all__ = [
    "UNPARSED_DATABASE_URL",
    "get_db",
    "get_engine",
    "get_session_factory",
    "redact_database_url",
    "reset_engine_cache",
    "session_scope",
]

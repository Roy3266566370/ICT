"""真实 MySQL 集成测试的环境开关与共享夹具（``C-INTEGRATION@1``）。

开关与安全边界
--------------

- 只有设置 ``XIANGSHENG_MYSQL_TEST_URL`` 时才执行任何集成用例；未配置时全部
  ``skip``（不是 fail，也不退回 SQLite 伪装通过）。
- 夹具用 ``sqlalchemy.engine.make_url`` 校验目标库名必须以 ``_test`` 结尾，
  否则拒绝执行；禁止对 ``xiangsheng_dev`` 执行 drop/create。
- 凭据只存在于环境变量与内存中：skip 原因、断言消息与日志都不回显连接串。

导入顺序（与既有 ``tests/test_auth_api.py`` 一致，顺序不可调整）
---------------------------------------------------------------

1. 读开关 → 写入 ``os.environ["DATABASE_URL"]``；
2. ``get_settings.cache_clear()`` + ``reset_engine_cache()``；
3. 再 ``from app.main import create_app``（``create_app`` 读 settings 单例）。

模块导入完成后会恢复进程原有的 ``DATABASE_URL`` 并再次清缓存：pytest 收集阶段
会导入全部测试模块，若把 MySQL 串长期留在进程环境里，会影响同一轮运行中的
SQLite 用例。每次执行集成用例时夹具会重新切回测试库。
"""

from __future__ import annotations

import os
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.engine import make_url

#: ``backend/``（本文件位于 ``backend/tests/integration/``）。
BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

#: 集成测试开关（``C-INTEGRATION@1``）；只从环境变量读取，代码中不写凭据。
TEST_URL_ENV = "XIANGSHENG_MYSQL_TEST_URL"
#: 允许执行 DDL/DML 的库名后缀；``xiangsheng_dev`` 等生产库一律拒绝。
TEST_DATABASE_SUFFIX = "_test"
#: skip 原因固定文案：只描述开关，不含任何连接信息。
SKIP_REASON_NOT_CONFIGURED = "未配置 XIANGSHENG_MYSQL_TEST_URL，跳过真实 MySQL 集成测试"
SKIP_REASON_NOT_MYSQL = "XIANGSHENG_MYSQL_TEST_URL 不是 MySQL 连接串，拒绝执行集成测试"
SKIP_REASON_NOT_TEST_DATABASE = "拒绝在非测试库上执行（目标库名必须以 _test 结尾）"

#: 收集阶段的开关值与原始 ``DATABASE_URL``（仅保存在内存中，不写日志）。
_configured_url = (os.environ.get(TEST_URL_ENV) or "").strip()
_original_database_url = os.environ.get("DATABASE_URL")

if _configured_url:
    os.environ["DATABASE_URL"] = _configured_url

from app.db import account_models as _account_models  # noqa: E402,F401  注册账号三表
from app.db import models as _models  # noqa: E402,F401  注册存量业务表
from app.db.base import Base  # noqa: E402
from app.db.session import get_engine, reset_engine_cache  # noqa: E402
from app.settings import get_settings  # noqa: E402

if _configured_url:
    # 顺序要求：先固定 DATABASE_URL，再清配置/引擎缓存，最后才导入 app.main。
    get_settings.cache_clear()
    reset_engine_cache()

from app.main import create_app  # noqa: E402

if _configured_url:
    # 恢复收集前的进程环境，避免污染同一轮运行中的 SQLite 用例。
    if _original_database_url is None:
        os.environ.pop("DATABASE_URL", None)
    else:
        os.environ["DATABASE_URL"] = _original_database_url
    get_settings.cache_clear()
    reset_engine_cache()


def _activate_test_database(url: str) -> None:
    """把进程切到集成测试库：写环境变量 → 清配置缓存 → 清引擎缓存。"""

    os.environ["DATABASE_URL"] = url
    get_settings.cache_clear()
    reset_engine_cache()


def _restore_database_url(saved_url: str | None) -> None:
    """恢复进程原有的 ``DATABASE_URL``（``None`` 表示原本未设置）。"""

    if saved_url is None:
        os.environ.pop("DATABASE_URL", None)
    else:
        os.environ["DATABASE_URL"] = saved_url
    get_settings.cache_clear()
    reset_engine_cache()


@pytest.fixture(scope="session")
def mysql_test_url() -> str:
    """返回已校验的 MySQL 测试连接串；未配置或库名不安全时 ``skip``。

    skip 文案由固定常量给出，**不拼接**连接串，避免凭据进入测试输出。
    """

    if not _configured_url:
        pytest.skip(SKIP_REASON_NOT_CONFIGURED)

    parsed = make_url(_configured_url)
    if parsed.get_backend_name() != "mysql":
        pytest.skip(SKIP_REASON_NOT_MYSQL)

    database = parsed.database or ""
    if not database.endswith(TEST_DATABASE_SUFFIX):
        pytest.skip(SKIP_REASON_NOT_TEST_DATABASE)

    return _configured_url


@pytest.fixture(scope="session")
def mysql_engine(mysql_test_url: str) -> Iterator[Engine]:
    """会话级引擎：先 ``drop_all`` 再 ``create_all``，整轮结束后再 drop 表（不 drop 库）。

    ``create_all`` 的 DDL 验证由用例断言；这里只负责建立干净的目标库状态。
    """

    saved_url = os.environ.get("DATABASE_URL")
    _activate_test_database(mysql_test_url)
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()
        _restore_database_url(saved_url)


@pytest.fixture(autouse=True)
def _clean_account_rows(mysql_engine: Engine) -> Iterator[None]:
    """每个用例结束后清空账号三表，保证用例之间互不影响。

    删除顺序遵循外键依赖：``auth_sessions`` / ``login_identities`` → ``users``。
    """

    yield
    with mysql_engine.begin() as connection:
        connection.execute(text("DELETE FROM auth_sessions"))
        connection.execute(text("DELETE FROM login_identities"))
        connection.execute(text("DELETE FROM users"))


@pytest.fixture()
def client(mysql_test_url: str) -> Iterator[TestClient]:
    """走真实 FastAPI 栈的 HTTP 客户端（生命周期内由 ``init_db()`` 幂等建表）。

    每次都重新切库并清缓存：pytest 收集阶段可能已被其它测试模块改成 SQLite，
    不能依赖模块导入时的那一次设置。
    """

    _activate_test_database(mysql_test_url)
    app = create_app()
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        # 关闭本用例的连接池后再清单例，避免 Windows 下句柄残留。
        get_engine().dispose()
        reset_engine_cache()


__all__ = [
    "SKIP_REASON_NOT_CONFIGURED",
    "SKIP_REASON_NOT_MYSQL",
    "SKIP_REASON_NOT_TEST_DATABASE",
    "TEST_DATABASE_SUFFIX",
    "TEST_URL_ENV",
    "client",
    "mysql_engine",
    "mysql_test_url",
]
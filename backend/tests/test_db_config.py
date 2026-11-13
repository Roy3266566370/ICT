"""数据库配置与连接串脱敏（``C-DB@1``）。

覆盖：

- 新增 ``AUTH_*`` / ``DB_*`` 字段的默认值与校验边界；默认 ``DATABASE_URL`` 仍是 SQLite；
- ``redact_database_url()`` 的输出形状，且绝不回显用户名/密码/查询参数；
- MySQL 分支的连接池参数（只构造 ``Engine``，**不发起任何连接**）；
- SQLite 分支保持既有行为（``PRAGMA foreign_keys=ON``）；
- 建库脚本：缺凭据时退出码 2 且不连接、非法标识符被拒绝、CLI 参数形状；
- ``.env.example`` 不含任何真实凭据。
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.db.session import (
    UNPARSED_DATABASE_URL,
    get_engine,
    redact_database_url,
    reset_engine_cache,
)
from app.settings import Settings

BACKEND_DIR = Path(__file__).resolve().parents[1]
INIT_SCRIPT = BACKEND_DIR / "scripts" / "init_mysql_schema.py"

#: 所有新增配置项对应的环境变量名；默认值测试前先清空，避免其他测试文件污染。
_NEW_ENV_NAMES = (
    "AUTH_COOKIE_NAME",
    "AUTH_SESSION_ABSOLUTE_HOURS",
    "AUTH_SESSION_IDLE_HOURS",
    "AUTH_REMEMBER_ABSOLUTE_HOURS",
    "AUTH_REMEMBER_IDLE_HOURS",
    "AUTH_DEVELOPMENT_ACTIVE_ON_REGISTER",
    "DB_POOL_SIZE",
    "DB_MAX_OVERFLOW",
    "DB_POOL_TIMEOUT_SECONDS",
    "DB_POOL_RECYCLE_SECONDS",
    "MIGRATION_DATABASE_URL",
)


def _clean_settings(**overrides: object) -> Settings:
    """不读任何 ``.env`` 文件地构造配置（显式关键字参数优先于环境变量）。"""

    return Settings(_env_file=None, **overrides)


def _script_env(**overrides: str) -> dict[str, str]:
    """复制当前环境并**移除全部 MYSQL_* 变量**，只保留测试指定的值。"""

    env = {key: value for key, value in os.environ.items() if not key.startswith("MYSQL_")}
    env["PYTHONIOENCODING"] = "utf-8"
    env.update(overrides)
    return env


def _run_script(*args: str, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(INIT_SCRIPT), *args],
        cwd=str(BACKEND_DIR),
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
        check=False,
    )


# ---------------------------------------------------------------------------
# settings：默认值与边界
# ---------------------------------------------------------------------------


def test_new_settings_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in _NEW_ENV_NAMES:
        monkeypatch.delenv(name, raising=False)

    settings = _clean_settings()

    assert settings.auth_cookie_name == "xs_auth"
    assert settings.auth_session_absolute_hours == 24
    assert settings.auth_session_idle_hours == 12
    assert settings.auth_remember_absolute_hours == 720
    assert settings.auth_remember_idle_hours == 168
    assert settings.auth_development_active_on_register is True
    assert settings.db_pool_size == 5
    assert settings.db_max_overflow == 5
    assert settings.db_pool_timeout_seconds == 10.0
    assert settings.db_pool_recycle_seconds == 1800
    assert settings.migration_database_url == ""


def test_default_database_url_remains_sqlite(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)

    settings = _clean_settings()

    assert settings.database_url.startswith("sqlite:///")
    assert settings.database_url.endswith("xiangsheng.db")
    assert "mysql" not in settings.database_url


def test_existing_settings_fields_unchanged() -> None:
    settings = _clean_settings()

    assert settings.session_cookie_name == "xiangsheng_session"
    assert settings.session_ttl_hours == 24
    assert settings.material_retention_hours == 24
    assert settings.enforce_csrf is True
    assert settings.max_upload_bytes == 70 * 1024 * 1024
    assert settings.max_slide_pages == 100
    assert settings.max_limit == 50


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("auth_cookie_name", ""),
        ("auth_session_absolute_hours", 0),
        ("auth_session_idle_hours", 0),
        ("auth_remember_absolute_hours", 0),
        ("auth_remember_idle_hours", 0),
        ("db_pool_size", 0),
        ("db_pool_size", 51),
        ("db_max_overflow", -1),
        ("db_max_overflow", 51),
        ("db_pool_timeout_seconds", 0),
        ("db_pool_timeout_seconds", -1.0),
        ("db_pool_recycle_seconds", 59),
    ],
)
def test_new_settings_validation_bounds(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        _clean_settings(**{field: value})


# ---------------------------------------------------------------------------
# redact_database_url
# ---------------------------------------------------------------------------


def test_redact_mysql_url_drops_credentials_and_query() -> None:
    redacted = redact_database_url(
        "mysql+pymysql://appuser:unit-test-value@127.0.0.1:3306/xiangsheng_dev?charset=utf8mb4"
    )

    assert redacted == "mysql://127.0.0.1:3306/xiangsheng_dev"
    assert "appuser" not in redacted
    assert "unit-test-value" not in redacted
    assert "charset" not in redacted


@pytest.mark.parametrize(
    ("url", "secret"),
    [
        ("mysql+pymysql://app:unit-test-pw-1@db.local:3306/xiangsheng_dev", "unit-test-pw-1"),
        ("postgresql://app:unit-test%40pw@db:5432/app", "unit-test%40pw"),
        ("mysql://root:unit-test-pw-2@127.0.0.1:3306/db?ssl=1", "unit-test-pw-2"),
    ],
)
def test_redacted_output_never_contains_password(url: str, secret: str) -> None:
    redacted = redact_database_url(url)
    assert secret not in redacted
    assert "://" in redacted
    # 查询参数必须整体丢弃。
    assert "ssl" not in redacted


def test_redact_sqlite_url_keeps_only_basename() -> None:
    assert redact_database_url("sqlite:///E:/代码/ICT/backend/data/xiangsheng.db") == (
        "sqlite:///xiangsheng.db"
    )
    assert redact_database_url("sqlite:////tmp/xiangsheng.db") == "sqlite:///xiangsheng.db"
    assert redact_database_url("sqlite:///:memory:") == "sqlite:///:memory:"


@pytest.mark.parametrize("raw", ["", "not a database url", "://missing"])
def test_redact_unparsable_url_returns_placeholder(raw: str) -> None:
    assert redact_database_url(raw) == UNPARSED_DATABASE_URL
    assert UNPARSED_DATABASE_URL == "<unparsed-database-url>"


def test_redact_host_without_port() -> None:
    assert redact_database_url("mysql+pymysql://u:p@db.local/xiangsheng_dev") == (
        "mysql://db.local/xiangsheng_dev"
    )


# ---------------------------------------------------------------------------
# Engine 构造（不连接 MySQL）
# ---------------------------------------------------------------------------


def test_mysql_engine_uses_pool_settings_without_connecting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _clean_settings(
        database_url=(
            "mysql+pymysql://app:placeholder@127.0.0.1:3306/xiangsheng_dev?charset=utf8mb4"
        ),
        db_pool_size=7,
        db_max_overflow=3,
        db_pool_timeout_seconds=2.5,
        db_pool_recycle_seconds=600,
    )
    monkeypatch.setattr("app.db.session.get_settings", lambda: settings)
    reset_engine_cache()

    try:
        engine = get_engine()
        try:
            assert engine.dialect.name == "mysql"
            assert type(engine.pool).__name__ == "QueuePool"
            assert engine.pool.size() == 7
            assert getattr(engine.pool, "_max_overflow") == 3
            assert getattr(engine.pool, "_timeout") == pytest.approx(2.5)
            assert getattr(engine.pool, "_recycle") == 600
            assert getattr(engine.pool, "_pre_ping") is True
        finally:
            engine.dispose()
    finally:
        reset_engine_cache()


def test_sqlite_engine_keeps_foreign_key_pragma(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    db_path = tmp_path / "config.db"
    settings = _clean_settings(database_url="sqlite:///" + db_path.as_posix())
    monkeypatch.setattr("app.db.session.get_settings", lambda: settings)
    reset_engine_cache()

    try:
        engine = get_engine()
        try:
            assert engine.dialect.name == "sqlite"
            assert Path(engine.url.database or "") == db_path
            with engine.connect() as connection:
                assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        finally:
            engine.dispose()
    finally:
        reset_engine_cache()


# ---------------------------------------------------------------------------
# 建库脚本（只验证不连接的失败路径）
# ---------------------------------------------------------------------------


def test_init_script_exits_2_without_credentials() -> None:
    completed = _run_script(env=_script_env())

    assert completed.returncode == 2, completed.stderr
    assert "MYSQL_ROOT_PASSWORD" in completed.stderr
    assert "MYSQL_APP_PASSWORD" in completed.stderr
    # 缺凭据必须在建立连接之前退出。
    assert "连接 MySQL 失败" not in completed.stderr
    assert completed.stdout.strip() == ""


@pytest.mark.parametrize(
    "missing",
    ["MYSQL_ROOT_PASSWORD", "MYSQL_APP_PASSWORD"],
)
def test_init_script_reports_each_missing_password(missing: str) -> None:
    env = _script_env()
    provided = {
        "MYSQL_ROOT_PASSWORD": "unit-test-only",
        "MYSQL_APP_PASSWORD": "unit-test-only",
    }
    for name, value in provided.items():
        if name != missing:
            env[name] = value

    completed = _run_script(env=env)

    assert completed.returncode == 2
    first_line = completed.stderr.splitlines()[0]
    assert first_line.startswith("缺少必需的环境变量：")
    assert missing in first_line
    # 只报告缺失的那一个（后续示例行会同时提到两个变量名）。
    other = next(name for name in provided if name != missing)
    assert other not in first_line


def test_init_script_rejects_non_identifier_database() -> None:
    env = _script_env(
        MYSQL_ROOT_PASSWORD="unit-test-only",
        MYSQL_APP_PASSWORD="unit-test-only",
    )

    completed = _run_script("--database", "bad-name;DROP", env=env)

    assert completed.returncode == 2
    assert "数据库名只能包含字母、数字与下划线" in completed.stderr
    # 标识符校验先于连接，因此不会出现驱动错误。
    assert "连接 MySQL 失败" not in completed.stderr


def test_init_script_rejects_non_identifier_app_user() -> None:
    env = _script_env(
        MYSQL_ROOT_PASSWORD="unit-test-only",
        MYSQL_APP_PASSWORD="unit-test-only",
    )

    completed = _run_script("--app-user", "bad user", env=env)

    assert completed.returncode == 2
    assert "应用账号名只能包含字母、数字与下划线" in completed.stderr


def test_init_script_cli_shape() -> None:
    completed = _run_script("--help", env=_script_env())

    assert completed.returncode == 0
    for option in ("--database", "--app-user", "--host", "--port", "--rotate-password"):
        assert option in completed.stdout


# ---------------------------------------------------------------------------
# 凭据不得进入版本库
# ---------------------------------------------------------------------------


def test_env_example_has_no_credentials() -> None:
    content = (BACKEND_DIR / ".env.example").read_text(encoding="utf-8")

    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or not stripped:
            continue
        key, _, raw_value = stripped.partition("=")
        assert not key.startswith("MYSQL_"), f".env.example 不得包含凭据行：{stripped}"
        assert raw_value == "", f".env.example 不得包含值：{stripped}"

    # 变量名与占位符必须存在，方便开发者照抄。
    assert "MYSQL_ROOT_PASSWORD=" in content
    assert "MYSQL_APP_PASSWORD=" in content
    assert "<URL编码后的应用密码>" in content


def test_env_example_keeps_sqlite_as_default() -> None:
    content = (BACKEND_DIR / ".env.example").read_text(encoding="utf-8")
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("DATABASE_URL="):
            pytest.fail(f".env.example 里的 DATABASE_URL 必须保持注释状态：{stripped}")
    assert "# DATABASE_URL=mysql+pymysql://" in content
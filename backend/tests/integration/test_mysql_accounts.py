"""真实 MySQL 8.0 上的账号集成测试（``C-INTEGRATION@1``，计划 T8）。

覆盖计划 §3.3 T8 的验收项：

- ``drop_all`` + ``create_all`` 在真实 MySQL 上建出 15 张表（12 存量 + 3 账号），
  账号三表为 ``InnoDB`` / ``utf8mb4``（``information_schema.TABLES``）；
- 中文与 emoji 在 ``users.display_name`` / ``login_identities.display_identifier``
  往返一致（utf8mb4 存储，不是 SQLite 模拟）；
- 重复 ``identifier`` 由数据库唯一约束拒绝（``IntegrityError``）；
- ``register 201 → login 200（Set-Cookie xs_auth）→ /me 200 → logout 204 → /me 401``；
- ``remember=true`` 的绝对到期约为 ``now + 720h``；
- 同一会话 5 分钟内两次 ``/me`` 不重写 ``last_seen_at``。

所有用例都通过 ``fastapi.testclient.TestClient`` 走真实 HTTP 层（数据库层约束
用例除外，它直接验证 ORM 写入），并且都依赖 ``mysql_engine``：未配置
``XIANGSHENG_MYSQL_TEST_URL`` 时整体跳过，不会退回 SQLite 伪装通过。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import account_models as account_models
from app.db.models import TABLE_NAMES
from app.schemas.common import parse_iso

pytestmark = pytest.mark.integration

#: 覆盖 15 字符下限的集成测试口令（不是真实凭据）。
PASSWORD = "mysql-integration-2026"
#: 账号 Cookie 名（``C-DB@1`` 默认值）。
AUTH_COOKIE = "xs_auth"
#: 允许的写请求来源（与默认 ``ALLOWED_ORIGINS`` 一致）。
ALLOWED_ORIGIN = "http://localhost:5173"

#: 存量业务表：9 张基线 + 3 张 P2 追加表（``shares`` / ``labs`` / ``lab_shares``）。
STORED_TABLE_NAMES: frozenset[str] = frozenset(TABLE_NAMES) | {
    "shares",
    "labs",
    "lab_shares",
}
#: 账号三表（``ACCOUNT_TABLE_NAMES``）。
ACCOUNT_TABLE_NAMES: frozenset[str] = frozenset(account_models.ACCOUNT_TABLE_NAMES)
#: ``drop_all`` + ``create_all`` 后应存在的业务表（15 张，不含 ``alembic_version``）。
EXPECTED_TABLE_NAMES: frozenset[str] = STORED_TABLE_NAMES | ACCOUNT_TABLE_NAMES


# ---------------------------------------------------------------------------
# HTTP 辅助
# ---------------------------------------------------------------------------


def _unique_email(prefix: str = "integration") -> str:
    """生成互不冲突的测试邮箱（每轮唯一，避免用例间串数据）。"""

    return f"{prefix}.{uuid4().hex}@example.com"


def _register(
    client: TestClient,
    *,
    email: str,
    password: str = PASSWORD,
    display_name: Optional[str] = None,
) -> Any:
    """调用 ``POST /api/v1/auth/register``。"""

    payload: dict[str, Any] = {"email": email, "password": password}
    if display_name is not None:
        payload["display_name"] = display_name
    return client.post("/api/v1/auth/register", json=payload)


def _login(
    client: TestClient,
    *,
    email: str,
    password: str = PASSWORD,
    remember: bool = False,
) -> Any:
    """调用 ``POST /api/v1/auth/login``。"""

    return client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password, "remember": remember},
    )


def _me(client: TestClient) -> Any:
    """调用 ``GET /api/v1/me``。"""

    return client.get("/api/v1/me")


def _logout(client: TestClient, csrf_token: str) -> Any:
    """调用 ``POST /api/v1/auth/logout``（携带 CSRF 与合法的写请求来源）。"""

    return client.post(
        "/api/v1/auth/logout",
        headers={"X-CSRF-Token": csrf_token, "Origin": ALLOWED_ORIGIN},
    )


def _read_single_session(engine: Engine) -> account_models.AuthSessionRecord:
    """读取当前唯一的 ``auth_sessions`` 行（每个用例由夹具保证只有一行）。"""

    with Session(engine) as session:
        row = session.execute(select(account_models.AuthSessionRecord)).scalars().one()
        return row


# ---------------------------------------------------------------------------
# DDL：15 张表与账号三表的引擎/字符集
# ---------------------------------------------------------------------------


def test_create_all_builds_15_tables_on_mysql(mysql_engine: Engine) -> None:
    """``drop_all`` + ``create_all`` 在 MySQL 8.0 建出 15 张业务表。

    允许 ``alembic_version`` 同时存在（它不归 ORM 元数据管理），但业务表必须
    恰好等于 12 存量 + 3 账号。
    """

    with mysql_engine.connect() as connection:
        names = set(
            connection.execute(
                text(
                    "SELECT TABLE_NAME FROM information_schema.TABLES "
                    "WHERE TABLE_SCHEMA = DATABASE()"
                )
            ).scalars()
        )

    assert len(EXPECTED_TABLE_NAMES) == 15
    assert names - {"alembic_version"} == EXPECTED_TABLE_NAMES
    assert ACCOUNT_TABLE_NAMES <= names


def test_account_tables_use_innodb_and_utf8mb4(mysql_engine: Engine) -> None:
    """账号三表必须是 ``InnoDB`` 且排序规则以 ``utf8mb4`` 开头（支持 emoji）。"""

    with mysql_engine.connect() as connection:
        rows = (
            connection.execute(
                text(
                    "SELECT TABLE_NAME, ENGINE, TABLE_COLLATION "
                    "FROM information_schema.TABLES "
                    "WHERE TABLE_SCHEMA = DATABASE() "
                    "AND TABLE_NAME IN ('users', 'login_identities', 'auth_sessions')"
                )
            )
            .mappings()
            .all()
        )

    status = {row["TABLE_NAME"]: (row["ENGINE"], row["TABLE_COLLATION"]) for row in rows}
    assert set(status) == set(ACCOUNT_TABLE_NAMES)
    for table_name, (engine_name, collation) in status.items():
        assert engine_name == "InnoDB", f"{table_name} 引擎为 {engine_name}"
        assert collation.startswith("utf8mb4"), f"{table_name} 排序规则为 {collation}"


# ---------------------------------------------------------------------------
# 数据层：utf8mb4 往返与唯一约束
# ---------------------------------------------------------------------------


def test_chinese_and_emoji_roundtrip_through_mysql(
    client: TestClient, mysql_engine: Engine
) -> None:
    """中文与 emoji 在展示名和登录标识上原样往返（真实 utf8mb4 列）。"""

    email = "象生🎉.集成@example.com"
    display_name = "象生🎉集成账号"

    response = _register(client, email=email, display_name=display_name)

    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["email"] == email
    assert data["display_name"] == display_name
    assert data["user_id"].startswith("usr_")

    with Session(mysql_engine) as session:
        user = session.get(account_models.UserRecord, data["user_id"])
        identity = session.execute(
            select(account_models.LoginIdentityRecord).where(
                account_models.LoginIdentityRecord.user_id == data["user_id"]
            )
        ).scalars().one()

    assert user is not None
    assert user.display_name == display_name
    assert identity.display_identifier == email
    assert identity.identifier == email.casefold()

    login = _login(client, email=email)
    assert login.status_code == 200, login.text
    assert login.json()["data"]["user"]["display_name"] == display_name
    assert login.json()["data"]["user"]["email"] == email


def test_duplicate_identifier_raises_integrity_error(mysql_engine: Engine) -> None:
    """重复的 ``(provider, issuer, identifier)`` 由数据库唯一约束拒绝。"""

    identifier = "duplicate.integration@example.com"
    moment = account_models.utc_now()

    with Session(mysql_engine) as session:
        first = account_models.UserRecord(
            id=account_models.new_user_id(),
            display_name="first",
            status="active",
            platform_role=account_models.DEFAULT_PLATFORM_ROLE,
            created_at=moment,
            deleted_at=None,
        )
        second = account_models.UserRecord(
            id=account_models.new_user_id(),
            display_name="second",
            status="active",
            platform_role=account_models.DEFAULT_PLATFORM_ROLE,
            created_at=moment,
            deleted_at=None,
        )
        session.add_all([first, second])
        session.commit()

        session.add(
            account_models.LoginIdentityRecord(
                id=account_models.new_identity_id(),
                user_id=first.id,
                provider="email",
                issuer="",
                identifier=identifier,
                display_identifier=identifier,
                password_hash=None,
                verified_at=None,
                created_at=moment,
            )
        )
        session.commit()

        session.add(
            account_models.LoginIdentityRecord(
                id=account_models.new_identity_id(),
                user_id=second.id,
                provider="email",
                issuer="",
                identifier=identifier,
                display_identifier=identifier,
                password_hash=None,
                verified_at=None,
                created_at=moment,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()


# ---------------------------------------------------------------------------
# HTTP 往返：register → login → /me → logout → /me
# ---------------------------------------------------------------------------


def test_account_http_roundtrip(client: TestClient) -> None:
    """完整账号往返回路，全部经由真实 HTTP 层（Cookie / CSRF / 错误码）。"""

    email = _unique_email("roundtrip")

    register = _register(client, email=email, display_name="往返测试")
    assert register.status_code == 201, register.text
    # 注册不下发登录 Cookie（R3-5）。
    assert "set-cookie" not in register.headers
    assert client.cookies.get(AUTH_COOKIE) is None

    login = _login(client, email=email)
    assert login.status_code == 200, login.text
    cookie_header = login.headers["set-cookie"]
    assert f"{AUTH_COOKIE}=" in cookie_header
    assert "HttpOnly" in cookie_header
    assert "Path=/" in cookie_header
    assert "SameSite=lax" in cookie_header
    assert client.cookies.get(AUTH_COOKIE)

    me = _me(client)
    assert me.status_code == 200, me.text
    me_data = me.json()["data"]
    assert me_data["user"]["email"] == email
    assert me_data["session"]["session_id"].startswith("aut_")
    csrf_token = me_data["csrf_token"]
    assert csrf_token

    logout = _logout(client, csrf_token)
    assert logout.status_code == 204, logout.text
    assert logout.content == b""
    assert client.cookies.get(AUTH_COOKIE) is None

    after = _me(client)
    assert after.status_code == 401
    assert after.json()["error"]["code"] == "AUTH_REQUIRED"


def test_register_duplicate_email_returns_409(client: TestClient) -> None:
    """HTTP 层重复邮箱（大小写不敏感）返回 409，不创建第二个账号。"""

    email = _unique_email("duplicate")
    assert _register(client, email=email).status_code == 201

    response = _register(client, email=email.upper())

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "EMAIL_ALREADY_REGISTERED"


# ---------------------------------------------------------------------------
# 会话窗口：remember=true 的绝对到期与 last_seen_at 节流
# ---------------------------------------------------------------------------


def test_remember_true_uses_720_hour_absolute_window(
    client: TestClient, mysql_engine: Engine
) -> None:
    """``remember=true`` 的绝对到期约为 ``now + 720h``，且与库内行一致。"""

    email = _unique_email("remember")
    assert _register(client, email=email).status_code == 201

    login = _login(client, email=email, remember=True)
    assert login.status_code == 200, login.text
    data = login.json()["data"]

    absolute = parse_iso(data["absolute_expires_at"])
    idle = parse_iso(data["expires_at"])
    now = datetime.now(tz=timezone.utc)

    assert 719.0 <= (absolute - now).total_seconds() / 3600 <= 720.1
    assert 167.0 <= (idle - now).total_seconds() / 3600 <= 168.1
    assert "Max-Age=2592000" in login.headers["set-cookie"]

    row = _read_single_session(mysql_engine)
    row_absolute = row.absolute_expires_at.replace(tzinfo=timezone.utc)
    assert abs((row_absolute - absolute).total_seconds()) <= 1


def test_me_does_not_rewrite_last_seen_within_five_minutes(
    client: TestClient, mysql_engine: Engine
) -> None:
    """同一会话 5 分钟内两次 ``/me`` 不更新 ``last_seen_at`` / ``idle_expires_at``。"""

    email = _unique_email("lastseen")
    assert _register(client, email=email).status_code == 201
    assert _login(client, email=email).status_code == 200

    first_seen = _read_single_session(mysql_engine)
    first_last_seen = first_seen.last_seen_at
    first_idle = first_seen.idle_expires_at

    assert _me(client).status_code == 200
    assert _me(client).status_code == 200

    second_seen = _read_single_session(mysql_engine)
    assert second_seen.last_seen_at == first_last_seen
    assert second_seen.idle_expires_at == first_idle
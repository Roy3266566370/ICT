"""账号 API 端点测试（``C-AUTHAPI@1``）。

每个用例使用独立临时 SQLite 库并走真实 FastAPI 栈（``TestClient`` + 生命周期内
``init_db()``），**不连接真实 MySQL**。覆盖验收清单：

- 注册 201 / ``email_verification=disabled_development`` / 不下发 Cookie；
- 重复邮箱 409；非法邮箱与短密码 422；未知字段 422；
- 登录 200 + ``Set-Cookie`` 含 ``xs_auth`` 与 ``HttpOnly``；错误密码 401 且消息统一；
- ``suspended`` 账号 403；
- logout 正确 CSRF → 204 + 清 Cookie，第二次 401；缺/错 CSRF → 422 且会话仍有效；
  非法 Origin → 422；
- ``GET /me`` 有效 → 200 且 ``csrf_token`` 可用，无效 → 401 且 body 无账号字段；
- ``remember=true`` 的绝对到期约 720 小时；
- 5 分钟内重复 ``/me`` 不重复写 ``last_seen_at``。
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

import pytest
from sqlalchemy import func, select

# 必须在导入 ``app.main`` 之前固定测试数据库（``create_app`` 读 settings 单例）。
_TMP_DIR = Path(tempfile.mkdtemp(prefix="xiangsheng-auth-api-"))
os.environ["DATABASE_URL"] = "sqlite:///" + (_TMP_DIR / "bootstrap.db").as_posix()
os.environ["SESSION_COOKIE_SECURE"] = "false"
os.environ["ENFORCE_CSRF"] = "true"
os.environ["AUTH_COOKIE_NAME"] = "xs_auth"

from fastapi.testclient import TestClient  # noqa: E402

from app.db import account_models as am  # noqa: E402
from app.db.session import get_engine, reset_engine_cache, session_scope  # noqa: E402
from app.main import create_app  # noqa: E402
from app.schemas.common import parse_iso  # noqa: E402
from app.settings import get_settings  # noqa: E402

get_settings.cache_clear()
reset_engine_cache()

#: 注册用口令（21 个字符）。
PASSWORD = "example-password-2026"
#: 契约默认 Cookie 名（``C-DB@1``）。
AUTH_COOKIE = "xs_auth"


# ---------------------------------------------------------------------------
# 夹具与辅助
# ---------------------------------------------------------------------------


@pytest.fixture()
def client() -> Iterator[TestClient]:
    """独立数据库 + 独立应用实例；退出时清理临时库。"""

    db_path = _TMP_DIR / f"auth-{uuid4().hex}.db"
    os.environ["DATABASE_URL"] = "sqlite:///" + db_path.as_posix()
    get_settings.cache_clear()
    reset_engine_cache()

    app = create_app()
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        # Windows 下 SQLite 文件在连接池关闭前不可删除：先 dispose 再清单例。
        get_engine().dispose()
        get_settings.cache_clear()
        reset_engine_cache()
        try:
            db_path.unlink(missing_ok=True)
        except OSError:  # pragma: no cover - 句柄延迟释放时交给临时目录清理
            pass


def _register(
    client: TestClient,
    *,
    email: str = "a@example.com",
    username: str | None = None,
    password: str = PASSWORD,
    display_name: str | None = None,
) -> Any:
    # 默认用户名每次唯一，避免「重复邮箱」用例被用户名唯一约束抢先命中。
    resolved_username = username or f"user_{uuid4().hex[:8]}"
    payload: dict[str, Any] = {
        "username": resolved_username,
        "email": email,
        "password": password,
    }
    if display_name is not None:
        payload["display_name"] = display_name
    return client.post("/api/v1/auth/register", json=payload)


def _login(
    client: TestClient,
    *,
    identifier: str | None = None,
    email: str = "a@example.com",
    password: str = PASSWORD,
    remember: bool = False,
) -> Any:
    payload: dict[str, Any] = {"password": password, "remember": remember}
    if identifier is not None:
        payload["identifier"] = identifier
    else:
        payload["email"] = email
    return client.post("/api/v1/auth/login", json=payload)


def _me(client: TestClient) -> Any:
    return client.get("/api/v1/me")


def _logout(
    client: TestClient, csrf: str | None, *, origin: str | None = None
) -> Any:
    headers: dict[str, str] = {}
    if csrf is not None:
        headers["X-CSRF-Token"] = csrf
    if origin is not None:
        headers["Origin"] = origin
    return client.post("/api/v1/auth/logout", headers=headers)


def _register_and_login(client: TestClient, *, email: str = "a@example.com") -> str:
    """注册 + 登录，返回 CSRF 令牌（同时让 client 持有 ``xs_auth`` Cookie）。"""

    assert _register(client, email=email).status_code == 201
    response = _login(client, email=email)
    assert response.status_code == 200
    return str(response.json()["data"]["csrf_token"])


# ---------------------------------------------------------------------------
# POST /auth/register
# ---------------------------------------------------------------------------


def test_register_returns_201_without_cookie(client: TestClient) -> None:
    response = _register(client, username="Alice", display_name=None)

    assert response.status_code == 201
    body = response.json()
    data = body["data"]
    assert data["user_id"].startswith("usr_")
    assert data["username"] == "Alice"
    assert data["email"] == "a@example.com"
    assert data["display_name"] == "Alice"
    assert data["status"] == "active"
    assert data["email_verification"] == "disabled_development"
    assert data["created_at"].endswith("Z")
    assert body["request_id"]

    # 注册不下发登录 Cookie（R3-1）。
    assert "set-cookie" not in response.headers
    assert client.cookies.get(AUTH_COOKIE) is None


def test_register_duplicate_username_returns_409(client: TestClient) -> None:
    assert _register(client, username="Alice").status_code == 201

    response = _register(client, username="ALICE", email="other@example.com")

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "USERNAME_ALREADY_REGISTERED"
    assert error["message"] == "该用户名已被占用，请换一个"
    assert error["retryable"] is False


def test_register_duplicate_email_returns_409(client: TestClient) -> None:
    assert _register(client, email="dup@example.com").status_code == 201

    response = _register(client, email="DUP@Example.com")

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "EMAIL_ALREADY_REGISTERED"
    assert error["message"] == "该邮箱已注册，可直接登录"
    assert error["retryable"] is False


@pytest.mark.parametrize(
    "payload",
    [
        {"username": "alice", "email": "not-an-email", "password": PASSWORD},
        {"username": "alice", "email": "a@example.com", "password": "short"},
        {"username": "alice", "email": "a@example.com"},
        {"email": "a@example.com", "password": PASSWORD},
        {"username": "ab", "email": "a@example.com", "password": PASSWORD},
        {"username": "1alice", "email": "a@example.com", "password": PASSWORD},
        {"username": "ali ce", "email": "a@example.com", "password": PASSWORD},
        {"username": "alice", "email": "a@example.com", "password": PASSWORD, "unknown": True},
        {"username": "alice", "email": "a@example.com", "password": PASSWORD, "display_name": "x" * 65},
    ],
)
def test_register_invalid_payload_returns_422(
    client: TestClient, payload: dict[str, Any]
) -> None:
    response = client.post("/api/v1/auth/register", json=payload)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "MISSING_FIELD"


# ---------------------------------------------------------------------------
# POST /auth/login
# ---------------------------------------------------------------------------


def test_login_sets_httponly_auth_cookie(client: TestClient) -> None:
    _register(client, username="alice")

    response = _login(client)

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["user"]["username"] == "alice"
    assert data["user"]["email"] == "a@example.com"
    assert data["csrf_token"]
    assert data["expires_at"] <= data["absolute_expires_at"]  # 同格式 ISO 可直接比较

    cookie_header = response.headers["set-cookie"]
    assert f"{AUTH_COOKIE}=" in cookie_header
    assert "HttpOnly" in cookie_header
    assert "Max-Age=86400" in cookie_header
    assert "Path=/" in cookie_header
    assert "SameSite=lax" in cookie_header
    assert client.cookies.get(AUTH_COOKIE)


def test_login_accepts_username_case_insensitively(client: TestClient) -> None:
    _register(client, username="Alice")

    response = _login(client, identifier="  ALICE  ")

    assert response.status_code == 200
    assert response.json()["data"]["user"]["username"] == "Alice"
    assert client.cookies.get(AUTH_COOKIE)


def test_login_wrong_password_and_unknown_identifier_share_message(client: TestClient) -> None:
    _register(client, username="alice")

    wrong = _login(client, identifier="alice", password="wrong-password-2026")
    unknown = _login(client, identifier="nobody")

    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert unknown.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert wrong.json()["error"]["message"] == unknown.json()["error"]["message"]
    assert wrong.json()["error"]["message"] == "用户名或密码不正确"


def test_login_suspended_account_returns_403(client: TestClient) -> None:
    _register(client, username="susp", email="susp@example.com")
    with session_scope() as db:
        identity = db.execute(
            select(am.LoginIdentityRecord).where(
                am.LoginIdentityRecord.identifier == "susp@example.com"
            )
        ).scalars().first()
        assert identity is not None
        user = db.get(am.UserRecord, identity.user_id)
        assert user is not None
        user.status = "suspended"

    response = _login(client, email="susp@example.com")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"
    assert response.json()["error"]["message"] == "账号不可用，请联系管理员"
    assert client.cookies.get(AUTH_COOKIE) is None


def test_login_remember_uses_720_hour_absolute_window(client: TestClient) -> None:
    _register(client)

    response = _login(client, remember=True)

    assert response.status_code == 200
    data = response.json()["data"]
    absolute = parse_iso(data["absolute_expires_at"])
    idle = parse_iso(data["expires_at"])
    now = datetime.now(tz=timezone.utc)

    assert 719.0 <= (absolute - now).total_seconds() / 3600 <= 720.1
    assert 167.0 <= (idle - now).total_seconds() / 3600 <= 168.1
    assert "Max-Age=2592000" in response.headers["set-cookie"]


# ---------------------------------------------------------------------------
# POST /auth/logout
# ---------------------------------------------------------------------------


def test_logout_with_valid_csrf_clears_cookie_and_second_call_is_401(
    client: TestClient,
) -> None:
    csrf = _register_and_login(client)

    first = _logout(client, csrf)

    assert first.status_code == 204
    assert first.content == b""
    cookie_header = first.headers["set-cookie"]
    assert f'{AUTH_COOKIE}=""' in cookie_header
    assert "Max-Age=0" in cookie_header
    assert client.cookies.get(AUTH_COOKIE) is None

    second = _logout(client, csrf)

    assert second.status_code == 401
    assert second.json()["error"]["code"] == "AUTH_REQUIRED"


def test_logout_without_csrf_returns_422_and_keeps_session(client: TestClient) -> None:
    csrf = _register_and_login(client)

    response = _logout(client, None)

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "MISSING_FIELD"
    assert error["details"]["header"] == "X-CSRF-Token"

    # 会话仍有效（CSRF 失败不得撤销会话）。
    me = _me(client)
    assert me.status_code == 200
    assert me.json()["data"]["csrf_token"] == csrf


def test_logout_with_wrong_csrf_returns_422_and_keeps_session(client: TestClient) -> None:
    _register_and_login(client)

    response = _logout(client, "forged-csrf-value")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "MISSING_FIELD"
    assert _me(client).status_code == 200


def test_logout_rejects_foreign_origin(client: TestClient) -> None:
    csrf = _register_and_login(client)

    response = _logout(client, csrf, origin="https://evil.example.com")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "MISSING_FIELD"
    assert _me(client).status_code == 200


def test_logout_accepts_allowed_origin(client: TestClient) -> None:
    csrf = _register_and_login(client)

    response = _logout(client, csrf, origin="http://localhost:5173")

    assert response.status_code == 204


# ---------------------------------------------------------------------------
# GET /me
# ---------------------------------------------------------------------------


def test_me_returns_user_session_and_usable_csrf(client: TestClient) -> None:
    assert _register(client, username="alice", display_name="Alice Example").status_code == 201
    login = _login(client)
    assert login.status_code == 200

    response = _me(client)

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["user"]["username"] == "alice"
    assert data["user"]["email"] == "a@example.com"
    assert data["user"]["display_name"] == "Alice Example"
    assert data["user"]["email_verification"] == "disabled_development"
    assert data["session"]["session_id"].startswith("aut_")
    assert data["session"]["expires_at"] == data["session"]["idle_expires_at"]
    assert data["csrf_token"] == login.json()["data"]["csrf_token"]

    # ``/me`` 返回的 CSRF 必须能直接用于写请求。
    assert _logout(client, data["csrf_token"]).status_code == 204


def test_me_without_cookie_returns_401_without_account_fields(client: TestClient) -> None:
    response = _me(client)

    assert response.status_code == 401
    body = response.json()
    assert set(body) == {"error", "request_id"}
    assert body["error"]["code"] == "AUTH_REQUIRED"
    assert body["error"]["message"] == "请先登录"
    assert set(body["error"]) <= {"code", "message", "retryable", "details"}
    assert "data" not in body
    assert "user" not in json.dumps(body)
    assert "csrf_token" not in json.dumps(body)


def test_me_with_forged_cookie_returns_401(client: TestClient) -> None:
    client.cookies.set(AUTH_COOKIE, "forged-raw-token")

    response = _me(client)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


def test_me_does_not_rewrite_last_seen_within_five_minutes(client: TestClient) -> None:
    _register_and_login(client)

    with session_scope() as db:
        row = db.execute(select(am.AuthSessionRecord)).scalars().first()
        assert row is not None
        first_seen = row.last_seen_at
        first_idle = row.idle_expires_at

    for _ in range(3):
        assert _me(client).status_code == 200

    with session_scope() as db:
        row = db.execute(select(am.AuthSessionRecord)).scalars().first()
        assert row is not None
        assert row.last_seen_at == first_seen
        assert row.idle_expires_at == first_idle


def test_me_after_logout_returns_401(client: TestClient) -> None:
    csrf = _register_and_login(client)
    assert _logout(client, csrf).status_code == 204

    response = _me(client)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"

# ---------------------------------------------------------------------------
# R7-6：register / login 的写请求 Origin 校验（Phase F 复核阻断项修复）
# ---------------------------------------------------------------------------


def _count_rows(model: type[Any]) -> int:
    """统计账号相关表的行数，用于验证被拒绝的请求没有任何副作用。"""

    with session_scope() as db:
        return int(db.execute(select(func.count()).select_from(model)).scalar_one())


def test_register_rejects_disallowed_origin_without_side_effects(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/v1/auth/register",
        headers={"Origin": "http://evil.example.com"},
        json={"username": "evil", "email": "evil@example.com", "password": PASSWORD},
    )

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "MISSING_FIELD"
    assert "来源" in error["message"]
    # 拒绝发生在业务服务之前：库内不得新增 users / login_identities。
    assert _count_rows(am.UserRecord) == 0
    assert _count_rows(am.LoginIdentityRecord) == 0


def test_login_rejects_disallowed_origin_without_session(client: TestClient) -> None:
    assert _register(client, email="login-origin@example.com").status_code == 201

    response = client.post(
        "/api/v1/auth/login",
        headers={"Origin": "http://evil.example.com"},
        json={"identifier": "login-origin@example.com", "password": PASSWORD},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "MISSING_FIELD"
    assert "set-cookie" not in response.headers
    assert client.cookies.get(AUTH_COOKIE) is None
    # 拒绝发生在签发之前：不得留下 auth_sessions 行。
    assert _count_rows(am.AuthSessionRecord) == 0


def test_register_with_allowed_origin_still_succeeds(client: TestClient) -> None:
    allowed = get_settings().allowed_origins[0]
    response = client.post(
        "/api/v1/auth/register",
        headers={"Origin": allowed},
        json={"username": "allowed", "email": "allowed@example.com", "password": PASSWORD},
    )

    assert response.status_code == 201
    assert response.json()["data"]["email"] == "allowed@example.com"


def test_login_with_allowed_origin_still_issues_cookie(client: TestClient) -> None:
    assert _register(client, email="allowed-login@example.com").status_code == 201
    allowed = get_settings().allowed_origins[0]

    response = client.post(
        "/api/v1/auth/login",
        headers={"Origin": allowed},
        json={"identifier": "allowed-login@example.com", "password": PASSWORD},
    )

    assert response.status_code == 200
    assert f"{AUTH_COOKIE}=" in response.headers["set-cookie"]
    assert client.cookies.get(AUTH_COOKIE)


def test_register_without_origin_remains_supported(client: TestClient) -> None:
    """curl / 服务端调用不带 Origin：不参与判定，保持向后兼容。"""

    response = _register(client, email="no-origin@example.com")

    assert response.status_code == 201


def test_login_without_origin_remains_supported(client: TestClient) -> None:
    assert _register(client, email="no-origin-login@example.com").status_code == 201

    response = _login(client, email="no-origin-login@example.com")

    assert response.status_code == 200
    assert client.cookies.get(AUTH_COOKIE)
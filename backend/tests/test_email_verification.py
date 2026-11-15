"""注册邮箱验证码测试（有效期、重发节流、尝试上限、一次性作废）。

每个用例使用独立临时 SQLite 库并走真实 FastAPI 栈；Brevo 发送被替换为
内存捕获，测试既不会联网，也不会把真实验证码写进日志。
"""

from __future__ import annotations

import os
import tempfile
from datetime import timedelta
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

import pytest
from sqlalchemy import select

# 必须在导入 ``app.main`` 之前固定测试数据库与空 Brevo 配置。
_TMP_DIR = Path(tempfile.mkdtemp(prefix="xiangsheng-email-code-"))
os.environ["DATABASE_URL"] = "sqlite:///" + (_TMP_DIR / "bootstrap.db").as_posix()
os.environ["SESSION_COOKIE_SECURE"] = "false"
os.environ["ENFORCE_CSRF"] = "true"
os.environ["AUTH_COOKIE_NAME"] = "xs_auth"
os.environ["BREVO_API_KEY"] = ""
os.environ["BREVO_SENDER_EMAIL"] = ""

from fastapi.testclient import TestClient  # noqa: E402

from app.accounts import verification  # noqa: E402
from app.accounts.verification import (  # noqa: E402
    build_brevo_payload,
    consume_registration_code,
)
from app.db import account_models as am  # noqa: E402
from app.db.session import get_engine, reset_engine_cache, session_scope  # noqa: E402
from app.main import create_app  # noqa: E402
from app.schemas.errors import ApiError, ErrorCode  # noqa: E402
from app.settings import get_settings  # noqa: E402

get_settings.cache_clear()
reset_engine_cache()

PASSWORD = "example-password-2026"
#: 真实发送函数；「未配置 Brevo」用例需要临时恢复它。
REAL_SENDER = verification.send_verification_code_email
#: 验证码捕获：规范化邮箱 → 明文验证码。
_CODES: dict[str, str] = {}


@pytest.fixture(autouse=True)
def _capture_verification_codes(monkeypatch: pytest.MonkeyPatch) -> None:
    _CODES.clear()

    def _capture(*, email: str, code: str, ttl_seconds: int) -> None:
        _CODES[email.strip().casefold()] = code

    monkeypatch.setattr(verification, "send_verification_code_email", _capture)


@pytest.fixture()
def client() -> Iterator[TestClient]:
    db_path = _TMP_DIR / f"email-code-{uuid4().hex}.db"
    os.environ["DATABASE_URL"] = "sqlite:///" + db_path.as_posix()
    get_settings.cache_clear()
    reset_engine_cache()

    app = create_app()
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        get_engine().dispose()
        get_settings.cache_clear()
        reset_engine_cache()
        try:
            db_path.unlink(missing_ok=True)
        except OSError:  # pragma: no cover - 句柄延迟释放时交给临时目录清理
            pass


def send_code(client: TestClient, email: str = "a@example.com") -> Any:
    return client.post("/api/v1/auth/register/code", json={"email": email})


def register(
    client: TestClient,
    *,
    email: str = "a@example.com",
    username: str | None = None,
    code: str | None = None,
) -> Any:
    return client.post(
        "/api/v1/auth/register",
        json={
            "username": username or f"user_{uuid4().hex[:8]}",
            "email": email,
            "password": PASSWORD,
            "verification_code": code if code is not None else _CODES[email.strip().casefold()],
        },
    )


def code_rows() -> list[am.EmailVerificationCodeRecord]:
    with session_scope() as db:
        return list(
            db.execute(
                select(am.EmailVerificationCodeRecord).order_by(
                    am.EmailVerificationCodeRecord.created_at
                )
            ).scalars()
        )


def test_send_code_returns_policy_and_stores_only_a_hash(client: TestClient) -> None:
    response = send_code(client, "Alice@Example.com")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data == {
        "email": "Alice@Example.com",
        "expires_in_seconds": 300,
        "resend_after_seconds": 60,
    }
    code = _CODES["alice@example.com"]
    assert code.isdigit() and len(code) == 6
    # 响应体不得回显验证码。
    assert code not in response.text

    rows = code_rows()
    assert len(rows) == 1
    row = rows[0]
    assert row.id.startswith("evc_")
    assert row.email == "alice@example.com"
    assert row.purpose == "register"
    assert row.code_hash != code
    assert len(row.code_hash) == 64
    assert row.attempts == 0
    assert row.consumed_at is None
    assert (row.expires_at - row.created_at).total_seconds() == 300


def test_registration_with_correct_code_marks_email_verified(client: TestClient) -> None:
    assert send_code(client).status_code == 200

    response = register(client, username="alice")

    assert response.status_code == 201, response.text
    assert response.json()["data"]["email_verification"] == "verified"
    with session_scope() as db:
        identity = db.execute(
            select(am.LoginIdentityRecord).where(
                am.LoginIdentityRecord.provider == "email",
                am.LoginIdentityRecord.identifier == "a@example.com",
            )
        ).scalars().one()
        assert identity.verified_at is not None
    assert code_rows()[0].consumed_at is not None


def test_second_send_within_60_seconds_is_rate_limited(client: TestClient) -> None:
    assert send_code(client).status_code == 200

    response = send_code(client)

    assert response.status_code == 429
    error = response.json()["error"]
    assert error["code"] == "RATE_LIMITED"
    retry_after = error["details"]["retry_after_seconds"]
    assert 1 <= retry_after <= 60
    assert len(code_rows()) == 1


def test_resend_after_interval_replaces_the_previous_code(client: TestClient) -> None:
    assert send_code(client).status_code == 200
    old_code = _CODES["a@example.com"]
    with session_scope() as db:
        row = db.execute(select(am.EmailVerificationCodeRecord)).scalars().one()
        row.created_at = am.utc_now() - timedelta(seconds=61)

    assert send_code(client).status_code == 200
    new_code = _CODES["a@example.com"]
    assert len(code_rows()) == 2

    stale = register(client, username="alice", code=old_code)
    assert stale.status_code == 422
    assert stale.json()["error"]["details"]["field"] == "verification_code"

    accepted = register(client, username="alice", code=new_code)
    assert accepted.status_code == 201, accepted.text


def test_wrong_code_counts_down_and_fifth_attempt_locks(client: TestClient) -> None:
    assert send_code(client).status_code == 200
    correct = _CODES["a@example.com"]

    for remaining in range(4, 0, -1):
        response = register(client, code="000000")
        assert response.status_code == 422
        error = response.json()["error"]
        assert error["details"]["attempts_left"] == remaining
        assert f"还可尝试 {remaining} 次" in error["message"]

    locked = register(client, code="000000")
    assert locked.status_code == 429
    assert locked.json()["error"]["code"] == "RATE_LIMITED"

    # 尝试次数超限后，即使输入正确验证码也不能继续。
    after_lock = register(client, code=correct)
    assert after_lock.status_code == 422
    assert "已失效" in after_lock.json()["error"]["message"]
    row = code_rows()[0]
    assert row.attempts == 5
    assert row.consumed_at is not None


def test_expired_code_is_rejected_and_consumed(client: TestClient) -> None:
    assert send_code(client).status_code == 200
    code = _CODES["a@example.com"]
    with session_scope() as db:
        row = db.execute(select(am.EmailVerificationCodeRecord)).scalars().one()
        row.expires_at = am.utc_now() - timedelta(seconds=1)

    response = register(client, code=code)

    assert response.status_code == 422
    assert "已过期" in response.json()["error"]["message"]
    assert code_rows()[0].consumed_at is not None


def test_successful_code_cannot_be_reused(client: TestClient) -> None:
    assert send_code(client).status_code == 200
    code = _CODES["a@example.com"]
    assert register(client).status_code == 201

    with session_scope() as db:
        with pytest.raises(ApiError) as info:
            consume_registration_code(db, email="a@example.com", code=code)

    assert info.value.code == ErrorCode.MISSING_FIELD
    assert "已失效" in info.value.message


def test_code_is_bound_to_the_requested_email(client: TestClient) -> None:
    assert send_code(client, "a@example.com").status_code == 200
    code = _CODES["a@example.com"]

    response = register(client, email="b@example.com", code=code)

    assert response.status_code == 422
    assert "请先获取邮箱验证码" in response.json()["error"]["message"]


def test_send_code_to_registered_email_returns_409(client: TestClient) -> None:
    assert send_code(client).status_code == 200
    assert register(client).status_code == 201

    response = send_code(client)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "EMAIL_ALREADY_REGISTERED"


def test_missing_brevo_config_returns_503_and_allows_immediate_retry(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 临时恢复真实发送函数：测试环境未配置 Brevo 凭据，必然发送失败。
    monkeypatch.setattr(verification, "send_verification_code_email", REAL_SENDER)

    failed = send_code(client)

    assert failed.status_code == 503
    assert failed.json()["error"]["code"] == "MODEL_UNAVAILABLE"
    assert code_rows()[0].consumed_at is not None

    # 发送失败不应把用户锁在 60 秒重发节流里。
    def _capture(*, email: str, code: str, ttl_seconds: int) -> None:
        _CODES[email.strip().casefold()] = code

    monkeypatch.setattr(verification, "send_verification_code_email", _capture)
    assert send_code(client).status_code == 200


def test_send_code_rejects_invalid_email_and_foreign_origin(client: TestClient) -> None:
    invalid = send_code(client, "not-an-email")
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "MISSING_FIELD"

    foreign = client.post(
        "/api/v1/auth/register/code",
        headers={"Origin": "https://evil.example.com"},
        json={"email": "a@example.com"},
    )
    assert foreign.status_code == 422
    assert code_rows() == []


def test_register_requires_six_digit_verification_code(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/register",
        json={"username": "alice", "email": "a@example.com", "password": PASSWORD},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "MISSING_FIELD"


def test_brevo_payload_contains_sender_recipient_and_ttl() -> None:
    payload = build_brevo_payload(
        recipient="alice@example.com",
        code="123456",
        sender_email="noreply@example.com",
        sender_name="万象",
        ttl_seconds=300,
    )

    assert payload["sender"] == {"name": "万象", "email": "noreply@example.com"}
    assert payload["to"] == [{"email": "alice@example.com"}]
    assert "123456" in payload["htmlContent"]
    assert "123456" in payload["textContent"]
    assert "5 分钟" in payload["textContent"]
    assert payload["subject"] == "万象账号注册验证码"

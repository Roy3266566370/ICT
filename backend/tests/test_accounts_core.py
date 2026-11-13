"""账号领域服务单测（``C-AUTHSVC@1`` + ``C-ERR@2`` 追加校验）。

全部在**临时 SQLite** 上执行（每个用例独立库文件），不连接真实 MySQL：

- 密码：Argon2id PHC 形状、校验分支、dummy 等价耗时路径；
- 邮箱规范化与密码策略：契约列出的每条规则各一条用例；
- 会话：窗口、签发、解析、5 分钟节流、滑动跨度、过期/撤销、CSRF 比较；
- 用例：注册（含 ``users`` 先 ``flush()`` 的 INSERT 顺序）、重复邮箱、
  ``IntegrityError`` 转 409 且回滚、认证的 6 个分支、渐进重哈希；
- ``C-ERR@2``：既有 8 码顺序不变、6 个新码映射正确且均不可重试。
"""

from __future__ import annotations

import os
import tempfile
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path
from typing import Iterator

import pytest
from argon2 import PasswordHasher
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app import accounts as accounts_pkg
from app.accounts import (
    PasswordVerification,
    authenticate,
    create_auth_session,
    find_email_identity,
    find_username_identity,
    get_active_user,
    hash_password,
    hash_token,
    normalize_email,
    normalize_username,
    register_account,
    resolve_auth_session,
    revoke_auth_session,
    session_windows,
    validate_password_policy,
    verify_csrf,
    verify_dummy_password,
    verify_password,
)
from app.accounts import service as service_module
from app.db import account_models as am
from app.db.base import Base
from app.schemas.errors import HTTP_STATUS, RETRYABLE_CODES, ApiError, ErrorCode
from app.settings import Settings

#: 注册用口令（21 个字符，满足 8–128 策略）。
PASSWORD = "example-password-2026"
#: 固定临时目录；每个用例在其下新建独立的 ``.db`` 文件。
_TMP_DIR = Path(tempfile.mkdtemp(prefix="xiangsheng-accounts-core-"))


# ---------------------------------------------------------------------------
# 夹具
# ---------------------------------------------------------------------------


def _enable_foreign_keys(engine: Engine) -> None:
    """SQLite 默认不校验外键；显式打开，验证 flush 顺序与 FK 真实生效。"""

    @event.listens_for(engine, "connect")
    def _set_pragma(dbapi_connection: object, _connection_record: object) -> None:
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
        finally:
            cursor.close()


@contextmanager
def _fresh_session() -> Iterator[tuple[Session, Engine]]:
    """打开一个全新 SQLite 库并建好 15 张表；退出时销毁引擎。"""

    handle, path = tempfile.mkstemp(suffix=".db", dir=_TMP_DIR)
    os.close(handle)
    engine = create_engine("sqlite:///" + Path(path).as_posix(), future=True)
    _enable_foreign_keys(engine)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    session = factory()
    try:
        yield session, engine
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def db() -> Iterator[Session]:
    """每个用例独立会话（独立库文件），互不污染。"""

    with _fresh_session() as (session, _engine):
        yield session


def _make_user(db: Session, *, display_name: str = "测试用户") -> am.UserRecord:
    """只建 ``users`` 行（会话类用例不需要登录身份）。"""

    user = am.UserRecord(
        id=am.new_user_id(),
        display_name=display_name,
        status="active",
        platform_role="user",
        created_at=am.utc_now(),
    )
    db.add(user)
    db.commit()
    return user


def _count_users(db: Session) -> int:
    return int(db.execute(select(func.count()).select_from(am.UserRecord)).scalar_one())


# ---------------------------------------------------------------------------
# 密码（passwords.py）
# ---------------------------------------------------------------------------


def test_hash_password_uses_contract_argon2id_parameters() -> None:
    digest = hash_password(PASSWORD)
    assert digest.startswith("$argon2id$v=19$")
    assert "$m=19456,t=2,p=1$" in digest


def test_verify_password_distinguishes_mismatch_and_broken_hash() -> None:
    digest = hash_password(PASSWORD)
    assert verify_password(PASSWORD, digest) == PasswordVerification(True, False)

    mismatch = verify_password("another-password-2026", digest)
    assert (mismatch.valid, mismatch.needs_rehash) == (False, False)

    broken = verify_password(PASSWORD, "not-a-phc-string")
    assert (broken.valid, broken.needs_rehash) == (False, True)


def test_verify_dummy_password_consumes_time_without_raising() -> None:
    # 只验证"不抛异常"；耗时等价性无法在单测中稳定度量。
    verify_dummy_password("任意口令 with spaces")
    verify_dummy_password("")


# ---------------------------------------------------------------------------
# 邮箱规范化与密码策略（identities.py）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "display", "identifier"),
    [
        ("  Alice@Example.COM ", "Alice@Example.COM", "alice@example.com"),
        ("first.last+tag@sub.example.cn", "first.last+tag@sub.example.cn", "first.last+tag@sub.example.cn"),
        ("本地@例子.中国", "本地@例子.中国", "本地@例子.中国"),
    ],
)
def test_normalize_email_keeps_display_and_casefolds_identifier(
    raw: str, display: str, identifier: str
) -> None:
    normalized = normalize_email(raw)
    assert normalized.display == display
    assert normalized.identifier == identifier


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "ab",
        "no-at-sign.example.com",
        "two@@example.com",
        "a b@example.com",
        "a@example",
        "a@example.c",
        "a@.example.com",
        "a@example..com",
        "a@example.com " + "x" * 400,
        "a" * 65 + "@example.com",
    ],
)
def test_normalize_email_rejects_invalid_shapes(raw: str) -> None:
    with pytest.raises(ApiError) as info:
        normalize_email(raw)
    error = info.value
    assert error.code == ErrorCode.MISSING_FIELD
    assert error.status_code == 422
    assert "email" in (error.details or {}).get("field", "email")


@pytest.mark.parametrize(
    ("password", "accepted"),
    [
        ("x" * 7, False),
        ("x" * 8, True),
        ("x" * 128, True),
        ("x" * 129, False),
        ("密码 with 空格 " * 2, True),
        ("", False),
    ],
)
def test_validate_password_policy_enforces_8_to_128(
    password: str, accepted: bool
) -> None:
    if accepted:
        validate_password_policy(password)
        return
    with pytest.raises(ApiError) as info:
        validate_password_policy(password)
    assert info.value.code == ErrorCode.MISSING_FIELD
    assert info.value.status_code == 422
    assert "password" == (info.value.details or {}).get("field")


# ---------------------------------------------------------------------------
# 用户名规范化（identities.py）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "display", "identifier"),
    [
        ("  Alice_01 ", "Alice_01", "alice_01"),
        ("林老师", "林老师", "林老师"),
        ("student-a", "student-a", "student-a"),
        ("王小明2026", "王小明2026", "王小明2026"),
    ],
)
def test_normalize_username_keeps_display_and_casefolds_identifier(
    raw: str, display: str, identifier: str
) -> None:
    normalized = normalize_username(raw)
    assert normalized.display == display
    assert normalized.identifier == identifier


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "ab",
        "a" * 21,
        "1alice",
        "_alice",
        "-alice",
        "ali ce",
        "alice@example.com",
        "alice.bob",
        "alice!",
    ],
)
def test_normalize_username_rejects_invalid_shapes(raw: str) -> None:
    with pytest.raises(ApiError) as info:
        normalize_username(raw)
    error = info.value
    assert error.code == ErrorCode.MISSING_FIELD
    assert error.status_code == 422
    assert error.details == {"field": "username"}


# ---------------------------------------------------------------------------
# 会话（sessions.py）
# ---------------------------------------------------------------------------


def test_session_windows_follow_settings_defaults() -> None:
    assert session_windows(False) == (timedelta(hours=12), timedelta(hours=24))
    assert session_windows(True) == (timedelta(hours=168), timedelta(hours=720))


def test_create_auth_session_persists_only_digests(db: Session) -> None:
    user = _make_user(db)
    created = create_auth_session(
        db, user_id=user.id, remember=False, device_label="Mozilla/5.0 " + "x" * 100
    )

    assert created.row.id.startswith("aut_")
    assert created.row.user_id == user.id
    # 明文只存在于返回值，库里只能是 SHA-256 摘要。
    assert created.row.token_hash == hash_token(created.raw_token)
    assert created.row.csrf_token_hash == hash_token(created.csrf_token)
    assert created.raw_token not in (created.row.token_hash, created.row.csrf_token_hash)
    assert len(created.row.device_label or "") == 64
    assert created.row.created_at == created.row.last_seen_at
    assert created.row.idle_expires_at - created.row.created_at == timedelta(hours=12)
    assert created.row.absolute_expires_at - created.row.created_at == timedelta(hours=24)


def test_create_auth_session_omits_missing_device_label(db: Session) -> None:
    user = _make_user(db)
    created = create_auth_session(db, user_id=user.id, remember=False, device_label=None)
    assert created.row.device_label is None


def test_resolve_auth_session_returns_row(db: Session) -> None:
    user = _make_user(db)
    now = am.utc_now()
    created = create_auth_session(db, user_id=user.id, remember=False, now=now)

    row = resolve_auth_session(db, created.raw_token, now=now + timedelta(minutes=1))
    assert row.id == created.row.id


def test_resolve_auth_session_skips_touch_within_five_minutes(db: Session) -> None:
    user = _make_user(db)
    now = am.utc_now()
    created = create_auth_session(db, user_id=user.id, remember=False, now=now)
    seen = created.row.last_seen_at
    idle = created.row.idle_expires_at

    row = resolve_auth_session(db, created.raw_token, now=now + timedelta(minutes=4, seconds=59))
    assert row.last_seen_at == seen
    assert row.idle_expires_at == idle


def test_resolve_auth_session_slides_by_remember_span_not_config(db: Session) -> None:
    """记住我会话的滑动跨度必须是 168h，而不是被普通 12h 窗口缩短。"""

    user = _make_user(db)
    now = am.utc_now()
    created = create_auth_session(db, user_id=user.id, remember=True, now=now)
    absolute = created.row.absolute_expires_at

    later = now + timedelta(hours=100)
    row = resolve_auth_session(db, created.raw_token, now=later)
    assert row.idle_expires_at - row.last_seen_at == timedelta(hours=168)
    assert row.idle_expires_at <= absolute
    assert row.last_seen_at == later


def test_resolve_auth_session_enforces_absolute_expiry(db: Session) -> None:
    user = _make_user(db)
    now = am.utc_now()
    created = create_auth_session(db, user_id=user.id, remember=False, now=now)
    # 人工把空闲窗口拉长到绝对窗口之外，验证绝对上限独立生效。
    created.row.idle_expires_at = now + timedelta(hours=48)
    db.commit()

    with pytest.raises(ApiError) as info:
        resolve_auth_session(db, created.raw_token, now=now + timedelta(hours=25))
    assert info.value.code == ErrorCode.AUTH_REQUIRED
    assert info.value.status_code == 401


@pytest.mark.parametrize("token", [None, "", "forged-token"])
def test_resolve_auth_session_rejects_missing_or_unknown_token(
    db: Session, token: str | None
) -> None:
    with pytest.raises(ApiError) as info:
        resolve_auth_session(db, token)
    assert info.value.code == ErrorCode.AUTH_REQUIRED
    assert info.value.status_code == 401


def test_resolve_auth_session_rejects_expired_and_revoked(db: Session) -> None:
    user = _make_user(db)
    now = am.utc_now()

    expired = create_auth_session(db, user_id=user.id, remember=False, now=now)
    with pytest.raises(ApiError):
        resolve_auth_session(db, expired.raw_token, now=now + timedelta(hours=13))

    revoked = create_auth_session(db, user_id=user.id, remember=False, now=now)
    revoke_auth_session(db, revoked.row, now=now)
    with pytest.raises(ApiError):
        resolve_auth_session(db, revoked.raw_token, now=now + timedelta(minutes=1))


def test_revoke_auth_session_is_idempotent(db: Session) -> None:
    user = _make_user(db)
    now = am.utc_now()
    created = create_auth_session(db, user_id=user.id, remember=False, now=now)

    revoke_auth_session(db, created.row, now=now)
    first = created.row.revoked_at
    revoke_auth_session(db, created.row, now=now + timedelta(hours=1))
    assert created.row.revoked_at == first


def test_verify_csrf_matches_token_and_rejects_blank(db: Session) -> None:
    user = _make_user(db)
    created = create_auth_session(db, user_id=user.id, remember=False)

    assert verify_csrf(created.row, created.csrf_token) is True
    assert verify_csrf(created.row, "") is False
    assert verify_csrf(created.row, created.raw_token) is False


# ---------------------------------------------------------------------------
# 用例：注册 / 认证（service.py）
# ---------------------------------------------------------------------------


def test_register_account_creates_user_and_both_identities(db: Session) -> None:
    user = register_account(
        db,
        username="  Alice_01 ",
        email="  Alice@Example.COM ",
        password=PASSWORD,
    )

    assert user.id.startswith("usr_")
    assert user.display_name == "Alice_01"  # 缺省取用户名的原始大小写
    assert user.status == "active"
    assert user.platform_role == "user"
    assert user.deleted_at is None

    identity = find_email_identity(db, user.id)
    assert identity is not None
    assert identity.provider == "email"
    assert identity.issuer == ""
    assert identity.identifier == "alice@example.com"
    assert identity.display_identifier == "Alice@Example.COM"
    assert identity.password_hash is not None
    assert identity.password_hash.startswith("$argon2id$v=19$")
    assert identity.verified_at is None

    username_identity = find_username_identity(db, user.id)
    assert username_identity is not None
    assert username_identity.provider == "username"
    assert username_identity.identifier == "alice_01"
    assert username_identity.display_identifier == "Alice_01"
    # 同一账号的两条身份共用一份密码摘要
    assert username_identity.password_hash == identity.password_hash


def test_register_account_honours_explicit_display_name(db: Session) -> None:
    user = register_account(
        db,
        username="bob",
        email="bob@example.com",
        password=PASSWORD,
        display_name="  鲍勃  ",
    )
    assert user.display_name == "鲍勃"


def test_register_account_duplicate_email_returns_409_without_extra_rows(db: Session) -> None:
    register_account(db, username="alice", email="alice@example.com", password=PASSWORD)

    with pytest.raises(ApiError) as info:
        register_account(
            db, username="alice-two", email="ALICE@example.com", password=PASSWORD
        )

    assert info.value.code == ErrorCode.EMAIL_ALREADY_REGISTERED
    assert info.value.status_code == 409
    assert _count_users(db) == 1


def test_register_account_duplicate_username_is_case_insensitive(db: Session) -> None:
    register_account(db, username="Alice", email="alice@example.com", password=PASSWORD)

    with pytest.raises(ApiError) as info:
        register_account(
            db, username="ALICE", email="other@example.com", password=PASSWORD
        )

    assert info.value.code == ErrorCode.USERNAME_ALREADY_REGISTERED
    assert info.value.status_code == 409
    assert _count_users(db) == 1


def test_register_account_integrity_error_is_translated_and_rolled_back(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """并发兜底：预检查被绕过时，唯一约束冲突必须转 409 且 ``users`` 不增行。"""

    register_account(db, username="dup", email="dup@example.com", password=PASSWORD)
    before = _count_users(db)

    # 模拟并发窗口：预检查看不到刚被另一事务写入的身份行。
    monkeypatch.setattr(service_module, "_find_email_identity", lambda _db, _identifier: None)

    with pytest.raises(ApiError) as info:
        register_account(
            db, username="dup-two", email="DUP@example.com", password=PASSWORD
        )

    assert info.value.code == ErrorCode.EMAIL_ALREADY_REGISTERED
    assert info.value.status_code == 409
    assert _count_users(db) == before
    # 事务已回滚：会话可以继续使用；只保留首个账号的两条身份。
    assert db.execute(select(func.count()).select_from(am.LoginIdentityRecord)).scalar_one() == 2


def test_register_account_flushes_users_before_identities(db: Session) -> None:
    """T1 硬约束：三表无 ORM relationship，INSERT 必须让 ``users`` 先行。"""

    engine = db.get_bind()
    statements: list[str] = []

    def _record(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        if statement.lstrip().upper().startswith("INSERT"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", _record)
    try:
        register_account(
            db, username="order", email="order@example.com", password=PASSWORD
        )
    finally:
        event.remove(engine, "before_cursor_execute", _record)

    tables: list[str] = []
    for statement in statements:
        marker = statement.upper().find("INTO")
        if marker == -1:
            continue
        table = statement[marker + 4 :].strip().split("(", 1)[0].strip().strip('"`')
        tables.append(table.lower())

    assert "users" in tables
    assert "login_identities" in tables
    assert tables.index("users") < tables.index("login_identities")


def test_login_identity_rejects_unknown_user_at_database_level(db: Session) -> None:
    """外键真实生效，因此上面的 flush 顺序不是可选优化。"""

    db.add(
        am.LoginIdentityRecord(
            id=am.new_identity_id(),
            user_id=am.new_user_id(),
            provider="email",
            issuer="",
            identifier="ghost@example.com",
            display_identifier="ghost@example.com",
            password_hash=hash_password(PASSWORD),
            created_at=am.utc_now(),
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_register_account_respects_development_active_flag(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    disabled = Settings(auth_development_active_on_register=False)
    monkeypatch.setattr(service_module, "get_settings", lambda: disabled)

    with pytest.raises(ApiError) as info:
        register_account(
            db, username="nodflag", email="nod-flag@example.com", password=PASSWORD
        )

    assert info.value.code == ErrorCode.MODEL_UNAVAILABLE
    assert info.value.status_code == 503
    assert _count_users(db) == 0


def test_authenticate_success_returns_active_user(db: Session) -> None:
    registered = register_account(
        db, username="auth_user", email="auth@example.com", password=PASSWORD
    )
    user = authenticate(db, identifier=" AUTH@example.com ", password=PASSWORD)
    assert user.id == registered.id

    by_username = authenticate(db, identifier=" AUTH_USER ", password=PASSWORD)
    assert by_username.id == registered.id


def test_authenticate_wrong_password_and_unknown_identifier_share_message(db: Session) -> None:
    register_account(db, username="auth_user", email="auth@example.com", password=PASSWORD)

    with pytest.raises(ApiError) as wrong:
        authenticate(db, identifier="auth_user", password="wrong-password-2026")
    with pytest.raises(ApiError) as unknown:
        authenticate(db, identifier="nobody_here", password=PASSWORD)

    assert wrong.value.code == ErrorCode.INVALID_CREDENTIALS
    assert unknown.value.code == ErrorCode.INVALID_CREDENTIALS
    assert wrong.value.status_code == unknown.value.status_code == 401
    assert wrong.value.message == unknown.value.message == "用户名或密码不正确"


def test_authenticate_rejects_invalid_identifier_with_422(db: Session) -> None:
    with pytest.raises(ApiError) as info:
        authenticate(db, identifier="bad@example", password=PASSWORD)
    assert info.value.code == ErrorCode.MISSING_FIELD
    assert info.value.status_code == 422

    with pytest.raises(ApiError) as username_info:
        authenticate(db, identifier="1bad_name", password=PASSWORD)
    assert username_info.value.code == ErrorCode.MISSING_FIELD
    assert username_info.value.details == {"field": "username"}


def test_authenticate_identity_without_password_hash_is_credential_error(db: Session) -> None:
    registered = register_account(
        db, username="oauth_user", email="oauth@example.com", password=PASSWORD
    )
    identity = find_email_identity(db, registered.id)
    assert identity is not None
    identity.password_hash = None
    db.commit()

    with pytest.raises(ApiError) as info:
        authenticate(db, identifier="oauth@example.com", password=PASSWORD)
    assert info.value.code == ErrorCode.INVALID_CREDENTIALS


def test_authenticate_suspended_account_returns_403(db: Session) -> None:
    registered = register_account(
        db, username="susp_user", email="susp@example.com", password=PASSWORD
    )
    registered.status = "suspended"
    db.commit()

    with pytest.raises(ApiError) as info:
        authenticate(db, identifier="susp_user", password=PASSWORD)

    assert info.value.code == ErrorCode.FORBIDDEN
    assert info.value.status_code == 403
    assert info.value.message == "账号不可用，请联系管理员"


def test_authenticate_rehashes_outdated_digest(db: Session) -> None:
    registered = register_account(
        db, username="rehash_user", email="rehash@example.com", password=PASSWORD
    )
    identity = find_email_identity(db, registered.id)
    assert identity is not None

    weak_hasher = PasswordHasher(
        time_cost=1, memory_cost=8, parallelism=1, hash_len=32, salt_len=16
    )
    identity.password_hash = weak_hasher.hash(PASSWORD)
    db.commit()

    authenticate(db, identifier="rehash@example.com", password=PASSWORD)

    refreshed = find_email_identity(db, registered.id)
    assert refreshed is not None
    assert refreshed.password_hash is not None
    assert "$m=19456,t=2,p=1$" in refreshed.password_hash


def test_get_active_user_rejects_missing_and_suspended(db: Session) -> None:
    registered = register_account(
        db, username="active_user", email="active@example.com", password=PASSWORD
    )
    assert get_active_user(db, registered.id).id == registered.id

    registered.status = "suspended"
    db.commit()
    with pytest.raises(ApiError) as info:
        get_active_user(db, registered.id)
    assert info.value.code == ErrorCode.AUTH_REQUIRED
    assert info.value.status_code == 401

    with pytest.raises(ApiError):
        get_active_user(db, am.new_user_id())


# ---------------------------------------------------------------------------
# C-ERR@2：错误码向后兼容追加
# ---------------------------------------------------------------------------


def test_error_codes_keep_existing_eight_and_append_six() -> None:
    existing = [
        "INVALID_FILE",
        "LIMIT_EXCEEDED",
        "PARSE_FAILED",
        "MODEL_UNAVAILABLE",
        "UNSUPPORTED_TEMPLATE",
        "MISSING_FIELD",
        "VERSION_CONFLICT",
        "SESSION_EXPIRED",
    ]
    new = [
        "AUTH_REQUIRED",
        "INVALID_CREDENTIALS",
        "EMAIL_ALREADY_REGISTERED",
        "FORBIDDEN",
        "EMAIL_NOT_VERIFIED",
        "RATE_LIMITED",
        "USERNAME_ALREADY_REGISTERED",
    ]
    assert [code.value for code in ErrorCode][: len(existing)] == existing
    assert [code.value for code in ErrorCode][len(existing) :] == new


def test_new_error_codes_have_http_status_and_are_not_retryable() -> None:
    expected = {
        ErrorCode.AUTH_REQUIRED: 401,
        ErrorCode.INVALID_CREDENTIALS: 401,
        ErrorCode.EMAIL_ALREADY_REGISTERED: 409,
        ErrorCode.FORBIDDEN: 403,
        ErrorCode.EMAIL_NOT_VERIFIED: 403,
        ErrorCode.RATE_LIMITED: 429,
        ErrorCode.USERNAME_ALREADY_REGISTERED: 409,
    }
    for code, status in expected.items():
        assert HTTP_STATUS[code] == status
        assert code not in RETRYABLE_CODES


def test_accounts_package_exports_contract_symbols() -> None:
    required = {
        "CreatedAuthSession",
        "PasswordVerification",
        "NormalizedEmail",
        "create_auth_session",
        "resolve_auth_session",
        "revoke_auth_session",
        "verify_csrf",
        "hash_token",
        "new_raw_token",
        "session_windows",
        "hash_password",
        "verify_password",
        "verify_dummy_password",
        "normalize_email",
        "normalize_username",
        "validate_password_policy",
        "register_account",
        "authenticate",
        "get_active_user",
        "find_email_identity",
        "find_username_identity",
    }
    assert required <= set(accounts_pkg.__all__)
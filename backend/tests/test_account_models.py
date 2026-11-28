"""账号三表 ORM 形状与时间/ID 工具（``C-MODEL@1``）。

全部在**临时 SQLite** 上执行（沿用 ``test_publish.py`` 的模式），不连接真实 MySQL：

- 表名、列名、可空性、索引名与唯一约束名逐字对照契约；
- ID 前缀与长度、``utc_now()`` 的 naive/秒级精度、``to_contract_iso()`` 的 ISO 形状；
- ``init_db()`` 覆盖存量表 + 账号三表且可重复调用；
- 唯一约束与外键在 SQLite 上真实生效。
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

import pytest
from sqlalchemy import DateTime, UniqueConstraint, create_engine, event, inspect
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

_TMP_DIR = Path(tempfile.mkdtemp(prefix="xiangsheng-account-models-"))
# 与既有测试文件一致：导入应用前固定测试数据库，避免写仓库内 ``data/xiangsheng.db``。
os.environ["DATABASE_URL"] = "sqlite:///" + (_TMP_DIR / "accounts.db").as_posix()

from app.db import account_models as am  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.init_db import REQUIRED_TABLE_NAMES, init_db  # noqa: E402
from app.db.models import PLAZA_TABLE_NAMES, TABLE_NAMES  # noqa: E402
from app.db.session import get_engine, reset_engine_cache  # noqa: E402
from app.schemas.common import parse_iso  # noqa: E402
from app.settings import Settings, get_settings  # noqa: E402

get_settings.cache_clear()
reset_engine_cache()


def _enable_foreign_keys(engine: Engine) -> None:
    """SQLite 默认不校验外键；测试里显式打开，验证 FK 真实存在。"""

    @event.listens_for(engine, "connect")
    def _set_pragma(dbapi_connection: object, _connection_record: object) -> None:
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
        finally:
            cursor.close()


@pytest.fixture(scope="module")
def account_engine() -> Iterator[Engine]:
    """建好 15 张表的临时 SQLite 引擎（账号三表 + 存量 12 表）。"""

    url = "sqlite:///" + (_TMP_DIR / "models.db").as_posix()
    engine = create_engine(url, future=True)
    _enable_foreign_keys(engine)
    init_db(bind=engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def db(account_engine: Engine) -> Iterator[Session]:
    """每个用例独立会话；退出时回滚未提交事务。"""

    factory = sessionmaker(bind=account_engine, expire_on_commit=False, future=True)
    session = factory()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _user(user_id: str | None = None, **overrides: object) -> am.UserRecord:
    values: dict[str, object] = {
        "id": user_id or am.new_user_id(),
        "display_name": "测试账号",
        "status": "active",
        "platform_role": am.DEFAULT_PLATFORM_ROLE,
        "created_at": am.utc_now(),
        "deleted_at": None,
    }
    values.update(overrides)
    return am.UserRecord(**values)


# ---------------------------------------------------------------------------
# 表与列形状
# ---------------------------------------------------------------------------


def test_account_table_names_are_registered() -> None:
    assert am.ACCOUNT_TABLE_NAMES == (
        "users",
        "login_identities",
        "auth_sessions",
        "user_profiles",
        "email_verification_codes",
    )
    for table_name in am.ACCOUNT_TABLE_NAMES:
        assert table_name in Base.metadata.tables, f"{table_name} 未注册到 Base.metadata"


def test_required_table_names_cover_baseline_and_accounts() -> None:
    from app.db.ppt_ai_models import PPT_AI_TABLE_NAMES

    assert REQUIRED_TABLE_NAMES[: len(TABLE_NAMES)] == TABLE_NAMES
    assert set(am.ACCOUNT_TABLE_NAMES).issubset(set(REQUIRED_TABLE_NAMES))
    assert REQUIRED_TABLE_NAMES[-len(PPT_AI_TABLE_NAMES) :] == PPT_AI_TABLE_NAMES
    assert len(REQUIRED_TABLE_NAMES) == len(set(REQUIRED_TABLE_NAMES))


def test_users_columns_match_contract() -> None:
    table = am.UserRecord.__table__

    assert list(table.columns.keys()) == [
        "id",
        "display_name",
        "status",
        "platform_role",
        "created_at",
        "deleted_at",
    ]
    assert list(table.primary_key.columns.keys()) == ["id"]
    assert table.c.id.type.length == 64
    assert table.c.display_name.type.length == 64
    assert table.c.status.type.length == 16
    assert table.c.platform_role.type.length == 16
    assert isinstance(table.c.created_at.type, DateTime)
    assert isinstance(table.c.deleted_at.type, DateTime)

    assert table.c.id.nullable is False
    assert table.c.display_name.nullable is False
    assert table.c.status.nullable is False
    assert table.c.platform_role.nullable is False
    assert table.c.created_at.nullable is False
    assert table.c.deleted_at.nullable is True

    assert table.c.status.default.arg == "active"
    assert table.c.platform_role.default.arg == am.DEFAULT_PLATFORM_ROLE == "user"
    assert {index.name for index in table.indexes} == {"ix_users_status_created"}
    index = next(iter(table.indexes))
    assert [column.name for column in index.columns] == ["status", "created_at"]


def test_login_identities_columns_match_contract() -> None:
    table = am.LoginIdentityRecord.__table__

    assert list(table.columns.keys()) == [
        "id",
        "user_id",
        "provider",
        "issuer",
        "identifier",
        "display_identifier",
        "password_hash",
        "verified_at",
        "created_at",
    ]
    assert table.c.id.type.length == 64
    assert table.c.user_id.type.length == 64
    assert table.c.provider.type.length == 32
    assert table.c.issuer.type.length == 255
    assert table.c.identifier.type.length == 320
    assert table.c.display_identifier.type.length == 320
    assert table.c.password_hash.type.length == 255
    assert isinstance(table.c.verified_at.type, DateTime)

    assert table.c.password_hash.nullable is True
    assert table.c.verified_at.nullable is True
    for required in ("user_id", "provider", "issuer", "identifier", "display_identifier", "created_at"):
        assert table.c[required].nullable is False, f"{required} 必须非空"

    assert table.c.provider.default.arg == "email"
    assert table.c.issuer.default.arg == ""
    assert {index.name for index in table.indexes} == {"ix_login_identities_user"}

    unique = next(
        constraint
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    )
    assert unique.name == "uq_login_identities_provider_issuer_identifier"
    assert [column.name for column in unique.columns] == ["provider", "issuer", "identifier"]

    foreign_key = next(iter(table.foreign_keys))
    assert foreign_key.parent.name == "user_id"
    assert foreign_key.column.table.name == "users"
    assert foreign_key.column.name == "id"


def test_auth_sessions_columns_match_contract() -> None:
    table = am.AuthSessionRecord.__table__

    assert list(table.columns.keys()) == [
        "id",
        "user_id",
        "token_hash",
        "csrf_token_hash",
        "created_at",
        "last_seen_at",
        "idle_expires_at",
        "absolute_expires_at",
        "revoked_at",
        "device_label",
    ]
    assert table.c.id.type.length == 64
    assert table.c.user_id.type.length == 64
    assert table.c.token_hash.type.length == 64
    assert table.c.csrf_token_hash.type.length == 64
    assert table.c.device_label.type.length == 64

    for required in (
        "user_id",
        "token_hash",
        "csrf_token_hash",
        "created_at",
        "last_seen_at",
        "idle_expires_at",
        "absolute_expires_at",
    ):
        assert table.c[required].nullable is False, f"{required} 必须非空"
    assert table.c.revoked_at.nullable is True
    assert table.c.device_label.nullable is True

    assert {index.name for index in table.indexes} == {
        "ix_auth_sessions_user_revoked",
        "ix_auth_sessions_absolute_expires",
    }
    unique = next(
        constraint
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    )
    assert unique.name == "uq_auth_sessions_token_hash"
    assert [column.name for column in unique.columns] == ["token_hash"]

    foreign_key = next(iter(table.foreign_keys))
    assert foreign_key.parent.name == "user_id"
    assert foreign_key.column.table.name == "users"


def test_mysql_table_options_on_all_account_tables() -> None:
    assert am.MYSQL_TABLE_OPTIONS == {
        "mysql_engine": "InnoDB",
        "mysql_charset": "utf8mb4",
        "mysql_collate": "utf8mb4_0900_ai_ci",
    }
    for model in (am.UserRecord, am.LoginIdentityRecord, am.AuthSessionRecord):
        kwargs = model.__table__.kwargs
        assert kwargs["mysql_engine"] == "InnoDB"
        assert kwargs["mysql_charset"] == "utf8mb4"
        assert kwargs["mysql_collate"] == "utf8mb4_0900_ai_ci"


# ---------------------------------------------------------------------------
# ID 与时间工具
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("factory", "prefix"),
    [
        (am.new_user_id, am.USER_ID_PREFIX),
        (am.new_identity_id, am.IDENTITY_ID_PREFIX),
        (am.new_auth_session_id, am.AUTH_SESSION_ID_PREFIX),
    ],
)
def test_id_generators_use_contract_prefix_and_length(factory, prefix: str) -> None:
    value = factory()
    assert value.startswith(prefix)
    assert len(value) == 36
    suffix = value[len(prefix) :]
    assert len(suffix) == 32
    assert suffix == suffix.lower()
    assert all(char in "0123456789abcdef" for char in suffix)


def test_id_generators_are_unique() -> None:
    ids = {am.new_user_id() for _ in range(200)}
    assert len(ids) == 200


def test_utc_now_is_naive_with_second_precision() -> None:
    moment = am.utc_now()
    assert moment.tzinfo is None
    assert moment.microsecond == 0
    reference = datetime.now(tz=timezone.utc).replace(tzinfo=None)
    assert abs((reference - moment).total_seconds()) < 5


def test_to_contract_iso_formats_naive_and_aware_inputs() -> None:
    assert am.to_contract_iso(datetime(2026, 1, 2, 3, 4, 5)) == "2026-01-02T03:04:05Z"

    utc_plus_eight = datetime(2026, 1, 2, 11, 4, 5, tzinfo=timezone(timedelta(hours=8)))
    assert am.to_contract_iso(utc_plus_eight) == "2026-01-02T03:04:05Z"


def test_to_contract_iso_output_is_parseable_by_common_parse_iso() -> None:
    text = am.to_contract_iso(am.utc_now())
    parsed = parse_iso(text)
    assert parsed.tzinfo is not None
    assert parsed.utcoffset() == timedelta(0)


# ---------------------------------------------------------------------------
# 真实落库行为（临时 SQLite）
# ---------------------------------------------------------------------------


def test_roundtrip_user_identity_and_session(db: Session) -> None:
    now = am.utc_now()
    user = _user()
    identity = am.LoginIdentityRecord(
        id=am.new_identity_id(),
        user_id=user.id,
        provider="email",
        issuer="",
        identifier="teach@example.com",
        display_identifier="Teach@Example.com",
        password_hash="$argon2id$v=19$m=19456,t=2,p=1$placeholder",
        verified_at=None,
        created_at=now,
    )
    auth_session = am.AuthSessionRecord(
        id=am.new_auth_session_id(),
        user_id=user.id,
        token_hash="a" * 64,
        csrf_token_hash="b" * 64,
        created_at=now,
        last_seen_at=now,
        idle_expires_at=now + timedelta(hours=12),
        absolute_expires_at=now + timedelta(hours=24),
        revoked_at=None,
        device_label="pytest",
    )
    db.add(user)
    # 三张表之间没有 ORM relationship，flush 顺序不由外键推导；
    # 先落 users，再写依赖它的两张表（T2 服务层同样需要先 flush 账号）。
    db.flush()
    db.add_all([identity, auth_session])
    db.commit()

    stored_user = db.get(am.UserRecord, user.id)
    assert stored_user is not None
    assert (stored_user.display_name, stored_user.status) == ("测试账号", "active")
    assert stored_user.platform_role == "user"
    assert stored_user.created_at == now
    assert stored_user.deleted_at is None

    stored_identity = db.get(am.LoginIdentityRecord, identity.id)
    assert stored_identity is not None
    assert stored_identity.identifier == "teach@example.com"
    assert stored_identity.display_identifier == "Teach@Example.com"
    assert stored_identity.verified_at is None

    stored_session = db.get(am.AuthSessionRecord, auth_session.id)
    assert stored_session is not None
    assert stored_session.token_hash == "a" * 64
    assert stored_session.idle_expires_at == now + timedelta(hours=12)
    assert stored_session.absolute_expires_at == now + timedelta(hours=24)
    assert stored_session.revoked_at is None


def test_duplicate_identity_triplet_is_rejected(db: Session) -> None:
    user = _user()
    db.add(user)
    db.commit()

    for _ in range(2):
        db.add(
            am.LoginIdentityRecord(
                id=am.new_identity_id(),
                user_id=user.id,
                provider="email",
                issuer="",
                identifier="dup@example.com",
                display_identifier="dup@example.com",
                password_hash=None,
                created_at=am.utc_now(),
            )
        )
    with pytest.raises(IntegrityError):
        db.commit()


def test_duplicate_token_hash_is_rejected(db: Session) -> None:
    user = _user()
    db.add(user)
    db.commit()

    now = am.utc_now()
    for _ in range(2):
        db.add(
            am.AuthSessionRecord(
                id=am.new_auth_session_id(),
                user_id=user.id,
                token_hash="c" * 64,
                csrf_token_hash="d" * 64,
                created_at=now,
                last_seen_at=now,
                idle_expires_at=now + timedelta(hours=1),
                absolute_expires_at=now + timedelta(hours=2),
                revoked_at=None,
                device_label=None,
            )
        )
    with pytest.raises(IntegrityError):
        db.commit()


def test_identity_requires_existing_user(db: Session) -> None:
    db.add(
        am.LoginIdentityRecord(
            id=am.new_identity_id(),
            user_id="usr_missing_user",
            provider="email",
            issuer="",
            identifier="orphan@example.com",
            display_identifier="orphan@example.com",
            password_hash=None,
            created_at=am.utc_now(),
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()


# ---------------------------------------------------------------------------
# init_db 与方言
# ---------------------------------------------------------------------------


def test_init_db_is_idempotent_and_returns_all_tables(account_engine: Engine) -> None:
    first = init_db(bind=account_engine)
    second = init_db(bind=account_engine)

    assert first == second
    assert first == sorted(first)
    assert set(TABLE_NAMES).issubset(first)
    assert set(am.ACCOUNT_TABLE_NAMES).issubset(first)
    # 返回值是 metadata 中全部表（存量/扩展 12 表 + 账号 5 表 + PPT AI 7 表 + 活页 3 表），不多不少。
    assert set(first) == set(Base.metadata.tables)
    assert set(PLAZA_TABLE_NAMES).issubset(first)


def test_sqlite_has_account_tables_after_init(account_engine: Engine) -> None:
    names = set(inspect(account_engine).get_table_names())
    assert set(am.ACCOUNT_TABLE_NAMES).issubset(names)
    assert set(TABLE_NAMES).issubset(names)


def test_get_engine_creates_sqlite_engine(monkeypatch: pytest.MonkeyPatch) -> None:

    url = "sqlite:///" + (_TMP_DIR / "engine.db").as_posix()
    monkeypatch.setattr(
        "app.db.session.get_settings",
        lambda: Settings(_env_file=None, database_url=url),
    )
    reset_engine_cache()
    try:
        engine = get_engine()
        assert engine.dialect.name == "sqlite"
        assert Path(engine.url.database or "").name == "engine.db"
    finally:
        reset_engine_cache()
"""账号、登录身份与登录会话（账号文档 §6.1 的首版子集）。

本模块只负责表结构、ID 生成与时间约定（``C-MODEL@1``），不含任何业务规则：

- 唯一约束冲突由调用方（账号服务层）捕获 ``sqlalchemy.exc.IntegrityError`` 后转换；
- ``status`` / ``platform_role`` / ``provider`` 的取值合法性由服务层保证，
  这里**不新增** CHECK 约束（避免 MySQL 8.0 与 SQLite 的约束差异）；
- 不做删除级联；SQLite 未开 ``PRAGMA foreign_keys`` 时不依赖级联语义。

时间列一律存 **UTC naive**（MySQL ``DATETIME`` 无时区），写入统一走
:func:`utc_now`，跨模块边界一律用 :func:`to_contract_iso` 转 ISO 字符串。
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..schemas.common import to_iso
from .base import Base

#: 主键前缀（``usr_`` / ``lid_`` / ``aut_`` + 32 位 uuid4 hex = 36 字符）。
USER_ID_PREFIX = "usr_"
IDENTITY_ID_PREFIX = "lid_"
AUTH_SESSION_ID_PREFIX = "aut_"

#: 账号域的表名（``init_db`` 据此做完整性校验）。
ACCOUNT_TABLE_NAMES: tuple[str, ...] = (
    "users",
    "login_identities",
    "auth_sessions",
    "user_profiles",
)

#: 本版本只写 ``user``；``operator`` / ``admin`` 预留给后续管理端。
DEFAULT_PLATFORM_ROLE = "user"

#: MySQL 表选项（InnoDB + utf8mb4，与 Alembic 基线逐字一致）。
MYSQL_TABLE_OPTIONS: dict[str, str] = {
    "mysql_engine": "InnoDB",
    "mysql_charset": "utf8mb4",
    "mysql_collate": "utf8mb4_0900_ai_ci",
}


def new_user_id() -> str:
    """生成账号主键：``usr_`` + 32 位 uuid4 hex（共 36 字符）。"""

    return USER_ID_PREFIX + uuid4().hex


def new_identity_id() -> str:
    """生成登录身份主键：``lid_`` + 32 位 uuid4 hex（共 36 字符）。"""

    return IDENTITY_ID_PREFIX + uuid4().hex


def new_auth_session_id() -> str:
    """生成登录会话主键：``aut_`` + 32 位 uuid4 hex（共 36 字符）。"""

    return AUTH_SESSION_ID_PREFIX + uuid4().hex


def utc_now() -> datetime:
    """当前时间：UTC naive、微秒清零（与 ``app.schemas.common.utc_now`` 的秒级精度一致）。"""

    return datetime.now(tz=timezone.utc).replace(tzinfo=None, microsecond=0)


def to_contract_iso(value: datetime) -> str:
    """把 ``datetime`` 转成契约使用的 ISO 8601 UTC 字符串（``YYYY-MM-DDTHH:MM:SSZ``）。

    naive 输入按 UTC 处理；不接受字符串输入，也不把 ``datetime`` 传给 ``parse_iso``。
    """

    return to_iso(value)


class UserRecord(Base):
    """账号主体：只保存身份与状态，不保存登录凭据（凭据在 ``login_identities``）。"""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(64), nullable=False)
    #: active / suspended / deleted；pending 仅存在于账号文档，本版本不产生。
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    platform_role: Mapped[str] = mapped_column(
        String(16), nullable=False, default=DEFAULT_PLATFORM_ROLE
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_users_status_created", "status", "created_at"),
        MYSQL_TABLE_OPTIONS,
    )


class LoginIdentityRecord(Base):
    """登录身份：一个账号可绑定多种 provider（首版只有 ``email``）。"""

    __tablename__ = "login_identities"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.id"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="email")
    #: 外部身份签发方；首版为空串，第三方登录时填 ``issuer``。
    issuer: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    #: 规范化比较值（``casefold()`` + 去首尾空格）。
    identifier: Mapped[str] = mapped_column(String(320), nullable=False)
    #: 原始展示值（仅去首尾空格，不做大小写改写）。
    display_identifier: Mapped[str] = mapped_column(String(320), nullable=False)
    #: Argon2id PHC 串（约 97 字符）；第三方登录方式可为空。
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    #: 邮箱验证时间；本版本注册即 active，不写入，但保留列以便后续接入验证。
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "provider",
            "issuer",
            "identifier",
            name="uq_login_identities_provider_issuer_identifier",
        ),
        Index("ix_login_identities_user", "user_id"),
        MYSQL_TABLE_OPTIONS,
    )


class UserProfileRecord(Base):
    """账号资料：与 ``users`` 一对一，只保存展示信息与偏好。

    - 头像只存文件标识（``avatar_id``）；图片本体在 ``backend/data/avatars``，
      文件名由 ``user_id`` 决定，便于幂等覆盖；
    - ``interests`` 存 JSON 数组字符串（SQLite / MySQL 同一列类型，不依赖 JSON 类型）；
    - ``default_entry`` 为 ``space`` / ``labs``，只影响登录后的落地页，不构成权限。
    """

    __tablename__ = "user_profiles"

    user_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.id"), primary_key=True
    )
    bio: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    occupation: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    school: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    #: 手机号（选填）：只保存规范化后的 11 位中国大陆号码，空串表示未填写。
    phone: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    #: JSON 数组字符串，如 ``["线性代数", "可视化"]``。
    interests: Mapped[str] = mapped_column(String(512), nullable=False, default="[]")
    preferred_subject: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    default_entry: Mapped[str] = mapped_column(String(16), nullable=False, default="space")
    #: 头像文件标识；``NULL`` 表示使用昵称首字兜底。
    avatar_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    avatar_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    __table_args__ = (MYSQL_TABLE_OPTIONS,)


class AuthSessionRecord(Base):
    """登录会话：只存 token/CSRF 的 SHA-256，明文只返回给客户端一次。"""

    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.id"), nullable=False
    )
    #: ``sha256(raw_token).hexdigest()``，64 位小写 hex。
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    #: ``sha256(raw_csrf).hexdigest()``，64 位小写 hex。
    csrf_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    #: 供 5 分钟节流更新 ``last_seen_at``。
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    idle_expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    absolute_expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    #: 非空即失效。
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    #: 首版由 User-Agent 截断填充，仅用于展示。
    device_label: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_auth_sessions_token_hash"),
        Index("ix_auth_sessions_user_revoked", "user_id", "revoked_at"),
        Index("ix_auth_sessions_absolute_expires", "absolute_expires_at"),
        MYSQL_TABLE_OPTIONS,
    )


__all__ = [
    "ACCOUNT_TABLE_NAMES",
    "AUTH_SESSION_ID_PREFIX",
    "AuthSessionRecord",
    "DEFAULT_PLATFORM_ROLE",
    "IDENTITY_ID_PREFIX",
    "LoginIdentityRecord",
    "MYSQL_TABLE_OPTIONS",
    "USER_ID_PREFIX",
    "UserProfileRecord",
    "UserRecord",
    "new_auth_session_id",
    "new_identity_id",
    "new_user_id",
    "to_contract_iso",
    "utc_now",
]
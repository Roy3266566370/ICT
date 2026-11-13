"""账号用例：注册、认证、按 ID 取活跃账号（``C-AUTHSVC@1`` §4）。

事务约定：

- **三表之间没有 ORM ``relationship``**，SQLAlchemy 不会按外键列推导 flush 顺序。
  因此 ``users`` 必须显式 ``flush()`` 成 INSERT 之后，再写 ``login_identities``
  （SQLite 已开启 ``PRAGMA foreign_keys=ON``，否则会报
  ``FOREIGN KEY constraint failed``）。:func:`register_account` 统一处理该顺序。
- 唯一约束冲突（并发注册）由本层捕获 ``IntegrityError`` 转成业务错误；
  ``account_models`` 只提供表结构，不抛业务错误。
- 日志只记录 ``user_id``，**不记录**用户名、邮箱、密码、摘要或令牌。
"""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db.account_models import (
    DEFAULT_PLATFORM_ROLE,
    LoginIdentityRecord,
    UserRecord,
    new_identity_id,
    new_user_id,
    utc_now,
)
from ..schemas.errors import (
    auth_required,
    email_already_registered,
    forbidden,
    invalid_credentials,
    model_unavailable,
    username_already_registered,
)
from ..settings import get_settings
from .identities import normalize_email, normalize_username, validate_password_policy
from .passwords import hash_password, verify_dummy_password, verify_password


logger = logging.getLogger(__name__)

#: 登录身份类型：一个账号同时拥有 ``username`` 与 ``email`` 两种身份。
USERNAME_PROVIDER = "username"
EMAIL_PROVIDER = "email"
EMAIL_ISSUER = ""
USERNAME_ISSUER = ""


def _find_identity(
    db: Session, provider: str, issuer: str, identifier: str
) -> Optional[LoginIdentityRecord]:
    """按 ``(provider, issuer, identifier)`` 查登录身份。"""

    statement = select(LoginIdentityRecord).where(
        LoginIdentityRecord.provider == provider,
        LoginIdentityRecord.issuer == issuer,
        LoginIdentityRecord.identifier == identifier,
    )
    return db.execute(statement).scalars().first()


def _find_email_identity(db: Session, identifier: str) -> Optional[LoginIdentityRecord]:
    """按规范化邮箱查登录身份；``identifier`` 必须是 ``normalize_email`` 的结果。"""

    return _find_identity(db, EMAIL_PROVIDER, EMAIL_ISSUER, identifier)


def find_email_identity(db: Session, user_id: str) -> Optional[LoginIdentityRecord]:
    """取账号的邮箱登录身份（没有则返回 ``None``）。"""

    statement = select(LoginIdentityRecord).where(
        LoginIdentityRecord.user_id == user_id,
        LoginIdentityRecord.provider == EMAIL_PROVIDER,
        LoginIdentityRecord.issuer == EMAIL_ISSUER,
    )
    return db.execute(statement).scalars().first()


def find_username_identity(db: Session, user_id: str) -> Optional[LoginIdentityRecord]:
    """取账号的用户名登录身份（老账号可能没有，返回 ``None``）。"""

    statement = select(LoginIdentityRecord).where(
        LoginIdentityRecord.user_id == user_id,
        LoginIdentityRecord.provider == USERNAME_PROVIDER,
        LoginIdentityRecord.issuer == USERNAME_ISSUER,
    )
    return db.execute(statement).scalars().first()


def register_account(
    db: Session,
    *,
    username: str,
    email: str,
    password: str,
    display_name: Optional[str] = None,
) -> UserRecord:
    """注册账号并返回 ``users`` 行（``expire_on_commit=False``，可直接读属性）。

    1. 先校验用户名、邮箱与密码（失败 422，无副作用）；
    2. 开发期降级开关关闭时返回明确的 503，而不是静默降级（D-04）；
    3. 预检查重复用户名 / 邮箱 → 409；并发下的 ``IntegrityError`` 同样转 409；
    4. ``users`` 先 ``flush()``，再写两条 ``login_identities``（username + email），
       最后一次性 ``commit()``；两次身份共用同一份密码摘要。
    """

    normalized_username = normalize_username(username)
    normalized_email = normalize_email(email)
    validate_password_policy(password)

    if not get_settings().auth_development_active_on_register:
        raise model_unavailable("当前版本尚未启用邮箱验证，注册暂不可用")

    if (
        _find_identity(
            db, USERNAME_PROVIDER, USERNAME_ISSUER, normalized_username.identifier
        )
        is not None
    ):
        raise username_already_registered()
    if _find_email_identity(db, normalized_email.identifier) is not None:
        raise email_already_registered()

    moment = utc_now()
    raw_display_name = (display_name or "").strip()
    resolved_name = (raw_display_name or normalized_username.display)[:64]
    password_hash = hash_password(password)

    user = UserRecord(
        id=new_user_id(),
        display_name=resolved_name,
        status="active",
        platform_role=DEFAULT_PLATFORM_ROLE,
        created_at=moment,
        deleted_at=None,
    )
    username_identity = LoginIdentityRecord(
        id=new_identity_id(),
        user_id=user.id,
        provider=USERNAME_PROVIDER,
        issuer=USERNAME_ISSUER,
        identifier=normalized_username.identifier,
        display_identifier=normalized_username.display,
        password_hash=password_hash,
        verified_at=None,
        created_at=moment,
    )
    email_identity = LoginIdentityRecord(
        id=new_identity_id(),
        user_id=user.id,
        provider=EMAIL_PROVIDER,
        issuer=EMAIL_ISSUER,
        identifier=normalized_email.identifier,
        display_identifier=normalized_email.display,
        password_hash=password_hash,
        verified_at=None,
        created_at=moment,
    )

    try:
        db.add(user)
        # 关键：三表无 ORM relationship，必须先 flush users，再插 login_identities。
        db.flush()
        db.add(username_identity)
        db.add(email_identity)
        db.commit()
    except IntegrityError:
        db.rollback()
        # 并发注册命中唯一约束：回滚后复查是哪一条身份冲突，返回同一业务错误。
        if (
            _find_identity(
                db, USERNAME_PROVIDER, USERNAME_ISSUER, normalized_username.identifier
            )
            is not None
        ):
            logger.info("注册命中用户名唯一约束，已回滚并返回 409")
            raise username_already_registered() from None
        logger.info("注册命中邮箱唯一约束，已回滚并返回 409")
        raise email_already_registered() from None

    logger.info("已注册账号 user_id=%s", user.id)
    return user


def authenticate(db: Session, *, identifier: str, password: str) -> UserRecord:
    """校验用户名/邮箱 + 密码并返回活跃账号。

    - 含 ``@`` 的标识按邮箱校验，其余按用户名校验；格式非法 → 422
      （字段问题优先暴露，不伪装成凭据错误）；
    - 账号不存在 / 无密码摘要 / 密码错误 → 同一句 401 ``INVALID_CREDENTIALS``，
      并在前两种分支走一次 dummy 校验保持等价耗时（R4-2）；
    - 成功但参数过期 → 用当前参数重算摘要并提交（渐进重哈希）；
    - 账号状态非 ``active`` → 403 ``FORBIDDEN``。
    """

    raw = (identifier or "").strip()
    if "@" in raw:
        normalized_email = normalize_email(raw)
        identity = _find_email_identity(db, normalized_email.identifier)
    else:
        normalized_username = normalize_username(raw)
        identity = _find_identity(
            db, USERNAME_PROVIDER, USERNAME_ISSUER, normalized_username.identifier
        )

    if identity is None or identity.password_hash is None:
        verify_dummy_password(password)
        raise invalid_credentials()

    verification = verify_password(password, identity.password_hash)
    if not verification.valid:
        raise invalid_credentials()

    if verification.needs_rehash:
        identity.password_hash = hash_password(password)
        db.commit()
        logger.info("已重哈希账号密码摘要 user_id=%s", identity.user_id)

    user = db.get(UserRecord, identity.user_id)
    if user is None:
        # 外键保证不会发生；数据不一致时不泄露内部细节，按凭据错误处理。
        raise invalid_credentials()
    if user.status != "active":
        raise forbidden()
    return user


def get_active_user(db: Session, user_id: str) -> UserRecord:
    """按 ID 取活跃账号；未找到或非 ``active`` 一律 ``AUTH_REQUIRED``（不泄露存在性）。"""

    user = db.get(UserRecord, user_id)
    if user is None or user.status != "active":
        raise auth_required()
    return user


__all__ = [
    "EMAIL_ISSUER",
    "EMAIL_PROVIDER",
    "USERNAME_ISSUER",
    "USERNAME_PROVIDER",
    "authenticate",
    "find_email_identity",
    "find_username_identity",
    "get_active_user",
    "register_account",
]
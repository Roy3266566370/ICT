"""账号领域服务包（``C-AUTHSVC@1``）。

对外只暴露下面 ``__all__`` 中的符号；路由层不得依赖子模块内部实现。
所有函数都是同步函数、接收 ``sqlalchemy.orm.Session``，**不接收**
``Request`` / ``Response``（HTTP 形状归 ``app.api.routes_auth``）。
"""

from __future__ import annotations

from .avatars import (
    AVATAR_JPEG_QUALITY,
    avatar_path,
    delete_avatar,
    save_avatar,
)
from .identities import (
    NormalizedEmail,
    NormalizedUsername,
    normalize_email,
    normalize_username,
    validate_password_policy,
)
from .passwords import (
    PasswordVerification,
    hash_password,
    verify_dummy_password,
    verify_password,
)
from .profiles import (
    DEFAULT_ENTRIES,
    DEFAULT_ENTRY_LABS,
    DEFAULT_ENTRY_SPACE,
    get_or_create_profile,
    interests_of,
    update_profile,
)
from .service import (
    PendingRegistration,
    authenticate,
    create_account,
    find_email_identity,
    find_username_identity,
    get_active_user,
    register_account,
    validate_registration,
)
from .verification import (
    EmailDeliveryError,
    consume_registration_code,
    issue_registration_code,
    send_verification_code_email,
)
from .sessions import (
    CreatedAuthSession,
    create_auth_session,
    csrf_token_for,
    hash_token,
    new_raw_token,
    resolve_auth_session,
    revoke_auth_session,
    session_windows,
    verify_csrf,
)

__all__ = [
    "CreatedAuthSession",
    "PasswordVerification",
    "NormalizedEmail",
    "NormalizedUsername",
    "create_auth_session",
    "resolve_auth_session",
    "revoke_auth_session",
    "verify_csrf",
    "hash_token",
    "csrf_token_for",
    "new_raw_token",
    "session_windows",
    "hash_password",
    "verify_password",
    "verify_dummy_password",
    "normalize_email",
    "normalize_username",
    "validate_password_policy",
    "EmailDeliveryError",
    "issue_registration_code",
    "consume_registration_code",
    "send_verification_code_email",
    "PendingRegistration",
    "register_account",
    "validate_registration",
    "create_account",
    "authenticate",
    "get_active_user",
    "find_email_identity",
    "find_username_identity",
    "AVATAR_JPEG_QUALITY",
    "avatar_path",
    "delete_avatar",
    "save_avatar",
    "DEFAULT_ENTRIES",
    "DEFAULT_ENTRY_LABS",
    "DEFAULT_ENTRY_SPACE",
    "get_or_create_profile",
    "interests_of",
    "update_profile",
]
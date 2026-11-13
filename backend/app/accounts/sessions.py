"""登录会话签发、解析与撤销（``C-AUTHSVC@1`` §3）。

- 数据库只存令牌与 CSRF 的 SHA-256 十六进制摘要，**明文只返回一次**；
- 过期判定与滑动空闲窗口都在这一层完成，路由只负责取 Cookie / 写 Cookie；
- ``remember`` 不落库：空闲窗口的跨度在创建时写入 ``idle_expires_at - last_seen_at``，
  解析时按该跨度滑动，因此"记住我"会话不会被普通 12 小时窗口缩短。

> 契约缺口（已登记）：``C-AUTHAPI@1`` 的 ``GET /me`` 需要返回**当前会话的原始 CSRF**，
> 但 ``auth_sessions`` 只存 ``csrf_token_hash``。若 CSRF 为独立随机值则服务端无法在
> 后续请求中复原。本模块因此把 CSRF 定义为 ``SHA-256(域分隔前缀 + raw_token)`` 的
> 确定性派生值：登录时返回、``/me`` 时可由 Cookie 中的 ``raw_token`` 重算，
> 二者与库内摘要始终一致，且无法从摘要反推。
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.account_models import AuthSessionRecord, new_auth_session_id, utc_now
from ..schemas.errors import auth_required
from ..settings import get_settings

logger = logging.getLogger(__name__)

#: ``last_seen_at`` 的最小写入间隔（R4-3：5 分钟内重复读不重复写）。
LAST_SEEN_WRITE_INTERVAL = timedelta(minutes=5)
#: 原始令牌熵：32 字节 → ``token_urlsafe`` 后 43 字符。
RAW_TOKEN_BYTES = 32
#: CSRF 派生域分隔前缀，避免与其它用途的同输入摘要混淆。
_CSRF_DERIVATION_PREFIX = b"xiangsheng-account-csrf-v1:"
#: ``device_label`` 列宽。
DEVICE_LABEL_MAX_LENGTH = 64


@dataclass(frozen=True, slots=True)
class CreatedAuthSession:
    """新建会话的结果；``raw_token`` / ``csrf_token`` 只在本次响应中下发一次。"""

    row: AuthSessionRecord
    raw_token: str
    csrf_token: str


def new_raw_token() -> str:
    """生成 43 字符的 URL 安全随机令牌（32 字节熵）。"""

    return secrets.token_urlsafe(RAW_TOKEN_BYTES)


def hash_token(raw: str) -> str:
    """``sha256(raw.encode("utf-8")).hexdigest()``（64 位小写 hex）。"""

    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def csrf_token_for(raw_token: str) -> str:
    """由原始会话令牌确定性派生 CSRF 值（同一令牌永远得到同一结果）。"""

    return hashlib.sha256(_CSRF_DERIVATION_PREFIX + raw_token.encode("utf-8")).hexdigest()


def session_windows(remember: bool) -> tuple[timedelta, timedelta]:
    """返回 ``(空闲窗口, 绝对窗口)``：普通 ``(12h, 24h)``、记住我 ``(168h, 720h)``。"""

    settings = get_settings()
    if remember:
        return (
            timedelta(hours=settings.auth_remember_idle_hours),
            timedelta(hours=settings.auth_remember_absolute_hours),
        )
    return (
        timedelta(hours=settings.auth_session_idle_hours),
        timedelta(hours=settings.auth_session_absolute_hours),
    )


def _normalize_device_label(value: str | None) -> str | None:
    """``User-Agent`` 只截断前 64 字符；空值落 ``None``。"""

    if not value:
        return None
    trimmed = value.strip()[:DEVICE_LABEL_MAX_LENGTH]
    return trimmed or None


def create_auth_session(
    db: Session,
    *,
    user_id: str,
    remember: bool,
    device_label: str | None = None,
    now: datetime | None = None,
) -> CreatedAuthSession:
    """签发会话：写一行 ``auth_sessions`` 并返回明文令牌与 CSRF（只此一次）。

    调用方必须保证 ``users`` 行已持久化（例如注册事务中先 ``flush()``），
    否则 SQLite 外键约束会拒绝这里的 INSERT。
    """

    moment = now or utc_now()
    idle_window, absolute_window = session_windows(remember)
    raw_token = new_raw_token()
    csrf_token = csrf_token_for(raw_token)

    row = AuthSessionRecord(
        id=new_auth_session_id(),
        user_id=user_id,
        token_hash=hash_token(raw_token),
        csrf_token_hash=hash_token(csrf_token),
        created_at=moment,
        last_seen_at=moment,
        idle_expires_at=moment + idle_window,
        absolute_expires_at=moment + absolute_window,
        revoked_at=None,
        device_label=_normalize_device_label(device_label),
    )
    db.add(row)
    db.commit()
    logger.info("已签发账号会话 session_id=%s user_id=%s", row.id, user_id)
    return CreatedAuthSession(row=row, raw_token=raw_token, csrf_token=csrf_token)


def resolve_auth_session(
    db: Session,
    raw_token: str | None,
    *,
    touch: bool = True,
    now: datetime | None = None,
) -> AuthSessionRecord:
    """按 Cookie 中的原始令牌取会话；任何无效原因都统一 ``AUTH_REQUIRED``（401）。

    有效且距上次写入超过 5 分钟时，按该行**已有跨度**滑动空闲窗口，
    并以 ``absolute_expires_at`` 封顶。
    """

    if not raw_token:
        raise auth_required()

    moment = now or utc_now()
    statement = select(AuthSessionRecord).where(
        AuthSessionRecord.token_hash == hash_token(raw_token)
    )
    row = db.execute(statement).scalars().first()
    if row is None:
        raise auth_required()
    if row.revoked_at is not None:
        raise auth_required()
    if moment >= row.idle_expires_at or moment >= row.absolute_expires_at:
        raise auth_required()

    if touch and moment - row.last_seen_at >= LAST_SEEN_WRITE_INTERVAL:
        span = row.idle_expires_at - row.last_seen_at
        if span <= timedelta(0):
            span = timedelta(0)
        row.last_seen_at = moment
        row.idle_expires_at = min(moment + span, row.absolute_expires_at)
        db.commit()
    return row


def revoke_auth_session(
    db: Session, row: AuthSessionRecord, *, now: datetime | None = None
) -> None:
    """撤销会话；已撤销时幂等返回（不覆盖首次撤销时间）。"""

    if row.revoked_at is not None:
        return
    row.revoked_at = now or utc_now()
    db.commit()
    logger.info("已撤销账号会话 session_id=%s user_id=%s", row.id, row.user_id)


def verify_csrf(row: AuthSessionRecord, provided: str) -> bool:
    """常量时间比较 ``X-CSRF-Token`` 与库内摘要；空值直接失败。"""

    if not provided:
        return False
    return hmac.compare_digest(hash_token(provided), row.csrf_token_hash)


__all__ = [
    "DEVICE_LABEL_MAX_LENGTH",
    "LAST_SEEN_WRITE_INTERVAL",
    "RAW_TOKEN_BYTES",
    "CreatedAuthSession",
    "create_auth_session",
    "csrf_token_for",
    "hash_token",
    "new_raw_token",
    "resolve_auth_session",
    "revoke_auth_session",
    "session_windows",
    "verify_csrf",
]
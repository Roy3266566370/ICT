"""注册邮箱验证码：签发、Brevo 发送与核验（``C-AUTHAPI@1`` 邮箱验证补充）。

规则：

- 验证码 6 位数字，默认 5 分钟有效；
- 同一邮箱两次发送至少间隔 60 秒（每次签发都会作废旧验证码）；
- 单个验证码最多允许 5 次错误尝试，超限立即作废；
- 核验成功后立即作废，不能重复使用；
- 明文验证码只出现在邮件里，数据库只保存 HMAC-SHA256 摘要；
- 日志不记录邮箱、验证码或 Brevo 密钥。

发送失败（未配置 Brevo / 网络错误 / 非 2xx）时把刚写入的验证码标记为已消费，
并返回 503，避免用户被失败请求锁在 60 秒重发节流里。
"""

from __future__ import annotations

import hashlib
import hmac
import html
import json
import logging
import math
import secrets
import urllib.error
import urllib.request
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.account_models import (
    EmailVerificationCodeRecord,
    LoginIdentityRecord,
    new_email_verification_id,
    utc_now,
)
from ..schemas.errors import (
    email_already_registered,
    missing_field,
    model_unavailable,
    rate_limited,
)
from ..settings import get_settings
from .identities import normalize_email

logger = logging.getLogger(__name__)

#: 当前唯一的验证码用途。
PURPOSE_REGISTER = "register"
#: 验证码位数。
CODE_LENGTH = 6


class EmailDeliveryError(RuntimeError):
    """邮件服务未配置或发送失败；对外统一转 503，不暴露服务商细节。"""


def _code_hash(code: str) -> str:
    """用进程密钥对验证码做 HMAC，避免数据库泄露后直接还原 6 位数字。"""

    key = get_settings().session_secret.encode("utf-8")
    return hmac.new(key, code.encode("utf-8"), hashlib.sha256).hexdigest()


def _latest_code(
    db: Session, email: str, purpose: str = PURPOSE_REGISTER
) -> EmailVerificationCodeRecord | None:
    """取该邮箱最近一条验证码（含已消费，用于区分过期/失效）。"""

    statement = (
        select(EmailVerificationCodeRecord)
        .where(
            EmailVerificationCodeRecord.email == email,
            EmailVerificationCodeRecord.purpose == purpose,
        )
        .order_by(EmailVerificationCodeRecord.created_at.desc())
        .limit(1)
    )
    return db.execute(statement).scalars().first()


def _active_code(
    db: Session, email: str, purpose: str = PURPOSE_REGISTER
) -> EmailVerificationCodeRecord | None:
    """取该邮箱当前有效的验证码（未消费）。"""

    statement = (
        select(EmailVerificationCodeRecord)
        .where(
            EmailVerificationCodeRecord.email == email,
            EmailVerificationCodeRecord.purpose == purpose,
            EmailVerificationCodeRecord.consumed_at.is_(None),
        )
        .order_by(EmailVerificationCodeRecord.created_at.desc())
        .limit(1)
    )
    return db.execute(statement).scalars().first()


def _email_registered(db: Session, identifier: str) -> bool:
    """邮箱是否已经绑定账号（与登录身份同口径的规范化值）。"""

    statement = select(LoginIdentityRecord.id).where(
        LoginIdentityRecord.provider == "email",
        LoginIdentityRecord.issuer == "",
        LoginIdentityRecord.identifier == identifier,
    )
    return db.execute(statement).first() is not None


def build_brevo_payload(
    *, recipient: str, code: str, sender_email: str, sender_name: str, ttl_seconds: int
) -> dict[str, Any]:
    """构造 Brevo ``POST /v3/smtp/email`` 请求体（纯函数，便于单测）。"""

    minutes = max(1, math.ceil(ttl_seconds / 60))
    safe_code = html.escape(code)
    safe_email = html.escape(recipient)
    text_content = (
        f"你正在注册万象账号，邮箱验证码：{code}\n"
        f"验证码 {minutes} 分钟内有效，请勿泄露给他人。\n"
        "如非本人操作，请忽略本邮件。"
    )
    html_content = (
        '<div style="font-family:Arial,\'PingFang SC\',sans-serif;color:#1c1c1e;line-height:1.7">'
        "<p>你正在注册万象账号，邮箱验证码：</p>"
        f'<p style="font-size:28px;letter-spacing:6px;font-weight:700">{safe_code}</p>'
        f"<p>验证码 {minutes} 分钟内有效，请勿泄露给他人。</p>"
        f'<p style="color:#6b6b70;font-size:13px">收件邮箱：{safe_email}。'
        "如非本人操作，请忽略本邮件。</p>"
        "</div>"
    )
    return {
        "sender": {"name": sender_name, "email": sender_email},
        "to": [{"email": recipient}],
        "subject": "万象账号注册验证码",
        "htmlContent": html_content,
        "textContent": text_content,
    }


def send_verification_code_email(*, email: str, code: str, ttl_seconds: int) -> None:
    """通过 Brevo 事务邮件 API 发送验证码；失败抛 :class:`EmailDeliveryError`。

    该函数是测试的替换点（monkeypatch 后可捕获明文验证码），内部只读取配置，
    不读取数据库。
    """

    settings = get_settings()
    if not settings.brevo_api_key.strip() or not settings.brevo_sender_email.strip():
        logger.warning("注册验证码邮件未发送：Brevo 未配置（缺 API Key 或发件人邮箱）")
        raise EmailDeliveryError("Brevo 邮件服务未配置")

    payload = build_brevo_payload(
        recipient=email,
        code=code,
        sender_email=settings.brevo_sender_email.strip(),
        sender_name=settings.brevo_sender_name.strip() or "万象 WANXIANG",
        ttl_seconds=ttl_seconds,
    )
    request = urllib.request.Request(
        settings.brevo_api_url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "api-key": settings.brevo_api_key.strip(),
            "accept": "application/json",
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=settings.brevo_timeout_s) as response:
            status = int(getattr(response, "status", 0) or 0)
    except urllib.error.HTTPError as exc:
        logger.warning("注册验证码邮件发送失败 status=%s", exc.code)
        raise EmailDeliveryError("发送失败") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        logger.warning("注册验证码邮件发送失败：%s", type(exc).__name__)
        raise EmailDeliveryError("发送失败") from None
    if not 200 <= status < 300:
        logger.warning("注册验证码邮件发送失败 status=%s", status)
        raise EmailDeliveryError("发送失败")


def issue_registration_code(db: Session, *, email: str) -> dict[str, Any]:
    """签发并发送注册验证码；返回展示邮箱与时效信息。

    邮箱格式非法 → 422；邮箱已注册 → 409；60 秒内重发 → 429。
    """

    normalized = normalize_email(email)
    if _email_registered(db, normalized.identifier):
        raise email_already_registered()

    settings = get_settings()
    now = utc_now()
    active = _active_code(db, normalized.identifier)
    if active is not None:
        elapsed = max(0.0, (now - active.created_at).total_seconds())
        if elapsed < settings.register_code_resend_seconds:
            retry_after = max(
                1, math.ceil(settings.register_code_resend_seconds - elapsed)
            )
            raise rate_limited(
                f"请在 {retry_after} 秒后再获取验证码",
                retry_after_seconds=retry_after,
            )
        active.consumed_at = now

    code = f"{secrets.randbelow(10 ** CODE_LENGTH):0{CODE_LENGTH}d}"
    record = EmailVerificationCodeRecord(
        id=new_email_verification_id(),
        email=normalized.identifier,
        purpose=PURPOSE_REGISTER,
        code_hash=_code_hash(code),
        attempts=0,
        created_at=now,
        expires_at=now + timedelta(seconds=settings.register_code_ttl_seconds),
        consumed_at=None,
    )
    db.add(record)
    db.commit()

    try:
        send_verification_code_email(
            email=normalized.display,
            code=code,
            ttl_seconds=settings.register_code_ttl_seconds,
        )
    except EmailDeliveryError:
        record.consumed_at = utc_now()
        db.commit()
        raise model_unavailable("验证码邮件发送失败，请稍后重试") from None

    logger.info("注册验证码已发送")
    return {
        "email": normalized.display,
        "expires_in_seconds": settings.register_code_ttl_seconds,
        "resend_after_seconds": settings.register_code_resend_seconds,
    }


def consume_registration_code(db: Session, *, email: str, code: str) -> str:
    """核验并立即作废注册验证码；成功返回规范化后的展示邮箱。"""

    normalized = normalize_email(email)
    raw = (code or "").strip()
    if len(raw) != CODE_LENGTH or not raw.isdigit():
        raise missing_field(
            f"请输入 {CODE_LENGTH} 位数字验证码", field="verification_code"
        )

    settings = get_settings()
    now = utc_now()
    active = _active_code(db, normalized.identifier)
    if active is None:
        latest = _latest_code(db, normalized.identifier)
        message = (
            "验证码已失效，请重新获取"
            if latest is not None and latest.consumed_at is not None
            else "请先获取邮箱验证码"
        )
        raise missing_field(message, field="verification_code")

    if active.expires_at <= now:
        active.consumed_at = now
        db.commit()
        raise missing_field("验证码已过期，请重新获取", field="verification_code")

    if active.attempts >= settings.register_code_max_attempts:
        active.consumed_at = now
        db.commit()
        raise rate_limited("验证码尝试次数过多，请重新获取", field="verification_code")

    if not hmac.compare_digest(active.code_hash, _code_hash(raw)):
        active.attempts += 1
        remaining = settings.register_code_max_attempts - active.attempts
        if remaining <= 0:
            active.consumed_at = now
            db.commit()
            raise rate_limited(
                "验证码尝试次数过多，请重新获取", field="verification_code"
            )
        db.commit()
        raise missing_field(
            f"验证码不正确，还可尝试 {remaining} 次",
            field="verification_code",
            attempts_left=remaining,
        )

    active.consumed_at = now
    db.commit()
    return normalized.display


__all__ = [
    "CODE_LENGTH",
    "EmailDeliveryError",
    "PURPOSE_REGISTER",
    "build_brevo_payload",
    "consume_registration_code",
    "issue_registration_code",
    "send_verification_code_email",
]

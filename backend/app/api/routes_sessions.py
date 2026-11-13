"""会话端点（``C-API@1`` #1、#2；R2-AC1/AC3/AC5、R13-AC3）。

- ``POST /api/v1/sessions``（auth N）：创建访客会话，下发
  ``HttpOnly; SameSite=Lax; Path=/`` Cookie；``Secure`` 由 ``SESSION_COOKIE_SECURE`` 控制
  （默认 false，本地无 HTTPS）。原始凭据不写 localStorage（R2-AC1）。
- ``GET /api/v1/sessions/current``（auth S）：返回 ``SessionInfo``；无/过期 Cookie → 401
  ``SESSION_EXPIRED``。
"""

from __future__ import annotations

import logging
import secrets
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..db.models import SessionRecord
from ..schemas.api_models import SessionInfo
from ..schemas.common import iso_after, to_iso, utc_now
from ..settings import get_settings
from . import API_PREFIX, DBDep, SessionDep, ok

logger = logging.getLogger(__name__)

router = APIRouter(prefix=API_PREFIX, tags=["sessions"])


@router.post("/sessions", summary="创建访客会话（端点 #1）")
def create_session(request: Request, db: DBDep) -> JSONResponse:
    """创建访客会话并下发会话 Cookie。

    Cookie 只存随机会话标识（``ses_`` + 128 bit），不携带任何用户身份信息；
    ``csrf_token`` 通过响应体下发，写请求需回传到 ``X-CSRF-Token``（§2.2.7 行为 2）。
    """

    settings = get_settings()
    now = utc_now()
    session = SessionRecord(
        id=f"ses_{uuid4().hex}",
        csrf_token=secrets.token_urlsafe(32),
        created_at=to_iso(now),
        expires_at=iso_after(settings.session_ttl_hours, base=now),
        retention_hours=settings.material_retention_hours,
    )
    db.add(session)
    db.commit()

    response = ok(
        request,
        SessionInfo(
            session_id=session.id,
            expires_at=session.expires_at,
            csrf_token=session.csrf_token,
            retention_hours=session.retention_hours,
        ),
    )
    response.set_cookie(
        key=settings.session_cookie_name,
        value=session.id,
        max_age=settings.session_ttl_hours * 3600,
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.session_cookie_secure,
    )
    # 日志只记录会话标识，不记录 csrf_token / Cookie 原文（R12-AC5）。
    logger.info("已创建访客会话 %s，保留 %d 小时", session.id, session.retention_hours)
    return response


@router.get("/sessions/current", summary="读取当前会话（端点 #2）")
def get_current_session(request: Request, ctx: SessionDep) -> JSONResponse:
    """返回当前会话信息；会话无效时由依赖统一抛 401 ``SESSION_EXPIRED``。"""

    return ok(
        request,
        SessionInfo(
            session_id=ctx.session_id,
            expires_at=ctx.expires_at,
            csrf_token=ctx.csrf_token,
            retention_hours=ctx.retention_hours,
        ),
    )


__all__ = ["router"]

"""``/api/v1`` 共享设施：request_id、统一响应、会话依赖、CSRF、归属校验。

这是 T7 与 T10 路由模块共同使用的薄层，只做"横切"能力，不含任何端点：

- ``ok()`` / ``empty()``：构造 ``{"data": ..., "request_id": ...}`` 或 204 响应；
  ``request_id`` 由中间件生成并写入 ``request.state``，与 ``X-Request-Id`` 头一致。
- ``SessionDep`` / ``WriteDep``：读请求只校验会话，写请求额外校验 CSRF 与 Origin。
- ``owned_*``：归属校验失败统一 404 + ``SESSION_EXPIRED`` / "资源不可用"（D2），
  不区分"无权"与"不存在"（R2-AC3）。

字段名与契约逐字一致（snake_case），不做任何命名转换。
"""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..db.models import JobRecord, KnowledgeObjectRecord, MaterialRecord, SessionRecord
from ..db.session import get_db
from ..schemas.common import is_expired, success_payload
from ..schemas.errors import (
    missing_field,
    resource_unavailable,
    session_expired,
)
from ..settings import get_settings

logger = logging.getLogger(__name__)

#: 路由统一前缀（§2.2.7：所有接口都带 ``/api/v1``）。
API_PREFIX = "/api/v1"
#: request_id 在 ``request.state`` 上的属性名，也是响应头名（小写）。
REQUEST_ID_STATE_KEY = "request_id"
REQUEST_ID_HEADER = "X-Request-Id"
#: 写请求的 CSRF 头名（§2.2.7 契约级行为 2）。
CSRF_HEADER = "X-CSRF-Token"


@dataclass(frozen=True, slots=True)
class SessionContext:
    """当前请求的会话快照；``csrf_token`` 只用于服务端比较，不写日志。"""

    session_id: str
    csrf_token: str
    expires_at: str
    retention_hours: int


# ---------------------------------------------------------------------------
# 响应构造
# ---------------------------------------------------------------------------


def get_request_id(request: Request) -> str:
    """取当前请求的 request_id（中间件保证一定存在）。"""

    value = getattr(request.state, REQUEST_ID_STATE_KEY, None)
    return str(value) if value else "unknown"


def ok(request: Request, data: Any, status_code: int = 200) -> JSONResponse:
    """构造成功响应；``data`` 可以是 Pydantic 模型（由 ``jsonable_encoder`` 编码）。"""

    # Pydantic 模型与 Decimal/日期等需要先编码，不依赖路由返回值的自动编码路径。
    return JSONResponse(
        content=jsonable_encoder(success_payload(data, get_request_id(request))),
        status_code=status_code,
    )


def empty(request: Request, status_code: int = 204) -> Response:
    """构造无体响应（端点 #8 删除材料）；``X-Request-Id`` 由中间件统一回写。"""

    return Response(status_code=status_code)


def clamp_limit(limit: int | None) -> int:
    """分页收敛：默认 20、最大 50，超出按 50 处理且不报错（§2.2.7 行为 5）。"""

    return get_settings().normalize_limit(limit)


# ---------------------------------------------------------------------------
# 会话与写请求校验
# ---------------------------------------------------------------------------


def load_session_row(db: Session, raw_session_id: str | None) -> SessionRecord:
    """按 Cookie 值取会话；缺失/过期一律 ``SESSION_EXPIRED``（401）。"""

    if not raw_session_id:
        raise session_expired("会话不存在，请重新进入工作空间")
    row = db.get(SessionRecord, raw_session_id)
    if row is None:
        raise session_expired("会话不存在，请重新进入工作空间")
    if is_expired(row.expires_at):
        # 过期会话不删除数据：其材料本身也已到期，保留只读入口由 status 表达。
        raise session_expired("会话已过期，请重新进入工作空间")
    return row


def _to_context(row: SessionRecord) -> SessionContext:
    return SessionContext(
        session_id=row.id,
        csrf_token=row.csrf_token,
        expires_at=row.expires_at,
        retention_hours=row.retention_hours,
    )


def require_session(
    request: Request, db: Session = Depends(get_db)
) -> SessionContext:
    """读请求依赖：校验 Cookie 会话（端点 #2/#6/#7/#9/#10 等）。"""

    settings = get_settings()
    raw = request.cookies.get(settings.session_cookie_name)
    return _to_context(load_session_row(db, raw))


def _check_origin(request: Request) -> None:
    """Origin 必须在允许列表内；缺省 Origin（如 curl/服务端调用）不参与判定。

    契约 C-09 未定义 403 专用码，这里按"缺字段"处理为 ``MISSING_FIELD``（422），
    与 CSRF 缺失保持同一错误码（见回报中的契约缺口清单）。
    """

    settings = get_settings()
    origin = request.headers.get("origin")
    if not origin:
        return
    allowed = {item.rstrip("/") for item in settings.allowed_origins}
    if origin.rstrip("/") not in allowed:
        # 把实际来源写进消息：本地用 localhost / 127.0.0.1 / [::1] 打开时 Origin 并不相同，
        # 只报"来源不被允许"会让人无从下手。
        logger.warning("拒绝写请求：来源 %s 不在允许列表 %s", origin, sorted(allowed))
        raise missing_field(f"请求来源不被允许（{origin}）", origin=origin)


def check_origin(request: Request) -> None:
    """``_check_origin`` 的公开别名（``C-AUTHAPI@1``）；行为逐字不变。

    ``_check_origin`` 继续保留，既有 ``write_context`` 的内部调用路径不受影响。
    """

    _check_origin(request)


def _check_csrf(request: Request, ctx: SessionContext) -> None:
    """写请求必须携带与当前会话一致的 ``X-CSRF-Token``（§2.2.7 行为 2）。"""

    settings = get_settings()
    if not settings.enforce_csrf:
        return
    _check_origin(request)
    provided = request.headers.get(CSRF_HEADER)
    if not provided:
        raise missing_field("缺少 CSRF 令牌", header=CSRF_HEADER)
    if not secrets.compare_digest(provided, ctx.csrf_token):
        raise missing_field("CSRF 令牌无效，请重新载入页面", header=CSRF_HEADER)


def write_context(
    request: Request, db: Session = Depends(get_db)
) -> SessionContext:
    """写请求依赖：会话 + Origin + CSRF（``POST /sessions`` 之外的所有写请求）。"""

    settings = get_settings()
    raw = request.cookies.get(settings.session_cookie_name)
    ctx = _to_context(load_session_row(db, raw))
    _check_csrf(request, ctx)
    return ctx


#: 读请求依赖别名。
SessionDep = Annotated[SessionContext, Depends(require_session)]
#: 写请求依赖别名（含 CSRF 校验）。
WriteDep = Annotated[SessionContext, Depends(write_context)]
#: 数据库会话依赖别名。
DBDep = Annotated[Session, Depends(get_db)]


# ---------------------------------------------------------------------------
# 归属校验（R2-AC3、§2.3.7 D2）
# ---------------------------------------------------------------------------


def owned_material(db: Session, ctx: SessionContext, material_id: str) -> MaterialRecord:
    """取当前会话的材料；不存在或属他人一律 404 + ``SESSION_EXPIRED``。"""

    row = db.get(MaterialRecord, material_id)
    if row is None or row.session_id != ctx.session_id:
        raise resource_unavailable()
    return row


def owned_job(db: Session, ctx: SessionContext, job_id: str) -> JobRecord:
    """取当前会话的任务；``job_id`` 全局唯一但只允许本人访问。"""

    row = db.get(JobRecord, job_id)
    if row is None or row.session_id != ctx.session_id:
        raise resource_unavailable()
    return row


def owned_object(
    db: Session, ctx: SessionContext, object_id: str
) -> KnowledgeObjectRecord:
    """取当前会话的知识对象（T10 端点复用）。"""

    row = db.get(KnowledgeObjectRecord, object_id)
    if row is None or row.session_id != ctx.session_id:
        raise resource_unavailable()
    return row


__all__ = [
    "API_PREFIX",
    "CSRF_HEADER",
    "DBDep",
    "REQUEST_ID_HEADER",
    "REQUEST_ID_STATE_KEY",
    "SessionContext",
    "SessionDep",
    "WriteDep",
    "check_origin",
    "clamp_limit",
    "empty",
    "get_request_id",
    "load_session_row",
    "ok",
    "owned_job",
    "owned_material",
    "owned_object",
    "require_session",
    "write_context",
]

"""账号端点（``C-AUTHAPI@1``）：注册 / 登录 / 退出 / 当前账号。

- ``router`` 由 ``app.api.registry`` 的 ``pkgutil`` 自动发现（模块名 ``routes_auth``），
  **不需要**改 ``main.py``；
- 本模块只负责 HTTP 形状：Cookie、CSRF、错误码与响应封装；业务规则全部在
  ``app.accounts`` 中，路由不内嵌算法；
- ``logout`` 使用 :func:`require_auth_write`（Origin → 会话 → CSRF 顺序），
  ``GET /me`` 使用 :func:`require_auth_session`（GET 无副作用，不校验 CSRF）；
- 日志只记录 ``user_id`` / ``session_id``，**不记录**邮箱、密码、令牌或 CSRF。
"""

from __future__ import annotations

import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy.orm import Session, object_session

from ..accounts import (
    authenticate,
    avatar_path,
    consume_registration_code,
    create_account,
    create_auth_session,
    csrf_token_for,
    delete_avatar,
    find_email_identity,
    find_username_identity,
    get_active_user,
    get_or_create_profile,
    hash_token,
    interests_of,
    issue_registration_code,
    resolve_auth_session,
    revoke_auth_session,
    save_avatar,
    update_profile,
    validate_registration,
    verify_csrf,
)
from ..db.account_models import (
    AuthSessionRecord,
    LoginIdentityRecord,
    UserProfileRecord,
    UserRecord,
    to_contract_iso,
    utc_now,
)
from ..schemas.account_api_models import (
    AuthSessionSummary,
    AuthUser,
    LoginRequest,
    LoginResult,
    MeResponse,
    ProfileUpdateResult,
    RegisterCodeRequest,
    RegisterCodeResult,
    RegisterRequest,
    UpdateMeRequest,
    UserProfile,
)
from ..schemas.errors import auth_required, missing_field, resource_unavailable
from ..settings import get_settings
from . import API_PREFIX, CSRF_HEADER, DBDep, check_origin, empty, ok

logger = logging.getLogger(__name__)

router = APIRouter(prefix=API_PREFIX, tags=["auth"])


# ---------------------------------------------------------------------------
# 依赖：账号 Cookie、会话解析、写请求 CSRF
# ---------------------------------------------------------------------------


def _auth_cookie(request: Request) -> Optional[str]:
    """取账号 Cookie 原文（缺失返回 ``None``）；只用于比较，不写日志。"""

    return request.cookies.get(get_settings().auth_cookie_name)


def require_auth_session(request: Request, db: DBDep) -> AuthSessionRecord:
    """读请求依赖：有效 ``xs_auth`` Cookie → 会话行；否则 401 ``AUTH_REQUIRED``。

    允许按 5 分钟节流滑动 ``last_seen_at``（``touch=True``）。
    """

    return resolve_auth_session(db, _auth_cookie(request), touch=True)


def require_auth_write(request: Request, db: DBDep) -> AuthSessionRecord:
    """写请求依赖：``check_origin`` → 会话解析 → ``X-CSRF-Token`` 校验。

    顺序不可调整：先拒绝非法来源（422），再判会话（401），最后判 CSRF（422），
    这样错误语义与既有访客写请求一致。CSRF 失败时会话保持有效。
    """

    check_origin(request)
    row = resolve_auth_session(db, _auth_cookie(request), touch=False)
    provided = request.headers.get(CSRF_HEADER) or ""
    if not provided:
        raise missing_field("缺少 CSRF 令牌", header=CSRF_HEADER)
    if not verify_csrf(row, provided):
        raise missing_field("CSRF 令牌无效，请重新载入页面", header=CSRF_HEADER)
    return row


#: 读请求依赖别名。
AuthSessionDep = Annotated[AuthSessionRecord, Depends(require_auth_session)]
#: 写请求依赖别名（含 Origin 与 CSRF 校验）。
AuthWriteDep = Annotated[AuthSessionRecord, Depends(require_auth_write)]


# ---------------------------------------------------------------------------
# 响应组装
# ---------------------------------------------------------------------------


def _avatar_url(profile: Optional[UserProfileRecord]) -> Optional[str]:
    """头像地址：相对路径 + ``avatar_id`` 版本号；未上传时返回 ``None``。"""

    avatar_id = None if profile is None else profile.avatar_id
    if not avatar_id:
        return None
    return f"{API_PREFIX}/me/avatar?v={avatar_id}"


def _profile_payload(profile: UserProfileRecord) -> UserProfile:
    """把资料行组装成 ``UserProfile``；损坏的偏好值回退到默认值。"""

    default_entry = profile.default_entry if profile.default_entry in ("space", "labs") else "space"
    return UserProfile(
        bio=profile.bio or "",
        occupation=profile.occupation or "",
        school=profile.school or "",
        phone=profile.phone or "",
        interests=interests_of(profile),
        preferred_subject=profile.preferred_subject or "",
        default_entry=default_entry,
        updated_at=to_contract_iso(profile.updated_at),
    )


def _auth_user(
    user: UserRecord,
    identity: Optional[LoginIdentityRecord],
    username_identity: Optional[LoginIdentityRecord] = None,
    profile: Optional[UserProfileRecord] = None,
) -> AuthUser:
    """把 ``users`` + ``login_identities`` （+ 资料）组装成 ``AuthUser``。

    ``email`` 取邮箱身份的 ``display_identifier``；``username`` 取用户名身份，
    老账号没有用户名身份时回退到邮箱的本地部分。身份行缺失说明数据不完整，
    此时按未登录处理，避免返回半成品账号信息。
    """

    if identity is None or not identity.display_identifier:
        raise auth_required("账号信息不完整，请重新登录")
    username = (
        username_identity.display_identifier
        if username_identity is not None and username_identity.display_identifier
        else identity.display_identifier.split("@", 1)[0]
    )
    return AuthUser(
        user_id=user.id,
        username=username,
        email=identity.display_identifier,
        display_name=user.display_name,
        status="active",
        created_at=to_contract_iso(user.created_at),
        email_verification=(
            "verified" if identity.verified_at is not None else "disabled_development"
        ),
        avatar_url=_avatar_url(profile),
    )


def _profile_result(
    db: Session, user: UserRecord, profile: UserProfileRecord
) -> ProfileUpdateResult:
    """资料变更的统一响应：最新账号对象 + 最新资料。"""

    identity = find_email_identity(db, user.id)
    username_identity = find_username_identity(db, user.id)
    return ProfileUpdateResult(
        user=_auth_user(user, identity, username_identity, profile),
        profile=_profile_payload(profile),
    )


# ---------------------------------------------------------------------------
# 端点
# ---------------------------------------------------------------------------


@router.post("/auth/register/code", summary="发送注册邮箱验证码")
def send_register_code(
    request: Request, payload: RegisterCodeRequest, db: DBDep
) -> JSONResponse:
    """向未注册邮箱发送 6 位验证码（Brevo 事务邮件）。

    - 验证码 5 分钟有效，60 秒内不能重发，最多尝试 5 次，成功后立即作废；
    - 邮箱已注册 → 409 ``EMAIL_ALREADY_REGISTERED``；60 秒内重发 → 429
      ``RATE_LIMITED``（``details.retry_after_seconds`` 给出等待秒数）；
    - 邮件服务未配置或发送失败 → 503 ``MODEL_UNAVAILABLE``；邮箱格式非法 → 422。
    """

    check_origin(request)

    result = issue_registration_code(db, email=payload.email)
    return ok(request, RegisterCodeResult(**result))


@router.post("/auth/register", summary="注册账号")
def register(request: Request, payload: RegisterRequest, db: DBDep) -> JSONResponse:
    """校验邮箱验证码后注册账号：201，不下发任何登录 Cookie。

    步骤：字段与唯一性预检查（422/409）→ 核验并作废验证码（422/429）→ 创建账号。
    验证码错误、过期、失效 → 422 ``MISSING_FIELD``（``details.field`` 为
    ``verification_code``）；尝试次数超限 → 429 ``RATE_LIMITED``。

    写请求要求 Origin 在允许列表内（R7-6），不允许 → 422 ``MISSING_FIELD``；
    缺省 Origin（curl/服务端调用）不参与判定。
    """

    check_origin(request)

    pending = validate_registration(
        db,
        username=payload.username,
        email=payload.email,
        password=payload.password,
        display_name=payload.display_name,
    )
    consume_registration_code(
        db, email=payload.email, code=payload.verification_code
    )
    user = create_account(db, pending, verified_at=utc_now())
    identity = find_email_identity(db, user.id)
    username_identity = find_username_identity(db, user.id)
    profile = get_or_create_profile(db, user.id)
    return ok(
        request,
        _auth_user(user, identity, username_identity, profile),
        status_code=201,
    )


@router.post("/auth/login", summary="登录账号")
def login(request: Request, payload: LoginRequest, db: DBDep) -> JSONResponse:
    """校验凭据、签发会话并下发 ``HttpOnly`` Cookie；``remember`` 决定窗口长度。

    ``identifier`` 可以是用户名或邮箱。写请求要求 Origin 在允许列表内（R7-6），
    不允许 → 422 ``MISSING_FIELD``；缺省 Origin（curl/服务端调用）不参与判定。
    凭据错误统一 401 ``INVALID_CREDENTIALS``；账号非 ``active`` 为 403 ``FORBIDDEN``。
    """

    check_origin(request)

    user = authenticate(
        db, identifier=payload.login_identifier, password=payload.password
    )
    settings = get_settings()
    created = create_auth_session(
        db,
        user_id=user.id,
        remember=payload.remember,
        device_label=request.headers.get("user-agent"),
    )
    identity = find_email_identity(db, user.id)
    username_identity = find_username_identity(db, user.id)
    profile = get_or_create_profile(db, user.id)

    response = ok(
        request,
        LoginResult(
            user=_auth_user(user, identity, username_identity, profile),
            csrf_token=created.csrf_token,
            expires_at=to_contract_iso(created.row.idle_expires_at),
            absolute_expires_at=to_contract_iso(created.row.absolute_expires_at),
        ),
    )
    max_age_hours = (
        settings.auth_remember_absolute_hours
        if payload.remember
        else settings.auth_session_absolute_hours
    )
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=created.raw_token,
        max_age=max_age_hours * 3600,
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.session_cookie_secure,
    )
    logger.info(
        "账号登录成功 user_id=%s session_id=%s", user.id, created.row.id
    )
    return response


@router.post("/auth/logout", summary="退出登录")
def logout(request: Request, row: AuthWriteDep, db: DBDep) -> Response:
    """撤销当前会话并清除 Cookie；204 无体。

    同一 Cookie 第二次调用返回 401（会话已撤销），这是契约要求的幂等语义。
    """

    # 依赖与路由参数虽共享同一 ``get_db`` 实例（FastAPI 依赖缓存），这里仍取
    # ``row`` 真正的归属会话，避免依赖缓存被关闭时在错误的 Session 上 commit。
    owner: Session = object_session(row) or db
    revoke_auth_session(owner, row)
    response = empty(request, status_code=204)
    settings = get_settings()
    response.set_cookie(
        key=settings.auth_cookie_name,
        value="",
        max_age=0,
        expires=0,
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.session_cookie_secure,
    )
    logger.info("账号退出登录 user_id=%s session_id=%s", row.user_id, row.id)
    return response


@router.get("/me", summary="读取当前账号")
def get_me(request: Request, row: AuthSessionDep, db: DBDep) -> JSONResponse:
    """返回当前账号、会话摘要与**可用的** CSRF 令牌；未登录一律 401 且不含账号字段。"""

    user = get_active_user(db, row.user_id)
    identity = find_email_identity(db, user.id)
    username_identity = find_username_identity(db, user.id)
    profile = get_or_create_profile(db, user.id)
    raw_token = _auth_cookie(request) or ""
    csrf_token = csrf_token_for(raw_token)
    if hash_token(csrf_token) != row.csrf_token_hash:
        # 会话行不是由本版本签发（例如外部直接插入）时，不返回无法通过校验的令牌。
        raise auth_required("会话凭据已失效，请重新登录")

    idle_iso = to_contract_iso(row.idle_expires_at)
    return ok(
        request,
        MeResponse(
            user=_auth_user(user, identity, username_identity, profile),
            session=AuthSessionSummary(
                session_id=row.id,
                expires_at=idle_iso,
                idle_expires_at=idle_iso,
            ),
            csrf_token=csrf_token,
            profile=_profile_payload(profile),
        ),
    )


@router.patch("/me", summary="更新当前账号资料")
def update_me(
    request: Request,
    payload: UpdateMeRequest,
    row: AuthWriteDep,
    db: DBDep,
) -> JSONResponse:
    """修改昵称、简介与偏好；只作用于当前登录账号。

    未提供的字段保持不变；``display_name`` 去空白后为空 → 422。
    写请求复用 Origin + 会话 + CSRF 校验（与退出登录一致）。
    """

    user = get_active_user(db, row.user_id)
    profile = update_profile(
        db,
        user,
        display_name=payload.display_name,
        bio=payload.bio,
        occupation=payload.occupation,
        school=payload.school,
        phone=payload.phone,
        interests=payload.interests,
        preferred_subject=payload.preferred_subject,
        default_entry=payload.default_entry,
    )
    logger.info("账号资料已更新 user_id=%s", user.id)
    return ok(request, _profile_result(db, user, profile))


@router.post("/me/avatar", summary="上传或更换头像")
async def upload_me_avatar(
    request: Request,
    row: AuthWriteDep,
    db: DBDep,
    file: UploadFile = File(...),
) -> JSONResponse:
    """接收 JPG / PNG / WebP（≤2MB），服务端方形裁剪并重编码为 JPEG。"""

    user = get_active_user(db, row.user_id)
    profile = get_or_create_profile(db, row.user_id)
    # 多读 1 字节用于判定超限，避免把超大文件完整读入内存。
    content = await file.read(get_settings().avatar_max_bytes + 1)
    profile = save_avatar(db, profile, user_id=user.id, content=content)
    return ok(request, _profile_result(db, user, profile))


@router.delete("/me/avatar", summary="恢复默认头像")
def reset_me_avatar(request: Request, row: AuthWriteDep, db: DBDep) -> JSONResponse:
    """删除已上传头像并回到昵称首字；重复调用幂等。"""

    user = get_active_user(db, row.user_id)
    profile = get_or_create_profile(db, row.user_id)
    profile = delete_avatar(db, profile, user_id=user.id)
    return ok(request, _profile_result(db, user, profile))


@router.get("/me/avatar", summary="读取当前账号头像")
def get_me_avatar(row: AuthSessionDep, db: DBDep) -> FileResponse:
    """返回重编码后的 JPEG；未上传时 404（前端回退昵称首字）。"""

    profile = get_or_create_profile(db, row.user_id)
    path = avatar_path(row.user_id)
    if profile.avatar_id is None or not path.is_file():
        raise resource_unavailable()
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
        },
    )


__all__ = [
    "AuthSessionDep",
    "AuthWriteDep",
    "require_auth_session",
    "require_auth_write",
    "router",
]
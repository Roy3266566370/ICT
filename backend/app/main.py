"""FastAPI 应用装配（``R14-AC2``、``C-REG@1``、``C-ERR@1``）。

启动行为：

1. 读取配置并配置日志（日志不打印 Cookie / CSRF / 密钥，R12-AC5）。
2. ``lifespan`` 内执行幂等 ``init_db()``，建 9 张表并打印清单；创建上传目录。
3. 通过 ``app.api.registry`` 自动注册 ``routes_*`` 模块（并行新增路由不改本文件）；
   必需账号路由模块或必需端点缺失时抛 ``RouteRegistrationError`` → 进程启动失败
   （``C-ROUTE-CHECK@1``）。
4. 统一中间件回写 ``X-Request-Id``，统一异常处理器把 ``ApiError`` / ``KernelError`` /
   参数校验失败 / 未预期异常全部收敛为 ``{"error": {...}, "request_id": ...}``，
   从而不让 500 裸抛（T7 约束 11）。
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api import REQUEST_ID_HEADER, REQUEST_ID_STATE_KEY
from .api.registry import RouteRegistrationError, collect_endpoints, register_routes
from .db.init_db import init_db
from .schemas.errors import (
    ApiError,
    ErrorCode,
    HTTP_STATUS,
    from_kernel_error,
    from_validation_error,
    model_unavailable,
    session_expired,
)
from .settings import BACKEND_DIR, UPLOAD_DIR, configure_logging, get_settings

logger = logging.getLogger(__name__)


def new_request_id() -> str:
    """``uuid4().hex[:16]``（§2.2.7 契约级行为 1）。"""

    return uuid4().hex[:16]


def _request_id(request: Request) -> str:
    value = getattr(request.state, REQUEST_ID_STATE_KEY, None)
    if value:
        return str(value)
    # 极端兜底：中间件之外的处理器（例如未进入用户中间件栈的异常）也能拿到可读 id。
    fresh = new_request_id()
    request.state.__dict__[REQUEST_ID_STATE_KEY] = fresh
    return fresh


def _error_response(
    request: Request,
    error: ApiError,
    *,
    status_code: int | None = None,
) -> JSONResponse:
    rid = _request_id(request)
    return JSONResponse(
        status_code=status_code or error.status_code,
        content=error.to_body(rid),
        headers={REQUEST_ID_HEADER: rid},
    )


def _http_error_to_api_error(exc: StarletteHTTPException) -> ApiError:
    """把框架级 HTTP 错误映射到 C-ERR@1 的 8 个码之一（不新增错误码）。"""

    status = exc.status_code
    if status == 401:
        return session_expired("会话已过期，请重新进入工作空间")
    if status == 404:
        # 这里只处理框架级 404（路径不存在）；归属校验失败由 ApiError 分支返回
        # SESSION_EXPIRED，两者用不同 code 区分，避免排障时把路径写错误判为会话问题。
        return ApiError(
            ErrorCode.MISSING_FIELD,
            "接口不存在，请检查请求路径。材料操作使用 /api/v1/materials/{material_id}/ai-*。",
            status_code=404,
        )
    if status == 405:
        return ApiError(ErrorCode.MISSING_FIELD, "不支持的请求方法", status_code=405)
    if status == 413:
        return ApiError(ErrorCode.LIMIT_EXCEEDED, "请求体超出限制", status_code=413)
    if status in (400, 422):
        detail = exc.detail if isinstance(exc.detail, str) else "请求不合法"
        return ApiError(
            ErrorCode.INVALID_FILE if status == 400 else ErrorCode.MISSING_FIELD,
            detail,
            status_code=status,
        )
    return ApiError(ErrorCode.MODEL_UNAVAILABLE, "服务暂时不可用，请稍后重试", status_code=status)


def create_app(*, strict_routes: bool | None = None) -> FastAPI:
    """构造应用（工厂形式便于测试与脚本使用不同配置）。

    ``strict_routes`` 为 ``None`` 时取配置项 ``STRICT_ROUTE_CHECK``（默认 ``True``）；
    显式传入 ``True`` / ``False`` 可覆盖配置，仅用于测试与应急旁路。
    """

    settings = get_settings()
    configure_logging(settings)
    strict = settings.strict_route_check if strict_routes is None else strict_routes

    @asynccontextmanager
    async def lifespan(app_instance: FastAPI) -> AsyncIterator[None]:
        # 幂等建表：可重复启动、不丢数据（T7 验收 1）。
        tables = init_db()
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        logger.info("后端目录：%s", BACKEND_DIR)
        logger.info("已注册端点：%d", len(collect_endpoints(app_instance)))
        logger.info("启动完成：%s v%s，表：%s", settings.app_name, settings.app_version, ", ".join(tables))
        yield

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="万象 WANXIANG v0.2 —— 统一参数模型 + 多视图同步 + 确定性内核 + 独立校验 + 来源可溯",
        lifespan=lifespan,
    )

    # CORS 只放行配置中的来源，并允许携带 Cookie（R13-AC4 的 Origin 校验在依赖层再做一次）。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token", "X-Request-Id"],
        expose_headers=[REQUEST_ID_HEADER],
    )

    @app.middleware("http")
    async def attach_request_id(request: Request, call_next):  # type: ignore[no-untyped-def]
        """为每个请求生成 request_id，并在响应头回写（与 body 一致）。"""

        rid = new_request_id()
        setattr(request.state, REQUEST_ID_STATE_KEY, rid)
        try:
            response = await call_next(request)
        except Exception:  # noqa: BLE001 - 最后一道防线，避免 500 裸抛
            logger.exception("请求 %s %s 未预期失败（request_id=%s）", request.method, request.url.path, rid)
            error = model_unavailable("服务处理异常，请稍后重试")
            return JSONResponse(
                status_code=HTTP_STATUS[ErrorCode.MODEL_UNAVAILABLE],
                content=error.to_body(rid),
                headers={REQUEST_ID_HEADER: rid},
            )
        response.headers[REQUEST_ID_HEADER] = rid
        return response

    # --- 统一异常处理（T7 约束 11）---

    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
        return _error_response(request, exc)

    from .ppt_ai.tasks import TaskConflict

    @app.exception_handler(TaskConflict)
    async def handle_task_conflict(request: Request, exc: TaskConflict) -> JSONResponse:
        return _error_response(
            request,
            ApiError(ErrorCode.VERSION_CONFLICT, str(exc) or "同一操作标识已用于不同输入"),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return _error_response(request, from_validation_error(exc))

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        return _error_response(request, _http_error_to_api_error(exc), status_code=exc.status_code)

    # 引擎错误（C-ENGINE@1）：KernelError 只在 ``app.engines.types`` 定义过一次，直接复用。
    try:
        from .engines.types import KernelError  # noqa: PLC0415 - 避免与内核包形成导入环
    except Exception:  # pragma: no cover - 内核缺失时降级（不影响基础端点）
        logger.warning("未找到 app.engines.types.KernelError，跳过该异常处理器")
    else:

        @app.exception_handler(KernelError)
        async def handle_kernel_error(request: Request, exc: KernelError) -> JSONResponse:
            return _error_response(request, from_kernel_error(exc))

    # 自动注册；非必需模块缺失或导入失败只告警（C-REG@1），
    # 但必需账号路由模块/端点缺失时抛 RouteRegistrationError 让启动失败（C-ROUTE-CHECK@1）。
    try:
        registered = register_routes(app, strict=strict)
    except RouteRegistrationError:
        logger.error(
            "启动失败：必需账号路由缺失（strict=%s），请检查 backend/app/api/routes_auth.py 是否存在并导出 router",
            strict,
        )
        logger.error("若确认要临时跳过该校验，可在 backend/.env 设置 STRICT_ROUTE_CHECK=false 后重启")
        raise
    logger.info("已注册 %d 个路由模块：%s", len(registered), ", ".join(registered))
    return app


#: uvicorn 入口（``python -m uvicorn app.main:app --app-dir backend``）。
app = create_app()


__all__ = ["app", "create_app", "new_request_id"]

"""共享响应封装与时间工具（C-API@1 通用封装，plan §2.2.7）。

成功响应::

    {"data": <T>, "request_id": "<16 hex>"}

错误响应（``request_id`` 在**顶层**）::

    {"error": {"code": ..., "message": ..., "retryable": ..., "details": {...}},
     "request_id": "..."}

``request_id`` 同时回写响应头 ``X-Request-Id``，两者必须一致（T7 验收 2）。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from .errors import ApiError, ApiErrorModel, ErrorBody, ErrorCode

T = TypeVar("T")

#: 统一 UTC 时区，所有时间字段都按 ISO 8601 UTC 序列化。
UTC = timezone.utc


class ApiSuccess(BaseModel, Generic[T]):
    """成功响应外壳；``204`` 端点不返回 body。"""

    model_config = ConfigDict(extra="forbid")

    data: T
    request_id: str = Field(min_length=1)


#: 供路由声明 ``response_model`` 时复用的错误外壳。
ApiErrorEnvelope = ApiErrorModel


# ---------------------------------------------------------------------------
# 时间：统一 ISO 8601 UTC（``2026-11-01T00:00:00Z``）
# ---------------------------------------------------------------------------


def utc_now() -> datetime:
    """当前时间（UTC，秒级精度，去掉微秒便于幂等比较与展示）。"""

    return datetime.now(tz=UTC).replace(microsecond=0)


def to_iso(moment: datetime) -> str:
    """转成契约使用的 ISO 8601 UTC 字符串。"""

    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(text: str) -> datetime:
    """解析 ISO 8601 字符串；无时区按 UTC 处理，非法输入抛 ``ValueError``。"""

    raw = text.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    parsed = datetime.fromisoformat(raw)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def iso_after(hours: float, *, base: datetime | None = None) -> str:
    """基准时间之后 ``hours`` 小时的 ISO 字符串。"""

    return to_iso((base or utc_now()) + timedelta(hours=hours))


def is_expired(expires_at: str, *, now: datetime | None = None) -> bool:
    """判断 ISO 时间是否已过期；解析失败视为已过期，避免泄露异常。"""

    try:
        return parse_iso(expires_at) <= (now or utc_now())
    except ValueError:
        return True


# ---------------------------------------------------------------------------
# 响应体构造
# ---------------------------------------------------------------------------


def success_payload(data: Any, request_id: str) -> dict[str, Any]:
    """构造 ``{"data": ..., "request_id": ...}``；Pydantic 模型由 FastAPI 编码。"""

    return {"data": data, "request_id": request_id}


def error_payload(error: ApiError | ErrorBody | ApiErrorModel, request_id: str) -> dict[str, Any]:
    """构造错误响应体；接受 ``ApiError`` 或已显式构造的 ``ErrorBody``。"""

    if isinstance(error, ApiErrorModel):
        return error.model_dump(mode="json")
    if isinstance(error, ErrorBody):
        return {"error": error.model_dump(mode="json"), "request_id": request_id}
    return error.to_body(request_id)


def error_body(
    code: ErrorCode,
    message: str,
    *,
    retryable: bool | None = None,
    details: dict[str, Any] | None = None,
) -> ErrorBody:
    """按 C-ERR@1 构造错误对象，``retryable`` 默认由码表推导。"""

    from .errors import DEFAULT_MESSAGES, RETRYABLE_CODES

    resolved_code = ErrorCode(code)
    return ErrorBody(
        code=resolved_code,
        message=message or DEFAULT_MESSAGES[resolved_code],
        retryable=(
            resolved_code in RETRYABLE_CODES if retryable is None else bool(retryable)
        ),
        details=details or None,
    )


__all__ = [
    "ApiErrorEnvelope",
    "ApiSuccess",
    "UTC",
    "error_body",
    "error_payload",
    "is_expired",
    "iso_after",
    "parse_iso",
    "success_payload",
    "to_iso",
    "utc_now",
]

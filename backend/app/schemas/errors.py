"""``C-ERR@1`` 错误码、HTTP 映射与统一错误对象（plan §2.2.8）。

规则摘要：

==============  ====  =========  =====================================================
code            HTTP  retryable  触发条件
==============  ====  =========  =====================================================
INVALID_FILE    400   false      非 pptx、ZIP 损坏、宏文件、加密、路径越界
LIMIT_EXCEEDED  413   false      >70MB、>60 页、解压 >200MB
PARSE_FAILED    422   true       python-pptx 抛异常或 0 页
MODEL_UNAVAILABLE 503 true       规则化候选生成器/解析器不可用
UNSUPPORTED_TEMPLATE 422 false   template_id 不在四个白名单内
MISSING_FIELD   422   false      缺字段、越界、非法引用、循环依赖、规模超限
VERSION_CONFLICT 409  false      expected_version / revision 与库中不一致
SESSION_EXPIRED 401   false      无 Cookie、过期；归属校验失败时 HTTP 改为 404（D2）
==============  ====  =========  =====================================================

归属校验失败（对象存在但属于别的会话）**不得暴露存在性**：统一返回 HTTP 404，
body 仍为 ``ApiError``，``code="SESSION_EXPIRED"``、``message="资源不可用"``（§2.3.7 D2）。
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Mapping

from pydantic import BaseModel, ConfigDict, Field


class ErrorCode(str, Enum):
    """C-ERR@1 的 8 个错误码，取值即线上字符串。"""

    INVALID_FILE = "INVALID_FILE"
    LIMIT_EXCEEDED = "LIMIT_EXCEEDED"
    PARSE_FAILED = "PARSE_FAILED"
    MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE"
    UNSUPPORTED_TEMPLATE = "UNSUPPORTED_TEMPLATE"
    MISSING_FIELD = "MISSING_FIELD"
    VERSION_CONFLICT = "VERSION_CONFLICT"
    SESSION_EXPIRED = "SESSION_EXPIRED"
    # --- C-ERR@2 追加（既有 8 个成员的名字与顺序不变，新成员一律追加在末尾）---
    AUTH_REQUIRED = "AUTH_REQUIRED"
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    EMAIL_ALREADY_REGISTERED = "EMAIL_ALREADY_REGISTERED"
    FORBIDDEN = "FORBIDDEN"
    EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED"
    RATE_LIMITED = "RATE_LIMITED"
    # --- C-ERR@3 追加：用户名注册后新增（既有成员的位置不变）---
    USERNAME_ALREADY_REGISTERED = "USERNAME_ALREADY_REGISTERED"


#: code → HTTP 状态码（§2.2.8 表）。
HTTP_STATUS: dict[ErrorCode, int] = {
    ErrorCode.INVALID_FILE: 400,
    ErrorCode.LIMIT_EXCEEDED: 413,
    ErrorCode.PARSE_FAILED: 422,
    ErrorCode.MODEL_UNAVAILABLE: 503,
    ErrorCode.UNSUPPORTED_TEMPLATE: 422,
    ErrorCode.MISSING_FIELD: 422,
    ErrorCode.VERSION_CONFLICT: 409,
    ErrorCode.SESSION_EXPIRED: 401,
    # --- C-ERR@2 追加（6 个新码均不可重试，RETRYABLE_CODES 不新增成员）---
    ErrorCode.AUTH_REQUIRED: 401,
    ErrorCode.INVALID_CREDENTIALS: 401,
    ErrorCode.EMAIL_ALREADY_REGISTERED: 409,
    ErrorCode.FORBIDDEN: 403,
    ErrorCode.EMAIL_NOT_VERIFIED: 403,
    ErrorCode.RATE_LIMITED: 429,
    # --- C-ERR@3 追加 ---
    ErrorCode.USERNAME_ALREADY_REGISTERED: 409,
}

#: 建议重试的错误码（§2.2.8 表）。
RETRYABLE_CODES: frozenset[ErrorCode] = frozenset(
    {ErrorCode.PARSE_FAILED, ErrorCode.MODEL_UNAVAILABLE}
)

#: 面向用户的中文兜底文案，代码中不重复拼接堆栈（R12-AC5）。
DEFAULT_MESSAGES: dict[ErrorCode, str] = {
    ErrorCode.INVALID_FILE: "文件无法识别，请上传未加密、无宏的 .pptx 文件",
    ErrorCode.LIMIT_EXCEEDED: "文件超出限制",
    ErrorCode.PARSE_FAILED: "解析失败，可以稍后重试",
    ErrorCode.MODEL_UNAVAILABLE: "解析或规则化能力暂不可用，可继续查看已保留的静态内容",
    ErrorCode.UNSUPPORTED_TEMPLATE: "暂不支持该模板",
    ErrorCode.MISSING_FIELD: "缺少必要字段或取值越界",
    ErrorCode.VERSION_CONFLICT: "内容版本已变化，请重新载入后确认",
    ErrorCode.SESSION_EXPIRED: "会话已过期，请重新进入工作空间",
    # --- C-ERR@2 追加 ---
    ErrorCode.AUTH_REQUIRED: "请先登录",
    ErrorCode.INVALID_CREDENTIALS: "用户名或密码不正确",
    ErrorCode.EMAIL_ALREADY_REGISTERED: "该邮箱已注册，可直接登录",
    ErrorCode.FORBIDDEN: "账号不可用，请联系管理员",
    ErrorCode.EMAIL_NOT_VERIFIED: "请先完成邮箱验证",
    ErrorCode.RATE_LIMITED: "请求过于频繁，请稍后再试",
    # --- C-ERR@3 追加 ---
    ErrorCode.USERNAME_ALREADY_REGISTERED: "该用户名已被占用，请换一个",
}

#: 归属校验失败时对外统一文案（§2.3.7 D2）。
RESOURCE_UNAVAILABLE_MESSAGE = "资源不可用"


class ErrorBody(BaseModel):
    """错误对象；``request_id`` 在响应顶层，不在这里（C-07）。"""

    model_config = ConfigDict(extra="forbid")

    code: ErrorCode
    message: str = Field(min_length=1)
    retryable: bool
    details: dict[str, Any] | None = None


class ApiErrorModel(BaseModel):
    """统一错误外壳：``{"error": {...}, "request_id": "..."}``。"""

    model_config = ConfigDict(extra="forbid")

    error: ErrorBody
    request_id: str


class ApiError(Exception):
    """可被统一异常处理器序列化为 ``ApiErrorModel`` 的业务错误。

    ``status_code`` 默认取 §2.2.8 的映射，可在归属校验失败时显式改为 404（D2）。
    """

    def __init__(
        self,
        code: ErrorCode,
        message: str | None = None,
        *,
        status_code: int | None = None,
        retryable: bool | None = None,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        self.code = ErrorCode(code)
        self.message = message or DEFAULT_MESSAGES[self.code]
        self.status_code = status_code or HTTP_STATUS[self.code]
        self.retryable = (
            self.code in RETRYABLE_CODES if retryable is None else bool(retryable)
        )
        self.details = dict(details) if details else None
        super().__init__(f"{self.code.value}: {self.message}")

    # --- 序列化 ---

    def to_body(self, request_id: str) -> dict[str, Any]:
        """转成响应体；字段顺序为 code/message/retryable/details。"""

        error: dict[str, Any] = {
            "code": self.code.value,
            "message": self.message,
            "retryable": self.retryable,
        }
        if self.details:
            error["details"] = self.details
        return {"error": error, "request_id": request_id}


# ---------------------------------------------------------------------------
# 便捷构造：路由与任务统一从这里取错误，避免各处手写状态码
# ---------------------------------------------------------------------------


def invalid_file(message: str | None = None, **details: Any) -> ApiError:
    """400：静态阅读入口保留，不重试。"""

    return ApiError(ErrorCode.INVALID_FILE, message, details=_clean(details))


def limit_exceeded(message: str | None = None, **details: Any) -> ApiError:
    """413：说明具体超限项。"""

    return ApiError(ErrorCode.LIMIT_EXCEEDED, message, details=_clean(details))


def parse_failed(message: str | None = None, **details: Any) -> ApiError:
    """422：可重试。"""

    return ApiError(ErrorCode.PARSE_FAILED, message, details=_clean(details))


def model_unavailable(message: str | None = None, **details: Any) -> ApiError:
    """503：可重试，且必须保留静态阅读入口。"""

    return ApiError(ErrorCode.MODEL_UNAVAILABLE, message, details=_clean(details))


def unsupported_template(message: str | None = None, **details: Any) -> ApiError:
    """422：template_id / example_id 不在白名单内。"""

    return ApiError(ErrorCode.UNSUPPORTED_TEMPLATE, message, details=_clean(details))


def missing_field(message: str | None = None, **details: Any) -> ApiError:
    """422：缺字段、越界、非法引用、循环依赖、规模超限。"""

    return ApiError(ErrorCode.MISSING_FIELD, message, details=_clean(details))


def version_conflict(message: str | None = None, **details: Any) -> ApiError:
    """409：``expected_version`` / ``revision`` 与库中不一致。"""

    return ApiError(ErrorCode.VERSION_CONFLICT, message, details=_clean(details))


def session_expired(message: str | None = None, **details: Any) -> ApiError:
    """401：无 Cookie、Cookie 过期或来源非法。"""

    return ApiError(ErrorCode.SESSION_EXPIRED, message, details=_clean(details))


def auth_required(message: str | None = None, **details: Any) -> ApiError:
    """401：无/无效/过期账号 Cookie；``GET /me`` 未登录。"""

    return ApiError(ErrorCode.AUTH_REQUIRED, message, details=_clean(details))


def invalid_credentials(message: str | None = None, **details: Any) -> ApiError:
    """401：登录标识或密码不匹配（不存在与密码错误共用同一句消息）。"""

    return ApiError(ErrorCode.INVALID_CREDENTIALS, message, details=_clean(details))


def email_already_registered(message: str | None = None, **details: Any) -> ApiError:
    """409：注册邮箱已存在（含并发唯一约束冲突）。"""

    return ApiError(
        ErrorCode.EMAIL_ALREADY_REGISTERED, message, details=_clean(details)
    )


def username_already_registered(message: str | None = None, **details: Any) -> ApiError:
    """409：注册用户名已存在（含并发唯一约束冲突）。"""

    return ApiError(
        ErrorCode.USERNAME_ALREADY_REGISTERED, message, details=_clean(details)
    )


def forbidden(message: str | None = None, **details: Any) -> ApiError:
    """403：账号 ``status != active``。"""

    return ApiError(ErrorCode.FORBIDDEN, message, details=_clean(details))


def rate_limited(message: str | None = None, **details: Any) -> ApiError:
    """429：验证码重发节流或错误尝试次数超限。"""

    return ApiError(ErrorCode.RATE_LIMITED, message, details=_clean(details))


def resource_unavailable(**details: Any) -> ApiError:
    """404 + ``SESSION_EXPIRED``：跨会话访问他人资源，不得暴露存在性（D2）。"""

    return ApiError(
        ErrorCode.SESSION_EXPIRED,
        RESOURCE_UNAVAILABLE_MESSAGE,
        status_code=404,
        details=_clean(details),
    )


def from_kernel_error(exc: "Exception") -> ApiError:
    """把 ``KernelError`` 映射为 ``ApiError``；未知名错误码退回 ``MISSING_FIELD``。"""

    code_text = str(getattr(exc, "code", "") or "")
    try:
        code = ErrorCode(code_text)
    except ValueError:
        code = ErrorCode.MISSING_FIELD
    message = str(getattr(exc, "message", "") or DEFAULT_MESSAGES[code])
    field_name = getattr(exc, "field", None)
    details = {"field": field_name} if field_name else None
    return ApiError(code, message, details=details)


def from_validation_error(exc: "Exception") -> ApiError:
    """把 Pydantic ``ValidationError`` 收敛为 ``MISSING_FIELD``（422）。

    只暴露字段定位与错误类型，不回传输入值，避免回显敏感内容（R12-AC5）。
    """

    errors: list[dict[str, Any]] = []
    for item in getattr(exc, "errors", lambda: [])():
        location = item.get("loc") or ()
        errors.append(
            {
                "field": ".".join(str(part) for part in location),
                "type": item.get("type", "invalid"),
                "message": str(item.get("msg", "")),
            }
        )
    first = errors[0]["field"] if errors else ""
    message = f"字段校验失败：{first}" if first else "请求体字段校验失败"
    details: dict[str, Any] = {"errors": errors[:10]}
    return missing_field(message, **details)


def _clean(details: Mapping[str, Any]) -> dict[str, Any] | None:
    """去掉值为 None 的细节，保证响应体稳定。"""

    cleaned = {key: value for key, value in details.items() if value is not None}
    return cleaned or {}

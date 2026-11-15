"""账号端点的请求/响应模型（``C-AUTHAPI@1``）。

- 字段名与契约逐字一致（snake_case），所有模型 ``extra="forbid"``；
- 可选字段一律 ``Optional[...] = None``；
- 字段长度上下界只做"请求形状"约束，业务规则（邮箱格式、密码策略）在服务层校验，
  这样直接调用服务时也得到同一套规则。
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class _StrictModel(BaseModel):
    """账号端点模型的公共基类：拒绝未知字段（与既有契约一致）。"""

    model_config = ConfigDict(extra="forbid")


class RegisterCodeRequest(_StrictModel):
    """``POST /auth/register/code`` 请求体。"""

    email: str = Field(min_length=3, max_length=320)


class RegisterCodeResult(_StrictModel):
    """``POST /auth/register/code`` 的 ``data``：展示邮箱与时效信息。"""

    email: str
    expires_in_seconds: int
    resend_after_seconds: int


class RegisterRequest(_StrictModel):
    """``POST /auth/register`` 请求体；``verification_code`` 必填。"""

    username: str = Field(min_length=1, max_length=32)
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=128)
    verification_code: str = Field(min_length=6, max_length=6)
    display_name: Optional[str] = Field(default=None, max_length=64)


class LoginRequest(_StrictModel):
    """``POST /auth/login`` 请求体。

    ``identifier`` 是用户名或邮箱；``email`` 只为旧客户端保留，二者至少提供一个。
    """

    identifier: Optional[str] = Field(default=None, min_length=1, max_length=320)
    email: Optional[str] = Field(default=None, min_length=1, max_length=320)
    password: str = Field(min_length=1, max_length=128)
    remember: bool = False

    @model_validator(mode="after")
    def _require_identifier(self) -> "LoginRequest":
        if not (self.identifier or self.email):
            raise ValueError("identifier or email is required")
        return self

    @property
    def login_identifier(self) -> str:
        """优先使用 ``identifier``，旧字段 ``email`` 作为兼容回退。"""

        return (self.identifier or self.email or "").strip()


class AuthUser(_StrictModel):
    """注册/登录/``/me`` 共用的账号展示对象。"""

    user_id: str
    username: str
    email: str
    display_name: str
    status: Literal["active"]
    created_at: str
    #: ``verified``：邮箱已通过注册验证码核验；``disabled_development``：历史账号。
    email_verification: Literal["disabled_development", "verified"]
    #: 头像 URL（相对路径，带版本参数）；未上传时为 None，前端回退昵称首字。
    avatar_url: Optional[str] = None


class UserProfile(_StrictModel):
    """``GET /me`` 与资料更新响应中的展示资料与偏好。"""

    bio: str
    occupation: str
    school: str
    #: 选填；只返回规范化后的 11 位号码，空串表示未填写。
    phone: str
    interests: list[str]
    preferred_subject: str
    default_entry: Literal["space", "labs"]
    updated_at: str


class UpdateMeRequest(_StrictModel):
    """``PATCH /me`` 请求体；未提供的字段表示"保持不变"。"""

    display_name: Optional[str] = Field(default=None, min_length=1, max_length=64)
    bio: Optional[str] = Field(default=None, max_length=200)
    occupation: Optional[str] = Field(default=None, max_length=64)
    school: Optional[str] = Field(default=None, max_length=64)
    phone: Optional[str] = Field(default=None, max_length=32)
    interests: Optional[list[str]] = Field(default=None, max_length=8)
    preferred_subject: Optional[str] = Field(default=None, max_length=32)
    default_entry: Optional[Literal["space", "labs"]] = None


class ProfileUpdateResult(_StrictModel):
    """``PATCH /me``、头像上传/删除的统一响应（账号 + 最新资料）。"""

    user: AuthUser
    profile: UserProfile


class LoginResult(_StrictModel):
    """``POST /auth/login`` 的 ``data``。"""

    user: AuthUser
    csrf_token: str
    expires_at: str
    absolute_expires_at: str


class AuthSessionSummary(_StrictModel):
    """``GET /me`` 中的会话摘要（``expires_at`` 与 ``idle_expires_at`` 同值）。"""

    session_id: str
    expires_at: str
    idle_expires_at: str


class MeResponse(_StrictModel):
    """``GET /me`` 的 ``data``。"""

    user: AuthUser
    session: AuthSessionSummary
    csrf_token: str
    profile: UserProfile


__all__ = [
    "AuthSessionSummary",
    "AuthUser",
    "LoginRequest",
    "LoginResult",
    "MeResponse",
    "ProfileUpdateResult",
    "RegisterCodeRequest",
    "RegisterCodeResult",
    "RegisterRequest",
    "UpdateMeRequest",
    "UserProfile",
]
"""用户名/邮箱规范化与密码策略（``C-AUTHSVC@1`` §2）。

规则（逐条可测）：

=======================  ====================================================
规则                      行为
=======================  ====================================================
用户名                    3–20 个字符；首字符为字母（含中文），其余为字母、数字、
                          ``_`` 或 ``-``；不区分大小写比较、展示保留原大小写
邮箱                      ``raw.strip()`` 后长度 3–320，否则 422 ``MISSING_FIELD``
``@`` 数量                必须恰好 1 个，否则 422
本地部分                  1–64 字符，不含空白
域名部分                  至少 1 个 ``.``，末段（TLD）≥ 2 字符，不含空白与 ``@``
归一                      ``identifier = display.casefold()``；不删 ``.`` / ``+``，
                          不做 punycode
密码                      长度 8–128（Unicode 字符计），允许空格与任意可见字符
错误消息                  中文、指出字段名，**不含输入值**
=======================  ====================================================

非法输入统一抛 422 ``MISSING_FIELD``（与既有错误契约一致，不新增错误码）。
"""

from __future__ import annotations

from dataclasses import dataclass

from ..schemas.errors import missing_field
from .passwords import MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH

#: 邮箱总长度上限（RFC 5321 的地址上限）。
MAX_EMAIL_LENGTH = 320
#: 邮箱本地部分上限。
EMAIL_LOCAL_MAX_LENGTH = 64
#: 邮箱总长度下限（``a@b.c`` 已是 5，这里按契约取 3）。
MIN_EMAIL_LENGTH = 3

#: 用户名长度上下限（按 Unicode 码点计）。
MIN_USERNAME_LENGTH = 3
MAX_USERNAME_LENGTH = 20
#: 用户名首字符之后允许的额外符号（其余位置只接受字母与数字）。
USERNAME_SYMBOLS = "_-"


@dataclass(frozen=True, slots=True)
class NormalizedEmail:
    """邮箱的展示值与比较值；``display`` 只去首尾空格，不改大小写。"""

    display: str
    identifier: str


def _invalid_email(reason: str) -> Exception:
    """构造统一的 422 错误：只描述规则，不回显输入值。"""

    return missing_field(f"邮箱格式不合法：{reason}", field="email")


def normalize_email(raw: str) -> NormalizedEmail:
    """规范化邮箱；非法输入抛 ``ApiError(MISSING_FIELD, 422)``。

    ``identifier`` 用 ``casefold()``（而非 ``lower()``）保证 Unicode 大小写折叠一致，
    后续唯一约束比较只依赖该值。
    """

    display = (raw or "").strip()
    if not (MIN_EMAIL_LENGTH <= len(display) <= MAX_EMAIL_LENGTH):
        raise _invalid_email(f"长度需为 {MIN_EMAIL_LENGTH}–{MAX_EMAIL_LENGTH} 个字符")

    if display.count("@") != 1:
        raise _invalid_email("必须且只能包含一个 @")

    local, _, domain = display.partition("@")
    if not (1 <= len(local) <= EMAIL_LOCAL_MAX_LENGTH):
        raise _invalid_email(f"本地部分长度需为 1–{EMAIL_LOCAL_MAX_LENGTH} 个字符")
    if any(character.isspace() for character in local):
        raise _invalid_email("本地部分不能包含空白字符")

    if any(character.isspace() for character in domain) or "@" in domain:
        raise _invalid_email("域名不能包含空白字符或 @")
    if "." not in domain:
        raise _invalid_email("域名必须包含 .")
    if domain.startswith(".") or domain.endswith(".") or ".." in domain:
        raise _invalid_email("域名不能以 . 开头或结尾，也不能包含连续的 .")

    tld = domain.rsplit(".", 1)[1]
    if len(tld) < 2:
        raise _invalid_email("域名末段至少需要 2 个字符")

    return NormalizedEmail(display=display, identifier=display.casefold())


def validate_password_policy(password: str) -> None:
    """校验注册密码长度（8–128 个 Unicode 字符）；不合规抛 422。"""

    length = len(password or "")
    if not (MIN_PASSWORD_LENGTH <= length <= MAX_PASSWORD_LENGTH):
        raise missing_field(
            f"密码长度需为 {MIN_PASSWORD_LENGTH}–{MAX_PASSWORD_LENGTH} 个字符",
            field="password",
        )


@dataclass(frozen=True, slots=True)
class NormalizedUsername:
    """用户名的展示值与比较值；``display`` 只去首尾空格，不改大小写。"""

    display: str
    identifier: str


def _invalid_username(reason: str) -> Exception:
    """构造统一 422 错误：只描述规则，不回显输入值。"""

    return missing_field(f"用户名不合法：{reason}", field="username")


def normalize_username(raw: str) -> NormalizedUsername:
    """规范化用户名；非法输入抛 ``ApiError(MISSING_FIELD, 422)``。

    比较值统一 ``casefold()``，因此 ``Alice`` 与 ``alice`` 视为同一个用户名；
    展示值保留用户输入的大小写。
    """

    display = (raw or "").strip()
    length = len(display)
    if not (MIN_USERNAME_LENGTH <= length <= MAX_USERNAME_LENGTH):
        raise _invalid_username(
            f"长度需为 {MIN_USERNAME_LENGTH}–{MAX_USERNAME_LENGTH} 个字符"
        )

    first = display[0]
    if not first.isalpha():
        raise _invalid_username("首字符需为字母")

    for character in display[1:]:
        if character.isalpha() or character.isdecimal() or character in USERNAME_SYMBOLS:
            continue
        raise _invalid_username("只能包含字母、数字、下划线或短横线")

    return NormalizedUsername(display=display, identifier=display.casefold())


__all__ = [
    "EMAIL_LOCAL_MAX_LENGTH",
    "MAX_EMAIL_LENGTH",
    "MAX_USERNAME_LENGTH",
    "MIN_EMAIL_LENGTH",
    "MIN_USERNAME_LENGTH",
    "NormalizedEmail",
    "NormalizedUsername",
    "normalize_email",
    "normalize_username",
    "validate_password_policy",
]
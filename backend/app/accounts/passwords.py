"""密码哈希与校验（``C-AUTHSVC@1`` §1）。

- 使用 ``argon2-cffi`` 的 ``PasswordHasher``（Argon2id），**不使用** ``passlib``；
- 参数与契约逐字一致（``time_cost=2``、``memory_cost=19456`` KiB、``parallelism=1``、
  ``hash_len=32``、``salt_len=16``）；
- 只做"哈希 / 校验"两件事，不缓存明文或摘要到模块级可变状态；
- 账号不存在时用 ``verify_dummy_password`` 走一次等价耗时的校验，避免通过响应时间
  枚举邮箱（R4-2）。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

logger = logging.getLogger(__name__)

#: 注册密码长度下限（常见站点默认：至少 8 位）。
MIN_PASSWORD_LENGTH = 8
#: 注册密码长度上限（与 ``RegisterRequest.password`` 的 max_length 一致）。
MAX_PASSWORD_LENGTH = 128

#: Argon2id 参数（C-AUTHSVC@1 §1）。
ARGON2_TIME_COST = 2
#: 内存开销，单位 KiB（19 MiB）。
ARGON2_MEMORY_COST = 19456
ARGON2_PARALLELISM = 1
ARGON2_HASH_LEN = 32
ARGON2_SALT_LEN = 16

#: dummy 校验用的固定口令：仅用于等价耗时路径，不是任何真实凭据。
_DUMMY_PASSWORD = "xiangsheng-dummy-password-for-timing-2026"


@dataclass(frozen=True, slots=True)
class PasswordVerification:
    """密码校验结果；``needs_rehash`` 表示库中摘要需按当前参数重算。"""

    valid: bool
    needs_rehash: bool


def _build_hasher() -> PasswordHasher:
    """按契约参数构造 hasher（参数固定，进程内复用同一实例）。"""

    return PasswordHasher(
        time_cost=ARGON2_TIME_COST,
        memory_cost=ARGON2_MEMORY_COST,
        parallelism=ARGON2_PARALLELISM,
        hash_len=ARGON2_HASH_LEN,
        salt_len=ARGON2_SALT_LEN,
    )


_hasher = _build_hasher()
#: dummy 摘要惰性生成一次；只保存摘要本身，不保存任何用户输入。
_dummy_hash: str | None = None


def hash_password(password: str) -> str:
    """返回 Argon2id PHC 串（``$argon2id$v=19$...``）。"""

    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> PasswordVerification:
    """校验密码。

    - 摘要与口令不匹配 → ``(False, False)``（凭据错误，不是需要重哈希）；
    - 摘要格式损坏 / 参数不可识别 → ``(False, True)``，调用方一律按凭据错误处理；
    - 校验通过 → ``needs_rehash`` 取自 ``check_needs_rehash``，供渐进重哈希使用。
    """

    try:
        _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return PasswordVerification(valid=False, needs_rehash=False)
    except (InvalidHashError, VerificationError):
        # 摘要不可解析时不能把异常原文带出去（可能含摘要片段）。
        return PasswordVerification(valid=False, needs_rehash=True)
    return PasswordVerification(
        valid=True, needs_rehash=_hasher.check_needs_rehash(password_hash)
    )


def verify_dummy_password(password: str) -> None:
    """对模块级惰性 dummy 摘要做一次完整校验，返回值丢弃。

    账号不存在或凭据缺失时调用，使失败分支的耗时与真实校验接近（R4-2）。
    """

    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = hash_password(_DUMMY_PASSWORD)
    try:
        _hasher.verify(_dummy_hash, password)
    except (InvalidHashError, VerificationError):
        # dummy 摘要只用于消耗时间，任何结果都不影响业务分支。
        pass


__all__ = [
    "ARGON2_HASH_LEN",
    "ARGON2_MEMORY_COST",
    "ARGON2_PARALLELISM",
    "ARGON2_SALT_LEN",
    "ARGON2_TIME_COST",
    "MAX_PASSWORD_LENGTH",
    "MIN_PASSWORD_LENGTH",
    "PasswordVerification",
    "hash_password",
    "verify_dummy_password",
    "verify_password",
]
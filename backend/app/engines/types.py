"""确定性内核的共享类型、错误与数值约定（C-ENGINE@1，plan §2.2.9）。

四个内核共享的约定：

1. 字段名一律 snake_case，与 ``contracts/schemas`` 和 ``fixtures/golden`` 逐字一致。
2. 出错只抛 :class:`KernelError`，不抛裸异常、不泄露堆栈（R12-AC5、R13）。
3. 金额使用 :class:`decimal.Decimal`，量化统一 ``ROUND_HALF_UP``（R9-AC3、§2.2.6 规则 7）。
4. 浮点归一：``round(value, 10)`` 并消除 ``-0.0``（§2.2.3 规则 1）。

本模块只做类型声明与无副作用的数值工具，不包含任何计算业务。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Literal, TypedDict, Union

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

#: 内核标识（C-RUN@1 的 kernel 字段取值）。
KernelId = Literal["linear_v1", "force_v1", "bfs_v1", "budget_v1"]

#: 跨任务共享的浮点容差（§2.3.6 规则 3）。
TOLERANCE = 1e-9

#: rank / invertible 判定阈值（§2.2.3 规则 3、5）。
RANK_TOLERANCE = 1e-12

#: 奇异矩阵固定文案（§2.2.3 规则 5，前端与校验器共用）。
SINGULAR_REASON = "矩阵奇异（det=0），零空间非平凡，无法把每个点送回原位"

#: 无实特征值固定文案（§2.2.3 规则 4）。
NO_REAL_EIGEN_REASON = "判别式小于 0，该矩阵没有实特征值（对应纯旋转/螺旋型变换）"

#: 金额默认量化位数（§2.2.6 规则 7）。
AMOUNT_QUANT = Decimal("0.01")

#: 预算模板的人数上限与预算上限（R9-AC1/R9-AC6）。
MAX_PEOPLE = 2000
MAX_BUDGET_LIMIT = Decimal("1000000")

#: 预算直线数据取点的最大人数（C-BUD@1 的 LineSeries.at_max）。
LINE_MAX_N = 2000


# ---------------------------------------------------------------------------
# 错误类型
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class KernelError(Exception):
    """四内核统一错误。

    :param code: C-ERR@1 错误码之一，如 ``MISSING_FIELD``。
    :param message: 面向用户的中文说明，不含堆栈。
    :param field: 出错的参数/字段名，便于调用方定位。
    """

    code: str
    message: str
    field: str | None = None

    def __post_init__(self) -> None:
        # 让 Exception.args 保持有意义，便于日志与测试捕获。
        Exception.__init__(self, self.code, self.message, self.field)

    def __str__(self) -> str:
        suffix = f"（字段：{self.field}）" if self.field else ""
        return f"{self.code}: {self.message}{suffix}"


# ---------------------------------------------------------------------------
# 预算表达式 AST（白名单：constant / ref / add / multiply）
# ---------------------------------------------------------------------------


class AstConstant(TypedDict):
    """十进制字符串常量节点。"""

    op: Literal["constant"]
    value: str


class AstRef(TypedDict):
    """参数引用节点，不得内联数值。"""

    op: Literal["ref"]
    parameter_id: str


class AstAdd(TypedDict):
    """求和节点，至少两个参数。"""

    op: Literal["add"]
    args: list["AstNode"]


class AstMultiply(TypedDict):
    """相乘节点，至少两个参数。"""

    op: Literal["multiply"]
    args: list["AstNode"]


#: 白名单 AST 节点联合类型。
AstNode = Union[AstConstant, AstRef, AstAdd, AstMultiply]


# ---------------------------------------------------------------------------
# 数值工具
# ---------------------------------------------------------------------------


def finite_float(
    value: object,
    field: str,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    """把入参转成有限浮点数，并按需校验闭区间。

    :raises KernelError: 非数值、布尔值、NaN/Inf 或超出范围。
    """

    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise KernelError("MISSING_FIELD", f"{field} 必须是数值", field)
    number = float(value)
    if not math.isfinite(number):
        raise KernelError("MISSING_FIELD", f"{field} 必须是有限数值", field)
    if minimum is not None and number < minimum:
        raise KernelError(
            "MISSING_FIELD", f"{field} 超出允许范围 [{minimum}, {maximum}]", field
        )
    if maximum is not None and number > maximum:
        raise KernelError(
            "MISSING_FIELD", f"{field} 超出允许范围 [{minimum}, {maximum}]", field
        )
    return number


def normalize_float(value: float, digits: int = 10) -> float:
    """按契约 ``round(v, 10)`` 归一，并把 ``-0.0`` 变成 ``0.0``。"""

    normalized = round(float(value), digits)
    if normalized == 0.0:
        return 0.0
    return normalized


def decimal_from(value: object, field: str) -> Decimal:
    """把十进制字符串/整数转成 :class:`Decimal`。

    ``float`` 输入先经 ``repr`` 转成最短往返十进制文本再解析，避免
    ``Decimal(0.1)`` 带出二进制尾数；金额仍建议上游直接传字符串（R9-AC3）。
    """

    if isinstance(value, bool) or value is None:
        raise KernelError("MISSING_FIELD", f"{field} 必须是十进制数值", field)
    if isinstance(value, Decimal):
        number = value
    elif isinstance(value, int):
        number = Decimal(value)
    elif isinstance(value, float):
        if not math.isfinite(value):
            raise KernelError("MISSING_FIELD", f"{field} 必须是有限数值", field)
        number = Decimal(repr(value))
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            raise KernelError("MISSING_FIELD", f"{field} 不能为空", field)
        try:
            number = Decimal(text)
        except InvalidOperation as exc:
            raise KernelError("MISSING_FIELD", f"{field} 不是合法的十进制数值", field) from exc
    else:
        raise KernelError("MISSING_FIELD", f"{field} 必须是十进制数值", field)
    if not number.is_finite():
        raise KernelError("MISSING_FIELD", f"{field} 必须是有限数值", field)
    return number


def quantize_to(value: Decimal, digits: int) -> Decimal:
    """按 ``digits`` 位小数做 ``ROUND_HALF_UP`` 量化，并消除 ``-0.00``。"""

    quantum = Decimal(1).scaleb(-digits)
    quantized = value.quantize(quantum, rounding=ROUND_HALF_UP)
    if quantized == 0:
        return abs(quantized)
    return quantized


def format_decimal(value: Decimal, digits: int) -> str:
    """格式化十进制字符串，保留 ``digits`` 位小数。"""

    return format(quantize_to(value, digits), "f")


def format_amount(value: Decimal) -> str:
    """金额统一格式：``str(quantize(Decimal("0.01")))``，如 ``"9400.00"``。"""

    return format(quantize_to(value, 2), "f")

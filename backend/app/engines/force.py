# [legacy] 不再参与主链路，保留为 iSpec 表达式求值器的领域扩展参考（见 backend/legacy/README.md）。
"""``force_2d`` 确定性内核（C-FC@1，plan §2.2.4）。

纯函数、无 I/O、不修改入参。返回结构与
``contracts/schemas/template_force_2d.schema.json`` 的 ``Force2dResult``
逐字一致（snake_case）。

关键规则：

- ``magnitude = hypot(Σm·cosθ, Σm·sinθ)``，角度以度为单位、x 轴正向 0°、逆时针为正。
- 合力 < 1e-9 时 ``cancel=true`` 且 ``direction_deg=null``，禁止输出 0° 或 NaN。
- ``magnitude_rounded``（2 位）与 ``magnitude_exact``（6 位）必须同时返回（R7-AC2）。
"""

from __future__ import annotations

import math

from collections.abc import Sequence
from decimal import Decimal
from typing import Any

from .types import (
    TOLERANCE,
    KernelError,
    decimal_from,
    finite_float,
    format_decimal,
)

#: force_2d 允许的共点力数量（R7-AC6）。
MIN_FORCES = 2
MAX_FORCES = 4

#: 力的大小上限（N，R7-AC5）。
MAX_MAGNITUDE = Decimal("1000")

# 输入字符串必须是非负普通十进制（拒绝 1e3、+1、01、.5 等写法）。
def _is_plain_decimal(text: str) -> bool:
    """按 ``^(0|[1-9][0-9]*)(\\.[0-9]+)?$`` 的等价规则做纯文本校验。"""

    if not text:
        return False
    integer_part, dot, fraction_part = text.partition(".")
    if not integer_part.isdigit():
        return False
    if len(integer_part) > 1 and integer_part.startswith("0"):
        return False
    if dot and (not fraction_part or not fraction_part.isdigit()):
        return False
    return True

#: 合力近似为零的判定阈值（§2.2.4 规则 2）。
_CANCEL_TOLERANCE = 1e-9

#: 浮点噪声清理阈值：远小于 1e-9 容差，只用于消除 sin(180°) 之类的尾数。
_NOISE_TOLERANCE = 1e-12

#: 合力为零时的固定说明文案（§2.2.4 规则 2）。
_CANCEL_NOTE = "合力为零，方向未定义"

#: 常态下的方向说明文案。
_DEFAULT_NOTE = "合力按矢量合成，方向以 x 轴正向为 0°、逆时针为正"


def _clean(value: float) -> float:
    """消除浮点噪声与 ``-0.0``；真实量级远大于 1e-12 时保持全精度。"""

    if abs(value) < _NOISE_TOLERANCE:
        return 0.0
    return value


def _read_magnitude(raw: object, field: str) -> tuple[Decimal, str]:
    """校验力的大小（0..1000N）并返回 ``(Decimal, 回显字符串)``。"""

    if isinstance(raw, str):
        text = raw.strip()
        if not _is_plain_decimal(text):
            raise KernelError("MISSING_FIELD", f"{field} 必须是十进制字符串（N）", field)
        magnitude = decimal_from(text, field)
        echo = text
    else:
        magnitude = decimal_from(raw, field)
        echo = format(magnitude, "f")

    if magnitude < 0 or magnitude > MAX_MAGNITUDE:
        raise KernelError(
            "MISSING_FIELD",
            f"{field} 力的大小必须在 0 到 1000N 之间",
            field,
        )
    return magnitude, echo


def _read_angle(raw: object, field: str) -> float:
    """校验角度（0 ≤ θ < 360，度）。"""

    angle = finite_float(raw, field)
    if not 0.0 <= angle < 360.0:
        raise KernelError("MISSING_FIELD", f"{field} 角度必须在 [0, 360) 度内", field)
    return angle


def _read_precision(raw: object, field: str, upper: int) -> int:
    """校验展示/计算精度（非负整数）。"""

    if isinstance(raw, bool) or not isinstance(raw, int):
        raise KernelError("MISSING_FIELD", f"{field} 必须是整数", field)
    if not 0 <= raw <= upper:
        raise KernelError("MISSING_FIELD", f"{field} 必须在 0 到 {upper} 之间", field)
    return raw


def force_resultant(
    forces: Sequence[dict[str, Any]],
    display_precision: int = 2,
    compute_precision: int = 6,
) -> dict[str, Any]:
    """求共点力的合力，返回 ``Force2dResult`` 的 dict 形式。

    :param forces: 2..4 个 ``{"magnitude": 十进制字符串, "angle_deg": number}``。
    :param display_precision: ``magnitude_rounded`` / ``direction_rounded`` 的小数位。
    :param compute_precision: ``magnitude_exact`` 的小数位。
    :raises KernelError: 数量、大小、角度或精度非法时抛 ``MISSING_FIELD``。

    示例（R7-AC1）::

        >>> force_resultant([{"magnitude": "10", "angle_deg": 0},
        ...                  {"magnitude": "10", "angle_deg": 90}])["magnitude_rounded"]
        '14.14'
    """

    display_digits = _read_precision(display_precision, "display_precision", 12)
    compute_digits = _read_precision(compute_precision, "compute_precision", 15)

    if not isinstance(forces, (list, tuple)) or not MIN_FORCES <= len(forces) <= MAX_FORCES:
        raise KernelError(
            "MISSING_FIELD",
            f"共点力数量必须在 {MIN_FORCES} 到 {MAX_FORCES} 之间",
            "forces",
        )

    components: list[dict[str, Any]] = []
    fx_parts: list[float] = []
    fy_parts: list[float] = []

    for index, item in enumerate(forces):
        if not isinstance(item, dict):
            raise KernelError("MISSING_FIELD", f"forces[{index}] 必须是对象", f"forces[{index}]")
        if "magnitude" not in item:
            raise KernelError(
                "MISSING_FIELD", f"forces[{index}] 缺少力的大小", f"forces[{index}].magnitude"
            )
        if "angle_deg" not in item:
            raise KernelError(
                "MISSING_FIELD", f"forces[{index}] 缺少角度", f"forces[{index}].angle_deg"
            )

        magnitude, echo = _read_magnitude(item["magnitude"], f"forces[{index}].magnitude")
        angle_deg = _read_angle(item["angle_deg"], f"forces[{index}].angle_deg")

        radians = math.radians(angle_deg)
        magnitude_float = float(magnitude)
        fx = _clean(magnitude_float * math.cos(radians))
        fy = _clean(magnitude_float * math.sin(radians))
        fx_parts.append(fx)
        fy_parts.append(fy)
        components.append(
            {
                "magnitude": echo,
                "angle_deg": angle_deg,
                "fx": fx,
                "fy": fy,
            }
        )

    # math.fsum 提供正确的舍入求和，避免逐项相加的累积误差。
    resultant_x = _clean(math.fsum(fx_parts))
    resultant_y = _clean(math.fsum(fy_parts))
    magnitude_value = math.hypot(resultant_x, resultant_y)
    cancel = magnitude_value < _CANCEL_TOLERANCE

    if cancel:
        direction_deg: float | None = None
        direction_rounded: str | None = None
        note = _CANCEL_NOTE
    else:
        # 契约公式 (atan2·180/π + 360) % 360 的等价写法：仅负角度补 360，
        # 避免正角度先加 360 再取模引入 1e-14 级噪声（黄金夹具要求逐值一致）。
        direction_deg = math.degrees(math.atan2(resultant_y, resultant_x))
        if direction_deg < 0.0:
            direction_deg += 360.0
        direction_rounded = format_decimal(Decimal(repr(direction_deg)), display_digits)
        note = _DEFAULT_NOTE

    magnitude_decimal = Decimal(repr(magnitude_value))
    return {
        "forces": components,
        "fx": resultant_x,
        "fy": resultant_y,
        "magnitude": magnitude_value,
        "magnitude_rounded": format_decimal(magnitude_decimal, display_digits),
        "magnitude_exact": format_decimal(magnitude_decimal, compute_digits),
        "direction_deg": direction_deg,
        "direction_rounded": direction_rounded,
        "direction_defined": not cancel,
        "cancel": cancel,
        "note": note,
        "tolerance": TOLERANCE,
    }

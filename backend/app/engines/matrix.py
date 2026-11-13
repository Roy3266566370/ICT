# [legacy] 不再参与主链路，保留为 iSpec 表达式求值器的领域扩展参考（见 backend/legacy/README.md）。
"""``matrix_2d`` 确定性内核（C-MX@1，plan §2.2.3）。

纯函数、无 I/O、不修改入参。返回结构与
``contracts/schemas/template_matrix_2d.schema.json`` 的 ``Matrix2dResult``
逐字一致（snake_case）。

矩阵乘法顺序（§2.3.6 规则 1，C-12 裁决）：

- ``ab = A · B`` 表示"先执行 B、再执行 A"，即 ``(AB)x = A(Bx)``。
- ``ba = B · A`` 表示"先执行 A、再执行 B"，即 ``(BA)x = B(Ax)``。

本模块用模块常量 :data:`COMPOSE_SEMANTICS` 将该语义显式化，供前端文案引用。
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

from .types import (
    NO_REAL_EIGEN_REASON,
    RANK_TOLERANCE,
    SINGULAR_REASON,
    TOLERANCE,
    KernelError,
    finite_float,
    normalize_float,
)

#: C-12 裁决的复合语义说明（界面文案必须写清"先执行哪个"）。
COMPOSE_SEMANTICS: dict[str, str] = {
    "ab_means_apply_b_then_a": "ab = A·B：先执行 B，再执行 A；(AB)x = A(Bx)",
    "ba_means_apply_a_then_b": "ba = B·A：先执行 A，再执行 B；(BA)x = B(Ax)",
}

_VALID_ORDERS = ("A_then_B", "B_then_A")

Matrix2 = list[list[float]]
Vector2 = list[float]


# ---------------------------------------------------------------------------
# 入参校验
# ---------------------------------------------------------------------------


def _read_vector(value: object, field: str) -> Vector2:
    """读取二维向量并做 [-3, 3] 范围校验（§2.2.3 规则 7）。"""

    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise KernelError("MISSING_FIELD", f"{field} 必须是长度为 2 的数组", field)
    return [
        _bounded_component(item, f"{field}[{index}]")
        for index, item in enumerate(value)
    ]


def _bounded_component(value: object, field: str) -> float:

    return finite_float(value, field, minimum=-3.0, maximum=3.0)


def _read_matrix(value: object, field: str = "matrix") -> Matrix2:
    """读取 2×2 矩阵并做 [-3, 3] 范围校验。"""

    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise KernelError("MISSING_FIELD", f"{field} 必须是 2×2 矩阵", field)
    return [
        _read_vector(row, f"{field}[{row_index}]")
        for row_index, row in enumerate(value)
    ]


# ---------------------------------------------------------------------------
# 线性代数工具
# ---------------------------------------------------------------------------


def _apply(matrix: Matrix2, vector: Vector2) -> Vector2:
    """Ax = (a11·x1 + a12·x2, a21·x1 + a22·x2)。"""

    (a11, a12), (a21, a22) = matrix
    x1, x2 = vector
    return [
        normalize_float(a11 * x1 + a12 * x2),
        normalize_float(a21 * x1 + a22 * x2),
    ]


def _matmul(left: Matrix2, right: Matrix2) -> Matrix2:
    """标准 2×2 矩阵乘法 ``left · right``。"""

    (a11, a12), (a21, a22) = left
    (b11, b12), (b21, b22) = right
    return [
        [
            normalize_float(a11 * b11 + a12 * b21),
            normalize_float(a11 * b12 + a12 * b22),
        ],
        [
            normalize_float(a21 * b11 + a22 * b21),
            normalize_float(a21 * b12 + a22 * b22),
        ],
    ]


def _det(matrix: Matrix2) -> float:
    (a11, a12), (a21, a22) = matrix
    return normalize_float(a11 * a22 - a12 * a21)


def _trace(matrix: Matrix2) -> float:
    return normalize_float(matrix[0][0] + matrix[1][1])


def _rank(matrix: Matrix2, det: float) -> int:
    """rank：|det| > 1e-12 判 2；否则任一分量绝对值 > 1e-12 判 1；否则 0。"""

    if abs(det) > RANK_TOLERANCE:
        return 2
    if any(abs(component) > RANK_TOLERANCE for row in matrix for component in row):
        return 1
    return 0


def _eigenvalues(matrix: Matrix2, trace: float, det: float) -> dict[str, Any]:
    """实特征值（升序）；判别式 < 0 时 ``real=false`` 并给固定原因（禁止 NaN）。"""

    discriminant = trace * trace - 4.0 * det
    if discriminant >= 0.0:
        root = math.sqrt(discriminant)
        values = sorted(
            [
                normalize_float((trace - root) / 2.0),
                normalize_float((trace + root) / 2.0),
            ]
        )
        return {"real": True, "values": values}
    return {"real": False, "reason": NO_REAL_EIGEN_REASON}


def _inverse(matrix: Matrix2, det: float) -> Matrix2 | None:
    """可逆时返回 [[a22, -a12], [-a21, a11]] / det；奇异时返回 None（不伪造）。"""

    if abs(det) <= RANK_TOLERANCE:
        return None
    (a11, a12), (a21, a22) = matrix
    return [
        [normalize_float(a22 / det), normalize_float(-a12 / det)],
        [normalize_float(-a21 / det), normalize_float(a11 / det)],
    ]


def _ellipse(matrix: Matrix2, rank: int) -> dict[str, float] | None:
    """单位圆像的半轴长（两个奇异值），rank<2 时返回 None。

    2×2 矩阵的奇异值可用 ``tr(AᵀA)`` 与 ``det(A)`` 解析求得，避免引入 numpy
    依赖，同时保持确定性：

    ``s = sqrt((E ± sqrt(E² − 4·det²)) / 2)``，其中 ``E = Σaᵢⱼ²``。
    """

    if rank < 2:
        return None

    (a11, a12), (a21, a22) = matrix
    determinant = _det(matrix)
    energy = a11 * a11 + a12 * a12 + a21 * a21 + a22 * a22
    discriminant = max(energy * energy - 4.0 * determinant * determinant, 0.0)
    root = math.sqrt(discriminant)
    semi_major = math.sqrt(max((energy + root) / 2.0, 0.0))
    semi_minor = math.sqrt(max((energy - root) / 2.0, 0.0))
    if semi_minor < RANK_TOLERANCE:
        semi_minor = 0.0
    return {"a": normalize_float(semi_major), "b": normalize_float(semi_minor)}


def _steps(matrix: Matrix2, vector: Vector2, result: Vector2) -> list[dict[str, Any]]:
    """固定两步步骤视图：取输入坐标当倍数 → 组合各列（R6-AC9）。"""

    (a11, a12), (a21, a22) = matrix
    x1, x2 = vector
    columns: list[Vector2] = [[a11, a21], [a12, a22]]

    terms = [
        {
            "coefficient": normalize_float(x1),
            "column_index": 0,
            "column": [normalize_float(a11), normalize_float(a21)],
        },
        {
            "coefficient": normalize_float(x2),
            "column_index": 1,
            "column": [normalize_float(a12), normalize_float(a22)],
        },
    ]

    # C-11 裁决：partial 为"第一项执行后的部分和"，即 x1·column[0]。
    partial = [
        normalize_float(x1 * columns[0][0]),
        normalize_float(x1 * columns[0][1]),
    ]

    return [
        {"step": 1, "title": "取输入坐标当倍数", "terms": terms},
        {"step": 2, "title": "组合各列", "partial": partial, "result": list(result)},
    ]


def _build_result(
    matrix: Matrix2,
    vector: Vector2,
    composition: dict[str, Any] | None,
) -> dict[str, Any]:
    """组装与 ``Matrix2dResult`` 字段逐字一致的字典。"""

    ax = _apply(matrix, vector)
    det = _det(matrix)
    trace = _trace(matrix)
    rank = _rank(matrix, det)
    invertible = abs(det) > RANK_TOLERANCE
    return {
        "ax": ax,
        # 列去向同样按 round(v, 10) 归一，避免输入 -0.0 泄漏到契约输出。
        "columns": [
            [normalize_float(matrix[0][0]), normalize_float(matrix[1][0])],
            [normalize_float(matrix[0][1]), normalize_float(matrix[1][1])],
        ],
        "det": det,
        "trace": trace,
        "rank": rank,
        "eigenvalues": _eigenvalues(matrix, trace, det),
        "invertible": invertible,
        "inverse": _inverse(matrix, det),
        "singular_reason": None if invertible else SINGULAR_REASON,
        "steps": _steps(matrix, vector, ax),
        "composition": composition,
        "ellipse": _ellipse(matrix, rank),
    }


# ---------------------------------------------------------------------------
# 公开内核
# ---------------------------------------------------------------------------


def apply_matrix(matrix: Sequence[Sequence[float]], vector: Sequence[float]) -> dict[str, Any]:
    """单矩阵作用于向量，返回 ``Matrix2dResult`` 的 dict 形式。

    示例（R6-AC1）::

        >>> apply_matrix([[1, 1], [0, 1]], [1, 1])["ax"]
        [2, 1]
    """

    checked_matrix = _read_matrix(matrix, "matrix")
    checked_vector = _read_vector(vector, "vector")
    return _build_result(checked_matrix, checked_vector, composition=None)


def compose_matrices(
    a: Sequence[Sequence[float]],
    b: Sequence[Sequence[float]],
    vector: Sequence[float],
    order: str = "A_then_B",
) -> dict[str, Any]:
    """两矩阵复合，返回 ``Matrix2dResult``（``composition`` 非 null）。

    ``composition`` 内含 ``order`` / ``ab`` / ``ba`` / ``abx`` / ``bax`` /
    ``commutes``（C-MX@1 ``Matrix2dComposition``）：

    - ``ab = A·B``：先执行 B、再执行 A（见 :data:`COMPOSE_SEMANTICS`）。
    - ``ba = B·A``：先执行 A、再执行 B。
    - ``commutes`` 由 ``|abx − bax| ≤ 1e-9`` 判定。
    """

    if order not in _VALID_ORDERS:
        raise KernelError(
            "MISSING_FIELD",
            "compose_order 必须是 A_then_B 或 B_then_A",
            "compose_order",
        )

    matrix_a = _read_matrix(a, "matrix")
    matrix_b = _read_matrix(b, "second_matrix")
    checked_vector = _read_vector(vector, "vector")

    product_ab = _matmul(matrix_a, matrix_b)
    product_ba = _matmul(matrix_b, matrix_a)
    abx = _apply(product_ab, checked_vector)
    bax = _apply(product_ba, checked_vector)
    # 规则 2：A(Bx) 与 (AB)x 必须逐分量相等，这里显式验证一次以便测试与校验器复用。
    via_a = _apply(matrix_a, _apply(matrix_b, checked_vector))
    if any(abs(left - right) > TOLERANCE for left, right in zip(abx, via_a, strict=True)):
        raise KernelError("MISSING_FIELD", "复合运算不自洽：A(Bx) 与 (AB)x 不一致", "composition")

    commutes = all(abs(left - right) <= TOLERANCE for left, right in zip(abx, bax, strict=True))
    composition = {
        "order": order,
        "ab": product_ab,
        "ba": product_ba,
        "abx": abx,
        "bax": bax,
        "commutes": commutes,
    }
    return _build_result(matrix_a, checked_vector, composition=composition)

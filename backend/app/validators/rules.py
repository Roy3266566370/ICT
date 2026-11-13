"""四个模板的**独立参考实现**（R11-AC1，plan §2.3.3）。

独立性声明（本文件的核心主张）
===============================

本模块是校验器（validators）使用的"第二实现"，与确定性内核 ``app.engines``
**没有任何导入关系、没有代码复用**（生产代码里搜索不到 ``app.engines`` 字样，
由 ``grep`` 自检保证）。四类计算的对照关系：

===========  ====================================  ============================================
维度          内核实现（``app.engines``）              本模块（独立参考实现）
===========  ====================================  ============================================
矩阵          私有 ``_apply/_matmul/_det/_rank``      显式标量代数：``det = a·d − b·c``、
              函数封装，结果一律 ``round(v, 10)``      2×2 逆元公式 ``[[d,−b],[−c,a]]/det``、
              归一，容差 1e-9                        秩用"行列式 + 1×1 子式"判据、特征值用
                                                     特征方程判别式 ``trace² − 4·det``。
                                                     不做 round 归一，改用 1e-9 容差比对，
                                                     避免"双方同样舍入"掩盖精度缺陷。
力            复用 ``.types.format_decimal``、          逐项累加（**不用** ``math.fsum``）+
              ``math.fsum`` 求和                      ``math.hypot`` + ``math.atan2``；格式化
                                                     独立用 Decimal ``quantize(ROUND_HALF_UP)``
BFS           模块内私有单遍队列实现                     用 ``collections.deque`` + ``in_queue``
                                                     集合重新实现，并**独立生成**逐事件
                                                     ``trace``（enqueue / dequeue / skip）
预算          字符串表达式递归下降解析器 +               只实现 AST 四节点（constant / ref /
              ``_Evaluator``（带缓存）                 add / multiply）的独立递归求值器，带
                                                     显式循环依赖检测（求值栈）；字符串
                                                     表达式形态**不支持**，显式列为
                                                     ``not_covered``
===========  ====================================  ============================================

为什么这样能发现内核错误
-------------------------

1. **不同数值路径**：内核把结果压到 10 位小数，本模块保留全精度并以 ``1e-9`` 判定。
   内核多舍/少舍一位、或用错容差，会在边界用例上与本模块分离。
2. **不同代数判据**：秩用"行列式 + 子式"，不复用内核的同一个分支；可逆性由
   ``|det| > 1e-12`` 独立判定，能发现"det=0 却返回逆矩阵"这类伪造（R6-AC10）。
3. **不同流程结构**：BFS 用独立的 ``deque`` 循环与独立的 trace 生成器，逐事件比对
   ``trace`` 可发现"节点被重复入队""环上死循环""parent 指向非边"（R8-AC2/AC3/AC4）。
4. **不同金额算术**：预算只用 ``Decimal`` 与显式 ``quantize(ROUND_HALF_UP)``，并独立
   检测 AST 循环依赖；任何把金额退回二进制浮点的改动都会在 2 位小数比对上暴露（R9-AC3）。

局限（诚实声明）
-----------------

``math.cos/sin/atan2/hypot``、``Decimal``、``deque`` 这些基础库函数两边都要用，无法也
不应独立。本模块的独立性目标是"独立于内核的实现选择"，而不是"独立于数学"：当内核把
公式、顺序、容差、空值语义或错误码写错时，本模块仍按契约原文（§2.2.3–§2.2.6）给出
期望值，两者不一致即判 ``fail``。

边界容差
---------

``TOLERANCE`` / ``RANK_TOLERANCE`` 在契约（§2.3.6 规则 3）中是**公开数值约定**，这里重新
声明而不从内核导入，避免校验器继承内核常量被改坏时一起失效。
"""

from __future__ import annotations

import math
from collections import deque
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP, localcontext
from typing import Any

# ---------------------------------------------------------------------------
# 契约常量（重新声明，不从内核导入）
# ---------------------------------------------------------------------------

#: 矩阵与力比较容差（§2.3.6 规则 3）。
TOLERANCE = 1e-9

#: rank / invertible 判定阈值（§2.2.3 规则 3、5）。
RANK_TOLERANCE = 1e-12

#: 金额量化单位与精度（§2.2.6 规则 1、7）。
AMOUNT_QUANT = Decimal("0.01")
AMOUNT_PRECISION = 28

#: 预算直线数据取点上限（C-BUD@1 ``LineSeries.at_max``）。
LINE_MAX_N = 2000

#: 契约固定文案（§2.2.3 规则 4、5 原文；文案本身是对外契约，必须逐字一致）。
NO_REAL_EIGEN_REASON = "判别式小于 0，该矩阵没有实特征值（对应纯旋转/螺旋型变换）"
SINGULAR_REASON = "矩阵奇异（det=0），零空间非平凡，无法把每个点送回原位"

#: 合力为零时的固定文案（§2.2.4 规则 2）。
CANCEL_NOTE = "合力为零，方向未定义"

#: 预算方案顺序（C-BUD@1：scenarios / remaining / over_budget / lines 一一对应）。
PLAN_IDS = ("plan_a", "plan_b")

#: AST 白名单（R9-AC7）。
ALLOWED_OPS = ("constant", "ref", "add", "multiply")

#: 可能代表"人数"的参数 id；这些 ref 必须跟随当前 n，才能扫描 n=0/1/2000。
PEOPLE_PARAMETER_NAMES = ("n", "people", "people_n")

#: 有向 BFS 唯一允许的邻居顺序（C-BFS@1）。
NEIGHBOR_ORDER = "lexicographic_by_id"


class InputProblem(Exception):
    """校验器对输入的独立判定结论。

    字段与内核 ``KernelError`` 的 ``code`` / ``message`` / ``field`` **同构**
    （鸭子类型），因此 T7/T10 可以用同一种方式读取失败诊断，而无需让校验器
    依赖内核类型定义（plan §2.3.3 允许 import ``engines/types.py``，但交付验收
    要求生产代码零 ``app.engines`` 引用，这里选择完全解耦）。
    """

    def __init__(self, code: str, message: str, field: str | None = None) -> None:
        super().__init__(code, message, field)
        self.code = code
        self.message = message
        self.field = field

    def __str__(self) -> str:
        suffix = f"（字段：{self.field}）" if self.field else ""
        return f"{self.code}: {self.message}{suffix}"


# ---------------------------------------------------------------------------
# 通用读取工具
# ---------------------------------------------------------------------------


def _as_sequence(value: object, field_name: str) -> Sequence[Any]:
    """读取数组输入；``str``/``bytes`` 不是数组。"""

    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise InputProblem("MISSING_FIELD", f"{field_name} 必须是数组", field_name)
    return value


def _as_number(value: object, field_name: str) -> float:
    """读取有限数值；布尔值、非数值与 NaN/Inf 一律拒绝。"""

    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise InputProblem("MISSING_FIELD", f"{field_name} 必须是数值", field_name)
    number = float(value)
    if not math.isfinite(number):
        raise InputProblem("MISSING_FIELD", f"{field_name} 必须是有限数值", field_name)
    return number


def _as_decimal(value: object, field_name: str) -> Decimal:
    """读取十进制数值。

    金额以十进制字符串/整数为主要输入（R9-AC3）；若上游给 ``float``，按最短往返
    十进制文本（``repr``）解析，与内核口径一致，不在这里制造"校验器比内核更严格"
    的假失败。金额是否真的用 Decimal 计算，由结果侧的两位小数格式检查（§2.2.6 规则 7）
    来判定。
    """

    if isinstance(value, bool) or value is None:
        raise InputProblem("MISSING_FIELD", f"{field_name} 必须是十进制数值", field_name)
    if isinstance(value, Decimal):
        number = value
    elif isinstance(value, int):
        number = Decimal(value)
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            raise InputProblem("MISSING_FIELD", f"{field_name} 不能为空", field_name)
        try:
            number = Decimal(text)
        except ArithmeticError as exc:  # InvalidOperation 是 ArithmeticError 子类
            raise InputProblem(
                "MISSING_FIELD", f"{field_name} 不是合法的十进制数值", field_name
            ) from exc
    elif isinstance(value, float):
        if not math.isfinite(value):
            raise InputProblem("MISSING_FIELD", f"{field_name} 必须是有限数值", field_name)
        number = Decimal(repr(value))
    else:
        raise InputProblem("MISSING_FIELD", f"{field_name} 必须是十进制数值", field_name)
    if not number.is_finite():
        raise InputProblem("MISSING_FIELD", f"{field_name} 必须是有限数值", field_name)
    return number


def format_amount(value: Decimal) -> str:
    """金额统一格式：两位小数、``ROUND_HALF_UP``，消除 ``-0.00``（§2.2.6 规则 7）。"""

    quantized = value.quantize(AMOUNT_QUANT, rounding=ROUND_HALF_UP)
    if quantized == 0:
        quantized = abs(quantized)
    return format(quantized, "f")


def _format_fixed(value: float, digits: int) -> str:
    """按固定小数位格式化浮点，采用契约要求的 ``ROUND_HALF_UP``。"""

    quantized = Decimal(repr(float(value))).quantize(
        Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP
    )
    if quantized == 0:
        quantized = abs(quantized)
    return format(quantized, "f")


# ---------------------------------------------------------------------------
# 矩阵：显式标量代数（不使用任何矩阵库，也不复用内核函数）
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class MatrixReference:
    """``matrix_2d`` 的独立期望值。"""

    ax: list[float]
    columns: list[list[float]]
    det: float
    trace: float
    rank: int
    invertible: bool
    inverse: list[list[float]] | None
    eigenvalues: dict[str, Any]
    steps: list[dict[str, Any]]
    composition: dict[str, Any] | None = None


def _matrix_entries(value: object, field_name: str) -> tuple[float, float, float, float]:
    """把 2×2 矩阵读成 ``(a, b, c, d)``，即 ``[[a, b], [c, d]]``。"""

    rows = _as_sequence(value, field_name)
    if len(rows) != 2:
        raise InputProblem("MISSING_FIELD", f"{field_name} 必须是 2×2 矩阵", field_name)
    cells: list[float] = []
    for row_index, row in enumerate(rows):
        row_values = _as_sequence(row, f"{field_name}[{row_index}]")
        if len(row_values) != 2:
            raise InputProblem(
                "MISSING_FIELD",
                f"{field_name}[{row_index}] 必须是长度为 2 的数组",
                f"{field_name}[{row_index}]",
            )
        for column_index, cell in enumerate(row_values):
            cells.append(
                _as_number(cell, f"{field_name}[{row_index}][{column_index}]")
            )
    return cells[0], cells[1], cells[2], cells[3]


def _vector2(value: object, field_name: str) -> tuple[float, float]:
    values = _as_sequence(value, field_name)
    if len(values) != 2:
        raise InputProblem("MISSING_FIELD", f"{field_name} 必须是长度为 2 的数组", field_name)
    return (
        _as_number(values[0], f"{field_name}[0]"),
        _as_number(values[1], f"{field_name}[1]"),
    )


def _zero_safe(value: float) -> float:
    """把 ``-0.0`` 归一为 ``0.0``（§2.2.3 规则 1：输出不得出现 ``-0``）。"""

    return 0.0 if value == 0.0 else value


def _apply_scalar(
    entries: tuple[float, float, float, float], vector: tuple[float, float]
) -> list[float]:
    """``Ax = (a·x₁ + b·x₂, c·x₁ + d·x₂)``。

    保留全精度（不做 ``round(v, 10)`` 归一，那会与内核的同一条规则重叠），
    只消除 ``-0.0``，保证报告里的 expected 文案可读。
    """

    a, b, c, d = entries
    x1, x2 = vector
    return [_zero_safe(a * x1 + b * x2), _zero_safe(c * x1 + d * x2)]


def _mul_scalar(
    left: tuple[float, float, float, float], right: tuple[float, float, float, float]
) -> list[list[float]]:
    """2×2 乘法 ``left · right`` 的显式分量展开。"""

    a, b, c, d = left
    e, f, g, h = right
    return [
        [_zero_safe(a * e + b * g), _zero_safe(a * f + b * h)],
        [_zero_safe(c * e + d * g), _zero_safe(c * f + d * h)],
    ]


def _flatten(matrix: list[list[float]]) -> tuple[float, float, float, float]:
    """把 2×2 列表摊平成 ``(a, b, c, d)``，供显式标量运算复用。"""

    return matrix[0][0], matrix[0][1], matrix[1][0], matrix[1][1]


def _eigenvalues_by_discriminant(trace: float, det: float) -> dict[str, Any]:
    """特征方程 ``λ² − trace·λ + det = 0`` 的判别式判据（§2.2.3 规则 4）。"""

    discriminant = trace * trace - 4.0 * det
    if discriminant < 0.0:
        return {"real": False, "reason": NO_REAL_EIGEN_REASON}
    root = math.sqrt(discriminant)
    values = sorted([(trace - root) / 2.0, (trace + root) / 2.0])
    return {"real": True, "values": values}


def matrix_reference(
    matrix: object,
    vector: object,
    second_matrix: object | None = None,
    compose_order: str = "A_then_B",
) -> MatrixReference:
    """独立复算 ``matrix_2d`` 的全部可观察量。

    :raises InputProblem: 形状不合法（2×2 矩阵 / 长度 2 向量）。

    示例::

        >>> matrix_reference([[1, 1], [0, 1]], [1, 1]).ax
        [2.0, 1.0]
    """

    if compose_order not in ("A_then_B", "B_then_A"):
        raise InputProblem(
            "MISSING_FIELD",
            "compose_order 必须是 A_then_B 或 B_then_A",
            "compose_order",
        )

    a, b, c, d = _matrix_entries(matrix, "matrix")
    x1, x2 = _vector2(vector, "vector")

    det = _zero_safe(a * d - b * c)
    trace = _zero_safe(a + d)
    # 秩判据：2×2 行列式（唯一的 2 阶子式）非零 → 2；
    # 否则看是否存在非零的 1 阶子式 → 1；否则 0。
    if abs(det) > RANK_TOLERANCE:
        rank = 2
    elif max(abs(a), abs(b), abs(c), abs(d)) > RANK_TOLERANCE:
        rank = 1
    else:
        rank = 0

    invertible = abs(det) > RANK_TOLERANCE
    inverse: list[list[float]] | None = None
    if invertible:
        # 2×2 逆元伴随矩阵公式：[[d, −b], [−c, a]] / det。
        inverse = [
            [_zero_safe(d / det), _zero_safe(-b / det)],
            [_zero_safe(-c / det), _zero_safe(a / det)],
        ]

    columns = [[_zero_safe(a), _zero_safe(c)], [_zero_safe(b), _zero_safe(d)]]
    ax = _apply_scalar((a, b, c, d), (x1, x2))
    # C-11 裁决：partial 为"第一项（column_index=0）执行后的部分和"。
    partial = [_zero_safe(x1 * a), _zero_safe(x1 * c)]
    steps = [
        {
            "step": 1,
            "title": "取输入坐标当倍数",
            "terms": [
                {
                    "coefficient": _zero_safe(x1),
                    "column_index": 0,
                    "column": [_zero_safe(a), _zero_safe(c)],
                },
                {
                    "coefficient": _zero_safe(x2),
                    "column_index": 1,
                    "column": [_zero_safe(b), _zero_safe(d)],
                },
            ],
        },
        {
            "step": 2,
            "title": "组合各列",
            "partial": partial,
            "result": ax,
        },
    ]

    composition: dict[str, Any] | None = None
    if second_matrix is not None:
        second = _matrix_entries(second_matrix, "second_matrix")
        product_ab = _mul_scalar((a, b, c, d), second)
        product_ba = _mul_scalar(second, (a, b, c, d))
        # (AB)x 与 (BA)x 是"作用在输入向量上的合成结果"，必须用积矩阵去乘，
        # 而不是用单个矩阵（这一处曾是本实现的历史缺陷，由自检脚本发现）。
        abx = _apply_scalar(_flatten(product_ab), (x1, x2))
        bax = _apply_scalar(_flatten(product_ba), (x1, x2))
        # 契约要求 A(Bx) 与 (AB)x 逐分量相等（§2.2.3 规则 2），这里独立验算一次。
        via_a = _apply_scalar((a, b, c, d), _apply_scalar(second, (x1, x2)))
        if any(abs(abx[index] - via_a[index]) > TOLERANCE for index in (0, 1)):
            raise AssertionError("A(Bx) 与 (AB)x 不自洽（独立实现内部错误）")
        composition = {
            "order": compose_order,
            "ab": product_ab,
            "ba": product_ba,
            "abx": abx,
            "bax": bax,
            "commutes": all(
                abs(abx[index] - bax[index]) <= TOLERANCE for index in (0, 1)
            ),
        }

    return MatrixReference(
        ax=ax,
        columns=columns,
        det=det,
        trace=trace,
        rank=rank,
        invertible=invertible,
        inverse=inverse,
        eigenvalues=_eigenvalues_by_discriminant(trace, det),
        steps=steps,
        composition=composition,
    )


# ---------------------------------------------------------------------------
# 力：向量合成
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ForceReference:
    """``force_2d`` 的独立期望值。"""

    components: list[dict[str, Any]]
    fx: float
    fy: float
    magnitude: float
    magnitude_rounded: str
    magnitude_exact: str
    direction_deg: float | None
    direction_rounded: str | None
    direction_defined: bool
    cancel: bool
    note: str


def force_reference(
    forces: object,
    display_precision: int = 2,
    compute_precision: int = 6,
) -> ForceReference:
    """独立复算共点力合力。

    与内核的差异：**逐项累加**（内核用 ``math.fsum`` 做正确舍入求和），因此两条实现
    在浮点累加顺序/补偿上不同；一旦内核把分量公式写错（例如把 ``sin`` 写成 ``cos``、
    角度未转弧度、角度方向取反），差异会远大于 1e-9。
    """

    if (
        isinstance(display_precision, bool)
        or not isinstance(display_precision, int)
        or not 0 <= display_precision <= 12
    ):
        raise InputProblem(
            "MISSING_FIELD", "display_precision 必须是 0 到 12 的整数", "display_precision"
        )
    if (
        isinstance(compute_precision, bool)
        or not isinstance(compute_precision, int)
        or not 0 <= compute_precision <= 15
    ):
        raise InputProblem(
            "MISSING_FIELD", "compute_precision 必须是 0 到 15 的整数", "compute_precision"
        )

    items = _as_sequence(forces, "forces")
    components: list[dict[str, Any]] = []
    total_x = 0.0
    total_y = 0.0

    for index, item in enumerate(items):
        if not isinstance(item, Mapping):
            raise InputProblem(
                "MISSING_FIELD", f"forces[{index}] 必须是对象", f"forces[{index}]"
            )
        if "magnitude" not in item or "angle_deg" not in item:
            raise InputProblem(
                "MISSING_FIELD",
                f"forces[{index}] 缺少 magnitude 或 angle_deg",
                f"forces[{index}]",
            )
        magnitude = _as_decimal(item["magnitude"], f"forces[{index}].magnitude")
        angle_deg = _as_number(item["angle_deg"], f"forces[{index}].angle_deg")
        radians = math.radians(angle_deg)
        # 分量 = m·(cosθ, sinθ)，θ 以度为单位、x 轴正向 0°、逆时针为正（§2.2.4 规则 1）。
        fx = float(magnitude) * math.cos(radians)
        fy = float(magnitude) * math.sin(radians)
        if abs(fx) < 1e-12:
            fx = 0.0
        if abs(fy) < 1e-12:
            fy = 0.0
        total_x += fx
        total_y += fy
        components.append(
            {
                "magnitude": item["magnitude"],
                "angle_deg": angle_deg,
                "fx": fx,
                "fy": fy,
            }
        )

    total_x = _zero_safe(total_x)
    total_y = _zero_safe(total_y)
    magnitude_value = math.hypot(total_x, total_y)
    cancel = magnitude_value < TOLERANCE

    if cancel:
        direction_deg: float | None = None
        direction_rounded: str | None = None
        note = CANCEL_NOTE
    else:
        # 方向角必须落在 [0, 360)：atan2 的 (-180°, 180°] 用模运算折回。
        direction_deg = math.degrees(math.atan2(total_y, total_x)) % 360.0
        direction_rounded = _format_fixed(direction_deg, display_precision)
        note = "合力按矢量合成，方向以 x 轴正向为 0°、逆时针为正"

    return ForceReference(
        components=components,
        fx=total_x,
        fy=total_y,
        magnitude=magnitude_value,
        magnitude_rounded=_format_fixed(magnitude_value, display_precision),
        magnitude_exact=_format_fixed(magnitude_value, compute_precision),
        direction_deg=direction_deg,
        direction_rounded=direction_rounded,
        direction_defined=not cancel,
        cancel=cancel,
        note=note,
    )


# ---------------------------------------------------------------------------
# BFS：独立队列实现 + 独立轨迹生成
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class BfsReference:
    """``bfs_flow`` 的独立期望值（含逐事件 trace）。"""

    order: list[str]
    enqueue_order: list[str]
    visited: list[str]
    unvisited: list[str]
    parent: dict[str, str | None]
    level: dict[str, int]
    edges_of_spanning_tree: list[dict[str, str]]
    rejected_edges: list[dict[str, str]]
    trace: list[dict[str, Any]]
    terminated_reason: str
    has_cycle: bool
    max_steps: int


def _reachable_nodes(
    adjacency: Mapping[str, Sequence[str]], start: str
) -> set[str]:
    """独立的可达性判定（用集合 + 栈的迭代 DFS，与 BFS 队列实现不同路径）。"""

    seen = {start}
    pending = deque([start])
    while pending:
        node = pending.pop()
        for neighbor in adjacency.get(node, ()):
            if neighbor not in seen:
                seen.add(neighbor)
                pending.append(neighbor)
    return seen


def _has_cycle_independent(
    node_ids: Sequence[str], edges: Sequence[tuple[str, str]], directed: bool
) -> bool:
    """独立环检测：有向用入度拓扑消除（Kahn），无向用并查集。"""

    if directed:
        # Kahn 算法：能消除全部节点则无环。
        in_degree = {node_id: 0 for node_id in node_ids}
        for _, target in edges:
            in_degree[target] += 1
        ready = deque(node_id for node_id in node_ids if in_degree[node_id] == 0)
        removed = 0
        while ready:
            node = ready.popleft()
            removed += 1
            for source, target in edges:
                if source == node:
                    in_degree[target] -= 1
                    if in_degree[target] == 0:
                        ready.append(target)
        return removed != len(node_ids)

    # 无向图：并查集，同一条边两侧已连通即为环。
    parent_of = {node_id: node_id for node_id in node_ids}

    def find(node: str) -> str:
        while parent_of[node] != node:
            parent_of[node] = parent_of[parent_of[node]]
            node = parent_of[node]
        return node

    for source, target in edges:
        left, right = find(source), find(target)
        if left == right:
            return True
        parent_of[left] = right
    return False


def bfs_reference(
    nodes: object,
    edges: object,
    start_node_id: str,
    directed: bool = True,
    max_steps: int = 200,
) -> BfsReference:
    """独立实现广度优先遍历，并生成逐事件 ``trace``（与内核逐事件比对）。

    :raises InputProblem: 节点/边形状不合法、起点不存在、邻居顺序非法。
    """

    if isinstance(max_steps, bool) or not isinstance(max_steps, int) or not 1 <= max_steps <= 200:
        raise InputProblem("MISSING_FIELD", "max_steps 必须在 1 到 200 之间", "max_steps")

    node_items = _as_sequence(nodes, "nodes")
    node_ids: list[str] = []
    for index, node in enumerate(node_items):
        if not isinstance(node, Mapping):
            raise InputProblem("MISSING_FIELD", f"nodes[{index}] 必须是对象", f"nodes[{index}]")
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            raise InputProblem(
                "MISSING_FIELD", f"nodes[{index}].id 必须是非空字符串", f"nodes[{index}].id"
            )
        if node_id in node_ids:
            raise InputProblem("MISSING_FIELD", f"节点 id 重复：{node_id}", f"nodes[{index}].id")
        node_ids.append(node_id)
    if not node_ids:
        raise InputProblem("MISSING_FIELD", "节点列表不能为空", "nodes")
    if start_node_id not in node_ids:
        raise InputProblem(
            "MISSING_FIELD", f"起点不存在于节点表中：{start_node_id}", "start_node_id"
        )

    edge_items = _as_sequence(edges, "edges")
    pairs: list[tuple[str, str]] = []
    for index, edge in enumerate(edge_items):
        if not isinstance(edge, Mapping):
            raise InputProblem("MISSING_FIELD", f"edges[{index}] 必须是对象", f"edges[{index}]")
        source = edge.get("from")
        target = edge.get("to")
        if source not in node_ids or target not in node_ids:
            raise InputProblem(
                "MISSING_FIELD",
                f"edges[{index}] 指向不存在的节点",
                f"edges[{index}]",
            )
        pairs.append((source, target))

    # 邻接表按 id 的 Unicode 码点字典序排序（neighbor_order=lexicographic_by_id）。
    adjacency: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    for source, target in pairs:
        adjacency[source].append(target)
        if not directed:
            adjacency[target].append(source)
    for node_id in adjacency:
        adjacency[node_id].sort()

    order: list[str] = []
    enqueue_order: list[str] = [start_node_id]
    visited: set[str] = set()
    parent: dict[str, str | None] = {start_node_id: None}
    level: dict[str, int] = {start_node_id: 0}
    spanning_edges: list[dict[str, str]] = []
    rejected_edges: list[dict[str, str]] = []
    trace: list[dict[str, Any]] = []

    queue: deque[str] = deque([start_node_id])
    in_queue: set[str] = {start_node_id}
    terminated_reason = "completed"
    step_index = 0
    dequeued = 0

    while queue:
        if dequeued >= max_steps:
            terminated_reason = "max_steps_reached"
            break

        node_id = queue.popleft()
        in_queue.discard(node_id)
        visited.add(node_id)
        order.append(node_id)
        dequeued += 1
        trace.append(
            {
                "index": step_index,
                "kind": "dequeue",
                "node": node_id,
                "queue_after": list(queue),
                "visited_after": list(order),
            }
        )
        step_index += 1

        for neighbor in adjacency[node_id]:
            if neighbor in visited:
                rejected_edges.append(
                    {"from": node_id, "to": neighbor, "reason": f"{neighbor} 已访问"}
                )
                trace.append(
                    {
                        "index": step_index,
                        "kind": "skip",
                        "node": neighbor,
                        "from": node_id,
                        "reason": "already_visited",
                    }
                )
            elif neighbor in in_queue:
                rejected_edges.append(
                    {"from": node_id, "to": neighbor, "reason": f"{neighbor} 已在队列中"}
                )
                trace.append(
                    {
                        "index": step_index,
                        "kind": "skip",
                        "node": neighbor,
                        "from": node_id,
                        "reason": "already_queued",
                    }
                )
            else:
                in_queue.add(neighbor)
                queue.append(neighbor)
                enqueue_order.append(neighbor)
                parent[neighbor] = node_id
                level[neighbor] = level[node_id] + 1
                spanning_edges.append({"from": node_id, "to": neighbor})
                trace.append(
                    {
                        "index": step_index,
                        "kind": "enqueue",
                        "node": neighbor,
                        "from": node_id,
                        "queue_after": list(queue),
                    }
                )
            step_index += 1

    reachable = _reachable_nodes(adjacency, start_node_id)
    return BfsReference(
        order=order,
        enqueue_order=enqueue_order,
        visited=order,
        unvisited=[node_id for node_id in node_ids if node_id not in reachable],
        parent=parent,
        level=level,
        edges_of_spanning_tree=spanning_edges,
        rejected_edges=rejected_edges,
        trace=trace,
        terminated_reason=terminated_reason,
        has_cycle=_has_cycle_independent(node_ids, pairs, directed),
        max_steps=max_steps,
    )


# ---------------------------------------------------------------------------
# 预算：独立 AST 求值器（仅 constant / ref / add / multiply）
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class BudgetReference:
    """``budget_compare`` 的独立期望值。"""

    people: int
    totals: list[str]
    totals_decimal: list[Decimal]
    fixed: list[str]
    per_person: list[str]
    difference: str
    difference_decimal: Decimal
    equal: bool
    budget_limit: str | None
    limit_decimal: Decimal | None
    remaining: list[str] | None
    remaining_decimal: list[Decimal] | None
    over_budget: list[bool] | None
    lines: list[dict[str, str]]
    display_precision: int = 2
    evaluated_via: str = "expression"


def _plan_expressions(parameters: Mapping[str, Any]) -> dict[str, Any] | None:
    """读取命名表达式表 ``expressions.{plan_a,plan_b}``（golden 与 C-06 裁决形状）。"""

    raw = parameters.get("expressions")
    if raw is None:
        return None
    if not isinstance(raw, Mapping):
        raise InputProblem("MISSING_FIELD", "expressions 必须是对象", "expressions")
    expressions: dict[str, Any] = {}
    for plan_id in PLAN_IDS:
        if plan_id not in raw:
            raise InputProblem("MISSING_FIELD", f"缺少方案 {plan_id} 的表达式", plan_id)
        expressions[plan_id] = raw[plan_id]
    return expressions


def _plan_coefficients(parameters: Mapping[str, Any]) -> dict[str, tuple[Decimal, Decimal]]:
    """读取系数形态 ``fixed + per_person·n``（C-06 裁决：示例对象不携带 AST）。"""

    table = parameters.get("parameters")
    if table is not None and not isinstance(table, Mapping):
        raise InputProblem("MISSING_FIELD", "parameters 必须是对象", "parameters")
    values: Mapping[str, Any] = table if isinstance(table, Mapping) else parameters

    coefficients: dict[str, tuple[Decimal, Decimal]] = {}
    for plan_id in PLAN_IDS:
        fixed_key = f"{plan_id}_fixed"
        per_person_key = f"{plan_id}_per_person"
        if fixed_key not in values or per_person_key not in values:
            raise InputProblem(
                "MISSING_FIELD",
                f"缺少方案 {plan_id} 的 fixed/per_person 系数或表达式",
                plan_id,
            )
        coefficients[plan_id] = (
            _as_decimal(values[fixed_key], fixed_key),
            _as_decimal(values[per_person_key], per_person_key),
        )
    return coefficients


def _eval_ast_node(
    node: object,
    people: int,
    parameters: Mapping[str, Any],
    expressions: Mapping[str, Any],
    stack: tuple[str, ...],
) -> Decimal:
    """独立 AST 求值：只有四种节点，循环依赖由 ``stack`` 显式检出。"""

    if not isinstance(node, Mapping):
        raise InputProblem("MISSING_FIELD", "表达式节点必须是对象", "expressions")

    operation = node.get("op")
    if operation not in ALLOWED_OPS:
        raise InputProblem(
            "MISSING_FIELD",
            f"不支持的表达式节点 {operation!r}（仅允许 {'/'.join(ALLOWED_OPS)}）",
            "expressions",
        )

    if operation == "constant":
        if "value" not in node:
            raise InputProblem("MISSING_FIELD", "常量节点缺少 value", "expressions")
        return _as_decimal(node["value"], "expressions.constant")

    if operation == "ref":
        parameter_id = node.get("parameter_id")
        if not isinstance(parameter_id, str) or not parameter_id:
            raise InputProblem("MISSING_FIELD", "ref 节点缺少 parameter_id", "expressions")
        return _resolve_ref(parameter_id, people, parameters, expressions, stack)

    arguments = node.get("args")
    if not isinstance(arguments, Sequence) or isinstance(arguments, (str, bytes)):
        raise InputProblem("MISSING_FIELD", f"{operation} 节点缺少 args 数组", "expressions")
    if len(arguments) < 2:
        raise InputProblem(
            "MISSING_FIELD", f"{operation} 节点至少需要两个参数", "expressions"
        )

    if operation == "add":
        total = Decimal(0)
        for argument in arguments:
            total += _eval_ast_node(argument, people, parameters, expressions, stack)
        return total

    product = Decimal(1)
    for argument in arguments:
        product *= _eval_ast_node(argument, people, parameters, expressions, stack)
    return product


def _resolve_ref(
    name: str,
    people: int,
    parameters: Mapping[str, Any],
    expressions: Mapping[str, Any],
    stack: tuple[str, ...],
) -> Decimal:
    """解析 ``ref``：人数变量跟随当前 n，参数表优先，其次命名表达式（可递归）。"""

    if name in PEOPLE_PARAMETER_NAMES and name in parameters:
        return Decimal(people)
    if name in parameters:
        return _as_decimal(parameters[name], f"parameters.{name}")
    if name in expressions:
        if name in stack:
            raise InputProblem(
                "MISSING_FIELD",
                f"命名表达式 {name} 存在循环依赖（依赖链：{' -> '.join(stack + (name,))}）",
                name,
            )
        return _eval_plan(
            name, people, parameters, expressions, stack + (name,)
        )
    raise InputProblem("MISSING_FIELD", f"引用了未定义的参数 {name}", name)


def _eval_plan(
    plan_id: str,
    people: int,
    parameters: Mapping[str, Any],
    expressions: Mapping[str, Any],
    stack: tuple[str, ...],
) -> Decimal:
    if plan_id not in expressions:
        raise InputProblem("MISSING_FIELD", f"缺少方案 {plan_id} 的表达式", plan_id)
    return _eval_ast_node(expressions[plan_id], people, parameters, expressions, stack)


def budget_reference(
    parameters: Mapping[str, Any],
    display_precision: int = 2,
) -> BudgetReference:
    """独立复算两方案预算（全程 ``Decimal``，精度 28、``ROUND_HALF_UP``）。

    ``parameters`` 支持两种形态：

    1. 表达式形态：``{"expressions": {...}, "parameters": {...}, "people": n,
       "budget_limit": ...}``（golden 用例形状）。
    2. 系数形态：``{"parameters": {"plan_a_fixed": "3000",
       "plan_a_per_person": "80", ...}, "people": n}``（C-06 裁决的示例对象形状）。

    :raises InputProblem: 人数/上限越界、未定义 ref、循环依赖、不支持的节点。
    """

    if (
        isinstance(display_precision, bool)
        or not isinstance(display_precision, int)
        or not 0 <= display_precision <= 6
    ):
        raise InputProblem(
            "MISSING_FIELD", "display_precision 必须在 0 到 6 之间", "display_precision"
        )

    people_value = parameters.get("people")
    if isinstance(people_value, bool) or not isinstance(people_value, int):
        raise InputProblem("MISSING_FIELD", "人数必须是整数", "people")
    if not 0 <= people_value <= 2000:
        raise InputProblem("MISSING_FIELD", "人数必须在 0 到 2000 之间", "people")

    limit_raw = parameters.get("budget_limit")
    limit_value: Decimal | None = None
    if limit_raw is not None:
        limit_value = _as_decimal(limit_raw, "budget_limit")
        if limit_value != limit_value.to_integral_value():
            raise InputProblem("MISSING_FIELD", "预算上限必须是整数", "budget_limit")
        if limit_value < 0 or limit_value > Decimal(1000000):
            raise InputProblem(
                "MISSING_FIELD", "预算上限必须在 0 到 1000000 之间", "budget_limit"
            )

    raw_table = parameters.get("parameters")
    if raw_table is not None and not isinstance(raw_table, Mapping):
        raise InputProblem("MISSING_FIELD", "parameters 必须是对象", "parameters")
    parameter_table: Mapping[str, Any] = raw_table if isinstance(raw_table, Mapping) else {}

    expressions = _plan_expressions(parameters)
    coefficients = None if expressions is not None else _plan_coefficients(parameters)

    with localcontext() as context:
        context.prec = AMOUNT_PRECISION
        context.rounding = ROUND_HALF_UP

        def total_at(plan_id: str, people: int) -> Decimal:
            if expressions is not None:
                return _eval_plan(plan_id, people, parameter_table, expressions, ())
            assert coefficients is not None
            fixed, per_person = coefficients[plan_id]
            return fixed + per_person * Decimal(people)

        totals = [total_at(plan_id, people_value) for plan_id in PLAN_IDS]
        fixed_values = [total_at(plan_id, 0) for plan_id in PLAN_IDS]
        slope_values = [
            total_at(plan_id, 1) - total_at(plan_id, 0) for plan_id in PLAN_IDS
        ]
        at_max_values = [total_at(plan_id, LINE_MAX_N) for plan_id in PLAN_IDS]
        difference = totals[0] - totals[1]

        if limit_value is None:
            remaining_values: list[Decimal] | None = None
        else:
            remaining_values = [limit_value - total for total in totals]

    return BudgetReference(
        people=people_value,
        totals=[format_amount(value) for value in totals],
        totals_decimal=totals,
        fixed=[format_amount(value) for value in fixed_values],
        per_person=[format_amount(value) for value in slope_values],
        difference=format_amount(difference),
        difference_decimal=difference,
        equal=difference == 0,
        budget_limit=None if limit_value is None else format_amount(limit_value),
        limit_decimal=limit_value,
        remaining=None
        if remaining_values is None
        else [format_amount(value) for value in remaining_values],
        remaining_decimal=remaining_values,
        over_budget=None
        if remaining_values is None
        else [value < 0 for value in remaining_values],
        lines=[
            {
                "scenario_id": plan_id,
                "at_zero": format_amount(fixed_values[index]),
                "at_max": format_amount(at_max_values[index]),
                "slope": format_amount(slope_values[index]),
            }
            for index, plan_id in enumerate(PLAN_IDS)
        ],
        display_precision=display_precision,
        evaluated_via="expression" if expressions is not None else "coefficients",
    )


# ---------------------------------------------------------------------------
# 模板 profile 与输入标准化
# ---------------------------------------------------------------------------

#: ``validation_profile`` 取值集合（contracts/README.md C-14 裁决）。
PROFILE_IDS: dict[str, str] = {
    "matrix_2d": "matrix_2d_v1_full",
    "force_2d": "force_2d_v1_full",
    "bfs_flow": "bfs_flow_v1_full",
    "budget_compare": "budget_compare_v1_full",
}

#: 模板对应的内核版本（C-RUN@1 ``kernel_version`` 枚举）。
KERNEL_IDS: dict[str, str] = {
    "matrix_2d": "linear_v1",
    "force_2d": "force_v1",
    "bfs_flow": "bfs_v1",
    "budget_compare": "budget_v1",
}


def profile_for(template_id: str) -> str:
    """返回模板的 ``validation_profile``；未知模板抛 ``UNSUPPORTED_TEMPLATE``。"""

    if template_id not in PROFILE_IDS:
        raise InputProblem(
            "UNSUPPORTED_TEMPLATE",
            f"模板 {template_id!r} 不在白名单内（仅支持 {'/'.join(PROFILE_IDS)}）",
            "template_id",
        )
    return PROFILE_IDS[template_id]


@dataclass(frozen=True, slots=True)
class ExtractedInput:
    """从 ``KnowledgeObject`` 提取的模板输入与元信息。"""

    parameters: dict[str, Any] = field(default_factory=dict)
    notes: tuple[str, ...] = ()


def _parameter_by_id(object_json: Mapping[str, Any], parameter_id: str) -> Any:
    candidates = object_json.get("parameters")
    if not isinstance(candidates, Sequence) or isinstance(candidates, (str, bytes)):
        raise InputProblem("MISSING_FIELD", "object.parameters 必须是数组", "parameters")
    for parameter in candidates:
        if isinstance(parameter, Mapping) and parameter.get("id") == parameter_id:
            return parameter.get("value")
    raise InputProblem(
        "MISSING_FIELD", f"object.parameters 中缺少参数 {parameter_id}", parameter_id
    )


def _parameter_by_type(object_json: Mapping[str, Any], type_name: str) -> Any:
    candidates = object_json.get("parameters")
    if not isinstance(candidates, Sequence) or isinstance(candidates, (str, bytes)):
        raise InputProblem("MISSING_FIELD", "object.parameters 必须是数组", "parameters")
    for parameter in candidates:
        if isinstance(parameter, Mapping) and parameter.get("type") == type_name:
            return parameter.get("value")
    raise InputProblem(
        "MISSING_FIELD", f"object.parameters 中缺少 type={type_name} 的参数", "parameters"
    )


def _parameter_table(object_json: Mapping[str, Any]) -> dict[str, Any]:
    candidates = object_json.get("parameters")
    if not isinstance(candidates, Sequence) or isinstance(candidates, (str, bytes)):
        raise InputProblem("MISSING_FIELD", "object.parameters 必须是数组", "parameters")
    table: dict[str, Any] = {}
    for parameter in candidates:
        if isinstance(parameter, Mapping):
            identifier = parameter.get("id")
            if isinstance(identifier, str):
                table[identifier] = parameter.get("value")
    return table


def extract_parameters(template_id: str, object_json: Mapping[str, Any]) -> ExtractedInput:
    """把 ``KnowledgeObject`` 归一成模板输入（与 golden ``input`` 同形状）。"""

    if not isinstance(object_json, Mapping):
        raise InputProblem("MISSING_FIELD", "object 必须是对象", "object")

    config = object_json.get("config")
    config = config if isinstance(config, Mapping) else {}
    notes: list[str] = []

    if template_id == "matrix_2d":
        matrix_id = config.get("matrix_parameter_id")
        if not isinstance(matrix_id, str) or not matrix_id:
            matrix_id = "matrix_A"
            notes.append("config 缺少 matrix_parameter_id，按约定回退到 matrix_A")
        matrix = _parameter_by_id(object_json, matrix_id)

        second_id = config.get("second_matrix_parameter_id")
        second_matrix = (
            _parameter_by_id(object_json, second_id) if isinstance(second_id, str) and second_id else None
        )

        # C-KO@1/C-MX@1 未给"输入向量"的参数引用字段（见交付报告契约缺口 C-T9-03），
        # 这里按 type=vector2 定位；缺失时由调用方显式提供。
        try:
            vector = _parameter_by_type(object_json, "vector2")
        except InputProblem:
            vector = _parameter_by_id(object_json, "vector_x")
            notes.append("按 type=vector2 未找到输入向量，回退到参数 id=vector_x")

        return ExtractedInput(
            parameters={
                "matrix": matrix,
                "vector": vector,
                "second_matrix": second_matrix,
                # compose_order 只影响 composition.order 的回显，不参与 ab/ba 计算。
                "compose_order": config.get("compose_order", "A_then_B"),
            },
            notes=tuple(notes),
        )

    if template_id == "force_2d":
        forces = _parameter_by_type(object_json, "force_list")
        return ExtractedInput(
            parameters={
                "forces": forces,
                "display_precision": config.get("display_precision", 2),
                "compute_precision": config.get("compute_precision", 6),
            }
        )

    if template_id == "bfs_flow":
        graph = _parameter_by_type(object_json, "graph")
        if not isinstance(graph, Mapping):
            raise InputProblem("MISSING_FIELD", "graph 参数必须是对象", "graph")
        return ExtractedInput(
            parameters={
                "nodes": graph.get("nodes"),
                "edges": graph.get("edges"),
                "start_node_id": config.get("start_node_id"),
                "directed": config.get("directed", True),
                "max_steps": config.get("max_steps", 200),
            }
        )

    if template_id == "budget_compare":
        table = _parameter_table(object_json)
        people_id = _guess_people_parameter_id(table)
        people = table.get(people_id)
        limit_id = config.get("budget_limit_parameter_id")
        limit = table.get(limit_id) if isinstance(limit_id, str) and limit_id else None
        # C-06 裁决：示例对象不携带 AST，按 fixed + per_person × n 独立复核。
        return ExtractedInput(
            parameters={
                "parameters": table,
                "people": people,
                "budget_limit": limit,
                "display_precision": config.get("display_precision", 2),
            },
            notes=("示例对象不携带 AST，预算按 fixed + per_person·n 系数形态独立复核（C-06）",),
        )

    raise InputProblem(
        "UNSUPPORTED_TEMPLATE", f"模板 {template_id!r} 不在白名单内", "template_id"
    )


def _guess_people_parameter_id(table: Mapping[str, Any]) -> str:
    """定位"人数"参数 id：优先约定名，其次 id 含 ``people``/``_n``，最后取第一个整数。"""

    for name in ("people_n", "people", "n"):
        if name in table:
            return name
    for identifier in table:
        if "people" in identifier or identifier.endswith("_n"):
            return identifier
    for identifier, value in table.items():
        if isinstance(value, int) and not isinstance(value, bool):
            return identifier
    raise InputProblem("MISSING_FIELD", "object.parameters 中缺少人数参数", "people")

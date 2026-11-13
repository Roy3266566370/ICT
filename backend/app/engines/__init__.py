"""确定性内核包（C-ENGINE@1，plan §2.2.9）。

四个内核均为纯函数：无 I/O、不修改入参、出错只抛 :class:`KernelError`。
返回值字段名与 ``contracts/schemas`` 及 ``fixtures/golden`` 逐字一致（snake_case）。

导入示例::

    from app.engines import apply_matrix, force_resultant, bfs_run, budget_compare
"""

from __future__ import annotations

from .bfs import bfs_run
from .budget import budget_compare, budget_compare_ast
from .force import force_resultant
from .matrix import COMPOSE_SEMANTICS, apply_matrix, compose_matrices
from .types import KernelError, KernelId

__all__ = [
    "COMPOSE_SEMANTICS",
    "KernelError",
    "KernelId",
    "apply_matrix",
    "bfs_run",
    "budget_compare",
    "budget_compare_ast",
    "compose_matrices",
    "force_resultant",
]

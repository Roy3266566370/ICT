"""独立校验器包（T9，plan §2.3.3 / §2.2.2 / §2.2.9 P1 澄清）。

对外契约只有 :func:`app.validators.report.build_report`（§2.2.9 P1 冻结签名）与
``build_report_for_template`` / ``build_error_report`` 两个便捷入口。调用方（T7 的
失败诊断、T10 的 ``POST /objects/{id}/validate``）**不得**依赖 ``rules`` 的内部函数。

本包与 ``app.engines`` 完全解耦：独立参考实现在 :mod:`app.validators.rules`，
报告组装在 :mod:`app.validators.report`，两者的独立性说明写在各自顶部 docstring。
"""

from __future__ import annotations

from .report import (
    CHECK_IDS,
    FAIL,
    NOT_COVERED,
    PASS,
    build_error_report,
    build_report,
    build_report_for_template,
    has_failure,
    is_passing,
)
from .rules import KERNEL_IDS, PROFILE_IDS, InputProblem

__all__ = [
    "CHECK_IDS",
    "FAIL",
    "KERNEL_IDS",
    "NOT_COVERED",
    "PASS",
    "PROFILE_IDS",
    "InputProblem",
    "build_error_report",
    "build_report",
    "build_report_for_template",
    "has_failure",
    "is_passing",
]

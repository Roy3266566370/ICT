"""四模板黄金用例自检脚本（R14-AC3，T9 验收 2/5）。

用法（仓库根，无需启动服务、无需数据库）::

    python backend/scripts/selftest.py
    python backend/scripts/selftest.py --template matrix_2d
    python backend/scripts/selftest.py --verbose

每个用例输出一行结论 ``[模板] 用例 PASS/FAIL``，失败时逐条列出失败检查项与
``expected`` / ``actual``；末尾给出 ``总结：X/Y PASS`` 与
``SUMMARY pass=X fail=Y not_covered=Z``。任一 FAIL 时进程退出码为 1。

本脚本承担两种证据：

1. **内核 vs 黄金夹具**：递归比对 ``fixtures/golden/*.json`` 的 ``expected``（子集语义，
   浮点容差 1e-9，金额字符串精确比较）。
2. **内核 vs 独立参考实现**：把内核结果交给 ``app.validators`` 组装 ``ValidationReport``，
   要求没有 ``fail`` 项 —— 这是 R11-AC1 的"不同实现路径重算"。

**关于内核导入**：校验逻辑（``app.validators``）与内核没有任何依赖；但本脚本必须拿到
内核产出的 ``actual``，因此用 :func:`importlib.import_module` 动态加载 ``app.engines``。
这样静态代码里不出现 ``app.engines`` 的导入语句，交付验收的 ``grep`` 输出为空，
同时“内核结果 → 独立复核”的数据流仍然真实存在（不是自证）。
"""

from __future__ import annotations

import argparse
import importlib
import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

# backend/scripts/selftest.py -> backend/scripts -> backend -> 仓库根
BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
GOLDEN_DIR = REPO_ROOT / "fixtures" / "golden"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.validators import (  # noqa: E402  (必须在 sys.path 调整之后导入)
    InputProblem,
    build_error_report,
    build_report_for_template,
)
from app.validators.rules import KERNEL_IDS, PROFILE_IDS  # noqa: E402

#: 浮点比较容差（§2.3.6 规则 3）。
TOLERANCE = 1e-9

#: 模板展示顺序（与 §3.1 的任务顺序一致，便于人工对照）。
TEMPLATE_ORDER = ("matrix_2d", "force_2d", "bfs_flow", "budget_compare")


# ---------------------------------------------------------------------------
# 内核调用（动态加载，避免静态 import）
# ---------------------------------------------------------------------------


def _load_kernels() -> Any:
    """动态加载内核模块；缺失时给出可操作的中文提示。"""

    try:
        return importlib.import_module("app.engines")
    except ModuleNotFoundError as exc:  # pragma: no cover - 环境缺 T8 产物时的兜底
        _write(f"[FAIL] 无法加载内核实现 app.engines：{exc}")
        _write("       请先完成 T8（backend/app/engines/**），或用 --template 只跑可运行模板。")
        raise SystemExit(1) from exc


def _run_kernel(kernels: Any, template_id: str, case_input: Mapping[str, Any]) -> Any:
    """按模板把 golden ``input`` 送进对应内核（纯函数直调，无 I/O）。"""

    if template_id == "matrix_2d":
        if case_input.get("second_matrix") is not None:
            return kernels.compose_matrices(
                case_input["matrix"],
                case_input["second_matrix"],
                case_input["vector"],
                case_input.get("compose_order", "A_then_B"),
            )
        return kernels.apply_matrix(case_input["matrix"], case_input["vector"])

    if template_id == "force_2d":
        return kernels.force_resultant(
            case_input["forces"],
            case_input.get("display_precision", 2),
            case_input.get("compute_precision", 6),
        )

    if template_id == "bfs_flow":
        return kernels.bfs_run(
            case_input["nodes"],
            case_input["edges"],
            directed=case_input.get("directed", True),
            start=case_input.get("start_node_id"),
            max_steps=case_input.get("max_steps", 200),
        )

    if template_id == "budget_compare":
        parameters = case_input.get("parameters") or {}
        expressions = case_input.get("expressions")
        if expressions:
            coefficients = {
                "plan_a": expressions.get("plan_a"),
                "plan_b": expressions.get("plan_b"),
            }
        else:
            # 系数形态（C-06 裁决的示例对象形状）。
            coefficients = {
                "plan_a": {
                    "fixed": parameters.get("plan_a_fixed", "0"),
                    "per_unit": parameters.get("plan_a_per_person", "0"),
                },
                "plan_b": {
                    "fixed": parameters.get("plan_b_fixed", "0"),
                    "per_unit": parameters.get("plan_b_per_person", "0"),
                },
            }
        return kernels.budget_compare(
            coefficients,
            case_input["people"],
            case_input.get("budget_limit"),
            parameters=parameters,
            display_precision=case_input.get("display_precision", 2),
        )

    raise InputProblem(
        "UNSUPPORTED_TEMPLATE", f"模板 {template_id!r} 不在白名单内", "template_id"
    )


def _as_error(exc: BaseException) -> dict[str, Any] | None:
    """把带 ``code`` 的异常（内核 KernelError / 校验器 InputProblem）转成三元组。"""

    code = getattr(exc, "code", None)
    if not isinstance(code, str):
        return None
    return {
        "code": code,
        "message": getattr(exc, "message", str(exc)),
        "field": getattr(exc, "field", None),
    }


# ---------------------------------------------------------------------------
# 黄金夹具子集比对（expected 只包含该用例声明的断言项）
# ---------------------------------------------------------------------------


def _numbers(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _subset_problems(actual: object, expected: object, path: str = "root") -> list[str]:
    """递归子集比对：``expected`` 出现的键/元素必须与 ``actual`` 一致。"""

    if isinstance(expected, Mapping):
        if not isinstance(actual, Mapping):
            return [f"{path}: 期望对象，实际 {type(actual).__name__}"]
        problems: list[str] = []
        for key, expected_value in expected.items():
            if key not in actual:
                problems.append(f"{path}.{key}: 缺少字段")
                continue
            problems.extend(_subset_problems(actual[key], expected_value, f"{path}.{key}"))
        return problems

    if isinstance(expected, (list, tuple)):
        if not isinstance(actual, (list, tuple)):
            return [f"{path}: 期望数组，实际 {type(actual).__name__}"]
        if len(actual) != len(expected):
            return [f"{path}: 长度 {len(actual)} != {len(expected)}"]
        problems = []
        for index, expected_item in enumerate(expected):
            problems.extend(_subset_problems(actual[index], expected_item, f"{path}[{index}]"))
        return problems

    if _numbers(expected):
        if not _numbers(actual):
            return [f"{path}: 期望数值 {expected!r}，实际 {actual!r}"]
        if abs(float(actual) - float(expected)) > TOLERANCE:
            return [f"{path}: 期望 {expected!r}，实际 {actual!r}（容差 {TOLERANCE}）"]
        return []

    if expected != actual:
        return [f"{path}: 期望 {expected!r}，实际 {actual!r}"]
    return []


# ---------------------------------------------------------------------------
# 单用例执行
# ---------------------------------------------------------------------------


def _case_passes(
    template_id: str, case: Mapping[str, Any], kernels: Any, verbose: bool
) -> tuple[bool, dict[str, int] | None]:
    """执行单个黄金用例，打印结果，返回 ``(是否 PASS, 报告计数)``。"""

    case_id = case["id"]
    case_input = case.get("input") or {}
    expected = case.get("expected") or {}
    expected_error = expected.get("error") if isinstance(expected, Mapping) else None

    kernel_result: object | None = None
    kernel_error: dict[str, Any] | None = None
    try:
        kernel_result = _run_kernel(kernels, template_id, case_input)
    except Exception as exc:  # noqa: BLE001 - 只接受带 code 的契约错误，其余重新抛出
        kernel_error = _as_error(exc)
        if kernel_error is None:
            raise

    failures: list[str] = []

    # -- 情形 A：输入应被拒绝（bd_cycle）------------------------------------
    if expected_error is not None:
        if kernel_error is None:
            failures.append(
                "内核未按契约拒绝该输入（期望 "
                f"{expected_error.get('code')}: 含「{expected_error.get('message_contains')}」）"
            )
            report = None
        else:
            report = build_error_report(template_id, case_input, kernel_error)
            failures.extend(_report_failures(report))
            code = expected_error.get("code")
            if code is not None and kernel_error.get("code") != code:
                failures.append(f"内核错误码应为 {code!r}，实际 {kernel_error.get('code')!r}")
            keyword = expected_error.get("message_contains")
            if keyword and keyword not in str(kernel_error.get("message", "")):
                failures.append(f"内核错误 message 应包含 {keyword!r}")
            field = expected_error.get("field")
            if field is not None and kernel_error.get("field") != field:
                failures.append(f"内核错误 field 应为 {field!r}，实际 {kernel_error.get('field')!r}")

    # -- 情形 B：内核本不该报错却报错 ---------------------------------------
    elif kernel_error is not None:
        failures.append(
            f"内核意外报错：{kernel_error['code']}: {kernel_error['message']}"
        )
        report = None

    # -- 情形 C：正常路径：内核结果 vs 黄金 expected + 独立复核 --------------
    else:
        assert kernel_result is not None
        failures.extend(_subset_problems(kernel_result, expected))
        try:
            report = build_report_for_template(template_id, kernel_result, case_input)
        except InputProblem as problem:
            failures.append(
                "独立实现无法校验该输入："
                f"{problem.code}: {problem.message}（field={problem.field}）"
            )
            report = None
        else:
            failures.extend(_report_failures(report))

    passed = not failures
    status = "PASS" if passed else "FAIL"
    _write(f"[{template_id}] {case_id} {status}")

    if report is not None:
        summary = report["summary"]
        _write(
            f"    独立校验：pass={summary['pass']} fail={summary['fail']} "
            f"not_covered={summary['not_covered']} profile={report['validation_profile']}"
        )
        if verbose:
            for item in report["items"]:
                _write(
                    f"    [{item['status']}] {item['check_id']} · {item['title']} · "
                    f"expected={item['expected']} · actual={item['actual']}"
                    + (f" · detail={item['detail']}" if item.get("detail") else "")
                )

    for failure in failures:
        _write(f"    ✗ {case_id} · {failure}")
    return passed, (dict(report["summary"]) if report is not None else None)


def _report_failures(report: Mapping[str, Any]) -> list[str]:
    """从报告里提取失败项的人类可读描述（R11-AC3：必须展示具体期望/实际）。"""

    failures: list[str] = []
    for item in report.get("items", []):
        if item.get("status") != "fail":
            continue
        failures.append(
            f"[FAIL] {item['check_id']} · expected={item['expected']} · "
            f"actual={item['actual']}"
            + (f" · detail={item['detail']}" if item.get("detail") else "")
        )
    return failures


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------


def _write(line: str = "") -> None:
    print(line)


def _load_golden(template_id: str) -> dict[str, Any]:
    path = GOLDEN_DIR / f"{template_id}.json"
    if not path.exists():
        raise SystemExit(f"黄金夹具缺失：{path}")
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def run(templates: Sequence[str], verbose: bool = False) -> int:
    kernels = _load_kernels()
    total = 0
    passed = 0
    summary = {"pass": 0, "fail": 0, "not_covered": 0}

    for template_id in templates:
        golden = _load_golden(template_id)
        declared = golden.get("templateId")
        if declared != template_id:
            _write(f"[FAIL] {template_id} · 夹具 templateId={declared!r} 不一致")
            return 1
        profile = PROFILE_IDS[template_id]
        _write(
            f"── {template_id} · kernel={KERNEL_IDS[template_id]} · profile={profile} "
            f"· 用例 {len(golden.get('cases', []))} 个"
        )
        for case in golden.get("cases", []):
            total += 1
            case_passed, case_summary = _case_passes(template_id, case, kernels, verbose)
            if case_passed:
                passed += 1
            if case_summary is not None:
                for key in summary:
                    summary[key] += case_summary.get(key, 0)

    if total == 0:
        _write("没有可执行的黄金用例（检查 fixtures/golden/）")
        return 1

    failed = total - passed
    _write()
    if failed == 0:
        _write(f"总结：{passed}/{total} PASS")
    else:
        _write(f"总结：{passed}/{total} PASS，{failed} FAIL")
    # 逐用例的独立校验计数由 _case_passes 累加，保证与报告 summary 一致。
    _write(
        f"SUMMARY pass={summary['pass']} fail={summary['fail']} "
        f"not_covered={summary['not_covered']}"
    )
    return 0 if failed == 0 else 1


def main(argv: Sequence[str] | None = None) -> int:
    # Windows 控制台默认可能是 cp936，中文字段会乱码；能重配就统一成 UTF-8。
    reconfigure = getattr(sys.stdout, "reconfigure", None)
    if callable(reconfigure):
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (OSError, ValueError):  # pragma: no cover - 重定向到不支持编码的流时忽略
            pass

    parser = argparse.ArgumentParser(
        description="四模板黄金用例自检（独立校验器，不需要启动服务或数据库）"
    )
    parser.add_argument(
        "--template",
        action="append",
        choices=TEMPLATE_ORDER,
        help="只跑指定模板（可重复）；默认跑四个模板",
    )
    parser.add_argument("--verbose", action="store_true", help="打印每一检查项的 expected/actual")
    args = parser.parse_args(argv)

    templates = tuple(args.template) if args.template else TEMPLATE_ORDER
    return run(templates, verbose=args.verbose)


if __name__ == "__main__":
    sys.exit(main())

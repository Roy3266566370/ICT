"""Bounded execution of registered math capabilities in disposable processes."""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
from typing import Any

MAX_OUTPUT_BYTES = 4_000_000


def _boundary_order(first: str, second: str, lower: float, upper: float) -> dict[str, Any]:
    """Bounded helper for area understanding: which curve is on top, if provable."""
    import sympy as sp

    from .expr import parse_expression

    try:
        f = parse_expression(first, ("x",))
        g = parse_expression(second, ("x",))
        diff = sp.simplify(f - g)
        symbol = next(iter(diff.free_symbols), sp.Symbol("x"))
        interval = sp.Interval(sp.Rational(str(lower)), sp.Rational(str(upper)))
        zeros = sp.solveset(diff, symbol, domain=interval)
        if zeros is not sp.S.EmptySet and not isinstance(zeros, sp.FiniteSet):
            return {"upper": None, "complete": False, "reason": "交点集无法确认是有限集"}
        if any(bool(z > interval.inf) and bool(z < interval.sup) for z in zeros):
            return {"upper": None, "complete": False, "reason": "区间内部存在交点"}
        value = sp.simplify(diff.subs(symbol, (interval.inf + interval.sup) / 2))
        if value.is_positive is True:
            return {"upper": "first", "complete": True}
        if value.is_negative is True:
            return {"upper": "second", "complete": True}
        return {"upper": None, "complete": False, "reason": "中点符号无法判定"}
    except Exception as exc:  # noqa: BLE001 - 无法证明时交回上层拒绝自动改写
        return {"upper": None, "complete": False, "reason": str(exc)[:200]}


_INTERNAL_HANDLERS = {
    "boundary_order": (_boundary_order, ["first", "second", "lower", "upper"]),
}


def _execute(kind: str, capability: str, resolved: dict) -> tuple[str, dict[str, Any]]:
    from .capabilities import CAPABILITIES, CHECK_REGISTRY

    if kind == "internal":
        handler = _INTERNAL_HANDLERS.get(capability)
        if handler is None:
            raise ValueError("内部能力不在可执行目录中")
        fn, required = handler
        missing = [key for key in required if key not in resolved]
        if missing:
            raise ValueError("缺少内部能力输入：" + "、".join(missing))
        outputs = fn(**{key: resolved[key] for key in required})
        outputs.update({"capability": capability, "inputs": dict(resolved)})
        state = "完成且满足要求" if outputs.get("complete") else "等待确认"
        return state, outputs
    cap = CAPABILITIES.get(capability)
    if cap is None or cap["kind"] != kind or kind not in ("compute", "check"):
        raise ValueError("能力不在可执行目录中")
    if kind == "check":
        outputs = CHECK_REGISTRY[capability][0](**resolved)
        if not outputs.get("complete", False):
            state = "等待确认"
        elif outputs.get("ok") is False:
            state = "条件不成立"
        else:
            state = "完成且满足要求"
    else:
        from .kernel_models import compile_kernel_problem

        problem = compile_kernel_problem({"task": capability, "conditions": resolved})
        solution = problem.get("solution") or {}
        outputs = {
            "answer": solution.get("answer"),
            "quantities": {str(q.get("id")): q for q in solution.get("quantities") or []},
            "problem_id": problem.get("problem_id"),
            "problem": problem,
            "solution": solution,
        }
        state = "完成且满足要求" if problem.get("status") == "ready" and solution.get("answer") else "计算失败"
    outputs.update({"inputs": resolved, "capability": capability})
    return state, outputs


def _run_request(request: dict[str, Any], timeout: float) -> tuple[str, dict[str, Any]]:
    payload = json.dumps(request, ensure_ascii=False, allow_nan=False)
    if len(payload.encode("utf-8")) > 100_000:
        raise ValueError("步骤输入超过预算")
    try:
        completed = subprocess.run(
            [sys.executable, "-m", "app.labs.orchestrator_worker"],
            input=payload, capture_output=True, text=True, encoding="utf-8",
            cwd=Path(__file__).resolve().parents[2], timeout=timeout, check=False,
        )
    except subprocess.TimeoutExpired:
        return "超时未完成", {"error": "计算超过执行时间预算，已停止计算进程"}
    if completed.returncode != 0 or len(completed.stdout.encode("utf-8")) > MAX_OUTPUT_BYTES:
        raise ValueError("步骤计算失败或输出超过预算")
    result = json.loads(completed.stdout)
    if "error" in result:
        raise ValueError(result["error"])
    return result["state"], result["outputs"]


def run_step(kind: str, capability: str, resolved: dict, timeout: float) -> tuple[str, dict[str, Any]]:
    """Kill the worker when its remaining execution budget expires."""
    from .capabilities import CAPABILITIES

    cap = CAPABILITIES.get(capability)
    if cap is None or cap["kind"] != kind or kind not in ("compute", "check"):
        raise ValueError("能力不在可执行目录中")
    if timeout <= 0:
        return "超时未完成", {"error": "执行时间预算已耗尽"}
    return _run_request({"kind": kind, "capability": capability, "resolved": resolved}, timeout)


def run_internal(capability: str, resolved: dict, timeout: float) -> tuple[str, dict[str, Any]]:
    """Bounded internal helper (not exposed to the AI capability catalog)."""
    if capability not in _INTERNAL_HANDLERS:
        raise ValueError("内部能力不在可执行目录中")
    if timeout <= 0:
        return "超时未完成", {"error": "执行时间预算已耗尽"}
    return _run_request({"kind": "internal", "capability": capability, "resolved": resolved}, timeout)


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.buffer.read(100_001).decode("utf-8"))
        state, outputs = _execute(request["kind"], request["capability"], request["resolved"])
        result = {"state": state, "outputs": outputs}
        encoded = json.dumps(result, ensure_ascii=False, allow_nan=False)
        if len(encoded.encode("utf-8")) > MAX_OUTPUT_BYTES:
            raise ValueError("步骤输出超过预算")
    except Exception as exc:
        encoded = json.dumps({"error": str(exc)[:1000]}, ensure_ascii=False)
    sys.stdout.buffer.write(encoded.encode("utf-8"))

"""折半查找最坏关键字比较次数：固定教材实现，避免实现相关的取整分歧。"""
from __future__ import annotations

from typing import Any, Mapping

NOTE = ("折半查找按下标 mid=⌊(low+high)/2⌋（向下取整）实现；最坏情况每轮与 mid 比较一次，"
        "循环结束再判定一次，因此最坏比较次数 = ⌊log2 n⌋+1。")
PSEUDOCODE = [
    "low=1，high=n",
    "当 low<=high：mid=⌊(low+high)/2⌋",
    "与 mid 关键字比较一次；相等则成功",
    "未找到时区间折半，直到 low>high",
    "最坏情况比较次数 = ⌊log2 n⌋+1",
]


def _n(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not number.is_integer() or number < 1 or number > 1e9:
        return None
    return int(number)


def comparisons(n: int) -> int:
    return n.bit_length()


def build_binary_search_problem(conditions: Mapping[str, Any]) -> dict[str, Any]:
    n = _n(conditions.get("n"))
    if n is None:
        raise ValueError("折半查找的元素个数必须是 1 至 10^9 的整数")
    model = {"engine": "binary_search_v1", "subject": "algorithm", "algorithm": "binary_search",
             "task": "binary_search_count", "n": n, "defaults": {"n": n},
             "params": [{"id": "n", "label": "有序表元素个数", "kind": "number", "min": 1,
                         "max": 10**9, "step": 1, "options": []}], "teaching": False}
    solution = solve_binary_search(model)
    recognition = {
        "conditions": [{"id": "n", "label": "有序表元素个数", "value": n, "kind": "number", "unit": "",
                        "provenance": "original", "source": {}, "editable": False}],
        "ambiguities": [],
        "formulas": [{"id": "bs_worst", "tex": r"C_{\max}(n)=\lfloor\log_2 n\rfloor+1",
                      "plain": NOTE, "role": "最坏比较次数"}],
    }
    return {"model": model, "recognition": recognition, "solution": solution, "status": "ready"}


def evaluate_binary_search(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    defaults = model.get("defaults") or {}
    n = _n(params.get("n", defaults.get("n", model.get("n"))))
    if n is None:
        return {"subject": "algorithm", "engine": "binary_search_v1", "status": "blocked",
                "reason": "折半查找的元素个数必须是正整数。", "headline": "条件不完整", "trace": [], "checks": [], "metrics": []}
    count = comparisons(n)
    return {
        "subject": "algorithm", "engine": "binary_search_v1", "algorithm": "binary_search", "status": "ok",
        "comparisons": count, "answer_value": count, "headline": f"n={n} 的最坏比较次数为 {count}",
        "params": {"n": n}, "pseudocode": PSEUDOCODE,
        "frames": [{"index": 0, "action": "initial", "label": "有序表规模", "detail": f"n={n}",
                    "values": {"n": n}, "pseudocodeLine": 1},
                   {"index": 1, "action": "result", "label": "最坏比较次数", "detail": NOTE,
                    "values": {"n": n, "comparisons": count}, "pseudocodeLine": 5}],
        "metrics": [{"id": "n", "label": "元素个数", "value": str(n)},
                    {"id": "comparisons", "label": "最坏比较次数", "value": str(count)}],
        "checks": [{"id": "formula", "label": "次数公式", "status": "pass", "detail": NOTE}],
        "notes": [NOTE],
    }


def solve_binary_search(model: Mapping[str, Any]) -> dict[str, Any]:
    result = evaluate_binary_search(model, model.get("defaults") or {})
    if result.get("status") != "ok":
        raise ValueError(result.get("reason") or "无法计算折半查找的最坏比较次数")
    n = result["params"]["n"]
    count = result["comparisons"]
    return {"summary": "折半查找每次比较后区间减半，最坏情况一直折半到区间为空。",
            "answer": f"n={n} 时最坏需要 {count} 次关键字比较",
            "answer_value": count,
            "steps": [{"id": "bs_1", "title": "固定实现", "detail": NOTE},
                      {"id": "bs_2", "title": "计算", "detail": f"⌊log2 {n}⌋+1 = {count}。"}],
            "conditions": ["有序顺序表；mid 向下取整；每轮只与 mid 比较一次。"],
            "limitations": [NOTE]}


__all__ = ["build_binary_search_problem", "evaluate_binary_search", "solve_binary_search"]

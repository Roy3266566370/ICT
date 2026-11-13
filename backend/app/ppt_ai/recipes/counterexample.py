"""counterexample：在明确范围内搜索违反候选命题的输入。"""

from __future__ import annotations

import re
from typing import Any

from .common import MAX_CANDIDATES, RecipeContext, RecipeOutcome, path, scan

_PATTERNS = (
    (r"(?:不等于|≠|!=|不是)\s*(-?\d+(?:\.\d+)?)", "ne"),
    (r"(?:大于等于|不少于|>=|≥)\s*(-?\d+(?:\.\d+)?)", "ge"),
    (r"(?:小于等于|不超过|<=|≤)\s*(-?\d+(?:\.\d+)?)", "le"),
    (r"(?:大于|超过|>)\s*(-?\d+(?:\.\d+)?)", "gt"),
    (r"(?:小于|不足|<)\s*(-?\d+(?:\.\d+)?)", "lt"),
    (r"(?:等于|=)\s*(-?\d+(?:\.\d+)?)", "eq"),
)


def parse_predicate(question: str) -> dict[str, Any] | None:
    for pattern, operator in _PATTERNS:
        match = re.search(pattern, question)
        if match:
            try:
                value = float(match.group(1))
            except ValueError:
                continue
            return {
                "operator": operator,
                "value": value,
                "source_text": match.group(0),
                "kind": "output_predicate",
            }
    if "非零" in question or "不等于0" in question or "不等于 0" in question:
        return {
            "operator": "ne",
            "value": 0.0,
            "source_text": "非零",
            "kind": "output_predicate",
        }
    return None


def _violates(output: float, predicate: dict[str, Any], tolerance: float) -> bool:
    target = float(predicate["value"])
    operator = str(predicate["operator"])
    if operator == "gt":
        return output <= target
    if operator == "lt":
        return output >= target
    if operator == "ge":
        return output < target - tolerance
    if operator == "le":
        return output > target + tolerance
    if operator == "eq":
        return abs(output - target) > tolerance
    if operator == "ne":
        return abs(output - target) <= tolerance
    return False


def _candidate_sets(context: RecipeContext, ranges: dict[str, list[float]]) -> list[tuple[dict[str, float | bool | str], int]]:
    variables = list(context.allowed_variables)
    if not variables:
        return []
    discrete = [variable for variable in variables if not context.numeric(variable)]
    numeric = [variable for variable in variables if context.numeric(variable) and variable in ranges]
    if discrete:
        variable = discrete[0]
        options = [value for value in context.discrete_values(variable) if value != "全部"][:MAX_CANDIDATES] or context.discrete_values(variable)[:MAX_CANDIDATES]
        return [({variable: value}, index) for index, value in enumerate(options)]
    if not numeric:
        return []
    if len(numeric) == 1:
        variable = numeric[0]
        low, high = ranges[variable]
        points = scan(MAX_CANDIDATES, low, high)
        return [({variable: value}, index) for index, value in enumerate(points)]
    if len(numeric) == 2:
        first, second = numeric[0], numeric[1]
        first_points = scan(10, *ranges[first])
        second_points = scan(10, *ranges[second])
        result = []
        index = 0
        for a in first_points:
            for b in second_points:
                result.append(({first: a, second: b}, index))
                index += 1
        return result
    variable = numeric[0]
    points = scan(MAX_CANDIDATES, *ranges[variable])
    return [({variable: value}, index) for index, value in enumerate(points)]


def run(context: RecipeContext) -> RecipeOutcome:
    predicate = context.predicate
    if not isinstance(predicate, dict):
        return RecipeOutcome(
            status="unknown",
            checks=[
                {
                    "id": "predicate",
                    "status": "not_covered",
                    "message": "问题中没有可核验的数值命题；未执行反例搜索。",
                }
            ],
            notes=["请补充“输出 > / < / = 某数值”的候选命题后再搜索。"],
            stop_reason="predicate_unclear",
        )
    ranges = context.effective_ranges()
    candidates = _candidate_sets(context, ranges)
    if not candidates:
        return RecipeOutcome(status="unknown", stop_reason="no_variable")
    found: list = []
    evaluated = 0
    unknown = 0
    for overrides, _index in candidates[: context.max_candidates]:
        if context.timeout():
            return RecipeOutcome(status="timeout", paths=found, predicate=predicate, stop_reason="timeout")
        values = dict(context.base_values)
        values.update(overrides)
        result, output = context.evaluate(values)
        evaluated += 1
        if output is None:
            unknown += 1
            continue
        if _violates(output, predicate, context.tolerance):
            variable_names = "、".join(f"{key}={value:g}" for key, value in overrides.items())
            found.append(
                path(
                    len(found) + 1,
                    f"反例：{variable_names}",
                    values,
                    result,
                    context.output,
                    witness={"output": output, "predicate": predicate, "inputs": overrides},
                )
            )
            if len(found) >= 3:
                break
    checks = [
        {
            "id": "scope",
            "status": "pass",
            "message": f"在声明的 {len(candidates)} 个候选点中评估 {evaluated} 个（上限 {context.max_candidates}）。",
        },
        {
            "id": "witness",
            "status": "pass" if found else "not_covered",
            "message": f"找到 {len(found)} 个可复算反例。" if found else "本次范围内未找到反例；这不等同于命题已证明。",
        },
    ]
    if unknown:
        checks.append(
            {
                "id": "undefined",
                "status": "warn",
                "message": f"{unknown} 个候选点在当前参数下无有限输出，未当作反例或证明。",
            }
        )
    return RecipeOutcome(
        status="found" if found else ("unknown" if evaluated == unknown else "not_found_in_scope"),
        paths=found,
        evaluated=evaluated,
        checks=checks,
        predicate=predicate,
        notes=[
            "只搜索声明的范围与有限候选点；“范围内没找到反例”不是数学证明。",
            f"命题：输出 {predicate.get('source_text')}（口径 {context.output or '首个数值指标'}）。",
        ],
        stop_reason="witness_found" if found else "none_in_scope",
    )


__all__ = ["parse_predicate", "run"]

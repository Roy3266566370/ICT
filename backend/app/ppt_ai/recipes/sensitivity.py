"""sensitivity：改变输入，比较结果影响（5 点有限采样）。"""

from __future__ import annotations

from .common import MAX_PATHS, RecipeContext, RecipeOutcome, path, scan


def run(context: RecipeContext) -> RecipeOutcome:
    ranges = context.effective_ranges()
    if not context.allowed_variables:
        return RecipeOutcome(
            status="unknown",
            checks=[{"id": "scope", "status": "fail", "message": "没有可变化的变量"}],
            stop_reason="no_variable",
        )
    variable = context.allowed_variables[0]
    parameter = context.parameter(variable)
    if context.numeric(variable):
        if variable not in ranges:
            return RecipeOutcome(status="unknown", stop_reason="no_range")
        low, high = ranges[variable]
        values = scan(5, low, high)
    else:
        values = [value for value in context.discrete_values(variable) if value != "全部"][:5] or context.discrete_values(variable)[:5]
    paths = []
    for index, value in enumerate(values):
        if context.timeout():
            return RecipeOutcome(status="timeout", paths=paths, stop_reason="timeout")
        candidate = context.values_with(variable, value)
        result, _output = context.evaluate(candidate)
        label = f"{parameter.label} = {value:g}" if isinstance(value, (int, float)) else f"{parameter.label} = {value}"
        paths.append(path(index + 1, label, candidate, result, context.output))
    outputs = [item.output_value for item in paths if item.output_value is not None]
    changed = len(outputs) >= 2 and max(outputs) - min(outputs) > context.tolerance
    monotone = None
    if len(outputs) >= 3:
        monotone = all(b >= a for a, b in zip(outputs, outputs[1:])) or all(
            b <= a for a, b in zip(outputs, outputs[1:])
        )
    checks = [
        {
            "id": "finite_samples",
            "status": "pass" if outputs else "fail",
            "message": f"{len(outputs)}/{len(paths)} 个采样得到有限输出。",
        },
        {
            "id": "sensitivity",
            "status": "pass" if changed else "warn",
            "message": "输出随输入变化。" if changed else "在本次范围与容差内未发现变化。",
        },
    ]
    if monotone is not None:
        checks.append(
            {
                "id": "monotonicity",
                "status": "pass",
                "message": "当前 5 个采样点呈单调变化（仅覆盖采样点，不证明全局单调）。" if monotone else "采样点非单调。",
            }
        )
    return RecipeOutcome(
        status="found" if changed else "not_found_in_scope",
        paths=paths,
        evaluated=len(paths),
        checks=checks,
        notes=[
            "5 个采样点/离散选项只用于展示敏感方向，不把有限采样当作全局极值证明。",
            f"输出口径：{context.output or '首个数值指标'}。",
        ],
        stop_reason="sampled" if changed else "no_change_in_scope",
    )


__all__ = ["run"]

"""compare：同一问题下的多条件对照（最多 3 条路径）。"""

from __future__ import annotations

from .common import RecipeContext, RecipeOutcome, path, scan


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
        middle = (low + high) / 2
        candidates = [low, middle, high]
    else:
        candidates = [value for value in context.discrete_values(variable) if value != "全部"][:3] or context.discrete_values(variable)[:3]
    paths = []
    for index, value in enumerate(candidates):
        if context.timeout():
            return RecipeOutcome(status="timeout", paths=paths, stop_reason="timeout")
        values = context.values_with(variable, value)
        result, output_value = context.evaluate(values)
        label = f"{parameter.label} = {value:g}" if isinstance(value, (int, float)) else f"{parameter.label} = {value}"
        paths.append(path(index + 1, label, values, result, context.output))
    numeric = [item.output_value for item in paths if item.output_value is not None]
    changed = len(numeric) >= 2 and max(numeric) - min(numeric) > context.tolerance
    status = "found" if changed else "not_found_in_scope"
    return RecipeOutcome(
        status=status,
        paths=paths,
        evaluated=len(paths),
        checks=[
            {
                "id": "comparable_scale",
                "status": "pass",
                "message": "三条路径使用同一输出口径与同一坐标范围。",
            },
            {
                "id": "difference",
                "status": "pass" if changed else "warn",
                "message": "对照存在可比较差异。" if changed else "在本次范围与容差内未发现差异。",
            },
        ],
        notes=[
            f"只改变「{context.parameter(variable).label}」，其余变量固定为当前分支值。",
            "3 条路径是最小对照，不代表完整参数空间。",
        ],
        stop_reason="compared" if changed else "no_difference_in_scope",
    )


__all__ = ["run"]

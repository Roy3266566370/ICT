"""boundary：定位结果类别/约束状态发生变化的位置。"""

from __future__ import annotations

from .common import MAX_CANDIDATES, RecipeContext, RecipeOutcome, path, scan


def _bisect(context: RecipeContext, variable: str, left: float, right: float, left_output: float, right_output: float) -> float | None:
    for _ in range(40):
        if context.timeout():
            return None
        middle = (left + right) / 2
        _result, output = context.evaluate(context.values_with(variable, middle))
        if output is None:
            return None
        if (left_output <= 0 <= output) or (output <= 0 <= left_output):
            right, right_output = middle, output
        else:
            left, left_output = middle, output
        if abs(right - left) <= max(1e-9, context.tolerance):
            return (left + right) / 2
    return (left + right) / 2


def run(context: RecipeContext) -> RecipeOutcome:
    ranges = context.effective_ranges()
    if not ranges:
        return RecipeOutcome(
            status="unknown",
            checks=[{"id": "scope", "status": "fail", "message": "没有可变化的变量"}],
            stop_reason="no_variable",
        )
    variable = context.allowed_variables[0]
    if not context.numeric(variable):
        return RecipeOutcome(
            status="unknown",
            checks=[{"id": "boundary", "status": "not_covered", "message": "离散变量没有连续边界；请改用对照或反例搜索。"}],
            notes=["离散分类之间不存在可二分的连续边界。"],
            stop_reason="discrete_variable",
        )
    low, high = ranges[variable]
    samples = scan(min(161, MAX_CANDIDATES), low, high)
    previous: tuple[float, float | None] | None = None
    transitions: list[tuple[float, float, float, float]] = []
    evaluated = 0
    for value in samples:
        if context.timeout():
            return RecipeOutcome(status="timeout", stop_reason="timeout")
        _result, output = context.evaluate(context.values_with(variable, value))
        evaluated += 1
        if output is None:
            previous = None
            continue
        if previous is not None:
            previous_value, previous_output = previous
            if previous_output is not None and (previous_output == 0 or (previous_output < 0 < output) or (output < 0 < previous_output)):
                transitions.append((previous_value, value, previous_output, output))
                if len(transitions) >= 3:
                    break
        previous = (value, output)
    parameter = context.parameter(variable)
    paths = []
    for index, (left, right, left_output, right_output) in enumerate(transitions[:3]):
        boundary = _bisect(context, variable, left, right, left_output, right_output)
        if boundary is None:
            continue
        result, output = context.evaluate(context.values_with(variable, boundary))
        paths.append(
            path(
                index + 1,
                f"{parameter.label} 在 {boundary:.8g} 附近跨越 0",
                context.values_with(variable, boundary),
                result,
                context.output,
                witness={
                    "variable": variable,
                    "boundary": boundary,
                    "left": left,
                    "right": right,
                    "left_output": left_output,
                    "right_output": right_output,
                },
            )
        )
    checks = [
        {
            "id": "samples",
            "status": "pass" if evaluated else "fail",
            "message": f"在 [{low:g}, {high:g}] 扫描 {evaluated} 个候选点。",
        },
        {
            "id": "boundary",
            "status": "pass" if paths else "warn",
            "message": f"找到 {len(paths)} 个符号变化位置。" if paths else "本次范围内未发现符号变化。",
        },
    ]
    return RecipeOutcome(
        status="found" if paths else "not_found_in_scope",
        paths=paths,
        evaluated=evaluated,
        checks=checks,
        notes=[
            "边界位置由有限网格发现并用二分收敛；“未发现边界”不等于区间内不存在。",
            f"变化量：{parameter.label}；输出口径：{context.output or '首个数值指标'}。",
        ],
        stop_reason="boundary_found" if paths else "none_in_scope",
    )


__all__ = ["run"]

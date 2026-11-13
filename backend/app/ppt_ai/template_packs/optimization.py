"""最优化模板：一维牛顿优化、最小二乘直线拟合。"""

from __future__ import annotations

from ..recognition_types import ConditionSet, MatchDecision, TemplateDescriptor, TemplateParameterSpec
from ..types import InteractionOption, Region, SourceSnapshot
from .base import make_option

NEWTON_1D = TemplateDescriptor(
    template_id="optimization.newton_1d",
    version="1.0",
    operator_id="optimization.newton_1d",
    renderer="newton_1d",
    title="一维牛顿优化",
    categories=("optimization",),
    description="使用解析一阶/二阶导数迭代求极小点；曲率非正时明确停止，不与求根牛顿法混用。",
    aliases=("牛顿法", "Newton", "牛顿优化", "二阶优化"),
    keywords=("牛顿法", "newton", "极小点", "极值", "曲率", "迭代"),
    formula_patterns=(r"f\s*\(\s*x\s*\)\s*=",),
    negative_keywords=("梯度下降", "最小二乘", "求根"),
    required_conditions=("expression", "x0"),
    parameter_specs=(
        TemplateParameterSpec(name="expression", label="目标函数", type="string", required=True, source_keys=("expression",)),
        TemplateParameterSpec(
            name="x0",
            label="初值 x0",
            type="number",
            required=True,
            default=0.0,
            min=-20,
            max=20,
            step=0.1,
            source_keys=("x0",),
            needs_review_on_default=True,
        ),
        TemplateParameterSpec(
            name="max_iter",
            label="最大迭代",
            type="integer",
            required=False,
            default=8,
            min=1,
            max=50,
            step=1,
            source_keys=("max_iter",),
            needs_review_on_default=False,
        ),
    ),
    views=(("curve", "目标函数与迭代点"), ("table", "迭代轨迹"), ("metrics", "收敛状态"), ("text", "原稿依据")),
    examples=("f(x)=x^2-4x+1, x0=3", "用牛顿法求 x^4-2x^2+1 的极小点"),
    eval_cases=("newton_unique_min", "newton_nonsmooth_start", "newton_missing_start"),
)

LEAST_SQUARES = TemplateDescriptor(
    template_id="optimization.least_squares_line",
    version="1.0",
    operator_id="optimization.least_squares_line",
    renderer="least_squares",
    title="最小二乘直线拟合",
    categories=("optimization", "table"),
    description="用小型二维数据拟合直线，同时显示斜率、截距、残差与秩；秩不足时不伪称唯一解。",
    aliases=("最小二乘", "least squares", "直线拟合", "线性回归", "残差"),
    keywords=("最小二乘", "拟合", "残差", "数据点"),
    formula_patterns=(r"\(\s*-?\d+(?:\.\d+)?\s*[,;]\s*-?\d+(?:\.\d+)?\s*\)",),
    negative_keywords=("牛顿法", "梯度下降"),
    required_conditions=("xs", "ys"),
    parameter_specs=(
        TemplateParameterSpec(
            name="xs",
            label="x 数据",
            type="number_list",
            required=True,
            source_keys=("xs",),
            description="与 y 数据等长的有限数值数组。",
        ),
        TemplateParameterSpec(
            name="ys",
            label="y 数据",
            type="number_list",
            required=True,
            source_keys=("ys",),
        ),
    ),
    views=(("curve", "散点与拟合直线"), ("table", "残差表"), ("metrics", "斜率与决定系数"), ("text", "原稿依据")),
    examples=("(1,2), (2,3), (3,5), (4,4)",),
    eval_cases=("least_squares_line", "least_squares_rank_deficient", "least_squares_missing_y"),
)


def build_newton(decision: MatchDecision, condition_set: ConditionSet, region: Region, snapshot: SourceSnapshot) -> InteractionOption:
    return make_option(
        descriptor=NEWTON_1D,
        decision=decision,
        condition_set=condition_set,
        region=region,
        snapshot=snapshot,
        provider={"expression": str(decision.parameters.get("expression") or "")},
        purpose="显示目标函数、迭代点、导数/二阶导与停止原因；曲率非正时不继续。",
    )


def build_least_squares(decision: MatchDecision, condition_set: ConditionSet, region: Region, snapshot: SourceSnapshot) -> InteractionOption:
    return make_option(
        descriptor=LEAST_SQUARES,
        decision=decision,
        condition_set=condition_set,
        region=region,
        snapshot=snapshot,
        provider={},
        purpose="拟合直线与残差来自同一组数据；秩不足时报告原因而不是伪造唯一解。",
    )


TEMPLATES = (NEWTON_1D, LEAST_SQUARES)
BUILDERS = {
    "optimization.newton_1d": build_newton,
    "optimization.least_squares_line": build_least_squares,
}

__all__ = ["BUILDERS", "LEAST_SQUARES", "NEWTON_1D", "TEMPLATES"]

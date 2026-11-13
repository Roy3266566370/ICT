"""高数模板：泰勒近似、二重积分。"""

from __future__ import annotations

import sympy as sp

from ...labs.expr import ExprError, parse_expression
from ..recognition_types import ConditionSet, MatchDecision, TemplateDescriptor, TemplateParameterSpec
from ..types import InteractionOption, Region, SourceSnapshot
from .base import make_option


def _taylor_metadata(expression_text: str, x0: float) -> dict[str, object]:
    """给前端提供必须与后端一致的展开元数据；失败时返回 unknown。"""
    try:
        expression = parse_expression(expression_text, ("x",))
        x = sp.Symbol("x", real=True)
        functions = expression.atoms(sp.Function)
        meta: dict[str, object] = {"base_x0": x0}
        if not functions:
            polynomial = sp.Poly(expression, x)
            coefficients = [float(value) for value in reversed(polynomial.all_coeffs())]
            meta.update({"family": "poly", "poly_coefficients": coefficients})
            return meta
        if len(functions) == 1:
            function = next(iter(functions))
            argument = function.args[0]
            if function.func is sp.sin and argument == x:
                meta["family"] = "sin"
                return meta
            if function.func is sp.cos and argument == x:
                meta["family"] = "cos"
                return meta
            if function.func is sp.exp and argument == x:
                meta["family"] = "exp"
                return meta
            if function.func is sp.log and sp.simplify(argument - (1 + x)) == 0:
                meta["family"] = "log1p"
                return meta
        # 未知函数族：只在默认展开点预存系数，前端改变展开点时明确提示。
        series = sp.series(expression, x, x0, 9).removeO()
        polynomial = sp.Poly(series, x - x0)
        coefficients = [float(sp.N(value)) for value in reversed(polynomial.all_coeffs())]
        meta.update({"family": "generic", "coeffs": coefficients, "base_x0": x0})
        return meta
    except (ExprError, ValueError, TypeError, sp.PolynomialError):
        return {"family": "unknown"}

TAYLOR = TemplateDescriptor(
    template_id="calculus.taylor",
    version="1.0",
    operator_id="calculus.taylor",
    renderer="taylor",
    title="泰勒近似",
    categories=("formula",),
    description="把函数在展开点附近写成有限阶泰勒多项式，并同时显示原函数、近似式与误差。",
    aliases=("泰勒", "Taylor", "泰勒展开", "泰勒多项式", "展开近似"),
    keywords=("泰勒", "taylor", "展开点", "阶数", "近似"),
    formula_patterns=(r"f\s*\(\s*x\s*\)\s*=", r"sin|cos|exp|ln"),
    negative_keywords=("二重积分", "定积分", "梯度下降"),
    required_conditions=("expression",),
    parameter_specs=(
        TemplateParameterSpec(
            name="expression",
            label="函数表达式",
            type="string",
            required=True,
            source_keys=("expression",),
            description="支持 sin/cos/exp/ln(1+x) 与低阶多项式。",
        ),
        TemplateParameterSpec(
            name="x0",
            label="展开点 x0",
            type="number",
            required=True,
            default=0.0,
            min=-10,
            max=10,
            step=0.1,
            source_keys=("x0",),
            needs_review_on_default=True,
        ),
        TemplateParameterSpec(
            name="order",
            label="阶数 n",
            type="integer",
            required=True,
            default=5,
            min=0,
            max=8,
            step=1,
            source_keys=("order",),
            needs_review_on_default=True,
        ),
        TemplateParameterSpec(
            name="x_eval",
            label="估计点 x",
            type="number",
            required=False,
            default=0.5,
            min=-10,
            max=10,
            step=0.1,
            source_keys=("x_eval", "x"),
            needs_review_on_default=False,
        ),
    ),
    views=(
        ("curve", "原函数与泰勒多项式"),
        ("metrics", "近似值与误差"),
        ("table", "系数与阶数"),
        ("text", "原稿依据"),
    ),
    examples=("f(x)=sin(x), x0=0, n=5", "用 3 阶泰勒多项式近似 exp(x)"),
    eval_cases=("taylor_sin", "taylor_exp_center1", "taylor_missing_order"),
)

DOUBLE_INTEGRAL = TemplateDescriptor(
    template_id="calculus.double_integral",
    version="1.0",
    operator_id="calculus.double_integral",
    renderer="double_integral",
    title="二重积分网格",
    categories=("formula",),
    description="在矩形区域上做网格累加，并与解析参考值比较；区分数值近似与精确值。",
    aliases=("二重积分", "重积分", "double integral"),
    keywords=("二重积分", "∫∫", "dA", "网格", "矩形区域"),
    formula_patterns=(r"∫∫", r"dA"),
    negative_keywords=("泰勒", "梯度下降"),
    required_conditions=("expression", "ax", "bx", "ay", "by"),
    parameter_specs=(
        TemplateParameterSpec(
            name="expression",
            label="被积函数",
            type="string",
            required=True,
            source_keys=("expression",),
            description="支持多项式与低复杂度初等函数。",
        ),
        TemplateParameterSpec(name="ax", label="x 下限", type="number", required=True, default=None, source_keys=("ax",)),
        TemplateParameterSpec(name="bx", label="x 上限", type="number", required=True, default=None, source_keys=("bx",)),
        TemplateParameterSpec(name="ay", label="y 下限", type="number", required=True, default=None, source_keys=("ay",)),
        TemplateParameterSpec(name="by", label="y 上限", type="number", required=True, default=None, source_keys=("by",)),
        TemplateParameterSpec(name="nx", label="x 网格数", type="integer", required=False, default=20, min=1, max=64, step=1, source_keys=("nx",), needs_review_on_default=False),
        TemplateParameterSpec(name="ny", label="y 网格数", type="integer", required=False, default=20, min=1, max=64, step=1, source_keys=("ny",), needs_review_on_default=False),
    ),
    views=(("table", "网格累加表"), ("metrics", "数值与解析参考"), ("text", "原稿依据")),
    examples=("∫∫_D (x^2+y) dA, 0≤x≤2, 0≤y≤1", "x 从 -1 到 1，y 从 0 到 2"),
    eval_cases=("double_poly_rect", "double_missing_bounds"),
)


def build_taylor(decision: MatchDecision, condition_set: ConditionSet, region: Region, snapshot: SourceSnapshot) -> InteractionOption:
    expression = str(decision.parameters.get("expression") or "")
    x0 = float(decision.parameters.get("x0") or 0.0)
    return make_option(
        descriptor=TAYLOR,
        decision=decision,
        condition_set=condition_set,
        region=region,
        snapshot=snapshot,
        provider={
            "expression": expression,
            "taylor_meta": _taylor_metadata(expression, x0),
        },
        purpose="比较原函数与有限阶泰勒多项式；系数、误差与曲线来自同一组参数。",
    )


def build_double_integral(decision: MatchDecision, condition_set: ConditionSet, region: Region, snapshot: SourceSnapshot) -> InteractionOption:
    return make_option(
        descriptor=DOUBLE_INTEGRAL,
        decision=decision,
        condition_set=condition_set,
        region=region,
        snapshot=snapshot,
        provider={"expression": str(decision.parameters.get("expression") or "")},
        purpose="矩形区域上的网格累加与解析参考值并排显示，避免把近似值说成精确值。",
    )


TEMPLATES = (TAYLOR, DOUBLE_INTEGRAL)
BUILDERS = {
    "calculus.taylor": build_taylor,
    "calculus.double_integral": build_double_integral,
}

__all__ = ["BUILDERS", "DOUBLE_INTEGRAL", "TAYLOR", "TEMPLATES"]

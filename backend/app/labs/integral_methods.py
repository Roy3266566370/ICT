"""积分方法展示：换元与分部积分，只在结果通过求导核验时输出。

这里的方法步骤不是对 SymPy 结果的事后注解：每个方法的原函数都会先对原变量
求导并与被积函数核对，核对不通过就不展示，避免把猜测的“方法”写进解答。
"""
from __future__ import annotations

import math
from typing import Any

import sympy as sp
from sympy.integrals import manualintegrate as _mi

from .expr import to_latex

VERIFICATION_SYMBOLIC = "symbolic"
VERIFICATION_NUMERIC = "numeric"
VERIFICATION_UNCONFIRMED = "unconfirmed"
VERIFICATION_LABELS = {
    VERIFICATION_SYMBOLIC: "符号求导核验通过",
    VERIFICATION_NUMERIC: "数值抽查通过（非全域证明）",
    VERIFICATION_UNCONFIRMED: "尚未确认",
}

_INVERSE_TRIG = (sp.asin, sp.acos, sp.atan, sp.acot, sp.asec, sp.acsc)
_TRIG = (sp.sin, sp.cos, sp.tan, sp.cot, sp.sec, sp.csc)
_UNSUPPORTED = (sp.Abs, sp.Piecewise, sp.Integral, sp.Derivative, sp.sign)
_ELEMENTARY = {
    sp.exp, sp.log, sp.sin, sp.cos, sp.tan, sp.cot, sp.sec, sp.csc,
    sp.asin, sp.acos, sp.atan, sp.acot, sp.asec, sp.acsc,
    sp.sinh, sp.cosh, sp.tanh, sp.Abs,
}
_MAX_INTEGRAND_OPS = 60
_MAX_METHOD_OPS = 120
_SAMPLES = (-3.2, -2.6, -2.1, -1.2, -0.8, -0.4, 0.4, 0.8, 1.1, 1.9, 2.6, 3.0)


def _elementary(expression: sp.Expr) -> bool:
    return all(function.func in _ELEMENTARY for function in expression.atoms(sp.Function))


def _displayable(expression: sp.Expr) -> bool:
    """方法步骤只展示能写成实值初等形式的表达式。"""

    return (
        _elementary(expression)
        and not expression.has(sp.Integral, sp.Derivative, sp.Piecewise, sp.sign)
    )


def _numeric_verifies(antiderivative: sp.Expr, integrand: sp.Expr, variable: sp.Symbol) -> bool:
    """对只差孤立点的对数绝对值写法做保守的数值核对。

    SymPy 往往不能把 sign(x)/Abs(x) 化回 1/x；此时在远离常见瑕点的样本上比较
    中心差商与 f(x)。只在符号核验失败后使用，且要求足够多的样本同时通过。
    """

    step = 1e-5
    valid = 0
    for sample in _SAMPLES:
        try:
            center = complex(sp.N(antiderivative.subs(variable, sample), 15))
            left = complex(sp.N(antiderivative.subs(variable, sample - step), 15))
            right = complex(sp.N(antiderivative.subs(variable, sample + step), 15))
            target = complex(sp.N(integrand.subs(variable, sample), 15))
        except Exception:  # noqa: BLE001
            continue
        if any(abs(value.imag) > 1e-8 for value in (center, left, right, target)):
            continue
        values = (center.real, left.real, right.real, target.real)
        if not all(math.isfinite(value) for value in values):
            continue
        derivative = (right.real - left.real) / (2 * step)
        if abs(derivative - target.real) > 5e-4 * max(1.0, abs(target.real)):
            return False
        valid += 1
    return valid >= 5


def _zero_away_from_isolated_points(expression: sp.Expr, variable: sp.Symbol) -> bool:
    """判断表达式是否只在孤立点/零测集上非零。

    对 log|f(x)| 求导时 SymPy 常返回 Piecewise，把瑕点单独列出；这类分支不影响
    原函数在实定义域各段上的正确性。
    """

    try:
        difference = sp.simplify(expression)
    except Exception:  # noqa: BLE001 - 展示层方法探测不能影响求解
        return False
    if difference == 0:
        return True
    if not isinstance(difference, sp.Piecewise):
        return False
    for value, condition in difference.args:
        if condition is sp.S.true:
            if sp.simplify(value) != 0:
                return False
        elif isinstance(condition, sp.Eq):
            continue
        else:
            return False
    return True


def antiderivative_verification(antiderivative: sp.Expr, integrand: sp.Expr,
                                variable: sp.Symbol) -> dict[str, Any]:
    """区分符号核验、数值抽查和尚未确认，避免把抽样当成全域证明。"""

    # 未求值的 Integral 对 x 求导会机械地还原被积函数，不能算作求出了原函数。
    if antiderivative.has(sp.Integral, sp.Derivative):
        return {"level": VERIFICATION_UNCONFIRMED, "symbolic": False, "numeric": False}
    if _zero_away_from_isolated_points(
            sp.diff(antiderivative, variable) - integrand, variable):
        return {"level": VERIFICATION_SYMBOLIC, "symbolic": True, "numeric": False}
    if _numeric_verifies(antiderivative, integrand, variable):
        return {"level": VERIFICATION_NUMERIC, "symbolic": False, "numeric": True}
    return {"level": VERIFICATION_UNCONFIRMED, "symbolic": False, "numeric": False}


def verifies_antiderivative(antiderivative: sp.Expr, integrand: sp.Expr, variable: sp.Symbol) -> bool:
    return antiderivative_verification(
        antiderivative, integrand, variable)["level"] != VERIFICATION_UNCONFIRMED


def _negative_side_is_real(argument: sp.Expr, integrand: sp.Expr, variable: sp.Symbol) -> bool:
    """判断对数参数取负值时被积函数是否仍为实值。

    1/x 这类被积函数在 x<0 仍为实数，原函数必须用 log|x|；而 log(x) 的
    被积函数在 x<0 已经不是实数，不能擅自把定义域扩到负半轴。
    """

    for sample in _SAMPLES:
        try:
            argument_value = complex(sp.N(argument.subs(variable, sample), 15))
            if abs(argument_value.imag) > 1e-8 or argument_value.real >= 0:
                continue
            value = complex(sp.N(integrand.subs(variable, sample), 15))
        except Exception:  # noqa: BLE001
            continue
        if abs(value.imag) <= 1e-8 and math.isfinite(value.real):
            return True
    return False


def contains_absolute_log(expression: sp.Expr) -> bool:
    """原函数是否含 log|·|；内层积分已改写时外层 real_antiderivative 不再报 changed。"""

    return any(node.args[0].has(sp.Abs) for node in expression.atoms(sp.log))


def real_antiderivative(antiderivative: sp.Expr, integrand: sp.Expr,
                        variable: sp.Symbol) -> tuple[sp.Expr, bool]:
    """把对数参数改写成绝对值，让原函数在实定义域各段上取实值。

    只有求导核验通过时才采用改写；否则保留内核原式，避免为了“更实数”而改变
    数学结果。
    """

    if antiderivative.has(*_UNSUPPORTED):
        return antiderivative, False
    replacements = {}
    for node in antiderivative.atoms(sp.log):
        argument = node.args[0]
        if argument.is_positive is True:
            continue
        if not _negative_side_is_real(argument, integrand, variable):
            continue
        replacements[node] = sp.log(sp.Abs(argument))
    if not replacements:
        return antiderivative, False
    candidate = antiderivative.xreplace(replacements)
    if verifies_antiderivative(candidate, integrand, variable):
        return candidate, True
    return antiderivative, False


def _priority(term: sp.Expr) -> int:
    if term.has(sp.log):
        return 0
    if term.has(*_INVERSE_TRIG):
        return 1
    if not term.has(sp.exp, *_TRIG):
        return 2
    if term.has(*_TRIG):
        return 3
    return 4


def _single_factor_candidate(term: sp.Expr) -> bool:
    return term.has(sp.log) or term.has(*_INVERSE_TRIG)


def _parts_u_allowed(term: sp.Expr, variable: sp.Symbol) -> bool:
    """分部积分的 u 只取对数、反三角或多项式，避免绕远路。"""

    if term.has(sp.log) or term.has(*_INVERSE_TRIG):
        return True
    try:
        return bool(term.is_polynomial(variable))
    except Exception:  # noqa: BLE001
        return False


def _argument_sreprs(integrand: sp.Expr) -> tuple[set[str], set[str]]:
    deep = set()
    direct = set()
    for function in integrand.atoms(sp.Function):
        for argument in function.args:
            direct.add(sp.srepr(argument))
            for node in sp.preorder_traversal(argument):
                if isinstance(node, sp.Expr):
                    deep.add(sp.srepr(node))
    return deep, direct


def _substitution_candidates(integrand: sp.Expr, variable: sp.Symbol):
    deep_keys, direct_keys = _argument_sreprs(integrand)
    candidates = {}
    for node in sp.preorder_traversal(integrand):
        if not isinstance(node, sp.Expr) or node is integrand:
            continue
        if node.free_symbols != {variable} or node == variable:
            continue
        if node.is_number or sp.count_ops(node) > _MAX_INTEGRAND_OPS:
            continue
        # 倒数结构当 u 往往只是把 1/x 反过来，容易引出 Si/Ci 等非初等结果。
        if isinstance(node, sp.Pow) and node.exp.is_negative:
            continue
        # 单独的 x 的幂不做换元；只有当它是某个函数的参数时才值得整体替换。
        if isinstance(node, sp.Pow) and node.base == variable:
            if sp.srepr(node) not in deep_keys:
                continue
        candidates.setdefault(sp.srepr(node), node)
    ordered = sorted(
        candidates.items(),
        key=lambda item: (
            sp.srepr(item[1]) not in direct_keys,
            sp.count_ops(item[1]),
            item[0],
        ),
    )
    return [node for _, node in ordered[:8]]


def _substitution_plan(integrand: sp.Expr, variable: sp.Symbol):
    if integrand.has(*_UNSUPPORTED) or sp.count_ops(integrand) > _MAX_INTEGRAND_OPS:
        return None
    u = sp.Dummy('u', real=True)
    for inner in _substitution_candidates(integrand, variable):
        derivative = sp.diff(inner, variable)
        if derivative == 0:
            continue
        # u=-x、u=x+1 这类平移换元没有展示价值。
        if derivative.is_number and abs(derivative) == 1:
            continue
        try:
            quotient = sp.simplify(integrand / derivative).subs(inner, u)
        except Exception:  # noqa: BLE001
            continue
        if quotient.has(variable, sp.Integral) or not _displayable(quotient):
            continue
        try:
            antiderivative_u = sp.integrate(quotient, u)
        except Exception:  # noqa: BLE001
            continue
        if not _displayable(antiderivative_u):
            continue
        if sp.count_ops(antiderivative_u) > _MAX_METHOD_OPS:
            continue
        antiderivative_u, _ = real_antiderivative(antiderivative_u, quotient, u)
        result = antiderivative_u.subs(u, inner)
        if not _displayable(result) or sp.count_ops(result) > _MAX_METHOD_OPS:
            continue
        result, log_abs = real_antiderivative(result, integrand, variable)
        log_abs = log_abs or contains_absolute_log(result)
        verification = antiderivative_verification(result, integrand, variable)
        if verification["level"] != VERIFICATION_UNCONFIRMED:
            return {
                "kind": "substitution", "inner": inner, "derivative": derivative,
                "quotient": quotient, "antiderivative_u": antiderivative_u, "result": result,
                "log_abs": log_abs, "verification": verification,
            }
    return None


def _parts_plan(integrand: sp.Expr, variable: sp.Symbol):
    if integrand.has(*_UNSUPPORTED) or sp.count_ops(integrand) > _MAX_INTEGRAND_OPS:
        return None
    factors = list(sp.Mul.make_args(integrand)) if isinstance(integrand, sp.Mul) else [integrand]
    if len(factors) == 1:
        if not _single_factor_candidate(factors[0]):
            return None
        choices = [(factors[0], [])]
    else:
        order = sorted(range(len(factors)), key=lambda index: (_priority(factors[index]), index))
        choices = [
            (factors[index], [factor for position, factor in enumerate(factors) if position != index])
            for index in order
            if _priority(factors[index]) <= 2 and _parts_u_allowed(factors[index], variable)
        ]
    for u, dv_factors in choices:
        dv = sp.Mul(*dv_factors) if dv_factors else sp.S.One
        try:
            v = sp.integrate(dv, variable)
        except Exception:  # noqa: BLE001
            continue
        if v.has(sp.Integral) or sp.count_ops(v) > 40 or not _displayable(v):
            continue
        du = sp.diff(u, variable)
        try:
            remainder_expr = sp.simplify(v * du)
        except Exception:  # noqa: BLE001
            continue
        if not _displayable(remainder_expr):
            continue
        try:
            remainder = sp.integrate(remainder_expr, variable)
        except Exception:  # noqa: BLE001
            continue
        if not _displayable(remainder) or sp.count_ops(remainder) > _MAX_METHOD_OPS:
            continue
        result = sp.simplify(u * v - remainder)
        if not _displayable(result) or sp.count_ops(result) > _MAX_METHOD_OPS:
            continue
        result, log_abs = real_antiderivative(result, integrand, variable)
        log_abs = log_abs or contains_absolute_log(result)
        verification = antiderivative_verification(result, integrand, variable)
        if verification["level"] != VERIFICATION_UNCONFIRMED:
            return {
                "kind": "parts", "u": u, "dv": dv, "v": v, "du": du,
                "remainder_expr": remainder_expr, "remainder": remainder, "result": result,
                "log_abs": log_abs, "verification": verification,
            }
    return None


_TRIVIAL_RULES = (
    _mi.ConstantRule,
    _mi.PowerRule,
    _mi.ExpRule,
    _mi.SinRule,
    _mi.CosRule,
    _mi.ReciprocalRule,
)

_MEANINGFUL_RULES = (
    _mi.RewriteRule,
    _mi.URule,
    _mi.PartsRule,
    _mi.CyclicPartsRule,
    _mi.TrigSubstitutionRule,
    _mi.ArctanRule,
    _mi.ReciprocalSqrtQuadraticRule,
    _mi.SqrtQuadraticRule,
)


def _rule_children(rule: Any) -> list[Any]:
    children: list[Any] = []
    substep = getattr(rule, "substep", None)
    if substep is not None:
        children.append(substep)
    for key in ("substeps", "parts_rules", "alternatives"):
        items = getattr(rule, key, None)
        if items:
            children.extend(items)
    for key in ("v_step", "second_step"):
        item = getattr(rule, key, None)
        if item is not None:
            children.append(item)
    return children


def _rule_has_unknown(rule: Any) -> bool:
    if isinstance(rule, _mi.DontKnowRule):
        return True
    if isinstance(rule, _mi.AlternativeRule):
        return not any(not _rule_has_unknown(alt) for alt in (rule.alternatives or ()))
    return any(_rule_has_unknown(child) for child in _rule_children(rule))


def _rule_is_meaningful(rule: Any) -> bool:
    if isinstance(rule, _MEANINGFUL_RULES):
        return True
    if isinstance(rule, _mi.AlternativeRule):
        return any(_rule_is_meaningful(alt) and not _rule_has_unknown(alt) for alt in (rule.alternatives or ()))
    return any(_rule_is_meaningful(child) for child in _rule_children(rule))


def _unwrap_alternative(rule: Any) -> Any:
    if isinstance(rule, _mi.AlternativeRule):
        for alt in rule.alternatives or ():
            if not _rule_has_unknown(alt):
                return _unwrap_alternative(alt)
    return rule


def _collect_manual_steps(rule: Any, steps: list[dict], depth: int = 0) -> None:
    """仿 sympy_gamma/intsteps.py 将 SymPy manualintegrate 规则树翻译为中文教学步骤。"""
    if rule is None or depth > 6 or len(steps) >= 7:
        return
    rule = _unwrap_alternative(rule)
    var = getattr(rule, "variable", None)
    var_tex = to_latex(var) if var is not None else "x"

    if isinstance(rule, _mi.RewriteRule):
        steps.append({
            "id": f"method-manual-rewrite-{len(steps)}",
            "title": "恒等变形 / 部分分式拆解",
            "latex": rf"{to_latex(rule.integrand)} = {to_latex(rule.rewritten)}",
            "detail": "先把被积函数改写为更易积分的等价形式（如部分分式分解或三角降幂/恒等变换）。",
        })
        _collect_manual_steps(rule.substep, steps, depth + 1)
        return

    if isinstance(rule, _mi.CyclicPartsRule):
        parts_desc = []
        for idx, pr in enumerate(rule.parts_rules or (), start=1):
            v_expr = pr.v_step.eval() if getattr(pr, "v_step", None) is not None else None
            if v_expr is not None:
                parts_desc.append(
                    rf"\text{{第 {idx} 次：}}u={to_latex(pr.u)},\ \mathrm{{d}}v={to_latex(pr.dv)}\,\mathrm{{d}}{var_tex},\ v={to_latex(v_expr)}"
                )
        steps.append({
            "id": f"method-manual-cyclic-{len(steps)}",
            "title": "循环分部积分（连续分部并移项求解）",
            "latex": r" \\ ".join(parts_desc) if parts_desc else to_latex(rule.integrand),
            "detail": (
                f"连续进行 {len(rule.parts_rules or ())} 次分部积分后重新出现原积分（系数 {to_latex(rule.coefficient)}），"
                "将原积分移到等号同侧并除以系数即可解出原函数。"
            ),
        })
        return

    if isinstance(rule, _mi.PartsRule):
        v_expr = rule.v_step.eval() if getattr(rule, "v_step", None) is not None else None
        latex = rf"u={to_latex(rule.u)},\quad \mathrm{{d}}v={to_latex(rule.dv)}\,\mathrm{{d}}{var_tex}"
        if v_expr is not None:
            latex += rf",\quad v={to_latex(v_expr)}"
        steps.append({
            "id": f"method-manual-parts-{len(steps)}",
            "title": "分部积分：选择 u 与 dv",
            "latex": latex,
            "detail": "应用分部积分公式 ∫u dv = uv - ∫v du，化简剩余积分。",
        })
        _collect_manual_steps(rule.second_step, steps, depth + 1)
        return

    if isinstance(rule, _mi.URule):
        u_var = rule.u_var
        u_func = rule.u_func
        du = sp.diff(u_func, var) if var is not None else sp.S.One
        steps.append({
            "id": f"method-manual-u-{len(steps)}",
            "title": "换元：引入新变量",
            "latex": rf"u={to_latex(u_func)},\quad \mathrm{{d}}u={to_latex(du)}\,\mathrm{{d}}{var_tex}",
            "detail": f"令新变量替换复合结构 {to_latex(u_func)}，把积分转化为关于新变量的简单积分。",
        })
        if rule.substep is not None and not isinstance(rule.substep, _TRIVIAL_RULES):
            _collect_manual_steps(rule.substep, steps, depth + 1)
        return

    if isinstance(rule, _mi.TrigSubstitutionRule):
        steps.append({
            "id": f"method-manual-trigsub-{len(steps)}",
            "title": "三角换元",
            "latex": rf"{var_tex} = {to_latex(rule.func)}",
            "detail": "被积函数含二次根式结构，采用三角换元消去根号，再按三角函数积分并回代。",
        })
        _collect_manual_steps(rule.substep, steps, depth + 1)
        return

    if isinstance(rule, (_mi.ArctanRule, _mi.ReciprocalSqrtQuadraticRule, _mi.SqrtQuadraticRule)):
        label = (
            "反正切标准型积分" if isinstance(rule, _mi.ArctanRule)
            else "二次根式标准型积分（三角/双曲换元）"
        )
        steps.append({
            "id": f"method-manual-quad-{len(steps)}",
            "title": label,
            "latex": rf"\int {to_latex(rule.integrand)}\,\mathrm{{d}}{var_tex}",
            "detail": "对二次项进行配方或直接套用含二次式/根式二次式的标准积分公式。",
        })
        return

    if isinstance(rule, _mi.ConstantTimesRule):
        _collect_manual_steps(rule.substep, steps, depth + 1)
        return

    if isinstance(rule, _mi.AddRule):
        terms = [to_latex(sub.integrand) for sub in (rule.substeps or ()) if getattr(sub, "integrand", None) is not None]
        if terms:
            steps.append({
                "id": f"method-manual-add-{len(steps)}",
                "title": "按线性性质逐项积分",
                "latex": r" + ".join(rf"\int \left({t}\right)\,\mathrm{{d}}{var_tex}" for t in terms[:5]),
                "detail": "利用积分的线性性质拆分为多个基础项分别求原函数。",
            })
        for sub in rule.substeps or ():
            if not isinstance(sub, _TRIVIAL_RULES):
                _collect_manual_steps(sub, steps, depth + 1)


def _manualintegrate_plan(integrand: sp.Expr, variable: sp.Symbol):
    """使用 SymPy manualintegrate 规则树补充部分分式、三角换元、循环分部等教学步骤。"""
    if integrand.has(*_UNSUPPORTED) or sp.count_ops(integrand) > _MAX_INTEGRAND_OPS:
        return None
    try:
        rule = _mi.integral_steps(integrand, variable)
    except Exception:  # noqa: BLE001
        return None
    if rule is None or isinstance(rule, _TRIVIAL_RULES) or _rule_has_unknown(rule):
        return None
    if not _rule_is_meaningful(rule):
        return None
    try:
        result = sp.simplify(rule.eval())
    except Exception:  # noqa: BLE001
        return None
    if not _displayable(result) or sp.count_ops(result) > _MAX_METHOD_OPS:
        return None
    result, log_abs = real_antiderivative(result, integrand, variable)
    log_abs = log_abs or contains_absolute_log(result)
    verification = antiderivative_verification(result, integrand, variable)
    if verification["level"] == VERIFICATION_UNCONFIRMED:
        return None
    steps: list[dict] = []
    _collect_manual_steps(rule, steps)
    if not steps:
        return None
    return {
        "kind": "manualintegrate",
        "rule": rule,
        "raw_steps": steps,
        "result": result,
        "log_abs": log_abs,
        "verification": verification,
    }


def method_plan(integrand: sp.Expr, variable: sp.Symbol):
    """返回第一个通过求导核验的方法；没有可信方法时返回 None。"""

    try:
        plan = _substitution_plan(integrand, variable)
        if plan is not None:
            return plan
        plan = _parts_plan(integrand, variable)
        if plan is not None:
            return plan
        return _manualintegrate_plan(integrand, variable)
    except Exception:  # noqa: BLE001 - 展示层方法探测不能影响求解
        return None


def _constant_suffix(constant: bool) -> str:
    return "+C" if constant else ""


def _verification_detail(plan: dict, symbolic: str, numeric: str) -> str:
    level = (plan.get("verification") or {}).get("level")
    return symbolic if level == VERIFICATION_SYMBOLIC else numeric


def _substitution_steps(plan: dict, variable: sp.Symbol, constant: bool) -> list[dict]:
    suffix = _constant_suffix(constant)
    inner = to_latex(plan["inner"])
    return [
        {
            "id": "method-substitution",
            "title": "换元：配对复合结构与它的导数",
            "latex": rf"u={inner},\quad \mathrm{{d}}u={to_latex(plan['derivative'])}\,\mathrm{{d}}{to_latex(variable)}",
            "detail": "被积函数同时出现复合结构和它的导数；把复合结构整体设为 u，使积分只保留新变量。",
        },
        {
            "id": "method-substitution-integrate",
            "title": "对 u 积分",
            "latex": rf"\int {to_latex(plan['quotient'])}\,\mathrm{{d}}u={to_latex(plan['antiderivative_u'])}{suffix}",
            "detail": "换元后的被积函数不再含原变量；对 u 积分得到原函数。",
        },
        {
            "id": "method-substitution-back",
            "title": "回代并核对",
            "latex": rf"u={inner}\ \Rightarrow\ {to_latex(plan['result'])}{suffix}",
            "detail": _verification_detail(
                plan,
                "把 u 换回原变量；对结果求导可回到原被积函数，符号核验说明换元有效。",
                "把 u 换回原变量；符号求导未能化简回被积函数，但多个样本点的数值抽查通过；"
                "数值抽查不是全域证明。",
            ),
        },
    ]


def _parts_steps(plan: dict, variable: sp.Symbol, constant: bool) -> list[dict]:
    suffix = _constant_suffix(constant)
    return [
        {
            "id": "method-parts-choose",
            "title": "分部积分：选择 u 与 dv",
            "latex": rf"u={to_latex(plan['u'])},\quad \mathrm{{d}}v={to_latex(plan['dv'])}\,\mathrm{{d}}{to_latex(variable)}",
            "detail": "按对数、反三角、代数、三角、指数的先后顺序选择 u；剩余部分作为 dv，并能直接求出原函数。",
        },
        {
            "id": "method-parts-duv",
            "title": "求 du 与 v",
            "latex": rf"\mathrm{{d}}u={to_latex(plan['du'])}\,\mathrm{{d}}{to_latex(variable)},\quad v={to_latex(plan['v'])}",
            "detail": "对 u 求导得到 du，对 dv 积分得到 v；这里 v 不写积分常数。",
        },
        {
            "id": "method-parts-formula",
            "title": "代入分部积分公式",
            "latex": (
                rf"\int u\,\mathrm{{d}}v=uv-\int v\,\mathrm{{d}}u"
                rf"={to_latex(plan['u'] * plan['v'])}-\int {to_latex(plan['remainder_expr'])}\,\mathrm{{d}}{to_latex(variable)}"
            ),
            "detail": "剩余积分由内核继续计算；若仍是乘积形式，可按同一规则再次分部积分。",
        },
        {
            "id": "method-parts-finish",
            "title": "完成剩余积分",
            "latex": (
                rf"\int v\,\mathrm{{d}}u={to_latex(plan['remainder'])},\quad "
                rf"\int u\,\mathrm{{d}}v={to_latex(plan['result'])}{suffix}"
            ),
            "detail": _verification_detail(
                plan,
                "合并 uv 与剩余积分得到原函数；最终结果已通过符号求导核对。",
                "合并 uv 与剩余积分得到原函数；最终结果只通过数值抽查，不是全域证明。",
            ),
        },
    ]


def _manualintegrate_steps(plan: dict, variable: sp.Symbol, constant: bool) -> list[dict]:
    suffix = _constant_suffix(constant)
    steps = list(plan.get("raw_steps") or [])
    steps.append({
        "id": "method-manual-verify",
        "title": "汇总原函数并核对",
        "latex": rf"F({to_latex(variable)}) = {to_latex(plan['result'])}{suffix}",
        "detail": _verification_detail(
            plan,
            "汇总各步得到原函数；对结果求导可回到原被积函数，符号核验通过。",
            "汇总各步得到原函数；符号求导未能化简回被积函数，但多个样本点的数值抽查通过；"
            "数值抽查不是全域证明。",
        ),
    })
    return steps


def plan_steps(plan: dict | None, variable: sp.Symbol, *, constant: bool) -> list[dict]:
    if plan is None:
        return []
    if plan["kind"] == "substitution":
        return _substitution_steps(plan, variable, constant)
    if plan["kind"] == "manualintegrate":
        return _manualintegrate_steps(plan, variable, constant)
    return _parts_steps(plan, variable, constant)


def method_trace(integrand: sp.Expr, variable: sp.Symbol, *, constant: bool) -> list[dict]:
    """生成经核验的换元或分部积分步骤；无法核验时返回空列表。"""

    return plan_steps(method_plan(integrand, variable), variable, constant=constant)


__all__ = [
    "VERIFICATION_LABELS",
    "VERIFICATION_NUMERIC",
    "VERIFICATION_SYMBOLIC",
    "VERIFICATION_UNCONFIRMED",
    "antiderivative_verification",
    "contains_absolute_log",
    "method_plan",
    "method_trace",
    "plan_steps",
    "real_antiderivative",
    "verifies_antiderivative",
]

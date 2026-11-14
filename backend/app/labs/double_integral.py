"""Double integrals: finite strips, non-polynomial integrands, partitions, swaps and polar."""
from __future__ import annotations

import ast
import math
import re
from typing import Any, Mapping

import sympy as sp
from sympy.calculus.util import continuous_domain, function_range

from .domain_analysis import _missing_components
from .expr import SUPERSCRIPTS, expression_text, normalize_math, parse_expression, safe_float, to_latex

X, Y = sp.symbols('x y', real=True)
THETA = sp.Symbol('theta', real=True)
RADIUS = sp.Symbol('r', nonnegative=True)
MAX_INTEGRAND_OPS = 80


def _expression(raw, variables, limit=40):
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError('缺少完整的被积函数或区域边界')
    value = parse_expression(raw, variables or ('x',))
    if not variables and value.free_symbols:
        raise ValueError('外层积分区间必须是已知常数')
    if sp.count_ops(value) > limit:
        raise ValueError('表达式超过当前二重积分计算范围')
    return value.xreplace({v: sp.Rational(str(v)) for v in value.atoms(sp.Float)})


def _pair(raw, label):
    if not isinstance(raw, list) or len(raw) != 2:
        raise ValueError(f'{label}必须由两个字符串组成')
    return raw[0], raw[1]


def _strip_constants(outer_bounds):
    a_raw, b_raw = _pair(outer_bounds, '外层积分区间')
    a, b = _expression(a_raw, ()), _expression(b_raw, ())
    if safe_float(a) is None or safe_float(b) is None or not bool(a < b):
        raise ValueError('外层积分区间必须是从小到大的有限实数')
    if max(abs(float(a)), abs(float(b))) > 1e6:
        raise ValueError('积分区域超过当前交互画布的坐标范围（±10^6）')
    return a, b


def _boundary_syntax(raw):
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError('缺少完整的被积函数或区域边界')
    try:
        return ast.parse(normalize_math(raw), mode='eval')
    except SyntaxError as exc:
        raise ValueError('请使用显式乘号及完整的数学表达式') from exc


def _depends_on(node, names):
    return any(isinstance(n, ast.Name) and n.id in names for n in ast.walk(node))


def _validate_curve_domain(curve, t, domain, label):
    allowed=(sp.sin,sp.cos,sp.tan,sp.exp,sp.log,sp.asin,sp.acos,sp.atan)
    if any(node.func not in allowed for node in curve.atoms(sp.Function)) or any(p.exp.is_Rational is not True or abs(p.exp) > 6 for p in curve.atoms(sp.Pow)):
        raise ValueError(f'{label}暂仅支持可核验的代数与常见初等函数')
    for node in curve.atoms(sp.sin,sp.cos,sp.tan):
        argument=function_range(node.args[0],t,domain)
        width=safe_float(argument.sup-argument.inf)
        if width is None or width>16*math.pi:
            raise ValueError('周期边界跨度过长，请分片输入较短区间后再核验')
    if domain.is_subset(continuous_domain(curve, t, sp.S.Reals)) is not True:
        raise ValueError(f'{label}在积分区间内不连续或不是有限实数')
    span = function_range(curve, t, domain)
    if any(safe_float(v) is None or abs(float(v)) > 1e6 for v in (span.inf, span.sup)):
        raise ValueError(f'{label}超过当前交互画布的坐标范围（±10^6）')


def _quantifier_check(inequality, t, domain, message):
    if inequality is True or inequality is sp.true:
        raise ValueError(message)
    if inequality is False or inequality is sp.false:
        return
    if not isinstance(inequality, sp.Rel):
        raise ValueError(message)
    if (inequality.lhs-inequality.rhs).has(sp.Function):
        # solve_univariate_inequality may return only one period; range is over the actual interval.
        try:
            span=function_range(inequality.lhs-inequality.rhs,t,domain)
            if inequality.rel_op=='<' and span.inf.is_nonnegative is True:return
            if inequality.rel_op=='>' and span.sup.is_nonpositive is True:return
            proved_invalid=(inequality.rel_op=='<' and span.inf.is_negative is True) or (inequality.rel_op=='>' and span.sup.is_positive is True)
        except (NotImplementedError,ValueError,TypeError) as exc:
            raise ValueError('尚不能确认整个区间内的边界关系，请核对区域') from exc
        raise ValueError(message if proved_invalid else '尚不能确认整个区间内的边界关系，请核对区域')
    try:
        invalid = sp.solve_univariate_inequality(inequality, t, relational=False)
    except NotImplementedError as exc:
        raise ValueError('尚不能确认整个区间内的边界关系，请核对区域') from exc
    if sp.Intersection(domain, invalid) is not sp.S.EmptySet:
        raise ValueError(message)


def _validate_strip(outer: str, outer_bounds, inner_bounds):
    t, s = (X, Y) if outer == 'x' else (Y, X)
    a, b = _strip_constants(outer_bounds)
    domain = sp.Interval(a, b)
    curves = _pair(inner_bounds, '内层区域上下边界')
    for raw in curves:
        for node in ast.walk(_boundary_syntax(raw)):
            base, power = None, None
            if isinstance(node, ast.Call) and _depends_on(node, ('x', 'y')):
                if not isinstance(node.func, ast.Name) or node.func.id not in ('sqrt','sin','cos','tan','exp','log','ln','asin','acos','atan','arcsin','arccos','arctan') or len(node.args) != 1:
                    raise ValueError('区域边界暂仅支持可核验的代数与常见初等函数')
                original=_expression(ast.unparse(node),(outer,))
                if domain.is_subset(continuous_domain(original,t,sp.S.Reals)) is not True:
                    raise ValueError('原始边界函数在整个区间内不连续或无实定义')
                if node.func.id=='sqrt':base, power = _expression(ast.unparse(node.args[0]), (outer,)), sp.Rational(1, 2)
            if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Pow) and _depends_on(node.left, ('x', 'y')):
                base, power = _expression(ast.unparse(node.left), (outer,)), _expression(ast.unparse(node.right), ())
            if base is not None and power is not None:
                if power.is_Rational is not True or abs(power) > 6:
                    raise ValueError('区域边界的变量幂超过当前范围')
                if not power.is_integer:
                    _quantifier_check(base < 0, t, domain, '原始边界表达式在区间内存在非实数定义域')
                if power < 0 and sp.solveset(base, t, domain=domain) is not sp.S.EmptySet:
                    raise ValueError('原始边界在区间内存在零分母')
            if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div) and _depends_on(node.right, ('x', 'y')):
                denominator = _expression(ast.unparse(node.right), (outer,))
                if sp.solveset(denominator, t, domain=domain) is not sp.S.EmptySet:
                    raise ValueError('原始边界在区间内存在零分母')
    lo, hi = [_expression(raw, (outer,)) for raw in curves]
    _validate_curve_domain(lo, t, domain, '内层下边界')
    _validate_curve_domain(hi, t, domain, '内层上边界')
    _quantifier_check(hi - lo < 0, t, domain, '内层上边界低于下边界，请核对区域或分片')
    return a, b, lo, hi


def _missing_conflict(expression: sp.Expr, variable: sp.Symbol, interval: sp.Interval) -> str | None:
    try:
        domain = continuous_domain(expression, variable, interval)
        missing = interval - domain
    except Exception:  # noqa: BLE001
        return '无法确认原式在该方向上的实定义域'
    if missing is sp.S.EmptySet:
        return None
    points, gap, complete = _missing_components(missing, variable)
    if gap:
        return '被积函数在积分区域内存在一段无定义区间'
    if not complete:
        return '无法确认被积函数在积分区域内的实定义域是否完整'
    for point in points:
        if sp.simplify(point - interval.start) != 0 and sp.simplify(point - interval.end) != 0:
            return f'被积函数在区域内部点 {point} 处不在原式定义域'
    return None


def _sample_points(a: sp.Expr, b: sp.Expr) -> list[sp.Expr]:
    return [sp.simplify(a + (b - a) * sp.Rational(index * 2 + 1, 18)) for index in range(9)]


def _numeric_value_at(expression: sp.Expr, substitutions: dict) -> complex | None:
    try:
        return complex(sp.N(expression.subs(substitutions), 15))
    except Exception:  # noqa: BLE001
        return None


def _raw_domain_conflict(raw: Any, outer: str, a: sp.Expr, b: sp.Expr, lo: sp.Expr, hi: sp.Expr) -> str | None:
    """Check original syntax before SymPy can cancel denominators or square roots."""
    try:
        tree = ast.parse(normalize_math(str(raw)), mode='eval')
    except SyntaxError as exc:
        raise ValueError('请使用显式乘号及完整的数学表达式') from exc
    t, s = (X, Y) if outer == 'x' else (Y, X)
    outer_values = _sample_points(a, b)
    pairs: list[tuple[sp.Expr, sp.Expr]] = []
    for outer_value in outer_values:
        low = sp.simplify(lo.subs(t, outer_value))
        high = sp.simplify(hi.subs(t, outer_value))
        if sp.simplify(high - low) == 0:
            continue
        for inner_value in _sample_points(low, high):
            pairs.append((outer_value, inner_value))
        numeric_low, numeric_high, numeric_outer = safe_float(low), safe_float(high), safe_float(outer_value)
        if numeric_low is not None and numeric_high is not None and numeric_outer is not None and numeric_low < numeric_outer < numeric_high:
            pairs.append((outer_value, outer_value))
    for node in ast.walk(tree):
        checked: sp.Expr | None = None
        reason = ''
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div) and _depends_on(node.right, ('x', 'y')):
            checked = _expression(ast.unparse(node.right), ('x', 'y'))
            reason = '被积函数在区域内部存在零分母'
        elif isinstance(node, ast.BinOp) and isinstance(node.op, ast.Pow) and _depends_on(node.left, ('x', 'y')):
            exponent = _expression(ast.unparse(node.right), ())
            checked = _expression(ast.unparse(node.left), ('x', 'y'))
            if exponent.is_negative is True:
                reason = '被积函数在区域内部存在零分母'
            elif exponent.is_integer is not True:
                reason = '被积函数的变量幂在区域内部可能不是实值'
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.args:
            if not _depends_on(node.args[0], ('x', 'y')):
                continue
            checked = _expression(ast.unparse(node.args[0]), ('x', 'y'))
            if node.func.id == 'sqrt':
                reason = '原始被积函数中的平方根在区域内部可能不是实值'
            elif node.func.id in ('log', 'ln'):
                reason = '原始被积函数中的对数在区域内部可能无定义'
        if checked is None:
            continue
        for outer_value, inner_value in pairs:
            value = _numeric_value_at(checked, {t: outer_value, s: inner_value})
            if value is None:
                continue
            if '零分母' in reason and abs(value) < 1e-12:
                return reason
            if '平方根' in reason and value.real < -1e-12:
                return reason
            if '对数' in reason and abs(value) < 1e-12:
                return reason
    return None


def _strip_domain_conflict(f: sp.Expr, outer: str, a: sp.Expr, b: sp.Expr, lo: sp.Expr, hi: sp.Expr) -> str | None:
    t, s = (X, Y) if outer == 'x' else (Y, X)
    outer_interval = sp.Interval(a, b)
    for index in range(1, 8):
        q = sp.simplify(a + (b - a) * sp.Rational(index, 8))
        low, high = sp.simplify(lo.subs(t, q)), sp.simplify(hi.subs(t, q))
        if sp.simplify(high - low) == 0:
            continue
        reason = _missing_conflict(f.subs(t, q), s, sp.Interval(low, high))
        if reason:
            return reason
    inner_samples: set[sp.Expr] = set()
    for index in range(5):
        q = sp.simplify(a + (b - a) * sp.Rational(index + 1, 6))
        low, high = sp.simplify(lo.subs(t, q)), sp.simplify(hi.subs(t, q))
        for value in (low, high, sp.simplify((low + high) / 2)):
            if safe_float(value) is not None:
                inner_samples.add(value)
    for value in inner_samples:
        reason = _missing_conflict(f.subs(s, value), t, outer_interval)
        if reason:
            return reason
    return None


def _numeric_2d(f, t, s, a, b, lo, hi) -> float | None:
    try:
        import mpmath as mp
        numeric_f = sp.lambdify((t, s), f, 'mpmath')
        numeric_lo, numeric_hi = sp.lambdify(t, lo, 'mpmath'), sp.lambdify(t, hi, 'mpmath')
        with mp.workdps(20):
            value = mp.quad(
                lambda q: mp.quad(lambda v: numeric_f(q, v), [numeric_lo(q), numeric_hi(q)]),
                [mp.mpf(str(sp.N(a, 25))), mp.mpf(str(sp.N(b, 25)))],
            )
        result = float(value)
        return result if math.isfinite(result) else None
    except Exception:  # noqa: BLE001
        try:
            return safe_float(sp.N(sp.Integral(f, (s, lo, hi), (t, a, b)), 15))
        except Exception:  # noqa: BLE001
            return None


def _integrate_strip(f, outer, a, b, lo, hi):
    t, s = (X, Y) if outer == 'x' else (Y, X)
    reason = _strip_domain_conflict(f, outer, a, b, lo, hi)
    if reason:
        raise ValueError(reason)
    inner_value = sp.simplify(sp.integrate(f, (s, lo, hi)))
    if inner_value.has(sp.Integral):
        raise ValueError('内层积分未得到闭式结果，当前不能作为已完成的二重积分')
    exact = sp.simplify(sp.integrate(inner_value, (t, a, b)))
    if exact.has(sp.Integral) or safe_float(exact) is None:
        raise ValueError('二重积分未得到有限实数结果，请核对区域和被积函数（含奇点）')
    numeric = _numeric_2d(f, t, s, a, b, lo, hi)
    if numeric is None:
        raise ValueError('无法完成独立数值复核，不能判为通过')
    if abs(numeric - float(exact)) > 1e-6 * max(1, abs(float(exact))):
        raise ValueError('解析积分与独立数值积分不一致，不能判为通过')
    return inner_value, exact, numeric


def _monotone_direction(expression, t, a, b):
    derivative = sp.simplify(sp.diff(expression, t))
    if derivative == 0:
        return 0
    if derivative.has(sp.Function):
        try:
            span=function_range(derivative,t,sp.Interval.open(a,b))
            if span.inf.is_nonnegative is True:return 1
            if span.sup.is_nonpositive is True:return -1
        except (NotImplementedError,ValueError,TypeError):pass
        return None
    try:
        positive = sp.solve_univariate_inequality(derivative >= 0, t, relational=False)
        negative = sp.solve_univariate_inequality(derivative <= 0, t, relational=False)
    except NotImplementedError:
        return None
    # The boundary itself is continuous at endpoints; its derivative may have a vertical tangent there.
    domain = sp.Interval.open(a, b)
    if domain.is_subset(positive) is True:
        return 1
    if domain.is_subset(negative) is True:
        return -1
    return None


def _inverse_expression(expression, new_outer, t, a, b):
    try:
        solutions = sp.solve(sp.Eq(expression, new_outer), t)
    except Exception:  # noqa: BLE001
        return None
    candidates = [
        sp.simplify(solution) for solution in solutions
        if solution.free_symbols <= {new_outer} and solution.is_real is not False
    ]
    test=sp.simplify((expression.subs(t,a)+expression.subs(t,b))/2)
    if expression.func in (sp.sin,sp.cos) and expression.args[0].is_polynomial(t) and sp.degree(expression.args[0],t)==1:
        period=2*sp.pi/abs(sp.diff(expression.args[0],t))
        periodic=[]
        for candidate in candidates:
            value=safe_float(candidate.subs(new_outer,test))
            if value is None:continue
            shift=round(float(((a+b)/2-value)/period))
            periodic.extend(candidate+index*period for index in range(shift-2,shift+3))
        candidates=periodic
    if len(candidates) == 1:
        return candidates[0]
    numeric_a, numeric_b = safe_float(a), safe_float(b)
    if numeric_a is None or numeric_b is None:
        return None
    valid = []
    for candidate in candidates:
        numeric = safe_float(candidate.subs(new_outer, test))
        if numeric is not None and numeric_a - 1e-9 <= numeric <= numeric_b + 1e-9:
            valid.append(candidate)
    return sp.simplify(valid[0]) if len(valid) == 1 else None


def _derive_monotone_swap(f, outer, a, b, lo, hi):
    t, s = (X, Y) if outer == 'x' else (Y, X)
    new_outer = s
    lo_const, hi_const = not lo.has(t), not hi.has(t)
    lo_dir = 0 if lo_const else _monotone_direction(lo, t, a, b)
    hi_dir = 0 if hi_const else _monotone_direction(hi, t, a, b)
    new_a = new_b = new_lo = new_hi = None
    if lo_const and hi_const:
        new_a, new_b = sp.simplify(lo), sp.simplify(hi)
        new_lo, new_hi = a, b
    elif lo_const and hi_dir in (1, -1):
        inverse = _inverse_expression(hi, new_outer, t, a, b)
        if inverse is None:
            return None
        new_a = sp.simplify(lo)
        if hi_dir == 1:
            new_b, new_lo, new_hi = sp.simplify(hi.subs(t, b)), inverse, b
        else:
            new_b, new_lo, new_hi = sp.simplify(hi.subs(t, a)), a, inverse
    elif hi_const and lo_dir in (1, -1):
        inverse = _inverse_expression(lo, new_outer, t, a, b)
        if inverse is None:
            return None
        new_b = sp.simplify(hi)
        if lo_dir == 1:
            new_a, new_lo, new_hi = sp.simplify(lo.subs(t, a)), a, inverse
        else:
            new_a, new_lo, new_hi = sp.simplify(lo.subs(t, b)), inverse, b
    elif lo_dir == hi_dir == 1:
        inverse_lo = _inverse_expression(lo, new_outer, t, a, b)
        inverse_hi = _inverse_expression(hi, new_outer, t, a, b)
        if inverse_lo is None or inverse_hi is None:
            return None
        new_a, new_b = sp.simplify(lo.subs(t, a)), sp.simplify(hi.subs(t, b))
        new_lo, new_hi = inverse_hi, inverse_lo
    elif lo_dir == hi_dir == -1:
        inverse_lo = _inverse_expression(lo, new_outer, t, a, b)
        inverse_hi = _inverse_expression(hi, new_outer, t, a, b)
        if inverse_lo is None or inverse_hi is None:
            return None
        new_a, new_b = sp.simplify(lo.subs(t, b)), sp.simplify(hi.subs(t, a))
        new_lo, new_hi = inverse_lo, inverse_hi
    if any(value is None for value in (new_a, new_b, new_lo, new_hi)):
        return None
    try:
        new_a, new_b = sp.simplify(new_a), sp.simplify(new_b)
        if safe_float(new_a) is None or safe_float(new_b) is None or not bool(new_a < new_b):
            return None
        new_domain = sp.Interval(new_a, new_b)
        _validate_curve_domain(new_lo, new_outer, new_domain, '换序后的内层下边界')
        _validate_curve_domain(new_hi, new_outer, new_domain, '换序后的内层上边界')
        _quantifier_check(new_hi - new_lo < 0, new_outer, new_domain, '换序后内层上边界低于下边界')
        _quantifier_check(new_lo < a,new_outer,new_domain,'换序下界超出原区域')
        _quantifier_check(new_hi > b,new_outer,new_domain,'换序上界超出原区域')
        lower_peak=lo.subs(t,new_hi if lo_dir==1 else new_lo)
        upper_floor=hi.subs(t,new_lo if hi_dir==1 else new_hi)
        if new_a.is_nonnegative is True or new_b.is_nonpositive is True:
            sign=sp.Q.nonnegative(new_outer) if new_a.is_nonnegative is True else sp.Q.nonpositive(new_outer)
            lower_peak=sp.refine(lower_peak,sign)
            upper_floor=sp.refine(upper_floor,sign)
        _quantifier_check(lower_peak > new_outer,new_outer,new_domain,'换序区域越过原下边界')
        _quantifier_check(upper_floor < new_outer,new_outer,new_domain,'换序区域越过原上边界')
        if sp.simplify(sp.integrate(hi-lo,(t,a,b))-sp.integrate(new_hi-new_lo,(new_outer,new_a,new_b)))!=0:
            return None
        swapped_inner, swapped_exact, _ = _integrate_strip(f, s.name, new_a, new_b, new_lo, new_hi)
    except (ValueError, TypeError, NotImplementedError, sp.PolynomialError):
        return None
    return {
        'outer_variable': s.name,
        'inner_variable': t.name,
        'outer_bounds': [expression_text(new_a), expression_text(new_b)],
        'inner_bounds': [expression_text(new_lo), expression_text(new_hi)],
        'inner_bounds_tex': [to_latex(new_lo), to_latex(new_hi)],
        'inner_integral': expression_text(swapped_inner),
        'exact': expression_text(swapped_exact),
        'answer_value': float(swapped_exact),
        'numeric_verified': True,
        'region_verified': True,
        'formula_tex': (
            rf'\int_{{{to_latex(new_a)}}}^{{{to_latex(new_b)}}}'
            rf'\int_{{{to_latex(new_lo)}}}^{{{to_latex(new_hi)}}}{to_latex(f)}'
            rf'\,d{t.name}\,d{s.name}'
        ),
    }


def _derive_swap(f, outer, a, b, lo, hi):
    from .order_swap import quadratic_swap
    try:
        derived=quadratic_swap(f,outer,a,b,lo,hi)
        if derived is not None:
            return derived
        monotone=_derive_monotone_swap(f,outer,a,b,lo,hi)
        if monotone is not None:return monotone
        from .order_swap_general import general_swap
        return general_swap(f,outer,a,b,lo,hi)
    except (ValueError,TypeError,NotImplementedError,ArithmeticError,sp.PolynomialError):
        return None


def _verify_swap_value(swapped, exact):
    records=swapped if isinstance(swapped,list) else [swapped]
    total=sum(sp.sympify(part['exact'],locals={'e':sp.E}) for part in records)
    if sp.simplify(total-exact)!=0:
        raise ValueError('换序前后的精确值不一致，不能判定等价')


def _swap_step(swapped, index=None):
    return {
        'id': 'swap' if index is None else f'swap_{index}',
        'title': '交换积分次序' if index is None else f'换序后的第 {index} 段',
        'latex': swapped['formula_tex'],
        'detail': f"换序后：{swapped['outer_variable']}∈[{swapped['outer_bounds'][0]},{swapped['outer_bounds'][1]}]，"
                  f"{swapped['inner_variable']} 从 {swapped['inner_bounds'][0]} 到 {swapped['inner_bounds'][1]}；区域边界与覆盖已核验，各段分别积分，全部分段之和与原积分精确值一致，并通过独立数值复核。",
    }


def _compile_single_strip(plan, f):
    outer = plan.get('outer_variable', 'x')
    if outer not in ('x', 'y'):
        raise ValueError('积分外层变量必须是 x 或 y')
    inner = 'y' if outer == 'x' else 'x'
    a, b, lo, hi = _validate_strip(outer, plan.get('outer_bounds'), plan.get('inner_bounds'))
    raw_conflict = _raw_domain_conflict(plan.get('integrand'), outer, a, b, lo, hi)
    if raw_conflict:
        raise ValueError(raw_conflict)
    inner_value, exact, numeric = _integrate_strip(f, outer, a, b, lo, hi)
    swapped = None
    if plan.get('swap_order'):
        swapped = _derive_swap(f, outer, a, b, lo, hi)
        if swapped is None:
            raise ValueError('当前区域不能完成可验证换序，请按原区域手动分片或保留原次序')
        _verify_swap_value(swapped,exact)
    formula = (
        rf'\int_{{{to_latex(a)}}}^{{{to_latex(b)}}}'
        rf'\int_{{{to_latex(lo)}}}^{{{to_latex(hi)}}}{to_latex(f)}\,d{inner}\,d{outer}'
    )
    return dict(
        engine='double_integral_v1', subject='calculus', task='double_integral', kind='integral',
        region_kind='strip', expression=expression_text(f), integrand=expression_text(f),
        outer_variable=outer, inner_variable=inner,
        outer_bounds=[expression_text(a), expression_text(b)],
        inner_bounds=[expression_text(lo), expression_text(hi)],
        inner_bounds_tex=[to_latex(lo), to_latex(hi)],
        inner_integral=expression_text(inner_value), exact=expression_text(exact),
        inner_integral_tex=to_latex(inner_value), exact_latex=to_latex(exact),
        answer_value=float(exact), numeric_value=numeric, formula_tex=formula, teaching=False,
        swap_order=bool(plan.get('swap_order')), swapped=swapped,
        defaults={'slice': float((a + b) / 2), 'n': 20},
        params=[
            dict(id='slice', label=f'切片位置 {outer}', kind='number', min=float(a), max=float(b),
                 step=float(b - a) / 100, options=[]),
            dict(id='n', label='积分分割数', kind='integer', min=4, max=80, step=1, options=[]),
        ],
    )


def _compile_pieces(plan, f):
    outer = plan.get('outer_variable', 'x')
    if outer not in ('x', 'y'):
        raise ValueError('积分外层变量必须是 x 或 y')
    raw_pieces = plan.get('pieces')
    if not isinstance(raw_pieces, list) or not 1 <= len(raw_pieces) <= 20:
        raise ValueError('分片区域需要 1 至 20 个有限子区域')
    pieces = []
    for raw in raw_pieces:
        if not isinstance(raw, Mapping) or set(raw) != {'outer_bounds', 'inner_bounds'}:
            raise ValueError('每个分片只能包含 outer_bounds 和 inner_bounds')
        a, b, lo, hi = _validate_strip(outer, raw['outer_bounds'], raw['inner_bounds'])
        raw_conflict = _raw_domain_conflict(plan.get('integrand'), outer, a, b, lo, hi)
        if raw_conflict:
            raise ValueError(raw_conflict)
        inner_value, exact, numeric = _integrate_strip(f, outer, a, b, lo, hi)
        pieces.append(dict(a=a, b=b, lo=lo, hi=hi, inner_value=inner_value, exact=exact, numeric=numeric))
    pieces.sort(key=lambda item: float(item['a']))
    for first, second in zip(pieces, pieces[1:]):
        if float(first['b']) > float(second['a']) + 1e-9:
            raise ValueError('分片区域的外层区间不能重叠；请按不重不漏的方式拆分')
    total = sp.simplify(sum(item['exact'] for item in pieces))
    numeric_total = sum(item['numeric'] for item in pieces)
    if safe_float(total) is None or abs(numeric_total - float(total)) > 1e-6 * max(1, abs(float(total))):
        raise ValueError('分片积分之和与独立数值复核不一致')
    swapped = None
    if plan.get('swap_order'):
        swapped = []
        for item in pieces:
            derived = _derive_swap(f, outer, item['a'], item['b'], item['lo'], item['hi'])
            if derived is None:
                raise ValueError('至少一个分片不能自动换序，不能把部分换序冒充完整结果')
            _verify_swap_value(derived,item['exact'])
            swapped.extend(derived if isinstance(derived,list) else [derived])
    inner = 'y' if outer == 'x' else 'x'
    formula = r'\sum_{i=1}^{N}' + rf'\int_{{a_i}}^{{b_i}}\int_{{lo_i}}^{{hi_i}}{to_latex(f)}\,d{inner}\,d{outer}'
    model_pieces = []
    for index, item in enumerate(pieces):
        piece_formula = (
            rf"\int_{{{to_latex(item['a'])}}}^{{{to_latex(item['b'])}}}"
            rf"\int_{{{to_latex(item['lo'])}}}^{{{to_latex(item['hi'])}}}{to_latex(f)}\,d{inner}\,d{outer}"
        )
        model_pieces.append({
            'index': index + 1,
            'outer_bounds': [expression_text(item['a']), expression_text(item['b'])],
            'inner_bounds': [expression_text(item['lo']), expression_text(item['hi'])],
            'inner_bounds_tex': [to_latex(item['lo']), to_latex(item['hi'])],
            'inner_integral': expression_text(item['inner_value']),
            'exact': expression_text(item['exact']),
            'answer_value': float(item['exact']),
            'numeric_value': item['numeric'],
            'formula_tex': piece_formula,
        })
    first_a, last_b = float(pieces[0]['a']), float(pieces[-1]['b'])
    return dict(
        engine='double_integral_v1', subject='calculus', task='double_integral', kind='integral',
        region_kind='pieces', expression=expression_text(f), integrand=expression_text(f),
        outer_variable=outer, inner_variable=inner, pieces=model_pieces, swapped=swapped,
        outer_bounds=[expression_text(pieces[0]['a']), expression_text(pieces[-1]['b'])],
        inner_bounds=model_pieces[0]['inner_bounds'] if len(model_pieces) == 1 else ['', ''],
        exact=expression_text(total), answer_value=float(total), numeric_value=numeric_total,
        formula_tex=formula, teaching=False, swap_order=bool(plan.get('swap_order')),
        defaults={'slice': (first_a + last_b) / 2, 'n': 20},
        params=[
            dict(id='slice', label=f'切片位置 {outer}', kind='number', min=first_a, max=last_b,
                 step=max((last_b - first_a) / 100, 0.01), options=[]),
            dict(id='n', label='每片积分分割数', kind='integer', min=4, max=80, step=1, options=[]),
        ],
    )


def _validate_polar_curve(curve, theta_domain, label):
    try:
        if theta_domain.is_subset(continuous_domain(curve, THETA, sp.S.Reals)) is not True:
            raise ValueError(f'{label}在极角区间内不连续或不是有限实数')
        span = function_range(curve, THETA, theta_domain)
    except (NotImplementedError, ValueError) as exc:
        raise ValueError(f'{label}无法在极角区间内确认有限范围') from exc
    if any(safe_float(v) is None or abs(float(v)) > 1e6 for v in (span.inf, span.sup)):
        raise ValueError(f'{label}超过当前交互画布的坐标范围（±10^6）')


def _polar_domain_conflict(g, theta_a, theta_b, rlo, rhi):
    theta_interval = sp.Interval(theta_a, theta_b)
    for index in range(1, 7):
        q = sp.simplify(theta_a + (theta_b - theta_a) * sp.Rational(index, 7))
        low, high = sp.simplify(rlo.subs(THETA, q)), sp.simplify(rhi.subs(THETA, q))
        if sp.simplify(high - low) == 0:
            continue
        reason = _missing_conflict(g.subs(THETA, q), RADIUS, sp.Interval(low, high))
        if reason:
            return reason
    for index in range(1, 5):
        q = sp.simplify(theta_a + (theta_b - theta_a) * sp.Rational(index, 5))
        value = sp.simplify((rlo.subs(THETA, q) + rhi.subs(THETA, q)) / 2)
        if safe_float(value) is None:
            continue
        reason = _missing_conflict(g.subs(RADIUS, value), THETA, theta_interval)
        if reason:
            return reason
    return None


def _compile_polar(plan, f):
    if plan.get('swap_order'):
        raise ValueError('极坐标区域不适用直角坐标换序')
    polar = plan.get('polar')
    if not isinstance(polar, Mapping) or set(polar) != {'theta_bounds', 'r_bounds'}:
        raise ValueError('极坐标区域必须包含 theta_bounds 和 r_bounds')
    theta_a_raw, theta_b_raw = _pair(polar['theta_bounds'], '极角区间')
    theta_a, theta_b = _expression(theta_a_raw, ()), _expression(theta_b_raw, ())
    if safe_float(theta_a) is None or safe_float(theta_b) is None or not bool(theta_a < theta_b):
        raise ValueError('极角区间必须是从小到大的有限实数')
    rlo_raw, rhi_raw = _pair(polar['r_bounds'], '径向上下界')
    rlo, rhi = _expression(rlo_raw, ('theta',)), _expression(rhi_raw, ('theta',))
    theta_domain = sp.Interval(theta_a, theta_b)
    _validate_polar_curve(rlo, theta_domain, '极径下界')
    _validate_polar_curve(rhi, theta_domain, '极径上界')
    _quantifier_check(rlo < 0, THETA, theta_domain, '极径不能为负')
    _quantifier_check(rhi - rlo < 0, THETA, theta_domain, '极径上界不能低于下界')
    transformed = sp.simplify(f.subs({X: RADIUS * sp.cos(THETA), Y: RADIUS * sp.sin(THETA)}) * RADIUS)
    reason = _polar_domain_conflict(transformed, theta_a, theta_b, rlo, rhi)
    if reason:
        raise ValueError(reason)
    inner_value = sp.simplify(sp.integrate(transformed, (RADIUS, rlo, rhi)))
    if inner_value.has(sp.Integral):
        raise ValueError('极坐标内层积分未得到闭式结果，当前不能作为已完成的二重积分')
    exact = sp.simplify(sp.integrate(inner_value, (THETA, theta_a, theta_b)))
    if exact.has(sp.Integral) or safe_float(exact) is None:
        raise ValueError('极坐标二重积分未得到有限实数结果')
    try:
        import mpmath as mp
        numeric_f = sp.lambdify((RADIUS, THETA), transformed, 'mpmath')
        numeric_lo, numeric_hi = sp.lambdify(THETA, rlo, 'mpmath'), sp.lambdify(THETA, rhi, 'mpmath')
        with mp.workdps(20):
            numeric = float(mp.quad(
                lambda q: mp.quad(lambda v: numeric_f(v, q), [numeric_lo(q), numeric_hi(q)]),
                [mp.mpf(str(sp.N(theta_a, 25))), mp.mpf(str(sp.N(theta_b, 25)))],
            ))
    except Exception:  # noqa: BLE001
        numeric = None
    if numeric is None or not math.isfinite(numeric) or abs(numeric - float(exact)) > 1e-6 * max(1, abs(float(exact))):
        raise ValueError('极坐标解析积分与独立数值复核不一致，不能判为通过')
    formula = (
        rf'\int_{{{to_latex(theta_a)}}}^{{{to_latex(theta_b)}}}'
        rf'\int_{{{to_latex(rlo)}}}^{{{to_latex(rhi)}}}{to_latex(transformed)}'
        rf'\,dr\,d\theta'
    )
    return dict(
        engine='double_integral_v1', subject='calculus', task='double_integral', kind='integral',
        region_kind='polar', expression=expression_text(f), integrand=expression_text(f),
        outer_variable='theta', inner_variable='r',
        polar={
            'theta_bounds': [expression_text(theta_a), expression_text(theta_b)],
            'r_bounds': [expression_text(rlo), expression_text(rhi)],
            'r_bounds_tex': [to_latex(rlo), to_latex(rhi)],
            'jacobian': 'r',
            'transformed_integrand': expression_text(transformed),
            'inner_integral': expression_text(inner_value),
            'exact': expression_text(exact),
            'answer_value': float(exact),
            'numeric_value': numeric,
        },
        exact=expression_text(exact), answer_value=float(exact), numeric_value=numeric,
        formula_tex=formula, teaching=False,
        defaults={'theta': float((theta_a + theta_b) / 2), 'n': 20},
        params=[
            dict(id='theta', label='切片极角 θ', kind='number', min=float(theta_a), max=float(theta_b),
                 step=float(theta_b - theta_a) / 100, options=[]),
            dict(id='n', label='积分分割数', kind='integer', min=4, max=80, step=1, options=[]),
        ],
    )


def compile_model(plan: Mapping[str, Any]) -> dict:
    """Validate declarative bounds before deriving any result or plot."""
    if not isinstance(plan, Mapping):
        raise ValueError('二重积分模型格式不正确')
    f = _expression(plan.get('integrand'), ('x', 'y'), limit=MAX_INTEGRAND_OPS)
    if 'polar' in plan and 'pieces' in plan:
        raise ValueError('极坐标与分片区域不能同时使用')
    if 'polar' in plan:
        if any(key in plan for key in ('outer_variable', 'outer_bounds', 'inner_bounds')):
            raise ValueError('极坐标模式不能混用直角坐标积分限')
        if plan.get('swap_order'):
            raise ValueError('极坐标区域不适用直角坐标换序')
        return _compile_polar(plan, f)
    if 'pieces' in plan:
        if 'outer_bounds' in plan or 'inner_bounds' in plan:
            raise ValueError('分片模式不能混用单片积分限')
        return _compile_pieces(plan, f)
    return _compile_single_strip(plan, f)


def _polar_from_region_text(region_text: str) -> dict[str, Any] | None:
    normalized = region_text.replace('≤', '<=').replace('≥', '>=').replace('−', '-')
    normalized = normalized.replace('**', '^').replace(' ', '')
    annulus = re.fullmatch(r'([^<>=]+)<=x\^2\+y\^2<=([^<>=]+)', normalized)
    if annulus:
        inner = _expression(annulus.group(1), ())
        outer = _expression(annulus.group(2), ())
        if safe_float(inner) is None or safe_float(outer) is None or float(inner) < 0 or not bool(inner < outer):
            return None
        return {
            'theta_bounds': ['0', '2*pi'],
            'r_bounds': [expression_text(sp.sqrt(inner)), expression_text(sp.sqrt(outer))],
        }
    full = re.match(r'x\^2\+y\^2<=([^,]+)', normalized)
    if not full:
        return None
    radius_squared = _expression(full.group(1), ())
    if safe_float(radius_squared) is None or safe_float(radius_squared) <= 0:
        return None
    sector = normalized[full.end():]
    theta_low, theta_high = '0', '2*pi'
    if 'x>=0' in sector and 'y>=0' in sector:
        theta_low, theta_high = '0', 'pi/2'
    elif 'x>=0' in sector:
        theta_low, theta_high = '-pi/2', 'pi/2'
    elif 'y>=0' in sector:
        theta_low, theta_high = '0', 'pi'
    return {'theta_bounds': [theta_low, theta_high], 'r_bounds': ['0', expression_text(sp.sqrt(radius_squared))]}


def build_double_integral(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    if not re.search(r'二重积分|∬|\\iint|double\s+integral', text, re.I):
        return None
    from .exam_math import _condition, _ambiguity
    raw = text.replace('−', '-').replace('≤', '<=').replace('≥', '>=')
    raw = re.sub(r'[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+', lambda m:'^('+m.group().translate(SUPERSCRIPTS)+')', raw)
    raw = re.sub(r'\\(?:leq|le)\b', '<=', raw)
    raw = re.sub(r'\\(?:geq|ge)\b', '>=', raw)
    raw = raw.replace('\\left','').replace('\\right','').replace('\\{','{').replace('\\}','}')
    raw = re.sub(r'\^\s*\{([^{}]+)\}',r'^(\1)',raw)
    raw = raw.replace('\\iint', '∬').replace('\\,', '').replace('\\;', '')
    plan = dict(overrides.get('condition_values') or {})
    plan.update({k:v for k,v in overrides.items() if k in (
        'integrand','outer_variable','outer_bounds','inner_bounds','pieces','polar','swap_order')})
    start = r'∬\s*(?:_\s*\{?D\}?)?' if '∬' in raw else r'二重积分\s*[:：]?'
    match = re.search(start+r'\s*(.*?)\s*d\s*[xy]\s*d\s*[xy]', raw, re.S)
    if match:
        plan.setdefault('integrand', match.group(1).strip())
    # Only extract inequalities inside D, so unrelated conditions are never discarded.
    region = re.search(r'D\s*=\s*\{(.*?)\}', raw, re.S)
    region_text = region.group(1).split('|')[-1] if region else ''
    if 'polar' not in plan and 'pieces' not in plan and region_text:
        polar = _polar_from_region_text(region_text)
        if polar:
            plan['polar'] = polar
            for key in ('outer_bounds', 'inner_bounds', 'outer_variable'):
                plan.pop(key, None)
    parts = [v.strip() for v in re.split(r'[,，;；]', region_text) if v.strip()]
    if 'polar' not in plan and 'pieces' not in plan:
        for outer, inner in (('x','y'), ('y','x')):
            outer_part = next((p.split('<=') for p in parts if re.fullmatch(r'[^<>=]+<=\s*'+outer+r'\s*<=[^<>=]+', p)), None)
            inner_part = next((p.split('<=') for p in parts if re.fullmatch(r'[^<>=]+<=\s*'+inner+r'\s*<=[^<>=]+', p)), None)
            if outer_part and inner_part and len(parts) == 2:
                plan.setdefault('outer_variable', outer)
                plan.setdefault('outer_bounds', [outer_part[0].strip(), outer_part[2].strip()])
                plan.setdefault('inner_bounds', [inner_part[0].strip(), inner_part[2].strip()])
                break
    # Both even powers force x,y >= 0. Intersections then bound the entire region by 0 and 1.
    if 'polar' not in plan and 'pieces' not in plan and len(parts) == 2 and 'inner_bounds' not in plan:
        powers = {}
        for part in parts:
            sides = part.split('<=')
            if len(sides) != 2 or sides[1].strip() not in ('x','y'):
                break
            try:
                rhs = sides[1].strip()
                other = Y if rhs == 'x' else X
                lhs = _expression(sides[0].strip(), ('x','y'))
                if lhs.base != other or lhs.exp not in (2,4,6):
                    break
                powers[rhs] = int(lhs.exp)
            except (ValueError, AttributeError):
                break
        if set(powers) == {'x','y'}:
            plan.update(outer_variable='x', outer_bounds=['0','1'],
                        inner_bounds=[f'x^{powers["y"]}', f'x^(1/{powers["x"]})'])
    model = dict(
        engine='double_integral_v1', subject='calculus', task='double_integral',
        defaults={}, params=[], teaching=False,
        **{k:v for k,v in plan.items() if k in (
            'integrand','outer_variable','outer_bounds','inner_bounds','pieces','polar','swap_order')},
    )
    conditions, ambiguities = [], []
    try:
        outside = raw[:region.start()]+raw[region.end():] if region else raw
        if re.search(r'[<>≤≥]',outside):
            raise ValueError('区域外还有约束条件，需要一起核对，不能忽略后计算')
        model = compile_model(plan)
    except (ValueError, TypeError, NotImplementedError, ArithmeticError, sp.PolynomialError) as exc:
        ambiguities.append(_ambiguity('double_integral', str(exc)))
    labels = {
        'integrand':'被积函数', 'outer_variable':'外层积分变量',
        'outer_bounds':'外层积分区间', 'inner_bounds':'内层区域上下边界',
        'pieces':'分片区域', 'polar':'极坐标区域', 'swap_order':'换序要求',
    }
    for key, label in labels.items():
        if key in model:
            conditions.append(_condition(key, label, model[key], source,
                                         kind='json' if isinstance(model[key], (list, dict)) else 'expression'))
    return dict(model=model, conditions=conditions, ambiguities=ambiguities,
                formulas=[dict(id='double_integral',tex=model.get('formula_tex',''),plain=model.get('integrand',''),role='二重积分模型')],
                recognized=not ambiguities)


def _refresh_legacy_swap(model):
    saved=model.get('swapped')
    records=saved if isinstance(saved,list) else [saved] if saved else []
    if not records or all(part.get('region_verified') is True for part in records):
        return model
    plan=dict(integrand=model['integrand'],outer_variable=model['outer_variable'],swap_order=True)
    if model.get('region_kind')=='pieces':
        plan['pieces']=[dict(outer_bounds=part['outer_bounds'],inner_bounds=part['inner_bounds']) for part in model['pieces']]
    else:
        plan.update(outer_bounds=model['outer_bounds'],inner_bounds=model['inner_bounds'])
    fresh=compile_model(plan)
    return {**model,'swapped':fresh['swapped']}


def solve_double_integral(model: Mapping) -> dict:
    model=_refresh_legacy_swap(model)
    if 'exact' not in model:
        raise ValueError('请先核对二重积分的被积函数和区域边界')
    kind = model.get('region_kind', 'strip')
    if kind == 'pieces':
        pieces = model.get('pieces') or []
        steps = [dict(id='region', title='确认分片区域', detail='各分片的外层区间互不重叠，逐片积分后求和。')]
        for piece in pieces:
            steps.append(dict(
                id=f"piece_{piece['index']}", title=f"第 {piece['index']} 片",
                detail=f"{piece['outer_bounds'][0]} ≤ {model['outer_variable']} ≤ {piece['outer_bounds'][1]}；"
                       f"{piece['inner_bounds'][0]} ≤ {model['inner_variable']} ≤ {piece['inner_bounds'][1]}；结果 {piece['exact']}。",
                latex=piece.get('formula_tex', ''),
            ))
        steps.append(dict(id='sum', title='分片求和', detail=f"总和为 {model['exact']}。"))
        summary = '按不重不漏的分片区域分别积分，再求和。'
    elif kind == 'polar':
        polar = model.get('polar') or {}
        theta = polar.get('theta_bounds', ['', ''])
        radius = polar.get('r_bounds', ['', ''])
        steps = [
            dict(id='region', title='确定极坐标区域', latex=model.get('formula_tex', ''),
                 detail=f"θ∈[{theta[0]}, {theta[1]}]；r∈[{radius[0]}, {radius[1]}]。"),
            dict(id='jacobian', title='代入 x=r cosθ, y=r sinθ 与 Jacobian',
                 latex=r'x=r\cos\theta,\quad y=r\sin\theta,\quad dA=r\,dr\,d\theta',
                 detail=f"变换后被积函数为 {polar.get('transformed_integrand', '')}，包含雅可比因子 r。"),
            dict(id='evaluate', title='计算极坐标累次积分', detail=f"内层积分 {polar.get('inner_integral', '')}，结果为 {model['exact']}。"),
        ]
        summary = '极坐标变换：先确定 θ、r 范围，再乘 Jacobian r 积分。'
    else:
        steps = [
            dict(id='region', title='确定积分区域',
                 detail=f"{model['outer_bounds'][0]} ≤ {model['outer_variable']} ≤ {model['outer_bounds'][1]}；"
                        f"{model['inner_bounds'][0]} ≤ {model['inner_variable']} ≤ {model['inner_bounds'][1]}。边界和阴影共同表示区域 D。"),
            dict(id='slice', title='沿区域取切片',
                 detail=f'固定 {model["outer_variable"]}，{model["inner_variable"]} 从下边界到上边界。',
                 latex=model['formula_tex']),
            dict(id='inner', title='计算内层积分', detail=f'对 {model["inner_variable"]} 积分后得到 {model["inner_integral"]}。'),
            dict(id='evaluate', title='计算外层积分', detail=f'结果为 {model["exact"]}。'),
        ]
        summary = '从原题区域确定积分限，先对内层变量积分，再对外层变量累加。'
    if model.get('swapped'):
        swapped = model['swapped']
        if isinstance(swapped, list):
            steps.extend(_swap_step(item,index+1) for index,item in enumerate(swapped))
        else:
            steps.append(_swap_step(swapped))
    return dict(summary=summary, answer=model['exact'], exact=model['exact'], answer_value=model['answer_value'],
                steps=steps,
                conditions=['积分限来自原题或 AI 提取的区域，请结合原题核对。'],
                limitations=[
                    '区域边界仍限低阶代数函数；非多项式被积函数会先检查原式定义域与内部奇点。',
                    '分片要求各分片外层区间互不重叠；极坐标模式使用 x,y 被积函数并自动乘 Jacobian r。',
                ])


def evaluate_double_integral(model: Mapping, params: Mapping) -> dict:
    model=_refresh_legacy_swap(model)
    kind = model.get('region_kind', 'strip')
    if kind == 'pieces':
        return _evaluate_pieces(model, params)
    if kind == 'polar':
        return _evaluate_polar(model, params)
    return _evaluate_strip(model, params)


def _evaluate_strip(model: Mapping, params: Mapping) -> dict:
    solution = solve_double_integral(model)
    outer, inner = model['outer_variable'], model['inner_variable']
    t, s = (X, Y) if outer == 'x' else (Y, X)
    a, b = [float(_expression(v, ())) for v in model['outer_bounds']]
    lo, hi = [sp.lambdify(t, _expression(v, (outer,)), 'math') for v in model['inner_bounds']]
    f = sp.lambdify((X, Y), _expression(model['integrand'], ('x', 'y')), 'math')
    n = max(4, min(80, int(params.get('n', 20))))
    position = max(a, min(b, float(params.get('slice', (a + b) / 2))))
    if not math.isfinite(position):
        raise ValueError('切片位置必须是有限实数')
    approx = 0.0
    for i in range(n):
        q = a + (i + 0.5) * (b - a) / n
        l, h = float(lo(q)), float(hi(q))
        for j in range(n):
            v = l + (j + 0.5) * (h - l) / n
            approx += float(f(q, v) if outer == 'x' else f(v, q)) * (h - l) * (b - a) / n ** 2
    region = [dict(outer=a + i * (b - a) / 120, lower=float(lo(a + i * (b - a) / 120)),
                   upper=float(hi(a + i * (b - a) / 120))) for i in range(121)]
    exact = model['answer_value']
    result = dict(subject='calculus', task='double_integral', kind='integral', region_kind='strip',
                  headline=f'二重积分 = {model["exact"]}', answer=solution['answer'], answerText=solution['answer'],
                  domain={'x_min': a, 'x_max': b}, series=[], rects=[], exact=exact, approx=approx,
                  error=abs(approx - exact), region=region, outer_variable=outer, inner_variable=inner,
                  slice={'position': position, 'lower': float(lo(position)), 'upper': float(hi(position))},
                  metrics=[dict(id='exact', label='内核解析值', value=model['exact']),
                           dict(id='approx', label='二维中点和', value=f'{approx:.8g}'),
                           dict(id='error', label='近似误差', value=f'{abs(approx - exact):.3g}')],
                  checks=[dict(id='region', label='有限区域与边界顺序', status='pass', detail='内核已检查整个积分区间内的边界连续性及上下顺序'),
                          dict(id='numerical_quadrature', label='独立数值积分复核', status='pass', detail='原被积函数的数值积分与解析结果在相对容差1e-6内一致')],
                  notes=solution['limitations'],
                  trace=[dict(index=i, label=f'切片 {outer}={a + i * (b - a) / 40:.4g}', detail=f'固定 {outer}，从下边界扫到上边界。',
                              values={'slice': a + i * (b - a) / 40}) for i in range(41)])
    if model.get('swapped'):
        result['swapped'] = model['swapped']
        result['notes'] = [*result['notes'], '换序结果也通过独立数值复核。']
    return result


def _evaluate_pieces(model: Mapping, params: Mapping) -> dict:
    solution = solve_double_integral(model)
    outer, inner = model['outer_variable'], model['inner_variable']
    t, s = (X, Y) if outer == 'x' else (Y, X)
    f = sp.lambdify((X, Y), _expression(model['integrand'], ('x', 'y')), 'math')
    n = max(4, min(80, int(params.get('n', 20))))
    total_exact = model['answer_value']
    approx = 0.0
    output_pieces = []
    regions = []
    for piece in model['pieces']:
        a, b = [float(_expression(v, ())) for v in piece['outer_bounds']]
        lo, hi = [sp.lambdify(t, _expression(v, (outer,)), 'math') for v in piece['inner_bounds']]
        piece_approx = 0.0
        for i in range(n):
            q = a + (i + 0.5) * (b - a) / n
            l, h = float(lo(q)), float(hi(q))
            for j in range(n):
                v = l + (j + 0.5) * (h - l) / n
                piece_approx += float(f(q, v) if outer == 'x' else f(v, q)) * (h - l) * (b - a) / n ** 2
        approx += piece_approx
        region = [dict(outer=a + i * (b - a) / 80, lower=float(lo(a + i * (b - a) / 80)),
                       upper=float(hi(a + i * (b - a) / 80))) for i in range(81)]
        regions.append(region)
        output_pieces.append({**piece, 'region': region, 'approx': piece_approx})
    first_a = float(_expression(model['pieces'][0]['outer_bounds'][0], ()))
    last_b = float(_expression(model['pieces'][-1]['outer_bounds'][1], ()))
    position = max(first_a, min(last_b, float(params.get('slice', (first_a + last_b) / 2))))
    active = None
    for piece in model['pieces']:
        a, b = [float(_expression(v, ())) for v in piece['outer_bounds']]
        if a - 1e-9 <= position <= b + 1e-9:
            active = (piece, a, b)
            break
    if active is None:
        active = (model['pieces'][0], first_a,
                  float(_expression(model['pieces'][0]['outer_bounds'][1], ())))
    piece, a, b = active
    lo, hi = [sp.lambdify(t, _expression(v, (outer,)), 'math') for v in piece['inner_bounds']]
    lower, upper = float(lo(position)), float(hi(position))
    slice_values = []
    for i in range(25):
        v = lower + (upper - lower) * i / 24
        slice_values.append({'position': v, 'value': float(f(position, v) if outer == 'x' else f(v, position))})
    return dict(
        subject='calculus', task='double_integral', kind='integral', region_kind='pieces',
        headline=f'分片二重积分 = {model["exact"]}', answer=solution['answer'], answerText=solution['answer'],
        domain={'x_min': first_a, 'x_max': last_b}, series=[], rects=[], exact=total_exact, approx=approx,
        error=abs(approx - total_exact), region=regions[0], pieces=output_pieces,
        outer_variable=outer, inner_variable=inner,
        slice={'position': position, 'lower': lower, 'upper': upper}, sliceValues=slice_values,
        metrics=[dict(id='exact', label='内核解析值', value=model['exact']),
                 dict(id='approx', label='分片二维中点和', value=f'{approx:.8g}'),
                 dict(id='error', label='近似误差', value=f'{abs(approx - total_exact):.3g}'),
                 dict(id='pieces', label='分片数', value=str(len(model['pieces'])))],
        checks=[dict(id='region', label='分片不重不漏', status='pass', detail='各分片外层区间互不重叠，逐片边界顺序已检查'),
                dict(id='numerical_quadrature', label='独立数值积分复核', status='pass', detail='分片解析和与独立二重数值积分在相对容差1e-6内一致')],
        notes=solution['limitations'],
        trace=[dict(index=i, label=f'第 {item["index"]} 片', detail=f'切片 {outer}={position:.4g}', values={'slice': position})
               for i, item in enumerate(model['pieces'])],
    )


def _evaluate_polar(model: Mapping, params: Mapping) -> dict:
    solution = solve_double_integral(model)
    polar = model['polar']
    a, b = [float(_expression(v, ())) for v in polar['theta_bounds']]
    lo, hi = [sp.lambdify(THETA, _expression(v, ('theta',)), 'math') for v in polar['r_bounds']]
    transformed = _expression(polar['transformed_integrand'], ('theta', 'r'))
    g = sp.lambdify((RADIUS, THETA), transformed, 'math')
    n = max(4, min(80, int(params.get('n', 20))))
    position = max(a, min(b, float(params.get('theta', (a + b) / 2))))
    approx = 0.0
    for i in range(n):
        theta = a + (i + 0.5) * (b - a) / n
        low, high = float(lo(theta)), float(hi(theta))
        for j in range(n):
            radius = low + (j + 0.5) * (high - low) / n
            approx += float(g(radius, theta)) * (high - low) * (b - a) / n ** 2
    outer_points, inner_points = [], []
    for i in range(121):
        theta = a + (b - a) * i / 120
        low, high = float(lo(theta)), float(hi(theta))
        outer_points.append({'x': high * math.cos(theta), 'y': high * math.sin(theta)})
        inner_points.append({'x': low * math.cos(theta), 'y': low * math.sin(theta)})
    low, high = float(lo(position)), float(hi(position))
    slice_values = []
    for i in range(25):
        radius = low + (high - low) * i / 24
        slice_values.append({'position': radius, 'value': float(g(radius, position))})
    exact = model['answer_value']
    return dict(
        subject='calculus', task='double_integral', kind='integral', region_kind='polar',
        headline=f'极坐标二重积分 = {model["exact"]}', answer=solution['answer'], answerText=solution['answer'],
        domain={'x_min': min(p['x'] for p in outer_points), 'x_max': max(p['x'] for p in outer_points)},
        series=[], rects=[], exact=exact, approx=approx, error=abs(approx - exact),
        region=[], polar={**polar, 'outer_points': outer_points, 'inner_points': inner_points,
                          'slice': {'theta': position, 'r_lower': low, 'r_upper': high}},
        outer_variable='theta', inner_variable='r',
        slice={'position': position, 'lower': low, 'upper': high}, sliceValues=slice_values,
        metrics=[dict(id='exact', label='内核解析值', value=model['exact']),
                 dict(id='approx', label='极坐标二维中点和', value=f'{approx:.8g}'),
                 dict(id='error', label='近似误差', value=f'{abs(approx - exact):.3g}'),
                 dict(id='jacobian', label='Jacobian', value='r')],
        checks=[dict(id='region', label='极坐标区域与方向', status='pass', detail='θ 递增、r 非负且上界不低于下界'),
                dict(id='jacobian', label='Jacobian 因子', status='pass', detail='极坐标面积元为 r dr dθ'),
                dict(id='numerical_quadrature', label='独立数值积分复核', status='pass', detail='解析结果与独立极坐标数值积分在相对容差1e-6内一致')],
        notes=solution['limitations'],
        trace=[dict(index=i, label=f'θ={a + (b - a) * i / 40:.4g}', detail='固定 θ，沿 r 从下界扫到上界。',
                    values={'theta': a + (b - a) * i / 40}) for i in range(41)],
    )

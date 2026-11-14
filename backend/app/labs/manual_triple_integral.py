"""User-confirmed triple integral regions with rigorous real-domain checks."""
from __future__ import annotations

import math

import sympy as sp
from sympy.calculus.util import continuous_domain, function_range

from .expr import expression_text, parse_expression, safe_float, to_latex
from .double_integral import _integrate_outer

X, Y, Z = sp.symbols('x y z', real=True)
THETA = sp.Symbol('theta', real=True)
PHI = sp.Symbol('phi', real=True)
RADIAL = sp.Symbol('r', real=True)
RHO = sp.Symbol('rho', real=True)
UNIT = sp.Symbol('_s', real=True)
MODES = ('box', 'z_simple', 'cylindrical', 'spherical')
FIELDS = {
    'box': ('integrand', 'region_mode', 'x_lower', 'x_upper', 'y_lower', 'y_upper', 'z_lower', 'z_upper'),
    'z_simple': ('integrand', 'region_mode', 'x_lower', 'x_upper', 'y_lower', 'y_upper', 'z_lower', 'z_upper'),
    'cylindrical': ('integrand', 'region_mode', 'theta_lower', 'theta_upper', 'radius_lower', 'radius_upper', 'z_lower', 'z_upper'),
    'spherical': ('integrand', 'region_mode', 'theta_lower', 'theta_upper', 'phi_lower', 'phi_upper', 'rho_lower', 'rho_upper'),
}
NOTE = ('支持长方体、z型区域以及柱坐标/球坐标区域；柱坐标固定先z后r再theta，球坐标固定先rho后phi再theta。'
        '被积函数在完整区域上的连续实定义须有全域证明，抽样通过不代替证明。')
CONTINUOUS_FAILURE = ('尚未确认原被积函数在整个三维区域上连续实定义；抽样通过不能代替全域核验，'
                      '当前不输出积分答案')


def _expr(raw, variables, label, limit=60):
    if not isinstance(raw, str) or not raw.strip() or len(raw) > 600:
        raise ValueError(f'{label}必须是600字以内的表达式')
    # 保留书写结构，避免 sqrt(x)^2 在解析阶段就被化简为 x 而丢失原式定义域。
    value = parse_expression(raw, variables or ('x',), preserve_structure=True)
    if not variables and value.free_symbols:
        raise ValueError(f'{label}必须是已知常数')
    if sp.count_ops(value) > limit:
        raise ValueError(f'{label}超出当前三重积分计算范围')
    return value.xreplace({node: sp.Rational(str(node)) for node in value.atoms(sp.Float)})


def _constant(raw, label):
    value = _expr(raw, (), label, limit=40)
    numeric = safe_float(value)
    if numeric is None or abs(numeric) > 1e6:
        raise ValueError(f'{label}必须是±10^6范围内的有限实数')
    return value


def _constant_interval(c, low_key, high_key, label):
    a, b = _constant(c[low_key], f'{label}下限'), _constant(c[high_key], f'{label}上限')
    if not bool(a < b):
        raise ValueError(f'{label}必须从小到大')
    return a, b


def _interval_add(left, right):
    return sp.Interval(left.inf + right.inf, left.sup + right.sup)


def _interval_mul(left, right):
    products = (left.inf * right.inf, left.inf * right.sup, left.sup * right.inf, left.sup * right.sup)
    return sp.Interval(min(products), max(products))


def _interval_pow(part, exponent):
    if exponent == 0:
        return sp.Interval(1, 1)
    if exponent > 0:
        if exponent % 2 == 0:
            if part.inf.is_nonnegative is True:
                return sp.Interval(part.inf ** exponent, part.sup ** exponent)
            if part.sup.is_nonpositive is True:
                return sp.Interval(part.sup ** exponent, part.inf ** exponent)
            return sp.Interval(0, max(part.inf ** exponent, part.sup ** exponent))
        return sp.Interval(part.inf ** exponent, part.sup ** exponent)
    if part.inf.is_positive is True or part.sup.is_negative is True:
        reciprocal = sp.Interval(1 / part.sup, 1 / part.inf)
        return _interval_pow(reciprocal, -exponent)
    return None


def _interval_value(expression, box):
    """Rigorous containing interval; None means this simple evaluator cannot prove one."""
    if expression.is_Number:
        return sp.Interval(expression, expression) if expression.is_real is not False else None
    if expression.is_Symbol:
        return box.get(expression)
    if expression.is_Add:
        total = sp.Interval(0, 0)
        for argument in expression.args:
            part = _interval_value(argument, box)
            if part is None:
                return None
            total = _interval_add(total, part)
        return total
    if expression.is_Mul:
        total = sp.Interval(1, 1)
        for argument in expression.args:
            part = _interval_value(argument, box)
            if part is None:
                return None
            total = _interval_mul(total, part)
        return total
    if isinstance(expression, sp.Pow):
        base, exponent = expression.args
        part = _interval_value(base, box)
        if part is None:
            return None
        if exponent.is_integer:
            return _interval_pow(part, int(exponent))
        if exponent.is_Rational and exponent.is_positive is True and part.inf.is_nonnegative is True:
            try:
                return sp.Interval(sp.Pow(part.inf, exponent), sp.Pow(part.sup, exponent))
            except (ValueError, TypeError):
                return None
        return None
    if expression.func in (sp.exp, sp.atan, sp.sinh, sp.tanh):
        part = _interval_value(expression.args[0], box)
        if part is None or part.inf.is_finite is not True:
            return None
        return sp.Interval(expression.func(part.inf), expression.func(part.sup))
    if expression.func == sp.log:
        part = _interval_value(expression.args[0], box)
        if part is None or part.inf.is_positive is not True:
            return None
        return sp.Interval(sp.log(part.inf), sp.log(part.sup))
    if expression.func == sp.Abs:
        part = _interval_value(expression.args[0], box)
        if part is None:
            return None
        if part.inf.is_nonnegative is True:
            return part
        if part.sup.is_nonpositive is True:
            return sp.Interval(-part.sup, -part.inf)
        return sp.Interval(0, sp.Max(-part.inf, part.sup))
    if expression.func in (sp.sin, sp.cos):
        return sp.Interval(-1, 1) if _interval_value(expression.args[0], box) is not None else None
    if expression.func == sp.cosh:
        part = _interval_value(expression.args[0], box)
        if part is None:
            return None
        if part.inf.is_nonnegative is True:
            return sp.Interval(sp.cosh(part.inf), sp.cosh(part.sup))
        if part.sup.is_nonpositive is True:
            return sp.Interval(sp.cosh(part.sup), sp.cosh(part.inf))
        return sp.Interval(1, sp.Max(sp.cosh(part.inf), sp.cosh(part.sup)))
    return None


def _estimate_range(expression, box, label):
    interval = None
    symbols = expression.free_symbols
    if len(symbols) == 1:
        symbol = next(iter(symbols))
        domain = box.get(symbol)
        if domain is not None:
            try:
                span = function_range(expression, symbol, domain)
            except (ValueError, TypeError, NotImplementedError):
                span = None
            if isinstance(span, sp.Interval) and span.inf.is_finite is True and span.sup.is_finite is True:
                interval = span
    if interval is None:
        interval = _interval_value(expression, box)
    if interval is not None and interval.inf.is_finite is True and interval.sup.is_finite is True:
        return interval
    raise ValueError(f'当前无法确认{label}在区域内的有限范围，请改写为可核验边界')


def _prove_nonnegative(expression, box):
    expression = sp.simplify(expression)
    if expression.is_zero is True or expression.is_nonnegative is True:
        return True
    if expression.is_negative is True:
        return False
    symbols = expression.free_symbols
    if not symbols:
        return expression.is_nonnegative is True
    if len(symbols) == 1:
        symbol = next(iter(symbols))
        interval = box.get(symbol)
        if interval is not None:
            try:
                span = function_range(expression, symbol, interval)
            except (ValueError, TypeError, NotImplementedError):
                span = None
            if isinstance(span, sp.Interval) and span.inf.is_nonnegative is True:
                return True
    interval = _interval_value(expression, box)
    if interval is not None and interval.inf.is_nonnegative is True:
        return True
    if not all(symbol in box for symbol in symbols) or not expression.is_polynomial(*symbols):
        return False
    try:
        poly = sp.Poly(expression, *symbols)
    except (sp.PolynomialError, TypeError):
        return False
    if poly.total_degree() > 8 or len(poly.terms()) > 120:
        return False
    parameters = sp.symbols(f'_u0:{len(symbols)}', real=True)
    substitutions = {symbol: box[symbol].start + (box[symbol].end - box[symbol].start) * parameter
                     for symbol, parameter in zip(symbols, parameters)}
    expanded = sp.Poly(expression.subs(substitutions, simultaneous=True).expand(), *parameters)
    degrees = [max(0, expanded.degree(parameter)) for parameter in parameters]
    from itertools import product
    for index in product(*(range(degree + 1) for degree in degrees)):
        coefficient = 0
        for powers, value in expanded.terms():
            term = value
            for i, k, degree in zip(index, powers, degrees):
                term *= sp.binomial(i, k) / sp.binomial(degree, k)
            coefficient += term
        if sp.simplify(coefficient).is_nonnegative is not True:
            return False
    return True


def _prove_order(low, high, box, label):
    difference = sp.simplify(high - low)
    if difference.is_zero is True:
        return
    try:
        proven = _prove_nonnegative(difference, box)
    except (ValueError, TypeError, NotImplementedError, sp.PolynomialError):
        proven = False
    if not proven:
        raise ValueError(f'尚不能确认{label}在整个区域上满足下界不高于上界，请改写为可核验边界或分片')


def _prove_order_on_curve(low, high, parameter, low_curve, high_curve, parameter_box, label):
    """Prove an order on the actual curved region by mapping the parameter to [0,1]."""
    substituted = sp.simplify((high - low).subs(
        parameter, low_curve + (high_curve - low_curve) * UNIT, simultaneous=True))
    if substituted.is_zero is True:
        return
    try:
        proven = _prove_nonnegative(substituted, {**parameter_box, UNIT: sp.Interval(0, 1)})
    except (ValueError, TypeError, NotImplementedError, sp.PolynomialError):
        proven = False
    if not proven:
        raise ValueError(f'尚不能确认{label}在整个区域上满足下界不高于上界，请改写为可核验边界或分片')


def _real_on_box(expression, box):
    """Sufficient continuity proof on a box containing the region; sampling is not a proof."""
    try:
        for node in sp.preorder_traversal(expression):
            names = node.free_symbols
            if not names:
                if safe_float(node) is None:
                    return False
                continue
            if len(names) == 1:
                symbol = next(iter(names))
                interval = box.get(symbol)
                if interval is None:
                    return False
                if interval.is_subset(continuous_domain(node, symbol, sp.S.Reals)) is not True:
                    return False
                span = function_range(node, symbol, interval)
                if safe_float(span.inf) is None or safe_float(span.sup) is None:
                    return False
                continue
            if node.func in (sp.Add, sp.Mul):
                continue
            if isinstance(node, sp.Pow):
                base, power = node.args
                if power.is_integer is True and power.is_nonnegative is True:
                    continue
                if base.is_positive is True:
                    continue
                if power.is_positive is True and base.is_nonnegative is True:
                    continue
                if power.is_Rational is True and power.is_positive is True:
                    try:
                        if _prove_nonnegative(base, box):
                            continue
                    except (ValueError, TypeError, NotImplementedError, sp.PolynomialError):
                        pass
                return False
            if node.func in (sp.sin, sp.cos, sp.exp, sp.atan, sp.sinh, sp.cosh, sp.tanh, sp.Abs):
                continue
            if node.func == sp.log and node.args[0].is_positive is True:
                continue
            return False
        return True
    except (ValueError, TypeError, NotImplementedError):
        return False


def _combined_range(expressions, box, label):
    values = [_estimate_range(expression, box, label) for expression in expressions]
    low = min(value.inf for value in values)
    high = max(value.sup for value in values)
    if abs(float(low)) > 1e6 or abs(float(high)) > 1e6:
        raise ValueError(f'{label}超过当前交互画布的坐标范围（±10^6）')
    return sp.Interval(low, high)


def _curve(raw, variables, label):
    return _expr(raw, variables, label)


def parse_inputs(c):
    mode = c.get('region_mode')
    if mode not in MODES:
        raise ValueError('请选择长方体、z型区域、柱坐标或球坐标三重积分区域')
    expected = set(FIELDS[mode])
    if set(c) != expected:
        raise ValueError('必须完整填写该区域模式的被积函数和全部积分限，额外条件不能忽略')
    if any(not isinstance(c[key], str) or not c[key].strip() or len(c[key]) > 600 for key in expected):
        raise ValueError('请完整填写被积函数和各层积分限，不自动补0')
    f = _expr(c['integrand'], ('x', 'y', 'z'), '被积函数')
    if mode in ('box', 'z_simple'):
        a, b = _constant_interval(c, 'x_lower', 'x_upper', 'x 区间')
        if mode == 'box':
            c0, d0 = _constant_interval(c, 'y_lower', 'y_upper', 'y 区间')
            e, g = _constant_interval(c, 'z_lower', 'z_upper', 'z 区间')
            box = {X: sp.Interval(a, b), Y: sp.Interval(c0, d0), Z: sp.Interval(e, g)}
            return dict(mode=mode, integrand=f, x=(a, b), y=(c0, d0), z=(e, g), cartesian_box=box)
        xbox = {X: sp.Interval(a, b)}
        y0, y1 = _curve(c['y_lower'], ('x',), 'y 下界'), _curve(c['y_upper'], ('x',), 'y 上界')
        if not all(_real_on_box(curve, xbox) for curve in (y0, y1)):
            raise ValueError('y 边界在 x 区间内存在无定义或不连续的实值点')
        ybox = _combined_range((y0, y1), xbox, 'y 边界')
        _prove_order(y0, y1, xbox, 'y 边界')
        xybox = {X: sp.Interval(a, b), Y: ybox}
        z0, z1 = _curve(c['z_lower'], ('x', 'y'), 'z 下界'), _curve(c['z_upper'], ('x', 'y'), 'z 上界')
        if not all(_real_on_box(curve, xybox) for curve in (z0, z1)):
            raise ValueError('z 边界在投影区域内存在无定义或不连续的实值点')
        zbox = _combined_range((z0, z1), xybox, 'z 边界')
        _prove_order_on_curve(z0, z1, Y, y0, y1, xbox, 'z 边界')
        return dict(mode=mode, integrand=f, x=(a, b), y=(y0, y1), z=(z0, z1),
                    y_box=ybox, z_box=zbox, cartesian_box={X: sp.Interval(a, b), Y: ybox, Z: zbox})
    if mode == 'cylindrical':
        theta0, theta1 = _constant_interval(c, 'theta_lower', 'theta_upper', '极角 theta 区间')
        if not bool(theta1 - theta0 <= 2 * sp.pi):
            raise ValueError('极角区间必须递增且不超过2*pi，避免重复覆盖区域')
        theta_box = {THETA: sp.Interval(theta0, theta1)}
        r0 = _curve(c['radius_lower'], ('theta',), '半径下界 r')
        r1 = _curve(c['radius_upper'], ('theta',), '半径上界 r')
        if not all(_real_on_box(curve, theta_box) for curve in (r0, r1)):
            raise ValueError('半径边界在极角区间内存在无定义或不连续的实值点')
        rbox = _combined_range((r0, r1), theta_box, '半径边界')
        if rbox.inf.is_nonnegative is not True:
            raise ValueError('柱坐标半径不能为负')
        _prove_order(r0, r1, theta_box, '半径边界')
        parameter_box = {THETA: sp.Interval(theta0, theta1), RADIAL: rbox}
        z0 = _curve(c['z_lower'], ('theta', 'r'), 'z 下界')
        z1 = _curve(c['z_upper'], ('theta', 'r'), 'z 上界')
        if not all(_real_on_box(curve, parameter_box) for curve in (z0, z1)):
            raise ValueError('z 边界在柱坐标参数域内存在无定义或不连续的实值点')
        zbox = _combined_range((z0, z1), parameter_box, 'z 边界')
        _prove_order_on_curve(z0, z1, RADIAL, r0, r1, theta_box, 'z 边界')
        parameter_box[Z] = zbox
        return dict(mode=mode, integrand=f, theta=(theta0, theta1), r=(r0, r1), z=(z0, z1),
                    parameter_box=parameter_box)
    theta0, theta1 = _constant_interval(c, 'theta_lower', 'theta_upper', '方位角 theta 区间')
    if not bool(theta1 - theta0 <= 2 * sp.pi):
        raise ValueError('方位角区间必须递增且不超过2*pi，避免重复覆盖区域')
    phi0, phi1 = _constant_interval(c, 'phi_lower', 'phi_upper', '极角 phi 区间')
    if not bool(phi0 >= 0) or not bool(phi1 <= sp.pi):
        raise ValueError('球坐标极角 phi 必须满足 0≤phi≤pi')
    theta_phi_box = {THETA: sp.Interval(theta0, theta1), PHI: sp.Interval(phi0, phi1)}
    rho0 = _curve(c['rho_lower'], ('theta', 'phi'), '径向 rho 下界')
    rho1 = _curve(c['rho_upper'], ('theta', 'phi'), '径向 rho 上界')
    if not all(_real_on_box(curve, theta_phi_box) for curve in (rho0, rho1)):
        raise ValueError('径向边界在角度区间内存在无定义或不连续的实值点')
    rhobox = _combined_range((rho0, rho1), theta_phi_box, '径向边界')
    if rhobox.inf.is_nonnegative is not True:
        raise ValueError('球坐标径向 rho 不能为负')
    _prove_order(rho0, rho1, theta_phi_box, '径向边界')
    parameter_box = {THETA: sp.Interval(theta0, theta1), PHI: sp.Interval(phi0, phi1), RHO: rhobox}
    return dict(mode=mode, integrand=f, theta=(theta0, theta1), phi=(phi0, phi1), rho=(rho0, rho1),
                parameter_box=parameter_box)


def _substitute(expression, mapping):
    """Substitute while keeping written structure, so hidden domain conditions survive."""
    if expression.is_number:
        return expression
    if expression.is_Symbol:
        return mapping.get(expression, expression)
    if not expression.args:
        return expression
    args = tuple(_substitute(argument, mapping) for argument in expression.args)
    try:
        return expression.func(*args, evaluate=False)
    except TypeError:
        return expression.func(*args)


def _mapped_integrand(plan):
    """Original integrand after coordinate mapping, still structurally unevaluated."""
    if plan['mode'] in ('box', 'z_simple'):
        return plan['integrand']
    if plan['mode'] == 'cylindrical':
        return _substitute(plan['integrand'], {
            X: RADIAL * sp.cos(THETA), Y: RADIAL * sp.sin(THETA), Z: Z,
        })
    return _substitute(plan['integrand'], {
        X: RHO * sp.sin(PHI) * sp.cos(THETA),
        Y: RHO * sp.sin(PHI) * sp.sin(THETA),
        Z: RHO * sp.cos(PHI),
    })


def transformed_integrand(plan):
    if plan['mode'] in ('box', 'z_simple'):
        return plan['integrand'], sp.S.One
    if plan['mode'] == 'cylindrical':
        return _mapped_integrand(plan) * RADIAL, RADIAL
    return _mapped_integrand(plan) * RHO ** 2 * sp.sin(PHI), RHO ** 2 * sp.sin(PHI)


def continuous_verified(plan):
    if plan['mode'] in ('box', 'z_simple'):
        return _real_on_box(plan['integrand'], plan['cartesian_box'])
    # 雅可比在参数域上光滑且不为零，域核验只看原式映射后的结构。
    return _real_on_box(_mapped_integrand(plan), plan['parameter_box'])


def _bounds_text(values):
    return [expression_text(value) for value in values]


def _details(plan, question, continuous):
    if plan['mode'] in ('box', 'z_simple'):
        outer, middle, inner = 'x', 'y', 'z'
        outer_bounds = _bounds_text(plan['x'])
        middle_bounds = _bounds_text(plan['y'])
        inner_bounds = _bounds_text(plan['z'])
        jacobian = '1'
        jacobian_latex = '1'
    elif plan['mode'] == 'cylindrical':
        outer, middle, inner = 'theta', 'r', 'z'
        outer_bounds = _bounds_text(plan['theta'])
        middle_bounds = _bounds_text(plan['r'])
        inner_bounds = _bounds_text(plan['z'])
        jacobian = 'r'
        jacobian_latex = 'r'
    else:
        outer, middle, inner = 'theta', 'phi', 'rho'
        outer_bounds = _bounds_text(plan['theta'])
        middle_bounds = _bounds_text(plan['phi'])
        inner_bounds = _bounds_text(plan['rho'])
        jacobian = 'rho^2*sin(phi)'
        jacobian_latex = r'\rho^{2}\sin\phi'
    return dict(region_mode=plan['mode'], outer_variable=outer, middle_variable=middle, inner_variable=inner,
                outer_bounds=outer_bounds, middle_bounds=middle_bounds, inner_bounds=inner_bounds,
                region_description=question, region_verified=True, continuous_verified=bool(continuous),
                jacobian=jacobian, jacobian_latex=jacobian_latex, note=NOTE)


def preview(c):
    plan = parse_inputs(c)
    f = plan['integrand']
    mode = plan['mode']
    if mode in ('box', 'z_simple'):
        a, b = plan['x']
        y0, y1 = plan['y']
        z0, z1 = plan['z']
        latex = (rf'\int_{{{to_latex(a)}}}^{{{to_latex(b)}}}'
                 rf'\int_{{{to_latex(y0)}}}^{{{to_latex(y1)}}}'
                 rf'\int_{{{to_latex(z0)}}}^{{{to_latex(z1)}}}{to_latex(f)}\,dz\,dy\,dx')
        question = (f'计算三重积分；被积函数={c["integrand"]}；先对z、再对y、最后对x；'
                    f'完整区域：{a}≤x≤{b}，{y0}≤y≤{y1}，{z0}≤z≤{z1}；无其他区域限制')
        label = '直角坐标三重积分'
    elif mode == 'cylindrical':
        t0, t1 = plan['theta']
        r0, r1 = plan['r']
        z0, z1 = plan['z']
        g, _ = transformed_integrand(plan)
        latex = (rf'\int_{{{to_latex(t0)}}}^{{{to_latex(t1)}}}'
                 rf'\int_{{{to_latex(r0)}}}^{{{to_latex(r1)}}}'
                 rf'\int_{{{to_latex(z0)}}}^{{{to_latex(z1)}}}{to_latex(g)}\,dz\,dr\,d\theta')
        question = (f'柱坐标三重积分，原函数f(x,y,z)={c["integrand"]}；'
                    f'{c["theta_lower"]}≤theta≤{c["theta_upper"]}，{c["radius_lower"]}≤r≤{c["radius_upper"]}，'
                    f'{c["z_lower"]}≤z≤{c["z_upper"]}；x=r*cos(theta)，y=r*sin(theta)，自动乘雅可比r')
        label = '柱坐标三重积分'
    else:
        t0, t1 = plan['theta']
        p0, p1 = plan['phi']
        q0, q1 = plan['rho']
        g, _ = transformed_integrand(plan)
        latex = (rf'\int_{{{to_latex(t0)}}}^{{{to_latex(t1)}}}'
                 rf'\int_{{{to_latex(p0)}}}^{{{to_latex(p1)}}}'
                 rf'\int_{{{to_latex(q0)}}}^{{{to_latex(q1)}}}{to_latex(g)}\,d\rho\,d\phi\,d\theta')
        question = (f'球坐标三重积分，原函数f(x,y,z)={c["integrand"]}；'
                    f'{c["theta_lower"]}≤theta≤{c["theta_upper"]}，{c["phi_lower"]}≤phi≤{c["phi_upper"]}，'
                    f'{c["rho_lower"]}≤rho≤{c["rho_upper"]}；'
                    'x=rho*sin(phi)*cos(theta)，y=rho*sin(phi)*sin(theta)，z=rho*cos(phi)，'
                    '自动乘雅可比rho^2*sin(phi)')
        label = '球坐标三重积分'
    return dict(task='triple_integral', label=label, conditions=dict(c), latex=latex, question=question)


def labels(c):
    mode = c.get('region_mode', 'box')
    result = {'integrand': '被积函数', 'region_mode': '区域模式'}
    if mode in ('box', 'z_simple'):
        result.update({'x_lower': 'x 下限', 'x_upper': 'x 上限', 'y_lower': 'y 下界', 'y_upper': 'y 上界',
                       'z_lower': 'z 下界', 'z_upper': 'z 上界'})
    elif mode == 'cylindrical':
        result.update({'theta_lower': '极角下限 theta', 'theta_upper': '极角上限 theta',
                       'radius_lower': '半径下界 r', 'radius_upper': '半径上界 r',
                       'z_lower': 'z 下界', 'z_upper': 'z 上界'})
    else:
        result.update({'theta_lower': '方位角下限 theta', 'theta_upper': '方位角上限 theta',
                       'phi_lower': '极角下限 phi', 'phi_upper': '极角上限 phi',
                       'rho_lower': '径向下界 rho', 'rho_upper': '径向上界 rho'})
    return result


def _closed(value, label):
    if value.has(sp.Integral):
        raise ValueError(f'{label}未得到闭式结果，当前不能作为已完成的三重积分')
    return sp.simplify(value)


def _numeric_check(exact, numeric, label):
    if safe_float(exact) is None:
        raise ValueError(f'{label}未得到有限实数结果，请核对区域边界与被积函数（含奇点）')
    if numeric is None or not math.isfinite(numeric):
        raise ValueError(f'{label}无法完成独立数值复核，不能判为通过')
    if abs(numeric - float(exact)) > 1e-6 * max(1, abs(float(exact))):
        raise ValueError(f'{label}解析值与独立数值复核不一致，不能判为通过')


def _mp(value):
    import mpmath as mp
    return mp.mpf(str(sp.N(value, 25)))


def _gl_nodes():
    import numpy as np
    nodes, weights = np.polynomial.legendre.leggauss(28)
    return nodes, weights


def _numeric_box(f, a, b, c, d, e, g):
    try:
        import numpy as np
        nodes, weights = _gl_nodes()
        func = sp.lambdify((X, Y, Z), f, 'numpy')
        xa, xb, ya, yb, za, zb = [float(value) for value in (a, b, c, d, e, g)]
        xs = 0.5 * (xb - xa) * nodes + 0.5 * (xb + xa)
        ys = 0.5 * (yb - ya) * nodes + 0.5 * (yb + ya)
        zs = 0.5 * (zb - za) * nodes + 0.5 * (zb + za)
        xg, yg, zg = np.meshgrid(xs, ys, zs, indexing='ij')
        values = np.asarray(func(xg, yg, zg), dtype=float)
        if values.ndim == 0:
            values = np.full(xg.shape, float(values))
        total = np.einsum('i,j,k,ijk->', weights, weights, weights, values)
        total *= 0.125 * (xb - xa) * (yb - ya) * (zb - za)
        result = float(total)
        return result if math.isfinite(result) else None
    except Exception:  # noqa: BLE001
        return None


def _numeric_z_simple(f, a, b, y0, y1, z0, z1):
    try:
        import numpy as np
        nodes, weights = _gl_nodes()
        func = sp.lambdify((X, Y, Z), f, 'numpy')
        ny0, ny1 = sp.lambdify(X, y0, 'numpy'), sp.lambdify(X, y1, 'numpy')
        nz0, nz1 = sp.lambdify((X, Y), z0, 'numpy'), sp.lambdify((X, Y), z1, 'numpy')
        xa, xb = float(a), float(b)
        xs = 0.5 * (xb - xa) * nodes + 0.5 * (xb + xa)
        xg = np.repeat(xs[:, None], nodes.size, axis=1)
        ylow = np.broadcast_to(np.asarray(ny0(xs), dtype=float), xs.shape)
        yhigh = np.broadcast_to(np.asarray(ny1(xs), dtype=float), xs.shape)
        ys = 0.5 * (yhigh - ylow)[:, None] * nodes[None, :] + 0.5 * (yhigh + ylow)[:, None]
        zlow = np.broadcast_to(np.asarray(nz0(xg, ys), dtype=float), xg.shape)
        zhigh = np.broadcast_to(np.asarray(nz1(xg, ys), dtype=float), xg.shape)
        zg = 0.5 * (zhigh - zlow)[:, :, None] * nodes[None, None, :] + 0.5 * (zhigh + zlow)[:, :, None]
        values = np.asarray(func(xg[:, :, None], ys[:, :, None], zg), dtype=float)
        if values.ndim == 0:
            values = np.full(zg.shape, float(values))
        inner = (values * weights[None, None, :] * (0.5 * (zhigh - zlow))[:, :, None]).sum(axis=2)
        middle = (inner * weights[None, :]).sum(axis=1)
        total = ((middle * (0.5 * (yhigh - ylow))) * weights).sum() * (0.5 * (xb - xa))
        result = float(total)
        return result if math.isfinite(result) else None
    except Exception:  # noqa: BLE001
        return None


def _numeric_cylindrical(g, theta0, theta1, r0, r1, z0, z1):
    try:
        import numpy as np
        nodes, weights = _gl_nodes()
        func = sp.lambdify((RADIAL, THETA, Z), g, 'numpy')
        nr0, nr1 = sp.lambdify(THETA, r0, 'numpy'), sp.lambdify(THETA, r1, 'numpy')
        nz0, nz1 = sp.lambdify((THETA, RADIAL), z0, 'numpy'), sp.lambdify((THETA, RADIAL), z1, 'numpy')
        t0, t1 = float(theta0), float(theta1)
        theta = 0.5 * (t1 - t0) * nodes + 0.5 * (t1 + t0)
        rlow = np.broadcast_to(np.asarray(nr0(theta), dtype=float), theta.shape)
        rhigh = np.broadcast_to(np.asarray(nr1(theta), dtype=float), theta.shape)
        rg = 0.5 * (rhigh - rlow)[:, None] * nodes[None, :] + 0.5 * (rhigh + rlow)[:, None]
        tg = np.repeat(theta[:, None], nodes.size, axis=1)
        zlow = np.broadcast_to(np.asarray(nz0(tg, rg), dtype=float), tg.shape)
        zhigh = np.broadcast_to(np.asarray(nz1(tg, rg), dtype=float), tg.shape)
        zg = 0.5 * (zhigh - zlow)[:, :, None] * nodes[None, None, :] + 0.5 * (zhigh + zlow)[:, :, None]
        values = np.asarray(func(rg[:, :, None], tg[:, :, None], zg), dtype=float)
        if values.ndim == 0:
            values = np.full(zg.shape, float(values))
        inner = (values * weights[None, None, :] * (0.5 * (zhigh - zlow))[:, :, None]).sum(axis=2)
        middle = (inner * weights[None, :] * (0.5 * (rhigh - rlow))[:, None]).sum(axis=1)
        total = (middle * weights).sum() * (0.5 * (t1 - t0))
        result = float(total)
        return result if math.isfinite(result) else None
    except Exception:  # noqa: BLE001
        return None


def _numeric_spherical(g, theta0, theta1, phi0, phi1, rho0, rho1):
    try:
        import numpy as np
        nodes, weights = _gl_nodes()
        func = sp.lambdify((RHO, PHI, THETA), g, 'numpy')
        nrho0, nrho1 = sp.lambdify((THETA, PHI), rho0, 'numpy'), sp.lambdify((THETA, PHI), rho1, 'numpy')
        t0, t1, p0, p1 = float(theta0), float(theta1), float(phi0), float(phi1)
        theta = 0.5 * (t1 - t0) * nodes + 0.5 * (t1 + t0)
        phi = 0.5 * (p1 - p0) * nodes + 0.5 * (p1 + p0)
        tg = np.repeat(theta[:, None], nodes.size, axis=1)
        pg = np.repeat(phi[None, :], nodes.size, axis=0)
        rholow = np.broadcast_to(np.asarray(nrho0(tg, pg), dtype=float), tg.shape)
        rhohigh = np.broadcast_to(np.asarray(nrho1(tg, pg), dtype=float), tg.shape)
        rg = 0.5 * (rhohigh - rholow)[:, :, None] * nodes[None, None, :] + 0.5 * (rhohigh + rholow)[:, :, None]
        values = np.asarray(func(rg, pg[:, :, None], tg[:, :, None]), dtype=float)
        if values.ndim == 0:
            values = np.full(rg.shape, float(values))
        inner = (values * weights[None, None, :] * (0.5 * (rhohigh - rholow))[:, :, None]).sum(axis=2)
        middle = (inner * weights[None, :]).sum(axis=1) * (0.5 * (p1 - p0))
        total = (middle * weights).sum() * (0.5 * (t1 - t0))
        result = float(total)
        return result if math.isfinite(result) else None
    except Exception:  # noqa: BLE001
        return None


def _numeric_box_mp(f, a, b, c, d, e, g):
    try:
        import mpmath as mp
        func = sp.lambdify((X, Y, Z), f, 'mpmath')
        with mp.workdps(16):
            value = mp.quad(
                lambda x: mp.quad(
                    lambda y: mp.quad(lambda z: func(x, y, z), [_mp(e), _mp(g)]),
                    [_mp(c), _mp(d)]),
                [_mp(a), _mp(b)])
        result = float(value)
        return result if math.isfinite(result) else None
    except Exception:  # noqa: BLE001
        return None


def _numeric_z_simple_mp(f, a, b, y0, y1, z0, z1):
    try:
        import mpmath as mp
        func = sp.lambdify((X, Y, Z), f, 'mpmath')
        ny0, ny1 = sp.lambdify(X, y0, 'mpmath'), sp.lambdify(X, y1, 'mpmath')
        nz0, nz1 = sp.lambdify((X, Y), z0, 'mpmath'), sp.lambdify((X, Y), z1, 'mpmath')
        with mp.workdps(16):
            value = mp.quad(
                lambda x: mp.quad(
                    lambda y: mp.quad(lambda z: func(x, y, z), [nz0(x, y), nz1(x, y)]),
                    [ny0(x), ny1(x)]),
                [_mp(a), _mp(b)])
        result = float(value)
        return result if math.isfinite(result) else None
    except Exception:  # noqa: BLE001
        return None


def _numeric_cylindrical_mp(g, theta0, theta1, r0, r1, z0, z1):
    try:
        import mpmath as mp
        func = sp.lambdify((RADIAL, THETA, Z), g, 'mpmath')
        nr0, nr1 = sp.lambdify(THETA, r0, 'mpmath'), sp.lambdify(THETA, r1, 'mpmath')
        nz0, nz1 = sp.lambdify((THETA, RADIAL), z0, 'mpmath'), sp.lambdify((THETA, RADIAL), z1, 'mpmath')
        with mp.workdps(16):
            value = mp.quad(
                lambda t: mp.quad(
                    lambda r: mp.quad(lambda z: func(r, t, z), [nz0(t, r), nz1(t, r)]),
                    [nr0(t), nr1(t)]),
                [_mp(theta0), _mp(theta1)])
        result = float(value)
        return result if math.isfinite(result) else None
    except Exception:  # noqa: BLE001
        return None


def _numeric_spherical_mp(g, theta0, theta1, phi0, phi1, rho0, rho1):
    try:
        import mpmath as mp
        func = sp.lambdify((RHO, PHI, THETA), g, 'mpmath')
        nrho0, nrho1 = sp.lambdify((THETA, PHI), rho0, 'mpmath'), sp.lambdify((THETA, PHI), rho1, 'mpmath')
        with mp.workdps(16):
            value = mp.quad(
                lambda t: mp.quad(
                    lambda p: mp.quad(lambda rho: func(rho, p, t), [nrho0(t, p), nrho1(t, p)]),
                    [_mp(phi0), _mp(phi1)]),
                [_mp(theta0), _mp(theta1)])
        result = float(value)
        return result if math.isfinite(result) else None
    except Exception:  # noqa: BLE001
        return None


def _verified_numeric(exact, fast, fallback):
    target = safe_float(exact)
    if target is not None and fast is not None and abs(fast - target) <= 1e-6 * max(1, abs(target)):
        return fast
    adaptive = fallback()
    return adaptive if adaptive is not None else fast


def _point(x, y, z):
    values = [float(x), float(y), float(z)]
    if not all(math.isfinite(value) for value in values):
        return None
    return {'x': round(values[0], 6), 'y': round(values[1], 6), 'z': round(values[2], 6)}


def _box_space(a, b, c, d, e, g):
    corners = [(x, y, z) for x in (a, b) for y in (c, d) for z in (e, g)]
    edges = []
    for i in range(8):
        for j in range(i + 1, 8):
            if sum(1 for left, right in zip(corners[i], corners[j]) if left != right) == 1:
                edges.append([_point(*corners[i]), _point(*corners[j])])
    return {'kind': 'box', 'x': [float(a), float(b)], 'y': [float(c), float(d)],
            'z': [float(e), float(g)], 'edges': edges}


def _z_simple_space(a, b, y0, y1, z0, z1):
    try:
        ny0, ny1 = sp.lambdify(X, y0, 'math'), sp.lambdify(X, y1, 'math')
        nz0, nz1 = sp.lambdify((X, Y), z0, 'math'), sp.lambdify((X, Y), z1, 'math')
        grid = []
        for i in range(13):
            x = float(a) + (float(b) - float(a)) * i / 12
            low, high = ny0(x), ny1(x)
            row = []
            for j in range(9):
                y = low + (high - low) * j / 8
                point = _point(x, y, nz1(x, y))
                if point is not None:
                    row.append(point)
            grid.append(row)
        bottom = []
        for i in range(25):
            x = float(a) + (float(b) - float(a)) * i / 24
            point = _point(x, ny0(x), nz0(x, ny0(x)))
            if point is not None:
                bottom.append(point)
        corners = []
        for x in (float(a), float(b)):
            for y in (ny0(x), ny1(x)):
                corners.append([_point(x, y, nz0(x, y)), _point(x, y, nz1(x, y))])
        return {'kind': 'z_simple', 'grid': grid,
                'curves': [{'id': 'bottom', 'label': '下边界', 'points': bottom}]
                          + [{'id': f'edge{index}', 'label': '竖边', 'points': edge}
                             for index, edge in enumerate(corners) if all(edge)]}
    except Exception:  # noqa: BLE001
        return {'kind': 'z_simple'}


def _cylindrical_point(r, theta, z):
    return _point(r * math.cos(theta), r * math.sin(theta), z)


def _cylindrical_space(theta0, theta1, r0, r1, z0, z1):
    try:
        nr0, nr1 = sp.lambdify(THETA, r0, 'math'), sp.lambdify(THETA, r1, 'math')
        nz0, nz1 = sp.lambdify((THETA, RADIAL), z0, 'math'), sp.lambdify((THETA, RADIAL), z1, 'math')
        grid = []
        for i in range(13):
            theta = float(theta0) + (float(theta1) - float(theta0)) * i / 12
            radius = nr1(theta)
            row = []
            for j in range(7):
                z = nz0(theta, radius) + (nz1(theta, radius) - nz0(theta, radius)) * j / 6
                point = _cylindrical_point(radius, theta, z)
                if point is not None:
                    row.append(point)
            grid.append(row)
        curves = []
        for identifier, height in (('bottom', nz0), ('top', nz1)):
            points = []
            for i in range(33):
                theta = float(theta0) + (float(theta1) - float(theta0)) * i / 32
                radius = nr1(theta)
                point = _cylindrical_point(radius, theta, height(theta, radius))
                if point is not None:
                    points.append(point)
            curves.append({'id': identifier, 'label': '外边界圆环', 'points': points})
        return {'kind': 'cylinder', 'grid': grid, 'curves': curves}
    except Exception:  # noqa: BLE001
        return {'kind': 'cylinder'}


def _spherical_point(rho, theta, phi):
    return _point(rho * math.sin(phi) * math.cos(theta),
                  rho * math.sin(phi) * math.sin(theta), rho * math.cos(phi))


def _spherical_space(theta0, theta1, phi0, phi1, rho0, rho1):
    try:
        nrho1 = sp.lambdify((THETA, PHI), rho1, 'math')
        grid = []
        for i in range(11):
            phi = float(phi0) + (float(phi1) - float(phi0)) * i / 10
            row = []
            for j in range(15):
                theta = float(theta0) + (float(theta1) - float(theta0)) * j / 14
                point = _spherical_point(nrho1(theta, phi), theta, phi)
                if point is not None:
                    row.append(point)
            grid.append(row)
        curves = []
        for identifier, phi in (('phi_low', phi0), ('phi_high', phi1)):
            points = []
            for i in range(33):
                theta = float(theta0) + (float(theta1) - float(theta0)) * i / 32
                point = _spherical_point(nrho1(theta, float(phi)), theta, float(phi))
                if point is not None:
                    points.append(point)
            curves.append({'id': identifier, 'label': '角度边界曲线', 'points': points})
        return {'kind': 'sphere', 'grid': grid, 'curves': curves}
    except Exception:  # noqa: BLE001
        return {'kind': 'sphere'}


def _space(plan):
    mode = plan['mode']
    if mode == 'box':
        return _box_space(*plan['x'], *plan['y'], *plan['z'])
    if mode == 'z_simple':
        return _z_simple_space(*plan['x'], *plan['y'], *plan['z'])
    if mode == 'cylindrical':
        return _cylindrical_space(*plan['theta'], *plan['r'], *plan['z'])
    return _spherical_space(*plan['theta'], *plan['phi'], *plan['rho'])


def _compute(plan):
    mode = plan['mode']
    if mode == 'box':
        a, b = plan['x']
        c, d = plan['y']
        e, g = plan['z']
        f = plan['integrand']
        inner = _closed(sp.integrate(f, (Z, e, g)), '内层 z 积分')
        middle = _closed(sp.integrate(inner, (Y, c, d)), '中层 y 积分')
        exact = sp.simplify(_integrate_outer(middle, (X, a, b)))
        numeric = _verified_numeric(exact, _numeric_box(f, a, b, c, d, e, g),
                                    lambda: _numeric_box_mp(f, a, b, c, d, e, g))
        transformed = f
        jacobian = sp.S.One
    elif mode == 'z_simple':
        a, b = plan['x']
        y0, y1 = plan['y']
        z0, z1 = plan['z']
        f = plan['integrand']
        inner = _closed(sp.integrate(f, (Z, z0, z1)), '内层 z 积分')
        middle = _closed(sp.integrate(inner, (Y, y0, y1)), '中层 y 积分')
        exact = sp.simplify(_integrate_outer(middle, (X, a, b)))
        numeric = _verified_numeric(exact, _numeric_z_simple(f, a, b, y0, y1, z0, z1),
                                    lambda: _numeric_z_simple_mp(f, a, b, y0, y1, z0, z1))
        transformed = f
        jacobian = sp.S.One
    elif mode == 'cylindrical':
        t0, t1 = plan['theta']
        r0, r1 = plan['r']
        z0, z1 = plan['z']
        transformed, jacobian = transformed_integrand(plan)
        inner = _closed(sp.integrate(transformed, (Z, z0, z1)), '内层 z 积分')
        middle = _closed(sp.integrate(inner, (RADIAL, r0, r1)), '中层 r 积分')
        exact = sp.simplify(_integrate_outer(middle, (THETA, t0, t1)))
        numeric = _verified_numeric(exact, _numeric_cylindrical(transformed, t0, t1, r0, r1, z0, z1),
                                    lambda: _numeric_cylindrical_mp(transformed, t0, t1, r0, r1, z0, z1))
    else:
        t0, t1 = plan['theta']
        p0, p1 = plan['phi']
        q0, q1 = plan['rho']
        transformed, jacobian = transformed_integrand(plan)
        inner = _closed(sp.integrate(transformed, (RHO, q0, q1)), '内层 rho 积分')
        middle = _closed(sp.integrate(inner, (PHI, p0, p1)), '中层 phi 积分')
        exact = sp.simplify(_integrate_outer(middle, (THETA, t0, t1)))
        numeric = _verified_numeric(exact, _numeric_spherical(transformed, t0, t1, p0, p1, q0, q1),
                                    lambda: _numeric_spherical_mp(transformed, t0, t1, p0, p1, q0, q1))
    if exact.has(sp.Integral):
        raise ValueError('三重积分外层未得到闭式结果，当前不能作为已完成的计算')
    _numeric_check(exact, numeric, '三重积分')
    return dict(exact=sp.simplify(exact), numeric=numeric, transformed=transformed,
                jacobian=jacobian, inner=inner, middle=middle, space=_space(plan))


def _steps(plan, result):
    mode = plan['mode']
    if mode in ('box', 'z_simple'):
        order = 'z → y → x'
        inner_limit = (Z, *plan['z'])
        middle_limit = (Y, *plan['y'])
        outer_limit = (X, *plan['x'])
    elif mode == 'cylindrical':
        order = 'z → r → theta'
        inner_limit = (Z, *plan['z'])
        middle_limit = (RADIAL, *plan['r'])
        outer_limit = (THETA, *plan['theta'])
    else:
        order = 'rho → phi → theta'
        inner_limit = (RHO, *plan['rho'])
        middle_limit = (PHI, *plan['phi'])
        outer_limit = (THETA, *plan['theta'])
    transform_detail = ('直接按直角坐标累次积分，雅可比为1。'
                        if mode in ('box', 'z_simple') else
                        f'先代入坐标变换并乘雅可比 {expression_text(result["jacobian"])}，再按参数域积分。')
    return [
        {'id': 'region', 'title': '确认完整三维区域', 'latex': '',
         'detail': f'区域类型 {mode}；固定积分次序 {order}；全部边界已做全区间核验。'},
        {'id': 'transform', 'title': '坐标变换与雅可比', 'latex': to_latex(result['transformed']),
         'detail': transform_detail},
        {'id': 'inner', 'title': f'内层积分（{inner_limit[0]}）', 'latex': to_latex(result['inner']),
         'detail': f'在每条内层区间上积分，积分限来自已确认边界。'},
        {'id': 'middle', 'title': f'中层积分（{middle_limit[0]}）', 'latex': to_latex(result['middle']),
         'detail': '把内层结果作为被积函数继续积分。'},
        {'id': 'outer', 'title': f'外层积分（{outer_limit[0]}）', 'latex': to_latex(result['exact']),
         'detail': f'外层积分为最终精确值 {expression_text(result["exact"])}。'},
        {'id': 'numeric', 'title': '独立数值复核', 'latex': '',
         'detail': f'嵌套数值积分得到 {result["numeric"]:.10g}，与精确值在容差内一致。'},
    ]


def build_problem(c):
    from .exam_math import _condition
    plan = parse_inputs(c)
    p = preview(c)
    continuous = continuous_verified(plan)
    failure = '' if continuous else CONTINUOUS_FAILURE
    model = dict(engine='triple_integral_v1', subject='calculus', task='triple_integral', kind='space',
                 region_kind=plan['mode'], variables=['x', 'y', 'z'], expression=c['integrand'],
                 integrand=c['integrand'], formula_tex=p['latex'], defaults={}, params=[], teaching=False,
                 manual_triple_conditions=dict(c), manual_triple_continuous=continuous,
                 manual_triple_failure=failure)
    fields = [_condition(key, labels(c)[key], value, {}) for key, value in c.items()]
    for field in fields:
        if field['id'] == 'region_mode':
            field['editable'] = False
    return dict(problem_id='prb_manual_triple', number=None, title=p['label'], text=p['question'],
                subject='calculus', subject_label='三重积分', confidence=1.0, status='ready',
                source=dict(page_from=1, page_to=1, file_names=[], label='结构化输入', excerpt=''),
                source_pages=[], recognition=dict(method='declarative_kernel', raw_text='', conditions=fields,
                                                  ambiguities=[], formulas=[], recognized_subject='calculus',
                                                  ai_used=False),
                model=model, solution={}, states={})


def _unsupported(plan, details, question, latex, reason):
    return dict(answer='', summary=reason,
                steps=[dict(id='region', title='完整区域与次序已记录', detail=question, latex=latex)],
                conditions=[], limitations=[NOTE], triple_details=details, space=_space(plan),
                solution_complete=False, solution_status='unsupported', incomplete_reason=reason)


def solve(model):
    c = model['manual_triple_conditions']
    plan = parse_inputs(c)
    p = preview(c)
    # 每次都按原式重新核验，不信任文档里可能已被旧版解析写下的连续标记。
    continuous = continuous_verified(plan)
    details = _details(plan, p['question'], continuous)
    if not continuous:
        return _unsupported(plan, details, p['question'], p['latex'], CONTINUOUS_FAILURE)
    try:
        result = _compute(plan)
    except (ValueError, TypeError, NotImplementedError, ArithmeticError, sp.PolynomialError) as exc:
        reason = str(exc) or '三重积分未完成全域核验或解析计算'
        return _unsupported(plan, details, p['question'], p['latex'], reason)
    details['numeric_value'] = result['numeric']
    return dict(answer=expression_text(result['exact']),
                summary='三重积分：按区域类型确定积分限或坐标变换，内层到外层逐层积分，并做独立数值复核。',
                exact=expression_text(result['exact']), exact_latex=to_latex(result['exact']),
                answer_value=float(result['exact']), steps=_steps(plan, result),
                conditions=[p['question']],
                limitations=[NOTE, '数值积分仅作独立复核；区域边界关系与连续性依据分别保留。'],
                triple_details=details, space=result['space'],
                solution_complete=True, solution_status='complete')


def evaluate(model):
    solution = solve(model)
    return dict(
        subject='calculus', task='triple_integral', kind='space',
        headline=solution.get('answer') or solution.get('summary') or '三重积分',
        answerText=solution.get('answer') or '',
        metrics=[], checks=[],
        notes=solution.get('limitations') or [], series=[], rects=[],
        domain={'x_min': -1, 'x_max': 1},
        exact=solution.get('answer_value'), approx=None, error=None,
        trace=[dict(index=index, label=step['title'], detail=step['detail'], values={})
               for index, step in enumerate(solution.get('steps') or [])],
        space=solution.get('space'), space_solution=solution,
    )


__all__ = ['FIELDS', 'MODES', 'NOTE', 'build_problem', 'evaluate', 'labels', 'parse_inputs', 'preview', 'solve']

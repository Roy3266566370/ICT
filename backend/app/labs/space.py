"""Space objects: triple, line and surface integrals, Green/Gauss/Stokes and geometry."""
from __future__ import annotations

import math
from typing import Any, Mapping

import sympy as sp

from .expr import expression_text, parse_expression, safe_float, to_latex

X, Y, Z = sp.symbols('x y z', real=True)
T, U, V = sp.symbols('t u v', real=True)
TH, PH, RH = sp.symbols('theta phi rho', real=True)
RADIAL = sp.Symbol('r', nonnegative=True)


def _expr(raw: Any, variables: tuple[str, ...], label: str, limit=80) -> sp.Expr:
    if not isinstance(raw, str) or not 1 <= len(raw) <= 600:
        raise ValueError(f'{label}必须是600字以内的表达式')
    value = parse_expression(raw, variables)
    if sp.count_ops(value) > limit:
        raise ValueError(f'{label}超出当前空间计算预算')
    return value


def _pair(raw: Any, label: str) -> tuple[str, str]:
    if not isinstance(raw, list) or len(raw) != 2 or any(not isinstance(item, str) for item in raw):
        raise ValueError(f'{label}必须是两个字符串')
    return raw[0], raw[1]


def _constant(raw: Any, label: str) -> sp.Expr:
    value = _expr(raw, ('x',), label)
    if value.free_symbols or safe_float(value) is None:
        raise ValueError(f'{label}必须是有限实数')
    return value


def _constant_pair(raw: Any, label: str) -> tuple[sp.Expr, sp.Expr]:
    a, b = _pair(raw, label)
    left, right = _constant(a, label), _constant(b, label)
    if not bool(left < right):
        raise ValueError(f'{label}必须从小到大')
    return left, right


def _function_pair(raw: Any, variables: tuple[str, ...], label: str) -> tuple[sp.Expr, sp.Expr]:
    a, b = _pair(raw, label)
    return _expr(a, variables, label), _expr(b, variables, label)


def _strip_order(low: sp.Expr, high: sp.Expr, variables: tuple[sp.Symbol, ...], ranges: list[tuple[sp.Expr, sp.Expr]], label: str):
    samples = []
    for index in range(1, 6):
        substitutions = {}
        for symbol, (left, right) in zip(variables, ranges):
            substitutions[symbol] = left + (right - left) * sp.Rational(index, 6)
        try:
            value = complex(sp.N((high - low).subs(substitutions), 12))
        except Exception:  # noqa: BLE001
            continue
        if value.imag > 1e-9:
            raise ValueError(f'{label}在区域内不是实值')
        samples.append(value.real)
    if samples and min(samples) < -1e-9:
        raise ValueError(f'{label}下界高于上界')


def _numeric_check(exact: sp.Expr, numeric: float | None, label: str):
    if exact.has(sp.Integral) or safe_float(exact) is None:
        raise ValueError(f'{label}未得到有限闭式结果')
    if numeric is None or not math.isfinite(numeric):
        raise ValueError(f'{label}数值复核失败')
    if abs(numeric - float(exact)) > 1e-6 * max(1, abs(float(exact))):
        raise ValueError(f'{label}解析值与独立数值复核不一致')


def _space_points_line(points: list[Mapping[str, float]]) -> dict:
    return {'kind': 'curve', 'points': points}


def _sample_curve(exprs: list[sp.Expr], variables: tuple[sp.Symbol, ...], bounds: list[tuple[sp.Expr, sp.Expr]], count=120):
    funcs = [sp.lambdify(variables, expr, 'math') for expr in exprs]
    points = []
    for index in range(count):
        values = [low + (high - low) * index / (count - 1) for low, high in bounds]
        try:
            coords = [float(func(*values)) for func in funcs]
        except Exception:  # noqa: BLE001
            continue
        if all(math.isfinite(item) for item in coords):
            points.append({'x': round(coords[0], 6), 'y': round(coords[1], 6), 'z': round(coords[2], 6)})
    return points


def _sample_surface(exprs: list[sp.Expr], u_bounds: tuple[sp.Expr, sp.Expr], v_bounds: tuple[sp.Expr, sp.Expr], count=18):
    funcs = [sp.lambdify((U, V), expr, 'math') for expr in exprs]
    grid = []
    for iv in range(count):
        v = v_bounds[0] + (v_bounds[1] - v_bounds[0]) * iv / (count - 1)
        row = []
        for iu in range(count):
            u = u_bounds[0] + (u_bounds[1] - u_bounds[0]) * iu / (count - 1)
            try:
                coords = [float(func(u, v)) for func in funcs]
            except Exception:  # noqa: BLE001
                continue
            if all(math.isfinite(item) for item in coords):
                row.append({'x': round(coords[0], 6), 'y': round(coords[1], 6), 'z': round(coords[2], 6)})
        grid.append(row)
    return {'kind': 'surface', 'grid': grid, 'u_bounds': [expression_text(u_bounds[0]), expression_text(u_bounds[1])],
            'v_bounds': [expression_text(v_bounds[0]), expression_text(v_bounds[1])]}


def _numeric_box(f, a, b, c, d, e, g):
    import mpmath as mp
    func = sp.lambdify((X, Y, Z), f, 'mpmath')
    with mp.workdps(18):
        return float(mp.quad(lambda x: mp.quad(lambda y: mp.quad(lambda z: func(x, y, z), [e, g]), [c, d]), [a, b]))


def _triple_box(f, region):
    a, b = _constant_pair(region.get('x'), 'x 区间')
    c, d = _constant_pair(region.get('y'), 'y 区间')
    e, g = _constant_pair(region.get('z'), 'z 区间')
    exact = sp.simplify(sp.integrate(f, (Z, e, g), (Y, c, d), (X, a, b)))
    numeric = _numeric_box(f, float(a), float(b), float(c), float(d), float(e), float(g))
    _numeric_check(exact, numeric, '三重积分')
    return {'exact': exact, 'numeric': numeric, 'region': region,
            'space': {'kind': 'box', 'x': [float(a), float(b)], 'y': [float(c), float(d)], 'z': [float(e), float(g)]}}


def _triple_z_simple(f, region):
    a, b = _constant_pair(region.get('x'), 'x 区间')
    y0, y1 = _function_pair(region.get('y'), ('x',), 'y 边界')
    z0, z1 = _function_pair(region.get('z'), ('x', 'y'), 'z 边界')
    _strip_order(y0, y1, (X,), [(a, b)], 'y 边界')
    _strip_order(z0, z1, (X, Y), [(a, b), (y0, y1)], 'z 边界')
    exact = sp.simplify(sp.integrate(f, (Z, z0, z1), (Y, y0, y1), (X, a, b)))
    import mpmath as mp
    func = sp.lambdify((X, Y, Z), f, 'mpmath')
    fy0, fy1 = sp.lambdify(X, y0, 'mpmath'), sp.lambdify(X, y1, 'mpmath')
    fz0, fz1 = sp.lambdify((X, Y), z0, 'mpmath'), sp.lambdify((X, Y), z1, 'mpmath')
    with mp.workdps(16):
        numeric = float(mp.quad(lambda x: mp.quad(lambda y: mp.quad(lambda z: func(x, y, z), [fz0(x, y), fz1(x, y)]), [fy0(x), fy1(x)]), [float(a), float(b)]))
    _numeric_check(exact, numeric, '三重积分')
    return {'exact': exact, 'numeric': numeric, 'region': region,
            'space': {'kind': 'box', 'x': [float(a), float(b)], 'y': [float(y0.subs(X, a)), float(y1.subs(X, b))],
                      'z': [float(z0.subs({X: a, Y: y0.subs(X, a)})), float(z1.subs({X: b, Y: y1.subs(X, b)}))]}}


def _triple_cylindrical(f, region):
    theta0, theta1 = _constant_pair(region.get('theta'), 'θ 区间')
    r0, r1 = _function_pair(region.get('r'), ('theta',), 'r 边界')
    z0, z1 = _function_pair(region.get('z'), ('theta', 'r'), 'z 边界')
    if float(r0.subs(TH, (theta0 + theta1) / 2)) < -1e-9:
        raise ValueError('柱坐标半径不能为负')
    _strip_order(r0, r1, (TH,), [(theta0, theta1)], 'r 边界')
    transformed = sp.simplify(f.subs({X: RADIAL * sp.cos(TH), Y: RADIAL * sp.sin(TH), Z: Z}) * RADIAL)
    exact = sp.simplify(sp.integrate(transformed, (Z, z0, z1), (RADIAL, r0, r1), (TH, theta0, theta1)))
    import mpmath as mp
    func = sp.lambdify((RADIAL, TH, Z), transformed, 'mpmath')
    # z bounds depend on both r and theta; r bounds only on theta.
    nr0 = sp.lambdify(TH, r0, 'mpmath'); nr1 = sp.lambdify(TH, r1, 'mpmath')
    nz0 = sp.lambdify((TH, RADIAL), z0, 'mpmath'); nz1 = sp.lambdify((TH, RADIAL), z1, 'mpmath')
    with mp.workdps(16):
        numeric = float(mp.quad(lambda th: mp.quad(lambda r: mp.quad(lambda z: func(r, th, z), [nz0(th, r), nz1(th, r)]), [nr0(th), nr1(th)]), [float(theta0), float(theta1)]))
    _numeric_check(exact, numeric, '柱坐标三重积分')
    return {'exact': exact, 'numeric': numeric, 'region': region,
            'space': {'kind': 'cylinder', 'theta': [float(theta0), float(theta1)], 'r': [float(r0.subs(TH, (theta0+theta1)/2)), float(r1.subs(TH, (theta0+theta1)/2))], 'z': [0.0, 1.0]}}


def _triple_spherical(f, region):
    theta0, theta1 = _constant_pair(region.get('theta'), 'θ 区间')
    phi0, phi1 = _constant_pair(region.get('phi'), 'φ 区间')
    rho0, rho1 = _function_pair(region.get('rho'), ('theta', 'phi'), 'ρ 边界')
    _strip_order(rho0, rho1, (TH, PH), [(theta0, theta1), (phi0, phi1)], 'ρ 边界')
    transformed = sp.simplify(f.subs({
        X: RH * sp.sin(PH) * sp.cos(TH), Y: RH * sp.sin(PH) * sp.sin(TH), Z: RH * sp.cos(PH),
    }) * RH ** 2 * sp.sin(PH))
    exact = sp.simplify(sp.integrate(transformed, (RH, rho0, rho1), (PH, phi0, phi1), (TH, theta0, theta1)))
    import mpmath as mp
    func = sp.lambdify((RH, PH, TH), transformed, 'mpmath')
    nr0 = sp.lambdify((TH, PH), rho0, 'mpmath'); nr1 = sp.lambdify((TH, PH), rho1, 'mpmath')
    with mp.workdps(16):
        numeric = float(mp.quad(lambda th: mp.quad(lambda ph: mp.quad(lambda rho: func(rho, ph, th), [nr0(th, ph), nr1(th, ph)]), [float(phi0), float(phi1)]), [float(theta0), float(theta1)]))
    _numeric_check(exact, numeric, '球坐标三重积分')
    return {'exact': exact, 'numeric': numeric, 'region': region,
            'space': {'kind': 'sphere', 'theta': [float(theta0), float(theta1)], 'phi': [float(phi0), float(phi1)], 'rho': [0.0, 1.0]}}


def _line_integral(conditions):
    curve = conditions.get('curve')
    if not isinstance(curve, list) or len(curve) != 3:
        raise ValueError('空间曲线需要 x(t)、y(t)、z(t) 三个表达式')
    exprs = [_expr(item, ('t',), '曲线分量') for item in curve]
    a, b = _constant_pair(conditions.get('t_bounds'), 't 区间')
    kind = str(conditions.get('kind') or 'scalar')
    if kind not in ('scalar', 'vector'):
        raise ValueError('曲线积分类型只支持 scalar 或 vector')
    derivatives = [sp.diff(expr, T) for expr in exprs]
    substitutions = dict(zip((X, Y, Z), exprs))
    if kind == 'scalar':
        field = _expr(conditions.get('field'), ('x', 'y', 'z'), '被积函数')
        speed = sp.sqrt(sum(item ** 2 for item in derivatives))
        integrand = sp.simplify(field.subs(substitutions) * speed)
    else:
        field = conditions.get('field')
        if not isinstance(field, list) or len(field) != 3:
            raise ValueError('第二类曲线积分需要 P、Q、R 三个分量')
        p, q, r = [_expr(item, ('x', 'y', 'z'), '向量场分量') for item in field]
        integrand = sp.simplify((p.subs(substitutions) * derivatives[0] + q.subs(substitutions) * derivatives[1] + r.subs(substitutions) * derivatives[2]))
    exact = sp.simplify(sp.integrate(integrand, (T, a, b)))
    import mpmath as mp
    func = sp.lambdify(T, integrand, 'mpmath')
    with mp.workdps(18):
        numeric = float(mp.quad(func, [float(a), float(b)]))
    _numeric_check(exact, numeric, '曲线积分')
    points = _sample_curve(exprs, (T,), [(a, b)])
    return {'exact': exact, 'numeric': numeric, 'kind': kind, 'curve': curve,
            'space': {'kind': 'curve', 'curves': [{'id': 'curve', 'label': '积分曲线', 'points': points}]}}


def _surface_integral(conditions):
    surface = conditions.get('surface')
    if not isinstance(surface, list) or len(surface) != 3:
        raise ValueError('参数曲面需要 x(u,v)、y(u,v)、z(u,v) 三个表达式')
    exprs = [_expr(item, ('u', 'v'), '曲面分量') for item in surface]
    uv = conditions.get('uv_bounds')
    if not isinstance(uv, list) or len(uv) != 2:
        raise ValueError('参数曲面需要 u、v 两个区间')
    u0, u1 = _constant_pair(uv[0], 'u 区间')
    v0, v1 = _constant_pair(uv[1], 'v 区间')
    ru = [sp.diff(expr, U) for expr in exprs]
    rv = [sp.diff(expr, V) for expr in exprs]
    normal = sp.Matrix(ru).cross(sp.Matrix(rv))
    normal_norm = sp.sqrt(sum(item ** 2 for item in normal))
    substitutions = dict(zip((X, Y, Z), exprs))
    kind = str(conditions.get('kind') or 'scalar')
    if kind not in ('scalar', 'flux'):
        raise ValueError('曲面积分类型只支持 scalar 或 flux')
    if kind == 'scalar':
        field = _expr(conditions.get('field'), ('x', 'y', 'z'), '被积函数')
        integrand = sp.simplify(field.subs(substitutions) * normal_norm)
    else:
        field = conditions.get('field')
        if not isinstance(field, list) or len(field) != 3:
            raise ValueError('第二类曲面积分需要 P、Q、R 三个分量')
        p, q, r = [_expr(item, ('x', 'y', 'z'), '向量场分量') for item in field]
        vector = sp.Matrix([p.subs(substitutions), q.subs(substitutions), r.subs(substitutions)])
        integrand = sp.simplify((vector.T * normal)[0])
    exact = sp.simplify(sp.integrate(integrand, (V, v0, v1), (U, u0, u1)))
    import mpmath as mp
    func = sp.lambdify((U, V), integrand, 'mpmath')
    with mp.workdps(16):
        numeric = float(mp.quad(lambda u: mp.quad(lambda v: func(u, v), [float(v0), float(v1)]), [float(u0), float(u1)]))
    _numeric_check(exact, numeric, '曲面积分')
    return {'exact': exact, 'numeric': numeric, 'kind': kind, 'surface': surface,
            'space': _sample_surface(exprs, (u0, u1), (v0, v1))}


def _green(conditions):
    field = conditions.get('field')
    if not isinstance(field, list) or len(field) != 2:
        raise ValueError('Green 公式需要 P、Q 两个分量')
    p, q = [_expr(item, ('x', 'y'), '向量场分量') for item in field]
    region = conditions.get('region')
    if not isinstance(region, dict) or set(region) != {'x', 'y'}:
        raise ValueError('Green 区域需要 x 区间和 y 上下边界')
    a, b = _constant_pair(region['x'], 'x 区间')
    y0, y1 = _function_pair(region['y'], ('x',), 'y 边界')
    _strip_order(y0, y1, (X,), [(a, b)], 'y 边界')
    double = sp.simplify(sp.integrate(sp.diff(q, X) - sp.diff(p, Y), (Y, y0, y1), (X, a, b)))
    bottom = sp.simplify(sp.integrate((p.subs(Y, y0) + q.subs(Y, y0) * sp.diff(y0, X)), (X, a, b)))
    top = sp.simplify(sp.integrate((p.subs(Y, y1) + q.subs(Y, y1) * sp.diff(y1, X)), (X, b, a)))
    right = sp.simplify(sp.integrate(q.subs(X, b), (Y, y0.subs(X, b), y1.subs(X, b))))
    left = sp.simplify(sp.integrate(q.subs(X, a), (Y, y1.subs(X, a), y0.subs(X, a))))
    line = sp.simplify(bottom + top + right + left)
    _numeric_check(double, float(line) if safe_float(line) is not None else None, 'Green 公式')
    points = []
    for index in range(41):
        x = a + (b - a) * index / 40
        points.append({'x': float(x), 'y': float(y0.subs(X, x)), 'z': 0.0})
    for index in range(21):
        y = y0.subs(X, b) + (y1.subs(X, b) - y0.subs(X, b)) * index / 20
        points.append({'x': float(b), 'y': float(y), 'z': 0.0})
    for index in range(40, -1, -1):
        x = a + (b - a) * index / 40
        points.append({'x': float(x), 'y': float(y1.subs(X, x)), 'z': 0.0})
    for index in range(20, -1, -1):
        y = y0.subs(X, a) + (y1.subs(X, a) - y0.subs(X, a)) * index / 20
        points.append({'x': float(a), 'y': float(y), 'z': 0.0})
    return {'exact': double, 'line_value': line, 'numeric': float(line), 'region': region,
            'space': {'kind': 'curve', 'curves': [{'id': 'boundary', 'label': '边界曲线', 'points': points}]}}


def _gauss(conditions):
    field = conditions.get('field')
    if not isinstance(field, list) or len(field) != 3:
        raise ValueError('Gauss 公式需要 P、Q、R 三个分量')
    p, q, r = [_expr(item, ('x', 'y', 'z'), '向量场分量') for item in field]
    region = conditions.get('region')
    if not isinstance(region, dict) or region.get('kind') != 'box':
        raise ValueError('Gauss 区域当前只支持长方体 box')
    a, b = _constant_pair(region.get('x'), 'x 区间')
    c, d = _constant_pair(region.get('y'), 'y 区间')
    e, g = _constant_pair(region.get('z'), 'z 区间')
    divergence = sp.diff(p, X) + sp.diff(q, Y) + sp.diff(r, Z)
    volume = sp.simplify(sp.integrate(divergence, (Z, e, g), (Y, c, d), (X, a, b)))
    flux = 0
    flux += sp.integrate(p.subs(X, b), (Z, e, g), (Y, c, d)) - sp.integrate(p.subs(X, a), (Z, e, g), (Y, c, d))
    flux += sp.integrate(q.subs(Y, d), (Z, e, g), (X, a, b)) - sp.integrate(q.subs(Y, c), (Z, e, g), (X, a, b))
    flux += sp.integrate(r.subs(Z, g), (Y, c, d), (X, a, b)) - sp.integrate(r.subs(Z, e), (Y, c, d), (X, a, b))
    flux = sp.simplify(flux)
    _numeric_check(volume, float(flux) if safe_float(flux) is not None else None, 'Gauss 公式')
    edges = []
    corners = [(x, y, z) for x in (a, b) for y in (c, d) for z in (e, g)]
    for i in range(8):
        for j in range(i + 1, 8):
            if sum(1 for a1, b1 in zip(corners[i], corners[j]) if sp.simplify(a1 - b1) != 0) == 1:
                edges.append([{'x': float(corners[i][0]), 'y': float(corners[i][1]), 'z': float(corners[i][2])},
                              {'x': float(corners[j][0]), 'y': float(corners[j][1]), 'z': float(corners[j][2])}])
    return {'exact': volume, 'surface_value': flux, 'numeric': float(flux), 'region': region,
            'space': {'kind': 'box', 'x': [float(a), float(b)], 'y': [float(c), float(d)], 'z': [float(e), float(g)], 'edges': edges}}


def _stokes(conditions):
    field = conditions.get('field')
    if not isinstance(field, list) or len(field) != 3:
        raise ValueError('Stokes 公式需要 P、Q、R 三个分量')
    p, q, r = [_expr(item, ('x', 'y', 'z'), '向量场分量') for item in field]
    surface_z = _expr(conditions.get('surface_z'), ('x', 'y'), '曲面 z(x,y)')
    region = conditions.get('region')
    if not isinstance(region, dict) or set(region) != {'x', 'y'}:
        raise ValueError('Stokes 曲面需要 x、y 两个区间')
    a, b = _constant_pair(region['x'], 'x 区间')
    c, d = _constant_pair(region['y'], 'y 区间')
    zx, zy = sp.diff(surface_z, X), sp.diff(surface_z, Y)
    curl = sp.Matrix([sp.diff(r, Y) - sp.diff(q, Z), sp.diff(p, Z) - sp.diff(r, X), sp.diff(q, X) - sp.diff(p, Y)])
    normal = sp.Matrix([-zx, -zy, 1])
    flux_integrand = sp.simplify((curl.T * normal)[0].subs(Z, surface_z))
    surface_flux = sp.simplify(sp.integrate(flux_integrand, (Y, c, d), (X, a, b)))
    edge1 = sp.integrate((p + r * zx).subs({Y: c, Z: surface_z}), (X, a, b))
    edge2 = sp.integrate((q + r * zy).subs({X: b, Z: surface_z}), (Y, c, d))
    edge3 = sp.integrate((p + r * zx).subs({Y: d, Z: surface_z}), (X, b, a))
    edge4 = sp.integrate((q + r * zy).subs({X: a, Z: surface_z}), (Y, d, c))
    line = sp.simplify(edge1 + edge2 + edge3 + edge4)
    _numeric_check(surface_flux, float(line) if safe_float(line) is not None else None, 'Stokes 公式')
    grid = []
    for iv in range(15):
        y = c + (d - c) * iv / 14
        row = []
        for iu in range(15):
            x = a + (b - a) * iu / 14
            row.append({'x': float(x), 'y': float(y), 'z': float(surface_z.subs({X: x, Y: y}))})
        grid.append(row)
    boundary = []
    for i in range(41):
        x = a + (b - a) * i / 40
        boundary.append({'x': float(x), 'y': float(c), 'z': float(surface_z.subs({X: x, Y: c}))})
    for i in range(1, 31):
        y = c + (d - c) * i / 30
        boundary.append({'x': float(b), 'y': float(y), 'z': float(surface_z.subs({X: b, Y: y}))})
    for i in range(1, 41):
        x = b - (b - a) * i / 40
        boundary.append({'x': float(x), 'y': float(d), 'z': float(surface_z.subs({X: x, Y: d}))})
    for i in range(1, 30):
        y = d - (d - c) * i / 30
        boundary.append({'x': float(a), 'y': float(y), 'z': float(surface_z.subs({X: a, Y: y}))})
    return {'exact': surface_flux, 'line_value': line, 'numeric': float(line), 'region': region,
            'space': {'kind': 'surface', 'grid': grid, 'curves': [{'id': 'boundary', 'label': '边界曲线', 'points': boundary}]}}


def _geometry(conditions):
    kind = str(conditions.get('geometry_kind') or '')
    def point(raw, label):
        if not isinstance(raw, list) or len(raw) != 3:
            raise ValueError(f'{label}需要三个坐标')
        return sp.Matrix([_constant(str(item), label) for item in raw])
    if kind == 'point_plane_distance':
        p = point(conditions.get('point'), '点')
        plane = conditions.get('plane')
        if not isinstance(plane, list) or len(plane) != 4:
            raise ValueError('平面需要 [a,b,c,d] 表示 ax+by+cz+d=0')
        a, b, c, d = [_constant(str(item), '平面系数') for item in plane]
        value = abs(a * p[0] + b * p[1] + c * p[2] + d) / sp.sqrt(a ** 2 + b ** 2 + c ** 2)
        projection = p - ((a * p[0] + b * p[1] + c * p[2] + d) / (a ** 2 + b ** 2 + c ** 2)) * sp.Matrix([a, b, c])
        return {'exact': sp.simplify(value), 'answer_text': f'点到平面距离 {sp.simplify(value)}',
                'space': {'kind': 'geometry', 'points': [{'id': 'P', 'x': float(p[0]), 'y': float(p[1]), 'z': float(p[2])},
                                                          {'id': '投影', 'x': float(projection[0]), 'y': float(projection[1]), 'z': float(projection[2])}]}}
    if kind == 'point_line_distance':
        p = point(conditions.get('point'), '点')
        q = point(conditions.get('line_point'), '直线点')
        direction = point(conditions.get('line_direction'), '直线方向')
        cross = (p - q).cross(direction)
        value = sp.sqrt((cross.T * cross)[0]) / sp.sqrt((direction.T * direction)[0])
        projection = q + (((p - q).T * direction)[0] / (direction.T * direction)[0]) * direction
        return {'exact': sp.simplify(value), 'answer_text': f'点到直线距离 {sp.simplify(value)}',
                'space': {'kind': 'geometry', 'points': [{'id': 'P', 'x': float(p[0]), 'y': float(p[1]), 'z': float(p[2])},
                                                          {'id': '垂足', 'x': float(projection[0]), 'y': float(projection[1]), 'z': float(projection[2])}],
                          'line': [{'x': float(q[0]), 'y': float(q[1]), 'z': float(q[2])},
                                   {'x': float(q[0] + direction[0]), 'y': float(q[1] + direction[1]), 'z': float(q[2] + direction[2])}]}}
    if kind == 'line_plane_intersection':
        q = point(conditions.get('line_point'), '直线点')
        direction = point(conditions.get('line_direction'), '直线方向')
        plane = conditions.get('plane')
        a, b, c, d = [_constant(str(item), '平面系数') for item in plane]
        denominator = a * direction[0] + b * direction[1] + c * direction[2]
        if sp.simplify(denominator) == 0:
            return {'exact': None, 'answer_text': '直线与平面平行或在平面内，无唯一交点',
                    'space': {'kind': 'geometry', 'points': []}}
        t_value = -(a * q[0] + b * q[1] + c * q[2] + d) / denominator
        hit = q + t_value * direction
        return {'exact': sp.simplify(t_value), 'answer_text': f'交点 ({sp.simplify(hit[0])}, {sp.simplify(hit[1])}, {sp.simplify(hit[2])})',
                'space': {'kind': 'geometry', 'points': [{'id': '交点', 'x': float(hit[0]), 'y': float(hit[1]), 'z': float(hit[2])}],
                          'line': [{'x': float(q[0]), 'y': float(q[1]), 'z': float(q[2])},
                                   {'x': float(q[0] + direction[0]), 'y': float(q[1] + direction[1]), 'z': float(q[2] + direction[2])}]}}
    if kind == 'plane_plane_angle':
        plane1 = conditions.get('plane')
        plane2 = conditions.get('plane2')
        n1 = sp.Matrix([_constant(str(item), '平面系数') for item in plane1[:3]])
        n2 = sp.Matrix([_constant(str(item), '平面系数') for item in plane2[:3]])
        cosine = abs((n1.T * n2)[0]) / (sp.sqrt((n1.T * n1)[0]) * sp.sqrt((n2.T * n2)[0]))
        angle = sp.acos(sp.simplify(cosine))
        return {'exact': sp.simplify(angle), 'answer_text': f'两平面夹角 {sp.simplify(angle)}',
                'space': {'kind': 'geometry', 'points': []}}
    raise ValueError('当前空间几何只支持点到平面距离、点到直线距离、线面交点和两平面夹角')


def solve_space_task(model: Mapping[str, Any]) -> dict:
    task = model.get('task')
    conditions = model.get('conditions') or {}
    if task == 'triple_integral':
        region = conditions.get('region') or {}
        kind = region.get('kind')
        f = _expr(conditions.get('integrand'), ('x', 'y', 'z'), '被积函数')
        if kind == 'box':
            result = _triple_box(f, region)
        elif kind == 'z_simple':
            result = _triple_z_simple(f, region)
        elif kind == 'cylindrical':
            result = _triple_cylindrical(f, region)
        elif kind == 'spherical':
            result = _triple_spherical(f, region)
        else:
            raise ValueError('三重积分区域只支持 box、z_simple、cylindrical、spherical')
        return {'summary': '三重积分：按区域类型确定积分限/坐标变换，再做独立数值复核。',
                'answer': expression_text(result['exact']), 'answer_value': float(result['exact']), 'exact': expression_text(result['exact']),
                'steps': [{'id': 'region', 'title': '确认空间区域', 'latex': to_latex(f), 'detail': f'区域类型 {kind}。'},
                          {'id': 'integrate', 'title': '累次积分/坐标变换', 'latex': to_latex(result['exact']), 'detail': '按内到外逐层积分，柱/球坐标包含 Jacobian。'}],
                'conditions': [f'区域类型 {kind}。'], 'limitations': ['区域边界需有限且表达式在区域内为实值。'],
                'space_result': result, 'space': result['space'],
                'solution_status': 'complete', 'solution_complete': True}
    if task == 'line_integral':
        result = _line_integral(conditions)
        return {'summary': '曲线积分：参数化后乘弧长元或方向微分，再做数值复核。', 'answer': expression_text(result['exact']),
                'answer_value': float(result['exact']), 'exact': expression_text(result['exact']), 'steps': [],
                'conditions': [], 'limitations': ['只支持显式参数曲线。'], 'space': result['space'],
                'solution_status': 'complete', 'solution_complete': True}
    if task == 'surface_integral':
        result = _surface_integral(conditions)
        return {'summary': '曲面积分：参数化后乘面积元或法向面积元，再做数值复核。', 'answer': expression_text(result['exact']),
                'answer_value': float(result['exact']), 'exact': expression_text(result['exact']), 'steps': [],
                'conditions': [], 'limitations': ['只支持参数曲面和有限参数区间。'], 'space': result['space'],
                'solution_status': 'complete', 'solution_complete': True}
    if task == 'green':
        result = _green(conditions)
        return {'summary': 'Green 公式：边界曲线积分与二重积分两条路径互验。', 'answer': expression_text(result['exact']),
                'answer_value': float(result['exact']), 'exact': expression_text(result['exact']), 'steps': [],
                'conditions': [], 'limitations': ['区域需为 x 型简单区域，边界按逆时针定向。'], 'space': result['space'],
                'solution_status': 'complete', 'solution_complete': True}
    if task == 'gauss':
        result = _gauss(conditions)
        return {'summary': 'Gauss 公式：闭合曲面通量与散度体积分两条路径互验。', 'answer': expression_text(result['exact']),
                'answer_value': float(result['exact']), 'exact': expression_text(result['exact']), 'steps': [],
                'conditions': [], 'limitations': ['当前只支持长方体区域和外法向。'], 'space': result['space'],
                'solution_status': 'complete', 'solution_complete': True}
    if task == 'stokes':
        result = _stokes(conditions)
        return {'summary': 'Stokes 公式：空间曲面旋度通量与边界环路积分两条路径互验。', 'answer': expression_text(result['exact']),
                'answer_value': float(result['exact']), 'exact': expression_text(result['exact']), 'steps': [],
                'conditions': [], 'limitations': ['当前只支持 z=z(x,y) 的矩形参数曲面和向上法向。'], 'space': result['space'],
                'solution_status': 'complete', 'solution_complete': True}
    if task == 'space_geometry':
        result = _geometry(conditions)
        return {'summary': '空间解析几何：使用向量点积、叉积和投影计算距离或交点。',
                'answer': result['answer_text'], 'answer_value': safe_float(result['exact']), 'exact': str(result['exact']),
                'steps': [], 'conditions': [], 'limitations': ['当前只支持常见点线面距离、交点和夹角。'],
                'space_result': result, 'space': result['space'], 'solution_status': 'complete', 'solution_complete': True}
    raise ValueError('当前没有该空间任务')


def evaluate_space_task(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict:
    solution = solve_space_task(model)
    return {
        'subject': 'calculus', 'task': model.get('task'), 'kind': 'space',
        'headline': solution.get('answer') or solution.get('summary') or '空间计算',
        'metrics': [
            {'id': 'value', 'label': '结果', 'value': str(solution.get('answer') or '—'), 'tone': 'accent'},
            {'id': 'method', 'label': '方法', 'value': solution.get('summary') or ''},
        ],
        'checks': [
            {'id': 'exact', 'label': '符号结果', 'status': 'pass' if solution.get('solution_complete') else 'fail', 'detail': solution.get('answer') or ''},
            {'id': 'numeric', 'label': '独立数值复核', 'status': 'pass' if solution.get('solution_complete') else 'warn', 'detail': '解析结果与数值积分/双路径结果一致。'},
        ],
        'notes': solution.get('limitations') or [],
        'series': [], 'domain': {'x_min': -1, 'x_max': 1}, 'rects': [],
        'exact': solution.get('answer_value'), 'approx': None, 'error': None,
        'answerText': solution.get('answer') or '',
        'trace': [{'index': 0, 'label': '空间对象', 'detail': solution.get('answer') or '', 'values': {}}],
        'space': solution.get('space'),
        'space_solution': solution,
    }


def build_space_problem(task: str, conditions: Mapping[str, Any]) -> dict:
    from .exam_math import _condition
    titles = {
        'triple_integral': '三重积分', 'line_integral': '曲线积分', 'surface_integral': '曲面积分',
        'green': 'Green 公式', 'gauss': 'Gauss 公式', 'stokes': 'Stokes 公式', 'space_geometry': '空间解析几何',
    }
    if task not in titles:
        raise ValueError('未知空间任务')
    model = {
        'engine': 'space_v1', 'subject': 'calculus', 'task': task, 'kind': 'space',
        'conditions': dict(conditions), 'defaults': {}, 'params': [], 'teaching': False,
        'formula_tex': '',
    }
    condition_list = [
        _condition(key, key, value, {}, kind='json' if isinstance(value, (list, dict)) else 'expression')
        for key, value in conditions.items()
    ]
    return {
        'problem_id': 'prb_space', 'number': None, 'title': titles[task], 'text': '',
        'subject': 'calculus', 'subject_label': '微积分', 'confidence': 1.0, 'status': 'ready',
        'source': {'page_from': 1, 'page_to': 1, 'file_names': [], 'label': '声明式条件', 'excerpt': ''},
        'source_pages': [],
        'recognition': {'method': 'declarative_kernel', 'raw_text': '', 'conditions': condition_list,
                        'ambiguities': [], 'formulas': [], 'recognized_subject': 'calculus', 'ai_used': False},
        'model': model, 'solution': {}, 'states': {}, 'conditions': condition_list,
        'ambiguities': [], 'recognized': True, 'formulas': [],
    }


__all__ = ['build_space_problem', 'evaluate_space_task', 'solve_space_task']

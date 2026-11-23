"""Independent check of the five algebraic claims in a ring walkthrough."""
from dataclasses import dataclass
from math import factorial
import re

import sympy as sp

from ..ai_solve import _expr, _polynomial_syntax
from ..expr import parse_expression
from ..space import _require_domain_on_range
from .pattern_router import Surface, Z, radius_squared

X, Y = sp.symbols('x y', real=True)


@dataclass
class Derived:
    lower: sp.Expr
    upper: sp.Expr
    scale: sp.Expr
    field: list[sp.Expr]
    claims: dict[str, sp.Expr]


def _constant(value):
    result = _expr(value, ['z'])
    if result.free_symbols or result.is_real is not True or not -1000 <= result <= 1000:
        raise ValueError('曲面参数必须是有限实常数，绝对值不超过 1000')
    return result


def _ring_average(expr, radius2):
    total = sp.S.Zero
    for (i, j, k), coefficient in sp.Poly(expr, X, Y, Z).terms():
        if i % 2 == 0 and j % 2 == 0:
            moment = sp.Rational(factorial(i)*factorial(j),
                                 2**(i+j)*factorial(i//2)*factorial(j//2)*factorial((i+j)//2))
            total += coefficient * moment * radius2**((i+j)//2) * Z**k
    return sp.expand(total)


def _degree(expr):
    if not expr.free_symbols:
        return 0
    if expr.is_Symbol:
        return 1
    if expr.is_Add:
        return max(map(_degree, expr.args))
    if expr.is_Mul:
        return sum(map(_degree, expr.args))
    if expr.is_Pow and expr.exp.is_Integer and 0 <= expr.exp <= 6:
        return int(expr.exp) * _degree(expr.base)
    return 7


def derive(surface: Surface) -> Derived:
    scale, lower, upper = map(_constant, (surface.scale, surface.lower, surface.upper))
    if scale < sp.Rational(1, 1000) or upper - lower < sp.Rational(1, 1000):
        raise ValueError('尺度与高度范围需要为正且可绘制')
    family = surface.family
    if ((family in ('sphere', 'hemisphere') and (lower < -scale or upper > scale))
            or (family == 'hemisphere' and lower < 0 < upper)
            or (family in ('cone', 'paraboloid') and lower < 0)):
        raise ValueError('积分高度超出所选曲面')
    if len(surface.field) not in (1, 3):
        raise ValueError('被积函数为一个标量或三个向量场分量')
    field = []
    for raw in surface.field:
        _polynomial_syntax(raw, ['x', 'y', 'z'])
        expr = _expr(raw, ['x', 'y', 'z'])
        # Check before Poly expands the input.
        if _degree(expr) > 6:
            raise ValueError('首批环带过程仅支持六次以内的多项式场')
        if any(value.is_real is not True or value.is_finite is not True
               for value in sp.Poly(expr, X, Y, Z).coeffs()):
            raise ValueError('被积函数的系数必须是有限实数')
        field.append(expr)

    radius2 = sp.expand(radius_squared(family, scale))
    slope = sp.diff(radius2, Z)/2
    metric_squared = sp.expand(radius2 + slope**2)
    metric = sp.sqrt(metric_squared)
    if family == 'cone':
        metric = sp.sqrt(metric_squared.coeff(Z, 2)) * Z
    if len(field) == 1:
        average = _ring_average(field[0], radius2)
        density = 2*sp.pi*average*metric
    else:
        average = _ring_average(X*field[0]+Y*field[1]-slope*field[2], radius2)
        density = 2*sp.pi*surface.orientation*average

    # A paraboloid metric is the square root of a linear polynomial. The
    # substitution t = metric² leaves a finite sum of monomials in t.
    if len(field) == 1 and family == 'paraboloid':
        t = sp.Symbol('t', real=True)
        a = metric_squared.coeff(Z)
        b = metric_squared.subs(Z, 0)
        integral = sum(c*t**(i+sp.Rational(3, 2))/(i+sp.Rational(3, 2))
                       for (i,), c in sp.Poly(average.subs(Z, (t-b)/a), t).terms())
        primitive = 2*sp.pi*sp.sympify(integral).subs(t, metric_squared)/a
    else:
        primitive = sp.integrate(sp.expand(density), Z)
    primitive = sp.factor(primitive)
    exact = sp.simplify(primitive.subs(Z, upper) - primitive.subs(Z, lower))
    if exact.is_real is not True or exact.is_finite is not True:
        raise ValueError('无法得到有限、可核验的积分值')
    return Derived(lower, upper, scale, field, {
        'radius_squared': radius2, 'metric': metric, 'density': sp.factor(density),
        'primitive': primitive, 'exact': exact,
    })


def verify(derived: Derived, claims: dict[str, str]):
    results = {}
    for key, raw in claims.items():
        expected = derived.claims[key]
        try:
            if raw == str(expected):
                correct = True
            else:
                # Expected results use algebraic expressions only. Keep expensive
                # transcendental identities outside the allowed claim format.
                if not re.fullmatch(r'[0-9piqrtsz+*/^(). \-]+', raw) or any(
                        token not in ('pi', 'sqrt', 'z') for token in re.findall(r'[a-z]+', raw)):
                    raise ValueError('需要 z、pi、sqrt 和常数构成的代数式')
                candidate = parse_expression(raw, ['z'], preserve_structure=True)
                if key == 'exact' and candidate.free_symbols:
                    raise ValueError('最终值不能依赖 z')
                _require_domain_on_range(candidate, Z, sp.Interval(derived.lower, derived.upper), key)
                difference = _expr(raw, ['z']) - expected
                if key == 'primitive':
                    difference = sp.diff(difference, Z)
                difference = sp.factor(difference)
                correct = difference == 0 or sp.simplify(difference) == 0
        except (TypeError, ValueError, ArithmeticError):
            correct = False
        results[key] = {'id': key, 'status': 'verified' if correct else 'unverified'}
        if not correct:
            results[key]['detail'] = f'模型给出 {raw}，重新计算为 {expected}'
    return results

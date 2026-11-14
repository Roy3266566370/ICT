"""Proof support: theorem certificates, inequality certificates, counterexamples and local steps."""
from __future__ import annotations

import math
from typing import Any, Mapping

import sympy as sp
from sympy.calculus.util import continuous_domain

from .expr import expression_text, parse_expression, safe_float, to_latex

X = sp.Symbol('x', real=True)
PROOF_KINDS = ('ivt_root', 'ivt_unique_root', 'rolle', 'mvt', 'cauchy_mvt',
               'monotone_inequality', 'inequality', 'counterexample', 'steps')


def _expr(raw: Any, label: str, variable='x') -> sp.Expr:
    if not isinstance(raw, str) or not 1 <= len(raw) <= 600:
        raise ValueError(f'{label}必须是600字以内的表达式')
    value = parse_expression(raw, (variable,), preserve_structure=True)
    if sp.count_ops(value) > 100:
        raise ValueError(f'{label}超出证明计算预算')
    return value


def _constant(raw: Any, label: str) -> sp.Expr:
    value = _expr(raw, label)
    if value.free_symbols or safe_float(value) is None:
        raise ValueError(f'{label}必须是有限实数')
    return value


def _interval(conditions: Mapping[str, Any]) -> tuple[sp.Expr, sp.Expr]:
    a = _constant(str(conditions.get('lower') or 0), '区间下限')
    b = _constant(str(conditions.get('upper') or 1), '区间上限')
    if not bool(a < b):
        raise ValueError('证明区间必须从小到大')
    return a, b


def _continuous_on(expression: sp.Expr, a: sp.Expr, b: sp.Expr) -> bool:
    try:
        domain = continuous_domain(expression, X, sp.Interval(a, b))
        return sp.Interval(a, b).is_subset(domain) is True
    except Exception:  # noqa: BLE001
        return False


def _differentiable_on(expression: sp.Expr, a: sp.Expr, b: sp.Expr) -> bool:
    try:
        derivative = sp.diff(expression, X)
        domain = continuous_domain(derivative, X, sp.Interval.open(a, b))
        return sp.Interval.open(a, b).is_subset(domain) is True
    except Exception:  # noqa: BLE001
        return False


def _endpoint_sign(value: sp.Expr) -> str | None:
    simplified = sp.simplify(value)
    if safe_float(simplified) is None:
        return None
    if simplified == 0:
        return 'zero'
    if simplified.is_positive is True:
        return 'positive'
    if simplified.is_negative is True:
        return 'negative'
    return None


def _defined_at(expression: sp.Expr, point: sp.Expr) -> bool:
    try:
        domain = continuous_domain(expression, X, sp.Interval(point, point))
        return sp.Interval(point, point).is_subset(domain) is True
    except Exception:  # noqa: BLE001
        return False


def _obligation(oid: str, label: str, passed: bool, detail: str) -> dict[str, Any]:
    return {'id': oid, 'label': label, 'status': 'pass' if passed else 'fail', 'detail': detail}


def _base_result(proof_kind: str, status: str, level: str, obligations: list[dict], certificate: dict, answer: str, reason: str = '') -> dict:
    complete = status in ('verified', 'disproved')
    return {
        'summary': {
            'verified': '定理条件已逐项核验，给出可复核的证明证书。',
            'disproved': '反例代入成立，原全称命题被否定。',
            'local_steps_verified': '局部等式/代数步骤已核对，但整体证明结构未认证。',
            'invalid': '证明义务或条件不成立，当前证明尝试无效。',
            'unverified': '当前内核不能认证该证明，只提供条件核对与辅助说明。',
        }[status],
        'answer': answer,
        'answer_value': None,
        'exact': answer,
        'approx': None,
        'steps': obligations,
        'conditions': [],
        'limitations': [
            '证明题不以数值抽样代替证明；定理证书只核验模板条件与结论。',
            '局部等式步骤通过不等于整段证明逻辑成立；未认证结果不能自动判分。',
        ],
        'proof_kind': proof_kind, 'proof_status': status, 'verification_level': level,
        'obligations': obligations, 'certificate': certificate, 'incomplete_reason': reason or None,
        'solution_status': 'complete' if complete else 'incomplete',
        'solution_complete': complete,
    }


def _ivt(expression: sp.Expr, a: sp.Expr, b: sp.Expr) -> dict:
    continuous = _continuous_on(expression, a, b)
    fa, fb = sp.simplify(expression.subs(X, a)), sp.simplify(expression.subs(X, b))
    fa_num, fb_num = safe_float(fa), safe_float(fb)
    obligations = [
        _obligation('domain', '区间上连续', continuous, f'连续域检查：{continuous}。'),
        _obligation('endpoints', '端点函数值有限', fa_num is not None and fb_num is not None, f'f({a})={fa}，f({b})={fb}。'),
    ]
    fa_sign, fb_sign = _endpoint_sign(fa), _endpoint_sign(fb)
    endpoint_zero = fa_sign == 'zero' or fb_sign == 'zero'
    sign_change = (
        fa_sign is not None and fb_sign is not None
        and (endpoint_zero or {fa_sign, fb_sign} == {'positive', 'negative'})
    )
    obligations.append(_obligation('sign_change', '端点异号或端点为零', sign_change,
                                   f'f(a)={fa}（{fa_sign}），f(b)={fb}（{fb_sign}）。'))
    certificate = {'theorem': '介值定理', 'expression': expression_text(expression), 'interval': [str(a), str(b)],
                   'endpoint_zero': endpoint_zero, 'conclusion': '存在 c∈[a,b] 使 f(c)=0'}
    if not continuous or fa_num is None or fb_num is None:
        return _base_result('ivt_root', 'invalid', 'not_certified', obligations, certificate,
                            '证明条件不成立：函数在区间上不连续或端点无定义', '介值定理条件不成立')
    if sign_change:
        where = f'[{a},{b}]（零点可在端点）' if endpoint_zero else f'({a},{b})'
        answer = (f'已认证（介值定理证书）：{expression_text(expression)} 在 [{a},{b}] 上连续且端点异号/为零，'
                  f'因此存在 c∈{where} 使 f(c)=0。')
        return _base_result('ivt_root', 'verified', 'kernel_certificate', obligations, certificate, answer)
    return _base_result('ivt_root', 'unverified', 'not_certified', obligations, certificate,
                        '未认证：介值定理只给出存在性充分条件，端点同号不能据此排除区间内有根。',
                        '端点同号，当前证书不能证明根的存在')


def _rolle(expression: sp.Expr, a: sp.Expr, b: sp.Expr) -> dict:
    continuous = _continuous_on(expression, a, b)
    differentiable = _differentiable_on(expression, a, b)
    fa, fb = sp.simplify(expression.subs(X, a)), sp.simplify(expression.subs(X, b))
    equal = sp.simplify(fa - fb) == 0
    obligations = [
        _obligation('continuous', '闭区间连续', continuous, f'连续域检查：{continuous}。'),
        _obligation('differentiable', '开区间可导', differentiable, f'导数连续域检查：{differentiable}。'),
        _obligation('equal_endpoints', '端点函数值相等', equal, f'f(a)={fa}，f(b)={fb}。'),
    ]
    certificate = {'theorem': '罗尔定理', 'expression': expression_text(expression), 'interval': [str(a), str(b)],
                   'conclusion': '存在 c∈(a,b) 使 f\'(c)=0'}
    if not continuous or not differentiable:
        return _base_result('rolle', 'invalid', 'not_certified', obligations, certificate,
                            '证明条件不成立：闭区间连续或开区间可导未满足', '罗尔定理条件不成立')
    if not equal:
        return _base_result('rolle', 'unverified', 'not_certified', obligations, certificate,
                            '未认证：端点函数值不相等，不能直接使用罗尔定理。', '端点函数值不相等')
    witnesses: list[str] = []
    try:
        roots = sp.solveset(sp.diff(expression, X), X, domain=sp.Interval.open(a, b))
        if isinstance(roots, sp.FiniteSet):
            witnesses = [str(sp.simplify(root)) for root in roots]
    except Exception:  # noqa: BLE001
        witnesses = []
    certificate['witnesses'] = witnesses
    answer = f'已认证（罗尔定理证书）：f 在 [{a},{b}] 连续、在 ({a},{b}) 可导且 f(a)=f(b)，因此存在 c∈({a},{b}) 使 f\'(c)=0。'
    if witnesses:
        answer += ' 可选零点：' + '、'.join(witnesses) + '。'
    return _base_result('rolle', 'verified', 'kernel_certificate', obligations, certificate, answer)


def _mvt(expression: sp.Expr, a: sp.Expr, b: sp.Expr) -> dict:
    continuous = _continuous_on(expression, a, b)
    differentiable = _differentiable_on(expression, a, b)
    fa, fb = sp.simplify(expression.subs(X, a)), sp.simplify(expression.subs(X, b))
    obligations = [
        _obligation('continuous', '闭区间连续', continuous, f'连续域检查：{continuous}。'),
        _obligation('differentiable', '开区间可导', differentiable, f'导数连续域检查：{differentiable}。'),
    ]
    certificate = {'theorem': '拉格朗日中值定理', 'expression': expression_text(expression), 'interval': [str(a), str(b)],
                   'slope': expression_text(sp.simplify((fb - fa) / (b - a))),
                   'conclusion': '存在 c∈(a,b) 使 f\'(c)=(f(b)-f(a))/(b-a)'}
    if not continuous or not differentiable:
        return _base_result('mvt', 'invalid', 'not_certified', obligations, certificate,
                            '证明条件不成立：闭区间连续或开区间可导未满足', '中值定理条件不成立')
    answer = f'已认证（拉格朗日中值定理证书）：f 在 [{a},{b}] 连续、在 ({a},{b}) 可导，因此存在 c∈({a},{b})，使 f\'(c)={(fb-fa)/(b-a)}。'
    return _base_result('mvt', 'verified', 'kernel_certificate', obligations, certificate, answer)


def _monotone_inequality(expression: sp.Expr, a: sp.Expr, b: sp.Expr) -> dict:
    continuous = _continuous_on(expression, a, b)
    derivative = sp.simplify(sp.diff(expression, X))
    try:
        nonnegative = sp.solve_univariate_inequality(derivative >= 0, X, relational=False)
        increasing = sp.Interval.open(a, b).is_subset(nonnegative) is True
    except Exception:  # noqa: BLE001
        increasing = False
    try:
        nonpositive = sp.solve_univariate_inequality(derivative <= 0, X, relational=False)
        decreasing = sp.Interval.open(a, b).is_subset(nonpositive) is True
    except Exception:  # noqa: BLE001
        decreasing = False
    left_exact, right_exact = sp.simplify(expression.subs(X, a)), sp.simplify(expression.subs(X, b))
    left_nonnegative, right_nonnegative = left_exact.is_nonnegative is True, right_exact.is_nonnegative is True
    obligations = [
        _obligation('continuous', '区间上连续', continuous, f'连续域检查：{continuous}。'),
        _obligation('derivative', '单调性证书', increasing or decreasing,
                    f'f\'={derivative}；递增：{increasing}，递减：{decreasing}。'),
        _obligation('endpoint', '起点/终点非负', (increasing and left_nonnegative)
                    or (decreasing and right_nonnegative),
                    f'f(a)={left_exact}，f(b)={right_exact}。'),
    ]
    verified = continuous and obligations[1]['status'] == 'pass' and obligations[2]['status'] == 'pass'
    certificate = {'theorem': '单调性判别', 'expression': expression_text(expression),
                   'interval': [str(a), str(b)], 'conclusion': 'f(x)≥0 在区间上成立',
                   'derivative': expression_text(derivative), 'increasing': increasing, 'decreasing': decreasing}
    if verified:
        answer = f'已认证（单调性证书）：f\' 在 ({a},{b}) 上保持符号且非负端点成立，因此 f(x)≥0 在 [{a},{b}] 上成立。'
        return _base_result('monotone_inequality', 'verified', 'kernel_certificate', obligations, certificate, answer)
    return _base_result('monotone_inequality', 'unverified', 'not_certified', obligations, certificate,
                        '未认证：当前单调性证书条件不足，不能据此断言不等式。', '单调性证书条件不足')


def _strict_monotone(expression: sp.Expr, a: sp.Expr, b: sp.Expr) -> tuple[sp.Expr, bool, bool]:
    derivative = sp.simplify(sp.diff(expression, X))
    interval = sp.Interval.open(a, b)
    try:
        increasing = interval.is_subset(
            sp.solve_univariate_inequality(derivative > 0, X, relational=False)) is True
    except Exception:  # noqa: BLE001
        increasing = False
    try:
        decreasing = interval.is_subset(
            sp.solve_univariate_inequality(derivative < 0, X, relational=False)) is True
    except Exception:  # noqa: BLE001
        decreasing = False
    return derivative, increasing, decreasing


def _ivt_unique(expression: sp.Expr, a: sp.Expr, b: sp.Expr) -> dict:
    continuous = _continuous_on(expression, a, b)
    fa, fb = sp.simplify(expression.subs(X, a)), sp.simplify(expression.subs(X, b))
    fa_num, fb_num = safe_float(fa), safe_float(fb)
    fa_sign, fb_sign = _endpoint_sign(fa), _endpoint_sign(fb)
    endpoint_zero = fa_sign == 'zero' or fb_sign == 'zero'
    sign_change = (
        fa_sign is not None and fb_sign is not None
        and (endpoint_zero or {fa_sign, fb_sign} == {'positive', 'negative'})
    )
    derivative, increasing, decreasing = _strict_monotone(expression, a, b)
    monotone = increasing or decreasing
    obligations = [
        _obligation('domain', '闭区间连续', continuous, f'连续域检查：{continuous}。'),
        _obligation('endpoints', '端点函数值有限', fa_num is not None and fb_num is not None,
                    f'f({a})={fa}，f({b})={fb}。'),
        _obligation('sign_change', '端点异号或端点为零', sign_change,
                    f'f(a)·f(b)={fa_num}·{fb_num}。'),
        _obligation('strict_monotone', '开区间内严格单调', monotone,
                    f'f\'={derivative}；严格递增：{increasing}，严格递减：{decreasing}。'),
    ]
    certificate = {
        'theorem': '介值定理 + 严格单调性',
        'expression': expression_text(expression), 'interval': [str(a), str(b)],
        'endpoint_zero': endpoint_zero,
        'conclusion': '存在唯一 c∈[a,b] 使 f(c)=0',
        'derivative': expression_text(derivative), 'strictly_increasing': increasing,
        'strictly_decreasing': decreasing,
    }
    if not continuous or fa_num is None or fb_num is None:
        return _base_result('ivt_unique_root', 'invalid', 'not_certified', obligations, certificate,
                            '证明条件不成立：函数在区间上不连续或端点无定义', '介值定理条件不成立')
    if not sign_change:
        return _base_result('ivt_unique_root', 'unverified', 'not_certified', obligations, certificate,
                            '未认证：端点同号时介值定理不能保证区间内有根。', '端点同号，无法证明零点存在')
    if not monotone:
        return _base_result('ivt_unique_root', 'unverified', 'not_certified', obligations, certificate,
                            '未认证：已确认零点存在，但当前不能由严格单调性证明零点唯一。', '严格单调性未认证')
    direction = '严格递增' if increasing else '严格递减'
    where = f'[{a},{b}]（零点可在端点）' if endpoint_zero else f'({a},{b})'
    answer = (f'已认证（介值定理 + 严格单调性）：f 在 [{a},{b}] 连续且端点异号/为零，'
              f'又因 f 在 ({a},{b}) 上{direction}，存在唯一 c∈{where} 使 f(c)=0。')
    return _base_result('ivt_unique_root', 'verified', 'kernel_certificate', obligations, certificate, answer)


def _cauchy_mvt(f: sp.Expr, g: sp.Expr, a: sp.Expr, b: sp.Expr) -> dict:
    f_continuous = _continuous_on(f, a, b)
    g_continuous = _continuous_on(g, a, b)
    f_differentiable = _differentiable_on(f, a, b)
    g_differentiable = _differentiable_on(g, a, b)
    g_prime = sp.simplify(sp.diff(g, X))
    interval = sp.Interval.open(a, b)
    try:
        g_increasing = interval.is_subset(
            sp.solve_univariate_inequality(g_prime > 0, X, relational=False)) is True
    except Exception:  # noqa: BLE001
        g_increasing = False
    try:
        g_decreasing = interval.is_subset(
            sp.solve_univariate_inequality(g_prime < 0, X, relational=False)) is True
    except Exception:  # noqa: BLE001
        g_decreasing = False
    nonzero_derivative = g_increasing or g_decreasing
    ga, gb = sp.simplify(g.subs(X, a)), sp.simplify(g.subs(X, b))
    denominator = sp.simplify(gb - ga)
    denominator_ok = denominator != 0
    fa, fb = sp.simplify(f.subs(X, a)), sp.simplify(f.subs(X, b))
    obligations = [
        _obligation('f_continuous', 'f 在闭区间连续', f_continuous, f'连续域检查：{f_continuous}。'),
        _obligation('g_continuous', 'g 在闭区间连续', g_continuous, f'连续域检查：{g_continuous}。'),
        _obligation('f_differentiable', 'f 在开区间可导', f_differentiable, f'导数连续域检查：{f_differentiable}。'),
        _obligation('g_differentiable', 'g 在开区间可导', g_differentiable, f'导数连续域检查：{g_differentiable}。'),
        _obligation('g_prime_nonzero', 'g\' 在开区间保持同号', nonzero_derivative,
                    f'g\'={g_prime}；严格增：{g_increasing}，严格减：{g_decreasing}。'),
        _obligation('denominator', 'g(b)-g(a)≠0', denominator_ok,
                    f'g(b)-g(a)={denominator}。'),
    ]
    certificate = {
        'theorem': '柯西中值定理', 'left': expression_text(f), 'right': expression_text(g),
        'interval': [str(a), str(b)], 'slope': expression_text(sp.simplify((fb - fa) / denominator)) if denominator_ok else '—',
        'conclusion': '存在 c∈(a,b) 使 f\'(c)/g\'(c)=(f(b)-f(a))/(g(b)-g(a))',
    }
    if not all((f_continuous, g_continuous, f_differentiable, g_differentiable)):
        return _base_result('cauchy_mvt', 'invalid', 'not_certified', obligations, certificate,
                            '证明条件不成立：f 或 g 的连续/可导条件未满足', '柯西中值定理条件不成立')
    if not nonzero_derivative:
        return _base_result('cauchy_mvt', 'unverified', 'not_certified', obligations, certificate,
                            '未认证：当前不能确认 g\' 在开区间内恒不为零。', 'g\' 非零条件未认证')
    if not denominator_ok:
        return _base_result('cauchy_mvt', 'unverified', 'not_certified', obligations, certificate,
                            '未认证：g(b)-g(a)=0，结论右端无定义。', '分母为零')
    slope = sp.simplify((fb - fa) / denominator)
    answer = (f'已认证（柯西中值定理证书）：f、g 在 [{a},{b}] 连续、在 ({a},{b}) 可导，'
              f'且 g\' 在开区间内保持同号，因此存在 c∈({a},{b})，使 '
              f'f\'(c)/g\'(c)=({fb}-{fa})/({gb}-{ga})={slope}。')
    return _base_result('cauchy_mvt', 'verified', 'kernel_certificate', obligations, certificate, answer)


def _inequality(conditions: Mapping[str, Any]) -> dict:
    left = _expr(str(conditions.get('left') or ''), '左式')
    right = _expr(str(conditions.get('right') or ''), '右式')
    relation = str(conditions.get('relation') or '>=')
    if relation not in ('>=', '<='):
        raise ValueError('函数不等式关系只支持 >= 或 <=')
    a, b = _interval(conditions)
    interval = sp.Interval(a, b)
    try:
        left_domain = continuous_domain(left, X, interval)
        right_domain = continuous_domain(right, X, interval)
        domain_ok = interval.is_subset(left_domain) is True and interval.is_subset(right_domain) is True
    except Exception:  # noqa: BLE001
        domain_ok = False
    difference = sp.simplify(left - right if relation == '>=' else right - left)
    certificate = {
        'theorem': '单调性不等式', 'left': expression_text(left), 'right': expression_text(right),
        'relation': relation, 'difference': expression_text(difference),
        'conclusion': f'{expression_text(left)} {relation} {expression_text(right)} 在 [{a},{b}] 上成立',
    }
    if not domain_ok:
        obligations = [
            _obligation('domain', '原式在区间上有完整实定义', False,
                        f'左式或右式在 [{a},{b}] 上存在无实定义点，不能先作差抹去定义域限制。'),
            _obligation('difference', '作差证明', False, '原式定义域未通过，未进行作差单调性认证。'),
        ]
        return _base_result('inequality', 'invalid', 'not_certified', obligations, certificate,
                            '证明无效：左右表达式在区间上没有完整实定义，不能通过作差认证。',
                            '原式定义域不满足')
    base = _monotone_inequality(difference, a, b)
    certificate = {
        **base.get('certificate', {}),
        'theorem': '单调性不等式', 'left': expression_text(left), 'right': expression_text(right),
        'relation': relation, 'difference': expression_text(difference),
        'conclusion': f'{expression_text(left)} {relation} {expression_text(right)} 在 [{a},{b}] 上成立',
    }
    domain_obligation = _obligation('domain', '原式在区间上有完整实定义', True,
                                    f'左右表达式在 [{a},{b}] 上均有完整实定义。')
    base['obligations'] = [domain_obligation, *base.get('obligations', [])]
    base['steps'] = base['obligations']
    if base.get('proof_status') == 'verified':
        answer = (f'已认证（单调性证书）：作差函数 {expression_text(difference)} 的导数保持符号且非负端点成立，'
                  f'因此 {expression_text(left)} {relation} {expression_text(right)} 在 [{a},{b}] 上成立。')
        return {**base, 'proof_kind': 'inequality', 'answer': answer, 'certificate': certificate}
    return {
        **base, 'proof_kind': 'inequality', 'certificate': certificate,
        'answer': '未认证：当前单调性证书条件不足，不能据此证明该函数不等式。',
    }


def _counterexample(conditions: Mapping[str, Any]) -> dict:
    left = _expr(str(conditions.get('left') or ''), '左式')
    right = _expr(str(conditions.get('right') or ''), '右式')
    relation = str(conditions.get('relation') or '>=')
    if relation not in ('>=', '<=', '>', '<', '='):
        raise ValueError('反例关系只支持 >=、<=、>、<、=')
    point = _constant(str(conditions.get('point') or 0), '反例点')
    point_defined = _defined_at(left, point) and _defined_at(right, point)
    left_value = right_value = None
    holds = False
    comparison_ok = False
    if point_defined:
        try:
            left_value, right_value = left.subs(X, point), right.subs(X, point)
            comparisons = {'>=': sp.Ge, '<=': sp.Le, '>': sp.Gt, '<': sp.Lt, '=': sp.Eq}
            holds = bool(comparisons[relation](left_value, right_value))
            comparison_ok = True
        except Exception:  # noqa: BLE001
            comparison_ok = False
    obligations = [
        _obligation('point', '反例点在实定义域内', point_defined,
                    f'x={point} 时左式={left_value}，右式={right_value}。'),
        _obligation('false', '全称命题在该点不成立', comparison_ok and not holds,
                    f'原关系 {relation} 在该点成立：{holds}。'),
    ]
    certificate = {'theorem': '反例', 'left': expression_text(left), 'right': expression_text(right),
                   'relation': relation, 'point': str(point), 'left_value': str(left_value), 'right_value': str(right_value)}
    if not point_defined:
        return _base_result('counterexample', 'unverified', 'not_certified', obligations, certificate,
                            '未认证：反例点不在左式或右式的实定义域内，不能作为反例。', '反例点无定义')
    if not comparison_ok:
        return _base_result('counterexample', 'unverified', 'not_certified', obligations, certificate,
                            '未认证：反例点处的左右值无法完成有限实数比较。', '反例比较无法确认')
    if not holds:
        answer = f'已否定原命题：取 x={point}，左式={left_value}，右式={right_value}，不满足 {relation}，反例成立。'
        return _base_result('counterexample', 'disproved', 'kernel_certificate', obligations, certificate, answer)
    return _base_result('counterexample', 'unverified', 'not_certified', obligations, certificate,
                        '未认证：该点满足原关系，不能作为反例。', '该点不是反例')


def _steps(conditions: Mapping[str, Any]) -> dict:
    raw_steps = conditions.get('steps')
    if not isinstance(raw_steps, list) or not 1 <= len(raw_steps) <= 20:
        raise ValueError('证明步骤必须是1至20条等式字符串')
    obligations = []
    all_passed = True
    certificate_steps = []
    for index, raw in enumerate(raw_steps, start=1):
        if not isinstance(raw, str) or raw.count('=') != 1:
            obligations.append(_obligation(f'Step{index}', f'第 {index} 步等式', False, '步骤必须是 lhs=rhs 形式'))
            all_passed = False
            continue
        left, right = raw.split('=')
        try:
            lhs = _expr(left.strip(), f'第 {index} 步左式')
            rhs = _expr(right.strip(), f'第 {index} 步右式')
            equal = sp.simplify(lhs - rhs) == 0
        except Exception:  # noqa: BLE001
            equal = False
            lhs = rhs = None
        all_passed = all_passed and equal
        obligations.append(_obligation(f'Step{index}', f'第 {index} 步等式', equal,
                                       raw if equal else f'{raw} 两侧化简不相同'))
        certificate_steps.append({'step': index, 'text': raw, 'equal': equal})
    certificate = {'theorem': '局部等式步骤', 'steps': certificate_steps,
                   'conclusion': '仅核对每一步的代数恒等，不认证整体逻辑结构'}
    answer = ('局部步骤已核对：所有声明的等式步骤均成立，但整体证明逻辑未认证。'
              if all_passed else '证明步骤不成立：至少一个等式步骤化简不相等，当前证明无效。')
    return _base_result('steps', 'local_steps_verified' if all_passed else 'invalid',
                        'local_steps_only' if all_passed else 'not_certified', obligations, certificate,
                        answer, '整体证明未认证' if all_passed else '局部等式步骤不成立')


def solve_proof(model: Mapping[str, Any]) -> dict:
    proof_kind = str(model.get('proof_kind') or '')
    if proof_kind not in PROOF_KINDS:
        raise ValueError('当前证明类型不支持')
    conditions = dict(model.get('conditions') or {})
    for key in ('proof_kind','expression','lower','upper','left','right','relation','point','steps','statement'):
        if key in model and key not in conditions:
            conditions[key] = model[key]
    if proof_kind == 'counterexample':
        return _counterexample(conditions)
    if proof_kind == 'steps':
        return _steps(conditions)
    if proof_kind == 'inequality':
        return _inequality(conditions)
    if proof_kind == 'cauchy_mvt':
        first = _expr(conditions.get('left'), '左式 f')
        second = _expr(conditions.get('right'), '右式 g')
        a, b = _interval(conditions)
        return _cauchy_mvt(first, second, a, b)
    expression = _expr(model.get('expression'), '函数表达式')
    a, b = _interval(conditions)
    if proof_kind == 'ivt_root':
        return _ivt(expression, a, b)
    if proof_kind == 'ivt_unique_root':
        return _ivt_unique(expression, a, b)
    if proof_kind == 'rolle':
        return _rolle(expression, a, b)
    if proof_kind == 'mvt':
        return _mvt(expression, a, b)
    return _monotone_inequality(expression, a, b)


def evaluate_proof(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict:
    solution = solve_proof(model)
    expression = None
    if model.get('expression'):
        try:
            expression = _expr(model.get('expression'), '函数表达式')
        except Exception:  # noqa: BLE001
            expression = None
    lower = 0.0
    upper = 1.0
    try:
        lower, upper = [float(_constant(str((model.get('conditions') or {}).get(key, value)), key))
                        for key, value in (('lower', 0), ('upper', 1))]
    except Exception:  # noqa: BLE001
        pass
    series = []
    if expression is not None:
        try:
            func = sp.lambdify(X, expression, 'math')
            for index in range(200):
                value = lower + (upper - lower) * index / 199
                try:
                    y = float(func(value))
                except Exception:  # noqa: BLE001
                    y = None
                series.append({'x': round(value, 6), 'y': None if y is None or not math.isfinite(y) else round(y, 6)})
        except Exception:  # noqa: BLE001
            series = []
    return {
        'subject': 'calculus', 'task': 'proof', 'kind': 'proof',
        'headline': solution.get('answer') or solution.get('summary') or '证明核对',
        'metrics': [
            {'id': 'status', 'label': '证明状态', 'value': solution.get('proof_status') or '—', 'tone': 'accent'},
            {'id': 'level', 'label': '认证级别', 'value': solution.get('verification_level') or '—'},
            {'id': 'obligations', 'label': '已通过义务', 'value': f'{sum(1 for item in solution.get("obligations") or [] if item["status"] == "pass")}/{len(solution.get("obligations") or [])}'},
        ],
        'checks': [
            {'id': item['id'], 'label': item['label'], 'status': item['status'], 'detail': item['detail']}
            for item in solution.get('obligations') or []
        ],
        'notes': solution.get('limitations') or [],
        'series': series, 'domain': {'x_min': lower, 'x_max': upper}, 'rects': [],
        'exact': None, 'approx': None, 'error': None,
        'answerText': solution.get('answer') or '',
        'trace': [{'index': index, 'label': item['label'], 'detail': item['detail'], 'values': item}
                  for index, item in enumerate(solution.get('obligations') or [])],
        'proof': {
            'proof_kind': solution.get('proof_kind'), 'status': solution.get('proof_status'),
            'verification_level': solution.get('verification_level'),
            'obligations': solution.get('obligations') or [],
            'certificate': solution.get('certificate') or {},
            'statement': model.get('statement') or '',
        },
        'proof_solution': solution,
    }


def build_proof_problem(conditions: Mapping[str, Any]) -> dict:
    from .exam_math import _condition
    proof_kind = str(conditions.get('proof_kind') or '')
    if proof_kind not in PROOF_KINDS:
        raise ValueError('证明类型只支持存在性、中值定理、不等式、反例与局部步骤模板')
    model = {
        'engine': 'proof_v1', 'subject': 'calculus', 'task': 'proof', 'kind': 'proof',
        'proof_kind': proof_kind, 'conditions': dict(conditions), 'defaults': {}, 'params': [],
        'teaching': False, 'formula_tex': '',
    }
    if proof_kind == 'cauchy_mvt':
        first = _expr(conditions.get('left'), '左式 f')
        second = _expr(conditions.get('right'), '右式 g')
        a, b = _interval(conditions)
        model.update(expression=expression_text(first), left=expression_text(first),
                     right=expression_text(second), lower=str(a), upper=str(b),
                     statement=str(conditions.get('statement') or ''))
    elif proof_kind == 'inequality':
        left = _expr(conditions.get('left'), '左式')
        right = _expr(conditions.get('right'), '右式')
        relation = str(conditions.get('relation') or '>=')
        if relation not in ('>=', '<='):
            raise ValueError('函数不等式关系只支持 >= 或 <=')
        a, b = _interval(conditions)
        model.update(expression=expression_text(left), left=expression_text(left),
                     right=expression_text(right), relation=relation,
                     lower=str(a), upper=str(b), statement=str(conditions.get('statement') or ''))
    elif proof_kind not in ('counterexample', 'steps'):
        expression = _expr(conditions.get('expression'), '函数表达式')
        a, b = _interval(conditions)
        model.update(expression=expression_text(expression), lower=str(a), upper=str(b),
                     statement=str(conditions.get('statement') or ''))
    elif proof_kind == 'counterexample':
        model.update(left=expression_text(_expr(str(conditions.get('left')), '左式')),
                     right=expression_text(_expr(str(conditions.get('right')), '右式')),
                     relation=str(conditions.get('relation') or '>='),
                     point=str(_constant(str(conditions.get('point') or 0), '反例点')),
                     statement=str(conditions.get('statement') or ''))
    else:
        if not isinstance(conditions.get('steps'), list):
            raise ValueError('证明步骤必须是字符串数组')
        model.update(steps=list(conditions['steps']), statement=str(conditions.get('statement') or ''))
    condition_list = [
        _condition(key, key, value, {}, kind='json' if isinstance(value, (list, dict)) else 'expression')
        for key, value in conditions.items()
    ]
    return {
        'problem_id': 'prb_proof', 'number': None, 'title': '证明与存在性', 'text': '',
        'subject': 'calculus', 'subject_label': '微积分', 'confidence': 1.0, 'status': 'ready',
        'source': {'page_from': 1, 'page_to': 1, 'file_names': [], 'label': '声明式条件', 'excerpt': ''},
        'source_pages': [],
        'recognition': {'method': 'declarative_kernel', 'raw_text': '', 'conditions': condition_list,
                        'ambiguities': [], 'formulas': [], 'recognized_subject': 'calculus', 'ai_used': False},
        'model': model, 'solution': {}, 'states': {}, 'conditions': condition_list,
        'ambiguities': [], 'recognized': True, 'formulas': [],
    }




def build_proof_from_text(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """Recognize explicit theorem-proof phrasing; never infer a proof from prose alone."""
    import re as _re
    lowered = text.replace('−', '-').replace('≤', '<=').replace('≥', '>=')
    if not any(key in lowered for key in ('罗尔定理', '拉格朗日中值定理', '中值定理', '介值定理', '有根', '零点')):
        return None
    interval = _re.search(r'\[\s*(-?(?:\d+(?:\.\d+)?|pi))\s*,\s*(-?(?:\d+(?:\.\d+)?|pi))\s*\]', lowered)
    if not interval:
        return None
    expression_match = _re.search(r'(?:f|g)\s*\(\s*x\s*\)\s*=\s*([^，,。；;]+)', lowered)
    if expression_match:
        expression_text_raw = _re.split(r'\s*(?:在|上|，|,|。|区间)', expression_match.group(1))[0].strip()
    else:
        equation = _re.search(r'方程\s*([^，,。；;]+?)\s*=\s*0', lowered)
        if not equation:
            return None
        expression_text_raw = equation.group(1).strip()
    proof_kind = ('ivt_unique_root' if ('唯一' in lowered and ('根' in lowered or '零点' in lowered))
                  else 'rolle' if '罗尔' in lowered
                  else ('mvt' if ('中值定理' in lowered or '拉格朗日' in lowered) else 'ivt_root'))
    try:
        problem = build_proof_problem({
            'proof_kind': proof_kind, 'expression': expression_text_raw,
            'lower': interval.group(1), 'upper': interval.group(2),
            'statement': text[:500],
        })
    except Exception:  # noqa: BLE001
        return None
    problem['recognition']['raw_text'] = text
    problem['recognition']['method'] = 'typed_text'
    problem['source']['excerpt'] = text[:220]
    return problem


__all__ = ['build_proof_from_text', 'build_proof_problem', 'evaluate_proof', 'solve_proof', 'PROOF_KINDS']

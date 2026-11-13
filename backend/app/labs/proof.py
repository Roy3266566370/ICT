"""Proof support: theorem certificates, inequality certificates, counterexamples and local steps."""
from __future__ import annotations

import math
from typing import Any, Mapping

import sympy as sp
from sympy.calculus.util import continuous_domain

from .expr import expression_text, parse_expression, safe_float, to_latex

X = sp.Symbol('x', real=True)
PROOF_KINDS = ('ivt_root', 'rolle', 'mvt', 'monotone_inequality', 'counterexample', 'steps')


def _expr(raw: Any, label: str, variable='x') -> sp.Expr:
    if not isinstance(raw, str) or not 1 <= len(raw) <= 600:
        raise ValueError(f'{label}必须是600字以内的表达式')
    value = parse_expression(raw, (variable,))
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
    sign_change = (
        fa_num is not None and fb_num is not None
        and (abs(fa_num) < 1e-12 or abs(fb_num) < 1e-12 or fa_num * fb_num < 0)
    )
    obligations.append(_obligation('sign_change', '端点异号或端点为零', sign_change, f'f(a)·f(b)={fa_num}·{fb_num}。'))
    certificate = {'theorem': '介值定理', 'expression': expression_text(expression), 'interval': [str(a), str(b)],
                   'conclusion': '存在 c∈[a,b] 使 f(c)=0'}
    if not continuous or fa_num is None or fb_num is None:
        return _base_result('ivt_root', 'invalid', 'not_certified', obligations, certificate,
                            '证明条件不成立：函数在区间上不连续或端点无定义', '介值定理条件不成立')
    if sign_change:
        answer = f'已认证（介值定理证书）：{expression_text(expression)} 在 [{a},{b}] 上连续且端点异号/为零，因此存在 c∈({a},{b}) 使 f(c)=0。'
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
    left_value, right_value = safe_float(expression.subs(X, a)), safe_float(expression.subs(X, b))
    obligations = [
        _obligation('continuous', '区间上连续', continuous, f'连续域检查：{continuous}。'),
        _obligation('derivative', '单调性证书', increasing or decreasing,
                    f'f\'={derivative}；递增：{increasing}，递减：{decreasing}。'),
        _obligation('endpoint', '起点/终点非负', (increasing and left_value is not None and left_value >= -1e-12)
                    or (decreasing and right_value is not None and right_value >= -1e-12),
                    f'f(a)={left_value}，f(b)={right_value}。'),
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


def _counterexample(conditions: Mapping[str, Any]) -> dict:
    left = _expr(str(conditions.get('left') or ''), '左式')
    right = _expr(str(conditions.get('right') or ''), '右式')
    relation = str(conditions.get('relation') or '>=')
    if relation not in ('>=', '<=', '>', '<', '='):
        raise ValueError('反例关系只支持 >=、<=、>、<、=')
    point = _constant(str(conditions.get('point') or 0), '反例点')
    left_value, right_value = left.subs(X, point), right.subs(X, point)
    comparisons = {'>=': sp.Ge, '<=': sp.Le, '>': sp.Gt, '<': sp.Lt, '=': sp.Eq}
    holds = bool(comparisons[relation](left_value, right_value))
    obligations = [
        _obligation('point', '反例点定义', safe_float(left_value) is not None and safe_float(right_value) is not None,
                    f'x={point} 时左式={left_value}，右式={right_value}。'),
        _obligation('false', '全称命题在该点不成立', not holds,
                    f'原关系 {relation} 在该点成立：{holds}。'),
    ]
    certificate = {'theorem': '反例', 'left': expression_text(left), 'right': expression_text(right),
                   'relation': relation, 'point': str(point), 'left_value': str(left_value), 'right_value': str(right_value)}
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
    expression = _expr(model.get('expression'), '函数表达式')
    a, b = _interval(conditions)
    if proof_kind == 'ivt_root':
        return _ivt(expression, a, b)
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
        raise ValueError('证明类型只支持 ivt_root、rolle、mvt、monotone_inequality、counterexample、steps')
    model = {
        'engine': 'proof_v1', 'subject': 'calculus', 'task': 'proof', 'kind': 'proof',
        'proof_kind': proof_kind, 'conditions': dict(conditions), 'defaults': {}, 'params': [],
        'teaching': False, 'formula_tex': '',
    }
    if proof_kind not in ('counterexample', 'steps'):
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
    proof_kind = 'rolle' if '罗尔' in lowered else ('mvt' if ('中值定理' in lowered or '拉格朗日' in lowered) else 'ivt_root')
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

"""User-confirmed series inputs: numerical convergence, power series and Fourier series."""
from __future__ import annotations

import re
from typing import Any

import sympy as sp
from sympy.calculus.util import continuous_domain

from .expr import expression_text, parse_expression, safe_float, to_latex
from .series import N, _parse_coefficient, _parse_term, ensure_defined_from

X = sp.Symbol('x', real=True)
TASKS = ('series_convergence', 'power_series', 'fourier_series')
FIELDS = {
    'series_convergence': ('term', 'index_start'),
    'radius': ('goal', 'coefficient', 'center', 'index_start'),
    'sum': ('goal', 'coefficient', 'center', 'index_start'),
    'fourier_series': ('expression', 'lower', 'upper', 'order'),
}
NOTE = ('数项级数结论来自符号判别，部分和只作观察；幂级数端点必须逐点代入原级数；'
        '傅里叶系数按给定区间计算，间断点结论按 Dirichlet 定理说明。')


def _integer(raw: Any, label: str, minimum: int, maximum: int) -> int:
    if isinstance(raw, bool) or raw is None:
        raise ValueError(f'{label}必须是整数')
    text = str(raw).strip()
    if not re.fullmatch(r'[+-]?\d+', text):
        raise ValueError(f'{label}必须是整数')
    value = int(text)
    if value < minimum or value > maximum:
        raise ValueError(f'{label}必须在 {minimum} 至 {maximum} 之间')
    return value


def _constant(raw: Any, label: str) -> sp.Expr:
    if isinstance(raw, bool) or raw is None or not str(raw).strip() or len(str(raw)) > 100:
        raise ValueError(f'请填写{label}')
    value = parse_expression(str(raw))
    if value.free_symbols or value.is_real is not True or safe_float(value) is None:
        raise ValueError(f'{label}必须是有限实常数')
    return value.xreplace({node: sp.Rational(str(node)) for node in value.atoms(sp.Float)})


def _term(raw: Any, start: int) -> sp.Expr:
    term = _parse_term(raw)
    ensure_defined_from(term, start, '通项')
    return term


def _coefficient(raw: Any, start: int) -> sp.Expr:
    coefficient = _parse_coefficient(raw)
    ensure_defined_from(coefficient, start, '幂级数系数')
    return coefficient


def parse_inputs(task: str, c: dict[str, Any]) -> dict[str, Any]:
    if task == 'series_convergence':
        expected = set(FIELDS[task])
        if set(c) != expected:
            raise ValueError('数项级数必须完整填写通项与起始指标，额外条件不能忽略')
        start = _integer(c['index_start'], '起始指标', 0, 100)
        term = _term(c['term'], start)
        return dict(task=task, term=term, term_text=str(c['term']).strip(), start=start)
    if task == 'power_series':
        if c.get('goal') not in ('radius', 'sum'):
            raise ValueError('请选择求收敛域或收敛域与和函数')
        goal = str(c['goal'])
        expected = set(FIELDS[goal])
        if set(c) != expected:
            raise ValueError('幂级数必须完整填写系数、展开中心与起始指标，额外条件不能忽略')
        start = _integer(c['index_start'], '起始指标', 0, 100)
        center = _constant(c['center'], '展开中心')
        coefficient = _coefficient(c['coefficient'], start)
        return dict(task=task, goal=goal, coefficient=coefficient,
                    coefficient_text=str(c['coefficient']).strip(), center=center, start=start)
    if task == 'fourier_series':
        expected = set(FIELDS[task])
        if set(c) != expected:
            raise ValueError('傅里叶级数必须完整填写函数、有限区间与截断阶数，额外条件不能忽略')
        expression = parse_expression(str(c.get('expression') or ''), ('x',), preserve_structure=True)
        lower = _constant(c['lower'], '区间下限')
        upper = _constant(c['upper'], '区间上限')
        if not bool(lower < upper):
            raise ValueError('傅里叶区间必须从小到大')
        order = _integer(c['order'], '截断阶数', 1, 12)
        domain = continuous_domain(expression, X, sp.S.Reals)
        if sp.Interval(lower, upper).is_subset(domain) is not True:
            raise ValueError('傅里叶级数要求函数在整个闭区间上有实定义且连续，不自动跨越无定义点')
        return dict(task=task, expression=expression, expression_text=str(c['expression']).strip(),
                    lower=lower, upper=upper, order=order)
    raise ValueError('暂不支持该级数任务')


def _power_bounds_latex(center: sp.Expr) -> str:
    if center == 0:
        return 'x^{n}'
    if center.is_negative:
        return rf'(x+{to_latex(-center)})^{{n}}'
    return rf'(x-{to_latex(center)})^{{n}}'


def preview(task: str, conditions: dict[str, Any]) -> dict[str, Any]:
    plan = parse_inputs(task, conditions)
    c = dict(conditions)
    for key in ('index_start', 'order'):
        if key in c:
            c[key] = str(_integer(c[key], '起始指标' if key == 'index_start' else '截断阶数',
                                    0 if key == 'index_start' else 1,
                                    100 if key == 'index_start' else 12))
    if 'center' in c:
        c['center'] = expression_text(plan['center'])
    if task == 'fourier_series':
        c['expression'] = c['expression'].strip()
        c['lower'] = expression_text(plan['lower'])
        c['upper'] = expression_text(plan['upper'])
    if task == 'series_convergence':
        latex = rf'\sum_{{n={plan["start"]}}}^{{\infty}} {to_latex(plan["term"])}'
        question = (f'判断数项级数 Σ (n={plan["start"]} 到 ∞) {plan["term_text"]} 的敛散性；'
                    '需区分绝对收敛、条件收敛与发散，部分和只作观察。')
        label = '数项级数敛散性'
    elif task == 'power_series':
        latex = (rf'\sum_{{n={plan["start"]}}}^{{\infty}} {to_latex(plan["coefficient"])}'
                 rf'{_power_bounds_latex(plan["center"])}')
        question = (f'求幂级数 Σ (n={plan["start"]} 到 ∞) {plan["coefficient_text"]}'
                    f'{_power_bounds_latex(plan["center"]).replace("^{n}", "^n")} 的收敛半径与收敛域；'
                    '两个端点必须分别代入原级数判断。')
        if plan['goal'] == 'sum':
            question += '并求收敛域内的和函数 S(x)。'
        label = '幂级数收敛域与和函数' if plan['goal'] == 'sum' else '幂级数收敛域'
    else:
        latex = (rf'f(x)={to_latex(plan["expression"])},\quad x\in'
                 rf'[{to_latex(plan["lower"])},{to_latex(plan["upper"])}],\quad n\le {plan["order"]}')
        question = (f'将 f(x)={plan["expression_text"]} 在 [{expression_text(plan["lower"])},'
                    f'{expression_text(plan["upper"])}] 上展开为傅里叶级数，截断到 n={plan["order"]}；'
                    '核对 a0、an、bn、部分和与端点/间断点收敛结论。')
        label = '傅里叶级数'
    return dict(task=task, label=label, conditions=c, latex=latex, question=question)


def labels(c: dict[str, Any]) -> dict[str, str]:
    result = {'term': '级数通项', 'index_start': '起始指标', 'goal': '幂级数任务',
              'coefficient': '幂级数系数', 'center': '展开中心', 'expression': '函数表达式',
              'lower': '区间下限', 'upper': '区间上限', 'order': '截断阶数'}
    return result


def build_problem(task: str, c: dict[str, Any]) -> dict[str, Any]:
    from .exam_math import _condition
    from .series import (build_fourier_problem, build_power_series_problem,
                         build_series_problem)

    p = preview(task, c)
    normalized = p['conditions']
    if task == 'series_convergence':
        problem = build_series_problem({'term': normalized['term'],
                                        'index_start': normalized['index_start']})
    elif task == 'power_series':
        problem = build_power_series_problem({
            'goal': normalized['goal'], 'coefficient': normalized['coefficient'],
            'center': normalized['center'], 'index_start': normalized['index_start']})
    else:
        problem = build_fourier_problem({
            'expression': normalized['expression'], 'lower': normalized['lower'],
            'upper': normalized['upper'], 'order': normalized['order']})
    problem['model']['modeling_task'] = task
    problem['model']['manual_series_conditions'] = normalized
    problem['model']['formula_tex'] = p['latex']
    fields = [_condition(key, labels(normalized)[key], value, {}) for key, value in normalized.items()]
    if task == 'power_series':
        for field in fields:
            if field['id'] == 'goal':
                field['editable'] = False
    problem['recognition']['conditions'] = fields
    problem['recognition']['formulas'] = [{'id': 'series', 'tex': p['latex'],
                                           'plain': normalized.get('term') or normalized.get('coefficient') or normalized.get('expression', ''),
                                           'role': p['label']}]
    problem['formulas'] = [{'id': 'series', 'tex': p['latex'],
                            'plain': normalized.get('term') or normalized.get('coefficient') or normalized.get('expression', ''),
                            'role': p['label']}]
    problem['text'] = p['question']
    problem['title'] = p['label']
    return problem


__all__ = ['FIELDS', 'NOTE', 'TASKS', 'build_problem', 'labels', 'parse_inputs', 'preview']

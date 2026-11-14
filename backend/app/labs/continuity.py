"""在有限点核查双侧连续性；单点定义与去心邻域表达式分开保存。"""
from __future__ import annotations
import sympy as sp
from sympy.calculus.util import continuous_domain
from .expr import parse_expression, safe_float
from .calculus_analysis import _limit_at, _point_payload


def continuity_report(model):
    variable = sp.Symbol(str(model.get('variable') or 'x'), real=True)
    original = parse_expression(model['expression'], (str(variable),), preserve_structure=True)
    expression = sp.simplify(original)
    point = parse_expression(model['exact_point'])
    config = model['continuity_config']
    labels = dict(continuous='连续', removable='可去间断点', jump='跳跃间断点', infinite='无穷间断点', oscillatory='振荡间断点', boundary='定义域边界：不作双侧间断点分类', undetermined='无法判定')
    try:
        domain = continuous_domain(original, variable, sp.S.Reals)
        intervals = list(domain.args) if isinstance(domain, sp.Union) else [domain]
        if any(not isinstance(part, (sp.Interval, sp.FiniteSet)) and part != sp.S.EmptySet for part in intervals):
            raise NotImplementedError('当前不能确认该表达式的实定义域邻域')
        sides = {}
        for name, direction in [('left', '-'), ('right', '+')]:
            accessible = any(isinstance(part, sp.Interval) and
                ((part.start < point and part.end >= point) if name == 'left' else (part.start <= point and part.end > point)) for part in intervals)
            sides[name] = _limit_at(expression, variable, point, direction) if accessible else {'kind': 'undefined', 'value': None, 'text': '该侧无实定义域邻域'}
        if config['mode'] == 'value':
            value = _point_payload(parse_expression(config['value']))
        elif config['mode'] == 'undefined' or domain.contains(point) is not sp.S.true:
            value = {'kind': 'undefined', 'value': None, 'text': '未定义'}
        else:
            value = _point_payload(original.subs(variable, point))
            if value['kind'] != 'finite': value = {'kind': 'undefined', 'value': None, 'text': '无有限实函数值'}
        left, right = sides['left'], sides['right']
        kinds = [left['kind'], right['kind']]
        category = 'undetermined'
        if 'undefined' in kinds: category = 'boundary'
        elif 'undetermined' in kinds: pass
        elif 'infinite' in kinds: category = 'infinite'
        elif 'does_not_exist' in kinds: category = 'oscillatory'
        elif kinds == ['finite', 'finite']:
            difference = sp.simplify(parse_expression(left['text']) - parse_expression(right['text']))
            if difference == 0:
                if value['kind'] != 'finite': category = 'removable'
                else:
                    same = sp.simplify(parse_expression(value['text']) - parse_expression(left['text']))
                    category = 'continuous' if same == 0 else ('removable' if same.is_zero is False else 'undetermined')
            elif difference.is_zero is False: category = 'jump'
        reason = labels[category]
    except (NotImplementedError, TypeError, ValueError) as exc:
        category, reason = 'undetermined', f'无法判定：{exc}'
        value = {'kind': 'undetermined', 'text': '无法判定'}
        left = right = {'kind': 'undetermined', 'text': '无法判定'}
    completed = category != 'undetermined'
    answer = f"在 {variable}={point} 处：{reason}；函数值 {value['text']}；左极限 {left['text']}；右极限 {right['text']}。"
    return dict(summary=reason, answer=answer if completed else '', exact=reason,
        exact_latex=rf'\text{{{reason}}}', solution_status='complete' if completed else 'unsupported',
        solution_complete=completed, incomplete_reason=None if completed else reason,
        continuity=dict(classification=category, label=reason, value=value, left=left, right=right),
        steps=[dict(id='function-value',title='核对该点函数值',detail=f"按已确认的单点定义，f({point})={value['text']}。"),
               dict(id='one-sided-limits',title='计算左右极限',detail=f"左极限：{left['text']}；右极限：{right['text']}。单点值不改变去心极限。"),
               dict(id='continuity',title='判断连续性与间断点类型',detail=reason+'。连续要求双侧有限极限相等，且等于该点函数值。')],
        conditions=['有限点的双侧连续性检查；单点定义由用户确认。'],
        limitations=['首批支持单个表达式及单点补定义。图形展示去心邻域表达式；单点函数值以此处核对结果为准。边界点不套用双侧间断点分类。'])

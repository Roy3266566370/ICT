"""用户确认的结构化积分输入，不经过题干识别或模型理解。"""
from __future__ import annotations

import copy
import re
from typing import Any

import sympy as sp

from .expr import expression_text, parse_expression, safe_float, to_latex
from .domain_analysis import domain_gap_profile
from .kernel_models import FIELD_LABELS, TASKS, _validate


def preview_integral(task: str, conditions: dict[str, Any]) -> dict[str, Any]:
    if task not in ('integral', 'antiderivative', 'derivative', 'inverse_derivative', 'limit', 'parameter_limit', 'higher_derivative', 'continuity', 'implicit_normal', 'implicit_derivative', 'parametric_derivative', 'curvature', 'asymptote', 'sequence_limit', 'arc_length', 'parametric_arc_length', 'surface_of_revolution', 'polar_area', 'polar_arc_length', 'function_study', 'taylor', 'geometric_area', 'rotation_volume', 'integral_function', 'ode', 'multivariable', 'multivariable_extrema', 'double_integral', 'triple_integral', 'series_convergence', 'power_series', 'fourier_series', 'space_geometry', 'curve_surface_integral', 'proof'):
        raise ValueError('手动输入目前支持积分、导数与极限、级数与展开等题型')
    c = copy.deepcopy(conditions)
    if task in ('series_convergence', 'power_series', 'fourier_series'):
        from .manual_series import preview
        return preview(task, c)
    if task == 'integral' and 'integral_mode' in c:
        from .manual_improper_integral import preview
        return preview(c)
    if task == 'double_integral':
        from .manual_double_integral import preview
        return preview(c)
    if task == 'triple_integral':
        from .manual_triple_integral import preview
        return preview(c)
    if task == 'space_geometry':
        from .manual_space_geometry import preview
        return preview(c)
    if task == 'curve_surface_integral':
        from .manual_space_integrals import preview
        return preview(c)
    if task == 'proof':
        from .manual_proof import preview
        return preview(c)
    if task == 'multivariable_extrema':
        from .extrema import preview
        _validate(task,c)
        return preview(c)
    if task == 'multivariable':
        from .multivariable import canonical_conditions, parse_inputs, OPERATIONS
        _validate(task,c)
        c=canonical_conditions(c)
        variables,_,operation,expression,point,direction=parse_inputs(c)
        latex=rf'f({",".join(variables)})={to_latex(expression)}'
        if point is not None:latex+=rf',\quad P=({",".join(to_latex(p) for p in point)})'
        question=f"求{OPERATIONS[operation]}，变量顺序{c['variables']}，函数{c['expression']}；"+('未指定点，求条件适用的符号公式' if point is None else '求值点=('+c['point']+')')
        if operation=='partial':question+='；偏导变量='+c['partial_variable']
        if direction is not None:question+='；方向向量=('+c['direction']+')，归一化后求'+('正向单侧' if c['direction_limit']=='forward' else '双侧')+'方向导数'
        return dict(task=task,label=OPERATIONS[operation],conditions=c,latex=latex,question=question)
    if task == 'ode':
        from .ode import parse_equation, parse_initial_conditions
        raw_initial = c.get('initial_conditions', '')
        if not isinstance(raw_initial, str): raise ValueError('初值条件请按每行一条输入')
        lines = [line.strip() for line in raw_initial.splitlines() if line.strip()]
        independent = c.get('independent_variable')
        if independent not in ('x','t'): raise ValueError('请选择自变量x或t，未知函数固定为y')
        if any(key.startswith('target_') for key in c): raise ValueError('本阶段手动微分方程入口只求解方程，组合求值和积分目标尚未接入')
        kernel_conditions = {**c, 'initial_conditions': lines}
        _validate(task, kernel_conditions)
        equation, _, order = parse_equation(c['equation'], independent, 'y')
        parse_initial_conditions(lines, independent, 'y', order)
        c['initial_conditions'] = '\n'.join(lines)
        question = f"求解微分方程 {c['equation']}，自变量{independent}，未知函数y；" + ('条件：'+'；'.join(lines) if lines else '未给初值，求可核验的解族，不自动指定任意常数')
        return dict(task=task,label='常微分方程',conditions=c,latex=to_latex(equation),question=question)
    if task == 'implicit_normal':
        from .exam_math import _build_normal
        raw = c.get('implicit_expression')
        if not isinstance(raw, str) or not raw.strip():
            raise ValueError('请填写曲线方程，如 y=x^2 或 x^2+y^2=1')
        parts = raw.split('=')
        if len(parts) > 2 or not all(part.strip() for part in parts):
            raise ValueError('曲线方程最多有一个等号')
        normalized = f'({parts[0]})-({parts[1]})' if len(parts) == 2 else raw
        original = parse_expression(normalized, ('x','y'), preserve_structure=True)
        c['implicit_expression'] = normalized
        for key in ('point_x', 'point_y'):
            if key not in c: continue
            if isinstance(c[key], bool) or len(str(c[key])) > 100:
                raise ValueError('研究点坐标必须是有限实常数')
            v = parse_expression(str(c[key]))
            if v.free_symbols or v.is_real is not True or safe_float(v) is None:
                raise ValueError('研究点坐标必须是有限实常数')
            c[key] = expression_text(v)
        _validate(task, c)
        built = _build_normal('', {}, {**c, 'point': c['point_x']})
        if built['ambiguities']:
            candidates = built['model'].get('branch_candidates', [])
            raise ValueError(built['ambiguities'][0]['question'] + (' 候选纵坐标：'+', '.join(candidates) if candidates else ''))
        model = built['model']
        px, py = parse_expression(model['point_x']), parse_expression(model['point_y'])
        values = {sp.Symbol('x', real=True):px, sp.Symbol('y', real=True):py}
        if safe_float(original.subs(values)) is None or sp.simplify(original.subs(values)) != 0:
            raise ValueError('该点不在原式已确认的实定义域或曲线上')
        for node in sp.preorder_traversal(original):
            if node.func == sp.Abs and sp.simplify(node.args[0].subs(values)) == 0:
                raise ValueError('该点包含绝对值折点，当前不能确认唯一普通切线与法线')
            if isinstance(node, sp.Pow) and node.exp.is_number and node.exp < 0 and sp.simplify(node.base.subs(values)) == 0:
                raise ValueError('原式在研究点分母为零')
        c['point_y'] = expression_text(py)
        latex = rf'{to_latex(original)}=0,\quad P=({to_latex(px)},{to_latex(py)})'
        question = f"求曲线 {raw} 在 P=({c['point_x']},{c['point_y']}) 处的切线与法线"
        return dict(task=task, label='切线与法线', conditions=c, latex=latex, question=question)
    if task in ('function_study','geometric_area','rotation_volume'):
        for key in ('lower','upper'):
            raw = c.get(key)
            if isinstance(raw,bool) or raw is None or len(str(raw))>100: raise ValueError('请填写有限研究区间上下限')
            value = parse_expression(str(raw))
            if value.free_symbols or value.is_real is not True or safe_float(value) is None: raise ValueError('区间端点必须是有限实常数')
            c[key] = expression_text(value.xreplace({n:sp.Rational(str(n)) for n in value.atoms(sp.Float)}))
        if task == 'function_study' and 'interval_type' not in c: raise ValueError('请选择区间端点开闭方式')
    exact_point = None
    if task == 'parameter_limit':
        raw_point = c.get('point')
        if isinstance(raw_point, bool) or raw_point is None or len(str(raw_point)) > 100:
            raise ValueError('请填写有限极限点，可使用分数或 pi')
        point = parse_expression(str(raw_point))
        if point.free_symbols or point.is_real is not True or safe_float(point) is None:
            raise ValueError('极限点必须是有限实常数，可使用分数或 pi')
        point_text = expression_text(point.xreplace({n: sp.Rational(str(n)) for n in point.atoms(sp.Float)}))
        point_value = float(point.xreplace({n: sp.Rational(str(n)) for n in point.atoms(sp.Float)}))
        c['point'] = point_text
        raw_target = c.get('target_value')
        if isinstance(raw_target, bool) or raw_target is None or len(str(raw_target)) > 100:
            raise ValueError('请填写题目给定的极限值')
        target = parse_expression(str(raw_target))
        if target.free_symbols or target.is_real is not True or safe_float(target) is None:
            raise ValueError('给定极限值必须是有限实常数')
        c['target_value'] = expression_text(target)
        parameter = c.get('parameter')
        if not isinstance(parameter, str) or not re.fullmatch(r'[a-df-hj-z]', parameter) or parameter == c.get('variable'):
            raise ValueError('参数必须是不同于自变量的单个实数字母（不含 e、i）')
        expression = parse_expression(c['expression'], (c['variable'], parameter), preserve_structure=True)
        if parameter not in {str(symbol) for symbol in expression.free_symbols}:
            raise ValueError('原式未包含所求参数；不能用其他字母替代或补入参数')
        _validate(task, {**c, 'point': point_value})
        latex = (rf'\lim_{{{c["variable"]}\to {to_latex(parse_expression(point_text))}}}'
                 rf'{to_latex(expression)}={to_latex(target)}')
        question = (f'已知 lim_{{{c["variable"]}→{point_text}}} ({c["expression"]}) = {c["target_value"]}，'
                    f'求参数 {parameter}；先计算双侧极限，再代回原式核验')
        return dict(task=task, label=TASKS[task]['label'], conditions=c, latex=latex, question=question)
    if task == 'inverse_derivative':
        raw = c.get('point')
        if isinstance(raw, bool) or raw is None or len(str(raw)) > 100:
            raise ValueError('请填写反函数的输入值，可使用分数或 pi')
        point = parse_expression(str(raw))
        if point.free_symbols or point.is_real is not True or safe_float(point) is None:
            raise ValueError('反函数输入值必须是有限实常数')
        point_text = expression_text(point.xreplace({n: sp.Rational(str(n)) for n in point.atoms(sp.Float)}))
        point_value = float(point.xreplace({n: sp.Rational(str(n)) for n in point.atoms(sp.Float)}))
        c['point'] = point_text
        _validate(task, {**c, 'point': point_value})
        expression = parse_expression(c['expression'], (c['variable'],), preserve_structure=True)
        latex = rf"(f^{{-1}})'\left({to_latex(parse_expression(point_text))}\right)"
        question = (f"已知 f({c['variable']})={c['expression']}，求反函数在 x={point_text} 处的导数；"
                    '内核先求 f(x0)=x 的原像，再计算 1/f′(x0)')
        return dict(task=task, label=TASKS[task]['label'], conditions=c, latex=latex, question=question)
    if task == 'integral_function':
        _validate(task, c)
        from .integral_function import _parse_inputs
        function, lower_bound, upper_bound = _parse_inputs(c)
        latex = (rf'F(x)=\int_{{{to_latex(lower_bound)}}}^{{{to_latex(upper_bound)}}}'
                 rf'{to_latex(function)}\,\mathrm{{d}}t')
        question = (f"已知 F(x)=∫_{{{c['lower_expression']}}}^{{{c['upper_expression']}}} ({c['expression']}) dt，"
                    '求 F′(x)' + (f"，并在 x={c['point']} 处求值" if c.get('point') else ''))
        return dict(task=task, label=TASKS[task]['label'], conditions=c, latex=latex, question=question)
    if task == 'parametric_derivative':
        from .derivative_extra import _constant, _order
        xt = parse_expression(c['x_expression'], ('t',), preserve_structure=True)
        yt = parse_expression(c['y_expression'], ('t',), preserve_structure=True)
        t0 = _constant(c['point'], '参数点 t0')
        order = _order(c.get('order'))
        symbol_t = sp.Symbol('t', real=True)
        dx_value = sp.simplify(sp.diff(xt, symbol_t).subs(symbol_t, t0))
        if dx_value == 0:
            raise ValueError('在给定参数点 x′(t0)=0，不能得到有限的 dy/dx；请换点或改用参数形式求切线')
        if order == 2:
            first_derivative = sp.simplify((sp.diff(yt, symbol_t) / sp.diff(xt, symbol_t)))
            second_value = sp.simplify((sp.diff(first_derivative, symbol_t) / sp.diff(xt, symbol_t)).subs(symbol_t, t0))
            if safe_float(second_value) is None:
                raise ValueError('该点二阶导数不是有限实数')
        c['point'] = expression_text(t0)
        c['order'] = order
        _validate(task, {**c, 'point': float(t0)})
        latex = rf'x={to_latex(xt)},\quad y={to_latex(yt)},\quad t={to_latex(t0)}'
        question = (f"已知参数方程 x={c['x_expression']}, y={c['y_expression']}，求在 t={c['point']} 处的"
                    + ('一阶导数 dy/dx' if order == 1 else '一阶、二阶导数 dy/dx 与 d²y/dx²'))
        return dict(task=task, label=TASKS[task]['label'], conditions=c, latex=latex, question=question)
    if task == 'implicit_derivative':
        from .derivative_extra import _constant, _order, _parse_equation
        raw = c.get('implicit_expression')
        equation = _parse_equation(raw)
        px = _constant(c['point_x'], '研究点横坐标')
        py = _constant(c['point_y'], '研究点纵坐标') if c.get('point_y') not in (None, '') else None
        symbol_x, symbol_y = sp.Symbol('x', real=True), sp.Symbol('y', real=True)
        if py is None:
            roots = sp.solveset(equation.subs(symbol_x, px), symbol_y, domain=sp.S.Reals)
            if not isinstance(roots, sp.FiniteSet) or len(roots) != 1:
                raise ValueError('该横坐标对应多个曲线分支，请填写研究点纵坐标')
            py = next(iter(roots))
        if sp.simplify(equation.subs({symbol_x: px, symbol_y: py})) != 0:
            raise ValueError('研究点不在曲线上')
        fy = sp.simplify(sp.diff(equation, symbol_y).subs({symbol_x: px, symbol_y: py}))
        if fy == 0:
            raise ValueError('研究点处 F_y=0，不能由隐函数定理得到有限的 dy/dx')
        c['point_x'] = expression_text(px)
        c['point_y'] = expression_text(py)
        c['order'] = _order(c.get('order'))
        _validate(task, {**c, 'point_x': float(px), **({'point_y': float(py)} if py is not None else {})})
        latex = rf'{to_latex(equation)}=0,\quad P=({to_latex(px)},{to_latex(py) if py is not None else "?"})'
        question = (f"已知隐函数方程 {raw}，求在 P=({c['point_x']},{c.get('point_y', '待确认')}) 处的"
                    + ('dy/dx' if _order(c.get('order')) == 1 else 'dy/dx 与 d²y/dx²'))
        return dict(task=task, label=TASKS[task]['label'], conditions=c, latex=latex, question=question)
    if task == 'curvature':
        from .derivative_extra import _constant
        function = parse_expression(c['expression'], ('x',), preserve_structure=True)
        x0 = _constant(c['point'], '曲率点 x0')
        symbol_x = sp.Symbol('x', real=True)
        for value in (function, sp.diff(function, symbol_x), sp.diff(function, symbol_x, 2)):
            if safe_float(sp.simplify(value.subs(symbol_x, x0))) is None:
                raise ValueError('该点函数值或一、二阶导数不是有限实数，不能计算曲率')
        c['point'] = expression_text(x0)
        _validate(task, {**c, 'point': float(x0)})
        latex = rf'y={to_latex(function)},\quad x_0={to_latex(x0)}'
        question = f"求曲线 y={c['expression']} 在 x={c['point']} 处的曲率与曲率半径"
        return dict(task=task, label=TASKS[task]['label'], conditions=c, latex=latex, question=question)
    if task in ('asymptote', 'sequence_limit'):
        variable = 'n' if task == 'sequence_limit' else 'x'
        function = parse_expression(c['expression'], (variable,), preserve_structure=True)
        _validate(task, c)
        if task == 'asymptote':
            from .limit_extra import _rational_parts
            _rational_parts(sp.sympify(function))
            latex = rf'f(x)={to_latex(function)}'
            question = f"求函数 f(x)={c['expression']} 的全部渐近线（垂直、水平、斜）"
        else:
            latex = rf'\lim_{{n\to\infty}} {to_latex(function)}'
            question = f"求数列 aₙ={c['expression']} 当 n→∞ 的极限"
        return dict(task=task, label=TASKS[task]['label'], conditions=c, latex=latex, question=question)
    if task in ('arc_length', 'parametric_arc_length', 'surface_of_revolution', 'polar_area', 'polar_arc_length'):
        from .integral_applications import _bound
        variable = 'theta' if task in ('polar_area', 'polar_arc_length') else ('t' if task == 'parametric_arc_length' else 'x')
        if task == 'parametric_arc_length':
            xt = parse_expression(c['x_expression'], ('t',), preserve_structure=True)
            yt = parse_expression(c['y_expression'], ('t',), preserve_structure=True)
        else:
            function = parse_expression(c['expression'], (variable,), preserve_structure=True)
        a = _bound(c['lower'], '积分下限')
        b = _bound(c['upper'], '积分上限')
        if not bool(a < b):
            raise ValueError('积分区间要求下限小于上限，不能通过反转区间改变符号')
        c['lower'] = expression_text(a)
        c['upper'] = expression_text(b)
        if task == 'surface_of_revolution':
            axis = c.get('rotation_axis')
            if axis not in ('x', 'y'):
                raise ValueError('请选择旋转轴：x 轴或 y 轴')
            if axis == 'y' and bool(a < 0) and bool(b > 0):
                raise ValueError('绕 y 轴的旋转曲面要求曲线位于 y 轴一侧；跨轴时半径 |x| 需分段，请拆分区间')
        _validate(task, c)
        if task == 'parametric_arc_length':
            latex = rf'x={to_latex(xt)},\quad y={to_latex(yt)},\quad t\in[{to_latex(a)},{to_latex(b)}]'
            question = (f"求参数曲线 x={c['x_expression']}, y={c['y_expression']}，"
                        f"t∈[{c['lower']},{c['upper']}] 的弧长")
        elif task in ('polar_area', 'polar_arc_length'):
            latex = rf'r={to_latex(function)},\quad \theta\in[{to_latex(a)},{to_latex(b)}]'
            goal = '围成的面积' if task == 'polar_area' else '的弧长'
            question = (f"求极坐标曲线 r={c['expression']}，θ∈[{c['lower']},{c['upper']}] {goal}")
        elif task == 'surface_of_revolution':
            latex = rf'y={to_latex(function)},\quad x\in[{to_latex(a)},{to_latex(b)}]，绕{axis}轴'
            question = (f"求曲线 y={c['expression']}，x∈[{c['lower']},{c['upper']}] "
                        f"绕{axis}轴旋转所得旋转曲面的面积")
        else:
            latex = rf'y={to_latex(function)},\quad x\in[{to_latex(a)},{to_latex(b)}]'
            question = f"求曲线 y={c['expression']}，x∈[{c['lower']},{c['upper']}] 的弧长"
        return dict(task=task, label=TASKS[task]['label'], conditions=c, latex=latex, question=question)
    if task in ('higher_derivative', 'taylor'):
        raw_order = c.get('order')
        if isinstance(raw_order, bool) or str(raw_order) not in [str(n) for n in range(1, 11)]:
            raise ValueError('导数阶数必须是1至10的整数')
        c['order'] = int(raw_order)
    if task in ('derivative', 'limit', 'continuity', 'taylor') or (task == 'higher_derivative' and 'point' in c):
        raw = c.get('point')
        infinities = {'oo': 'oo', '+oo': 'oo', 'inf': 'oo', '+inf': 'oo', '∞': 'oo', '+∞': 'oo', '-oo': '-oo', '-inf': '-oo', '-∞': '-oo'}
        if task == 'limit' and str(raw).strip() in infinities:
            c['point'] = infinities[str(raw).strip()]
        else:
            if isinstance(raw, bool) or raw is None or len(str(raw)) > 100:
                raise ValueError('请填写常数点，可使用分数或 pi')
            exact_point = parse_expression(str(raw))
            if exact_point.free_symbols or exact_point.is_real is not True or safe_float(exact_point) is None:
                raise ValueError('请填写有限实数点，可使用分数或 pi')
            exact_point = exact_point.xreplace({n: sp.Rational(str(n)) for n in exact_point.atoms(sp.Float)})
            c['point'] = float(exact_point)
        if task == 'limit' and 'side' not in c:
            raise ValueError('请选择趋近方向')
    if task == 'continuity':
        if c.get('value_mode') not in ('expression', 'undefined', 'value'):
            raise ValueError('请选择该点函数值的定义方式')
        if c['value_mode'] == 'value':
            raw_value = c.get('point_value')
            if isinstance(raw_value, bool) or raw_value is None or len(str(raw_value)) > 100:
                raise ValueError('请填写题目给定的单点函数值')
            point_value = parse_expression(str(raw_value))
            if point_value.free_symbols or point_value.is_real is not True or safe_float(point_value) is None:
                raise ValueError('单点函数值必须是有限实常数')
            c['point_value'] = expression_text(point_value)
        elif 'point_value' in c:
            raise ValueError('所选单点定义方式不能忽略额外给定的函数值')
    _validate(task, c)
    variable = 'x' if task in ('geometric_area','rotation_volume') else c['variable']
    expression = parse_expression(c['expression'], (variable,), preserve_structure=True)
    simplified = parse_expression(c['expression'], (variable,))
    c['expression'] = c['expression'].strip()
    if task in ('geometric_area','rotation_volume'):
        from sympy.calculus.util import continuous_domain
        a,b=parse_expression(c['lower']),parse_expression(c['upper'])
        if not bool(a<b): raise ValueError('几何区域要求下限小于上限，不能通过反转区间改变面积符号')
        if sp.Interval(a,b).is_subset(continuous_domain(expression,sp.Symbol('x',real=True),sp.S.Reals)) is not True:
            raise ValueError('首批面积与体积手动输入要求边界函数在整个有限闭区间有实定义且连续；不自动填补空点或跨越瑕点')
        lower_expression = None
        if c.get('region_kind') == 'between_curves':
            raw_lower = c.get('lower_expression')
            if not isinstance(raw_lower, str) or not raw_lower.strip():
                raise ValueError('请填写两条曲线之间区域的下边界函数 g(x)')
            lower_expression = parse_expression(raw_lower, ('x',), preserve_structure=True)
            if sp.Interval(a,b).is_subset(continuous_domain(lower_expression,sp.Symbol('x',real=True),sp.S.Reals)) is not True:
                raise ValueError('下边界函数在整个有限闭区间必须有实定义且连续；不自动填补空点或跨越瑕点')
            c['lower_expression'] = raw_lower.strip()
        axis = c.get('rotation_axis') or 'x'
        if task == 'rotation_volume' and axis == 'y' and bool(a < 0) and bool(b > 0):
            raise ValueError('绕 y 轴旋转要求区域完全位于 y 轴一侧；跨 y 轴的区域折叠后不能直接按壳层法累加，请拆分区域或更换旋转轴')
        if task == 'rotation_volume' and c['region_kind'] == 'between_curves' and axis == 'x':
            from .exam_math import _require_nonnegative
            _require_nonnegative(expression, a, b, '两曲线之间的区域绕 x 轴旋转要求上边界 f(x)≥0')
            _require_nonnegative(lower_expression, a, b, '两曲线之间的区域绕 x 轴旋转要求下边界 g(x)≥0；区域跨越 x 轴时圆环法不适用')
        if c['region_kind'] == 'between_curves':
            region = rf'{to_latex(lower_expression)}\le y\le {to_latex(expression)}'
            description = f'曲线 y={c["expression"]} 与 y={c["lower_expression"]} 之间的全部区域'
        else:
            region = (rf'\min(0,{to_latex(expression)})\le y\le\max(0,{to_latex(expression)})' if c['region_kind']=='between_axis' else rf'0\le y\le {to_latex(expression)}')
            description = '曲线与x轴之间的全部区域（包含负函数区域）' if c['region_kind']=='between_axis' else '不等式0≤y≤f(x)的区域（f(x)<0处为空）'
        latex=rf'D=\{{(x,y)\mid {to_latex(a)}\le x\le {to_latex(b)},\ {region}\}}'
        if task == 'geometric_area':
            question=f"求 {description}，f(x)={c['expression']}，x∈[{c['lower']},{c['upper']}] 的平面面积"
        else:
            method = '壳层法，体积元 2π|x|·高度·dx' if axis == 'y' else '圆盘/圆环法'
            question=(f"求 {description}，f(x)={c['expression']}，x∈[{c['lower']},{c['upper']}] 的"
                      f"绕{axis}轴旋转体积；旋转轴={axis}轴；{method}")
        return dict(task=task,label=TASKS[task]['label'],conditions=c,latex=latex,question=question)
    if task == 'integral':
        for key in ('lower', 'upper'):
            raw = c[key]
            if isinstance(raw, bool) or not isinstance(raw, (str, int, float)) or len(str(raw)) > 100:
                raise ValueError(f'{FIELD_LABELS[key]}必须是有限实数，可使用分数或 pi')
            endpoint = parse_expression(str(raw))
            if endpoint.free_symbols or endpoint.is_real is not True or safe_float(endpoint) is None:
                raise ValueError(f'{FIELD_LABELS[key]}必须是有限实数，可使用分数或 pi')
            endpoint = endpoint.xreplace({
                node: sp.Rational(str(node)) for node in endpoint.atoms(sp.Float)})
            c[key] = expression_text(endpoint)
        latex = (rf'\int_{{{to_latex(parse_expression(c["lower"]))}}}'
                 rf'^{{{to_latex(parse_expression(c["upper"]))}}}'
                 rf'{to_latex(expression)}\,\mathrm{{d}}{variable}')
        question = f'计算定积分 ∫_{{{c["lower"]}}}^{{{c["upper"]}}} ({c["expression"]}) d{variable}'
    elif task == 'derivative':
        point = exact_point
        symbol = sp.Symbol(variable, real=True)
        from sympy.calculus.util import continuous_domain
        from .calculus_analysis import _real_side_defined
        if continuous_domain(expression, symbol, sp.S.Reals).contains(point) is not sp.S.true:
            raise ValueError('求导点不在原式已确认的实定义域内')
        side_domain = _real_side_defined(expression, symbol, point)
        if not side_domain.get('left') or not side_domain.get('right'):
            raise ValueError('该点在原式只有单侧实邻域；当前导数入口只支持双侧实邻域，不能按双侧导数判定')
        left = sp.limit((expression - expression.subs(symbol, point))/(symbol-point), symbol, point, dir='-')
        right = sp.limit((expression - expression.subs(symbol, point))/(symbol-point), symbol, point, dir='+')
        if safe_float(left) is None or safe_float(right) is None or sp.simplify(left-right) != 0:
            raise ValueError('该点不存在可确认的有限双侧导数，当前不生成切线实验')
        latex = rf"f'({to_latex(point)})"
        question = f"求函数 f({variable})={c['expression']} 在 {variable}={expression_text(point)} 处的导数与切线"
    elif task == 'function_study':
        left = '(' if c['interval_type'] in ('open','left_open') else '['
        right = ')' if c['interval_type'] in ('open','right_open') else ']'
        latex = rf"f({variable})={to_latex(expression)},\quad {variable}\in {left}{to_latex(parse_expression(c['lower']))},{to_latex(parse_expression(c['upper']))}{right}"
        question = f"研究 f({variable})={c['expression']} 在 {left}{c['lower']},{c['upper']}{right} 内的单调性、极值最值、凹凸性与拐点"
    elif task == 'continuity':
        latex = rf'f({variable})={to_latex(expression)},\quad {variable}_0={to_latex(exact_point)}'
        definition = {'expression': '按原式取值', 'undefined': '该点未定义', 'value': f"该点函数值={c.get('point_value', '')}"}[c['value_mode']]
        question = f"判断 f({variable})={c['expression']} 在 {variable}={exact_point} 处的连续性与间断点类型；{definition}"
    elif task == 'taylor':
        latex = rf"f({variable})={to_latex(expression)},\quad a={to_latex(exact_point)},\quad n={c['order']}"
        question = f"求 f({variable})={c['expression']} 在 {variable}={expression_text(exact_point)} 处的{c['order']}阶泰勒展开并说明余项"
    elif task == 'higher_derivative':
        latex = rf"\frac{{\mathrm{{d}}^{{{c['order']}}}}}{{\mathrm{{d}}{variable}^{{{c['order']}}}}}\left({to_latex(expression)}\right)"
        question = f"求函数 f({variable})={c['expression']} 的{c['order']}阶导数"
        if exact_point is not None:
            latex += rf'\bigg|_{{{variable}={to_latex(exact_point)}}}'
            question += f'，并在 {variable}={expression_text(exact_point)} 处求值'
    elif task == 'limit':
        point = exact_point if exact_point is not None else (sp.oo if c['point'] == 'oo' else -sp.oo)
        if point in (sp.oo, -sp.oo) and c['side'] != 'both':
            raise ValueError('无穷远趋近请选择双侧/通常极限方向')
        suffix = {'both': '', 'left': '^-', 'right': '^+'}[c['side']]
        latex = rf'\lim_{{{variable}\to {to_latex(point)}{suffix}}} {to_latex(expression)}'
        question = f"求极限 {c['expression']}，{variable}→{point}，方向：{c['side']}"
    else:
        latex = rf'\int {to_latex(expression)}\,\mathrm{{d}}{variable}'
        question = f'计算不定积分 ∫ ({c["expression"]}) d{variable}'
    interval = (sp.Interval(*sorted([parse_expression(c['lower']), parse_expression(c['upper'])], key=float))
                if task == 'integral' else sp.S.Reals)
    symbol = sp.Symbol(variable, real=True)
    try:
        original_profile = domain_gap_profile(expression, symbol, interval)
        simplified_profile = domain_gap_profile(simplified, symbol, interval)
        if original_profile['complete'] and simplified_profile['complete']:
            # 周期函数的瑕点族在 SymPy 集合里带不同的哑指标，不能直接用 == 比较；
            # 只要双方都没有正测度缺口，差异就只是零测度的孤立点，不构成隐藏条件。
            if (original_profile['gap'] or simplified_profile['gap']) and original_profile['domain'] != simplified_profile['domain']:
                raise ValueError('化简会改变原式实定义域，请调整区间或改写为可核对的表达式')
        elif original_profile['domain'] != simplified_profile['domain']:
            raise ValueError('化简会改变原式实定义域，请调整区间或改写为可核对的表达式')
        if task == 'integral' and (not original_profile['complete'] or original_profile['gap']):
            raise ValueError('原式实定义域不覆盖积分区间，存在无定义的实区间')
    except (NotImplementedError, TypeError) as exc:
        raise ValueError('当前未能验证原式实定义域，请改写公式或调整区间') from exc
    if exact_point is not None:
        c['point'] = expression_text(exact_point)
    return {'task': task, 'label': TASKS[task]['label'], 'conditions': c, 'latex': latex, 'question': question}


def build_manual_document(*, lab_id: str, title: str, task: str,
                          conditions: dict[str, Any], now_iso: str) -> dict[str, Any]:
    from .extract import text_source
    from .recognize import _default_state
    from .kernel_models import compile_kernel_problem

    preview = preview_integral(task, conditions)
    c = preview['conditions']
    kernel_conditions = copy.deepcopy(c)
    if task == 'ode': kernel_conditions['initial_conditions'] = c['initial_conditions'].splitlines()
    if task in ('derivative', 'inverse_derivative', 'limit', 'parameter_limit') and 'point' in c and c['point'] not in ('oo', '-oo'):
        kernel_conditions['point'] = float(parse_expression(c['point']))
    if task == 'integral' and c.get('integral_mode') == 'improper':
        from .manual_improper_integral import build_problem
        from .recognize import _attach_solution
        problem=build_problem(c)
        _attach_solution(problem)
    elif task == 'double_integral':
        from .manual_double_integral import build_problem
        from .recognize import _attach_solution
        problem=build_problem(c)
        problem['model']['modeling_task']=task
        _attach_solution(problem)
    elif task == 'triple_integral':
        from .manual_triple_integral import build_problem
        from .recognize import _attach_solution
        problem=build_problem(c)
        problem['model']['modeling_task']=task
        _attach_solution(problem)
    elif task == 'space_geometry':
        from .manual_space_geometry import build_problem
        from .recognize import _attach_solution
        problem=build_problem(c)
        problem['model']['modeling_task']=task
        _attach_solution(problem)
    elif task == 'curve_surface_integral':
        from .manual_space_integrals import build_problem
        from .recognize import _attach_solution
        problem=build_problem(c)
        problem['model']['modeling_task']=task
        _attach_solution(problem)
    elif task == 'proof':
        from .manual_proof import build_problem
        from .recognize import _attach_solution
        problem=build_problem(c)
        problem['model']['modeling_task']=task
        _attach_solution(problem)
    elif task in ('series_convergence', 'power_series', 'fourier_series'):
        from .manual_series import build_problem
        from .recognize import _attach_solution
        problem=build_problem(task, c)
        _attach_solution(problem)
    else:
        problem = compile_kernel_problem({'task': task, 'conditions': kernel_conditions}, allow_unfinished=True)
    if task in ('derivative', 'limit', 'continuity', 'taylor') or (task == 'higher_derivative' and 'point' in c):
        from .recognize import _attach_solution
        problem['model']['exact_point'] = c['point']
        if task == 'taylor': problem['model']['taylor_point'] = c['point']
        problem['model']['preserve_expression_structure'] = True
        _attach_solution(problem)
    if task == 'higher_derivative':
        from .recognize import _attach_solution
        if 'point' in c:
            problem['model']['derivative_point'] = c['point']
        problem['model']['preserve_expression_structure'] = True
        _attach_solution(problem)
    solution = problem['solution']
    solution_status = solution.get('solution_status')
    if task == 'integral' or (task == 'double_integral' and c.get('region_mode') in ('improper','polar_improper','strip_improper')):
        if solution_status == 'divergent':
            result_status = 'divergent'
            result_latex = solution.get('exact_latex') or ''
            result_note = solution.get('incomplete_reason') or solution.get('summary') or ''
            problem['status'] = 'ready'
        elif solution_status in ('incomplete', 'undetermined', 'unsupported', 'undefined'):
            result_status = 'unsupported'
            result_latex = ''
            result_note = (solution.get('incomplete_reason') or solution.get('summary')
                           or '当前内核未能给出可信的闭式结果')
            problem['status'] = 'unsupported'
        elif solution.get('solution_complete') is False or not solution.get('answer'):
            result_status = 'unsupported'
            result_latex = ''
            result_note = (solution.get('limitations') or [solution.get('summary')
                           or '当前内核未能完成该积分'])[0]
            problem['status'] = 'unsupported'
        else:
            result_status = 'complete'
            result_latex = solution.get('exact_latex') or ''
            result_note = ''
            problem['status'] = 'ready'
            if not result_latex:
                raise ValueError('内核未提供可展示的精确结果') from None
    elif task in ('series_convergence', 'power_series', 'fourier_series'):
        if (solution_status in ('incomplete', 'undetermined', 'unsupported', 'undefined')
                or solution.get('solution_complete') is False or not solution.get('answer')):
            result_status = 'unsupported'
            result_latex = ''
            result_note = (solution.get('incomplete_reason') or solution.get('summary')
                           or (solution.get('limitations') or ['当前级数内核未给出确定结论'])[0])
            problem['status'] = 'unsupported'
        else:
            result_status = 'complete'
            result_latex = ''
            result_note = ''
            problem['status'] = 'ready'
    elif task == 'proof':
        if solution.get('proof_status') in ('verified', 'disproved'):
            result_status = 'complete'
            result_latex = ''
            result_note = ''
            problem['status'] = 'ready'
        else:
            result_status = 'unsupported'
            result_latex = ''
            result_note = (solution.get('incomplete_reason') or solution.get('summary')
                           or '当前证明未获得整体认证，只保留已核验的证明义务。')
            problem['status'] = 'unsupported'
    else:
        if (solution_status in ('incomplete', 'undetermined', 'unsupported', 'undefined')
                or solution.get('solution_complete') is False or not solution.get('answer')):
            result_status = 'unsupported'
            result_latex = ''
            result_note = (solution.get('incomplete_reason') or solution.get('summary')
                           or (solution.get('limitations') or ['当前内核未能完成该不定积分'])[0])
            problem['status'] = 'unsupported'
        else:
            result_status = 'complete'
            result_latex = solution.get('exact_latex') or solution.get('exact') or ''
            result_note = ''
            problem['status'] = 'ready'
            if not result_latex:
                raise ValueError('内核未提供可展示的精确结果') from None
    proof_details = None
    if task == 'proof':
        from .manual_proof import KIND_LABELS, certificate_facts
        certificate = solution.get('certificate') or {}
        proof_details = {'label': KIND_LABELS.get(str(c.get('proof_kind')), '证明'),
                         'proof_kind': solution.get('proof_kind'),
                         'proof_status': solution.get('proof_status'),
                         'verification_level': solution.get('verification_level'),
                         'obligations': solution.get('obligations') or [],
                         'certificate': certificate,
                         'certificate_facts': certificate_facts(certificate),
                         'statement': c.get('statement') or '',
                         'reason': solution.get('incomplete_reason')}
    from .exploration import attach_controls
    attach_controls(problem)
    problem['manual_input'] = {'task': task, 'conditions': {k: str(v) for k, v in c.items()}, 'confirmed': True,
                               'latex': preview['latex'], 'result_latex': result_latex,
                               'result_status': result_status,
                               'continuity': solution.get('continuity'),
                               'line_geometry': solution.get('line_geometry'),
                               'study': solution.get('study') if task == 'function_study' else None,
                               'taylor_details': solution.get('taylor_details'),
                               'multi_details': solution.get('multi_details'),
                               'extrema_details': solution.get('extrema_details'),
                               'double_details': solution.get('double_details'),
                               'triple_details': solution.get('triple_details'),
                               'space_details': solution.get('space_details'),
                               'space_integral_details': solution.get('space_integral_details'),
                               'proof_details': proof_details,
                               'series_details': solution.get('series_details'),
                               'integral_function_details': solution.get('integral_function_details'),
                               'parametric_details': solution.get('parametric_details'),
                               'implicit_derivative_details': solution.get('implicit_derivative_details'),
                               'curvature_details': solution.get('curvature_details'),
                               'application_details': solution.get('application_details'),
                               'power_details': solution.get('power_details'),
                               'fourier_details': solution.get('fourier_details'),
                               'double_extension': solution.get('double_extension'),
                               'ode_details': {key: solution.get(key) for key in ('ode_order','ode_hints','solution_latex','initial_conditions','residual_verified','initial_conditions_verified','free_constants','solution_domain','scope_note')} if task == 'ode' else None,
                               'geometry_details': {'region_kind': c['region_kind'], 'rotation_axis': c.get('rotation_axis'), 'lower_expression': c.get('lower_expression'), 'quantities': solution.get('quantities', []), 'zero_points': problem['model'].get('boundary_roots', []), 'effective_intervals': problem['model'].get('effective_intervals')} if task in ('geometric_area','rotation_volume') else None,
                               'result_answer': solution.get('answer') or '',
                               'result_approx': solution.get('approx') or '',
                               'result_note': result_note,
                               'verification': solution.get('verification')}
    if task == 'ode':
        problem['manual_input']['ode_details']['initial_conditions'] = problem['model'].get('initial_conditions', [])
        problem['manual_input']['ode_details']['ode_order'] = problem['model']['order']
    problem['text'] = preview['question']
    problem['title'] = preview['question']
    problem['model']['formula_tex'] = preview['latex']
    if task in ('series_convergence', 'power_series', 'fourier_series'):
        pass
    elif task == 'double_integral':
        problem['model']['expression'] = c['integrand']
    elif task == 'triple_integral':
        problem['model']['expression'] = c['integrand']
    elif task == 'space_geometry':
        problem['model']['expression'] = c.get('expression') or c.get('surface') or ''
    elif task == 'curve_surface_integral':
        problem['model']['expression'] = c.get('integrand') or ''
    elif task == 'proof':
        problem['model']['expression'] = c.get('expression') or c.get('left') or ''
    elif task not in ('implicit_normal','implicit_derivative','parametric_derivative','parametric_arc_length','ode'):
        problem['model']['expression'] = c['expression']
    problem['model']['preserve_expression_structure'] = True
    for formula in problem['recognition']['formulas']:
        if r'\int' in formula.get('tex', '') or task in ('series_convergence', 'power_series', 'fourier_series'):
            formula['tex'] = preview['latex']
    for item in problem['recognition']['conditions']:
        if item['id'] in c:
            item.update(value=c[item['id']], provenance='user_confirmed', label={'value_mode': '该点函数值的定义', 'point_value': '单点函数值', **({'point':'展开点','order':'展开阶数'} if task == 'taylor' else {'point':'求值点','direction':'方向向量','partial_variable':'偏导变量','direction_limit':'方向导数约定','operation':'计算任务'} if task == 'multivariable' else {})}.get(item['id'], FIELD_LABELS.get(item['id'], item['label'])), note=None)
        else:
            item.update(provenance='inferred', editable=False, note='演示参数，不是补入的原题条件。')
        if task == 'multivariable_extrema':
            item['label']={'expression':'目标函数','constraint':'完整等式约束','variables':'变量顺序','operation':'极值任务'}.get(item['id'],item['label'])
        if task == 'double_integral':
            from .manual_double_integral import labels
            item['label']=labels(c).get(item['id'],item['label'])
        if task == 'triple_integral':
            from .manual_triple_integral import labels
            item['label']=labels(c).get(item['id'],item['label'])
        if task in ('series_convergence', 'power_series', 'fourier_series'):
            from .manual_series import labels
            item['label']=labels(c).get(item['id'],item['label'])
        if task == 'space_geometry':
            from .manual_space_geometry import labels
            item['label']=labels(c).get(item['id'],item['label'])
        if task == 'curve_surface_integral':
            from .manual_space_integrals import labels
            item['label']=labels(c).get(item['id'],item['label'])
        if task == 'proof':
            from .manual_proof import labels
            item['label']=labels(c).get(item['id'],item['label'])
        if task == 'integral_function':
            item['label']={'expression':'被积函数 f(t)','lower_expression':'下限 a(x)','upper_expression':'上限 b(x)','point':'求值点 x0'}.get(item['id'],item['label'])
        if task == 'parametric_derivative':
            item['label']={'x_expression':'曲线 x(t)','y_expression':'曲线 y(t)','point':'参数点 t0','order':'导数阶数'}.get(item['id'],item['label'])
        if task == 'curvature':
            item['label']={'expression':'函数 f(x)','point':'曲率点 x0'}.get(item['id'],item['label'])
        if task in ('asymptote','sequence_limit'):
            item['label']={'expression':'数列通项 aₙ' if task=='sequence_limit' else '有理函数 f(x)'}.get(item['id'],item['label'])
        if task in ('arc_length','parametric_arc_length','surface_of_revolution','polar_area','polar_arc_length'):
            polar = task in ('polar_area','polar_arc_length')
            item['label']={'expression':'极径 r(θ)' if polar else '曲线 y=f(x)',
                           'x_expression':'曲线 x(t)','y_expression':'曲线 y(t)',
                           'lower':'极角下限' if polar else ('参数下限' if task=='parametric_arc_length' else '积分下限'),
                           'upper':'极角上限' if polar else ('参数上限' if task=='parametric_arc_length' else '积分上限'),
                           'rotation_axis':'旋转轴'}.get(item['id'],item['label'])
    # 发散或内核未完成不是“缺条件”，结果区会单独说明；不要在这里要求用户补条件。
    problem['recognition']['ambiguities'] = [
        item for item in problem['recognition']['ambiguities'] if item.get('id') != 'solution_incomplete']
    problem['states'] = _default_state(problem)
    problem['states']['mode'] = 'solution'
    problem['states']['scenarios'][0]['summary'] = '用户填写并确认的原题条件'
    source = text_source(preview['question'], lab_id=lab_id)
    source['method'] = 'manual_input'
    source['files'][0]['name'] = '手动输入的题目'
    problem['source'] = {'page_from': 1, 'page_to': 1, 'file_names': ['手动输入的题目'],
                         'label': '用户确认的题目', 'excerpt': preview['question']}
    problem['source_pages'] = [{'file_id': 'f1', 'page': 1, 'image_key': None, 'method': 'typed_text'}]
    return {
        'schema_version': 'lab.1', 'lab_id': lab_id, 'title': title.strip() or preview['question'][:120],
        'created_at': now_iso, 'updated_at': now_iso, 'revision': 1,
        'source': {**source, 'citation': '手动输入 · 已确认题目'},
        'problems': [problem], 'selected_problem_id': problem['problem_id'],
        'status': problem['status'], 'subject': 'calculus', 'problem_count': 1,
        'capabilities': {'ai_configured': False, 'ai_solver_configured': False,
                         'ai_note': '按用户确认的条件直接调用本地内核计算。'},
    }


def revise_manual_document(document: dict[str, Any], problem: dict[str, Any],
                           condition_values: dict[str, Any]) -> dict[str, Any]:
    conditions = {**problem['manual_input']['conditions'], **condition_values}
    if problem['manual_input']['task'] == 'multivariable' and condition_values.get('point') == '' and conditions['operation'] != 'directional':
        conditions.pop('point',None)
    if problem['manual_input']['task'] == 'continuity' and condition_values.get('value_mode') in ('expression', 'undefined') and 'point_value' not in condition_values:
        conditions.pop('point_value', None)
    rebuilt_doc = build_manual_document(lab_id=document['lab_id'], title=document['title'],
        task=problem['manual_input']['task'], conditions=conditions, now_iso=document['updated_at'])
    rebuilt = rebuilt_doc['problems'][0]
    rebuilt['problem_id'] = problem['problem_id']
    baseline = rebuilt['states']['scenarios'][0]
    rebuilt['states'] = {**copy.deepcopy(problem['states']), 'params': rebuilt['model']['defaults'],
                         'step': 0, 'evaluated': None, 'active_scenario_id': 'baseline',
                         'scenarios': [baseline]}
    rebuilt['states']['scenarios'].extend(copy.deepcopy([
        {**item, 'summary': '原题修正前保存的参数；按当前公式重放前请重新核对。'}
        for item in problem['states'].get('scenarios', []) if item.get('id') != 'baseline']))
    document['source'] = rebuilt_doc['source']
    return rebuilt

"""用户确认的结构化积分输入，不经过题干识别或模型理解。"""
from __future__ import annotations

import copy
from typing import Any

import sympy as sp

from .expr import expression_text, parse_expression, safe_float, to_latex
from .domain_analysis import domain_gap_profile
from .kernel_models import FIELD_LABELS, TASKS, _validate


def preview_integral(task: str, conditions: dict[str, Any]) -> dict[str, Any]:
    if task not in ('integral', 'antiderivative', 'derivative', 'limit', 'higher_derivative', 'continuity', 'implicit_normal', 'function_study', 'taylor', 'geometric_area', 'rotation_volume', 'ode', 'multivariable', 'multivariable_extrema', 'double_integral', 'triple_integral', 'series_convergence', 'power_series', 'fourier_series', 'space_geometry', 'curve_surface_integral', 'proof'):
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
        region = (rf'\min(0,{to_latex(expression)})\le y\le\max(0,{to_latex(expression)})' if c['region_kind']=='between_axis' else rf'0\le y\le {to_latex(expression)}')
        latex=rf'D=\{{(x,y)\mid {to_latex(a)}\le x\le {to_latex(b)},\ {region}\}}'
        description='曲线与x轴之间的全部区域（包含负函数区域）' if c['region_kind']=='between_axis' else '不等式0≤y≤f(x)的区域（f(x)<0处为空）'
        question=f"求 {description}，f(x)={c['expression']}，x∈[{c['lower']},{c['upper']}] 的"+('平面面积' if task=='geometric_area' else '绕x轴旋转体积；旋转轴=x轴')
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
    if task in ('derivative', 'limit') and 'point' in c and c['point'] not in ('oo', '-oo'):
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
                               'power_details': solution.get('power_details'),
                               'fourier_details': solution.get('fourier_details'),
                               'double_extension': solution.get('double_extension'),
                               'ode_details': {key: solution.get(key) for key in ('ode_order','ode_hints','solution_latex','initial_conditions','residual_verified','initial_conditions_verified','free_constants','solution_domain','scope_note')} if task == 'ode' else None,
                               'geometry_details': {'region_kind': c['region_kind'], 'rotation_axis': c.get('rotation_axis'), 'quantities': solution.get('quantities', []), 'zero_points': problem['model'].get('boundary_roots', []), 'effective_intervals': problem['model'].get('effective_intervals')} if task in ('geometric_area','rotation_volume') else None,
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
    elif task not in ('implicit_normal','ode'):
        problem['model']['expression'] = c['expression']
    else:
        problem['model']['params'] = []
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

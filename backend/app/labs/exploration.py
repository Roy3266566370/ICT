"""Numeric observation controls; symbolic conclusions remain tied to source conditions."""
import math
from .expr import parse_expression, safe_float

SLICE_TASKS = {'multivariable', 'multivariable_extrema', 'constrained_extrema', 'function_study', 'power_series'}


def attach_controls(problem):
    model = problem['model']
    task = model.get('modeling_task') or model.get('task')
    defaults = model.setdefault('defaults', {})
    controls = model.setdefault('params', [])
    def add(key, label, value, low, high, step=0.1):
        if any(p['id'] == key for p in controls):
            return
        defaults[key] = int(value) if step >= 1 else float(value)
        controls.append(dict(id=key, label=label, kind='number', min=low, max=high, step=step, options=[]))
    if task == 'power_series':
        solution = problem.get('solution') or {}
        model['observation_expression'] = solution.get('sum_function') or solution.get('polynomial') or model.get('expression')
        if not model.get('observation_expression') and model.get('coefficient'):
            import sympy as sp
            coefficient = parse_expression(model['coefficient'], ('n',))
            n = next((v for v in coefficient.free_symbols if str(v) == 'n'), sp.Symbol('n', real=True))
            x = sp.Symbol('x', real=True)
            center = parse_expression(str(model.get('center') or '0'))
            start = int(model.get('index_start') or 0)
            model['observation_partial'] = True
            model['observation_expression'] = str(sum(coefficient.subs(n, i)*(x-center)**i for i in range(start, start+20)))
    if task in SLICE_TASKS and (task != 'power_series' or model.get('observation_expression')):
        add('view_radius', '观察半径', 3, 0.1, 10)
        for variable in model.get('variables') or [model.get('variable') or 'x']:
            add('probe_' + variable, '观察坐标 ' + variable, 0, -10, 10)
    if task == 'continuity':
        add('view_radius', '观察半径', 3, 0.1, 10)
        value = safe_float(parse_expression(str((model.get('continuity_config') or {}).get('value') or '0')))
        add('point_value', '实验点值 f(a)', value or 0, -10, 10)
    if problem.get('solution', {}).get('space'):
        add('view_yaw', '空间旋转角度', 0, -180, 180, 5)
        add('view_zoom', '空间显示比例', 1, 0.5, 2, 0.1)
    if task == 'series_convergence':
        add('terms', '部分和项数', 40, 1, 200, 1)


def observe(model, params, result):
    task = model.get('modeling_task') or model.get('task')
    if result.get('space'):
        result['space'] = {**result['space'], 'view_yaw':float(params.get('view_yaw',0)), 'view_zoom':float(params.get('view_zoom',1))}
    if task == 'series_convergence':
        import sympy as sp
        expr = parse_expression(model['term'], ('n',))
        symbol = next((v for v in expr.free_symbols if str(v) == 'n'), sp.Symbol('n', real=True))
        start = int(model.get('index_start', 1))
        terms = max(1, min(200, int(params.get('terms', 40))))
        total, points = 0, []
        for n in range(start, start + terms):
            value = safe_float(expr.subs(symbol, n))
            if value is None: break
            total += value
            points.append(dict(x=n, y=total))
        result.update(series=points, approx=total, domain=dict(x_min=start, x_max=start+max(1, terms-1)))
        return result
    if task == 'continuity':
        from .continuity import continuity_report
        point = float(parse_expression(model['exact_point']))
        value = float(params.get('point_value', model['defaults']['point_value']))
        radius = float(params.get('view_radius', 3))
        report = continuity_report({**model, 'continuity_config': {'mode': 'value', 'value': str(value)}})
        result.update(domain=dict(x_min=point-radius, x_max=point+radius))
        result.setdefault('metrics', []).extend([dict(id='point_value', label='实验点值 f(a)', value=str(value)),
            dict(id='continuity', label='实验点连续性', value=report['continuity']['label'])])
        return result
    if task not in SLICE_TASKS:
        return result
    variables = model.get('variables') or [model.get('variable') or 'x']
    source = model.get('expression')
    if task == 'power_series':
        source = model.get('observation_expression') or source
    if not source:
        return result
    expr = parse_expression(source, tuple(variables))
    point = {v: float(params.get('probe_' + v, 0)) for v in variables}
    radius = float(params.get('view_radius', 3))
    if not math.isfinite(radius) or not 0.1 <= radius <= 10 or any(not math.isfinite(v) or abs(v)>10 for v in point.values()):
        raise ValueError('观察参数超出范围')
    import sympy as sp
    symbols = {str(v): v for v in expr.free_symbols}
    def value(values):
        return safe_float(expr.subs({symbols[k]: v for k, v in values.items() if k in symbols}))
    if result.get('subject') == 'optimization':
        result['domain'] = dict(x_min=point['x']-radius,x_max=point['x']+radius,y_min=point['y']-radius,y_max=point['y']+radius)
        result.setdefault('metrics', []).append(dict(id='probe',label='观察点函数值（未必满足约束）',value=str(value(point))))
        return result
    axis = variables[0]
    series = []
    for i in range(201):
        x = point[axis] - radius + 2 * radius * i / 200
        series.append(dict(x=x, y=value({**point, axis: x})))
    result.update(series=series, domain=dict(x_min=point[axis]-radius, x_max=point[axis]+radius))
    result.setdefault('metrics', []).append(dict(id='probe', label='观察点函数值', value=str(value(point))))
    result.setdefault('notes', []).append('切片与观察点用于数值实验；极值、约束与收敛性结论仍以原题内核核验为准。')
    return result

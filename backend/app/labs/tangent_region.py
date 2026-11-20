"""Exact tangent-plane projection and polynomial extrema on its closed triangle."""
import sympy as sp

from .expr import parse_expression, safe_float, to_latex
from .extrema import X, Y, _finite_points, _polynomial


def _constant(raw):
    value = parse_expression(str(raw))
    if value.free_symbols or safe_float(value) is None:
        raise ValueError('切点坐标必须是有限实常数')
    return sp.nsimplify(value)


def _nonnegative(value):
    result = sp.simplify(value).is_nonnegative
    if result is None:
        raise ValueError('无法精确判定候选点是否属于投影区域')
    return result


def solve_tangent_region(model):
    c = model['typed_conditions']
    if c.get('variables', 'x,y') != 'x,y':
        raise ValueError('投影区域任务的变量顺序必须为x,y')
    f = parse_expression(c['expression'], ('x', 'y'))
    if not _polynomial(f, 6):
        raise ValueError('目前只认证次数不超过6的二元实多项式')
    raw_point = c.get('point')
    if not isinstance(raw_point, (list, tuple)) or len(raw_point) != 3:
        raise ValueError('切点必须包含曲面上的三个坐标[x,y,z]')
    x0, y0, z0 = [_constant(v) for v in raw_point]
    point = {X: x0, Y: y0}
    if sp.simplify(f.subs(point)-z0) != 0:
        raise ValueError('给定切点不在原曲面上')
    a, b = [sp.simplify(sp.diff(f, v).subs(point)) for v in (X, Y)]
    intercept = sp.simplify(z0-a*x0-b*y0)
    if a == 0 or b == 0 or intercept == 0:
        raise ValueError('切平面与坐标面不能围成非退化有界四面体')
    u, v = sp.simplify(-intercept/a), sp.simplify(-intercept/b)
    if any(t.is_positive is not True for t in (u, v, intercept)):
        raise ValueError('仅支持切平面与正坐标轴围成的有界四面体投影')
    z = sp.Symbol('z', real=True)
    plane = sp.expand(z-a*X-b*Y-intercept)
    vertices = [(sp.S.Zero, sp.S.Zero), (u, sp.S.Zero), (sp.S.Zero, v)]
    candidates = list(vertices)
    gradient = [sp.diff(f, s) for s in (X, Y)]
    roots, complete = _finite_points(gradient, (X, Y))
    if not complete:
        raise ValueError('内部驻点全集尚未认证，不能宣称全局最值')
    for root in roots:
        px, py = root[X], root[Y]
        if all(_nonnegative(t) for t in (px, py, 1-px/u-py/v)):
            candidates.append((px, py))
    t = sp.Symbol('t', real=True)
    edge_details = []
    for start, end in zip(vertices, vertices[1:]+vertices[:1]):
        px, py = [sp.expand(s+t*(e-s)) for s, e in zip(start, end)]
        edge = sp.expand(f.subs({X: px, Y: py}, simultaneous=True))
        derivative = sp.diff(edge, t)
        # Constant edges have their values represented by both endpoints.
        edge_roots = [] if derivative == 0 else sp.Poly(derivative, t).real_roots()
        for root in edge_roots:
            if _nonnegative(root) and _nonnegative(1-root):
                candidates.append((sp.simplify(px.subs(t, root)), sp.simplify(py.subs(t, root))))
        edge_details.append({'start': list(map(str, start)), 'end': list(map(str, end)), 'expression': str(edge)})
    candidates = list(dict.fromkeys(candidates))
    values = [sp.simplify(f.subs({X: px, Y: py})) for px, py in candidates]
    minimum, maximum = values[0], values[0]
    for value in values[1:]:
        if _nonnegative(minimum-value):
            minimum = value
        if _nonnegative(value-maximum):
            maximum = value
    def extreme(value):
        return {'value': str(value), 'points': [list(map(str, p)) for p, w in zip(candidates, values) if sp.simplify(w-value) == 0]}
    d = {'plane': str(plane), 'plane_equation': str(plane)+'=0',
         'vertices': [list(map(str, p)) for p in vertices],
         'region': f'x>=0,y>=0,x/({u})+y/({v})<=1',
         'stationary_complete': True, 'boundary_complete': True,
         'edges': edge_details,
         'candidates': [{'point': list(map(str, p)), 'value': str(w)} for p, w in zip(candidates, values)],
         'minimum': extreme(minimum), 'maximum': extreme(maximum)}
    answer = f'切平面：{plane}=0；D：{d["region"]}；最小值 {minimum}，取于 {d["minimum"]["points"]}；最大值 {maximum}，取于 {d["maximum"]["points"]}'
    steps = [
        {'id': 'tangent-plane', 'title': '（1）计算切平面', 'detail': f'切点代回原曲面成立；偏导数为 fx={a}，fy={b}。', 'latex': to_latex(plane)+'=0'},
        {'id': 'projection', 'title': '（2）确定闭三角形投影区域', 'detail': d['region'], 'latex': rf'x\geq0,\ y\geq0,\ \frac{{x}}{{{to_latex(u)}}}+\frac{{y}}{{{to_latex(v)}}}\leq1'},
        {'id': 'interior', 'title': '枚举内部驻点', 'detail': '使用零维多项式方程组完整求根，并按三角形不等式筛选。'},
        {'id': 'boundary', 'title': '检查三条边及顶点', 'detail': str(edge_details)},
        {'id': 'compare', 'title': '比较所有候选值得到全局最值', 'detail': answer},
    ]
    return {'summary': '先求切平面及其闭三角形投影，再完整比较内部与边界候选值。', 'answer': answer,
            'exact': f'min={minimum};max={maximum}', 'steps': steps, 'conditions': [d['region']],
            'limitations': [], 'solution_complete': True, 'solution_status': 'complete', 'tangent_region_details': d}


def compile_tangent_region(c):
    from .exam_math import _condition
    model = dict(engine='sympy', subject='calculus', task='tangent_region_extrema', kind='tangent_region_extrema',
                 variables=['x', 'y'], expression=c['expression'], typed_conditions=dict(c),
                 defaults={}, params=[], teaching=False)
    solution = solve_tangent_region(model)
    return dict(problem_id='prb_tangent_region', number=None, title='切平面与投影区域上的全局最值',
                text='（1）求给定曲面在指定点的切平面；（2）求原函数在切平面与坐标面围成四面体的闭投影区域上的最大值、最小值。',
                subject='calculus', subject_label='多元函数微分学', confidence=1.0, status='ready',
                source=dict(page_from=1, page_to=1, file_names=[], label='结构化输入', excerpt=''), source_pages=[],
                recognition=dict(method='declarative_kernel', raw_text='', conditions=[_condition(k, k, v, {}) for k, v in c.items()],
                                 ambiguities=[], formulas=[], recognized_subject='calculus', ai_used=False),
                model=model, solution=solution, states={})


def evaluate(model, params=None):
    s = solve_tangent_region(model)
    return dict(subject='calculus', task=model['task'], kind=model['kind'], headline=s['answer'],
                metrics=[], checks=[], notes=[], series=[], domain=dict(x_min=0, x_max=1), rects=[],
                exact=None, approx=None, error=None, answerText=s['answer'], tangent_region_details=s['tangent_region_details'],
                trace=[dict(index=i, label=p['title'], detail=p['detail'], values={}) for i, p in enumerate(s['steps'])])

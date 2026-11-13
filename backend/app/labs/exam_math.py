"""Deterministic geometry, implicit normals and complete stationary-set analysis.

These rules operate on the supplied expressions and bounds. Unsupported geometry
and unresolved branches remain blocking questions, never a substituted example.
"""
from __future__ import annotations

import math
import re
from typing import Any, Mapping

import sympy as sp

from .expr import ExprError, normalize_math, number_text, parse_expression, safe_float, to_latex

X, Y = sp.symbols('x y', real=True)
K = sp.Symbol('k', integer=True)
_MATH = r'[A-Za-z0-9_+*/^().\\{}\[\] \-]+'


def _prefix(raw: str) -> str:
    match = re.match(_MATH, raw.strip())
    if not match:
        return ''
    value = match.group().strip().rstrip('.')
    stack = []
    for index, char in enumerate(value):
        if char in '({[':
            stack.append(char)
        elif char in ')}]':
            if not stack:
                return value[:index].strip()
            stack.pop()
    return value


def _expr(raw: str, variables=('x',)) -> sp.Expr:
    normalized = normalize_math(raw)
    normalized = re.sub(r'(?<=[xy])(?=(?:sqrt|exp|sin|cos|tan|log|ln|abs)\()', '*', normalized)
    return parse_expression(normalized, variables)


def _bound(raw: str) -> sp.Expr:
    if raw in ('oo', '+oo', '∞', '+∞'):
        return sp.oo
    value = _expr(raw)
    if value.free_symbols or safe_float(value) is None:
        raise ExprError('区间端点必须是实数')
    return value


def _condition(key: str, label: str, value: Any, source: Mapping[str, Any], kind='expression') -> dict:
    return dict(id=key, label=label, value=value, kind=kind, unit='', provenance='original',
                source=dict(source), editable=True, options=[], min=None, max=None, step=None)


def _ambiguity(field: str, question: str) -> dict:
    return dict(id='exam_'+field, field=field, question=question, severity='blocking',
                options=[], resolved=False, answer=None)


def _real_roots(expression: sp.Expr, symbol: sp.Symbol, domain=sp.S.Reals) -> list[sp.Expr] | None:
    if expression.is_polynomial(symbol):
        poly = sp.Poly(expression, symbol)
        if poly.degree() > 12:
            return None
        roots = sorted(set(poly.real_roots()), key=lambda v: float(sp.N(v)))
        return [root for root in roots if domain.contains(root) is sp.S.true]
    roots = sp.solveset(expression, symbol, domain=domain)
    if roots is sp.S.EmptySet:
        return []
    if isinstance(roots, sp.FiniteSet):
        return sorted(roots, key=lambda v: float(sp.N(v)))
    return None


def _base(task: str, expression: str, kind='integral') -> dict:
    return dict(engine='sympy', subject='calculus', task=task, kind=kind, variable='x',
                expression=expression, defaults={}, params=[], teaching=False)


def build_exam_math(text: str, source: Mapping[str, Any] | None = None,
                    overrides: Mapping[str, Any] | None = None) -> dict | None:
    """Compile explicit x-axis regions or an implicit normal into an exam model."""
    source, overrides = source or {}, dict(overrides or {})
    overrides = {**dict(overrides.get('condition_values') or {}), **overrides}
    for key, value in (overrides.get('ambiguity_answers') or {}).items():
        if key.startswith('exam_') and str(value).strip():
            overrides[key[5:]] = value
    normalized = text.replace('≤', '<=').replace('≥', '>=').replace('−', '-').replace('π', 'pi')
    normalized = normalized.replace('ｘ', 'x').replace('ｙ', 'y')
    normalized = normalized.replace('√', 'sqrt')
    normalized = re.sub(r'(?<=[0-9xy)])(?=sqrt\()', '*', normalized)
    superscripts = str.maketrans('⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺', '0123456789-+')
    normalized = re.sub(r'[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+', lambda m: '^('+m.group().translate(superscripts)+')', normalized)
    normalized = re.sub(r'\\(?:leq|le)\b', '<=', normalized)
    normalized = re.sub(r'\\(?:geq|ge)\b', '>=', normalized)
    if '法线' in normalized or re.search(r'\bnormal\b', normalized, re.I):
        return _build_normal(normalized, source, overrides)
    if not ('面积' in normalized or '体积' in normalized or re.search(r'\b(area|volume)\b', normalized, re.I)):
        return None
    if not re.search(r'\by\s*(?:<=|=)', normalized):
        return None
    conditions, ambiguities = [], []
    volume = '体积' in normalized or bool(re.search(r'\bvolume\b', normalized, re.I))
    area = '面积' in normalized or bool(re.search(r'\barea\b', normalized, re.I))
    task = 'area_volume' if volume else 'geometric_area'
    expression = str(overrides.get('expression') or '')
    match = re.search(r'\by\s*(?:<=|=)\s*', normalized)
    if not expression and match:
        expression = _prefix(normalized[match.end():])
    model = _base(task, expression)
    model['requested_quantities'] = (['area'] if area else []) + (['volume'] if volume else [])
    try:
        function = _expr(expression)
        model['expression'] = str(function)
        model['formula_tex'] = 'y='+to_latex(function)
        conditions.append(_condition('expression', '区域边界函数', str(function), source))
    except (ExprError, ValueError):
        ambiguities.append(_ambiguity('expression', '请确认区域上边界 y=f(x) 的完整表达式。'))
        return _built(model, conditions, ambiguities)
    if volume and not re.search(r'(?:绕|about)\s*(?:the\s*)?x\s*(?:轴|axis)', normalized, re.I):
        ambiguities.append(_ambiguity('rotation_axis', '请确认旋转轴；当前确定性内核支持绕 x 轴的圆盘法。'))
    y_lower_bounds = []
    for lower_match in re.finditer(r'('+_MATH+r')<=\s*y\b', normalized):
        y_lower_bounds.append(lower_match.group(1).strip().lstrip('{').strip())
    for lower_match in re.finditer(r'\by\s*>=\s*', normalized):
        y_lower_bounds.append(_prefix(normalized[lower_match.end():]))
    for lower_boundary in y_lower_bounds:
        try:
            if sp.simplify(_expr(lower_boundary)) != 0:
                raise ExprError('暂不支持非零区域下边界')
        except (ExprError, ValueError):
            ambiguities.append(_ambiguity('region', '区域下边界不是已确认的 y=0，请核对完整边界。'))
            break
    explicit_inequality = bool(y_lower_bounds) and bool(re.search(r'\by\s*<=',normalized))
    model['region_kind'] = 'vertical_inequality' if explicit_inequality else 'between_axis'
    if re.search(r'\by\s*<=',normalized) and not y_lower_bounds:
        ambiguities.append(_ambiguity('region','不等式区域缺少 y 的下边界，请核对完整区域。'))
    if not y_lower_bounds and not re.search(r'x\s*(?:轴|axis)',normalized,re.I):
        ambiguities.append(_ambiguity('region','请确认完整区域边界；当前支持函数与 x 轴之间的区域。'))
    if len(re.findall(r'\by\s*=',normalized))>1:
        ambiguities.append(_ambiguity('region','存在多条函数边界，请核对区域；不能自动按 x 轴替代其他边界。'))
    lower, upper = overrides.get('lower'), overrides.get('upper')
    chained = re.search(r'([^,，{}|;；\n]+?)<=\s*x\s*<=\s*([^,，};；\n]+)', normalized)
    lower_match = re.search(r'\bx\s*>=\s*', normalized)
    upper_match = re.search(r'\bx\s*<=\s*', normalized)
    if lower is None and lower_match:
        lower = _prefix(normalized[lower_match.end():])
    if upper is None and upper_match:
        upper = _prefix(normalized[upper_match.end():])
    if chained:
        if lower is None:
            lower = _prefix(chained.group(1))
        if upper is None:
            upper = _prefix(chained.group(2))
    if lower is None and upper is None and ('围成' in normalized or 'enclosed' in normalized.lower()):
        roots = _real_roots(function, X)
        if roots is not None and len(roots) >= 2:
            lower, upper = str(roots[0]), str(roots[-1])
            model['boundary_roots'] = [str(v) for v in roots]
        else:
            ambiguities.append(_ambiguity('bounds', '无法确定有限封闭区域，请提供全部边界或积分区间。'))
    elif lower is not None and upper is None and re.search(r'\bx\s*>=', normalized):
        upper = 'oo'
    if lower is None or upper is None:
        ambiguities.append(_ambiguity('bounds', '请确认完整积分区间，不能用默认 0 到 1 替代原题边界。'))
    else:
        try:
            a, b = _bound(str(lower)), _bound(str(upper))
            if b != sp.oo and not bool(a < b):
                raise ExprError('区间顺序不正确')
            model.update(lower_bound=str(a), upper_bound=str(b), improper_upper=b == sp.oo)
            visual_upper = float(a)+8 if b == sp.oo else float(b)
            model['defaults'] = dict(lower=float(a), upper=visual_upper, n=16)
            model['original_upper'] = str(b)
            model['visual_upper'] = visual_upper
            conditions.extend([_condition('lower', '积分下界', str(a), source),
                               _condition('upper', '积分上界', '+∞' if b == sp.oo else str(b), source)])
            model['params'] = [dict(id='n', label='分割数', kind='number', min=2, max=80, step=1, options=[])]
            if 'boundary_roots' not in model:
                roots = _real_roots(function, X, sp.Interval(a,b))
                model['boundary_roots'] = [str(v) for v in (roots or []) if bool(v > a) and (b == sp.oo or bool(v < b))]
                model['boundary_roots_complete'] = roots is not None
            else:
                model['boundary_roots_complete'] = True
        except (ExprError, ValueError, TypeError):
            ambiguities.append(_ambiguity('bounds', '积分区间无法确认，请提供实数上下界。'))
    if not ambiguities:
        try:
            if explicit_inequality:
                model['effective_intervals'] = _positive_intervals(model)
            model['reference_quantities'] = _quantities(model)
        except (ValueError, TypeError, NotImplementedError):
            ambiguities.append(_ambiguity('integral','积分未收敛到有限值或符号求解未完成，请核对函数与区间。'))
    return _built(model, conditions, ambiguities)


def _positive_intervals(model: Mapping) -> list[list[str]]:
    """Discard fibers for which 0 <= y <= f(x) has no solution."""
    if not model.get('boundary_roots_complete'):
        raise ValueError('无法证明全部零点，不能确定非空纤维')
    function = _expr(str(model['expression']))
    a,b = _bound(model['lower_bound']),_bound(model['upper_bound'])
    cuts = sorted(set([a,b]+[_bound(root) for root in model.get('boundary_roots',[])]),key=lambda v:float(v))
    intervals=[]
    for left,right in zip(cuts,cuts[1:]):
        if not function.is_polynomial(X):
            interval=sp.Interval.open(left,right)
            if sp.calculus.util.continuous_domain(function,X,interval) != interval:
                raise ValueError('函数在分段内并非连续，不能据一个采样点判断符号')
        sample=left+1 if right==sp.oo else (left+right)/2
        sign=sp.simplify(function.subs(X,sample))
        if sign.is_nonnegative is True:
            intervals.append([str(left),str(right)])
        elif sign.is_negative is not True:
            raise ValueError('无法确认分段函数的符号')
    return intervals


def _built(model: dict, conditions: list, ambiguities: list) -> dict:
    return dict(model=model, conditions=conditions, ambiguities=ambiguities,
                formulas=[dict(id='exam_formula', tex=model.get('formula_tex', ''),
                               plain=model.get('expression', ''), role='识别出的原题公式')],
                recognized=not ambiguities)


def _build_normal(text: str, source: Mapping, overrides: Mapping) -> dict:
    model = _base('implicit_normal', '', 'derivative')
    conditions, ambiguities = [], []
    implicit = str(overrides.get('implicit_expression') or '')
    equation_end = 0
    for match in re.finditer(r'('+_MATH+r')=('+_MATH+r')', text):
        lhs, rhs = match.group(1).strip().lstrip('.'), match.group(2).strip().rstrip('.')
        try:
            equation = _expr(lhs, ('x', 'y'))-_expr(rhs, ('x', 'y'))
            if X in equation.free_symbols and Y in equation.free_symbols:
                equation_end = match.end()
                if not implicit:
                    implicit = str(equation)
                break
        except (ExprError, ValueError):
            continue
    try:
        equation = _expr(implicit, ('x', 'y'))
        model.update(expression=str(equation), implicit_expression=str(equation),
                     formula_tex=to_latex(equation)+'=0')
        conditions.append(_condition('implicit_expression', '隐式曲线 F(x,y)=0', str(equation), source))
    except (ExprError, ValueError):
        ambiguities.append(_ambiguity('implicit_expression', '请核对隐式曲线的完整方程 F(x,y)=0。'))
        return _built(model, conditions, ambiguities)
    coordinate_text = text[equation_end:]
    point_match = re.search(r'\bx\s*=\s*([+\-]?\d+(?:\.\d+)?(?:/\d+)?)', coordinate_text)
    point = overrides.get('point', point_match.group(1) if point_match else None)
    if point is None:
        ambiguities.append(_ambiguity('point', '请确认曲线上研究点的 x 坐标。'))
        return _built(model, conditions, ambiguities)
    try:
        point_x = _bound(str(point))
        model['point_x'] = str(point_x)
        model['defaults'] = dict(point=float(point_x), h=0.05)
        roots = _real_roots(equation.subs(X, point_x), Y)
        specified_y = overrides.get('point_y')
        y_match = re.search(r'\by\s*=\s*([+\-]?\d+(?:\.\d+)?(?:/\d+)?)', coordinate_text)
        if specified_y is None and y_match:
            specified_y = y_match.group(1)
        if specified_y is not None:
            point_y = _bound(str(specified_y))
            if sp.simplify(equation.subs({X:point_x, Y:point_y})) != 0:
                raise ExprError('研究点不在曲线上')
        elif roots is not None and len(roots) == 1:
            point_y = roots[0]
        else:
            model['branch_candidates'] = [str(v) for v in (roots or [])]
            ambiguities.append(_ambiguity('point_y', '该横坐标可能对应多个曲线分支，请提供研究点的 y 坐标。'))
            return _built(model, conditions, ambiguities)
        fx = sp.diff(equation, X).subs({X:point_x,Y:point_y})
        fy = sp.diff(equation, Y).subs({X:point_x,Y:point_y})
        if sp.simplify(fx) == 0 and sp.simplify(fy) == 0:
            raise ExprError('研究点为奇点，无法唯一确定法线')
        model['point_y'] = str(point_y)
        slope = sp.simplify(fy/fx) if fx != 0 else None
        model['normal_slope'] = str(slope) if slope is not None else None
        model['vertical_normal'] = fx == 0
        model['partial_x'] = str(sp.diff(equation,X))
        model['partial_y'] = str(sp.diff(equation,Y))
        conditions.extend([_condition('point', '研究点 x 坐标', str(point_x), source),
                           _condition('point_y', '研究点 y 坐标', str(point_y), source)])
    except (ExprError, ValueError, TypeError):
        ambiguities.append(_ambiguity('point', '研究点或法线无法唯一确定，请核对坐标与曲线条件。'))
    return _built(model, conditions, ambiguities)


def _quantities(model: Mapping) -> list[dict]:
    if model.get('reference_quantities'):
        return list(model['reference_quantities'])
    function = _expr(str(model['expression']))
    a, b = _bound(str(model['lower_bound'])), _bound(str(model['upper_bound']))
    roots = [_bound(v) for v in model.get('boundary_roots', [])]
    cuts = [a]+[r for r in roots if bool(r>a) and (b == sp.oo or bool(r<b))]+[b]
    cuts = sorted(set(cuts), key=lambda v: float(v))
    intervals = [(_bound(left),_bound(right)) for left,right in model['effective_intervals']] if 'effective_intervals' in model else list(zip(cuts,cuts[1:]))
    result = []
    for quantity in model['requested_quantities']:
        integrand = function**2*sp.pi if quantity == 'volume' else function
        if quantity == 'area' and model.get('boundary_roots_complete') is False:
            raise ValueError('无法证明分段零点的完整性')
        pieces = [sp.integrate(integrand, (X, left, right)) for left,right in intervals]
        exact = sp.simplify(sum(pieces) if quantity == 'volume' else sum(sp.Abs(v) for v in pieces))
        if exact.has(sp.Integral):
            raise ValueError('符号积分未完成，不能把未验证的数值积分作为原题答案')
        value = safe_float(exact)
        if value is None:
            raise ValueError('该广义积分未收敛到有限值或未能完成解析计算')
        result.append(dict(id=quantity, label='面积' if quantity == 'area' else '旋转体积',
                           exact=str(exact), value=value, latex=to_latex(exact)))
    return result


def solve_exam_math(model: Mapping[str, Any]) -> dict | None:
    task = model.get('task')
    if task not in ('geometric_area','area_volume','implicit_normal'):
        return None
    if task == 'implicit_normal':
        if 'point_y' not in model:
            raise ValueError('曲线分支尚未确认')
        equation = _expr(str(model['implicit_expression']), ('x','y'))
        px,py = _bound(str(model['point_x'])),_bound(str(model['point_y']))
        slope = None if model.get('vertical_normal') else _expr(str(model['normal_slope']))
        line = 'x='+to_latex(px) if slope is None else 'y-('+to_latex(py)+')='+to_latex(slope)+'(x-('+to_latex(px)+'))'
        return dict(summary='隐函数偏导确定切线，再求过研究点的法线。',
                    answer='法线 '+line if slope is None else '法线斜率 '+str(slope),
                    answer_value=safe_float(slope), exact=str(slope) if slope is not None else '斜率不存在（竖直法线）',
                    tangent_tex=line, normal_tex=line, steps=[
                        dict(id='point',title='确认曲线上研究点',latex=f'P=({to_latex(px)},{to_latex(py)})',detail='将给定横坐标代入曲线，保留唯一实分支或已核对的纵坐标。'),
                        dict(id='implicit',title='隐式求导与法线',latex=r'y\prime=-F_x/F_y,\quad k_n=F_y/F_x',detail='光滑点法线方向为梯度 (F_x,F_y)；F_x=0 时法线竖直。'),
                        dict(id='normal',title='写出法线',latex=line,detail='法线经过研究点，方向与切线垂直。')],
                    conditions=['研究点必须位于曲线上，且梯度非零。'], limitations=[])
    quantities = _quantities(model)
    a,b = _bound(str(model['lower_bound'])),_bound(str(model['upper_bound']))
    function = _expr(str(model['expression']))
    return dict(summary='按完整区域边界计算几何面积与题目要求的旋转体积。',
                answer='；'.join(q['label']+' = '+q['exact'] for q in quantities),
                answer_value=quantities[0]['value'], exact=quantities[0]['exact'],
                approx=number_text(quantities[0]['value'],10), quantities=quantities,
                steps=[dict(id='region',title='确定区域与分段点',latex=f'y={to_latex(function)},\\quad x\\in[{to_latex(a)},{to_latex(b)}]',detail='不等式区域仅保留 f(x)≥0 的非空纤维。' if model.get('region_kind')=='vertical_inequality' else '与 x 轴的全部实交点用于分段，几何面积逐段取绝对值。')]+
                      [dict(id=q['id'],title=q['label'],latex=((r'S=\int \max(f(x),0)\,dx=' if q['id']=='area' else r'V=\pi\int \max(f(x),0)^2\,dx=') if model.get('region_kind')=='vertical_inequality' else (r'S=\int |f(x)|\,dx=' if q['id']=='area' else r'V=\pi\int f(x)^2\,dx='))+q['latex'],detail=q['label']+'解析值为 '+q['exact']) for q in quantities],
                conditions=['旋转轴为 x 轴；图形截断展示与原题广义积分分别标注。'] if model.get('improper_upper') else [],
                limitations=[])


def evaluate_exam_math(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict | None:
    if model.get('task') not in ('geometric_area','area_volume','implicit_normal'):
        return None
    solution = solve_exam_math(model)
    if model['task'] == 'implicit_normal':
        return _normal_evaluate(model, params, solution)
    function = _expr(str(model['expression']))
    a = float(model['defaults']['lower'])
    b = float(model['defaults']['upper'])
    n = max(2,min(80,int(params.get('n',16))))
    func = sp.lambdify(X,function,'math')
    def evaluate(x):
        try:
            value=float(func(x))
            if model.get('region_kind') == 'vertical_inequality' and value < 0:
                return None
            return value if math.isfinite(value) else None
        except (ValueError,ZeroDivisionError,OverflowError):
            return None
    series=[dict(x=a+(b-a)*i/259,y=evaluate(a+(b-a)*i/259)) for i in range(260)]
    rects=[]
    for i in range(n):
        x0,x1=a+(b-a)*i/n,a+(b-a)*(i+1)/n
        mid=(x0+x1)/2
        height=evaluate(mid)
        rects.append(dict(x0=x0,x1=x1,mid=mid,height=height if height is not None else 0))
    quantities=solution['quantities']
    volume_preview = quantities[0]['id'] == 'volume'
    approximation=sum((math.pi*r['height']**2 if volume_preview else abs(r['height']))*(r['x1']-r['x0']) for r in rects)
    notes=['曲线与矩形展示几何区域；面积逐段取绝对值，旋转体积使用 πf(x)²。']
    if model.get('improper_upper'):
        notes.append(f'原题上界为 +∞，图形及矩形在 x={b:g} 截断；指标仍为原题广义积分的完整解析值。')
    return dict(subject='calculus',kind='integral',headline=solution['answer'],
                metrics=[dict(id=q['id'],label=q['label']+'解析值',value=number_text(q['value'],10)) for q in quantities],
                checks=[],notes=notes,trace=[dict(index=i,label=q['label'],detail=q['exact'],values={q['id']:q['value']}) for i,q in enumerate(quantities)],
                series=series,domain=dict(x_min=a,x_max=b),rects=rects,
                exact=quantities[0]['value'],approx=approximation,error=abs(approximation-quantities[0]['value']),
                answerText=solution['answer'],quantities=quantities)


def _normal_evaluate(model: Mapping, params: Mapping, solution: Mapping) -> dict:
    equation=_expr(str(model['implicit_expression']),('x','y'))
    px,py=float(_bound(str(model['point_x']))),float(_bound(str(model['point_y'])))
    current=py
    series=[]
    # Continue the confirmed branch from the point separately in each direction.
    for direction in (-1,1):
        current=py
        half=[]
        for i in range(1,81):
            x=px+direction*i/80
            try:
                root=sp.nsolve(equation.subs(X,x),Y,current,verify=True)
                value=safe_float(root)
                if value is None or abs(value-current)>0.5:
                    raise ValueError('branch discontinuity')
                current=value
            except Exception:
                value=None
            half.append(dict(x=x,y=value))
        series.extend(reversed(half) if direction<0 else [dict(x=px,y=py)]+half)
    slope=safe_float(_expr(str(model['normal_slope']))) if model.get('normal_slope') is not None else None
    result = dict(subject='calculus',kind='derivative',headline=solution['answer'],
                metrics=[dict(id='normal_slope',label='法线斜率',value=solution['exact'])],
                checks=[],notes=['仅展示经过已核对研究点的局部隐式曲线分支；叠加直线为法线。'],
                trace=[dict(index=0,label='曲线研究点',detail=solution['answer'],values=dict(x=px,y=py,slope=slope))],
                series=series,domain=dict(x_min=px-1,x_max=px+1),rects=[],exact=solution['answer_value'],approx=solution['answer_value'],error=0,
                answerText=solution['answer'],vertical_normal=model.get('vertical_normal',False))
    if slope is not None:
        result['point'] = dict(x=px,y=py,slope=slope,tangent=dict(m=slope,b=py-slope*px))
    return result


def _finite_families(roots: sp.Set) -> tuple[list[sp.Expr],bool]:
    if roots is sp.S.EmptySet:
        return [],True
    if isinstance(roots,sp.FiniteSet):
        return list(roots),True
    if isinstance(roots,sp.ImageSet) and roots.base_set == sp.S.Integers:
        return [roots.lamda.expr.subs(roots.lamda.variables[0],K)],True
    if isinstance(roots,sp.Union):
        values=[]
        for subset in roots.args:
            partial,complete=_finite_families(subset)
            if not complete:
                return [],False
            values.extend(partial)
        return values,True
    return [],False


def _triangular_extrema_candidates(expression: sp.Expr, symbols: list[sp.Symbol]) -> tuple[list[dict], bool]:
    """Solve one gradient for a variable, then substitute into the other gradient."""
    x, y = symbols
    gx, gy = sp.diff(expression, x), sp.diff(expression, y)
    for first, second, first_grad, second_grad in ((x, y, gx, gy), (y, x, gy, gx)):
        try:
            roots = sp.solveset(second_grad, second, domain=sp.S.Reals)
        except Exception:  # noqa: BLE001
            continue
        if roots is sp.S.EmptySet:
            if second_grad.has(first):
                complete = False
                continue
            return [], True
        if not isinstance(roots, sp.FiniteSet):
            continue
        complete = True
        candidates: list[dict] = []
        for root in roots:
            if not isinstance(root, sp.Expr) or root.is_real is False or not root.free_symbols <= {first}:
                complete = False
                continue
            reduced = sp.simplify(first_grad.subs(second, root))
            try:
                first_roots = sp.solveset(reduced, first, domain=sp.S.Reals)
            except Exception:  # noqa: BLE001
                complete = False
                continue
            if first_roots is sp.S.EmptySet:
                if reduced.has(second):
                    complete = False
                continue
            if not isinstance(first_roots, sp.FiniteSet):
                complete = False
                continue
            for first_root in first_roots:
                if first_root.is_real is not True:
                    complete = False
                    continue
                candidate = {first: sp.simplify(first_root), second: sp.simplify(root.subs(first, first_root))}
                if any(sp.simplify(g.subs(candidate)) != 0 for g in (gx, gy)):
                    complete = False
                    continue
                candidates.append(candidate)
        if complete:
            unique = []
            seen = set()
            for candidate in candidates:
                key = tuple(str(sp.simplify(candidate[s])) for s in symbols)
                if key not in seen:
                    seen.add(key)
                    unique.append(candidate)
            return unique, True
    return [], False


def complete_extrema(model: Mapping[str,Any], base_solution: Mapping[str,Any]) -> dict:
    """Classify all isolated stationary points when an exhaustive set is provable.

    A polynomial triangular reduction and a linear elimination cover many exam
    functions. An unresolved set is explicitly incomplete; numerical candidates
    are never promoted to a complete extremum classification.
    """
    result=dict(base_solution)
    if model.get('bounds'):
        return result
    names=list(model.get('variables') or [])
    if len(names)!=2:
        return result
    symbols=[sp.Symbol(name,real=True) for name in names]
    x,y=symbols
    expression=_expr(str(model['expression']),names)
    gx,gy=[sp.diff(expression,s) for s in symbols]
    candidates=[]
    complete=False
    # Eliminate one variable only if its gradient equation is globally linear
    # with a nonzero constant coefficient (no lost zero-denominator branches).
    for first,second,first_grad,second_grad in ((x,y,gx,gy),(y,x,gy,gx)):
        coefficient=sp.diff(first_grad,first)
        if coefficient == 0 or coefficient.free_symbols or sp.diff(first_grad,first,2)!=0:
            continue
        replacement=sp.simplify(first-sp.cancel(first_grad/coefficient))
        if first in replacement.free_symbols:
            continue
        reduced=sp.simplify(second_grad.subs(first,replacement))
        families,complete=_finite_families(sp.solveset(reduced,second,domain=sp.S.Reals))
        if complete:
            candidates=[{first:sp.simplify(replacement.subs(second,v)),second:v} for v in families]
            break
    if not complete and expression.is_polynomial(x,y):
        if sp.Poly(expression,x,y).total_degree()<=8:
            try:
                roots=sp.solve_poly_system([gx,gy],x,y)
                if roots is not None:
                    candidates=[dict(zip(symbols,values)) for values in roots if all(v.is_real is True for v in values)]
                    complete=all(v.is_real is not None for values in roots for v in values)
            except (NotImplementedError,ValueError,sp.PolynomialError):
                pass
    if not complete:
        triangular, triangular_complete = _triangular_extrema_candidates(expression, symbols)
        if triangular_complete:
            candidates = triangular
            complete = True
    hessian=sp.hessian(expression,symbols)
    points=[]
    labels={'minimum':'极小值','maximum':'极大值','saddle':'鞍点','undetermined':'退化驻点（需进一步判别）'}
    for candidate in candidates[:64]:
        if any(sp.simplify(g.subs(candidate))!=0 for g in (gx,gy)):
            complete=False
            continue
        matrix=sp.simplify(hessian.subs(candidate))
        determinant=sp.simplify(matrix.det())
        a=sp.simplify(matrix[0,0])
        classification='undetermined'
        if determinant.is_negative:
            classification='saddle'
        elif determinant.is_positive and a.is_positive:
            classification='minimum'
        elif determinant.is_positive and a.is_negative:
            classification='maximum'
        points.append(dict(coordinates=[str(sp.simplify(candidate[s])) for s in symbols],
                           classification=classification,value=str(sp.simplify(expression.subs(candidate))),
                           hessian_determinant=str(determinant),latex=to_latex(sp.Tuple(*(candidate[s] for s in symbols)))))
    complete=complete and len(candidates)<=64
    result['stationary_points']=points
    result['stationary_complete']=complete
    descriptions=[labels[p['classification']]+'点 ('+', '.join(p['coordinates'])+'), f='+p['value'] for p in points]
    if any(K in candidate[s].free_symbols for candidate in candidates for s in symbols):
        descriptions.append('k ∈ Z')
    fully_classified=complete and all(p['classification']!='undetermined' for p in points)
    if fully_classified:
        for key,label in (('minimum','极小值'),('maximum','极大值')):
            if not any(p['classification']==key for p in points):
                descriptions.append(label+'不存在')
    if complete and not points:
        descriptions.append('没有有限的孤立驻点')
    if not complete:
        descriptions.append('驻点集合尚未证明完整，不能据此排除其他极值')
    if fully_classified:
        result['answer']='；'.join(descriptions) or '没有有限的孤立驻点'
    else:
        result['answer']=''
    result['classification_complete']=fully_classified
    result['solution_complete']=fully_classified
    result['solution_status']='complete' if fully_classified else 'incomplete'
    if not complete:
        result['incomplete_reason']='驻点集合尚未证明完整，不能据此排除其他极值'
    elif not fully_classified:
        result['incomplete_reason']='存在退化驻点，当前高阶判别未能完成分类'
    if not fully_classified:
        result['summary']=result['incomplete_reason']
    result['global_note']='全部驻点由符号方程求出；Hessian 判别局部极值与鞍点。' if fully_classified else '仅得到部分驻点候选或存在退化点，完整性尚未证明。'
    result['steps']=list(result.get('steps') or [])+[dict(id='stationary_classification',title='驻点全集与 Hessian 分类',
        latex=r'\nabla f=0,\quad D=f_{xx}f_{yy}-f_{xy}^2',detail='；'.join(descriptions))]
    # One numerical representative is not a full stationary family or an optimum.
    if points:
        result['answer_point']=None
        result['answer_value']=None
    return result

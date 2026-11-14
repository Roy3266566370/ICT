"""Verified invertible affine changes of variables on finite parameter strips."""
import sympy as sp
from sympy.calculus.util import function_range

from .expr import parse_expression, expression_text, safe_float, to_latex
from .double_integral import X, Y, _validate_strip, _monotone_direction, compile_model, solve_double_integral
from .manual_double_integral import _continuous_on_region

U, V = sp.symbols('u v', real=True)
FIELDS = {'integrand','region_mode','x_map','y_map','outer_lower','outer_upper','inner_lower','inner_upper'}
NOTE = '连续实定义使用覆盖参数区域的矩形充分条件证明；不能证明时保留未完成。区域轮廓抽样仅作示意，不作全域证明。'


def _rename(expr):
    return expr.xreplace({U:X,V:Y})


def _strict_direction(expression,variable,a,b):
    _period_budget(expression,variable,a,b)
    direction=_monotone_direction(expression,variable,a,b)
    if direction not in (-1,1):raise ValueError('尚不能证明映射在完整参数区间严格单调，不能忽略重叠覆盖')
    zeros=sp.solveset(sp.diff(expression,variable),variable,domain=sp.Interval.open(a,b))
    if zeros is not sp.S.EmptySet and not isinstance(zeros,sp.FiniteSet):
        raise ValueError('映射的退化集合尚未确认，不能宣称一一对应')
    return direction


def _period_budget(expression,variable,a,b):
    for node in expression.atoms(sp.sin,sp.cos,sp.tan):
        span=function_range(node.args[0],variable,sp.Interval(a,b))
        if safe_float(span.sup-span.inf) is None or bool(span.sup-span.inf>16*sp.pi):
            raise ValueError('周期映射区间过长，请缩小参数域或分片后分别核验')


def _nonlinear_jacobian(xm,ym,a,b,lo,hi):
    if xm.free_symbols-{U}:raise ValueError('当前非线性入口要求x仅依赖u；任意映射的重数不能忽略')
    first=_strict_direction(xm,U,a,b)
    if ym.free_symbols<={V}:
        interval=sp.Interval(a,b)
        low=function_range(lo,X,interval).inf;high=function_range(hi,X,interval).sup
        second=_strict_direction(ym,V,low,high)
    elif sp.diff(ym,V,2)==0 and sp.diff(ym,V).free_symbols<={U}:
        slope=sp.simplify(sp.diff(ym,V))
        _period_budget(slope,U,a,b)
        span=function_range(slope,U,sp.Interval(a,b))
        second=1 if span.inf.is_nonnegative is True and span.sup.is_positive is True else -1 if span.sup.is_nonpositive is True and span.inf.is_negative is True else None
        zeros=sp.solveset(slope,U,domain=sp.Interval(a,b))
        if second is None or (zeros is not sp.S.EmptySet and not isinstance(zeros,sp.FiniteSet)):
            raise ValueError('尚不能证明每个有效u切片上的v映射单调且不塌缩')
    else:raise ValueError('当前非线性入口支持分离映射，或y关于v为一次式的三角形结构映射')
    determinant=sp.simplify(sp.diff(xm,U)*sp.diff(ym,V))
    jacobian=sp.simplify(first*second*determinant)
    if not _continuous_on_region(_rename(jacobian),'x',a,b,lo,hi):
        raise ValueError('当前代换要求面积因子在完整有限参数域有界连续；不能忽略反常Jacobian')
    return determinant,jacobian


def _inputs(c):
    if not isinstance(c,dict) or set(c)!=FIELDS or any(not isinstance(v,str) or not v.strip() or len(v)>(600 if k=='integrand' else 150) for k,v in c.items()):
        raise ValueError('变量代换必须完整填写全部字符串字段，不能忽略额外条件')
    if c['region_mode'] not in ('affine','change_variables'):
        raise ValueError('请选择仿射或可核验非线性变量代换')
    f=parse_expression(c['integrand'],('x','y'),preserve_structure=True)
    bounds=[parse_expression(c[k],('u',),preserve_structure=True) for k in ('outer_lower','outer_upper','inner_lower','inner_upper')]
    # Rename parsed symbols, preserving function names such as sqrt and truncation-free constants.
    renamed=[expression_text(_rename(e)) for e in bounds]
    a,b,lo,hi=_validate_strip('x',renamed[:2],renamed[2:])
    for bound in bounds:
        if any(not _continuous_on_region(_rename(node),'x',a,b,sp.S.Zero,sp.S.One) for node in sp.preorder_traversal(bound)):
            raise ValueError('原始参数边界含非实、无定义或不能全域核验的子式')
    maps=[]
    for key in ('x_map','y_map'):
        raw=parse_expression(c[key],('u','v'),preserve_structure=True)
        if any(not _continuous_on_region(_rename(node),'x',a,b,lo,hi) for node in sp.preorder_traversal(raw)):
            raise ValueError('仿射映射的原始表达式必须全域连续实定义')
        if c['region_mode']=='affine':
            try:poly=sp.Poly(raw,U,V)
            except sp.PolynomialError as exc:raise ValueError('映射必须是u,v的仿射多项式') from exc
            if poly.total_degree()>1 or any(safe_float(v) is None for v in poly.coeffs()):
                raise ValueError('映射必须具有有限实常数系数且次数不超过1')
        maps.append(sp.expand(raw))
    xm,ym=maps
    det=sp.simplify(sp.diff(xm,U)*sp.diff(ym,V)-sp.diff(xm,V)*sp.diff(ym,U))
    if c['region_mode']=='change_variables':
        det,jacobian=_nonlinear_jacobian(xm,ym,a,b,lo,hi)
    elif safe_float(det) is None or det.is_zero is not False:
        raise ValueError('仿射映射Jacobian行列式必须为可证明非零的有限实数')
    else:jacobian=abs(det)
    return f,xm,ym,det,a,b,lo,hi,jacobian


def _preview(c,data):
    f,xm,ym,det,a,b,lo,hi,jacobian=data
    latex=rf'\iint_D {to_latex(f)}\,dx\,dy,\quad x={to_latex(xm)},\quad y={to_latex(ym)},\quad {to_latex(a)}\le u\le {to_latex(b)},\quad {to_latex(lo.xreplace({X:U}))}\le v\le {to_latex(hi.xreplace({X:U}))}'
    label='仿射变量代换二重积分' if c['region_mode']=='affine' else '非线性变量代换二重积分'
    question=f"{label}；原函数f(x,y)={c['integrand']}；x={c['x_map']}，y={c['y_map']}；完整参数域：{c['outer_lower']}≤u≤{c['outer_upper']}，{c['inner_lower']}≤v≤{c['inner_upper']}；先v后u；自动乘Jacobian绝对值"
    return dict(task='double_integral',label=label,conditions=dict(c),latex=latex,question=question)


def preview(c):
    return _preview(c,_inputs(c))


def _points(xm,ym,a,b,lo,hi):
    result=[]
    for curve,indices in ((lo,range(61)),(hi,range(60,-1,-1))):
        for i in indices:
            t=a+(b-a)*sp.Rational(i,60)
            subs={U:t,V:curve.subs(X,t)}
            x,y=safe_float(xm.subs(subs)),safe_float(ym.subs(subs))
            if x is None or y is None:
                raise ValueError('不能构造有限原坐标区域轮廓')
            result.append(dict(x=x,y=y))
    result.append(dict(result[0]))
    return result


def solve(c):
    data=_inputs(c)
    f,xm,ym,det,a,b,lo,hi,jacobian=data
    p=_preview(c,data)
    proof='常数行列式非零，仿射映射全局一一对应' if c['region_mode']=='affine' else '各方向严格单调或切片单调已核验；仅允许有限退化切片，不忽略有面积的重叠覆盖'
    extension=dict(kind='affine',title=p['label'],facts=[dict(label='坐标映射',latex=rf'x={to_latex(xm)},\quad y={to_latex(ym)}'),dict(label='Jacobian绝对值',latex=rf'|J|={to_latex(jacobian)}')],values=[dict(id='jacobian',label='Jacobian绝对值',latex=to_latex(jacobian),value=safe_float(jacobian))],notes=[proof,NOTE])
    steps=[dict(id='affine_region',title='确认映射与完整参数区域',detail=p['question'],latex=p['latex']),dict(id='jacobian',title='核验可逆映射并乘绝对Jacobian',detail=proof+'；面积因子取绝对值。',latex=rf'J={to_latex(det)},\quad dA={to_latex(jacobian)}\,du\,dv')]
    result=dict(answer='',exact='',exact_latex='',answer_value=None,summary='',steps=steps,conditions=[p['question']],limitations=[NOTE],solution_complete=False,solution_status='unsupported',incomplete_reason='',double_extension=extension)
    try:
        # Each original subtree is checked independently before substitution can cancel it.
        for node in sp.preorder_traversal(f):
            transformed=_rename(node.subs({X:xm,Y:ym},simultaneous=True))
            if not _continuous_on_region(transformed,'x',a,b,lo,hi):
                raise ValueError('尚不能证明原被积函数每个子式在完整区域上连续实定义；不输出积分答案')
        transformed=_rename(f.subs({X:xm,Y:ym},simultaneous=True)*jacobian)
        model=compile_model(dict(integrand=expression_text(transformed),outer_variable='x',outer_bounds=[expression_text(a),expression_text(b)],inner_bounds=[expression_text(lo),expression_text(hi)]))
        solved=solve_double_integral(model)
        exact=sp.sympify(model['exact'],locals={'e':sp.E})
        result.update(answer=solved['answer'],exact=solved['exact'],exact_latex=to_latex(exact),answer_value=solved['answer_value'],summary=proof+'；原式连续实定义已核验，乘绝对Jacobian后积分并数值复核。',solution_complete=True,solution_status='complete')
        steps.append(dict(id='evaluate',title='计算参数域积分并复核',detail=f"积分结果：{model['exact']}；数值复核：{model['numeric_value']}。",latex=rf'\int_{{{to_latex(a)}}}^{{{to_latex(b)}}}\int_{{{to_latex(lo.xreplace({X:U}))}}}^{{{to_latex(hi.xreplace({X:U}))}}}{to_latex(transformed.xreplace({X:U,Y:V}))}\,dv\,du={to_latex(exact)}'))
        extension['values'].append(dict(id='integral',label='积分值',latex=to_latex(exact),value=solved['answer_value']))
    except (ValueError,TypeError,NotImplementedError,ArithmeticError,sp.PolynomialError) as exc:
        result.update(summary=str(exc),incomplete_reason=str(exc))
    try:
        extension['region_points']=_points(xm,ym,a,b,lo,hi)
    except (ValueError,TypeError,ArithmeticError):
        extension['notes'].append('原坐标轮廓无法生成，不显示替代区域。')
    return result

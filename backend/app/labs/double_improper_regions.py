"""Improper integrals on polar and curved strips, with explicit parameter domains."""
import sympy as sp

from .double_integral import X, Y, RADIUS, THETA, _validate_strip, _numeric_2d
from .domain_analysis import domain_gap_profile
from .expr import parse_expression, expression_text, safe_float, to_latex
from .manual_improper_integral import endpoint, solve_double, _reports

NOTE='原式实定义域与参数代换分别核验；绝对收敛或不变号积分依据分别保留。不用柯西主值或有限截断值代替答案。'


def inputs(c):
    if not isinstance(c,dict) or 'integrand' not in c or 'region_mode' not in c:
        raise ValueError('请完整填写被积函数、区域模式与全部积分限')
    if any(not isinstance(v,str) or not v.strip() or len(v)>(600 if k=='integrand' else 150) for k,v in c.items()):
        raise ValueError('请完整填写函数、区域与全部积分限')
    f=parse_expression(c['integrand'],('x','y'),preserve_structure=True)
    if c.get('region_mode')=='polar_improper':
        if set(c)!={'integrand','region_mode','theta_lower','theta_upper','radius_lower','radius_upper'}:
            raise ValueError('极坐标反常积分必须填写原函数和四个积分限，不能忽略额外限制')
        a,b,lo,hi=[endpoint(c[k]) for k in ('theta_lower','theta_upper','radius_lower','radius_upper')]
        if any(safe_float(v) is None for v in (a,b)) or not bool(a<b) or not bool(b-a<=2*sp.pi):
            raise ValueError('极角必须是递增有限常数区间，跨度不超过2*pi')
        if safe_float(lo) is None or not bool(lo>=0) or not bool(lo<hi) or (hi!=sp.oo and safe_float(hi) is None):
            raise ValueError('极径须为递增非负常数，下限有限，上限可为正无穷')
        mapping={X:RADIUS*sp.cos(THETA),Y:RADIUS*sp.sin(THETA)}
        return f,RADIUS,THETA,lo,hi,a,b,mapping,RADIUS
    if c.get('region_mode')!='strip_improper' or set(c)!={'integrand','region_mode','outer_variable','outer_lower','outer_upper','inner_lower','inner_upper'}:
        raise ValueError('曲边反常积分必须完整填写有限外层区间与两条边界，不能混用其他条件')
    if c['outer_variable'] not in ('x','y'):raise ValueError('积分次序只能选择x或y为外层')
    # Reuse original boundary syntax validation, including canceled denominators.
    from .manual_double_integral import parse_inputs
    parse_inputs({k:v for k,v in c.items() if k!='region_mode'})
    a,b,lo,hi=_validate_strip(c['outer_variable'],[c['outer_lower'],c['outer_upper']],[c['inner_lower'],c['inner_upper']])
    outer,inner=(X,Y) if c['outer_variable']=='x' else (Y,X)
    width=sp.simplify(hi-lo)
    zeros=sp.solveset(width,outer,domain=sp.Interval(a,b))
    if not isinstance(zeros,sp.FiniteSet) and zeros is not sp.S.EmptySet:
        raise ValueError('尚未确认曲边代换在区域内部的可逆性；不能用退化区域替代原题')
    parameter=sp.Symbol('u',real=True)
    mapping={outer:outer,inner:lo+width*parameter}
    return f,outer,parameter,a,b,sp.Integer(0),sp.Integer(1),mapping,width


def preview(c):
    f,t,s,a,b,lo,hi,mapping,jacobian=inputs(c)
    g=sp.simplify(sp.trigsimp(f.subs(mapping,simultaneous=True))*jacobian)
    label='极坐标反常二重积分' if c['region_mode']=='polar_improper' else '曲边区域反常二重积分'
    region=(f"{c['theta_lower']}≤theta≤{c['theta_upper']}，{c['radius_lower']}≤r≤{c['radius_upper']}" if c['region_mode']=='polar_improper' else f"{c['outer_lower']}≤{c['outer_variable']}≤{c['outer_upper']}，{c['inner_lower']}≤{'y' if c['outer_variable']=='x' else 'x'}≤{c['inner_upper']}")
    latex=rf'\int_{{{to_latex(a)}}}^{{{to_latex(b)}}}\int_{{{to_latex(lo)}}}^{{{to_latex(hi)}}}{to_latex(g)}\,d{s}\,d{t}'
    return dict(task='double_integral',label=label,conditions=c,latex=latex,question=f"{label}；原被积函数={c['integrand']}；完整区域：{region}；{NOTE}")


def _real_on_product(expression, domains, positive):
    for node in sp.preorder_traversal(expression):
        if not node.free_symbols:
            if node.is_real is not True or safe_float(node) is None:return False
        elif len(node.free_symbols)==1:
            v=next(iter(node.free_symbols));profile=domain_gap_profile(node,v,domains[v])
            if profile['gap'] or not profile['complete']:return False
        elif node.func in (sp.Add,sp.Mul,sp.sin,sp.cos,sp.exp,sp.Abs,sp.atan,sp.sinh,sp.cosh,sp.tanh):continue
        elif isinstance(node,sp.Pow):
            if node.exp.is_integer and node.exp.is_nonnegative:continue
            if node.base.xreplace(positive).is_positive is True:continue
            return False
        else:return False
    return True


def _tonelli(g,t,s,a,b,lo,hi,positive):
    signed=g.xreplace(positive)
    nonnegative=signed.is_nonnegative is True
    nonpositive=signed.is_nonpositive is True
    if not nonnegative and not nonpositive:return None
    sign=1 if nonnegative else -1
    tp,sp_=positive.get(t,t),positive.get(s,s)
    integrand=sign*signed
    profile=domain_gap_profile(integrand,sp_,sp.Interval(lo,hi))
    if profile['gap'] or not profile['complete'] or any(p.free_symbols for p in profile['points']):return None
    cuts=sorted({lo,hi,*profile['points']},key=float)
    inner=sp.simplify(sum(sp.integrate(integrand,(sp_,left,right)) for left,right in zip(cuts,cuts[1:])))
    if inner.has(sp.Integral,sp.Limit):return None
    if inner==sp.oo:
        return 'divergent',None,'内层不变号积分发散，由Tonelli定理，二重反常积分发散'
    if inner.has(sp.oo,sp.zoo,sp.nan):return None
    inner=inner.xreplace({tp:t})
    reports=_reports(inner,t,a,b)
    if any(report['status']=='divergent' for report in reports):
        return 'divergent',None,'不变号积分的累次积分发散，由Tonelli定理判定二重积分发散'
    if not all(report['status']=='finite' and report['complete'] for report in reports):return None
    value=sign*sp.simplify(sum(report['value'] for report in reports))
    numeric=_numeric_2d(g,t,s,a,b,sp.sympify(lo),sp.sympify(hi))
    if numeric is None or safe_float(value) is None or abs(numeric-float(value))>1e-6*max(1,abs(float(value))):return None
    return 'complete',value,'参数域内被积函数不变号，由Tonelli定理与有限累次积分确认绝对收敛，并完成独立数值复核'


def solve(c):
    f,t,s,a,b,lo,hi,mapping,jacobian=inputs(c);p=preview(c)
    domains={t:sp.Interval(a,b),s:sp.Interval(lo,hi)}
    positive={v:sp.Symbol(f'positive_{v}',positive=True) for v,interval in domains.items() if bool(interval.start>=0)}
    assumptions=sp.And(*(sp.Q.positive(v) for v in positive))
    g=sp.refine(sp.trigsimp(f.subs(mapping,simultaneous=True))*jacobian,assumptions)
    reason='尚未完成原式实定义域或绝对收敛核验；保留完整区域，不输出数值替代答案'
    result=dict(answer='',exact='',exact_latex='',answer_value=None,approx='',summary=reason,steps=[],conditions=[p['question']],limitations=[NOTE],solution_status='unsupported',solution_complete=False,incomplete_reason=reason)
    try:
        for node in sp.preorder_traversal(f):
            transformed=sp.factor_terms(sp.refine(sp.trigsimp(node.subs(mapping,simultaneous=True)),assumptions))
            if not _real_on_product(transformed,domains,positive):raise ValueError(reason)
        normalized=sp.simplify(g.xreplace(positive)).xreplace({value:key for key,value in positive.items()})
        canonical=normalized.subs({t:X,s:Y},simultaneous=True)
        result=solve_double(dict(integrand=expression_text(canonical),outer_variable='x',outer_lower=expression_text(a),outer_upper=expression_text(b),inner_lower=expression_text(lo),inner_upper=expression_text(hi)))
        if result['solution_status']=='unsupported' and all(safe_float(bound) is not None for bound in (a,b,lo,hi)):
            from .manual_double_integral import _continuous_on_region
            from .double_integral import compile_model, solve_double_integral
            if _continuous_on_region(canonical,'x',a,b,lo,hi):
                proper=compile_model(dict(integrand=expression_text(canonical),outer_variable='x',outer_bounds=[expression_text(a),expression_text(b)],inner_bounds=[expression_text(lo),expression_text(hi)]))
                result=solve_double_integral(proper)
                result.update(solution_status='complete',solution_complete=True,exact_latex=proper['exact_latex'],summary='变换后的函数在有限参数域连续延拓，绝对可积；原式实定义域已单独核验，并完成独立数值复核',incomplete_reason='')
        if result['solution_status']=='unsupported':
            extra=_tonelli(normalized,t,s,a,b,lo,hi,positive)
            if extra:
                status,value,reason=extra;complete=status=='complete'
                result.update(solution_status=status,solution_complete=complete,summary=reason,incomplete_reason='' if complete else reason,
                    answer=str(value) if complete else '发散',exact=str(value) if complete else '',exact_latex=to_latex(value) if complete else '',answer_value=safe_float(value) if complete else None)
        result['limitations']=[NOTE,'只在原式实定义域、映射及收敛依据可核验时给出结论；任意隐式区域或无法判定情形保留未完成。']
    except (ValueError,TypeError,NotImplementedError,ArithmeticError,sp.PolynomialError) as exc:
        result.update(summary=str(exc) or reason,incomplete_reason=str(exc) or reason)
    facts=[dict(label='参数代换',latex=r',\quad '.join(rf'{v}={to_latex(expr)}' for v,expr in mapping.items())),dict(label='面积因子',latex=rf'dA={to_latex(jacobian)}\,d{s}\,d{t}'),dict(label='含面积因子的被积函数',latex=to_latex(g))]
    result['steps']=[dict(id='parameter_region',title='记录原区域与参数域',detail=p['question'],latex=p['latex']),dict(id='jacobian',title='代入面积因子并核查原式定义域',detail=NOTE,latex=to_latex(g)),*result['steps']]
    result['conditions']=[p['question']]
    result['double_extension']=dict(kind=c['region_mode'],title=p['label'],facts=facts,values=[dict(id='integral',label='反常积分值',latex=result['exact_latex'],value=result['answer_value'])] if result['solution_complete'] else [],notes=[NOTE])
    return result

"""Certified finite-region density applications, using the ordinary integral kernel."""
import sympy as sp
from sympy.calculus.util import function_range

from . import manual_double_integral as base
from .double_integral import X, Y, _validate_strip, _quantifier_check
from .expr import parse_expression, expression_text, safe_float, to_latex

TITLES = dict(mass='质量',centroid='质心',inertia='转动惯量',probability='事件概率')
AXES = dict(x='x轴',y='y轴',origin='过原点且垂直于平面的轴')
EVENT = ('event_outer_lower','event_outer_upper','event_inner_lower','event_inner_upper')
NOTE = '应用首批支持有限单片、分片、极坐标区域；概率限同次序单片事件。非负性须符号证明，不用抽样或自动归一化。'


def _inputs(c):
    c=dict(c)
    kind=c.pop('application',None)
    if kind not in TITLES: raise ValueError('请选择质量、质心、明确轴的转动惯量或事件概率')
    axis=None; event=None
    if kind=='inertia':
        axis=c.pop('inertia_axis',None)
        if axis not in ('x','y','origin'): raise ValueError('转动惯量必须明确选择x、y或origin轴')
    if kind=='probability':
        if c.get('region_mode','strip')!='strip': raise ValueError('概率首批仅支持完整单片支持区域和同次序单片事件')
        if any(k not in c for k in EVENT): raise ValueError('必须完整填写事件的四个积分限')
        event=dict(c)
        event.update(dict(zip(base.FIELDS[2:],(c.pop(k) for k in EVENT))))
        for k in EVENT: event.pop(k,None)
    if c.get('region_mode','strip') not in ('strip','pieces','polar'):
        raise ValueError('应用首批不混用反常积分或仿射换元，仅支持有限strip/pieces/polar区域')
    plan=base.region_plan(c)
    if event is not None:
        base.region_plan(event)
        _,a,b,lo,hi=base.parse_inputs({k:c[k] for k in base.FIELDS})
        _,ea,eb,elo,ehi=base.parse_inputs({k:event[k] for k in base.FIELDS})
        if not (bool(a<=ea) and bool(eb<=b)): raise ValueError('事件外层区间必须包含在完整支持区域内')
        t=X if c['outer_variable']=='x' else Y
        for violation in (elo<lo,ehi>hi):
            _quantifier_check(violation,t,sp.Interval(ea,eb),'事件必须完全包含在支持区域内，不能截断')
    return kind,axis,c,event,plan


def preview(c):
    kind,axis,clean,event,_=_inputs(c)
    p=base.preview(clean)
    task=TITLES[kind]+(f'（关于{AXES[axis]}）' if axis else '')
    question=f'密度ρ(x,y)={clean["integrand"]}；任务：{task}；完整支持区域：'+p['question']
    if event: question+='；事件区域：'+base.preview(event)['question']+'；支持区域密度总积分须精确等于1，不自动归一化'
    return dict(task='double_integral',label=task,conditions=dict(c),latex=p['latex'],question=question)


def _rectangles(clean,plan):
    if 'polar' in plan:
        from .double_integral import THETA
        a,b=[parse_expression(v) for v in plan['polar']['theta_bounds']]
        r=parse_expression(plan['polar']['r_bounds'][1],('theta',))
        radius=function_range(r,THETA,sp.Interval(a,b)).sup
        return [(-radius,radius,-radius,radius)]
    rects=[]
    for part in plan.get('pieces',[plan]):
        a,b,lo,hi=_validate_strip(plan['outer_variable'],part['outer_bounds'],part['inner_bounds'])
        t=X if plan['outer_variable']=='x' else Y
        lower=function_range(lo,t,sp.Interval(a,b)).inf
        upper=function_range(hi,t,sp.Interval(a,b)).sup
        rects.append((a,b,lower,upper) if t==X else (lower,upper,a,b))
    return rects


def _rect_interval(rect,variable):
    x0,x1,y0,y1=rect
    if variable==X:return sp.Interval(x0,x1)
    if variable==Y:return sp.Interval(y0,y1)
    return None


def _range_on_rect(expression,rect):
    if len(expression.free_symbols)!=1:return None
    variable=next(iter(expression.free_symbols))
    interval=_rect_interval(rect,variable)
    if interval is None:return None
    try:span=function_range(expression,variable,interval)
    except (ValueError,TypeError,NotImplementedError):return None
    if not isinstance(span,sp.Interval):return None
    if span.inf.is_finite is not True or span.sup.is_finite is not True:return None
    return span


def _strict_positive(expression,rect):
    if expression.is_positive is True:return True
    if expression.is_number:return expression.is_extended_positive is True
    if expression.func==sp.exp:return True
    span=_range_on_rect(expression,rect)
    if span is not None:return span.inf.is_positive is True
    if expression.is_Add:
        pairs=[_sign_pair(arg,rect) for arg in expression.args]
        return all(pair is not None and pair[0] for pair in pairs) and any(_strict_positive(arg,rect) for arg in expression.args)
    if expression.is_Mul:
        return all(_strict_positive(arg,rect) for arg in expression.args)
    if expression.is_Pow:
        base,exponent=expression.base,expression.exp
        if exponent.is_integer and exponent.is_positive:
            if exponent.is_even:return _strict_positive(base,rect) or _strict_negative(base,rect)
            return _strict_positive(base,rect)
    return False


def _strict_negative(expression,rect):
    if expression.is_negative is True:return True
    if expression.is_number:return expression.is_extended_negative is True
    span=_range_on_rect(expression,rect)
    if span is not None:return span.sup.is_negative is True
    if expression.is_Add:
        pairs=[_sign_pair(arg,rect) for arg in expression.args]
        return all(pair is not None and pair[1] for pair in pairs) and any(_strict_negative(arg,rect) for arg in expression.args)
    if expression.is_Mul:
        signs=[_strict_sign(arg,rect) for arg in expression.args]
        if any(sign is None for sign in signs):return False
        product=1
        for sign in signs:product*=sign
        return product<0
    if expression.is_Pow:
        base,exponent=expression.base,expression.exp
        if exponent.is_integer and exponent.is_positive:
            if exponent.is_even:return False
            return _strict_negative(base,rect)
    return False


def _strict_sign(expression,rect):
    if _strict_positive(expression,rect):return 1
    if _strict_negative(expression,rect):return -1
    return None


def _sign_pair(expression,rect):
    if expression.is_zero:return (True,True)
    if expression.is_number:return (expression.is_nonnegative is True,expression.is_nonpositive is True)
    if expression.is_nonnegative is True and expression.is_nonpositive is True:return (True,True)
    if expression.is_nonnegative is True:return (True,False)
    if expression.is_nonpositive is True:return (False,True)
    span=_range_on_rect(expression,rect)
    if span is not None:return (span.inf.is_nonnegative is True,span.sup.is_nonpositive is True)
    if expression.is_Add:
        pairs=[_sign_pair(arg,rect) for arg in expression.args]
        if any(pair is None for pair in pairs):return None
        return (all(pair[0] for pair in pairs),all(pair[1] for pair in pairs))
    if expression.is_Mul:
        pairs=[_sign_pair(arg,rect) for arg in expression.args]
        if any(pair is None for pair in pairs):return None
        if not all(pair[0] or pair[1] for pair in pairs):return None
        if any(pair==(True,True) for pair in pairs):return (True,True)
        negative=sum(1 for pair in pairs if pair==(False,True))
        return (negative%2==0,negative%2==1 and not any(pair==(True,False) for pair in pairs))
    if expression.is_Pow:
        base,exponent=expression.base,expression.exp
        if exponent.is_integer:
            if exponent.is_positive:
                if exponent.is_even:return (True,False) if base.is_real is not False else None
                return _sign_pair(base,rect)
            if exponent.is_negative:
                pair=_sign_pair(sp.Pow(base,-exponent),rect)
                if pair is None or not (_strict_positive(base,rect) or _strict_negative(base,rect)):return None
                return pair
            return (True,False)
        if exponent.is_Rational:
            if exponent.is_negative:
                pair=_sign_pair(sp.Pow(base,-exponent),rect)
                if pair is None or not (_strict_positive(base,rect) or _strict_negative(base,rect)):return None
                return pair
            numerator,denominator=exponent.p,exponent.q
            if denominator.is_odd:
                if numerator.is_even:return (True,False)
                return _sign_pair(base,rect)
            pair=_sign_pair(base,rect)
            return (True,False) if pair is not None and pair[0] else None
        return None
    if expression.func==sp.Abs:return (True,False)
    if expression.func==sp.exp:return (True,False)
    return None


def _nonnegative(f,clean,plan):
    f=sp.simplify(f)
    rectangles=_rectangles(clean,plan)
    if all((lambda pair: pair is not None and pair[0])(_sign_pair(f,rect)) for rect in rectangles):return True
    # Tensor-product Bernstein coefficients on each projection rectangle provide
    # a sufficient whole-domain proof, including boundaries. Work is bounded.
    if not f.is_polynomial(X,Y): return False
    poly=sp.Poly(f,X,Y)
    if poly.total_degree()>8 or len(poly.terms())>60: return False
    u,v=sp.symbols('_u _v',real=True)
    for a,b,lo,hi in _rectangles(clean,plan):
        p=sp.Poly(f.subs({X:a+(b-a)*u,Y:lo+(hi-lo)*v},simultaneous=True).expand(),u,v)
        n,m=max(0,p.degree(u)),max(0,p.degree(v))
        for i in range(n+1):
            for j in range(m+1):
                coefficient=sum(value*sp.binomial(i,k)/sp.binomial(n,k)*sp.binomial(j,l)/sp.binomial(m,l) for (k,l),value in p.terms() if k<=i and l<=j)
                if sp.simplify(coefficient).is_nonnegative is not True: return False
    return True


def _integrate(clean,weight=sp.S.One):
    weighted=dict(clean)
    if weight!=1:
        weighted['integrand']=expression_text(weight*parse_expression(clean['integrand'],('x','y')))
    return base.solve(base.build_problem(weighted)['model'])


def solve(c):
    kind,axis,clean,event,plan=_inputs(c)
    p=preview(c)
    extension=dict(kind='applications',title=TITLES[kind],facts=[dict(label='密度',latex=r'\rho(x,y)='+to_latex(parse_expression(clean['integrand'],('x','y'))))],values=[],notes=[NOTE])
    mass=_integrate(clean)  # Check original density domain before any multiplication.
    def unsupported(reason):
        result=dict(mass)
        result.update(answer='',answer_value=None,approx='',summary=reason,solution_complete=False,solution_status='unsupported',incomplete_reason=reason,double_extension=extension)
        result.pop('double_details',None)
        result.pop('exact',None);result.pop('exact_latex',None)
        return result
    if not mass.get('solution_complete'): return unsupported(mass.get('incomplete_reason','密度的完整定义域或积分未确认'))
    rho=parse_expression(clean['integrand'],('x','y'),preserve_structure=True)
    try: certified=_nonnegative(rho,clean,plan)
    except (ValueError,TypeError,NotImplementedError,sp.PolynomialError): certified=False
    if not certified: return unsupported('尚不能证明密度在完整区域非负；负密度不能用于此应用，抽样不代替证明')
    M=sp.sympify(mass['exact'],locals={'e':sp.E})
    extension['facts'].extend([dict(label='已核验完整区域上的非负性',latex=r'\rho(x,y)\ge 0'),dict(label='支持区域总积分',latex=rf'M=\iint_D\rho\,dA={to_latex(M)}')])
    def value(identifier,label,expr):
        extension['values'].append(dict(id=identifier,label=label,latex=to_latex(expr),value=safe_float(expr)))
    value('mass','质量' if kind!='probability' else '支持区域总概率',M)
    result=dict(mass)
    result.pop('double_details',None)
    result['steps']=list(mass['steps'])
    answer=M
    if kind=='centroid':
        if M.is_positive is not True: return unsupported('质心要求严格正质量；零质量没有定义的质心坐标')
        coords=[]
        for identifier,weight in [('x_bar',X),('y_bar',Y)]:
            moment=_integrate(clean,weight)
            if not moment.get('solution_complete'): return unsupported('质心矩积分尚未完成')
            coord=sp.simplify(sp.sympify(moment['exact'],locals={'e':sp.E})/M)
            coords.append(coord);value(identifier,'质心'+identifier[0]+'坐标',coord)
        answer=sp.Matrix(coords)
        formula=rf'\bar x=\frac{{\iint_D x\rho\,dA}}{{M}}={to_latex(coords[0])},\quad \bar y=\frac{{\iint_D y\rho\,dA}}{{M}}={to_latex(coords[1])}'
        extension['facts'].append(dict(label='一阶矩与正质量归一化',latex=formula))
        result['steps'].append(dict(id='centroid_moments',title='计算一阶矩并除以正质量',detail=f"加权积分∫xρ dA={sp.simplify(coords[0]*M)}，∫yρ dA={sp.simplify(coords[1]*M)}，质量M={M}。",latex=formula))
    elif kind=='inertia':
        weight={'x':Y**2,'y':X**2,'origin':X**2+Y**2}[axis]
        moment=_integrate(clean,weight)
        if not moment.get('solution_complete'): return unsupported('指定轴的惯量积分尚未完成')
        answer=sp.sympify(moment['exact'],locals={'e':sp.E});value('inertia','关于'+AXES[axis]+'的转动惯量',answer)
        formula=rf'I=\iint_D ({to_latex(weight)})\rho\,dA={to_latex(answer)}'
        extension['facts'].append(dict(label='指定轴的加权积分',latex=formula))
        result['steps'].append(dict(id='inertia_moment',title='按指定轴计算转动惯量',detail=f"指定轴={axis}，密度权重={weight}，结果={answer}。",latex=formula))
    elif kind=='probability':
        if sp.simplify(M-1)!=0: return unsupported('完整支持区域密度积分不等于1，不能作为概率密度且不自动归一化')
        probability=_integrate(event)
        if not probability.get('solution_complete'): return unsupported('事件积分尚未完成')
        answer=sp.sympify(probability['exact'],locals={'e':sp.E})
        if answer.is_nonnegative is not True or (1-answer).is_nonnegative is not True: return unsupported('不能确认事件概率位于[0,1]')
        value('probability','事件概率',answer)
        formula=rf'\iint_D\rho\,dA=1,\quad P(E)=\iint_E\rho\,dA={to_latex(answer)}'
        extension['facts'].append(dict(label='完整支持归一化与事件积分',latex=formula))
        result['steps'].append(dict(id='probability_event',title='核对完整支持归一化并积分事件区域',detail='事件全区间包含关系与非负性已核验；'+base.preview(event)['question'],latex=formula))
    result.update(answer=TITLES[kind]+' = '+to_latex(answer),summary=p['question'],exact=str(answer),exact_latex=to_latex(answer),answer_value=None if kind=='centroid' else safe_float(answer),approx='' if kind=='centroid' else str(safe_float(answer)),double_extension=extension,conditions=[p['question']])
    return result

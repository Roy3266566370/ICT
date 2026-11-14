"""精确泰勒系数、可核验余项及与误差保证分开的观察范围。"""
import sympy as sp
from sympy.calculus.util import continuous_domain, function_range
from .expr import parse_expression, safe_float, to_latex


def taylor_report(model):
    from .calculus_analysis import _interval_components, _point_payload
    v=sp.Symbol(str(model.get('variable') or 'x'),real=True)
    original=parse_expression(model['expression'],(str(v),),preserve_structure=True)
    expression=sp.simplify(original)
    point=parse_expression(str(model.get('taylor_point',0)))
    order=int(model.get('order',3))
    base=dict(expression=expression,variable=v,point=point,order=order)
    try:
        if not 1<=order<=10: raise ValueError('展开阶数必须是1至10的整数')
        domain=continuous_domain(original,v,sp.S.Reals)
        components=_interval_components(domain)
        component=next((c for c in components or [] if c[0]<point<c[1]),None)
        if domain.contains(point) is not sp.S.true or component is None:
            raise ValueError('展开点必须属于原式实定义域，并具有双侧实邻域；不自动补定义或改为单侧展开')
        value=sp.simplify(original.subs(v,point))
        if safe_float(value) is None: raise ValueError('原式在展开点无有限实函数值')
        coefficients=[value]
        previous=expression; previous_value=value
        for k in range(1,order+1):
            quotient=(previous-previous_value)/(v-point)
            left=sp.limit(quotient,v,point,dir='-');right=sp.limit(quotient,v,point,dir='+')
            if safe_float(left) is None or safe_float(right) is None or sp.simplify(left-right)!=0:
                raise ValueError(f'无法确认第{k}阶普通双侧导数存在')
            previous_value=sp.simplify(left)
            coefficients.append(sp.simplify(previous_value/sp.factorial(k)))
            previous=sp.diff(expression,v,k)
        shift=v-point
        polynomial=sp.Add(*[c*shift**k for k,c in enumerate(coefficients)])
        residual=sp.simplify(expression-polynomial)
        exact=residual==0
        if exact:
            remainder_kind='exact';remainder_text='0';remainder_latex='0'
        else:
            ratios=[sp.limit(residual/shift**(order+1),v,point,dir=d) for d in ('-','+')]
            if all(safe_float(r) is not None for r in ratios):
                remainder_kind='big_o';letter='O';power=order+1
            else:
                peano=[sp.limit(residual/shift**order,v,point,dir=d) for d in ('-','+')]
                if not all(sp.simplify(r)==0 for r in peano):raise ValueError('系数已求出，但余项阶尚未通过双侧极限核验')
                remainder_kind='little_o';letter='o';power=order
            remainder_text=f'{letter}(({v}-({point}))^{power})'
            remainder_latex=rf'{letter}\left(\left({to_latex(shift)}\right)^{{{power}}}\right)'
        radius=sp.Integer(1)
        if component[0] is not -sp.oo: radius=sp.Min(radius,(point-component[0])/2)
        if component[1] is not sp.oo: radius=sp.Min(radius,(component[1]-point)/2)
        radius=sp.simplify(radius)
        window=sp.Interval(point-radius,point+radius)
        bound=None
        if exact:bound='0'
        elif sp.count_ops(expression)<=60:
            try:
                derivatives=[sp.diff(expression,v,k) for k in range(1,order+2)]
                if all(window.is_subset(continuous_domain(d,v,sp.S.Reals)) is True for d in derivatives):
                    values=function_range(derivatives[-1],v,window)
                    magnitude=sp.Max(sp.Abs(values.inf),sp.Abs(values.sup))
                    if safe_float(magnitude) is not None:bound=str(sp.simplify(magnitude*radius**(order+1)/sp.factorial(order+1)))
            except (ValueError,TypeError,NotImplementedError): pass
        details=dict(point=str(point),order=order,coefficients=[dict(order=k,value=str(c),latex=to_latex(c)) for k,c in enumerate(coefficients)],polynomial_latex=to_latex(polynomial),remainder_kind=remainder_kind,remainder_latex=remainder_latex,
            relation_latex=rf'f({v})={to_latex(polynomial)}'+('' if exact else '+'+remainder_latex),
            window_lower=str(window.start),window_upper=str(window.end),error_bound=bound,
            range_note='观察区间不等于泰勒级数收敛区间，也不自动保证指定精度。'+('此区间的误差上界由拉格朗日余项和连续高阶导数界给出。' if bound is not None and not exact else '多项式余项为零，恒等式仍受原式定义域约束。' if exact else '当前未能证明整个观察区间的误差上界；抽样误差只供观察。'))
        return dict(**base,status='complete',limit_value=_point_payload(value),coefficients=coefficients,polynomial=polynomial,shift=shift,remainder_text=remainder_text,remainder_latex=remainder_latex,remainder_kind=remainder_kind,details=details,radius=radius)
    except (ValueError,TypeError,NotImplementedError) as exc:
        return dict(**base,status='incomplete',reason=f'泰勒展开未完成：{exc}')

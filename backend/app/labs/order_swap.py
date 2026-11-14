"""Exact horizontal cells for strips bounded by polynomials of degree at most two."""
import sympy as sp
from sympy.calculus.util import continuous_domain, function_range

from .expr import expression_text, safe_float, to_latex


def quadratic_swap(f, outer, a, b, lo, hi):
    from .double_integral import X, Y, _integrate_strip, _quantifier_check, _validate_curve_domain
    t,s=(X,Y) if outer=='x' else (Y,X)
    if any(not curve.is_polynomial(t) or sp.degree(curve,t)>2 for curve in (lo,hi)):
        return None
    levels=set();branches=[]
    for curve in (lo,hi):
        polynomial=sp.Poly(curve,t)
        levels.update((sp.simplify(curve.subs(t,a)),sp.simplify(curve.subs(t,b))))
        if polynomial.degree()==1:
            linear,constant=polynomial.all_coeffs()
            branches.append(((s-constant)/linear,None))
        elif polynomial.degree()==2:
            quadratic,linear,constant=polynomial.all_coeffs()
            discriminant=sp.expand(linear**2-4*quadratic*(constant-s))
            levels.add(sp.simplify(constant-linear**2/(4*quadratic)))
            for sign in (-1,1):
                branches.append((sp.simplify((-linear+sign*sp.sqrt(discriminant))/(2*quadratic)),discriminant))
    if sp.simplify(hi-lo)==0:
        return None
    contacts=sp.solveset(hi-lo,t,domain=sp.Interval(a,b))
    if not isinstance(contacts,sp.FiniteSet) and contacts is not sp.S.EmptySet:
        return None
    levels.update(sp.simplify(lo.subs(t,point)) for point in contacts)
    original_domain=sp.Interval(a,b)
    bottom=function_range(lo,t,original_domain).inf
    top=function_range(hi,t,original_domain).sup
    levels={level for level in levels if bool(bottom<=level) and bool(level<=top)}
    levels.update((bottom,top))
    if any(safe_float(level) is None for level in levels):
        return None
    cuts=sorted(levels,key=float);cells=[]
    for left,right in zip(cuts,cuts[1:]):
        if sp.simplify(right-left)==0:
            continue
        domain=sp.Interval(left,right);middle=sp.simplify((left+right)/2)
        curves=[a,b]
        for curve,discriminant in branches:
            if discriminant is not None and bool(discriminant.subs(s,middle)<0):
                _quantifier_check(discriminant>0,s,domain,'反函数实分支范围未确认')
                continue
            if domain.is_subset(continuous_domain(curve,s,sp.S.Reals)) is not True:
                return None
            value=sp.simplify(curve.subs(s,middle))
            if bool(value<a):
                _quantifier_check(curve>a,s,domain,'反函数分支跨越原区域端点')
                continue
            if bool(value>b):
                _quantifier_check(curve<b,s,domain,'反函数分支跨越原区域端点')
                continue
            _quantifier_check(curve<a,s,domain,'换序下界超出原区域')
            _quantifier_check(curve>b,s,domain,'换序上界超出原区域')
            _validate_curve_domain(curve,s,domain,'换序反函数边界')
            if not any(sp.simplify(curve-existing)==0 for existing in curves):
                curves.append(curve)
        curves.sort(key=lambda curve:float(curve.subs(s,middle)))
        band=[]
        for first,second in zip(curves,curves[1:]):
            _quantifier_check(first>second,s,domain,'换序边界在分段内交叉')
            point=sp.simplify(((first+second)/2).subs(s,middle))
            # All roots are enumerated and cannot cross within this band: cell membership is constant.
            if bool(lo.subs(t,point)<=middle) and bool(middle<=hi.subs(t,point)):
                if band and sp.simplify(band[-1][1]-first)==0:
                    band[-1]=(band[-1][0],second)
                else:
                    band.append((first,second))
        cells.extend((left,right,first,second) for first,second in band)
    if not cells:
        return None
    original_area=sp.integrate(hi-lo,(t,a,b))
    new_area=sum(sp.integrate(second-first,(s,left,right)) for left,right,first,second in cells)
    if sp.simplify(original_area-new_area)!=0:
        return None
    result=[]
    for left,right,first,second in cells:
        inner,exact,_=_integrate_strip(f,s.name,left,right,first,second)
        result.append(dict(outer_variable=s.name,inner_variable=t.name,
            outer_bounds=[expression_text(left),expression_text(right)],
            inner_bounds=[expression_text(first),expression_text(second)],
            inner_bounds_tex=[to_latex(first),to_latex(second)],inner_integral=expression_text(inner),
            exact=expression_text(exact),answer_value=float(exact),numeric_verified=True,region_verified=True,
            formula_tex=rf'\int_{{{to_latex(left)}}}^{{{to_latex(right)}}}\int_{{{to_latex(first)}}}^{{{to_latex(second)}}}{to_latex(f)}\,d{t.name}\,d{s.name}'))
    return result[0] if len(result)==1 else result

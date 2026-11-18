"""Verified monotone decompositions for elementary-function strip boundaries."""
import sympy as sp
from .expr import expression_text, parse_expression, safe_float, to_latex

MAX_PREVIEW_CHARS = 600


def preview_swap(
    integrand_text: str,
    outer: str,
    outer_a: str,
    outer_b: str,
    lower_text: str,
    upper_text: str,
) -> dict:
    """只读的沙盒换序预览：不写实验室、不改原题条件。

    仅接受 x/y 变量和受限表达式；无法保证等价时返回 ``supported=False``。
    """

    if outer not in ('x', 'y'):
        return {'supported': False, 'reason': '外层变量只能是 x 或 y。'}
    texts = (integrand_text, outer_a, outer_b, lower_text, upper_text)
    if any(not isinstance(text, str) or not text.strip() or len(text) > MAX_PREVIEW_CHARS for text in texts):
        return {'supported': False, 'reason': '表达式为空或超出长度上限。'}
    try:
        # parse_expression 要求至少声明一个变量；用不会出现在文本里的占位名，
        # 再显式拒绝任何自由符号，保证外层积分限是常数。
        a = parse_expression(outer_a, variables=('outer0',))
        b = parse_expression(outer_b, variables=('outer0',))
        if a.free_symbols or b.free_symbols:
            return {'supported': False, 'reason': '外层积分限必须是常数。'}
        a_value, b_value = complex(sp.N(a)), complex(sp.N(b))
        if abs(a_value.imag) > 1e-12 or abs(b_value.imag) > 1e-12 or not (a_value.real < b_value.real):
            return {'supported': False, 'reason': '外层积分区间必须按从小到大的有限实数给出。'}
        f = parse_expression(integrand_text, variables=('x', 'y'))
        lower = parse_expression(lower_text, variables=(outer,))
        upper = parse_expression(upper_text, variables=(outer,))
        allowed = {outer}
        if {str(symbol) for symbol in lower.free_symbols} - allowed or {str(symbol) for symbol in upper.free_symbols} - allowed:
            return {'supported': False, 'reason': f'内层边界只能含变量 {outer}。'}
        result = general_swap(f, outer, a, b, lower, upper)
    except Exception:  # noqa: BLE001 - 受限表达式或 SymPy 无法完成换序时明确拒绝
        return {'supported': False, 'reason': '当前拖拽区域无法完成符号换序。'}
    if result is None:
        return {'supported': False, 'reason': '当前区域不满足自动分段换序的单调性条件，已保留原题区域。'}
    records = result if isinstance(result, list) else [result]
    if not records or len(records) > 48:
        return {'supported': False, 'reason': '换序后的分段数量超出预览上限。'}
    return {'supported': True, 'swaps': records, 'piece_count': len(records)}


def general_swap(f,outer,a,b,lo,hi):
    from .double_integral import X,Y,_monotone_direction,_inverse_expression,_validate_curve_domain,_quantifier_check,_integrate_strip
    t,s=(X,Y) if outer=='x' else (Y,X)
    cuts={a,b}
    for curve in (lo,hi):
        if not curve.has(t):continue
        roots=sp.solveset(sp.diff(curve,t),t,domain=sp.Interval(a,b))
        if roots is not sp.S.EmptySet and not isinstance(roots,sp.FiniteSet):return None
        if len(roots)>24:return None
        cuts.update(root for root in roots if bool(a<root) and bool(root<b))
    if len(cuts)>26:return None
    cuts=sorted(cuts,key=float);cells=[]
    for left,right in zip(cuts,cuts[1:]):
        directions=[_monotone_direction(curve,t,left,right) for curve in (lo,hi)]
        if any(direction is None for direction in directions):return None
        levels={sp.simplify(curve.subs(t,end)) for curve in (lo,hi) for end in (left,right)}
        if sp.simplify(hi-lo)==0:return None
        contacts=sp.solveset(hi-lo,t,domain=sp.Interval(left,right))
        if contacts is not sp.S.EmptySet and not isinstance(contacts,sp.FiniteSet):return None
        if len(contacts)>24:return None
        levels.update(sp.simplify(lo.subs(t,point)) for point in contacts)
        levels=sorted(levels,key=float);branches=[]
        for curve,direction in zip((lo,hi),directions):
            if direction==0:continue
            inverse=_inverse_expression(curve,s,t,left,right)
            if inverse is None:return None
            ends=sorted([sp.simplify(curve.subs(t,end)) for end in (left,right)],key=float)
            branches.append((inverse,*ends))
        for bottom,top in zip(levels,levels[1:]):
            domain=sp.Interval(bottom,top);middle=sp.simplify((bottom+top)/2);boundaries=[left,right]
            for inverse,low,high in branches:
                if not (bool(low<middle) and bool(middle<high)):continue
                _validate_curve_domain(inverse,s,domain,'换序反函数')
                _quantifier_check(inverse<left,s,domain,'换序反函数越过原端点')
                _quantifier_check(inverse>right,s,domain,'换序反函数越过原端点')
                if not any(sp.simplify(inverse-old)==0 for old in boundaries):boundaries.append(inverse)
            boundaries.sort(key=lambda curve:float(curve.subs(s,middle)))
            band=[]
            for first,second in zip(boundaries,boundaries[1:]):
                _quantifier_check(first>second,s,domain,'换序分段内边界交叉')
                point=sp.simplify(((first+second)/2).subs(s,middle))
                # Strict monotonicity gives each boundary exactly one root; ordered root cells have fixed membership.
                if bool(lo.subs(t,point)<=middle) and bool(middle<=hi.subs(t,point)):
                    if band and sp.simplify(band[-1][1]-first)==0:band[-1]=(band[-1][0],second)
                    else:band.append((first,second))
            cells.extend((bottom,top,first,second) for first,second in band)
    if not cells or len(cells)>48:return None
    area=sum(sp.integrate(second-first,(s,bottom,top)) for bottom,top,first,second in cells)
    if sp.simplify(area-sp.integrate(hi-lo,(t,a,b)))!=0:return None
    records=[]
    for bottom,top,first,second in cells:
        inner,exact,_=_integrate_strip(f,s.name,bottom,top,first,second)
        records.append(dict(outer_variable=s.name,inner_variable=t.name,outer_bounds=[expression_text(bottom),expression_text(top)],inner_bounds=[expression_text(first),expression_text(second)],inner_bounds_tex=[to_latex(first),to_latex(second)],inner_integral=expression_text(inner),exact=expression_text(exact),answer_value=safe_float(exact),numeric_verified=True,region_verified=True,
            formula_tex=rf'\int_{{{to_latex(bottom)}}}^{{{to_latex(top)}}}\int_{{{to_latex(first)}}}^{{{to_latex(second)}}}{to_latex(f)}\,d{t}\,d{s}'))
    return records[0] if len(records)==1 else records

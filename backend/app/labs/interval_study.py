"""有限区间研究：保留原式定义域、不可导点和端点的取到性。"""
import sympy as sp
from sympy.calculus.util import continuous_domain
from .expr import parse_expression, safe_float
from .calculus_analysis import _interval_components, _finite_roots, _sample_point, _interval_label


def _roots(expr, v, domain):
    roots, complete = _finite_roots(expr, v, domain)
    if not complete or len(roots)>80: raise ValueError('无法确认全部临界点，或临界点数量超出当前范围')
    return roots


def _sign(expr, v, point):
    value=sp.simplify(expr.subs(v,point))
    if value.is_zero is True: return 0
    if value.is_positive is True: return 1
    if value.is_negative is True: return -1
    raise ValueError('无法符号确认区间内导数的符号')


def interval_study_report(model):
    v=sp.Symbol(str(model.get('variable') or 'x'),real=True)
    original=parse_expression(model['expression'],(str(v),),preserve_structure=True)
    config=model['manual_study']
    a,b=parse_expression(config['lower']),parse_expression(config['upper'])
    kind=config['interval_type']
    requested=sp.Interval(a,b,kind in ('open','left_open'),kind in ('open','right_open'))
    try:
        domain=continuous_domain(original,v,requested)
        components=_interval_components(domain)
        if not components: raise ValueError('区间内无可确认的实定义域区间，或定义域无法完整分解')
        pieces=[]; candidates=set(); attained=[]; boundary_values=[]
        domain_rows=[]
        for start,end,lo,ro in components:
            domain_rows.append(dict(**{'from':str(start),'to':str(end)},left_open=bool(lo),right_open=bool(ro)))
            for p,opened,direction in [(start,lo,'+'),(end,ro,'-')]:
                if not opened:
                    value=sp.simplify(original.subs(v,p))
                    if safe_float(value) is None: raise ValueError('无法确认闭端点的有限函数值')
                    attained.append((p,value,'端点'))
                limit=sp.limit(original,v,p,dir=direction)
                if limit not in (sp.oo,-sp.oo) and safe_float(limit) is None: raise ValueError('无法确认定义域端点的单侧极限')
                boundary_values.append(limit)
            abs_cuts=set()
            for node in original.atoms(sp.Abs): abs_cuts.update(_roots(node.args[0],v,sp.Interval.open(start,end)))
            base=[start,*sorted(abs_cuts,key=lambda x:sp.N(x,80)),end]
            for low,high in zip(base,base[1:]):
                sample=_sample_point(low,high)
                replacements={node:node.args[0] if _sign(node.args[0],v,sample)>=0 else -node.args[0] for node in original.atoms(sp.Abs)}
                branch=sp.simplify(original.xreplace(replacements))
                first=sp.simplify(sp.diff(branch,v)); second=sp.simplify(sp.diff(branch,v,2))
                inner=sp.Interval.open(low,high)
                domains=[continuous_domain(d,v,inner) for d in (first,second)]
                cuts=set()
                for derivative,dd in zip((first,second),domains):
                    dc=_interval_components(dd)
                    if dc is None: raise ValueError('无法完整确认导数定义域')
                    cuts.update(_roots(derivative,v,dd))
                    for dl,dr,_,_ in dc:
                        if low<dl<high: cuts.add(dl)
                        if low<dr<high: cuts.add(dr)
                boundaries=[low,*sorted(cuts,key=lambda x:sp.N(x,80)),high]
                for l,r in zip(boundaries,boundaries[1:]):
                    if not bool(l<r): raise ValueError('无法确认分段边界顺序')
                    open_piece=sp.Interval.open(l,r)
                    if any(open_piece.is_subset(dd) is not True for dd in domains): raise ValueError('导数在某子区间无实定义，无法给出完整结论')
                    mid=_sample_point(l,r)
                    s1,s2=_sign(first,v,mid),_sign(second,v,mid)
                    if (s1==0 and first!=0) or (s2==0 and second!=0): raise ValueError('分段内部存在尚未分离的导数零点')
                    pieces.append(dict(low=l,high=r,first=s1,second=s2))
                    if s1==0: attained.append((mid,sp.simplify(original.subs(v,mid)),'常值区间'))
                candidates.update(cuts);candidates.update(abs_cuts)
        extrema=[]; inflections=[]; critical=[]
        for point in sorted(candidates,key=lambda x:sp.N(x,80)):
            if not (a<point<b) or domain.contains(point) is not sp.S.true: continue
            left=next((p for p in pieces if sp.simplify(p['high']-point)==0),None)
            right=next((p for p in pieces if sp.simplify(p['low']-point)==0),None)
            if not left or not right: continue
            value=sp.simplify(original.subs(v,point))
            if safe_float(value) is None: continue
            attained.append((point,value,'内部候选点'))
            critical.append(dict(point=str(point),value=str(value)))
            if left['first']*right['first']<0:
                classification='maximum' if left['first']>0 else 'minimum'
                extrema.append(dict(point=str(point),value=str(value),classification=classification,label='极大值' if classification=='maximum' else '极小值'))
            if left['second']*right['second']<0:
                inflections.append(dict(point=str(point),value=str(value)))
        values=[value for _,value,_ in attained]+boundary_values
        lower_value=sp.simplify(sp.Min(*values));upper_value=sp.simplify(sp.Max(*values))
        if lower_value.has(sp.Min,sp.Max) or upper_value.has(sp.Min,sp.Max): raise ValueError('候选值大小无法符号确定')
        def bound(value):
            points=[str(p) for p,val,_ in attained if sp.simplify(val-value)==0]
            return dict(value=str(value),attained=bool(points),points=list(dict.fromkeys(points)))
        absolute=dict(minimum=bound(lower_value),maximum=bound(upper_value))
        endpoints=[]
        for point in (a,b):
            included=domain.contains(point) is sp.S.true
            endpoints.append(dict(point=str(point),included=included,value=str(sp.simplify(original.subs(v,point))) if included else '不计入函数取值'))
        monotone_pieces=[]
        for piece in pieces:
            previous=monotone_pieces[-1] if monotone_pieces else None
            if previous and previous['first']==piece['first'] and sp.simplify(previous['high']-piece['low'])==0 and domain.contains(piece['low']) is sp.S.true:
                previous['high']=piece['high']
            else: monotone_pieces.append(dict(piece))
        monotonic=[dict(kind={1:'increasing',-1:'decreasing',0:'constant'}[p['first']],label={1:'单调递增',-1:'单调递减',0:'常值'}[p['first']],interval=_interval_label(p['low'],p['high']),**{'from':float(p['low']),'to':float(p['high'])}) for p in monotone_pieces]
        concavity=[dict(kind={1:'concave_up',-1:'concave_down',0:'linear'}[p['second']],label={1:'凹向上',-1:'凹向下',0:'二阶导数恒为零'}[p['second']],interval=_interval_label(p['low'],p['high'])) for p in pieces]
        bounds_text=[]
        for key,title,nonattained in [('minimum','最小值','下确界'),('maximum','最大值','上确界')]:
            record=absolute[key]
            bounds_text.append(f"{title}={record['value']}（取到）" if record['attained'] else f"无{title}；{nonattained}={record['value']}（未取到）")
        answer='；'.join([*(p['label']+p['interval'] for p in monotonic),*bounds_text])
        return dict(status='complete',reason=None,answer=answer,derivative=str(sp.diff(original,v)),second_derivative=str(sp.diff(original,v,2)),monotonic=monotonic,concavity=concavity,extrema=extrema,inflections=inflections,domain=domain_rows,critical_points=critical,endpoints=endpoints,absolute=absolute,asymptotes=dict(vertical=[],horizontal=[],oblique=[],vertical_values=[],horizontal_values=[]))
    except (ValueError,TypeError,NotImplementedError) as exc:
        return dict(status='incomplete',reason=str(exc))

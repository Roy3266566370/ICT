"""User-confirmed improper integrals; finite truncations never supply the answer."""
import sympy as sp
from .expr import parse_expression, safe_float, to_latex
from .domain_analysis import analyze_integral, domain_gap_profile

NOTE='按普通反常积分分别检查每个瑕点两侧与无穷端；不以柯西主值或图像截断积分代替答案。'


def endpoint(raw):
    if not isinstance(raw,str) or not raw.strip() or len(raw)>100: raise ValueError('请完整填写积分上下限')
    raw=raw.strip()
    if raw in ('oo','+oo','inf','+inf','∞','+∞'): return sp.oo
    if raw in ('-oo','-inf','-∞'): return -sp.oo
    value=parse_expression(raw)
    if value.free_symbols or safe_float(value) is None: raise ValueError('积分限必须是实常数或±∞')
    return value


def preview(c):
    if set(c)!={'expression','variable','lower','upper','integral_mode'} or c['integral_mode']!='improper': raise ValueError('反常积分必须完整填写函数、变量与上下限，额外条件不能忽略')
    if c['variable'] not in ('x','t','y','z'): raise ValueError('积分变量不合法')
    if not isinstance(c['expression'],str) or len(c['expression'])>600: raise ValueError('被积函数过长')
    f=parse_expression(c['expression'],(c['variable'],),preserve_structure=True)
    a,b=endpoint(c['lower']),endpoint(c['upper'])
    if not bool(a<b): raise ValueError('反常积分下限必须小于上限')
    profile=domain_gap_profile(f,sp.Symbol(c['variable'],real=True),sp.Interval(a,b))
    if profile['gap']: raise ValueError('原被积函数在积分区间存在无实定义的区间')
    latex=rf'\int_{{{to_latex(a)}}}^{{{to_latex(b)}}}{to_latex(f)}\,d{c["variable"]}'
    return dict(task='integral',label='反常积分',conditions=c,latex=latex,question=f"计算普通反常积分：{c['expression']}，变量{c['variable']}，从{c['lower']}到{c['upper']}；{NOTE}")


def build_problem(c):
    from .exam_math import _condition
    p=preview(c)
    model=dict(subject='calculus',task='integral',kind='integral',variable=c['variable'],variables=[c['variable']],expression=c['expression'],formula_tex=p['latex'],defaults={},params=[],teaching=False,manual_improper_conditions=dict(c))
    names=dict(expression='被积函数',variable='积分变量',lower='积分下限',upper='积分上限',integral_mode='积分类型')
    fields=[_condition(k,names[k],v,{}) for k,v in c.items()]
    for field in fields:
        if field['id'] in ('variable','integral_mode'): field['editable']=False
    return dict(problem_id='prb_manual_improper',number=None,title=p['label'],text=p['question'],subject='calculus',subject_label='反常积分',confidence=1.0,status='ready',source={},source_pages=[],recognition=dict(method='declarative_kernel',raw_text='',conditions=fields,ambiguities=[],formulas=[],recognized_subject='calculus',ai_used=False),model=model,solution={},states={})


def solve(model):
    c=model['manual_improper_conditions'];v=sp.Symbol(c['variable'],real=True)
    f=parse_expression(c['expression'],(c['variable'],),preserve_structure=True)
    a,b=endpoint(c['lower']),endpoint(c['upper'])
    # Splitting two infinite ends prevents symmetric principal-value cancellation.
    reports=_reports(f,v,a,b)
    divergent=any(r['status']=='divergent' for r in reports)
    complete=all(r['status']=='finite' and r['complete'] for r in reports)
    value=sp.simplify(sum(r['value'] for r in reports)) if complete else None
    status='complete' if complete else 'divergent' if divergent else 'unsupported'
    reason='' if complete else next((r.get('reason') or '无法确认收敛性' for r in reports if r['status']!='finite'),'无法确认收敛性')
    steps=[dict(id='definition',title='按普通反常积分定义分段',detail=preview(c)['question'],latex=preview(c)['latex'])]
    for i,r in enumerate(reports):
        for j,segment in enumerate(r['segments']):
            steps.append(dict(id=f'part_{i}_{j}',title=f"子区间 [{segment['lower']}, {segment['upper']}]",detail=f"状态：{segment['status']}；{segment.get('reason','')}，{NOTE}",latex=to_latex(segment['value']) if segment.get('value') is not None else ''))
    return dict(answer=str(value) if complete else '发散' if divergent else '',exact=str(value) if complete else '',exact_latex=to_latex(value) if complete else '',answer_value=safe_float(value) if complete else None,approx=str(safe_float(value)) if complete else '',summary='反常积分收敛' if complete else reason,steps=steps,conditions=[preview(c)['question']],limitations=[NOTE],solution_complete=complete,solution_status=status,incomplete_reason=reason,convergence='finite' if complete else status)


def evaluate(model):
    s=solve(model)
    return dict(subject='calculus',task='integral',kind='integral',headline=s['summary'],answerText=s['answer'],metrics=[],checks=[],notes=s['limitations'],series=[],rects=[],domain=dict(x_min=-1,x_max=1),exact=s['answer_value'],approx=None,error=None,trace=[dict(index=i,label=p['title'],detail=p['detail'],values={}) for i,p in enumerate(s['steps'])])


def _reports(f,v,a,b):
    intervals=[(a,sp.Integer(0)),(sp.Integer(0),b)] if a==-sp.oo and b==sp.oo else [(a,b)]
    return [analyze_integral(f,v,lo,hi) for lo,hi in intervals]


def solve_double(c):
    from .double_integral import X,Y
    from sympy.calculus.util import function_range
    f=parse_expression(c['integrand'],('x','y'),preserve_structure=True)
    a,b,lo,hi=[endpoint(c[k]) for k in ('outer_lower','outer_upper','inner_lower','inner_upper')]
    t,s=(X,Y) if c['outer_variable']=='x' else (Y,X)
    domains={t:sp.Interval(a,b),s:sp.Interval(lo,hi)}
    reason='当前二重反常积分仅支持矩形常数边界上的可分离乘积；必须分别证明绝对收敛，未确认时不输出累次积分替代答案'
    status='unsupported';value=None;steps=[]
    try:
        for node in sp.preorder_traversal(f):
            if not node.free_symbols:
                if safe_float(node) is None: raise ValueError('原式含非实或无定义常数')
            elif len(node.free_symbols)==1:
                v=next(iter(node.free_symbols));profile=domain_gap_profile(node,v,domains[v])
                if profile['gap'] or not profile['complete']: raise ValueError('无法确认原被积函数实定义域，不能化简补回定义域')
            elif node.func in (sp.Add,sp.Mul,sp.sin,sp.cos,sp.exp,sp.Abs): continue
            elif isinstance(node,sp.Pow) and node.exp.is_integer: continue
            else: raise ValueError(reason)
        separated=sp.separatevars(sp.simplify(f),symbols=(t,s),dict=True)
        if separated is None: raise ValueError(reason)
        if separated['coeff']==0: separated={t:sp.Integer(0),s:sp.Integer(0),'coeff':sp.Integer(1)}
        coefficient=separated['coeff'];signed=[];absolute=[];fixed_sign=True
        for v in (t,s):
            factor=separated[v];domain=domains[v]
            span=function_range(factor,v,domain)
            positive=bool(span.inf>=0);negative=bool(span.sup<=0)
            abs_factor=factor if positive else -factor if negative else sp.Abs(factor)
            signed_parts=_reports(factor,v,domain.start,domain.end)
            absolute_parts=_reports(abs_factor,v,domain.start,domain.end)
            signed.append(signed_parts);absolute.append(absolute_parts)
            for i,part in enumerate(absolute_parts):
                steps.append(dict(id=f'absolute_{v}_{i}',title=f'{v}方向绝对收敛核查',detail=f"区间{domain}，|{factor}|：{part['status']}；{part.get('reason','')}",latex=''))
            fixed_sign=fixed_sign and (positive or negative)
        if all(r['status']=='finite' and r['complete'] for parts in absolute+signed for r in parts):
            value=sp.simplify(coefficient*sp.prod(sum(r['value'] for r in parts) for parts in signed))
            status='complete';reason='两方向绝对积分均有限，由Fubini定理计算乘积，二重反常积分收敛'
        elif fixed_sign and coefficient!=0:
            abs_values=[sum(r['value'] for r in parts) if all(r['status']=='finite' for r in parts) else None for parts in absolute]
            diverges=[any(r['status']=='divergent' for r in parts) for parts in absolute]
            if any(diverges[i] and (diverges[1-i] or (abs_values[1-i] is not None and bool(abs_values[1-i]>0))) for i in (0,1)):
                status='divergent';reason='被积函数在区域上不变号，且绝对积分发散；二重反常积分发散'
    except (ValueError,TypeError,NotImplementedError,ArithmeticError) as exc:
        reason=str(exc) or reason
    complete=status=='complete'
    return dict(answer=str(value) if complete else '发散' if status=='divergent' else '',exact=str(value) if complete else '',exact_latex=to_latex(value) if complete else '',answer_value=safe_float(value) if complete else None,approx='',summary=reason,steps=steps,conditions=[],limitations=[NOTE,'二重反常积分限矩形区域及可分离乘积；条件收敛不自动换序。'],solution_status=status,solution_complete=complete,incomplete_reason='' if complete else reason)

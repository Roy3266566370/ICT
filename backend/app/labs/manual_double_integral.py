"""Flat user-confirmed Cartesian bounds mapped to the existing double-integral kernel."""
import sympy as sp
from sympy.calculus.util import continuous_domain, function_range

from .expr import parse_expression, safe_float, to_latex
from .double_integral import X, Y, _validate_strip, compile_model, solve_double_integral

FIELDS = ('integrand','outer_variable','outer_lower','outer_upper','inner_lower','inner_upper')
NOTE = '支持有限单片、外层区间不重叠的分片及极坐标区域；自动换序支持二次边界完整分段，以及临界点、单调性与反函数可完整核验的其他初等边界。反常积分另有矩形、极坐标与曲边参数域模式，变量代换及密度应用使用专用流程；不能省略额外区域限制。'


def region_plan(c):
    if any(not isinstance(v,str) or not v.strip() or len(v)>(12000 if k=='pieces_text' else 600 if k=='integrand' else 150) for k,v in c.items()):
        raise ValueError('请完整填写字符串条件，不能省略积分限或输入过长表达式')
    mode=c.get('region_mode','strip')
    keys=set(c)-{'region_mode','swap_order'}
    if c.get('swap_order','false') not in ('true','false'):
        raise ValueError('换序要求必须是true或false')
    if mode=='improper':
        from .manual_improper_integral import endpoint
        if keys!=set(FIELDS) or c['outer_variable'] not in ('x','y'): raise ValueError('二重反常积分必须完整填写次序和四个常数积分限')
        if c.get('swap_order')=='true': raise ValueError('二重反常积分不自动换序，先分别确认绝对收敛')
        a,b,lo,hi=[endpoint(c[k]) for k in FIELDS[2:]]
        if not bool(a<b) or not bool(lo<hi): raise ValueError('矩形两方向的积分限均须递增')
        plan=dict(integrand=c['integrand'],outer_variable=c['outer_variable'],outer_bounds=[c['outer_lower'],c['outer_upper']],inner_bounds=[c['inner_lower'],c['inner_upper']])
    elif mode=='strip':
        base={k:v for k,v in c.items() if k in FIELDS}
        if keys!=set(FIELDS): raise ValueError('单片必须完整填写四个积分限，不能忽略额外条件')
        parse_inputs(base)
        plan=dict(integrand=c['integrand'],outer_variable=c['outer_variable'],outer_bounds=[c['outer_lower'],c['outer_upper']],inner_bounds=[c['inner_lower'],c['inner_upper']])
    elif mode=='pieces':
        if keys!={'integrand','outer_variable','pieces_text'}: raise ValueError('分片仅填写被积函数、次序及全部分片')
        raw=c['pieces_text']
        if not isinstance(raw,str) or len(raw)>12000: raise ValueError('分片输入过长')
        rows=[line.strip().split(';') for line in raw.splitlines() if line.strip()]
        if not 1<=len(rows)<=20 or any(len(row)!=4 for row in rows): raise ValueError('分片每行填写四个限，用英文分号分隔，最多20片')
        pieces=[]
        for row in rows:
            part=dict(zip(FIELDS,(c['integrand'],c['outer_variable'],*row)))
            parse_inputs(part)
            pieces.append(dict(outer_bounds=row[:2],inner_bounds=row[2:]))
        intervals=sorted([(parse_expression(p['outer_bounds'][0]),parse_expression(p['outer_bounds'][1])) for p in pieces],key=lambda pair:float(pair[0]))
        if any(bool(first[1]>second[0]) for first,second in zip(intervals,intervals[1:])): raise ValueError('分片外层区间不能重叠')
        plan=dict(integrand=c['integrand'],outer_variable=c['outer_variable'],pieces=pieces)
    elif mode=='polar':
        if keys!={'integrand','theta_lower','theta_upper','radius_lower','radius_upper'}: raise ValueError('极坐标必须完整填写极角与极径的四个限')
        if c.get('swap_order')=='true': raise ValueError('极坐标不适用直角坐标自动换序')
        from .double_integral import THETA, _validate_polar_curve, _quantifier_check
        a,b=[parse_expression(c[k]) for k in ('theta_lower','theta_upper')]
        if any(v.free_symbols or safe_float(v) is None for v in (a,b)) or not bool(a<b) or not bool(b-a<=2*sp.pi): raise ValueError('极角区间必须递增且不超过2*pi，避免重复覆盖区域')
        domain=sp.Interval(a,b)
        curves=[parse_expression(c[k],('theta',),preserve_structure=True) for k in ('radius_lower','radius_upper')]
        for curve in curves:
            for node in sp.preorder_traversal(curve):
                if not node.free_symbols and safe_float(node) is None: raise ValueError('原始极径边界含非实或无定义表达式')
                if node.free_symbols and domain.is_subset(continuous_domain(node,THETA,sp.S.Reals)) is not True: raise ValueError('原始极径边界在区间内无定义或不连续')
            _validate_polar_curve(curve,domain,'极径边界')
        _quantifier_check(curves[0]<0,THETA,domain,'极径不能为负')
        _quantifier_check(curves[1]-curves[0]<0,THETA,domain,'极径上界不能低于下界')
        plan=dict(integrand=c['integrand'],polar=dict(theta_bounds=[c['theta_lower'],c['theta_upper']],r_bounds=[c['radius_lower'],c['radius_upper']]))
    else: raise ValueError('请选择单片、分片或极坐标区域')
    parse_expression(c['integrand'],('x','y'),preserve_structure=True)
    if c.get('swap_order')=='true': plan['swap_order']=True
    return plan


def parse_inputs(c):
    if set(c) != set(FIELDS):
        raise ValueError('必须完整填写被积函数、积分次序和四个积分限；额外条件不能忽略')
    if any(not isinstance(c[k],str) or not c[k].strip() or len(c[k]) > (600 if k=='integrand' else 150) for k in FIELDS):
        raise ValueError('请完整填写被积函数和四个积分限，不自动补0')
    if c['outer_variable'] not in ('x','y'):
        raise ValueError('请选择先y后x或先x后y的积分次序')
    f=parse_expression(c['integrand'],('x','y'),preserve_structure=True)
    for key in ('outer_lower','outer_upper','inner_lower','inner_upper'):
        raw=parse_expression(c[key],('x','y'),preserve_structure=True)
        if any(not node.free_symbols and safe_float(node) is None for node in sp.preorder_traversal(raw)):
            raise ValueError('原始积分限含无定义或非实子表达式，不能化简后补回区域条件')
    a,b,lo,hi=_validate_strip(c['outer_variable'],[c['outer_lower'],c['outer_upper']],[c['inner_lower'],c['inner_upper']])
    return f,a,b,lo,hi


def _continuous_on_region(f,outer,a,b,lo,hi):
    """Sufficient proof on a rectangle containing D; sampling is not a proof."""
    t,s=(X,Y) if outer=='x' else (Y,X)
    interval=sp.Interval(a,b)
    projections={t:interval,s:sp.Interval(function_range(lo,t,interval).inf,function_range(hi,t,interval).sup)}
    try:
        for node in sp.preorder_traversal(f):
            names=node.free_symbols
            if not names:
                if safe_float(node) is None:return False
            elif len(names)==1:
                v=next(iter(names));domain=projections[v]
                if domain.is_subset(continuous_domain(node,v,sp.S.Reals)) is not True:return False
                span=function_range(node,v,domain)
                if safe_float(span.inf) is None or safe_float(span.sup) is None:return False
            elif node.func in (sp.Add,sp.Mul):
                continue
            elif isinstance(node,sp.Pow):
                base,power=node.args
                if power.is_integer is True and power.is_nonnegative is True:continue
                if base.is_positive is True:continue
                if power.is_positive is True and base.is_nonnegative is True:continue
                return False
            elif node.func in (sp.sin,sp.cos,sp.exp,sp.atan,sp.sinh,sp.cosh,sp.tanh,sp.Abs):
                continue
            elif node.func==sp.log and node.args[0].is_positive is True:
                continue
            else:return False
        return True
    except (ValueError,TypeError,NotImplementedError):
        return False


def preview(c):
    from .double_extensions import module_for
    extension=module_for(c)
    if extension is not None:return extension.preview(c)
    if 'region_mode' in c or 'swap_order' in c:
        plan=region_plan(c)
        f=parse_expression(c['integrand'],('x','y'),preserve_structure=True)
        if c.get('region_mode')=='improper':
            from .manual_improper_integral import endpoint
            a,b,lo,hi=[endpoint(c[k]) for k in FIELDS[2:]]
            outer=c['outer_variable'];inner='y' if outer=='x' else 'x'
            latex=rf'\int_{{{to_latex(a)}}}^{{{to_latex(b)}}}\int_{{{to_latex(lo)}}}^{{{to_latex(hi)}}}{to_latex(f)}\,d{inner}\,d{outer}'
            question=f"二重反常积分：{c['integrand']}；矩形区域：{a}<{outer}<{b}，{lo}<{inner}<{hi}；先{inner}后{outer}，按普通二重积分与绝对收敛定义核验，不以主值或累次积分代替"
        elif 'polar' in plan:
            a,b=[parse_expression(v) for v in plan['polar']['theta_bounds']]
            lo,hi=[parse_expression(v,('theta',)) for v in plan['polar']['r_bounds']]
            from .double_integral import RADIUS, THETA
            g=f.subs({X:RADIUS*sp.cos(THETA),Y:RADIUS*sp.sin(THETA)}, simultaneous=True)*RADIUS
            latex=rf'\int_{{{to_latex(a)}}}^{{{to_latex(b)}}}\int_{{{to_latex(lo)}}}^{{{to_latex(hi)}}}{to_latex(g)}\,dr\,d\theta'
            question=f"极坐标二重积分，原函数f(x,y)={c['integrand']}；{c['theta_lower']}≤theta≤{c['theta_upper']}，{c['radius_lower']}≤r≤{c['radius_upper']}；x=r*cos(theta)，y=r*sin(theta)，自动乘雅可比r"
        elif 'pieces' in plan:
            parts=[preview(dict(zip(FIELDS,(c['integrand'],c['outer_variable'],*p['outer_bounds'],*p['inner_bounds'])))) for p in plan['pieces']]
            latex='+'.join(p['latex'] for p in parts)
            question='分片二重积分，各片之并为完整区域：'+'；'.join(f"第{i+1}片：{p['question']}" for i,p in enumerate(parts))
        else:
            p=preview({k:c[k] for k in FIELDS});latex=p['latex'];question=p['question']
        if plan.get('swap_order'): question+='；要求根据同一区域自动推导等价积分次序与全部新积分限'
        return dict(task='double_integral',label='二重积分',conditions=c,latex=latex,question=question)
    f,a,b,lo,hi=parse_inputs(c)
    outer=c['outer_variable'];inner='y' if outer=='x' else 'x'
    latex=rf'\int_{{{to_latex(a)}}}^{{{to_latex(b)}}}\int_{{{to_latex(lo)}}}^{{{to_latex(hi)}}}{to_latex(f)}\,\mathrm{{d}}{inner}\,\mathrm{{d}}{outer}'
    question=f"计算二重积分；被积函数={c['integrand']}；先对{inner}再对{outer}；完整区域：{c['outer_lower']}≤{outer}≤{c['outer_upper']}，{c['inner_lower']}≤{inner}≤{c['inner_upper']}；无其他区域限制"
    return dict(task='double_integral',label='直角坐标二重积分',conditions=c,latex=latex,question=question)


def labels(c):
    outer=c.get('outer_variable','theta');inner='y' if outer=='x' else 'x'
    if c.get('region_mode') in ('affine','change_variables'):outer,inner='u','v'
    return dict(integrand='密度函数' if c.get('application') else '被积函数',application='计算任务',inertia_axis='惯量轴',x_map='映射 x(u,v)',y_map='映射 y(u,v)',event_outer_lower='事件外层下限',event_outer_upper='事件外层上限',event_inner_lower='事件内层下界',event_inner_upper='事件内层上界',region_mode='区域模式',swap_order='自动换序',pieces_text='全部分片（每行a;b;下界;上界）',theta_lower='极角下限',theta_upper='极角上限',radius_lower='极径下界',radius_upper='极径上界',outer_variable='外层积分变量',outer_lower=f'外层下限 {outer}',outer_upper=f'外层上限 {outer}',inner_lower=f'内层下界 {inner}',inner_upper=f'内层上界 {inner}')


def build_problem(c):
    from .double_extensions import module_for, build_problem as build_extension
    if module_for(c) is not None:return build_extension(c)
    if 'region_mode' in c or 'swap_order' in c:
        return build_advanced(c)
    from .exam_math import _condition
    f,a,b,lo,hi=parse_inputs(c);p=preview(c)
    outer=c['outer_variable'];inner='y' if outer=='x' else 'x'
    model=dict(engine='double_integral_v1',subject='calculus',task='double_integral',kind='integral',region_kind='strip',variables=['x','y'],expression=c['integrand'],integrand=c['integrand'],outer_variable=outer,inner_variable=inner,
        outer_bounds=[c['outer_lower'],c['outer_upper']],inner_bounds=[c['inner_lower'],c['inner_upper']],formula_tex=p['latex'],defaults={},params=[],teaching=False)
    failure=''
    continuous=_continuous_on_region(f,outer,a,b,lo,hi)
    if not continuous:
        failure='尚未确认原被积函数在整个区域上的连续实定义；抽样通过不能代替全域核验，当前不输出积分答案'
    else:
        try:
            model=compile_model(dict(integrand=c['integrand'],outer_variable=outer,outer_bounds=model['outer_bounds'],inner_bounds=model['inner_bounds']))
        except (ValueError,TypeError,NotImplementedError,ArithmeticError,sp.PolynomialError) as exc:
            failure=str(exc)
    # Keep the user's exact strings separate from the kernel's normalized form.
    model['variables']=['x','y']
    model['manual_double_conditions']=dict(c)
    model['manual_double_failure']=failure
    model['manual_double_continuous']=continuous
    fields=[_condition(k,labels(c)[k],v,{}) for k,v in c.items()]
    for field in fields:
        if field['id']=='outer_variable':field['editable']=False
    return dict(problem_id='prb_manual_double',number=None,title=p['label'],text=p['question'],subject='calculus',subject_label='二重积分',confidence=1.0,status='ready',
        source=dict(page_from=1,page_to=1,file_names=[],label='结构化输入',excerpt=''),source_pages=[],recognition=dict(method='declarative_kernel',raw_text='',conditions=fields,ambiguities=[],formulas=[],recognized_subject='calculus',ai_used=False),model=model,solution={},states={})


def solve(model):
    if 'double_extension_solution' in model:
        from .double_extensions import solve as solve_extension
        return solve_extension(model)
    c=model['manual_double_conditions'];failure=model['manual_double_failure']
    if 'region_mode' in c or 'swap_order' in c:
        return solve_advanced(model)
    d=dict(outer_variable=c['outer_variable'],inner_variable='y' if c['outer_variable']=='x' else 'x',outer_bounds=[c['outer_lower'],c['outer_upper']],inner_bounds=[c['inner_lower'],c['inner_upper']],
        region_kind='strip',region_verified=True,continuous_verified=model['manual_double_continuous'],inner_integral_latex='',zero_area=sp.simplify(parse_expression(c['inner_upper'],('x','y'))-parse_expression(c['inner_lower'],('x','y')))==0,note=NOTE)
    if failure:
        return dict(answer='',summary=failure,steps=[dict(id='region',title='完整区域与次序已记录',detail=preview(c)['question'],latex=model['formula_tex'])],conditions=[],limitations=[NOTE],double_details=d,solution_complete=False,solution_status='unsupported',incomplete_reason=failure)
    result=solve_double_integral(model)
    d['inner_integral_latex']=model['inner_integral_tex']
    result.update(exact_latex=model['exact_latex'],double_details=d,solution_complete=True,solution_status='complete',conditions=[preview(c)['question']],limitations=[NOTE,'数值积分仅作独立复核，二维中点和只用于观察；连续性依据与区域边界的全区间核验分别保留。'])
    return result


def evaluate_unfinished(model):
    solution=solve(model)
    return dict(subject='calculus',task='double_integral',kind='integral',headline=solution['summary'],answerText=solution['answer'],metrics=[],checks=[],notes=solution['limitations'],series=[],rects=[],domain=dict(x_min=-1,x_max=1),exact=solution.get('answer_value'),approx=None,error=None,trace=[dict(index=i,label=p['title'],detail=p['detail'],values={}) for i,p in enumerate(solution['steps'])])


def build_advanced(c):
    from .exam_math import _condition
    plan=region_plan(c);p=preview(c)
    f=parse_expression(c['integrand'],('x','y'),preserve_structure=True)
    continuous=True
    if c.get('region_mode')=='improper':
        continuous=False
    elif 'polar' in plan:
        from .double_integral import THETA, RADIUS
        a,b=[parse_expression(v) for v in plan['polar']['theta_bounds']]
        rlo,rhi=[parse_expression(v,('theta',)).subs(THETA,X) for v in plan['polar']['r_bounds']]
        # Check every original node so cancellation cannot erase an original pole.
        substitution={X:RADIUS*sp.cos(THETA),Y:RADIUS*sp.sin(THETA)}
        for node in sp.preorder_traversal(f):
            transformed=sp.trigsimp(node.subs(substitution,simultaneous=True))
            transformed=transformed.subs({THETA:X,RADIUS:Y},simultaneous=True)
            if not _continuous_on_region(transformed,'x',a,b,rlo,rhi):
                continuous=False
                break
    else:
        for piece in plan.get('pieces',[plan]):
            a,b,lo,hi=_validate_strip(plan['outer_variable'],piece['outer_bounds'],piece['inner_bounds'])
            continuous=continuous and _continuous_on_region(f,plan['outer_variable'],a,b,lo,hi)
    failure=''
    model=dict(engine='double_integral_v1',subject='calculus',task='double_integral',kind='integral',region_kind=c.get('region_mode','strip'),defaults={},params=[],teaching=False,formula_tex=p['latex'])
    if c.get('region_mode')=='improper': pass
    elif not continuous: failure='尚未确认原被积函数在整个区域上连续实定义；当前不输出积分答案'
    else:
        try: model=compile_model(plan)
        except (ValueError,TypeError,NotImplementedError,ArithmeticError,sp.PolynomialError) as exc: failure=str(exc)
    model.update(variables=['x','y'],expression=c['integrand'],manual_double_conditions=dict(c),manual_double_failure=failure,manual_double_continuous=continuous)
    fields=[_condition(k,labels(c)[k],v,{}) for k,v in c.items()]
    for field in fields:
        if field['id'] in ('outer_variable','region_mode','swap_order'): field['editable']=False
    return dict(problem_id='prb_manual_double',number=None,title=p['label'],text=p['question'],subject='calculus',subject_label='二重积分',confidence=1.0,status='ready',source={},source_pages=[],recognition=dict(method='declarative_kernel',raw_text='',conditions=fields,ambiguities=[],formulas=[],recognized_subject='calculus',ai_used=False),model=model,solution={},states={})


def solve_advanced(model):
    c=model['manual_double_conditions'];p=preview(c);failure=model['manual_double_failure']
    d=dict(region_kind=c.get('region_mode','strip'),outer_variable=model.get('outer_variable',c.get('outer_variable','theta')),inner_variable=model.get('inner_variable','r' if c.get('region_mode')=='polar' else 'y' if c.get('outer_variable')=='x' else 'x'),outer_bounds=model.get('outer_bounds',[]),inner_bounds=model.get('inner_bounds',[]),region_verified=True,continuous_verified=model['manual_double_continuous'],inner_integral_latex=model.get('inner_integral_tex',''),zero_area=False,note=NOTE,region_description=p['question'])
    if c.get('region_mode')=='improper':
        from .manual_improper_integral import solve_double
        result=solve_double(c)
        result['double_details']=d
        return result
    if failure:
        return dict(answer='',summary=failure,steps=[dict(id='region',title='完整区域与要求已记录',detail=p['question'],latex=p['latex'])],conditions=[],limitations=[NOTE],double_details=d,solution_complete=False,solution_status='unsupported',incomplete_reason=failure)
    result=solve_double_integral(model)
    result.update(exact_latex=to_latex(parse_expression('0')) if model['answer_value']==0 else to_latex(sp.sympify(model['exact'],locals={'e':sp.E})),double_details=d,solution_complete=True,solution_status='complete',conditions=[p['question']],limitations=[NOTE])
    return result

"""多元一阶微分：偏导定义与可微充分条件分开核验。"""
import sympy as sp
from sympy.calculus.util import continuous_domain
from .expr import parse_expression, expression_text, safe_float, to_latex

OPERATIONS={'partial':'一阶偏导数','differential':'全微分','directional':'方向导数','gradient':'梯度'}


def vector(raw,dimension,label):
    if not isinstance(raw,str) or not raw.strip() or len(raw)>300: raise ValueError(f'请完整填写{label}')
    text=raw.strip().replace('，',',')
    if text.startswith('[') and text.endswith(']'): text=text[1:-1]
    if text.startswith('(') and text.endswith(')'):
        depth=0;enclosed=True
        for i,char in enumerate(text):
            depth+=1 if char=='(' else -1 if char==')' else 0
            if depth==0 and i<len(text)-1: enclosed=False;break
        if enclosed:text=text[1:-1]
    parts=text.split(',')
    if len(parts)!=dimension: raise ValueError(f'{label}必须按变量顺序完整填写{dimension}个分量，不自动补0')
    values=[]
    for part in parts:
        value=parse_expression(part.strip())
        if value.free_symbols or value.is_real is not True or safe_float(value) is None: raise ValueError(f'{label}的分量必须是有限实常数')
        values.append(value.xreplace({n:sp.Rational(str(n)) for n in value.atoms(sp.Float)}))
    return values


def parse_inputs(c):
    if c.get('variables') not in ('x,y','x,y,z'): raise ValueError('变量顺序请选择x,y或x,y,z')
    variables=c['variables'].split(',');symbols=[sp.Symbol(v,real=True) for v in variables]
    op=c.get('operation')
    if op not in OPERATIONS: raise ValueError('请选择偏导数、全微分、方向导数或梯度')
    if not isinstance(c.get('expression'),str) or not 1<=len(c['expression'])<=600: raise ValueError('请填写600字以内的显式函数')
    expr=parse_expression(c['expression'],variables,preserve_structure=True)
    point=vector(c['point'],len(variables),'求值点') if 'point' in c else None
    if op=='partial':
        if c.get('partial_variable') not in variables: raise ValueError('请选择属于当前变量列表的偏导变量')
    elif 'partial_variable' in c: raise ValueError('该任务不能忽略额外指定的偏导变量')
    direction=None
    if op=='directional':
        if point is None: raise ValueError('方向导数必须给出完整求值点')
        direction=vector(c.get('direction'),len(variables),'方向向量')
        if sp.simplify(sum(v*v for v in direction))==0: raise ValueError('方向向量不能为零向量')
        if c.get('direction_limit') not in ('forward','two_sided'): raise ValueError('请明确正向单侧或双侧方向导数约定')
    elif 'direction' in c or 'direction_limit' in c: raise ValueError('非方向导数任务不能忽略额外方向条件')
    return variables,symbols,op,expr,point,direction


def canonical_conditions(c):
    variables,_,op,_,point,direction=parse_inputs(c)
    out={**c,'expression':c['expression'].strip()}
    if point is not None:out['point']=', '.join(expression_text(v) for v in point)
    if direction is not None:out['direction']=', '.join(expression_text(v) for v in direction)
    return out


def smooth_conditions(expr,point_map):
    conditions=[];known=True;satisfied=True
    def require(predicate):
        nonlocal satisfied
        predicate=sp.simplify(predicate)
        if predicate is sp.S.false: raise ValueError('该表达式没有当前能确认的实开域')
        if predicate is not sp.S.true:conditions.append(to_latex(predicate))
        if point_map is not None and sp.simplify(predicate.subs(point_map)) is not sp.S.true:satisfied=False
    for node in sp.preorder_traversal(expr):
        if node.is_Atom or node.func in (sp.Add,sp.Mul):continue
        if isinstance(node,sp.Pow):
            base,power=node.args
            if power.is_integer is True:
                if power.is_negative:require(sp.Ne(base,0))
            else:require(sp.Gt(base,0))
        elif node.func==sp.Abs:require(sp.Ne(node.args[0],0))
        elif node.func==sp.log:require(sp.Gt(node.args[0],0))
        elif node.func in (sp.tan,sp.sec):require(sp.Ne(sp.cos(node.args[0]),0))
        elif node.func in (sp.cot,sp.csc):require(sp.Ne(sp.sin(node.args[0]),0))
        elif node.func in (sp.asin,sp.acos):require(sp.Gt(1-node.args[0]**2,0))
        elif node.func in (sp.asec,sp.acsc):require(sp.Gt(node.args[0]**2-1,0))
        elif node.func==sp.acot:require(sp.Ne(node.args[0],0))
        elif node.func not in (sp.sin,sp.cos,sp.exp,sp.atan,sp.sinh,sp.cosh,sp.tanh):known=False
    return list(dict.fromkeys(conditions)),known and satisfied


def defined_value(expr,substitutions):
    for node in sp.preorder_traversal(expr):
        if isinstance(node,sp.Expr) and safe_float(node.subs(substitutions)) is None:
            raise ValueError('原式在该点存在无定义或非实子表达式，不因化简补回条件')
    return sp.simplify(expr.subs(substitutions))


def path_derivative(expr, symbols, point, direction, convention):
    from .calculus_analysis import _interval_components
    h=sp.Symbol('h',real=True)
    path=expr.subs({v:p+h*d for v,p,d in zip(symbols,point,direction)},simultaneous=True)
    domain=continuous_domain(path,h,sp.S.Reals)
    parts=_interval_components(domain)
    def available(side):
        return any((start<0 and end>=0 if side=='-' else start<=0 and end>0) for start,end,_,_ in parts or [])
    sides=('+',) if convention=='forward' else ('-','+')
    if not parts or not all(available(side) for side in sides):raise ValueError('所选方向没有该约定要求的实定义域邻域')
    base=defined_value(expr,dict(zip(symbols,point)))
    values=[sp.simplify(sp.limit((path-base)/h,h,0,dir=side)) for side in sides]
    if any(safe_float(v) is None for v in values):raise ValueError('该方向或偏导的差商没有有限实极限')
    if len(values)==2 and sp.simplify(values[0]-values[1])!=0:raise ValueError('双侧差商极限不相等，不能把单侧值当作普通偏导或双侧方向导数')
    return values[-1]


def solve_multivariable(model):
    c=model['typed_conditions'];variables,symbols,op,expr,point,direction=parse_inputs(c)
    details=dict(operation=op,variables=variables,point=[str(p) for p in point] if point is not None else None,partials=[],smooth_conditions=[],differentiability='unconfirmed',method='symbolic',result_latex='',direction=None,
        note='偏导存在或梯度分量存在，不等于全微分存在。所列光滑条件是充分条件，不声称覆盖全部可微点。')
    steps=[]
    try:
        substitutions=dict(zip(symbols,point)) if point is not None else None
        if substitutions is not None:defined_value(expr,substitutions)
        conditions,smooth=smooth_conditions(expr,substitutions)
        details.update(smooth_conditions=conditions,differentiability='sufficient_c1' if point is not None and smooth else 'conditional' if point is None and smooth else 'unconfirmed')
        gradients=[sp.simplify(sp.diff(expr,v)) for v in symbols]
        selected=[variables.index(c['partial_variable'])] if op=='partial' else list(range(len(symbols))) if op!='directional' or smooth else []
        values={}
        for index in selected:
            derivative=gradients[index]
            if derivative.has(sp.Derivative,sp.DiracDelta):raise ValueError('当前未完成普通偏导表达式的求解')
            value=path_derivative(expr,symbols,point,[sp.Integer(i==index) for i in range(len(symbols))],'two_sided') if point is not None else derivative
            values[index]=value
            details['partials'].append(dict(variable=variables[index],expression=expression_text(derivative),latex=to_latex(derivative),value=str(value) if point is not None else None))
        if point is None and not smooth:raise ValueError('尚不能为该形式确认符号微分公式的充分适用条件')
        location='(P)' if point is not None else ''
        result_value=None
        if op=='partial':
            index=selected[0];result=values[index];result_value=safe_float(result) if point is not None else None
            tex=rf'\frac{{\partial f}}{{\partial {variables[index]}}}'+location+'='+to_latex(result)
        elif op=='gradient':
            result=sp.Matrix([values[i] for i in range(len(symbols))]);tex=rf'\nabla f{location}='+to_latex(result)
        elif op=='differential':
            if point is not None and not smooth:raise ValueError('偏导已核对，但当前不能确认该点可微；不将形式线性项当作已成立的全微分')
            result=sum(values[i]*sp.Symbol('d'+v) for i,v in enumerate(variables))
            differential_tex=to_latex(result)
            for v in variables:differential_tex=differential_tex.replace('d'+v,rf'\,\mathrm{{d}}{v}')
            tex=r'\mathrm{d}f'+location+'='+differential_tex
        else:
            norm=sp.sqrt(sum(v*v for v in direction));unit=[sp.simplify(v/norm) for v in direction]
            result=path_derivative(expr,symbols,point,unit,c['direction_limit']);result_value=safe_float(result)
            details['method']='gradient' if smooth else 'definition'
            if smooth and sp.simplify(sum(values[i]*unit[i] for i in range(len(symbols)))-result)!=0:raise ValueError('定义极限与梯度内积尚未确认一致')
            details['direction']=dict(raw=[str(v) for v in direction],unit=[str(v) for v in unit],norm=str(norm),convention=c['direction_limit'])
            tex=(r'D_{\mathbf u}^{+}f(P)=' if c['direction_limit']=='forward' else r'D_{\mathbf u}f(P)=')+to_latex(result)
            steps.append(dict(id='direction',title='归一化方向并核对定义',detail='原向量只指定方向，除以长度得到单位向量；按已选单侧/双侧差商求极限。可微充分条件通过时再与梯度内积核对。',latex=r'\mathbf u='+to_latex(sp.Matrix(unit))))
        details['result_latex']=tex
        steps=[dict(id='variables',title='确认变量与求值点',detail='变量顺序为'+', '.join(variables)+'；'+('未指定点，给出条件适用的符号公式。' if point is None else '逐个保留完整坐标和原式定义。')),
               dict(id='partials',title='偏导与可微性分开核对',detail='求偏导时固定其余变量；点值用普通双侧差商核验。全微分和梯度内积公式仅在可微性有依据时使用。'),*steps,dict(id='result',title='写出本任务结果',detail=details['note'],latex=tex)]
        answer=OPERATIONS[op]+' = '+('('+', '.join(str(result[i]) for i in range(len(symbols)))+')' if op=='gradient' else str(result))
        return dict(summary=OPERATIONS[op],answer=answer,exact=str(result),exact_latex=tex,answer_value=result_value,steps=steps,conditions=conditions,limitations=[details['note']],multi_details=details,solution_status='complete',solution_complete=True)
    except (ValueError,TypeError,NotImplementedError) as exc:
        return dict(summary=str(exc),answer='',steps=steps,conditions=[],limitations=[details['note']],multi_details=details,solution_status='unsupported',solution_complete=False,incomplete_reason=str(exc))


def build_multivariable_problem(c):
    from .exam_math import _condition
    c=canonical_conditions(c);variables,_,op,expr,_,_=parse_inputs(c)
    condition_list=[_condition(k,k,v,{}) for k,v in c.items()]
    for item in condition_list:
        if item['id'] in ('operation','variables'):item['editable']=False
    model=dict(engine='sympy',subject='calculus',task='multivariable',kind='multivariable',variables=variables,expression=c['expression'],typed_conditions=c,defaults={},params=[],teaching=False,formula_tex='f='+to_latex(expr))
    return dict(problem_id='prb_multi',number=None,title=OPERATIONS[op],text='',subject='calculus',subject_label='多元函数微分学',confidence=1.0,status='ready',source=dict(page_from=1,page_to=1,file_names=[],label='结构化输入',excerpt=''),source_pages=[],recognition=dict(method='declarative_kernel',raw_text='',conditions=condition_list,ambiguities=[],formulas=[],recognized_subject='calculus',ai_used=False),model=model,solution={},states={})


def evaluate_multivariable(model,params):
    solution=solve_multivariable(model)
    return dict(subject='calculus',task='multivariable',kind='multivariable',headline=solution.get('answer') or solution['summary'],metrics=[],checks=[],notes=solution['limitations'],series=[],domain=dict(x_min=-1,x_max=1),rects=[],exact=solution.get('answer_value'),approx=None,error=None,answerText=solution.get('answer',''),trace=[dict(index=i,label=s['title'],detail=s['detail'],values={}) for i,s in enumerate(solution['steps'])])

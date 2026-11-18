"""二元局部极值编排；候选全集、奇异约束点与分类分开核验。"""
import re

import sympy as sp
from sympy.polys.polyerrors import BasePolynomialError

from .expr import parse_expression, safe_float, to_latex
from .constrained import X, Y, LAMBDA, _split_constraint, _classify_constrained

LABELS = {'minimum':'局部极小值', 'maximum':'局部极大值', 'saddle':'鞍点', 'undetermined':'尚未判定'}
SCOPE = '只判定局部极值与鞍点，不由候选值比较宣称全局最值。首批支持二元多项式；不等式、多约束、额外区域边界和驻点族的完整分类尚未开放。'


_OPERATIONS = {
    'unconstrained': 'unconstrained', 'unconstrained_extrema': 'unconstrained',
    'local_extrema': 'unconstrained', 'extrema': 'unconstrained', 'extremum': 'unconstrained',
    'local': 'unconstrained', 'free': 'unconstrained', '无约束': 'unconstrained',
    '无约束极值': 'unconstrained', '无条件极值': 'unconstrained',
    'constrained': 'constrained', 'constrained_extrema': 'constrained',
    'conditional': 'constrained', 'conditional_extrema': 'constrained', 'lagrange': 'constrained',
    '条件极值': 'constrained', '有条件极值': 'constrained',
}


def _operation_text(raw):
    """Map provider synonyms to the two kernel operations."""
    if not isinstance(raw, str):
        return ''
    return _OPERATIONS.get(raw.strip().lower(), '')


def _variables_text(raw):
    """Accept both "x,y" and ["x", "y"]; the kernel only supports the fixed pair."""
    if isinstance(raw, (list, tuple)):
        raw = ','.join(str(item).strip() for item in raw)
    if not isinstance(raw, str):
        return ''
    return re.sub(r'\s+', '', raw)


def parse_inputs(c):
    if _variables_text(c.get('variables')) != 'x,y':
        raise ValueError('首批多元极值固定二元变量顺序x,y')
    operation = _operation_text(c.get('operation'))
    if not operation:
        raise ValueError('请选择无约束局部极值或单等式约束极值')
    raw = c.get('expression')
    if not isinstance(raw,str) or not 1 <= len(raw) <= 600:
        raise ValueError('目标函数必须是600字以内的表达式')
    objective = parse_expression(raw, ('x','y'), preserve_structure=True)
    constraint = None
    if operation == 'constrained':
        raw = c.get('constraint')
        if not isinstance(raw,str) or not 1 <= len(raw) <= 600 or raw.count('=') != 1 or any(v in raw for v in ('\n','\r',';',',','；','，')):
            raise ValueError('首批仅支持一个完整等式约束；多约束或附加条件不能遗漏，请保留原题')
        left,right = _split_constraint(raw)
        constraint = parse_expression(f'({left})-({right})', ('x','y'), preserve_structure=True)
        if not constraint.free_symbols:
            raise ValueError('约束必须含x或y，不能用恒等式替代题目约束')
    elif 'constraint' in c and c.get('constraint') not in (None, ''):
        raise ValueError('无约束任务不能忽略额外约束，请选择条件极值')
    return objective,constraint


def _polynomial(expr, degree):
    # shortcut: only raw polynomial trees certify a smooth full domain; extend
    # after a domain-aware candidate enumeration is available for other forms.
    for node in sp.preorder_traversal(expr):
        if not node.free_symbols and safe_float(node) is None:
            return False
        if isinstance(node,sp.Pow) and (node.exp.is_integer is not True or node.exp.is_nonnegative is not True):
            if node.free_symbols:
                return False
        if node.is_Function and node.free_symbols:
            return False
    if not expr.is_polynomial(X,Y):
        return False
    polynomial=sp.Poly(expr,X,Y)
    return polynomial.total_degree() <= degree and all(a.is_real is True and safe_float(a) is not None for a in polynomial.coeffs())


def _finite_points(equations, symbols):
    """Exact zero-dimensional polynomial solve, never an unchecked solve() list."""
    try:
        basis = sp.groebner(equations, *symbols)
        if list(basis) == [1]:
            return [], True
        if not basis.is_zero_dimensional:
            return [], False
        roots = sp.solve_poly_system(equations, *symbols, strict=True)
        if roots is None or len(roots) > 64:
            return [], False
        rows=[]
        for values in roots:
            if any(v.is_real is False for v in values):
                continue
            if any(v.free_symbols or v.is_real is not True or safe_float(v) is None for v in values):
                return rows,False
            row = dict(zip(symbols,values))
            if any(sp.simplify(e.subs(row)) != 0 for e in equations):
                return rows,False
            rows.append(row)
        return rows,True
    except (ValueError,TypeError,NotImplementedError,BasePolynomialError):
        return [],False


def _feasible_witness(g, candidates):
    if candidates:
        return True
    # A real slice is a witness only, never a completeness argument.
    for fixed,other in ((X,Y),(Y,X)):
        for value in (0,1,-1):
            expr = sp.simplify(g.subs(fixed,value))
            if expr == 0:
                return True
            roots=sp.solveset(expr,other,domain=sp.S.Reals)
            if isinstance(roots,sp.FiniteSet) and any(r.is_real is True and safe_float(r) is not None and sp.simplify(expr.subs(other,r)) == 0 for r in roots):
                return True
    return False


def _periodic_quadratic(f):
    """Certify a*x²/2 + B*x*exp(c + d*T(w*y+p)) + C on R².

    The raw syntax guard is essential: cancellation must never erase a hole.
    Only exp/sin/cos and polynomial arithmetic are globally smooth here.
    """
    for node in sp.preorder_traversal(f):
        if node.is_Function and node.func not in (sp.exp, sp.sin, sp.cos):
            return None
        if isinstance(node, sp.Pow) and node.free_symbols and (node.exp.is_integer is not True or node.exp.is_nonnegative is not True):
            return None
        if not node.free_symbols and (node.is_real is not True or safe_float(node) is None):
            return None
    try:
        poly = sp.Poly(f, X)
    except BasePolynomialError:
        return None
    if poly.degree() != 2:
        return None
    a, b, constant = [sp.simplify(v) for v in (2*poly.nth(2), poly.nth(1), poly.nth(0))]
    if any(v.free_symbols or v.is_real is not True or safe_float(v) is None for v in (a, constant)) or a.is_zero is not False:
        return None
    exponentials = list(b.atoms(sp.exp))
    if len(exponentials) != 1:
        return None
    exponential = exponentials[0]
    scale = sp.simplify(b/exponential)
    if scale.free_symbols or scale.is_real is not True or scale.is_zero is not False or safe_float(scale) is None:
        return None
    h = exponential.args[0]
    trig = list(h.atoms(sp.sin, sp.cos))
    if len(trig) != 1:
        return None
    t = trig[0]
    amplitude = sp.simplify(sp.diff(h, Y)/sp.diff(t, Y))
    offset = sp.simplify(h-amplitude*t)
    frequency = sp.diff(t.args[0], Y)
    phase = sp.simplify(t.args[0]-frequency*Y)
    if any(v.free_symbols or v.is_real is not True or safe_float(v) is None for v in (amplitude, offset, frequency, phase)) or amplitude.is_zero is not False or frequency.is_zero is not False:
        return None
    # solveset returns the full real zero set, rather than sample roots.
    roots = sp.solveset(sp.diff(h, Y), Y, domain=sp.S.Reals)
    families = list(roots.args) if isinstance(roots, sp.Union) else [roots]
    if not families or len(families) > 8:
        return None
    k = sp.Symbol('k', integer=True)
    candidates = []
    for family in families:
        if not isinstance(family, sp.ImageSet) or family.base_set != sp.S.Integers or len(family.lamda.variables) != 1:
            return None
        y = sp.simplify(family.lamda.expr.subs(family.lamda.variables[0], k))
        x = sp.simplify((-b/a).subs(Y, y))
        point = {X: x, Y: y}
        if any(sp.simplify(sp.diff(f, v).subs(point)) != 0 for v in (X, Y)):
            return None
        determinant = sp.simplify(sp.hessian(f, (X, Y)).subs(point).det())
        if determinant.is_negative:
            classification = 'saddle'
        elif determinant.is_positive and (a.is_positive or a.is_negative):
            classification = 'minimum' if a.is_positive else 'maximum'
        else:
            return None
        candidates.append(dict(point=[str(x), str(y)], value=str(sp.simplify(f.subs(point))), classification=classification,
            kind='stationary', multiplier=None, residual_verified=True, constraint_verified=None,
            evidence=f'k为任意整数；整族代回梯度为零；A=f_xx={a}，D={determinant}；{LABELS[classification]}'))
    return candidates, a, b, roots


def solve_extrema(model):
    c=model['typed_conditions'];f,g=parse_inputs(c)
    d=dict(operation=c['operation'],variables=['x','y'],constraint=c.get('constraint'),candidates=[],stationary_complete=False,
           classification_complete=False,singular_complete=None,scope_note=SCOPE)
    steps=[]
    reason=''
    periodic = _periodic_quadratic(f) if g is None and not _polynomial(f,6) else None
    if periodic is not None:
        candidates, a, b, roots = periodic
        d.update(candidates=candidates, stationary_complete=True, classification_complete=True,
                 scope_note='已认证全实平面光滑的常系数二次项与指数正弦/余弦系数；保留全部整数参数驻点族。')
        steps=[dict(id='gradient', title='消元并核查驻点全集', latex=rf'f_x={to_latex(sp.diff(f,X))}=0,\quad f_y={to_latex(sp.diff(f,Y))}=0',
                    detail=f'二次项系数非零且指数系数处处非零。由f_x=0得x=-({b})/({a})，代入f_y=0等价于指数的导数为零；solveset实零点全集为{roots}。'),
               dict(id='hessian', title='对完整整数参数族作二阶判别', detail='k为任意整数；整族代回梯度核验，并对含整数参数的Hessian行列式作精确符号判别，不只取k=0。')]
    elif not _polynomial(f,6) or (g is not None and not _polynomial(g,4)):
        reason='首批仅确认六次以内多项式目标与四次以内多项式约束；保留原式，不化简掉分母、非光滑点或定义域条件'
    elif g is None:
        from .exam_math import complete_extrema
        report=complete_extrema(dict(expression=c['expression'],variables=['x','y'],bounds={}),{})
        certified,enumeration_complete=_finite_points([sp.diff(f,v) for v in (X,Y)],(X,Y))
        # The legacy solver can return only radical-solvable roots. Require an
        # independent exhaustive solve before accepting its classification.
        same_points={tuple(str(sp.simplify(p[v])) for v in (X,Y)) for p in certified} == {tuple(p['coordinates']) for p in report['stationary_points']}
        d['stationary_complete']=report['stationary_complete'] and enumeration_complete and same_points
        d['classification_complete']=report['classification_complete'] and d['stationary_complete']
        for p in report['stationary_points']:
            point=dict(zip((X,Y),map(sp.sympify,p['coordinates'])))
            a=sp.simplify(sp.diff(f,X,2).subs(point))
            determinant=sp.simplify(sp.hessian(f,(X,Y)).subs(point).det())
            d['candidates'].append(dict(point=p['coordinates'],value=p['value'],classification=p['classification'],kind='stationary',
                multiplier=None,residual_verified=all(sp.simplify(sp.diff(f,v).subs(point)) == 0 for v in (X,Y)),constraint_verified=None,
                evidence=f'A=f_xx={a}，D=f_xx*f_yy-f_xy²={determinant}；'+('二阶判别不足，不以D=0认定无极值' if p['classification']=='undetermined' else LABELS[p['classification']])))
        steps=[dict(id='gradient',title='求梯度并建立驻点方程',latex=rf'f_x={to_latex(sp.diff(f,X))}=0,\quad f_y={to_latex(sp.diff(f,Y))}=0',detail='目标为已确认全实平面光滑的多项式；局部极值必须满足两个偏导同时为零。'),
               dict(id='enumerate',title='核查驻点全集',detail='精确多项式方程组的实根全集已核对。' if d['stationary_complete'] else '驻点全集尚未确认；已列候选不作为排除其他极值的依据。'),
               dict(id='hessian',title='逐个候选进行二阶判别',latex=r'A=f_{xx},\quad D=f_{xx}f_{yy}-f_{xy}^2',detail='D>0且A>0为局部极小；D>0且A<0为局部极大；D<0为鞍点；D=0或符号未确认时不强行分类。')]
        reason=(report.get('incomplete_reason') or '驻点方程候选全集尚未确认，不能将部分符号根或空列表当作全部解') if not d['classification_complete'] else ''
    else:
        fx,fy=sp.diff(f,X),sp.diff(f,Y);gx,gy=sp.diff(g,X),sp.diff(g,Y)
        equations=[fx-LAMBDA*gx,fy-LAMBDA*gy,g]
        regular,regular_complete=_finite_points(equations,(X,Y,LAMBDA))
        singular,singular_complete=_finite_points([g,gx,gy],(X,Y))
        d['singular_complete']=singular_complete
        seen=set()
        for point in regular:
            if sp.simplify(gx.subs(point)) == 0 and sp.simplify(gy.subs(point)) == 0:
                continue
            classification,evidence=_classify_constrained(f,g,point)
            key=tuple(str(sp.simplify(point[s])) for s in (X,Y));seen.add(key)
            d['candidates'].append(dict(point=list(key),value=str(sp.simplify(f.subs(point))),kind='regular',multiplier=str(sp.simplify(point[LAMBDA])),
                classification=classification,evidence=evidence,residual_verified=all(sp.simplify(e.subs(point)) == 0 for e in equations),constraint_verified=sp.simplify(g.subs(point)) == 0))
        for point in singular:
            key=tuple(str(sp.simplify(point[s])) for s in (X,Y))
            if key in seen:
                continue
            d['candidates'].append(dict(point=list(key),value=str(sp.simplify(f.subs(point))),kind='singular',multiplier=None,
                classification='undetermined',evidence='约束梯度为零的奇异点；普通拉格朗日必要条件不适用，不能遗漏',
                residual_verified=all(sp.simplify(e.subs(point)) == 0 for e in (g,gx,gy)),constraint_verified=True))
        d['stationary_complete']=regular_complete and singular_complete
        feasible=_feasible_witness(g,d['candidates'])
        d['classification_complete']=d['stationary_complete'] and feasible and all(p['classification']!='undetermined' for p in d['candidates'])
        reasons=[]
        if not regular_complete:reasons.append('乘数方程候选全集尚未确认（可能存在驻点族）')
        if not singular_complete:reasons.append('奇异约束点集合尚未确认完整')
        if any(p['kind']=='singular' for p in d['candidates']):reasons.append('存在奇异约束点，需进一步判定')
        if any(p['classification']=='undetermined' and p['kind']=='regular' for p in d['candidates']):reasons.append('存在退化候选，加边Hessian不足以分类')
        if not feasible:reasons.append('尚未确认实可行点，不将空候选当作无约束极值的证明')
        reason='；'.join(reasons)
        steps=[dict(id='lagrange',title='完整保留约束并建立乘数方程',latex=rf'L={to_latex(f)}-\lambda({to_latex(g)})',detail='解f_x=λg_x、f_y=λg_y及g=0；候选逐项代回核验。'),
               dict(id='singular',title='单独检查奇异约束点',latex=r'g=0,\quad g_x=g_y=0',detail='奇异点不要求存在乘数；未确认全集或分类时保留未完成状态。'),
               dict(id='classification',title='核验候选并判定约束局部极值',detail='正则点用加边Hessian：行列式负为局部极小，正为局部极大；为零不强行分类。')]
    complete=d['classification_complete']
    descriptions=[f"{LABELS[p['classification']]}点({', '.join(p['point'])})，f={p['value']}" for p in d['candidates']]
    answer='；'.join(descriptions) if complete else ''
    if complete and periodic is not None:
        answer+='；k为任意整数'
        if not any(p['classification']=='maximum' for p in d['candidates']):answer+='；无局部极大值'
        if not any(p['classification']=='minimum' for p in d['candidates']):answer+='；无局部极小值'
    if complete and not descriptions:answer='在已确认的光滑可行域中没有驻点，因此不存在局部极值'
    tex=r'\begin{gathered}'+r'\\'.join(rf'f({",".join(to_latex(sp.sympify(v)) for v in p["point"])})={to_latex(sp.sympify(p["value"]))}\quad\text{{{LABELS[p["classification"]]}}}' for p in d['candidates'])+r'\end{gathered}' if complete and descriptions else r'\text{没有驻点及局部极值}' if complete else ''
    d['result_latex']=tex
    return dict(summary=answer or reason,answer=answer,exact=answer,exact_latex=tex,answer_value=None,steps=steps,conditions=[c.get('constraint') or '无额外约束，研究整个实平面上的局部极值'],limitations=[SCOPE],extrema_details=d,
                solution_complete=complete,solution_status='complete' if complete else 'unsupported',incomplete_reason=None if complete else reason)


def preview(c):
    f,g=parse_inputs(c)
    latex=rf'f(x,y)={to_latex(f)}'
    question=f"求二元函数{c['expression']}的"+('无约束局部极值与鞍点，研究范围为整个实平面，无其他约束' if g is None else f"条件局部极值；完整等式约束：{c['constraint']}")
    if g is not None:latex+=rf',\quad {to_latex(g)}=0'
    return dict(task='multivariable_extrema',label='二元局部极值' if g is None else '等式约束局部极值',conditions=c,latex=latex,question=question)


def build_problem(c):
    from .exam_math import _condition
    c = dict(c)
    if _operation_text(c.get('operation')):
        c['operation'] = _operation_text(c.get('operation'))
    if _variables_text(c.get('variables')) == 'x,y':
        c['variables'] = 'x,y'
    p=preview(c)
    conditions=[_condition(k,{'expression':'目标函数','constraint':'完整等式约束','operation':'极值任务','variables':'变量顺序'}.get(k,k),v,{}) for k,v in c.items()]
    for item in conditions:
        if item['id'] in ('operation','variables'):item['editable']=False
    return dict(problem_id='prb_extrema',number=None,title=p['label'],text=p['question'],subject='calculus',subject_label='多元函数极值',confidence=1.0,status='ready',
        source=dict(page_from=1,page_to=1,file_names=[],label='结构化输入',excerpt=''),source_pages=[],recognition=dict(method='declarative_kernel',raw_text='',conditions=conditions,ambiguities=[],formulas=[],recognized_subject='calculus',ai_used=False),
        model=dict(engine='sympy',subject='calculus',task='multivariable_extrema',kind='multivariable_extrema',variables=['x','y'],expression=c['expression'],typed_conditions=c,defaults={},params=[],teaching=False,formula_tex=p['latex']),solution={},states={})


def evaluate(model,params):
    s=solve_extrema(model)
    return dict(subject='calculus',task='multivariable_extrema',kind='multivariable_extrema',headline=s['answer'] or s['summary'],metrics=[],checks=[],notes=s['limitations'],series=[],domain=dict(x_min=-1,x_max=1),rects=[],exact=None,approx=None,error=None,answerText=s['answer'],trace=[dict(index=i,label=p['title'],detail=p['detail'],values={}) for i,p in enumerate(s['steps'])])

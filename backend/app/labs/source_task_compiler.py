"""Compile explicit source notation; retain extraction facts and source additions.

No general natural-language parser: only complete, delimited task expressions.
Function definitions (设/已知 f(x[,y])=EXPR) compile to the right-hand side plus
sourced facts; the reading's own facts are never rewritten or dropped here.
Unconsumed facts are still rejected by the shared coverage validator.
"""
import ast
import re

_CN_DIGITS = {'一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
              '六': 6, '七': 7, '八': 8, '九': 9, '十': 10}
_EN_ORDINALS = {1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth',
                6: 'sixth', 7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth'}


def _order_fact_predicate(order, order_text):
    """阶数事实的溯源匹配：绑定谓词只影响覆盖与溯源，不影响计算值。"""
    ordinal = _EN_ORDINALS.get(order, '')

    def predicate(value):
        text = str(value).strip()
        if text in (str(order), order_text):
            return True
        if re.search(r'第?\s*[0-9一二两三四五六七八九十]+\s*阶', text):
            return True
        return bool(re.search(rf'\b(?:{order}\s*(?:st|nd|rd|th)|{ordinal})\s*[-\s]?derivative',
                              text, re.I))
    return predicate

# 定义右侧不能包含的字符：分句符、等号（多等式须核对）与中文连接词。
_FUNC_DEF = (r'(?:(?:已知|设|求)(?:函数)?\s*)?'
             r'(?P<name>[a-z])\s*\(\s*(?P<vars>x(?:\s*,\s*y)?)\s*\)\s*=\s*'
             r'(?P<expr>[^，,。;；=的在]+?)')
_OPTIMIZATION = re.compile(
    _FUNC_DEF
    + r'(?:\s*的\s*|[，,。;；]\s*求\s*(?:函数\s*)?'
    + r'(?:(?P=name)\s*(?:\(\s*x(?:\s*,\s*y)?\s*\)\s*)?)?的?\s*)'
    + r'(?P<goal>极值点?)\s*[。.]?\s*')
_HIGHER_DERIVATIVE = re.compile(
    _FUNC_DEF
    + r'(?:\s*的\s*|\s*在\s*x\s*=\s*(?P<point2>[+-]?\d+(?:\.\d+)?)\s*处\s*的?\s*'
    + r'|[，,。;；]\s*求\s*(?:函数\s*)?(?:(?P=name)\s*(?:\(\s*x\s*\)\s*)?)?'
    + r'(?:在\s*x\s*=\s*(?P<point>[+-]?\d+(?:\.\d+)?)\s*处\s*)?的?\s*)'
    + r'第?\s*(?P<order>[0-9]+|[一二两三四五六七八九十])\s*阶\s*导\s*数\s*[。.]?\s*')


def key(value):
    text=re.sub(r'\s+','',str(value)).replace('θ','theta').replace('π','pi')
    return re.sub(r'(?<=\d)(?=theta)', '*', text)


def defkey(value):
    """定义比对用规范化：读题常把 2*x^3 写成 2x^3，数字与单字母间补显式乘号。

    仅用于来源匹配，不改变任何事实值。
    """
    return re.sub(r'(?<=\d)(?=[a-z])', '*', key(value))


def subtree(part, whole):
    try:
        def syntax(text):
            return re.sub(r"y('{1,4})",lambda m:'D'+str(len(m.group(1))),key(text).replace('^','**'))
        p=ast.dump(ast.parse(syntax(part),mode='eval').body)
        return any(ast.dump(n)==p for n in ast.walk(ast.parse(syntax(whole),mode='eval').body))
    except (SyntaxError,ValueError,RecursionError):
        return False


def _order_value(text):
    return int(text) if text.isdigit() else _CN_DIGITS.get(text)


def _definition_problem(reading, task, source, issue):
    """定义语法存在但完整匹配失败时，要求核对而不是截取计算。"""
    if re.search(r'[a-z]\s*\(\s*x(?:\s*,\s*y)?\s*\)\s*=', source) and issue(source):
        reading.setdefault('source_coverage_issues', []).append(
            f'{task}的原文含未覆盖成分（附加条件、区间或所求限定），需完整核对，不能只取定义计算。')
    return None


def compile_source_task(task, reading, source):
    conditions={};sources={};aliases={}
    if task=='limit':
        m=re.search(r'lim\(\s*([xyzt])\s*->\s*([+-]?\d+(?:\.\d+)?)\s*\)\s*(.+?)[。]?$',source)
        if not m:return None
        variable,point,expression=m.groups()
        conditions={'expression':expression,'variable':variable,'point':float(point)}
        sources={'expression':expression,'point':m.group(0)}
        aliases={'expression':lambda v:subtree(v,expression), 'point':lambda v:key(v) in (variable+'='+point,variable+'->'+point),
                 'variable':lambda v:key(v)==variable}
    elif task=='ode':
        m=re.fullmatch(r'\s*(?:求)?微分方程\s*([^。]+?=[^。]+?)\s*的通解[。.]?\s*',source)
        if not m:
            if '的通解' in source and '微分方程' in source:
                reading.setdefault('source_coverage_issues',[]).append('通解任务原文含额外条件或目标，不能只截取方程。')
            return None
        equation=m.group(1).strip()
        if equation.count('=')!=1:
            reading.setdefault('source_coverage_issues',[]).append('原文含多个等式，须核对方程及初值，不能丢弃额外等式。')
            return None
        for fact in reading['conditions']:
            def orderless(v):return re.sub(r"y'{1,4}", 'Dy', key(v))
            if (key(fact.get('excerpt',''))==key(equation)
                    and key(fact.get('value',''))!=key(equation)
                    and orderless(fact.get('value',''))==orderless(equation)):
                reading.setdefault('extraction_corrections',[]).append(dict(fact_id=fact['id'],
                    previous=fact['value'],corrected=equation,evidence=equation))
                fact['value']=equation
        conditions={'equation':equation};sources={'equation':equation}
        lhs,rhs=equation.split('=')
        aliases={'equation':lambda v:key(v)==key(equation) or subtree(v,lhs) or subtree(v,rhs)}
    elif task=='double_integral' and '极坐标' in source and '面积' in source:
        complete=re.fullmatch(r'(?:曲线[A-Za-z]?的)?极坐标方程(?:为)?r=[^，,。;；]+[，,]\s*[\d+*/().pie -]+<=theta<=[\d+*/().pie -]+[。；;]\s*求[A-Za-z]?围成的有界区域面积[。.]?',source)
        if not complete:
            reading.setdefault('source_coverage_issues',[]).append('极坐标原文含未覆盖的区域约束或目标，需核对完整区域。')
            return None
        radius=re.search(r'(?<![A-Za-z0-9_])r\s*=\s*([^，,。;；]+)',source)
        bounds=re.search(r'([\d+*/().pie -]+)<=theta<=([\d+*/().pie -]+)',source)
        if not radius or not bounds:return None
        r=radius.group(1).strip();lo,hi=(v.strip() for v in bounds.groups())
        conditions={'integrand':'1','polar':{'theta_bounds':[lo,hi],'r_bounds':['0',r]}}
        sources={'polar':radius.group(0)+'，'+bounds.group(0)}
        aliases={'polar':lambda v:key(v) in (key(radius.group(0)),key(bounds.group(0)))}
    elif task=='optimization':
        m=_OPTIMIZATION.fullmatch(source)
        if not m:
            return _definition_problem(reading, task, source, lambda s: re.search(r'极[值大]', s))
        name,variables_text,expr=m['name'],m['vars'],m['expr'].strip()
        variables=['x'] if re.sub(r'\s+','',variables_text)=='x' else ['x','y']
        definition=f'{name}({variables_text})={expr}'
        conditions={'expression':expr,'variables':variables,'goal':'extrema','bounds':{}}
        sources={'expression':definition}
        aliases={'expression':lambda v:defkey(v) in (defkey(definition),defkey(expr)) or subtree(v,expr),
                 'variables':lambda v:v.strip() in ('x','y','x,y'),
                 'goal':lambda v:'极值' in v}
    elif task=='higher_derivative':
        m=_HIGHER_DERIVATIVE.fullmatch(source)
        if not m:
            return _definition_problem(reading, task, source, lambda s: re.search(r'阶\s*导\s*数', s))
        order=_order_value(m['order'])
        if order is None or not 1<=order<=10:
            reading.setdefault('source_coverage_issues',[]).append('导数阶数超出内核支持的1至10阶，需核对。')
            return None
        if re.sub(r'\s+','',m['vars'])!='x':
            reading.setdefault('source_coverage_issues',[]).append('高阶导数编译仅支持单变量函数定义，需核对。')
            return None
        name,expr=m['name'],m['expr'].strip()
        point_text=m['point'] or m['point2']
        point_value=(float(point_text) if '.' in point_text else int(point_text)) if point_text else None
        definition=f'{name}(x)={expr}'
        conditions={'expression':expr,'variable':'x','order':order}
        sources={'expression':definition}
        if point_value is not None:
            conditions['point']=point_value
            sources['point']=f'x={point_value}'
        order_phrase=re.search(rf'第?\s*{re.escape(m["order"])}\s*阶\s*导\s*数',source)
        sources['order']=order_phrase.group() if order_phrase else f'{order}阶导数'
        aliases={'expression':lambda v:defkey(v) in (defkey(definition),defkey(expr),defkey(f'{name}(x)')) or subtree(v,expr),
                 'variable':lambda v:v.strip()=='x',
                 'order':_order_fact_predicate(order, m['order']),
                 'point':lambda v:point_value is not None and bool(re.fullmatch(
                     rf'在?\s*x\s*=\s*{re.escape(str(point_value))}\s*处?',v.strip()))}
    else:return None
    bindings={}
    for field,predicate in aliases.items():
        refs=[f['id'] for f in reading['conditions'] if predicate(f.get('value',''))]
        if refs:bindings[field]=refs
    for field,excerpt in sources.items():
        i=1
        while any(f['id']==f'source_{field}_{i}' for f in reading['conditions']):i+=1
        identifier=f'source_{field}_{i}'
        reading['conditions'].append(dict(id=identifier,value=excerpt,excerpt=excerpt,unit='',page_key=None,bbox=None))
        bindings.setdefault(field,[]).append(identifier)
    if task in ('limit','higher_derivative'):
        bindings.setdefault('variable',[]).extend(bindings['expression'])
    if task=='optimization':
        bindings.setdefault('variables',[]).extend(bindings['expression'])
    bindings={field:list(dict.fromkeys(refs)) for field,refs in bindings.items()}
    model=dict(task=task,conditions=conditions,bindings=bindings)
    if task=='double_integral':model['derivations']={'integrand':'面积作为对区域上常数1的二重积分'}
    if task=='optimization':model['derivations']={'expression':'目标函数取自函数定义的右侧'}
    if task=='higher_derivative':model['derivations']={'expression':'目标函数取自函数定义的右侧','order':'阶数取自所求的第N阶导数'}
    return model

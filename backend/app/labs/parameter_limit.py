"""Solve a unique real parameter from an independently computed bilateral limit."""
import math
import re
import sympy as sp
from .expr import expression_text, number_text, parse_expression, safe_float, to_latex

_LIMIT_PATTERN = re.compile(
    r"(?:\\?lim|极限)\s*(?:[_^]\s*\{?|\()?\s*([A-Za-z])\s*"
    r"(?:\\to|->|→|to|趋于|趋近于)\s*([^\s,，})\]}]+)\s*[\)\}]?\s*(.+)",
    re.IGNORECASE | re.DOTALL,
)
_LEADING_NUMBER = re.compile(r"^\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*/\s*\d+(?:\.\d+)?)?)")
_PARAM_ASK = re.compile(
    r"(?:求|则|确定|试确定|计算)\s*(?:常数|参数|实数)?\s*([A-Za-z])\s*(?:=|的|值为|$|[\n，,。；;])"
)
_PARAM_BLANK = re.compile(r"([A-Za-z])\s*=\s*[_＿—\-]{2,}")
_PARAM_WORD = re.compile(r"参数\s*([A-Za-z])")
_FUNCTION_WORDS = {
    "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "arccot",
    "arcsec", "arccsc", "sinh", "cosh", "tanh", "exp", "ln", "log", "sqrt", "abs",
    "pi", "e", "i",
}


def _normalize_products(expression: str) -> str:
    """OCR/手写公式常把乘号省成空格；解析前补出显式乘法，但不动函数名。"""

    text = expression.strip()
    functions = "arcsin|arccos|arctan|arccot|arcsec|arccsc|sinh|cosh|tanh|sin|cos|tan|cot|sec|csc|exp|ln|log|sqrt|abs"
    text = re.sub(
        rf"\b({functions})\s+([A-Za-z](?:\^[-+]?\d+)?|\([^()]*\))",
        lambda match: f"{match.group(1)}({match.group(2)})",
        text,
    )
    text = re.sub(r"(?<=[A-Za-z0-9)])\s+(?=[A-Za-z0-9(])", "*", text)
    # 连写的单字母参数 ax→a*x；以函数名开头的 token（如 sinx、ln）保持原样交给解析器。
    text = re.sub(rf"\b(?!{functions}\b)([A-Za-z])([A-Za-z])\b", r"\1*\2", text)
    return text


def _split_equation(raw: str) -> tuple[str, str] | None:
    depth = 0
    for index, char in enumerate(raw):
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth = max(0, depth - 1)
        elif char == "=" and depth == 0:
            left, right = raw[:index].strip(), raw[index + 1:].strip()
            return (left, right) if left and right else None
    return None


def _parse_limit(text: str) -> tuple[str, str, str, float] | None:
    match = _LIMIT_PATTERN.search(text)
    if not match:
        return None
    variable, point, body = match.group(1), match.group(2), match.group(3)
    point = point.replace("＋", "+").replace("−", "-")
    if "\\" in body:
        from .extract import _latex_display
        body = _latex_display(body)
    body = body.strip(" ：:，,。；;")
    parts = _split_equation(body)
    if parts is None:
        return None
    left, right = parts
    target = _LEADING_NUMBER.match(right)
    if target is None:
        return None
    try:
        value = float(sp.sympify(target.group(1)))
    except (ValueError, TypeError, sp.SympifyError):
        return None
    if not math.isfinite(value):
        return None
    return variable, point, left.strip(" ：:，,。；;"), value


def _asked_parameter(text: str, variable: str) -> str | None:
    for pattern in (_PARAM_ASK, _PARAM_BLANK, _PARAM_WORD):
        for match in pattern.finditer(text):
            for group in match.groups():
                if group and group != variable and len(group) == 1:
                    return group
    return None


def _parameter(expression: str, variable: str, text: str) -> str | None:
    candidates: list[str] = []
    for token in re.findall(r"[A-Za-z][A-Za-z0-9_]*", expression):
        if token in _FUNCTION_WORDS or token == variable or len(token) != 1:
            continue
        if re.search(rf"\b{re.escape(token)}\s*\(", expression):
            continue
        if token not in candidates:
            candidates.append(token)
    asked = _asked_parameter(text, variable)
    if asked is not None:
        return asked if asked in candidates else None
    return candidates[0] if len(candidates) == 1 else None


def _condition(condition_id: str, label: str, value: object, source: dict) -> dict:
    return {
        "id": condition_id,
        "label": label,
        "value": value,
        "kind": "text",
        "unit": "",
        "provenance": "original",
        "source": dict(source or {}),
        "editable": True,
        "options": [],
        "min": None,
        "max": None,
        "step": None,
    }


def build_parameter_limit_from_text(text: str, source: dict, overrides: dict) -> dict | None:
    """识别“已知含参极限值，求参数”的题干并交给参数极限内核。"""

    parsed = _parse_limit(text)
    if parsed is None:
        return None
    variable, point, expression, target = parsed
    expression = _normalize_products(expression)
    parameter = _parameter(expression, variable, text)
    if parameter is None:
        return None
    try:
        original = parse_expression(expression, (variable, parameter))
        point_value = safe_float(parse_expression(point))
    except Exception:
        return None
    if point_value is None:
        return None
    try:
        problem = compile_parameter_limit({
            "expression": expression_text(original) if original.free_symbols else str(original),
            "variable": variable,
            "point": str(point),
            "parameter": parameter,
            "target_value": number_text(target),
        })
    except (ValueError, TypeError, ArithmeticError):
        return None
    recognition = problem.get("recognition") or {}
    conditions = list(recognition.get("conditions") or [])
    conditions.extend([
        _condition("parameter", "所求参数", parameter, source),
        _condition("target_value", "已知极限值", number_text(target), source),
    ])
    return {
        "model": problem["model"],
        "conditions": conditions,
        "formulas": [{
            "id": "parameter_limit",
            "tex": to_latex(original),
            "plain": expression,
            "role": "原题含参极限",
        }],
        "recognized": True,
        "ambiguities": list(recognition.get("ambiguities") or []),
        "title": "已知极限求参数",
    }


def compile_parameter_limit(c):
    from .kernel_models import compile_kernel_problem
    variable, parameter = c['variable'], c['parameter']
    if not isinstance(parameter,str) or not re.fullmatch('[a-df-hj-z]',parameter) or parameter == variable:
        raise ValueError('参数必须是与自变量不同的实数字母')
    expression = parse_expression(c['expression'], (variable,parameter))
    symbols = {str(s):s for s in expression.free_symbols}
    x, a = symbols.get(variable,sp.Symbol(variable,real=True)), symbols.get(parameter)
    if a is None: raise ValueError('原式未包含所求参数')
    point = parse_expression(str(c['point']))
    target = parse_expression(str(c['target_value']))
    if point.free_symbols or target.free_symbols or safe_float(point) is None or safe_float(target) is None:
        raise ValueError('极限点和给定极限值必须为有限实常数')
    left, right = [sp.limit(expression,x,point,dir=side) for side in ('-','+')]
    if left.has(sp.Limit) or right.has(sp.Limit) or sp.simplify(left-right)!=0:
        raise ValueError('左右极限尚未证明一致，不能建立参数方程')
    solutions = sp.solveset(left-target,a,domain=sp.S.Reals)
    if not isinstance(solutions,sp.FiniteSet) or len(solutions)!=1:
        raise ValueError('尚未得到唯一有限实参数解')
    value = next(iter(solutions))
    if safe_float(value) is None: raise ValueError('参数解不是有限实数')
    substituted = expression.subs(a,value)
    if any(sp.simplify(sp.limit(substituted,x,point,dir=side)-target)!=0 for side in ('-','+')):
        raise ValueError('参数代回原式后未通过双侧极限复核')
    p=compile_kernel_problem({'task':'limit','conditions':{'expression':str(substituted),
        'variable':variable,'point':float(point),'side':'both'}})
    p['model'].update(modeling_task='parameter_limit',parameter=parameter,parameter_value=str(value),
        parameter_limit_expression=c['expression'],parameter_limit_left=str(left),target_value=str(target))
    p['solution'].update(exact=expression_text(value),answer=f'{parameter}={expression_text(value)}',summary='先计算含参双侧极限，再解参数方程，并代回原式核验。',
        steps=[{'id':'symbolic-limit','title':'计算含参双侧极限','detail':'左右极限一致。',
            'latex':rf'\lim_{{{variable}\to {to_latex(point)}}}{to_latex(expression)}={to_latex(left)}'},
            {'id':'solve-parameter','title':'解参数方程','detail':f'由给定极限值求出 {parameter}={expression_text(value)}。',
             'latex':rf'{to_latex(left)}={to_latex(target)}\quad\Longrightarrow\quad {parameter}={to_latex(value)}'},
            {'id':'verify-parameter','title':'代回原式复核','detail':'将参数解代回完整原式，左右极限均等于给定值。'}])
    return p

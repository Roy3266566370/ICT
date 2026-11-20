"""受限数学表达式解析。

只接受白名单函数、变量与运算符；不执行任意 Python，也不让模型生成的文本直接
进入求解器。LaTeX 片段先做有限替换，再交给 sympy 的 ``parse_expr``。解析失败的
原因会原样返回给识别层，用于生成需要学生核对的歧义项。
"""

from __future__ import annotations

import re
import unicodedata
from fractions import Fraction
from typing import Iterable

import sympy as sp
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

MAX_EXPR_CHARS = 600
# 只限制输入长度不足以阻止 2**(2**33) 这类在求值阶段指数级膨胀的输入：
# evaluate=True 会先物化完整整数再返回，因此必须在求值前加工作量预算。
MAX_EXPR_NODES = 500
MAX_INT_LITERAL_BITS = 128
MAX_RESULT_INT_BITS = 8192
MAX_POWER_EXPONENT = 4096
_MAX_EXACT_INT = 10**18

TRANSFORMATIONS = standard_transformations + (
    convert_xor,
    implicit_multiplication_application,
)

FUNCTIONS = {
    "sin": sp.sin,
    "cos": sp.cos,
    "tan": sp.tan,
    "asin": sp.asin,
    "acos": sp.acos,
    "atan": sp.atan,
    "acot": sp.acot,
    "asec": sp.asec,
    "acsc": sp.acsc,
    "sinh": sp.sinh,
    "cosh": sp.cosh,
    "tanh": sp.tanh,
    "exp": sp.exp,
    "log": sp.log,
    "ln": sp.log,
    "sqrt": sp.sqrt,
    "abs": sp.Abs,
    "cot": sp.cot,
    "sec": sp.sec,
    "csc": sp.csc,
    "factorial": sp.factorial,
}

# ``\arctan`` 这类反三角写法是教材常见记号，去掉前缀等价于 SymPy 的 atan。
FUNCTION_ALIASES = {
    "arctan": "atan",
    "arcsin": "asin",
    "arccos": "acos",
    "arccot": "acot",
    "arcsec": "asec",
    "arccsc": "acsc",
}
FUNCTIONS.update({alias: FUNCTIONS[base] for alias, base in FUNCTION_ALIASES.items()})

CONSTANTS = {"pi": sp.pi, "e": sp.E}

SUPERSCRIPTS = str.maketrans(
    {
        "⁰": "0",
        "¹": "1",
        "²": "2",
        "³": "3",
        "⁴": "4",
        "⁵": "5",
        "⁶": "6",
        "⁷": "7",
        "⁸": "8",
        "⁹": "9",
        "⁻": "-",
        "⁺": "+",
    }
)

_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z_0-9]*")
# ``xarctanx`` / ``arccosx`` 这类粘连写法既没有乘号也没有括号：整体当成一个标识符
# 必然报“未知符号”。因此在解析前按最长函数名切出函数名并补一个空格，让 sympy 的
# 隐式乘法变换补出参数与乘法，得到 ``x*atan(x)``。
FUNCTION_NAMES = tuple(sorted(FUNCTIONS, key=len, reverse=True))


def normalize_function_notation(text: str) -> str:
    """Keep known function names when OCR uses LaTeX font/operator wrappers."""
    def operator(match: re.Match[str]) -> str:
        name = re.sub(r'\s+', '', match.group(1)).lower()
        return ' ' + FUNCTION_ALIASES.get(name, name) + ' ' if name in FUNCTIONS else match.group(0)

    text = re.sub(r'\\(?:operatorname\*?|mathrm|mathit|mathbf|mathsf|textrm|text)\s*\{([^{}]*)\}', operator, text)
    text = re.sub(r'\{\s*\\(?:bf|rm|it)\s+([^{}]*)\}', operator, text)
    def font(match: re.Match[str]) -> str:
        contents=match.group(1)
        return ' '+contents+' ' if re.fullmatch(r'[A-Za-z\s]+', contents) else '('+contents+')'
    text = re.sub(r'\\(?:mathrm|mathit|mathbf|mathsf|textrm|text)\s*\{([^{}]*)\}', font, text)
    # Preserve names before the display layer removes unknown LaTeX commands.
    for name in FUNCTION_NAMES:
        canonical = FUNCTION_ALIASES.get(name, name)
        text = re.sub(
            r'\\' + name + r'(?![A-Za-z])',
            ' ' + canonical + ' ',
            text,
        )
        text = re.sub(
            r'\\' + name + r'(?=[xyztuvn](?![A-Za-z]))',
            ' ' + canonical + ' ',
            text,
        )
    return text


def expression_text(expression: sp.Expr) -> str:
    """A shared executable spelling for the browser and backend, not OCR prose."""
    text = str(expression).replace("**", "^")
    text = re.sub(r"\bE\b", "e", text)
    text = re.sub(r"\bAbs\(", "abs(", text)
    return re.sub(r"\blog\(", "ln(", text)


def _split_juxtaposition(text: str, *, followed_by_paren: bool = False) -> str:
    """拆开与函数名粘连的变量与参数，并用括号锁定紧邻的函数参数。"""

    if not any(name in text.lower() for name in FUNCTION_NAMES):
        return text
    lowered = text.lower()
    out: list[str] = []
    cursor = 0
    length = len(text)
    while cursor < length:
        hit = next((name for name in FUNCTION_NAMES if lowered.startswith(name, cursor)), None)
        if hit is not None:
            previous = out[-1] if out else ""
            if previous and (previous[-1].isalnum() or previous[-1] == ")"):
                out.append(" ")
            out.append(text[cursor : cursor + len(hit)])
            cursor += len(hit)
            if cursor == length:
                break
            nxt = min(
                (
                    idx
                    for idx in range(cursor, length)
                    if any(lowered.startswith(name, idx) for name in FUNCTION_NAMES)
                ),
                default=length,
            )
            if nxt > cursor:
                out.append(f"({text[cursor:nxt]})")
                cursor = nxt
            elif not followed_by_paren:
                inner = _split_juxtaposition(text[cursor:], followed_by_paren=False)
                out.append(f"({inner})")
                cursor = length
            else:
                out.append(" ")
            continue
        out.append(text[cursor])
        cursor += 1
    return "".join(out)


class ExprError(ValueError):
    """表达式不合法；坐标仅在能映射到 raw 时提供（Unicode 字符索引）。"""

    def __init__(self, message: str, *, raw: str | None = None,
                 start: int | None = None, end: int | None = None,
                 code: str | None = None):
        super().__init__(message)
        self.raw, self.start, self.end, self.code = raw, start, end, code


def _is_cjk(char: str) -> bool:
    return unicodedata.name(char, '').startswith(('CJK UNIFIED IDEOGRAPH', 'CJK COMPATIBILITY IDEOGRAPH'))


def _annotation_positions(raw: str) -> set[int]:
    """Exclude textual LaTeX groups and Chinese subscripts, not math operands."""
    positions = set()
    for match in re.finditer(r'\\(?:text|textrm|mathrm)\s*\{|_\s*\{', raw):
        group = _read_braced(raw, match.end() - 1)
        if group and (not match[0].startswith('_') or any(_is_cjk(c) for c in group[0])):
            positions.update(range(match.start(), group[1]))
    for match in re.finditer(r'_\s*([^\W\d_])', raw):
        if _is_cjk(match[1]):
            positions.update(range(match.start(), match.end()))
    return positions


def _raw_character_error(raw: str) -> ExprError | None:
    protected = _annotation_positions(raw)
    for index, char in enumerate(raw):
        if index in protected:
            continue
        if _is_cjk(char) or char in '@#$&?!;=\'"' or unicodedata.category(char) == 'So':
            return ExprError('表达式包含不允许的字符', raw=raw, start=index,
                             end=index + 1, code='illegal_character')
    return None


def _read_braced(text: str, start: int) -> tuple[str, int] | None:
    """读取从 ``start`` 开始的平衡花括号组；嵌套分式/上标需要按括号层级切分。"""

    if start >= len(text) or text[start] != "{":
        return None
    depth = 0
    for index in range(start, len(text)):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start + 1 : index], index + 1
    return None


def _replace_frac(text: str) -> str:
    """把 ``\\frac{...}{...}`` 展开成普通除法，支持嵌套分式。"""

    marker = "\\frac"
    while True:
        index = text.find(marker)
        if index < 0:
            return text
        cursor = index + len(marker)
        while cursor < len(text) and text[cursor].isspace():
            cursor += 1
        numerator = _read_braced(text, cursor)
        if numerator is None:
            return text
        num, cursor = numerator
        while cursor < len(text) and text[cursor].isspace():
            cursor += 1
        denominator = _read_braced(text, cursor)
        if denominator is None:
            return text
        den, end = denominator
        text = f"{text[:index]}(({num})/({den})){text[end:]}"


def _replace_sqrt(text: str) -> str:
    """把 ``\\sqrt{...}`` 展开成 ``sqrt(...)``。"""

    marker = "\\sqrt"
    while True:
        index = text.find(marker)
        if index < 0:
            return text
        cursor = index + len(marker)
        while cursor < len(text) and text[cursor].isspace():
            cursor += 1
        group = _read_braced(text, cursor)
        if group is None:
            return text
        content, end = group
        text = f"{text[:index]}sqrt({content}){text[end:]}"


def _replace_braced_power(text: str) -> str:
    """把 ``x^{2}`` 展开成 ``x**(2)``，支持指数里的嵌套括号。"""

    while True:
        match = re.search(r"\^\s*\{", text)
        if match is None:
            return text
        group = _read_braced(text, match.end() - 1)
        if group is None:
            return text
        content, end = group
        text = f"{text[:match.start()]}**({content}){text[end:]}"


def normalize_power_notation(raw: str, variables: Iterable[str] = ()) -> str:
    """Normalize superscripts and undeclared single-letter x2–x9 shorthand, not indexed variables."""
    if not isinstance(raw, str):
        raise ExprError("表达式必须是文本")
    names = set(variables)
    text = re.sub(
        r"(?<=[A-Za-z0-9)}\]])([⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)",
        lambda match: "^(" + match.group().translate(SUPERSCRIPTS) + ")",
        raw,
    )

    def compact_power(match: re.Match[str]) -> str:
        token = match.group()
        if token not in names and re.fullmatch(r"[A-Za-z][2-9]", token) and token[0] in names:
            return token[0] + "^" + token[1]
        return token

    return _IDENTIFIER.sub(compact_power, text)


def _latex_to_plain(raw: str) -> str:
    text = normalize_power_notation(normalize_function_notation(raw.strip()))
    text = text.replace("\u2212", "-").replace("\u00d7", "*").replace("\u00f7", "/")
    text = text.replace("\u00b7", "*").replace("\u03c0", "pi").replace("\u221a", "sqrt")
    for command in (
        "\\textstyle",
        "\\displaystyle",
        "\\scriptstyle",
        "\\left",
        "\\right",
        "\\!",
        "\\,",
        "\\;",
        "\\:",
        "\\quad",
        "\\qquad",
    ):
        text = text.replace(command, "")
    text = text.replace("\\mathrm{d}", "d").replace("\\mathrm", "")
    text = text.replace("\\cdot", "*").replace("\\times", "*").replace("\\div", "/")
    text = text.replace("\\pi", "pi")
    for name in (
        "arctan",
        "arcsin",
        "arccos",
        "arccot",
        "arcsec",
        "arccsc",
        "sin",
        "cos",
        "tan",
        "exp",
        "ln",
        "log",
        "sqrt",
        "abs",
        "tanh",
        "sinh",
        "cosh",
    ):
        text = text.replace("\\" + name, name)
    text = _replace_frac(text)
    text = _replace_sqrt(text)
    text = _replace_braced_power(text)
    text = text.replace("^", "**")
    # dx / dt 之类只保留被积变量，避免把 d 当作未知符号。
    text = re.sub(r"\bd\s*([xyzt])\b", r"\1", text)
    text = text.replace("{", "(").replace("}", ")")
    text = text.replace("[", "(").replace("]", ")")
    # 先锁定空格分隔的单参数函数调用（如 ln x -> ln(x)），再在相邻项间补隐式乘号，
    # 防止 "a sin(x)" 去空格后误拼成 "asin(x)" 或 "ln x * ln(1-x)" 吞掉乘数。
    fn_pattern = "|".join(FUNCTION_NAMES)
    text = re.sub(rf"({fn_pattern})\s+\(", r"\1(", text, flags=re.I)
    text = re.sub(
        rf"((?:[A-Za-z0-9_]*?)(?:{fn_pattern}))\s+([A-Za-z0-9]+)(?=$|[\s+\-*/^),])",
        lambda m: f"{m.group(1)}({m.group(2)})"
        if m.group(2).lower() not in FUNCTION_NAMES
        else f"{m.group(1)} {m.group(2)}",
        text,
        flags=re.I,
    )
    text = re.sub(
        r"([A-Za-z0-9_]+|\))\s+(?=[A-Za-z(])",
        lambda m: (
            m.group(0)
            if m.group(1) != ")"
            and any(m.group(1).lower().endswith(name) for name in FUNCTION_NAMES)
            else f"{m.group(1)}*"
        ),
        text,
    )
    text = text.replace(" ", "")
    # 希腊字母/花体命令无法安全求值，保留标记让调用方提问，而不是猜测。
    return text


def normalize_math(raw: str) -> str:
    """把常见 LaTeX/Unicode 写法整理成 sympy 可读的纯文本。"""

    if not isinstance(raw, str):
        raise ExprError("表达式必须是文本")
    text = _latex_to_plain(raw)
    if not text:
        raise ExprError("表达式为空")
    if len(text) > MAX_EXPR_CHARS:
        raise ExprError("表达式过长")
    return text


def _exact_value(expression: sp.Expr) -> Fraction | None:
    """在预算内求整数/有理常量子树的值；无法安全求值返回 None。"""

    if isinstance(expression, sp.Integer):
        value = int(expression)
        return Fraction(value) if abs(value) <= _MAX_EXACT_INT else None
    if isinstance(expression, sp.Rational):
        return Fraction(int(expression.p), int(expression.q))
    if isinstance(expression, sp.Add):
        total = Fraction(0)
        for argument in expression.args:
            item = _exact_value(argument)
            if item is None:
                return None
            total += item
            if abs(total) > _MAX_EXACT_INT:
                return None
        return total
    if isinstance(expression, sp.Mul):
        total = Fraction(1)
        for argument in expression.args:
            item = _exact_value(argument)
            if item is None:
                return None
            total *= item
            if abs(total) > _MAX_EXACT_INT:
                return None
        return total
    if isinstance(expression, sp.Pow):
        base = _exact_value(expression.base)
        exponent = _exact_value(expression.exp)
        if base is None or exponent is None or exponent.denominator != 1:
            return None
        power = int(exponent)
        if abs(power) > 64:
            return None
        value = base**power
        return value if abs(value) <= _MAX_EXACT_INT else None
    return None


def _check_work_budget(tree: sp.Expr) -> None:
    """求值前拒绝会指数级膨胀的语法树（幂塔、超大整数/指数、超大表达式）。"""

    nodes = 0
    for node in sp.preorder_traversal(tree):
        nodes += 1
        if nodes > MAX_EXPR_NODES:
            raise ExprError("表达式过于复杂")
        if isinstance(node, sp.Integer):
            if abs(int(node)).bit_length() > MAX_INT_LITERAL_BITS:
                raise ExprError("整数常数超出可计算范围")
        elif isinstance(node, sp.Pow) and node.exp.is_number:
            exponent = _exact_value(node.exp)
            if exponent is None or abs(exponent) > MAX_POWER_EXPONENT:
                raise ExprError("指数超出可计算范围")


def _strip_identity_factors(expression: sp.Expr) -> sp.Expr:
    """去掉未求值解析留下的字面 1 因子，不动其余书写结构。

    ``parse_expr(..., evaluate=False)`` 会保留 ``1/(x**2+1)`` 的书写结构，但把它表示成
    ``Mul(1, Pow(...))``，渲染成 LaTeX 时会多出一个孤立的 1。这里只删除作为恒等因子的
    字面 1，不做任何化简，因此 ``sqrt(x)**2`` 等结构仍保持原样。
    """

    if not expression.args:
        return expression
    args = [_strip_identity_factors(argument) for argument in expression.args]
    if isinstance(expression, sp.Mul):
        kept = [argument for argument in args if argument is not sp.S.One]
        if not kept:
            return sp.S.One
        if len(kept) == 1:
            return kept[0]
        args = kept
    try:
        return expression.func(*args, evaluate=False)
    except TypeError:
        return expression.func(*args)


def parse_expression(raw: str, variables: Iterable[str] = ("x",), *, preserve_structure: bool = False) -> sp.Expr:
    """解析并校验表达式；未知符号/函数一律拒绝。"""

    names = tuple(dict.fromkeys(str(item) for item in variables))
    if not names or any(not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name) for name in names):
        raise ExprError("变量名不合法")
    if isinstance(raw, str):
        diagnostic = _raw_character_error(raw)
        if diagnostic:
            raise diagnostic
    text = normalize_math(normalize_power_notation(raw, names))
    # Declared identifiers take precedence over OCR's implicit function notation.
    text = _IDENTIFIER.sub(
        lambda match: match.group()
        if match.group() in names
        else _split_juxtaposition(match.group(), followed_by_paren=text[match.end() : match.end() + 1] == "("),
        text,
    )
    allowed = set(names) | set(FUNCTIONS) | set(CONSTANTS)
    for match in _IDENTIFIER.finditer(text):
        token = match[0]
        if token not in allowed:
            # Never reuse offsets after length-changing LaTeX/power normalization.
            raise ExprError(f"包含暂不支持的符号：{token}", raw=raw,
                            start=match.start() if text == raw else None,
                            end=match.end() if text == raw else None, code='unknown_symbol')
    if any(bad in text for bad in ("=", ";", ":", "'", '"', "[", "]", "{", "}")):
        raise ExprError("表达式包含不允许的字符", raw=raw, code='illegal_character')
    local_dict: dict[str, object] = {name: sp.Symbol(name, real=True) for name in names}
    local_dict.update(FUNCTIONS)
    local_dict.update(CONSTANTS)
    try:
        unevaluated = parse_expr(
            text,
            local_dict=local_dict,
            transformations=TRANSFORMATIONS,
            evaluate=False,
        )
        _check_work_budget(unevaluated)
        expression = unevaluated if preserve_structure else unevaluated.doit()
        if preserve_structure:
            expression = _strip_identity_factors(expression)
        for integer in expression.atoms(sp.Integer):
            if abs(int(integer)).bit_length() > MAX_RESULT_INT_BITS:
                raise ExprError("计算结果超出可处理范围")
    except ExprError:
        raise
    except Exception as exc:  # noqa: BLE001 - 转成可展示的识别错误
        raise ExprError(f"无法解析表达式：{type(exc).__name__}", raw=raw, code='syntax_error') from exc
    if not isinstance(expression, sp.Expr):
        raise ExprError("解析结果不是数学表达式")
    symbols = {str(symbol) for symbol in expression.free_symbols}
    unexpected = symbols - set(names)
    if unexpected:
        raise ExprError(f"表达式包含未声明变量：{', '.join(sorted(unexpected))}")
    return expression


def to_latex(expression: object) -> str:
    try:
        return sp.latex(expression, ln_notation=True)
    except Exception:  # noqa: BLE001 - 展示层降级
        return str(expression)


def safe_float(value: object) -> float | None:
    """把 sympy 数值收敛为有限 float；复数/无穷返回 None。"""

    try:
        converted = complex(sp.N(value, 14))
    except Exception:  # noqa: BLE001
        return None
    if abs(converted.imag) > 1e-9:
        return None
    real = float(converted.real)
    if real != real or real in (float("inf"), float("-inf")):
        return None
    return real


def number_text(value: float | None, digits: int = 6) -> str:
    if value is None:
        return "—"
    if abs(value) < 1e-12:
        value = 0.0
    text = f"{value:.{digits}g}"
    return text


__all__ = [
    "ExprError",
    "FUNCTIONS",
    "normalize_math",
    "number_text",
    "parse_expression",
    "safe_float",
    "to_latex",
]

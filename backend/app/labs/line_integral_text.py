"""Parse simple second-kind plane line integrals from OCR text.

Only the common exam shape is accepted: a vector field P dx + Q dy along a
graph y=f(x) with two explicit endpoints. Anything less clear stays with the
normal AI/source-review path instead of guessing a parameterization.
"""
from __future__ import annotations

import re
from typing import Any, Mapping

import sympy as sp

from .expr import expression_text, parse_expression, to_latex

X, Y = sp.symbols('x y', real=True)
T = sp.Symbol('t', real=True)


def _plain(expression: str) -> str:
    text = expression.replace('（', '(').replace('）', ')').replace('²', '^2').replace('³', '^3')
    text = text.replace('·', '*').replace('×', '*').strip()
    text = re.sub(r'\b(ln|log|sin|cos|tan|exp|sqrt)\s+([A-Za-z0-9]+)', r'\1(\2)', text)
    text = re.sub(r'(\d)\s*([A-Za-z(])', r'\1*\2', text)
    return text


def _parse_xy(raw: str, label: str):
    expression = parse_expression(_plain(raw), ('x', 'y'))
    if {str(symbol) for symbol in expression.free_symbols} - {'x', 'y'}:
        raise ValueError(f'{label}只能含 x、y')
    return expression


def build_line_integral_from_text(text: str, source: Mapping[str, Any],
                                  overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if '曲线积分' not in text:
        return None
    compact = re.sub(r'\s+', '', text)
    if 'dx' not in compact.lower() or 'dy' not in compact.lower():
        return None
    # The differential form may keep the integral sign or lose it to OCR.
    start = max(text.rfind('曲线积分'), text.rfind('\n')) + 1
    segment = text[start:]
    segment = re.split(r'[=。；;]', segment, maxsplit=1)[0]
    segment = re.sub(r'^[^()A-Za-z0-9]*', '', segment)
    form = re.search(
        r'\((?P<p>[^()]*(?:\([^()]*\)[^()]*)*)\)\s*d\s*x\s*'
        r'(?P<sign>[+-])\s*\((?P<q>[^()]*(?:\([^()]*\)[^()]*)*)\)\s*d\s*y',
        segment, re.I,
    )
    if not form:
        return None
    p_raw = _plain(form.group('p'))
    q_raw = _plain(form.group('q'))
    if form.group('sign') == '-':
        q_raw = f'-({q_raw})'
    try:
        p_expr = _parse_xy(p_raw, 'P')
        q_expr = _parse_xy(q_raw, 'Q')
    except Exception:
        return None
    curve = re.search(r'y\s*=\s*([^\n，,。；;]+?)(?=\s*(?:从|上|在|的|，|,|。|；|;|$))', text)
    if not curve:
        return None
    curve_raw = _plain(curve.group(1))
    try:
        curve_expr = parse_expression(curve_raw, ('x',), preserve_structure=True)
    except Exception:
        return None
    if curve_expr.has(Y):
        return None
    points = re.search(
        r'从\s*(?:点)?\s*\(\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*\)'
        r'\s*(?:到|至)\s*(?:点)?\s*\(\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*\)',
        text,
    )
    if not points:
        return None
    x0, y0, x1, y1 = (float(points.group(i)) for i in range(1, 5))
    for x_value, y_value in ((x0, y0), (x1, y1)):
        if abs(float(curve_expr.subs(X, x_value)) - y_value) > 1e-8:
            return None
    if x0 == x1:
        return None
    lower, upper = sorted((x0, x1))
    orientation = 'forward' if x0 < x1 else 'reverse'
    curve_t = curve_expr.subs(X, T)
    bounds = [str(int(value)) if float(value).is_integer() else str(value)
              for value in (lower, upper)]
    model_conditions = {
        'curve': ['t', expression_text(curve_t), '0'],
        't_bounds': bounds,
        'kind': 'vector',
        'field': [expression_text(p_expr), expression_text(q_expr), '0'],
        'orientation': orientation,
    }
    from .exam_math import _condition
    conditions = [
        _condition('field_p', 'P(x,y)', expression_text(p_expr), source, kind='expr'),
        _condition('field_q', 'Q(x,y)', expression_text(q_expr), source, kind='expr'),
        _condition('curve', '积分曲线', f'y={expression_text(curve_expr)}', source, kind='text'),
        _condition('t_bounds', '参数区间', f'{lower} 到 {upper}', source, kind='text'),
        _condition('orientation', '沿曲线方向', '正向' if orientation == 'forward' else '反向', source, kind='text'),
    ]
    model = {
        'engine': 'line_integral_v1', 'subject': 'calculus', 'task': 'line_integral',
        'kind': 'line_integral', 'conditions': model_conditions,
        'defaults': {}, 'params': [], 'teaching': False,
        'formula_tex': (
            rf'\int_L ({to_latex(p_expr)}\,\mathrm{{d}}x+{to_latex(q_expr)}\,\mathrm{{d}}y)'
            rf',\quad L:y={to_latex(curve_expr)}'
        ),
    }
    return {
        'model': model, 'conditions': conditions,
        'formulas': [{'id': 'line_integral', 'tex': model['formula_tex'],
                      'plain': f'P={expression_text(p_expr)}, Q={expression_text(q_expr)}',
                      'role': '识别出的曲线积分'}],
        'recognized': True, 'ambiguities': [],
    }

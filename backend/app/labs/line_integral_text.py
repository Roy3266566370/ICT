"""Parse simple second-kind plane line integrals from OCR text.

Only the common exam shape is accepted: a vector field P dx + Q dy along a
graph y=f(x) with two explicit endpoints. Once P dx + Q dy is recognized,
invalid or incomplete conditions stay blocked instead of falling through.
"""
from __future__ import annotations

import math
import re
from typing import Any, Mapping

import sympy as sp

from .expr import expression_text, parse_expression, to_latex

X, Y = sp.symbols('x y', real=True)
T = sp.Symbol('t', real=True)


def _plain(expression: str) -> str:
    text = expression.replace('（', '(').replace('）', ')').replace('²', '^2').replace('³', '^3')
    text = text.replace('~', '^').replace('·', '*').replace('×', '*').strip()
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
    # OCR 的全角括号与幂号误读统一归一后再匹配。
    scan = text.replace('（', '(').replace('）', ')').replace('~', '^')
    # 微分式位于“曲线积分”之后、“其中/标点”之前——不能按最后换行截取（选项行会顶替）。
    seg_match = re.search(r'曲线积分\s*(.+?)(?=其中|，|,|。|；|;|\n|$)', scan)
    segment = seg_match.group(1) if seg_match else ''
    segment = re.split(r'[=。；;]', segment, maxsplit=1)[0]
    segment = re.sub(r'^[^()A-Za-z0-9]*', '', segment)
    # P/Q 可以带括号也可以不带（`x dy - y dx`），且 dx、dy 次序不限。
    _TERM = r'(?:\([^()]*(?:\([^()]*\)[^()]*)*\)|[A-Za-z0-9.+*/^\-]+?)'
    form = re.search(
        rf'(?P<first>{_TERM})\s*d\s*(?P<v1>[xy])\s*'
        rf'(?P<sign>[+-])\s*(?P<second>{_TERM})\s*d\s*(?P<v2>[xy])',
        segment, re.I,
    )
    if not form or form.group('v1').lower() == form.group('v2').lower():
        return None
    first_raw = _plain(form.group('first'))
    second_raw = _plain(form.group('second'))
    if form.group('sign') == '-':
        second_raw = f'-({second_raw})'
    if form.group('v1').lower() == 'x':
        p_raw, q_raw = first_raw, second_raw
    else:
        p_raw, q_raw = second_raw, first_raw
    # Preserve curve and endpoints even when field parsing fails.
    curve = re.search(r'y\s*=\s*([^\n，,。；;]+?)(?=\s*(?:从|上|在|的|，|,|。|；|;|$))', scan)
    curve_raw = _plain(curve.group(1)) if curve else None
    points = re.search(
        r'从\s*(?:点)?\s*\(\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*\)'
        r'\s*(?:到|至)\s*(?:点)?\s*\(\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*\)',
        scan,
    )
    raw_conditions = {
        'field': [p_raw, q_raw, '0'],
        'curve': curve_raw,
        'source_text': text,
        'endpoints': [[points.group(1), points.group(2)],
                      [points.group(3), points.group(4)]] if points else None,
    }

    def blocked(reason: str) -> dict[str, Any]:
        from .kernel_models import blocked_recognized_problem
        return blocked_recognized_problem(
            'line_integral', raw_conditions,
            f'已识别为曲线积分，但{reason}。请核对或修正原题。',
        )

    try:
        p_expr = _parse_xy(p_raw, 'P')
        q_expr = _parse_xy(q_raw, 'Q')
    except Exception as exc:
        return blocked(f'向量场 P/Q 无法解析：{exc}')
    if not curve:
        return blocked('缺少可识别的曲线 y=f(x)')
    try:
        curve_expr = parse_expression(curve_raw, ('x',), preserve_structure=True)
    except Exception as exc:
        return blocked(f'曲线表达式无法解析：{exc}')
    if curve_expr.has(Y):
        return blocked('曲线 y=f(x) 的右侧不能含 y')
    if not points:
        return blocked('缺少明确的起点和终点，暂不支持仅用区间和方向描述曲线')
    try:
        x0, y0, x1, y1 = (float(points.group(i)) for i in range(1, 5))
        if not all(math.isfinite(value) for value in (x0, y0, x1, y1)):
            return blocked('端点坐标必须是有限实数')
        for x_value, y_value in ((x0, y0), (x1, y1)):
            curve_value = float(curve_expr.subs(X, x_value))
            if not math.isfinite(curve_value):
                return blocked('曲线在端点处的值不是有限实数')
            if abs(curve_value - y_value) > 1e-8:
                return blocked('端点不在给定曲线上')
    except Exception as exc:
        return blocked(f'端点代入曲线无法得到有限实数：{exc}')
    if x0 == x1:
        return blocked('起点和终点的 x 坐标相同，无法确定非退化参数区间')
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

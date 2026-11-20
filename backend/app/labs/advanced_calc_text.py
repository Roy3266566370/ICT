"""高数进阶题型的文本识别：只把边界明确、内核可核验的形式接进结构化内核。

覆盖：长方体三重积分、变限积分求导、二元偏导/梯度/全微分、
单等式约束极值、点法式平面。未匹配时返回 None；已提取的条件被内核拒绝时阻塞。
"""
from __future__ import annotations

import re
from typing import Any, Mapping


from .kernel_models import blocked_recognized_problem


def _compile(task: str, conditions: dict) -> dict:
    from .kernel_models import build_recognized_problem, compile_kernel_problem

    problem = build_recognized_problem(
        task, conditions, lambda values: compile_kernel_problem({'task': task, 'conditions': values}))
    recognition = problem.get('recognition') or {}
    return {
        'model': problem['model'],
        'conditions': list(recognition.get('conditions') or problem.get('conditions') or []),
        'formulas': list(problem.get('formulas') or []),
        'recognized': True,
        'ambiguities': list(recognition.get('ambiguities') or problem.get('ambiguities') or []),
    }


def _bounds_xyz(text: str) -> dict[str, list[str]] | None:
    """`0≤x≤1` 型常数界；OCR 丢变量名的按 x→y→z 顺序补位，变量名大小写不敏感。"""
    bounds: dict[str, list[str]] = {}
    unlabeled = []
    for match in re.finditer(
            r'([-+]?\d+(?:\.\d+)?)\s*[<≤]=?\s*([xyzXYZ]?)\s*[<≤]=?\s*([-+]?\d+(?:\.\d+)?)', text):
        var = match.group(2)
        if var:
            bounds[var.lower()] = [match.group(1), match.group(3)]
        else:
            unlabeled.append([match.group(1), match.group(3)])
    for var in 'xyz':
        if var not in bounds and unlabeled:
            bounds[var] = unlabeled.pop(0)
    return bounds


def _triple_integrand(text: str) -> str | None:
    text = re.sub(r'd\s*x\s*d\s*y\s*d\s*z|dxdydz', ' dV ', text, flags=re.I)
    integrand = re.search(
        r'[∭口]\s*[_^]?\s*[A-Za-zΩ_]{0,3}\s*(.+?)\s*d\s*(?:[xyz]\s*d\s*[xyz]\s*d\s*[xyz]|V|v)',
        text, flags=re.I | re.S,
    )
    if not integrand:
        return None
    raw = integrand.group(1).strip()
    raw = re.sub(r'([0-9])([xyz])', r'\1*\2', raw)
    raw = re.sub(r'([xyz])([xyz])', r'\1*\2', raw)
    return raw


def _triple_with_region(text: str, region: dict | None) -> dict | None:
    integrand = _triple_integrand(text)
    if integrand is None or region is None:
        return None
    return _compile('triple_integral', {
        'integrand': integrand or '1', 'region': region})


def _triple_spherical(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`三重积分` + `球体/球面 x^2+y^2+z^2[=≤]R^2` → spherical。"""
    if '∭' not in text and '三重积分' not in text:
        return None
    if not re.search(r'球', text):
        return None
    sphere = re.search(r'x\s*[~^]\s*2\s*\+\s*y\s*[~^]\s*2\s*\+\s*z\s*[~^]\s*2\s*[=<≤]=?\s*(\d+(?:\.\d+)?)', text)
    if not sphere:
        return None
    remaining = text[:sphere.start()] + text[sphere.end():]
    if re.search(r'[<>≤≥]|[xyz]\s*=|半球|卦限|截', remaining):
        return blocked_recognized_problem('triple_integral', {
            'integrand': _triple_integrand(text), 'source_text': text,
        }, '球域还有附加约束，当前识别器未完整建立截取区域，不能按整球求积。')
    a = sphere.group(1)
    radius = '1' if a == '1' else f'sqrt({a})'
    return _triple_with_region(text, {
        'kind': 'spherical', 'theta': ['0', '2*pi'], 'phi': ['0', 'pi'], 'rho': ['0', radius]})


def _triple_cylindrical(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`三重积分` + `圆柱面 x^2+y^2=a`/`柱面` + `z=0,z=h` → cylindrical。"""
    if ('∭' not in text and '三重积分' not in text
            or not re.search(r'柱面|柱坐标|x\s*[~^]\s*2\s*\+\s*y\s*[~^]\s*2', text)):
        return None
    cyl = re.search(r'x\s*[~^]\s*2\s*\+\s*y\s*[~^]\s*2\s*[=<≤]=?\s*(\d+(?:\.\d+)?)', text)
    if not cyl:
        return None
    radius = f'sqrt({cyl.group(1)})' if cyl.group(1) != '1' else '1'
    z_match = (re.search(r'([-+]?\d+(?:\.\d+)?)\s*[<≤]=?\s*z\s*[<≤]=?\s*([-+]?\d+(?:\.\d+)?)', text)
               or re.search(r'z\s*=\s*([-+]?\d+(?:\.\d+)?)\s*[,，、和与]+\s*z\s*=\s*([-+]?\d+(?:\.\d+)?)', text))
    if not z_match:
        return None
    return _triple_with_region(text, {
        'kind': 'cylindrical', 'theta': ['0', '2*pi'],
        'r': ['0', radius], 'z': [z_match.group(1), z_match.group(2)]})


def _triple_box(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`∭`/`三重积分` + 三个常数边界 `0<=x<=1` → kernel triple_integral box。"""
    if '∭' not in text and '三重积分' not in text:
        return None
    bounds = _bounds_xyz(text) or {}
    if len(bounds) < 3:
        return None
    return _triple_with_region(text, {'kind': 'box', **bounds})


def _surface_graph(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`曲面积分∬_Σ f dS，Σ 为 z=z(x,y)` + 矩形界 → surface_integral graph scalar。"""
    if not re.search(r'曲面积分|∬|∫∫|口', text) or not re.search(r'd\s*S', text):
        return None
    surface = re.search(r'(?:Σ|∑|E)\s*(?:为|是|[:：])?\s*(?:平面|曲面)?\s*z\s*=\s*([^，,。；;\n]+?)(?=\s*(?:在|上|的|，|,|。|；|;|$))', text)
    if not surface:
        return None
    bounds = _bounds_xyz(text) or {}
    if 'x' not in bounds or 'y' not in bounds:
        return None
    body = re.search(r'(?:∬|∫∫|口)\s*[_^]?\s*[Σ∑E]?\s*(.+?)\s*d\s*S', text, flags=re.I | re.S)
    if not body:
        return None
    raw = body.group(1).strip()
    raw = re.sub(r'([0-9])([xyz])', r'\1*\2', raw)
    raw = re.sub(r'([xyz])([xyz])', r'\1*\2', raw)
    return _compile('surface_integral', {
        'surface_mode': 'graph', 'surface_z': surface.group(1).strip().replace('~', '^'),
        'region': {'x': bounds['x'], 'y': bounds['y']},
        'kind': 'scalar', 'field': raw,
    })


_TERM = r'(?:\([^()]*(?:\([^()]*\)[^()]*)*\)|[A-Za-z0-9.+*/^~×\-]+?)'


def _clean_term(raw: str) -> str:
    """场分量归一：× 独占一项时是 x 的 OCR 形，否则是乘号。"""
    text = raw.strip().replace('~', '^')
    if text == '×':
        return 'x'
    text = text.replace('×', '*')
    text = re.sub(r'([0-9])([xyz])', r'\1*\2', text)
    text = re.sub(r'([xyz])([xyz])', r'\1*\2', text)
    return text


def _green(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`格林公式`/`∮_L` + `P dx + Q dy` + 圆域 → kernel green。"""
    if not re.search(r'格林|Green|∮', text, flags=re.I):
        return None
    scan = text.replace('（', '(').replace('）', ')')
    match = re.search(
        rf'([+-]?)\s*({_TERM})\s*d\s*x\s*([+-])\s*({_TERM})\s*d\s*y(?!\s*[+-]?\s*{_TERM}\s*d)',
        scan, flags=re.I,
    )
    if not match:
        return None
    field = []
    for index in (2, 4):
        raw = _clean_term(match.group(index))
        field.append(raw if match.group(index - 1) != '-' else f'-({raw})')
    circle = re.search(r'x\s*[~^]\s*2\s*\+\s*y\s*[~^]\s*2\s*=\s*(\d+(?:\.\d+)?)', text)
    ellipse = re.search(
        r'x\s*[~^]\s*2\s*/\s*(\d+(?:\.\d+)?)\s*\+\s*y\s*[~^]\s*2\s*(?:/\s*(\d+(?:\.\d+)?))?\s*=\s*1', text)
    if not circle and not ellipse:
        bounds = _bounds_xyz(text) or {}
        if 'x' not in bounds or 'y' not in bounds:
            return None
        region = {'x': bounds['x'], 'y': bounds['y']}
    elif ellipse:
        a2, b2 = ellipse.group(1), ellipse.group(2) or '1'
        a = '1' if a2 == '1' else f'sqrt({a2})'
        half = (f'sqrt({b2}*(1-x^2/{a2}))' if b2 != '1'
                else f'sqrt(1-x^2/{a2})' if a2 != '1' else 'sqrt(1-x^2)')
        region = {'x': [f'-{a}' if a != '1' else '-1', a], 'y': [f'-{half}', half]}
    else:
        a = circle.group(1)
        radius = '1' if a == '1' else f'sqrt({a})'
        half = f'sqrt({a}-x^2)' if a != '1' else 'sqrt(1-x^2)'
        region = {'x': [f'-{radius}' if radius != '1' else '-1', radius],
                  'y': [f'-{half}', half]}
    orientation = 'negative' if re.search(r'顺时针|负向', text) else 'positive'
    return _compile('green', {'field': field, 'region': region, 'orientation': orientation})


def _gauss(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`高斯公式`/`∯_Σ` + `P dy dz+Q dz dx+R dx dy` + box 界 → kernel gauss。"""
    if not re.search(r'高斯|Gauss|∯|奥高', text, flags=re.I):
        return None
    # 三元通量形式：`P dy dz + Q dz dx + R dx dy`
    scan = text.replace('（', '(').replace('）', ')')
    match = re.search(
        rf'([+-]?)\s*({_TERM})\s*d\s*y\s*d\s*z\s*([+-])\s*({_TERM})\s*d\s*z\s*d\s*x\s*([+-])\s*({_TERM})\s*d\s*x\s*d\s*y',
        scan, flags=re.I,
    )
    if not match:
        return None
    field = []
    for index in (2, 4, 6):
        raw = _clean_term(match.group(index))
        field.append(raw if match.group(index - 1) != '-' else f'-({raw})')
    bounds = _bounds_xyz(text) or {}
    if len(bounds) < 3:
        return None
    return _compile('gauss', {'field': field, 'region': {'kind': 'box', **bounds}})


def _stokes(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`斯托克斯` + `P dx+Q dy+R dz` + `平面 z=c` + 矩形界 → kernel stokes。"""
    if not re.search(r'斯托克斯|Stokes|∮', text, flags=re.I):
        return None
    scan = text.replace('（', '(').replace('）', ')')
    match = re.search(
        rf'([+-]?)\s*({_TERM})\s*d\s*x\s*([+-])\s*({_TERM})\s*d\s*y\s*([+-])\s*({_TERM})\s*d\s*z',
        scan, flags=re.I,
    )
    if not match:
        return None
    field = []
    for index in (2, 4, 6):
        raw = _clean_term(match.group(index))
        field.append(raw if match.group(index - 1) != '-' else f'-({raw})')
    surface = re.search(r'平面\s*z\s*=\s*([-+]?\d+(?:\.\d+)?)', text)
    if not surface:
        return None
    bounds = _bounds_xyz(text) or {}
    if 'x' not in bounds or 'y' not in bounds:
        return None
    orientation = 'down' if re.search(r'下侧|负向|顺时针', text) else 'up'
    return _compile('stokes', {
        'field': field, 'surface_z': surface.group(1),
        'region': {'x': bounds['x'], 'y': bounds['y']}, 'orientation': orientation,
    })


def _directional(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`z=f(x,y) 在点(a,b) 沿方向(u,v) 的方向导数` → multivariable directional。"""
    if '方向导数' not in text:
        return None
    expr = re.search(r'[zf]\s*(?:\(\s*x\s*,\s*y\s*\))?\s*=\s*([^，,。；;\n]+?)\s*(?:[,，。；;\n]|在|$)', text)
    if not expr:
        return None
    point = re.search(r'在\s*点?\s*[（(]\s*([-+0-9.,，\s]+)\s*[）)]', text)
    direction = re.search(r'沿\s*(?:方向|向量)?\s*[A-Za-z]?\s*[=＝]?\s*[（(]?\s*([-+0-9.,，\s]+)\s*[）)]?', text)
    if not point or not direction:
        return None
    raw = expr.group(1).strip()
    raw = re.sub(r'([0-9])([xyz])', r'\1*\2', raw)
    raw = re.sub(r'([xyz])([xyz])', r'\1*\2', raw)
    return _compile('multivariable', {
        'expression': raw, 'operation': 'directional', 'variables': 'x,y',
        'point': point.group(1).replace('，', ','),
        'direction': direction.group(1).replace('，', ','),
        'direction_limit': 'forward',
    })



def _surface_flux(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`曲面积分∬_Σ P dy dz+Q dz dx+R dx dy，Σ:z=φ(x,y) 上/下侧` → surface_integral flux。"""
    if not re.search(r'曲面积分|通量|∬|∫∫|口', text):
        return None
    scan = text.replace('（', '(').replace('）', ')')
    match = re.search(
        rf'([+-]?)\s*({_TERM})\s*d\s*y\s*d\s*z\s*([+-])\s*({_TERM})\s*d\s*z\s*d\s*x\s*([+-])\s*({_TERM})\s*d\s*x\s*d\s*y',
        scan, flags=re.I,
    )
    if not match:
        return None
    surface = re.search(r'(?:Σ|∑|E)\s*(?:为|是|[:：])?\s*(?:平面|曲面|部分)?\s*z\s*=\s*([^，,。；;\n]+?)(?=\s*(?:在|上|的|，|,|。|；|;|$))', text)
    if not surface:
        return None
    bounds = _bounds_xyz(text) or {}
    if 'x' not in bounds or 'y' not in bounds:
        return None
    field = []
    for index in (2, 4, 6):
        raw = _clean_term(match.group(index))
        field.append(raw if match.group(index - 1) != '-' else f'-({raw})')
    orientation = 'down' if re.search(r'下侧|负向', text) else 'up'
    return _compile('surface_integral', {
        'surface_mode': 'graph', 'surface_z': surface.group(1).strip().replace('~', '^'),
        'region': {'x': bounds['x'], 'y': bounds['y']},
        'kind': 'flux', 'field': field, 'orientation': orientation,
    })


def _normalize_angle(raw: str) -> str:
    value = raw.strip().replace('π', 'pi').replace('~', '^')
    value = re.sub(r'^([+-]?)\s*/', r'\1pi/', value)
    value = re.sub(r'(\d)(pi)', r'\1*\2', value)
    return value


def _interval_bounds(text: str, var: str) -> list[str] | None:
    """`[a,b]`、`a≤x≤b`/`x∈[a,b]` 区间提取；端点可为数或含 pi 的表达式。"""
    endpoint = r'([-+]?\d*(?:\.\d+)?\s*(?:pi|π)?(?:\s*[/×*^+-]\s*[-+]?\d*(?:\.\d+)?\s*(?:pi|π)?)*)'
    bracket = re.search(rf'[(\[{{]?\s*{endpoint}\s*[,，]\s*{endpoint}\s*[\])}}]?', text)
    chained = re.search(rf'{endpoint}\s*[<≤]=?\s*{var}\s*[<≤]=?\s*{endpoint}', text)
    belongs = re.search(rf'{var}\s*∈\s*[\[（(]?\s*{endpoint}\s*[,，]\s*{endpoint}\s*[\]）)]?', text)
    def _valid(raw: str) -> bool:
        return bool(re.search(r'\d|pi|π', raw))
    for match in (belongs, chained):
        if match and _valid(match.group(1)) and _valid(match.group(2)):
            return [_normalize_angle(match.group(1)), _normalize_angle(match.group(2))]
    if bracket and _valid(bracket.group(1)) and _valid(bracket.group(2)):
        return [_normalize_angle(bracket.group(1)), _normalize_angle(bracket.group(2))]
    return None


def _parametric_pair(text: str) -> tuple[str, str] | None:
    """`x=φ(t),y=ψ(t)` → (x_expr, y_expr)；只接含参数 t 的形式。"""
    x_match = re.search(r'(?<![A-Za-z0-9_])x\s*=\s*([^，,。；;\n]+?)\s*(?:[,，。；;\n]|(?=[一-鿿])|$)', text)
    y_match = re.search(r'(?<![A-Za-z0-9_])y\s*=\s*([^，,。；;\n]+?)\s*(?:[,，。；;\n]|(?=[一-鿿])|$)', text)
    if not x_match or not y_match:
        return None
    x_expr, y_expr = x_match.group(1).strip().replace('~', '^'), y_match.group(1).strip().replace('~', '^')
    if 't' not in (x_expr + y_expr):
        return None
    func = r'sin|cos|tan|sec|csc|cot|exp|ln|log'
    for target in ('x_expr', 'y_expr'):
        value = locals()[target]
        # OCR/排版常把 sin t 黏成 sint：分两条互斥规则——`sin t`（空白分隔）与
        # `sint`（直接黏连，且后面不是 `(`，避免破坏已带括号的 sin(t)）。
        value = re.sub(rf'({func})\s+([a-zA-Z])(?!\()', r'\1(\2)', value)
        value = re.sub(rf'(?<![a-zA-Z])({func})(?=[a-zA-Z])([a-zA-Z])\b', r'\1(\2)', value)
        value = re.sub(r'(\d)(t)', r'\1*\2', value)
        value = re.sub(r't(\d+)', r't^\1', value)
        if target == 'x_expr':
            x_expr = value
        else:
            y_expr = value
    return x_expr, y_expr


def _parametric_derivative(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`x=φ(t),y=ψ(t)` + `dy/dx`(或二阶) + `t=t0` → parametric_derivative。"""
    if not re.search(r'd\s*(?:²|\^?\s*2)?\s*y\s*/\s*d\s*x|参数方程.*(?:求导|导数)', text):
        return None
    pair = _parametric_pair(text)
    if not pair:
        return None
    order = 2 if re.search(r'd\s*(?:²|\^?\s*2)\s*y\s*/\s*d\s*x|二阶', text) else 1
    point = re.search(r'(?<![A-Za-z0-9_])t\s*=\s*([^，,。；;\n\u4e00-\u9fff]+)', text)
    if not point:
        return blocked_recognized_problem('parametric_derivative',
                        {'x_expression': pair[0], 'y_expression': pair[1], 'order': order},
                        '已识别为参数方程求导并提取了 x(t)、y(t)，但缺少研究点 t=t0。'
                        '请补充求值点（如 t=π/2）。')
    conditions = {
        'x_expression': pair[0], 'y_expression': pair[1],
        'point': _normalize_angle(point.group(1)), 'order': order,
    }
    return _compile('parametric_derivative', conditions)


def _arc_length(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`y=f(x)在[a,b]上的弧长`（显式或参数式）→ arc_length/parametric_arc_length。"""
    if '弧长' not in text:
        return None
    pair = _parametric_pair(text)
    if pair:
        bounds = _interval_bounds(text, 't')
        if not bounds:
            return blocked_recognized_problem('parametric_arc_length', {
                'x_expression': pair[0], 'y_expression': pair[1], 'source_text': text,
            }, '已识别参数曲线，但缺少完整弧段范围，请补充参数区间。')
        return _compile('parametric_arc_length', {
            'x_expression': pair[0], 'y_expression': pair[1],
            'lower': bounds[0], 'upper': bounds[1]})
    expr = re.search(r'y\s*=\s*([^，,。；;\n]+?)\s*(?:[,，。；;\n]|在|$)', text)
    if not expr:
        return None
    bounds = _interval_bounds(text, 'x')
    if not bounds:
        return blocked_recognized_problem('arc_length', {'expression': expr.group(1).strip(), 'source_text': text},
            '已识别弧长请求，但缺少区间端点，不以默认求导点代替弧段。')
    return _compile('arc_length', {
        'expression': expr.group(1).strip().replace('~', '^'),
        'lower': bounds[0], 'upper': bounds[1]})


def _curvature(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`y=f(x)在点(a,·)处的曲率` → curvature。"""
    if '曲率' not in text:
        return None
    expr = re.search(r'y\s*=\s*([^，,。；;\n]+?)\s*(?:[,，。；;\n]|在|$)', text)
    if not expr:
        return None
    point = re.search(r'[（(]\s*([-+]?\d+(?:\.\d+)?)\s*[,，]', text) or re.search(r'x\s*=\s*([-+]?\d+(?:\.\d+)?)', text)
    if not point:
        return None
    return _compile('curvature', {
        'expression': expr.group(1).strip().replace('~', '^'), 'point': point.group(1)})


def _polar_area(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`r=r(θ)`/`ρ=ρ(θ)` + `θ∈[α,β]` + `面积` → polar_area；
    心形线/闭合曲线无显式界时按约定区间 [0,2π]。"""
    if '面积' not in text and '围成' not in text and '围' not in text:
        return None
    expr = re.search(r'[rρ]\s*=\s*([^，,。；;\n]+?)\s*(?:[,，。；;\n]|所|(?=[一-鿿])|$)', text)
    if not expr or not re.search(r'θ|theta|极坐标|极径|心形线|心脏线|玫瑰线', text):
        return None
    if re.search(r'(?<![A-Za-z])T(?=\s*[/×])', text):
        return blocked_recognized_problem('polar_area', {'expression': expr.group(1), 'source_text': text},
            '区间中出现 T，无法确认是参数还是 π 的误读；请对照原图修正端点，不自动替换。')
    bounds_text = re.sub(r'([θρ]|theta)\s*E\s*(?=[\[（(])', r'\1∈', text)
    bounds = _interval_bounds(bounds_text, 'θ') or _interval_bounds(bounds_text, 'theta')
    if not bounds:
        if re.search(r'心形线|心脏线', text):
            # 心形线 r=a(1±cosθ)/r=a(1±sinθ) 在 [0,2π] 上完整描绘一次——教材约定区间。
            bounds = ['0', '2*pi']
        else:
            return None
    raw = expr.group(1).strip().replace('~', '^').replace('θ', 'theta')
    raw = re.sub(r'(sin|cos|tan)0\b', r'\1(theta)', raw)
    raw = re.sub(r'(?<![a-zA-Z])(sin|cos|tan)(\d+\s*theta)', r'\1(\2)', raw)
    raw = re.sub(r'(?<![a-zA-Z])(sin|cos|tan)(theta)\b', r'\1(\2)', raw)
    raw = re.sub(r'(\d)([a-zA-Z(])', r'\1*\2', raw)
    return _compile('polar_area', {
        'expression': raw, 'lower': bounds[0], 'upper': bounds[1]})


def _asymptote(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`y=f(x)的渐近线` → asymptote（内核只收有理函数，其余返回 None 走后续链路）。"""
    if '渐近线' not in text or re.search(r'单调|凹凸|拐点|极值', text):
        return None
    expr = re.search(r'y\s*=\s*([^，,。；;\n]+?)\s*(?:[,，。；;\n]|的|$)', text)
    if not expr:
        return None
    raw = expr.group(1).strip().replace('~', '^')
    raw = re.sub(r'([0-9])([a-zA-Z(])', r'\1*\2', raw)
    return _compile('asymptote', {'expression': raw})


_ORDER_WORDS = {'一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
                '六': 6, '七': 7, '八': 8, '九': 9, '十': 10}


def _higher_derivative(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`y=f(x)` + `n阶导数`/`y^{(n)}`/`y'''` → higher_derivative。"""
    order = None
    match = re.search(r'([一二两三四五六七八九十]|\d+)\s*阶\s*(?:导数|导)', text)
    if match:
        token = match.group(1)
        order = _ORDER_WORDS.get(token) or int(token)
    else:
        match = re.search(r"[yfz]\s*(?:\^\s*\{?\s*\(\s*(\d+)\s*\)?\}?|('{2,10}))", text)
        if match:
            order = int(match.group(1)) if match.group(1) else len(match.group(2))
    if not order or order < 2:
        return None
    expr = re.search(r'[yf]\s*(?:\(\s*x\s*\))?\s*=\s*([^，,。；;\n]+?)\s*(?:[,，。；;\n]|求|的|$)', text)
    if not expr:
        return None
    raw = expr.group(1).strip().replace('~', '^')
    raw = re.sub(r'([0-9])([a-zA-Z(])', r'\1*\2', raw)
    conditions = {'expression': raw, 'variable': 'x', 'order': order}
    point = re.search(r'x\s*=\s*([-+]?\d+(?:\.\d+)?)', text) or re.search(r'在\s*点?\s*x?\s*[=（(]?\s*([-+]?\d+(?:\.\d+)?)', text)
    if point:
        conditions['point'] = point.group(1)
    return _compile('higher_derivative', conditions)


def _implicit_normal(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`曲线 F(x,y)=C 在点(a,b)处的法线` → kernel implicit_normal（坐标对直接给两分量）。"""
    if '法线' not in text:
        return None
    relation = (re.search(r'曲线\s*([^，,。；;\n]*=[^，,。；;\n]*?)(?=\s*(?:在|的|求|，|,|。|；|;|$))', text)
                or re.search(r'方程\s*([^，,。；;\n]*=[^，,。；;\n]*?)(?=\s*(?:在|的|求|，|,|。|；|;|$))', text))
    if not relation:
        return None
    point = re.search(r'[（(]\s*([-+0-9.,，\sa-zA-Z()√V/^~]+)\s*[）)]\s*处?', text)
    if not point:
        return None
    coords = [item.strip() for item in re.split(r'[,，]', point.group(1)) if item.strip()]
    if len(coords) < 2:
        return None
    expression = relation.group(1).strip().replace('~', '^').replace('√', 'sqrt')
    coords = [re.sub(r'√\s*(\d+)', r'sqrt(\1)', re.sub(r'V\s*(\d+)', r'sqrt(\1)', c.replace('~', '^')))
              for c in coords]
    return _compile('implicit_normal', {
        'implicit_expression': expression, 'point_x': coords[0], 'point_y': coords[1]})


def _integral_function(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`F(x)=∫_a^b f(t)dt，求F'(x)` → kernel integral_function（Leibniz 法则）。"""
    match = re.search(
        r'F\s*\(\s*([A-Za-z])\s*\)\s*=\s*∫\s*_'
        r'\s*(?:\{([^{}]+)\}|([^\s{}^]+))'
        r'\s*\^\s*(?:\{([^{}]+)\}|([^\s{}^]+))'
        r'\s*(.+?)\s*d\s*([A-Za-z])(?![A-Za-z])',
        text, flags=re.I | re.S,
    )
    if not match or 'F' not in text:
        return None
    free_var = match.group(1)
    lower = match.group(2) or match.group(3)
    upper = match.group(4) or match.group(5)
    integrand, int_var = match.group(6), match.group(7)
    lower, upper = lower.replace('~', '^'), upper.replace('~', '^')
    integrand = integrand.replace('~', '^')
    if not re.search(r"F['′]|求\s*F|F\s*'\s*\(|导数", text):
        return None
    lower, upper = lower.strip(), upper.strip()
    integrand = integrand.strip()
    if free_var.lower() == int_var.lower():
        return None
    # 上/下限必须含自由变量或其一为常数；被积函数只含积分变量。
    if free_var not in (lower + upper):
        return None
    integrand = re.sub(r'([0-9])([A-Za-z])', r'\1*\2', integrand)
    point = re.search(r"F\s*['′]\s*\(\s*([-+]?\d+(?:\.\d+)?)\s*\)", text)
    conditions = {
        'expression': integrand.replace(int_var, 't') if int_var != 't' else integrand,
        'lower_expression': lower, 'upper_expression': upper,
    }
    if point:
        conditions['point'] = point.group(1)
    return _compile('integral_function', conditions)


def _multivariable(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`z=f(x,y)` + `∂z/∂x`/`偏导`/`梯度`/`全微分` → kernel multivariable。"""
    op = None
    if '梯度' in text:
        op = 'gradient'
    elif '全微分' in text:
        op = 'differential'
    elif re.search(r'∂|偏导', text):
        op = 'partial'
    if op is None:
        return None
    expr = re.search(r'[zwf]\s*(?:\(\s*x\s*,\s*y\s*\))?\s*=\s*([^，,。；;\n]+?)\s*(?:[,，。；;\n]|求|$)', text)
    if not expr:
        return None
    raw = expr.group(1).strip()
    raw = re.sub(r'([0-9])([xyz])', r'\1*\2', raw)
    raw = re.sub(r'([xyz])([xyz])', r'\1*\2', raw)
    conditions = {
        'expression': raw, 'operation': op, 'variables': 'x,y',
    }
    if op == 'partial':
        var = re.search(r'∂\s*[zwf]?\s*/\s*∂\s*([xyz])', text) or re.search(r'对\s*([xyz])\s*(?:求)?\s*偏导', text)
        conditions['partial_variable'] = var.group(1) if var else 'x'
    point = re.search(r'在点?\s*\(\s*([-+0-9.,，\s]+)\s*\)', text)
    if point:
        conditions['point'] = point.group(1).replace('，', ',')
    return _compile('multivariable', conditions)


def _constrained_extrema(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`f(x,y)=… 在约束 g=0 下最大/最小值` → kernel multivariable_extrema。"""
    if not re.search(r'约束|条件|满足', text) or not re.search(r'最[大小]值|极值|最值', text):
        return None
    expr = re.search(r'f\s*\(\s*x\s*,\s*y\s*\)\s*=\s*([^，,。；;\n]+?)\s*(?:[,，。；;\n]|在|$)', text)
    if not expr:
        return None
    constraint = re.search(r'(?:约束|条件|满足)\s*[:：为]?\s*([^，,。；;\n]*?=[^，,。；;\n]*?)(?=\s*(?:下|的|，|,|。|；|;|$))', text)
    if not constraint:
        return None
    raw = expr.group(1).strip()
    raw = re.sub(r'([0-9])([xyz])', r'\1*\2', raw)
    raw = re.sub(r'([xyz])([xyz])', r'\1*\2', raw)
    cond = constraint.group(1).strip()
    cond = re.sub(r'([0-9])([xyz])', r'\1*\2', cond)
    cond = re.sub(r'([xyz])([xyz])', r'\1*\2', cond)
    return _compile('multivariable_extrema', {
        'expression': raw, 'operation': 'constrained',
        'variables': ['x', 'y'], 'constraint': cond,
    })


def _plane_coefficients(raw: str) -> list[str] | None:
    """`2x+y-z=1` → [2, 1, -1]；缺项系数为 0。"""
    left = re.split(r'[=＝]', raw, maxsplit=1)[0]
    coeffs = []
    for var in 'xyz':
        match = re.search(rf'([-+]?\s*\d*(?:\.\d+)?)\s*{var}', left)
        if not match:
            coeffs.append('0')
            continue
        value = match.group(1).replace(' ', '')
        coeffs.append(value if value not in ('', '+', '-') else value + '1')
    return coeffs


def _implicit(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`方程 F(x,y)=C 确定隐函数 y，在点(a,b)处求 dy/dx` → kernel implicit_derivative。"""
    if not re.search(r"隐函数|确定|方程", text) or not re.search(r"dy\s*/\s*dx|y['′]|导数", text, re.I):
        return None
    relation = re.search(r'方程\s*([^，,。；;\n]*=[^，,。；;\n]*?)(?=\s*(?:确定|所|在|求|，|,|。|；|;|$))', text)
    if not relation:
        return None
    point = re.search(r'在\s*点?\s*[（(]\s*([-+0-9.,，\sa-z()√V]+)\s*[）)]\s*处?', text)
    if not point:
        return None
    coords = [item.strip() for item in re.split(r'[,，]', point.group(1)) if item.strip()]
    if len(coords) < 2:
        return None
    # OCR 字形：~→^、√→sqrt、V2→sqrt(2)。
    expression = relation.group(1).strip().replace('~', '^').replace('√', 'sqrt')
    coords = [re.sub(r'√\s*(\d+)', r'sqrt(\1)', re.sub(r'V\s*(\d+)', r'sqrt(\1)', c.replace('~', '^')))
              for c in coords]
    conditions = {'implicit_expression': expression, 'point_x': coords[0], 'point_y': coords[1]}
    return _compile('implicit_derivative', conditions)


def _sequence_limit(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`lim(n→∞) aₙ` / `数列极限` → sequence_limit。"""
    match = re.search(
        r'(?:lim|极限)\s*[_({]?\s*n\s*(?:->|→|to|趋于|趋近于)\s*(?:\+?∞|oo)\s*[)}]?\s*(.+)',
        text, flags=re.I)
    if not match or ('数列' not in text and 'n' not in match.group(1)):
        return None
    body = match.group(1)
    body = re.split(r'(?:的极限|极限为|等于|求|，|,|。|；|;)', body, maxsplit=1)[0]
    body = re.sub(r'[（(]\s*\d+(?:\.\d+)?\s*分\s*[）)]\s*$', '', body.strip())
    body = body.replace('√', 'sqrt').replace('~', '^').replace('×', '*').replace('·', '*')
    body = re.sub(r'([0-9)])\s*\(', r'\1*(', body)
    body = re.sub(r'(?<![A-Za-z])([A-Za-z])\s*\(', r'\1*(', body)
    body = re.sub(r'\)\s*([A-Za-z0-9(])', r')*\1', body)
    if 'n' not in body:
        return None
    return _compile('sequence_limit', {'expression': body.strip()})


def _surface_of_revolution(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`y=f(x)在[a,b]绕x/y轴旋转曲面(侧表面)面积` → surface_of_revolution。"""
    if not re.search(r'旋转曲面|旋转面|侧表面', text) or '面积' not in text:
        return None
    expr = re.search(r'y\s*=\s*([^，,。；;\n]+?)\s*(?:[,，。；;\n]|在|上|的|$)', text)
    if not expr:
        return None
    axis = re.search(r'绕\s*([xyXY])\s*轴', text)
    if not axis:
        return None
    bounds = _interval_bounds(text, 'x')
    if not bounds:
        return None
    return _compile('surface_of_revolution', {
        'expression': expr.group(1).strip().replace('~', '^').replace('√', 'sqrt'),
        'lower': bounds[0], 'upper': bounds[1],
        'rotation_axis': axis.group(1).lower()})


def _polar_arc_length(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`r=r(θ)` + `θ∈[α,β]` + `弧长` → polar_arc_length。"""
    if '弧长' not in text:
        return None
    # OCR 常把 θ 读成「日」：极坐标上下文（θ/极坐标/螺线等词已在场）内可直接回写。
    if re.search(r'极坐标|极径|螺线|心形线|theta', text) or 'θ' in text:
        text = text.replace('日', 'θ')
    expr = re.search(r'[rρ]\s*=\s*([^，,。；;\n]+?)\s*(?:[,，。；;\n]|在|上|的|$)', text)
    if not expr or not re.search(r'θ|theta|极坐标|极径|螺线|心形线|摆线', text):
        return None
    bounds = _interval_bounds(text, 'θ') or _interval_bounds(text, 'theta')
    if not bounds:
        return None
    raw = expr.group(1).strip().replace('~', '^').replace('θ', 'theta')
    raw = re.sub(r'(\d)([a-zA-Z(])', r'\1*\2', raw)
    return _compile('polar_arc_length', {
        'expression': raw, 'lower': bounds[0], 'upper': bounds[1]})


def _continuity(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`f(x)=…，f(a)=v/未定义，讨论x=a处连续性/间断点` → continuity。"""
    if not re.search(r'连续|间断', text):
        return None
    expr = re.search(r'(?:f|y)\s*(?:\(\s*x\s*\))?\s*=\s*([^，,。；;\n]+?)\s*(?:[,，。；;\n]|的|$)', text)
    if not expr:
        return None
    point = re.search(r'x\s*=\s*([-+]?\d+(?:\.\d+)?)\s*处', text) or re.search(r'在\s*x\s*=\s*([-+]?\d+(?:\.\d+)?)', text)
    if not point:
        return None
    raw = expr.group(1).strip()
    raw = re.sub(r'[(（]\s*x\s*[≠<>≤≥=!][^)）]*[)）]\s*$', '', raw)
    raw = raw.replace('~', '^').replace('√', 'sqrt').replace('·', '*').replace('×', '*')
    conditions = {'expression': raw,
        'variable': 'x', 'point': point.group(1)}
    defined = re.search(rf'f\s*\(\s*{re.escape(point.group(1))}\s*\)\s*=\s*([-+]?\d+(?:\.\d+)?|[^，,。；;\n]+)', text)
    if defined:
        conditions['value_mode'] = 'value'
        conditions['point_value'] = defined.group(1).strip()
    elif re.search(r'无定义|未定义|间断', text):
        conditions['value_mode'] = 'undefined'
    else:
        conditions['value_mode'] = 'expression'
    return _compile('continuity', conditions)


def _two_curve_bounds(f_raw: str, g_raw: str) -> tuple[list[str], str] | None:
    """两曲线交点求外层界；中点取值比大小得下边界函数。"""
    from .expr import parse_expression, safe_float
    import sympy as sp
    try:
        f = parse_expression(f_raw, ('x',))
        g = parse_expression(g_raw, ('x',))
    except Exception:
        return None
    x = (f.free_symbols | g.free_symbols).pop() if (f.free_symbols | g.free_symbols) else sp.Symbol('x')
    roots = sp.solve(sp.Eq(f, g), x)
    real = sorted({safe_float(r) for r in roots if safe_float(r) is not None})
    if len(real) < 1:
        return None
    a, b = real[0], real[-1]
    mid = (a + b) / 2 if len(real) > 1 else a + 0.5
    try:
        lo = g_raw if float(g.subs(x, mid)) < float(f.subs(x, mid)) else f_raw
    except (TypeError, ValueError):
        return None
    fmt = lambda v: str(int(v)) if float(v).is_integer() else str(v)
    return [fmt(a), fmt(b)], lo


def _geometric_area(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`曲线 y=f 与 y=g 围成图形面积` → geometric_area between_curves。"""
    if '面积' not in text or '围' not in text:
        return None
    pair = re.search(
        r'y\s*=\s*([^，,。；;\n]+?)\s*与\s*(?:直线|抛物线|曲线)?\s*y\s*=\s*([^，,。；;\n]+?)\s*所?围',
        text)
    if not pair:
        return None
    bounds = _two_curve_bounds(pair.group(1).strip(), pair.group(2).strip())
    if not bounds or bounds[0][0] == bounds[0][1]:
        return None
    upper = pair.group(2).strip() if bounds[1] == pair.group(1).strip() else pair.group(1).strip()
    return _compile('geometric_area', {
        'expression': upper.replace('~', '^'),
        'lower_expression': bounds[1],
        'lower': bounds[0][0], 'upper': bounds[0][1],
        'region_kind': 'between_curves'})


def _rotation_volume(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`y=f(x)，y=0(或x轴)与x=b围成，绕x/y轴旋转体积` → rotation_volume between_axis。"""
    if '体积' not in text or not re.search(r'绕\s*[xyXY]\s*轴', text):
        return None
    axis = re.search(r'绕\s*([xyXY])\s*轴', text).group(1).lower()
    expr = re.search(r'y\s*=\s*([^，,。；;\n=0]+?)\s*(?:[,，。；;\n]|与|的|$)', text)
    if not expr:
        return None
    f_raw = expr.group(1).strip().replace('~', '^').replace('√', 'sqrt')
    boundaries = re.findall(r'(?<![A-Za-z0-9_])y\s*=\s*([^，,。；;\n]+?)(?=[\u4e00-\u9fff，,。；;\n]|$)', text)
    nonzero_boundaries = [item.strip() for item in boundaries if not re.fullmatch(r'\s*0(?:\.0+)?\s*', item)]
    if len(nonzero_boundaries) > 1:
        return blocked_recognized_problem('rotation_volume', {'boundaries': boundaries, 'source_text': text},
            '已识别多条区域边界，不能把旋转轴当成第二条边界；请明确上下边界后建模。')
    bounds = _interval_bounds(text, 'x')
    if not bounds:
        xb = re.search(r'x\s*=\s*([-+]?\d+(?:\.\d+)?)', text)
        if not xb or not re.search(r'y\s*=\s*0|x\s*轴', text):
            return None
        root_bounds = _two_curve_bounds(f_raw, '0')
        if not root_bounds:
            return None
        a = min(float(root_bounds[0][0]), float(xb.group(1)))
        b = max(float(root_bounds[0][0]), float(xb.group(1)))
        fmt = lambda v: str(int(v)) if float(v).is_integer() else str(v)
        bounds = [fmt(a), fmt(b)]
    return _compile('rotation_volume', {
        'expression': f_raw, 'lower': bounds[0], 'upper': bounds[1],
        'region_kind': 'between_axis', 'rotation_axis': axis})


def _space_plane(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """`过点(a,b,c) 且与平面 Ax+By+Cz+D=0 平行/法向量 n` → plane_point_normal。"""
    point = re.search(r'过\s*点?\s*[（(]\s*([-+0-9.,，\s]+)\s*[）)]', text)
    if not point:
        return None
    normal = None
    normal_match = re.search(r'法向量\s*[:：=]?\s*\(?\s*([-+0-9.,，\s]+)\s*\)?', text)
    if normal_match:
        normal = normal_match.group(1).replace('，', ',')
    else:
        parallel = re.search(r'与\s*平面\s*([^，,。；;\n]*[xyz][^，,。；;\n]*)\s*平行', text)
        if parallel:
            coeffs = _plane_coefficients(parallel.group(1))
            if coeffs:
                normal = ','.join(coeffs)
    if normal is None:
        return None
    return _compile('space_geometry', {
        'geometry_kind': 'plane_point_normal',
        'point': point.group(1).replace('，', ','),
        'normal': normal,
    })


_NUM = r'[-+]?\d+(?:\.\d+)?(?:/\d+)?'


def _points3(text: str) -> list[str]:
    """全部 `(a,b,c)` 三点组（容许分数分量）→ ['a,b,c', ...]。"""
    out = []
    for match in re.finditer(
            rf'[（(]\s*({_NUM})\s*[,，]\s*({_NUM})\s*[,，]\s*({_NUM})\s*[）)]', text):
        out.append(','.join(g.strip() for g in match.groups()))
    return out


def _plane_abcd(eq: str) -> str | None:
    """`x+2y-2z+5=0`/`x+y+z=3` → `a,b,c,d`（左-右，缺项 0）。解析失败返回 None。"""
    from .expr import parse_expression
    import sympy as sp
    left, _, right = eq.partition('=')
    if not left.strip() or (right and not right.strip()):
        return None
    try:
        lhs = parse_expression(left.strip(), ('x', 'y', 'z'))
        rhs = parse_expression(right.strip(), ('x', 'y', 'z')) if right.strip() else sp.Integer(0)
        expr = sp.expand(lhs - rhs)
    except Exception:
        return None
    coeffs = {}
    for sym in expr.free_symbols:
        if sym.name in ('x', 'y', 'z'):
            coeffs[sym.name] = expr.coeff(sym)
    a, b, c = (coeffs.get(v, sp.Integer(0)) for v in 'xyz')
    if a == 0 and b == 0 and c == 0:
        return None
    d = expr.subs({s: 0 for s in expr.free_symbols})
    return ','.join(str(v) for v in (a, b, c, d))


def _plane_eq_after(text: str, pos: int = 0) -> str | None:
    """从 pos 起第一个含 x/y/z 的 `左=右` 式子（不含 CJK 字符）。"""
    match = re.search(
        r'([0-9xyzXYZ+\-*/^~()\s.]*[xyzXYZ][0-9xyzXYZ+\-*/^~()\s.]*=\s*[0-9xyzXYZ+\-*/^~()\s.]+)',
        text[pos:])
    return match.group(1).strip() if match else None


def _symmetric_line(seg: str) -> tuple[str, str] | None:
    """`(x-1)/3=y/(-1)=z/2`、`x-1=y=z`（隐式分母1）、`x/1=y/1=z/0` → (line_point, direction)。"""
    from .expr import parse_expression
    import sympy as sp
    parts = seg.split('=')
    if len(parts) != 3:
        return None
    point, direction = [None] * 3, [None] * 3
    order = {'x': 0, 'y': 1, 'z': 2}
    for part in parts:
        part = part.strip().strip('()（）')
        var = next((v for v in 'xyz' if v in part.lower()), None)
        if var is None:
            return None
        num, _, den = part.partition('/')
        num = num.strip().strip('()（）')
        den = den.strip().strip('()（）') or '1'
        try:
            expr = parse_expression(num.replace('~', '^'), ('x', 'y', 'z'))
            sym = next((s for s in expr.free_symbols if s.name == var), None)
            if sym is None:
                return None
            coeff = expr.coeff(sym)
            if coeff == 0:
                return None
            root = sp.simplify(-expr.subs(sym, 0) / coeff)
            direction_val = parse_expression(den.replace('~', '^'), ('x', 'y', 'z'))
        except Exception:
            return None
        idx = order[var]
        point[idx] = str(root)
        direction[idx] = str(direction_val)
    if any(v is None for v in point):
        return None
    return ','.join(point), ','.join(direction)


def _line_after(text: str, keyword: str = '直线') -> str | None:
    """`直线<对称式>` 的直线段：到「与/和/的/标点」为止。"""
    match = re.search(
        keyword + r'\s*[:：]?\s*([^，,。；;\n]*?[xyzXYZ][^，,。；;\n]*?=[^，,。；;\n]*?)\s*(?=与|和|的|在|求|，|,|。|；|;|$)',
        text)
    return match.group(1).strip() if match else None


def _vectors(text: str) -> list[str]:
    """`a=(1,2,3)` 赋值的向量分量列表（按出现顺序）。"""
    out = []
    for match in re.finditer(
            r'[a-zA-Z]\s*=\s*[（(]\s*([-+0-9./\s]+)\s*[,，]\s*([-+0-9./\s]+)\s*[,，]\s*([-+0-9./\s]+)\s*[）)]',
            text):
        out.append(','.join(g.strip() for g in match.groups()))
    return out


def _space_geometry(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """空间解析几何大题 → space_geometry 各 geometry_kind。条件不全一律 None。"""
    t = text.replace('（', '(').replace('）', ')').replace('，', ',')
    has_line = '直线' in t
    has_plane = '平面' in t
    sym = _line_after(t)
    line = _symmetric_line(sym) if sym else None

    def _planes(count: int) -> list[str] | None:
        found = []
        for match in re.finditer(
                r'平面\s*[:：]?\s*([0-9xyzXYZ+\-*/^~()\s.]*[xyzXYZ][0-9xyzXYZ+\-*/^~()\s.]*=\s*[0-9xyzXYZ+\-*/^~()\s.]+)',
                t):
            coeffs = _plane_abcd(match.group(1))
            if coeffs:
                found.append(coeffs)
        return found[:count] if len(found) >= count else None

    # 曲面切平面与法线
    if '曲面' in t and ('切平面' in t or '法线' in t):
        eq = re.search(
            r'曲面\s*[:：]?\s*([0-9xyzXYZ+\-*/^~()\s.]*[xyzXYZ][0-9xyzXYZ+\-*/^~()\s.]*=\s*[0-9xyzXYZ+\-*/^~()\s.]+)',
            t)
        pts = _points3(t)
        if eq and pts:
            return _compile('space_geometry', {
                'geometry_kind': 'surface_tangent',
                'surface': eq.group(1).strip().replace('~', '^'), 'point': pts[0]})
        return None

    # 二次曲面识别
    if '二次曲面' in t or re.search(r'曲面[^，,。；;\n]*(名称|类型|指出|识别)', t):
        eq = _plane_eq_after(t, t.find('曲面') + 2)
        if eq:
            return _compile('space_geometry', {
                'geometry_kind': 'quadric_surface',
                'expression': eq.replace('~', '^')})
        return None

    # 直线在平面上的投影
    if '投影' in t and has_line and has_plane and line:
        planes = _planes(1)
        if planes:
            return _compile('space_geometry', {
                'geometry_kind': 'line_plane_projection',
                'line_point': line[0], 'line_direction': line[1], 'plane': planes[0]})
        return None

    # 点到平面/直线距离
    if '距离' in t and (has_plane or has_line):
        pts = _points3(t)
        if has_plane:
            planes = _planes(1)
            if pts and planes:
                return _compile('space_geometry', {
                    'geometry_kind': 'point_plane_distance',
                    'point': pts[0], 'plane': planes[0]})
        elif line and pts:
            return _compile('space_geometry', {
                'geometry_kind': 'point_line_distance',
                'point': pts[0], 'line_point': line[0], 'line_direction': line[1]})
        return None

    # 两平面关系/夹角
    if re.search(r'两\s*平面|平面[^，,。；;\n]*与[^，,。；;\n]*平面', t):
        planes = _planes(2)
        if not planes:
            # `两平面 eq1 与 eq2`：第二个平面没有"平面"前缀，在"与"后按式子取。
            join = re.search(r'与\s*([0-9xyzXYZ+\-*/^~()\s.]*[xyzXYZ][0-9xyzXYZ+\-*/^~()\s.]*=\s*[0-9xyzXYZ+\-*/^~()\s.]+)', t)
            first = _planes(1)
            second = _plane_abcd(join.group(1)) if join else None
            planes = first + [second] if first and second else None
        if planes:
            return _compile('space_geometry', {
                'geometry_kind': 'plane_plane_relation',
                'plane': planes[0], 'plane2': planes[1]})
        return None

    # 直线与平面关系
    if has_line and has_plane and line and re.search(r'交点|夹角|相交|平行|垂直|位置关系|所成', t):
        planes = _planes(1)
        if planes:
            return _compile('space_geometry', {
                'geometry_kind': 'line_plane_relation',
                'line_point': line[0], 'line_direction': line[1], 'plane': planes[0]})
        return None

    # 两直线位置关系
    if has_line and re.search(r'位置关系|相交|异面|平行|垂直', t):
        pair = re.search(
            r'直线\s*[:：]?\s*([^，,。；;\n]*?=[^，,。；;\n]*?)\s*与\s*([^，,。；;\n]*?=[^，,。；;\n]*?)\s*(?:的|[，,。；;\n]|$)',
            t)
        if pair:
            first, second = _symmetric_line(pair.group(1)), _symmetric_line(pair.group(2))
            if first and second:
                return _compile('space_geometry', {
                    'geometry_kind': 'line_line_relation',
                    'point_a': first[0], 'direction_a': first[1],
                    'point_b': second[0], 'direction_b': second[1]})
        return None

    # 向量运算/向量积
    vecs = _vectors(t)
    if len(vecs) >= 3 and re.search(r'体积|混合积|平行六面体|面积', t):
        return _compile('space_geometry', {
            'geometry_kind': 'vector_products',
            'vector_a': vecs[0], 'vector_b': vecs[1], 'vector_c': vecs[2]})
    if len(vecs) >= 2 and re.search(r'夹角|点积|数量积|向量积|叉积|·|×', t):
        return _compile('space_geometry', {
            'geometry_kind': 'vector_operations',
            'vector_a': vecs[0], 'vector_b': vecs[1]})

    # 三点确定平面
    pts = _points3(t)
    if has_plane and len(pts) >= 3:
        return _compile('space_geometry', {
            'geometry_kind': 'plane_three_points',
            'point_a': pts[0], 'point_b': pts[1], 'point_c': pts[2]})

    # 过点+方向向量的直线
    if has_line and '方向向量' in t and pts:
        vec = re.search(r'方向向量\s*(?:为|是|[:：=])?\s*\(?\s*([-+0-9.,，\s]+)\s*\)?', t)
        if vec:
            return _compile('space_geometry', {
                'geometry_kind': 'line_point_direction',
                'line_point': pts[0],
                'line_direction': vec.group(1).replace('，', ',').strip()})
        return None

    # 两点确定直线
    if has_line and len(pts) >= 2:
        return _compile('space_geometry', {
            'geometry_kind': 'line_from_points',
            'point_a': pts[0], 'point_b': pts[1]})
    return None


_BUILDERS = (_triple_spherical, _triple_cylindrical, _triple_box,
             _surface_graph, _surface_flux, _gauss, _stokes, _green,
             _directional, _sequence_limit, _surface_of_revolution,
             _rotation_volume, _geometric_area, _parametric_derivative,
             _polar_arc_length, _arc_length, _curvature, _polar_area,
             _continuity, _asymptote, _higher_derivative, _integral_function,
             _multivariable, _constrained_extrema, _implicit, _implicit_normal,
             _space_geometry, _space_plane)


def build_advanced_calc_from_text(text: str, source: Mapping[str, Any],
                                  overrides: Mapping[str, Any]) -> dict | None:
    for builder in _BUILDERS:
        problem = builder(text, source, overrides)
        if problem is not None:
            problem.setdefault('recognized', True)
            return problem
    return None

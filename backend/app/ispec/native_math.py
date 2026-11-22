"""Native, evidence-backed arithmetic and 2D mappings; never execute source text."""
from __future__ import annotations

import ast
import math
import re
import unicodedata
from collections.abc import Mapping
from typing import Any

NUMBER = r"[-+]?(?:\d+(?:\.\d+)?|\.\d+)"
PAIR = re.compile(rf"\(\s*({NUMBER})\s*,\s*({NUMBER})\s*\)\s*(?:→|⇒|->|=>)\s*\(\s*({NUMBER})\s*,\s*({NUMBER})\s*\)")
MATRIX = re.compile(rf"\[\s*\[\s*({NUMBER})\s*,\s*({NUMBER})\s*\]\s*,\s*\[\s*({NUMBER})\s*,\s*({NUMBER})\s*\]\s*\]")
FUNCTIONS = {"abs", "sqrt", "pow", "sin", "cos", "tan", "exp", "log", "min", "max", "floor", "ceil", "round"}


def _normalize(text: str) -> str:
    superscripts = str.maketrans('⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻', '0123456789+-')
    text = re.sub(r'[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+', lambda match: '**(' + match.group().translate(superscripts) + ')', text)
    text = unicodedata.normalize("NFKC", text)
    for symbol, replacement in {"−": "-", "×": "*", "·": "*", "÷": "/", "^": "**", "π": "pi",
                                r"\cdot": "*", r"\times": "*", r"\pi": "pi", r"\left": "", r"\right": ""}.items():
        text = text.replace(symbol, replacement)
    # Unwrap simple nested LaTeX fractions/roots without evaluating anything.
    for _ in range(8):
        previous = text
        text = re.sub(r"\\(?:mathbf|mathrm|mathit|mathsf|mathtt|mathnormal|boldsymbol)\s*\{([^{}]*)\}", r"\1", text)
        text = re.sub(r"\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}", r"((\1)/(\2))", text)
        text = re.sub(r"\\sqrt\s*\{([^{}]+)\}", r"sqrt(\1)", text)
        if text == previous:
            break
    return text.replace("{", "(").replace("}", ")").strip().strip("$")


def _expression(text: str) -> tuple[str, list[str]] | None:
    text = _normalize(text)
    if len(text) > 350:
        return None
    text = re.sub(r"(?<=\d)\s*(?=[a-df-zA-DF-Z])", "*", text)
    text = re.sub(r"(?<=\))(?=[A-Za-z(])", "*", text)
    try:
        tree = ast.parse(text, mode="eval")
    except (SyntaxError, ValueError, RecursionError):
        return None
    nodes = list(ast.walk(tree))
    allowed = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Call, ast.Name, ast.Constant,
               ast.Load, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod, ast.UAdd, ast.USub)
    if len(nodes) > 100 or any(not isinstance(node, allowed) for node in nodes):
        return None
    names = []
    for node in nodes:
        if isinstance(node, ast.Constant) and (type(node.value) not in (int, float) or
                not math.isfinite(node.value) or abs(node.value) > 1e12):
            return None
        if isinstance(node, ast.Call) and (not isinstance(node.func, ast.Name) or
                node.func.id not in FUNCTIONS or node.keywords or not 1 <= len(node.args) <= 4):
            return None
        if isinstance(node, ast.Call):
            count = len(node.args)
            if node.func.id == 'pow' and count != 2:
                return None
            if node.func.id not in ('pow', 'min', 'max') and count != 1:
                return None
        if isinstance(node, ast.Name):
            name = node.id
            if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,23}", name):
                return None
            if name not in FUNCTIONS and name not in names:
                names.append(name)
    return ast.unparse(tree.body), names


def _source(page, element, excerpt, status="original"):
    return {"page": page, "element_id": element.get("element_id"), "bbox": None,
            "status": status, "excerpt": excerpt[:160]}


def _parameter(identifier, value, source, label=None):
    extent = max(10, abs(value) * 5)
    return {"id": identifier, "label": label or identifier, "type": "number", "unit": "",
            "default": value, "min": -extent, "max": extent, "source": source}


def _spec(identifier, title, kind, parameters, expressions, views, notes):
    return {"spec_version": "1.0", "object_id": identifier, "title": title, "kind": kind,
            "parameters": parameters, "expressions": expressions, "views": views,
            "constraints": [], "checks": [], "notes": notes}


def _matrix_spec(page, elements, material_id):
    mappings = []
    literals = []
    columns = []
    for element in elements:
        text = _normalize(str(element.get("text") or ""))
        for match in PAIR.finditer(text):
            mappings.append((list(map(float, match.groups())), element, match.group(0)))
        for match in MATRIX.finditer(text):
            literals.append((list(map(float, match.groups())), element, match.group(0)))
        found = list(re.finditer(rf'[cC]?\s*([12])\s*=\s*=?\s*\(\s*({NUMBER})\s*,\s*({NUMBER})\s*\)', text))
        by_column = {int(match[1]): match for match in found}
        if set(by_column)=={1,2}:
            first, second = by_column[1], by_column[2]
            columns.append(([float(first[2]),float(second[2]),float(first[3]),float(second[3])], element, text))
    if not literals and len(columns)==1:
        literals = columns
    matrix = literals[0][0] if len(literals) == 1 else None
    if matrix is None and not literals:
        for first, _, _ in mappings:
            for second, _, _ in mappings:
                x, y, u, v = first
                xx, yy, uu, vv = second
                det = x * yy - xx * y
                if abs(det) < 1e-9:
                    continue
                matrix = [(u * yy - uu * y) / det, (uu * x - u * xx) / det,
                          (v * yy - vv * y) / det, (vv * x - v * xx) / det]
                break
            if matrix is not None:
                break
    if matrix is None or not all(math.isfinite(n) for n in matrix):
        return None
    a, b, c, d = matrix
    if any(abs(a*x+b*y-u) > 1e-7 or abs(c*x+d*y-v) > 1e-7 for (x,y,u,v), _, _ in mappings):
        return None
    evidence = literals[0] if literals else (matrix, mappings[0][1], "; ".join(m[2] for m in mappings))
    status = 'inferred' if evidence[1].get('recognition_method')=='local_ocr' or not literals else 'original'
    source = _source(page["page_no"], evidence[1], evidence[2], status)
    parameters = [_parameter(key, value, dict(source), f"矩阵 {key}") for key, value in zip("abcd", matrix)]
    for i, (mapping, element, excerpt) in enumerate(mappings[:8], 1):
        for key, value in zip((f"x{i}", f"y{i}"), mapping[:2]):
            parameters.append(_parameter(key, value, _source(page["page_no"], element, excerpt), f"向量 {i} · {key[0]}"))
    expressions = [{"id": "det", "expr": "a*d-b*c", "label": "行列式"}]
    for i in range(1, min(8, len(mappings)) + 1):
        expressions += [{"id": f"u{i}", "expr": f"a*x{i}+b*y{i}"}, {"id": f"v{i}", "expr": f"c*x{i}+d*y{i}"}]
    lines = ["det(A) = {{det}}"] + [f"({{{{x{i}}}}}, {{{{y{i}}}}}) → ({{{{u{i}}}}}, {{{{v{i}}}}})" for i in range(1, min(8, len(mappings)) + 1)]
    return _spec(f"native_{material_id}_p{page['page_no']}_matrix", page.get("title") or "二维矩阵与向量",
                 "geometric", parameters, expressions,
                 [{"type": "figure", "spec_ref": "circle_ellipse" if mappings else "grid_transform", "title": "拖动向量或修改矩阵"},
                  {"type": "text", "template": "\n".join(lines), "title": "当前计算结果"}],
                 "由本页原生文字中的矩阵或至少两条独立向量映射生成；推断矩阵已复核全部映射，不读取示例配置。")


def build_native_math_specs(page: Mapping[str, Any], material_id: str) -> list[dict[str, Any]]:
    elements = [e for e in page.get("elements", []) if isinstance(e, Mapping)]
    specs = []
    matrix = _matrix_spec(page, elements, material_id)
    if matrix:
        specs.append(matrix)
    for element in elements:
        original = str(element.get("math_text") or element.get("text") or "")
        line_status = "inferred" if element.get("recognition_method") == "local_ocr" else "original"
        for line_index, line in enumerate(original.splitlines()):
            if element.get('image_recognition', {}).get('status') in ('recognized', 'user_confirmed', 'vision_confirmed') and r'\int' in line:
                integral = _image_integral_spec(page, element, material_id, line, line_index)
                if integral:
                    specs.append(integral)
                continue
            # Matrix transpose/inverse and symbolic operators are not scalar arithmetic.
            if any(symbol in line for symbol in ("⁻", "ᵀ", "Σ", "∑", "∫", "[", r"\begin")):
                continue
            match = re.fullmatch(r"\s*([A-Za-z][A-Za-z0-9_]{0,23})\s*=\s*(.+?)\s*[;；。]?\s*", _normalize(line))
            if not match:
                continue
            output, rhs = match.groups()
            parsed = _expression(rhs)
            if parsed is None:
                continue
            expression, names = parsed
            if not names or output in names or len(names) > 12:
                continue
            # Constants alone are assignments, not interactive relations.
            parameters = []
            for name in names:
                if name == "pi":
                    continue
                assignments = []
                for source_element in elements:
                    for source_line in str(source_element.get('text') or source_element.get('math_text') or '').splitlines():
                        assignment = re.fullmatch(rf'\s*{re.escape(name)}\s*=\s*({NUMBER})\s*', _normalize(source_line))
                        if assignment:
                            assignments.append((assignment.group(1), source_element, source_line))
                matches = [assignment[0] for assignment in assignments]
                values = {float(v) for v in matches}
                confirmed = len(values) == 1
                value = next(iter(values)) if confirmed else 0
                if confirmed:
                    source = _source(
                        page["page_no"],
                        assignments[0][1],
                        assignments[0][2],
                        "inferred" if assignments[0][1].get("recognition_method") == "local_ocr" else "original",
                    )
                else:
                    source = _source(page["page_no"], element, line, "inferred")
                parameters.append(_parameter(name, value, source, f"变量 {name}"))
            if not parameters:
                continue
            expressions = ([{"id": "pi", "expr": str(math.pi)}] if "pi" in names else [])
            expressions.append({"id": output, "expr": expression, "label": output})
            template = f"{output} = {{{{{output}}}}}"
            specs.append(_spec(f"native_{material_id}_{element.get('element_id')}_{line_index}", line.strip()[:100],
                         "parametric", parameters, expressions,
                         [{"type": "text", "template": line.strip(), "title": "原始公式"},
                          {"type": "text", "template": template, "title": "当前计算结果"},
                          {"type": "table", "columns": [p["id"] for p in parameters] + [output]}],
                         "受限标量公式；参数默认值来自本页明确赋值，缺失值标为系统推断并以 0 占位，请确认后使用。"))
    return specs


def _image_integral_spec(page, element, material_id, latex, index):
    """Plot the supported, confirmed single-variable definite integral."""
    import sympy as sp
    from .formula_review import parse_formula
    from ..labs.expr import parse_expression

    integral = parse_formula(latex)
    if not isinstance(integral, sp.Integral) or len(integral.limits) != 1 or len(integral.limits[0]) != 3:
        return None
    variable, lower, upper = integral.limits[0]
    if integral.function.free_symbols - {variable} or not re.fullmatch(r'[A-Za-z]', str(variable)):
        return None
    try:
        a, b = float(lower), float(upper)
        code = sp.sstr(integral.function)
        parsed = _expression(code)
        if not parsed or not all(math.isfinite(n) and abs(n) <= 1e6 for n in (a, b)) or a == b:
            return None
        expression = parse_expression(code, variables=(str(variable),))
        sample_variable = next(iter(expression.free_symbols), variable)
        lo, hi = sorted((a, b))
        points = []
        for i in range(81):
            x = lo + (hi-lo)*i/80
            try:
                value = float(expression.subs(sample_variable, x))
                points.append([x, value if math.isfinite(value) else None])
            except (ValueError, TypeError, ArithmeticError):
                points.append([x, None])
        if sum(y is not None for _, y in points) < 2:
            return None
    except (ValueError, TypeError, ArithmeticError):
        return None
    source = _source(page['page_no'], element, latex,
                     'confirmed' if element.get('recognition_method') == 'user_confirmed' else 'inferred')
    parameter = _parameter(str(variable), (lo+hi)/2, source)
    parameter.update(min=lo, max=hi)
    spec = _spec(f"native_{material_id}_{element['element_id']}_{index}_integral", '定积分 · 被积函数',
                 'parametric', [parameter], [{'id': 'fx', 'expr': parsed[0], 'label': '被积函数'}], [
                     {'type': 'text', 'template': latex, 'title': '原始公式'},
                     {'type': 'vega', 'spec_ref': 'line', 'x': 'x', 'y': 'y', 'dataset': 'curve',
                      'title': '积分区间内的被积函数'},
                     {'type': 'text', 'template': '当前被积函数值 = {{fx}}', 'title': '观察点'},
                 ], '曲线来自已核对的公式，横轴取原积分区间。')
    spec['anchor'] = {'page': page['page_no'], 'element_id': element['element_id'], 'bbox': element['bbox']}
    spec['datasets'] = [{'id': 'curve', 'columns': ['x', 'y'], 'rows': points,
                         'source': {'page': page['page_no'], 'element_id': element['element_id']}}]
    return spec

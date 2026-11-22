"""手写墨迹圈选 → LaTeX / 受限表达式。

只在本机调用可选的公式 OCR；识别失败或无法转成 f(x) 时明确返回 supported=False，
不猜测、不伪造公式。墨迹由前端按画布坐标上传，这里重新栅格化后识别。
"""
from __future__ import annotations

import math
import re
from typing import Any, Sequence

import sympy as sp

from importlib.util import find_spec

from ..settings import get_settings
from .expr import parse_expression
from .extract import _math_ocr

MAX_STROKES = 60
MAX_POINTS = 6000
MAX_COORD = 100000

_FUNCTIONS = {
    "sin", "cos", "tan", "cot", "sec", "csc",
    "asin", "acos", "atan", "acot", "asec", "acsc",
    "sinh", "cosh", "tanh", "exp", "ln", "log",
}
_FUNCTION_ALIASES = {
    "arcsin": "asin",
    "arccos": "acos",
    "arctan": "atan",
    "arccot": "acot",
    "arcsec": "asec",
    "arccsc": "acsc",
}


class _LatexParser:
    """只解析无上下限的算式子集；积分/求和/矩阵等直接拒绝。"""

    def __init__(self, text: str) -> None:
        self.text = text
        self.index = 0

    def parse(self) -> str | None:
        result = self._sequence(None)
        self._skip()
        if result is None or self.index < len(self.text):
            return None
        return result

    def _skip(self) -> None:
        while self.index < len(self.text) and self.text[self.index].isspace():
            self.index += 1

    def _sequence(self, stop: str | None) -> str | None:
        parts: list[str] = []
        while self.index < len(self.text):
            char = self.text[self.index]
            if stop is not None and char == stop:
                break
            if char in "}]":
                return None
            part = self._atom()
            if part is None:
                return None
            parts.append(part)
        return "".join(parts)

    def _group_raw(self) -> str | None:
        self._skip()
        if self.index >= len(self.text) or self.text[self.index] != "{":
            return None
        self.index += 1
        content = self._sequence("}")
        if content is None or self.index >= len(self.text) or self.text[self.index] != "}":
            return None
        self.index += 1
        return content

    def _command(self) -> str | None:
        self.index += 1
        start = self.index
        while self.index < len(self.text) and self.text[self.index].isalpha():
            self.index += 1
        name = self.text[start:self.index]
        if not name:
            return None
        if name in {"left", "right", "displaystyle", "textstyle", "limits", "nolimits"}:
            return ""
        if name in {"cdot", "times"}:
            return "*"
        if name == "div":
            return "/"
        if name == "pi":
            return "pi "
        if name in {"frac", "dfrac", "tfrac"}:
            numerator = self._group_raw()
            denominator = self._group_raw()
            if numerator is None or denominator is None:
                return None
            return f"({numerator})/({denominator})"
        if name == "sqrt":
            content = self._group_raw()
            if content is None:
                return None
            return f"sqrt({content})"
        canonical = _FUNCTION_ALIASES.get(name, name)
        if canonical in _FUNCTIONS:
            argument = self._argument()
            if argument is None:
                return None
            return f"{canonical}({argument})"
        return None

    def _argument(self) -> str | None:
        self._skip()
        if self.index >= len(self.text):
            return None
        if self.text[self.index] == "{":
            return self._group_raw()
        if self.text[self.index] == "\\":
            start = self.index
            part = self._command()
            if part is None:
                return None
            if part and part[0].isalpha():
                return part
            self.index = start
            return None
        if self.text[self.index] == "(":
            self.index += 1
            content = self._sequence(")")
            if content is None or self.index >= len(self.text) or self.text[self.index] != ")":
                return None
            self.index += 1
            return content
        if self.text[self.index].isalnum() or self.text[self.index] == ".":
            start = self.index
            while self.index < len(self.text) and (self.text[self.index].isalnum() or self.text[self.index] == "."):
                self.index += 1
            return self.text[start:self.index]
        return None

    def _atom(self) -> str | None:
        self._skip()
        if self.index >= len(self.text):
            return ""
        char = self.text[self.index]
        if char == "\\":
            if self.index + 1 < len(self.text) and self.text[self.index + 1] in ",!;:":
                self.index += 2
                return ""
            return self._command()
        if char == "{":
            content = self._group_raw()
            if content is None:
                return None
            return f"({content})"
        if char in "_&=%<>[]":
            return None
        if char in "^":
            self.index += 1
            argument = self._argument()
            if argument is None:
                return None
            return f"^({argument})"
        if char in "$\\":
            return None
        self.index += 1
        return char


def _separate_juxtaposition(text: str) -> str:
    known = _FUNCTIONS | {"pi", "sqrt", "abs"}

    def replace(match: re.Match[str]) -> str:
        token = match.group(0)
        if token in known:
            return token
        if len(token) > 1 and all(char.isalpha() for char in token):
            return "*".join(token)
        return token

    text = re.sub(r"[A-Za-z]+", replace, text)
    text = re.sub(r"(?<![A-Za-z])pi\s*(?=[A-Za-z0-9(])", "pi*", text)
    text = re.sub(r"(?<![A-Za-z])e\s+(?=[A-Za-z0-9(])", "e*", text)
    return text


def latex_to_expression(latex: str) -> str | None:
    """把受限 LaTeX 转成前端可求值的 f(x) 表达式；不确定时返回 None。"""

    text = (latex or "").strip().strip("$").strip()
    if not text or "\\int" in text or "\\sum" in text or "\\lim" in text:
        return None
    # 学生最常写 y=… 或 f(x)=…；只剥掉这两种明确前缀，避免把一般方程误当函数。
    text = re.sub(
        r"^\s*(?:y|f\s*(?:\\left)?\s*\(\s*x\s*(?:\\right)?\s*\))\s*=\s*",
        "",
        text,
        flags=re.I,
    )
    if not text.strip():
        return None
    converted = _LatexParser(text).parse()
    if not converted:
        return None
    converted = _separate_juxtaposition(re.sub(r"\s+", " ", converted).strip())
    try:
        parsed = parse_expression(converted, variables=("x", "a", "b", "c"))
    except Exception:  # noqa: BLE001 - 识别结果不可计算时保留为公式卡
        return None
    if {str(symbol) for symbol in parsed.free_symbols} - {"x", "a", "b", "c"}:
        return None
    normalized = sp.sstr(parsed).replace("**", "^").replace("Abs(", "abs(")
    if any(bad in normalized for bad in ("Integral", "Derivative", "Piecewise", "Sum", "Limit", "oo", "zoo", "nan")):
        return None
    return normalized


_ALLOWED_LATEX_COMMANDS = {
    "frac", "dfrac", "tfrac", "sqrt", "left", "right", "cdot", "times", "div",
    "pi", "infty", "int", "sum", "lim", "mathrm", "text",
    "sin", "cos", "tan", "cot", "sec", "csc",
    "arcsin", "arccos", "arctan", "arccot", "arcsec", "arccsc",
    "sinh", "cosh", "tanh", "exp", "ln", "log", "abs",
    "quad", "qquad", "begin", "end", "pmatrix", "bmatrix",
}


def _plausible_latex(latex: str) -> bool:
    """拒绝公式模型对稀疏笔迹产生的纯符号幻觉（如 \\nabla×\\nabla）。

    只接受初等函数/积分常用的 LaTeX 命令；集合、矩阵、装饰命令等一律拒绝，
    避免把随手画的线条自动注入成“公式”。
    """

    text = (latex or "").strip()
    if not text or len(text) > 500:
        return False
    commands = set(re.findall(r"\\([a-zA-Z]+)", text))
    if commands - _ALLOWED_LATEX_COMMANDS:
        return False
    stripped = re.sub(r"\\[a-zA-Z]+", "", text)
    stripped = re.sub(r"[{}$\\\s]", "", stripped)
    return any(char.isalpha() or char.isdigit() for char in stripped)


def latex_to_matrix(latex: str) -> dict[str, float] | None:
    """识别 2×2 常数矩阵；其它尺寸/含变量的矩阵降级为公式卡。"""

    match = re.search(r"\\begin\{(p|b)matrix\}(.*?)\\end\{\1matrix\}", latex or "", re.S)
    if not match:
        return None
    rows = [row.strip() for row in re.split(r"\\\\", match.group(2)) if row.strip()]
    if len(rows) != 2:
        return None
    cells = [[cell.strip() for cell in row.split("&")] for row in rows]
    if any(len(row) != 2 for row in cells):
        return None
    values: list[float] = []
    for row in cells:
        for cell in row:
            cleaned = re.sub(r"\s+", "", cell)
            if not re.fullmatch(r"[+-]?\d+(?:\.\d+)?(?:/\d+(?:\.\d+)?)?", cleaned):
                return None
            try:
                value = float(parse_expression(cleaned, variables=("x",)))
            except Exception:  # noqa: BLE001 - 非数值单元格不做猜测
                return None
            if not math.isfinite(value):
                return None
            values.append(value)
    return {"a": values[0], "b": values[1], "c": values[2], "d": values[3]}


def latex_to_node(latex: str) -> dict[str, Any]:
    """把识别结果归类为矩阵源、函数源或公式卡，绝不抛错。"""

    matrix = latex_to_matrix(latex)
    if matrix is not None:
        return {"node_type": "matrixSource", "matrix": matrix}
    expression = latex_to_expression(latex)
    if expression is not None:
        return {"node_type": "functionSource", "expression": expression}
    return {"node_type": "latexNote"}


def _collect_points(strokes: Sequence[dict[str, Any]]) -> list[tuple[float, float, float]] | None:
    if not strokes or len(strokes) > MAX_STROKES:
        return None
    points: list[tuple[float, float, float]] = []
    for stroke in strokes:
        raw = stroke.get("points")
        width = stroke.get("width", 2.4)
        if not isinstance(raw, list) or not raw:
            continue
        try:
            line_width = float(width)
        except (TypeError, ValueError):
            line_width = 2.4
        for point in raw:
            if not isinstance(point, (list, tuple)) or len(point) < 2:
                return None
            try:
                x, y = float(point[0]), float(point[1])
            except (TypeError, ValueError):
                return None
            if not (math.isfinite(x) and math.isfinite(y)) or abs(x) > MAX_COORD or abs(y) > MAX_COORD:
                return None
            points.append((x, y, max(1.0, min(12.0, line_width))))
            if len(points) > MAX_POINTS:
                return None
    return points or None


def normalize_stroke_sequence(strokes: Sequence[dict[str, Any]]) -> list[list[tuple[float, float]]]:
    """把原始画布笔迹归一化为 [0, 1] 坐标空间的笔画序列（供 ink2latex 序列模型使用）。"""
    points = _collect_points(strokes)
    if not points:
        return []
    min_x = min(p[0] for p in points)
    min_y = min(p[1] for p in points)
    span = max(1.0, max(p[0] for p in points) - min_x, max(p[1] for p in points) - min_y)
    normalized: list[list[tuple[float, float]]] = []
    for stroke in strokes:
        raw = stroke.get("points")
        if not isinstance(raw, list) or not raw:
            continue
        seq = [
            (round((float(pt[0]) - min_x) / span, 5), round((float(pt[1]) - min_y) / span, 5))
            for pt in raw
            if isinstance(pt, (list, tuple)) and len(pt) >= 2
        ]
        if seq:
            normalized.append(seq)
    return normalized


def _ink_backend_mode() -> str:
    try:
        mode = str(getattr(get_settings(), "lab_ink_backend", "auto") or "auto").strip().lower()
        return mode if mode in {"auto", "ink2latex", "raster"} else "auto"
    except Exception:  # noqa: BLE001
        return "auto"


def _ink2latex_recognize(strokes: Sequence[dict[str, Any]]) -> str | None:
    """可选的 ink2latex 笔迹序列识别通道；未安装或失败时返回 None 回退栅格 OCR。"""
    if _ink_backend_mode() == "raster":
        return None
    if find_spec("ink2latex") is None:
        return None
    normalized = normalize_stroke_sequence(strokes)
    if not normalized:
        return None
    try:
        import ink2latex  # type: ignore[import-not-found]

        if hasattr(ink2latex, "recognize_strokes"):
            result = ink2latex.recognize_strokes(normalized)
        elif hasattr(ink2latex, "predict"):
            result = ink2latex.predict(normalized)
        else:
            return None
        return str(result).strip() if result else None
    except Exception:  # noqa: BLE001 - 失败时无缝降级为栅格化公式 OCR
        return None


def ink_to_formula(strokes: Sequence[dict[str, Any]]) -> dict[str, Any]:
    points = _collect_points(strokes)
    if points is None:
        return {"supported": False, "reason": "墨迹为空、过大或坐标不合法。"}
    min_x = min(point[0] for point in points)
    min_y = min(point[1] for point in points)
    span_x = max(1.0, max(point[0] for point in points) - min_x)
    span_y = max(1.0, max(point[1] for point in points) - min_y)
    if len(points) < 8 or max(span_x, span_y) < 8:
        return {"supported": False, "reason": "笔迹过于稀疏，无法可靠识别；请完整写出一个算式后再圈选。"}

    recognition_method = "ink2latex"
    latex = _ink2latex_recognize(strokes)
    if not latex or not _plausible_latex(latex):
        recognition_method = "raster_ocr"
        scale = max(0.3, min(4.0, 1200 / span_x))
        pad = 28
        width = max(1, int(span_x * scale) + pad * 2)
        height = max(1, int(span_y * scale) + pad * 2)
        try:
            from PIL import Image, ImageDraw
            image = Image.new("RGB", (width, height), "white")
            draw = ImageDraw.Draw(image)
            for stroke in strokes:
                raw = stroke.get("points")
                if not isinstance(raw, list) or not raw:
                    continue
                line_width = max(2, int(round(max(1.0, min(12.0, float(stroke.get("width", 2.4)))) * scale)))
                path = [
                    ((float(point[0]) - min_x) * scale + pad, (float(point[1]) - min_y) * scale + pad)
                    for point in raw
                    if isinstance(point, (list, tuple)) and len(point) >= 2
                ]
                if len(path) >= 2:
                    draw.line(path, fill="black", width=line_width, joint="curve")
                elif path:
                    radius = max(2, line_width // 2)
                    x, y = path[0]
                    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill="black")
        except Exception:  # noqa: BLE001 - 栅格化失败按不可识别处理
            return {"supported": False, "reason": "手写笔迹无法栅格化。"}
        latex = _math_ocr(image, loose=True)
    if not latex or not _plausible_latex(latex):
        return {
            "supported": False,
            "reason": "未能从选中的笔迹识别出可靠公式；请只圈选一个算式，或确认本地公式 OCR 已安装。",
        }
    node = latex_to_node(latex)
    note = {
        "matrixSource": "识别为 2×2 矩阵；请核对四个元素后再使用。",
        "functionSource": "识别为单变量函数，已准备函数源与图像积木；请核对表达式。",
        "latexNote": "识别为公式卡；复杂公式不会自动转成函数源。",
    }[node["node_type"]]
    return {
        "supported": True,
        "latex": latex,
        "node_type": node["node_type"],
        "expression": node.get("expression"),
        "matrix": node.get("matrix"),
        "note": note,
        "recognition_method": recognition_method,
    }
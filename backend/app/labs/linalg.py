"""线性代数题目的识别与确定性求解。

覆盖五类题型，全部产出可逐步回放的执行轨迹：

- ``linear_system``：Ax=b，高斯消元（可选部分主元 / 高斯-若尔当）；
- ``determinant``：|A|，初等行变换化为上三角后取主元乘积；
- ``inverse``：A⁻¹，对增广矩阵 [A|I] 做消元；
- ``matmul``：A·B、A±B、数乘 kA，逐元素展示计算；
- ``eigen``：精确特征根、特征空间基与 Av=λv 校验。

输入支持两种形式：矩阵字面量 ``A=[[1,2],[3,4]]`` / ``A=[1 2;3 4]``，
以及中文/普通写法的线性方程组（``x+y=3`` 这类等式直接解析成系数矩阵）。
特征问题使用精确符号运算，其余轨迹使用确定性浮点运算；缺失数据明确阻塞。
"""

from __future__ import annotations

import ast
import math
import re
from typing import Any, Mapping, Sequence

import sympy as sp

EPS = 1e-9
MAX_DIM = 5
MAX_CELLS = 25

PSEUDOCODE = [
    "写出（增广）矩阵",
    "每列选取非零主元，必要时交换两行",
    "逐行消元：把主元下方（若尔当则上下）化为 0",
    "回代或化简后读出结果",
    "用代回 / 乘积核对结果",
]

EIGEN_PSEUDOCODE = [
    "按原始整数、分数或小数字面量构造精确矩阵 A",
    "展开特征多项式 p(λ)=det(λI−A)",
    "精确求解 p(λ)=0，并记录每个根的代数重数",
    "求 ker(A−λI) 的一组基；基的个数为几何重数",
    "逐个基向量精确校验 Av=λv，并核对代数重数之和",
]

_KIND_LABELS = {
    "linear_system": "线性方程组",
    "determinant": "行列式",
    "inverse": "逆矩阵",
    "matmul": "矩阵运算",
    "eigen": "特征值与特征向量",
}

_OP_LABELS = {"mul": "A·B", "add": "A+B", "sub": "A−B", "scalar": "kA"}


# ---------------------------------------------------------------------------
# 数值与文本工具
# ---------------------------------------------------------------------------


def _num_token(raw: str) -> float | None:
    token = raw.strip().replace(" ", "")
    if not token:
        return None
    try:
        value = float(token)
    except ValueError:
        if re.fullmatch(r"[-+]?\d+(?:\.\d+)?/\d+(?:\.\d+)?", token):
            try:
                value = eval(token, {"__builtins__": {}}, {})  # noqa: S307 - 纯分数字面量
            except (SyntaxError, ZeroDivisionError, TypeError):
                return None
        else:
            return None
    return value if isinstance(value, (int, float)) and math.isfinite(value) else None


def _fmt(value: float | None, digits: int = 5) -> str:
    if value is None or not math.isfinite(value):
        return "—"
    from .expr import number_text

    return number_text(float(value), digits)


def _mat_text(matrix: Sequence[Sequence[float | None]]) -> str:
    return "[" + "; ".join(", ".join(_fmt(v) for v in row) for row in matrix) + "]"


def _clone(matrix: Sequence[Sequence[float]]) -> list[list[float]]:
    return [list(row) for row in matrix]


def _square(matrix: Sequence[Sequence[Any]] | None) -> bool:
    return bool(matrix) and all(isinstance(row, list) and len(row) == len(matrix) for row in matrix or [])


# ---------------------------------------------------------------------------
# 矩阵 / 向量字面量解析
# ---------------------------------------------------------------------------


def _literal_matrix(raw: str) -> list[list[float]] | None:
    """``[[a,b],[c,d]]`` / ``((a,b),(c,d))`` 形式的嵌套字面量。"""

    try:
        value = ast.literal_eval(raw.replace("，", ",").replace(" ", ""))
    except (ValueError, SyntaxError):
        return None
    if not isinstance(value, (list, tuple)) or not value:
        return None
    rows: list[list[float]] = []
    for row in value:
        if not isinstance(row, (list, tuple)) or not row:
            return None
        parsed: list[float] = []
        for item in row:
            try:
                number = float(item)
            except (TypeError, ValueError):
                return None
            parsed.append(number)
        rows.append(parsed)
    width = len(rows[0])
    if any(len(row) != width for row in rows):
        return None
    return rows


def _semicolon_matrix(raw: str) -> list[list[float]] | None:
    """``[a b; c d]`` / ``[a,b; c,d]`` 分号分行写法。"""

    body = raw.strip().lstrip("[（(").rstrip("]）)")
    if ";" not in body and "；" not in body:
        return None
    rows: list[list[float]] = []
    for piece in re.split(r"\s*[;；]\s*", body):
        tokens = [t for t in re.split(r"[,\s]+", piece.strip()) if t]
        if not tokens:
            return None
        row = [_num_token(token) for token in tokens]
        if any(value is None for value in row):
            return None
        rows.append([float(v) for v in row if v is not None])
    if len(rows) < 2 or any(len(row) != len(rows[0]) for row in rows):
        return None
    return rows


_NESTED = re.compile(r"\[\s*\[(?:[^\[\]]*)\](?:\s*,\s*\[(?:[^\[\]]*)\])*\s*\]")
_SEMICOLON = re.compile(r"\[\s*[^\[\];；]+?\s*(?:[;；]\s*[^\[\];]+?)+\s*\]")
# `|1 2;3 4|` 行列式竖线记法：要求至少一个分号，避免误吃 |x| 绝对值。
# 开闭定界允许 `|`/`[`/`]` 混搭——OCR 常把 `|` 误读成 `[`（如 `[2 1 0;…|`）。
_BARS = re.compile(r"[|\[]\s*[^|;；\[\]]+?\s*(?:[;；]\s*[^|;；\[\]]+?)+\s*[|\]]")


def _matrices_from_text(text: str) -> tuple[dict[str, list[list[float]]], list[list[list[float]]]]:
    """返回 (具名矩阵 {字母:矩阵}, 匿名矩阵按出现顺序)。"""

    named: dict[str, list[list[float]]] = {}
    anonymous: list[list[list[float]]] = []
    taken: list[tuple[int, int]] = []
    for match in _NESTED.finditer(text):
        matrix = _literal_matrix(match.group(0))
        if matrix is None:
            continue
        prefix = text[max(0, match.start() - 8): match.start()]
        name = re.search(r"([A-Za-z])\s*=\s*$", prefix)
        if name:
            named[name.group(1)] = matrix
        else:
            anonymous.append(matrix)
        taken.append(match.span())
    for match in _SEMICOLON.finditer(text):
        if any(start <= match.start() < end or start < match.end() <= end for start, end in taken):
            continue
        matrix = _semicolon_matrix(match.group(0))
        if matrix is None:
            continue
        prefix = text[max(0, match.start() - 8): match.start()]
        name = re.search(r"([A-Za-z])\s*=\s*$", prefix)
        if name:
            named[name.group(1)] = matrix
        else:
            anonymous.append(matrix)
        taken.append(match.span())
    for match in _BARS.finditer(text):
        if any(start <= match.start() < end or start < match.end() <= end for start, end in taken):
            continue
        body = match.group(0).strip().strip('|[]')
        matrix = _semicolon_matrix('[' + body + ']')
        if matrix is None:
            continue
        anonymous.append(matrix)
    return named, anonymous


_EXACT_LITERAL = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?")


def _exact_number(value: Any) -> sp.Rational:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError("矩阵元素仅支持有限整数、分数或小数字面量。")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("矩阵元素必须有限，不能包含 NaN 或 Infinity。")
    token = str(value).strip()
    if len(token) > 256:
        raise ValueError("矩阵元素字面量过长，无法进行小规模精确求解。")
    parts = [part.strip() for part in token.split("/")]
    if len(parts) > 2 or any(not _EXACT_LITERAL.fullmatch(part) for part in parts):
        raise ValueError("矩阵元素仅支持有限整数、分数或小数字面量，不接受符号或可执行表达式。")
    for part in parts:
        exponent = re.search(r"[eE]([+-]?\d+)$", part)
        if exponent and abs(int(exponent.group(1))) > 100:
            raise ValueError("科学计数法的指数绝对值不能超过 100。")
    numbers = [sp.Rational(part) for part in parts]
    if len(numbers) == 2 and numbers[1] == 0:
        raise ValueError("矩阵分数字面量的分母不能为 0。")
    result = numbers[0] if len(numbers) == 1 else numbers[0] / numbers[1]
    if len(str(result)) > 256:
        raise ValueError("矩阵元素的精确分数过长，无法进行小规模精确求解。")
    return result


def _exact_matrix(value: Any) -> sp.Matrix:
    if isinstance(value, str):
        raw = value.strip().replace("，", ",").replace("；", ";")
        if len(raw) > 10000:
            raise ValueError("矩阵文本过长，无法进行小规模精确求解。")
        if ";" in raw and raw[:1] in "[(|" and raw[-1:] in "])|":
            body = re.sub(r"\s*/\s*", "/", raw[1:-1])
            value = [piece.split(",") if "," in piece else piece.split() for piece in body.split(";")]
        else:
            try:
                tree = ast.parse(raw, mode="eval").body
            except (ValueError, SyntaxError, RecursionError) as exc:
                raise ValueError("无法解析精确矩阵，请使用 [[1/3,0],[0,2]] 或 [1/3 0;0 2]。") from exc
            if not isinstance(tree, (ast.List, ast.Tuple)):
                raise ValueError("精确矩阵必须是嵌套列表或分号分行字面量。")
            value = []
            for row in tree.elts:
                if not isinstance(row, (ast.List, ast.Tuple)):
                    raise ValueError("矩阵每一行必须是列表。")
                value.append([
                    item.value if isinstance(item, ast.Constant) and isinstance(item.value, str)
                    else ast.get_source_segment(raw, item)
                    for item in row.elts
                ])
    if not isinstance(value, (list, tuple)) or not value:
        raise ValueError("缺少有效矩阵 A，请补充精确矩阵数据。")
    if any(not isinstance(row, (list, tuple)) or not row for row in value):
        raise ValueError("矩阵每一行必须是非空列表。")
    if len(value) > MAX_DIM or any(len(row) > MAX_DIM for row in value):
        raise ValueError(f"精确特征求解仅支持 {MAX_DIM} 阶以内的矩阵。")
    if any(len(row) != len(value) for row in value):
        raise ValueError("特征值与特征向量需要 n×n 方阵，请核对矩阵 A 的行数与列数。")
    return sp.Matrix([[_exact_number(item) for item in row] for row in value])


def _exact_matrix_a_text(text: str) -> str | None:
    named: dict[str, str] = {}
    anonymous: list[str] = []
    taken: list[tuple[int, int]] = []
    text = text.replace("，", ",")
    depth, start = 0, 0
    for index, char in enumerate(text):
        if char == "[":
            if depth == 0:
                start = index
            depth += 1
        elif char == "]" and depth:
            depth -= 1
            if depth == 0:
                taken.append((start, index + 1))
    if depth:
        taken.append((start, len(text)))
    for match in _BARS.finditer(text):
        if not any(start < match.end() and match.start() < end for start, end in taken):
            taken.append(match.span())
    for start, end in sorted(taken):
        name = re.search(r"([A-Za-z])\s*=\s*$", text[max(0, start - 8):start])
        if name:
            named[name.group(1).lower()] = text[start:end]
        else:
            anonymous.append(text[start:end])
    return named.get("a") or (anonymous[0] if anonymous else None)


def _exact_rows(matrix: sp.Matrix) -> list[list[str]]:
    return [[str(item) for item in row] for row in matrix.tolist()]


def _vectors_from_text(text: str) -> dict[str, list[float]]:
    vectors: dict[str, list[float]] = {}
    for match in re.finditer(
        r"([A-Za-z])\s*=\s*[\(\[]\s*(-?\d+(?:\.\d+)?(?:\s*[,，、\s]\s*-?\d+(?:\.\d+)?)+)\s*[\)\]]",
        text,
    ):
        values = [_num_token(item) for item in re.split(r"[,，、\s]+", match.group(2).strip()) if item]
        if values and all(value is not None for value in values):
            vectors[match.group(1)] = [float(v) for v in values if v is not None]
    return vectors


def _coerce_matrix(value: Any) -> list[list[float]] | None:
    """condition_values / 模型字段里的矩阵：list 或字面量字符串。"""

    if isinstance(value, (list, tuple)) and value:
        try:
            rows = [[float(item) for item in row] for row in value]  # type: ignore[union-attr]
        except (TypeError, ValueError):
            return None
        if rows and all(len(row) == len(rows[0]) for row in rows):
            return rows
        return None
    if isinstance(value, str):
        return _literal_matrix(value) or _semicolon_matrix(value)
    return None


def _coerce_vector(value: Any) -> list[float] | None:
    if isinstance(value, (list, tuple)) and value:
        try:
            return [float(item) for item in value]
        except (TypeError, ValueError):
            return None
    if isinstance(value, str):
        numbers = [_num_token(item) for item in re.split(r"[,，、\s;；]+", value.strip("[]()（） ")) if item]
        if numbers and all(item is not None for item in numbers):
            return [float(item) for item in numbers if item is not None]
    return None


# ---------------------------------------------------------------------------
# 中文方程组解析
# ---------------------------------------------------------------------------

_SUBSCRIPT = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")
_EQUATION = re.compile(r"[^\s，,。；;、=＝（）(){}\[\]<>〈〉]+=[^\s，,。；;、=＝（）(){}\[\]<>〈〉]+")


def _linear_poly(expr: str) -> tuple[dict[str, float], float] | None:
    """把 ``2x-y+3`` 解析成 ({x:2, y:-1}, 3)；非线性项返回 None。"""

    text = expr.strip().translate(_SUBSCRIPT).replace("−", "-").replace("·", "*").replace(" ", "")
    # 剥掉等式两端可能粘着的中文说明文字（如“解方程组：2x+y”“8的解”）。
    text = re.sub(r"^[^+\-0-9A-Za-z]+|[^0-9A-Za-z]+$", "", text)
    if not text:
        return None
    terms = re.findall(r"[+-]?[^+-]+", text)
    if not terms:
        return None
    coeffs: dict[str, float] = {}
    const = 0.0
    for term in terms:
        match = re.fullmatch(r"([+-]?(?:\d+(?:\.\d+)?(?:/\d+(?:\.\d+)?)?)?)\*?([A-Za-z]\d*)", term)
        if match:
            coef_raw, var = match.groups()
            coef = 1.0 if coef_raw in ("", "+") else -1.0 if coef_raw == "-" else _num_token(coef_raw)
            if coef is None:
                return None
            coeffs[var] = coeffs.get(var, 0.0) + coef
            continue
        if re.fullmatch(r"[+-]?\d+(?:\.\d+)?(?:/\d+(?:\.\d+)?)?", term):
            value = _num_token(term)
            if value is None:
                return None
            const += value
            continue
        return None
    return coeffs, const


def _equation_system(text: str) -> tuple[list[list[float]], list[float], list[str]] | None:
    """从文本中提取等式，组成系数矩阵 A、右端 b 与变量名顺序。"""

    rows: list[dict[str, float]] = []
    rhs: list[float] = []
    variables: list[str] = []
    for match in _EQUATION.finditer(text):
        if match.group(0).count("=") != 1:
            continue
        lhs, rhs_text = match.group(0).split("=", 1)
        left = _linear_poly(lhs)
        right = _linear_poly(rhs_text)
        if left is None or right is None:
            continue
        order = list(left[0].keys()) + [var for var in right[0] if var not in left[0]]
        coeffs = {var: left[0].get(var, 0.0) - right[0].get(var, 0.0) for var in order}
        coeffs = {var: value for var, value in coeffs.items() if abs(value) > EPS}
        if not coeffs:
            continue
        for var in coeffs:
            if var not in variables:
                variables.append(var)
        rows.append(coeffs)
        rhs.append(right[1] - left[1])
    if len(rows) < 2 or len(variables) < 2 or len(variables) > MAX_DIM or len(rows) > MAX_DIM + 1:
        return None
    if all(re.fullmatch(r"x\d+", var) for var in variables):
        variables.sort(key=lambda name: int(name[1:]))
    matrix = [[row.get(var, 0.0) for var in variables] for row in rows]
    return matrix, rhs, variables


# ---------------------------------------------------------------------------
# 任务判定
# ---------------------------------------------------------------------------


def _unsupported_goal(text: str) -> str | None:
    if re.search(r"对角化|diagonali[sz]", text, re.I):
        return "diagonalization"
    if re.search(r"若尔当标准形|约当标准形|jordan\s+(?:(?:normal|canonical)\s+)?form", text, re.I):
        return "jordan_form"
    if re.search(r"广义特征|generalized\s+eigen", text, re.I):
        return "generalized_eigen"
    if re.search(r"谱分解|特征分解|spectral\s+decomposition|eigendecomposition", text, re.I):
        return "spectral_decomposition"
    if re.search(r"奇异值分解|\bsvd\b", text, re.I):
        return "svd"
    return None


def _detect_kind(text: str, has_equations: bool) -> str | None:
    lowered = text.lower()
    unsupported = _unsupported_goal(text)
    if unsupported:
        return unsupported
    if re.search(r"特征值|特征向量|特征根|特征空间|eigen", lowered):
        return "eigen"
    if re.search(r"逆矩阵|逆阵|inverse|a\s*\^\s*\{?\s*-\s*1\s*\}?|a⁻¹|a\b\s*的逆", lowered):
        return "inverse"
    if re.search(r"行列式|determinant|\bdet\b|\|\s*a\s*\||\bdet\s*\(|可逆|奇异", lowered):
        return "determinant"
    if re.search(r"方程组|线性方程|消元|gauss|a\s*x\s*=\s*b", lowered):
        return "linear_system"
    if has_equations and re.search(r"解|求|solve", lowered):
        return "linear_system"
    if re.search(r"数乘|k\s*a\b|λ|lambda|[-+]?\d+(?:\.\d+)?\s*[·×*]?\s*a\b", lowered):
        return "matmul"
    if re.search(r"a\s*[+＋]\s*b\b|矩阵.*?(相加|求和|的和)", lowered):
        return "matmul"
    if re.search(r"a\s*[-−]\s*b\b|矩阵.*?(相减|的差)", lowered):
        return "matmul"
    if re.search(r"a\s*[·×*]\s*b\b|a\s*b\b|矩阵.*(乘法|乘积|相乘|的积)|matrix", lowered):
        return "matmul"
    return None


def _detect_op(text: str) -> str:
    lowered = text.lower()
    if re.search(r"数乘|lambda|λ", lowered):
        return "scalar"
    scalar = re.search(r"([-+]?\d+(?:\.\d+)?)\s*[·×*]?\s*a\b(?!\s*[·×*+\-=]?\s*[a-df-z])", lowered)
    if scalar and not re.search(r"[+＋\-−]\s*b\b", lowered) and re.search(r"数乘|倍", lowered):
        return "scalar"
    if re.search(r"a\s*[+＋]\s*b\b", lowered):
        return "add"
    if re.search(r"a\s*[-−]\s*b\b", lowered):
        return "sub"
    return "mul"


def _scalar_from(text: str) -> float | None:
    match = re.search(r"k\s*=\s*(-?\d+(?:\.\d+)?(?:/\d+)?)", text, re.I)
    if match:
        return _num_token(match.group(1))
    match = re.search(r"(-?\d+(?:\.\d+)?)\s*(?:倍|·|\*|×)\s*矩阵?A?\b|数乘\s*(-?\d+(?:\.\d+)?)", text)
    if match:
        return _num_token(next(group for group in match.groups() if group))
    match = re.search(r"(-?\d+(?:\.\d+)?)\s*A\b", text)
    if match:
        return _num_token(match.group(1))
    return None


# ---------------------------------------------------------------------------
# 模型构建
# ---------------------------------------------------------------------------


def _param(parameter_id: str, label: str, kind: str, **extra: Any) -> dict[str, Any]:
    payload = {"id": parameter_id, "label": label, "kind": kind, "min": extra.get("min_value"),
               "max": extra.get("max_value"), "step": extra.get("step"), "options": list(extra.get("options") or [])}
    if extra.get("note"):
        payload["note"] = extra["note"]
    return payload


def _condition(condition_id: str, label: str, value: Any, *, kind: str = "text",
               provenance: str = "original", source: Mapping[str, Any] | None = None,
               editable: bool = True, note: str | None = None) -> dict[str, Any]:
    payload = {"id": condition_id, "label": label, "value": value, "kind": kind, "unit": "",
               "provenance": provenance, "source": dict(source or {}), "editable": editable,
               "options": [], "min": None, "max": None, "step": None}
    if note:
        payload["note"] = note
    return payload


def _ambiguity(ambiguity_id: str, field: str, question: str,
               options: Sequence[Mapping[str, str]] | None = None) -> dict[str, Any]:
    return {"id": ambiguity_id, "field": field, "question": question, "severity": "blocking",
            "options": [dict(item) for item in (options or [])], "resolved": False, "answer": None}


def build_linalg(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any]:
    """识别线性代数题目并生成可执行模型；数据缺失时给出阻塞问题，不编造矩阵。"""

    merged = {**dict(overrides.get("condition_values") or {}),
              **dict(overrides.get("ambiguity_answers") or {}),
              **dict(overrides or {})}
    ambiguities: list[dict[str, Any]] = []
    conditions: list[dict[str, Any]] = []
    equations = _equation_system(text)
    kind = (_unsupported_goal(text) or str(merged.get("la_kind") or "").strip()
            or _detect_kind(text, equations is not None))
    exact_a = None
    eigen_input_error = ""
    if kind == "eigen":
        matrix_a, matrix_b, vector_b = None, None, None
        try:
            raw_a = merged["matrix_a"] if "matrix_a" in merged else _exact_matrix_a_text(text)
            exact_matrix = _exact_matrix(raw_a)
            exact_a = _exact_rows(exact_matrix)
            matrix_a = [[float(item) for item in row] for row in exact_matrix.tolist()]
        except ValueError as exc:
            eigen_input_error = str(exc)
    else:
        named, anonymous = _matrices_from_text(text)
        vectors = _vectors_from_text(text)
        matrix_a = _coerce_matrix(merged.get("matrix_a")) or named.get("A") or named.get("a")
        matrix_b = _coerce_matrix(merged.get("matrix_b")) or named.get("B") or named.get("b")
        if matrix_a is None and anonymous:
            matrix_a = anonymous[0]
            if len(anonymous) > 1 and matrix_b is None:
                matrix_b = anonymous[1]
        vector_b = _coerce_vector(merged.get("vector_b")) or vectors.get("b") or vectors.get("B")
    op = str(merged.get("op") or "").strip() or _detect_op(text)
    # 只有一个矩阵且有 kA 写法时按数乘：_detect_op 要求"数乘/倍"字样，"求3A"会误判为乘法。
    if (kind == "matmul" and op == "mul" and matrix_b is None
            and re.search(r"[-+]?\d+(?:\.\d+)?\s*[·×*]?\s*a\b", text.lower())):
        op = "scalar"
    scalar = merged.get("scalar")
    try:
        scalar = float(scalar) if scalar is not None and str(scalar).strip() != "" else None
    except (TypeError, ValueError):
        scalar = None
    if scalar is None and op == "scalar":
        scalar = _scalar_from(text)

    # 方程组：优先使用显式矩阵字面量，其次用解析出的方程。
    variables: list[str] = []
    if kind == "linear_system":
        if equations is not None and (matrix_a is None or vector_b is None):
            eq_a, eq_b, variables = equations
            matrix_a = matrix_a or eq_a
            vector_b = vector_b or eq_b
        elif matrix_a is not None and vector_b is None:
            # 单列增广矩阵写法：n×(n+1) 的最后一列作为 b。
            if _square(matrix_a) is False and all(len(row) == len(matrix_a) + 1 for row in matrix_a):
                vector_b = [row[-1] for row in matrix_a]
                matrix_a = [row[:-1] for row in matrix_a]
        if equations is not None and not variables:
            variables = equations[2]
        if not variables and matrix_a is not None:
            width = len(matrix_a[0]) if matrix_a else 0
            variables = [f"x{i + 1}" for i in range(width)]

    if kind is None:
        kind = "linear_system" if equations is not None else (
            "matmul" if matrix_b is not None else "determinant" if matrix_a is not None else "linear_system"
        )
        ambiguities.append(_ambiguity(
            "la_kind", "la_kind",
            "已识别为线性代数内容，但没有确定任务：求解方程组、计算行列式、求逆矩阵还是矩阵运算？",
            options=[{"value": key, "label": label} for key, label in _KIND_LABELS.items()],
        ))

    if kind not in _KIND_LABELS:
        ambiguities.append(_ambiguity(
            "la_unsupported", "la_kind",
            f"任务 {kind} 暂无本地确定内核；对角化、标准形等目标不能用特征值结果冒充完成。",
        ))
    if eigen_input_error:
        ambiguities.append(_ambiguity("matrix_a", "matrix_a", eigen_input_error))

    if kind == "matmul":
        if op == "mul" and (matrix_a is None or matrix_b is None):
            ambiguities.append(_ambiguity(
                "matrix_ab", "matrix_b",
                "矩阵乘法需要两个矩阵 A 与 B，当前没有识别齐全。请补写形如 B=[[1,2],[3,4]] 的数据。",
            ))
        elif op in ("add", "sub") and (matrix_a is None or matrix_b is None):
            ambiguities.append(_ambiguity(
                "matrix_ab", "matrix_b", "矩阵加减需要同形的 A 与 B，请补齐缺失的矩阵。",
            ))
        elif op == "scalar" and matrix_a is None:
            ambiguities.append(_ambiguity("matrix_a", "matrix_a", "数乘需要一个矩阵 A，请补写矩阵数据。"))
        if op == "scalar" and scalar is None:
            scalar = 2.0
            ambiguities.append(_ambiguity(
                "scalar", "scalar", "没有识别到数乘系数 k。默认按 k=2 演示，可在条件中修正。",
                options=[{"value": "2", "label": "k=2"}, {"value": "3", "label": "k=3"},
                         {"value": "-1", "label": "k=-1"}, {"value": "0.5", "label": "k=0.5"}],
            ))
    else:
        if matrix_a is None and not eigen_input_error:
            ambiguities.append(_ambiguity(
                "matrix_a", "matrix_a",
                "没有识别到矩阵数据。请按 A=[[1,2],[3,4]] 或逐行写方程组的形式补全题目。",
            ))
        if kind == "linear_system" and vector_b is None and matrix_a is not None:
            ambiguities.append(_ambiguity(
                "vector_b", "vector_b",
                "方程组缺少右端向量 b。可写成 b=[3,1]，或直接用 n×(n+1) 增广矩阵。",
            ))

    if kind in ("determinant", "inverse") and matrix_a is not None and not _square(matrix_a):
        ambiguities.append(_ambiguity(
            "matrix_layout_ambiguity", "matrix_a",
            "行列式或逆矩阵需要方阵；当前行列数不一致。请核对每个元素并补全列分隔符，不会自动将多位数拆成多个元素。",
        ))

    for matrix, name in ((matrix_a, "A"), (matrix_b, "B")):
        if matrix is not None and (
            len(matrix) > MAX_DIM or any(len(row) > MAX_DIM + (1 if kind == "linear_system" else 0) for row in matrix)
        ):
            ambiguities.append(_ambiguity(
                "matrix_size", f"matrix_{name.lower()}",
                f"矩阵 {name} 超过 {MAX_DIM} 阶；为保证逐步轨迹可读，首版仅支持 {MAX_DIM} 阶以内。",
            ))

    params: list[dict[str, Any]] = []
    if kind == "matmul":
        if op == "mul":
            params.append(_param("order", "乘积顺序", "enum", options=["ab", "ba"],
                                 note="交换顺序可对照矩阵乘法不满足交换律。"))
        if op == "scalar":
            params.append(_param("scalar", "数乘系数 k", "number", min_value=-9, max_value=9, step=0.5))
        defaults: dict[str, Any] = {"order": "ab", "scalar": scalar if scalar is not None else 2.0}
        engine = "matmul_v1"
    elif kind == "eigen":
        defaults = {}
        engine = "gauss_v1"
    else:
        if kind in ("linear_system", "inverse"):
            params.append(_param("method", "消元方式", "enum", options=["gauss", "jordan"],
                                 note="高斯消元化上三角后回代；高斯-若尔当一步化到行最简形。"))
        params.append(_param("pivoting", "主元策略", "enum", options=["partial", "none"],
                             note="部分主元每列选绝对值最大者换到主行（更稳定）；不选主元按顺序取第一个非零者。"))
        defaults = {"method": "gauss", "pivoting": "partial"}
        engine = "gauss_v1"

    model = {
        "engine": engine,
        "subject": "linear_algebra",
        "la_kind": kind,
        "op": op if kind == "matmul" else None,
        "matrix_a": matrix_a,
        "matrix_b": matrix_b,
        "vector_b": vector_b,
        "variables": variables,
        "defaults": defaults,
        "params": params,
        "teaching": False,
    }

    if kind == "eigen":
        model.update(matrix_a_exact=exact_a, eigen_input_error=eigen_input_error)
    if matrix_a is not None:
        matrix_text = ("[[" + "], [".join(", ".join(row) for row in exact_a) + "]]") if exact_a else _mat_text(matrix_a)
        conditions.append(_condition("matrix_a", "系数矩阵 A", matrix_text, source=source,
                                     note="写法 A=[[1,2],[3,4]] 或 A=[1 2;3 4]；修正后重新求解。"))
    if matrix_b is not None:
        conditions.append(_condition("matrix_b", "矩阵 B", _mat_text(matrix_b), source=source))
    if vector_b is not None:
        conditions.append(_condition("vector_b", "右端向量 b", ", ".join(_fmt(v) for v in vector_b), source=source))
    if kind == "matmul" and op == "scalar":
        conditions.append(_condition("scalar", "数乘系数 k", scalar, kind="number", source=source,
                                     provenance="original" if merged.get("scalar") is not None else "supplement"))

    formulas = [{
        "id": "gauss_rule",
        "tex": r"R_i \leftarrow R_i - \dfrac{a_{ij}}{a_{jj}} R_j,\quad \det(A)=(-1)^{s}\prod_j a_{jj}^{(j)}",
        "plain": "高斯消元：换行记一次变号，主元乘积给出行列式；回代得到解向量。",
        "role": "消元规则",
    }]
    if kind == "eigen":
        formulas = [{
            "id": "eigen_rule", "tex": r"p(\lambda)=\det(\lambda I-A)=0,\quad E_\lambda=\ker(A-\lambda I),\quad Av=\lambda v",
            "plain": "求特征多项式的根，再求对应齐次方程组的零空间基，并精确代回核对。",
            "role": "特征值与特征空间",
        }]

    return {
        "model": model,
        "conditions": conditions,
        "ambiguities": ambiguities,
        "formulas": formulas,
        "recognized": not ambiguities,
    }


# ---------------------------------------------------------------------------
# 消元轨迹（高斯 / 高斯-若尔当）
# ---------------------------------------------------------------------------


def _record(frames: list[dict[str, Any]], w: list[list[Any]], *, action: str,
            label: str, detail: str, line: int, **values: Any) -> None:
    snapshot = [row[:] for row in w]
    payload = {"matrix": snapshot, **values}
    frames.append({"index": len(frames), "action": action, "label": label,
                   "detail": detail, "values": payload, "pseudocodeLine": line})


def _eliminate(w: list[list[float]], n: int, *, method: str, pivoting: str,
               frames: list[dict[str, Any]], aug: int = 0) -> tuple[float, bool]:
    """对前 n 列做主元消元；返回 (行列式带号乘积, 是否奇异)。"""

    det = 1.0
    for col in range(n):
        if pivoting == "partial":
            pivot_row = max(range(col, n), key=lambda r: abs(w[r][col]))
        else:
            pivot_row = next((r for r in range(col, n) if abs(w[r][col]) > EPS), -1)
        if pivot_row < 0 or abs(w[pivot_row][col]) <= EPS:
            _record(frames, w, action="singular", label=f"第 {col + 1} 列找不到非零主元",
                    detail="该列在主行及以下全为 0，矩阵奇异；方程组无唯一解，逆矩阵/行列式结论随之确定。",
                    line=2, pivot={"row": col, "col": col}, aug=aug)
            return det, True
        if pivot_row != col:
            w[col], w[pivot_row] = w[pivot_row], w[col]
            det = -det
            _record(frames, w, action="swap", label=f"交换 R{pivot_row + 1} ↔ R{col + 1}",
                    detail=f"把绝对值最大的主元 { _fmt(w[col][col]) } 换到第 {col + 1} 行；行列式变号。",
                    line=2, rows=[pivot_row, col], pivot={"row": col, "col": col}, aug=aug)
        pivot = w[col][col]
        _record(frames, w, action="pivot", label=f"第 {col + 1} 列主元 = {_fmt(pivot)}",
                detail="以该元素为主元，把同列其它元素消为 0。", line=2,
                pivot={"row": col, "col": col}, aug=aug)
        if method == "jordan" and abs(pivot - 1.0) > EPS:
            w[col] = [value / pivot for value in w[col]]
            _record(frames, w, action="scale", label=f"R{col + 1} ← R{col + 1} ÷ {_fmt(pivot)}",
                    detail="若尔当法先把主元化为 1，再消上下两方向。", line=3,
                    rows=[col], pivot={"row": col, "col": col}, aug=aug)
        det *= pivot
        targets = (r for r in range(n) if r != col) if method == "jordan" else range(col + 1, n)
        for r in targets:
            if abs(w[r][col]) <= EPS:
                continue
            factor = w[r][col] / w[col][col]
            w[r] = [w[r][c] - factor * w[col][c] for c in range(len(w[r]))]
            _record(frames, w, action="eliminate",
                    label=f"R{r + 1} ← R{r + 1} − ({_fmt(factor)})·R{col + 1}",
                    detail=f"消去第 {r + 1} 行第 {col + 1} 列元素；行列式不变。",
                    line=3, rows=[r], factor=factor, pivot={"row": col, "col": col}, aug=aug)
    return det, False


def _eval_gauss(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    kind = str(model.get("la_kind") or "linear_system")
    a = _coerce_matrix(model.get("matrix_a"))
    b = _coerce_vector(model.get("vector_b"))
    defaults = model.get("defaults") or {}
    method = str(params.get("method") or defaults.get("method") or "gauss")
    pivoting = str(params.get("pivoting") or defaults.get("pivoting") or "partial")
    variables = [str(v) for v in (model.get("variables") or [])]

    reason = ""
    if kind not in ("linear_system", "determinant", "inverse"):
        reason = f"{_KIND_LABELS.get(kind, kind)}暂无本地确定内核；已识别的矩阵保留供核对。"
    if kind in ("determinant", "inverse") and not _square(a):
        reason = f"{_KIND_LABELS[kind]}需要 n×n 方阵，请核对矩阵 A 的行数与列数。"
    if kind == "linear_system":
        if not a or not _square(a):
            reason = "线性方程组的系数矩阵需要 n×n 方阵；可在条件中以增广矩阵补充最后一列。"
        elif not b or len(b) != len(a):
            reason = "右端向量 b 的长度须与矩阵阶数一致。"
    if a and (len(a) > MAX_DIM or any(len(row) > MAX_DIM + 1 for row in a)):
        reason = f"首版仅支持 {MAX_DIM} 阶以内的矩阵，保证逐步轨迹可读。"
    if reason:
        return {"subject": "linear_algebra", "engine": "gauss_v1", "la_kind": kind, "status": "blocked",
                "reason": reason, "headline": reason, "trace": [], "frames": [], "checks": [], "metrics": [],
                "matrix_a": a, "vector_b": b, "pseudocode": PSEUDOCODE}

    assert a is not None
    n = len(a)
    if kind == "linear_system":
        w = [a[i] + [b[i]] for i in range(n)]  # type: ignore[index]
        aug = 1
    elif kind == "inverse":
        w = [a[i] + [1.0 if j == i else 0.0 for j in range(n)] for i in range(n)]
        aug = n
    else:
        w = _clone(a)
        aug = 0

    frames: list[dict[str, Any]] = []
    title = {"linear_system": "增广矩阵 [A|b]", "inverse": "增广矩阵 [A|I]", "determinant": "矩阵 A"}[kind]
    _record(frames, w, action="initial", label=f"写出{title}",
            detail="消元轨迹从此矩阵开始；每一步行变换都记录在内。",
            line=1, aug=aug, det=1.0)

    det_signed, singular = _eliminate(w, n, method=method if kind != "determinant" else "gauss",
                                      pivoting=pivoting, frames=frames, aug=aug)

    solution: list[float | None] = [None] * n
    det_value = det_signed
    answer = ""
    answer_vector: list[float] | None = None

    if singular:
        if kind == "determinant":
            # 奇异即 det=0——行列式题的合法确定答案（"是否可逆"也由此判定）。
            det_value = 0.0
            answer = "det(A) = 0"
            headline = "det(A) = 0（矩阵奇异）"
            _record(frames, w, action="result", label="结果",
                    detail="存在全零主元列：det(A)=0，矩阵不可逆。",
                    line=5, aug=aug, det=0.0, solution=solution)
            checks = [{"id": "singular", "label": "主元检查", "status": "pass",
                       "detail": "某列在主行及以下全为 0，行列式确定为零。"}]
        else:
            _record(frames, w, action="result", label="无法继续",
                    detail="矩阵在该主元策略下奇异；结论与轨迹均保留供核对。",
                    line=5, aug=aug, det=det_value, solution=solution)
            headline = "矩阵奇异，无唯一解"
            checks = [{"id": "singular", "label": "主元检查", "status": "fail",
                       "detail": "某列在主行及以下全为 0；可换主元策略或核对原题数据。"}]
    else:
        if kind == "determinant":
            _record(frames, w, action="eliminated", label="已化为上三角矩阵",
                    detail="行列式 = 换行次数的符号 × 主对角线主元乘积。", line=4, aug=aug, det=det_value)
            answer = f"det(A) = {_fmt(det_value)}"
            headline = answer
        elif kind == "inverse":
            if method == "gauss":
                # 前向消元后还需向上消元并归一主行，才能得到 [I|A⁻¹]。
                _record(frames, w, action="eliminated", label="前向消元完成，继续向上消元",
                        detail="高斯法：先化上三角，再从下到上消去主元上方元素并归一。", line=4, aug=aug, det=det_value)
                for col in range(n - 1, -1, -1):
                    pivot = w[col][col]
                    if abs(pivot - 1.0) > EPS:
                        w[col] = [value / pivot for value in w[col]]
                        _record(frames, w, action="scale", label=f"R{col + 1} ← R{col + 1} ÷ {_fmt(pivot)}",
                                detail="归一主行，使对角线主元为 1。", line=4,
                                rows=[col], pivot={"row": col, "col": col}, det=det_value, aug=aug)
                    for r in range(col):
                        factor = w[r][col]
                        if abs(factor) <= EPS:
                            continue
                        w[r] = [w[r][c] - factor * w[col][c] for c in range(len(w[r]))]
                        _record(frames, w, action="eliminate",
                                label=f"R{r + 1} ← R{r + 1} − ({_fmt(factor)})·R{col + 1}",
                                detail="消去主元上方元素，左半向单位阵靠近。", line=4,
                                rows=[r], factor=factor, pivot={"row": col, "col": col}, det=det_value, aug=aug)
            else:
                _record(frames, w, action="eliminated", label="已化为行最简形 [I|A⁻¹]",
                        detail="若尔当法一次消完上下两个方向，右半即为逆矩阵。", line=4, aug=aug, det=det_value)
            inverse = [row[n:] for row in w]
            answer = f"A⁻¹ = {_mat_text(inverse)}"
            answer_vector = [item for row in inverse for item in row]
            headline = "右半矩阵即 A⁻¹"
        else:
            if method == "gauss":
                _record(frames, w, action="eliminated", label="上三角完成，开始回代",
                        detail="自下而上逐个求解：xᵢ = (bᵢ − Σaᵢⱼxⱼ) / aᵢᵢ。", line=4, aug=aug, det=det_value)
                for i in range(n - 1, -1, -1):
                    rest = sum(w[i][j] * (solution[j] or 0.0) for j in range(i + 1, n))
                    value = (w[i][n] - rest) / w[i][i]
                    solution[i] = value
                    _record(frames, w, action="back_sub",
                            label=f"{variables[i] if i < len(variables) else f'x{i + 1}'} = {_fmt(value)}",
                            detail=f"({ _fmt(w[i][n]) } − {_fmt(rest)}) ÷ {_fmt(w[i][i])}；已代入后行结果。",
                            line=4, rows=[i], solution=list(solution), det=det_value, aug=aug)
            else:
                solution = [w[i][n] for i in range(n)]
                _record(frames, w, action="rref", label="已化为行最简形，直接读出解",
                        detail="左半为单位阵，最后一列即解向量。", line=4, aug=aug,
                        solution=list(solution), det=det_value)
            answer_vector = [float(v) for v in solution if v is not None]
            names = variables or [f"x{i + 1}" for i in range(n)]
            answer = "，".join(f"{names[i]} = {_fmt(solution[i])}" for i in range(n))
            headline = f"x = ({', '.join(_fmt(v) for v in solution)})"
        _record(frames, w, action="result", label="结果", detail=answer or "计算完成。",
                line=5, aug=aug, det=det_value, solution=solution)

        if kind == "linear_system" and b:
            residuals = [sum(a[i][j] * (solution[j] or 0.0) for j in range(n)) - b[i] for i in range(n)]
            residual = math.sqrt(sum(value * value for value in residuals))
            checks = [{"id": "residual", "label": "残差 ‖Ax−b‖",
                       "status": "pass" if residual <= 1e-6 else "warn",
                       "detail": f"把解代回原方程，最大残差 {_fmt(residual, 3)}。"}]
        elif kind == "inverse":
            products = [[sum(a[i][k] * w[k][n + j] for k in range(n)) for j in range(n)] for i in range(n)]
            deviation = max(abs(products[i][j] - (1.0 if i == j else 0.0)) for i in range(n) for j in range(n))
            checks = [{"id": "inverse", "label": "乘积 A·A⁻¹≈I",
                       "status": "pass" if deviation <= 1e-6 else "warn",
                       "detail": f"最大偏差 {_fmt(deviation, 3)}。"}]
        else:
            checks = [{"id": "det_check", "label": "行列式符号",
                       "status": "pass", "detail": "只统计换行次数；倍加行变换不改变行列式。"}]

    metrics = [
        {"id": "size", "label": "规模", "value": f"{n}×{n}"},
        {"id": "det", "label": "det(A)", "value": _fmt(det_value)},
        {"id": "method", "label": "方法", "value": "高斯-若尔当" if method == "jordan" and kind != "determinant" else "高斯消元"},
        {"id": "pivoting", "label": "主元策略", "value": "部分主元" if pivoting == "partial" else "不选主元"},
    ]
    return {
        "subject": "linear_algebra", "engine": "gauss_v1", "la_kind": kind, "status": "ok",
        "method": method, "pivoting": pivoting, "matrix_a": a, "vector_b": b,
        "variables": variables, "frames": frames, "trace": frames, "pseudocode": PSEUDOCODE,
        "det": det_value, "solution": solution, "answer": answer, "answer_vector": answer_vector,
        "inverse": ([row[n:] for row in w] if kind == "inverse" and not singular else None),
        "headline": headline, "metrics": metrics, "checks": checks,
        "stop_reason": "singular" if singular else "done",
        "notes": ["行号从 1 开始；换行使行列式变号，倍加变换不变。", "若尔当法把主元先归一，再消上下两个方向。"],
    }


# ---------------------------------------------------------------------------
# 矩阵基本运算轨迹
# ---------------------------------------------------------------------------


def _eval_matop(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    a = _coerce_matrix(model.get("matrix_a"))
    b = _coerce_matrix(model.get("matrix_b"))
    op = str(model.get("op") or "mul")
    defaults = model.get("defaults") or {}
    order = str(params.get("order") or defaults.get("order") or "ab")
    try:
        scalar = float(params.get("scalar", defaults.get("scalar", 2.0)))
    except (TypeError, ValueError):
        scalar = 2.0

    reason = ""
    left, right = (a, b) if order != "ba" else (b, a)
    if op == "mul":
        if a is None or b is None:
            reason = "矩阵乘法需要两个矩阵 A 与 B。"
        elif len(a[0]) != len(b):
            reason = f"维度不匹配：A 是 {len(a)}×{len(a[0])}，B 是 {len(b)}×{len(b[0])}；要求 A 的列数等于 B 的行数。"
        elif len(a) * len(b[0]) > MAX_CELLS:
            reason = f"乘积超过 {MAX_CELLS} 个元素；首版逐步演示只支持小型矩阵。"
    elif op in ("add", "sub"):
        if a is None or b is None:
            reason = "矩阵加减需要两个同形矩阵。"
        elif len(a) != len(b) or len(a[0]) != len(b[0]):
            reason = "矩阵加减要求 A 与 B 形状完全相同。"
        elif len(a) * len(a[0]) > MAX_CELLS:
            reason = f"超过 {MAX_CELLS} 个元素；首版逐步演示只支持小型矩阵。"
    else:
        if a is None:
            reason = "数乘需要一个矩阵 A。"
        elif len(a) * len(a[0]) > MAX_CELLS:
            reason = f"超过 {MAX_CELLS} 个元素；首版逐步演示只支持小型矩阵。"
    if reason:
        return {"subject": "linear_algebra", "engine": "matmul_v1", "la_kind": "matmul", "op": op,
                "status": "blocked", "reason": reason, "headline": reason, "trace": [], "frames": [],
                "checks": [], "metrics": [], "matrix_a": a, "matrix_b": b, "pseudocode": []}

    assert a is not None
    frames: list[dict[str, Any]] = []
    if op == "mul":
        assert left is not None and right is not None
        rows, inner, cols = len(left), len(right), len(right[0])
        c: list[list[float | None]] = [[None] * cols for _ in range(rows)]
        _record(frames, c, action="initial",
                label=f"计算 {'A·B' if order != 'ba' else 'B·A'}：{len(left)}×{len(left[0])} · {len(right)}×{len(right[0])}",
                detail="结果每个元素 = 左矩阵一行与右矩阵一列逐项相乘再求和。",
                line=0, a=left, b=right, cell=None, terms=[], op_label="")
        for i in range(rows):
            for j in range(cols):
                terms = [left[i][k] * right[k][j] for k in range(inner)]
                value = sum(terms)
                c[i][j] = value
                op_label = " + ".join(
                    f"{_fmt(left[i][k])}·{_fmt(right[k][j])}" for k in range(inner)
                )
                _record(frames, c, action="element", label=f"C[{i + 1},{j + 1}] = {_fmt(value)}",
                        detail=f"第 {i + 1} 行 · 第 {j + 1} 列：{op_label} = {_fmt(value)}。",
                        line=0, a=left, b=right, cell={"row": i, "col": j},
                        terms=terms, op_label=f"{op_label} = {_fmt(value)}")
        answer = f"{'A·B' if order != 'ba' else 'B·A'} = {_mat_text(c)}"
        headline = f"乘积矩阵 {len(left)}×{len(right[0])} 已算出"
        answer_vector = [float(v) for row in c for v in row if v is not None]
    else:
        source = a
        rows, cols = len(source), len(source[0])
        c = [[None] * cols for _ in range(rows)]
        symbol = {"add": "+", "sub": "−", "scalar": "·"}[op]
        title = {"add": "A+B 逐元素相加", "sub": "A−B 逐元素相减", "scalar": f"{_fmt(scalar)}·A 数乘"}[op]
        _record(frames, c, action="initial", label=title,
                detail="矩阵逐元素运算；每个元素独立计算。",
                line=0, a=source, b=b if op in ("add", "sub") else None,
                cell=None, terms=[], op_label="")
        for i in range(rows):
            for j in range(cols):
                if op == "add":
                    value, op_label, terms = a[i][j] + b[i][j], f"{_fmt(a[i][j])} + {_fmt(b[i][j])}", [a[i][j], b[i][j]]  # type: ignore[index]
                elif op == "sub":
                    value, op_label, terms = a[i][j] - b[i][j], f"{_fmt(a[i][j])} − {_fmt(b[i][j])}", [a[i][j], b[i][j]]  # type: ignore[index]
                else:
                    value, op_label, terms = scalar * a[i][j], f"{_fmt(scalar)}·{_fmt(a[i][j])}", [scalar, a[i][j]]
                c[i][j] = value
                _record(frames, c, action="element", label=f"C[{i + 1},{j + 1}] = {_fmt(value)}",
                        detail=f"{op_label} = {_fmt(value)}。", line=0, a=source,
                        b=b if op in ("add", "sub") else None,
                        cell={"row": i, "col": j}, terms=terms, op_label=f"{op_label} = {_fmt(value)}")
        name = _OP_LABELS[op]
        answer = f"{name} = {_mat_text(c)}"
        headline = f"{title.split(' ')[0]} 已算出"
        answer_vector = [float(v) for row in c for v in row if v is not None]

    _record(frames, c, action="result", label="结果", detail=answer, line=0,
            a=left if op == "mul" else a, b=right if op == "mul" else (b if op in ("add", "sub") else None),
            cell=None, terms=[], op_label="")
    metrics = [
        {"id": "op", "label": "运算", "value": _OP_LABELS[op] + ("（已交换为 B·A）" if op == "mul" and order == "ba" else "")},
        {"id": "shape", "label": "结果形状", "value": f"{len(c)}×{len(c[0])}"},
        {"id": "cells", "label": "元素步数", "value": str(len(frames) - 2)},
    ]
    checks = [{"id": "shape", "label": "维度核对", "status": "pass",
               "detail": ("左矩阵列数 = 右矩阵行数，可乘。" if op == "mul"
                          else "同形矩阵逐元素运算。" if op in ("add", "sub") else "标量逐元素相乘。")}]
    return {
        "subject": "linear_algebra", "engine": "matmul_v1", "la_kind": "matmul", "op": op,
        "order": order, "scalar": scalar, "status": "ok", "matrix_a": a, "matrix_b": b,
        "frames": frames, "trace": frames, "pseudocode": [],
        "result_matrix": [[float(v) for v in row] for row in c],
        "answer": answer, "answer_vector": answer_vector, "headline": headline,
        "metrics": metrics, "checks": checks, "stop_reason": "done",
        "notes": ["矩阵乘法不满足交换律：A·B 与 B·A 一般不同。", "逐步帧展示每个元素的乘积求和过程。"],
    }


def _eigen_residual_zero(expression: sp.Expr, root: sp.Expr) -> sp.Expr:
    expression = sp.simplify(expression)
    if expression == 0 or not isinstance(root, sp.CRootOf):
        return expression
    variable = sp.Dummy("root")
    numerator, denominator = sp.fraction(sp.cancel(expression.xreplace({root: variable})))
    minimal = sp.Poly(root.poly.as_expr().subs(root.poly.gen, variable), variable, domain=sp.QQ)
    numerator = sp.Poly(numerator, variable, domain=sp.QQ).rem(minimal)
    denominator = sp.Poly(denominator, variable, domain=sp.QQ).rem(minimal)
    return sp.S.Zero if numerator.is_zero and not denominator.is_zero else expression


def _eval_eigen(model: Mapping[str, Any]) -> dict[str, Any]:
    frames: list[dict[str, Any]] = []
    checks: list[dict[str, Any]] = []
    result: dict[str, Any] = {
        "subject": "linear_algebra", "engine": "gauss_v1", "la_kind": "eigen",
        "status": "blocked", "matrix_a": None, "matrix_a_exact": None,
        "frames": frames, "trace": frames, "checks": checks, "metrics": [],
        "pseudocode": EIGEN_PSEUDOCODE, "eigenvalues": [],
    }
    try:
        if model.get("eigen_input_error"):
            raise ValueError(str(model["eigen_input_error"]))
        raw = model["matrix_a_exact"] if "matrix_a_exact" in model else model.get("matrix_a")
        a = _exact_matrix(raw)
        n = a.rows
        exact_a = _exact_rows(a)
        result.update(matrix_a_exact=exact_a, matrix_a=[[float(v) for v in row] for row in a.tolist()])
        _record(frames, exact_a, action="initial", label="写出精确矩阵 A",
                detail="直接按原始字面量构造有理数，不从浮点近似反推分数。", line=1)
        lam = sp.Symbol("lambda")
        polynomial = a.charpoly(lam)
        charpoly = {
            "expression": str(polynomial.as_expr()), "latex": sp.latex(polynomial.as_expr()),
            "variable": "lambda", "coefficients": [str(v) for v in polynomial.all_coeffs()],
            "convention": "det(lambda*I - A)",
        }
        result["charpoly"] = charpoly
        _record(frames, exact_a, action="charpoly", label="展开特征多项式",
                detail=f"p(λ)=det(λI−A)={charpoly['expression']}。", line=2, charpoly=charpoly)
        eigenspaces = a.eigenvects(error_when_incomplete=True)
        if sum(int(multiplicity) for _, multiplicity, _ in eigenspaces) != n:
            raise ValueError("精确特征根未求全；不能把部分结果作为完整答案。")
        roots = [{"value": str(value), "latex": sp.latex(value), "algebraic_multiplicity": int(multiplicity)}
                 for value, multiplicity, _ in eigenspaces]
        _record(frames, exact_a, action="eigenvalues", label="精确求根并记录代数重数",
                detail="；".join(f"λ={root['value']}，代数重数 {root['algebraic_multiplicity']}" for root in roots),
                line=3, eigenvalues=roots)
        eigenvalues = []
        for root_index, (value, multiplicity, basis) in enumerate(eigenspaces):
            if not basis or len(basis) > multiplicity:
                raise ValueError("未能求得完整有效的特征空间基。")
            basis = [vector.applyfunc(sp.simplify) for vector in basis]
            basis_text = [[str(v) for v in vector] for vector in basis]
            space = {
                **roots[root_index], "geometric_multiplicity": len(basis), "basis": basis_text,
                "basis_latex": [sp.latex(vector) for vector in basis], "verification": [],
            }
            basis_description = ", ".join("(" + ", ".join(vector) + ")" for vector in basis_text)
            _record(frames, _exact_rows(a - value * sp.eye(n)), action="eigenspace",
                    label=f"求 λ={value} 的特征空间",
                    detail=f"求解 (A−λI)v=0：E_λ=span{{{basis_description}}}；几何重数 {len(basis)}。",
                    line=4, eigenvalue=str(value), basis=basis_text,
                    algebraic_multiplicity=int(multiplicity), geometric_multiplicity=len(basis))
            for vector_index, vector in enumerate(basis):
                av = (a * vector).applyfunc(sp.simplify)
                lv = (value * vector).applyfunc(sp.simplify)
                residual = (av - lv).applyfunc(lambda v: _eigen_residual_zero(v, value))
                exact = all(v == 0 for v in residual) and any(v != 0 for v in vector)
                verification = {
                    "vector": basis_text[vector_index], "av": [str(v) for v in av],
                    "lambda_v": [str(v) for v in lv], "residual": [str(v) for v in residual], "exact": exact,
                }
                space["verification"].append(verification)
                check = {
                    "id": f"eigen_{root_index}_{vector_index}", "label": f"λ={value}，基向量 {vector_index + 1}：Av=λv",
                    "status": "pass" if exact else "fail",
                    "detail": f"Av={verification['av']}，λv={verification['lambda_v']}；精确残差 {verification['residual']}。",
                }
                checks.append(check)
                _record(frames, exact_a, action="verify_eigenvector", label=check["label"],
                        detail=check["detail"], line=5, eigenvalue=str(value), **verification)
                if not exact:
                    raise ValueError("无法确认 Av=λv 的精确零残差，特征结果暂不作为已完成答案。")
            eigenvalues.append(space)
        checks.append({"id": "multiplicity", "label": "代数重数之和", "status": "pass",
                       "detail": f"全部特征根的代数重数之和为 {n}，等于矩阵阶数。"})
        answer = "；".join(
            f"λ={space['value']}（代数重数 {space['algebraic_multiplicity']}，几何重数 {space['geometric_multiplicity']}），"
            + "特征空间基：" + ", ".join("(" + ", ".join(vector) + ")" for vector in space["basis"])
            for space in eigenvalues
        )
        _record(frames, exact_a, action="result", label="特征值与特征空间基", detail=answer, line=5,
                eigenvalues=eigenvalues)
        result.update(
            status="ok", eigenvalues=eigenvalues, answer=answer, answer_vector=None,
            headline=f"已精确求得 {len(eigenvalues)} 个不同特征值及其特征空间基", stop_reason="done",
            metrics=[{"id": "size", "label": "规模", "value": f"{n}×{n}"},
                     {"id": "roots", "label": "不同特征值", "value": str(len(eigenvalues))},
                     {"id": "method", "label": "方法", "value": "精确特征多项式与零空间"}],
            notes=["在复数域上给出特征空间基；基的非零线性组合即对应的全部特征向量。",
                   "小数按输入的十进制字面量精确解释；需要 1/3 时应直接输入分数。",
                   "本分支不求对角化变换矩阵、Jordan 标准形或广义特征向量。"],
        )
    except (ValueError, NotImplementedError, ArithmeticError, sp.polys.polyerrors.BasePolynomialError,
            sp.matrices.exceptions.MatrixError) as exc:
        reason = f"精确特征求解阻塞：{exc}"
        result.update(reason=reason, headline=reason, stop_reason="blocked")
    return result


def evaluate_linalg(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    if str(model.get("la_kind") or "") == "matmul":
        return _eval_matop(model, params)
    if str(model.get("la_kind") or "") == "eigen":
        return _eval_eigen(model)
    return _eval_gauss(model, params)


# ---------------------------------------------------------------------------
# 原题解答
# ---------------------------------------------------------------------------


def solve_linalg(model: Mapping[str, Any]) -> dict[str, Any]:
    kind = str(model.get("la_kind") or "linear_system")
    result = evaluate_linalg(model, model.get("defaults") or {})
    if result.get("status") != "ok":
        raise ValueError(result.get("reason") or "暂不能求解该线性代数题")
    # 行列式题奇异是合法结论（det=0/不可逆）；方程组与逆矩阵才需要报错。
    if result.get("stop_reason") == "singular" and kind != "determinant":
        raise ValueError("矩阵奇异：该题无唯一解或逆；可在实验室中查看消元轨迹定位奇异列。")

    frames = result["trace"]
    if kind == "eigen":
        return {
            "summary": "精确构造特征多项式 → 求全部特征根及代数重数 → 求各特征空间基及几何重数 → 精确核对 Av=λv。",
            "answer": result["answer"], "answer_vector": None, "answer_value": None,
            "solution_complete": True, "solution_status": "complete",
            "steps": [{"id": f"la_{frame['index']}", "title": frame["label"], "detail": frame["detail"]}
                      for frame in frames],
            "conditions": ["矩阵按整数、分数及十进制小数字面量精确解析。"],
            "limitations": result["notes"], "eigenvalues": result["eigenvalues"], "charpoly": result["charpoly"],
            "matrix_a_exact": result["matrix_a_exact"], "trace": frames,
            "checks": result["checks"], "pseudocode": result["pseudocode"],
        }
    index_of = {frame["action"]: frame["index"] for frame in frames}
    last = len(frames) - 1
    steps: list[dict[str, Any]] = []

    if kind == "linear_system":
        pivot_first = next((f["index"] for f in frames if f["action"] == "pivot"), last)
        eliminated = index_of.get("eliminated", last)
        steps = [
            {"id": "la_0", "title": "写出增广矩阵 [A|b]",
             "detail": "把系数与右端写成增广矩阵；所有后续步骤都作用在这张表上。"},
            {"id": f"la_{pivot_first}", "title": "选取主元并前向消元",
             "detail": "每列选绝对值最大的主元换到主行，再用倍加行变换把主元下方消为 0。"},
            {"id": f"la_{eliminated}", "title": "回代求解",
             "detail": "上三角化后自下而上：xᵢ = (bᵢ − Σaᵢⱼxⱼ)/aᵢᵢ；若尔当法则直接读最后一列。"},
            {"id": f"la_{last}", "title": "解与核对",
             "detail": f"{result['answer']}。把解代回残差 ‖Ax−b‖ 已核对。"},
        ]
        summary = "高斯消元：写出增广矩阵 → 选主元消元 → 回代（或行最简形）→ 代回核对。"
    elif kind == "determinant":
        steps = [
            {"id": "la_0", "title": "矩阵 A",
             "detail": "行列式用初等行变换计算；换行变号，倍乘行会使行列式同倍变化，倍加不变。"},
            {"id": f"la_{next((f['index'] for f in frames if f['action'] == 'pivot'), last)}",
             "title": "初等行变换化上三角",
             "detail": "每列选非零主元并向下消元；本例只用换行与倍加两类变换。"},
            {"id": f"la_{index_of.get('eliminated', last)}", "title": "读取主对角线",
             "detail": "det(A) = (−1)^(换行次数) × 主元乘积。"},
            {"id": f"la_{last}", "title": "结果", "detail": result["answer"]},
        ]
        summary = "行列式经初等行变换化为上三角后取主元乘积；轨迹记录每一次变号。"
    elif kind == "inverse":
        steps = [
            {"id": "la_0", "title": "写出 [A|I]",
             "detail": "对同样的行变换同时作用在 A 与单位阵 I 上。"},
            {"id": f"la_{next((f['index'] for f in frames if f['action'] == 'pivot'), last)}",
             "title": "消元把左半化为 I",
             "detail": "主元消元 + 归一主行；左半变 I 时，右半自动成为 A⁻¹。"},
            {"id": f"la_{index_of.get('eliminated', last)}", "title": "读出右半",
             "detail": "右半矩阵即 A⁻¹。"},
            {"id": f"la_{last}", "title": "核对 A·A⁻¹≈I",
             "detail": f"{result['answer']}；乘积核对通过。"},
        ]
        summary = "逆矩阵用高斯-若尔当消元：对 [A|I] 同步做行变换，左半化 I、右半即 A⁻¹。"
    else:
        first = next((f["index"] for f in frames if f["action"] == "element"), 1)
        steps = [
            {"id": "la_0", "title": "按维度核对",
             "detail": "乘法和加减都要先核对形状；数乘对全部元素同乘 k。"},
            {"id": f"la_{first}", "title": "逐元素计算",
             "detail": "每个结果元素逐项相乘/相加/数乘并求和。"},
            {"id": f"la_{last}", "title": "结果矩阵", "detail": result["answer"]},
        ]
        summary = "矩阵运算逐元素进行；乘法为行·列乘积求和，且一般 A·B ≠ B·A。"

    return {
        "summary": summary,
        "answer": result["answer"],
        "answer_vector": result.get("answer_vector"),
        "answer_value": result.get("det") if kind == "determinant" else None,
        "steps": steps,
        "conditions": ["矩阵数据来自题目识别条件；可在条件面板中修正后重建。"],
        "limitations": result.get("notes") or [],
    }


__all__ = ["PSEUDOCODE", "build_linalg", "evaluate_linalg", "solve_linalg"]

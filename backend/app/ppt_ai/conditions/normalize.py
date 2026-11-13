"""文本/公式/单位规范化：保留原文，同时生成可计算的规范值。"""

from __future__ import annotations

import math
import re
from typing import Any, Iterable

_UNICODE_MINUS = "\u2212"
_FORMULA_REPLACEMENTS = {
    "−": "-",
    "–": "-",
    "—": "-",
    "×": "*",
    "·": "*",
    "⋅": "*",
    "÷": "/",
    "≤": "<=",
    "≥": ">=",
    "＜": "<",
    "＞": ">",
    "，": ",",
    "；": ";",
    "（": "(",
    "）": ")",
    "【": "[",
    "】": "]",
    "“": '"',
    "”": '"',
    "′": "'",
    "″": '"',
}

_UNIT_ALIASES: tuple[tuple[re.Pattern[str], str, float], ...] = (
    (re.compile(r"km\s*/\s*h|千米\s*/\s*(?:小时|时)|公里\s*/\s*(?:小时|时)"), "m/s", 1000.0 / 3600.0),
    (re.compile(r"m\s*/\s*s\^?2|米\s*/\s*秒\s*(?:\^?2|平方)"), "m/s^2", 1.0),
    (re.compile(r"cm\s*/\s*s|厘米\s*/\s*秒"), "m/s", 0.01),
    (re.compile(r"mm\s*/\s*s|毫米\s*/\s*秒"), "m/s", 0.001),
    (re.compile(r"km\s*/\s*s|千米\s*/\s*秒"), "m/s", 1000.0),
    (re.compile(r"m\s*/\s*s|米\s*/\s*秒"), "m/s", 1.0),
    (re.compile(r"kN\s*/\s*m|千牛\s*/\s*米"), "N/m", 1000.0),
    (re.compile(r"N\s*/\s*m|牛\s*/\s*米"), "N/m", 1.0),
    (re.compile(r"^km$|千米|公里"), "m", 1000.0),
    (re.compile(r"^cm$|厘米"), "m", 0.01),
    (re.compile(r"^mm$|毫米"), "m", 0.001),
    (re.compile(r"^m$|米"), "m", 1.0),
    (re.compile(r"^kg$|千克|公斤"), "kg", 1.0),
    (re.compile(r"^g$|克"), "kg", 0.001),
    (re.compile(r"^h$|小时|时"), "s", 3600.0),
    (re.compile(r"min$|分钟|分"), "s", 60.0),
    (re.compile(r"^s$|秒"), "s", 1.0),
    (re.compile(r"^N$|牛"), "N", 1.0),
    (re.compile(r"°|度|deg(?:ree)?s?"), "deg", 1.0),
    (re.compile(r"rad|弧度"), "rad", 1.0),
)

_ALIASES: dict[str, tuple[str, ...]] = {
    "v0": ("v0", "v_0", "初速度", "初速", "初始速度", "initial velocity", "initial speed"),
    "x0": ("x0", "x_0", "初值", "起点", "初始点", "展开点", "初位移", "初始位移", "初始位置", "从位移", "center"),
    "y0": ("y0", "y_0", "初始高度", "离地高度", "高度", "initial height"),
    "angle_deg": ("angle", "仰角", "抛射角", "角度", "theta", "θ"),
    "g": ("g", "重力加速度", "gravity", "gravitational acceleration"),
    "t": ("t", "时间", "time", "at t"),
    "m": ("m", "质量", "mass"),
    "k": ("k", "劲度系数", "弹簧常数", "刚度", "spring constant", "stiffness"),
    "order": ("order", "阶数", "泰勒阶数", "展开阶数"),
    "x_eval": ("x_eval", "估计点", "求值点", "eval point", "evaluation point"),
    "ax": ("ax", "x 下限", "x下限", "x_min", "xmin"),
    "bx": ("bx", "x 上限", "x上限", "x_max", "xmax"),
    "ay": ("ay", "y 下限", "y下限", "y_min", "ymin"),
    "by": ("by", "y 上限", "y上限", "y_max", "ymax"),
    "nx": ("nx", "x 网格", "x网格"),
    "ny": ("ny", "y 网格", "y网格"),
    "stride": ("stride", "步长"),
    "padding": ("padding", "填充"),
    "capacity": ("capacity", "容量"),
    "upstream": ("upstream", "上游梯度", "反向梯度", "反向传播梯度", "传播梯度", "gradient upstream"),
    "activation": ("activation", "激活函数", "激活"),
    "algorithm": ("algorithm", "算法", "排序算法"),
    "mode": ("mode", "模式"),
    "matrix": ("matrix", "输入矩阵", "输入数据", "input matrix"),
    "kernel": ("kernel", "卷积核", "filter"),
    "initial": ("initial", "初始栈", "初始队列", "初始列表", "初始序列"),
    "values": ("values", "列表", "数组", "输入列表", "数据列表"),
    "xs": ("xs", "x 数据", "x数据", "x values"),
    "ys": ("ys", "y 数据", "y数据", "y values"),
    "operations": ("operations", "操作序列", "操作", "依次执行"),
    "expression": ("expression", "函数表达式", "表达式", "formula"),
    "max_iter": ("max_iter", "迭代次数", "最多迭代", "迭代", "最多", "步数"),
}

_KEY_BY_ALIAS: dict[str, str] = {
    alias.casefold().replace(" ", ""): key
    for key, aliases in _ALIASES.items()
    for alias in (key, *aliases)
}


def clean_text(text: Any) -> str:
    value = str(text or "")
    value = value.replace(_UNICODE_MINUS, "-")
    for source, target in _FORMULA_REPLACEMENTS.items():
        value = value.replace(source, target)
    return re.sub(r"[ \t\u3000]+", " ", value).strip()


def compact_text(text: Any) -> str:
    return re.sub(r"\s+", "", clean_text(text)).casefold()


def normalize_key(name: Any) -> str:
    raw = compact_text(name)
    if raw in _KEY_BY_ALIAS:
        return _KEY_BY_ALIAS[raw]
    stripped = re.sub(r"[^a-z0-9_α-ω]", "", raw)
    return stripped or raw


def to_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    text = clean_text(value)
    match = re.search(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?", text)
    if not match:
        return None
    try:
        number = float(match.group(0))
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def normalize_formula(text: Any) -> str:
    value = clean_text(text)
    value = value.replace("\\left", "").replace("\\right", "")
    value = value.replace("\\,", " ").replace("\\;", " ")
    value = re.sub(r"\\mathrm\{(.*?)\}", r"\1", value)
    value = value.replace("\\cdot", "*").replace("\\times", "*")
    value = re.sub(r"\s+", " ", value)
    return value.strip(" 。.;；")


def parse_double_integrand(text: Any) -> str | None:
    value = normalize_formula(text)
    if "∫∫" not in value and "二重积分" not in value:
        return None
    match = re.search(r"∫∫[_\s]*[A-Za-z]?\s*\(([^)]+)\)\s*d[xyA]", value)
    if match:
        return match.group(1).strip()
    match = re.search(r"∫∫[^\n]*?\s+([A-Za-z0-9^+\-*/().\s]+?)\s*d[xyA]", value)
    return match.group(1).strip() if match else None


def parse_expression(text: Any) -> str:
    value = normalize_formula(text)
    match = re.search(r"(?:f\s*\(\s*[A-Za-z]\s*\)|y)\s*=\s*(.+)$", value, re.I)
    if match:
        value = match.group(1).strip()
    value = re.split(r"[，,；;。]|的(?:极小|极大|极值|最值|点|解)|并(?:计算|求)|求(?:解|值)?", value, maxsplit=1)[0].strip()
    return value.strip(" .")


def normalize_quantity(value: float, unit: str) -> tuple[float, str, str]:
    """返回 ``(规范化数值, 规范单位, 换算说明)``；未知单位保持原值。"""
    raw_unit = clean_text(unit).strip()
    if not raw_unit:
        return float(value), "", ""
    compact = re.sub(r"\s+", "", raw_unit)
    for pattern, target, factor in _UNIT_ALIASES:
        if pattern.search(compact) or pattern.search(raw_unit):
            converted = float(value) * factor
            note = f"{value:g} {raw_unit} → {converted:g} {target}" if factor != 1.0 else ""
            return converted, target, note
    return float(value), raw_unit, ""


def parse_number_list(text: Any) -> list[float] | None:
    value = normalize_formula(text)
    candidates = re.findall(r"\[\s*(-?\d+(?:\.\d+)?(?:\s*[,;]\s*-?\d+(?:\.\d+)?)*)\s*\]", value)
    for candidate in candidates:
        numbers = [to_float(item) for item in re.split(r"[,;]", candidate)]
        if numbers and all(number is not None for number in numbers):
            return [float(number) for number in numbers if number is not None]
    match = re.search(r"(?:初始栈|初始队列|初始列表|列表|数组|输入)\s*[:：=]?\s*((?:-?\d+(?:\.\d+)?\s*[,，、;；]\s*){1,31}-?\d+(?:\.\d+)?)", value)
    if match:
        numbers = [to_float(item) for item in re.split(r"[,，、;；]", match.group(1))]
        if numbers and all(number is not None for number in numbers):
            return [float(number) for number in numbers if number is not None]
    return None


def parse_number_matrix(text: Any) -> list[list[float]] | None:
    value = normalize_formula(text)
    matches = re.findall(r"\[\s*\[.*?\]\s*\]", value)
    for candidate in matches:
        rows = re.findall(r"\[\s*(-?\d+(?:\.\d+)?(?:\s*[,;]\s*-?\d+(?:\.\d+)?)*)\s*\]", candidate)
        matrix: list[list[float]] = []
        for row in rows:
            numbers = [to_float(item) for item in re.split(r"[,;]", row)]
            if not numbers or any(number is None for number in numbers):
                matrix = []
                break
            matrix.append([float(number) for number in numbers if number is not None])
        if matrix and len({len(row) for row in matrix}) == 1:
            return matrix
    # LaTeX / 分号矩阵：[[1,2],[3,4]] 或 [1 2; 3 4]
    match = re.search(r"\[\s*(-?\d+(?:\.\d+)?(?:\s+|\s*,\s*))(-?\d+(?:\.\d+)?)\s*;\s*(-?\d+(?:\.\d+)?)(?:\s+|\s*,\s*)(-?\d+(?:\.\d+)?)\s*\]", value)
    if match:
        values = [to_float(item) for item in match.groups()]
        if all(item is not None for item in values):
            return [[float(values[0]), float(values[1])], [float(values[2]), float(values[3])]]  # type: ignore[arg-type]
    return None


def parse_pairs(text: Any) -> list[tuple[float, float]] | None:
    value = normalize_formula(text)
    pairs = re.findall(r"\(\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*\)", value)
    if not pairs:
        return None
    result: list[tuple[float, float]] = []
    for left, right in pairs:
        x, y = to_float(left), to_float(right)
        if x is None or y is None:
            return None
        result.append((x, y))
    return result or None


def _parse_bound(raw: str) -> float | None:
    value = raw.strip().replace("∞", "inf").replace("+inf", "inf")
    if value in ("inf", "+inf"):
        return math.inf
    if value in ("-inf", "-∞"):
        return -math.inf
    return to_float(value)


def parse_interval(text: Any, variable: str) -> tuple[float, float] | None:
    value = normalize_formula(text)
    variable_pattern = rf"{re.escape(variable)}"
    patterns = (
        rf"(-?\d+(?:\.\d+)?|[-+]?∞)\s*(?:<=|<)\s*{variable_pattern}\s*(?:<=|<)\s*(-?\d+(?:\.\d+)?|[-+]?∞)",
        rf"{variable_pattern}\s*(?:∈|in)\s*\[\s*(-?\d+(?:\.\d+)?|[-+]?∞)\s*,\s*(-?\d+(?:\.\d+)?|[-+]?∞)\s*\]",
        rf"{variable_pattern}\s*从\s*(-?\d+(?:\.\d+)?)\s*到\s*(-?\d+(?:\.\d+)?)",
        rf"{variable_pattern}\s*(?:范围|区间)\s*[:：]?\s*(-?\d+(?:\.\d+)?)\s*(?:到|~|-)\s*(-?\d+(?:\.\d+)?)",
    )
    for pattern in patterns:
        match = re.search(pattern, value, re.I)
        if match:
            low, high = _parse_bound(match.group(1)), _parse_bound(match.group(2))
            if low is not None and high is not None:
                return low, high
    return None


def parse_grid(text: Any) -> tuple[int, int] | None:
    value = normalize_formula(text)
    match = re.search(r"(\d{1,3})\s*[x×*]\s*(\d{1,3})\s*(?:网格|grid)?", value)
    if match:
        nx, ny = int(match.group(1)), int(match.group(2))
        if 1 <= nx <= 64 and 1 <= ny <= 64:
            return nx, ny
    return None


def parse_operations(text: Any) -> str | None:
    value = normalize_formula(text)
    match = re.search(r"(?:操作序列|依次执行|operations?)\s*[:：]?\s*(.+)$", value, re.I)
    candidate = match.group(1) if match else value
    tokens = re.findall(r"(?:push|pop|enqueue|dequeue|入栈|出栈|入队|出队)(?:\s*-?\d+(?:\.\d+)?)?", candidate, re.I)
    if not tokens:
        return None
    canonical = []
    for token in tokens:
        token = token.strip()
        token = re.sub(r"入栈", "push", token)
        token = re.sub(r"出栈", "pop", token)
        token = re.sub(r"入队", "enqueue", token)
        token = re.sub(r"出队", "dequeue", token)
        canonical.append(token)
    return "; ".join(canonical)


def detect_activation(text: Any) -> str | None:
    value = compact_text(text)
    if "relu" in value:
        return "relu"
    if "sigmoid" in value or "s型" in value:
        return "sigmoid"
    if "tanh" in value or "双曲正切" in value:
        return "tanh"
    return None


def detect_sort_algorithm(text: Any) -> str | None:
    value = compact_text(text)
    if "冒泡" in value or "bubble" in value:
        return "bubble"
    if "插入" in value or "insertion" in value:
        return "insertion"
    return None


def detect_pool_mode(text: Any) -> str | None:
    value = compact_text(text)
    if "最大池化" in value or "maxpool" in value or "maxpooling" in value:
        return "maxpool"
    if "平均池化" in value or "avgpool" in value or "averagepooling" in value:
        return "avgpool"
    if "卷积" in value or "conv" in value:
        return "conv"
    return None


def detect_mode(text: Any) -> str | None:
    value = compact_text(text)
    if "队列" in value or "queue" in value or "enqueue" in value or "dequeue" in value:
        return "queue"
    if "栈" in value or "stack" in value or "push" in value or "pop" in value:
        return "stack"
    return None


def parse_quantity_after(text: Any, labels: Iterable[str]) -> tuple[float, str] | None:
    value = normalize_formula(text)
    for label in labels:
        pattern = rf"{re.escape(label)}\s*(?:为|是|=|:)?\s*(-?\d+(?:\.\d+)?)\s*([A-Za-z/%^0-9·°]+)?"
        match = re.search(pattern, value, re.I)
        if match:
            number = to_float(match.group(1))
            if number is not None:
                return number, (match.group(2) or "").strip()
    return None


def scalar_assignments(text: Any) -> list[tuple[str, float, str, str]]:
    """提取 ``key = value unit`` 与中文物理量；返回 ``(key, value, unit, excerpt)``。"""
    value = normalize_formula(text)
    result: list[tuple[str, float, str, str]] = []
    seen: set[str] = set()
    pattern = re.compile(
        r"([A-Za-z_α-ω][A-Za-z0-9_]*|[\u4e00-\u9fff]{2,8})\s*=\s*(-?\d+(?:\.\d+)?)\s*([A-Za-z/%^0-9·°]+)?"
    )
    for match in pattern.finditer(value):
        key = normalize_key(match.group(1))
        number = to_float(match.group(2))
        if number is None or key in seen:
            continue
        seen.add(key)
        result.append((key, number, (match.group(3) or "").strip(), match.group(0)))
    # 中文叙述：初速度为 10 m/s / 质量 0.5 kg / 起点 x0 = 0.5
    for key, labels in _ALIASES.items():
        if key in seen:
            continue
        found = parse_quantity_after(value, labels)
        if found is None:
            continue
        number, unit = found
        seen.add(key)
        result.append((key, number, unit, f"{labels[0]} {number:g} {unit}".strip()))
    return result


def normalizes_to_si(key: str, value: float, unit: str) -> tuple[float, str, str]:
    target = {
        "v0": "m/s",
        "g": "m/s^2",
        "m": "kg",
        "k": "N/m",
        "t": "s",
        "x0": "m",
        "y0": "m",
        "t0": "s",
        "angle_deg": "deg",
        "x_eval": "",
        "upstream": "",
        "order": "",
        "max_iter": "",
        "stride": "",
        "padding": "",
        "capacity": "",
    }.get(key, "")
    if not target or not unit:
        return float(value), unit, ""
    if target == "deg" and re.search(r"rad|弧度", unit, re.I):
        converted = math.degrees(value)
        return converted, "deg", f"{value:g} rad → {converted:g} deg"
    converted, normalized_unit, note = normalize_quantity(value, unit)
    if normalized_unit and target and normalized_unit != target:
        # 只在同量纲下换算；未知单位保留原值并交给程序核验。
        compatible = {
            "m/s": {"m/s"},
            "m/s^2": {"m/s^2"},
            "kg": {"kg"},
            "N/m": {"N/m"},
            "s": {"s"},
            "m": {"m"},
            "deg": {"deg"},
        }
        if target in compatible and normalized_unit not in compatible[target]:
            return float(value), unit, ""
    return converted, (normalized_unit or target), note


__all__ = [
    "clean_text",
    "compact_text",
    "detect_activation",
    "detect_mode",
    "detect_pool_mode",
    "detect_sort_algorithm",
    "normalize_formula",
    "normalize_key",
    "normalize_quantity",
    "normalizes_to_si",
    "parse_double_integrand",
    "parse_expression",
    "parse_grid",
    "parse_interval",
    "parse_number_list",
    "parse_number_matrix",
    "parse_operations",
    "parse_pairs",
    "parse_quantity_after",
    "scalar_assignments",
    "to_float",
]

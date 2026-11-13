"""题目识别与统一模型编译（本地规则版）。

本模块只做三件事：

1. 把来源页拆成"一道完整题目"：题号切分、跨页续写合并、保留原页来源；
2. 按科目提取条件、公式、数据和可交互参数；关键条件无法确定时生成明确问题，
   而不是猜测后直接求解；
3. 生成四类确定性模型（微积分 / 最优化 / 数据结构与算法 / 深度学习）。

模型不使用模型生成的任意代码。表达式由 :mod:`app.labs.expr` 白名单解析；
题目未提供的数据使用 ``teaching`` / ``supplement`` 标记，原题文本始终保留。
"""

from __future__ import annotations

import ast
import math
import re
from typing import Any, Iterable, Mapping, Sequence

import sympy as sp

from .expr import ExprError, expression_text, parse_expression, safe_float, to_latex

SUBJECT_LABELS = {
    "calculus": "微积分",
    "optimization": "最优化",
    "algorithm": "数据结构与算法",
    "deep_learning": "深度学习",
    "linear_algebra": "线性代数",
    "operating_system": "操作系统",
    "unknown": "待选择",
}

SUBJECT_KEYWORDS: dict[str, tuple[tuple[str, int], ...]] = {
    "deep_learning": (
        ("神经网络", 8), ("反向传播", 8), ("损失函数", 7), ("softmax", 7),
        ("卷积", 6), ("激活函数", 6), ("多层感知", 7), ("mlp", 5),
        ("张量", 4), ("梯度下降", 2), ("权重", 3), ("偏置", 3), ("学习率", 2),
        ("neural network", 8), ("backprop", 8), ("loss function", 7),
        ("activation", 5), ("epoch", 4), ("tensor", 4),
    ),
    "algorithm": (
        ("大根堆", 9), ("小根堆", 9), ("最大堆", 9), ("最小堆", 9), ("堆顶", 8),
        ("广度优先", 8), ("bfs", 8), ("队列", 6), ("邻接", 5), ("图搜索", 7),
        ("最短路径", 7), ("遍历", 4), ("二叉", 5), ("算法", 3), ("节点", 3),
        ("边", 2), ("栈", 3), ("dfs", 5), ("复杂度", 4),
        ("breadth-first", 8), ("queue", 6), ("adjacency", 5),
        ("shortest path", 7), ("binary tree", 5), ("algorithm", 3),
    ),
    "calculus": (
        ("面积", 6), ("体积", 6), ("旋转体", 7), ("法线", 8), ("斜率", 5), ("隐函数", 7),
        ("定积分", 8), ("不定积分", 7), ("积分", 6), ("导数", 7), ("微分", 6),
        ("极限", 6), ("切线", 5), ("∫", 8), ("\\int", 8), ("曲边", 4),
        ("原函数", 6), ("d x", 3), ("dx", 3), ("连续", 2), ("间断点", 5),
        ("泰勒", 7), ("麦克劳林", 7), ("高阶导数", 7), ("单调区间", 8), ("单调", 5), ("微分方程", 9),
        ("级数", 9), ("幂级数", 9), ("傅里叶", 9), ("罗尔定理", 9), ("拉格朗日", 7),
        ("介值定理", 9), ("零点", 6), ("有根", 6),
        ("凹凸", 6), ("拐点", 6), ("渐近线", 6), ("函数研究", 8),
        ("integral", 8), ("derivative", 7), ("differentiate", 6),
        ("limit", 5), ("tangent", 5), ("antiderivative", 6),
    ),
    "optimization": (
        ("极值", 8), ("驻点", 6),
        ("梯度下降", 7), ("最小值", 6), ("最大值", 5), ("最优解", 7),
        ("目标函数", 8), ("约束", 6), ("初始点", 6), ("迭代", 5),
        ("收敛", 4), ("可行域", 5), ("学习率", 5), ("极小", 5), ("极大", 4),
        ("gradient descent", 8), ("minimum", 6), ("maximum", 5),
        ("optimal", 7), ("objective", 8), ("constraint", 6),
        ("learning rate", 6), ("initial point", 6), ("iteration", 5),
    ),
    "linear_algebra": (
        ("线性代数", 10), ("矩阵", 8), ("行列式", 9), ("逆矩阵", 9), ("逆阵", 8),
        ("线性方程组", 9), ("方程组", 6), ("增广矩阵", 8), ("高斯消元", 9), ("消元", 5),
        ("矩阵乘法", 8), ("矩阵运算", 7), ("数乘", 6), ("主元", 6), ("特征值", 4),
        ("matrix", 7), ("determinant", 8), ("inverse", 7), ("gauss", 7),
        ("linear system", 8), ("linear algebra", 9), ("matmul", 6),
    ),
    "operating_system": (
        ("操作系统", 10), ("进程调度", 10), ("作业调度", 9), ("cpu调度", 9), ("处理机调度", 9),
        ("先来先服务", 8), ("短作业优先", 9), ("最短剩余时间", 9), ("时间片轮转", 10), ("时间片", 8),
        ("周转时间", 9), ("带权周转", 9), ("等待时间", 6), ("到达时间", 7), ("服务时间", 6), ("甘特图", 7),
        ("进程", 7), ("优先级调度", 8),
        ("页面置换", 10), ("缺页", 9), ("页框", 8), ("物理块", 8), ("页面访问", 8), ("置换算法", 8),
        ("最佳置换", 9), ("最近最久", 9), ("页面走向", 9), ("引用串", 8),
        ("磁盘调度", 10), ("磁头", 8), ("寻道", 9), ("磁道", 8), ("柱面", 8), ("电梯算法", 9),
        ("银行家", 10), ("安全序列", 10), ("安全状态", 9), ("死锁", 8), ("allocation", 6), ("available", 5),
        ("operating system", 10), ("page fault", 9), ("page replacement", 10), ("round robin", 9),
        ("turnaround", 9), ("disk scheduling", 10), ("banker", 10), ("deadlock", 8),
        ("fcfs", 5), ("sjf", 7), ("srtf", 8), ("sstf", 8), ("c-scan", 7), ("lru", 5),
    ),
}

NUMBER_MARKER = re.compile(
    r"(?m)^\s*(?:第\s*)?([0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*[.、．:：)）]\s*"
)
NUMBER_WORDS = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
}
ALLOWED_ROLES = ("problem", "courseware", "data")
STOP_EXPR = r"(?=\s*(?:的|，|,|。|；|;|\n|求|其中|初始|起点|学习率|迭代|约束|满足|在点|目标|已知|$))"


class RecognitionError(ValueError):
    """无法形成任何可用题目。"""


# ---------------------------------------------------------------------------
# 来源与拆分
# ---------------------------------------------------------------------------


def _basic_source(page: Mapping[str, Any]) -> dict[str, Any]:
    text = str(page.get("text") or "")
    return {
        "file_id": page.get("file_id"),
        "page": page.get("page"),
        "excerpt": re.sub(r"\s+", " ", text).strip()[:220],
    }


def _page_labels(pages: Sequence[Mapping[str, Any]], files: Sequence[Mapping[str, Any]]) -> str:
    roles = {item.get("file_id"): str(item.get("role")) for item in files}
    kinds = {item.get("file_id"): str(item.get("kind")) for item in files}
    parts: list[str] = []
    for page in pages:
        role = roles.get(page.get("file_id"), "")
        kind = kinds.get(page.get("file_id"), "")
        if role == "problem":
            parts.append("题目")
        elif role == "data":
            parts.append("补充数据")
        elif role == "courseware":
            parts.append("课件")
        if kind == "pdf":
            parts.append("PDF")
        elif kind == "image":
            parts.append("图片")
        elif kind == "pptx":
            parts.append("PPTX")
    return " + ".join(dict.fromkeys(parts)) or "文本"


def _problem_pages(pages: Sequence[Mapping[str, Any]], files: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    roles = {item.get("file_id"): str(item.get("role")) for item in files}
    primary = [page for page in pages if roles.get(page.get("file_id")) == "problem" and str(page.get("text") or "").strip()]
    if primary:
        return primary
    courseware = [page for page in pages if roles.get(page.get("file_id")) == "courseware" and str(page.get("text") or "").strip()]
    if courseware:
        return courseware
    return [page for page in pages if roles.get(page.get("file_id")) in ("problem", "courseware", "data") and str(page.get("text") or "").strip()]


def _split_page(text: str) -> list[tuple[str | None, str]]:
    matches = list(NUMBER_MARKER.finditer(text))
    if not matches:
        cleaned = text.strip()
        return [(None, cleaned)] if cleaned else []
    parts: list[tuple[str | None, str]] = []
    # 题号前若有引导语（如“三、计算题”），并入第一题，避免丢失上下文。
    prefix = text[: matches[0].start()].strip()
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if index == 0 and prefix:
            body = f"{prefix}\n{body}"
        parts.append((match.group(1), body))
    return parts


def split_problems(
    pages: Sequence[Mapping[str, Any]],
    files: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """按题号拆分，并把后续无题号页面合并到上一题（跨页题干/图示）。"""

    relevant = _problem_pages(pages, files)
    if not relevant:
        raise RecognitionError("没有读到可用于识别的题目文字")
    marked = any(NUMBER_MARKER.search(str(page.get("text") or "")) for page in relevant)
    if not marked:
        text = "\n".join(str(page.get("text") or "").strip() for page in relevant).strip()
        first = relevant[0]
        last = relevant[-1]
        return [
            {
                "number": None,
                "text": text,
                "pages": list(relevant),
                "page_from": int(first.get("page") or 1),
                "page_to": int(last.get("page") or 1),
            }
        ]

    problems: list[dict[str, Any]] = []
    by_number: dict[str, dict[str, Any]] = {}
    for page in relevant:
        for number, segment in _split_page(str(page.get("text") or "")):
            if not segment.strip():
                continue
            if number is not None and number in by_number:
                # 同一题号出现在后续页：视为跨页续写，而不是新题。
                target = by_number[number]
                target["text"] = f"{target['text']}\n{segment}".strip()
                target["pages"].append(page)
                target["page_to"] = int(page.get("page") or target["page_to"])
                continue
            if number is None and problems:
                # 没有题号的页面归入上一题，保留跨页图示/条件。
                target = problems[-1]
                target["text"] = f"{target['text']}\n{segment}".strip()
                target["pages"].append(page)
                target["page_to"] = int(page.get("page") or target["page_to"])
                continue
            item = {
                "number": number,
                "text": segment.strip(),
                "pages": [page],
                "page_from": int(page.get("page") or 1),
                "page_to": int(page.get("page") or 1),
            }
            problems.append(item)
            if number is not None:
                by_number[number] = item
    # 单页多题时，上一步只按题号合并了同名题号；清理重复页面引用。
    for item in problems:
        unique: list[Mapping[str, Any]] = []
        seen: set[tuple[Any, Any]] = set()
        for page in item["pages"]:
            key = (page.get("file_id"), page.get("page"))
            if key not in seen:
                seen.add(key)
                unique.append(page)
        item["pages"] = unique
    return problems


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------


def classify_subject(text: str) -> tuple[str, float]:
    lowered = text.lower()
    compact = re.sub(r'\s+', '', lowered)
    scores: dict[str, int] = {}
    for subject, keywords in SUBJECT_KEYWORDS.items():
        score = 0
        for keyword, weight in keywords:
            if keyword.lower() in lowered or re.sub(r'\s+', '', keyword.lower()) in compact:
                score += weight
        scores[subject] = score
    # “梯度下降 + f(x)”更像最优化；“神经网络 + 学习率”才归深度学习。
    if "梯度下降" in text and "神经网络" not in text and "损失" not in text:
        scores["optimization"] += 4
    if scores["operating_system"] >= max(scores.values() or [0]) and scores["operating_system"] >= 8:
        chosen = "operating_system"
    elif scores["deep_learning"] >= max(scores.values() or [0]) and scores["deep_learning"] > 0:
        chosen = "deep_learning"
    elif scores["linear_algebra"] > 0 and scores["linear_algebra"] >= max(
        scores["algorithm"], scores["calculus"], scores["optimization"]
    ):
        chosen = "linear_algebra"
    elif scores["algorithm"] > 0 and scores["algorithm"] >= scores["optimization"]:
        chosen = "algorithm"
    elif scores["calculus"] > 0 and scores["calculus"] >= scores["optimization"]:
        chosen = "calculus"
    elif scores["optimization"] > 0:
        chosen = "optimization"
    elif scores["calculus"] > 0:
        chosen = "calculus"
    else:
        chosen = "unknown"
    top = scores.get(chosen, 0)
    confidence = min(0.95, 0.55 + top / 40) if chosen != "unknown" else 0.3
    return chosen, round(confidence, 2)


def _clean_expr(text: str) -> str:
    value = text.strip()
    value = re.sub(r"^[=＝]\s*", "", value)
    value = value.strip(" ：:，,。；;")
    value = re.sub(r"(的最小值|的最大值|的最小|的最大|的极值|的值)$", "", value).strip()
    return value


def _extract_function_expression(text: str) -> tuple[str | None, str | None]:
    patterns = [
        re.compile(r"(?:f|g|h|y)\s*\(\s*([xy](?:\s*,\s*[xy])?)\s*\)\s*=\s*([^\n]+)"),
        re.compile(r"(?:目标函数|函数)\s*[:：]?\s*(?:f\s*\(\s*[xy](?:\s*,\s*[xy])?\s*\)\s*=\s*)?([^\n]+)"),
    ]
    for pattern in patterns:
        match = pattern.search(text)
        if not match:
            continue
        if pattern.groups == 2:
            variables, raw = match.group(1), match.group(2)
        else:
            variables, raw = "x", match.group(1)
        # 截断到中文条件词，但保留括号内的逗号。
        stop = re.search(
            r"(?:的|，|,|。|；|;|\n|求|其中|初始|起点|学习率|迭代|约束|满足|在点|目标|已知|$)",
            raw,
        )
        if stop:
            raw = raw[: stop.start()]
        cleaned = _clean_expr(raw)
        if cleaned:
            return cleaned, variables.replace(" ", "")
    return None, None


def _extract_number(text: str, patterns: Sequence[str]) -> float | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            try:
                value = float(match.group(1).replace("−", "-"))
                if math.isfinite(value):
                    return value
            except (TypeError, ValueError):
                continue
    return None


def _extract_int(text: str, patterns: Sequence[str], default: int | None = None) -> int | None:
    value = _extract_number(text, patterns)
    return int(value) if value is not None else default


def _condition(
    condition_id: str,
    label: str,
    value: Any,
    *,
    kind: str = "number",
    unit: str = "",
    provenance: str = "original",
    source: Mapping[str, Any] | None = None,
    editable: bool = True,
    options: Sequence[str] | None = None,
    min_value: float | None = None,
    max_value: float | None = None,
    step: float | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": condition_id,
        "label": label,
        "value": value,
        "kind": kind,
        "unit": unit,
        "provenance": provenance,
        "source": dict(source or {}),
        "editable": editable,
        "options": list(options or []),
        "min": min_value,
        "max": max_value,
        "step": step,
    }
    if note:
        payload["note"] = note
    return payload


def _ambiguity(
    ambiguity_id: str,
    field: str,
    question: str,
    *,
    severity: str = "blocking",
    options: Sequence[Mapping[str, str]] | None = None,
    resolved: bool = False,
    answer: str | None = None,
) -> dict[str, Any]:
    return {
        "id": ambiguity_id,
        "field": field,
        "question": question,
        "severity": severity,
        "options": [dict(item) for item in (options or [])],
        "resolved": resolved,
        "answer": answer,
    }


def _param(
    parameter_id: str,
    label: str,
    kind: str,
    *,
    min_value: float | None = None,
    max_value: float | None = None,
    step: float | None = None,
    options: Sequence[str] | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": parameter_id,
        "label": label,
        "kind": kind,
        "min": min_value,
        "max": max_value,
        "step": step,
        "options": list(options or []),
    }
    if note:
        payload["note"] = note
    return payload


def _add_defaults_conditions(
    model: dict[str, Any],
    conditions: list[dict[str, Any]],
    text: str,
    source: Mapping[str, Any],
    overrides: Mapping[str, Any],
) -> None:
    values = overrides.get("condition_values") or {}
    mapping = {item["id"]: item for item in conditions}
    for key, value in values.items():
        if key not in model["defaults"]:
            continue
        try:
            if isinstance(model["defaults"][key], int) and not isinstance(model["defaults"][key], bool):
                parsed: Any = int(round(float(value)))
            elif isinstance(model["defaults"][key], float):
                parsed = float(value)
            else:
                parsed = value
        except (TypeError, ValueError):
            continue
        model["defaults"][key] = parsed
        if key in mapping:
            mapping[key]["value"] = parsed
            mapping[key]["provenance"] = "user_confirmed"
        else:
            conditions.append(
                _condition(
                    key,
                    key,
                    parsed,
                    kind="number",
                    provenance="user_confirmed",
                    source=source,
                    note="学生补充或修正的条件",
                )
            )


# ---------------------------------------------------------------------------
# 微积分
# ---------------------------------------------------------------------------


def _parse_limit(raw: str) -> float | None:
    """解析积分上下限；支持 ``+∞`` / ``\\infty`` / ``inf``，普通值返回浮点数。"""

    text = raw.strip().strip("{}").replace(" ", "").replace("\\infty", "∞").replace("\\inf", "∞")
    lowered = text.lower()
    if lowered in ("∞", "+∞", "inf", "+inf", "oo", "+oo"):
        return math.inf
    if lowered in ("-∞", "-inf", "-oo"):
        return -math.inf
    try:
        return float(text)
    except ValueError:
        return None


def _antiderivative_plot_domain(antiderivative: sp.Expr | None, variable: str) -> list[float]:
    """挑一个能看清原函数形状、又不会被奇点或巨大值拉爆纵轴的显示区间。"""

    if antiderivative is None:
        return [-3.0, 3.0]
    symbol = sp.Symbol(variable, real=True)
    try:
        evaluate = sp.lambdify(symbol, antiderivative, modules=["math"])
    except Exception:  # noqa: BLE001 - 无法数值化时退回默认窗口
        return [-3.0, 3.0]
    for low, high in (
        (-4.0, 4.0), (-3.0, 3.0), (-2.0, 2.0), (-1.5, 1.5), (-1.0, 1.0),
        (0.05, 3.0), (-3.0, -0.05), (0.05, 1.5), (-1.5, -0.05),
    ):
        peak = 0.0
        usable = True
        for index in range(81):
            x_value = low + (high - low) * index / 80
            try:
                y_value = float(evaluate(x_value))
            except Exception:  # noqa: BLE001
                usable = False
                break
            if not math.isfinite(y_value):
                usable = False
                break
            peak = max(peak, abs(y_value))
        if usable and peak <= 40:
            return [low, high]
    return [-1.0, 1.0]


def _parse_integral(text: str) -> dict[str, Any] | None:
    """解析积分式，并区分定积分与不定积分。

    只有显式写出的上下限（``∫_a^b`` / ``∫_{a}^{b}`` / “从 a 到 b”）才按定积分
    处理。``∫x^2 dx`` 中的 ``^`` 是幂，不是积分上限；没有上下限的积分默认按
    “不定积分”识别，除非题目明确写了“定积分”。这样既不会把 ``x^2`` 读成
    “下限 x、上限 2”，也不会给不定积分擅自补上 0 到 1 的区间。
    """

    compact = text.replace("\n", " ")
    compact = re.sub(r"\\,|\\!|\\;|\\ ", " ", compact)
    compact = re.sub(r"\\mathrm\{d\}|\\text\{d\}|\\operatorname\{d\}", "d", compact)

    says_indefinite = bool(re.search(r"不定积分|原函数|antiderivative", text, flags=re.I))
    says_definite = bool(
        re.search(r"(?<!不)(?<!in)定积分|(?<!in)definite integral", text, flags=re.I)
    )

    # 1) 显式上下限：LaTeX/Unicode 下标 + 上标。
    matches = list(
        re.finditer(
            r"(?:\\int|∫)\s*(?:_\{?([^{}\s^]+)\}?)\s*(?:\^\{?([^{}\s]+)\}?)\s*(.+?)\s*d\s*([xyzt])(?![A-Za-z])",
            compact,
        )
    )
    # 2) 中文/英文“从 a 到 b”。
    matches += list(
        re.finditer(
            r"(?:\\int|∫)\s*(?:从|from)?\s*([0-9.\-+∞]+)\s*(?:到|至|to)\s*([0-9.\-+∞]+)\s*(.+?)\s*d\s*([xyzt])(?![A-Za-z])",
            compact,
            flags=re.I,
        )
    )
    # 3) 纯文本 int_a^b。
    matches += list(
        re.finditer(
            r"\bint\s*_\s*\{?([0-9.\-+]+)\}?\s*\^\s*\{?([0-9.\-+]+)\}?\s*(.+?)\s*d\s*([xyzt])(?![A-Za-z])",
            compact,
            flags=re.I,
        )
    )
    # 4) 没有 ∫ 符号、但写了“从 a 到 b 积分”的题目。
    matches += list(
        re.finditer(
            r"(?:积分\s*)?(?:从|from)\s*([0-9.\-+]+)\s*(?:到|至|to)\s*([0-9.\-+∞]+)\s*(?:求积分|求|计算)?\s*(.+?)\s*d\s*([xyzt])(?![A-Za-z])",
            compact,
            flags=re.I,
        )
    )
    for match in matches:
        lower_text, upper_text, body, variable = match.groups()
        if not body.strip():
            continue
        lower = _parse_limit(lower_text)
        upper = _parse_limit(upper_text)
        payload = {
            "expression": _clean_expr(body),
            "lower": lower,
            "upper": upper,
            "variable": variable,
            "indefinite": False,
            "matched": match.group(0),
        }
        if lower is None or upper is None:
            # 上下限是符号/公式时不能擅自代入，交给核对面板处理。
            payload["limits_text"] = f"{lower_text}, {upper_text}"
        return payload

    # 5) 写了 ∫ 但只带一个限（如 ∫_0 x dx）：限不完整，交回核对面板确认区间。
    if re.search(r"(?:\\int|∫)\s*[_^]", compact):
        partial = re.search(
            r"(?:\\int|∫)\s*(?:_\{?[^{}\s]*\}?|\^\{?[^{}\s]*\}?)\s*(.+?)\s*d\s*([xyzt])(?![A-Za-z])",
            compact,
        )
        if partial and partial.group(1).strip():
            return {
                "expression": _clean_expr(partial.group(1)),
                "lower": None,
                "upper": None,
                "variable": partial.group(2),
                "indefinite": False,
                "matched": partial.group(0),
            }
        return None

    # 6) 没有显式上下限：∫f(x)dx 视为不定积分；“定积分 x^2 dx”仍要求确认区间。
    match = re.search(
        r"(?:\\int|∫)\s*_?\s*(.+?)\s*d\s*([xyzt])(?![A-Za-z])", compact
    )
    if match and not match.group(1).strip().lstrip("^_").strip():
        match = None
    if match:
        body = match.group(1).strip()
        # 写成 ∫_0^2 但漏了某个限时，不猜成不定积分。
        indefinite = not says_definite or says_indefinite
    else:
        match = re.search(r"(?:定?积分)\s*(.+?)\s*d\s*([xyzt])(?![A-Za-z])", compact)
        if not match:
            return None
        body = match.group(1).strip()
        indefinite = says_indefinite and not says_definite
    if not body or body.strip("^_") == "":
        return None
    return {
        "expression": _clean_expr(body),
        "lower": None,
        "upper": None,
        "variable": match.group(2),
        "indefinite": indefinite,
        "matched": match.group(0),
    }


def _calculus_model(
    text: str,
    source: Mapping[str, Any],
    overrides: Mapping[str, Any],
) -> dict[str, Any]:
    from .proof import build_proof_from_text
    proof = build_proof_from_text(text, source, overrides)
    if proof is not None:
        return proof
    from .ode import build_ode_from_text
    ode = build_ode_from_text(text, source, overrides)
    if ode is not None:
        return ode
    from .series import build_series_from_text
    series = build_series_from_text(text, source, overrides)
    if series is not None:
        return series
    from .calculus_analysis import build_analysis_problem
    analysis = build_analysis_problem(text, source, overrides)
    if analysis is not None:
        return analysis
    from .double_integral import build_double_integral
    double = build_double_integral(text, source, overrides)
    if double is not None:
        return double
    from .exam_math import build_exam_math
    exam = build_exam_math(text, source, overrides)
    if exam is not None:
        return exam
    expression_override = str(overrides.get("expression") or "").strip()
    lower_override = overrides.get("lower")
    upper_override = overrides.get("upper")
    integral = _parse_integral(text)
    function_expr, variables = _extract_function_expression(text)
    indefinite = bool(integral and integral.get("indefinite"))
    kind = "antiderivative" if indefinite else ("integral" if integral else "derivative")
    raw_expr = expression_override or (str(integral.get("expression")) if integral else None) or function_expr
    teaching = False
    improper_upper = False
    upper_tex: str | None = None
    lower: float | None = 0.0
    upper: float | None = 1.0
    ambiguities: list[dict[str, Any]] = []
    conditions: list[dict[str, Any]] = []

    if not raw_expr:
        teaching = True
        kind = "integral"
        raw_expr = "x**2"
        lower, upper = 0.0, 1.0
        ambiguities.append(
            _ambiguity(
                "expression",
                "expression",
                "没有识别到可计算的函数或积分表达式。先核对题目，或使用明确标注的教学示例继续。",
                options=[
                    {"value": "use_example", "label": "使用教学示例 ∫₀¹ x² dx"},
                    {"value": "x**2", "label": "输入表达式，例如 x^2"},
                ],
            )
        )
    elif kind == "antiderivative":
        # 不定积分没有积分区间：不能擅自补 0 到 1，只记录被积函数与积分变量。
        lower, upper = None, None
    elif kind == "integral":
        lower = lower_override if lower_override is not None else integral.get("lower") if integral else None
        upper = upper_override if upper_override is not None else integral.get("upper") if integral else None
        if lower is None or upper is None:
            lower = 0.0 if lower is None else float(lower)
            upper = 1.0 if upper is None else float(upper)
            limit_options = [
                {"value": "0,1", "label": "0 到 1"},
                {"value": "-1,1", "label": "−1 到 1"},
            ]
            observed_limits = f"{lower:g},{upper:g}"
            if observed_limits not in {"0,1", "-1,1"}:
                limit_options.append(
                    {"value": observed_limits, "label": f"{lower:g} 到 {upper:g}（按已读到的值）"}
                )
            ambiguities.append(
                _ambiguity(
                    "limits",
                    "integral_limits",
                    "积分的上下限不够明确。请确认区间后再计算原题答案。",
                    options=limit_options,
                )
            )
        elif math.isinf(upper):
            # 只支持 +∞ 上限：图像与黎曼和需要一个有限截断区间，解析值仍按无穷积分计算。
            if upper > 0 and math.isfinite(lower):
                improper_upper = True
                upper = max(10.0, float(lower) + 8.0)
                upper_tex = r"+\infty"
            else:
                lower, upper = 0.0, 1.0
                ambiguities.append(
                    _ambiguity(
                        "limits",
                        "integral_limits",
                        "积分的无穷方向暂时无法直接图形化。请先确认一个有限展示区间。",
                        options=[
                            {"value": "0,1", "label": "0 到 1"},
                            {"value": "-1,1", "label": "−1 到 1"},
                        ],
                    )
                )
        else:
            lower = float(lower)
            upper = float(upper)
    else:
        lower = 0.0
        upper = 1.0

    variable = (integral or {}).get("variable") or (variables[:1] if variables else "x") or "x"
    if not re.fullmatch(r"[A-Za-z]", variable):
        variable = "x"
    try:
        parsed = parse_expression(raw_expr, (variable,))
    except ExprError as exc:
        teaching = True
        ambiguities.append(
            _ambiguity(
                "expression_parse",
                "expression",
                f"表达式“{raw_expr[:60]}”暂时无法解析（{exc}）。请核对符号或改写为 x^2、sin(x) 这样的形式。",
                options=[{"value": "use_example", "label": "使用教学示例"}],
            )
        )
        raw_expr = f"{variable}**2"
        parsed = parse_expression(raw_expr, (variable,))
        lower, upper = 0.0, 1.0
        if kind == "antiderivative":
            # 不定积分表达式无法解析时退回教学示例，明确要求学生核对原题。
            kind = "integral"
    else:
        # Original OCR stays in the source dossier; the executable model must
        # never send split function letters or implicit calls to the browser.
        raw_expr = expression_text(parsed)

    if kind == "integral":
        point = None
        # 无穷上限的截断区间较宽，默认分割数提高一点，避免首屏黎曼和显得离谱。
        n = 32 if improper_upper else 8
        upper_latex = upper_tex or f"{upper:g}"
        upper_label = "积分上限 b（图像截断）" if improper_upper else "积分上限 b"
        defaults = {"lower": float(lower), "upper": float(upper), "n": n}
        params = [
            _param("lower", "积分下限 a", "number", step=0.5),
            _param("upper", upper_label, "number", step=0.5),
            _param("n", "分割数 n", "integer", min_value=2, max_value=80, step=1),
        ]
        if improper_upper:
            params[1]["note"] = (
                f"原题上限为 +∞；这里只调整图像与黎曼和的截断范围（当前 {upper:g}）。"
            )
        formulas = [
            {
                "id": "integral",
                "tex": rf"\int_{{{lower:g}}}^{{{upper_latex}}} {to_latex(parsed)}\,\mathrm{{d}}{variable}",
                "plain": raw_expr,
                "role": "教学示例（未识别到原题公式）" if teaching else "识别出的原题公式",
            }
        ]
        conditions.append(
            _condition(
                "expression", "被积函数", raw_expr, kind="expr",
                provenance="teaching" if teaching else "original", source=source,
            )
        )
        conditions.append(
            _condition(
                "lower", "积分下限 a", float(lower), provenance="original" if integral and integral.get("lower") is not None else "supplement",
                source=source, step=0.5,
            )
        )
        if improper_upper:
            conditions.append(
                _condition(
                    "upper",
                    "积分上限 b",
                    "+∞",
                    kind="text",
                    provenance="original",
                    source=source,
                    editable=False,
                    note=f"原题上限为 +∞；图像与黎曼和在 b={upper:g} 处截断展示，解析值按无穷积分计算。",
                )
            )
            ambiguities.append(
                _ambiguity(
                    "improper_upper",
                    "expression",
                    f"原题上限为 +∞；图像与黎曼和在 b={upper:g} 处截断展示，解析值按无穷积分计算。",
                    severity="notice",
                )
            )
        else:
            conditions.append(
                _condition(
                    "upper", "积分上限 b", float(upper), provenance="original" if integral and integral.get("upper") is not None else "supplement",
                    source=source, step=0.5,
                )
            )
        conditions.append(
            _condition(
                "n", "数值分割数 n", n, kind="integer", provenance="supplement",
                source=source, editable=True, min_value=2, max_value=80, step=1,
                note="用于对照数值近似与解析值，不改变原题答案。",
            )
        )
    elif kind == "antiderivative":
        # 不定积分没有上下限：答案是一族原函数 F(x)+C，图形用常数 C 做上下平移。
        antiderivative_expr: str | None = None
        antiderivative_symbolic: sp.Expr | None = None
        if len(raw_expr) <= 200:
            try:
                symbol = sp.Symbol(variable, real=True)
                candidate = sp.integrate(parsed, symbol)
                if not candidate.has(sp.Integral):
                    antiderivative_symbolic = candidate
                    antiderivative_expr = expression_text(candidate)
            except Exception:  # noqa: BLE001 - 符号积分失败时保留被积函数与提示
                antiderivative_expr = None
        defaults = {"c": 0.0}
        params = [
            _param(
                "c", "积分常数 C", "number", min_value=-16, max_value=16, step=0.5,
                note="不定积分给出 F(x)+C；C 只改变曲线上下平移。",
            ),
        ]
        formulas = [
            {
                "id": "antiderivative",
                "tex": rf"\int {to_latex(parsed)}\,\mathrm{{d}}{variable}",
                "plain": raw_expr,
                "role": "识别出的原题公式",
            }
        ]
        conditions.extend(
            [
                _condition("expression", "被积函数", raw_expr, kind="expr", provenance="original", source=source),
                _condition(
                    "c", "积分常数 C", 0.0, provenance="supplement", source=source, step=0.5,
                    note="不定积分表示一族原函数；C 只改变图像上下平移，不改变原题答案。",
                ),
            ]
        )
    else:
        point = _extract_number(
            text,
            (
                r"(?:在|于)\s*[xX]\s*=?\s*(-?\d+(?:\.\d+)?)",
                r"[xX]\s*_?0?\s*=\s*(-?\d+(?:\.\d+)?)",
            ),
        )
        point_supplied = point is not None
        point = 0.0 if point is None else point
        defaults = {"point": float(point), "h": 0.1}
        params = [
            _param("point", "研究点 x", "number", step=0.1),
            _param("h", "差商步长 h", "number", min_value=0.001, max_value=2, step=0.001),
        ]
        formulas = [
            {
                "id": "function",
                "tex": f"f({variable})={to_latex(parsed)}",
                "plain": raw_expr,
                "role": "教学示例（未识别到原题公式）" if teaching else "识别出的原题公式",
            }
        ]
        conditions.extend(
            [
                _condition("expression", "函数", raw_expr, kind="expr", provenance="original", source=source),
                _condition(
                    "point", "研究点 x", float(point),
                    provenance="original" if point_supplied else "supplement", source=source, step=0.1,
                ),
                _condition(
                    "h", "差商步长 h", 0.1, provenance="supplement", source=source,
                    min_value=0.001, max_value=2, step=0.001, note="用于观察割线趋近切线。",
                ),
            ]
        )

    if not any(item["id"] == "expression" for item in ambiguities) and teaching:
        ambiguities.append(
            _ambiguity(
                "teaching_model", "expression",
                "当前使用的是教学示例，原题文字与来源仍保留。请确认是否继续。",
                severity="notice", options=[{"value": "use_example", "label": "继续使用教学示例"}],
            )
        )

    model = {
        "engine": (
            "antiderivative_v1"
            if kind == "antiderivative"
            else "riemann_v1"
            if kind == "integral"
            else "tangent_v1"
        ),
        "subject": "calculus",
        "kind": kind,
        "variable": variable,
        "expression": raw_expr,
        "formula_tex": (
            rf"\int {to_latex(parsed)}\,\mathrm{{d}}{variable}=F({variable})+C"
            if kind == "antiderivative"
            else f"f({variable})={to_latex(parsed)}"
        ),
        "defaults": defaults,
        "params": params,
        "teaching": teaching,
        "provenance_note": "教学示例：题目未提供可计算表达式" if teaching else None,
    }
    if kind == "antiderivative":
        model["indefinite"] = True
        model["antiderivative_expression"] = antiderivative_expr
        model["plot_domain"] = _antiderivative_plot_domain(antiderivative_symbolic, variable)
    if improper_upper:
        model["improper_upper"] = True
        model["original_upper"] = "+∞"
        model["visual_upper"] = float(upper)
    _add_defaults_conditions(model, conditions, text, source, overrides)
    return {
        "model": model,
        "conditions": conditions,
        "ambiguities": ambiguities,
        "formulas": formulas,
        "recognized": not teaching and not any(item["severity"] == "blocking" and not item["resolved"] for item in ambiguities),
    }


# ---------------------------------------------------------------------------
# 最优化
# ---------------------------------------------------------------------------


def _optimization_model(
    text: str,
    source: Mapping[str, Any],
    overrides: Mapping[str, Any],
) -> dict[str, Any]:
    raw_expr = str(overrides.get("expression") or "").strip() or None
    variables_text = str(overrides.get("variables") or "")
    extracted_expr, lhs_vars = _extract_function_expression(text)
    if not raw_expr:
        raw_expr = extracted_expr
    teaching = False
    ambiguities: list[dict[str, Any]] = []
    conditions: list[dict[str, Any]] = []
    formulas: list[dict[str, Any]] = []

    if not raw_expr:
        teaching = True
        raw_expr = "(x-3)**2"
        lhs_vars = "x"
        ambiguities.append(
            _ambiguity(
                "expression",
                "expression",
                "没有识别到目标函数。请核对题目，或使用明确标注的教学示例继续。",
                options=[
                    {"value": "use_example", "label": "使用教学示例 f(x)=(x−3)²"},
                    {"value": "(x-3)^2", "label": "输入目标函数，例如 (x-3)^2"},
                ],
            )
        )

    variables = [item for item in re.split(r"\s*,\s*", variables_text or lhs_vars or "x") if item]
    if not variables:
        variables = ["x"]
    if "y" in raw_expr and "y" not in variables:
        variables.append("y")
    variables = [v for v in variables if re.fullmatch(r"[xy]", v)]
    if not variables:
        variables = ["x"]

    try:
        parsed = parse_expression(raw_expr, variables)
    except ExprError as exc:
        teaching = True
        ambiguities.append(
            _ambiguity(
                "expression_parse",
                "expression",
                f"目标函数“{raw_expr[:60]}”无法解析（{exc}）。请核对符号或改写为 (x-3)^2。",
                options=[{"value": "use_example", "label": "使用教学示例 f(x)=(x−3)²"}],
            )
        )
        raw_expr = "(x-3)**2"
        variables = ["x"]
        parsed = parse_expression(raw_expr, variables)

    gradients = [sp.diff(parsed, sp.Symbol(var, real=True)) for var in variables]
    gradient_exprs = [str(sp.simplify(item)) for item in gradients]

    def initial_pattern(var: str) -> list[str]:
        return [
            rf"{var}\s*_?\s*0?\s*=\s*(-?\d+(?:\.\d+)?)",
            rf"(?:初始点|起点|初始值)\s*[^0-9\-]{{0,8}}{var}\s*=?\s*(-?\d+(?:\.\d+)?)",
        ]

    initial_values: list[float | None] = []
    for var in variables:
        value = _extract_number(text, initial_pattern(var))
        initial_values.append(value)
    if len(variables) == 1 and initial_values[0] is None:
        # “初始点为 0”也是常见写法。
        initial_values[0] = _extract_number(text, [r"(?:初始点|起点|初始值)\s*(?:为|是|:|=)?\s*(-?\d+(?:\.\d+)?)"])
    lr = _extract_number(text, [r"(?:学习率|步长)\s*(?:为|是|:|=)?\s*(\d+(?:\.\d+)?)"])
    iterations = _extract_int(text, [r"(?:迭代|执行)\s*(?:次数|步数)?\s*(?:为|是|:|=)?\s*(\d{1,3})"])
    # 区间/箱约束，仅对显式一维或二维范围生效；一般不等式会进入提示而不伪造。
    bounds: dict[str, list[float | None]] = {}
    for var in variables:
        range_match = re.search(
            rf"{var}\s*(?:∈|in|属于)\s*[\[\(]\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*[\]\)]",
            text,
        )
        inequality = re.search(
            rf"(-?\d+(?:\.\d+)?)\s*(<=?|≤)\s*{var}\s*(<=?|≤)\s*(-?\d+(?:\.\d+)?)",
            text,
        )
        if range_match:
            bounds[var] = [float(range_match.group(1)), float(range_match.group(2))]
        elif inequality:
            bounds[var] = [float(inequality.group(1)), float(inequality.group(4))]
            if "<" in (inequality.group(2) + inequality.group(3)):
                ambiguities.append(
                    _ambiguity(
                        f"strict_{var}",
                        "constraint",
                        f"{var} 的约束使用了严格不等式；数值探索按闭区间显示，是否接受这一近似？",
                        severity="notice",
                        options=[{"value": "accept", "label": "按闭区间近似探索"}],
                    )
                )
    if re.search(r"[<>≤≥]", text) and not bounds and "学习率" not in text:
        ambiguities.append(
            _ambiguity(
                "constraint_general",
                "constraint",
                "题目包含一般不等式约束。首版只对明确的箱约束（如 0≤x≤6）做可执行模型；其余约束会保留在来源中，不冒充已满足。",
                severity="notice",
                options=[{"value": "ack", "label": "知道了，先按无约束模型探索"}],
            )
        )

    defaults: dict[str, Any] = {}
    for index, var in enumerate(variables):
        value = initial_values[index]
        origin = value is not None
        defaults[f"{var}0"] = float(0.0 if value is None else value)
        conditions.append(
            _condition(
                f"{var}0", f"初始点 {var}₀", defaults[f"{var}0"],
                provenance="original" if origin else "supplement", source=source, step=0.1,
                note=None if origin else "题目未明确给出，按教学补充值初始化，可修改。",
            )
        )
    defaults["learning_rate"] = float(lr if lr is not None else 0.1)
    defaults["iterations"] = int(iterations if iterations is not None else 30)
    conditions.extend(
        [
            _condition(
                "learning_rate", "学习率 η", defaults["learning_rate"],
                provenance="original" if lr is not None else "supplement", source=source,
                min_value=0.001, max_value=2, step=0.001,
                note=None if lr is not None else "题目未给出学习率，按教学补充值 0.1 初始化。",
            ),
            _condition(
                "iterations", "迭代次数", defaults["iterations"], kind="integer",
                provenance="supplement", source=source, min_value=1, max_value=120, step=1,
                note="用于展示完整轨迹，不改变原题的目标函数。",
            ),
        ]
    )
    conditions.append(
        _condition(
            "expression", "目标函数", raw_expr, kind="expr",
            provenance="teaching" if teaching else "original", source=source,
        )
    )
    if bounds:
        conditions.append(
            _condition(
                "bounds", "箱约束", bounds, kind="json",
                provenance="original", source=source, editable=False,
                note="模型会把迭代点投影到该闭区间，并单独报告约束是否满足。",
            )
        )
        defaults["bounds"] = bounds

    formulas.append(
        {
            "id": "objective",
            "tex": f"\\min_{{{','.join(variables)}}}\\; {to_latex(parsed)}",
            "plain": raw_expr,
            "role": "识别出的目标函数",
        }
    )
    gradients_latex = ", ".join(
        rf"\frac{{\partial f}}{{\partial {var}}}={to_latex(expr)}"
        for var, expr in zip(variables, gradients)
    )
    formulas.append({"id": "gradient", "tex": gradients_latex, "plain": "梯度", "role": "求解器推导"})

    # 画布范围包含初始点与常见临界点，避免轨迹跑出主图。
    domain: dict[str, float] = {}
    for var in variables:
        try:
            critical = sp.solve([sp.diff(parsed, sp.Symbol(var, real=True))], [sp.Symbol(var, real=True)], dict=True)
        except (NotImplementedError, ValueError):
            critical = []
        candidates = [defaults[f"{var}0"]]
        for item in critical[:4]:
            val = safe_float(item.get(sp.Symbol(var, real=True)))
            if val is not None:
                candidates.append(val)
        if var in bounds:
            candidates.extend([val for val in bounds[var] if val is not None])
        low, high = min(candidates), max(candidates)
        if abs(high - low) < 2:
            low -= 2
            high += 2
        pad = max(1.0, (high - low) * 0.35)
        domain[f"{var}_min"] = low - pad
        domain[f"{var}_max"] = high + pad
        domain[f"{var}_critical"] = (low + high) / 2

    model = {
        "engine": "gradient_descent_v1",
        "subject": "optimization",
        "variables": variables,
        "expression": raw_expr,
        "grad_exprs": gradient_exprs,
        "gradient_tex": gradients_latex,
        "objective_tex": f"f({','.join(variables)})={to_latex(parsed)}",
        "defaults": defaults,
        "params": [
            *[
                _param(f"{var}0", f"初始点 {var}₀", "number", step=0.1)
                for var in variables
            ],
            _param("learning_rate", "学习率 η", "number", min_value=0.001, max_value=2, step=0.001),
            _param("iterations", "迭代次数", "integer", min_value=1, max_value=120, step=1),
        ],
        "bounds": bounds,
        "domain": domain,
        "teaching": teaching,
        "provenance_note": "教学示例：题目未提供可计算目标函数" if teaching else None,
    }
    _add_defaults_conditions(model, conditions, text, source, overrides)
    return {
        "model": model,
        "conditions": conditions,
        "ambiguities": ambiguities,
        "formulas": formulas,
        "recognized": not teaching and not any(item["severity"] == "blocking" and not item["resolved"] for item in ambiguities),
    }


# ---------------------------------------------------------------------------
# 数据结构与算法：BFS
# ---------------------------------------------------------------------------

_NODE = r"[A-Za-z0-9_\u4e00-\u9fa5]{1,10}"


def _parse_edges(text: str) -> tuple[list[dict[str, str]], bool]:
    edges: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    directed = bool(re.search(r"有向|directed|->|→|—>", text))

    def add(left: str, right: str) -> None:
        left, right = left.strip(), right.strip()
        if not left or not right or left == right:
            return
        key = (left, right)
        if key in seen:
            return
        seen.add(key)
        edges.append({"from": left, "to": right})

    for match in re.finditer(rf"({_NODE})\s*(?:->|→|—>|-->)\s*({_NODE})", text):
        add(match.group(1), match.group(2))
    for match in re.finditer(rf"({_NODE})\s*[-–—]\s*({_NODE})", text):
        # 避免把数字范围 0-1 误判为边。
        if re.search(r"\d", match.group(1) + match.group(2)):
            continue
        add(match.group(1), match.group(2))
    for match in re.finditer(rf"(?m)^\s*({_NODE})\s*[:：]\s*([^\n]+)$", text):
        left = match.group(1)
        rest = match.group(2)
        if not re.search(r"[,，、\s]", rest):
            continue
        for token in re.split(r"[,，、\s]+", rest):
            if re.fullmatch(_NODE, token):
                add(left, token)
    return edges, directed


def _algorithm_model(
    text: str,
    source: Mapping[str, Any],
    overrides: Mapping[str, Any],
) -> dict[str, Any]:
    from .heap import build_heap
    heap = build_heap(text, source, {**dict(overrides.get('condition_values') or {}), **overrides})
    if heap is not None:
        return heap
    edges, directed = _parse_edges(text)
    if overrides.get("edges"):
        edges = [dict(item) for item in overrides["edges"]]
    start = str(overrides.get("start") or "").strip() or None
    start_match = re.search(r"(?:从|起点|开始节点|start)\s*[:：]?\s*([A-Za-z0-9_\u4e00-\u9fa5]{1,10})", text, flags=re.I)
    if start_match and not start:
        start = start_match.group(1)
    teaching = False
    ambiguities: list[dict[str, Any]] = []
    conditions: list[dict[str, Any]] = []
    if not edges:
        teaching = True
        edges = [
            {"from": "A", "to": "B"},
            {"from": "A", "to": "C"},
            {"from": "B", "to": "D"},
            {"from": "C", "to": "D"},
            {"from": "D", "to": "E"},
        ]
        ambiguities.append(
            _ambiguity(
                "graph",
                "graph",
                "没有识别到图的边。可先核对图中连接关系，或使用明确标注的教学图继续。",
                options=[{"value": "use_example", "label": "使用教学图 A-B, A-C, B-D, C-D, D-E"}],
            )
        )
    nodes: list[str] = []
    for edge in edges:
        for key in ("from", "to"):
            if edge[key] not in nodes:
                nodes.append(edge[key])
    nodes = nodes[:20]
    if not start or start not in nodes:
        suggested = nodes[0] if nodes else "A"
        start = suggested
        if not teaching:
            ambiguities.append(
                _ambiguity(
                    "start",
                    "start",
                    "没有明确识别出起点。请选择 BFS 的起始节点。",
                    options=[{"value": node, "label": f"从 {node} 开始"} for node in nodes[:6]],
                )
            )
    conditions.extend(
        [
            _condition(
                "graph", "图的边", "；".join(f"{item['from']}→{item['to']}" for item in edges),
                kind="text", provenance="teaching" if teaching else "original", source=source, editable=False,
                note="可在“输入数据”中修改连接关系，修改后属于新情景。",
            ),
            _condition(
                "directed", "有向图", directed, kind="boolean",
                provenance="original" if directed else "inferred", source=source, editable=False,
            ),
            _condition(
                "start", "起点", start, kind="text",
                provenance="original" if start_match else "supplement", source=source,
                options=nodes[:8],
            ),
            _condition(
                "neighbor_order", "同层顺序", "按节点编号升序（A→B→…）", kind="text",
                provenance="inferred", source=source, editable=False,
                note="执行顺序与队列规则会直接写入轨迹，动画与伪代码读取同一份记录。",
            ),
        ]
    )
    model = {
        "engine": "bfs_v1",
        "subject": "algorithm",
        "algorithm": "bfs",
        "nodes": [{"id": node, "label": node} for node in nodes],
        "edges": edges,
        "directed": directed,
        "start": start,
        "neighbor_order": "lexicographic_by_id",
        "defaults": {"start": start},
        "params": [_param("start", "起点", "enum", options=nodes[:8])],
        "teaching": teaching,
        "provenance_note": "教学示例：题目未提供可计算的图数据" if teaching else None,
    }
    _add_defaults_conditions(model, conditions, text, source, overrides)
    return {
        "model": model,
        "conditions": conditions,
        "ambiguities": ambiguities,
        "formulas": [
            {
                "id": "bfs_rule",
                "tex": r"\text{队列（FIFO）;\;入队即标记已访问;\;邻居按编号升序}",
                "plain": "BFS: 队列先进先出；入队时标记访问；邻居按编号升序",
                "role": "算法规则",
            }
        ],
        "recognized": not teaching and not any(item["severity"] == "blocking" and not item["resolved"] for item in ambiguities),
    }


# ---------------------------------------------------------------------------
# 深度学习
# ---------------------------------------------------------------------------


def _parse_vector(raw: str) -> list[float] | None:
    try:
        value = ast.literal_eval(raw.replace("，", ",").replace("；", ","))
    except (ValueError, SyntaxError):
        return None
    if not isinstance(value, (list, tuple)) or not value:
        return None
    try:
        return [float(item) for item in value]
    except (TypeError, ValueError):
        return None


def _parse_matrix(raw: str) -> list[list[float]] | None:
    try:
        value = ast.literal_eval(raw.replace("，", ",").replace("；", ","))
    except (ValueError, SyntaxError):
        return None
    if not isinstance(value, (list, tuple)) or not value:
        return None
    result: list[list[float]] = []
    for row in value:
        if not isinstance(row, (list, tuple)) or not row:
            return None
        try:
            result.append([float(item) for item in row])
        except (TypeError, ValueError):
            return None
    return result


def _activation(name: str) -> str:
    lowered = name.lower()
    if "relu" in lowered:
        return "relu"
    if "sigmoid" in lowered:
        return "sigmoid"
    return "tanh"


def _deep_learning_model(
    text: str,
    source: Mapping[str, Any],
    overrides: Mapping[str, Any],
) -> dict[str, Any]:
    teaching = False
    ambiguities: list[dict[str, Any]] = []
    conditions: list[dict[str, Any]] = []
    sizes: list[int] | None = None
    size_match = re.search(r"(\d+)\s*[-–—]\s*(\d+)(?:\s*[-–—]\s*(\d+))?", text)
    if size_match:
        sizes = [int(item) for item in size_match.groups() if item]
    if overrides.get("layers"):
        sizes = [int(item) for item in overrides["layers"]]
    if not sizes or len(sizes) < 2 or any(item < 1 or item > 8 for item in sizes):
        sizes = [2, 3, 1]
        ambiguities.append(
            _ambiguity(
                "network_shape",
                "layers",
                "没有识别到完整的网络结构。当前按明确标注的教学网络 2–3–1 展示，可核对后修改。",
                severity="notice",
                options=[{"value": "2-3-1", "label": "使用 2–3–1 教学网络"}],
            )
        )
    activation = _activation(text)
    input_match = re.search(r"(?:x|输入)\s*(?:=|为|:)\s*[\[\(（]\s*([^\]\)）]+)[\]\)）]", text)
    input_values = _parse_vector(input_match.group(1)) if input_match else None
    if input_values is None or len(input_values) != sizes[0]:
        input_values = [0.6, -0.2] if sizes[0] == 2 else [0.5] * sizes[0]
        ambiguities.append(
            _ambiguity(
                "input_vector",
                "input",
                f"题目没有给出与输入维度 {sizes[0]} 匹配的完整输入向量。当前使用教学输入，可修改。",
                severity="notice",
                options=[{"value": "use_example", "label": "使用教学输入"}],
            )
        )
    target = _extract_number(text, [r"(?:目标|标签|真实值|y)\s*(?:=|为|:)\s*(-?\d+(?:\.\d+)?)"])
    target_value = float(target if target is not None else 1.0)
    lr = _extract_number(text, [r"(?:学习率|步长)\s*(?:为|是|:|=)?\s*(\d+(?:\.\d+)?)"])
    epochs = _extract_int(
        text,
        [
            r"(?:epoch|训练轮|轮数|迭代)\s*(?:为|是|:|=)?\s*(\d{1,2})",
            r"训练\s*(\d{1,2})\s*轮",
        ],
        8,
    ) or 8
    weights: list[list[list[float]]] = []
    weight_source = "teaching"
    for index in range(len(sizes) - 1):
        match = re.search(
            rf"W\s*{index + 1}\s*=\s*(\[\[[\s\S]*?\]\])",
            text,
            flags=re.I,
        )
        parsed = _parse_matrix(match.group(1)) if match else None
        if parsed is not None and len(parsed) == sizes[index + 1] and all(len(row) == sizes[index] for row in parsed):
            weights.append(parsed)
            weight_source = "original"
        else:
            weights = []
            break
    if not weights:
        import numpy as np

        rng = np.random.RandomState(42)
        weights = [
            (rng.randn(sizes[index + 1], sizes[index]) * 0.8).round(4).tolist()
            for index in range(len(sizes) - 1)
        ]
        ambiguities.append(
            _ambiguity(
                "weights",
                "weights",
                "题目没有提供完整权重。已生成可复现的小型教学网络，权重来源会明确标注，不与原模型混称。",
                severity="notice",
                options=[{"value": "use_teaching_weights", "label": "使用可复现的教学权重"}],
            )
        )
    biases = [[0.0] * size for size in sizes[1:]]
    layers = [{"size": size, "activation": "input" if index == 0 else ("linear" if index == len(sizes) - 1 else activation)} for index, size in enumerate(sizes)]
    defaults: dict[str, Any] = {
        "learning_rate": float(lr if lr is not None else 0.1),
        "epochs": int(min(30, max(1, epochs))),
    }
    for index, value in enumerate(input_values):
        defaults[f"input_{index + 1}"] = value
    conditions.extend(
        [
            _condition("layers", "网络结构", "–".join(str(item) for item in sizes), provenance="original" if size_match else "teaching", source=source),
            _condition("activation", "隐藏层激活", activation, kind="text", provenance="original" if activation in text.lower() else "teaching", source=source),
            _condition(
                "input", "输入向量 x", input_values, kind="json",
                provenance="original" if input_match else "teaching", source=source,
            ),
            _condition(
                "target", "目标值 y", target_value,
                provenance="original" if target is not None else "teaching", source=source,
            ),
            _condition(
                "weights", "权重来源", "题目提供" if weight_source == "original" else "可复现教学初始化（seed=42）",
                kind="text", provenance="original" if weight_source == "original" else "teaching", source=source,
                editable=False,
            ),
            _condition(
                "learning_rate", "学习率 η", defaults["learning_rate"],
                provenance="original" if lr is not None else "supplement", source=source,
                min_value=0.001, max_value=2, step=0.001,
            ),
            _condition(
                "epochs", "训练轮数", defaults["epochs"], kind="integer",
                provenance="supplement", source=source, min_value=1, max_value=30, step=1,
            ),
        ]
    )
    params = [
        *[
            _param(f"input_{index + 1}", f"输入 x{index + 1}", "number", min_value=-3, max_value=3, step=0.1)
            for index in range(sizes[0])
        ],
        _param("learning_rate", "学习率 η", "number", min_value=0.001, max_value=2, step=0.001),
        _param("epochs", "训练轮数", "integer", min_value=1, max_value=30, step=1),
    ]
    model = {
        "engine": "mlp_v1",
        "subject": "deep_learning",
        "layers": layers,
        "weights": weights,
        "biases": biases,
        "input": input_values,
        "target": [target_value],
        "seed": 42,
        "activation": activation,
        "weight_source": weight_source,
        "defaults": defaults,
        "params": params,
        "teaching": teaching or weight_source != "original" or not size_match,
        "provenance_note": "教学示例：题目未提供完整网络结构或权重" if teaching or weight_source != "original" else None,
    }
    _add_defaults_conditions(model, conditions, text, source, overrides)
    formulas = [
        {
            "id": "network",
            "tex": r"z^{[l]}=W^{[l]}a^{[l-1]}+b^{[l]},\quad a^{[l]}=\sigma(z^{[l]})",
            "plain": "逐层前向：线性变换 + 激活",
            "role": "模型结构",
        },
        {
            "id": "loss",
            "tex": r"\mathcal{L}=\frac{1}{m}\sum_i(\hat y_i-y_i)^2",
            "plain": "均方误差损失",
            "role": "求解器推导",
        },
    ]
    return {
        "model": model,
        "conditions": conditions,
        "ambiguities": ambiguities,
        "formulas": formulas,
        "recognized": not any(item["severity"] == "blocking" and not item["resolved"] for item in ambiguities),
    }


# ---------------------------------------------------------------------------
# 统一构建
# ---------------------------------------------------------------------------


def _answer_overrides(text: str, overrides: dict[str, Any]) -> None:
    # 先应用“条件面板”的普通修正，再应用学生对歧义问题的直接回答；后者优先，
    # 因为核对问题的答案就是学生刚刚做出的明确决定（例如积分区间 0,2）。
    condition_values = overrides.get("condition_values") or {}
    if isinstance(condition_values, Mapping):
        expression = condition_values.get("expression")
        if isinstance(expression, str) and expression.strip():
            overrides["expression"] = expression.strip()
        for key in ("lower", "upper"):
            if key in condition_values:
                try:
                    overrides[key] = float(condition_values[key])
                except (TypeError, ValueError):
                    pass
        if isinstance(condition_values.get("start"), str) and condition_values["start"].strip():
            overrides["start"] = condition_values["start"].strip()
        graph_source = condition_values.get("graph_edges")
        if isinstance(graph_source, str) and graph_source.strip():
            parsed, _directed = _parse_edges(graph_source)
            if parsed:
                overrides["edges"] = parsed
        layer_source = condition_values.get("layers")
        if isinstance(layer_source, str):
            sizes = [int(item) for item in re.findall(r"\d+", layer_source)]
            if len(sizes) >= 2:
                overrides["layers"] = sizes

    answers = overrides.get("ambiguity_answers") or {}
    for key, raw in answers.items():
        value = str(raw).strip()
        if not value:
            continue
        if key == "limits":
            parts = re.split(r"\s*[,，;；]\s*", value)
            if len(parts) == 2:
                try:
                    overrides["lower"] = float(parts[0])
                    overrides["upper"] = float(parts[1])
                except ValueError:
                    pass
        elif key in ("expression", "expression_parse"):
            if value != "use_example":
                overrides["expression"] = value
        elif key == "start":
            overrides["start"] = value
        elif key in ("network_shape",):
            sizes = [int(item) for item in re.findall(r"\d+", value)]
            if len(sizes) >= 2:
                overrides["layers"] = sizes
        elif key == "graph":
            parsed, _directed = _parse_edges(value)
            if parsed:
                overrides["edges"] = parsed
    # 后置的 _add_defaults_conditions 仍会读取 condition_values；把已经被明确
    # 回答覆盖的普通字段移除，避免它把学生刚确认的区间/起点改回旧值。
    if isinstance(condition_values, dict):
        if "limits" in answers:
            condition_values.pop("lower", None)
            condition_values.pop("upper", None)
        if "start" in answers:
            condition_values.pop("start", None)
    if str(overrides.get("subject") or "") == "unknown":
        overrides.pop("subject", None)


def _linear_algebra_model(
    text: str,
    source: Mapping[str, Any],
    overrides: Mapping[str, Any],
) -> dict[str, Any]:
    from .linalg import build_linalg
    return build_linalg(text, source, overrides)


def _operating_system_model(
    text: str,
    source: Mapping[str, Any],
    overrides: Mapping[str, Any],
) -> dict[str, Any]:
    from .opsys import build_os
    return build_os(text, source, overrides)


BUILDERS = {
    "calculus": _calculus_model,
    "optimization": _optimization_model,
    "algorithm": _algorithm_model,
    "deep_learning": _deep_learning_model,
    "linear_algebra": _linear_algebra_model,
    "operating_system": _operating_system_model,
}


def _unknown_model(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any]:
    """Keep unsupported questions intact; never substitute an unrelated example."""
    return {
        "model": {"subject": "unknown", "engine": "unsupported_v1", "defaults": {}, "params": [], "teaching": False},
        "conditions": [], "formulas": [], "recognized": False,
        "ambiguities": [_ambiguity(
            "subject", "subject", "暂未识别到可执行的题目类型。请选择类型并核对原题文字、公式和条件后重建。",
            options=[],
        )],
    }


def _title_from(text: str, number: str | None) -> str:
    for line in text.splitlines():
        compact = re.sub(r"\s+", " ", line).strip()
        if len(compact) < 4:
            continue
        compact = NUMBER_MARKER.sub("", compact).strip()
        if len(compact) > 48:
            compact = compact[:47] + "…"
        return f"第 {number} 题 · {compact}" if number else compact
    return "未命名题目"


def build_problem(
    text: str,
    *,
    number: str | None = None,
    pages: Sequence[Mapping[str, Any]] | None = None,
    files: Sequence[Mapping[str, Any]] | None = None,
    subject_hint: str | None = None,
    title_override: str | None = None,
    overrides: Mapping[str, Any] | None = None,
    problem_index: int = 1,
) -> dict[str, Any]:
    """把一道题的原文转成可执行模型、条件、歧义与解答。"""

    override_values: dict[str, Any] = dict(overrides or {})
    _answer_overrides(text, override_values)
    source_pages = list(pages or [])
    source = _basic_source(source_pages[0]) if source_pages else {"file_id": None, "page": 1, "excerpt": text[:220]}
    method = _page_labels(source_pages, list(files or []))
    classified, confidence = classify_subject(text)
    subject = str(override_values.get("subject") or subject_hint or classified)
    if subject not in BUILDERS:
        subject = classified if classified in BUILDERS else "unknown"

    builder = BUILDERS.get(subject, _unknown_model)
    built = builder(text, source, override_values)
    model = built["model"]

    if any(page.get("requires_formula_confirmation") for page in source_pages):
        built["ambiguities"].append(_ambiguity(
            "source_formula_confirmation", "source_formula",
            "图片或PDF中的公式可能存在识别误差。请对照原稿核对指数、分子分母、根号和区间，必要时修正题目文字后确认。",
            options=[{"value": "confirmed", "label": "已对照原图核对并修正全部公式"}],
        ))

    # 学生已经作答的歧义项：保留答案，不再阻塞。
    answers = override_values.get("ambiguity_answers") or {}
    for item in built["ambiguities"]:
        if item["id"] in answers and str(answers[item["id"]]).strip():
            # New semantic builders consume corrections themselves. If a blocking
            # condition remains, arbitrary text must never turn it into a proof.
            if item["id"].startswith("exam_") or item["id"] in ("heap_conditions", "subject", "solution"):
                continue
            if item["id"] == "source_formula_confirmation" and answers[item["id"]] != "confirmed":
                continue
            item["resolved"] = True
            item["answer"] = str(answers[item["id"]])
    blocking = [item for item in built["ambiguities"] if item["severity"] == "blocking" and not item["resolved"]]
    status = "ready" if not blocking else "needs_review"
    if subject not in BUILDERS:
        status = "unsupported"

    answer_override = str(override_values.get("student_answer") or "").strip()
    problem: dict[str, Any] = {
        "problem_id": f"prb_{problem_index}",
        "number": number,
        "title": title_override or _title_from(text, number),
        "text": text.strip(),
        "subject": subject,
        "subject_label": SUBJECT_LABELS.get(subject, SUBJECT_LABELS["unknown"]),
        "confidence": confidence,
        "status": status,
        "source": {
            "page_from": int(source_pages[0].get("page") or 1) if source_pages else 1,
            "page_to": int(source_pages[-1].get("page") or 1) if source_pages else 1,
            "file_names": sorted({str(page.get("file_id")) for page in source_pages}),
            "label": method,
            "excerpt": re.sub(r"\s+", " ", text).strip()[:260],
        },
        "source_pages": [
            {
                "file_id": page.get("file_id"),
                "page": page.get("page"),
                "image_key": page.get("image_key"),
                "method": page.get("method"),
                "requires_formula_confirmation": bool(page.get("requires_formula_confirmation")),
            }
            for page in source_pages
        ],
        "recognition": {
            "method": method,
            "raw_text": text.strip(),
            "conditions": built["conditions"],
            "ambiguities": built["ambiguities"],
            "formulas": built["formulas"],
            "recognized_subject": classified,
            "ai_used": False,
        },
        "model": model,
    }
    if answer_override:
        problem["recognition"]["reference_answer_text"] = answer_override
    return problem


def build_lab_document(
    *,
    lab_id: str,
    title: str,
    source: Mapping[str, Any],
    now_iso: str,
    files: Sequence[Mapping[str, Any]],
    subject_hint: str | None = None,
    max_problems: int = 12,
) -> dict[str, Any]:
    """拆分、识别并装配完整实验室文档（不含持久化）。"""

    split = split_problems(source.get("pages") or [], files)[:max_problems]
    if not split:
        raise RecognitionError("没有可识别的题目")
    problems = [
        build_problem(
            item["text"],
            number=item.get("number"),
            pages=item["pages"],
            files=files,
            subject_hint=subject_hint,
            problem_index=index + 1,
        )
        for index, item in enumerate(split)
    ]
    for problem in problems:
        _attach_solution(problem)
        problem["states"] = _default_state(problem)
    selected = problems[0]
    return {
        "schema_version": "lab.1",
        "lab_id": lab_id,
        "title": title.strip()[:120] or selected["title"],
        "created_at": now_iso,
        "updated_at": now_iso,
        "revision": 1,
        "source": {
            "files": list(files),
            "pages": list(source.get("pages") or []),
            "method": source.get("method"),
            "citation": _citation(source, files),
        },
        "problems": problems,
        "selected_problem_id": selected["problem_id"],
        "status": selected["status"],
        "subject": selected["subject"],
        "problem_count": len(problems),
        "capabilities": {
            "ai_configured": False,
            "note": "识别与求解均由本地确定性引擎完成；AI 增强只在后端配置明确开启后才会调用。",
        },
    }


def _citation(source: Mapping[str, Any], files: Sequence[Mapping[str, Any]]) -> str:
    names = [str(item.get("name")) for item in files if item.get("role") in ("problem", "courseware")]
    if not names:
        names = [str(item.get("name")) for item in files]
    pages = [int(page.get("page") or 0) for page in source.get("pages") or []]
    page_text = f"第 {min(pages)}–{max(pages)} 页" if pages else "原文"
    return f"{'、'.join(dict.fromkeys(names)) or '粘贴文本'} · {page_text}"


def _default_state(problem: Mapping[str, Any]) -> dict[str, Any]:
    model = problem["model"]
    params = dict(model.get("defaults") or {})
    scenario = {
        "id": "baseline",
        "name": "原题条件",
        "params": dict(params),
        "created_at": None,
        "kind": "baseline",
        "summary": "原题识别条件",
    }
    return {
        "params": params,
        "step": 0,
        "mode": "explore",
        "notes": "",
        "observations": [],
        "events": [],
        "scenarios": [scenario],
        "active_scenario_id": "baseline",
        "attempts": [],
        "evaluated": None,
    }


def select_problem(document: dict[str, Any], problem_id: str) -> dict[str, Any] | None:
    for problem in document.get("problems") or []:
        if problem.get("problem_id") == problem_id:
            return problem
    return None


def rebuild_problem(
    problem: dict[str, Any],
    *,
    files: Sequence[Mapping[str, Any]],
    text: str | None = None,
    subject: str | None = None,
    condition_values: Mapping[str, Any] | None = None,
    ambiguity_answers: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """按学生修正重新编译题目；保留原题文本与学生记录。"""

    overrides = {
        "subject": subject or problem.get("subject"),
        "condition_values": dict(condition_values or {}),
        "ambiguity_answers": dict(ambiguity_answers or {}),
    }
    text_changed = text is not None and text.strip() != str(problem.get('text') or '').strip()
    rebuilt = build_problem(
        (text if text is not None else problem.get("text") or "").strip(),
        number=problem.get("number"),
        pages=[
            {
                "file_id": item.get("file_id"),
                "page": item.get("page"),
                "image_key": item.get("image_key"),
                "method": item.get("method"),
                "requires_formula_confirmation": bool(item.get("requires_formula_confirmation")),
            }
            for item in problem.get("source_pages") or []
        ],
        files=files,
        subject_hint=None,
        title_override=None if text_changed else problem.get("title"),
        overrides=overrides,
        problem_index=int(str(problem.get("problem_id") or "prb_1").split("_")[-1])
        if str(problem.get("problem_id") or "").split("_")[-1].isdigit()
        else 1,
    )
    rebuilt["problem_id"] = problem["problem_id"]
    if not text_changed:
        rebuilt["title"] = problem.get("title") or rebuilt["title"]
    rebuilt["states"] = problem.get("states") or _default_state(rebuilt)
    # 条件结构可能变化：保留学生记录，但参数回到新的默认值，并新增“修正后”情景。
    state = rebuilt["states"]
    state["params"] = dict(rebuilt["model"].get("defaults") or {})
    state["step"] = 0
    baseline = {
        "id": "baseline",
        "name": "核对后条件",
        "params": dict(state["params"]),
        "created_at": None,
        "kind": "baseline",
        "summary": "学生核对后的原题条件",
    }
    state["scenarios"] = [baseline, *[item for item in state.get("scenarios") or [] if item.get("id") != "baseline"]]
    state["active_scenario_id"] = "baseline"
    _attach_solution(rebuilt)
    return rebuilt


def _attach_solution(problem: dict[str, Any]) -> None:
    """An unreadable formula or unsupported branch must remain reviewable."""
    from .solvers import solve_problem, SolveError
    if (problem['model'].get('task') or problem['model'].get('engine') == 'heap_v1') and any(
        item['severity'] == 'blocking' and not item['resolved'] for item in problem['recognition']['ambiguities']
    ):
        problem['solution'] = {'answer': '', 'summary': '先核对原题公式与条件，再计算答案。', 'steps': [], 'limitations': []}
        return
    try:
        problem["solution"] = solve_problem(problem["model"])
        solution = problem["solution"]
        unfinished = (
            solution.get("solution_complete") is False
            or solution.get("solution_status") in ("incomplete", "undetermined", "divergent", "unsupported", "undefined")
        )
        if unfinished:
            problem["status"] = "needs_review"
            reason = (
                solution.get("incomplete_reason")
                or solution.get("reason")
                or solution.get("summary")
                or "当前结果尚未完成，不能自动判分。"
            )
            problem["recognition"]["ambiguities"] = [
                item for item in problem["recognition"]["ambiguities"]
                if item.get("id") != "solution_incomplete"
            ]
            problem["recognition"]["ambiguities"].append(_ambiguity(
                "solution_incomplete", "solution", str(reason), options=[]))
    except (SolveError, ValueError, TypeError, ExprError, ArithmeticError) as exc:
        problem["solution"] = {"answer": "", "summary": "请先核对原题公式、区间或分支。", "steps": [],
                               "limitations": [str(exc)]}
        problem["status"] = "needs_review"
        problem["recognition"]["ambiguities"].append(_ambiguity(
            "solution", "solution", f"当前条件暂时不能求解：{exc}。请修正题目后重新求解。", options=[]))


__all__ = [
    "RecognitionError",
    "SUBJECT_LABELS",
    "build_lab_document",
    "build_problem",
    "classify_subject",
    "rebuild_problem",
    "select_problem",
    "split_problems",
]

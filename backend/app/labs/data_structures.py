"""408 数据结构题型：确定性识别、执行轨迹与核对。

覆盖：算法分析（语句频度、循环/递归复杂度、效率比较）、顺序表与链表（插入删除查找、
逆置、有序表合并、去重、双向/循环链表口径）、栈（出入栈模拟、合法出栈序列、括号匹配、
表达式转换与求值、递归调用过程）、队列（顺序/循环队列、队空队满与长度、双端队列、
栈与队列互模拟）、数组与特殊矩阵（地址计算、对称/三角/三对角压缩存储、稀疏矩阵三元组）、
串与模式匹配（朴素匹配、KMP next/nextval、比较次数）。

与微积分实验同流程：识别 → 可执行模型 → 轨迹回放 → 核对。关键数据缺失时返回
blocked 模型并给出可核对的说明，不编造结果。
"""
from __future__ import annotations

import math
import re
from typing import Any, Mapping

_MAX_FRAMES = 200

_CN_NUM = {"零": 0, "一": 1, "两": 2, "二": 2, "三": 3, "四": 4, "五": 5,
           "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------


def _frame(index: int, label: str, detail: str, values: dict[str, Any], line: int | None = None,
           *, visual: dict[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"index": index, "label": label, "detail": detail, "values": values}
    if line is not None:
        payload["pseudocodeLine"] = line
    if visual is not None:
        payload["visual"] = visual
    return payload


def _tree_visual(root: Any, highlight: Any = None) -> dict[str, Any]:
    """把 v/l/r 二叉树压成带坐标的帧视觉数据：x 为中序序号，y 为深度。"""
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, str]] = []
    cursor = [0]

    def walk(node: Any, depth: int) -> None:
        if not node:
            return
        walk(node.get("l"), depth + 1)
        node_id = str(node.get("v"))
        nodes.append({"id": node_id, "label": node_id, "x": cursor[0], "y": depth})
        cursor[0] += 1
        for child_key in ("l", "r"):
            child = node.get(child_key)
            if child:
                edges.append({"from": node_id, "to": str(child.get("v"))})
        walk(node.get("r"), depth + 1)

    walk(root, 0)
    return {"type": "tree", "nodes": nodes, "edges": edges,
            "highlight": str(highlight) if highlight is not None else None}


def _check(cid: str, label: str, ok: bool, detail: str) -> dict[str, Any]:
    return {"id": cid, "label": label, "status": "pass" if ok else "fail", "detail": detail}


def _cn_number(token: str) -> int | None:
    token = token.strip()
    if token.isdigit():
        return int(token)
    if token in _CN_NUM:
        return _CN_NUM[token]
    if "十" in token:
        left, _, right = token.partition("十")
        try:
            return (_CN_NUM.get(left, 1) if left else 1) * 10 + (_CN_NUM.get(right, 0) if right else 0)
        except KeyError:
            return None
    return None


def _seq(raw: str) -> list[int]:
    token = r"-?\d+"
    stripped = raw.strip().strip("[]（）(){} ")
    if not re.fullmatch(rf"{token}(?:\s*[,，、;；]\s*{token})*", stripped):
        return []
    return [int(v) for v in re.findall(token, stripped)]


def _fmt(items: list[Any]) -> str:
    return ", ".join(str(item) for item in items) if items else "空"


def _fmt_stack(stack: list[Any]) -> str:
    return ("底 → " + " → ".join(str(item) for item in stack)) if stack else "空栈"


def _truncate(frames: list[dict[str, Any]], notes: list[str]) -> list[dict[str, Any]]:
    if len(frames) <= _MAX_FRAMES:
        return frames
    notes.append(f"执行记录超过 {_MAX_FRAMES} 帧，仅保留前 {_MAX_FRAMES} 帧；结论仍来自完整执行。")
    return frames[:_MAX_FRAMES]


def _ok_result(kind: str, headline: str, answer: str, frames: list[dict[str, Any]], pseudocode: list[str],
               checks: list[dict[str, Any]], notes: list[str], *, answer_value: float | None = None,
               answer_order: list[str] | None = None) -> dict[str, Any]:
    metrics: list[dict[str, Any]] = [{"id": "answer", "label": "结论", "value": answer, "tone": "accent"}]
    result: dict[str, Any] = {
        "subject": "algorithm", "algorithm": "data_structure", "ds_kind": kind, "status": "ok",
        "headline": headline, "answer": answer, "metrics": metrics, "checks": checks, "notes": notes,
        "trace": frames, "frames": frames, "pseudocode": pseudocode, "params": {},
    }
    if answer_value is not None:
        result["answer_value"] = answer_value
        metrics.append({"id": "value", "label": "数值", "value": str(answer_value)})
    if answer_order:
        result["answer_order"] = answer_order
    return result


def _blocked_result(kind: str, reason: str) -> dict[str, Any]:
    return {
        "subject": "algorithm", "algorithm": "data_structure", "ds_kind": kind, "status": "blocked",
        "reason": reason, "headline": reason, "answer": "", "metrics": [], "checks": [], "notes": [],
        "trace": [], "frames": [], "pseudocode": [], "params": {},
    }


def _built(kind: str, model: dict[str, Any], conditions: list[dict[str, Any]], formulas: list[dict[str, Any]]) -> dict[str, Any]:
    return {"model": model, "conditions": conditions, "formulas": formulas, "ambiguities": [], "recognized": True}


def _blocked_model(kind: str, reason: str) -> dict[str, Any]:
    model = {"engine": f"ds_{kind}_v1", "subject": "algorithm", "ds_kind": kind, "blocked": reason,
             "defaults": {}, "params": [], "teaching": False}
    return {"model": model, "conditions": [], "formulas": [],
            "ambiguities": [{"id": "ds_blocked", "field": "ds_kind",
                             "question": f"未能完成该题型的自动建模：{reason}。请核对题面写法后修正重试。",
                             "severity": "blocking", "options": [], "resolved": False, "answer": None}],
            "recognized": False}


def _condition(cid: str, label: str, value: Any, *, source: Mapping[str, Any] | None = None,
               kind: str = "text", editable: bool = True, note: str | None = None) -> dict[str, Any]:
    return {"id": cid, "label": label, "value": value, "kind": kind, "unit": "",
            "provenance": "original", "source": dict(source or {}), "editable": editable,
            "options": [], "min": None, "max": None, "step": None, "note": note}


def _clause_values(cv: Mapping[str, Any], cid: str, fallback: Any) -> Any:
    """rebuild 时学生修改的条件值按 id 覆盖。"""
    value = cv.get(cid)
    return fallback if value in (None, "") else value


# ---------------------------------------------------------------------------
# 各题型伪代码
# ---------------------------------------------------------------------------

PSEUDOCODES: dict[str, list[str]] = {
    "list_ops": ["定位操作位置（顺序表按位序，链表沿指针走）",
                 "插入：后续元素/指针依次调整",
                 "删除：摘除元素并回收位置",
                 "记录每次操作的移动/比较次数",
                 "输出最终表与累计开销"],
    "stack_ops": ["读入一个操作",
                  "入栈：写入栈顶，栈顶指针 +1",
                  "出栈：栈空则失败，否则弹出栈顶",
                  "栈空即出栈失败；记录出栈序列",
                  "全部操作结束后输出栈与出栈序列"],
    "brackets": ["左括号入栈",
                 "右括号：与栈顶配对，配对则弹栈",
                 "栈空遇右括号，或结束栈非空 → 不匹配",
                 "全部处理完且栈空 → 匹配"],
    "expression": ["读入一个 token",
                   "操作数直接进入输出/求值栈",
                   "运算符与栈顶按优先级比较后入栈（^ 右结合）",
                   "')' 弹出运算符直到 '('",
                   "结束弹出剩余运算符；后缀式逐项求值"],
    "recursion": ["调用：压入新栈帧（参数入栈）",
                  "到达基例：开始返回",
                  "返回：弹出栈帧，回传结果",
                  "记录调用次数与栈深",
                  "全部返回后输出结果"],
    "queue_ops": ["入队：判满后写入 Q[rear]，rear 后移",
                  "出队：判空后取 Q[front]，front 后移",
                  "循环队列：下标对容量取模",
                  "队空 front==rear；队满 (rear+1)%size==front（牺牲一格）",
                  "长度 = (rear-front+size) mod size"],
    "deque": ["按限制选择可用的输入端/输出端",
              "每步：输入下一个元素，或从允许的端输出",
              "需要输出的元素不可达 → 该序列不合法",
              "搜索全部可行操作序列后给出结论"],
    "stack_queue_sim": ["入队 → 压入 S1",
                        "出队 → S2 空则把 S1 全部倒入 S2，再弹出 S2 栈顶",
                        "入栈 → 加入活动队列",
                        "出栈 → 活动队列前 n-1 个转移到另一队列，取最后一个",
                        "记录每次转移与结果"],
    "array_address": ["确定各维下标范围与每维元素个数",
                      "行优先：先排满一行再换行，累计前行偏移",
                      "偏移元素个数 = 前面元素个数",
                      "地址 = 首地址 + 偏移 × 元素字节数"],
    "matrix_storage": ["按存储方式确定 (i,j) 前面的元素个数",
                       "对称/下三角行优先：k = i(i-1)/2 + j（下标从 1 起）",
                       "三对角：k = 2i + j - 2（下标从 1 起）",
                       "给出下标或按 k 反查元素"],
    "sparse": ["按行优先扫描矩阵，非零元素写入三元组 (行,列,值)",
               "表头记录行数、列数、非零元个数",
               "转置：按列号从小到大重排三元组"],
    "string_match": ["朴素：每个起点逐字符比较，失配右移一位",
                     "KMP：失配时 j = next[j]，主串指针不回溯",
                     "next[j] = 最长相等前后缀长度 + 1（next[1]=0）",
                     "nextval 在 next 基础上消除等同失配",
                     "统计比较次数并给出匹配位置"],
    "analysis": ["确定各层循环的起点、终点与步进",
                 "逐层累计内层语句执行次数",
                 "对给定 n 代入得到精确频度",
                 "按最高阶项给出渐进复杂度"],
}


# ---------------------------------------------------------------------------
# 1) 算法分析：语句频度 / 复杂度 / 效率比较
# ---------------------------------------------------------------------------

_LOOP_FOR = re.compile(
    r"for\s*\(\s*([A-Za-z])\s*=\s*(-?\d+)\s*;\s*\1\s*<=\s*([^;)]+?)\s*;\s*([^)]+)\)", re.I)
_LOOP_CN = re.compile(r"([A-Za-z])\s*(?:从|=)\s*(\d+)\s*(?:到|<=|≤)\s*([^\s，,。;；]+)")
_REC_REL = re.compile(r"T\(n\)\s*=\s*(\d+)\s*[TＴ]\(n\s*/\s*(\d+)\)\s*\+\s*(n\^\s*2|n²|n\s*log\s*n|n|1)", re.I)


def _loop_kind(update: str) -> tuple[str, int]:
    """解析循环步进：i+=k → 线性步长 k；i*=k → 倍增（对数层）；默认步长 1。"""
    update = update.replace(" ", "")
    m = re.search(r"\*=\s*(\d+)", update)
    if m and int(m.group(1)) > 1:
        return "log", int(m.group(1))
    m = re.search(r"\+=\s*(\d+)", update)
    if m:
        return "linear", max(1, int(m.group(1)))
    if re.search(r"\*\s*2\b|<<\s*1", update):
        return "log", 2
    return "linear", 1


def _detect_structure(text: str, spans: list[tuple[int, int]], count: int) -> str:
    """区分嵌套与顺序执行：代码风格看前一个 for 的体是否已用 } 结束；中文看措辞。"""
    if count <= 1:
        return "single"
    if len(spans) >= 2:
        between = text[spans[0][1]:spans[1][0]]
        if "}" in between:
            return "sequential"
        if between.strip() == "":
            return "nested"
    if re.search(r"依次执行|先后执行|分别执行", text):
        return "sequential"
    return "nested"


def _parse_loops(text: str) -> tuple[list[dict[str, Any]], str] | None:
    loops: list[dict[str, Any]] = []
    spans: list[tuple[int, int]] = []
    for match in _LOOP_FOR.finditer(text):
        var, lo, hi, update = match.group(1), match.group(2), match.group(3), match.group(4)
        kind, param = _loop_kind(update)
        loop = {"var": var, "lo": lo, "hi": hi.strip(), "kind": kind}
        loop["factor" if kind == "log" else "step"] = param
        loops.append(loop)
        spans.append((match.start(), match.end()))
    if loops:
        return loops[:3], _detect_structure(text, spans, len(loops))
    for match in _LOOP_CN.finditer(text):
        var, lo, hi = match.group(1), match.group(2), match.group(3).strip("）)。")
        context = text[max(0, match.start() - 24): match.end() + 24]
        kind, param = ("log", 2) if re.search(r"\*=2|×2|翻倍|倍增", context) else ("linear", 1)
        if kind == "linear" and re.search(r"步长\s*[为是]?\s*2|每次(?:加|增加)\s*2|\+=\s*2", context):
            param = 2
        loop = {"var": var, "lo": lo, "hi": hi, "kind": kind}
        loop["factor" if kind == "log" else "step"] = param
        loops.append(loop)
    if not loops:
        return None
    structure = "sequential" if len(loops) > 1 and re.search(r"依次执行|先后执行|分别执行", text) else "nested"
    return loops[:3], structure


def _hi_value(raw: str, env: Mapping[str, int], n: int) -> int:
    text = str(raw).replace(" ", "").strip("=")
    if re.fullmatch(r"\d+", text):
        return int(text)
    token = re.sub(r"n\^2|n²", "n*n", text)
    result = 1
    for part in token.split("*"):
        part = part.strip()
        if not part:
            continue
        if part == "n":
            result *= n
        elif part == "n/2":
            result *= n // 2
        elif part == "1":
            pass
        elif part in env:
            result *= env[part]
        elif part.endswith("/2") and part[:-2] in env:
            result *= env[part[:-2]] // 2
        elif re.fullmatch(r"\d+", part):
            result *= int(part)
        else:
            raise ValueError(f"暂不支持循环终值“{raw}”，请改写为 n、i、n/2 一类的形式")
    return result


def _loops_complexity(loops: list[dict[str, Any]], structure: str = "nested") -> tuple[int, int]:
    if structure == "sequential":
        # 依次执行的循环互不依赖：取各循环复杂度的最大者（求和不改变阶）。
        best_p, best_q = 0, 0
        for loop in loops:
            p_i, q_i = (0, 1) if loop["kind"] == "log" else (1, 0)
            if p_i * 2 + q_i > best_p * 2 + best_q:
                best_p, best_q = p_i, q_i
        return best_p, best_q
    p = q = 0
    seen_vars: list[str] = []
    for loop in loops:
        hi = str(loop["hi"]).replace(" ", "")
        dependent = any(re.fullmatch(rf"{re.escape(v)}(?:/2)?", hi) for v in seen_vars)
        if loop["kind"] == "linear":
            if re.search(r"n\*n|n\^2|n²", hi):
                p += 2
            elif re.search(r"n", hi) or dependent:
                p += 1
            elif not re.fullmatch(r"\d+", hi):
                p += 1
        else:
            q += 1
        seen_vars.append(str(loop["var"]))
    return p, q


def _complexity_text(p: int, q: int) -> str:
    if q == 0:
        base = "1" if p == 0 else ("n" if p == 1 else f"n^{p}")
        return f"O({base})"
    log_part = "log n" if q == 1 else f"log^{q} n"
    if p == 0:
        return f"O({log_part})"
    return f"O({'n' if p == 1 else f'n^{p}'} {log_part})"


def _complexity_rank(text: str) -> int:
    lowered = re.sub(r"\s+", "", str(text).lower())
    if "2^n" in lowered or "exp" in lowered:
        return 99
    if "log" in lowered:
        match = re.search(r"n\^(\d+)", lowered)
        base = int(match.group(1)) if match else (1 if re.search(r"(?<![a-z])n", lowered) else 0)
        return base * 2 + 1
    match = re.search(r"n\^(\d+)", lowered)
    if match:
        return int(match.group(1)) * 2
    if re.search(r"(?<![a-z])n", lowered):
        return 2
    return 0


def _count_loops(loops: list[dict[str, Any]], n: int, structure: str = "nested") -> tuple[int, list[dict[str, Any]]]:
    frames: list[dict[str, Any]] = []

    def advance(loop: dict[str, Any], value: int) -> int:
        if loop["kind"] == "log":
            return value * int(loop.get("factor", 2))
        return value + int(loop.get("step", 1))

    def run_one(loop: dict[str, Any], order: int) -> int:
        lo = _hi_value(str(loop["lo"]), {}, n)
        hi = _hi_value(str(loop["hi"]), {}, n)
        var = str(loop["var"])
        value = lo
        guard = 0
        accumulated = 0
        while value <= hi:
            guard += 1
            if guard > 200000:
                raise ValueError("循环规模超出可执行范围，请缩小 n")
            accumulated += 1
            if len(frames) < _MAX_FRAMES:
                frames.append(_frame(len(frames) + 1, f"第 {order} 个循环：{var} = {value}",
                                     f"{var}={value} 时执行 1 次；该循环累计 {accumulated} 次，总计 {total + accumulated} 次。",
                                     {"循环": f"第 {order} 个", "变量": f"{var}={value}", "累计次数": str(total + accumulated)}, 3))
            value = advance(loop, value)
        return accumulated

    if structure == "sequential":
        total = 0
        for order, loop in enumerate(loops, 1):
            total += run_one(loop, order)
        return total, frames

    def run(level: int, env: dict[str, int]) -> int:
        loop = loops[level]
        lo = _hi_value(str(loop["lo"]), env, n)
        hi = _hi_value(str(loop["hi"]), env, n)
        var = str(loop["var"])
        value = lo
        guard = 0
        accumulated = 0
        while value <= hi:
            guard += 1
            if guard > 200000:
                raise ValueError("循环规模超出可执行范围，请缩小 n")
            if level + 1 < len(loops):
                inner = run(level + 1, {**env, var: value})
            else:
                inner = 1
            accumulated += inner
            if level == 0 and len(frames) < _MAX_FRAMES:
                frames.append(_frame(len(frames) + 1, f"{var} = {value}",
                                     f"{var}={value} 时，内层语句执行 {inner} 次；累计 {accumulated} 次。",
                                     {"外层变量": f"{var}={value}", "本次次数": str(inner), "累计次数": str(accumulated)}, 3))
            value = advance(loop, value)
        return accumulated

    total = run(0, {})
    return total, frames


def _master_rows(text: str) -> list[dict[str, Any]] | None:
    rows: list[dict[str, Any]] = []
    for a_raw, b_raw, f_raw in _REC_REL.findall(text):
        a, b = int(a_raw), int(b_raw)
        f = re.sub(r"\s+", "", f_raw).replace("²", "^2")
        f = {"n^2": "n2", "n": "n", "1": "1"}.get(f)
        if f is None:
            continue
        exponent = math.log(a, b)
        phi = {"1": 0.0, "n": 1.0, "n2": 2.0}[f]
        if phi < exponent - 1e-9:
            if abs(exponent - round(exponent)) < 1e-9:
                answer = _complexity_text(int(round(exponent)), 0)
            else:
                answer = f"O(n^{exponent:.2f})".replace(".00", "")
            case = "f(n) 低于 n^log_b(a)：主定理情形 1"
        elif abs(phi - exponent) < 1e-9:
            answer = _complexity_text(int(round(exponent)), 1)
            case = "f(n) 与 n^log_b(a) 同阶：主定理情形 2"
        else:
            answer = {0: "O(1)", 1: "O(n)", 2: "O(n^2)"}[int(phi)]
            case = "f(n) 占主导（满足正则条件）：主定理情形 3"
        f_text = {"1": "1", "n": "n", "n2": "n^2"}[f]
        rows.append({"rel": f"T(n)={a}T(n/{b})+{f_text}", "answer": answer,
                     "depth": f"log_{b} n", "case": case})
    return rows or None


def build_analysis(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    relations = _master_rows(text)
    parsed = _parse_loops(text)
    loops = parsed[0] if parsed else []
    structure = parsed[1] if parsed else "nested"
    if relations is None and parsed is None:
        return None
    cv = overrides.get("condition_values") or {}
    n_default = None
    for match in re.finditer(r"n\s*[=是为]\s*(\d{1,3})", text):
        n_default = int(match.group(1))
    n = int(_clause_values(cv, "n", n_default if n_default is not None else 4))
    compare = [token.strip() for token in re.findall(r"O\(([^)]+)\)", text)][:2]
    model = {"engine": "ds_analysis_v1", "subject": "algorithm", "ds_kind": "analysis",
             "mode": "recursion" if (relations is not None and parsed is None) else "loops",
             "relations": relations or [], "loops": loops, "structure": structure, "compare": compare,
             "want_space": "空间复杂度" in text,
             "n": n, "defaults": {"n": n}, "params": [], "teaching": False}
    conditions: list[dict[str, Any]] = []
    if model["mode"] == "recursion":
        conditions.append(_condition("relation", "递推关系",
                                     "；".join(row["rel"] for row in relations or []), source=source, editable=False))
        conditions.append(_condition("n", "规模 n", n, kind="number", source=source, note="仅用于展示规模含义。"))
    else:
        assert loops is not None
        structure_label = "顺序执行" if structure == "sequential" else "嵌套"
        conditions.append(_condition("loops", "循环结构",
                                     f"（{structure_label}）" + "；".join(
                                         f"{loop['var']}: {loop['lo']}→{loop['hi']}"
                                         f"（{'倍增×' + str(loop.get('factor', 2)) if loop['kind'] == 'log' else '步进 ' + str(loop.get('step', 1))}）"
                                         for loop in loops), source=source, editable=False))
        conditions.append(_condition("n", "规模 n", n, kind="number", source=source, note="修改后重新求解可得到新的精确频度。"))
    formulas = [{"id": "analysis_rule", "tex": r"T(n)=\sum \prod f,\quad O(\cdot)=\text{最高阶项}",
                 "plain": "语句频度按循环逐层累计；复杂度只保留最高阶项。递归用主定理比较 f(n) 与 n^log_b(a)。", "role": "分析方法"}]
    return _built("analysis", model, conditions, formulas)


def eval_analysis(model: Mapping[str, Any]) -> dict[str, Any]:
    notes: list[str] = []
    frames: list[dict[str, Any]] = []
    answer_value: float | None = None
    if model.get("mode") == "recursion":
        rows = list(model.get("relations") or [])
        for row in rows:
            frames.append(_frame(len(frames) + 1, f"分析 {row['rel']}", f"{row['case']}，得到 {row['answer']}；递归深度 {row['depth']}。",
                                 {"递推式": row["rel"], "复杂度": row["answer"], "递归深度": row["depth"]}, 3))
        answer_text = "；".join(f"{row['rel']} 的复杂度为 {row['answer']}" for row in rows)
        if len(rows) > 1:
            best = min(rows, key=lambda row: _complexity_rank(row["answer"]))
            notes.append(f"其中 {best['rel']} 渐进更优（{best['answer']}）。")
            answer_text += f"；更优：{best['rel']}（{best['answer']}）"
        checks = [_check("master", "主定理判定", True, "按 f(n) 与 n^log_b(a) 的阶比较完成判定。")]
        headline = "递归复杂度分析"
    else:
        loops = list(model.get("loops") or [])
        structure = str(model.get("structure") or "nested")
        n = int(model.get("n") or 4)
        p, q = _loops_complexity(loops, structure)
        complexity = _complexity_text(p, q)
        total, frames = _count_loops(loops, n, structure)
        answer_value = float(total)
        answer_text = f"n={n} 时语句执行 {total} 次；时间复杂度 {complexity}"
        if model.get("want_space"):
            answer_text += "；空间复杂度 O(1)（只用常数个辅助变量）"
        if any(loop["kind"] == "log" for loop in loops):
            notes.append("含倍增循环：步进为 i*=2，层数为 ⌊log₂(终值)⌋+1。")
        checks = [
            _check("count", "频度计算", total >= 0, f"逐层累计循环体执行次数，n={n} 时共 {total} 次。"),
            _check("complexity", "渐进阶", True, f"{complexity}：只保留最高阶项，忽略常数因子。"),
        ]
        headline = "循环语句频度与复杂度"
    compare = list(model.get("compare") or [])
    if len(compare) >= 2:
        ranked = sorted(compare, key=lambda token: _complexity_rank(f"O({token})"))
        notes.append(f"效率比较：O({ranked[0]}) 渐进更优，n 增大后差距显著。")
        answer_text += f"；效率比较：O({compare[0]}) 与 O({compare[1]})，更优 O({ranked[0]})"
        frames.append(_frame(len(frames) + 1, "算法效率比较",
                             "按渐进阶比较：" + "；".join(f"O({token})" for token in compare),
                             {"更优": f"O({ranked[0]})"}, 4))
    return _ok_result("analysis", headline, answer_text, _truncate(frames, notes), PSEUDOCODES["analysis"],
                      checks, notes, answer_value=answer_value)


# ---------------------------------------------------------------------------
# 2) 顺序表与链表
# ---------------------------------------------------------------------------

def _parse_list_ops(text: str) -> tuple[list[int], list[int] | None, list[dict[str, Any]]] | None:
    groups = re.findall(r"[（(]\s*([0-9]{1,4}(?:\s*[,，、]\s*[0-9]{1,4})+)\s*[)）]", text)
    lists = [_seq(group) for group in groups]
    ops: list[dict[str, Any]] = []
    for clause in re.split(r"[，,。;；\n]+", text):
        c = clause.strip()
        if not c:
            continue
        m = re.search(r"(?:在|于)?第\s*(\d+)\s*个?(?:元素|位置|结点|节点)?(?:之前|前|处|上)?插入\s*(-?\d+)", c)
        if m:
            ops.append({"op": "insert", "pos": int(m.group(1)), "value": int(m.group(2))})
            continue
        m = re.search(r"插入\s*(-?\d+)\s*(?:到|至|作为)?\s*第\s*(\d+)", c)
        if m:
            ops.append({"op": "insert", "value": int(m.group(1)), "pos": int(m.group(2))})
            continue
        m = re.search(r"删除第\s*(\d+)\s*个?(?:元素|位置|结点|节点)?", c)
        if m:
            ops.append({"op": "delete_pos", "pos": int(m.group(1))})
            continue
        m = re.search(r"删除(?:值为|元素|结点|节点)?\s*(-?\d+)(?:的?(?:元素|结点|节点))?", c)
        if m:
            ops.append({"op": "delete_value", "value": int(m.group(1))})
            continue
        m = re.search(r"(?:查找|搜索)(?:值为|元素)?\s*(-?\d+)", c)
        if m:
            ops.append({"op": "search", "value": int(m.group(1))})
            continue
        if re.search(r"逆置|反转|倒置", c):
            ops.append({"op": "reverse"})
        elif re.search(r"去重|删除重复", c):
            ops.append({"op": "dedupe"})
        elif re.search(r"合并", c) and len(lists) >= 2:
            ops.append({"op": "merge"})
    if re.search(r"去重|删除重复", text) and not any(op["op"] == "dedupe" for op in ops):
        ops.append({"op": "dedupe"})
    if re.search(r"逆置|反转", text) and not any(op["op"] == "reverse" for op in ops):
        ops.append({"op": "reverse"})
    if re.search(r"合并", text) and len(lists) >= 2 and not any(op["op"] == "merge" for op in ops):
        ops.append({"op": "merge"})
    if not ops or not lists:
        return None
    return lists[0], (lists[1] if len(lists) > 1 else None), ops


def build_list_ops(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    parsed = _parse_list_ops(text)
    if parsed is None:
        return None
    first, second, ops = parsed
    list_type = ("double" if "双向" in text else "circular" if "循环" in text
                 else "linked" if re.search(r"链表", text) else "array")
    model = {"engine": "ds_list_v1", "subject": "algorithm", "ds_kind": "list_ops",
             "list_type": list_type, "initial": first, "initial2": second or [], "ops": ops,
             "defaults": {}, "params": [], "teaching": False}
    conditions = [
        _condition("list", "线性表", _fmt(first), source=source, editable=False),
        _condition("list_type", "存储结构",
                   {"array": "顺序表", "linked": "单链表", "double": "双向链表", "circular": "循环链表"}[list_type],
                   source=source, editable=False),
        _condition("ops", "操作序列", "；".join(", ".join(f"{k}={v}" for k, v in op.items()) for op in ops),
                   source=source, editable=False),
    ]
    if second:
        conditions.insert(1, _condition("list2", "第二个有序表", _fmt(second), source=source, editable=False))
    formulas = [{"id": "list_cost", "tex": r"\text{顺序表插入/删除移动 } n-p+1\,/\,n-p \text{ 个元素}",
                 "plain": "顺序表按位插入移动 n-p+1 个元素，删除移动 n-p 个；链表定位后只改指针，不搬移元素。", "role": "开销口径"}]
    return _built("list_ops", model, conditions, formulas)


def eval_list_ops(model: Mapping[str, Any]) -> dict[str, Any]:
    notes: list[str] = []
    values = list(model.get("initial") or [])
    other_box = list(model.get("initial2") or [])
    list_type = str(model.get("list_type") or "array")
    is_array = list_type == "array"
    total_moves = 0
    total_cmp = 0
    frames: list[dict[str, Any]] = []

    def record(label: str, detail: str, line: int, extra: dict[str, Any] | None = None) -> None:
        payload: dict[str, Any] = {"表": _fmt(values)}
        if other_box:
            payload["表2"] = _fmt(other_box)
        payload["移动次数"] = str(total_moves)
        payload["比较次数"] = str(total_cmp)
        if extra:
            payload.update(extra)
        frames.append(_frame(len(frames) + 1, label, detail, payload, line))

    record("初始状态", "按题面建立线性表。", 1)
    for op in model.get("ops") or []:
        kind = op.get("op")
        if kind == "insert":
            pos = int(op.get("pos") or (len(values) + 1))
            value = op.get("value")
            if not (1 <= pos <= len(values) + 1):
                record(f"插入 {value}（第 {pos} 位）", "位序越界，插入失败。", 2, {"结果": "失败"})
                continue
            if is_array:
                moves = len(values) - pos + 1
                total_moves += moves
                values.insert(pos - 1, value)
                record(f"第 {pos} 位插入 {value}", f"第 {pos} 位起的元素依次后移，移动 {moves} 次。", 2)
            else:
                total_cmp += max(1, pos)
                values.insert(pos - 1, value)
                record(f"第 {pos} 位插入 {value}", f"沿链定位比较 {max(1, pos)} 次，修改指针完成插入；不移动元素。", 2)
        elif kind == "delete_pos":
            pos = int(op.get("pos") or 0)
            if not (1 <= pos <= len(values)):
                record(f"删除第 {pos} 个元素", "位序越界，删除失败。", 3, {"结果": "失败"})
                continue
            removed = values[pos - 1]
            if is_array:
                moves = len(values) - pos
                total_moves += moves
                values.pop(pos - 1)
                record(f"删除第 {pos} 个元素 {removed}", f"其后 {moves} 个元素依次前移。", 3)
            else:
                total_cmp += pos
                values.pop(pos - 1)
                record(f"删除第 {pos} 个元素 {removed}", f"定位比较 {pos} 次，修改指针摘除结点。", 3)
        elif kind == "delete_value":
            value = op.get("value")
            if value in values:
                pos = values.index(value) + 1
                if is_array:
                    total_cmp += pos
                    moves = len(values) - pos
                    total_moves += moves
                    values.pop(pos - 1)
                    record(f"删除值为 {value} 的元素", f"比较 {pos} 次定位，其后 {moves} 个元素前移。", 3)
                else:
                    total_cmp += pos
                    values.pop(pos - 1)
                    record(f"删除值为 {value} 的元素", f"比较 {pos} 次定位，修改指针摘除结点。", 3)
            else:
                total_cmp += len(values)
                record(f"删除值为 {value} 的元素", f"比较 {len(values)} 次未找到，删除失败。", 3, {"结果": "未找到"})
        elif kind == "search":
            value = op.get("value")
            if value in values:
                pos = values.index(value) + 1
                total_cmp += pos
                record(f"查找 {value}", f"第 {pos} 个元素命中，比较 {pos} 次。", 1, {"查找成功": "是"})
            else:
                total_cmp += len(values) + 1
                record(f"查找 {value}", f"比较 {len(values) + 1} 次仍未命中（含末尾判空），查找失败。", 1, {"查找成功": "否"})
        elif kind == "reverse":
            values.reverse()
            detail = "首尾对称交换完成逆置。" if is_array else "依次头插（修改 next 指针）一趟完成逆置。"
            record("逆置", detail, 2)
        elif kind == "dedupe":
            before = len(values)
            deduped: list[int] = []
            for index, value in enumerate(values):
                if index:
                    total_cmp += 1
                if not deduped or value != deduped[-1]:
                    deduped.append(value)
            values[:] = deduped
            record("去重", f"相邻比较 {before - 1} 次，删除 {before - len(values)} 个重复元素（要求有序表）。", 4)
        elif kind == "merge":
            if not other_box:
                continue
            merged: list[int] = []
            i = j = 0
            merge_cmp = 0
            while i < len(values) and j < len(other_box):
                merge_cmp += 1
                if values[i] <= other_box[j]:
                    merged.append(values[i])
                    i += 1
                else:
                    merged.append(other_box[j])
                    j += 1
            merged.extend(values[i:])
            merged.extend(other_box[j:])
            total_cmp += merge_cmp
            frames.append(_frame(len(frames) + 1, "合并两个有序表",
                                 f"双指针逐一比较，本次比较 {merge_cmp} 次；较短表的剩余整体并入。",
                                 {"表1": _fmt(values), "表2": _fmt(other_box), "本次比较次数": str(merge_cmp)}, 2))
            values[:] = merged
            other_box.clear()
            record("合并完成", f"合并后长度 {len(values)}。", 3)
    headline = f"最终线性表：[{_fmt(values)}]；累计移动 {total_moves} 次、比较 {total_cmp} 次"
    checks = [
        _check("final", "最终表", True, f"长度 {len(values)}：{_fmt(values)}"),
        _check("cost", "开销统计", True, f"移动 {total_moves} 次、比较 {total_cmp} 次"
               + ("（顺序表口径）" if is_array else "（链表口径：定位后的指针修改不计数为移动）")),
    ]
    if not is_array:
        notes.append("链表插入/删除在定位后只修改指针，元素不搬移；定位开销按比较次数计。")
    if list_type == "double":
        notes.append("双向链表：插入/删除需同时修改前驱 prior 与后继 next 指针。")
    if list_type == "circular":
        notes.append("循环链表：尾结点 next 指回头结点，从任一结点可遍历全表。")
    return _ok_result("list_ops", headline, headline, _truncate(frames, notes), PSEUDOCODES["list_ops"],
                      checks, notes, answer_order=[str(v) for v in values])


# ---------------------------------------------------------------------------
# 3) 栈：出入栈模拟与合法出栈序列
# ---------------------------------------------------------------------------

def _parse_io_ops(text: str, push_words: str, pop_words: str) -> list[dict[str, Any]]:
    """按出现顺序扫描出入操作；数字列表可后置（入栈1,2,3）或前置（把1,2,3入栈）。"""
    ops: list[dict[str, Any]] = []
    pattern = re.compile(
        rf"(?P<prevals>-?\d+(?:\s*[,，、]\s*-?\d+)+)\s*(?:依次|逐个|连续)?(?:地)?(?P<prepush>{push_words})(?!序列)"
        rf"|(?P<push>{push_words})(?!序列)\s*(?P<vals>-?\d+(?:\s*[,，、]\s*-?\d+)*)"
        rf"|(?P<pop>{pop_words})(?!序列)(?:\s*(?P<cnt>[0-9]{{1,3}}|[零一二两三四五六七八九十]+)\s*次)?",
        re.I)
    for match in pattern.finditer(text):
        if match.group("prepush"):
            ops.extend({"op": "push", "value": int(v)} for v in re.findall(r"-?\d+", match.group("prevals")))
        elif match.group("push"):
            values = [int(v) for v in re.findall(r"-?\d+", match.group("vals") or "")]
            ops.extend({"op": "push", "value": v} for v in values)
        elif match.group("pop"):
            count = (_cn_number(match.group("cnt")) if match.group("cnt") else 1) or 1
            ops.extend({"op": "pop"} for _ in range(count))
    return ops


def build_stack_ops(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    ops: list[dict[str, Any]] = []
    push_match = re.search(r"(?:入栈|进栈|压栈)序列(?:为|是|[:：])?\s*([\[（(]?\s*-?\d+(?:\s*[,，、]\s*-?\d+)+\s*[\]）)]?)", text)
    pop_match = re.search(r"出栈序列(?:为|是|[:：])?\s*([\[（(]?\s*-?\d+(?:\s*[,，、]\s*-?\d+)+\s*[\]）)]?)", text)
    if not push_match and not pop_match:
        ops = _parse_io_ops(text, "入栈|压栈", "出栈|弹栈")
        if not ops:
            return None
        push_seq, pop_seq, mode = [], [], "ops"
    else:
        if not push_match or not pop_match:
            raise ValueError("请同时给出入栈序列与出栈序列（例如：入栈序列为 1,2,3，出栈序列为 3,2,1）")
        push_seq, pop_seq, mode = _seq(push_match.group(1)), _seq(pop_match.group(1)), "check"
        if not push_seq or not pop_seq:
            raise ValueError("入栈/出栈序列解析失败，请检查数字写法")
    model = {"engine": "ds_stack_v1", "subject": "algorithm", "ds_kind": "stack_ops",
             "mode": mode, "push_seq": push_seq, "pop_seq": pop_seq, "ops": ops,
             "defaults": {}, "params": [], "teaching": False}
    conditions = [
        _condition("push_seq", "入栈序列", _fmt(push_seq) if push_seq else "见操作序列", source=source, editable=False),
        _condition("pop_seq", "出栈序列", _fmt(pop_seq) if pop_seq else "见操作序列", source=source, editable=False),
    ]
    formulas = [{"id": "stack_rule", "tex": r"\text{只能操作栈顶；入栈次序固定}",
                 "plain": "栈：后进先出，只能在栈顶插入/删除；判断出栈序列合法时，入栈与出栈可任意交错。", "role": "栈规则"}]
    return _built("stack_ops", model, conditions, formulas)


def eval_stack_ops(model: Mapping[str, Any]) -> dict[str, Any]:
    notes: list[str] = []
    stack: list[int] = []
    pushed = list(model.get("push_seq") or [])
    expected = list(model.get("pop_seq") or [])
    frames: list[dict[str, Any]] = []
    outputs: list[int] = []

    def record(label: str, detail: str, line: int, extra: dict[str, Any] | None = None) -> None:
        payload: dict[str, Any] = {"栈（底→顶）": _fmt_stack(stack), "已出栈": _fmt(outputs)}
        if extra:
            payload.update(extra)
        frames.append(_frame(len(frames) + 1, label, detail, payload, line))

    if model.get("mode") == "check":
        record("初始化", f"入栈序列 {_fmt(pushed)}，目标出栈序列 {_fmt(expected)}。", 1)
        legal = True
        pi = 0
        for want in expected:
            while pi < len(pushed) and (not stack or stack[-1] != want):
                stack.append(pushed[pi])
                record(f"入栈 {pushed[pi]}", f"栈顶不是 {want}，继续入栈 {pushed[pi]}。", 2, {"待出栈": str(want)})
                pi += 1
            if not stack or stack[-1] != want:
                legal = False
                record(f"无法出栈 {want}", "入栈序列已用尽且栈顶不是所需元素；该出栈序列不合法。", 3, {"结论": "不合法"})
                break
            stack.pop()
            outputs.append(want)
            record(f"出栈 {want}", f"栈顶恰为 {want}，弹出。", 3, {"待出栈": "—"})
        if legal:
            record("完成", "全部出栈成功。", 5)
        headline = (f"出栈序列 {' → '.join(str(v) for v in outputs)} 合法" if legal
                    else "该出栈序列不合法（中途无法取出所需元素）")
        answer = headline if legal else headline + f"；已得到 {' → '.join(str(v) for v in outputs) or '无'}"
        checks = [
            _check("stack_rule", "栈规则", True, "只能操作栈顶；出栈时栈空即非法。"),
            _check("sequence", "出栈记录", legal is True, f"已按序得到 {len(outputs)} 个元素。"),
        ]
    else:
        record("初始化", "空栈。", 1)
        for op in model.get("ops") or []:
            if op.get("op") == "push":
                stack.append(op.get("value"))
                record(f"入栈 {op.get('value')}", f"{op.get('value')} 进栈，成为新栈顶。", 2)
            else:
                if not stack:
                    record("出栈失败", "栈空，出栈操作非法。", 3, {"结论": "失败"})
                    continue
                value = stack.pop()
                outputs.append(value)
                record(f"出栈 {value}", f"弹出栈顶 {value}。", 3)
        record("结束", f"栈中剩余（底→顶）：{_fmt(stack)}。", 5)
        headline = f"最终栈（底→顶）：{_fmt(stack)}" + (f"；出栈序列 {_fmt(outputs)}" if outputs else "")
        answer = headline
        checks = [_check("stack_rule", "栈规则", True, "每次出栈都来自当前栈顶。")]
    notes.append("判断口径：单个栈、入栈次序固定，出栈与入栈可任意交错。")
    return _ok_result("stack_ops", headline, answer, _truncate(frames, notes), PSEUDOCODES["stack_ops"],
                      checks, notes, answer_order=[str(v) for v in outputs])


# ---------------------------------------------------------------------------
# 4) 括号匹配
# ---------------------------------------------------------------------------

def build_brackets(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if not re.search(r"括号.{0,6}(?:匹配|配对)|匹配.{0,6}括号", text):
        return None
    cv = overrides.get("condition_values") or {}
    candidate = _clause_values(cv, "expr", None)
    if not candidate:
        quoted = re.findall(r"[\"'“”‘’]([^\"'“”‘’]+)[\"'“”‘’]", text)
        pools = quoted or re.findall(r"[\[\](){}][\[\](){}\w\s+\-*/^]*[\[\](){}]", text)
        candidate = max(pools, key=len) if pools else None
    if not candidate:
        raise ValueError("未识别到待检查的括号串，请用引号或直接给出 ( ) [ ] { } 序列")
    chars = [ch for ch in str(candidate) if ch in "()[]{}"]
    if not chars:
        raise ValueError("待检查串中没有括号字符 ()[]{}")
    model = {"engine": "ds_brackets_v1", "subject": "algorithm", "ds_kind": "brackets",
             "chars": chars, "expr": str(candidate), "defaults": {}, "params": [], "teaching": False}
    conditions = [_condition("expr", "待检查串", str(candidate), source=source, note="只检查 ()[]{}，其他字符忽略。")]
    formulas = [{"id": "bracket_rule", "tex": r"\text{左括号入栈；右括号须与栈顶配对}",
                 "plain": "括号匹配：左括号入栈，右括号与栈顶配对；结束时栈空才算匹配。", "role": "判定规则"}]
    return _built("brackets", model, conditions, formulas)


def eval_brackets(model: Mapping[str, Any]) -> dict[str, Any]:
    pairs = {")": "(", "]": "[", "}": "{"}
    stack: list[str] = []
    frames: list[dict[str, Any]] = []
    matched = True
    bad_index: int | None = None
    for index, ch in enumerate(model.get("chars") or [], 1):
        if ch in "([{":
            stack.append(ch)
            frames.append(_frame(len(frames) + 1, f"读入 {ch}", f"左括号 {ch} 入栈。",
                                 {"栈（底→顶）": _fmt_stack(stack), "读入位置": str(index)}, 1))
        else:
            if not stack or stack[-1] != pairs[ch]:
                matched = False
                bad_index = index
                frames.append(_frame(len(frames) + 1, f"读入 {ch}",
                                     f"栈顶 {'空' if not stack else stack[-1]} 与 {ch} 不配对，匹配失败。",
                                     {"栈（底→顶）": _fmt_stack(stack), "失败位置": str(index)}, 2))
                break
            stack.pop()
            frames.append(_frame(len(frames) + 1, f"读入 {ch}", f"{ch} 与栈顶 {pairs[ch]} 配对，弹栈。",
                                 {"栈（底→顶）": _fmt_stack(stack), "读入位置": str(index)}, 2))
    if matched and stack:
        matched = False
        bad_index = len(model.get("chars") or [])
        frames.append(_frame(len(frames) + 1, "扫描结束", f"仍有 {len(stack)} 个左括号未配对。",
                             {"栈（底→顶）": _fmt_stack(stack), "未配对": _fmt(stack)}, 4))
    verdict = "括号完全匹配" if matched else f"在第 {bad_index} 个括号处不匹配"
    frames.append(_frame(len(frames) + 1, "结论", verdict, {"结论": verdict}, 4))
    checks = [
        _check("pairing", "配对规则", True, "每个右括号与最近未配对的左括号（栈顶）配对。"),
        _check("balance", "最终栈空", matched, "匹配成功的充要条件：中途不失败且结束时栈空。"),
    ]
    notes = ["忽略非括号字符；()、[]、{} 各自配对，不交叉匹配。"]
    return _ok_result("brackets", verdict, verdict, _truncate(frames, notes), PSEUDOCODES["brackets"],
                      checks, notes, answer_order=["匹配"] if matched else ["不匹配"])


# ---------------------------------------------------------------------------
# 5) 表达式转换与求值
# ---------------------------------------------------------------------------

_PREC = {"+": 1, "-": 1, "*": 2, "/": 2, "^": 3}


def _tokenize_expr(expr: str) -> list[str]:
    normalized = (expr.replace("（", "(").replace("）", ")").replace("×", "*")
                  .replace("÷", "/").replace("＋", "+").replace("－", "-"))
    tokens: list[str] = []
    index = 0
    while index < len(normalized):
        ch = normalized[index]
        if ch.isspace():
            index += 1
            continue
        match = re.match(r"\d+(?:\.\d+)?", normalized[index:])
        if match:
            tokens.append(match.group(0))
            index += len(match.group(0))
            continue
        match = re.match(r"[A-Za-z]+", normalized[index:])
        if match:
            tokens.append(match.group(0))
            index += len(match.group(0))
            continue
        if ch in "+-*/^()":
            tokens.append(ch)
            index += 1
            continue
        raise ValueError(f"表达式含无法识别的字符“{ch}”")
    return tokens


def _infix_to_postfix(tokens: list[str]) -> tuple[str, list[dict[str, Any]]]:
    out: list[str] = []
    ops: list[str] = []
    frames: list[dict[str, Any]] = []
    for index, tok in enumerate(tokens, 1):
        if re.fullmatch(r"\d+(?:\.\d+)?|[A-Za-z]+", tok):
            out.append(tok)
            detail, line = f"操作数 {tok} 直接进入输出", 2
        elif tok == "(":
            ops.append(tok)
            detail, line = "'(' 入运算符栈", 3
        elif tok == ")":
            while ops and ops[-1] != "(":
                out.append(ops.pop())
            if not ops:
                raise ValueError("括号不匹配")
            ops.pop()
            detail, line = "')' 弹出运算符直到 '('", 4
        else:
            while ops and ops[-1] != "(" and (
                _PREC[ops[-1]] > _PREC[tok] or (_PREC[ops[-1]] == _PREC[tok] and tok != "^")
            ):
                out.append(ops.pop())
            ops.append(tok)
            detail, line = f"{tok} 与栈顶比较优先级后入栈（^ 右结合）", 3
        frames.append(_frame(index, f"读入 {tok}", detail,
                             {"输出": " ".join(out) or "空", "运算符栈": _fmt(ops)}, line))
    while ops:
        if ops[-1] == "(":
            raise ValueError("括号不匹配")
        out.append(ops.pop())
    frames.append(_frame(len(frames) + 1, "结束", "弹出运算符栈中剩余运算符。",
                         {"输出": " ".join(out) or "空", "运算符栈": "空"}, 5))
    return " ".join(out), frames


def _eval_postfix(tokens: list[str]) -> tuple[float, list[dict[str, Any]]]:
    stack: list[float] = []
    frames: list[dict[str, Any]] = []
    for index, tok in enumerate(tokens, 1):
        if re.fullmatch(r"\d+(?:\.\d+)?", tok):
            stack.append(float(tok))
            frames.append(_frame(index, f"读入 {tok}", f"操作数 {tok} 入求值栈。", {"求值栈": _fmt(stack)}, 2))
            continue
        if len(stack) < 2:
            raise ValueError("后缀表达式不合法：运算符缺少操作数")
        right = stack.pop()
        left = stack.pop()
        if tok == "+":
            value = left + right
        elif tok == "-":
            value = left - right
        elif tok == "*":
            value = left * right
        elif tok == "/":
            if right == 0:
                raise ValueError("除数为 0")
            value = left / right
        else:
            value = left ** right
        stack.append(value)
        frames.append(_frame(index, f"读入 {tok}",
                             f"弹出 {left:g} 与 {right:g}，计算 {left:g} {tok} {right:g} = {value:g} 后入栈。",
                             {"求值栈": _fmt(stack)}, 2))
    if len(stack) != 1:
        raise ValueError("后缀表达式不合法：结束时栈中不是唯一结果")
    return stack[0], frames


def build_expression(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if not re.search(r"(?:中缀|后缀|前缀)表达式|表达式.{0,8}(?:转换|求值|计算)|求.{0,4}表达式的值", text):
        return None
    cv = overrides.get("condition_values") or {}
    expr = _clause_values(cv, "expr", None)
    if not expr:
        expr_class = r"0-9A-Za-z+\-*/^（）()."
        for pattern in (rf"(?:中缀表达式|后缀表达式|表达式)\s*(?:为|是)?\s*[:：]?\s*[\"'“”]?([{expr_class}][{expr_class}\s]*[{expr_class}]|[{expr_class}])",
                        rf"(?:求|计算)\s*([{expr_class}][{expr_class}\s]*[{expr_class}]|[{expr_class}])"):
            match = re.search(pattern, text)
            if match:
                expr = match.group(1).strip()
                break
    if not expr:
        raise ValueError("未识别到表达式，请用“表达式为 …”的写法给出")
    expr = " ".join(str(expr).split())
    mode = "postfix_eval" if (re.search(r"后缀", text) and re.search(r"求值|的值|结果", text)) else "convert"
    model = {"engine": "ds_expression_v1", "subject": "algorithm", "ds_kind": "expression",
             "expr": expr, "mode": mode, "defaults": {}, "params": [], "teaching": False}
    conditions = [_condition("expr", "表达式", expr, source=source, note="支持数字、字母、+ - * / ^ 与括号。")]
    formulas = [{"id": "postfix_rule", "tex": r"\text{操作数直出；运算符按优先级出入栈；^ 右结合}",
                 "plain": "中缀转后缀：操作数直接输出，运算符按优先级出入栈；后缀求值用操作数栈。", "role": "转换/求值规则"}]
    return _built("expression", model, conditions, formulas)


def eval_expression(model: Mapping[str, Any]) -> dict[str, Any]:
    notes: list[str] = []
    expr = str(model.get("expr") or "")
    tokens = _tokenize_expr(expr)
    if model.get("mode") == "postfix_eval":
        if any(ch.isalpha() for ch in expr):
            raise ValueError("含字母的后缀表达式无法求值，请改为数字或只做转换")
        value, frames = _eval_postfix(tokens)
        shown = int(value) if float(value).is_integer() else value
        headline = f"后缀表达式求值结果：{shown}"
        checks = [_check("stack", "求值栈", True, f"结束时栈中唯一元素即结果：{shown}")]
        return _ok_result("expression", headline, headline, _truncate(frames, notes), PSEUDOCODES["expression"],
                          checks, notes, answer_value=float(shown))
    postfix, frames = _infix_to_postfix(tokens)
    answer_value = None
    parts = postfix.split()
    if parts and all(re.fullmatch(r"\d+(?:\.\d+)?|[+\-*/^]", part) for part in parts):
        value, eval_frames = _eval_postfix(parts)
        shown = int(value) if float(value).is_integer() else value
        frames.extend(eval_frames)
        frames = [_frame(i + 1, f["label"], f["detail"], f["values"], f.get("pseudocodeLine"))
                  for i, f in enumerate(frames)]
        answer_value = float(shown)
        headline = f"后缀表达式：{postfix}；值 = {shown}"
        notes.append("操作数全为数字，转换后顺带求值。")
    else:
        headline = f"后缀表达式：{postfix}"
        notes.append("操作数为字母，只做转换，不代入数值。")
    checks = [
        _check("postfix", "后缀转换", True, f"输出：{postfix}"),
        _check("priority", "优先级处理", True, "*/ 高于 +-；同级从左到右；^ 右结合。"),
    ]
    return _ok_result("expression", headline, headline, _truncate(frames, notes), PSEUDOCODES["expression"],
                      checks, notes, answer_value=answer_value)


# ---------------------------------------------------------------------------
# 6) 递归调用过程
# ---------------------------------------------------------------------------

def build_recursion(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if re.search(r"复杂度", text):
        return None
    func = None
    n = None
    match = re.search(r"(?<![A-Za-z])(fact|factorial|fib|fibonacci)\s*\(\s*(\d{1,3})\s*\)", text, re.I)
    if match:
        name = match.group(1).lower()
        func = "fib" if name.startswith("fib") else "fact"
        n = int(match.group(2))
    if func is None:
        if re.search(r"阶乘|fact", text, re.I):
            func = "fact"
        elif re.search(r"fib|斐波那契", text, re.I):
            func = "fib"
    if func is None:
        return None
    if n is None:
        for pattern in (r"第\s*(\d{1,3})\s*项", r"n\s*[=是为]\s*(\d{1,3})"):
            m = re.search(pattern, text)
            if m:
                n = int(m.group(1))
                break
    cv = overrides.get("condition_values") or {}
    n = int(_clause_values(cv, "n", n if n is not None else 4))
    if func == "fact" and n > 200:
        raise ValueError("阶乘递归演示取 n ≤ 200")
    if func == "fib" and n > 10:
        raise ValueError("fib 递归调用次数随 n 指数增长，演示取 n ≤ 10")
    model = {"engine": "ds_recursion_v1", "subject": "algorithm", "ds_kind": "recursion",
             "func": func, "n": n, "defaults": {"n": n}, "params": [], "teaching": False}
    conditions = [
        _condition("func", "递归函数", "阶乘 fact(n)" if func == "fact" else "斐波那契 fib(n)", source=source, editable=False),
        _condition("n", "n", n, kind="number", source=source, note="修改后重新求解可回放新的调用过程。"),
    ]
    formulas = [{"id": "rec_def", "tex": r"fact(n)=n\cdot fact(n-1),\ fact(1)=1;\quad fib(n)=fib(n-1)+fib(n-2)",
                 "plain": "fact(n)=n·fact(n-1)，fact(1)=1；fib(n)=fib(n-1)+fib(n-2)，fib(1)=fib(2)=1。", "role": "递归定义"}]
    return _built("recursion", model, conditions, formulas)


def eval_recursion(model: Mapping[str, Any]) -> dict[str, Any]:
    func = str(model.get("func") or "fact")
    n = int(model.get("n") or 0)
    notes: list[str] = []
    frames: list[dict[str, Any]] = []
    call_stack: list[str] = []
    calls = 0

    def record(label: str, detail: str, line: int, extra: dict[str, Any] | None = None) -> None:
        payload: dict[str, Any] = {"调用栈（底→顶）": " → ".join(call_stack) or "空", "已调用": str(calls)}
        if extra:
            payload.update(extra)
        frames.append(_frame(len(frames) + 1, label, detail, payload, line))

    if func == "fact":
        def fact(k: int) -> int:
            nonlocal calls
            calls += 1
            call_stack.append(f"fact({k})")
            record(f"调用 fact({k})", f"压入新栈帧（第 {calls} 次调用，栈深 {len(call_stack)}）。", 1, {"栈深": str(len(call_stack))})
            if k <= 1:
                call_stack.pop()
                record(f"fact({k}) 基例返回 1", "到达基例，返回 1 并弹出栈帧。", 2, {"返回值": "1"})
                return 1
            value = k * fact(k - 1)
            call_stack.pop()
            record(f"fact({k}) 返回 {value}", f"{k} × fact({k - 1}) = {value}，弹出栈帧。", 3, {"返回值": str(value)})
            return value
        result = fact(n)
        depth = n
        headline = f"fact({n}) = {result}；共调用 {calls} 次，最大栈深 {depth}"
    else:
        distinct = {"count": 0}
        seen_fib: set[int] = set()

        def fib(k: int) -> int:
            nonlocal calls
            calls += 1
            call_stack.append(f"fib({k})")
            record(f"调用 fib({k})", f"压入新栈帧（第 {calls} 次调用，栈深 {len(call_stack)}）。", 1, {"栈深": str(len(call_stack))})
            if k <= 2:
                value = 1
            else:
                value = fib(k - 1) + fib(k - 2)
            if k not in seen_fib:
                seen_fib.add(k)
                distinct["count"] += 1
            call_stack.pop()
            record(f"fib({k}) 返回 {value}", f"计算完成，弹出栈帧（栈深回到 {len(call_stack)}）。", 3, {"返回值": str(value)})
            return value
        result = fib(n)
        depth = n
        notes.append(f"fib 递归存在大量重复子问题：{calls} 次调用只对应 {distinct['count']} 个不同的 fib(k)；迭代法为 O(n)。")
        headline = f"fib({n}) = {result}；共调用 {calls} 次"
    record("结束", f"结果 {result}；空间复杂度 O({depth})（递归栈深）。", 4, {"结果": str(result)})
    checks = [
        _check("calls", "调用计数", True, f"共 {calls} 次调用。"),
        _check("stack", "栈深口径", True, f"最大栈深 {depth}，对应空间复杂度 O({depth})。"),
    ]
    return _ok_result("recursion", headline, headline, _truncate(frames, notes), PSEUDOCODES["recursion"],
                      checks, notes, answer_value=float(calls))


# ---------------------------------------------------------------------------
# 7) 循环队列 / 顺序队列
# ---------------------------------------------------------------------------

def build_queue_ops(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if "双端队列" in text:
        return None
    ops = _parse_io_ops(text, "入队", "出队")
    capacity = None
    for pattern in (r"容量(?:为|是)?\s*(\d{1,3})", r"(\d{1,3})\s*个(?:存储单元|单元|元素空间|空间)",
                    r"队列长度(?:为|是)?\s*(\d{1,3})"):
        m = re.search(pattern, text)
        if m:
            capacity = int(m.group(1))
            break
    if not ops and capacity is None:
        return None
    cv = overrides.get("condition_values") or {}
    capacity = int(_clause_values(cv, "capacity", capacity if capacity is not None else 6))
    if capacity < 2 or capacity > 32:
        raise ValueError("队列容量须在 2–32 之间")
    circular = "循环" in text or "顺序队列" not in text
    use_tag = bool(re.search(r"tag|标志", text, re.I))
    model = {"engine": "ds_queue_v1", "subject": "algorithm", "ds_kind": "queue_ops",
             "circular": circular, "capacity": capacity, "tag": use_tag, "ops": ops,
             "defaults": {}, "params": [], "teaching": False}
    conditions = [
        _condition("capacity", "容量", capacity, kind="number", source=source,
                   note="循环队列牺牲一格区分队空/队满；使用 tag 标志时不牺牲。" if not use_tag
                   else "使用 tag 标志区分队空/队满，不牺牲存储单元。"),
        _condition("kind", "队列类型", "循环队列" if circular else "顺序队列（非循环）", source=source, editable=False),
    ]
    formulas = [{"id": "queue_len", "tex": r"\text{长度}=(rear-front+size)\bmod size",
                 "plain": "队空：front==rear；循环队列队满：(rear+1)%size==front（牺牲一格）或 tag 标志。", "role": "队列口径"}]
    return _built("queue_ops", model, conditions, formulas)


def eval_queue_ops(model: Mapping[str, Any]) -> dict[str, Any]:
    cap = int(model.get("capacity") or 6)
    circular = bool(model.get("circular", True))
    use_tag = bool(model.get("tag"))
    cells: list[Any] = [None] * cap
    front = rear = 0
    tag = 0
    notes: list[str] = []
    frames: list[dict[str, Any]] = []
    outputs: list[int] = []
    events: list[str] = []

    def is_full() -> bool:
        if not circular:
            return rear == cap
        if use_tag:
            return front == rear and tag == 1
        return (rear + 1) % cap == front

    def is_empty() -> bool:
        if use_tag and circular:
            return front == rear and tag == 0
        return front == rear

    def queue_length() -> int:
        if not circular:
            return max(rear - front, 0)
        if front == rear:
            # tag=1 表示队满（长度为容量）；无 tag 口径下 front==rear 只能是队空。
            return cap if (use_tag and tag == 1) else 0
        return (rear - front + cap) % cap

    def snapshot() -> dict[str, Any]:
        return {"存储单元": _fmt([v if v is not None else "·" for v in cells]),
                "front": str(front), "rear": str(rear), "长度": str(queue_length())}

    def record(label: str, detail: str, line: int, extra: dict[str, Any] | None = None) -> None:
        payload = snapshot()
        if extra:
            payload.update(extra)
        frames.append(_frame(len(frames) + 1, label, detail, payload, line))

    record("初始化", f"{'循环队列' if circular else '顺序队列'}：容量 {cap}，front=rear=0，"
                     + ("用 tag 标志区分队空/队满。" if use_tag else "牺牲一格区分队空/队满。"), 1)
    for op in model.get("ops") or []:
        if op.get("op") == "push":
            value = op.get("value")
            if is_full():
                events.append(f"入队 {value} 时队满，被拒绝")
                record(f"入队 {value} 失败", "队满判定成立，元素被拒绝（上溢）。", 2, {"判定": "队满"})
                continue
            cells[rear] = value
            written = rear
            rear = (rear + 1) % cap if circular else rear + 1
            tag = 1
            record(f"入队 {value}", f"写入 Q[{written}]，rear 后移到 {rear}。", 2)
        else:
            if is_empty():
                events.append("出队时队空，被拒绝")
                record("出队失败", "队空判定成立，出队非法（下溢）。", 3, {"判定": "队空"})
                continue
            value = cells[front]
            cells[front] = None
            taken = front
            front = (front + 1) % cap if circular else front + 1
            tag = 0
            outputs.append(value)
            record(f"出队 {value}", f"取出 Q[{taken}] = {value}，front 后移到 {front}。", 3)
    length = queue_length()
    if not circular and front > 0 and rear == cap:
        notes.append("顺序队列出现“假溢出”：rear 已到末尾但前部仍有空位，这正是引入循环队列的原因。")
    if use_tag:
        notes.append(f"tag 口径：不牺牲存储单元；front==rear 时 tag=1 为队满（长度为 {cap}）、tag=0 为队空；"
                     f"其余长度 = (rear-front+{cap}) mod {cap}。")
    else:
        notes.append(f"牺牲一格口径：队空 front==rear；队满 (rear+1) mod {cap} == front；长度 = (rear-front+{cap}) mod {cap}。")
    headline = f"最终 front={front}，rear={rear}，队列长度 {length}" + (f"；出队序列 {_fmt(outputs)}" if outputs else "")
    answer = headline + ("".join("；" + e for e in events))
    checks = [
        _check("bounds", "判空判满", True, "每次操作前都做了队空/队满判定，越界操作被拒绝。"),
        _check("length", "长度公式", True, f"当前长度 {length}。"),
    ]
    return _ok_result("queue_ops", headline, answer, _truncate(frames, notes), PSEUDOCODES["queue_ops"],
                      checks, notes, answer_order=[str(v) for v in outputs])


# ---------------------------------------------------------------------------
# 8) 双端队列
# ---------------------------------------------------------------------------

def build_deque(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if "双端队列" not in text:
        return None
    push = None
    for match in re.finditer(r"[1-9][0-9]{0,2}(?:\s*[,，、]\s*[1-9][0-9]{0,2})+", text):
        candidate_seq = _seq(match.group(0))
        if len(candidate_seq) >= 3:
            push = candidate_seq
            break
    if not push:
        raise ValueError("未识别到输入序列，请用“依次输入 1,2,3,4”一类的写法")
    if len(push) > 6:
        raise ValueError("双端队列演示最多支持 6 个输入元素")
    input_restricted = "输入受限" in text
    candidate = None
    m = re.search(r"(?:输出序列|得到|取出)[^0-9]{0,6}([1-9][0-9]{0,2}(?:\s*[,，、]\s*[1-9][0-9]{0,2})+)", text)
    if m:
        candidate = _seq(m.group(1))
        if candidate and sorted(candidate) != sorted(push):
            raise ValueError("候选输出序列与输入序列的元素不一致，请核对")
    model = {"engine": "ds_deque_v1", "subject": "algorithm", "ds_kind": "deque",
             "push": push, "candidate": candidate or [], "input_restricted": input_restricted,
             "defaults": {}, "params": [], "teaching": False}
    conditions = [
        _condition("restriction", "限制", "输入受限（只能一端输入，两端输出）" if input_restricted
                   else "输出受限（两端输入，只能一端输出）", source=source, editable=False),
        _condition("push", "输入序列", _fmt(push), source=source, editable=False),
    ]
    if candidate:
        conditions.append(_condition("candidate", "候选输出序列", _fmt(candidate), source=source, editable=False))
    formulas = [{"id": "deque_rule", "tex": r"\text{在限制允许的端点上选择输入/输出}",
                 "plain": "输入受限：只能一端输入、两端可输出；输出受限：两端可输入、只能一端输出。", "role": "双端队列口径"}]
    return _built("deque", model, conditions, formulas)


def eval_deque(model: Mapping[str, Any]) -> dict[str, Any]:
    push = list(model.get("push") or [])
    candidate = list(model.get("candidate") or [])
    input_restricted = bool(model.get("input_restricted"))
    notes: list[str] = []
    frames: list[dict[str, Any]] = []

    def record(label: str, detail: str, extra: dict[str, Any]) -> None:
        frames.append(_frame(len(frames) + 1, label, detail, extra, 2))

    if candidate:
        seen: set[tuple[int, tuple[int, ...]]] = set()

        def dfs(idx: int, dq: tuple[int, ...], acc: tuple[int, ...],
                steps: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
            if len(acc) == len(candidate):
                return list(steps) if list(acc) == list(candidate) else None
            key = (idx, dq)
            if key in seen:
                return None
            seen.add(key)
            if idx < len(push):
                choices = ([(f"右端输入 {push[idx]}", dq + (push[idx],), acc)] if input_restricted
                           else [(f"左端输入 {push[idx]}", (push[idx],) + dq, acc),
                                 (f"右端输入 {push[idx]}", dq + (push[idx],), acc)])
                for desc, nxt, nacc in choices:
                    steps.append({"desc": desc, "dq": nxt, "acc": nacc})
                    result = dfs(idx + 1, nxt, nacc, steps)
                    if result is not None:
                        return result
                    steps.pop()
            if dq:
                needed = candidate[len(acc)]
                if input_restricted:
                    outs = []
                    if dq[0] == needed:
                        outs.append((f"左端输出 {dq[0]}", dq[1:], acc + (dq[0],)))
                    if dq[-1] == needed:
                        outs.append((f"右端输出 {dq[-1]}", dq[:-1], acc + (dq[-1],)))
                else:
                    outs = [(f"右端输出 {dq[-1]}", dq[:-1], acc + (dq[-1],))] if dq[-1] == needed else []
                for desc, ndq, nacc in outs:
                    steps.append({"desc": desc, "dq": ndq, "acc": nacc})
                    result = dfs(idx, ndq, nacc, steps)
                    if result is not None:
                        return result
                    steps.pop()
            return None

        plan = dfs(0, (), (), [])
        legal = plan is not None
        if legal:
            for step in plan:
                record(step["desc"], f"执行：{step['desc']}。",
                       {"队列（左→右）": _fmt(list(step["dq"])), "已输出": _fmt(list(step["acc"]))})
            headline = f"输出序列 {' → '.join(str(v) for v in candidate)} 可以得到（合法）"
        else:
            headline = f"输出序列 {' → '.join(str(v) for v in candidate)} 无法得到（不合法）"
        answer = headline
        checks = [_check("search", "可行性搜索", True, "对限制允许的全部输入/输出组合做了带状态去重的穷举搜索。")]
        return _ok_result("deque", headline, answer, _truncate(frames, notes), PSEUDOCODES["deque"],
                          checks, notes, answer_order=[str(v) for v in candidate] if legal else [])

    outputs: set[tuple[int, ...]] = set()
    seen_enum: set[tuple[int, tuple[int, ...], tuple[int, ...]]] = set()

    def enumerate_all(idx: int, dq: tuple[int, ...], acc: tuple[int, ...]) -> None:
        if idx == len(push) and not dq:
            outputs.add(acc)
            return
        key = (idx, dq, acc)
        if key in seen_enum:
            return
        seen_enum.add(key)
        if idx < len(push):
            if input_restricted:
                enumerate_all(idx + 1, dq + (push[idx],), acc)
            else:
                enumerate_all(idx + 1, (push[idx],) + dq, acc)
                enumerate_all(idx + 1, dq + (push[idx],), acc)
        if dq:
            enumerate_all(idx, dq[1:], acc + (dq[0],))
            enumerate_all(idx, dq[:-1], acc + (dq[-1],))

    enumerate_all(0, (), ())
    count = len(outputs)
    examples = sorted(outputs)[:3]
    record("穷举完成", f"在给定限制下，输入 {_fmt(push)} 共可得到 {count} 个不同的输出序列。",
           {"可达序列数": str(count),
            "示例": "；".join(" → ".join(str(v) for v in item) for item in examples) or "—"})
    headline = f"共 {count} 个不同的可达输出序列"
    answer = headline + "；例如：" + "；".join(" → ".join(str(v) for v in item) for item in examples)
    checks = [_check("enumerate", "穷举计数", True, f"输入长度 {len(push)}，限制：{'输入受限' if input_restricted else '输出受限'}。")]
    return _ok_result("deque", headline, answer, _truncate(frames, notes), PSEUDOCODES["deque"],
                      checks, notes, answer_value=float(count))


# ---------------------------------------------------------------------------
# 9) 栈与队列互模拟
# ---------------------------------------------------------------------------

def build_stack_queue_sim(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if re.search(r"两个栈.{0,6}队列|用两个栈", text):
        mode = "two_stacks_queue"
    elif re.search(r"两个队列.{0,6}栈|用两个队列", text):
        mode = "two_queues_stack"
    else:
        return None
    push_word, pop_word = ("入队", "出队") if mode == "two_stacks_queue" else ("入栈", "出栈")
    ops = _parse_io_ops(text, push_word, pop_word)
    if not ops:
        raise ValueError("未从题面解析出操作序列，请用“入队1，入队2，出队”一类的写法")
    model = {"engine": "ds_sqsim_v1", "subject": "algorithm", "ds_kind": "stack_queue_sim",
             "mode": mode, "ops": ops, "defaults": {}, "params": [], "teaching": False}
    conditions = [
        _condition("mode", "模拟方式", "两个栈模拟队列" if mode == "two_stacks_queue" else "两个队列模拟栈",
                   source=source, editable=False),
        _condition("ops", "操作序列", "；".join(op["op"] + (f" {op['value']}" if op.get("value") is not None else "")
                                            for op in ops), source=source, editable=False),
    ]
    formulas = [{"id": "amortized", "tex": r"\text{每个元素最多被搬运一次}",
                 "plain": "两个栈模拟队列：出队仅在 S2 空时整体倒入 S1 的内容，均摊 O(1)；两个队列模拟栈：出栈需搬运 n-1 个。",
                 "role": "均摊口径"}]
    return _built("stack_queue_sim", model, conditions, formulas)


def eval_stack_queue_sim(model: Mapping[str, Any]) -> dict[str, Any]:
    mode = str(model.get("mode") or "two_stacks_queue")
    notes: list[str] = []
    frames: list[dict[str, Any]] = []
    outputs: list[int] = []
    if mode == "two_stacks_queue":
        s1: list[int] = []
        s2: list[int] = []

        def record(label: str, detail: str, line: int, extra: dict[str, Any] | None = None) -> None:
            payload: dict[str, Any] = {"S1（底→顶）": _fmt(s1), "S2（底→顶）": _fmt(s2), "已出队": _fmt(outputs)}
            if extra:
                payload.update(extra)
            frames.append(_frame(len(frames) + 1, label, detail, payload, line))

        record("初始化", "S1 负责入队，S2 负责出队。", 1)
        for op in model.get("ops") or []:
            if op.get("op") == "push":
                s1.append(op.get("value"))
                record(f"入队 {op.get('value')}", f"{op.get('value')} 压入 S1。", 2)
            else:
                if not s2:
                    if not s1:
                        record("出队失败", "S1、S2 均空，队列空，出队非法。", 3, {"结论": "失败"})
                        continue
                    moved = list(reversed(s1))
                    s2.extend(moved)
                    record("倒入 S2", f"S2 为空：把 S1 的 {len(moved)} 个元素依次弹出并压入 S2。", 3)
                    s1.clear()
                value = s2.pop()
                outputs.append(value)
                record(f"出队 {value}", f"弹出 S2 栈顶 {value}（即最早入队的元素）。", 4)
        headline = f"出队序列 {_fmt(outputs)}" + (f"；S1 剩余 {_fmt(s1)}，S2 剩余 {_fmt(s2)}" if (s1 or s2) else "")
        notes.append("均摊分析：每个元素最多从 S1 搬到 S2 一次，出队均摊 O(1)。")
    else:
        active: list[int] = []
        spare: list[int] = []

        def record(label: str, detail: str, line: int, extra: dict[str, Any] | None = None) -> None:
            payload: dict[str, Any] = {"活动队列（队头→队尾）": _fmt(active), "备用队列": _fmt(spare), "已出栈": _fmt(outputs)}
            if extra:
                payload.update(extra)
            frames.append(_frame(len(frames) + 1, label, detail, payload, line))

        record("初始化", "活动队列负责入栈与出栈。", 1)
        for op in model.get("ops") or []:
            if op.get("op") == "push":
                active.append(op.get("value"))
                record(f"入栈 {op.get('value')}", f"{op.get('value')} 加入活动队列队尾。", 3)
            else:
                if not active:
                    record("出栈失败", "两个队列均空，出栈非法。", 4, {"结论": "失败"})
                    continue
                while len(active) > 1:
                    spare.append(active.pop(0))
                value = active.pop(0)
                outputs.append(value)
                record(f"出栈 {value}", f"把前 {len(spare)} 个元素转移到备用队列后，取出最后一个元素 {value}；两队列角色互换。", 4)
                active, spare = spare, active
        headline = f"出栈序列 {_fmt(outputs)}" + (f"；剩余 {_fmt(active)}" if active else "")
        notes.append("两个队列模拟栈：入栈 O(1)，出栈需搬运 n-1 个元素后再交换角色。")
    checks = [_check("sim", "模拟规则", True, "严格按两个栈/两个队列的能力执行，未使用被禁用的操作。")]
    return _ok_result("stack_queue_sim", headline, headline, _truncate(frames, notes), PSEUDOCODES["stack_queue_sim"],
                      checks, notes, answer_order=[str(v) for v in outputs])


# ---------------------------------------------------------------------------
# 10) 多维数组地址计算
# ---------------------------------------------------------------------------

def build_array_address(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if not re.search(r"地址|LOC", text):
        return None
    dims = re.search(r"([A-Za-z])\s*\[\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\]\s*\[\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\]", text)
    target = re.search(r"(?:求|计算)\s*([A-Za-z])\s*\[\s*(\d{1,3})\s*\]\s*\[\s*(\d{1,3})\s*\]", text)
    if dims is None:
        simple = re.search(r"([A-Za-z])\s*\[\s*(\d{1,3})\s*\]\s*\[\s*(\d{1,3})\s*\]", text)
        if simple is None:
            return None
        name, d1, d2 = simple.group(1), int(simple.group(2)), int(simple.group(3))
        bounds = (1, d1, 1, d2)
        note = f"题面给的是规模 A[{d1}][{d2}]，按 1..{d1} × 1..{d2} 的下标范围处理。"
    else:
        name = dims.group(1)
        bounds = (int(dims.group(2)), int(dims.group(3)), int(dims.group(4)), int(dims.group(5)))
        note = None
    if target is None:
        raise ValueError("未识别到求解目标，请用“求 A[i][j] 的地址”的写法")
    i, j = int(target.group(2)), int(target.group(3))
    cv = overrides.get("condition_values") or {}
    base = None
    for pattern in (r"(?:首地址|起始地址|存放首地址)\s*[A-Za-z]?\s*[=是为]?\s*(\d{1,7})",
                    r"LOC\s*[=是为]?\s*(\d{1,7})"):
        m = re.search(pattern, text)
        if m:
            base = int(m.group(1))
            break
    size = None
    m = re.search(r"每个元素(?:占用|占)?\s*(\d{1,3})\s*个?字节", text)
    if m:
        size = int(m.group(1))
    base = _clause_values(cv, "base", base)
    size = _clause_values(cv, "size", size)
    if base is None:
        raise ValueError("未识别到数组首地址，请用“首地址为 …”的写法给出")
    if size is None:
        raise ValueError("未识别到每元素字节数，请用“每个元素占 … 字节”的写法给出")
    base = int(base)
    size = int(size)
    col_major = "列优先" in text
    l1, h1, l2, h2 = bounds
    if not (l1 <= i <= h1 and l2 <= j <= h2):
        raise ValueError(f"A[{i}][{j}] 超出数组范围 [{l1}..{h1}][{l2}..{h2}]")
    rows, cols = h1 - l1 + 1, h2 - l2 + 1
    offset = ((j - l2) * rows + (i - l1)) if col_major else ((i - l1) * cols + (j - l2))
    addr = base + offset * size
    major = "列优先" if col_major else "行优先"
    model = {"engine": "ds_address_v1", "subject": "algorithm", "ds_kind": "array_address",
             "bounds": list(bounds), "target": [i, j], "base": base, "size": size,
             "col_major": col_major, "defaults": {}, "params": [], "teaching": False}
    conditions = [
        _condition("dims", "数组范围", f"{name}[{l1}..{h1}][{l2}..{h2}]（{rows}×{cols}）", source=source, editable=False),
        _condition("major", "存储方式", major, source=source, editable=False,
                   note="题面未指明时按行优先处理。" if not col_major else None),
        _condition("base", "首地址", base, kind="number", source=source),
        _condition("size", "每元素字节", size, kind="number", source=source),
        _condition("target", "求解元素", f"{name}[{i}][{j}]", source=source, editable=False),
    ]
    formulas = [{"id": "addr", "tex": r"LOC(i,j)=LOC_0+((i-l_1)\cdot n_2+(j-l_2))\cdot s",
                 "plain": "行优先：前面的元素个数 = (i-l1)×每行列数 + (j-l2)；地址 = 首地址 + 个数 × 元素字节数。", "role": "地址公式"}]
    return _built("array_address", model, conditions, formulas)


def eval_array_address(model: Mapping[str, Any]) -> dict[str, Any]:
    l1, h1, l2, h2 = (int(v) for v in model.get("bounds") or [0, 0, 0, 0])
    i, j = (int(v) for v in model.get("target") or [0, 0])
    base = int(model.get("base") or 0)
    size = int(model.get("size") or 1)
    col_major = bool(model.get("col_major"))
    rows, cols = h1 - l1 + 1, h2 - l2 + 1
    offset = ((j - l2) * rows + (i - l1)) if col_major else ((i - l1) * cols + (j - l2))
    addr = base + offset * size
    notes: list[str] = []
    frames = [
        _frame(1, "确定范围", f"数组范围 [{l1}..{h1}][{l2}..{h2}]，每行 {cols} 个、共 {rows} 行。",
               {"每行列数": str(cols), "行数": str(rows)}, 1),
        _frame(2, "累计偏移", ("列优先" if col_major else "行优先") +
               f"：A[{i}][{j}] 前共有 {offset} 个元素。",
               {"偏移元素个数": str(offset)}, 2),
        _frame(3, "计算地址", f"地址 = {base} + {offset} × {size} = {addr}。",
               {"地址": str(addr)}, 4),
    ]
    headline = f"A[{i}][{j}] 的存储地址为 {addr}"
    checks = [
        _check("bounds", "下标范围", True, f"目标下标在 [{l1}..{h1}][{l2}..{h2}] 内。"),
        _check("offset", "偏移计算", offset >= 0, f"偏移 {offset} 个元素 × {size} 字节。"),
    ]
    notes.append("题面若给 A[n][m] 规模写法，按 1..n × 1..m 处理；未指明存储方式时按行优先。")
    return _ok_result("array_address", headline, headline, frames, PSEUDOCODES["array_address"],
                      checks, notes, answer_value=float(addr))


# ---------------------------------------------------------------------------
# 11) 对称 / 三角 / 三对角矩阵压缩存储
# ---------------------------------------------------------------------------

def build_matrix_storage(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if not re.search(r"压缩存储|对称矩阵|三角矩阵|三对角", text):
        return None
    kind = ("tridiag" if "三对角" in text else "symmetric" if "对称" in text
            else "lower" if re.search(r"下三角", text) else "upper" if re.search(r"上三角", text) else None)
    if kind is None:
        return None
    m = re.search(r"n\s*[=是为]\s*(\d{1,2})|([1-9]\d?)\s*阶|([一二三四五六七八九十]{1,3})\s*阶", text)
    if m is None:
        raise ValueError("未识别到矩阵阶数 n，请用 n=5、5 阶或五阶矩阵的写法")
    n = int(m.group(1) or m.group(2) or _cn_number(m.group(3)) or 0)
    if not (2 <= n <= 30):
        raise ValueError("矩阵阶数须在 2–30 之间")
    one_based = not re.search(r"从\s*0\s*开始|下标从0", text)
    column_major = bool(re.search(r"列优先|按列(优先|序|顺序)?存储|按列存储", text))
    query = re.search(r"[aA]\s*\[\s*(\d{1,2})\s*\]\s*\[\s*(\d{1,2})\s*\]", text)
    reverse = re.search(r"下标(?:为|是)?\s*(\d{1,4})\s*的元素|k\s*[=是为]\s*(\d{1,4})", text)
    model = {"engine": "ds_matrix_v1", "subject": "algorithm", "ds_kind": "matrix_storage",
             "kind": kind, "n": n, "one_based": one_based, "column_major": column_major,
             "query": [int(query.group(1)), int(query.group(2))] if query else [],
             "reverse_k": int(reverse.group(1) or reverse.group(2)) if reverse else None,
             "defaults": {}, "params": [], "teaching": False}
    kind_label = {"tridiag": "三对角矩阵", "symmetric": "对称矩阵", "lower": "下三角矩阵", "upper": "上三角矩阵"}[kind]
    conditions = [
        _condition("kind", "矩阵类型", kind_label, source=source, editable=False),
        _condition("n", "阶数 n", n, kind="number", source=source),
        _condition("base", "下标起点", "从 1 开始" if one_based else "从 0 开始", source=source, editable=False),
        _condition("storage_order", "存储顺序", "列优先" if column_major else "行优先", source=source, editable=False),
    ]
    if query:
        conditions.append(_condition("query", "求解元素", f"a[{query.group(1)}][{query.group(2)}]", source=source, editable=False))
    if reverse:
        conditions.append(_condition("reverse", "反查下标", f"k={reverse.group(1) or reverse.group(2)}", source=source, editable=False))
    formulas = [{"id": "matrix_k", "tex": r"k=\dfrac{i(i-1)}{2}+j\ (\text{下三角行优先，1 起});\quad k=2i+j-2\ (\text{三对角，1 起})",
                 "plain": "对称/下三角（行优先，1 起）：k=i(i-1)/2+j；上三角按行：k=(i-1)(2n-i+2)/2+(j-i+1)；三对角：k=2i+j-2；列优先时按列累计（以存储序列核对）。", "role": "压缩存储公式"}]
    return _built("matrix_storage", model, conditions, formulas)


def _tri_storage_sequence(kind: str, n: int, column_major: bool) -> list[tuple[int, int]]:
    """1 起的存储序列：按给定顺序枚举被存储的 (行, 列)。"""
    if kind == "tridiag":
        if column_major:
            return [(i, j) for j in range(1, n + 1) for i in (j - 1, j, j + 1) if 1 <= i <= n]
        return [(i, j) for i in range(1, n + 1) for j in (i - 1, i, i + 1) if 1 <= j <= n]
    if kind == "upper":
        if column_major:
            return [(i, j) for j in range(1, n + 1) for i in range(1, j + 1)]
        return [(i, j) for i in range(1, n + 1) for j in range(i, n + 1)]
    # 对称 / 下三角：存 i >= j
    if column_major:
        return [(i, j) for j in range(1, n + 1) for i in range(j, n + 1)]
    return [(i, j) for i in range(1, n + 1) for j in range(1, i + 1)]


def eval_matrix_storage(model: Mapping[str, Any]) -> dict[str, Any]:
    kind = str(model.get("kind") or "symmetric")
    n = int(model.get("n") or 0)
    one_based = bool(model.get("one_based", True))
    column_major = bool(model.get("column_major"))
    order_label = "列优先" if column_major else "行优先"
    seq = _tri_storage_sequence(kind, n, column_major)
    total = len(seq)
    lookup = {pair: pos + 1 for pos, pair in enumerate(seq)}
    notes: list[str] = []
    frames: list[dict[str, Any]] = []

    def lookup_pair(i: int, j: int) -> int | None:
        if (i, j) in lookup:
            return lookup[(i, j)]
        if kind == "symmetric":
            return lookup.get((max(i, j), min(i, j)))
        return None

    answer_bits: list[str] = []
    answer_value: float | None = None
    query = list(model.get("query") or [])
    if query:
        i_raw, j_raw = int(query[0]), int(query[1])
        i, j = (i_raw + 1, j_raw + 1) if not one_based else (i_raw, j_raw)
        if not (1 <= i <= n and 1 <= j <= n):
            raise ValueError(f"a[{i_raw}][{j_raw}] 超出 {n} 阶矩阵范围")
        k = lookup_pair(i, j)
        if k is None:
            note = "该元素不在存储带内（压缩存储不保存，按 0 处理）。"
            answer_bits.append(f"a[{i_raw}][{j_raw}] 未存储于压缩数组（对应 0）")
            k_show = "未存储"
        else:
            k_out = k if one_based else k - 1
            note = (f"{order_label}存储下，前面共有 {k - 1} 个元素，存入一维数组的下标为 {k_out}"
                    f"（数组下标同样{'从 1' if one_based else '从 0'}起）。")
            answer_bits.append(f"a[{i_raw}][{j_raw}] 存入下标 k = {k_out}")
            k_show = str(k_out)
            answer_value = float(k_out)
        frames.append(_frame(1, f"计算 a[{i_raw}][{j_raw}]", note,
                             {"矩阵元素": f"a[{i_raw}][{j_raw}]", "下标 k": k_show,
                              "存储顺序": order_label}, 2))
    reverse_k = model.get("reverse_k")
    if reverse_k is not None:
        k_pos = int(reverse_k) if one_based else int(reverse_k) + 1
        if not (1 <= k_pos <= total):
            raise ValueError(f"下标 k={reverse_k} 超出压缩数组的存储范围（共 {total} 个单元）")
        pair = seq[k_pos - 1]
        i_raw = pair[0] if one_based else pair[0] - 1
        j_raw = pair[1] if one_based else pair[1] - 1
        answer_bits.append(f"k = {reverse_k} 对应元素 a[{i_raw}][{j_raw}]")
        frames.append(_frame(len(frames) + 1, f"反查 k={reverse_k}",
                             f"{order_label}存储序列的第 {k_pos} 个元素是第 {pair[0]} 行第 {pair[1]} 列，即 a[{i_raw}][{j_raw}]。",
                             {"下标 k": str(reverse_k), "元素": f"a[{i_raw}][{j_raw}]"}, 3))
    if not frames:
        frames.append(_frame(1, "压缩存储序列", f"按{order_label}顺序枚举被存储的元素，共 {total} 个。",
                             {"数组长度": str(total)}, 2))
    answer_bits.append(f"压缩数组共 {total} 个元素")
    headline = "；".join(answer_bits)
    checks = [
        _check("formula", "公式口径", True, ("矩阵下标从 1 开始" if one_based else "矩阵下标从 0 开始")
               + "；" + f"{order_label}存储（按存储序列核对）。"),
        _check("total", "数组长度", True, f"共 {total} 个存储单元。"),
    ]
    if column_major:
        notes.append("列优先按下标累计容易与行优先公式混淆，这里以存储序列逐项核对。")
    return _ok_result("matrix_storage", headline, headline, frames, PSEUDOCODES["matrix_storage"],
                      checks, notes, answer_value=answer_value)


# ---------------------------------------------------------------------------
# 12) 稀疏矩阵三元组
# ---------------------------------------------------------------------------

def build_sparse(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if not re.search(r"三元组|稀疏矩阵", text):
        return None
    rows: list[list[int]] = []
    for group in re.findall(r"[（(]([0-9\s,，、\-]+)[)）]", text):
        values = [int(v) for v in re.findall(r"-?\d+", group)]
        if values:
            rows.append(values)
    if len(rows) < 1:
        raise ValueError("未识别到矩阵数据，请用 ((0,5,0),(0,0,2)) 一类的写法给出各行")
    width = len(rows[0])
    if any(len(row) != width for row in rows) or width < 1 or len(rows) > 12 or width > 12:
        raise ValueError("矩阵各行长度必须一致，且规模不超过 12×12")
    transpose = "转置" in text
    model = {"engine": "ds_sparse_v1", "subject": "algorithm", "ds_kind": "sparse",
             "rows": rows, "transpose": transpose, "defaults": {}, "params": [], "teaching": False}
    conditions = [
        _condition("matrix", "矩阵", "；".join("(" + ",".join(str(v) for v in row) + ")" for row in rows),
                   source=source, editable=False),
        _condition("transpose", "是否转置", "是" if transpose else "否", source=source, editable=False),
    ]
    formulas = [{"id": "triple", "tex": r"(i,\ j,\ v)\ \text{按行优先排列}",
                 "plain": "三元组表按行优先记录每个非零元的 (行,列,值)，表头附行数、列数与非零元个数。", "role": "三元组口径"}]
    return _built("sparse", model, conditions, formulas)


def eval_sparse(model: Mapping[str, Any]) -> dict[str, Any]:
    rows = [list(row) for row in model.get("rows") or []]
    transpose = bool(model.get("transpose"))
    notes: list[str] = []
    frames: list[dict[str, Any]] = []
    triples = [[i + 1, j + 1, rows[i][j]] for i in range(len(rows)) for j in range(len(rows[i])) if rows[i][j] != 0]
    header = f"({len(rows)}, {len(rows[0])}, {len(triples)})"
    frames.append(_frame(1, "生成三元组表", f"按行优先扫描，非零元 {len(triples)} 个；表头 {header}（行数, 列数, 非零元个数）。",
                         {"表头": header, "三元组": _fmt([tuple(t) for t in triples]) or "空"}, 1))
    answer_bits = [f"表头 {header}", f"三元组（行,列,值）：{_fmt([tuple(t) for t in triples]) or '空'}"]
    if transpose:
        cols = len(rows[0])
        transposed: list[list[int]] = []
        for col in range(1, cols + 1):
            moved = [t for t in triples if t[1] == col]
            for t in moved:
                transposed.append([t[1], t[0], t[2]])
            frames.append(_frame(len(frames) + 1, f"扫描第 {col} 列", f"取出列号为 {col} 的 {len(moved)} 个三元组，交换行列后写入。",
                                 {"本列取出": _fmt([tuple(t) for t in moved]) or "无", "已写入": _fmt([tuple(t) for t in transposed])}, 3))
        answer_bits.append(f"转置后三元组：{_fmt([tuple(t) for t in transposed]) or '空'}")
        notes.append("按列扫描转置（经典算法）：对每个列号依次收集三元组；也可用快速转置按 pos 数组一次定位。")
    headline = "；".join(answer_bits)
    checks = [
        _check("nnz", "非零元计数", True, f"共 {len(triples)} 个非零元。"),
        _check("order", "排列顺序", True, "三元组按行优先（先按行号、再按列号）排列。"),
    ]
    return _ok_result("sparse", headline, headline, _truncate(frames, notes), PSEUDOCODES["sparse"],
                      checks, notes, answer_order=[str(t) for t in triples[0]] if triples else [])


# ---------------------------------------------------------------------------
# 13) 串与模式匹配（朴素 / KMP）
# ---------------------------------------------------------------------------

def _kmp_tables(t: str) -> tuple[list[int], list[int]]:
    m = len(t)
    border = [0] * (m + 1)
    for i in range(2, m + 1):
        k = border[i - 1]
        while k > 0 and t[k] != t[i - 1]:
            k = border[k]
        if t[k] == t[i - 1]:
            k += 1
        border[i] = k
    nxt = [0] * (m + 1)
    for j in range(2, m + 1):
        nxt[j] = border[j - 1] + 1
    nxtval = [0] * (m + 1)
    for j in range(2, m + 1):
        if nxt[j] >= 1 and t[nxt[j] - 1] == t[j - 1]:
            nxtval[j] = nxtval[nxt[j]]
        else:
            nxtval[j] = nxt[j]
    return nxt, nxtval


def _naive_match(s: str, t: str) -> tuple[int, int, list[dict[str, Any]]]:
    n, m = len(s), len(t)
    frames: list[dict[str, Any]] = []
    total = 0
    pos = 0
    for start in range(n - m + 1):
        count = 0
        matched = True
        for k in range(m):
            count += 1
            if s[start + k] != t[k]:
                matched = False
                frames.append(_frame(len(frames) + 1, f"起点 {start + 1}",
                                     f"S[{start + 1}..] 与 T 前 {count} 个字符比较后失配（S 第 {start + k + 1} 位 {s[start + k]} ≠ T 第 {k + 1} 位 {t[k]}），右移一位。",
                                     {"起点": str(start + 1), "本次比较次数": str(count), "累计比较次数": str(total + count)}, 1))
                break
        total += count
        if matched:
            pos = start + 1
            frames.append(_frame(len(frames) + 1, f"起点 {start + 1} 匹配成功", f"连续比较 {count} 次全部相等，匹配位置 {start + 1}。",
                                 {"起点": str(start + 1), "本次比较次数": str(count), "累计比较次数": str(total)}, 1))
            break
    return total, pos, frames


def _kmp_match(s: str, t: str, nxt: list[int]) -> tuple[int, int, list[dict[str, Any]]]:
    n, m = len(s), len(t)
    frames: list[dict[str, Any]] = []
    total = 0
    i, j = 1, 1
    while i <= n and j <= m:
        if j == 0:
            i += 1
            j = 1
            frames.append(_frame(len(frames) + 1, f"i={i}", "j 已回退到 0：主串指针前进一位，模式串从头开始。",
                                 {"i": str(i), "j": str(j), "比较次数": str(total)}, 2))
            continue
        total += 1
        if s[i - 1] == t[j - 1]:
            frames.append(_frame(len(frames) + 1, f"比较 S[{i}] 与 T[{j}]", f"{s[i - 1]} = {t[j - 1]}，两指针同时前进。",
                                 {"i": str(i), "j": str(j), "比较次数": str(total)}, 2))
            i += 1
            j += 1
        else:
            frames.append(_frame(len(frames) + 1, f"失配于 S[{i}] vs T[{j}]",
                                 f"{s[i - 1]} ≠ {t[j - 1]}，j 回退为 next[{j}] = {nxt[j]}；主串指针不回溯。",
                                 {"i": str(i), "j": str(nxt[j]), "比较次数": str(total)}, 3))
            j = nxt[j]
    pos = i - m if j > m else 0
    return total, pos, frames


def build_string_match(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if not re.search(r"KMP|next数组|nextval|模式匹配|朴素匹配|主串|模式串", text, re.I):
        return None
    cv = overrides.get("condition_values") or {}
    s = _clause_values(cv, "s", None)
    t = _clause_values(cv, "t", None)
    if not s or not t:
        s_match = re.search(r"主串\s*S\s*[=是为:：]\s*[\"'“”]?([A-Za-z0-9]{2,60})[\"'“”]?", text, re.I)
        t_match = re.search(r"模式串\s*T\s*[=是为:：]\s*[\"'“”]?([A-Za-z0-9]{1,30})[\"'“”]?", text, re.I)
        s = s or (s_match.group(1) if s_match else None)
        t = t or (t_match.group(1) if t_match else None)
    if not s or not t:
        raise ValueError("未识别到主串 S 与模式串 T，请用“主串S=…，模式串T=…”的写法")
    s, t = str(s), str(t)
    if len(s) > 60 or len(t) > 30:
        raise ValueError("串长过长：主串 ≤ 60、模式串 ≤ 30")
    model = {"engine": "ds_string_v1", "subject": "algorithm", "ds_kind": "string_match",
             "s": s, "t": t, "use_kmp": bool(re.search(r"KMP|next|模式匹配", text, re.I)),
             "defaults": {}, "params": [], "teaching": False}
    conditions = [
        _condition("s", "主串 S", s, source=source),
        _condition("t", "模式串 T", t, source=source),
    ]
    formulas = [{"id": "next_def", "tex": r"next[j]=\text{max}\{k\}+1,\ \text{T[1..k-1]=T[j-k+1..j-1]},\ next[1]=0",
                 "plain": "next[j] = T[1..j-1] 最长相等前后缀长度 + 1，next[1]=0；nextval 消除等同失配。", "role": "KMP 口径（1 起）"}]
    return _built("string_match", model, conditions, formulas)


def eval_string_match(model: Mapping[str, Any]) -> dict[str, Any]:
    s = str(model.get("s") or "")
    t = str(model.get("t") or "")
    notes = ["next 数组采用教材 1 起口径：next[1]=0，next[j] 为最长相等前后缀长度 + 1。"]
    frames: list[dict[str, Any]] = []
    naive_total, naive_pos, naive_frames = _naive_match(s, t)
    frames.extend(naive_frames)
    nxt, nxtval = _kmp_tables(t)
    table = {"j": " ".join(str(k) for k in range(1, len(t) + 1)),
             "T[j]": " ".join(t),
             "next": " ".join(str(nxt[k]) for k in range(1, len(t) + 1)),
             "nextval": " ".join(str(nxtval[k]) for k in range(1, len(t) + 1))}
    frames.append(_frame(len(frames) + 1, "next / nextval 数组", "按 1 起教材口径计算得到：" +
                         f"next = {table['next']}；nextval = {table['nextval']}。", table, 3))
    kmp_total, kmp_pos, kmp_frames = _kmp_match(s, t, nxt)
    frames.extend(kmp_frames)
    headline = (f"朴素匹配：比较 {naive_total} 次，匹配位置 {naive_pos or '无'}；"
                f"KMP：比较 {kmp_total} 次，匹配位置 {kmp_pos or '无'}")
    checks = [
        _check("naive", "朴素匹配", True, f"主串指针回溯逐起点比较，共 {naive_total} 次。"),
        _check("kmp", "KMP 匹配", True, f"主串指针不回溯，共 {kmp_total} 次比较" +
               (f"，比朴素少 {naive_total - kmp_total} 次。" if kmp_total < naive_total else "。")),
    ]
    return _ok_result("string_match", headline, headline, _truncate(frames, notes), PSEUDOCODES["string_match"],
                      checks, notes, answer_value=float(naive_total))


# ---------------------------------------------------------------------------
# 识别调度与统一入口
# ---------------------------------------------------------------------------

_DETECT: dict[str, str] = {
    "stack_queue_sim": r"两个栈|两个队列",
    "deque": r"双端队列",
    "brackets": r"括号.{0,6}(?:匹配|配对)|匹配.{0,6}括号",
    "string_match": r"KMP|next数组|nextval|模式匹配|朴素匹配|主串|模式串",
    "analysis": r"时间复杂度|空间复杂度|执行次数|执行频度|语句频度|执行\s*(?:多少|几)\s*次",
    "expression": r"(?:中缀|后缀|前缀)表达式|表达式.{0,8}(?:转换|求值|计算)|求.{0,4}表达式的值",
    "recursion": r"递归调用|调用栈|递归计算|递归过程|递归算法",
    "queue_ops": r"循环队列|顺序队列|入队|出队|队列",
    "stack_ops": r"入栈|进栈|压栈|出栈|弹栈|合法出栈",
    "list_ops": r"顺序表|单链表|双向链表|循环链表|链表|逆置|反转|去重|有序表",
    "sparse": r"三元组|稀疏矩阵",
    "matrix_storage": r"压缩存储|对称矩阵|三角矩阵|三对角",
    "array_address": r"数组.{0,30}地址|地址计算|存储地址|首地址|\[\s*-?\d+\s*\.\.",
}

_STRONG: dict[str, str] = {
    "analysis": r"时间复杂度|空间复杂度|执行次数|语句频度|执行\s*(?:多少|几)\s*次",
    "list_ops": r"逆置|去重|有序表.{0,4}合并|顺序表|单链表",
    "stack_ops": r"合法出栈|入栈序列|出栈序列",
    "brackets": r"括号.{0,6}(?:匹配|配对)",
    "expression": r"(?:中缀|后缀)表达式",
    "recursion": r"递归调用|调用栈",
    "queue_ops": r"循环队列|顺序队列",
    "deque": r"双端队列",
    "stack_queue_sim": r"两个栈|两个队列",
    "array_address": r"地址计算|首地址|\[\s*-?\d+\s*\.\.",
    "matrix_storage": r"压缩存储|对称矩阵|三对角",
    "sparse": r"三元组|稀疏矩阵",
    "string_match": r"KMP|next数组|nextval|模式匹配",
}

_BUILDERS = {
    "stack_queue_sim": build_stack_queue_sim,
    "deque": build_deque,
    "brackets": build_brackets,
    "string_match": build_string_match,
    "analysis": build_analysis,
    "expression": build_expression,
    "recursion": build_recursion,
    "queue_ops": build_queue_ops,
    "stack_ops": build_stack_ops,
    "list_ops": build_list_ops,
    "sparse": build_sparse,
    "matrix_storage": build_matrix_storage,
    "array_address": build_array_address,
}

_EVALUATORS = {
    "analysis": eval_analysis,
    "list_ops": eval_list_ops,
    "stack_ops": eval_stack_ops,
    "brackets": eval_brackets,
    "expression": eval_expression,
    "recursion": eval_recursion,
    "queue_ops": eval_queue_ops,
    "deque": eval_deque,
    "stack_queue_sim": eval_stack_queue_sim,
    "array_address": eval_array_address,
    "matrix_storage": eval_matrix_storage,
    "sparse": eval_sparse,
    "string_match": eval_string_match,
}

_SUMMARY = {
    "analysis": "按循环/递推结构逐层累计语句频度，并给出渐进复杂度。",
    "list_ops": "按给定操作序列逐一执行，统计移动与比较次数。",
    "stack_ops": "按栈规则模拟入栈/出栈并核对序列合法性。",
    "brackets": "用栈完成括号配对检查。",
    "expression": "中缀转后缀（调度栈），数字题顺带求值。",
    "recursion": "模拟调用栈，记录调用次数与栈深。",
    "queue_ops": "按队列口径模拟出入队并判空判满。",
    "deque": "在限制范围内搜索可达的输出序列。",
    "stack_queue_sim": "用两个栈/两个队列模拟对方结构并记录搬运过程。",
    "array_address": "按行/列优先公式计算元素地址。",
    "matrix_storage": "按压缩存储公式计算下标或反查元素。",
    "sparse": "生成三元组表并可执行按列转置。",
    "string_match": "执行朴素匹配与 KMP，给出 next/nextval 数组与比较次数。",
}


def build_ds_problem(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    from .algo_design import build_ds_design
    design = build_ds_design(text, source, overrides)
    if design is not None:
        return design
    from .ds_advanced import build_ds_advanced
    advanced = build_ds_advanced(text, source, overrides)
    if advanced is not None:
        return advanced
    errors: dict[str, str] = {}
    for kind, pattern in _DETECT.items():
        if not re.search(pattern, text, re.I):
            continue
        try:
            built = _BUILDERS[kind](text, source, overrides)
        except ValueError as exc:
            errors[kind] = str(exc)
            continue
        if built is not None:
            return built
    for kind, pattern in _STRONG.items():
        if re.search(pattern, text, re.I):
            reason = errors.get(kind) or "未能从题面解析出该题型所需的完整数据"
            return _blocked_model(kind, reason)
    return None


def evaluate_ds(model: Mapping[str, Any], params: Mapping[str, Any] | None = None) -> dict[str, Any]:
    kind = str(model.get("ds_kind") or "")
    if model.get("blocked"):
        return _blocked_result(kind, str(model.get("blocked")))
    evaluator = _EVALUATORS.get(kind)
    if evaluator is None:
        from .ds_advanced import ADVANCED_EVALUATORS
        evaluator = ADVANCED_EVALUATORS.get(kind)
    if evaluator is None:
        from .algo_design import DESIGN_EVALUATORS
        evaluator = DESIGN_EVALUATORS.get(kind)
    if evaluator is None:
        return _blocked_result(kind or "unknown", "暂不支持该数据结构题型")
    try:
        return evaluator(model)
    except ValueError as exc:
        return _blocked_result(kind, str(exc))


def solve_ds(model: Mapping[str, Any]) -> dict[str, Any]:
    result = evaluate_ds(model, model.get("defaults") or {})
    if result.get("status") != "ok":
        raise ValueError(result.get("reason") or "该题型的条件不足以执行")
    try:
        model["ds_result"] = result
    except TypeError:
        pass
    kind = str(model.get("ds_kind") or "")
    from .ds_advanced import ADVANCED_SUMMARY
    from .algo_design import DESIGN_SUMMARY
    steps = [{"id": f"ds_{frame['index']}", "title": frame["label"], "detail": frame["detail"]}
             for frame in result["frames"][:8]]
    return {
        "summary": _SUMMARY.get(kind) or ADVANCED_SUMMARY.get(kind) or DESIGN_SUMMARY.get(kind) or "按数据结构规则执行并记录轨迹。",
        "answer": result["answer"],
        "answer_order": result.get("answer_order"),
        "answer_value": result.get("answer_value"),
        "steps": steps,
        "conditions": ["全部结论由确定性执行产生，动画回放同一条轨迹。"],
        "limitations": list(result["notes"]),
    }


__all__ = ["build_ds_problem", "evaluate_ds", "solve_ds"]

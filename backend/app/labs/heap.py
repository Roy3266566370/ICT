"""Deterministic binary heap root deletion and conservative source recognition."""
from __future__ import annotations

import math
import re
from typing import Any, Mapping

MAX_HEAP_SIZE = 127
PSEUDOCODE = [
    "记录初始堆与删除次数",
    "删除堆顶，用末尾元素填充根节点",
    "选择两个孩子中优先级更高者（相同则选左）",
    "若孩子优先于父节点，交换并继续向下筛选",
    "堆序恢复，记录一次删除的结果",
    "重复直到完成指定次数",
]
INSERT_PSEUDOCODE = [
    "从空堆开始，按给定序列逐项处理",
    "把新元素放到数组末尾",
    "与父节点比较：优先则交换并继续上滤",
    "堆序恢复，记录本次插入后的数组",
    "重复直到序列全部插入",
]


def _number(value: Any) -> bool:
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def _count(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
        return int(number) if math.isfinite(number) and number.is_integer() else None
    except (TypeError, ValueError, OverflowError):
        return None


def _valid(array: list[Any], kind: str) -> bool:
    return all(array[(i - 1) // 2] >= array[i] if kind == "max" else array[(i - 1) // 2] <= array[i] for i in range(1, len(array)))


def _validate(model: Mapping[str, Any], params: Mapping[str, Any]) -> tuple[list[Any], str, int | None, str, bool, str]:
    array = model.get("initial_heap")
    kind = model.get("heap_type")
    defaults = model.get("defaults") or {}
    operation = params.get("operation", model.get("operation", defaults.get("operation", "delete")))
    counted = bool(params.get("count_comparisons", model.get("count_comparisons", defaults.get("count_comparisons", False))))
    count = _count(params.get("deletion_count", model.get("deletion_count", defaults.get("deletion_count"))))

    def blocked(reason: str):
        return array if isinstance(array, list) else [], str(kind or ""), count, operation, counted, reason

    if operation not in ("delete", "insert"):
        return blocked("堆操作须为删除堆顶或依次插入建堆，不能使用未定义的操作。")
    if not isinstance(array, list) or not array or len(array) > MAX_HEAP_SIZE or not all(_number(v) for v in array):
        target = "插入序列" if operation == "insert" else "初始堆序列"
        return blocked(f"请提供 1–{MAX_HEAP_SIZE} 个有限数值组成的{target}。")
    if kind not in ("max", "min"):
        return blocked("请确认使用大根堆还是小根堆。")
    if operation == "insert":
        budget = 2 + sum(2 + 2 * int(math.log2(max(1, size))) for size in range(1, len(array) + 1))
        if budget > 200:
            return blocked("该建堆轨迹上限超过 200 帧，请减少插入序列长度。")
        return array, kind, count, operation, counted, ""
    if not _valid(array, kind):
        return blocked("初始序列不满足堆序，请核对原题；不会自动重新建堆。")
    if count is None or count < 0 or count > len(array):
        return blocked(f"删除次数须为 0–{len(array)} 的整数，不能从空堆继续删除。")
    budget = 2 + sum(2 + 2 * int(math.log2(max(1, len(array) - deletion))) for deletion in range(1, count + 1))
    if budget > 200:
        return blocked("该操作的完整轨迹上限超过 200 帧，请减少删除次数或初始堆大小。")
    return array, kind, count, operation, counted, ""


def _text_number(token: str) -> int | None:
    words = {"零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
    if token.isdigit():
        return int(token)
    if token in words:
        return words[token]
    if "十" in token:
        left, right = token.split("十", 1)
        return words.get(left, 1) * 10 + words.get(right, 0)
    return None


def _parse_array(raw: str) -> list[int | float] | None:
    token = r"[-+]?\d+(?:\.\d+)?"
    stripped = raw.strip().strip("[]（）(){} ")
    if not re.fullmatch(rf"{token}(?:\s*[,，、;；\s]\s*{token})*", stripped):
        return None
    return [float(item) if "." in item else int(item) for item in re.findall(token, stripped)]


def build_heap(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if not re.search(r"(?:堆|\bheap\b)", text, re.I):
        return None
    if re.search(r"堆排序", text):
        return None  # 堆排序由排序题型内核处理
    # Options describe possible results, never the starting heap.
    stem = re.split(r"(?<![A-Za-z])[A-DＡ-Ｄ][.．、:：)）]\s*", text, maxsplit=1)[0]
    mentions_min = bool(re.search(r"(?:小根堆|小顶堆|最小堆|min[ -]?heap)", stem, re.I))
    mentions_max = bool(re.search(r"(?:大根堆|大顶堆|最大堆|max[ -]?heap)", stem, re.I))
    kind = ("min" if mentions_min else "max") if mentions_min != mentions_max else None
    initial = None
    array_match = re.search(r"(?:初始(?:序列|堆)?|序列|数组|array)\s*(?:为|是|:|：)?\s*([\[（({][^\]）)}]+[\]）)}])", stem, re.I)
    if not array_match:
        array_match = re.search(r"(?:堆|heap)\s*(?:为|是|:|：)?\s*([\[（({]\s*[-+]?\d+(?:[\d.,，、;；\s+-])*[\]）)}])", stem, re.I)
    if array_match and not re.search(r"初始|原始", array_match.group(0)) and re.search(r"(?:删除|移除).*后|最终|结果", stem[:array_match.start()]):
        array_match = None
    if array_match:
        initial = _parse_array(array_match.group(1))
    else:
        plain = re.search(r"(?:初始(?:序列|堆)?|序列|数组)\s*(?:为|是|:|：)?\s*([-+]?\d+(?:\s*[,，、]\s*[-+]?\d+)+)", stem)
        if plain:
            initial = _parse_array(plain.group(1))
    count_match = re.search(r"(?:删除|移除|delete|remove)\s*(?:了|连续|操作)?\s*(?:堆顶(?:元素|节点|结点)?|根节点|根结点)?\s*([0-9零一二两三四五六七八九十]+)\s*次", stem, re.I)
    if not count_match:
        count_match = re.search(r"([0-9零一二两三四五六七八九十]+)\s*次\s*(?:删除|移除)", stem)
    count = _text_number(count_match.group(1)) if count_match else None
    # Singular delete-root explicitly without a vague repetition count.
    if count is None and not re.search(r"若干|多次|连续|几次", stem) and re.search(r"(?:删除|移除)(?:堆顶|根节点|根结点)", stem):
        count = 1
    insert_hint = bool(re.search(r"(?:依次|逐个|连续|按顺序)[^。]{0,8}(?:插入|加入|建堆)"
                                 r"|(?:插入|加入)[^。]{0,6}(?:建堆|构造堆)"
                                 r"|空堆[^。]{0,10}(?:依次|逐个)?\s*(?:插入|加入)", stem))
    if insert_hint:
        sequence_match = re.search(r"(?:将|把)?\s*([\[（(]?[-+]?\d+(?:\s*[,，、]\s*[-+]?\d+)+[\]）)]?)\s*(?:依次|逐个|按顺序)?\s*(?:插入|加入)", stem)
        if sequence_match is None:
            sequence_match = re.search(r"(?:依次|逐个|按顺序)\s*(?:插入|加入)\s*([\[（(]?[-+]?\d+(?:\s*[,，、]\s*[-+]?\d+)+[\]）)]?)", stem)
        if sequence_match is not None:
            initial = _parse_array(sequence_match.group(1))
    elif isinstance(initial, list) and initial:
        # 已给合法堆中插入单个元素（408 常见考法）：合法堆按层序逐项重插是
        # 不动点，故把被插元素追加到初始序列即可复用"依次插入"内核。
        single_insert = re.search(r"(?:插入|加入|放入)\s*(?:关键字|元素|值|结点|节点|数据)?\s*([-+]?\d+(?:\.\d+)?)", stem)
        if single_insert:
            value: int | float = float(single_insert.group(1)) if "." in single_insert.group(1) else int(single_insert.group(1))
            insert_hint = True
            initial = [*initial, value]
    operation = str(overrides.get("operation", "insert" if insert_hint else "delete"))
    counted = bool(overrides.get("count_comparisons", False))
    initial = overrides.get("initial_heap", initial)
    kind = overrides.get("heap_type", kind)
    count = overrides.get("deletion_count", count)
    choices: dict[str, list[int | float]] = {}
    parts = re.split(r"(?<![A-Za-z])([A-D])[.．、:：)）]\s*", text)
    for index in range(1, len(parts) - 1, 2):
        raw = parts[index + 1].strip()
        option = _parse_array(raw.rstrip("。；;"))
        if option is not None:
            choices[parts[index]] = option
    if operation == "insert":
        model = {"engine": "heap_v1", "subject": "algorithm", "algorithm": "heap", "heap_type": kind,
                 "initial_heap": initial if initial is not None else [], "operation": "insert",
                 "count_comparisons": counted, "defaults": {"operation": "insert", "count_comparisons": counted},
                 "choices": choices, "params": [], "teaching": False}
    else:
        model = {"engine": "heap_v1", "subject": "algorithm", "algorithm": "heap", "heap_type": kind,
                 "initial_heap": initial if initial is not None else [], "operation": "delete",
                 "count_comparisons": counted, "defaults": {"deletion_count": count, "operation": "delete",
                 "count_comparisons": counted}, "choices": choices,
                 "params": [{"id": "deletion_count", "label": "删除次数", "kind": "number", "min": 0,
                             "max": len(initial) if isinstance(initial, list) else 0, "step": 1, "options": []}],
                 "teaching": False}
    _, _, _, _, _, reason = _validate(model, {})
    field = ("initial_heap" if initial is None or (operation == "insert" and not initial)
             else "heap_type" if kind is None
             else "deletion_count" if operation == "delete" and count is None
             else "heap_conditions")
    ambiguities = [] if not reason else [{"id": "heap_conditions", "field": field,
        "question": reason, "severity": "blocking", "options": [], "resolved": False, "answer": None}]
    conditions = []
    fields = (("initial_heap", "插入序列" if operation == "insert" else "初始堆序列", model["initial_heap"], "text"), ("heap_type", "堆类型", kind, "enum"))
    if operation == "delete":
        fields += (("deletion_count", "删除次数", count, "number"),)
    for key, label, value, field_kind in fields:
        conditions.append({"id": key, "label": label, "value": value, "kind": field_kind, "unit": "", "provenance": "user_confirmed" if key in overrides else "original", "source": dict(source), "editable": True,
                           "options": ["max", "min"] if key == "heap_type" else [], "min": 0 if key == "deletion_count" else None,
                           "max": len(model["initial_heap"]) if key == "deletion_count" and isinstance(model["initial_heap"], list) else None, "step": 1 if key == "deletion_count" else None})
    rule_plain = ("0 下标：父节点 floor((i-1)/2)，孩子 2i+1 与 2i+2；从空堆开始逐项插入，新元素与父节点比较并上滤。" if operation == "insert"
                  else "0 下标：父节点 floor((i-1)/2)，孩子 2i+1 与 2i+2；删除后向下筛选。")
    return {"model": model, "conditions": conditions, "ambiguities": ambiguities, "formulas": [{"id": "heap_rule", "tex": r"p(i)=\lfloor(i-1)/2\rfloor,\ l(i)=2i+1,\ r(i)=2i+2", "plain": rule_plain, "role": "堆规则"}], "recognized": not ambiguities}


def _compare_note() -> str:
    return ("关键字比较口径：删除时先比较两个孩子选出优先者（存在右孩子时计 1 次），"
            "再比较父节点与优先孩子（计 1 次）；插入时每与父节点比较一次计 1 次，无论是否交换。")


def _evaluate_deletion(initial: list[Any], kind: str, count: int, counted: bool) -> dict[str, Any]:
    array = initial.copy()
    deleted: list[Any] = []
    frames: list[dict[str, Any]] = []
    snapshots = [array.copy()]
    comparisons = 0

    def record(action: str, label: str, detail: str, indices: list[int], deletion: int, line: int) -> None:
        values = {"array": array.copy(), "deleted": deleted.copy(), "swapped_indices": indices.copy(), "heap_valid": _valid(array, kind), "deletion": deletion}
        frames.append({"index": len(frames), "action": action, "label": label, "detail": detail, "values": values, **values, "pseudocodeLine": line})

    record("initial", "初始堆", "核对初始数组满足堆序。", [], 0, 1)
    for deletion in range(1, count + 1):
        root = array[0]
        deleted.append(root)
        last = array.pop()
        if array:
            array[0] = last
        record("replace_root", f"第 {deletion} 次删除堆顶 {root}", "删除堆顶，末尾元素补到根节点；可能暂时不满足堆序。", [0] if array else [], deletion, 2)
        index = 0
        while index * 2 + 1 < len(array):
            child = index * 2 + 1
            right = child + 1
            if right < len(array):
                comparisons += 1
                if array[right] > array[child] if kind == "max" else array[right] < array[child]:
                    child = right
            comparisons += 1
            record("compare", "比较父节点与优先孩子", f"父节点下标 {index}，优先孩子下标 {child}；同值优先选择左孩子。", [index, child], deletion, 3)
            if array[index] >= array[child] if kind == "max" else array[index] <= array[child]:
                break
            array[index], array[child] = array[child], array[index]
            record("sift_down", f"交换下标 {index} 与 {child}", "交换后沿该孩子继续向下检查。", [index, child], deletion, 4)
            index = child
        snapshots.append(array.copy())
        record("deletion_done", f"第 {deletion} 次删除完成", "堆序已恢复，按层序数组记录当前堆。", [], deletion, 5)
    record("done", "删除完成", "最终序列是堆的层序数组。", [], count, 6)
    answer_order = [str(value) for value in array]
    notes = ["下标从 0 开始；筛选中的临时状态可能不满足堆序。相同优先级的孩子固定选择左侧。"]
    result = {"subject": "algorithm", "algorithm": "heap", "status": "ok", "heap_type": kind, "params": {"deletion_count": count},
              "initial_heap": initial.copy(), "final_heap": array.copy(), "deleted": deleted, "snapshots": snapshots, "frames": frames, "trace": frames,
              "trace_kind": "heap_deletion", "pseudocode": PSEUDOCODE, "answer_order": answer_order,
              "answer": ", ".join(answer_order) if array else "空堆",
              "headline": f"删除 {count} 次后的堆：[{', '.join(answer_order)}]",
              "metrics": [{"id": "array", "label": "堆数组", "value": str(array)}, {"id": "deleted", "label": "已删除", "value": str(deleted)}],
              "checks": [{"id": "heap_invariant", "label": "最终堆序", "status": "pass", "detail": "各次删除完成后均恢复父节点与孩子之间的堆序。"}],
              "notes": notes}
    if counted:
        result["compare_count"] = comparisons
        notes.append(_compare_note())
    return result


def _evaluate_insertion(sequence: list[Any], kind: str, counted: bool) -> dict[str, Any]:
    array: list[Any] = []
    inserted: list[Any] = []
    frames: list[dict[str, Any]] = []
    snapshots = [array.copy()]
    comparisons = 0

    def record(action: str, label: str, detail: str, indices: list[int], step: int, line: int) -> None:
        values = {"array": array.copy(), "inserted": inserted.copy(), "swapped_indices": indices.copy(), "heap_valid": _valid(array, kind), "step": step}
        frames.append({"index": len(frames), "action": action, "label": label, "detail": detail, "values": values, **values, "pseudocodeLine": line})

    record("initial", "空堆", "从空堆开始，按给定序列逐项插入。", [], 0, 1)
    for number, value in enumerate(sequence, 1):
        array.append(value)
        inserted.append(value)
        record("insert", f"插入第 {number} 个元素 {value}", "新元素先放到数组末尾，再与父节点比较。", [], number, 2)
        index = len(array) - 1
        while index > 0:
            parent = (index - 1) // 2
            comparisons += 1
            record("compare", "比较新元素与父节点", f"新元素下标 {index}，父节点下标 {parent}；优先则交换并继续上滤。", [index, parent], number, 3)
            if array[index] > array[parent] if kind == "max" else array[index] < array[parent]:
                array[index], array[parent] = array[parent], array[index]
                record("sift_up", f"交换下标 {index} 与 {parent}", "交换后继续沿父节点向上检查。", [index, parent], number, 4)
                index = parent
            else:
                break
        snapshots.append(array.copy())
        record("insert_done", f"第 {number} 次插入完成", "堆序已恢复，按层序数组记录当前堆。", [], number, 4)
    record("done", "建堆完成", "最终序列是堆的层序数组。", [], len(sequence), 5)
    answer_order = [str(value) for value in array]
    notes = ["下标从 0 开始；插入建堆不要求输入序列本身满足堆序，每插入一个元素后上滤恢复堆序；相同优先级不交换。"]
    result = {"subject": "algorithm", "algorithm": "heap", "status": "ok", "heap_type": kind, "params": {"operation": "insert"},
              "initial_heap": sequence.copy(), "final_heap": array.copy(), "deleted": [], "snapshots": snapshots, "frames": frames, "trace": frames,
              "trace_kind": "heap_insertion", "pseudocode": INSERT_PSEUDOCODE, "answer_order": answer_order,
              "answer": ", ".join(answer_order) if array else "空堆",
              "headline": f"依次插入后的堆：[{', '.join(answer_order)}]",
              "metrics": [{"id": "array", "label": "堆数组", "value": str(array)}, {"id": "inserted", "label": "已插入", "value": str(inserted)}],
              "checks": [{"id": "heap_invariant", "label": "每步插入后堆序", "status": "pass", "detail": "每次上滤完成后均恢复父节点与孩子之间的堆序。"}],
              "notes": notes}
    if counted:
        result["compare_count"] = comparisons
        notes.append(_compare_note())
    return result


def evaluate_heap(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    initial, kind, count, operation, counted, reason = _validate(model, params)
    if reason:
        return {"subject": "algorithm", "algorithm": "heap", "status": "blocked", "reason": reason, "headline": reason, "trace": [], "frames": [], "checks": [], "metrics": []}
    if operation == "insert":
        return _evaluate_insertion(initial, kind, counted)
    return _evaluate_deletion(initial, kind, count, counted)  # type: ignore[arg-type]


def solve_heap(model: Mapping[str, Any]) -> dict[str, Any]:
    result = evaluate_heap(model, {})
    if result["status"] != "ok":
        raise ValueError(result["reason"])
    choice = next((key for key, values in (model.get("choices") or {}).items() if values == result["final_heap"]), None)
    if result.get("trace_kind") == "heap_insertion":
        steps = [{"id": f"heap_{f['index']}", "title": f["label"], "detail": f"{f['detail']} 数组：{f['array']}；已插入：{f['inserted']}。"}
                 for f in result["trace"] if f["action"] != "compare"]
        return {"summary": "从空堆开始，按给定序列逐个插入，每次上滤恢复堆序。", "answer": result["answer"], "answer_order": result["answer_order"], "answer_choice": choice,
                "steps": steps, "conditions": ["插入序列逐项按给定顺序处理；每次上滤后恢复堆序。"], "limitations": result["notes"]}
    steps = [{"id": f"heap_{f['index']}", "title": f["label"], "detail": f"{f['detail']} 数组：{f['array']}；已删除：{f['deleted']}。"} for f in result["trace"] if f["action"] != "compare"]
    return {"summary": "删除堆顶后，用末尾元素替换根节点并逐层向下筛选。", "answer": result["answer"], "answer_order": result["answer_order"], "answer_choice": choice,
            "steps": steps, "conditions": ["初始序列已满足堆序；每次筛选后恢复堆序。"], "limitations": result["notes"]}

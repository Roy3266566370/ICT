"""操作系统题目的识别与确定性求解。

覆盖四类题型，全部产出可逐步回放的执行轨迹：

- ``cpu_schedule``：FCFS / SJF（非抢占）/ SRTF（抢占）/ 时间片轮转 RR / 优先级（非抢占，数小优先）；
- ``page_replace``：FIFO / LRU / OPT 页面置换，统计缺页次数并检查 Belady 异常；
- ``disk_schedule``：FCFS / SSTF / SCAN / C-SCAN / LOOK / C-LOOK 磁盘调度；
- ``banker``：银行家算法安全性检查，可附带一次资源请求。

同一份题目数据可以切换算法对照；每个确定性约定（同刻到达的入队先后、LRU 的并列、
SCAN 是否走到磁盘末端、回扫是否计入）都写进条件或说明，数据缺失时生成明确的阻塞问题，
不编造数据。
"""

from __future__ import annotations

import math
import re
from collections import deque
from typing import Any, Mapping, Sequence

from .linalg import _ambiguity, _coerce_matrix, _coerce_vector, _condition, _fmt, _param

EPS = 1e-9
MAX_PROCESSES = 12
MAX_REFERENCE = 60
MAX_FRAMES = 10
MAX_REQUESTS = 40
MAX_BANKER_N = 8
MAX_BANKER_M = 6

KIND_LABELS = {
    "cpu_schedule": "CPU 调度",
    "page_replace": "页面置换",
    "disk_schedule": "磁盘调度",
    "banker": "银行家算法",
}

SCHED_LABELS = {
    "fcfs": "先来先服务 FCFS",
    "sjf": "短作业优先 SJF（非抢占）",
    "srtf": "最短剩余时间优先 SRTF（抢占）",
    "rr": "时间片轮转 RR",
    "priority": "优先级调度（非抢占，数小优先）",
}
PAGE_LABELS = {"fifo": "先进先出 FIFO", "lru": "最近最久未使用 LRU", "opt": "最佳置换 OPT"}
DISK_LABELS = {
    "fcfs": "先来先服务 FCFS", "sstf": "最短寻道时间优先 SSTF", "scan": "SCAN（电梯）",
    "cscan": "C-SCAN（循环扫描）", "look": "LOOK", "clook": "C-LOOK",
}

SCHED_PSEUDOCODE = [
    "按到达时间把进程放入就绪队列",
    "按调度规则从就绪队列选出一个进程",
    "运行到完成、被抢占或时间片用完",
    "记录完成时刻并更新就绪队列",
    "周转 = 完成 − 到达；等待 = 周转 − 服务",
]
PAGE_PSEUDOCODE = [
    "取下一个页面访问",
    "页面已在物理块中 → 命中，更新记录",
    "否则缺页：有空闲块就直接装入",
    "没有空闲块：按算法选出被置换页面",
    "统计缺页次数与缺页率",
]
DISK_PSEUDOCODE = [
    "从当前磁头位置出发",
    "按算法选出下一个服务的磁道（或端点）",
    "移动磁头并累加移动距离",
    "必要时到达末端后换向或回扫",
    "全部请求服务完毕，统计总移动距离",
]
BANKER_PSEUDOCODE = [
    "Need = Max − Allocation，Work = Available",
    "找一个未完成且 Need ≤ Work 的进程",
    "假定它运行完毕：Work = Work + Allocation",
    "重复直到全部完成（安全）或再无可选进程（不安全）",
    "安全序列即各轮选出进程的顺序",
]


# ---------------------------------------------------------------------------
# 文本工具
# ---------------------------------------------------------------------------


def _word(token: str) -> str:
    return rf"(?<![A-Za-z]){token}(?![A-Za-z])"


def _earliest(text: str, patterns: Mapping[str, str]) -> str | None:
    """题目里同时提到多个算法时，取最先出现的那个。"""

    best: tuple[int, str] | None = None
    for key, pattern in patterns.items():
        match = re.search(pattern, text.lower())
        if match and (best is None or match.start() < best[0]):
            best = (match.start(), key)
    return best[1] if best else None


def _numbers(text: str) -> list[float]:
    return [float(item) for item in re.findall(r"-?\d+(?:\.\d+)?", text)]


def _clean(value: float) -> float:
    return round(float(value), 9)


def _int_like(value: float) -> bool:
    return abs(value - round(value)) < EPS


def _blocked(kind: str, engine: str, reason: str, **extra: Any) -> dict[str, Any]:
    return {"subject": "operating_system", "engine": engine, "os_kind": kind, "status": "blocked",
            "reason": reason, "headline": reason, "trace": [], "frames": [], "checks": [], "metrics": [],
            "pseudocode": [], "answer": "", "stats": {}, "notes": [], **extra}


def _frame(store: list[dict[str, Any]], action: str, label: str, detail: str, line: int,
           **values: Any) -> None:
    store.append({"index": len(store), "action": action, "label": label, "detail": detail,
                   "values": values, "pseudocodeLine": line})


def _detect_kind(text: str) -> str | None:
    low = text.lower()
    if re.search(r"银行家|安全序列|安全状态|banker|allocation|available|死锁避免", low):
        return "banker"
    if re.search(r"页面置换|缺页|页框|物理块|页面访问|置换算法|引用串|page fault|page replacement|最佳置换|最近最久"
                 + "|" + _word("lru") + "|" + _word("opt"), low):
        return "page_replace"
    if re.search(r"磁盘调度|磁头|寻道|磁道|柱面|sstf|电梯算法|disk scheduling|scan|" + _word("look"), low):
        return "disk_schedule"
    if re.search(r"进程|作业|调度|周转|到达时间|时间片|fcfs|sjf|srtf|优先级|轮转|round robin|turnaround|scheduling", low):
        return "cpu_schedule"
    return None


# ---------------------------------------------------------------------------
# CPU 调度：解析
# ---------------------------------------------------------------------------

_PROC_NAME = r"(?:[A-Za-z][A-Za-z0-9]{0,4}|进程\s*\d+|作业\s*\d+)"
_PROC_ROW = re.compile(
    rf"^\s*\|?\s*({_PROC_NAME})\s*[|\s,，:：]+(\d+(?:\.\d+)?)\s*[|\s,，]+(\d+(?:\.\d+)?)"
    r"(?:\s*[|\s,，]+(\d+(?:\.\d+)?))?\s*\|?\s*$"
)


def _norm_name(raw: str) -> str:
    name = re.sub(r"\s+", "", raw)
    return name.upper() if re.fullmatch(r"[PpJj]\d+", name) else name


def _table_processes(text: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for line in re.split(r"[\n;；]+", text):
        match = _PROC_ROW.match(line)
        if not match:
            continue
        name, arrival, burst, priority = match.groups()
        result.append({"id": _norm_name(name), "arrival": float(arrival), "burst": float(burst),
                       "priority": float(priority) if priority is not None else None})
    return result


def _inline_processes(text: str) -> list[dict[str, Any]]:
    mentions = list(re.finditer(r"(?<![A-Za-z0-9])([PJpj]\d+|进程\s*\d+|作业\s*\d+)(?![A-Za-z0-9])", text))
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, mention in enumerate(mentions):
        end = mentions[index + 1].start() if index + 1 < len(mentions) else min(len(text), mention.end() + 70)
        chunk = text[mention.end():end]
        arrival = re.search(r"(?:到达|arrival|arrive)(?:时间)?\s*(?:为|是|=|:|：)?\s*(\d+(?:\.\d+)?)", chunk, re.I)
        burst = re.search(r"(?:服务|运行|执行|CPU|需要|所需|burst)(?:时间|区间)?\s*(?:为|是|=|:|：|需要)?\s*(\d+(?:\.\d+)?)",
                          chunk, re.I)
        if not arrival or not burst:
            continue
        priority = re.search(r"(?:优先级|优先数|priority)\s*(?:为|是|=|:|：)?\s*(\d+(?:\.\d+)?)", chunk, re.I)
        name = _norm_name(mention.group(1))
        if name in seen:
            continue
        seen.add(name)
        result.append({"id": name, "arrival": float(arrival.group(1)), "burst": float(burst.group(1)),
                       "priority": float(priority.group(1)) if priority else None})
    return result


def _numbers_after(text: str, label: str) -> list[float]:
    match = re.search(rf"(?:{label})[^\d\-]{{0,14}}((?:\d+(?:\.\d+)?[\s,，、/;；]*)+)", text, re.I)
    return _numbers(match.group(1)) if match else []


def _list_processes(text: str) -> list[dict[str, Any]]:
    arrivals = _numbers_after(text, r"到达时间|arrival\s*times?")
    bursts = _numbers_after(text, r"(?:服务|运行|执行|CPU\s*区间|burst)\s*时间|CPU\s*时间|burst\s*times?")
    priorities = _numbers_after(text, r"优先级|优先数|priority")
    if not arrivals or len(arrivals) != len(bursts):
        return []
    names: list[str] = []
    for item in re.findall(r"(?<![A-Za-z0-9])([PJpj]\d+)(?![A-Za-z0-9])", text):
        if _norm_name(item) not in names:
            names.append(_norm_name(item))
    if len(names) != len(arrivals):
        names = [f"P{i + 1}" for i in range(len(arrivals))]
    return [{"id": names[i], "arrival": arrivals[i], "burst": bursts[i],
             "priority": priorities[i] if len(priorities) == len(arrivals) else None}
            for i in range(len(arrivals))]


def _coerce_processes(value: Any) -> list[dict[str, Any]] | None:
    if isinstance(value, str):
        return _table_processes(value) or None
    if isinstance(value, (list, tuple)) and value:
        result = []
        for index, row in enumerate(value):
            if isinstance(row, Mapping):
                row = [row.get("id"), row.get("arrival"), row.get("burst"), row.get("priority")]
            if not isinstance(row, (list, tuple)) or len(row) < 3:
                return None
            try:
                result.append({"id": _norm_name(str(row[0] or f"P{index + 1}")), "arrival": float(row[1]),
                               "burst": float(row[2]),
                               "priority": float(row[3]) if len(row) > 3 and row[3] not in (None, "") else None})
            except (TypeError, ValueError):
                return None
        return result
    return None


def _detect_sched_algorithm(text: str) -> str | None:
    return _earliest(text, {
        "srtf": r"srtf|srt(?![a-z])|最短剩余|剩余时间最短|抢占式短作业|抢占式短进程|抢占式sjf|可抢占的短",
        "rr": r"时间片|轮转|round[\s-]?robin|" + _word("rr"),
        "sjf": r"短作业|短进程|最短作业|最短进程|sjf|sjn|spn",
        "priority": r"优先级|优先权|priority",
        "fcfs": r"先来先服务|fcfs|fifo",
    })


def _processes_text(processes: Sequence[Mapping[str, Any]], with_priority: bool) -> str:
    return "; ".join(
        f"{p['id']} {_fmt(p['arrival'])} {_fmt(p['burst'])}"
        + (f" {_fmt(p['priority'])}" if with_priority and p.get("priority") is not None else "")
        for p in processes
    )


def _build_schedule(text: str, source: Mapping[str, Any], merged: Mapping[str, Any]) -> dict[str, Any]:
    ambiguities: list[dict[str, Any]] = []
    processes = (_coerce_processes(merged.get("processes")) or _table_processes(text)
                 or _inline_processes(text) or _list_processes(text))
    has_priority = bool(processes) and all(p.get("priority") is not None for p in processes)

    quantum = merged.get("quantum")
    try:
        quantum = float(quantum) if quantum is not None and str(quantum).strip() != "" else None
    except (TypeError, ValueError):
        quantum = None
    quantum_found = quantum is not None
    if quantum is None:
        match = re.search(r"时间片(?:大小|长度)?\s*(?:为|是|=|:|：|取)?\s*(\d+(?:\.\d+)?)|quantum\s*(?:=|:|is)?\s*(\d+(?:\.\d+)?)",
                          text, re.I)
        if match:
            quantum = float(next(group for group in match.groups() if group))
            quantum_found = True
    algorithm = str(merged.get("algorithm") or "").strip() or _detect_sched_algorithm(text)
    if algorithm not in SCHED_LABELS or (algorithm == "priority" and not has_priority):
        algorithm = None
    if algorithm is None:
        algorithm = "rr" if quantum_found else "priority" if has_priority and "优先" in text else "fcfs"
    if quantum is None or quantum <= 0:
        quantum = 2.0
        quantum_found = False

    if not processes:
        ambiguities.append(_ambiguity(
            "processes", "processes",
            "没有识别到进程表。请每个进程一行，写成 “P1 0 7”（名称 到达时间 服务时间，可再加优先级），多个进程用分号分隔。"))
    else:
        names = [p["id"] for p in processes]
        if len(set(names)) != len(names):
            ambiguities.append(_ambiguity("processes", "processes", "进程名称有重复，请给每个进程唯一的名称。"))
        if len(processes) > MAX_PROCESSES:
            ambiguities.append(_ambiguity(
                "process_count", "processes", f"进程超过 {MAX_PROCESSES} 个；为保证甘特图可读，首版仅支持 {MAX_PROCESSES} 个以内。"))
        if any(p["burst"] <= 0 or p["arrival"] < 0 for p in processes):
            ambiguities.append(_ambiguity("processes", "processes", "到达时间不能为负，服务时间必须大于 0。"))

    options = ["fcfs", "sjf", "srtf", "rr"] + (["priority"] if has_priority else [])
    params = [
        _param("algorithm", "调度算法", "enum", options=options, note="同一组进程可切换算法，对照平均等待与周转时间。"),
        _param("quantum", "时间片 q", "number", min_value=1, max_value=10, step=1, note="仅时间片轮转使用。"),
    ]
    model = {
        "engine": "os_sched_v1", "subject": "operating_system", "os_kind": "cpu_schedule",
        "processes": processes, "has_priority": has_priority,
        "defaults": {"algorithm": algorithm, "quantum": quantum}, "params": params, "teaching": False,
    }
    conditions = []
    if processes:
        conditions.append(_condition(
            "processes", "进程表（名称 到达 服务 [优先级]）", _processes_text(processes, has_priority), source=source,
            note="每个进程以分号分隔，例如 P1 0 7; P2 2 4；修正后重新求解。"))
    conditions.append(_condition(
        "quantum", "时间片 q（仅 RR）", quantum, kind="number", source=source,
        provenance="original" if quantum_found else "supplement",
        note=None if quantum_found else "题目未给出时间片，默认 q=2，可在条件中修正。"))
    formulas = [{
        "id": "sched_rule", "tex": r"T_{周转}=T_{完成}-T_{到达},\quad T_{等待}=T_{周转}-T_{服务}",
        "plain": "周转时间 = 完成时间 − 到达时间；等待时间 = 周转时间 − 服务时间；带权周转 = 周转 / 服务。", "role": "评价指标",
    }]
    return {"model": model, "conditions": conditions, "ambiguities": ambiguities, "formulas": formulas,
            "recognized": not ambiguities}


# ---------------------------------------------------------------------------
# CPU 调度：模拟
# ---------------------------------------------------------------------------


def _simulate_schedule(processes: Sequence[Mapping[str, Any]], algorithm: str, quantum: float) -> dict[str, Any]:
    n = len(processes)
    arrival = [float(p["arrival"]) for p in processes]
    burst = [float(p["burst"]) for p in processes]
    priority = [p.get("priority") for p in processes]
    remaining = list(burst)
    first: list[float | None] = [None] * n
    finish: list[float | None] = [None] * n
    segments: list[dict[str, Any]] = []
    time = min(arrival)
    done = 0

    def add(index: int, start: float, end: float, reason: str, ready: list[int]) -> None:
        if index >= 0 and first[index] is None:
            first[index] = start
        snapshot = [_clean(value) for value in remaining]
        last = segments[-1] if segments else None
        if last and last["index"] == index and abs(last["end"] - start) < EPS:
            last["end"] = _clean(end)
            last["remaining"] = snapshot
            return
        segments.append({"index": index, "start": _clean(start), "end": _clean(end), "reason": reason,
                         "ready": list(ready), "remaining": snapshot})

    def idle() -> float:
        nxt = min(arrival[i] for i in range(n) if finish[i] is None and arrival[i] > time + EPS)
        add(-1, time, nxt, "没有已到达的进程，CPU 空闲", [])
        return _clean(nxt)

    if algorithm in ("fcfs", "sjf", "priority"):
        def key(i: int) -> tuple[float, ...]:
            if algorithm == "fcfs":
                return (arrival[i], i)
            if algorithm == "sjf":
                return (burst[i], arrival[i], i)
            return (float(priority[i] if priority[i] is not None else math.inf), arrival[i], i)

        while done < n:
            available = [i for i in range(n) if finish[i] is None and arrival[i] <= time + EPS]
            if not available:
                time = idle()
                continue
            pick = min(available, key=key)
            ready = sorted((i for i in available if i != pick), key=key)
            reason = {
                "fcfs": "就绪进程中最先到达",
                "sjf": f"就绪进程中服务时间最短（{_fmt(burst[pick])}）",
                "priority": f"就绪进程中优先级数最小（{_fmt(priority[pick])}）",
            }[algorithm]
            start = time
            time = _clean(time + remaining[pick])
            remaining[pick] = 0.0
            finish[pick] = time
            done += 1
            add(pick, start, time, reason + "，非抢占，运行到完成", ready)
    elif algorithm == "srtf":
        current = -1
        while done < n:
            available = [i for i in range(n) if finish[i] is None and arrival[i] <= time + EPS]
            if not available:
                time = idle()
                current = -1
                continue

            def srtf_key(i: int) -> tuple[float, ...]:
                return (remaining[i], 0 if i == current else 1, arrival[i], i)

            pick = min(available, key=srtf_key)
            ready = sorted((i for i in available if i != pick), key=srtf_key)
            future = [arrival[i] for i in range(n) if finish[i] is None and arrival[i] > time + EPS]
            horizon = min(future) if future else math.inf
            run = min(remaining[pick], horizon - time)
            reason = f"剩余时间最短（{_fmt(remaining[pick])}），遇到新到达的进程会重新比较"
            start = time
            time = _clean(time + run)
            remaining[pick] = _clean(remaining[pick] - run)
            if remaining[pick] <= EPS:
                remaining[pick] = 0.0
                finish[pick] = time
                done += 1
            add(pick, start, time, reason, ready)
            current = pick
    else:
        queue: deque[int] = deque()
        queued: set[int] = set()

        def admit(upto: float) -> None:
            for i in sorted((i for i in range(n) if i not in queued and arrival[i] <= upto + EPS),
                            key=lambda i: (arrival[i], i)):
                queue.append(i)
                queued.add(i)

        admit(time)
        while done < n:
            if not queue:
                nxt = min(arrival[i] for i in range(n) if i not in queued)
                add(-1, time, nxt, "没有已到达的进程，CPU 空闲", [])
                time = _clean(nxt)
                admit(time)
                continue
            pick = queue.popleft()
            ready = list(queue)
            run = min(quantum, remaining[pick])
            start = time
            time = _clean(time + run)
            remaining[pick] = _clean(remaining[pick] - run)
            admit(time)
            finished = remaining[pick] <= EPS
            if finished:
                remaining[pick] = 0.0
                finish[pick] = time
                done += 1
            else:
                queue.append(pick)
            reason = f"队首进程，时间片 q={_fmt(quantum)}，" + ("运行完毕" if finished else "时间片用完，排到队尾")
            add(pick, start, time, reason, ready)

    rows = []
    for i in range(n):
        turnaround = _clean(finish[i] - arrival[i])  # type: ignore[operator]
        waiting = _clean(turnaround - burst[i])
        rows.append({"id": processes[i]["id"], "arrival": arrival[i], "burst": burst[i], "priority": priority[i],
                     "finish": finish[i], "turnaround": turnaround, "waiting": waiting,
                     "response": _clean(first[i] - arrival[i]),  # type: ignore[operator]
                     "weighted": _clean(turnaround / burst[i])})
    switches = sum(1 for a, b in zip(segments, segments[1:])
                   if a["index"] >= 0 and b["index"] >= 0 and a["index"] != b["index"])
    return {"segments": segments, "rows": rows, "first": first, "finish": finish,
            "avg_waiting": _clean(sum(r["waiting"] for r in rows) / n),
            "avg_turnaround": _clean(sum(r["turnaround"] for r in rows) / n),
            "avg_weighted": _clean(sum(r["weighted"] for r in rows) / n),
            "start": _clean(min(arrival)), "makespan": _clean(max(finish)),  # type: ignore[type-var]
            "switches": switches}


def _eval_schedule(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    kind, engine = "cpu_schedule", "os_sched_v1"
    processes = _coerce_processes(model.get("processes")) or []
    defaults = model.get("defaults") or {}
    algorithm = str(params.get("algorithm") or defaults.get("algorithm") or "fcfs")
    try:
        quantum = float(params.get("quantum", defaults.get("quantum", 2.0)))
    except (TypeError, ValueError):
        quantum = 2.0
    has_priority = bool(model.get("has_priority"))
    if not processes:
        return _blocked(kind, engine, "没有可调度的进程，请先补全进程表。")
    if len(processes) > MAX_PROCESSES:
        return _blocked(kind, engine, f"首版仅支持 {MAX_PROCESSES} 个以内的进程。")
    if len({p["id"] for p in processes}) != len(processes):
        return _blocked(kind, engine, "进程名称有重复，请先核对进程表。")
    if any(p["burst"] <= 0 or p["arrival"] < 0 for p in processes):
        return _blocked(kind, engine, "到达时间不能为负，服务时间必须大于 0。")
    if algorithm not in SCHED_LABELS:
        return _blocked(kind, engine, "未知的调度算法。")
    if algorithm == "priority" and not has_priority:
        return _blocked(kind, engine, "优先级调度需要每个进程都有优先级，请在进程表中补充第 4 列。")
    if quantum <= 0:
        return _blocked(kind, engine, "时间片必须大于 0。")

    sim = _simulate_schedule(processes, algorithm, quantum)
    names = [p["id"] for p in processes]
    n = len(processes)
    segments = sim["segments"]
    rows_final = sim["rows"]
    frames: list[dict[str, Any]] = []

    def table(time: float, running: int | None, segment_remaining: Sequence[float]) -> list[dict[str, Any]]:
        rows = []
        for i in range(n):
            finished = sim["finish"][i] is not None and sim["finish"][i] <= time + EPS and segment_remaining[i] <= EPS
            if finished:
                state = "done"
            elif processes[i]["arrival"] > time + EPS:
                state = "pending"
            elif running == i:
                state = "running"
            else:
                state = "ready"
            rows.append({"id": names[i], "arrival": processes[i]["arrival"], "burst": processes[i]["burst"],
                         "priority": processes[i].get("priority"), "remaining": segment_remaining[i], "state": state,
                         "finish": sim["finish"][i] if finished else None,
                         "turnaround": rows_final[i]["turnaround"] if finished else None,
                         "waiting": rows_final[i]["waiting"] if finished else None})
        return rows

    def gantt(upto: int) -> list[dict[str, Any]]:
        return [{"id": names[s["index"]] if s["index"] >= 0 else None, "start": s["start"], "end": s["end"]}
                for s in segments[:upto]]

    initial_ready = [names[i] for i in range(n) if processes[i]["arrival"] <= sim["start"] + EPS]
    _frame(frames, "initial", f"写出进程表（{SCHED_LABELS[algorithm]}）",
           f"从最早到达的时刻 t={_fmt(sim['start'])} 开始；每一段甘特图都记录选择的理由。", 1,
           time=sim["start"], gantt=[], ready=initial_ready, running=None,
           rows=table(sim["start"], None, [p["burst"] for p in processes]),
           finished=[], algorithm=algorithm)
    for number, seg in enumerate(segments, 1):
        done_now = [names[i] for i in range(n) if sim["finish"][i] is not None
                    and sim["finish"][i] <= seg["end"] + EPS and seg["remaining"][i] <= EPS]
        if seg["index"] < 0:
            label = f"t={_fmt(seg['start'])}–{_fmt(seg['end'])} · CPU 空闲"
            detail = seg["reason"] + "。"
            running = None
        else:
            name = names[seg["index"]]
            label = f"t={_fmt(seg['start'])}–{_fmt(seg['end'])} · {name} 运行 {_fmt(seg['end'] - seg['start'])}"
            detail = f"{name}：{seg['reason']}。"
            running = seg["index"]
            if seg["remaining"][seg["index"]] <= EPS:
                row = rows_final[seg["index"]]
                detail += (f"{name} 在 t={_fmt(row['finish'])} 完成，周转 {_fmt(row['turnaround'])}，"
                           f"等待 {_fmt(row['waiting'])}。")
            else:
                detail += f"{name} 还剩 {_fmt(seg['remaining'][seg['index']])}。"
        _frame(frames, "idle" if seg["index"] < 0 else "run", label, detail, 3 if seg["index"] >= 0 else 2,
               time=seg["end"], gantt=gantt(number), ready=[names[i] for i in seg["ready"]],
               running=names[running] if running is not None else None,
               rows=table(seg["end"], running, seg["remaining"]), finished=done_now, algorithm=algorithm,
               segment=number - 1)
    answer = (f"平均等待时间 = {_fmt(sim['avg_waiting'])}，平均周转时间 = {_fmt(sim['avg_turnaround'])}，"
              f"平均带权周转时间 = {_fmt(sim['avg_weighted'])}")
    _frame(frames, "result", "结果", answer, 5, time=sim["makespan"], gantt=gantt(len(segments)), ready=[],
           running=None, rows=table(sim["makespan"], None, [0.0] * n), finished=list(names), algorithm=algorithm)

    compare: dict[str, float] = {}
    for other in SCHED_LABELS:
        if other == "priority" and not has_priority:
            continue
        compare[other] = _simulate_schedule(processes, other, quantum)["avg_waiting"]
    busy = sum(s["end"] - s["start"] for s in segments if s["index"] >= 0)
    total_burst = sum(p["burst"] for p in processes)
    checks = [
        {"id": "conservation", "label": "CPU 服务时间守恒", "status": "pass" if abs(busy - total_burst) < 1e-6 else "fail",
         "detail": f"甘特图中运行总时长 {_fmt(busy)} 应等于各进程服务时间之和 {_fmt(total_burst)}。"},
        {"id": "nonneg", "label": "等待时间非负", "status": "pass" if all(r["waiting"] >= -EPS for r in rows_final) else "fail",
         "detail": "等待时间 = 周转 − 服务，任何进程都不可能为负。"},
    ]
    metrics = [
        {"id": "algorithm", "label": "算法", "value": SCHED_LABELS[algorithm]},
        {"id": "avg_waiting", "label": "平均等待", "value": _fmt(sim["avg_waiting"])},
        {"id": "avg_turnaround", "label": "平均周转", "value": _fmt(sim["avg_turnaround"])},
        {"id": "avg_weighted", "label": "平均带权周转", "value": _fmt(sim["avg_weighted"])},
        {"id": "makespan", "label": "完成时刻", "value": _fmt(sim["makespan"])},
    ]
    stats = {"processes": rows_final, "avg_waiting": sim["avg_waiting"], "avg_turnaround": sim["avg_turnaround"],
             "avg_weighted": sim["avg_weighted"], "makespan": sim["makespan"], "switches": sim["switches"],
             "gantt": gantt(len(segments)), "compare": compare, "quantum": quantum}
    return {
        "subject": "operating_system", "engine": engine, "os_kind": kind, "status": "ok", "algorithm": algorithm,
        "frames": frames, "trace": frames, "pseudocode": SCHED_PSEUDOCODE, "answer": answer,
        "answer_value": sim["avg_waiting"], "answer_order": None,
        "headline": f"{SCHED_LABELS[algorithm]}：平均等待 {_fmt(sim['avg_waiting'])}，平均周转 {_fmt(sim['avg_turnaround'])}",
        "metrics": metrics, "checks": checks, "stats": stats, "stop_reason": "done",
        "notes": ["同一时刻到达的进程按输入顺序入队；RR 中新到达的进程排在被抢占进程之前。",
                  "相同条件下优先比较：SJF 看服务时间，SRTF 看剩余时间（并列时不抢占），再依次看到达时间与输入顺序。",
                  "切换上方“调度算法”可用同一组进程对照各算法。"],
    }


# ---------------------------------------------------------------------------
# 页面置换
# ---------------------------------------------------------------------------

_REFERENCE_LABEL = (r"访问序列|引用序列|引用串|页面走向|页面号?序列|页面访问串|访问顺序|页号序列|页面请求序列|"
                    r"reference\s*string|reference\s*sequence|page\s*reference|走向")
_FRAME_STOP = r"物理块|页框|页帧|内存块|块数|分配|frames?|驻留集"
_REFERENCE_STOP = r"其中|初始|已(?:经)?调入|调入内存|已在内存|驻留"


def _coerce_reference(value: Any) -> list[str] | None:
    if isinstance(value, (list, tuple)) and value:
        return [str(item).strip() for item in value if str(item).strip() != ""] or None
    if isinstance(value, str):
        tokens = re.findall(r"\d+|(?<![A-Za-z])[A-Za-z](?![A-Za-z])", value)
        if len(tokens) == 1 and tokens[0].isdigit() and len(tokens[0]) >= 6:
            tokens = list(tokens[0])
        return tokens or None
    return None


def _reference_from_text(text: str) -> list[str] | None:
    match = re.search(rf"(?:{_REFERENCE_LABEL})", text, re.I)
    if not match:
        return None
    chunk = text[match.end():]
    stop = re.search(rf"{_FRAME_STOP}|{_REFERENCE_STOP}|[。\n]", chunk, re.I)
    chunk = chunk[:stop.start()] if stop else chunk
    tokens = _coerce_reference(chunk)
    return tokens if tokens and len(tokens) >= 3 else None


def _initial_frames_from_text(text: str) -> list[str]:
    """“其中 0,1,2 已调入内存”等初始驻留描述，按出现顺序记录。"""
    patterns = (
        r"其中\s*((?:\d+\s*[,，、/;；\s]*)+?)\s*(?:号?页?)?\s*(?:已|已经)?\s*(?:调入|装入|驻留|在内存)",
        r"(?:初始(?:时|状态)?|开始时|一开始|此时)[^\d。\n]{0,10}((?:\d+\s*[,，、/;；\s]*)+?)\s*(?:号?页?)?\s*(?:已|已经)?\s*(?:调入|装入|驻留|在内存)",
        r"(?:内存中|驻留集|页框内)[^\d。\n]{0,6}((?:\d+\s*[,，、/;；\s]*)+)",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            values = re.findall(r"\d+", match.group(1))
            if values:
                return values
    return []


def _frames_from_text(text: str) -> int | None:
    patterns = (
        r"(?:物理块数?|页框数?|页帧数?|内存块数?|块数|frames?)\s*(?:为|是|=|:|：|有|共)?\s*(\d+)",
        r"分配\s*(?:给[^\d]{0,8})?(\d+)\s*个?\s*(?:物理块|页框|内存块|块|页帧)",
        r"(\d+)\s*个\s*(?:物理块|页框|内存块|页帧)",
        r"(\d+)\s*(?:frames?|page\s*frames?)",
    )
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return int(match.group(1))
    return None


def _detect_page_algorithm(text: str) -> str | None:
    return _earliest(text, {
        "opt": r"最佳置换|最优置换|optimal|" + _word("opt"),
        "lru": r"最近最久|最久未使用|" + _word("lru"),
        "fifo": r"先进先出|" + _word("fifo"),
    })


def _build_page(text: str, source: Mapping[str, Any], merged: Mapping[str, Any]) -> dict[str, Any]:
    ambiguities: list[dict[str, Any]] = []
    reference = _coerce_reference(merged.get("reference")) or _reference_from_text(text)
    initial_value = merged.get("initial_frames")
    initial_frames = (_coerce_reference(initial_value) if initial_value is not None else _initial_frames_from_text(text)) or []
    frames_value = merged.get("frames")
    try:
        frames_count = int(float(frames_value)) if frames_value is not None and str(frames_value).strip() != "" else None
    except (TypeError, ValueError):
        frames_count = None
    frames_found = frames_count is not None or _frames_from_text(text) is not None
    if frames_count is None:
        frames_count = _frames_from_text(text)
    algorithm = str(merged.get("algorithm") or "").strip() or _detect_page_algorithm(text)
    if algorithm not in PAGE_LABELS:
        algorithm = "fifo"

    if not reference:
        ambiguities.append(_ambiguity(
            "reference", "reference",
            "没有识别到页面访问序列。请写成 “7,0,1,2,0,3,0,4” 这样用逗号或空格分隔的页号。"))
    elif len(reference) > MAX_REFERENCE:
        ambiguities.append(_ambiguity("reference_size", "reference",
                                      f"访问序列超过 {MAX_REFERENCE} 次；为保证逐步轨迹可读，首版仅支持 {MAX_REFERENCE} 次以内。"))
    if frames_count is None:
        frames_count = 3
    if not 1 <= frames_count <= MAX_FRAMES:
        ambiguities.append(_ambiguity("frames", "frames", f"物理块数需在 1–{MAX_FRAMES} 之间。"))
        frames_count = min(max(frames_count, 1), MAX_FRAMES)
    if len(initial_frames) > frames_count:
        ambiguities.append(_ambiguity(
            "initial_frames", "initial_frames",
            f"初始已调入 {len(initial_frames)} 个页面，超过物理块数 {frames_count}，请核对原题。"))
    if len(set(initial_frames)) != len(initial_frames):
        ambiguities.append(_ambiguity(
            "initial_frames", "initial_frames", "初始已调入的页面有重复，请核对原题。"))

    params = [
        _param("algorithm", "置换算法", "enum", options=["fifo", "lru", "opt"], note="同一访问序列可对照三种算法的缺页次数。"),
        _param("frames", "物理块数", "integer", min_value=1, max_value=MAX_FRAMES, step=1,
               note="FIFO 增加物理块数时可能缺页更多（Belady 异常）。"),
    ]
    model = {
        "engine": "os_page_v1", "subject": "operating_system", "os_kind": "page_replace",
        "reference": reference or [], "initial_frames": initial_frames,
        "defaults": {"algorithm": algorithm, "frames": frames_count},
        "params": params, "teaching": False,
    }
    conditions = []
    if reference:
        conditions.append(_condition("reference", "页面访问序列", ",".join(reference), source=source,
                                     note="用逗号或空格分隔；修正后重新求解。"))
    if initial_frames:
        conditions.append(_condition("initial_frames", "初始已调入页面", ",".join(initial_frames), source=source,
                                     provenance="user_confirmed" if merged.get("initial_frames") is not None else "original",
                                     note="按从早到晚的顺序列出；修正后重新求解。"))
    conditions.append(_condition("frames", "物理块数", frames_count, kind="number", source=source,
                                 provenance="original" if frames_found else "supplement",
                                 note=None if frames_found else "题目未给出物理块数，默认 3，可在条件中修正。"))
    formulas = [{"id": "fault_rate", "tex": r"\text{缺页率}=\dfrac{\text{缺页次数}}{\text{访问次数}}",
                 "plain": "缺页率 = 缺页次数 / 页面访问次数；命中次数 = 访问次数 − 缺页次数。", "role": "评价指标"}]
    return {"model": model, "conditions": conditions, "ambiguities": ambiguities, "formulas": formulas,
            "recognized": not ambiguities}


def _simulate_pages(reference: Sequence[str], frames_count: int, algorithm: str,
                    initial_frames: Sequence[str] = ()) -> list[dict[str, Any]]:
    initial = list(initial_frames)[:frames_count]
    slots: list[str | None] = list(initial) + [None] * (frames_count - len(initial))
    # 初始驻留页面视为在任何访问之前装入：越靠前装入越早。
    loaded: list[int] = [offset - len(initial) for offset in range(len(initial))] + [-1] * (frames_count - len(initial))
    used: list[int] = [offset - len(initial) for offset in range(len(initial))] + [-1] * (frames_count - len(initial))
    steps: list[dict[str, Any]] = []
    faults = 0
    for index, page in enumerate(reference):
        evicted = None
        if page in slots:
            slot = slots.index(page)
            used[slot] = index
            hit = True
        else:
            hit = False
            faults += 1
            if None in slots:
                slot = slots.index(None)
            else:
                if algorithm == "fifo":
                    slot = min(range(frames_count), key=lambda s: loaded[s])
                elif algorithm == "lru":
                    slot = min(range(frames_count), key=lambda s: used[s])
                else:
                    def next_use(s: int) -> float:
                        for later in range(index + 1, len(reference)):
                            if reference[later] == slots[s]:
                                return later
                        return math.inf
                    slot = max(range(frames_count), key=lambda s: (next_use(s), -loaded[s]))
                evicted = slots[slot]
            slots[slot] = page
            loaded[slot] = index
            used[slot] = index
        resident = [(s, slots[s]) for s in range(frames_count) if slots[s] is not None]
        if algorithm == "fifo":
            aux_title = "FIFO 队列（队首最早装入）"
            aux = [p for _, p in sorted(resident, key=lambda item: loaded[item[0]])]
        elif algorithm == "lru":
            aux_title = "LRU 栈（左为最近使用）"
            aux = [p for _, p in sorted(resident, key=lambda item: -used[item[0]])]
        else:
            aux_title = "下次访问位置（∞ 表示不再访问）"
            aux = []
            for s, p in resident:
                later = next((k for k in range(index + 1, len(reference)) if reference[k] == p), None)
                aux.append(f"{p}:{later + 1 if later is not None else '∞'}")
        steps.append({"index": index, "page": page, "hit": hit, "frames": list(slots), "slot": slot,
                      "evicted": evicted, "faults": faults, "aux_title": aux_title, "aux": aux})
    return steps


def _eval_page(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    kind, engine = "page_replace", "os_page_v1"
    reference = _coerce_reference(model.get("reference")) or []
    initial_frames = _coerce_reference(model.get("initial_frames")) or []
    defaults = model.get("defaults") or {}
    algorithm = str(params.get("algorithm") or defaults.get("algorithm") or "fifo")
    try:
        frames_count = int(float(params.get("frames", defaults.get("frames", 3))))
    except (TypeError, ValueError):
        frames_count = 3
    if not reference:
        return _blocked(kind, engine, "没有页面访问序列，请先补全题目数据。")
    if len(reference) > MAX_REFERENCE:
        return _blocked(kind, engine, f"访问序列超过 {MAX_REFERENCE} 次；首版逐步演示只支持较短的序列。")
    if not 1 <= frames_count <= MAX_FRAMES:
        return _blocked(kind, engine, f"物理块数需在 1–{MAX_FRAMES} 之间。")
    if len(initial_frames) > frames_count:
        return _blocked(kind, engine, f"初始已调入 {len(initial_frames)} 个页面，超过物理块数 {frames_count}，请核对原题。")
    if len(set(initial_frames)) != len(initial_frames):
        return _blocked(kind, engine, "初始已调入的页面有重复，请核对原题。")
    if algorithm not in PAGE_LABELS:
        return _blocked(kind, engine, "未知的置换算法。")

    steps = _simulate_pages(reference, frames_count, algorithm, initial_frames)
    total = len(reference)
    faults = steps[-1]["faults"]
    frames: list[dict[str, Any]] = []
    start_frames = list(initial_frames) + [None] * (frames_count - len(initial_frames))
    start_label = (f"{PAGE_LABELS[algorithm]}：{frames_count} 个物理块，初始已装入 {', '.join(initial_frames)}"
                   if initial_frames else f"{PAGE_LABELS[algorithm]}：{frames_count} 个物理块，初始全空")
    _frame(frames, "initial", start_label,
           "初始驻留页面不产生缺页；每次访问先查物理块，不在其中才产生一次缺页。" if initial_frames
           else "每次访问先查物理块；不在其中就产生一次缺页。", 1,
           reference=list(reference), cursor=-1, frames=start_frames, hit=None, slot=None, evicted=None,
           faults=0, hits=0, aux_title="", aux=[], algorithm=algorithm, initial_frames=list(initial_frames))
    for step in steps:
        hits = step["index"] + 1 - step["faults"]
        if step["hit"]:
            label = f"访问 {step['page']}：命中"
            detail = f"页面 {step['page']} 已在物理块中，不产生缺页。"
            action, line = "hit", 2
        elif step["evicted"] is None:
            label = f"访问 {step['page']}：缺页，装入空闲块"
            detail = f"页面 {step['page']} 不在内存，仍有空闲物理块，直接装入块 {step['slot'] + 1}。"
            action, line = "fault", 3
        else:
            reason = {"fifo": "最早装入的页面",
                      "lru": "最近最久没有被使用的页面",
                      "opt": "未来最晚才会再次访问（或不再访问）的页面"}[algorithm]
            label = f"访问 {step['page']}：缺页，置换 {step['evicted']}"
            detail = f"物理块已满，按 {algorithm.upper()} 选择{reason} {step['evicted']} 换出，页面 {step['page']} 装入块 {step['slot'] + 1}。"
            action, line = "replace", 4
        _frame(frames, action, label, detail, line, reference=list(reference), cursor=step["index"],
               frames=step["frames"], hit=step["hit"], slot=step["slot"], evicted=step["evicted"],
               faults=step["faults"], hits=hits, aux_title=step["aux_title"], aux=step["aux"], algorithm=algorithm)
    rate = faults / total
    answer = f"缺页 {faults} 次，命中 {total - faults} 次，缺页率 {rate * 100:.1f}%"
    _frame(frames, "result", "结果", answer, 5, reference=list(reference), cursor=total - 1, frames=steps[-1]["frames"],
           hit=None, slot=None, evicted=None, faults=faults, hits=total - faults, aux_title="", aux=[], algorithm=algorithm)

    compare = {name: _simulate_pages(reference, frames_count, name, initial_frames)[-1]["faults"] for name in PAGE_LABELS}
    series = [{"frames": count, "faults": _simulate_pages(reference, count, algorithm, initial_frames)[-1]["faults"]}
              for count in range(max(1, len(initial_frames)), MAX_FRAMES + 1)]
    checks = [{"id": "accounting", "label": "命中 + 缺页 = 访问次数", "status": "pass",
               "detail": f"{total - faults} + {faults} = {total}。"}]
    if compare["opt"] <= min(compare["fifo"], compare["lru"]):
        checks.append({"id": "opt_bound", "label": "OPT 为缺页下界", "status": "pass",
                       "detail": f"OPT {compare['opt']} 次不超过 FIFO {compare['fifo']} 次与 LRU {compare['lru']} 次。"})
    else:
        checks.append({"id": "opt_bound", "label": "OPT 为缺页下界", "status": "fail",
                       "detail": "OPT 的缺页次数不应高于其他算法，请核对序列。"})
    if algorithm == "fifo":
        bigger = next((item for item in series if item["frames"] == frames_count + 1), None)
        if bigger and bigger["faults"] > faults:
            checks.append({"id": "belady", "label": "Belady 异常", "status": "warn",
                           "detail": f"物理块从 {frames_count} 增加到 {frames_count + 1}，FIFO 缺页反而从 {faults} 增加到 {bigger['faults']} 次。"})
        else:
            checks.append({"id": "belady", "label": "Belady 异常", "status": "pass",
                           "detail": "增加一个物理块后缺页次数没有增加；FIFO 不是栈式算法，仍可能在其他序列上出现异常。"})
    else:
        checks.append({"id": "belady", "label": "Belady 异常", "status": "pass",
                       "detail": "LRU 与 OPT 是栈式算法，增加物理块不会让缺页变多。"})
    metrics = [
        {"id": "algorithm", "label": "算法", "value": PAGE_LABELS[algorithm]},
        {"id": "faults", "label": "缺页次数", "value": str(faults)},
        {"id": "hits", "label": "命中次数", "value": str(total - faults)},
        {"id": "rate", "label": "缺页率", "value": f"{rate * 100:.1f}%"},
    ]
    return {
        "subject": "operating_system", "engine": engine, "os_kind": kind, "status": "ok", "algorithm": algorithm,
        "frames": frames, "trace": frames, "pseudocode": PAGE_PSEUDOCODE, "answer": answer,
        "answer_value": float(faults), "answer_order": None,
        "headline": f"{PAGE_LABELS[algorithm]}（{frames_count} 块）：缺页 {faults} 次 / 访问 {total} 次",
        "metrics": metrics, "checks": checks,
        "stats": {"faults": faults, "hits": total - faults, "total": total, "rate": rate, "frames_count": frames_count,
                  "initial_frames": list(initial_frames), "compare": compare, "series": series},
        "stop_reason": "done",
        "notes": ["物理块按固定位置显示：被置换页面所在的块直接装入新页面。",
                  "OPT 并列时（多个页面都不再访问）置换最早装入的页面；LRU 命中会刷新最近使用时间，FIFO 命中不改变队列。",
                  "初始驻留页面按给定顺序视为从早到晚装入；对初态页面的访问按命中处理，不计缺页。" if initial_frames
                  else "访问序列开始前物理块全空，第一次访问每个页面都会缺页。"],
    }


# ---------------------------------------------------------------------------
# 磁盘调度
# ---------------------------------------------------------------------------


def _coerce_requests(value: Any) -> list[float] | None:
    if isinstance(value, (list, tuple)) and value:
        try:
            return [float(item) for item in value]
        except (TypeError, ValueError):
            return None
    if isinstance(value, str):
        numbers = _numbers(value)
        return numbers or None
    return None


def _detect_disk_algorithm(text: str) -> str | None:
    return _earliest(text, {
        "clook": r"c[\s_-]?look|循环look",
        "cscan": r"c[\s_-]?scan|循环扫描|单向扫描",
        "look": _word("look"),
        "scan": r"scan|电梯|扫描",
        "sstf": r"sstf|最短寻道|最短查找",
        "fcfs": r"先来先服务|fcfs",
    })


def _build_disk(text: str, source: Mapping[str, Any], merged: Mapping[str, Any]) -> dict[str, Any]:
    ambiguities: list[dict[str, Any]] = []
    requests = _coerce_requests(merged.get("requests"))
    if not requests:
        match = re.search(r"请求队列|磁道请求|访问请求|请求序列|访问序列|磁盘请求|请求的磁道|磁道号序列|queue", text, re.I)
        if match:
            chunk = text[match.end():]
            stop = re.search(r"磁头|当前|初始|head|位于|移动方向|方向|起始|[。\n]", chunk, re.I)
            chunk = chunk[:stop.start()] if stop else chunk
            requests = _numbers(chunk) or None
    head = merged.get("head")
    try:
        head = float(head) if head is not None and str(head).strip() != "" else None
    except (TypeError, ValueError):
        head = None
    head_found = head is not None
    if head is None:
        for pattern in (r"磁头[^\d]{0,12}(\d+)", r"(?:从|起始于|当前在|位于)\s*(\d+)\s*号?\s*(?:磁道|柱面)", r"head[^\d]{0,12}(\d+)"):
            match = re.search(pattern, text, re.I)
            if match:
                head, head_found = float(match.group(1)), True
                break

    max_value = merged.get("max_track")
    try:
        max_track = float(max_value) if max_value is not None and str(max_value).strip() != "" else None
    except (TypeError, ValueError):
        max_track = None
    max_found = max_track is not None
    if max_track is None:
        match = re.search(r"(\d+)\s*个\s*(?:磁道|柱面)|(?:磁道|柱面)(?:号)?(?:范围)?\s*(?:为|是|:|：)?\s*0\s*[~～\-–—到至]\s*(\d+)"
                          r"|0\s*[~～\-–—到至]\s*(\d+)\s*(?:号)?\s*(?:磁道|柱面)", text)
        if match:
            if match.group(1):
                max_track = float(int(match.group(1)) - 1)
            else:
                max_track = float(next(group for group in match.groups()[1:] if group))
            max_found = True
    if max_track is None:
        max_track = 199.0

    direction = str(merged.get("direction") or "").strip()
    direction_found = direction in ("up", "down")
    if not direction_found:
        if re.search(r"(?:磁道号|柱面号)?(?:增加|增大|递增|由小到大|从小到大)", text) and not re.search(r"(?:减小|减少|递减|由大到小|从大到小)", text):
            direction, direction_found = "up", True
        elif re.search(r"(?:减小|减少|递减|由大到小|从大到小)", text):
            direction, direction_found = "down", True
        else:
            direction = "up"
    algorithm = str(merged.get("algorithm") or "").strip() or _detect_disk_algorithm(text)
    if algorithm not in DISK_LABELS:
        algorithm = "fcfs"

    if not requests:
        ambiguities.append(_ambiguity(
            "requests", "requests", "没有识别到磁道请求序列。请写成 “98, 183, 37, 122, 14, 124, 65, 67” 这样的磁道号。"))
    elif len(requests) > MAX_REQUESTS:
        ambiguities.append(_ambiguity("request_count", "requests", f"请求超过 {MAX_REQUESTS} 个；首版仅支持 {MAX_REQUESTS} 个以内。"))
    if head is None:
        ambiguities.append(_ambiguity("head", "head", "没有识别到磁头的起始位置。请写成 “磁头当前位于 53 号磁道”。"))
    elif requests and (min(requests) < 0 or max(requests + [head]) > max_track):
        ambiguities.append(_ambiguity(
            "max_track", "max_track", f"有磁道号超出了范围 0–{_fmt(max_track)}。请补充磁盘的最大磁道号或修正请求。"))
    if requests and any(not _int_like(value) for value in requests):
        ambiguities.append(_ambiguity("requests", "requests", "磁道号应为整数。"))

    params = [
        _param("algorithm", "磁盘调度算法", "enum", options=list(DISK_LABELS), note="同一请求序列可对照各算法的总移动距离。"),
        _param("direction", "初始移动方向", "enum", options=["up", "down"], note="仅 SCAN / C-SCAN / LOOK / C-LOOK 使用。"),
        _param("return_cost", "回扫距离", "enum", options=["count", "skip"],
               note="C-SCAN / C-LOOK 从一端跳到另一端：教材有的计入总移动，有的不计。"),
    ]
    model = {
        "engine": "os_disk_v1", "subject": "operating_system", "os_kind": "disk_schedule",
        "requests": requests or [], "head": head, "max_track": max_track,
        "defaults": {"algorithm": algorithm, "direction": direction, "return_cost": "count"},
        "params": params, "teaching": False,
    }
    conditions = []
    if requests:
        conditions.append(_condition("requests", "磁道请求序列", ", ".join(_fmt(v) for v in requests), source=source,
                                     note="按到达顺序写出磁道号；修正后重新求解。"))
    if head is not None:
        conditions.append(_condition("head", "磁头起始位置", head, kind="number", source=source,
                                     provenance="original" if head_found else "supplement"))
    conditions.append(_condition(
        "max_track", "最大磁道号", max_track, kind="number", source=source,
        provenance="original" if max_found else "supplement",
        note=None if max_found else "题目未给出磁盘范围，SCAN/C-SCAN 默认走到 199，可在条件中修正。"))
    if not direction_found:
        conditions.append(_condition("direction_note", "初始方向", "磁道号增大方向", source=source, provenance="supplement",
                                     editable=False, note="题目未说明方向，默认向磁道号增大方向，可在控制条切换。"))
    formulas = [{"id": "seek", "tex": r"\text{总移动}=\sum_i |p_i-p_{i-1}|",
                 "plain": "总移动距离 = 磁头相邻两次位置之差的绝对值之和；平均寻道长度 = 总移动 / 请求数。", "role": "评价指标"}]
    return {"model": model, "conditions": conditions, "ambiguities": ambiguities, "formulas": formulas,
            "recognized": not ambiguities}


def _scan_legs(requests: Sequence[float], head: float, max_track: float, algorithm: str) -> list[dict[str, Any]]:
    """向上方向的 SCAN 类轨迹；向下方向由调用者镜像。"""

    upper = sorted(r for r in requests if r >= head)
    lower = sorted(r for r in requests if r < head)
    legs: list[dict[str, Any]] = [{"kind": "request", "pos": r, "serve": True} for r in upper]
    position = upper[-1] if upper else head
    if algorithm == "scan":
        if position < max_track:
            legs.append({"kind": "edge", "pos": max_track, "serve": False})
        legs += [{"kind": "request", "pos": r, "serve": True} for r in reversed(lower)]
    elif algorithm == "look":
        legs += [{"kind": "request", "pos": r, "serve": True} for r in reversed(lower)]
    elif algorithm == "cscan":
        if position < max_track:
            legs.append({"kind": "edge", "pos": max_track, "serve": False})
        if lower:
            legs.append({"kind": "jump", "pos": 0.0, "serve": False})
            legs += [{"kind": "request", "pos": r, "serve": True} for r in lower]
    else:
        if lower:
            legs.append({"kind": "jump", "pos": lower[0], "serve": True})
            legs += [{"kind": "request", "pos": r, "serve": True} for r in lower[1:]]
    return legs


def _disk_plan(requests: Sequence[float], head: float, max_track: float, algorithm: str,
               direction: str) -> list[dict[str, Any]]:
    if algorithm == "fcfs":
        return [{"kind": "request", "pos": r, "serve": True} for r in requests]
    if algorithm == "sstf":
        pending = list(enumerate(requests))
        position, legs = head, []
        while pending:
            choice = min(pending, key=lambda item: (abs(item[1] - position), item[0]))
            pending.remove(choice)
            legs.append({"kind": "request", "pos": choice[1], "serve": True})
            position = choice[1]
        return legs
    if direction == "down":
        mirrored = _scan_legs([max_track - r for r in requests], max_track - head, max_track, algorithm)
        return [{**leg, "pos": max_track - leg["pos"]} for leg in mirrored]
    return _scan_legs(requests, head, max_track, algorithm)


def _simulate_disk(requests: Sequence[float], head: float, max_track: float, algorithm: str, direction: str,
                   return_cost: str) -> dict[str, Any]:
    legs = _disk_plan(requests, head, max_track, algorithm, direction)
    position, total = head, 0.0
    moves = []
    for leg in legs:
        distance = abs(leg["pos"] - position)
        counted = 0.0 if leg["kind"] == "jump" and return_cost == "skip" else distance
        total += counted
        moves.append({**leg, "from": position, "distance": counted, "raw": distance, "total": total})
        position = leg["pos"]
    return {"moves": moves, "total": total, "served": [m["pos"] for m in moves if m["serve"]]}


def _eval_disk(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    kind, engine = "disk_schedule", "os_disk_v1"
    requests = _coerce_requests(model.get("requests")) or []
    defaults = model.get("defaults") or {}
    algorithm = str(params.get("algorithm") or defaults.get("algorithm") or "fcfs")
    direction = str(params.get("direction") or defaults.get("direction") or "up")
    return_cost = str(params.get("return_cost") or defaults.get("return_cost") or "count")
    try:
        head = float(model.get("head"))  # type: ignore[arg-type]
        max_track = float(model.get("max_track"))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return _blocked(kind, engine, "没有磁头起始位置或最大磁道号，请先补全题目数据。")
    if not requests:
        return _blocked(kind, engine, "没有磁道请求序列，请先补全题目数据。")
    if len(requests) > MAX_REQUESTS:
        return _blocked(kind, engine, f"请求超过 {MAX_REQUESTS} 个；首版逐步演示只支持较短的序列。")
    if min(requests) < 0 or max(requests + [head]) > max_track or head < 0:
        return _blocked(kind, engine, f"有磁道号超出范围 0–{_fmt(max_track)}，请核对请求序列、磁头位置或最大磁道号。")
    if algorithm not in DISK_LABELS:
        return _blocked(kind, engine, "未知的磁盘调度算法。")
    if direction not in ("up", "down"):
        direction = "up"

    sim = _simulate_disk(requests, head, max_track, algorithm, direction, return_cost)
    frames: list[dict[str, Any]] = []
    uses_direction = algorithm in ("scan", "cscan", "look", "clook")
    start_note = f"，初始向磁道号{'增大' if direction == 'up' else '减小'}方向" if uses_direction else ""
    _frame(frames, "initial", f"{DISK_LABELS[algorithm]}：磁头从 {_fmt(head)} 出发",
           f"共 {len(requests)} 个请求，磁道范围 0–{_fmt(max_track)}{start_note}。", 1,
           head=head, path=[head], served=[], remaining=list(requests), total=0.0, max_track=max_track,
           distance=0.0, from_pos=head, kind="start", algorithm=algorithm, direction=direction)
    pending = list(requests)
    path = [head]
    served: list[float] = []
    for move in sim["moves"]:
        path.append(move["pos"])
        if move["serve"]:
            served.append(move["pos"])
            pending.remove(move["pos"])
        if move["kind"] == "request":
            label = f"磁头 {_fmt(move['from'])} → {_fmt(move['pos'])}（移动 {_fmt(move['distance'])}）"
            detail = f"服务磁道 {_fmt(move['pos'])}，累计移动 {_fmt(move['total'])}。"
            action, line = "seek", 3
        elif move["kind"] == "edge":
            label = f"到达磁盘末端 {_fmt(move['pos'])}（移动 {_fmt(move['distance'])}）"
            detail = f"{algorithm.upper()} 必须走到磁盘末端再换向，累计移动 {_fmt(move['total'])}。"
            action, line = "edge", 4
        else:
            counted = "计入" if return_cost == "count" else "不计入"
            label = f"回扫 {_fmt(move['from'])} → {_fmt(move['pos'])}（{counted} {_fmt(move['raw'])}）"
            detail = (f"{algorithm.upper()} 不在回程服务请求，磁头直接跳到另一侧；回扫距离{counted}总移动，"
                      f"累计 {_fmt(move['total'])}。")
            action, line = "jump", 4
        _frame(frames, action, label, detail, line, head=move["pos"], path=list(path), served=list(served),
               remaining=list(pending), total=move["total"], max_track=max_track, distance=move["distance"],
               from_pos=move["from"], kind=move["kind"], algorithm=algorithm, direction=direction)
    total = sim["total"]
    average = total / len(requests)
    answer = f"总移动距离 = {_fmt(total)}，平均寻道长度 = {_fmt(average)}；服务顺序 {' → '.join(_fmt(v) for v in sim['served'])}"
    _frame(frames, "result", "结果", answer, 5, head=path[-1], path=list(path), served=list(served), remaining=[],
           total=total, max_track=max_track, distance=0.0, from_pos=path[-1], kind="result", algorithm=algorithm,
           direction=direction)

    compare = {name: _simulate_disk(requests, head, max_track, name, direction, return_cost)["total"] for name in DISK_LABELS}
    checks = [
        {"id": "coverage", "label": "每个请求恰好服务一次",
         "status": "pass" if sorted(sim["served"]) == sorted(requests) else "fail",
         "detail": f"服务了 {len(sim['served'])} 个磁道，请求共 {len(requests)} 个。"},
        {"id": "range", "label": "磁头不越界",
         "status": "pass" if all(0 <= p <= max_track for p in path) else "fail",
         "detail": f"磁头位置始终在 0–{_fmt(max_track)} 之间。"},
    ]
    metrics = [
        {"id": "algorithm", "label": "算法", "value": DISK_LABELS[algorithm]},
        {"id": "total", "label": "总移动距离", "value": _fmt(total)},
        {"id": "average", "label": "平均寻道长度", "value": _fmt(average)},
        {"id": "order", "label": "服务顺序", "value": " → ".join(_fmt(v) for v in sim["served"])},
    ]
    return {
        "subject": "operating_system", "engine": engine, "os_kind": kind, "status": "ok", "algorithm": algorithm,
        "frames": frames, "trace": frames, "pseudocode": DISK_PSEUDOCODE, "answer": answer,
        "answer_value": total, "answer_order": [_fmt(v) for v in sim["served"]],
        "headline": f"{DISK_LABELS[algorithm]}：总移动 {_fmt(total)}，平均 {_fmt(average)}",
        "metrics": metrics, "checks": checks,
        "stats": {"total": total, "average": average, "served": sim["served"], "path": path, "compare": compare,
                  "max_track": max_track, "head": head, "requests": list(requests)},
        "stop_reason": "done",
        "notes": ["SSTF 并列时选请求队列中更靠前的磁道；SCAN / C-SCAN 走到磁盘末端，LOOK / C-LOOK 只走到最远的请求。",
                  "C-SCAN / C-LOOK 的回扫是否计入总移动因教材而异，可在“回扫距离”中切换。"],
    }


# ---------------------------------------------------------------------------
# 银行家算法
# ---------------------------------------------------------------------------

_BANKER_LABELS = {
    "allocation": r"Allocation|已分配(?:资源)?|已占有|当前分配|分配矩阵",
    "max": r"Max|最大需求(?:矩阵)?|最大需求量",
    "need": r"Need|尚需|还需|需求矩阵|仍需",
    "available": r"Available|可用(?:资源)?|剩余资源|可利用",
}
_NESTED_MATRIX = r"(\[\s*\[[^\]]*\](?:\s*,\s*\[[^\]]*\])*\s*\])"


def _labelled_matrix(text: str, key: str) -> list[list[float]] | None:
    match = re.search(rf"(?:{_BANKER_LABELS[key]})\s*(?:矩阵)?\s*(?:=|:|：|为|是)?\s*{_NESTED_MATRIX}", text, re.I)
    return _coerce_matrix(match.group(1)) if match else None


def _labelled_vector(text: str, key: str) -> list[float] | None:
    match = re.search(rf"(?:{_BANKER_LABELS[key]})\s*(?:向量)?\s*(?:=|:|：|为|是)?\s*[\(\[（]?\s*(\d+(?:[\s,，]+\d+)*)\s*[\)\]）]?",
                      text, re.I)
    return [float(v) for v in re.findall(r"\d+", match.group(1))] if match else None


def _table_banker(text: str) -> dict[str, Any] | None:
    rows: list[tuple[str, list[float]]] = []
    for line in re.split(r"[\n]+", text):
        match = re.match(r"^\s*\|?\s*([Pp]\d+)\s*[|\s,，:：]+((?:\d+[|\s,，]*)+)$", line)
        if match:
            rows.append((match.group(1).upper(), _numbers(match.group(2))))
    if len(rows) < 2:
        return None
    lengths = [len(values) for _, values in rows]
    with_available = lengths[0] % 3 == 0 and all(length == lengths[0] * 2 // 3 for length in lengths[1:])
    if with_available:
        m = lengths[0] // 3
    elif len(set(lengths)) == 1 and lengths[0] % 2 == 0:
        m = lengths[0] // 2
    else:
        return None
    if m < 1:
        return None
    result = {"names": [name for name, _ in rows],
              "allocation": [values[:m] for _, values in rows],
              "max": [values[m:2 * m] for _, values in rows]}
    if with_available:
        result["available"] = rows[0][1][2 * m:3 * m]
    return result


def _coerce_request(value: Any) -> dict[str, Any] | None:
    if isinstance(value, Mapping) and value.get("process") and value.get("vector"):
        return {"process": str(value["process"]).upper(), "vector": [float(v) for v in value["vector"]]}
    if isinstance(value, str) and value.strip():
        match = re.search(r"([Pp]\d+)\s*[:：,，]?\s*(?:请求|request)?\s*[:：=]?\s*[\(\[（]?\s*(\d+(?:[\s,，]+\d+)*)\s*[\)\]）]?", value)
        if match:
            return {"process": match.group(1).upper(), "vector": [float(v) for v in re.findall(r"\d+", match.group(2))]}
    return None


def _request_from_text(text: str) -> dict[str, Any] | None:
    match = re.search(r"([Pp]\d+)\s*(?:发出|提出|发起)?\s*(?:了)?(?:资源)?请求\s*(?:资源)?\s*[:：=]?\s*[\(\[（]\s*(\d+(?:[\s,，]+\d+)*)\s*[\)\]）]", text)
    if match:
        return {"process": match.group(1).upper(), "vector": [float(v) for v in re.findall(r"\d+", match.group(2))]}
    match = re.search(r"(?:request)\s*\(?\s*([Pp]\d+)\s*[,，:：]\s*[\(\[（]\s*(\d+(?:[\s,，]+\d+)*)\s*[\)\]）]", text, re.I)
    if match:
        return {"process": match.group(1).upper(), "vector": [float(v) for v in re.findall(r"\d+", match.group(2))]}
    return None


def _matrix_text(matrix: Sequence[Sequence[float]]) -> str:
    return "[" + ",".join("[" + ",".join(_fmt(v) for v in row) + "]" for row in matrix) + "]"


def _build_banker(text: str, source: Mapping[str, Any], merged: Mapping[str, Any]) -> dict[str, Any]:
    ambiguities: list[dict[str, Any]] = []
    table = _table_banker(text)
    allocation = _coerce_matrix(merged.get("allocation")) or _labelled_matrix(text, "allocation") or (table or {}).get("allocation")
    maximum = _coerce_matrix(merged.get("max")) or _labelled_matrix(text, "max") or (table or {}).get("max")
    need_given = _labelled_matrix(text, "need") if maximum is None else None
    available = (_coerce_vector(merged.get("available")) or _labelled_vector(text, "available")
                 or (table or {}).get("available"))
    request = _coerce_request(merged.get("request")) or _request_from_text(text)

    if allocation is None:
        ambiguities.append(_ambiguity(
            "allocation", "allocation", "没有识别到已分配矩阵 Allocation。请写成 Allocation=[[0,1,0],[2,0,0]]（每行一个进程）。"))
    if maximum is None and need_given is None:
        ambiguities.append(_ambiguity(
            "max", "max", "没有识别到最大需求矩阵 Max（或尚需矩阵 Need）。请写成 Max=[[7,5,3],[3,2,2]]。"))
    if available is None:
        ambiguities.append(_ambiguity("available", "available", "没有识别到可用资源向量 Available。请写成 Available=[3,3,2]。"))

    n = len(allocation) if allocation else 0
    m = len(allocation[0]) if allocation else 0
    need = None
    if allocation is not None and (maximum is not None or need_given is not None):
        source_matrix = maximum if maximum is not None else need_given
        assert source_matrix is not None
        if len(source_matrix) != n or any(len(row) != m for row in source_matrix):
            ambiguities.append(_ambiguity("matrix_shape", "max", "Allocation 与 Max（或 Need）的行列数必须一致。"))
        elif maximum is not None:
            need = [[maximum[i][j] - allocation[i][j] for j in range(m)] for i in range(n)]
            if any(value < 0 for row in need for value in row):
                ambiguities.append(_ambiguity("need_negative", "max", "存在 Max 小于 Allocation 的项，请核对两个矩阵。"))
        else:
            need = [list(row) for row in need_given]  # type: ignore[union-attr]
    if available is not None and allocation is not None and len(available) != m:
        ambiguities.append(_ambiguity("available_shape", "available", f"Available 应有 {m} 个分量，与资源类型数一致。"))
    if allocation is not None and (n > MAX_BANKER_N or m > MAX_BANKER_M):
        ambiguities.append(_ambiguity(
            "banker_size", "allocation", f"首版仅支持 {MAX_BANKER_N} 个进程、{MAX_BANKER_M} 类资源以内。"))
    names = (table or {}).get("names") if table and len((table or {}).get("names") or []) == n else [f"P{i}" for i in range(n)]
    if request and (request["process"] not in names or len(request["vector"]) != m):
        ambiguities.append(_ambiguity("request", "request", "资源请求的进程名或分量数与矩阵不一致，请写成 “P1: 1,0,2”。"))
    resources = [chr(ord("A") + j) for j in range(m)] if m <= 26 else [f"R{j + 1}" for j in range(m)]

    params = []
    if request:
        params.append(_param("request_mode", "资源请求", "enum", options=["apply", "ignore"],
                             note="apply：先判断该请求能否满足，再试分配并检查安全；ignore：只检查当前状态是否安全。"))
    model = {
        "engine": "os_banker_v1", "subject": "operating_system", "os_kind": "banker",
        "names": names, "resources": resources, "allocation": allocation, "need": need,
        "max": maximum, "available": available, "request": request,
        "defaults": {"request_mode": "apply" if request else "ignore"}, "params": params, "teaching": False,
    }
    conditions = []
    if allocation is not None:
        conditions.append(_condition("allocation", "已分配矩阵 Allocation", _matrix_text(allocation), source=source,
                                     note="每行一个进程，例如 [[0,1,0],[2,0,0]]；修正后重新求解。"))
    if maximum is not None:
        conditions.append(_condition("max", "最大需求矩阵 Max", _matrix_text(maximum), source=source))
    elif need_given is not None:
        conditions.append(_condition("max", "尚需矩阵 Need", _matrix_text(need_given), source=source, editable=False))
    if available is not None:
        conditions.append(_condition("available", "可用资源 Available", ", ".join(_fmt(v) for v in available), source=source))
    if request:
        conditions.append(_condition("request", "资源请求", f"{request['process']}: " + ", ".join(_fmt(v) for v in request["vector"]),
                                     source=source, note="写成 P1: 1,0,2；删除后只检查当前状态。"))
    formulas = [{"id": "banker_rule", "tex": r"Need=Max-Allocation,\quad Need_i\le Work\Rightarrow Work\leftarrow Work+Allocation_i",
                 "plain": "找到 Need ≤ Work 的进程，假定它运行完毕并归还已分配资源；能走完全部进程则系统安全。", "role": "安全性算法"}]
    return {"model": model, "conditions": conditions, "ambiguities": ambiguities, "formulas": formulas,
            "recognized": not ambiguities}


def _safety(names: Sequence[str], allocation: Sequence[Sequence[float]], need: Sequence[Sequence[float]],
            available: Sequence[float]) -> tuple[list[dict[str, Any]], list[str] | None]:
    n, m = len(names), len(available)
    work = list(available)
    finished = [False] * n
    steps: list[dict[str, Any]] = []
    sequence: list[str] = []
    while len(sequence) < n:
        pick = next((i for i in range(n) if not finished[i] and all(need[i][j] <= work[j] + EPS for j in range(m))), None)
        if pick is None:
            return steps, None
        before = list(work)
        work = [work[j] + allocation[pick][j] for j in range(m)]
        finished[pick] = True
        sequence.append(names[pick])
        steps.append({"index": pick, "work_before": before, "work_after": list(work), "finished": list(finished)})
    return steps, sequence


def _eval_banker(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    kind, engine = "banker", "os_banker_v1"
    names = [str(item) for item in model.get("names") or []]
    allocation = _coerce_matrix(model.get("allocation"))
    need = _coerce_matrix(model.get("need"))
    available = _coerce_vector(model.get("available"))
    resources = [str(item) for item in model.get("resources") or []]
    request = _coerce_request(model.get("request"))
    original_request = model.get('request')
    if request and isinstance(original_request,Mapping) and original_request.get('process') in names:
        request['process']=original_request['process']
    defaults = model.get("defaults") or {}
    mode = str(params.get("request_mode") or defaults.get("request_mode") or "ignore")
    if allocation is None or need is None or available is None:
        return _blocked(kind, engine, "银行家算法需要 Allocation、Max（或 Need）与 Available，请先补全题目数据。")
    n, m = len(allocation), len(allocation[0])
    if (len(names) != n or len(need) != n or any(len(row) != m for row in need + allocation) or len(available) != m
            or n > MAX_BANKER_N or m > MAX_BANKER_M):
        return _blocked(kind, engine, "矩阵形状不一致或超出首版范围，请核对三个输入。")
    alloc = [list(row) for row in allocation]
    need_now = [list(row) for row in need]
    avail = list(available)
    frames: list[dict[str, Any]] = []

    def rows(finished: Sequence[bool] | None = None) -> list[dict[str, Any]]:
        return [{"id": names[i], "allocation": list(alloc[i]), "need": list(need_now[i]),
                 "finished": bool(finished[i]) if finished else False} for i in range(n)]

    def vec(values: Sequence[float]) -> str:
        return "(" + ", ".join(_fmt(v) for v in values) + ")"

    _frame(frames, "initial", "写出 Allocation、Need 与 Available",
           f"Need = Max − Allocation；可用资源 {vec(avail)}（资源类型 {'、'.join(resources)}）。", 1,
           rows=rows(), work=list(avail), resources=resources, picked=None, request=None)
    granted: bool | None = None
    request_note = ""
    steps: list[dict[str, Any]] = []
    sequence: list[str] | None = None
    if request and mode == "apply":
        index = names.index(request["process"]) if request["process"] in names else -1
        vector = request["vector"]
        if index < 0 or len(vector) != m:
            return _blocked(kind, engine, "资源请求的进程名或分量数与矩阵不一致。")
        if any(vector[j] > need_now[index][j] + EPS for j in range(m)):
            granted = False
            request_note = f"{request['process']} 的请求 {vec(vector)} 超过它的 Need {vec(need_now[index])}，出错，拒绝。"
            _frame(frames, "request_deny", "检查 1：Request ≤ Need 不成立", request_note, 2,
                   rows=rows(), work=list(avail), resources=resources, picked=None, request=request)
        elif any(vector[j] > avail[j] + EPS for j in range(m)):
            granted = False
            request_note = f"可用资源 {vec(avail)} 不能满足请求 {vec(vector)}，{request['process']} 必须等待。"
            _frame(frames, "request_deny", "检查 2：Request ≤ Available 不成立", request_note, 2,
                   rows=rows(), work=list(avail), resources=resources, picked=None, request=request)
        else:
            _frame(frames, "request_check", "检查 1、2：Request ≤ Need 且 ≤ Available",
                   f"{request['process']} 请求 {vec(vector)}：Need {vec(need_now[index])}、Available {vec(avail)}，两项检查均通过。", 2,
                   rows=rows(), work=list(avail), resources=resources, picked=None, request=request)
            backup = (list(avail), [list(r) for r in alloc], [list(r) for r in need_now])
            avail = [avail[j] - vector[j] for j in range(m)]
            alloc[index] = [alloc[index][j] + vector[j] for j in range(m)]
            need_now[index] = [need_now[index][j] - vector[j] for j in range(m)]
            _frame(frames, "request_try", "试分配：Available 减、Allocation 加、Need 减",
                   f"假设分配成功：Available 变为 {vec(avail)}，{request['process']} 的 Allocation {vec(alloc[index])}、Need {vec(need_now[index])}。", 2,
                   rows=rows(), work=list(avail), resources=resources, picked=index, request=request)
            steps, sequence = _safety(names, alloc, need_now, avail)
            for number, step in enumerate(steps, 1):
                i = step["index"]
                _frame(frames, "pick", f"第 {number} 轮：{names[i]} 可以完成",
                       f"Need {vec(need_now[i])} ≤ Work {vec(step['work_before'])}；{names[i]} 运行完毕后归还 Allocation，Work = {vec(step['work_after'])}。", 3,
                       rows=rows(step["finished"]), work=step["work_after"], resources=resources, picked=i, request=request)
            if sequence is None:
                granted = False
                avail, alloc, need_now = backup[0], backup[1], backup[2]
                request_note = f"试分配后系统不安全，撤销分配，{request['process']} 必须等待。"
                _frame(frames, "unsafe", "试分配后不安全，撤销",
                       request_note, 4, rows=rows(), work=list(avail), resources=resources, picked=None, request=request)
            else:
                granted = True
                request_note = f"试分配后仍安全，可以满足 {request['process']} 的请求。"
                _frame(frames, "safe", "试分配后仍安全，批准请求", request_note, 4,
                       rows=rows([True] * n), work=steps[-1]["work_after"] if steps else list(avail),
                       resources=resources, picked=None, request=request)
    if granted is None:
        steps, sequence = _safety(names, alloc, need_now, avail)
        for number, step in enumerate(steps, 1):
            i = step["index"]
            _frame(frames, "pick", f"第 {number} 轮：{names[i]} 可以完成",
                   f"Need {vec(need_now[i])} ≤ Work {vec(step['work_before'])}；{names[i]} 运行完毕后归还 Allocation，Work = {vec(step['work_after'])}。", 3,
                   rows=rows(step["finished"]), work=step["work_after"], resources=resources, picked=i, request=None)
        if sequence is None:
            done_names = {names[s["index"]] for s in steps}
            stuck = [name for name in names if name not in done_names]
            _frame(frames, "unsafe", "没有可以完成的进程：不安全",
                   f"剩余进程 {'、'.join(stuck)} 的 Need 都大于当前 Work，系统处于不安全状态（可能死锁）。", 4,
                   rows=rows([name in done_names for name in names]), work=steps[-1]["work_after"] if steps else list(avail),
                   resources=resources, picked=None, request=None)
        else:
            _frame(frames, "safe", "全部进程可完成：安全", f"安全序列 {' → '.join(sequence)}。", 4,
                   rows=rows([True] * n), work=steps[-1]["work_after"], resources=resources, picked=None, request=None)
    final_work = steps[-1]["work_after"] if steps and granted is not False else list(avail)
    if request and mode == "apply":
        verdict = "可以分配" if granted else "不能分配"
        answer = f"{request['process']} 请求 {vec(request['vector'])}：{verdict}。" + (
            f"安全序列 {' → '.join(sequence)}。" if granted and sequence else request_note)
    elif sequence:
        answer = f"系统处于安全状态，安全序列：{' → '.join(sequence)}"
    else:
        answer = "系统处于不安全状态，找不到安全序列"
    _frame(frames, "result", "结果", answer, 5, rows=rows([True] * n if sequence else None),
           work=final_work, resources=resources, picked=None, request=request)
    metrics = [
        {"id": "state", "label": "系统状态", "value": "安全" if sequence else "不安全"},
        {"id": "sequence", "label": "安全序列", "value": " → ".join(sequence) if sequence else "无"},
        {"id": "available", "label": "初始 Available", "value": vec(available)},
        {"id": "shape", "label": "规模", "value": f"{n} 个进程 × {m} 类资源"},
    ]
    checks = [{"id": "safety", "label": "安全性检查", "status": "pass" if sequence else "fail",
               "detail": "找到安全序列。" if sequence else "没有任何一个剩余进程满足 Need ≤ Work。"}]
    if request and mode == "apply":
        checks.append({"id": "request", "label": "资源请求", "status": "pass" if granted else "warn", "detail": request_note})
    return {
        "subject": "operating_system", "engine": engine, "os_kind": kind, "status": "ok", "algorithm": "banker",
        "frames": frames, "trace": frames, "pseudocode": BANKER_PSEUDOCODE, "answer": answer, "answer_value": None,
        "answer_order": sequence, "headline": answer, "metrics": metrics, "checks": checks,
        "stats": {"safe": bool(sequence), "sequence": sequence, "granted": granted,
                  "state": {"available": avail, "allocation": alloc, "need": need_now}, "names": names},
        "stop_reason": "done" if sequence else "unsafe",
        "notes": ["每一轮都从 P0 开始找第一个满足 Need ≤ Work 的进程，因此给出的是其中一个安全序列。",
                  "安全序列通常不唯一：只要每一步都满足 Need ≤ Work，任何合法的完成顺序都算正确。"],
    }


def check_banker_sequence(model: Mapping[str, Any], tokens: Sequence[str]) -> tuple[bool, str]:
    """学生写出的序列只要每一步都满足 Need ≤ Work 就算安全序列。"""

    evaluation = _eval_banker(model, model.get("defaults") or {})
    if evaluation.get("status") != "ok":
        return False, str(evaluation.get("reason") or "请先核对题目数据")
    state = evaluation["stats"]["state"]
    names = evaluation["stats"]["names"]
    wanted = [token.upper() for token in tokens]
    if sorted(wanted) != sorted(name.upper() for name in names):
        return False, f"序列需要恰好包含全部 {len(names)} 个进程：{'、'.join(names)}。"
    if not evaluation["stats"]["safe"]:
        return False, "该状态不安全，不存在安全序列。"
    work = list(state["available"])
    lookup = {name.upper(): index for index, name in enumerate(names)}
    for token in wanted:
        i = lookup[token]
        if any(state["need"][i][j] > work[j] + EPS for j in range(len(work))):
            return False, f"{names[i]} 的 Need 超过当时的 Work，不能在这一步完成。"
        work = [work[j] + state["allocation"][i][j] for j in range(len(work))]
    return True, "每一步都满足 Need ≤ Work，是一个合法的安全序列。"


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------

_BUILDERS = {
    "cpu_schedule": _build_schedule,
    "page_replace": _build_page,
    "disk_schedule": _build_disk,
    "banker": _build_banker,
}


def _infer_kind(text: str, merged: Mapping[str, Any]) -> tuple[str | None, bool]:
    explicit = str(merged.get("os_kind") or "").strip()
    if explicit in KIND_LABELS:
        return explicit, True
    detected = _detect_kind(text)
    if detected:
        return detected, True
    if _table_processes(text) or _inline_processes(text):
        return "cpu_schedule", True
    if _reference_from_text(text):
        return "page_replace", True
    return None, False


def build_os(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any]:
    """识别操作系统题目并生成可执行模型；数据缺失时给出阻塞问题，不编造条件。"""

    merged = {**dict(overrides.get("condition_values") or {}),
              **dict(overrides.get("ambiguity_answers") or {}),
              **dict(overrides or {})}
    kind, certain = _infer_kind(text, merged)
    built = _BUILDERS[kind or "cpu_schedule"](text, source, merged)
    if not certain:
        built["ambiguities"].insert(0, _ambiguity(
            "os_kind", "os_kind", "已识别为操作系统内容，但没有确定题型：CPU 调度、页面置换、磁盘调度还是银行家算法？",
            options=[{"value": key, "label": label} for key, label in KIND_LABELS.items()]))
        built["recognized"] = False
    return built


def evaluate_os(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    kind = str(model.get("os_kind") or "cpu_schedule")
    if kind == "page_replace":
        return _eval_page(model, params)
    if kind == "disk_schedule":
        return _eval_disk(model, params)
    if kind == "banker":
        return _eval_banker(model, params)
    return _eval_schedule(model, params)


# ---------------------------------------------------------------------------
# 原题解答
# ---------------------------------------------------------------------------


def solve_os(model: Mapping[str, Any]) -> dict[str, Any]:
    kind = str(model.get("os_kind") or "cpu_schedule")
    result = evaluate_os(model, model.get("defaults") or {})
    if result.get("status") != "ok":
        raise ValueError(result.get("reason") or "暂不能求解该操作系统题")
    frames = result["trace"]
    last = len(frames) - 1

    def first(*actions: str) -> int:
        return next((f["index"] for f in frames if f["action"] in actions), last)

    algorithm = str(result.get("algorithm") or "")
    if kind == "cpu_schedule":
        steps = [
            {"id": "os_0", "title": "列出进程表", "detail": "按到达时间排列进程；每个进程有到达时间与服务时间。"},
            {"id": f"os_{first('run', 'idle')}", "title": "按规则选择进程",
             "detail": f"{SCHED_LABELS[algorithm]}：每次在就绪队列里按规则选一个进程，甘特图记录每一段的理由。"},
            {"id": f"os_{max(0, last - 1)}", "title": "记录完成时刻",
             "detail": "周转时间 = 完成时间 − 到达时间；等待时间 = 周转时间 − 服务时间。"},
            {"id": f"os_{last}", "title": "平均指标", "detail": result["answer"]},
        ]
        summary = f"{SCHED_LABELS[algorithm]}：模拟 CPU 时间轴，得到各进程完成时刻，再求平均周转与平均等待时间。"
    elif kind == "page_replace":
        initial_frames = _coerce_reference(model.get("initial_frames")) or []
        steps = [
            {"id": "os_0", "title": "初始：物理块已有驻留页面" if initial_frames else "初始：物理块全空",
             "detail": (f"初始已调入页面 {', '.join(initial_frames)}，访问这些页面时直接命中。" if initial_frames
                        else "每次访问页面，先看它是否已在物理块中。")},
            {"id": f"os_{first('fault')}", "title": "缺页并装入空闲块", "detail": "不在内存就缺页；还有空闲块时直接装入。"},
            {"id": f"os_{first('replace')}", "title": "物理块已满：置换",
             "detail": f"{PAGE_LABELS[algorithm]}选出被换出的页面，新页面装入同一个块。"},
            {"id": f"os_{last}", "title": "统计缺页", "detail": result["answer"]},
        ]
        summary = f"{PAGE_LABELS[algorithm]}：逐次访问页面，命中则不动，缺页则装入或置换，最后统计缺页次数。"
    elif kind == "disk_schedule":
        steps = [
            {"id": "os_0", "title": "磁头起点与请求", "detail": "请求按到达顺序给出；总移动距离是相邻两次磁头位置之差的绝对值之和。"},
            {"id": f"os_{first('seek')}", "title": "选择下一个磁道",
             "detail": f"{DISK_LABELS[algorithm]}：按算法决定下一个服务的磁道，并累加移动距离。"},
            {"id": f"os_{first('edge', 'jump', 'seek')}", "title": "端点与换向",
             "detail": "SCAN 类算法走到末端或最远请求后换向（或回扫）；FCFS / SSTF 没有这一步。"},
            {"id": f"os_{last}", "title": "总移动距离", "detail": result["answer"]},
        ]
        summary = f"{DISK_LABELS[algorithm]}：按算法依次服务请求，累加磁头移动距离。"
    else:
        steps = [
            {"id": "os_0", "title": "Need 与 Work", "detail": "Need = Max − Allocation；Work 初始为 Available。"},
            {"id": f"os_{first('request_check', 'request_deny', 'pick')}", "title": "资源请求检查" if model.get("request")
             else "寻找可完成的进程",
             "detail": "有资源请求时先检查 Request ≤ Need 与 Request ≤ Available，再试分配；否则直接找 Need ≤ Work 的进程。"},
            {"id": f"os_{first('pick', 'unsafe')}", "title": "假定进程完成并归还资源", "detail": "Work = Work + Allocation，再找下一个。"},
            {"id": f"os_{last}", "title": "结论", "detail": result["answer"]},
        ]
        summary = "银行家算法：用安全性算法检查系统是否存在安全序列；有资源请求时先试分配再检查。"
    order = result.get("answer_order")
    return {
        "summary": summary, "answer": result["answer"], "answer_value": result.get("answer_value"),
        "answer_order": order if kind == "banker" else None, "answer_sequence": order,
        "steps": steps, "conditions": ["题目数据来自识别条件；可在条件面板中修正后重建。"],
        "limitations": result.get("notes") or [],
    }


__all__ = ["KIND_LABELS", "build_os", "check_banker_sequence", "evaluate_os", "solve_os"]

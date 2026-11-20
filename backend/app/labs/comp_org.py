"""计算机组成原理题目的识别与确定性求解。

覆盖五组题型，全部产出可回放的确定性轨迹：

- ``performance``：CPU 执行时间、时钟周期、主频、CPI、指令数与 MIPS、性能比较/加速比；
- ``data_repr``：进制转换、原码/反码/补码/移码、符号扩展、有符号/无符号解释；
- ``fixed_point``：补码加减与溢出标志、算术/逻辑移位、乘除运算；
- ``floating``：IEEE 754 编码/解码、规格化、范围与精度、浮点加减与上下溢；
- ``datapath``：ALU 运算、寄存器传送、多路选择器（MUX）与数据流/控制信号。

所有约定（位宽、补码、移码偏移、IEEE 格式、舍入方式）在结果中显式标注；
条件不足时返回阻塞模型，不编造数据。
"""
from __future__ import annotations

import math
import re
import struct
from fractions import Fraction
from typing import Any, Mapping

MAX_BITS = 16

KIND_LABELS = {
    "performance": "计算机性能",
    "data_repr": "数据表示",
    "fixed_point": "定点运算",
    "floating": "浮点数",
    "datapath": "运算器与数据通路",
    "memory": "主存储器",
    "cache": "Cache",
    "virtual_memory": "虚拟存储基础",
    "instruction": "指令系统",
    "cpu_control": "CPU 与控制器",
    "pipeline": "指令流水线",
    "bus_io": "总线与输入输出",
}

ENGINES = {
    "performance": "co_perf_v1",
    "data_repr": "co_data_v1",
    "fixed_point": "co_fixed_v1",
    "floating": "co_float_v1",
    "datapath": "co_datapath_v1",
    "memory": "co_memory_v1",
    "cache": "co_cache_v1",
    "virtual_memory": "co_virtual_v1",
    "instruction": "co_instruction_v1",
    "cpu_control": "co_control_v1",
    "pipeline": "co_pipeline_v1",
    "bus_io": "co_bus_io_v1",
}

PSEUDOCODES = {
    "performance": [
        "CPU 时间 = 指令数 × CPI × 时钟周期 = 指令数 × CPI / 主频",
        "时钟周期 = 1 / 主频；MIPS = 主频 / (CPI × 10^6)",
        "加速比 = 基准机时间 / 改进后时间 = 改进后性能 / 基准性能",
        "性能提升百分比 = (加速比 − 1) × 100%",
    ],
    "data_repr": [
        "按位权展开：N = Σ d_i × 基数^i",
        "整数转目标进制：除基取余，余数逆序排列",
        "小数转目标进制：乘基取整，整数部分顺序排列",
        "补码 = 模 2^n 下的无符号编码；移码 = 真值 + 2^(n−1)",
        "符号扩展：复制最高位（符号位）到新增高位",
    ],
    "fixed_point": [
        "补码加减：按位相加，超过 n 位的进位丢弃；减法化为加负数补码",
        "溢出判断：同号相加结果异号，或异号相减结果与被减数异号",
        "算术右移：符号位保持不变；逻辑右移：高位补 0",
        "原码一位乘：符号位单独处理，绝对值做移位相加",
        "恢复余数除法：余数左移并试减，够减商 1，不够减商 0 并恢复余数",
    ],
    "floating": [
        "IEEE 754：符号位 | 阶码（移码） | 尾数（隐含最高位 1）",
        "规格化数：(-1)^s × 1.f × 2^(E−bias)",
        "非规格化数：(-1)^s × 0.f × 2^(1−bias)",
        "浮点加减：对阶 → 尾数加减 → 规格化 → 舍入 → 溢出判断",
    ],
    "datapath": [
        "寄存器传送：在控制信号有效时把源寄存器/ALU 结果写入目的寄存器",
        "ALU 根据 ALUop 选择运算，并生成 Zero、Sign、Carry、Overflow 标志",
        "多路选择器：由选择信号在三元/四元输入中选一路输出",
        "数据流方向由控制信号决定：读寄存器 → ALU 运算 → 写回/存储",
    ],
    "memory": [
        "存储容量 = 存储单元数 × 每个单元位数 = 2^地址线数 × 数据线数",
        "位扩展：增加数据线宽度；字扩展：增加存储单元数",
        "总芯片数 = (总字数 / 片字数) × (总位数 / 片位数)",
        "字扩展时高位地址经译码器产生片选，低位地址送片内地址线",
        "交叉编址：m 体连续访问时间 = T + (m−1)τ",
    ],
    "cache": [
        "主存地址 = 标记 tag | 组索引 index | 块内偏移 offset",
        "直接映射每组 1 行；全相联只有 1 组；n 路组相联每组 n 行",
        "组数 = Cache 行数 / 相联度；行数 = Cache 容量 / 块大小",
        "平均访问时间 = 命中时间 + 缺失率 × 缺失代价",
        "写直达同时写 Cache 与主存；写回只在替换时写回脏块",
    ],
    "virtual_memory": [
        "虚拟地址 = 虚页号 VPN | 页内偏移 offset",
        "页表项把 VPN 映射到物理页框号 PFN",
        "TLB 是页表项的高速缓存；TLB 未命中再查页表",
        "物理地址 = PFN × 页大小 + offset",
        "联合访问时间 = TLB 时间 + 页表缺失代价 + Cache 时间 + 主存缺失代价",
    ],
    "instruction": [
        "指令 = 操作码字段 | 地址码字段（寄存器号/立即数/地址）",
        "操作码扩展：用保留操作码作为扩展标志，把地址字段解释为下一级操作码",
        "有效地址 EA 由寻址方式决定：直接、间接、基址、变址、相对等",
        "机器指令编码 = 操作码 + 各字段二进制拼接",
        "C 表达式与三地址指令一一对应：ADD/SUB/LOAD/STORE 等",
    ],
    "cpu_control": [
        "指令周期 = 取指周期 + 间址周期 + 执行周期 + 中断周期",
        "单周期数据通路每条指令一个时钟；多周期按阶段复用部件",
        "硬布线控制由组合逻辑产生控制信号；微程序控制从控制存储器取微指令",
        "总时间 = 指令数 × 平均 CPI × 时钟周期",
        "控制存储器容量 = 微指令条数 × 微指令字长",
    ],
    "pipeline": [
        "k 段流水线执行 n 条指令：总周期数 = k + (n−1)",
        "吞吐率 = n / 总时间；加速比 = 顺序执行时间 / 流水线时间",
        "结构冒险争用部件；数据冒险依赖前一条结果；控制冒险来自转移",
        "转发把结果提前送到需要处；无法转发时插入暂停周期",
        "实际周期数 = 理想周期数 + 停顿周期数",
    ],
    "bus_io": [
        "总线带宽 = 每次传送字节数 × 传送频率",
        "总线传输周期包含地址/数据/握手等阶段",
        "程序查询由 CPU 反复轮询；中断由设备主动通知；DMA 由控制器直接搬数据",
        "中断优先级决定同时请求时的服务顺序；高优先级可嵌套低优先级",
        "CPU 时间开销 = 轮询/中断/DMA 初始化周期数 / 主频",
    ],
}


# ---------------------------------------------------------------------------
# 结果与模型工具
# ---------------------------------------------------------------------------

def _frame(index: int, label: str, detail: str, values: dict[str, Any],
           line: int | None = None) -> dict[str, Any]:
    payload = {"index": index, "label": label, "detail": detail, "values": values}
    if line is not None:
        payload["pseudocodeLine"] = line
    return payload


def _check(cid: str, label: str, ok: bool, detail: str) -> dict[str, Any]:
    return {"id": cid, "label": label, "status": "pass" if ok else "fail", "detail": detail}


def _ok(kind: str, answer: str, frames: list[dict[str, Any]], pseudocode: list[str],
        checks: list[dict[str, Any]], notes: list[str], *,
        answer_value: float | None = None,
        answer_order: list[str] | None = None,
        metrics: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    items = [{"id": "answer", "label": "结论", "value": answer, "tone": "accent"}]
    items.extend(metrics or [])
    result: dict[str, Any] = {
        "subject": "computer_organization", "engine": ENGINES[kind],
        "co_kind": kind, "status": "ok", "headline": answer, "answer": answer,
        "metrics": items, "checks": checks, "notes": notes,
        "trace": frames, "frames": frames, "pseudocode": pseudocode, "params": {},
    }
    if answer_value is not None:
        try:
            numeric = float(answer_value)
            if math.isfinite(numeric):
                result["answer_value"] = numeric
                items.append({"id": "value", "label": "数值", "value": fmt(numeric)})
        except (TypeError, ValueError):
            pass
    if answer_order is not None:
        result["answer_order"] = answer_order
    return result


def _blocked(kind: str, reason: str) -> dict[str, Any]:
    return {"subject": "computer_organization", "engine": ENGINES.get(kind, "co_unknown_v1"),
            "co_kind": kind, "status": "blocked", "reason": reason,
            "headline": reason, "answer": "", "metrics": [], "checks": [], "notes": [],
            "trace": [], "frames": [], "pseudocode": PSEUDOCODES.get(kind, []), "params": {}}


def _condition(cid: str, label: str, value: Any, *, source: Mapping[str, Any] | None = None,
               kind: str = "text", editable: bool = False, note: str | None = None) -> dict[str, Any]:
    return {"id": cid, "label": label, "value": value, "kind": kind, "unit": "",
            "provenance": "original", "source": dict(source or {}), "editable": editable,
            "options": [], "min": None, "max": None, "step": None, "note": note}


def _ambiguity(cid: str, question: str, options: list[dict[str, str]]) -> dict[str, Any]:
    return {"id": cid, "field": "co_kind", "question": question,
            "severity": "blocking", "options": options, "resolved": False, "answer": None}


def _built(kind: str, model: dict[str, Any], conditions: list[dict[str, Any]],
           formulas: list[dict[str, Any]]) -> dict[str, Any]:
    return {"model": model, "conditions": conditions, "formulas": formulas,
            "ambiguities": [], "recognized": True}


# ---------------------------------------------------------------------------
# 通用数值工具
# ---------------------------------------------------------------------------

_UNIT = {
    "k": 1e3, "m": 1e6, "g": 1e9, "万": 1e4, "亿": 1e8,
}
_TIME_UNIT = {"ps": 1e-12, "ns": 1e-9, "us": 1e-6, "μs": 1e-6, "ms": 1e-3, "s": 1.0}
_FREQ_UNIT = {"hz": 1.0, "khz": 1e3, "mhz": 1e6, "ghz": 1e9}
_BASE_WORDS = {"二进制": 2, "八进制": 8, "十进制": 10, "十六进制": 16}
_BASE_DIGITS = "0123456789ABCDEF"


def fmt(value: float | int | None, digits: int = 10) -> str:
    if value is None:
        return "—"
    number = float(value)
    if not math.isfinite(number):
        return "∞" if number > 0 else ("−∞" if number < 0 else "NaN")
    if number == int(number) and abs(number) < 1e15:
        return str(int(number))
    return f"{number:.{digits}g}"


def _num(value: str) -> float:
    return float(value.replace(",", "").replace("−", "-"))


def _scale(value: str, unit: str | None) -> float:
    number = _num(value)
    if not unit:
        return number
    if unit in _TIME_UNIT:
        return number * _TIME_UNIT[unit]
    if unit.lower() in _FREQ_UNIT:
        return number * _FREQ_UNIT[unit.lower()]
    if unit in _UNIT:
        return number * _UNIT[unit]
    return number


def _number_after(text: str, label_pattern: str, unit_pattern: str = r"") -> float | None:
    pattern = rf"(?:{label_pattern})\s*(?:为|是|约|大约|=|:|：)?\s*([0-9]+(?:\.[0-9]+)?)\s*({unit_pattern})?"
    match = re.search(pattern, text, re.I)
    if not match:
        return None
    return _scale(match.group(1), match.group(2))


def _width(text: str, default: int = 8) -> int:
    match = re.search(r"(\d{1,3})\s*位", text)
    return int(match.group(1)) if match else default


def _time_ns(text: str, labels: str) -> float | None:
    match = re.search(
        rf"(?:{labels})(?:\s*[A-Za-zτΔ][A-Za-z0-9_]*)?\s*(?:为|是|约|=|:|：)?\s*([0-9]+(?:\.[0-9]+)?)\s*(ps|ns|us|μs|ms|s)",
        text, re.I)
    if not match:
        return None
    factor = {"ps": 1e-3, "ns": 1.0, "us": 1e3, "μs": 1e3, "ms": 1e6, "s": 1e9}
    return float(match.group(1)) * factor[match.group(2).lower()]


def _bits_token(text: str, minimum: int = 4) -> str | None:
    candidates = re.findall(r"(?<![0-9A-Za-z])[01](?:[\s_]?[01]){%d,63}(?![0-9A-Za-z])" % (minimum - 1), text)
    if not candidates:
        return None
    token = max(candidates, key=lambda item: len(re.sub(r"[\s_]", "", item)))
    return re.sub(r"[\s_]", "", token)


def _group_bits(bits: str) -> str:
    return " ".join(bits[i:i + 4] for i in range(0, len(bits), 4))


def _to_bits(value: int, width: int) -> str:
    return format(value & ((1 << width) - 1), f"0{width}b")


def _twos(value: int, width: int) -> int:
    value &= (1 << width) - 1
    return value - (1 << width) if value & (1 << (width - 1)) else value


def _round_fraction(value: Fraction, digits: int = 12) -> str:
    if value.denominator == 1:
        return str(value.numerator)
    return f"{float(value):.{digits}g}"


# ---------------------------------------------------------------------------
# 1) 计算机性能
# ---------------------------------------------------------------------------

def _parse_frequency(text: str) -> float | None:
    match = re.search(
        r"(?:主频|时钟频率|频率|f)(?:\s*[12]\s*[=:：]\s*)?\s*(?:为|是|约|=|:|：)?\s*([0-9]+(?:\.[0-9]+)?)\s*(GHz|MHz|kHz|Hz)",
        text, re.I)
    return _scale(match.group(1), match.group(2)) if match else None


def _parse_period(text: str) -> float | None:
    match = re.search(
        r"时钟周期\s*(?:为|是|约|=|:|：)?\s*([0-9]+(?:\.[0-9]+)?)\s*(ps|ns|us|μs|ms|s)",
        text, re.I)
    return _scale(match.group(1), match.group(2)) if match else None


def _parse_cpi(text: str) -> float | None:
    match = re.search(r"(?:平均\s*)?CPI\s*(?:为|是|约|=|:|：)?\s*([0-9]+(?:\.[0-9]+)?)", text, re.I)
    return float(match.group(1)) if match else None


def _parse_instruction_count(text: str) -> float | None:
    scientific = re.search(
        r"(?:指令数量|指令条数|指令数|指令|执行)\s*(?:为|是|约|共|=|:|：)?\s*"
        r"([0-9]+(?:\.[0-9]+)?)\s*[×xX*]\s*10\s*\^?\s*(\d+)\s*(?:条指令)?", text)
    if scientific:
        return float(scientific.group(1)) * (10 ** int(scientific.group(2)))
    scientific_short = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*[eE]\s*(\d+)\s*条指令", text)
    if scientific_short:
        return float(f"{scientific_short.group(1)}e{scientific_short.group(2)}")
    match = re.search(
        r"(?:指令数量|指令条数|指令数|指令)\s*(?:为|是|约|共|=|:|：)?\s*([0-9]+(?:\.[0-9]+)?)\s*(K|M|G|万|亿)?",
        text, re.I)
    if not match:
        match = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*(K|M|G|万|亿)?\s*条指令", text, re.I)
    if not match:
        return None
    return _scale(match.group(1), match.group(2))


def _parse_runtime(text: str) -> float | None:
    match = re.search(
        r"(?:CPU\s*执行时间|执行时间|运行时间|耗时|CPU时间)\s*(?:为|是|约|=|:|：)?\s*([0-9]+(?:\.[0-9]+)?)\s*(ps|ns|us|μs|ms|s)",
        text, re.I)
    return _scale(match.group(1), match.group(2)) if match else None


def _eval_performance(text: str) -> dict[str, Any]:
    if re.search(r"加速比|性能比|快多少|性能提升|性能是.*倍|速度是.*倍", text):
        return _eval_speedup(text)
    freq = _parse_frequency(text)
    period = _parse_period(text)
    if freq is None and period:
        freq = 1.0 / period
    if period is None and freq:
        period = 1.0 / freq
    cpi = _parse_cpi(text)
    count = _parse_instruction_count(text)
    runtime = _parse_runtime(text)
    mips = _number_after(text, r"MIPS")

    asked_time = bool(re.search(r"(?:求|计算|问).{0,12}(?:执行时间|CPU时间|运行时间)", text))
    unknown = []
    if count is None:
        unknown.append("指令数")
    if cpi is None:
        unknown.append("CPI")
    if freq is None:
        unknown.append("主频/时钟周期")

    frames: list[dict[str, Any]] = []
    lines: list[str] = []
    if period is not None:
        lines.append(f"时钟周期 T = {fmt(period)} s")
    if freq is not None:
        lines.append(f"主频 f = {fmt(freq)} Hz")
    if cpi is not None:
        lines.append(f"CPI = {fmt(cpi)}")
    if count is not None:
        lines.append(f"指令数 = {fmt(count)}")
    if runtime is not None:
        lines.append(f"执行时间 = {fmt(runtime)} s")
    if not lines:
        raise ValueError("未识别到主频/时钟周期、CPI、指令数或执行时间等性能条件")
    frames.append(_frame(1, "已知条件", "；".join(lines), {"条件": "；".join(lines)}, 1))

    if count is not None and cpi is not None and freq is not None:
        runtime = count * cpi / freq
    elif runtime is not None and cpi is not None and freq is not None:
        count = runtime * freq / cpi
    elif count is not None and cpi is not None and runtime is not None:
        freq = count * cpi / runtime
        period = 1 / freq
    elif count is not None and freq is not None and runtime is not None:
        cpi = runtime * freq / count
    elif runtime is not None and count is not None:
        pass

    if runtime is None:
        raise ValueError("条件不足：CPU 执行时间 = 指令数 × CPI / 主频；请补充其中一个量")
    if freq is not None and cpi is not None:
        period = 1 / freq
        mips = freq / (cpi * 1e6)
    elif count is not None and runtime:
        mips = count / (runtime * 1e6)

    frames.append(_frame(
        2, "套用公式",
        "CPU 时间 = 指令数 × CPI × 时钟周期 = 指令数 × CPI / 主频；"
        f"代入得 {fmt(count)} × {fmt(cpi)} / {fmt(freq)} = {fmt(runtime)} s。",
        {"公式": "T = N × CPI / f", "执行时间(s)": fmt(runtime)}, 2))
    if period is not None and cpi is not None and count is not None:
        gips = mips / 1000.0 if mips is not None else None
        speed_note = f"；指令执行速度 = {fmt(gips)} GIPS" if gips is not None and gips >= 0.01 else ""
        frames.append(_frame(3, "时钟周期与指令速度",
                             f"时钟周期 = 1/f = {fmt(period)} s；MIPS = f/(CPI×10⁶) ≈ {fmt(mips)}{speed_note}。",
                             {"时钟周期(s)": fmt(period), "MIPS": fmt(mips),
                              **({"GIPS": fmt(gips)} if gips is not None and gips >= 0.01 else {})}, 3))
    answer_bits = []
    if count is not None:
        answer_bits.append(f"指令数 = {fmt(count)}")
    if cpi is not None:
        answer_bits.append(f"CPI = {fmt(cpi)}")
    if freq is not None:
        answer_bits.append(f"主频 = {fmt(freq)} Hz")
    if period is not None:
        answer_bits.append(f"时钟周期 = {fmt(period)} s")
    time_text = f"{fmt(runtime)} s（{fmt(runtime * 1e3)} ms）" if 1e-4 <= runtime < 0.1 else f"{fmt(runtime)} s"
    answer_bits.append(f"CPU 执行时间 = {time_text}")
    if mips is not None:
        if mips >= 100 or re.search(r"GIPS|指令执行速度", text, re.I):
            answer_bits.append(f"指令执行速度 ≈ {fmt(mips / 1000.0)} GIPS（{fmt(mips)} MIPS）")
        else:
            answer_bits.append(f"MIPS ≈ {fmt(mips)}")
    answer = "；".join(answer_bits)
    checks = [
        _check("formula", "公式口径", True, "T = N × CPI × 时钟周期；时钟周期 = 1/主频。"),
        _check("unit", "单位换算", True, "时间统一到秒，主频统一到 Hz。"),
    ]
    notes = ["若题目给出时钟周期，则先换算主频 f = 1/T；MIPS 以 10⁶ 条指令/秒为口径。"]
    if unknown and asked_time:
        notes.append("题目未显式给出的量已由公式反求，结果中同时列出反求值。")
    return _ok("performance", answer, frames, PSEUDOCODES["performance"], checks, notes,
               answer_value=runtime)


def _eval_speedup(text: str) -> dict[str, Any]:
    times = [(_num(v), u) for v, u in re.findall(
        r"(?:执行时间|运行时间|耗时)\s*(?:为|是|约|=|:|：)?\s*([0-9]+(?:\.[0-9]+)?)\s*(ps|ns|us|μs|ms|s)",
        text, re.I)]
    if len(times) >= 2:
        t1 = _scale(str(times[0][0]), times[0][1])
        t2 = _scale(str(times[1][0]), times[1][1])
        ratio = t1 / t2
        basis = "基准执行时间 / 改进后执行时间"
    else:
        freqs = [_scale(v, u) for v, u in re.findall(
            r"(?:主频|时钟频率|频率)(?:\s*[12]\s*[=:：]\s*)?\s*(?:为|是|约|=|:|：)?\s*([0-9]+(?:\.[0-9]+)?)\s*(GHz|MHz|kHz|Hz)",
            text, re.I)]
        cpis = [float(v) for v in re.findall(
            r"CPI(?:\s*[12]\s*[=:：]\s*)?\s*(?:为|是|约|=|:|：)?\s*([0-9]+(?:\.[0-9]+)?)", text, re.I)]
        if len(freqs) < 2:
            raise ValueError("性能比较需要两台机器的主频/执行时间；请给出两组条件")
        cpi_a = cpis[0] if cpis else 1.0
        cpi_b = cpis[1] if len(cpis) > 1 else cpi_a
        ratio = (cpi_a / freqs[0]) / (cpi_b / freqs[1])
        basis = "T₁/T₂ = (CPI₁/f₁)/(CPI₂/f₂)"
    if ratio <= 0:
        raise ValueError("时间或频率数据不合法，无法计算加速比")
    improvement = (ratio - 1) * 100
    frames = [
        _frame(1, "确定基准", "以第一组条件为基准，第二组为改进后方案。", {"基准": "第一组", "对比": "第二组"}, 1),
        _frame(2, "计算加速比", f"加速比 = {basis} = {fmt(ratio)}。",
               {"加速比": fmt(ratio)}, 2),
        _frame(3, "性能提升", f"性能提升 = (加速比 − 1) × 100% = {fmt(improvement)}%。",
               {"性能提升(%)": fmt(improvement)}, 3),
    ]
    answer = f"第二方案相对第一方案的加速比 = {fmt(ratio)}；性能提升 {fmt(improvement)}%"
    checks = [_check("ratio", "加速比口径", ratio >= 1, "加速比大于 1 表示第二方案更快；小于 1 表示更慢。")]
    notes = ["加速比 = 基准时间 / 改进后时间；若题目方向相反，请交换两组条件的顺序。"]
    return _ok("performance", answer, frames, PSEUDOCODES["performance"], checks, notes,
               answer_value=ratio)


# ---------------------------------------------------------------------------
# 2) 数据表示
# ---------------------------------------------------------------------------

def _digit_value(ch: str) -> int:
    upper = ch.upper()
    return _BASE_DIGITS.index(upper) if upper in _BASE_DIGITS else 99


def _parse_base_fraction(token: str, base: int) -> Fraction:
    sign = -1 if token.startswith("-") else 1
    body = token.lstrip("+-")
    if "." in body:
        integer, fraction = body.split(".", 1)
    else:
        integer, fraction = body, ""
    if not integer and not fraction:
        raise ValueError("数字部分为空")
    value = Fraction(0)
    for ch in integer:
        digit = _digit_value(ch)
        if digit >= base:
            raise ValueError(f"数字 {ch} 不属于 {base} 进制")
        value = value * base + digit
    weight = Fraction(1, base)
    for ch in fraction:
        digit = _digit_value(ch)
        if digit >= base:
            raise ValueError(f"数字 {ch} 不属于 {base} 进制")
        value += digit * weight
        weight /= base
    return sign * value


def _base_name(base: int) -> str:
    return {2: "二进制", 8: "八进制", 10: "十进制", 16: "十六进制"}.get(base, f"{base} 进制")


def _base_label(token: str, base: int) -> str:
    subscript = {"0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅",
                 "6": "₆", "7": "₇", "8": "₈", "9": "₉"}
    return f"({token})" + "".join(subscript.get(ch, ch) for ch in str(base))


def _convert_integer(value: int, base: int) -> tuple[str, list[str]]:
    if value == 0:
        return "0", ["0 除以基数得商 0、余 0"]
    digits: list[str] = []
    steps: list[str] = []
    current = value
    while current:
        current, remainder = divmod(current, base)
        digits.append(_BASE_DIGITS[remainder])
        steps.append(f"{current * base + remainder} ÷ {base} = {current} 余 {_BASE_DIGITS[remainder]}")
    return "".join(reversed(digits)), steps


def _convert_fraction(frac: Fraction, base: int, limit: int = 16) -> tuple[str, list[str]]:
    if frac == 0:
        return "", []
    digits: list[str] = []
    steps: list[str] = []
    seen: set[Fraction] = set()
    current = frac
    for _ in range(limit):
        if current == 0:
            break
        if current in seen:
            steps.append("出现循环，小数部分按循环截断")
            break
        seen.add(current)
        current *= base
        digit = int(current)
        digits.append(_BASE_DIGITS[digit])
        steps.append(f"{_round_fraction(current / base)} × {base} = {digit}.{_round_fraction(current - digit)}，取整 {digit}")
        current -= digit
    return "".join(digits), steps


def _eval_base_conversion(text: str) -> dict[str, Any]:
    subscripts = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")
    text = text.translate(subscripts)
    special = re.search(
        r"[（(]\s*([0-9A-Fa-f]+(?:\.[0-9A-Fa-f]+)?)\s*[）)]\s*_?(\d+)", text)
    match = re.search(
        r"(?:将|把)?\s*([0-9A-Fa-f]+(?:\.[0-9A-Fa-f]+)?)\s*"
        r"(?:[（(]\s*(\d+)\s*[）)]|\s*(_?)(\d+))?\s*"
        r"(二进制|八进制|十进制|十六进制)?\s*(?:数)?\s*"
        r"(?:转换|转成|转为|化为|变成|转)\s*(?:为|成)?\s*"
        r"(?:(\d+)\s*进制|(\d+)|(二进制|八进制|十进制|十六进制))",
        text)
    if special is None and not match:
        raise ValueError("请用“将 (1011)₂ 转换为十进制”或“将十进制 45 转为二进制”的写法给出")
    if special is not None:
        token = special.group(1)
        bracket_base = int(special.group(2))
        source_word = None
        target_match = re.search(
            r"(?:转换|转成|转为|化为|变成|转)\s*(?:为|成)?\s*"
            r"(?:(\d+)\s*进制|(\d+)|(二进制|八进制|十进制|十六进制))", text)
        if not target_match:
            raise ValueError("未识别到目标进制")
        target_num = target_match.group(1) or target_match.group(2)
        target_word = target_match.group(3)
    else:
        token = match.group(1)
        bracket_base = int(match.group(2)) if match.group(2) else None
        source_word = match.group(5)
        target_word = match.group(8)
        target_num = match.group(7) or match.group(6)
        if not source_word:
            prefix = text[:match.start(1)]
            prefix_match = re.search(r"(二进制|八进制|十进制|十六进制)\s*(?:数)?\s*$", prefix)
            if prefix_match:
                source_word = prefix_match.group(1)
    target_base = int(target_num) if target_num else _BASE_WORDS.get(target_word or "", 10)
    prefix_base = None
    lower = token.lower()
    if lower.startswith("0x"):
        prefix_base, token = 16, token[2:]
    elif lower.startswith("0b"):
        prefix_base, token = 2, token[2:]
    elif lower.startswith("0o"):
        prefix_base, token = 8, token[2:]
    source_base = bracket_base or prefix_base or _BASE_WORDS.get(source_word or "", 0)
    if not source_base:
        source_base = 2 if (target_base == 10 and re.fullmatch(r"[01]+(?:\.[01]+)?", token)
                            and len(token) >= 4) else 10
    if not (2 <= source_base <= 16 and 2 <= target_base <= 16):
        raise ValueError("进制范围仅支持 2–16")
    value = _parse_base_fraction(token, source_base)
    sign = "-" if value < 0 else ""
    absolute = abs(value)
    integer_part = int(absolute)
    fraction_part = absolute - integer_part
    int_digits, int_steps = _convert_integer(integer_part, target_base)
    frac_digits, frac_steps = _convert_fraction(fraction_part, target_base)
    converted = sign + int_digits + (f".{frac_digits}" if frac_digits else "")
    frames = [
        _frame(1, "识别原数", f"{_base_label(token, source_base)} 按位权展开，真值 = {_round_fraction(value)}。",
               {"源进制": source_base, "目标进制": target_base, "真值": _round_fraction(value)}, 1),
        _frame(2, "整数部分：除基取余", "；".join(int_steps) + f"；余数逆序得到 {int_digits}。",
               {"整数部分": int_digits}, 2),
    ]
    if frac_steps:
        frames.append(_frame(3, "小数部分：乘基取整", "；".join(frac_steps) + f"；得到 0.{frac_digits}。",
                             {"小数部分": f"0.{frac_digits}"}, 2))
    answer = (f"{_base_label(token, source_base)} = {_base_label(converted, target_base)}"
              f"（{_base_name(target_base)}，真值 {_round_fraction(value)}）")
    checks = [_check("digits", "数位合法", True, f"{source_base} 进制下每一位均小于基数。"),
              _check("order", "余数逆序", True, "整数部分除基取余，余数逆序排列。")]
    notes = ["小数部分持续乘基取整；出现循环或超出 16 位时按教学精度截断。"]
    frames.append(_frame(len(frames) + 1, "结果", answer, {"结果": converted}, 4))
    return _ok("data_repr", answer, frames, PSEUDOCODES["data_repr"], checks, notes,
               answer_value=float(value), answer_order=[converted])


def _encode_original(value: int, width: int) -> str:
    sign = 1 if value < 0 else 0
    magnitude = abs(value)
    return f"{sign}{magnitude:0{width - 1}b}"


def _encode_ones(value: int, width: int) -> str:
    if value >= 0:
        return format(value, f"0{width}b")
    return format((~(abs(value))) & ((1 << width) - 1), f"0{width}b")


def _encode_twos(value: int, width: int) -> str:
    return format(value & ((1 << width) - 1), f"0{width}b")


def _encode_bias(value: int, width: int) -> str:
    return format(value + (1 << (width - 1)), f"0{width}b")


def _decode_code(bits: str, code: str) -> int:
    width = len(bits)
    unsigned = int(bits, 2)
    sign_bit = int(bits[0])
    if code == "原码":
        magnitude = unsigned & ((1 << (width - 1)) - 1)
        return -magnitude if sign_bit else magnitude
    if code == "反码":
        if sign_bit == 0:
            return unsigned
        return -((~unsigned) & ((1 << width) - 1))
    if code == "移码":
        return unsigned - (1 << (width - 1))
    return unsigned - (1 << width) if sign_bit else unsigned


def _eval_machine_code(text: str) -> dict[str, Any]:
    width = _width(text, 8)
    if width < 2 or width > MAX_BITS:
        raise ValueError(f"位宽仅支持 2–{MAX_BITS} 位")
    bits = _bits_token(text)
    sign_extend = "符号扩展" in text or "符号位扩展" in text
    target_match = re.search(r"(?:扩展|扩宽|扩展至|扩展为)\s*(?:到)?\s*(\d{1,3})\s*位", text)
    target_width = int(target_match.group(1)) if target_match else None
    codes = [code for code in ("原码", "反码", "补码", "移码") if code in text]
    if not codes:
        codes = ["补码"]
    value_match = re.search(r"(?:真值|十进制数?|数值|十进制)\s*(?:为|是|:)?\s*(-?\d+)", text)
    if value_match:
        value = int(value_match.group(1))
    elif bits is None:
        candidates = [int(item) for item in re.findall(r"(?<!\d)(-?\d+)", text)]
        candidates = [item for item in candidates if item != width]
        if not candidates:
            raise ValueError("未识别到位串或十进制真值")
        value = candidates[0]
    else:
        value = _decode_code(bits, codes[0])

    if sign_extend and bits is None:
        if target_width is None or not (width < target_width <= 64):
            raise ValueError("符号扩展需要给出更宽的目标位宽，例如“扩展到 16 位”")
        source_bits = _to_bits(value, width)
        extended = source_bits[0] * (target_width - width) + source_bits
        frames = [
            _frame(1, "写出源补码", f"{value} 的 {width} 位补码：{_group_bits(source_bits)}。",
                   {"源位串": source_bits, "真值": str(value)}, 1),
            _frame(2, "符号扩展", f"复制符号位 {source_bits[0]} {target_width - width} 次，得到 "
                                 f"{_group_bits(extended)}；真值保持 {value}。",
                   {"扩展后": extended}, 2),
        ]
        answer = f"{value} 的 {width} 位补码 {source_bits} 符号扩展为 {target_width} 位：{extended}（真值不变）"
        return _ok("data_repr", answer, frames, PSEUDOCODES["data_repr"],
                   [_check("sign", "符号位保持", True, "补码符号扩展复制最高位，真值不变。")],
                   ["正数高位补 0，负数高位补 1。"], answer_value=float(value), answer_order=[extended])

    signed_unsigned = ("无符号" in text and "有符号" in text
                       and re.search(r"转换|转为|转成|视为|解释|看作", text))
    if signed_unsigned and bits is None:
        if "无符号" in text and re.search(r"无符号[^。；;\n]{0,16}(转换|转为|转成)", text):
            bits_value = _to_bits(value, width)
            signed_value = _twos(int(bits_value, 2), width)
            frames = [
                _frame(1, "写出无符号位串", f"{value} 写成 {width} 位无符号数：{_group_bits(bits_value)}。",
                       {"无符号值": str(value), "位串": bits_value}, 1),
                _frame(2, "按补码解释", f"最高位是 1 时表示负数：{_group_bits(bits_value)} → {signed_value}。",
                       {"有符号值": str(signed_value)}, 2),
            ]
            answer = f"{width} 位无符号数 {value} 的位串为 {bits_value}，按补码解释为有符号数 {signed_value}"
            return _ok("data_repr", answer, frames, PSEUDOCODES["data_repr"],
                       [_check("same_bits", "位串不变", True, "有无符号只是解释方式不同，位串保持相同。")],
                       ["无符号数超过 2^(n−1)−1 时，按补码解释会得到负值。"],
                       answer_value=float(signed_value), answer_order=[bits_value])
        if "有符号" in text and re.search(r"有符号[^。；;\n]{0,16}(转换|转为|转成)", text):
            bits_value = _to_bits(value, width)
            unsigned_value = int(bits_value, 2)
            frames = [
                _frame(1, "写出补码位串", f"{value} 写成 {width} 位补码：{_group_bits(bits_value)}。",
                       {"有符号值": str(value), "位串": bits_value}, 1),
                _frame(2, "按无符号解释", f"同一组位串的无符号值为 {unsigned_value}。",
                       {"无符号值": str(unsigned_value)}, 2),
            ]
            answer = f"{width} 位有符号数 {value} 的补码为 {bits_value}，按无符号解释为 {unsigned_value}"
            return _ok("data_repr", answer, frames, PSEUDOCODES["data_repr"],
                       [_check("same_bits", "位串不变", True, "有无符号只是解释方式不同，位串保持相同。")],
                       ["负数按无符号解释时等于 真值 + 2^n。"],
                       answer_value=float(unsigned_value), answer_order=[bits_value])

    if bits is not None:
        if len(bits) != width and not sign_extend:
            width = len(bits)
        if len(bits) != width:
            raise ValueError(f"位串长度 {len(bits)} 与题面位宽 {width} 不一致")
        interpretations = {code: _decode_code(bits, code) for code in ("原码", "反码", "补码", "移码")}
        frames = [_frame(1, "拆分符号位与数值位", f"{width} 位位串：{_group_bits(bits)}；符号位 = {bits[0]}。",
                         {"位串": bits, "符号位": bits[0], "位宽": str(width)}, 1)]
        if sign_extend:
            if target_width is None or not (width < target_width <= 64):
                raise ValueError("符号扩展需要给出更宽的目标位宽，例如“扩展到 16 位”")
            fill = bits[0] * (target_width - width)
            extended = fill + bits
            frames.append(_frame(2, "符号扩展", f"复制符号位 {bits[0]} {target_width - width} 次：{_group_bits(extended)}。",
                                 {"扩展后": extended, "真值不变": str(_decode_code(bits, "补码"))}, 2))
            answer = f"{width} 位位串 {bits} 符号扩展为 {target_width} 位：{extended}（真值 {interpretations['补码']}）"
            return _ok("data_repr", answer, frames, PSEUDOCODES["data_repr"],
                       [_check("sign", "符号位保持", True, "符号扩展复制最高位，补码真值保持不变。")],
                       ["符号扩展适用于补码/无符号高位填充；原码扩展还需单独保持符号位。"],
                       answer_order=[extended])
        answer_bits = [f"{code}：{interpretations[code]}" for code in ("原码", "反码", "补码", "移码")]
        frames.append(_frame(2, "按不同码制解释", "；".join(answer_bits) + "。",
                             {"无符号值": str(int(bits, 2)), **{code: str(interpretations[code]) for code in interpretations}}, 2))
        answer = f"{width} 位位串 {bits}：" + "；".join(answer_bits)
        notes = ["同一组位串按不同码制解释会得到不同真值；无符号解释为 " + str(int(bits, 2)) + "。"]
        return _ok("data_repr", answer, frames, PSEUDOCODES["data_repr"],
                   [_check("width", "位宽一致", True, "符号位与数值位共 n 位。")], notes,
                   answer_value=float(interpretations["补码"]))

    if value < -(1 << (width - 1)) or value > (1 << (width - 1)) - 1:
        raise ValueError(f"{width} 位有符号数范围是 [−{1 << (width - 1)}, {(1 << (width - 1)) - 1}]")
    encoded = {
        "原码": _encode_original(value, width),
        "反码": _encode_ones(value, width),
        "补码": _encode_twos(value, width),
        "移码": _encode_bias(value, width),
    }
    frames = [
        _frame(1, "确定位宽与范围", f"{width} 位补码范围：[−{1 << (width - 1)}, {(1 << (width - 1)) - 1}]；真值 {value}。",
               {"位宽": str(width), "真值": str(value)}, 1),
        _frame(2, "求各码制编码", "；".join(f"{code} = {_group_bits(bits_value)}" for code, bits_value in encoded.items()),
               {code: bits_value for code, bits_value in encoded.items()}, 2),
    ]
    if "无符号" in text and value < 0:
        frames.append(_frame(3, "有符号/无符号", f"负数在无符号解释下会变成模 2^{width} 的数："
                             f"{int(encoded['补码'], 2)}。", {"无符号解释": str(int(encoded["补码"], 2))}, 3))
    wanted = codes or list(encoded)
    answer = f"{value} 的 {width} 位 " + "；".join(f"{code} = {_group_bits(encoded[code])}" for code in wanted)
    checks = [_check("range", "范围检查", True, f"真值在 {width} 位有符号范围内。"),
              _check("bias", "移码偏移", True, f"移码 = 真值 + 2^{width - 1} = 真值 + {1 << (width - 1)}。")]
    return _ok("data_repr", answer, frames, PSEUDOCODES["data_repr"], checks,
               ["原码与反码存在 +0/−0 两种零编码；补码的零唯一。"],
               answer_value=float(value),
               answer_order=[encoded[code] for code in wanted])


# ---------------------------------------------------------------------------
# 3) 定点运算
# ---------------------------------------------------------------------------

def _parse_operand(text: str, labels: str, width: int, default: int | None = None) -> int | None:
    match = re.search(
        rf"(?:{labels})\s*(?:=|为|是|:|：)?\s*([01](?:[\s_]?[01]){{{max(3, width - 1)},63}}|-?\d+)",
        text, re.I)
    if not match:
        return default
    token = match.group(1)
    compact = re.sub(r"[\s_]", "", token)
    if re.fullmatch(r"[01]+", compact) and len(compact) >= 4:
        return int(compact, 2)
    return int(token)


def _signed_binary_expr(text: str) -> tuple[int, str, int] | None:
    match = re.search(r"\(?\s*(-?\d+)\s*\)?\s*([+\-−])\s*\(?\s*(-?\d+)\s*\)?", text)
    if not match:
        return None
    op = "-" if match.group(2) in ("-", "−") else "+"
    return int(match.group(1)), op, int(match.group(3))


def _operands_two(text: str, width: int) -> tuple[int, int] | None:
    expression = _signed_binary_expr(text)
    if expression:
        return expression[0], expression[2]
    a = _parse_operand(text, r"A|X|操作数1|被加数|被减数|被乘数|被除数|第一个数", width)
    b = _parse_operand(text, r"B|Y|操作数2|加数|减数|乘数|除数|第二个数", width)
    if a is not None and b is not None:
        return a, b
    patterns = re.findall(r"(?<![0-9A-Za-z])[01](?:[\s_]?[01]){3,63}(?![0-9A-Za-z])", text)
    compact = [re.sub(r"[\s_]", "", item) for item in patterns]
    if len(compact) >= 2:
        return int(compact[0], 2), int(compact[1], 2)
    numbers = [int(item) for item in re.findall(r"(?<!\d)(-?\d+)", text)
               if int(item) not in (width,)]
    if len(numbers) >= 2:
        return numbers[0], numbers[1]
    return None


def _eval_fixed_addsub(text: str) -> dict[str, Any]:
    width = _width(text, 8)
    if width > MAX_BITS:
        raise ValueError(f"定点运算演示最多支持 {MAX_BITS} 位")
    operands = _operands_two(text, width)
    if operands is None:
        raise ValueError("需要两个操作数（A、B）或形如 5 + (-3) 的表达式")
    a_value, b_value = operands
    subtraction = bool(re.search(r"减法|相减|-\s*B|B\s*为减数", text) or "-" in text and "减法" in text
                       or re.search(r"计算\s*\(?\s*-?\d+\s*\)?\s*[-−]\s*\(?\s*-?\d+", text))
    expression = _signed_binary_expr(text)
    if expression:
        subtraction = expression[1] == "-"
    if not -(1 << (width - 1)) <= a_value <= (1 << (width - 1)) - 1 \
            or not -(1 << (width - 1)) <= b_value <= (1 << (width - 1)) - 1:
        raise ValueError(f"{width} 位补码操作数超出范围")
    mask = (1 << width) - 1
    a_bits = _to_bits(a_value, width)
    b_bits = _to_bits(b_value, width)
    a_u, b_u = int(a_bits, 2), int(b_bits, 2)
    if subtraction:
        raw = a_u + ((1 << width) - b_u)
        operation = f"{a_value} − ({b_value})"
        op_text = "A − B = A + (−B)补"
    else:
        raw = a_u + b_u
        operation = f"{a_value} + {b_value}"
        op_text = "A + B"
    carry = (raw >> width) & 1
    result_bits = format(raw & mask, f"0{width}b")
    result = _twos(raw & mask, width)
    if subtraction:
        borrow = int(a_u < b_u)
        cf = borrow
        of = 1 if (a_value >= 0) != (b_value >= 0) and (result >= 0) != (a_value >= 0) else 0
    else:
        cf = carry
        of = 1 if (a_value >= 0) == (b_value >= 0) and (result >= 0) != (a_value >= 0) else 0
    zf = 1 if (raw & mask) == 0 else 0
    sf = int(result_bits[0])
    frames = [
        _frame(1, "写出补码", f"A = {a_value} → {_group_bits(a_bits)}；B = {b_value} → {_group_bits(b_bits)}。",
               {"A补": a_bits, "B补": b_bits, "位宽": str(width)}, 1),
        _frame(2, "补码运算", f"{op_text}：按位相加并丢弃第 {width + 1} 位。",
               {"算式": operation, "结果位串": result_bits}, 2),
        _frame(3, "结果与标志", f"结果补码 {_group_bits(result_bits)}，真值 {result}；"
                                f"CF={cf}，ZF={zf}，SF={sf}，OF={of}。",
               {"结果": str(result), "CF": str(cf), "ZF": str(zf), "SF": str(sf), "OF": str(of)}, 3),
    ]
    overflow_text = "发生溢出（OF=1）" if of else "无溢出（OF=0）"
    answer = (f"{operation} = {result}；补码 {_group_bits(result_bits)}；{overflow_text}；"
              f"CF={cf}，ZF={zf}，SF={sf}")
    checks = [
        _check("overflow", "溢出判断", of == ((a_value >= 0) == (b_value >= 0) and (result >= 0) != (a_value >= 0))
               if not subtraction else of == ((a_value >= 0) != (b_value >= 0) and (result >= 0) != (a_value >= 0)),
               "同号相加结果异号，或异号相减结果与被减数异号时 OF=1。"),
        _check("flags", "标志位口径", True, "CF 对加法为最高位进位、对减法为借位；SF 取结果最高位，ZF 看结果是否全 0。"),
    ]
    return _ok("fixed_point", answer, frames, PSEUDOCODES["fixed_point"], checks,
               ["补码减法化为加上减数的补码（按位取反加一）。", "CF 采用 408 常见的“加法进位/减法借位”口径。"],
               answer_value=float(result),
               answer_order=[result_bits])


def _eval_fixed_shift(text: str) -> dict[str, Any]:
    width = _width(text, 8)
    bits = _bits_token(text)
    if bits is None:
        numbers = [int(item) for item in re.findall(r"(?<!\d)(-?\d+)", text) if int(item) != width]
        if not numbers:
            raise ValueError("需要给定位串或十进制数")
        bits = _to_bits(numbers[0], width)
    if len(bits) > MAX_BITS:
        raise ValueError(f"移位演示最多支持 {MAX_BITS} 位")
    width = len(bits)
    count_match = re.search(r"(?:左移|右移|算术右移|逻辑右移|循环右移|循环左移|移位)\s*(\d+)\s*位", text)
    count = int(count_match.group(1)) if count_match else 1
    if not (1 <= count <= width):
        raise ValueError(f"移位次数应在 1–{width} 之间")
    if "算术右移" in text:
        mode, fill = "算术右移", bits[0]
    elif "逻辑右移" in text:
        mode, fill = "逻辑右移", "0"
    elif "循环右移" in text:
        mode, fill = "循环右移", ""
    elif "循环左移" in text:
        mode, fill = "循环左移", ""
    elif "左移" in text:
        mode, fill = "逻辑左移", "0"
    else:
        mode, fill = "逻辑右移", "0"
    frames = [_frame(1, "初始位串", f"{width} 位：{_group_bits(bits)}；执行{mode} {count} 位。",
                     {"初始": bits, "方式": mode, "次数": str(count)}, 1)]
    current = bits
    carry = 0
    steps_detail: list[str] = []
    for step in range(1, count + 1):
        if mode in ("算术右移", "逻辑右移"):
            carry = int(current[-1])
            current = (fill + current[:-1]) if mode == "算术右移" else ("0" + current[:-1])
        elif mode == "循环右移":
            carry = int(current[-1])
            current = current[-1] + current[:-1]
        elif mode == "循环左移":
            carry = int(current[0])
            current = current[1:] + current[0]
        else:
            carry = int(current[0])
            current = current[1:] + "0"
        steps_detail.append(f"第 {step} 次：{current}")
        frames.append(_frame(len(frames) + 1, f"第 {step} 次移位", steps_detail[-1],
                             {"当前位串": current, "移出位": str(carry)}, 2))
    signed = _twos(int(current, 2), width)
    answer = f"{mode} {count} 位后：{_group_bits(current)}；无符号值 {int(current, 2)}，补码真值 {signed}"
    checks = [_check("fill", "填充规则", True, "算术右移补符号位，逻辑移位补 0。"),
              _check("carry", "移出位", True, f"最后一次移出位 CF = {carry}。")]
    return _ok("fixed_point", answer, frames, PSEUDOCODES["fixed_point"], checks,
               ["算术左移与逻辑左移在低位都补 0；差别体现在右移的高位填充。"],
               answer_value=float(signed), answer_order=[current])


def _eval_fixed_muldiv(text: str) -> dict[str, Any]:
    width = _width(text, 8)
    if width > MAX_BITS:
        raise ValueError(f"乘除演示最多支持 {MAX_BITS} 位")
    operands = _operands_two(text, width)
    if operands is None:
        raise ValueError("需要被乘数/乘数或被除数/除数两个操作数")
    a_value, b_value = operands
    is_division = bool(re.search(r"除法|除以|相除|÷|/", text))
    sign = -1 if (a_value < 0) != (b_value < 0) else 1
    a, b = abs(a_value), abs(b_value)
    if not a <= (1 << width) - 1 or not b <= (1 << width) - 1:
        raise ValueError(f"操作数绝对值应不超过 {width} 位无符号范围")
    if is_division:
        if b == 0:
            raise ValueError("除数不能为 0")
        quotient, remainder = divmod(a, b)
        q_value = sign * quotient
        r_value = -remainder if a_value < 0 else remainder
        frames = [
            _frame(1, "符号位单独处理", f"被除数 {a_value}、除数 {b_value}；结果符号为 {'−' if sign < 0 else '+'}，对绝对值做恢复余数除法。",
                   {"被除数": str(a), "除数": str(b), "结果符号": "负" if sign < 0 else "正"}, 1),
        ]
        remainder_work = 0
        quotient_bits: list[str] = []
        dividend_bits = _to_bits(a, width)
        for position, bit_char in enumerate(dividend_bits):
            remainder_work = (remainder_work << 1) | int(bit_char)
            if remainder_work >= b:
                remainder_work -= b
                bit = "1"
            else:
                bit = "0"
            quotient_bits.append(bit)
            frames.append(_frame(len(frames) + 1, f"第 {position + 1} 步",
                                 f"余数左移并引入被除数当前位 {bit_char}，试减除数：余数 {remainder_work}，商位 {bit}。",
                                 {"余数": str(remainder_work), "商位": bit}, 2))
        quotient_bits_text = "".join(quotient_bits)
        answer = (f"{a_value} ÷ {b_value}：商 = {q_value}，余数 = {r_value}；"
                  f"绝对值商位串 {quotient_bits_text}")
        return _ok("fixed_point", answer, frames, PSEUDOCODES["fixed_point"],
                   [_check("restore", "恢复余数", True, "余数小于除数时补 0；够减则减去除数并置商位 1。")],
                   ["若题目要求补码一位除，符号位与绝对值处理与本演示同口径；移位次数取决于字长。"],
                   answer_value=float(q_value), answer_order=[quotient_bits_text])
    product = 0
    frames = [
        _frame(1, "符号位单独处理", f"被乘数 {a_value}、乘数 {b_value}；结果符号为 {'−' if sign < 0 else '+'}。",
               {"被乘数": str(a), "乘数": str(b), "结果符号": "负" if sign < 0 else "正"}, 1),
    ]
    multiplier_bits = _to_bits(b, width)
    for index, bit in enumerate(reversed(multiplier_bits)):
        partial = (a << index) if bit == "1" else 0
        product += partial
        frames.append(_frame(len(frames) + 1, f"处理乘数第 {index} 位",
                             f"乘数最低位起第 {index} 位为 {bit}，部分积 = {partial}，累计 {product}。",
                             {"乘数位": bit, "部分积": str(partial), "累计": str(product)}, 2))
    result = sign * product
    factors = f"{a_value} × {b_value} = {result}"
    bits_result = format(product, f"0{min(2 * width, 64)}b")
    answer = f"{factors}；绝对值乘积位串 {bits_result}"
    return _ok("fixed_point", answer, frames, PSEUDOCODES["fixed_point"],
               [_check("shift_add", "移位相加", True, "乘数从低位到高位，逐位决定是否加被乘数左移后的部分积。")],
               ["原码乘法符号位单独处理；补码一位乘的附加位与算术右移步骤未在本演示中展开。"],
               answer_value=float(result), answer_order=[bits_result])


# ---------------------------------------------------------------------------
# 4) 浮点数
# ---------------------------------------------------------------------------

def _float_format(text: str) -> dict[str, Any]:
    double = bool(re.search(r"双精度|64\s*位|double", text, re.I))
    single = bool(re.search(r"单精度|32\s*位|float", text, re.I))
    if double and not single:
        return {"name": "双精度", "width": 64, "exp_bits": 11, "frac_bits": 52, "bias": 1023}
    return {"name": "单精度", "width": 32, "exp_bits": 8, "frac_bits": 23, "bias": 127}


def _format_changed(text: str) -> dict[str, Any]:
    fmt_spec = _float_format(text)
    fmt_spec["name"] = "双精度" if fmt_spec["width"] == 64 else "单精度"
    return fmt_spec


def _fields(bits: str, spec: Mapping[str, Any]) -> dict[str, Any]:
    width, exp_bits = int(spec["width"]), int(spec["exp_bits"])
    if len(bits) != width:
        raise ValueError(f"{spec['name']}需要 {width} 位位串")
    sign = int(bits[0])
    exponent = int(bits[1:1 + exp_bits], 2)
    fraction = bits[1 + exp_bits:]
    bias = int(spec["bias"])
    if exponent == (1 << exp_bits) - 1:
        kind = "Infinity" if int(fraction, 2) == 0 else "NaN"
        value = math.inf if kind == "Infinity" and sign == 0 else (-math.inf if kind == "Infinity" else math.nan)
        return {"sign": sign, "exponent": exponent, "fraction": fraction,
                "kind": kind, "value": value, "exponent_value": None}
    if exponent == 0:
        kind = "zero" if int(fraction, 2) == 0 else "subnormal"
        value = ((-1) ** sign) * (int(fraction, 2) / (1 << int(spec["frac_bits"]))) * (2 ** (1 - bias))
        return {"sign": sign, "exponent": exponent, "fraction": fraction,
                "kind": kind, "value": value, "exponent_value": 1 - bias}
    mantissa = 1 + int(fraction, 2) / (1 << int(spec["frac_bits"]))
    value = ((-1) ** sign) * mantissa * (2 ** (exponent - bias))
    return {"sign": sign, "exponent": exponent, "fraction": fraction,
            "kind": "normal", "value": value, "exponent_value": exponent - bias}


def _encode_float(value: float, spec: Mapping[str, Any]) -> tuple[str, str]:
    try:
        if spec["width"] == 32:
            raw = struct.pack(">f", value)
            bits = format(int.from_bytes(raw, "big"), "032b")
        else:
            raw = struct.pack(">d", value)
            bits = format(int.from_bytes(raw, "big"), "064b")
    except OverflowError:
        value = math.copysign(math.inf, value)
        bits = (("1" if value < 0 else "0") + "1" * int(spec["exp_bits"]) + "0" * int(spec["frac_bits"]))
    return bits, f"0x{int(bits, 2):0{int(spec['width']) // 4}X}"


def _normalized_text(fields: Mapping[str, Any], spec: Mapping[str, Any]) -> str:
    sign = -1 if fields["sign"] else 1
    if fields["kind"] == "NaN":
        return "NaN"
    if fields["kind"] == "Infinity":
        return "−∞" if sign < 0 else "+∞"
    if fields["kind"] == "zero":
        return "−0" if sign < 0 else "+0"
    frac = str(fields["fraction"])
    if fields["kind"] == "normal":
        return f"{sign} × 1.{frac} × 2^{fields['exponent_value']}"
    return f"{sign} × 0.{frac} × 2^{fields['exponent_value']}"


def _float_tokens(text: str) -> list[float]:
    tokens = re.findall(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?", text)
    values: list[float] = []
    for token in tokens:
        if token in ("32", "64", "754"):
            continue
        try:
            values.append(float(token))
        except ValueError:
            continue
    return values


def _eval_floating(text: str) -> dict[str, Any]:
    spec = _format_changed(text)
    width = int(spec["width"])
    bits_token = None
    hex_digits = width // 4
    hex_match = re.search(rf"0[xX]\s*([0-9A-Fa-f]{{{hex_digits}}})|\b([0-9A-Fa-f]{{{hex_digits}}})[Hh]\b", text)
    if hex_match:
        hex_raw = hex_match.group(1) or hex_match.group(2)
        bits_token = format(int(hex_raw, 16), f"0{width}b")
    else:
        candidate = _bits_token(text)
        if candidate and len(candidate) in (32, 64):
            bits_token = candidate
            spec = _format_changed("双精度" if len(bits_token) == 64 else "单精度")
    numbers = _float_tokens(text)
    wants_add = bool(re.search(r"加法|相加|求和|相加得|和是多少", text)) or (
        "加" in text and len(numbers) >= 2)
    wants_range = bool(re.search(
        r"表示范围|范围|最大值|最小值|最大有限|最小规格化|最小非零|最大正数|最小正数|"
        r"机器epsilon|机器精度|有效精度|精度是多少", text, re.I))

    if wants_range and bits_token is None and not wants_add:
        exp_bits, frac_bits, bias = int(spec["exp_bits"]), int(spec["frac_bits"]), int(spec["bias"])
        max_exp = (1 << exp_bits) - 2
        max_finite = (2 - 2 ** (-frac_bits)) * 2 ** (max_exp - bias)
        min_normal = 2 ** (1 - bias)
        min_subnormal = 2 ** (1 - bias - frac_bits)
        machine_eps = 2 ** (-frac_bits)
        digits = math.floor(frac_bits * math.log10(2)) + 1
        frames = [
            _frame(1, "格式参数", f"{spec['name']}：1 位符号 + {exp_bits} 位阶码 + {frac_bits} 位尾数，偏置 {bias}。",
                   {"格式": spec["name"], "阶码位": str(exp_bits), "尾数位": str(frac_bits), "偏置": str(bias)}, 1),
            _frame(2, "范围", f"最大有限数 = (2 − 2^−{frac_bits}) × 2^{max_exp - bias} ≈ {fmt(max_finite)}；"
                             f"最小规格化正数 = 2^{1 - bias} ≈ {fmt(min_normal)}；最小非零正数 = {fmt(min_subnormal)}。",
                   {"最大有限数": fmt(max_finite), "最小规格化正数": fmt(min_normal), "最小非零正数": fmt(min_subnormal)}, 2),
            _frame(3, "精度", f"机器 epsilon = 2^{1 - bias} ≈ {fmt(machine_eps)}；约 {digits} 位有效十进制数字。",
                   {"机器epsilon": fmt(machine_eps), "有效十进制位": str(digits)}, 3),
        ]
        answer = (f"{spec['name']}：最大有限数 ≈ {fmt(max_finite)}，最小规格化正数 ≈ {fmt(min_normal)}，"
                  f"最小非零正数 ≈ {fmt(min_subnormal)}，机器 epsilon ≈ {fmt(machine_eps)}，约 {digits} 位有效十进制数字")
        return _ok("floating", answer, frames, PSEUDOCODES["floating"],
                   [_check("bias", "阶码偏置", True, f"bias = 2^(e−1) − 1 = {bias}。")],
                   ["上溢到 ±∞；下溢通常舍入为 0 或非规格化数。"])

    if wants_add and len(numbers) >= 2:
        a, b = numbers[0], numbers[1]
        bits_a, hex_a = _encode_float(a, spec)
        bits_b, hex_b = _encode_float(b, spec)
        raw_sum = a + b
        if spec["width"] == 32:
            try:
                rounded = struct.unpack(">f", struct.pack(">f", raw_sum))[0]
            except OverflowError:
                rounded = math.copysign(math.inf, raw_sum)
        else:
            rounded = raw_sum
        bits_s, hex_s = _encode_float(rounded, spec)
        fa, fb, fs = _fields(bits_a, spec), _fields(bits_b, spec), _fields(bits_s, spec)
        overflow = math.isinf(rounded)
        min_subnormal = 2 ** (1 - int(spec["bias"]) - int(spec["frac_bits"]))
        underflow = rounded == 0 and a != 0 and b != 0 and abs(raw_sum) < min_subnormal
        frames = [
            _frame(1, "写出操作数", f"A = {a} → {hex_a}；B = {b} → {hex_b}。",
                   {"A": hex_a, "B": hex_b, "格式": spec["name"]}, 1),
            _frame(2, "对阶与尾数相加", "按阶码对齐后相加，结果按就近舍入到偶数规约到目标格式。",
                   {"A阶码": str(fa["exponent_value"]), "B阶码": str(fb["exponent_value"])}, 2),
            _frame(3, "规格化与舍入", f"和 = {fmt(rounded)}，编码 {hex_s}（{_normalized_text(fs, spec)}）。",
                   {"结果": fmt(rounded), "编码": hex_s}, 3),
        ]
        flags = []
        if overflow:
            flags.append("上溢（结果为 ±∞）")
        if underflow:
            flags.append("下溢（舍入为 0）")
        answer = f"{a} + {b} = {fmt(rounded)}；{spec['name']}编码 {hex_s}" + (f"；{'、'.join(flags)}" if flags else "；未上溢/下溢")
        checks = [_check("round", "舍入", True, "按 IEEE 754 默认的就近舍入到偶数处理。"),
                  _check("range", "溢出检查", not overflow, "结果指数超过最大阶码时上溢为 ±∞。")]
        return _ok("floating", answer, frames, PSEUDOCODES["floating"], checks,
                   ["本演示使用宿主浮点运算后再按目标格式舍入；教学题若要求逐位对阶，可展开尾数位。"],
                   answer_value=rounded)

    if bits_token is not None:
        fields = _fields(bits_token, spec)
        hex_text = f"0x{int(bits_token, 2):0{width // 4}X}"
        frames = [
            _frame(1, "拆分字段", f"符号位 {bits_token[0]}，阶码 {bits_token[1:1 + int(spec['exp_bits'])]}，"
                                  f"尾数 {bits_token[1 + int(spec['exp_bits']):]}。",
                   {"编码": hex_text, "类别": fields["kind"]}, 1),
            _frame(2, "计算阶码真值", f"阶码字段 = {fields['exponent']}，减去偏置 {spec['bias']} 得 "
                                     f"{fields['exponent_value']}。", {"阶码真值": str(fields["exponent_value"])}, 2),
            _frame(3, "还原真值", f"按规格化/非规格化规则还原：{_normalized_text(fields, spec)} = {fmt(fields['value'])}。",
                   {"真值": fmt(fields["value"]), "规格化形式": _normalized_text(fields, spec)}, 3),
        ]
        answer = f"{hex_text} 解码为 {spec['name']}：{_normalized_text(fields, spec)}，真值 = {fmt(fields['value'])}"
        val = fields["value"]
        numeric_val = float(val) if isinstance(val, (int, float)) and math.isfinite(float(val)) else None
        return _ok("floating", answer, frames, PSEUDOCODES["floating"],
                   [_check("fields", "字段拆分", True, "IEEE 754 按符号、阶码、尾数三段拆分。")],
                   ["阶码全 0 为非规格化/零，阶码全 1 为无穷/NaN。"],
                   answer_value=numeric_val, answer_order=[fmt(val), hex_text, bits_token])

    if not numbers:
        raise ValueError("未识别到待编码的十进制浮点数或 IEEE 754 位串")
    value = numbers[0]
    bits, hex_text = _encode_float(value, spec)
    fields = _fields(bits, spec)
    frames = [
        _frame(1, "确定格式", f"{spec['name']}：符号 1 位、阶码 {spec['exp_bits']} 位、尾数 {spec['frac_bits']} 位。",
               {"格式": spec["name"], "偏置": str(spec["bias"])}, 1),
        _frame(2, "规格化", f"{value} = {_normalized_text(fields, spec)}。",
               {"规格化形式": _normalized_text(fields, spec)}, 2),
        _frame(3, "编码", f"符号 {fields['sign']}，阶码字段 {fields['exponent']}，尾数字段 {fields['fraction']}；"
                          f"得到 {hex_text}。", {"编码": hex_text, "位串": bits}, 3),
    ]
    answer = f"{value} 的 {spec['name']} IEEE 754 编码为 {hex_text}（{_group_bits(bits)}）"
    return _ok("floating", answer, frames, PSEUDOCODES["floating"],
               [_check("normalized", "规格化", fields["kind"] in ("normal", "subnormal", "zero"),
                       "规格化数尾数隐含最高位 1；非规格化数隐含 0。"),
                _check("round", "舍入", True, "十进制转二进制尾数时按目标格式舍入。")],
               ["十六进制与二进制位串是同一编码的两种写法。"],
               answer_value=value, answer_order=[hex_text, bits])


# ---------------------------------------------------------------------------
# 5) 运算器与数据通路
# ---------------------------------------------------------------------------

_ALU_OPS = [
    ("sub", r"减法|SUB|相减|−|-"),
    ("add", r"加法|ADD|相加|\+"),
    ("and", r"逻辑与|AND|按位与|与"),
    ("or", r"逻辑或|OR|按位或|或"),
    ("xor", r"异或|XOR"),
    ("not", r"取反|NOT"),
    ("slt", r"小于|SLT|比较"),
]


def _alu_op(text: str) -> tuple[str, str, str]:
    lowered = text.lower()
    for key, pattern in _ALU_OPS:
        if re.search(pattern, text, re.I) or re.search(pattern, lowered):
            label = {"add": "加法", "sub": "减法", "and": "逻辑与", "or": "逻辑或",
                     "xor": "异或", "not": "取反", "slt": "小于置位"}[key]
            code = {"add": "000", "sub": "001", "and": "010", "or": "011",
                    "xor": "100", "not": "101", "slt": "110"}[key]
            return key, label, code
    return "add", "加法", "000"


def _alu_compute(op: str, a: int, b: int, width: int) -> tuple[int, int, int, int, int]:
    mask = (1 << width) - 1
    if op == "add":
        raw = a + b
        result = raw & mask
        carry = (raw >> width) & 1
        of = 1 if ((a >> (width - 1)) & 1) == ((b >> (width - 1)) & 1) \
            and ((result >> (width - 1)) & 1) != ((a >> (width - 1)) & 1) else 0
    elif op == "sub":
        raw = a - b
        result = raw & mask
        carry = 1 if a < b else 0
        of = 1 if ((a >> (width - 1)) & 1) != ((b >> (width - 1)) & 1) \
            and ((result >> (width - 1)) & 1) != ((a >> (width - 1)) & 1) else 0
    elif op == "and":
        result, carry, of = a & b, 0, 0
    elif op == "or":
        result, carry, of = a | b, 0, 0
    elif op == "xor":
        result, carry, of = a ^ b, 0, 0
    elif op == "not":
        result, carry, of = (~a) & mask, 0, 0
    else:
        result = 1 if _twos(a, width) < _twos(b, width) else 0
        carry = of = 0
    zero = 1 if result == 0 else 0
    sign = (result >> (width - 1)) & 1
    return result, carry, zero, sign, of


def _parse_registers(text: str, width: int) -> dict[str, dict[str, Any]]:
    registers: dict[str, dict[str, Any]] = {}
    for name, token in re.findall(r"(?<![A-Za-z])R(\d+)\s*(?:=|为|:)\s*([01](?:[\s_]?[01]){3,63}|-?\d+)", text, re.I):
        compact = re.sub(r"[\s_]", "", token)
        if re.fullmatch(r"[01]+", compact) and len(compact) >= 4:
            bits = compact
            registers[f"R{name}"] = {"bits": _to_bits(int(bits, 2), width), "value": _twos(int(bits, 2), width)}
        else:
            value = int(token)
            registers[f"R{name}"] = {"bits": _to_bits(value, width), "value": _twos(value, width)}
    return registers


def _eval_mux(text: str) -> dict[str, Any]:
    inputs: dict[int, str] = {}
    for name, token in re.findall(r"\bD\s*(\d+)\s*(?:=|为|:)\s*([01](?:[\s_]?[01]){1,63}|-?\d+)", text, re.I):
        compact = re.sub(r"[\s_]", "", token)
        if re.fullmatch(r"[01]+", compact) and len(compact) >= 2:
            inputs[int(name)] = compact
        else:
            inputs[int(name)] = format(int(token) & 0xFF, "08b")
    if not inputs:
        raise ValueError("未识别到多路选择器的 D0、D1…输入")
    width = max(len(value) for value in inputs.values())
    select_match = re.search(
        r"(?:选择信号|选择端|select)(?:\s*[A-Za-z]\w*)?\s*(?:为|是|=|:|：)?\s*([01]{1,8}|\d+)", text, re.I)
    if not select_match:
        select_match = re.search(r"\bS(?:\d+S\d+|\d*)\s*(?:=|为|是|:|：)\s*([01]{1,8}|\d+)", text, re.I)
    if not select_match:
        raise ValueError("未识别到多路选择器的选择信号")
    token = select_match.group(1)
    if re.fullmatch(r"[01]+", token):
        index = int(token, 2)
        sel_bits = token
    else:
        index = int(token)
        sel_bits = format(index, "b")
    if index not in inputs:
        raise ValueError(f"选择信号 {index} 超出输入编号范围")
    output = inputs[index].zfill(width)
    frames = [
        _frame(1, "列出输入", "；".join(f"D{key}={value}" for key, value in sorted(inputs.items())),
               {f"D{key}": value for key, value in sorted(inputs.items())}, 1),
        _frame(2, "译码选择信号", f"选择信号 {sel_bits} = {index}，选通 D{index}。",
               {"选择信号": sel_bits, "选中": f"D{index}"}, 2),
        _frame(3, "输出", f"多路选择器输出 = {_group_bits(output)}。", {"输出": output}, 3),
    ]
    answer = f"选择信号 {sel_bits} 选中 D{index}，输出 {output}"
    return _ok("datapath", answer, frames, PSEUDOCODES["datapath"],
               [_check("select", "选择信号", True, "选择信号按二进制编号选通对应输入。")],
               ["若输入为不同位宽，本演示按最宽输入左侧补 0。"],
               answer_value=float(int(output, 2)), answer_order=[output])


def _eval_register_transfer(text: str) -> dict[str, Any]:
    width = _width(text, 8)
    if width > MAX_BITS:
        raise ValueError(f"寄存器传送演示最多支持 {MAX_BITS} 位寄存器")
    registers = _parse_registers(text, width)
    if not registers:
        raise ValueError("请给出源寄存器初值，例如“R1=5、R2=3”")
    operations: list[tuple[str, str, str, str]] = []
    for dst, src_a, op_text, src_b in re.findall(
            r"(?<![A-Za-z])R(\d+)\s*(?:<-|←|=)\s*R(\d+)\s*(?:([+\-&|^])\s*R(\d+))?", text, re.I):
        operations.append((f"R{dst}", f"R{src_a}", op_text, f"R{src_b}" if src_b else ""))
    if not operations:
        # 单寄存器传送：R3 ← R1
        match = re.search(r"(?<![A-Za-z])R(\d+)\s*(?:<-|←)\s*R(\d+)(?![0-9])", text, re.I)
        if match:
            operations.append((f"R{match.group(1)}", f"R{match.group(2)}", "", ""))
    if not operations:
        raise ValueError("未识别到寄存器传送，例如“R3 ← R1 + R2”")
    frames = [_frame(1, "初始寄存器", "；".join(f"{name}={value['value']}" for name, value in sorted(registers.items())),
                     {name: value["bits"] for name, value in sorted(registers.items())}, 1)]
    op_map = {"+": ("add", "ADD"), "-": ("sub", "SUB"), "&": ("and", "AND"),
              "|": ("or", "OR"), "^": ("xor", "XOR")}
    for step, (dst, src_a, op_text, src_b) in enumerate(operations, 1):
        if src_a not in registers:
            raise ValueError(f"寄存器 {src_a} 没有给出初值")
        a = registers[src_a]
        if src_b:
            if src_b not in registers:
                raise ValueError(f"寄存器 {src_b} 没有给出初值")
            b = registers[src_b]
            op, label = op_map.get(op_text, ("add", "ADD"))
            result, carry, zero, sign, of = _alu_compute(op, int(a["bits"], 2), int(b["bits"], 2), width)
            bits = _to_bits(result, width)
            detail = f"{src_a}({a['value']}) {op_text} {src_b}({b['value']}) → {_twos(result, width)}"
        else:
            bits = a["bits"]
            result = int(bits, 2)
            detail = f"{src_a}({a['value']}) → {dst}，写使能有效"
            carry = zero = sign = of = 0
        registers[dst] = {"bits": bits, "value": _twos(result, width)}
        frames.append(_frame(step + 1, f"执行 {dst} ← {src_a}{(' ' + op_text + ' ' + src_b) if src_b else ''}",
                             detail + f"；写使能 RegWrite=1，结果写入 {dst}。",
                             {"目标": dst, "结果": bits, "写使能": "1"}, 2))
    answer = "最终寄存器：" + "；".join(f"{name}={value['value']}({value['bits']})"
                                    for name, value in sorted(registers.items()))
    return _ok("datapath", answer, frames, PSEUDOCODES["datapath"],
               [_check("write", "写使能", True, "只有目的寄存器写使能有效时才更新。"),
                _check("dataflow", "数据流", True, "读源寄存器 → ALU 运算 → 写回目的寄存器。")],
               ["寄存器宽度取题面“n位”，未给出时按 8 位处理。"])


def _eval_alu(text: str) -> dict[str, Any]:
    width = _width(text, 8)
    if width > MAX_BITS:
        raise ValueError(f"ALU 演示最多支持 {MAX_BITS} 位")
    op, label, code = _alu_op(text)
    operands = _operands_two(text, width)
    if operands is None:
        raise ValueError("需要 ALU 的两个操作数 A、B（或寄存器值）")
    a_value, b_value = operands
    a_bits, b_bits = _to_bits(a_value, width), _to_bits(b_value, width)
    result, carry, zero, sign, overflow = _alu_compute(op, int(a_bits, 2), int(b_bits, 2), width)
    result_bits = _to_bits(result, width)
    frames = [
        _frame(1, "送入 ALU", f"A = {_group_bits(a_bits)}，B = {_group_bits(b_bits)}，ALUop={code}（{label}）。",
               {"A": a_bits, "B": b_bits, "ALUop": code}, 1),
        _frame(2, "运算", f"ALU 执行{label}，结果 {_group_bits(result_bits)}；"
                          f"标志 Zero={zero}，Sign={sign}，Carry={carry}，Overflow={overflow}。",
               {"结果": result_bits, "Zero": str(zero), "Sign": str(sign),
                "Carry": str(carry), "Overflow": str(overflow)}, 2),
    ]
    unsigned_result = int(result_bits, 2)
    answer = (f"ALUop={code}（{label}）：结果 {result_bits}（无符号 {unsigned_result}，"
              f"补码真值 {_twos(result, width)}）；Zero={zero}，Sign={sign}，Carry={carry}，Overflow={overflow}")
    return _ok("datapath", answer, frames, PSEUDOCODES["datapath"],
               [_check("aluop", "控制信号", True, f"ALUop 编码 {code} 选择{label}。"),
                _check("flags", "状态标志", True, "标志由 ALU 结果与运算类型共同决定。")],
               ["ALU 的 Zero/Sign 看结果；Carry 与 Overflow 对加减法有意义，逻辑运算通常清 0。"],
               answer_order=[result_bits])


def _eval_datapath(text: str) -> dict[str, Any]:
    if re.search(r"多路选择器|MUX|数据选择器", text, re.I):
        return _eval_mux(text)
    if re.search(r"寄存器传送|<-|←|(?<![A-Za-z])R\d+\s*=", text):
        return _eval_register_transfer(text)
    return _eval_alu(text)


# ---------------------------------------------------------------------------
# 6) 主存储器
# ---------------------------------------------------------------------------

def _capacity_pairs(text: str) -> list[dict[str, Any]]:
    pairs: list[dict[str, Any]] = []
    for match in re.finditer(
            r"([0-9]+(?:\.[0-9]+)?)\s*([KMG]?)\s*[×xX*]\s*([0-9]+(?:\.[0-9]+)?)\s*(?:位|bit|b)?",
            text, re.I):
        words = _num(match.group(1)) * {"k": 1024, "m": 1024 ** 2, "g": 1024 ** 3}.get(
            match.group(2).lower(), 1)
        bits = _num(match.group(3))
        pairs.append({"words": int(round(words)), "bits": int(round(bits)), "raw": match.group(0)})
    return pairs


def _size_bytes(text: str, labels: str) -> float | None:
    match = re.search(
        rf"(?:{labels})\s*(?:为|是|约|=|:|：)?\s*([0-9]+(?:\.[0-9]+)?)\s*(KB|MB|GB|K|M|G|B|字节)",
        text, re.I)
    if not match:
        return None
    value = float(match.group(1))
    unit = match.group(2).upper()
    return value * {"B": 1, "字节": 1, "K": 1024, "KB": 1024, "M": 1024 ** 2,
                    "MB": 1024 ** 2, "G": 1024 ** 3, "GB": 1024 ** 3}.get(unit, 1)


def _log2_int(value: int) -> int | None:
    if value <= 0:
        return None
    exponent = int(round(math.log2(value)))
    return exponent if (1 << exponent) == value else None


def _parse_hex_address(text: str) -> int | None:
    match = re.search(
        r"(?:起始地址|首地址|开始地址|基地址|起始单元)\s*(?:为|是|=|:|：)?\s*(?:0[xX])?([0-9A-Fa-f]+)\s*[Hh]?",
        text)
    if not match:
        return None
    token = match.group(1)
    if not (re.search(r"0[xX]", match.group(0)) or re.search(r"[Hh]", match.group(0))
            or re.search(r"[A-Fa-f]", token)):
        return int(token)
    return int(token, 16)


def _fmt_hex(value: int) -> str:
    return f"{value:0{max(4, (value.bit_length() + 3) // 4)}X}H"


def _eval_memory(text: str) -> dict[str, Any]:
    if re.search(r"交叉编址|交叉存储|多体交叉|交叉存取", text):
        bank_match = re.search(r"(\d+)\s*(?:个|路|体|模块)", text)
        width = _number_after(text, r"(?:总线宽度?|数据线宽度?|每个字|字长)", r"位")
        access = _time_ns(text, r"(?:存取周期|存储周期|访问周期)")
        transfer = _time_ns(text, r"(?:总线周期|传送周期|总线传送周期|传输周期|总线传输周期)")
        count_match = re.search(r"(?:连续(?:读取|写入|访问|传送)|读取|访问)\s*(\d+)\s*个字", text)
        if bank_match is None:
            raise ValueError("交叉编址需要给出存储体数 m")
        banks = int(bank_match.group(1))
        count = int(count_match.group(1)) if count_match else banks
        if access is None:
            raise ValueError("交叉编址需要给出存取周期 T")
        if width is None and re.search(r"带宽|吞吐率|Gbit/s|GB/s|MB/s|bps", text, re.I):
            raise ValueError("计算交叉存储器带宽需要给出每个字/总线宽度（位）")
        tau = transfer if transfer is not None else access / banks
        total = access + (count - 1) * tau
        frames = [
            _frame(1, "确定参数", f"{banks} 体交叉，"
                                  + (f"字宽 {fmt(width)} 位，" if width is not None else "")
                                  + f"存取周期 T={fmt(access)} ns，总线传送周期 τ={fmt(tau)} ns。",
                   {"体数": str(banks), **({"字宽": fmt(width)} if width is not None else {}),
                    "T(ns)": fmt(access), "τ(ns)": fmt(tau)}, 1),
            _frame(2, f"连续访问 {count} 个字",
                   f"首个字需要完整存取周期，其后每个字错开 τ：T+(m−1)τ = {fmt(total)} ns。",
                   {"总时间(ns)": fmt(total)}, 2),
        ]
        if width is not None:
            bandwidth_gbps = count * width / total
            bandwidth = bandwidth_gbps * 1e9
            frames.append(_frame(3, "带宽", f"带宽 = m×W/T_total = {fmt(bandwidth_gbps)} Gbit/s。",
                                 {"带宽(Gbit/s)": fmt(bandwidth_gbps)}, 3))
            answer = f"{banks} 体交叉：连续 {count} 个字耗时 {fmt(total)} ns，带宽约 {fmt(bandwidth_gbps)} Gbit/s"
            return _ok("memory", answer, frames, PSEUDOCODES["memory"],
                       [_check("time", "交叉访问时间", True, "T+(m−1)τ；τ 未给出时按 T/m 均分。")],
                       ["带宽按 bit/s 给出，除以 8 可换算为 Byte/s。"], answer_value=bandwidth)
        answer = f"{banks} 体交叉：连续访问 {count} 个字耗时 {fmt(total)} ns"
        return _ok("memory", answer, frames, PSEUDOCODES["memory"],
                   [_check("time", "交叉访问时间", True, "T+(m−1)τ；τ 未给出时按 T/m 均分。")],
                   ["若需同时求最大带宽，请补充字长或数据总线宽度。"], answer_value=total)

    pairs = _capacity_pairs(text)
    base = _parse_hex_address(text)
    byte_addressed = bool(re.search(r"按字节编址|字节编址", text))
    if len(pairs) >= 2:
        chip, total = pairs[0], pairs[1]
        if total["words"] < chip["words"] or total["bits"] < chip["bits"]:
            raise ValueError("总容量应不小于单芯片容量")
        word_groups = math.ceil(total["words"] / chip["words"])
        bit_groups = math.ceil(total["bits"] / chip["bits"])
        chips = word_groups * bit_groups
        chip_addr_bits = _log2_int(chip["words"])
        total_addr_bits = _log2_int(total["words"])
        select_bits = _log2_int(word_groups) if word_groups > 1 else 0
        if chip_addr_bits is None or total_addr_bits is None:
            raise ValueError("片字数应为 2 的整数次幂")
        frames = [
            _frame(1, "芯片与目标容量", f"单片 {chip['raw']}，目标 {total['raw']}。",
                   {"单片": f"{chip['words']}×{chip['bits']}", "总容量": f"{total['words']}×{total['bits']}"}, 1),
            _frame(2, "字扩展与位扩展", f"字方向需要 {word_groups} 组，位方向需要 {bit_groups} 组，"
                                       f"共 {word_groups}×{bit_groups} = {chips} 片。",
                   {"字扩展组数": str(word_groups), "位扩展组数": str(bit_groups), "芯片数": str(chips)}, 2),
            _frame(3, "地址与片选", f"片内地址线 {chip_addr_bits} 根，系统地址线 {total_addr_bits} 根，"
                                   f"片选译码需要 {select_bits} 根高位地址。",
                   {"片内地址线": str(chip_addr_bits), "系统地址线": str(total_addr_bits),
                    "片选地址线": str(select_bits)}, 3),
        ]
        answer = (f"{total['raw']} 需要 {chip['raw']} 芯片 {chips} 片：字扩展 {word_groups} 组、"
                  f"位扩展 {bit_groups} 组；系统地址线 {total_addr_bits} 根，片内 {chip_addr_bits} 根，"
                  f"片选 {select_bits} 根")
        return _ok("memory", answer, frames, PSEUDOCODES["memory"],
                   [_check("chips", "芯片数", True, "总芯片数 = 字扩展组数 × 位扩展组数。")],
                   ["字扩展用高位地址译码产生片选；位扩展各芯片地址线并联、数据线拼接。"],
                   answer_value=float(chips))

    addr_match = re.search(
        r"(?:地址线\s*(?:数|为|有)?\s*(\d+)|(\d+)\s*根?\s*地址线)\s*(?:根|位|条)?", text)
    data_match = re.search(
        r"(?:数据线\s*(?:数|为|有)?\s*(\d+)|(\d+)\s*根?\s*数据线)\s*(?:根|位|条)?", text)
    if addr_match and data_match:
        address_bits = int(addr_match.group(1) or addr_match.group(2))
        data_bits = int(data_match.group(1) or data_match.group(2))
        words = 1 << address_bits
        bits = words * data_bits
        bytes_total = bits / 8
        frames = [
            _frame(1, "地址线与数据线", f"地址线 {address_bits} 根 → {words} 个单元；数据线 {data_bits} 位。",
                   {"地址线": str(address_bits), "数据线": str(data_bits), "单元数": str(words)}, 1),
            _frame(2, "容量", f"容量 = 2^{address_bits} × {data_bits} 位 = {fmt(bits)} 位 = {fmt(bytes_total)} B。",
                   {"容量(bit)": fmt(bits), "容量(B)": fmt(bytes_total)}, 2),
        ]
        answer = f"存储容量 = {fmt(bits)} 位（{fmt(bytes_total)} B），共 {words} 个存储单元"
        if base is not None:
            unit = 1 if byte_addressed else data_bits // 8
            end = base + (int(bytes_total) if byte_addressed else words) - 1
            frames.append(_frame(3, "地址范围", f"起始 {_fmt_hex(base)}，结束 {_fmt_hex(end)}。",
                                 {"起始": _fmt_hex(base), "结束": _fmt_hex(end)}, 3))
            answer += f"；地址范围 {_fmt_hex(base)}–{_fmt_hex(end)}"
        return _ok("memory", answer, frames, PSEUDOCODES["memory"],
                   [_check("capacity", "容量公式", True, "2^地址线数 × 数据线位数。")],
                   ["按字节编址时，地址范围按字节数计算。"], answer_value=bytes_total)

    if len(pairs) == 1:
        unit = pairs[0]
        address_bits = _log2_int(unit["words"])
        if address_bits is None:
            raise ValueError("存储单元数应为 2 的整数次幂")
        bytes_total = unit["words"] * unit["bits"] / 8
        answer = f"{unit['raw']}：地址线 {address_bits} 根，数据线 {unit['bits']} 位，容量 {fmt(bytes_total)} B"
        frames = [
            _frame(1, "拆分容量", f"{unit['words']} 个单元 × {unit['bits']} 位。",
                   {"单元数": str(unit["words"]), "数据线": str(unit["bits"])}, 1),
            _frame(2, "地址线", f"log₂{unit['words']} = {address_bits} 根地址线。",
                   {"地址线": str(address_bits), "容量(B)": fmt(bytes_total)}, 2),
        ]
        if base is not None:
            end = base + (unit["words"] if not byte_addressed else int(bytes_total)) - 1
            frames.append(_frame(3, "地址范围", f"{_fmt_hex(base)}–{_fmt_hex(end)}。",
                                 {"起始": _fmt_hex(base), "结束": _fmt_hex(end)}, 3))
            answer += f"；地址范围 {_fmt_hex(base)}–{_fmt_hex(end)}"
        return _ok("memory", answer, frames, PSEUDOCODES["memory"],
                   [_check("address", "地址线", True, "单元数 = 2^地址线数。")],
                   ["容量单位换算按 1 B = 8 bit。"], answer_value=bytes_total)
    if re.search(r"字扩展|位扩展|芯片选择|地址范围|存储容量|存储器", text, re.I):
        frames = [
            _frame(1, "容量与地址线", "容量 = 2^地址线数 × 数据线宽度；地址线决定寻址空间，数据线决定每次读写位数。",
                   {"容量": "2^地址线 × 数据线"}, 1),
            _frame(2, "字扩展", "增加存储单元数：各芯片地址线低位并联，高位经译码器产生片选；数据线共用。",
                   {"字扩展": "高位译码片选"}, 2),
            _frame(3, "位扩展", "增加数据线宽度：各芯片地址线、片选并联，数据线按位拼接。",
                   {"位扩展": "数据线拼接"}, 3),
            _frame(4, "地址范围", "结束地址 = 起始地址 + 存储单元数 − 1（按字节编址时用字节数）。",
                   {"地址范围": "起始 + 容量 − 1"}, 4),
        ]
        answer = ("存储器容量 = 2^地址线数 × 数据线宽度；字扩展用高位地址译码产生片选，"
                  "位扩展把各芯片数据线按位拼接；地址范围由起始地址和容量共同决定。")
        return _ok("memory", answer, frames, PSEUDOCODES["memory"],
                   [_check("concept", "扩展方式", True, "字扩展增单元数，位扩展增数据宽度。")],
                   ["交叉编址需要额外给出体数、存取周期和总线传送周期。"])
    raise ValueError("未识别到存储容量、地址线/数据线或芯片容量×位宽的条件")


# ---------------------------------------------------------------------------
# 7) Cache
# ---------------------------------------------------------------------------

def _parse_percent(text: str, labels: str) -> float | None:
    match = re.search(
        rf"(?:{labels})\s*(?:为|是|约|=|:|：)?\s*([0-9]+(?:\.[0-9]+)?)\s*(%)?",
        text, re.I)
    if not match:
        return None
    value = float(match.group(1))
    if match.group(2) == "%" or value > 1:
        value /= 100
    return value


def _parse_address_value(text: str) -> int | None:
    match = re.search(
        r"(?:主存地址|物理地址|虚拟地址|访问地址|地址)\s*(?:为|是|=|:|：)?\s*(0[xX][0-9A-Fa-f]+|[0-9A-Fa-f]+[Hh])",
        text)
    if not match:
        return None
    token = match.group(1)
    return int(token[2:], 16) if token.lower().startswith("0x") else int(token[:-1], 16)


def _parse_address_bits(text: str, labels: str = r"主存地址|地址|虚拟地址") -> int | None:
    match = re.search(
        rf"(?:{labels})\s*(?:宽度|长度)?\s*(?:为|是|=|:|：)?\s*(\d{{1,3}})\s*位",
        text, re.I)
    return int(match.group(1)) if match else None


def _eval_cache(text: str) -> dict[str, Any]:
    cache_size = _size_bytes(text, r"Cache\s*容量|缓存容量|Cache\s*大小|Cache\s*数据区(?:大小|容量)?")
    block_size = _size_bytes(text, r"块大小|块长|行大小|Cache\s*块大小|每块")
    address_bits = _parse_address_bits(text, r"物理地址|主存地址|实地址") or _parse_address_bits(text)
    hit_rate = _parse_percent(text, r"命中率")
    hit_time = _time_ns(text, r"(?:Cache\s*)?命中时间|访问\s*Cache\s*时间|Cache\s*访问时间")
    miss_penalty = _time_ns(text, r"缺失代价|缺失开销|访问主存时间|主存访问时间")
    policy_only = (bool(re.search(r"替换策略|替换算法|写策略|写直达|写回|LRU|FIFO", text, re.I))
                   or bool(re.search(r"命中过程|访问过程|命中时|缺失时", text))) \
        and cache_size is None and block_size is None and hit_rate is None
    if policy_only:
        frames = [
            _frame(1, "访问命中过程", "主存地址先拆成 tag/index/offset；用 index 定位组，"
                                     "再把 tag 与该组各行标记比较：相同则命中，不同则缺失。",
                   {"命中判断": "index 定位组 + tag 比较"}, 1),
            _frame(2, "替换策略", "常见替换算法：随机、FIFO（先进先出）、LRU（最近最少使用）。"
                                 "全相联和组相联需要替换，直接映射每组只有一行，无需选择。",
                   {"替换": "随机 / FIFO / LRU"}, 2),
            _frame(3, "写策略", "写直达：每次写命中同时写 Cache 和主存，一致性好但开销大；"
                               "写回：只写 Cache 并置脏位，替换时写回主存，减少总线写。",
                   {"写策略": "写直达 / 写回"}, 3),
            _frame(4, "缺失处理", "读缺失需从主存调入块；写缺失可用写分配或非写分配，需与写策略配套。",
                   {"写缺失": "写分配 / 非写分配"}, 4),
        ]
        answer = ("Cache 替换算法：随机、FIFO、LRU；写策略：写直达（强一致）与写回（脏位，替换时写回）；"
                  "写缺失还分写分配/非写分配。")
        return _ok("cache", answer, frames, PSEUDOCODES["cache"],
                   [_check("policy", "策略口径", True, "替换与写策略需要成对说明。")],
                   ["直接映射每组只有一行，不存在替换选择。"])

    if hit_rate is not None and hit_time is not None and miss_penalty is not None:
        miss_rate = 1 - hit_rate
        amat = hit_time + miss_rate * miss_penalty
        frames = [
            _frame(1, "命中率与代价", f"命中率 h={fmt(hit_rate)}，命中时间 Tc={fmt(hit_time)} ns，"
                                      f"缺失代价 Tm={fmt(miss_penalty)} ns。",
                   {"h": fmt(hit_rate), "Tc(ns)": fmt(hit_time), "Tm(ns)": fmt(miss_penalty)}, 1),
            _frame(2, "平均访问时间", f"AMAT = Tc + (1−h)×Tm = {fmt(amat)} ns。",
                   {"AMAT(ns)": fmt(amat)}, 2),
        ]
        answer = f"平均访问时间 AMAT = {fmt(amat)} ns（命中时间 {fmt(hit_time)} ns，缺失率 {fmt(miss_rate)}）"
        return _ok("cache", answer, frames, PSEUDOCODES["cache"],
                   [_check("amat", "平均访问时间", True, "AMAT = 命中时间 + 缺失率 × 缺失代价。")],
                   ["缺失代价按“发生缺失时额外付出的时间”口径；若题目给完整缺失访问时间，请相应调整。"],
                   answer_value=amat)

    if cache_size is None or block_size is None or address_bits is None:
        if re.search(r"直接映射|全相联|组相联|Cache|缓存", text, re.I):
            frames = [
                _frame(1, "直接映射", "主存块只能放到唯一 Cache 行：行号 = 主存块号 mod Cache 行数；"
                                     "地址 = tag + index + offset，每组 1 行。",
                       {"映射": "直接"}, 1),
                _frame(2, "全相联", "主存块可放到任意 Cache 行：地址只有 tag + offset，"
                                   "需要与全部行标记比较，替换灵活但比较器多。",
                       {"映射": "全相联"}, 2),
                _frame(3, "组相联", "先按 index 定位组，再在组内 n 行中按 tag 匹配；"
                                   "组数 = Cache 行数 / 相联度，是直接映射与全相联的折中。",
                       {"映射": "组相联"}, 3),
            ]
            answer = ("直接映射：每组 1 行、index 直接定位；全相联：只有 1 组、tag 与全部行比较；"
                      "组相联：index 定位组，组内 n 路按 tag 匹配。")
            return _ok("cache", answer, frames, PSEUDOCODES["cache"],
                       [_check("mapping", "映射方式", True, "三种映射的组数/相联度不同。")],
                       ["地址划分还需要 Cache 容量、块大小和主存地址位数。"])
        raise ValueError("Cache 地址划分需要 Cache 容量、块大小和主存地址位数")
    lines = cache_size / block_size
    if lines < 1:
        raise ValueError("Cache 容量应不小于一个块")
    if re.search(r"组\s*相\s*联", text):
        mapping = "组相联"
        way_match = re.search(r"(\d+)\s*路", text) or re.search(r"每组\s*(\d+)\s*行", text)
        ways = int(way_match.group(1)) if way_match else 2
    elif re.search(r"直接\s*映射", text):
        mapping, ways = "直接映射", 1
    elif re.search(r"全\s*相\s*联", text):
        mapping, ways = "全相联", int(lines)
    else:
        mapping, ways = "直接映射", 1
    if ways < 1 or ways > lines:
        raise ValueError("相联度应在 1 到 Cache 行数之间")
    sets = lines / ways
    index_bits = _log2_int(int(sets))
    offset_bits = _log2_int(int(block_size))
    if index_bits is None or offset_bits is None:
        raise ValueError("Cache 组数与块大小应为 2 的整数次幂")
    tag_bits = address_bits - index_bits - offset_bits
    if tag_bits < 0:
        raise ValueError("地址位数不足以容纳 tag/index/offset")
    frames = [
        _frame(1, "容量参数", f"Cache {fmt(cache_size)} B，块大小 {fmt(block_size)} B，"
                              f"共 {fmt(lines)} 行；{mapping}，相联度 {ways}。",
               {"行数": fmt(lines), "块大小(B)": fmt(block_size), "映射": mapping}, 1),
        _frame(2, "地址划分", f"组数 = {fmt(sets)}，offset={offset_bits} 位，index={index_bits} 位，"
                              f"tag={tag_bits} 位（总地址 {address_bits} 位）。",
               {"tag": str(tag_bits), "index": str(index_bits), "offset": str(offset_bits)}, 2),
    ]
    address_value = _parse_address_value(text)
    answer = (f"{mapping}：主存地址 {address_bits} 位 = tag {tag_bits} 位 + index {index_bits} 位 + "
              f"offset {offset_bits} 位；Cache 共 {fmt(lines)} 行、{fmt(sets)} 组")
    if address_value is not None:
        offset = address_value & (int(block_size) - 1)
        index = (address_value >> offset_bits) & (int(sets) - 1)
        tag = address_value >> (offset_bits + index_bits)
        binary = format(address_value, f"0{address_bits}b")
        tag_text, index_text, offset_text = (
            binary[:tag_bits], binary[tag_bits:tag_bits + index_bits], binary[tag_bits + index_bits:])
        frames.append(_frame(3, "地址拆解", f"地址 {address_value:0{address_bits // 4}X}H → "
                                         f"tag={tag_text}，index={index_text}，offset={offset_text}；"
                                         f"tag={tag}、组号 {index}、块内偏移 {offset}。",
                             {"tag值": str(tag), "组号": str(index), "块内偏移": str(offset)}, 2))
        answer += f"；地址拆解：tag {tag}、组号 {index}、块内偏移 {offset}"
    block_no_match = re.search(r"(?:主存)?块号\s*(?:为|是|=|:|：)?\s*(\d+)", text)
    if block_no_match is not None:
        block_no = int(block_no_match.group(1))
        mapped_set = block_no % int(sets)
        set_label = "行号" if mapping == "直接映射" else "组号"
        frames.append(_frame(
            len(frames) + 1,
            f"块号映射{set_label}",
            f"主存块号 {block_no} mod {int(sets)} = {mapped_set}，映射到 Cache 第 {mapped_set} {set_label[:-1]}。",
            {"主存块号": str(block_no), f"Cache {set_label}": str(mapped_set)}, 2,
        ))
        answer += f"；主存块号 {block_no} 映射到 Cache {set_label} {mapped_set}"
    return _ok("cache", answer, frames, PSEUDOCODES["cache"],
               [_check("fields", "字段长度", True, "tag + index + offset = 主存地址位数。")],
               ["组相联每组 ways 行；全相联可视为只有 1 组，直接映射可视为每组 1 行。"])


# ---------------------------------------------------------------------------
# 8) 虚拟存储基础
# ---------------------------------------------------------------------------

def _eval_virtual_memory(text: str) -> dict[str, Any]:
    page_size = _size_bytes(text, r"页大小|页面大小|页长|每页")
    va_bits = _parse_address_bits(text, r"虚拟地址|虚地址")
    pa_bits = _parse_address_bits(text, r"物理地址|实地址")
    address_value = _parse_address_value(text)
    pte_size = _size_bytes(text, r"页表项(?:大小)?|PTE(?:大小)?")
    frames: list[dict[str, Any]] = []
    answer_bits: list[str] = []
    if page_size is not None and va_bits is not None:
        offset_bits = _log2_int(int(page_size))
        if offset_bits is None:
            raise ValueError("页大小应为 2 的整数次幂")
        vpn_bits = va_bits - offset_bits
        if vpn_bits < 0:
            raise ValueError("虚拟地址位数小于页内偏移位数")
        pages = 1 << vpn_bits
        frame_bits = (pa_bits - offset_bits) if pa_bits is not None else None
        frames.append(_frame(1, "地址拆分", f"页大小 {fmt(page_size)} B → offset {offset_bits} 位；"
                                          f"虚拟地址 {va_bits} 位 → VPN {vpn_bits} 位，共 {pages} 个虚页。",
                             {"offset": str(offset_bits), "VPN": str(vpn_bits), "虚页数": str(pages)}, 1))
        answer_bits.append(f"offset {offset_bits} 位、VPN {vpn_bits} 位，共 {pages} 个虚页")
        if frame_bits is not None:
            frames.append(_frame(2, "物理地址", f"物理地址 {pa_bits} 位 → 页框号 {frame_bits} 位，"
                                              f"共 {1 << frame_bits} 个页框。",
                                 {"页框号位数": str(frame_bits), "页框数": str(1 << frame_bits)}, 2))
            answer_bits.append(f"页框号 {frame_bits} 位")
        if address_value is not None:
            vpn = address_value >> offset_bits
            offset = address_value & (int(page_size) - 1)
            mappings = {
                int(page, 0): int(frame, 0) for page, frame in re.findall(
                    r"(?:虚页|页号|VPN)\s*(0[xX][0-9A-Fa-f]+|\d+)\s*(?:→|->|映射到|对应)\s*"
                    r"(?:页框|物理页框)?\s*(0[xX][0-9A-Fa-f]+|\d+)", text)
            }
            if mappings and vpn in mappings:
                pa = (mappings[vpn] << offset_bits) | offset
                frames.append(_frame(3, "地址转换", f"虚拟地址 {address_value:X}H：VPN={vpn}，offset={offset}；"
                                                  f"页表映射到页框 {mappings[vpn]}，物理地址 {pa:X}H。",
                                     {"VPN": str(vpn), "offset": str(offset), "物理地址": f"{pa:X}H"}, 3))
                answer_bits.append(f"虚拟地址 {address_value:X}H → 物理地址 {pa:X}H")
            else:
                frames.append(_frame(3, "地址转换", f"虚拟地址 {address_value:X}H：VPN={vpn}，offset={offset}；"
                                                  "题面未给出该虚页的页框号，不能编造物理地址。",
                                     {"VPN": str(vpn), "offset": str(offset)}, 3))
                answer_bits.append(f"VPN={vpn}、offset={offset}")
        if pte_size is not None:
            table_bytes = pages * pte_size
            frames.append(_frame(len(frames) + 1, "页表大小", f"{pages} 项 × {fmt(pte_size)} B = "
                                                      f"{fmt(table_bytes)} B。", {"页表大小(B)": fmt(table_bytes)}, 3))
            answer_bits.append(f"页表大小 {fmt(table_bytes)} B")
    tlb_hit = _parse_percent(text, r"TLB\s*命中率|快表命中率")
    cache_hit = _parse_percent(text, r"Cache\s*命中率")
    tlb_time = _time_ns(text, r"TLB\s*访问时间|查\s*TLB\s*时间|TLB\s*时间|快表访问时间")
    page_time = _time_ns(text, r"页表访问时间|查页表时间")
    cache_time = _time_ns(text, r"Cache\s*访问时间|访问\s*Cache\s*时间")
    memory_time = _time_ns(text, r"主存访问时间|访问主存时间|内存访问时间|访问内存时间|主存时间|内存时间")
    levels_match = re.search(r"([1-4一二两三四])\s*级页表", text)
    level_map = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4}
    levels = int(level_map.get(levels_match.group(1), levels_match.group(1))) if levels_match else 1
    amat = None
    if tlb_hit is not None and (tlb_time is not None or cache_time is not None):
        has_cache = (cache_hit is not None) or (cache_time is not None)
        if not has_cache and memory_time is None:
            raise ValueError("计算平均有效访问时间还需要主存/内存访问时间")
        tlb_time = tlb_time or 0.0
        memory_time = memory_time or 0.0
        cache_time = cache_time or 0.0
        parallel = bool(re.search(r"同时|并行", text))
        miss_tlb = 1 - tlb_hit
        if has_cache:
            page_access = page_time or 0.0
            miss_cache = 1 - (cache_hit if cache_hit is not None else 1.0)
            if parallel:
                amat = max(tlb_time, cache_time) + miss_tlb * levels * page_access + miss_cache * memory_time
                mode = "TLB 与 Cache 并行访问"
            else:
                amat = tlb_time + miss_tlb * levels * page_access + cache_time + miss_cache * memory_time
                mode = "TLB → 页表 → Cache → 主存 顺序访问"
        else:
            page_access = page_time if page_time is not None else memory_time
            amat = tlb_time + miss_tlb * levels * page_access + memory_time
            mode = f"TLB + {levels} 级页表 + 主存（无 Cache）"
        frames.append(_frame(len(frames) + 1, "联合访问时间", f"{mode}：T = {fmt(amat)} ns。",
                             {"AMAT(ns)": fmt(amat)}, 4))
        answer_bits.append(f"平均访问时间 {fmt(amat)} ns")
    if not answer_bits:
        if re.search(r"虚拟存储|页表|TLB|快表|虚实地址|虚拟地址|页框", text, re.I):
            frames = [
                _frame(1, "虚实地址", "虚拟地址拆成 VPN + offset；页表把 VPN 映射为物理页框号 PFN；"
                                     "物理地址 = PFN×页大小 + offset。",
                       {"虚拟地址": "VPN + offset", "物理地址": "PFN + offset"}, 1),
                _frame(2, "TLB", "TLB 缓存最近使用的页表项；命中直接得到 PFN，未命中再访问页表。",
                       {"TLB": "页表项缓存"}, 2),
                _frame(3, "联合访问", "顺序访问：TLB → 页表（TLB 缺失）→ Cache → 主存（Cache 缺失）；"
                                     "并行访问时 TLB 与 Cache 同时查，取较慢者并叠加缺失代价。",
                       {"联合访问": "TLB/页表/Cache/主存"}, 3),
            ]
            answer = ("虚拟地址 = VPN + offset；页表完成 VPN→PFN 转换；TLB 缓存页表项；"
                      "联合访问按 TLB/页表/Cache/主存的命中与缺失逐级累加。")
            return _ok("virtual_memory", answer, frames, PSEUDOCODES["virtual_memory"],
                       [_check("concept", "虚实转换", True, "页表项保存 VPN→PFN 映射。")],
                       ["具体访问时间需要给出各级命中率和访问时间。"])
        raise ValueError("虚拟存储题需要页大小/虚拟地址位数，或 TLB/Cache 命中率与访问时间")
    answer = "；".join(answer_bits)
    return _ok("virtual_memory", answer, frames, PSEUDOCODES["virtual_memory"],
               [_check("offset", "页内偏移", True, "页大小 = 2^offset；VPN = 虚拟地址位数 − offset。")],
               ["TLB 与 Cache 并行时取两者较慢者作为首级访问时间；顺序访问时逐级相加。"],
               answer_value=amat)


# ---------------------------------------------------------------------------
# 9) 指令系统
# ---------------------------------------------------------------------------

def _address_count(token: str) -> int | None:
    token = token.strip()
    return {"一": 1, "二": 2, "三": 3, "四": 4, "零": 0}.get(token,
                                                             int(token) if token.isdigit() else None)


def _eval_instruction(text: str) -> dict[str, Any]:
    if re.search(r"操作码扩展|扩展操作码|操作码位数|最多.*指令|指令字长", text):
        return _instr_opcode(text)
    if re.search(r"寻址|有效地址|EA\b|基址|变址|相对寻址|间接寻址", text, re.I):
        return _instr_addressing(text)
    return _instr_encoding(text)


def _instr_opcode(text: str) -> dict[str, Any]:
    opcode_bits = _number_after(text, r"操作码(?:字段)?", r"位")
    addr_bits = _number_after(text, r"地址码(?:字段)?", r"位")
    total_bits = _number_after(text, r"指令字长", r"位")
    if opcode_bits is None:
        if re.search(r"指令格式|操作码|指令系统|机器指令", text):
            frames = [
                _frame(1, "指令格式", "指令由操作码和地址码组成；操作码指明操作，地址码给出寄存器号、立即数或地址。",
                       {"格式": "操作码 | 地址码"}, 1),
                _frame(2, "操作码扩展", "固定长度操作码浪费编码空间；扩展操作码把某些操作码作为标志，"
                                       "把地址字段解释为下一级操作码。", {"扩展": "保留操作码作标志"}, 2),
                _frame(3, "寻址与编码", "寻址方式决定有效地址 EA；机器指令编码按字段宽度把操作码、寄存器号和立即数拼接。",
                       {"输出": "字段拼接"}, 3),
            ]
            answer = ("指令 = 操作码 + 地址码；操作码扩展通过保留编码逐级解释地址字段；"
                      "寻址方式决定 EA，机器编码按字段宽度拼接。")
            return _ok("instruction", answer, frames, PSEUDOCODES["instruction"],
                       [_check("format", "格式约定", True, "字段宽度与操作码编码共同决定指令数量。")],
                       ["具体最大值需要给出操作码位数、地址码位数和已用编码数。"])
        raise ValueError("操作码扩展需要给出操作码位数")
    opcode_bits = int(opcode_bits)
    base_count = 1 << opcode_bits
    used_match = re.search(r"([一二三四0-9]+)\s*地址指令\s*(?:有|为|共)?\s*(\d+)\s*条", text)
    target_match = re.search(r"([一二三四0-9]+)\s*地址指令\s*(?:最多|至多)", text)
    if used_match and target_match and addr_bits is not None:
        start_level = _address_count(used_match.group(1))
        used = int(used_match.group(2))
        target_level = _address_count(target_match.group(1))
        if start_level is None or target_level is None or target_level >= start_level:
            raise ValueError("请按“三地址指令有 12 条，求二地址最多多少条”的格式给出")
        addr_bits = int(addr_bits)
        if total_bits is not None:
            max_level = int((int(total_bits) - opcode_bits) // addr_bits)
        else:
            max_level = start_level
        space = base_count
        remaining = 0
        result_count = None
        for level in range(max_level, -1, -1):
            if level == start_level:
                remaining = space - used
            if level == target_level:
                result_count = (remaining - 1) * (1 << addr_bits) if level < start_level else remaining
                break
            if level <= start_level and level > 0:
                space = max(0, remaining - 1) * (1 << addr_bits)
        if result_count is None or result_count < 0:
            raise ValueError("操作码空间不足，无法扩展到目标地址格式")
        frames = [
            _frame(1, "基本操作码", f"{opcode_bits} 位操作码共有 {base_count} 个编码",
                   {"基本操作码数": str(base_count)}, 1),
            _frame(2, "预留扩展标志", f"{start_level} 地址指令使用 {used} 个编码，剩余 {remaining} 个；"
                                     f"留 1 个作为扩展标志，其余进入下一级。",
                   {"已用": str(used), "剩余": str(remaining)}, 2),
            _frame(3, "目标级编码", f"{target_level} 地址指令最多 {result_count} 条"
                                    f"（每个扩展码再提供 2^{addr_bits} 种编码）。",
                   {f"{target_level}地址最多": str(result_count)}, 3),
        ]
        answer = (f"{opcode_bits} 位操作码：{start_level} 地址指令 {used} 条后，"
                  f"{target_level} 地址指令最多 {result_count} 条")
        return _ok("instruction", answer, frames, PSEUDOCODES["instruction"],
                   [_check("extension", "扩展标志", True, "每级保留一个操作码作为向下一级扩展的标志。")],
                   ["该口径按“每级留 1 个扩展码”计算；若题目另有保留编码，需要相应扣减。"],
                   answer_value=float(result_count))
    answer = f"{opcode_bits} 位操作码最多可表示 {base_count} 种不同的操作码"
    frames = [_frame(1, "操作码空间", f"2^{opcode_bits} = {base_count}。", {"操作码数": str(base_count)}, 1)]
    if addr_bits is not None and total_bits is not None:
        frames.append(_frame(2, "字段检查", f"指令字长 {int(total_bits)} 位 = 操作码 {opcode_bits} 位 + "
                                           f"地址码 {int(addr_bits)} 位 × 若干字段。",
                             {"操作码位": str(opcode_bits), "地址码位": str(int(addr_bits))}, 2))
    return _ok("instruction", answer, frames, PSEUDOCODES["instruction"],
               [_check("opcode", "操作码编码", True, "n 位操作码最多 2^n 种。")],
               ["操作码扩展通过保留编码把地址字段解释为下一级操作码。"], answer_value=float(base_count))


def _instr_addressing(text: str) -> dict[str, Any]:
    registers: dict[str, int] = {}
    for name, token in re.findall(r"(?:R|PC)\s*(\d*)\s*(?:=|为|:)\s*(0[xX][0-9A-Fa-f]+|[0-9A-Fa-f]+[Hh]|-?\d+)", text):
        compact = token
        if compact.lower().startswith("0x"):
            value = int(compact, 16)
        elif compact.endswith(("H", "h")):
            value = int(compact[:-1], 16)
        else:
            value = int(compact)
        registers[f"R{name}" if name else "PC"] = value
    pc = registers.get("PC")
    address_match = re.search(
        r"(?:地址|直接地址|形式地址)\s*(?:为|是|=|:|：)?\s*(0[xX][0-9A-Fa-f]+|[0-9A-Fa-f]+[Hh]|-?\d+)", text)
    direct = None
    if address_match:
        token = address_match.group(1)
        direct = int(token, 16) if token.lower().startswith("0x") else (
            int(token[:-1], 16) if token.endswith(("H", "h")) else int(token))
    displacement = _number_after(text, r"偏移量|位移量|A|D")
    if displacement is None:
        disp_match = re.search(r"(?:偏移量|位移量)\s*(?:为|是|=|:|：)?\s*(-?\d+)", text)
        displacement = float(disp_match.group(1)) if disp_match else None
    mode = None
    for key, pattern in (
            ("寄存器间接", r"寄存器间接"), ("基址", r"基址"), ("变址", r"变址"),
            ("相对", r"相对"), ("立即", r"立即"), ("直接", r"直接"), ("间接", r"间接"), ("寄存器", r"寄存器寻址")):
        if re.search(pattern, text):
            mode = key
            break
    if mode is None and direct is not None:
        mode = "直接"
    if mode is None:
        if re.search(r"寻址|有效地址|EA\b", text, re.I):
            frames = [
                _frame(1, "立即寻址", "操作数直接在指令中，EA 概念不适用；不访问主存。", {"EA": "立即数"}, 1),
                _frame(2, "直接/间接", "直接：EA = 形式地址；间接：EA = M[形式地址]，需再访问一次主存。",
                       {"直接": "EA=形式地址", "间接": "EA=M[形式地址]"}, 2),
                _frame(3, "寄存器/基址/变址/相对", "寄存器：操作数在寄存器；寄存器间接：EA=(R)；"
                                                 "基址/变址：EA=(R)+A；相对：EA=PC+A。",
                       {"寻址方式": "立即/直接/间接/寄存器/基址/变址/相对"}, 3),
            ]
            answer = ("常见寻址方式：立即、直接、间接、寄存器、寄存器间接、基址、变址、相对；"
                      "有效地址按各方式定义计算。")
            return _ok("instruction", answer, frames, PSEUDOCODES["instruction"],
                       [_check("modes", "寻址方式", True, "不同方式访问主存次数不同。")],
                       ["具体 EA 需要给出寄存器值、形式地址或位移量。"])
        raise ValueError("请给出寻址方式（立即/直接/间接/寄存器/寄存器间接/基址/变址/相对）")
    frame_note = ""
    if mode == "立即":
        immediate_match = re.search(r"立即数\s*(?:为|是|=|:|：)?\s*(-?\d+)", text)
        if immediate_match is None and direct is None and displacement is None:
            raise ValueError("立即寻址需要给出立即数")
        value = int(immediate_match.group(1)) if immediate_match else (
            direct if direct is not None else int(displacement or 0))
        ea = value
        operand = value
        frame_note = "立即数本身就是操作数，不访问主存"
    elif mode == "直接":
        if direct is None:
            raise ValueError("直接寻址需要给出形式地址")
        ea, operand = direct, None
        frame_note = "有效地址 EA = 形式地址；操作数在主存中"
    elif mode == "间接":
        if direct is None:
            raise ValueError("间接寻址需要给出形式地址")
        memory_match = re.search(r"(?:该单元|地址单元|M\[[^\]]+\])\s*(?:内容|存放|为|是)\s*(0[xX][0-9A-Fa-f]+|-?\d+)", text)
        if not memory_match:
            raise ValueError("间接寻址需要给出该地址单元中存放的有效地址")
        token = memory_match.group(1)
        ea = int(token, 16) if token.lower().startswith("0x") else int(token)
        operand = None
        frame_note = "EA = M[形式地址]；需再按 EA 访问主存取操作数"
    elif mode == "寄存器":
        if "R1" not in registers and "R0" not in registers:
            raise ValueError("寄存器寻址需要给出寄存器内容")
        value = registers.get("R1", next(iter(registers.values()), 0))
        ea, operand = value, value
        frame_note = "操作数在寄存器中，不访问主存"
    elif mode == "寄存器间接":
        value = registers.get("R1", next(iter(registers.values()), None))
        if value is None:
            raise ValueError("寄存器间接寻址需要给出寄存器内容")
        ea, operand = value, None
        frame_note = "EA = (R)；寄存器中存放的是有效地址"
    elif mode in ("基址", "变址"):
        value = registers.get("R1", next(iter(registers.values()), None))
        if value is None or displacement is None:
            raise ValueError(f"{mode}寻址需要寄存器内容和偏移量")
        ea = value + int(displacement)
        operand = None
        frame_note = f"EA = ({'基址寄存器' if mode == '基址' else '变址寄存器'}) + 偏移量"
    else:
        if pc is None or displacement is None:
            raise ValueError("相对寻址需要 PC 当前值和位移量")
        ea = pc + int(displacement)
        operand = None
        frame_note = "EA = PC + 位移量（PC 口径按题面当前值，未额外加指令长度）"
    answer = f"{mode}寻址：有效地址 EA = {ea}" + (f"，操作数 = {operand}" if operand is not None else "")
    frames = [
        _frame(1, "识别寻址方式", f"题面命中{mode}寻址；" + ("；".join(
            f"{name}={value}" for name, value in sorted(registers.items())) or "无寄存器值。"),
               {"方式": mode, "寄存器": str(registers)}, 1),
        _frame(2, "计算有效地址", frame_note + f"，EA={ea}。", {"EA": str(ea)}, 2),
    ]
    return _ok("instruction", answer, frames, PSEUDOCODES["instruction"],
               [_check("ea", "有效地址", True, "不同寻址方式按各自定义计算 EA。")],
               ["PC 相对寻址需确认 PC 指向当前指令还是下一条指令；本演示按题面给定 PC 值计算。"])


def _instr_encoding(text: str) -> dict[str, Any]:
    instruction_match = re.search(
        r"(ADD|SUB|AND|OR|XOR|MOV|LOAD|STORE)\s+R(\d+)\s*,\s*R(\d+)\s*(?:,\s*R(\d+))?",
        text, re.I)
    if instruction_match:
        op, rd, rs, rt = instruction_match.groups()
        op = op.upper()
        if op in ("ADD", "SUB", "AND", "OR", "XOR") and rt:
            symbol = {"ADD": "+", "SUB": "-", "AND": "&", "OR": "|", "XOR": "^"}[op]
            c_expr = f"R{rd} = R{rs} {symbol} R{rt}"
        elif op == "MOV":
            c_expr = f"R{rd} = R{rs}"
        elif op == "LOAD":
            c_expr = f"R{rd} = M[R{rs}]"
        else:
            c_expr = f"M[R{rd}] = R{rs}"
        answer = f"{op} R{rd},R{rs}" + (f",R{rt}" if rt else "") + f" 对应 C 表达式：{c_expr}"
        frames = [_frame(1, "解析机器指令", f"操作码 {op}，目的/源寄存器字段 R{rd},R{rs}"
                                            + (f",R{rt}" if rt else "") + "。",
                         {"操作码": op, "字段": f"R{rd},R{rs}" + (f",R{rt}" if rt else "")}, 1),
                  _frame(2, "对应 C 表达式", c_expr, {"C 表达式": c_expr}, 2)]
        return _ok("instruction", answer, frames, PSEUDOCODES["instruction"],
                   [_check("fields", "字段对应", True, "寄存器字段与 C 表达式变量按位置对应。")],
                   ["LOAD/STORE 使用 M[地址] 表示内存访问；具体地址形成方式由寻址方式决定。"])
    c_match = re.search(r"R(\d+)\s*=\s*R(\d+)\s*([+\-&|^])\s*R(\d+)", text)
    if c_match:
        rd, rs, op, rt = c_match.groups()
        op_name = {"+": "ADD", "-": "SUB", "&": "AND", "|": "OR", "^": "XOR"}[op]
        instruction = f"{op_name} R{rd},R{rs},R{rt}"
        answer = f"C 表达式 R{rd}=R{rs}{op}R{rt} 对应的三地址指令：{instruction}"
        frames = [_frame(1, "三地址表达式", f"目的 R{rd}，源 R{rs}、R{rt}，运算 {op}。",
                         {"目的": f"R{rd}", "源": f"R{rs}, R{rt}"}, 1),
                  _frame(2, "指令映射", instruction, {"机器指令": instruction}, 2)]
        return _ok("instruction", answer, frames, PSEUDOCODES["instruction"],
                   [_check("mapping", "表达式映射", True, "C 运算与三地址操作码一一对应。")],
                   ["实际机器还可能区分立即数/寄存器/内存操作数编码。"])
    field_bits = {name: int(bits) for name, bits in re.findall(
        r"(操作码|Rs|Rt|Rd|立即数|偏移量)\s*(\d+)\s*位", text)}
    field_values: dict[str, int] = {}
    for name in field_bits:
        value_match = re.search(rf"{name}\s*(?:=|为|:)\s*(\d+)", text)
        if value_match:
            field_values[name] = int(value_match.group(1))
    if field_bits and len(field_values) == len(field_bits):
        bits_text = ""
        values_text = []
        for name, bits in field_bits.items():
            value = field_values[name]
            if value < 0 or value >= (1 << bits):
                raise ValueError(f"{name} 的取值超出 {bits} 位范围")
            bits_text += format(value, f"0{bits}b")
            values_text.append(f"{name}={value}")
        answer = f"指令编码：{_group_bits(bits_text)}（{len(bits_text)} 位）；" + "，".join(values_text)
        frames = [
            _frame(1, "字段格式", "；".join(f"{name} {bits} 位" for name, bits in field_bits.items()),
                   {name: str(bits) for name, bits in field_bits.items()}, 1),
            _frame(2, "字段取值", "；".join(values_text), field_values, 2),
            _frame(3, "拼接编码", answer, {"编码": bits_text}, 2),
        ]
        return _ok("instruction", answer, frames, PSEUDOCODES["instruction"],
                   [_check("range", "字段范围", True, "各字段值均在对应位宽内。")],
                   ["机器指令编码按字段从左到右拼接；十六进制可按 4 位一组转换。"],
                   answer_order=[bits_text])
    raise ValueError("未识别到 C 表达式映射、机器指令或完整字段编码信息")

# ---------------------------------------------------------------------------
# 10) CPU 与控制器
# ---------------------------------------------------------------------------

def _eval_cpu_control(text: str) -> dict[str, Any]:
    count = _parse_instruction_count(text)
    clock_period = _time_ns(text, r"时钟周期")
    freq = _parse_frequency(text)
    if clock_period is None and freq:
        clock_period = 1e9 / freq  # ns
    micro_match = re.search(
        r"(?:(?:微指令|微指令条数|微指令数)\s*(?:为|是|有|=|:)?\s*(\d+)|(\d+)\s*条微指令)", text)
    micro_width = _number_after(text, r"微指令字长|微指令宽度|控制字长", r"位")
    if micro_match and micro_width:
        micro_count = int(micro_match.group(1) or micro_match.group(2))
        capacity_bits = micro_count * int(micro_width)
        frames = [
            _frame(1, "微指令参数", f"微指令 {micro_count} 条，每条 {int(micro_width)} 位。",
                   {"微指令数": str(micro_count), "字长": str(int(micro_width))}, 1),
            _frame(2, "控制存储器容量", f"{micro_count} × {int(micro_width)} = {capacity_bits} 位 = "
                                        f"{capacity_bits / 8:g} B。",
                   {"容量(bit)": str(capacity_bits), "容量(B)": f"{capacity_bits / 8:g}"}, 2),
        ]
        answer = f"控制存储器容量 = {capacity_bits} 位（{capacity_bits / 8:g} B）"
        return _ok("cpu_control", answer, frames, PSEUDOCODES["cpu_control"],
                   [_check("store", "控制存储容量", True, "微指令条数 × 微指令字长。")],
                   ["若控制存储器按字编址，地址线数 = log₂(微指令条数)。"], answer_value=capacity_bits)

    phase_cycles: dict[str, int] = {}
    names = {"取指": r"取指(?:周期|阶段)?", "间址": r"间址(?:周期|阶段)?",
             "执行": r"执行(?:周期|阶段)?", "中断": r"中断(?:周期|阶段)?"}
    for label, pattern in names.items():
        value = _number_after(text, pattern + r"(?:需要|占|为|用|:)?\s*", r"个?(?:时钟)?周期")
        if value is not None:
            phase_cycles[label] = int(value)
    cpi = _parse_cpi(text)
    if phase_cycles:
        total_cycles = sum(phase_cycles.values())
        frames = [_frame(1, "指令周期分解",
                         "；".join(f"{name} {cycles} 周期" for name, cycles in phase_cycles.items())
                         + f"；合计 {total_cycles} 周期。",
                         {name: str(cycles) for name, cycles in phase_cycles.items()} | {"合计": str(total_cycles)}, 1)]
        answer = "每个指令周期 = " + " + ".join(str(v) for v in phase_cycles.values()) + f" = {total_cycles} 个时钟周期"
        if count is not None and clock_period is not None:
            total_time = count * total_cycles * clock_period
            frames.append(_frame(2, "执行时间", f"{fmt(count)} 条 × {total_cycles} 周期 × {fmt(clock_period)} ns = "
                                              f"{fmt(total_time)} ns。",
                                 {"指令数": fmt(count), "总周期": fmt(count * total_cycles), "总时间(ns)": fmt(total_time)}, 2))
            answer += f"；执行 {fmt(count)} 条指令需 {fmt(total_time)} ns"
            return _ok("cpu_control", answer, frames, PSEUDOCODES["cpu_control"],
                       [_check("cycle", "周期分解", True, "取指、间址、执行、中断周期相加。")],
                       ["间址周期只在对间接寻址指令时出现；中断周期按题面给定计入。"],
                       answer_value=total_time)
        return _ok("cpu_control", answer, frames, PSEUDOCODES["cpu_control"],
                   [_check("cycle", "周期分解", True, "各阶段周期数相加。")],
                   ["单周期 CPU 每条指令 1 个时钟周期；多周期 CPU 按阶段分时复用部件。"])
    if cpi is not None and count is not None and clock_period is not None:
        total_time = count * cpi * clock_period
        frames = [
            _frame(1, "CPI 与指令数", f"CPI={fmt(cpi)}，指令数={fmt(count)}，时钟周期={fmt(clock_period)} ns。",
                   {"CPI": fmt(cpi), "指令数": fmt(count)}, 1),
            _frame(2, "总时间", f"T = N×CPI×Tc = {fmt(total_time)} ns。", {"总时间(ns)": fmt(total_time)}, 2),
        ]
        answer = f"CPU 时间 = {fmt(count)} × {fmt(cpi)} × {fmt(clock_period)} ns = {fmt(total_time)} ns"
        return _ok("cpu_control", answer, frames, PSEUDOCODES["cpu_control"],
                   [_check("time", "CPU 时间", True, "T = 指令数 × CPI × 时钟周期。")],
                   ["单周期 CPU 的 CPI 通常为 1；多周期 CPU 由各阶段周期数决定。"], answer_value=total_time)
    if re.search(r"硬布线|微程序|控制器|取指|间址|单周期|多周期|中断周期", text):
        frames = [
            _frame(1, "硬布线控制", "由组合逻辑电路直接产生控制信号，速度快、修改困难，适合 RISC/固定指令集。",
                   {"实现": "组合逻辑"}, 1),
            _frame(2, "微程序控制", "把控制信号存为微指令，从控制存储器逐条取出；设计规整、易修改，但多一次控制存储器访问。",
                   {"实现": "控制存储器 + 微指令"}, 2),
            _frame(3, "周期划分", "指令周期通常划分为取指、间址、执行、中断四个阶段；单周期每条指令一个时钟，多周期按阶段复用数据通路。",
                   {"阶段": "取指/间址/执行/中断"}, 3),
        ]
        answer = ("硬布线控制用组合逻辑产生控制信号；微程序控制把控制信号存为微指令；"
                  "指令周期可划分为取指、间址、执行、中断阶段。")
        return _ok("cpu_control", answer, frames, PSEUDOCODES["cpu_control"],
                   [_check("control", "控制方式", True, "硬布线与微程序控制是两种实现方式。")],
                   ["具体周期数需由题面时序或数据通路给出。"])
    raise ValueError("CPU/控制器题需要周期数、时钟周期、CPI、指令数或微指令条数/字长")


# ---------------------------------------------------------------------------
# 11) 指令流水线
# ---------------------------------------------------------------------------

def _eval_pipeline(text: str) -> dict[str, Any]:
    # 题型 A：已知各功能部件/流水段耗时（与可选流水段寄存器延时），求最短 CPU 时钟周期。
    stem = re.split(r"(?:\r?\n|\s)A[.、]", text, maxsplit=1)[0]
    latch_match = re.search(
        r"(?:流水段寄存器|锁存器|段间寄存器|缓冲寄存器)[^，。；;\n]{0,10}(?:延时|延迟|时间)\s*(?:为|是|=|:|：)?\s*([0-9]+(?:\.[0-9]+)?)\s*(ps|ns|us|μs)",
        stem, re.I,
    )
    stem_wo_latch = stem[:latch_match.start()] + stem[latch_match.end():] if latch_match else stem
    stage_unit_matches = re.findall(r"([0-9]+(?:\.[0-9]+)?)\s*(ps|ns|us|μs)", stem_wo_latch, re.I)
    asks_clock_period = bool(re.search(r"时钟周期(?:至少|最小|最短|为|是)|最短.*周期|流水线周期", stem))
    if len(stage_unit_matches) >= 2 and (asks_clock_period or latch_match is not None):
        unit_scale = {"ps": 1.0, "ns": 1e3, "us": 1e6, "μs": 1e6}
        display_unit = stage_unit_matches[0][1].lower()
        base_scale = unit_scale[display_unit]
        stage_vals = [float(v) * unit_scale[u.lower()] / base_scale for v, u in stage_unit_matches]
        latch_val = (
            float(latch_match.group(1)) * unit_scale[latch_match.group(2).lower()] / base_scale
            if latch_match else 0.0
        )
        max_stage = max(stage_vals)
        min_clock = max_stage + latch_val
        stage_list_text = "、".join(f"{fmt(v)}{display_unit}" for v in stage_vals)
        frames = [
            _frame(1, "各流水段耗时",
                   f"共 {len(stage_vals)} 个功能部件，耗时分别为 {stage_list_text}，最慢段为 {fmt(max_stage)} {display_unit}。",
                   {"段数": str(len(stage_vals)), f"最慢段({display_unit})": fmt(max_stage)}, 1),
            _frame(2, "计入段间寄存器延时",
                   f"流水线时钟周期 ≥ max(各段耗时) + 流水段寄存器延时 = {fmt(max_stage)} + {fmt(latch_val)} = {fmt(min_clock)} {display_unit}。",
                   {f"锁存器延时({display_unit})": fmt(latch_val), f"最短时钟周期({display_unit})": fmt(min_clock)}, 2),
        ]
        answer = (
            f"各段最慢耗时 {fmt(max_stage)} {display_unit}"
            + (f"，加流水段寄存器延时 {fmt(latch_val)} {display_unit}" if latch_val > 0 else "")
            + f"，CPU 时钟周期至少为 {fmt(min_clock)} {display_unit}"
        )
        return _ok(
            "pipeline", answer, frames, PSEUDOCODES["pipeline"],
            [_check("clock", "最短时钟周期", True, "T_clk ≥ max(各功能段耗时) + 流水段寄存器延时。")],
            ["流水线时钟周期由最慢功能段决定，有段间寄存器时需额外加上寄存器延时。"],
            answer_value=min_clock,
        )

    stage_match = re.search(r"(\d+)\s*段(?:流水线)?|流水线[^。；;\n]{0,8}(\d+)\s*段|k\s*=\s*(\d+)", text)
    count = _parse_instruction_count(text)
    if count is None:
        count_match = re.search(r"(?:执行|完成|连续输入)\s*(\d+)\s*条指令|n\s*=\s*(\d+)", text)
        count = float(count_match.group(1) or count_match.group(2)) if count_match else None
    if stage_match is None or count is None:
        if re.search(r"结构冒险|数据冒险|控制冒险|转发|暂停|冒险", text):
            frames = [
                _frame(1, "结构冒险", "多条指令争用同一部件（如存储器/ALU）导致冲突；可用分离指令/数据 Cache、"
                                     "增加部件或插入暂停解决。", {"冒险": "结构"}, 1),
                _frame(2, "数据冒险", "后续指令依赖前面尚未写回的结果；可用转发（旁路）提前取得结果，"
                                     "无法转发时插入暂停。", {"冒险": "数据 / 转发 / 暂停"}, 2),
                _frame(3, "控制冒险", "转移指令改变取指方向，可能取到错误指令；可用分支预测、延迟槽或清空流水线。",
                       {"冒险": "控制"}, 3),
                _frame(4, "性能", "实际周期数 = 理想 k+n−1 + 停顿周期；吞吐率和加速比都会因冒险下降。",
                       {"周期": "理想 + 停顿"}, 4),
            ]
            answer = ("流水线三类冒险：结构冒险（部件冲突）、数据冒险（数据依赖）、控制冒险（转移）；"
                      "常用转发/旁路、暂停、分支预测和分离 Cache 处理。")
            return _ok("pipeline", answer, frames, PSEUDOCODES["pipeline"],
                       [_check("hazard", "冒险分类", True, "结构/数据/控制冒险来源不同。")],
                       ["具体停顿周期和加速比需要流水段数、指令数和每类冒险的停顿数。"])
        raise ValueError("流水线题需要流水段数 k 和指令数 n")
    stages = int(next(group for group in stage_match.groups() if group))
    n = int(count)
    clock_ns = _time_ns(text, r"时钟周期|流水线周期|每段时钟")
    stage_times = [float(item) for item in re.findall(r"(\d+(?:\.\d+)?)\s*ns", text)] if clock_ns is None else []
    if clock_ns is None:
        if stage_times and len(stage_times) >= stages:
            clock_ns = max(stage_times[:stages])
        else:
            raise ValueError("流水线题需要时钟周期或各段时间")
    stall_match = re.search(
        r"(?:停顿|暂停|阻塞|气泡)\s*(\d+)\s*个?(?:时钟)?周期|(\d+)\s*个?(?:时钟)?周期(?:的)?[^\n。；]{0,12}(?:停顿|暂停|阻塞|气泡)",
        text)
    stalls = int(stall_match.group(1) or stall_match.group(2)) if stall_match else 0
    cycles = stages + (n - 1) + stalls
    time_total = cycles * clock_ns
    sequential_cycles = n * stages
    speedup = sequential_cycles / cycles
    throughput = n / time_total
    frames = [
        _frame(1, "流水参数", f"{stages} 段流水线，{n} 条指令，时钟周期 {fmt(clock_ns)} ns，"
                              f"附加停顿 {stalls} 周期。",
               {"段数": str(stages), "指令数": str(n), "时钟周期(ns)": fmt(clock_ns)}, 1),
        _frame(2, "总周期数", f"k+(n−1)+stalls = {stages}+{n - 1}+{stalls} = {cycles} 周期；"
                              f"总时间 {fmt(time_total)} ns。",
               {"总周期": str(cycles), "总时间(ns)": fmt(time_total)}, 2),
        _frame(3, "性能", f"加速比 = 顺序周期/流水线周期 = {fmt(speedup)}；"
                          f"吞吐率 = {fmt(throughput * 1e9)} 条/秒。",
               {"加速比": fmt(speedup), "吞吐率(条/s)": fmt(throughput * 1e9)}, 3),
    ]
    if stages <= 6 and n <= 8:
        lines = []
        max_cycle = min(cycles, 32)
        for instruction in range(1, n + 1):
            start = instruction - 1
            slots = []
            for cycle in range(max_cycle):
                if start <= cycle < start + stages:
                    slots.append(f"S{cycle - start + 1:>2}")
                else:
                    slots.append("  ")
            lines.append(f"I{instruction}: " + " ".join(slots))
        frames.append(_frame(4, "时空图", "\n".join(lines), {"时空图": "\n".join(lines)}, 4))
    answer = (f"{stages} 段流水线执行 {n} 条指令需 {cycles} 个周期（含 {stalls} 个停顿），"
              f"加速比 ≈ {fmt(speedup)}，吞吐率 ≈ {fmt(throughput * 1e9)} 条/s")
    return _ok("pipeline", answer, frames, PSEUDOCODES["pipeline"],
               [_check("cycles", "总周期", True, "理想 k+n−1，再叠加停顿周期。"),
                _check("speedup", "加速比", True, "顺序时间/流水线时间。")],
               ["各段不等时按最慢段作为流水线时钟；结构/数据/控制冒险需转成停顿周期后再叠加。"],
               answer_value=float(cycles))


# ---------------------------------------------------------------------------
# 12) 总线与输入输出
# ---------------------------------------------------------------------------

def _eval_bus_io(text: str) -> dict[str, Any]:
    width_bits = _number_after(text, r"总线宽度?|数据总线宽度?|数据线宽度?", r"位")
    if width_bits is None:
        bytes_match = re.search(r"(?:并行)?(?:传输|传送)\s*(\d+(?:\.\d+)?)\s*(?:字节|B\b)", text, re.I)
        if bytes_match:
            width_bits = float(bytes_match.group(1)) * 8.0
    frequency = _parse_frequency(text)
    cycle_ns = _time_ns(text, r"总线周期|传输周期|总线时钟周期")
    transfers = _number_after(text, r"(?:每次|每个周期|每周期)(?:传送|传输)", r"次|个")
    per_n_cycles = re.search(r"每\s*(\d+)\s*个?(?:总线|时钟)?周期(?:传送|传输)\s*(\d+|一)?\s*次?", text)
    clocks_per_bus_cycle = re.search(
        r"(?:一个|每个?)\s*总线周期(?:占用?|包含|需要|为)\s*(\d+)\s*个?(?:总线)?时钟周期", text
    )
    if width_bits is not None and (frequency or cycle_ns):
        if per_n_cycles and transfers is None:
            cyc_n = max(1, int(per_n_cycles.group(1)))
            tx_raw = per_n_cycles.group(2)
            tx_k = 1 if (not tx_raw or tx_raw == "一") else int(tx_raw)
            transfer_rate_ratio = tx_k / cyc_n
            rate_desc = f"每 {cyc_n} 周期传送 {tx_k} 次"
        elif clocks_per_bus_cycle and transfers is None:
            cyc_n = max(1, int(clocks_per_bus_cycle.group(1)))
            transfer_rate_ratio = 1.0 / cyc_n
            rate_desc = f"每总线周期占 {cyc_n} 个时钟周期"
        else:
            transfer_rate_ratio = float(int(transfers) if transfers else 1)
            rate_desc = f"每周期传送 {int(transfer_rate_ratio)} 次"
        if cycle_ns:
            bandwidth_bytes = (width_bits / 8) * transfer_rate_ratio / (cycle_ns * 1e-9)
            formula_rhs = f"{fmt(width_bits / 8)} B × {fmt(transfer_rate_ratio)} ÷ {fmt(cycle_ns)} ns"
        else:
            bandwidth_bytes = (width_bits / 8) * (frequency or 0.0) * transfer_rate_ratio
            formula_rhs = f"{fmt(width_bits / 8)} B × {fmt(transfer_rate_ratio)} × {fmt((frequency or 0.0) / 1e6)} MHz"
        frames = [
            _frame(1, "总线参数", f"宽度 {fmt(width_bits)} 位（{fmt(width_bits / 8)} B），"
                                 f"{'周期 ' + fmt(cycle_ns) + ' ns' if cycle_ns else '频率 ' + fmt((frequency or 0.0) / 1e6) + ' MHz'}，"
                                 f"{rate_desc}。",
                   {"宽度(位)": fmt(width_bits), "传送节奏": rate_desc}, 1),
            _frame(2, "带宽", f"带宽 = {formula_rhs} = {fmt(bandwidth_bytes / 1e6)} MB/s。",
                   {"带宽(MB/s)": fmt(bandwidth_bytes / 1e6)}, 2),
        ]
        answer = f"总线带宽 ≈ {fmt(bandwidth_bytes / 1e6)} MB/s"
        return _ok("bus_io", answer, frames, PSEUDOCODES["bus_io"],
                   [_check("bandwidth", "总线带宽", True, "宽度×传送频率。")],
                   ["总线带宽按理想连续传送计算，不含仲裁和等待周期。"], answer_value=bandwidth_bytes)

    block_size = _size_bytes(text, r"块大小|每次传送|数据块|缓冲区")
    total_size = _size_bytes(text, r"总数据量|传送数据|数据量|文件大小|传送|传输")
    overhead_cycles = _number_after(text, r"每次(?:查询|中断|DMA)?(?:需要|占|用)?\s*", r"个?(?:时钟)?周期")
    setup_cycles = _number_after(text, r"DMA\s*(?:初始化|启动|建立)(?:需要|占|用)?\s*", r"个?(?:时钟)?周期")
    clock_ns = _time_ns(text, r"时钟周期")
    freq = _parse_frequency(text)
    if clock_ns is None and freq:
        clock_ns = 1e9 / freq
    if block_size and total_size and clock_ns:
        blocks = math.ceil(total_size / block_size)
        if re.search(r"DMA", text, re.I):
            cycles = int(setup_cycles or overhead_cycles or 0)
            method = "DMA"
            detail = f"DMA 只计入 {cycles} 个初始化周期，数据搬运由控制器完成。"
        elif re.search(r"中断", text):
            per = int(overhead_cycles or 0)
            cycles = blocks * per
            method = "中断"
            detail = f"{blocks} 块 × 每块 {per} 周期中断开销 = {cycles} 周期。"
        else:
            per = int(overhead_cycles or 0)
            cycles = blocks * per
            method = "程序查询"
            detail = f"{blocks} 块 × 每块 {per} 周期查询开销 = {cycles} 周期。"
        cpu_time_ns = cycles * clock_ns
        frames = [
            _frame(1, "传输规模", f"总数据 {fmt(total_size)} B，块大小 {fmt(block_size)} B，共 {blocks} 块。",
                   {"总数据(B)": fmt(total_size), "块数": str(blocks)}, 1),
            _frame(2, "CPU 开销", detail + f" CPU 时间 = {fmt(cpu_time_ns)} ns。",
                   {"方式": method, "周期数": str(cycles), "CPU时间(ns)": fmt(cpu_time_ns)}, 2),
        ]
        answer = f"{method}方式：{blocks} 块，CPU 开销 {cycles} 周期，约 {fmt(cpu_time_ns)} ns"
        return _ok("bus_io", answer, frames, PSEUDOCODES["bus_io"],
                   [_check("overhead", "CPU 开销", True, "程序查询/中断按块计数，DMA 只计初始化。")],
                   ["总线占用时间与 CPU 开销是不同口径；本演示只回答 CPU 开销。"], answer_value=cpu_time_ns)

    if re.search(r"中断优先级|嵌套|仲裁|链式查询|DMA|程序查询|中断", text):
        priority_match = re.search(
            r"优先级\s*(?:分别)?\s*(?:为|是|=|:|：)?\s*((?:\d+\s*[、,，和及与]?\s*)+)", text)
        priorities = [int(item) for item in re.findall(r"\d+", priority_match.group(1))] if priority_match else []
        if priorities:
            order = sorted(range(len(priorities)), key=lambda index: priorities[index], reverse=True)
            names = [f"设备{index + 1}" for index in order]
            answer = "中断优先级从高到低：" + " → ".join(names) + f"；最多嵌套 {len(priorities)} 层"
            frames = [_frame(1, "优先级排序", answer, {"顺序": " → ".join(names)}, 1)]
            return _ok("bus_io", answer, frames, PSEUDOCODES["bus_io"],
                       [_check("priority", "优先级", True, "数值越大优先级越高；高优先级可打断低优先级。")],
                       ["若题目规定数值越小优先级越高，请交换排序方向。"])
        frames = [
            _frame(1, "程序查询", "CPU 反复读取设备状态，未就绪时忙等；实现简单但 CPU 开销大。",
                   {"方式": "程序查询"}, 1),
            _frame(2, "中断", "设备就绪后发中断，CPU 执行中断服务程序；需保存/恢复现场，支持优先级与嵌套。",
                   {"方式": "中断"}, 2),
            _frame(3, "DMA", "DMA 控制器直接在主存与设备间搬运数据，CPU 只在初始化和结束时介入，适合大块高速传输。",
                   {"方式": "DMA"}, 3),
            _frame(4, "总线仲裁", "多个主设备竞争总线时由仲裁器决定使用权；链式查询、计数器定时查询、独立请求是常见方式。",
                   {"仲裁": "链式/计数器/独立请求"}, 4),
        ]
        answer = "程序查询由 CPU 忙等；中断由设备主动通知并支持优先级嵌套；DMA 由控制器直接搬运；总线仲裁决定主设备使用权。"
        return _ok("bus_io", answer, frames, PSEUDOCODES["bus_io"],
                   [_check("io", "I/O 方式", True, "三种方式的 CPU 参与程度不同。")],
                   ["具体 CPU 时间开销需给出块大小、次数和每块周期数。"])
    raise ValueError("总线/I/O 题需要总线宽度与周期/频率，或数据块与 CPU 开销周期")






_EVALUATORS = {
    "performance": _eval_performance,
    "data_repr": lambda text: _eval_machine_code(text) if re.search(
        r"原码|反码|补码|移码|符号扩展|有符号|无符号", text) else _eval_base_conversion(text),
    "fixed_point": lambda text: (
        _eval_fixed_shift(text) if re.search(r"移位|左移|右移", text)
        else _eval_fixed_muldiv(text) if re.search(
            r"乘法|除法|乘除|相乘|相除|一位乘|一位除|Booth|恢复余数|×|÷|乘|除以", text)
        else _eval_fixed_addsub(text)),
    "floating": _eval_floating,
    "datapath": _eval_datapath,
    "memory": _eval_memory,
    "cache": _eval_cache,
    "virtual_memory": _eval_virtual_memory,
    "instruction": _eval_instruction,
    "cpu_control": _eval_cpu_control,
    "pipeline": _eval_pipeline,
    "bus_io": _eval_bus_io,
}


def _detect_kind(text: str, merged: Mapping[str, Any]) -> str | None:
    explicit = str(merged.get("co_kind") or "").strip()
    if explicit in KIND_LABELS:
        return explicit
    if re.search(r"流水线|时空图|吞吐率|结构冒险|数据冒险|控制冒险|转发|暂停", text, re.I):
        return "pipeline"
    if re.search(r"取指|间址|中断周期|控制器|微程序|微指令|硬布线|单周期|多周期|控制存储器", text):
        return "cpu_control"
    if re.search(r"Cache|缓存", text, re.I) and re.search(
            r"组相联|直接映射|标记|Tag|组号|Index|块内偏移|Offset|Cache\s*组号|Cache\s*行号|映射到\s*Cache",
            text, re.I):
        return "cache"
    if re.search(r"虚拟存储|虚拟地址|虚地址|虚实地址|页表|TLB|快表|页框|物理地址|缺页", text, re.I):
        return "virtual_memory"
    if re.search(r"Cache|缓存|相联|命中率|替换策略|替换算法|写直达|写回|写分配", text, re.I):
        return "cache"
    if re.search(r"存储容量|地址线|数据线|字扩展|位扩展|芯片|交叉编址|交叉存储|主存储器|主存容量",
                 text, re.I):
        return "memory"
    if re.search(r"总线|DMA|程序查询|中断方式|中断优先级|嵌套|仲裁|输入输出|I/O", text, re.I):
        return "bus_io"
    if re.search(r"指令格式|操作码|寻址|有效地址|机器指令|指令编码|C\s*表达式|三地址|二地址", text, re.I):
        return "instruction"
    if re.search(r"加速比|性能比|快多少|性能提升|性能是.*倍", text):
        return "performance"
    if re.search(r"CPU\s*时间|执行时间|主频|时钟频率|时钟周期|CPI|MIPS|指令(?:数量|条数|数)", text, re.I):
        return "performance"
    if re.search(r"IEEE|754|浮点|单精度|双精度|阶码|尾数", text, re.I):
        return "floating"
    if re.search(r"进制|二进制|八进制|十进制|十六进制", text) and re.search(
            r"转换|转成|转为|化为|变成|转", text):
        return "data_repr"
    if re.search(r"符号扩展", text):
        return "data_repr"
    if re.search(r"算术移位|逻辑移位|循环移位|移位|左移|右移", text):
        return "fixed_point"
    if re.search(r"乘法|除法|乘除|相乘|相除|一位乘|一位除|Booth|恢复余数|×|÷|乘|除以", text):
        return "fixed_point"
    if re.search(r"原码|反码|补码|移码|有符号数|无符号数", text):
        if re.search(r"补码\s*[加减]|溢出|标志|CF|ZF|SF|OF", text, re.I):
            return "fixed_point"
        return "data_repr"
    if re.search(r"ALU|算术逻辑|加法器|多路选择器|数据选择器|MUX|寄存器传送|寄存器\s*R\d+|数据通路|控制信号",
                 text, re.I):
        return "datapath"
    return None


def build_comp_org(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any]:
    merged = {**dict(overrides.get("condition_values") or {}),
              **dict(overrides.get("ambiguity_answers") or {}),
              **dict(overrides or {})}
    kind = _detect_kind(text, merged)
    if kind is None:
        model = {"engine": "co_unknown_v1", "subject": "computer_organization", "co_kind": None,
                 "raw": text, "defaults": {}, "params": [], "teaching": False}
        built = _built("data_repr", model, [], [])
        built["ambiguities"].append(_ambiguity(
            "co_kind",
            "已识别为计算机组成原理内容，但没有确定题型：性能、数据表示、定点运算、浮点数还是数据通路？",
            options=[{"value": key, "label": label} for key, label in KIND_LABELS.items()]))
        built["recognized"] = False
        return built
    model = {"engine": ENGINES[kind], "subject": "computer_organization", "co_kind": kind,
             "raw": text, "defaults": {}, "params": [], "teaching": False}
    if kind == "cache" and re.search(r"(?:主存)?块号\s*(?:为|是|=|:|：)?\s*\d+", text):
        model["target_kind"] = "cache_address_and_mapping"
    conditions = [_condition("co_kind", "题型", KIND_LABELS[kind], source=source)]
    formulas = [{
        "id": "co_rule",
        "tex": r"\text{位宽/码制/格式约定决定结果}",
        "plain": "所有数值按题面位宽、码制与 IEEE 格式约定计算；结果中注明口径。",
        "role": "计算口径",
    }]
    return _built(kind, model, conditions, formulas)


def evaluate_comp_org(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    kind = str(model.get("co_kind") or "")
    text = str(model.get("raw") or "")
    evaluator = _EVALUATORS.get(kind)
    if evaluator is None:
        return _blocked(kind or "data_repr", "未确定计算机组成原理题型，无法执行")
    try:
        return evaluator(text)
    except ValueError as exc:
        return _blocked(kind, str(exc))


def solve_comp_org(model: Mapping[str, Any]) -> dict[str, Any]:
    result = evaluate_comp_org(model, model.get("defaults") or {})
    if result.get("status") != "ok":
        raise ValueError(result.get("reason") or "该计算机组成原理题目的条件不足")
    try:
        model["co_result"] = result
    except TypeError:
        pass
    kind = str(model.get("co_kind") or "")
    steps = [{"id": f"co_{frame['index']}", "title": frame["label"], "detail": frame["detail"]}
             for frame in result["frames"][:8]]
    summary = {
        "performance": "按 CPU 时间公式计算指令数、CPI、主频/时钟周期、执行时间与加速比。",
        "data_repr": "按位权与码制规则完成进制转换、编码/解码、符号扩展。",
        "fixed_point": "在固定位宽下执行补码加减、移位或乘除，并给出标志位。",
        "floating": "按 IEEE 754 字段拆分/编码，处理规格化、舍入与上下溢。",
        "datapath": "按 ALUop、选择信号与写使能模拟数据流和控制信号。",
    }.get(kind, "计算机组成原理确定性求解。")
    return {
        "summary": summary,
        "answer": result["answer"],
        "answer_value": result.get("answer_value"),
        "answer_order": result.get("answer_order"),
        "steps": steps,
        "conditions": ["全部结果由题面位宽、码制与格式约定确定性计算。"],
        "limitations": list(result.get("notes") or []),
    }


__all__ = ["KIND_LABELS", "build_comp_org", "evaluate_comp_org", "solve_comp_org"]

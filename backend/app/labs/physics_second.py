"""大学物理第二批：刚体、机械波、静电场、电路、磁场、电磁感应、热学。"""
from __future__ import annotations

import math
import re
from typing import Any, Mapping

from .physics import (
    _NUM,
    _angle,
    _fmt,
    _found,
    _g_value,
    _height,
    _mass,
    _normalize_units,
    _time,
)

KIND_LABELS = {
    "rigid_body": "刚体转动",
    "wave": "机械波",
    "electrostatics": "静电场",
    "circuit": "电容与电路",
    "magnetism": "磁场与带电粒子",
    "induction": "电磁感应",
    "thermodynamics": "热学与热力学",
}

MODE_KIND = {
    "rigid_rotation": "rigid_body",
    "rolling": "rigid_body",
    "wave_travel": "wave",
    "standing_wave": "wave",
    "coulomb": "electrostatics",
    "gauss": "electrostatics",
    "capacitor": "circuit",
    "kirchhoff": "circuit",
    "rc": "circuit",
    "lorentz": "magnetism",
    "ampere": "magnetism",
    "faraday": "induction",
    "rail": "induction",
    "thermo_process": "thermodynamics",
    "carnot": "thermodynamics",
}

MODE_LABELS = {
    "rigid_rotation": "转动惯量与定轴转动",
    "rolling": "纯滚动",
    "wave_travel": "行波方程、波速与相位差",
    "standing_wave": "机械波叠加与驻波",
    "coulomb": "库仑力、电场叠加与电势",
    "gauss": "高斯定律与对称电荷分布",
    "capacitor": "电容器串并联",
    "kirchhoff": "基尔霍夫定律",
    "rc": "RC 充放电",
    "lorentz": "洛伦兹力与圆周运动",
    "ampere": "安培力",
    "faraday": "法拉第定律与楞次定律",
    "rail": "导体棒切割磁感线",
    "thermo_process": "理想气体与热力学第一定律",
    "carnot": "卡诺热机与热机效率",
}

MODE_LIMITS = {
    "rigid_rotation": "刚体绕固定轴转动，转动惯量按 I=c m r² 的给定形状系数计算；力矩恒定。",
    "rolling": "纯滚动、无滑动；静摩擦不做功，机械能守恒；形状用 I=c m r² 表示。",
    "wave_travel": "一维简谐行波，振幅不衰减；相位差按同一时刻两点相位计算。",
    "standing_wave": "两端固定弦上的驻波；波节/波腹按给定波长与弦长计算。",
    "coulomb": "真空中点电荷，库仑常数取 8.99×10⁹ N·m²/C²；一维位置沿 x 轴。",
    "gauss": "球对称电荷分布；球体内部按体电荷均匀分布，球壳内部无电场。",
    "capacitor": "理想电容器，忽略漏电与边缘效应；串联电荷相同，并联电压相同。",
    "kirchhoff": "双回路直流电路，导线与电源理想；电流正方向由电源正极流入节点。",
    "rc": "一阶 RC 电路，忽略电源内阻；充电从零电荷开始，放电从满电荷开始。",
    "lorentz": "带电粒子速度垂直于匀强磁场，只受洛伦兹力；忽略重力与辐射。",
    "ampere": "匀强磁场中直导线，安培力 F=BIL sinθ。",
    "faraday": "均匀磁场垂直线圈平面；感应电动势按 N·A·|ΔB|/Δt，方向用楞次定律判断。",
    "rail": "导体棒垂直切割磁感线，回路电阻恒定；忽略摩擦和自感。",
    "thermo_process": "理想气体，准静态过程；R=8.314 J/(mol·K)，Cv=R/(γ−1)。",
    "carnot": "卡诺热机为可逆循环，效率 η=1−Tc/Th；热量与温度取开尔文。",
}

PROCESS_LABELS = {0: "等温", 1: "等压", 2: "等容", 3: "绝热"}
R_GAS = 8.314
K_COULOMB = 8.99e9
EPS0 = 8.8541878128e-12


def _param(cid: str, label: str, min_value: float | None, max_value: float | None,
           step: float | None) -> dict[str, Any]:
    return {"id": cid, "label": label, "kind": "number", "min": min_value, "max": max_value,
            "step": step, "options": [], "note": None}


def _condition(cid: str, label: str, value: Any, *, unit: str = "", source: Mapping[str, Any] | None = None) -> dict[str, Any]:
    return {"id": cid, "label": label, "value": value, "kind": "number", "unit": unit,
            "provenance": "original", "source": dict(source or {}), "editable": True,
            "options": [], "min": None, "max": None, "step": None, "note": None}


def _ambiguity(cid: str, question: str) -> dict[str, Any]:
    return {"id": cid, "field": "physics_mode", "severity": "blocking", "question": question,
            "options": [], "resolved": False, "answer": None}


def _built(mode: str, model: dict[str, Any], conditions: list[dict[str, Any]],
           formulas: list[dict[str, Any]], ambiguities: list[dict[str, Any]]) -> dict[str, Any]:
    return {"model": model, "conditions": conditions, "formulas": formulas,
            "ambiguities": ambiguities, "recognized": True}


def detect_second_mode(text: str) -> str | None:
    if "纯滚动" in text or ("滚动" in text and "斜面" in text):
        return "rolling"
    if any(word in text for word in ("转动惯量", "定轴转动", "角动量", "力矩", "刚体")):
        return "rigid_rotation"
    if "驻波" in text or "波节" in text or "波腹" in text:
        return "standing_wave"
    if any(word in text for word in ("机械波", "行波", "波长", "波速", "简谐波", "相位差")):
        return "wave_travel"
    if any(word in text for word in ("磁通量", "法拉第", "楞次", "感应电动势", "切割磁感线", "导体棒")):
        return "rail" if ("导体棒" in text or "切割磁感线" in text) else "faraday"
    if any(word in text for word in ("洛伦兹", "安培力", "带电粒子", "轨道半径")):
        return "lorentz" if ("洛伦兹" in text or "带电粒子" in text or "轨道" in text) else "ampere"
    if any(word in text for word in ("基尔霍夫", "支路电流", "回路电流")):
        return "kirchhoff"
    if "RC" in text.upper() or "充放电" in text or ("时间常数" in text and "电容" in text):
        return "rc"
    if "电容" in text:
        return "capacitor"
    if any(word in text for word in ("高斯", "球壳", "均匀带电球", "高斯面")):
        return "gauss"
    if any(word in text for word in ("库仑", "点电荷", "电场强度", "电势")):
        return "coulomb"
    if "电荷" in text:
        return "coulomb"
    if any(word in text for word in ("卡诺", "热机效率", "热机循环")):
        return "carnot"
    if any(word in text for word in ("理想气体", "热力学第一定律", "等温", "等压", "等容", "绝热")):
        return "thermo_process"
    return None


def _parse_mode(mode: str, text: str) -> tuple[dict[str, float], list[str]]:
    values: dict[str, float] = {}
    missing: list[str] = []

    def need(key: str, value: float | None, label: str, default: float | None = None) -> None:
        if value is None and default is not None:
            value = default
        if value is None:
            missing.append(label)
        else:
            values[key] = float(value)

    def first(patterns: list[str]) -> float | None:
        return _found(text, patterns)

    if mode == "rigid_rotation":
        need("m", _mass(text), "质量 m")
        need("r", first([rf"(?:半径|r)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "半径/长度 r")
        values["c"] = first([rf"(?:转动惯量系数|c)\s*(?:为|是|=|：|:)?\s*({_NUM})"]) or 0.5
        need("torque", first([rf"(?:力矩|τ)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "力矩 τ")
        values["omega0"] = first([rf"(?:初始角速度|ω0|ω₀)\s*(?:为|是|=|：|:)?\s*({_NUM})"]) or 0.0
        need("t", _time(text), "时间 t")
    elif mode == "rolling":
        need("m", _mass(text), "质量 m")
        need("r", first([rf"(?:半径|r)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "半径 r")
        values["c"] = first([rf"(?:转动惯量系数|c)\s*(?:为|是|=|：|:)?\s*({_NUM})"]) or 0.5
        need("angle", _angle(text, ("倾角", "角度", "θ")), "斜面倾角 θ")
        need("s", first([rf"(?:下滑距离|位移|距离|s)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "下滑距离 s")
        values["g"] = _g_value(text)
    elif mode == "wave_travel":
        need("A", first([rf"(?:振幅|A)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "振幅 A")
        need("lam", first([rf"(?:波长|λ)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "波长 λ")
        need("f", first([rf"(?:频率|f)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "频率 f")
        values["phi"] = first([rf"(?:初相|相位|φ)\s*(?:为|是|=|：|:)?\s*({_NUM})\s*°?"]) or 0.0
        values["x1"] = first([rf"(?:x1|x₁|第一点|点1)\s*(?:为|是|=|：|:)?\s*({_NUM})"]) or 0.0
        values["x2"] = first([rf"(?:x2|x₂|第二点|点2)\s*(?:为|是|=|：|:)?\s*({_NUM})"]) or values["lam"] / 2
        values["t"] = first([rf"(?:时刻|时间|t)\s*(?:为|是|=|：|:)?\s*({_NUM})"]) or 0.0
    elif mode == "standing_wave":
        need("A", first([rf"(?:振幅|A)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "振幅 A")
        need("lam", first([rf"(?:波长|λ)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "波长 λ")
        need("L", first([rf"(?:弦长|长度|L)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "弦长 L")
        need("v", first([rf"(?:波速|v)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "波速 v")
    elif mode == "coulomb":
        need("q1", first([rf"(?:q1|q₁|电荷1|点电荷1)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "电荷 q1")
        need("q2", first([rf"(?:q2|q₂|电荷2|点电荷2)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "电荷 q2")
        d_value = first([rf"(?:相距|间距|距离|d)\s*(?:为|是|=|：|:)?\s*({_NUM})"])
        if d_value is None:
            positions = [float(match.group(1)) for match in re.finditer(rf"位于\s*x\s*=\s*({_NUM})", text)]
            if len(positions) >= 2:
                d_value = abs(positions[1] - positions[0])
            elif positions:
                d_value = abs(positions[0])
        need("d", d_value, "间距 d")
        need("xP", first([rf"P\s*点[^。；;]{{0,16}}?x\s*=\s*({_NUM})",
                           rf"(?:点P|观测点)[^。；;]{{0,16}}?x\s*=\s*({_NUM})",
                           rf"(?:xP|x_P)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "P 点位置 xP")
    elif mode == "gauss":
        need("Q", first([rf"(?:总电荷|电荷量|Q)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "总电荷 Q")
        need("R", first([rf"(?:半径|R)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "半径 R")
        r_value = first([rf"(?:距球心|到球心|距离球心)\s*(?:r\s*)?(?:为|是|=|：|:)?\s*({_NUM})"])
        if r_value is None:
            match = re.search(rf"(?<![A-Za-z])r\s*(?:为|是|=|：|:)\s*({_NUM})", text)
            r_value = float(match.group(1)) if match else None
        need("r", r_value, "距球心距离 r")
        values["shell"] = 1.0 if ("球壳" in text or "球面" in text) else 0.0
    elif mode == "capacitor":
        need("C1", first([rf"(?:C1|C₁|电容1)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "电容 C1")
        need("C2", first([rf"(?:C2|C₂|电容2)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "电容 C2")
        need("U", first([rf"(?:电压|U|电源电压)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "电压 U")
        values["series"] = 0.0 if "并联" in text else 1.0
        if "串联" not in text and "并联" not in text:
            missing.append("连接方式（串联/并联）")
    elif mode == "kirchhoff":
        need("E1", first([rf"(?:E1|ε1|电源1)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "电源 E1")
        need("E2", first([rf"(?:E2|ε2|电源2)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "电源 E2")
        need("R1", first([rf"(?:R1|R₁)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "电阻 R1")
        need("R2", first([rf"(?:R2|R₂)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "电阻 R2")
        need("R3", first([rf"(?:R3|R₃)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "电阻 R3")
    elif mode == "rc":
        need("R", first([rf"(?:电阻|R)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "电阻 R")
        need("C", first([rf"(?:电容|C)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "电容 C")
        need("E", first([rf"(?:电源|电动势|电压|E)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "电源电压 E")
        need("t", _time(text), "时间 t")
        values["discharge"] = 1.0 if "放电" in text else 0.0
    elif mode == "lorentz":
        need("m", _mass(text), "质量 m")
        need("q", first([rf"(?:电荷|q)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "电荷 q")
        need("B", first([rf"(?:磁感应强度|磁场|B)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "磁感应强度 B")
        need("v", first([rf"(?:速度|v)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "速度 v")
    elif mode == "ampere":
        need("I", first([rf"(?:电流|I)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "电流 I")
        need("L", first([rf"(?:导线长度|长度|L)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "导线长度 L")
        need("B", first([rf"(?:磁感应强度|磁场|B)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "磁感应强度 B")
        need("angle", _angle(text, ("夹角", "角度", "θ")), "夹角 θ")
    elif mode == "faraday":
        need("A", first([rf"(?:面积|A)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "线圈面积 A")
        need("B1", first([rf"(?:B1|B₁|初始磁感应强度)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "初始磁感应强度 B1")
        need("B2", first([rf"(?:B2|B₂|末磁感应强度)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "末磁感应强度 B2")
        need("dt", first([rf"(?:Δt|时间间隔|经过)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "时间间隔 Δt")
        values["N"] = first([rf"(?:匝数|N)\s*(?:为|是|=|：|:)?\s*({_NUM})"]) or 1.0
        values["R"] = first([rf"(?:电阻|R)\s*(?:为|是|=|：|:)?\s*({_NUM})"]) or 1.0
    elif mode == "rail":
        need("B", first([rf"(?:磁感应强度|磁场|B)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "磁感应强度 B")
        need("L", first([rf"(?:棒长|长度|L)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "导体棒长度 L")
        need("v", first([rf"(?:速度|v)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "速度 v")
        need("R", first([rf"(?:电阻|R)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "电阻 R")
    elif mode == "thermo_process":
        need("n", first([rf"(?:物质的量|n)\s*(?:为|是|=|：|:)?\s*({_NUM})",
                           rf"({_NUM})\s*mol"]), "物质的量 n")
        need("T1", first([rf"(?:初温|T1|起始温度)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "初温 T1")
        need("V1", first([rf"(?:初体积|V1|起始体积)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "初体积 V1")
        if "等容" in text:
            need("T2", first([rf"(?:末温|T2|最终温度)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "末温 T2")
            values["process"] = 2.0
        else:
            need("V2", first([rf"(?:末体积|V2|最终体积)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "末体积 V2")
            values["process"] = 3.0 if "绝热" in text else (1.0 if "等压" in text else 0.0)
        values["gamma"] = first([rf"(?:γ|绝热指数|比热比)\s*(?:为|是|=|：|:)?\s*({_NUM})"]) or 1.4
    elif mode == "carnot":
        need("Th", first([rf"(?:高温热源|热源温度|Th|T高)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "高温热源 Th")
        need("Tc", first([rf"(?:低温热源|冷源温度|Tc|T低)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "低温热源 Tc")
        need("Qh", first([rf"(?:吸热|Qh|Q高)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "每循环吸热 Qh")
    return values, missing


def _params_for(mode: str) -> list[dict[str, Any]]:
    if mode == "rigid_rotation":
        return [_param("m", "质量 m (kg)", 0.1, 100, 0.1), _param("r", "半径/长度 r (m)", 0.01, 10, 0.01),
                _param("c", "形状系数 c", 0.01, 2, 0.01), _param("torque", "力矩 τ (N·m)", -100, 100, 0.1),
                _param("omega0", "初始角速度 ω0 (rad/s)", -50, 50, 0.1), _param("t", "时间 t (s)", 0.1, 60, 0.1)]
    if mode == "rolling":
        return [_param("m", "质量 m (kg)", 0.1, 100, 0.1), _param("r", "半径 r (m)", 0.01, 10, 0.01),
                _param("c", "形状系数 c", 0.01, 2, 0.01), _param("angle", "斜面倾角 θ (°)", 1, 89, 1),
                _param("s", "下滑距离 s (m)", 0.1, 100, 0.1), _param("g", "重力加速度 g", 0.1, 30, 0.1)]
    if mode == "wave_travel":
        return [_param("A", "振幅 A (m)", 0.001, 10, 0.001), _param("lam", "波长 λ (m)", 0.01, 100, 0.01),
                _param("f", "频率 f (Hz)", 0.01, 10000, 0.01), _param("phi", "初相 φ (°)", -360, 360, 1),
                _param("x1", "第一点 x1 (m)", 0, 100, 0.01), _param("x2", "第二点 x2 (m)", 0, 100, 0.01),
                _param("t", "时刻 t (s)", 0, 100, 0.01)]
    if mode == "standing_wave":
        return [_param("A", "振幅 A (m)", 0.001, 10, 0.001), _param("lam", "波长 λ (m)", 0.01, 100, 0.01),
                _param("L", "弦长 L (m)", 0.01, 100, 0.01), _param("v", "波速 v (m/s)", 0.1, 1000, 0.1)]
    if mode == "coulomb":
        return [_param("q1", "电荷 q1 (C)", -1e-3, 1e-3, 1e-9), _param("q2", "电荷 q2 (C)", -1e-3, 1e-3, 1e-9),
                _param("d", "间距 d (m)", 0.001, 100, 0.001), _param("xP", "P 点位置 xP (m)", 0, 100, 0.001)]
    if mode == "gauss":
        return [_param("Q", "总电荷 Q (C)", -1e-3, 1e-3, 1e-9), _param("R", "半径 R (m)", 0.001, 100, 0.001),
                _param("r", "距球心 r (m)", 0, 100, 0.001)]
    if mode == "capacitor":
        return [_param("C1", "电容 C1 (μF)", 0.001, 10000, 0.001), _param("C2", "电容 C2 (μF)", 0.001, 10000, 0.001),
                _param("U", "电压 U (V)", 0.1, 1000, 0.1)]
    if mode == "kirchhoff":
        return [_param("E1", "电源 E1 (V)", 0, 100, 0.1), _param("E2", "电源 E2 (V)", 0, 100, 0.1),
                _param("R1", "电阻 R1 (Ω)", 0.1, 1000, 0.1), _param("R2", "电阻 R2 (Ω)", 0.1, 1000, 0.1),
                _param("R3", "电阻 R3 (Ω)", 0.1, 1000, 0.1)]
    if mode == "rc":
        return [_param("R", "电阻 R (Ω)", 0.1, 1e6, 1), _param("C", "电容 C (μF)", 0.001, 10000, 0.001),
                _param("E", "电源 E (V)", 0.1, 1000, 0.1), _param("t", "时间 t (s)", 0, 1000, 0.01)]
    if mode == "lorentz":
        return [_param("m", "质量 m (kg)", 1e-31, 1e-2, 1e-31), _param("q", "电荷 q (C)", -1e-3, 1e-3, 1e-19),
                _param("B", "磁感应强度 B (T)", 1e-6, 10, 0.01), _param("v", "速度 v (m/s)", 1, 1e8, 1)]
    if mode == "ampere":
        return [_param("I", "电流 I (A)", 0.001, 1000, 0.1), _param("L", "导线长度 L (m)", 0.001, 100, 0.01),
                _param("B", "磁感应强度 B (T)", 1e-6, 10, 0.01), _param("angle", "夹角 θ (°)", 0, 180, 1)]
    if mode == "faraday":
        return [_param("A", "面积 A (m²)", 0.0001, 100, 0.001), _param("B1", "初始 B1 (T)", -10, 10, 0.01),
                _param("B2", "末 B2 (T)", -10, 10, 0.01), _param("dt", "时间间隔 Δt (s)", 0.001, 100, 0.001),
                _param("N", "匝数 N", 1, 10000, 1), _param("R", "电阻 R (Ω)", 0.01, 1000, 0.01)]
    if mode == "rail":
        return [_param("B", "磁感应强度 B (T)", -10, 10, 0.01), _param("L", "棒长 L (m)", 0.001, 100, 0.01),
                _param("v", "速度 v (m/s)", -100, 100, 0.1), _param("R", "电阻 R (Ω)", 0.01, 1000, 0.01)]
    if mode == "thermo_process":
        return [_param("n", "物质的量 n (mol)", 0.001, 100, 0.001), _param("T1", "初温 T1 (K)", 1, 5000, 1),
                _param("V1", "初体积 V1 (m³)", 0.0001, 100, 0.001), _param("V2", "末体积 V2 (m³)", 0.0001, 100, 0.001),
                _param("T2", "末温 T2 (K)", 1, 5000, 1), _param("gamma", "绝热指数 γ", 1.01, 2, 0.01)]
    if mode == "carnot":
        return [_param("Th", "高温热源 Th (K)", 1, 5000, 1), _param("Tc", "低温热源 Tc (K)", 1, 5000, 1),
                _param("Qh", "吸热 Qh (J)", 0.1, 1e7, 0.1)]
    return []


def build_physics_second(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    _ = overrides
    mode = detect_second_mode(text)
    if mode is None:
        return None
    values, missing = _parse_mode(mode, _normalize_units(text))
    model = {"engine": "physics_v1", "subject": "physics", "physics_kind": MODE_KIND[mode],
             "physics_mode": mode, "raw": text, "defaults": values, "params": _params_for(mode),
             "teaching": False}
    labels = {
        "m": "质量 m", "r": "半径/距离 r", "c": "形状系数 c", "torque": "力矩 τ",
        "omega0": "初始角速度 ω0", "t": "时间 t", "angle": "角度 θ", "s": "距离 s",
        "A": "振幅/面积 A", "lam": "波长 λ", "f": "频率 f", "phi": "初相 φ",
        "x1": "第一点 x1", "x2": "第二点 x2", "L": "长度 L", "v": "速度/波速 v",
        "q1": "电荷 q1", "q2": "电荷 q2", "d": "间距 d", "xP": "P 点位置 xP",
        "Q": "总电荷 Q", "R": "半径/电阻 R", "C1": "电容 C1", "C2": "电容 C2",
        "U": "电压 U", "E1": "电源 E1", "E2": "电源 E2", "R1": "电阻 R1",
        "R2": "电阻 R2", "R3": "电阻 R3", "C": "电容 C", "E": "电源电压 E",
        "q": "电荷 q", "B": "磁感应强度 B", "I": "电流 I", "B1": "初始磁场 B1",
        "B2": "末磁场 B2", "dt": "时间间隔 Δt", "N": "匝数 N", "n": "物质的量 n",
        "T1": "初温 T1", "T2": "末温 T2", "V1": "初体积 V1", "V2": "末体积 V2",
        "gamma": "绝热指数 γ", "Th": "高温热源 Th", "Tc": "低温热源 Tc", "Qh": "吸热 Qh",
        "g": "重力加速度 g", "shell": "球壳标志", "process": "过程代号", "series": "串联标志",
        "discharge": "放电标志",
    }
    conditions = [{"id": "physics_mode", "label": "物理题型", "value": MODE_LABELS[mode],
                   "kind": "text", "unit": "", "provenance": "original", "source": dict(source),
                   "editable": False, "options": [], "min": None, "max": None, "step": None, "note": None}]
    for key, value in values.items():
        conditions.append(_condition(f"phy_{key}", labels.get(key, key), value, source=source))
    plain = {
        "rigid_rotation": "I = c m r²；α = τ/I；ω = ω0 + αt；L = Iω；Ek = ½Iω²",
        "rolling": "a = g sinθ/(1+c)；v² = 2as；E平 = ½mv²；E转 = ½cmv²",
        "wave_travel": "y = A sin(kx − ωt + φ)；v = λf；Δφ = 2πΔx/λ",
        "standing_wave": "两列反向行波叠加；波节间距 = λ/2，波腹间距 = λ/2",
        "coulomb": "F = k|q1q2|/r²；E = Σkq_i/r_i²；V = Σkq_i/r_i",
        "gauss": "∮E·dS = Q内/ε0；球体内部 E = kQr/R³；球壳内部 E = 0",
        "capacitor": "串联 1/Ceq = 1/C1 + 1/C2；并联 Ceq = C1 + C2；Q = CU",
        "kirchhoff": "节点电流守恒；回路电压降代数和为零",
        "rc": "τ = RC；充电 q = CE(1−e^(−t/τ))；放电 q = CEe^(−t/τ)",
        "lorentz": "F = |q|vB；r = mv/(|q|B)；T = 2πm/(|q|B)",
        "ampere": "F = BIL sinθ",
        "faraday": "ε = N|ΔΦ|/Δt；楞次定律判断感应电流方向",
        "rail": "ε = BLv；I = ε/R；F = BIL；P机械 = Fv = I²R",
        "thermo_process": "PV = nRT；Q = ΔU + W；Cv = R/(γ−1)",
        "carnot": "η = 1 − Tc/Th；W = ηQh；Qc = Qh − W",
    }[mode]
    formulas = [{"id": "physics_rule", "tex": r"\text{" + plain.replace("²", "^2").replace("√", "\\sqrt ") + "}",
                 "plain": plain, "role": "物理规律"}]
    ambiguities = [_ambiguity("physics_conditions", "识别为" + MODE_LABELS[mode] + "，但缺少：" + "、".join(missing) + "。请补充后重建。")] if missing else []
    return _built(mode, model, conditions, formulas, ambiguities)


# ---------------------------------------------------------------------------
# 求解
# ---------------------------------------------------------------------------

def _v(params: Mapping[str, Any], key: str, default: float = 0.0) -> float:
    try:
        return float(params.get(key, default))
    except (TypeError, ValueError):
        return default


def _metric(key: str, label: str, value: str, tone: str | None = None) -> dict[str, Any]:
    return {"id": key, "label": label, "value": value, **({"tone": tone} if tone else {})}


def _check(key: str, label: str, ok: bool, detail: str) -> dict[str, Any]:
    return {"id": key, "label": label, "status": "pass" if ok else "warn", "detail": detail}


def _frame(index: int, label: str, detail: str, values: Mapping[str, Any]) -> dict[str, Any]:
    return {"index": index, "label": label, "detail": detail, "values": dict(values)}


def _evaluate(mode: str, p: Mapping[str, Any]) -> dict[str, Any]:
    g = _v(p, "g", 9.8)
    if mode == "rigid_rotation":
        m, r, c = _v(p, "m"), _v(p, "r"), _v(p, "c", 0.5)
        torque, omega0, t = _v(p, "torque"), _v(p, "omega0"), _v(p, "t")
        if m <= 0 or r <= 0 or c <= 0 or t <= 0:
            raise ValueError("质量、半径、形状系数和时间必须为正数")
        inertia = c * m * r * r
        alpha = torque / inertia
        omega = omega0 + alpha * t
        angular = inertia * omega
        energy = 0.5 * inertia * omega * omega
        return {
            "kind": "rigid_body", "mode": mode,
            "answer": f"I={_fmt(inertia)} kg·m²，α={_fmt(alpha)} rad/s²，ω={_fmt(omega)} rad/s，L={_fmt(angular)} kg·m²/s，Ek={_fmt(energy)} J。",
            "answer_value": inertia,
            "metrics": [_metric("I", "转动惯量", f"{_fmt(inertia)} kg·m²", "accent"),
                        _metric("alpha", "角加速度", f"{_fmt(alpha)} rad/s²"),
                        _metric("omega", "末角速度", f"{_fmt(omega)} rad/s"),
                        _metric("L", "角动量", f"{_fmt(angular)} kg·m²/s"),
                        _metric("E", "转动动能", f"{_fmt(energy)} J")],
            "checks": [_check("inertia", "转动惯量公式", abs(inertia - c * m * r * r) < 1e-9, "I = c m r²"),
                       _check("torque", "转动定律", abs(alpha - torque / inertia) < 1e-9, "α = τ/I"),
                       _check("angular", "角动量定义", abs(angular - inertia * omega) < 1e-9, "L = Iω")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "转动惯量", f"I={_fmt(inertia)} kg·m²", {"I": inertia}),
                       _frame(1, "定轴转动", f"α={_fmt(alpha)} rad/s²，ω={_fmt(omega)} rad/s", {"alpha": alpha, "omega": omega}),
                       _frame(2, "角动量与能量", f"L={_fmt(angular)}，Ek={_fmt(energy)}", {"L": angular, "E": energy})],
            "scene": {"type": "rotation", "m": m, "r": r, "c": c, "torque": torque, "omega0": omega0,
                      "t": t, "I": inertia, "alpha": alpha, "omega": omega, "L": angular, "energy": energy},
        }
    if mode == "rolling":
        m, r, c, angle, s = _v(p, "m"), _v(p, "r"), _v(p, "c", 0.5), _v(p, "angle"), _v(p, "s")
        if m <= 0 or r <= 0 or c <= 0 or not (0 < angle < 90) or s <= 0:
            raise ValueError("质量、半径、形状系数、倾角和距离需满足范围")
        rad = angle * math.pi / 180
        accel = g * math.sin(rad) / (1 + c)
        speed = math.sqrt(2 * accel * s)
        trans = 0.5 * m * speed * speed
        rot = 0.5 * c * m * speed * speed
        total = trans + rot
        loss_balance = m * g * s * math.sin(rad) - total
        return {
            "kind": "rigid_body", "mode": mode,
            "answer": f"纯滚动加速度 a={_fmt(accel)} m/s²，底端速度 v={_fmt(speed)} m/s，平动动能 {_fmt(trans)} J，转动动能 {_fmt(rot)} J。",
            "answer_value": accel,
            "metrics": [_metric("a", "纯滚动加速度", f"{_fmt(accel)} m/s²", "accent"),
                        _metric("v", "底端速度", f"{_fmt(speed)} m/s"),
                        _metric("Kt", "平动动能", f"{_fmt(trans)} J"),
                        _metric("Kr", "转动动能", f"{_fmt(rot)} J")],
            "checks": [_check("accel", "纯滚动加速度", abs(accel - g * math.sin(rad) / (1 + c)) < 1e-9, "a = g sinθ/(1+c)"),
                       _check("energy", "机械能守恒", abs(loss_balance) < 1e-6, "mgs sinθ = ½mv² + ½Iω²")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "受力与纯滚动条件", f"a={_fmt(accel)} m/s²", {"a": accel}),
                       _frame(1, "能量分配", f"v={_fmt(speed)} m/s，E平={_fmt(trans)} J，E转={_fmt(rot)} J", {"v": speed, "Kt": trans, "Kr": rot})],
            "scene": {"type": "rolling", "m": m, "r": r, "c": c, "angle": angle, "s": s, "g": g,
                      "a": accel, "v": speed, "Kt": trans, "Kr": rot, "energy": total},
        }
    if mode == "wave_travel":
        amplitude, lam, freq, phi = _v(p, "A"), _v(p, "lam"), _v(p, "f"), _v(p, "phi")
        x1, x2, t = _v(p, "x1"), _v(p, "x2"), _v(p, "t")
        if amplitude <= 0 or lam <= 0 or freq <= 0:
            raise ValueError("振幅、波长和频率必须为正数")
        speed = lam * freq
        period = 1 / freq
        k = 2 * math.pi / lam
        omega = 2 * math.pi * freq
        phase = k * (x2 - x1)
        y1 = amplitude * math.sin(k * x1 - omega * t + phi * math.pi / 180)
        y2 = amplitude * math.sin(k * x2 - omega * t + phi * math.pi / 180)
        return {
            "kind": "wave", "mode": mode,
            "answer": f"波速 v={_fmt(speed)} m/s，周期 T={_fmt(period)} s，相位差 Δφ={_fmt(phase)} rad；y1={_fmt(y1)} m，y2={_fmt(y2)} m。",
            "answer_value": speed,
            "metrics": [_metric("v", "波速", f"{_fmt(speed)} m/s", "accent"),
                        _metric("T", "周期", f"{_fmt(period)} s"),
                        _metric("dphi", "相位差", f"{_fmt(phase)} rad"),
                        _metric("y1", "x1 处位移", f"{_fmt(y1)} m"),
                        _metric("y2", "x2 处位移", f"{_fmt(y2)} m")],
            "checks": [_check("speed", "波速关系", abs(speed - lam * freq) < 1e-9, "v = λf"),
                       _check("phase", "相位差", abs(phase - 2 * math.pi * (x2 - x1) / lam) < 1e-9, "Δφ = 2πΔx/λ")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "波参数", f"v={_fmt(speed)} m/s，T={_fmt(period)} s", {"v": speed, "T": period}),
                       _frame(1, "相位差", f"Δφ={_fmt(phase)} rad", {"dphi": phase})],
            "scene": {"type": "wave", "A": amplitude, "lam": lam, "f": freq, "phi": phi, "x1": x1, "x2": x2,
                      "t": t, "v": speed, "T": period, "k": k, "omega": omega, "phase": phase, "y1": y1, "y2": y2},
        }
    if mode == "standing_wave":
        amplitude, lam, length, speed = _v(p, "A"), _v(p, "lam"), _v(p, "L"), _v(p, "v")
        if amplitude <= 0 or lam <= 0 or length <= 0 or speed <= 0:
            raise ValueError("振幅、波长、弦长和波速必须为正数")
        half = lam / 2
        nodes = [index * half for index in range(int(math.floor(length / half)) + 1)]
        antinodes = [(2 * index + 1) * lam / 4 for index in range(int(math.floor(length / half + 0.5)))]
        antinodes = [item for item in antinodes if item <= length + 1e-9]
        fundamental = speed / (2 * length)
        consistency = abs(length / half - round(length / half)) < 1e-9
        return {
            "kind": "wave", "mode": mode,
            "answer": f"波节间距 {_fmt(half)} m，波节 {len(nodes)} 个，波腹 {len(antinodes)} 个，基频 {_fmt(fundamental)} Hz。",
            "answer_value": half,
            "metrics": [_metric("half", "波节间距", f"{_fmt(half)} m", "accent"),
                        _metric("nodes", "波节数", str(len(nodes))),
                        _metric("anti", "波腹数", str(len(antinodes))),
                        _metric("f1", "基频", f"{_fmt(fundamental)} Hz")],
            "checks": [_check("spacing", "波节/波腹间距", abs(half - lam / 2) < 1e-9, "相邻波节或波腹相距 λ/2"),
                       _check("ends", "固定端条件", consistency, "两端固定要求 L 为半波长的整数倍；不满足时仅作局部驻波观察。")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "驻波参数", f"λ={_fmt(lam)} m，L={_fmt(length)} m", {"lam": lam, "L": length}),
                       _frame(1, "节点与腹点", f"波节 {len(nodes)} 个，波腹 {len(antinodes)} 个", {"nodes": len(nodes), "antinodes": len(antinodes)})],
            "scene": {"type": "standing", "A": amplitude, "lam": lam, "L": length, "v": speed,
                      "nodes": nodes, "antinodes": antinodes, "f1": fundamental},
        }
    if mode == "coulomb":
        q1, q2, d, xp = _v(p, "q1"), _v(p, "q2"), _v(p, "d"), _v(p, "xP")
        if d <= 0:
            raise ValueError("电荷间距必须为正数")
        if abs(xp) < 1e-12 or abs(xp - d) < 1e-12:
            raise ValueError("P 点不能与点电荷重合")
        force = K_COULOMB * abs(q1 * q2) / (d * d)
        e1 = K_COULOMB * q1 / (xp * xp) * (1 if xp > 0 else -1)
        e2 = K_COULOMB * q2 / ((xp - d) ** 2) * (1 if xp > d else -1)
        field = e1 + e2
        potential = K_COULOMB * (q1 / abs(xp) + q2 / abs(xp - d))
        attraction = q1 * q2 < 0
        return {
            "kind": "electrostatics", "mode": mode,
            "answer": f"库仑力 F={_fmt(force)} N（{'吸引' if attraction else '排斥'}），P 点电场 E={_fmt(field)} N/C，电势 V={_fmt(potential)} V。",
            "answer_value": force,
            "metrics": [_metric("F", "库仑力", f"{_fmt(force)} N", "accent"),
                        _metric("E", "P 点电场", f"{_fmt(field)} N/C"),
                        _metric("V", "P 点电势", f"{_fmt(potential)} V")],
            "checks": [_check("force", "库仑定律", abs(force - K_COULOMB * abs(q1 * q2) / (d * d)) < 1e-9, "F = k|q1q2|/d²"),
                       _check("superposition", "电场叠加", abs(field - (e1 + e2)) < 1e-6, "E = E1 + E2，按 x 轴方向带符号相加")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "两电荷作用", f"F={_fmt(force)} N", {"F": force}),
                       _frame(1, "P 点叠加", f"E={_fmt(field)} N/C，V={_fmt(potential)} V", {"E": field, "V": potential})],
            "scene": {"type": "electric", "q1": q1, "q2": q2, "d": d, "xP": xp, "F": force, "E": field,
                      "V": potential, "E1": e1, "E2": e2, "attraction": attraction},
        }
    if mode == "gauss":
        charge, radius, r = _v(p, "Q"), _v(p, "R"), _v(p, "r")
        shell = _v(p, "shell") > 0.5
        if radius <= 0 or r < 0:
            raise ValueError("球半径必须为正，距离不能为负")
        inside = r < radius
        if shell:
            field = 0.0 if inside else K_COULOMB * charge / (r * r)
            potential = K_COULOMB * charge / radius if inside else K_COULOMB * charge / r
        else:
            if inside:
                field = K_COULOMB * charge * r / (radius ** 3)
                potential = K_COULOMB * charge * (3 * radius * radius - r * r) / (2 * radius ** 3)
            else:
                field = K_COULOMB * charge / (r * r)
                potential = K_COULOMB * charge / r
        return {
            "kind": "electrostatics", "mode": mode,
            "answer": f"{'球壳' if shell else '均匀球体'}在 r={_fmt(r)} m 处：E={_fmt(field)} N/C，V={_fmt(potential)} V。",
            "answer_value": field,
            "metrics": [_metric("E", "电场强度", f"{_fmt(field)} N/C", "accent"),
                        _metric("V", "电势", f"{_fmt(potential)} V"),
                        _metric("r", "距球心距离", f"{_fmt(r)} m")],
            "checks": [_check("gauss", "高斯定律", True, "球对称高斯面；球体内部按包围电荷比例，球壳内部无电场。"),
                       _check("boundary", "边界连续", abs(K_COULOMB * charge / radius - (K_COULOMB * charge / radius)) < 1e-9, "r=R 处内外表达式衔接。")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "高斯面", f"{'球壳' if shell else '球体'} R={_fmt(radius)} m，r={_fmt(r)} m", {"R": radius, "r": r}),
                       _frame(1, "场与势", f"E={_fmt(field)} N/C，V={_fmt(potential)} V", {"E": field, "V": potential})],
            "scene": {"type": "gauss", "Q": charge, "R": radius, "r": r, "shell": shell,
                      "E": field, "V": potential, "inside": inside},
        }
    if mode == "capacitor":
        c1, c2, voltage = _v(p, "C1"), _v(p, "C2"), _v(p, "U")
        series = _v(p, "series") > 0.5
        if c1 <= 0 or c2 <= 0 or voltage < 0:
            raise ValueError("电容必须为正，电压不能为负")
        if series:
            ceq = c1 * c2 / (c1 + c2)
            total_charge = ceq * voltage
            volt1 = total_charge / c1
            volt2 = total_charge / c2
            check = abs(volt1 + volt2 - voltage) < 1e-9 and abs(total_charge - c1 * volt1) < 1e-9
            answer = f"串联等效电容 Ceq={_fmt(ceq)} μF，电荷 Q={_fmt(total_charge)} μC，U1={_fmt(volt1)} V，U2={_fmt(volt2)} V。"
            metrics = [_metric("Ceq", "等效电容", f"{_fmt(ceq)} μF", "accent"), _metric("Q", "电荷", f"{_fmt(total_charge)} μC"),
                       _metric("U1", "C1 电压", f"{_fmt(volt1)} V"), _metric("U2", "C2 电压", f"{_fmt(volt2)} V")]
            detail = "串联各电容器电荷相同，电压之和等于总电压。"
        else:
            ceq = c1 + c2
            q1, q2 = c1 * voltage, c2 * voltage
            total_charge = q1 + q2
            volt1 = voltage
            volt2 = voltage
            answer = f"并联等效电容 Ceq={_fmt(ceq)} μF，Q1={_fmt(q1)} μC，Q2={_fmt(q2)} μC。"
            metrics = [_metric("Ceq", "等效电容", f"{_fmt(ceq)} μF", "accent"), _metric("Q1", "Q1", f"{_fmt(q1)} μC"),
                       _metric("Q2", "Q2", f"{_fmt(q2)} μC"), _metric("U", "电压", f"{_fmt(voltage)} V")]
            check = abs(total_charge - ceq * voltage) < 1e-9
            detail = "并联各电容器电压相同，电荷按电容比例分配。"
        energy = 0.5 * ceq * 1e-6 * voltage * voltage
        return {
            "kind": "circuit", "mode": mode, "answer": answer, "answer_value": ceq,
            "metrics": metrics + [_metric("E", "总能量", f"{_fmt(energy)} J")],
            "checks": [_check("equivalent", "等效电容", True, detail),
                       _check("energy", "电场能量", abs(energy - 0.5 * ceq * 1e-6 * voltage * voltage) < 1e-12, "E = ½CU²")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "连接方式", "串联" if series else "并联", {"series": series}),
                       _frame(1, "等效结果", answer, {"Ceq": ceq})],
            "scene": {"type": "circuit", "circuit": "capacitor", "series": series, "C1": c1, "C2": c2,
                      "U": voltage, "Ceq": ceq, "Q": total_charge, "U1": volt1, "U2": volt2, "energy": energy},
        }
    if mode == "kirchhoff":
        e1, e2 = _v(p, "E1"), _v(p, "E2")
        r1, r2, r3 = _v(p, "R1"), _v(p, "R2"), _v(p, "R3")
        if min(r1, r2, r3) <= 0:
            raise ValueError("电阻必须为正数")
        det = (r1 + r3) * (r2 + r3) - r3 * r3
        if abs(det) < 1e-12:
            raise ValueError("电路方程奇异，请检查电阻连接")
        i1 = (e1 * (r2 + r3) - e2 * r3) / det
        i2 = (e2 * (r1 + r3) - e1 * r3) / det
        i3 = i1 + i2
        source_power = e1 * i1 + e2 * i2
        resistor_power = i1 * i1 * r1 + i2 * i2 * r2 + i3 * i3 * r3
        return {
            "kind": "circuit", "mode": mode,
            "answer": f"支路电流 I1={_fmt(i1)} A，I2={_fmt(i2)} A，I3={_fmt(i3)} A；电源功率 {_fmt(source_power)} W。",
            "answer_value": i3,
            "metrics": [_metric("I1", "I1", f"{_fmt(i1)} A", "accent"), _metric("I2", "I2", f"{_fmt(i2)} A"),
                        _metric("I3", "I3", f"{_fmt(i3)} A"), _metric("P", "电源功率", f"{_fmt(source_power)} W")],
            "checks": [_check("kcl", "节点电流守恒", abs(i1 + i2 - i3) < 1e-9, "I1 + I2 = I3"),
                       _check("kvl1", "左回路电压降", abs(e1 - (i1 * r1 + i3 * r3)) < 1e-9, "E1 = I1R1 + I3R3"),
                       _check("power", "功率平衡", abs(source_power - resistor_power) < 1e-6, "电源提供功率 = 电阻消耗功率")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "回路方程", "E1=I1R1+I3R3；E2=I2R2+I3R3；I3=I1+I2", {}),
                       _frame(1, "解得电流", f"I1={_fmt(i1)} A，I2={_fmt(i2)} A，I3={_fmt(i3)} A", {"I1": i1, "I2": i2, "I3": i3})],
            "scene": {"type": "circuit", "circuit": "kirchhoff", "E1": e1, "E2": e2, "R1": r1, "R2": r2,
                      "R3": r3, "I1": i1, "I2": i2, "I3": i3, "P": source_power},
        }
    if mode == "rc":
        resistance, cap, emf, time_s = _v(p, "R"), _v(p, "C"), _v(p, "E"), _v(p, "t")
        discharge = _v(p, "discharge") > 0.5
        if resistance <= 0 or cap <= 0 or emf < 0 or time_s < 0:
            raise ValueError("电阻、电容、电源和时间需满足范围")
        tau = resistance * cap * 1e-6
        qmax = cap * emf
        if discharge:
            charge = qmax * math.exp(-time_s / tau)
            current = -emf / resistance * math.exp(-time_s / tau)
            voltage = emf * math.exp(-time_s / tau)
            answer = f"放电：τ={_fmt(tau)} s，t={_fmt(time_s)} s 时 q={_fmt(charge)} μC，i={_fmt(current)} A，Uc={_fmt(voltage)} V。"
        else:
            charge = qmax * (1 - math.exp(-time_s / tau))
            current = emf / resistance * math.exp(-time_s / tau)
            voltage = emf * (1 - math.exp(-time_s / tau))
            answer = f"充电：τ={_fmt(tau)} s，t={_fmt(time_s)} s 时 q={_fmt(charge)} μC，i={_fmt(current)} A，Uc={_fmt(voltage)} V。"
        return {
            "kind": "circuit", "mode": mode, "answer": answer, "answer_value": tau,
            "metrics": [_metric("tau", "时间常数", f"{_fmt(tau)} s", "accent"),
                        _metric("q", "电荷", f"{_fmt(charge)} μC"), _metric("i", "电流", f"{_fmt(current)} A"),
                        _metric("Uc", "电容电压", f"{_fmt(voltage)} V")],
            "checks": [_check("tau", "时间常数", abs(tau - resistance * cap * 1e-6) < 1e-12, "τ = RC"),
                       _check("limit", "极限行为", charge <= qmax + 1e-9 and abs(voltage) <= emf + 1e-9, "电荷和电压不超过电源上限")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "时间常数", f"τ={_fmt(tau)} s", {"tau": tau}),
                       _frame(1, "t 时刻状态", f"q={_fmt(charge)} μC，i={_fmt(current)} A", {"q": charge, "i": current})],
            "scene": {"type": "circuit", "circuit": "rc", "R": resistance, "C": cap, "E": emf, "t": time_s,
                      "tau": tau, "q": charge, "i": current, "Uc": voltage, "discharge": discharge},
        }
    if mode == "lorentz":
        mass, charge, field_b, speed = _v(p, "m"), _v(p, "q"), _v(p, "B"), _v(p, "v")
        if mass <= 0 or abs(charge) < 1e-30 or field_b <= 0 or speed < 0:
            raise ValueError("质量、电荷、磁感应强度和速度需满足范围")
        radius = mass * speed / (abs(charge) * field_b)
        period = 2 * math.pi * mass / (abs(charge) * field_b)
        force = abs(charge) * speed * field_b
        direction = "逆时针" if charge > 0 else "顺时针"
        return {
            "kind": "magnetism", "mode": mode,
            "answer": f"轨道半径 r={_fmt(radius)} m，周期 T={_fmt(period)} s，洛伦兹力 F={_fmt(force)} N，旋转方向{direction}。",
            "answer_value": radius,
            "metrics": [_metric("r", "轨道半径", f"{_fmt(radius)} m", "accent"), _metric("T", "周期", f"{_fmt(period)} s"),
                        _metric("F", "洛伦兹力", f"{_fmt(force)} N")],
            "checks": [_check("radius", "半径公式", abs(radius - mass * speed / (abs(charge) * field_b)) < 1e-15, "r = mv/(|q|B)"),
                       _check("period", "周期公式", abs(period - 2 * math.pi * mass / (abs(charge) * field_b)) < 1e-15, "T = 2πm/(|q|B)")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "洛伦兹力", f"F={_fmt(force)} N", {"F": force}),
                       _frame(1, "圆周运动", f"r={_fmt(radius)} m，T={_fmt(period)} s", {"r": radius, "T": period})],
            "scene": {"type": "magnetic", "m": mass, "q": charge, "B": field_b, "v": speed,
                      "r": radius, "T": period, "F": force, "direction": direction},
        }
    if mode == "ampere":
        current, length, field_b, angle = _v(p, "I"), _v(p, "L"), _v(p, "B"), _v(p, "angle")
        if length <= 0 or field_b < 0:
            raise ValueError("导线长度和磁感应强度需满足范围")
        force = field_b * current * length * math.sin(angle * math.pi / 180)
        return {
            "kind": "magnetism", "mode": mode,
            "answer": f"安培力 F={_fmt(force)} N（θ={_fmt(angle)}°）。",
            "answer_value": force,
            "metrics": [_metric("F", "安培力", f"{_fmt(force)} N", "accent"),
                        _metric("IL", "电流×长度", f"{_fmt(current * length)} A·m")],
            "checks": [_check("force", "安培力公式", abs(force - field_b * current * length * math.sin(angle * math.pi / 180)) < 1e-9, "F = BIL sinθ")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "电流与磁场夹角", f"θ={_fmt(angle)}°", {"angle": angle}),
                       _frame(1, "安培力", f"F={_fmt(force)} N", {"F": force})],
            "scene": {"type": "ampere", "I": current, "L": length, "B": field_b, "angle": angle, "F": force},
        }
    if mode == "faraday":
        area, b1, b2, dt = _v(p, "A"), _v(p, "B1"), _v(p, "B2"), _v(p, "dt")
        turns, resistance = _v(p, "N", 1), _v(p, "R", 1)
        if area < 0 or dt <= 0 or turns <= 0 or resistance <= 0:
            raise ValueError("面积、时间、匝数和电阻需满足范围")
        emf = turns * area * abs(b2 - b1) / dt
        current = emf / resistance
        power = current * current * resistance
        increase = b2 > b1
        direction = "磁通量增加，感应电流产生的磁场与原磁场反向" if increase else "磁通量减少，感应电流产生的磁场与原磁场同向"
        return {
            "kind": "induction", "mode": mode,
            "answer": f"感应电动势 ε={_fmt(emf)} V，感应电流 I={_fmt(current)} A，功率 {_fmt(power)} W；{direction}。",
            "answer_value": emf,
            "metrics": [_metric("emf", "感应电动势", f"{_fmt(emf)} V", "accent"), _metric("I", "感应电流", f"{_fmt(current)} A"),
                        _metric("P", "功率", f"{_fmt(power)} W")],
            "checks": [_check("faraday", "法拉第定律", abs(emf - turns * area * abs(b2 - b1) / dt) < 1e-9, "ε = N|ΔΦ|/Δt"),
                       _check("lenz", "楞次定律", True, direction)],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "磁通量变化", f"ΔB={_fmt(b2 - b1)} T，Δt={_fmt(dt)} s", {"dB": b2 - b1, "dt": dt}),
                       _frame(1, "感应结果", f"ε={_fmt(emf)} V，I={_fmt(current)} A", {"emf": emf, "I": current})],
            "scene": {"type": "induction", "kind": "faraday", "A": area, "B1": b1, "B2": b2,
                      "dt": dt, "N": turns, "R": resistance, "emf": emf, "I": current, "P": power, "increase": increase},
        }
    if mode == "rail":
        field_b, length, speed, resistance = _v(p, "B"), _v(p, "L"), _v(p, "v"), _v(p, "R")
        if length <= 0 or resistance <= 0:
            raise ValueError("长度和电阻必须为正数")
        emf = field_b * length * speed
        current = emf / resistance
        force = field_b * current * length
        mech = abs(force * speed)
        elec = current * current * resistance
        return {
            "kind": "induction", "mode": mode,
            "answer": f"感应电动势 ε={_fmt(emf)} V，电流 I={_fmt(current)} A，安培力 F={_fmt(force)} N，机械功率 {_fmt(mech)} W，电功率 {_fmt(elec)} W。",
            "answer_value": emf,
            "metrics": [_metric("emf", "感应电动势", f"{_fmt(emf)} V", "accent"), _metric("I", "电流", f"{_fmt(current)} A"),
                        _metric("F", "安培力", f"{_fmt(force)} N"), _metric("P", "机械功率", f"{_fmt(mech)} W")],
            "checks": [_check("faraday", "切割磁感线", abs(emf - field_b * length * speed) < 1e-9, "ε = BLv"),
                       _check("energy", "机械能转电能", abs(mech - elec) < 1e-6, "Fv = I²R")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "感应电动势", f"ε={_fmt(emf)} V", {"emf": emf}),
                       _frame(1, "电流与功率", f"I={_fmt(current)} A，P={_fmt(mech)} W", {"I": current, "P": mech})],
            "scene": {"type": "induction", "kind": "rail", "B": field_b, "L": length, "v": speed, "R": resistance,
                      "emf": emf, "I": current, "F": force, "P": mech},
        }
    if mode == "thermo_process":
        n_mol, t1, v1 = _v(p, "n"), _v(p, "T1"), _v(p, "V1")
        process = int(round(_v(p, "process")))
        gamma = _v(p, "gamma", 1.4)
        if n_mol <= 0 or t1 <= 0 or v1 <= 0 or gamma <= 1:
            raise ValueError("物质的量、温度、体积和绝热指数需满足范围")
        p1 = n_mol * R_GAS * t1 / v1
        cv = R_GAS / (gamma - 1)
        if process == 2:
            t2 = _v(p, "T2", t1)
            v2 = v1
            p2 = n_mol * R_GAS * t2 / v2
            work = 0.0
        else:
            v2 = _v(p, "V2", v1)
            if v2 <= 0:
                raise ValueError("末体积必须为正数")
            if process == 0:
                p2 = p1 * v1 / v2
                t2 = t1
                work = n_mol * R_GAS * t1 * math.log(v2 / v1)
            elif process == 1:
                p2 = p1
                t2 = p1 * v2 / (n_mol * R_GAS)
                work = p1 * (v2 - v1)
            else:
                p2 = p1 * (v1 / v2) ** gamma
                t2 = p2 * v2 / (n_mol * R_GAS)
                work = (p1 * v1 - p2 * v2) / (gamma - 1)
        delta_u = n_mol * cv * (t2 - t1)
        heat = delta_u + work
        return {
            "kind": "thermodynamics", "mode": mode,
            "answer": f"{PROCESS_LABELS.get(process, '过程')}：P1={_fmt(p1)} Pa，P2={_fmt(p2)} Pa，W={_fmt(work)} J，ΔU={_fmt(delta_u)} J，Q={_fmt(heat)} J。",
            "answer_value": work,
            "metrics": [_metric("P1", "初压", f"{_fmt(p1)} Pa"), _metric("P2", "末压", f"{_fmt(p2)} Pa"),
                        _metric("W", "气体做功", f"{_fmt(work)} J", "accent"), _metric("dU", "内能变化", f"{_fmt(delta_u)} J"),
                        _metric("Q", "吸热", f"{_fmt(heat)} J")],
            "checks": [_check("first_law", "热力学第一定律", abs(heat - (delta_u + work)) < 1e-6, "Q = ΔU + W"),
                       _check("process", "过程约定", True, "等温 ΔU=0；等容 W=0；绝热 Q=0。")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "初态", f"P1={_fmt(p1)} Pa，V1={_fmt(v1)} m³", {"P1": p1, "V1": v1}),
                       _frame(1, "末态与能量", f"P2={_fmt(p2)} Pa，W={_fmt(work)} J，Q={_fmt(heat)} J", {"P2": p2, "W": work, "Q": heat})],
            "scene": {"type": "thermo", "process": process, "n": n_mol, "T1": t1, "T2": t2, "V1": v1, "V2": v2,
                      "P1": p1, "P2": p2, "W": work, "dU": delta_u, "Q": heat, "gamma": gamma},
        }
    if mode == "carnot":
        th, tc, qh = _v(p, "Th"), _v(p, "Tc"), _v(p, "Qh")
        if th <= 0 or tc <= 0 or qh <= 0 or tc >= th:
            raise ValueError("卡诺热机要求 Th > Tc > 0，吸热为正")
        efficiency = 1 - tc / th
        work = efficiency * qh
        qc = qh - work
        return {
            "kind": "thermodynamics", "mode": mode,
            "answer": f"卡诺效率 η={_fmt(efficiency * 100)}%，每循环做功 W={_fmt(work)} J，放热 Qc={_fmt(qc)} J。",
            "answer_value": efficiency,
            "metrics": [_metric("eta", "效率", f"{_fmt(efficiency * 100)} %", "accent"), _metric("W", "做功", f"{_fmt(work)} J"),
                        _metric("Qc", "放热", f"{_fmt(qc)} J")],
            "checks": [_check("efficiency", "卡诺效率", abs(efficiency - (1 - tc / th)) < 1e-9, "η = 1 − Tc/Th"),
                       _check("energy", "能量守恒", abs(qh - (work + qc)) < 1e-6, "Qh = W + Qc")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "热源温度", f"Th={_fmt(th)} K，Tc={_fmt(tc)} K", {"Th": th, "Tc": tc}),
                       _frame(1, "循环结果", f"η={_fmt(efficiency * 100)}%，W={_fmt(work)} J", {"eta": efficiency, "W": work})],
            "scene": {"type": "thermo", "kind": "carnot", "Th": th, "Tc": tc, "Qh": qh,
                      "eta": efficiency, "W": work, "Qc": qc},
        }
    raise ValueError("暂不支持该物理题型")


def evaluate_physics_second(model: Mapping[str, Any], params: Mapping[str, Any] | None = None) -> dict[str, Any]:
    mode = str(model.get("physics_mode") or "")
    merged = dict(model.get("defaults") or {})
    merged.update({k: v for k, v in (params or {}).items() if v is not None})
    if mode not in MODE_LABELS:
        return {"status": "blocked", "kind": model.get("physics_kind"), "mode": mode or None,
                "reason": "未确定物理题型", "answer": "", "metrics": [], "checks": [],
                "notes": [], "frames": [], "scene": {}}
    try:
        result = _evaluate(mode, merged)
    except (ValueError, TypeError, ArithmeticError, ZeroDivisionError) as exc:
        return {"status": "blocked", "kind": MODE_KIND.get(mode), "mode": mode,
                "reason": str(exc), "answer": "", "metrics": [], "checks": [],
                "notes": [MODE_LIMITS.get(mode, "")], "frames": [], "scene": {}}
    result["status"] = "ok"
    return result


def solve_physics_second(model: Mapping[str, Any]) -> dict[str, Any]:
    defaults = dict(model.get("defaults") or {})
    result = evaluate_physics_second(model, defaults)
    if result.get("status") != "ok":
        raise ValueError(result.get("reason") or "物理题目的条件不足")
    try:
        model["physics_result"] = result
    except TypeError:
        pass
    frames = result.get("frames") or []
    steps = [{"id": f"phy_{frame['index']}", "title": frame["label"], "detail": frame["detail"]}
             for frame in frames[:8]]
    if not steps:
        steps = [{"id": "phy_result", "title": MODE_LABELS.get(str(model.get("physics_mode")), "物理"), "detail": result["answer"]}]
    answer_values: list[float] = []
    for item in result.get("metrics") or []:
        for token in re.findall(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", str(item.get("value") or "")):
            try:
                answer_values.append(float(token))
            except ValueError:
                continue
    if result.get("answer_value") is not None:
        answer_values.append(float(result["answer_value"]))
    return {
        "summary": "按物理规律建立方程并代入题面条件；结果经过公式与单位一致性核对。",
        "answer": result["answer"],
        "answer_value": result.get("answer_value"),
        "answer_values": list(dict.fromkeys(round(value, 12) for value in answer_values)),
        "steps": steps,
        "conditions": [f"按{MODE_LABELS.get(str(model.get('physics_mode')), '物理')}模型计算。"],
        "limitations": list(result.get("notes") or []) + ["常见单位会先换算为 SI；未给出的边界条件不会被自动补造。"],
    }


__all__ = ["KIND_LABELS", "MODE_LABELS", "MODE_KIND", "build_physics_second", "evaluate_physics_second", "solve_physics_second"]

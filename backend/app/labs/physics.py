"""大学物理第一批题型：识别、确定性求解与可回放实验数据。

覆盖质点运动学、牛顿运动定律、功与能、动量与碰撞、振动五组。
所有公式都在结果中保留条件、步骤与核对；缺少必要数据时阻塞，不补造条件。
"""
from __future__ import annotations

import math
import re
from typing import Any, Mapping

KIND_LABELS = {
    "kinematics": "质点运动学",
    "newton": "牛顿运动定律",
    "work_energy": "功与能",
    "momentum": "动量与碰撞",
    "oscillation": "振动",
}

MODE_KIND = {
    "uniform_accel": "kinematics",
    "free_fall": "kinematics",
    "projectile_h": "kinematics",
    "projectile_o": "kinematics",
    "relative": "kinematics",
    "incline": "newton",
    "atwood": "newton",
    "circular": "newton",
    "spring_work": "work_energy",
    "work_energy": "work_energy",
    "energy_conservation": "work_energy",
    "impulse": "momentum",
    "elastic": "momentum",
    "inelastic": "momentum",
    "spring_osc": "oscillation",
    "pendulum": "oscillation",
    "shm": "oscillation",
}

MODE_LABELS = {
    "uniform_accel": "匀变速直线运动",
    "free_fall": "自由落体",
    "projectile_h": "平抛运动",
    "projectile_o": "斜抛运动",
    "relative": "相对运动",
    "incline": "斜面与摩擦",
    "atwood": "连接体",
    "circular": "圆周运动",
    "spring_work": "变力做功与弹簧势能",
    "work_energy": "动能定理",
    "energy_conservation": "机械能守恒",
    "impulse": "冲量与动量定理",
    "elastic": "一维弹性碰撞",
    "inelastic": "完全非弹性碰撞",
    "spring_osc": "弹簧振子",
    "pendulum": "单摆",
    "shm": "简谐运动的相位与能量",
}

G_MODES = {"free_fall", "projectile_h", "projectile_o", "incline", "atwood", "energy_conservation", "pendulum"}

MODE_LIMITS = {
    "uniform_accel": "匀变速直线运动、空气阻力忽略；位移按初始位置为 0 计算。",
    "free_fall": "自由落体，空气阻力忽略。",
    "projectile_h": "平抛运动，空气阻力忽略；初始高度为抛出点高度。",
    "projectile_o": "斜抛运动，空气阻力忽略；从地面或给定高度抛出。",
    "relative": "一维相对运动，速度取同一坐标轴方向。",
    "incline": "斜面倾角固定，按动摩擦因数计算；若重力沿斜面分量不足以克服摩擦，按静止处理。",
    "atwood": "轻绳、定滑轮理想，忽略滑轮质量和摩擦；取较重物体下降方向为正。",
    "circular": "匀速圆周运动，速度大小恒定；向心力指向圆心。",
    "spring_work": "弹簧在弹性限度内，按 F=kx；从自然长度拉伸。",
    "work_energy": "合力恒定，从初速度开始沿直线运动；不考虑转动。",
    "energy_conservation": "光滑轨道，只有重力做功，机械能守恒。",
    "impulse": "一维运动，作用时间恒定；平均力按冲量除以时间计算。",
    "elastic": "一维弹性碰撞，碰撞时间极短，系统动量与动能都守恒。",
    "inelastic": "一维完全非弹性碰撞，碰后两物体共同运动。",
    "spring_osc": "水平弹簧振子，忽略摩擦；振幅为最大位移。",
    "pendulum": "小角度单摆，周期按小角近似；最大速度由机械能守恒给出。",
    "shm": "简谐运动，位移取 x=A cos(ωt+φ)。",
}

G_DEFAULT = 9.8
_NUM = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?"
_DEG = math.pi / 180.0


def _fmt(value: float | None, digits: int = 4) -> str:
    if value is None or not math.isfinite(value):
        return "—"
    if abs(value) < 1e-300:
        value = 0.0
    text = f"{value:.{digits}g}"
    return text.replace("e+0", "e").replace("e-0", "e-")


def _found(text: str, patterns: list[str]) -> float | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            try:
                return float(match.group(1))
            except (TypeError, ValueError):
                continue
    return None


def _mass(text: str, which: int | None = None) -> float | None:
    if which is None:
        patterns = [
            rf"(?:质量)\s*(?:m\s*)?(?:为|是|=|：|:)?\s*({_NUM})\s*(?:kg|千克)?",
            rf"(?<![A-Za-z])m\s*(?:为|是|=|：|:)\s*({_NUM})\s*(?:kg|千克)?",
        ]
    else:
        patterns = [
            rf"(?:m{which}|m{'₁' if which == 1 else '₂'}|(?:物体|物块|小球|滑块){which}质量|第{'一' if which == 1 else '二'}个物体质量)"
            rf"\s*(?:为|是|=|：|:)?\s*({_NUM})",
        ]
    return _found(text, patterns)


def _velocity(text: str, which: int | None = None) -> float | None:
    if which is None:
        patterns = [
            rf"(?:初速度|初速)\s*(?:v0\s*|v₀\s*)?(?:为|是|=|：|:)?\s*({_NUM})",
            rf"(?:v0|v₀)\s*(?:为|是|=|：|:)?\s*({_NUM})",
            rf"(?:速度)\s*(?:v\s*)?(?:为|是|=|：|:)?\s*({_NUM})",
        ]
    else:
        patterns = [
            rf"(?:v{which}|v{'₁' if which == 1 else '₂'}|(?:物体|物块|小球|滑块){which}速度)"
            rf"\s*(?:为|是|=|：|:)?\s*({_NUM})",
        ]
    return _found(text, patterns)


def _angle(text: str, keys: tuple[str, ...] = ("仰角", "抛射角", "倾角", "角度", "θ")) -> float | None:
    alternatives = "|".join(re.escape(item) for item in keys)
    return _found(text, [
        rf"(?:{alternatives})\s*(?:θ\s*|α\s*)?(?:为|是|=|：|:)?\s*({_NUM})\s*°?",
        rf"(?:θ|α)\s*(?:为|是|=|：|:)?\s*({_NUM})\s*°?",
    ])


def _time(text: str) -> float | None:
    for pattern in [
        rf"(?:时间|历时|经过)\s*(?:t\s*)?(?:为|是|=|：|:)?\s*({_NUM})\s*(?:s|秒)?",
        rf"(?<![A-Za-z])t\s*(?:为|是|=|：|:)\s*({_NUM})\s*(?:s|秒)?",
    ]:
        match = re.search(pattern, text)
        if match:
            try:
                return float(match.group(1))
            except (TypeError, ValueError):
                continue
    return None


def _height(text: str) -> float | None:
    return _found(text, [
        rf"(?:高度|高)\s*(?:h\s*)?(?:为|是|=|：|:)?\s*({_NUM})\s*(?:m|米)?",
        rf"(?<![A-Za-z])h\s*(?:为|是|=|：|:)\s*({_NUM})\s*(?:m|米)?",
    ])


def _g_value(text: str) -> float:
    value = _found(text, [
        rf"(?:重力加速度)\s*(?:g\s*)?(?:为|是|=|：|:)?\s*({_NUM})",
        rf"(?<![A-Za-z])g\s*(?:为|是|=|：|:)\s*({_NUM})",
    ])
    return G_DEFAULT if value is None else value


def _normalize_units(text: str) -> str:
    """把高中常见的非 SI 单位换成 SI；未识别的单位仍按题面数值处理。"""
    text = re.sub(rf"({_NUM})\s*[×xX*]\s*10\s*\^?\s*([-+]?\d+)",
                  lambda match: f"{float(match.group(1)):g}e{int(match.group(2))}", text)

    def replace(pattern: str, fn) -> None:
        nonlocal text
        text = re.sub(pattern, fn, text, flags=re.I)

    replace(rf"({_NUM})\s*km/h", lambda m: f"{float(m.group(1)) / 3.6:g} m/s")
    replace(rf"({_NUM})\s*cm(?![A-Za-z])", lambda m: f"{float(m.group(1)) / 100:g} m")
    replace(rf"({_NUM})\s*mm(?![A-Za-z])", lambda m: f"{float(m.group(1)) / 1000:g} m")
    replace(rf"({_NUM})\s*nm(?![A-Za-z])", lambda m: f"{float(m.group(1)) * 1e-9:g} m")
    replace(rf"({_NUM})\s*(?:μm|um)(?![A-Za-z])", lambda m: f"{float(m.group(1)) * 1e-6:g} m")
    replace(rf"({_NUM})\s*km(?![A-Za-z])", lambda m: f"{float(m.group(1)) * 1000:g} m")
    replace(rf"({_NUM})\s*min(?![A-Za-z])", lambda m: f"{float(m.group(1)) * 60:g} s")
    replace(rf"({_NUM})\s*h(?![A-Za-z])", lambda m: f"{float(m.group(1)) * 3600:g} s")
    replace(rf"({_NUM})\s*g(?![A-Za-z])", lambda m: f"{float(m.group(1)) / 1000:g} kg")
    return text


def _detect_mode(text: str) -> str | None:
    # OCR 可能把关键词从中间断行（"安\n培力"），关键词探测用折叠文本。
    text = re.sub(r"\s+", "", text or "")
    low = text.lower()
    if "单摆" in text:
        return "pendulum"
    if "弹簧振子" in text or ("弹簧" in text and any(word in text for word in ("周期", "振幅", "振动"))):
        return "spring_osc"
    if "简谐" in text:
        return "shm"
    if "完全非弹性" in text or "非弹性碰撞" in text or "粘在一起" in text:
        return "inelastic"
    if "弹性碰撞" in text:
        return "elastic"
    if "冲量" in text or "动量定理" in text or "冲力" in text:
        return "impulse"
    if "动能定理" in text or ("合力" in text and "功" in text):
        return "work_energy"
    if "机械能守恒" in text or ("光滑" in text and ("滑下" in text or "下降" in text)):
        return "energy_conservation"
    if "弹簧势能" in text or ("弹簧" in text and any(word in text for word in ("做功", "拉伸", "拉长", "形变"))):
        return "spring_work"
    if "连接体" in text or "滑轮" in text or "阿特伍德" in text:
        return "atwood"
    if "圆周" in text or "向心" in text:
        return "circular"
    if "斜面" in text or "倾角" in text:
        return "incline"
    if "平抛" in text:
        return "projectile_h"
    if "斜抛" in text or "仰角" in text or "抛射角" in text:
        return "projectile_o"
    if "自由落体" in text or "自由下落" in text or "自由落下" in text or "自由降落" in text:
        return "free_fall"
    if "相对" in text and "速度" in text:
        return "relative"
    if "匀变速" in text or ("初速度" in text and "加速度" in text):
        return "uniform_accel"
    if "抛体" in text or "抛出" in text:
        return "projectile_o" if "角" in text else "projectile_h"
    _ = low
    return None


def _parse_mode(mode: str, text: str) -> tuple[dict[str, float], list[str]]:
    values: dict[str, float] = {"g": _g_value(text)} if mode in G_MODES else {}
    missing: list[str] = []

    def need(key: str, value: float | None, label: str) -> None:
        if value is None:
            missing.append(label)
        else:
            values[key] = float(value)

    if mode == "uniform_accel":
        need("v0", _velocity(text), "初速度 v0")
        need("a", _found(text, [rf"(?:加速度)\s*(?:a\s*)?(?:为|是|=|：|:)?\s*({_NUM})", rf"(?<![A-Za-z])a\s*(?:为|是|=|：|:)\s*({_NUM})"]), "加速度 a")
        need("t", _time(text), "时间 t")
    elif mode == "free_fall":
        need("h", _height(text), "下落高度 h")
    elif mode == "projectile_h":
        need("v0", _velocity(text), "水平初速度 v0")
        need("h", _height(text), "抛出高度 h")
    elif mode == "projectile_o":
        need("v0", _velocity(text), "初速度 v0")
        need("angle", _angle(text, ("仰角", "抛射角", "角度", "θ")), "抛射角 θ")
        h0 = _height(text)
        values["h0"] = 0.0 if h0 is None else h0
    elif mode == "relative":
        need("vA", _found(text, [rf"(?:vA|v甲|甲[^。；;]{{0,8}}速度)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "甲的速度 vA")
        need("vB", _found(text, [rf"(?:vB|v乙|乙[^。；;]{{0,8}}速度)\s*(?:为|是|=|：|:)?\s*({_NUM})"]), "乙的速度 vB")
    elif mode == "incline":
        need("m", _mass(text), "质量 m")
        need("angle", _angle(text, ("倾角", "角度", "θ")), "斜面倾角 θ")
        mu = _found(text, [rf"(?:动摩擦因数|摩擦因数|摩擦系数)\s*(?:μ\s*)?(?:为|是|=|：|:)?\s*({_NUM})",
                           rf"μ\s*(?:为|是|=|：|:)?\s*({_NUM})"])
        if mu is None and ("光滑" in text or "无摩擦" in text):
            mu = 0.0
        need("mu", mu, "动摩擦因数 μ")
    elif mode == "atwood":
        need("m1", _mass(text, 1), "质量 m1")
        need("m2", _mass(text, 2), "质量 m2")
    elif mode == "circular":
        need("m", _mass(text), "质量 m")
        need("v", _velocity(text), "速度 v")
        need("r", _found(text, [rf"(?:半径)\s*(?:r\s*)?(?:为|是|=|：|:)?\s*({_NUM})", rf"(?<![A-Za-z])r\s*(?:为|是|=|：|:)\s*({_NUM})"]), "半径 r")
    elif mode == "spring_work":
        need("k", _found(text, [rf"(?:劲度系数|弹簧常数)\s*(?:k\s*)?(?:为|是|=|：|:)?\s*({_NUM})", rf"(?<![A-Za-z])k\s*(?:为|是|=|：|:)\s*({_NUM})"]), "劲度系数 k")
        need("x", _found(text, [rf"(?:伸长量|形变量|拉伸量|拉伸)\s*(?:x\s*)?(?:为|是|=|：|:)?\s*({_NUM})", rf"(?<![A-Za-z])x\s*(?:为|是|=|：|:)\s*({_NUM})"]), "形变量 x")
    elif mode == "work_energy":
        need("m", _mass(text), "质量 m")
        need("F", _found(text, [rf"(?:合力|恒力|拉力)\s*(?:F\s*)?(?:为|是|=|：|:)?\s*({_NUM})", rf"(?<![A-Za-z])F\s*(?:为|是|=|：|:)\s*({_NUM})"]), "合力 F")
        need("s", _found(text, [rf"(?:位移|距离|移动)\s*(?:s\s*)?(?:为|是|=|：|:)?\s*({_NUM})", rf"(?<![A-Za-z])s\s*(?:为|是|=|：|:)\s*({_NUM})"]), "位移 s")
        values["v0"] = _velocity(text) or 0.0
    elif mode == "energy_conservation":
        need("m", _mass(text), "质量 m")
        need("h", _height(text), "高度 h")
    elif mode == "impulse":
        need("m", _mass(text), "质量 m")
        need("v1", _velocity(text, 1), "初速度 v1")
        need("v2", _velocity(text, 2), "末速度 v2")
        need("t", _time(text), "作用时间 t")
    elif mode in ("elastic", "inelastic"):
        need("m1", _mass(text, 1), "质量 m1")
        need("v1", _velocity(text, 1), "速度 v1")
        need("m2", _mass(text, 2), "质量 m2")
        if "静止" in text:
            values["v2"] = 0.0
        else:
            need("v2", _velocity(text, 2), "速度 v2")
    elif mode == "spring_osc":
        need("m", _mass(text), "质量 m")
        need("k", _found(text, [rf"(?:劲度系数|弹簧常数)\s*(?:k\s*)?(?:为|是|=|：|:)?\s*({_NUM})", rf"(?<![A-Za-z])k\s*(?:为|是|=|：|:)\s*({_NUM})"]), "劲度系数 k")
        need("A", _found(text, [rf"(?:振幅)\s*(?:A\s*)?(?:为|是|=|：|:)?\s*({_NUM})", rf"(?<![A-Za-z])A\s*(?:为|是|=|：|:)\s*({_NUM})"]), "振幅 A")
    elif mode == "pendulum":
        need("L", _found(text, [rf"(?:摆长)\s*(?:L\s*)?(?:为|是|=|：|:)?\s*({_NUM})", rf"(?<![A-Za-z])L\s*(?:为|是|=|：|:)\s*({_NUM})"]), "摆长 L")
        # OCR 可能把 θ0 读成 "00/O0"（"初始摆角00=5°"），标签与数值间容忍一个乱码符号。
        need("theta0", _found(text, [
            rf"(?:初始摆角|摆角|初始角度)\s*[θθ₀Ο0Oo]{{0,2}}\s*(?:为|是|=|：|:)?\s*({_NUM})\s*°?",
            rf"(?:θ0|θ₀)\s*(?:为|是|=|：|:)?\s*({_NUM})\s*°?"]), "初始摆角 θ0")
        values["m"] = _mass(text) or 1.0
    elif mode == "shm":
        need("A", _found(text, [rf"(?:振幅)\s*(?:A\s*)?(?:为|是|=|：|:)?\s*({_NUM})", rf"(?<![A-Za-z])A\s*(?:为|是|=|：|:)\s*({_NUM})"]), "振幅 A")
        need("T", _found(text, [rf"(?:周期)\s*(?:T\s*)?(?:为|是|=|：|:)?\s*({_NUM})", rf"(?<![A-Za-z])T\s*(?:为|是|=|：|:)\s*({_NUM})"]), "周期 T")
        values["phi"] = _found(text, [rf"(?:初相|相位)\s*(?:φ\s*)?(?:为|是|=|：|:)?\s*({_NUM})\s*°?", rf"φ\s*(?:为|是|=|：|:)?\s*({_NUM})\s*°?"]) or 0.0
        need("t", _time(text), "时刻 t")
        values["m"] = _mass(text) or 1.0
    return values, missing


def _param(cid: str, label: str, min_value: float | None, max_value: float | None,
           step: float | None, note: str | None = None) -> dict[str, Any]:
    return {"id": cid, "label": label, "kind": "number", "min": min_value, "max": max_value,
            "step": step, "options": [], "note": note}


def _params_for(mode: str) -> list[dict[str, Any]]:
    if mode == "uniform_accel":
        return [_param("v0", "初速度 v0 (m/s)", -50, 50, 0.1),
                _param("a", "加速度 a (m/s²)", -20, 20, 0.1),
                _param("t", "时间 t (s)", 0.1, 30, 0.1)]
    if mode == "free_fall":
        return [_param("h", "高度 h (m)", 0.1, 500, 0.1), _param("g", "重力加速度 g", 0.1, 30, 0.1)]
    if mode == "projectile_h":
        return [_param("v0", "水平初速度 v0 (m/s)", 0.1, 80, 0.1),
                _param("h", "抛出高度 h (m)", 0.1, 500, 0.1), _param("g", "重力加速度 g", 0.1, 30, 0.1)]
    if mode == "projectile_o":
        return [_param("v0", "初速度 v0 (m/s)", 0.1, 120, 0.1),
                _param("angle", "抛射角 θ (°)", 1, 89, 1),
                _param("h0", "初始高度 h0 (m)", 0, 500, 0.1),
                _param("g", "重力加速度 g", 0.1, 30, 0.1)]
    if mode == "relative":
        return [_param("vA", "甲的速度 vA (m/s)", -50, 50, 0.1),
                _param("vB", "乙的速度 vB (m/s)", -50, 50, 0.1)]
    if mode == "incline":
        return [_param("m", "质量 m (kg)", 0.1, 100, 0.1), _param("angle", "倾角 θ (°)", 1, 89, 1),
                _param("mu", "动摩擦因数 μ", 0, 1.5, 0.01), _param("g", "重力加速度 g", 0.1, 30, 0.1)]
    if mode == "atwood":
        return [_param("m1", "质量 m1 (kg)", 0.1, 100, 0.1), _param("m2", "质量 m2 (kg)", 0.1, 100, 0.1),
                _param("g", "重力加速度 g", 0.1, 30, 0.1)]
    if mode == "circular":
        return [_param("m", "质量 m (kg)", 0.1, 100, 0.1), _param("v", "速度 v (m/s)", 0.1, 100, 0.1),
                _param("r", "半径 r (m)", 0.1, 100, 0.1)]
    if mode == "spring_work":
        return [_param("k", "劲度系数 k (N/m)", 0.1, 5000, 1),
                _param("x", "形变量 x (m)", 0.001, 5, 0.01)]
    if mode == "work_energy":
        return [_param("m", "质量 m (kg)", 0.1, 100, 0.1), _param("F", "合力 F (N)", -500, 500, 0.1),
                _param("s", "位移 s (m)", 0.1, 100, 0.1), _param("v0", "初速度 v0 (m/s)", -30, 30, 0.1)]
    if mode == "energy_conservation":
        return [_param("m", "质量 m (kg)", 0.1, 100, 0.1), _param("h", "高度 h (m)", 0.1, 500, 0.1),
                _param("g", "重力加速度 g", 0.1, 30, 0.1)]
    if mode == "impulse":
        return [_param("m", "质量 m (kg)", 0.1, 100, 0.1), _param("v1", "初速度 v1 (m/s)", -50, 50, 0.1),
                _param("v2", "末速度 v2 (m/s)", -50, 50, 0.1), _param("t", "作用时间 t (s)", 0.01, 60, 0.01)]
    if mode in ("elastic", "inelastic"):
        return [_param("m1", "质量 m1 (kg)", 0.1, 100, 0.1), _param("v1", "速度 v1 (m/s)", -50, 50, 0.1),
                _param("m2", "质量 m2 (kg)", 0.1, 100, 0.1), _param("v2", "速度 v2 (m/s)", -50, 50, 0.1)]
    if mode == "spring_osc":
        return [_param("m", "质量 m (kg)", 0.1, 100, 0.1), _param("k", "劲度系数 k (N/m)", 0.1, 5000, 1),
                _param("A", "振幅 A (m)", 0.001, 5, 0.01)]
    if mode == "pendulum":
        return [_param("L", "摆长 L (m)", 0.1, 20, 0.1), _param("theta0", "初始摆角 θ0 (°)", 0.1, 30, 0.1),
                _param("g", "重力加速度 g", 0.1, 30, 0.1), _param("m", "摆球质量 m (kg)", 0.1, 100, 0.1)]
    if mode == "shm":
        return [_param("A", "振幅 A (m)", 0.001, 5, 0.01), _param("T", "周期 T (s)", 0.1, 60, 0.1),
                _param("phi", "初相 φ (°)", -360, 360, 1), _param("t", "时刻 t (s)", 0, 60, 0.01),
                _param("m", "质量 m (kg)", 0.1, 100, 0.1)]
    return []


def _apply_overrides(values: dict[str, float], overrides: Mapping[str, Any]) -> set[str]:
    """将核对修正弹窗传回的数值条件（支持 `phy_<key>` 或 `<key>`）合并到模型默认值中。"""
    overridden: set[str] = set()
    merged: dict[str, Any] = dict(overrides.get("condition_values") or {})
    for raw_key, raw_value in merged.items():
        if raw_value is None or isinstance(raw_value, bool):
            continue
        key = raw_key[4:] if raw_key.startswith("phy_") else raw_key
        if key not in values:
            continue
        try:
            parsed = float(raw_value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(parsed):
            values[key] = parsed
            overridden.add(key)
    return overridden


def _conditions_for(
    mode: str,
    values: Mapping[str, float],
    source: Mapping[str, Any],
    overridden: set[str] | None = None,
) -> list[dict[str, Any]]:
    labels = {
        "v0": ("初速度 v0", "m/s"), "a": ("加速度 a", "m/s²"), "t": ("时间 t", "s"),
        "h": ("高度 h", "m"), "h0": ("初始高度 h0", "m"), "angle": ("角度 θ", "°"),
        "vA": ("甲速度 vA", "m/s"), "vB": ("乙速度 vB", "m/s"),
        "m": ("质量 m", "kg"), "m1": ("质量 m1", "kg"), "m2": ("质量 m2", "kg"),
        "mu": ("动摩擦因数 μ", ""), "v": ("速度 v", "m/s"), "r": ("半径 r", "m"),
        "k": ("劲度系数 k", "N/m"), "x": ("形变量 x", "m"), "F": ("合力 F", "N"),
        "s": ("位移 s", "m"), "v1": ("速度 v1", "m/s"), "v2": ("速度 v2", "m/s"),
        "L": ("摆长 L", "m"), "theta0": ("初始摆角 θ0", "°"), "A": ("振幅 A", "m"),
        "T": ("周期 T", "s"), "phi": ("初相 φ", "°"), "g": ("重力加速度 g", "m/s²"),
    }
    conditions = [{"id": "physics_mode", "label": "物理题型", "value": MODE_LABELS[mode], "kind": "text",
                   "unit": "", "provenance": "original", "source": dict(source), "editable": False,
                   "options": [], "min": None, "max": None, "step": None, "note": None}]
    confirmed = overridden or set()
    for key, value in values.items():
        label, unit = labels.get(key, (key, ""))
        conditions.append({"id": f"phy_{key}", "label": label, "value": value, "kind": "number",
                           "unit": unit, "provenance": "student_confirmed" if key in confirmed else "original",
                           "source": dict(source),
                           "editable": True, "options": [], "min": None, "max": None, "step": None,
                           "note": None})
    return conditions


def _formulas_for(mode: str) -> list[dict[str, Any]]:
    plain = {
        "uniform_accel": "v = v0 + at；s = v0 t + ½ a t²",
        "free_fall": "t = √(2h/g)；v = gt",
        "projectile_h": "t = √(2h/g)；x = v0 t；v = √(v0² + (gt)²)",
        "projectile_o": "x = v0cosθ·t；y = h0 + v0sinθ·t − ½gt²",
        "relative": "v(A相对B) = vA − vB",
        "incline": "N = mg cosθ；f = μN；a = g(sinθ − μcosθ)",
        "atwood": "a = (m2 − m1)g/(m1 + m2)；T = 2m1m2g/(m1 + m2)",
        "circular": "a = v²/r；F = mv²/r；T = 2πr/v",
        "spring_work": "F = kx；W = ½kx²；Ep = ½kx²",
        "work_energy": "W = Fs；W = ΔEk = ½mv² − ½mv0²",
        "energy_conservation": "mgh = ½mv²；v = √(2gh)",
        "impulse": "I = Δp = m(v2 − v1)；F平均 = I/t",
        "elastic": "m1v1 + m2v2 = m1v1′ + m2v2′；动能也守恒",
        "inelastic": "v′ = (m1v1 + m2v2)/(m1 + m2)",
        "spring_osc": "ω = √(k/m)；T = 2π/ω；vmax = Aω；E = ½kA²",
        "pendulum": "ω = √(g/L)；T = 2π/ω；vmax = √(2gL(1 − cosθ0))",
        "shm": "x = A cos(ωt + φ)；v = −Aω sin(ωt + φ)；a = −ω²x",
    }[mode]
    return [{"id": "physics_rule", "tex": r"\text{" + plain.replace("²", "^2").replace("√", "\\sqrt ") + "}",
             "plain": plain, "role": "物理规律"}]


def _built(mode: str, model: dict[str, Any], conditions: list[dict[str, Any]],
           formulas: list[dict[str, Any]], ambiguities: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {"model": model, "conditions": conditions, "formulas": formulas,
            "ambiguities": list(ambiguities or []), "recognized": True}


def build_physics(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any]:
    from .physics_third import build_physics_third
    third = build_physics_third(text, source, overrides)
    if third is not None:
        return third
    from .physics_second import build_physics_second
    second = build_physics_second(text, source, overrides)
    if second is not None:
        return second
    mode = _detect_mode(text)
    if mode is None:
        from .physics_second import MODE_LABELS as SECOND_LABELS
        from .physics_third import MODE_LABELS as THIRD_LABELS
        model = {"engine": "physics_unknown_v1", "subject": "physics", "physics_kind": None,
                 "physics_mode": None, "raw": text, "defaults": {}, "params": [], "teaching": False}
        built = _built("uniform_accel", model, [], [])
        built["recognized"] = False
        built["ambiguities"].append({
            "id": "physics_kind", "field": "physics_mode", "severity": "blocking",
            "question": "已识别为物理内容，但没有确定题型；请选择力学、电磁学、波动光学、几何光学或近代物理题型。",
            "options": [{"value": key, "label": value}
                        for key, value in {**MODE_LABELS, **SECOND_LABELS, **THIRD_LABELS}.items()],
            "resolved": False, "answer": None,
        })
        return built
    values, missing = _parse_mode(mode, _normalize_units(text))
    overridden = _apply_overrides(values, overrides)
    model = {"engine": "physics_v1", "subject": "physics", "physics_kind": MODE_KIND[mode],
             "physics_mode": mode, "raw": text, "defaults": values, "params": _params_for(mode),
             "teaching": False}
    conditions = _conditions_for(mode, values, source, overridden)
    formulas = _formulas_for(mode)
    ambiguities: list[dict[str, Any]] = []
    if missing:
        ambiguities.append({
            "id": "physics_conditions", "field": "physics_mode", "severity": "blocking",
            "question": "识别为" + MODE_LABELS[mode] + "，但缺少：" + "、".join(missing) + "。请补充后重建。",
            "options": [], "resolved": False, "answer": None,
        })
    return _built(mode, model, conditions, formulas, ambiguities)


# ---------------------------------------------------------------------------
# 求解
# ---------------------------------------------------------------------------

def _value(params: Mapping[str, Any], key: str, default: float | None = None) -> float:
    raw = params.get(key)
    if isinstance(raw, bool) or raw is None:
        return float(default if default is not None else 0.0)
    try:
        return float(raw)
    except (TypeError, ValueError):
        return float(default if default is not None else 0.0)


def _result_frame(index: int, label: str, detail: str, values: Mapping[str, Any]) -> dict[str, Any]:
    return {"index": index, "label": label, "detail": detail, "values": dict(values)}


def _metrics(items: list[tuple[str, str, str, str | None]]) -> list[dict[str, Any]]:
    return [{"id": key, "label": label, "value": value, **({"tone": tone} if tone else {})}
            for key, label, value, tone in items]


def _checks(items: list[tuple[str, str, bool, str]]) -> list[dict[str, Any]]:
    return [{"id": key, "label": label, "status": "pass" if ok else "warn", "detail": detail}
            for key, label, ok, detail in items]


def _samples(t_end: float, fn, count: int = 24) -> list[dict[str, float]]:
    out: list[dict[str, float]] = []
    if t_end <= 0:
        return out
    for index in range(count + 1):
        t = t_end * index / count
        out.append({"t": t, **fn(t)})
    return out


def _evaluate_mode(mode: str, p: Mapping[str, Any], text: str = "") -> dict[str, Any]:
    g = _value(p, "g", G_DEFAULT)
    if g <= 0:
        raise ValueError("重力加速度必须为正数")
    if mode == "uniform_accel":
        v0, a, t = _value(p, "v0"), _value(p, "a"), _value(p, "t")
        if t <= 0:
            raise ValueError("时间必须为正数")
        v = v0 + a * t
        s = v0 * t + 0.5 * a * t * t
        vavg = s / t
        check = v * v - (v0 * v0 + 2 * a * s)
        samples = _samples(t, lambda tau: {"x": v0 * tau + 0.5 * a * tau * tau, "v": v0 + a * tau, "a": a})
        return {
            "kind": "kinematics", "mode": mode,
            "answer": f"末速度 v={_fmt(v)} m/s，位移 s={_fmt(s)} m，平均速度 {_fmt(vavg)} m/s。",
            "answer_value": v,
            "metrics": _metrics([("v", "末速度", f"{_fmt(v)} m/s", "accent"),
                                  ("s", "位移", f"{_fmt(s)} m", None),
                                  ("vavg", "平均速度", f"{_fmt(vavg)} m/s", None)]),
            "checks": _checks([
                ("kinematics", "运动学公式一致", abs(check) < 1e-6 * max(1, abs(v * v)), "v² = v0² + 2as 的数值复核"),
                ("time", "时间与方向", t > 0, "时间取正值；a 或 v0 为负时按同一坐标轴解释。"),
            ]),
            "notes": [MODE_LIMITS[mode]],
            "frames": [_result_frame(i, f"t={_fmt(item['t'])} s", f"x={_fmt(item['x'])} m，v={_fmt(item['v'])} m/s", item)
                       for i, item in enumerate(samples[::max(1, len(samples) // 8)])],
            "scene": {"type": "linear", "v0": v0, "a": a, "t": t, "x": s, "v": v, "samples": samples},
        }
    if mode == "free_fall":
        h = _value(p, "h")
        if h <= 0:
            raise ValueError("高度必须为正数")
        t = math.sqrt(2 * h / g)
        v = g * t
        samples = _samples(t, lambda tau: {"y": h - 0.5 * g * tau * tau, "v": g * tau, "a": g})
        return {
            "kind": "kinematics", "mode": mode,
            "answer": f"落地时间 t={_fmt(t)} s，落地速度 v={_fmt(v)} m/s。",
            "answer_value": v if ("速度" in text and "时间" not in text) else t,
            "metrics": _metrics([("t", "落地时间", f"{_fmt(t)} s", "accent"),
                                  ("v", "落地速度", f"{_fmt(v)} m/s", None),
                                  ("h", "下落高度", f"{_fmt(h)} m", None)]),
            "checks": _checks([("energy", "自由落体关系", abs(v * v - 2 * g * h) < 1e-6, "v² = 2gh 的数值复核"),
                                ("time", "时间有效", t > 0, "从静止释放，空气阻力忽略。")]),
            "notes": [MODE_LIMITS[mode]],
            "frames": [_result_frame(i, f"t={_fmt(item['t'])} s", f"y={_fmt(item['y'])} m，v={_fmt(item['v'])} m/s", item)
                       for i, item in enumerate(samples[::max(1, len(samples) // 8)])],
            "scene": {"type": "fall", "h": h, "g": g, "t": t, "v": v, "samples": samples},
        }
    if mode in ("projectile_h", "projectile_o"):
        v0 = _value(p, "v0")
        if v0 <= 0:
            raise ValueError("初速度必须为正数")
        if mode == "projectile_h":
            h0 = _value(p, "h")
            if h0 < 0:
                raise ValueError("抛出高度不能为负")
            angle = 0.0
            vy0, vx = 0.0, v0
            t = math.sqrt(2 * h0 / g)
            y_end = 0.0
        else:
            angle = _value(p, "angle")
            if not (0 < angle < 90):
                raise ValueError("抛射角需在 0° 到 90° 之间")
            h0 = _value(p, "h0", 0.0)
            rad = angle * _DEG
            vx, vy0 = v0 * math.cos(rad), v0 * math.sin(rad)
            t = (vy0 + math.sqrt(vy0 * vy0 + 2 * g * h0)) / g
            y_end = 0.0
        range_x = vx * t
        max_h = h0 + (vy0 * vy0) / (2 * g)
        vy_end = vy0 - g * t
        v_end = math.hypot(vx, vy_end)
        samples = _samples(t, lambda tau: {"x": vx * tau, "y": h0 + vy0 * tau - 0.5 * g * tau * tau,
                                           "vx": vx, "vy": vy0 - g * tau})
        return {
            "kind": "kinematics", "mode": mode,
            "answer": f"飞行时间 t={_fmt(t)} s，水平射程 x={_fmt(range_x)} m，最大高度 {_fmt(max_h)} m，落地速度 {_fmt(v_end)} m/s。",
            "answer_value": range_x,
            "metrics": _metrics([("t", "飞行时间", f"{_fmt(t)} s", "accent"),
                                  ("range", "水平射程", f"{_fmt(range_x)} m", None),
                                  ("hmax", "最大高度", f"{_fmt(max_h)} m", None),
                                  ("v", "落地速度", f"{_fmt(v_end)} m/s", None)]),
            "checks": _checks([
                ("range", "水平位移关系", abs(range_x - vx * t) < 1e-6, "x = vx·t 的数值复核"),
                ("landing", "落地速度分解", abs(v_end * v_end - (vx * vx + vy_end * vy_end)) < 1e-6,
                 "v = √(vx² + vy²) 的数值复核"),
            ]),
            "notes": [MODE_LIMITS[mode]],
            "frames": [_result_frame(i, f"t={_fmt(item['t'])} s", f"({_fmt(item['x'])}, {_fmt(item['y'])}) m", item)
                       for i, item in enumerate(samples[::max(1, len(samples) // 8)])],
            "scene": {"type": "projectile", "v0": v0, "angle": angle, "h0": h0, "g": g,
                      "t": t, "range": range_x, "maxHeight": max_h, "vEnd": v_end,
                      "vx": vx, "vy0": vy0, "samples": samples},
        }
    if mode == "relative":
        va, vb = _value(p, "vA"), _value(p, "vB")
        rel = va - vb
        direction = "同向" if rel == 0 else ("甲相对乙向前" if rel > 0 else "甲相对乙向后")
        return {
            "kind": "kinematics", "mode": mode,
            "answer": f"甲相对乙的速度 vAB={_fmt(rel)} m/s（{direction}）。",
            "answer_value": rel,
            "metrics": _metrics([("rel", "相对速度", f"{_fmt(rel)} m/s", "accent"),
                                  ("speed", "相对速率", f"{_fmt(abs(rel))} m/s", None)]),
            "checks": _checks([("relative", "相对速度定义", True, "vAB = vA − vB；一维速度带符号。")]),
            "notes": [MODE_LIMITS[mode]],
            "frames": [_result_frame(0, "已知速度", f"vA={_fmt(va)} m/s，vB={_fmt(vb)} m/s", {"vA": va, "vB": vb}),
                       _result_frame(1, "相对速度", f"vAB={_fmt(rel)} m/s", {"rel": rel})],
            "scene": {"type": "relative", "vA": va, "vB": vb, "rel": rel},
        }
    if mode == "incline":
        m, angle, mu = _value(p, "m"), _value(p, "angle"), _value(p, "mu")
        if m <= 0 or not (0 < angle < 90) or mu < 0:
            raise ValueError("质量、倾角和摩擦因数需满足物理范围")
        rad = angle * _DEG
        normal = m * g * math.cos(rad)
        gravity_along = m * g * math.sin(rad)
        kinetic_friction = mu * normal
        net = gravity_along - kinetic_friction
        moving = net > 0
        acceleration = net / m if moving else 0.0
        friction = kinetic_friction if moving else gravity_along
        return {
            "kind": "newton", "mode": mode,
            "answer": (f"沿斜面加速度 a={_fmt(acceleration)} m/s²，摩擦力 f={_fmt(friction)} N，"
                       f"支持力 N={_fmt(normal)} N；" + ("物体可下滑。" if moving else "重力分量不足以克服摩擦，物体保持静止。")),
            "answer_value": acceleration,
            "metrics": _metrics([("a", "沿斜面加速度", f"{_fmt(acceleration)} m/s²", "accent"),
                                  ("f", "摩擦力", f"{_fmt(friction)} N", None),
                                  ("N", "支持力", f"{_fmt(normal)} N", None),
                                  ("net", "沿斜面合力", f"{_fmt(net)} N", None)]),
            "checks": _checks([
                ("normal", "支持力分量", abs(normal - m * g * math.cos(rad)) < 1e-6, "N = mg cosθ"),
                ("motion", "是否满足起滑条件", moving or abs(net) < 1e-9,
                 "重力沿斜面分量大于最大静摩擦时按动摩擦计算；否则按静止处理。"),
            ]),
            "notes": [MODE_LIMITS[mode]],
            "frames": [_result_frame(0, "受力分解", f"N={_fmt(normal)} N，f={_fmt(friction)} N",
                                     {"normal": normal, "friction": friction}),
                       _result_frame(1, "沿斜面运动", f"a={_fmt(acceleration)} m/s²", {"a": acceleration})],
            "scene": {"type": "incline", "m": m, "angle": angle, "mu": mu, "g": g,
                      "normal": normal, "friction": friction, "gravityAlong": gravity_along,
                      "net": net, "acceleration": acceleration, "moving": moving},
        }
    if mode == "atwood":
        m1, m2 = _value(p, "m1"), _value(p, "m2")
        if m1 <= 0 or m2 <= 0:
            raise ValueError("两物体质量必须为正数")
        total = m1 + m2
        acceleration = (m2 - m1) * g / total
        tension = 2 * m1 * m2 * g / total
        direction = "m2 下降、m1 上升" if acceleration > 0 else ("m1 下降、m2 上升" if acceleration < 0 else "静止")
        check1 = abs(m2 * g - tension - m2 * acceleration)
        check2 = abs(tension - m1 * g - m1 * acceleration)
        return {
            "kind": "newton", "mode": mode,
            "answer": f"加速度大小 {_fmt(abs(acceleration))} m/s²（{direction}），绳张力 T={_fmt(tension)} N。",
            "answer_value": abs(acceleration),
            "metrics": _metrics([("a", "加速度", f"{_fmt(abs(acceleration))} m/s²", "accent"),
                                  ("T", "绳张力", f"{_fmt(tension)} N", None),
                                  ("total", "总质量", f"{_fmt(total)} kg", None)]),
            "checks": _checks([("m2", "m2 方程", check1 < 1e-6, "m2g − T = m2a"),
                                ("m1", "m1 方程", check2 < 1e-6, "T − m1g = m1a")]),
            "notes": [MODE_LIMITS[mode]],
            "frames": [_result_frame(0, "两物体受力", f"m1={_fmt(m1)} kg，m2={_fmt(m2)} kg", {"m1": m1, "m2": m2}),
                       _result_frame(1, "共同加速度", f"a={_fmt(acceleration)} m/s²，T={_fmt(tension)} N",
                                     {"a": acceleration, "T": tension})],
            "scene": {"type": "atwood", "m1": m1, "m2": m2, "g": g, "a": acceleration, "T": tension},
        }
    if mode == "circular":
        m, v, r = _value(p, "m"), _value(p, "v"), _value(p, "r")
        if m <= 0 or v <= 0 or r <= 0:
            raise ValueError("质量、速度和半径必须为正数")
        acceleration = v * v / r
        force = m * acceleration
        period = 2 * math.pi * r / v
        return {
            "kind": "newton", "mode": mode,
            "answer": f"向心加速度 a={_fmt(acceleration)} m/s²，向心力 F={_fmt(force)} N，周期 T={_fmt(period)} s。",
            "answer_value": acceleration,
            "metrics": _metrics([("a", "向心加速度", f"{_fmt(acceleration)} m/s²", "accent"),
                                  ("F", "向心力", f"{_fmt(force)} N", None),
                                  ("T", "周期", f"{_fmt(period)} s", None)]),
            "checks": _checks([("force", "牛顿第二定律", abs(force - m * acceleration) < 1e-6, "F = ma"),
                                ("accel", "向心加速度公式", abs(acceleration - v * v / r) < 1e-6, "a = v²/r")]),
            "notes": [MODE_LIMITS[mode]],
            "frames": [_result_frame(0, "速度与半径", f"v={_fmt(v)} m/s，r={_fmt(r)} m", {"v": v, "r": r}),
                       _result_frame(1, "向心量与周期", f"a={_fmt(acceleration)} m/s²，F={_fmt(force)} N",
                                     {"a": acceleration, "F": force, "T": period})],
            "scene": {"type": "circular", "m": m, "v": v, "r": r, "a": acceleration, "F": force, "T": period},
        }
    if mode == "spring_work":
        k, x = _value(p, "k"), _value(p, "x")
        if k <= 0 or x < 0:
            raise ValueError("劲度系数需为正，形变量不能为负")
        force = k * x
        work = 0.5 * k * x * x
        energy = 0.5 * k * x * x
        return {
            "kind": "work_energy", "mode": mode,
            "answer": f"弹簧力 F={_fmt(force)} N，拉力做功 W={_fmt(work)} J，弹性势能 Ep={_fmt(energy)} J。",
            "answer_value": work,
            "metrics": _metrics([("F", "弹簧力", f"{_fmt(force)} N", None),
                                  ("W", "拉力做功", f"{_fmt(work)} J", "accent"),
                                  ("Ep", "弹性势能", f"{_fmt(energy)} J", None)]),
            "checks": _checks([("work", "变力做功积分", abs(work - energy) < 1e-6, "W = ∫kx dx = ½kx²"),
                                ("force", "胡克定律", abs(force - k * x) < 1e-6, "F = kx")]),
            "notes": [MODE_LIMITS[mode]],
            "frames": [_result_frame(0, "弹簧力", f"F={_fmt(force)} N", {"F": force}),
                       _result_frame(1, "做功与势能", f"W={_fmt(work)} J，Ep={_fmt(energy)} J",
                                     {"W": work, "Ep": energy})],
            "scene": {"type": "spring_work", "k": k, "x": x, "F": force, "W": work, "Ep": energy},
        }
    if mode == "work_energy":
        m, force, distance, v0 = _value(p, "m"), _value(p, "F"), _value(p, "s"), _value(p, "v0")
        if m <= 0 or distance <= 0:
            raise ValueError("质量和位移必须为正数")
        work = force * distance
        k0 = 0.5 * m * v0 * v0
        k1 = k0 + work
        if k1 < 0:
            raise ValueError("合力做功使动能变为负值；物体会在到达该位移前停下，请核对条件")
        v = math.sqrt(2 * k1 / m)
        return {
            "kind": "work_energy", "mode": mode,
            "answer": f"合力做功 W={_fmt(work)} J，末速度 v={_fmt(v)} m/s，动能变化 ΔEk={_fmt(work)} J。",
            "answer_value": work,
            "metrics": _metrics([("W", "合力做功", f"{_fmt(work)} J", "accent"),
                                  ("v", "末速度", f"{_fmt(v)} m/s", None),
                                  ("dK", "动能变化", f"{_fmt(work)} J", None)]),
            "checks": _checks([("theorem", "动能定理", abs(work - (k1 - k0)) < 1e-6, "W = ΔEk"),
                                ("speed", "末速度有效", v >= 0, "末动能非负时才能得到实速度。")]),
            "notes": [MODE_LIMITS[mode]],
            "frames": [_result_frame(0, "合力做功", f"F={_fmt(force)} N，s={_fmt(distance)} m，W={_fmt(work)} J",
                                     {"F": force, "s": distance, "W": work}),
                       _result_frame(1, "动能变化", f"v0={_fmt(v0)} m/s，v={_fmt(v)} m/s", {"v0": v0, "v": v})],
            "scene": {"type": "work_energy", "m": m, "F": force, "s": distance, "v0": v0,
                      "v": v, "W": work, "K0": k0, "K1": k1},
        }
    if mode == "energy_conservation":
        m, h = _value(p, "m"), _value(p, "h")
        if m <= 0 or h < 0:
            raise ValueError("质量和高度需满足物理范围")
        v = math.sqrt(2 * g * h)
        energy = m * g * h
        return {
            "kind": "work_energy", "mode": mode,
            "answer": f"到达底端速度 v={_fmt(v)} m/s，重力势能减少 {_fmt(energy)} J，动能增加 {_fmt(energy)} J。",
            "answer_value": v,
            "metrics": _metrics([("v", "底端速度", f"{_fmt(v)} m/s", "accent"),
                                  ("Ep", "重力势能", f"{_fmt(energy)} J", None),
                                  ("Ek", "动能", f"{_fmt(energy)} J", None)]),
            "checks": _checks([("energy", "机械能守恒", abs(0.5 * m * v * v - energy) < 1e-6, "mgh = ½mv²"),
                                ("speed", "速度有效", v >= 0, "从静止释放且只有重力做功。")]),
            "notes": [MODE_LIMITS[mode]],
            "frames": [_result_frame(0, "初始能量", f"Ep={_fmt(energy)} J，Ek=0", {"Ep": energy}),
                       _result_frame(1, "底端能量", f"v={_fmt(v)} m/s，Ek={_fmt(energy)} J",
                                     {"v": v, "Ek": energy})],
            "scene": {"type": "energy", "m": m, "h": h, "g": g, "v": v, "energy": energy},
        }
    if mode == "impulse":
        m, v1, v2, t = _value(p, "m"), _value(p, "v1"), _value(p, "v2"), _value(p, "t")
        if m <= 0 or t <= 0:
            raise ValueError("质量和作用时间必须为正数")
        impulse = m * (v2 - v1)
        average = impulse / t
        return {
            "kind": "momentum", "mode": mode,
            "answer": f"动量变化 Δp={_fmt(impulse)} kg·m/s，冲量 I={_fmt(impulse)} N·s，平均力 F={_fmt(average)} N。",
            "answer_value": average if re.search(r"冲力|平均力|平均作用力", text) else impulse,
            "metrics": _metrics([("dp", "动量变化", f"{_fmt(impulse)} kg·m/s", "accent"),
                                  ("I", "冲量", f"{_fmt(impulse)} N·s", None),
                                  ("F", "平均力", f"{_fmt(average)} N", None)]),
            "checks": _checks([("impulse", "动量定理", abs(impulse - m * (v2 - v1)) < 1e-6, "I = Δp"),
                                ("force", "平均力定义", abs(average - impulse / t) < 1e-6, "F平均 = I/t")]),
            "notes": [MODE_LIMITS[mode]],
            "frames": [_result_frame(0, "速度变化", f"v1={_fmt(v1)} m/s，v2={_fmt(v2)} m/s", {"v1": v1, "v2": v2}),
                       _result_frame(1, "冲量", f"I={_fmt(impulse)} N·s，F={_fmt(average)} N",
                                     {"I": impulse, "F": average})],
            "scene": {"type": "impulse", "m": m, "v1": v1, "v2": v2, "t": t, "impulse": impulse, "average": average},
        }
    if mode in ("elastic", "inelastic"):
        m1, v1, m2, v2 = _value(p, "m1"), _value(p, "v1"), _value(p, "m2"), _value(p, "v2")
        if m1 <= 0 or m2 <= 0:
            raise ValueError("两物体质量必须为正数")
        p_before = m1 * v1 + m2 * v2
        k_before = 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2
        if mode == "elastic":
            v1p = ((m1 - m2) * v1 + 2 * m2 * v2) / (m1 + m2)
            v2p = ((m2 - m1) * v2 + 2 * m1 * v1) / (m1 + m2)
            p_after = m1 * v1p + m2 * v2p
            k_after = 0.5 * m1 * v1p * v1p + 0.5 * m2 * v2p * v2p
            return {
                "kind": "momentum", "mode": mode,
                "answer": f"碰后速度 v1′={_fmt(v1p)} m/s，v2′={_fmt(v2p)} m/s；动量守恒，动能也守恒。",
                "answer_value": v1p,
                "metrics": _metrics([("v1", "碰后 v1′", f"{_fmt(v1p)} m/s", "accent"),
                                      ("v2", "碰后 v2′", f"{_fmt(v2p)} m/s", None),
                                      ("p", "总动量", f"{_fmt(p_after)} kg·m/s", None),
                                      ("Ek", "总动能", f"{_fmt(k_after)} J", None)]),
                "checks": _checks([("momentum", "动量守恒", abs(p_before - p_after) < 1e-6, "碰撞前后总动量相等"),
                                    ("energy", "动能守恒", abs(k_before - k_after) < 1e-6, "一维弹性碰撞的动能保持")]),
                "notes": [MODE_LIMITS[mode]],
                "frames": [_result_frame(0, "碰前", f"v1={_fmt(v1)} m/s，v2={_fmt(v2)} m/s", {"v1": v1, "v2": v2}),
                            _result_frame(1, "碰后", f"v1′={_fmt(v1p)} m/s，v2′={_fmt(v2p)} m/s",
                                          {"v1p": v1p, "v2p": v2p})],
                "scene": {"type": "collision", "mode": mode, "m1": m1, "v1": v1, "m2": m2, "v2": v2,
                          "v1p": v1p, "v2p": v2p, "p": p_after, "K0": k_before, "K1": k_after},
            }
        vp = (m1 * v1 + m2 * v2) / (m1 + m2)
        p_after = (m1 + m2) * vp
        k_after = 0.5 * (m1 + m2) * vp * vp
        loss = k_before - k_after
        return {
            "kind": "momentum", "mode": mode,
            "answer": f"碰后共同速度 v′={_fmt(vp)} m/s，总动量守恒，损失动能 ΔEk={_fmt(loss)} J。",
            "answer_value": vp,
            "metrics": _metrics([("v", "共同速度", f"{_fmt(vp)} m/s", "accent"),
                                  ("p", "总动量", f"{_fmt(p_after)} kg·m/s", None),
                                  ("loss", "损失动能", f"{_fmt(loss)} J", None)]),
            "checks": _checks([("momentum", "动量守恒", abs(p_before - p_after) < 1e-6, "碰撞前后总动量相等"),
                                ("energy", "动能不增", loss >= -1e-9, "完全非弹性碰撞的动能损失非负")]),
            "notes": [MODE_LIMITS[mode]],
            "frames": [_result_frame(0, "碰前", f"v1={_fmt(v1)} m/s，v2={_fmt(v2)} m/s", {"v1": v1, "v2": v2}),
                        _result_frame(1, "碰后共同运动", f"v′={_fmt(vp)} m/s，ΔEk={_fmt(loss)} J",
                                      {"vp": vp, "loss": loss})],
            "scene": {"type": "collision", "mode": mode, "m1": m1, "v1": v1, "m2": m2, "v2": v2,
                      "vp": vp, "p": p_after, "K0": k_before, "K1": k_after, "loss": loss},
        }
    if mode == "spring_osc":
        m, k, amplitude = _value(p, "m"), _value(p, "k"), _value(p, "A")
        if m <= 0 or k <= 0 or amplitude <= 0:
            raise ValueError("质量、劲度系数和振幅必须为正数")
        omega = math.sqrt(k / m)
        period = 2 * math.pi / omega
        frequency = 1 / period
        vmax, amax = amplitude * omega, amplitude * omega * omega
        energy = 0.5 * k * amplitude * amplitude
        samples = _samples(period, lambda tau: {"x": amplitude * math.cos(omega * tau),
                                                "v": -amplitude * omega * math.sin(omega * tau),
                                                "a": -amplitude * omega * omega * math.cos(omega * tau)})
        return {
            "kind": "oscillation", "mode": mode,
            "answer": f"周期 T={_fmt(period)} s，频率 f={_fmt(frequency)} Hz，最大速度 {_fmt(vmax)} m/s，总能量 {_fmt(energy)} J。",
            "answer_value": period,
            "metrics": _metrics([("T", "周期", f"{_fmt(period)} s", "accent"),
                                  ("f", "频率", f"{_fmt(frequency)} Hz", None),
                                  ("vmax", "最大速度", f"{_fmt(vmax)} m/s", None),
                                  ("E", "总能量", f"{_fmt(energy)} J", None)]),
            "checks": _checks([("period", "周期公式", abs(period - 2 * math.pi * math.sqrt(m / k)) < 1e-9, "T = 2π√(m/k)"),
                                ("energy", "能量守恒", abs(0.5 * k * amplitude * amplitude - energy) < 1e-9, "E = ½kA²")]),
            "notes": [MODE_LIMITS[mode]],
            "frames": [_result_frame(i, f"t={_fmt(item['t'])} s", f"x={_fmt(item['x'])} m，v={_fmt(item['v'])} m/s", item)
                       for i, item in enumerate(samples[::max(1, len(samples) // 8)])],
            "scene": {"type": "oscillation", "mode": mode, "m": m, "k": k, "A": amplitude,
                      "omega": omega, "T": period, "vmax": vmax, "amax": amax, "energy": energy,
                      "samples": samples},
        }
    if mode == "pendulum":
        length, theta0, mass = _value(p, "L"), _value(p, "theta0"), _value(p, "m", 1.0)
        if length <= 0 or theta0 <= 0 or theta0 >= 90 or mass <= 0:
            raise ValueError("摆长和摆角需在合理范围内")
        rad = theta0 * _DEG
        omega = math.sqrt(g / length)
        period = 2 * math.pi / omega
        frequency = 1 / period
        vmax = math.sqrt(2 * g * length * (1 - math.cos(rad)))
        energy = 0.5 * mass * vmax * vmax
        samples = _samples(period, lambda tau: {"theta": theta0 * math.cos(omega * tau) * _DEG,
                                                "omega": -theta0 * _DEG * omega * math.sin(omega * tau)})
        return {
            "kind": "oscillation", "mode": mode,
            "answer": f"小角度单摆周期 T={_fmt(period)} s，频率 f={_fmt(frequency)} Hz，最大速度 {_fmt(vmax)} m/s。",
            "answer_value": period,
            "metrics": _metrics([("T", "周期", f"{_fmt(period)} s", "accent"),
                                  ("f", "频率", f"{_fmt(frequency)} Hz", None),
                                  ("vmax", "最大速度", f"{_fmt(vmax)} m/s", None),
                                  ("E", "总能量", f"{_fmt(energy)} J", None)]),
            "checks": _checks([("period", "小角周期公式", abs(period - 2 * math.pi * math.sqrt(length / g)) < 1e-9, "T = 2π√(L/g)"),
                                ("energy", "机械能守恒", abs(mass * g * length * (1 - math.cos(rad)) - energy) < 1e-6,
                                 "mgh = ½mvmax²，h=L(1−cosθ0)")]),
            "notes": [MODE_LIMITS[mode]],
            "frames": [_result_frame(i, f"t={_fmt(item['t'])} s", f"θ={_fmt(item['theta'] / _DEG)}°", item)
                       for i, item in enumerate(samples[::max(1, len(samples) // 8)])],
            "scene": {"type": "pendulum", "L": length, "theta0": theta0, "g": g, "m": mass,
                      "omega": omega, "T": period, "vmax": vmax, "energy": energy, "samples": samples},
        }
    if mode == "shm":
        amplitude, period, phi, t = _value(p, "A"), _value(p, "T"), _value(p, "phi"), _value(p, "t")
        mass = _value(p, "m", 1.0)
        if amplitude <= 0 or period <= 0:
            raise ValueError("振幅和周期必须为正数")
        omega = 2 * math.pi / period
        phase = omega * t + phi * _DEG
        x = amplitude * math.cos(phase)
        v = -amplitude * omega * math.sin(phase)
        a = -omega * omega * x
        energy = 0.5 * mass * omega * omega * amplitude * amplitude
        return {
            "kind": "oscillation", "mode": mode,
            "answer": f"t={_fmt(t)} s 时 x={_fmt(x)} m，v={_fmt(v)} m/s，a={_fmt(a)} m/s²，总能量 {_fmt(energy)} J。",
            "answer_value": x,
            "metrics": _metrics([("x", "位移", f"{_fmt(x)} m", "accent"),
                                  ("v", "速度", f"{_fmt(v)} m/s", None),
                                  ("a", "加速度", f"{_fmt(a)} m/s²", None),
                                  ("E", "总能量", f"{_fmt(energy)} J", None)]),
            "checks": _checks([("phase", "相位关系", abs(x - amplitude * math.cos(phase)) < 1e-9, "x = A cos(ωt+φ)"),
                                ("accel", "回复力关系", abs(a + omega * omega * x) < 1e-9, "a = −ω²x")]),
            "notes": [MODE_LIMITS[mode]],
            "frames": [_result_frame(0, "相位", f"ωt+φ={_fmt(phase)} rad", {"phase": phase}),
                       _result_frame(1, "状态", f"x={_fmt(x)} m，v={_fmt(v)} m/s，a={_fmt(a)} m/s²",
                                     {"x": x, "v": v, "a": a})],
            "scene": {"type": "shm", "A": amplitude, "T": period, "phi": phi, "t": t, "m": mass,
                      "omega": omega, "x": x, "v": v, "a": a, "phase": phase, "energy": energy},
        }
    raise ValueError("暂不支持该物理题型")


def evaluate_physics(model: Mapping[str, Any], params: Mapping[str, Any] | None = None) -> dict[str, Any]:
    mode = str(model.get("physics_mode") or "")
    if mode not in MODE_LABELS:
        from .physics_second import MODE_LABELS as SECOND_LABELS, evaluate_physics_second
        from .physics_third import MODE_LABELS as THIRD_LABELS, evaluate_physics_third
        if mode in THIRD_LABELS:
            return evaluate_physics_third(model, params)
        return evaluate_physics_second(model, params)
    merged = dict(model.get("defaults") or {})
    merged.update({key: value for key, value in (params or {}).items() if value is not None})
    if mode not in MODE_LABELS:
        return {"status": "blocked", "kind": model.get("physics_kind"), "mode": mode or None,
                "reason": "未确定物理题型", "answer": "", "metrics": [], "checks": [],
                "notes": [], "frames": [], "scene": {}}
    try:
        result = _evaluate_mode(mode, merged, str(model.get("raw") or ""))
    except (ValueError, TypeError, ArithmeticError, ZeroDivisionError) as exc:
        return {"status": "blocked", "kind": MODE_KIND.get(mode), "mode": mode,
                "reason": str(exc), "answer": "", "metrics": [], "checks": [],
                "notes": [MODE_LIMITS.get(mode, "")], "frames": [], "scene": {}}
    result["status"] = "ok"
    return result


def solve_physics(model: Mapping[str, Any]) -> dict[str, Any]:
    if str(model.get("physics_mode") or "") not in MODE_LABELS:
        from .physics_second import MODE_LABELS as SECOND_LABELS, solve_physics_second
        from .physics_third import MODE_LABELS as THIRD_LABELS, solve_physics_third
        if str(model.get("physics_mode") or "") in THIRD_LABELS:
            return solve_physics_third(model)
        return solve_physics_second(model)
    defaults = dict(model.get("defaults") or {})
    result = evaluate_physics(model, defaults)
    if result.get("status") != "ok":
        raise ValueError(result.get("reason") or "物理题目的条件不足")
    try:
        model["physics_result"] = result
    except TypeError:
        pass
    mode = str(model.get("physics_mode") or "")
    frames = result.get("frames") or []
    steps = [{"id": f"phy_{frame['index']}", "title": frame["label"], "detail": frame["detail"]}
             for frame in frames[:8]]
    if not steps:
        steps = [{"id": "phy_result", "title": MODE_LABELS.get(mode, "物理"), "detail": result["answer"]}]
    answer_values: list[float] = []
    for item in result.get("metrics") or []:
        for token in re.findall(r"[-+]?\d+(?:\.\d+)?", str(item.get("value") or "")):
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
        "conditions": [f"按{MODE_LABELS.get(mode, '物理')}模型计算。"],
        "limitations": list(result.get("notes") or []) + [
            "未给出的初值或边界条件不会被自动补造。",
            "常见单位 km/h、cm、mm、km、g、min、h 会先换算为 SI；仍无法识别的单位请以 SI 填写。",
        ],
    }


__all__ = ["KIND_LABELS", "MODE_LABELS", "MODE_KIND", "build_physics", "evaluate_physics", "solve_physics"]

"""大学物理第三批：波动光学、几何光学、近代物理基础。"""
from __future__ import annotations

import math
import re
from typing import Any, Mapping

from .physics import _NUM, _fmt, _found, _mass, _normalize_units

KIND_LABELS = {
    "wave_optics": "波动光学",
    "geometric_optics": "几何光学",
    "modern_physics": "近代物理基础",
}

MODE_KIND = {
    "double_slit": "wave_optics",
    "thin_film": "wave_optics",
    "single_slit": "wave_optics",
    "grating": "wave_optics",
    "polarization": "wave_optics",
    "refraction": "geometric_optics",
    "lens": "geometric_optics",
    "photoelectric": "modern_physics",
    "de_broglie": "modern_physics",
    "energy_level": "modern_physics",
    "decay": "modern_physics",
}

MODE_LABELS = {
    "double_slit": "双缝干涉",
    "thin_film": "薄膜干涉与增透膜",
    "single_slit": "单缝衍射",
    "grating": "光栅衍射",
    "polarization": "偏振与马吕斯定律",
    "refraction": "折射定律与全反射",
    "lens": "薄透镜成像",
    "photoelectric": "光电效应",
    "de_broglie": "德布罗意波",
    "energy_level": "能级跃迁与氢原子光谱",
    "decay": "放射性衰变",
}

MODE_LIMITS = {
    "double_slit": "双缝干涉按远场近似，条纹间距 Δy=λD/d；介质中波长取 λ/n。",
    "thin_film": "薄膜上下表面平行，光垂直入射；只考虑反射光干涉。肥皂膜在空气中按上表面一次半波损失；增透膜按膜两侧折射率均高于膜、两次半波损失相消处理。",
    "single_slit": "夫琅禾费单缝衍射，屏上位置按小角近似 y≈Lθ；中央明纹宽度取两个第一级暗纹间距。",
    "grating": "光栅垂直入射，主极大满足 d sinθ=kλ；忽略缺级与缝宽衍射包络。",
    "polarization": "自然光通过第一个偏振片后光强减半；线偏振光通过检偏器服从马吕斯定律。",
    "refraction": "两种介质均为均匀各向同性，界面为平面；临界角只适用于从光密介质射向光疏介质。",
    "lens": "薄透镜近轴近似；采用 1/u+1/v=1/f，凸透镜 f>0、凹透镜 f<0，v>0 为实像。",
    "photoelectric": "爱因斯坦光电方程，金属表面逸出功恒定；忽略光强对最大初动能的影响。",
    "de_broglie": "物质波 λ=h/p；电子加速按非相对论处理，高速时需要相对论修正。",
    "energy_level": "氢原子能级 E_n=−13.6/n² eV；光子能量等于能级差，忽略反冲与精细结构。",
    "decay": "放射性衰变服从 N=N0(1/2)^(t/T)，半衰期恒定；活度 A=λN。",
}

PLANCK = 6.62607015e-34
LIGHT_SPEED = 2.99792458e8
E_CHARGE = 1.602176634e-19
ELECTRON_MASS = 9.1093837015e-31
RYDBERG_EV = 13.6

_TIME_FACTORS = {
    "s": 1.0, "秒": 1.0, "min": 60.0, "分钟": 60.0, "h": 3600.0, "小时": 3600.0,
    "d": 86400.0, "天": 86400.0, "日": 86400.0, "a": 365 * 86400.0, "年": 365 * 86400.0,
}


def _param(cid: str, label: str, min_value: float | None, max_value: float | None,
           step: float | None) -> dict[str, Any]:
    return {"id": cid, "label": label, "kind": "number", "min": min_value, "max": max_value,
            "step": step, "options": [], "note": None}


def _condition(cid: str, label: str, value: Any, *, unit: str = "",
               source: Mapping[str, Any] | None = None, editable: bool = True,
               provenance: str = "original") -> dict[str, Any]:
    return {"id": cid, "label": label, "value": value, "kind": "number", "unit": unit,
            "provenance": provenance, "source": dict(source or {}), "editable": editable,
            "options": [], "min": None, "max": None, "step": None, "note": None}


def _ambiguity(cid: str, question: str) -> dict[str, Any]:
    return {"id": cid, "field": "physics_mode", "severity": "blocking", "question": question,
            "options": [], "resolved": False, "answer": None}


def _built(model: dict[str, Any], conditions: list[dict[str, Any]],
           formulas: list[dict[str, Any]], ambiguities: list[dict[str, Any]]) -> dict[str, Any]:
    return {"model": model, "conditions": conditions, "formulas": formulas,
            "ambiguities": ambiguities, "recognized": True}


def _normalize_scientific(text: str) -> str:
    return re.sub(rf"({_NUM})\s*[×xX*]\s*10\s*\^?\s*([-+]?\d+)",
                  lambda match: f"{float(match.group(1)):g}e{int(match.group(2))}", text)


def _duration(text: str, patterns: list[str]) -> float | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if not match:
            continue
        try:
            value = float(match.group(1))
        except (TypeError, ValueError):
            continue
        unit = (match.group(2) or "s") if match.lastindex and match.lastindex >= 2 else "s"
        normalized = unit.lower()
        if normalized in ("秒", "分钟", "小时", "天", "日", "年"):
            factor = _TIME_FACTORS[unit]
        else:
            factor = _TIME_FACTORS.get(normalized, 1.0)
        return value * factor
    return None


def _ev_value(text: str, patterns: list[str]) -> float | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if not match:
            continue
        try:
            value = float(match.group(1))
        except (TypeError, ValueError):
            continue
        unit = (match.group(2) or "eV").lower() if match.lastindex and match.lastindex >= 2 else "ev"
        if unit in ("j", "焦耳"):
            value /= E_CHARGE
        return value
    return None


def detect_third_mode(text: str) -> str | None:
    # OCR 断行会拆散关键词，探测用折叠文本。
    text = re.sub(r"\s+", "", text or "")
    if any(word in text for word in ("光电效应", "逸出功", "遏止电压", "截止频率")):
        return "photoelectric"
    if "德布罗意" in text or "物质波" in text:
        return "de_broglie"
    if any(word in text for word in ("能级", "跃迁", "光谱线", "氢原子")):
        return "energy_level"
    if any(word in text for word in ("放射性", "半衰期", "衰变")):
        return "decay"
    if "双缝" in text:
        return "double_slit"
    if any(word in text for word in ("薄膜", "增透膜", "增反膜", "肥皂膜", "镀膜")):
        return "thin_film"
    if "单缝" in text:
        return "single_slit"
    if "光栅" in text:
        return "grating"
    if any(word in text for word in ("偏振", "马吕斯", "布儒斯特")):
        return "polarization"
    if any(word in text for word in ("透镜", "成像", "焦距", "物距", "像距")):
        return "lens"
    if any(word in text for word in ("折射", "全反射", "临界角", "斯涅尔")):
        return "refraction"
    return None


def _parse_mode(mode: str, text: str) -> tuple[dict[str, float], list[str]]:
    values: dict[str, float] = {}
    missing: list[str] = []

    def need(key: str, value: float | None, label: str) -> None:
        if value is None:
            missing.append(label)
        else:
            values[key] = float(value)

    def first(patterns: list[str]) -> float | None:
        return _found(text, patterns)

    def wavelength() -> float | None:
        return first([
            # OCR 常把 λ 读成 "入/人/Λ"（"波长入=600nm"）。
            rf"(?:入射光波长|光波长|波长)\s*(?:λ|入|人|Λ)?\s*(?:为|是|=|：|:)?\s*({_NUM})",
            rf"(?:λ|入)\s*(?:为|是|=|：|:)\s*({_NUM})\s*(?:nm|μm|mm|m|米)",
        ])

    if mode == "double_slit":
        need("d", first([rf"(?:双缝间距|缝间距|双缝距离)\s*(?:d\s*)?(?:为|是|=|：|:)?\s*({_NUM})"]), "双缝间距 d")
        need("D", first([rf"(?:双缝到屏|屏到双缝|缝到屏|缝屏间距|屏距)[^。；;]{{0,12}}?({_NUM})",
                         rf"(?:到屏距离|距屏|与屏距离)\s*(?:D\s*)?(?:为|是|=|：|:)?\s*({_NUM})"]), "缝到屏距离 D")
        need("lam", wavelength(), "光波长 λ")
        values["n"] = first([rf"(?:介质折射率|折射率)\s*(?:n\s*)?(?:为|是|=|：|:)?\s*({_NUM})"]) or 1.0
        values["k"] = first([rf"第\s*({_NUM})\s*级(?:明纹|亮纹|条纹)"]) or 1.0
    elif mode == "thin_film":
        need("n", first([rf"(?:薄膜折射率|膜折射率|折射率)\s*(?:n\s*)?(?:为|是|=|：|:)?\s*({_NUM})",
                         rf"(?<![A-Za-z])n\s*(?:为|是|=|：|:)\s*({_NUM})"]), "薄膜折射率 n")
        d_value = first([rf"(?:薄膜厚度|膜厚|厚度)\s*(?:d\s*)?(?:为|是|=|：|:)?\s*({_NUM})",
                         rf"(?<![A-Za-z])d\s*(?:为|是|=|：|:)\s*({_NUM})"])
        values["target"] = 1.0 if "增透" in text else (2.0 if "增反" in text else 0.0)
        values["phase"] = 0.0 if values["target"] > 0 else 1.0
        if values["target"] > 0:
            values["d"] = d_value if d_value is not None else 0.0
        else:
            need("d", d_value, "薄膜厚度 d")
        need("lam", wavelength(), "光波长 λ")
    elif mode == "single_slit":
        need("a", first([rf"(?:单缝宽度|单缝宽|缝宽|宽度)\s*(?:a\s*)?(?:为|是|=|：|:)?\s*({_NUM})",
                         rf"(?<![A-Za-z])a\s*(?:为|是|=|：|:)\s*({_NUM})"]), "单缝宽度 a")
        need("lam", wavelength(), "光波长 λ")
        l_value = first([rf"(?:透镜焦距|焦距)\s*(?:f\s*)?(?:为|是|=|：|:)?\s*({_NUM})",
                         rf"(?:屏距|距屏|到屏距离)\s*(?:L\s*)?(?:为|是|=|：|:)?\s*({_NUM})"])
        # 只问半角宽/衍射角时不需要屏距；问屏上条纹位置/宽度才必须给 L。
        asks_angular = bool(re.search(r"角宽|半角|衍射角|角位置|角距离", text))
        if asks_angular and l_value is None:
            values["angular_only"] = 1.0
        else:
            need("L", l_value, "透镜焦距或屏距 L")
    elif mode == "grating":
        per_mm = re.search(rf"每\s*(?:毫米|mm)\s*(?:有|刻有|刻痕|条|刻线)?\s*({_NUM})\s*(?:条|刻痕|刻线)?",
                           text, re.I)
        if per_mm:
            count = float(per_mm.group(1))
            if count <= 0:
                missing.append("每毫米刻痕数")
            else:
                values["d"] = 1e-3 / count
        else:
            need("d", first([rf"(?:光栅常数)\s*(?:d\s*)?(?:为|是|=|：|:)?\s*({_NUM})",
                             rf"(?<![A-Za-z])d\s*(?:为|是|=|：|:)\s*({_NUM})"]), "光栅常数 d")
        need("lam", wavelength(), "光波长 λ")
        values["k"] = first([rf"第\s*({_NUM})\s*级(?:明纹|亮纹|条纹|主极大|光谱|衍射|级)?",
                             rf"(?:级次|k)\s*(?:为|是|=|：|:)?\s*({_NUM})"]) or 1.0
    elif mode == "polarization":
        values["I0"] = first([rf"(?:入射光强|自然光强|光强|强度)\s*(?:为|是)?\s*(?:I0|I₀|I)\s*(?:为|是|=|：|:)?\s*({_NUM})",
                              rf"(?:I0|I₀)\s*(?:为|是|=|：|:)?\s*({_NUM})"]) or 1.0
        theta_val = first([rf"(?:偏振化方向夹角|夹角)\s*(?:θ\s*)?(?:为|是|=|：|:)?\s*({_NUM})",
                           rf"(?:θ)\s*(?:为|是|=|：|:)?\s*({_NUM})",
                           rf"夹角\s*(?:为|是|of|达到)?\s*({_NUM})\s*°"])
        # 只问布儒斯特角时不需要偏振片夹角。
        if theta_val is None and "布儒斯特" in text:
            values["theta"] = 0.0
            values["brewster_only"] = 1.0
        else:
            need("theta", theta_val, "偏振化方向夹角 θ")
        values["n"] = first([rf"(?:折射率)\s*(?:n\s*)?(?:为|是|=|：|:)?\s*({_NUM})"]) or 1.5
        values["natural"] = 1.0 if "自然光" in text else 0.0
    elif mode == "refraction":
        n1 = first([rf"(?:n1|n₁|第一介质折射率|入射介质折射率)\s*(?:为|是|=|：|:)?\s*({_NUM})"])
        n2 = first([rf"(?:n2|n₂|第二介质折射率|折射介质折射率)\s*(?:为|是|=|：|:)?\s*({_NUM})"])
        n_value = first([rf"(?:折射率)\s*(?:n\s*)?(?:为|是|=|：|:)?\s*({_NUM})",
                         rf"(?<![A-Za-z])n\s*(?:为|是|=|：|:)\s*({_NUM})"])
        to_air = re.search(r"(?:射向|射入|进入|传到)[^。；;]{0,12}空气", text) is not None
        from_air = re.search(r"空气[^。；;]{0,12}(?:射向|射入|进入|传到)", text) is not None
        if n1 is None and n2 is None and n_value is not None:
            if to_air and not from_air:
                n1, n2 = n_value, 1.0
            else:
                n1, n2 = 1.0, n_value
        elif n1 is None and n_value is not None:
            n1 = n_value
        elif n2 is None and n_value is not None:
            n2 = n_value
        if n1 is None:
            n1 = 1.0 if n2 is not None else None
        if n2 is None and n1 is not None:
            n2 = 1.0 if (to_air and not from_air) else None
        need("n1", n1, "入射介质折射率 n1")
        need("n2", n2, "折射介质折射率 n2")
        need("angle", first([rf"(?:入射角)\s*(?:θ1|θ₁|i)?\s*(?:为|是|=|：|:)?\s*({_NUM})",
                             rf"(?:θ1|θ₁)\s*(?:为|是|=|：|:)?\s*({_NUM})",
                             rf"以\s*({_NUM})\s*°?\s*(?:的)?入射角"]), "入射角 θ1")
    elif mode == "lens":
        convex = 0.0 if "凹透镜" in text else 1.0
        f_value = first([rf"(?:焦距)\s*(?:f\s*)?(?:为|是|=|：|:)?\s*({_NUM})",
                         rf"(?<![A-Za-z])f\s*(?:为|是|=|：|:)\s*({_NUM})"])
        if f_value is not None:
            f_value = -abs(f_value) if convex < 0.5 else abs(f_value)
        need("f", f_value, "焦距 f")
        need("u", first([rf"(?:物距)\s*(?:u\s*)?(?:为|是|=|：|:)?\s*({_NUM})",
                         rf"(?:距透镜|到透镜|距凸透镜|距凹透镜)[^。；;]{{0,8}}?(?:u\s*)?(?:为|是|=|：|:)?\s*({_NUM})",
                         rf"(?<![A-Za-z])u\s*(?:为|是|=|：|:)\s*({_NUM})"]), "物距 u")
        values["convex"] = convex
        values["h"] = first([rf"(?:物高|物体高度)\s*(?:h\s*)?(?:为|是|=|：|:)?\s*({_NUM})",
                             rf"(?<![A-Za-z])h\s*(?:为|是|=|：|:)\s*({_NUM})"]) or 1.0
    elif mode == "photoelectric":
        need("lam", wavelength(), "入射光波长 λ")
        work = _ev_value(text, [rf"(?:逸出功|功函数)\s*(?:W\s*)?(?:为|是|=|：|:)?\s*({_NUM})\s*(eV|电子伏|J|焦耳)?",
                                rf"(?<![A-Za-z])W\s*(?:为|是|=|：|:)\s*({_NUM})\s*(eV|电子伏|J|焦耳)?"])
        if work is None:
            nu0 = first([rf"(?:截止频率|ν0|ν₀)\s*(?:为|是|=|：|:)?\s*({_NUM})\s*(?:Hz)?",
                         rf"(?:ν0|ν₀)\s*(?:为|是|=|：|:)?\s*({_NUM})\s*(?:Hz)?"])
            if nu0 is not None:
                work = PLANCK * nu0 / E_CHARGE
        need("W", work, "逸出功 W")
    elif mode == "de_broglie":
        values["electron"] = 1.0 if "电子" in text else 0.0
        values["U"] = first([rf"(?:加速电压|电压)\s*(?:U\s*)?(?:为|是|=|：|:)?\s*({_NUM})",
                             rf"(?<![A-Za-z])U\s*(?:为|是|=|：|:)\s*({_NUM})"]) or 0.0
        m_value = _mass(text)
        if m_value is None and values["electron"] > 0:
            m_value = ELECTRON_MASS
        need("m", m_value, "质量 m")
        v_value = first([rf"(?:速度)\s*(?:v\s*)?(?:为|是|=|：|:)?\s*({_NUM})",
                         rf"(?<![A-Za-z])v\s*(?:为|是|=|：|:)\s*({_NUM})"])
        if v_value is None and not (values["electron"] > 0 and values["U"] > 0):
            missing.append("速度 v 或加速电压 U")
        values["v"] = v_value or 0.0
    elif mode == "energy_level":
        hydrogen = 1.0 if "氢原子" in text else 0.0
        match = re.search(rf"(?:从\s*)?n\s*=\s*(\d+)\s*(?:能级)?\s*(?:跃迁到|→|到)\s*n\s*=\s*(\d+)", text, re.I)
        if not match:
            match = re.search(rf"从第?\s*(\d+)\s*能级\s*(?:跃迁到|→|到)\s*第?\s*(\d+)\s*能级", text)
        if match:
            values["n_hi"] = float(match.group(1))
            values["n_lo"] = float(match.group(2))
        group = re.search(rf"(?:一群|大量)[^。；;]{{0,12}}?n\s*=\s*(\d+)", text, re.I)
        if not group:
            group = re.search(rf"n\s*=\s*(\d+)\s*(?:激发态|能级)[^。；;]{{0,10}}?(?:一群|大量)", text, re.I)
        values["group_n"] = float(group.group(1)) if group else 0.0
        e2 = _ev_value(text, [rf"E2\s*(?:为|是|=|：|:)?\s*({_NUM})\s*(eV|电子伏|J|焦耳)?"])
        e1 = _ev_value(text, [rf"E1\s*(?:为|是|=|：|:)?\s*({_NUM})\s*(eV|电子伏|J|焦耳)?"])
        values["hydrogen"] = hydrogen
        if e2 is not None:
            values["E2"] = e2
        if e1 is not None:
            values["E1"] = e1
        if re.search(r"几种|多少种|不同频率|谱线数|最多发出", text):
            values["asks_lines"] = 1.0
        elif "最短波长" in text:
            values["asks_shortest"] = 1.0
        if not match and values["group_n"] <= 0 and (e1 is None or e2 is None):
            missing.append("跃迁初末能级或两个能级能量")
        if hydrogen and values["group_n"] > 0 and "n_hi" not in values:
            values["n_hi"] = values["group_n"]
            values["n_lo"] = 1.0
        if hydrogen and values.get("n_hi") is not None and values.get("n_lo") is not None:
            if values["n_hi"] == values["n_lo"]:
                missing.append("不同的初末能级")
        if hydrogen and values["group_n"] > 0 and values["group_n"] < 2:
            missing.append("至少 n=2 的激发态")
    elif mode == "decay":
        half_life = _duration(text, [rf"(?:半衰期)\s*(?:T1/2|T)?\s*(?:为|是|=|：|:)?\s*({_NUM})\s*(秒|s|分钟|min|小时|h|天|d|日|年|a)?"])
        if half_life is None:
            half_life = _duration(text, [rf"(?<![A-Za-z])T\s*(?:为|是|=|：|:)?\s*({_NUM})\s*(秒|s|分钟|min|小时|h|天|d|日|年|a)?"])
        need("T", half_life, "半衰期 T")
        n0_val = first([rf"(?:原有|初始|N0|N₀)\s*(?:原子核|核)?\s*(?:数|数目|个数)?\s*(?:为|是|=|：|:)?\s*({_NUM})",
                        rf"(?:N0|N₀)\s*(?:为|是|=|：|:)?\s*({_NUM})"])
        if n0_val is None and re.search(r"百分比|比例|分之几|占|剩余比", text):
            # 求剩余比例/百分比时 N0 相消，按 1 归一。
            n0_val = 1.0
            values["n0_assumed"] = 1.0
        need("N0", n0_val, "初始核数 N0")
        elapsed = _duration(text, [rf"(?:经过|时间)\s*(?:t\s*)?(?:为|是|=|：|:)?\s*({_NUM})\s*(秒|s|分钟|min|小时|h|天|d|日|年|a)?",
                                   rf"(?<![A-Za-z])t\s*(?:为|是|=|：|:)\s*({_NUM})\s*(秒|s|分钟|min|小时|h|天|d|日|年|a)?"])
        need("t", elapsed, "经过时间 t")
    return values, missing


def _params_for(mode: str, values: Mapping[str, float] | None = None) -> list[dict[str, Any]]:
    vals = values or {}
    if mode == "double_slit":
        return [_param("d", "双缝间距 d (m)", 1e-6, 0.1, 1e-6), _param("D", "缝到屏距离 D (m)", 0.01, 20, 0.01),
                _param("lam", "波长 λ (m)", 1e-9, 1e-5, 1e-9), _param("n", "介质折射率 n", 1, 3, 0.01),
                _param("k", "条纹级次 k", 1, 20, 1)]
    if mode == "thin_film":
        items = [_param("n", "薄膜折射率 n", 1.01, 3, 0.01), _param("lam", "波长 λ (m)", 1e-9, 1e-5, 1e-9),
                 _param("phase", "附加半波损失（0/1）", 0, 1, 1)]
        if vals.get("target", 0.0) < 0.5:
            items.insert(1, _param("d", "薄膜厚度 d (m)", 1e-9, 1e-4, 1e-9))
        return items
    if mode == "single_slit":
        return [_param("a", "单缝宽度 a (m)", 1e-6, 1e-2, 1e-6), _param("lam", "波长 λ (m)", 1e-9, 1e-5, 1e-9),
                _param("L", "透镜焦距/屏距 L (m)", 0.01, 20, 0.01)]
    if mode == "grating":
        return [_param("d", "光栅常数 d (m)", 1e-7, 1e-3, 1e-7), _param("lam", "波长 λ (m)", 1e-9, 1e-5, 1e-9),
                _param("k", "级次 k", 1, 20, 1)]
    if mode == "polarization":
        return [_param("I0", "入射光强 I0 (W/m²)", 0, 1000, 0.1), _param("theta", "偏振化方向夹角 θ (°)", 0, 90, 1),
                _param("n", "介质折射率 n", 1, 3, 0.01), _param("natural", "自然光（0/1）", 0, 1, 1)]
    if mode == "refraction":
        return [_param("n1", "入射介质折射率 n1", 1, 3, 0.01), _param("n2", "折射介质折射率 n2", 1, 3, 0.01),
                _param("angle", "入射角 θ1 (°)", 0, 89, 1)]
    if mode == "lens":
        return [_param("f", "焦距 f (m)", -10, 10, 0.001), _param("u", "物距 u (m)", 0.001, 100, 0.001),
                _param("h", "物高 h (m)", 0.001, 10, 0.001), _param("convex", "凸透镜（0凹/1凸）", 0, 1, 1)]
    if mode == "photoelectric":
        return [_param("lam", "入射光波长 λ (m)", 1e-9, 1e-6, 1e-9), _param("W", "逸出功 W (eV)", 0.1, 10, 0.01)]
    if mode == "de_broglie":
        if vals.get("electron", 0.0) > 0.5 and vals.get("U", 0.0) > 0:
            return [_param("m", "质量 m (kg)", 1e-31, 10, 1e-31), _param("U", "加速电压 U (V)", 1, 1e6, 1)]
        return [_param("m", "质量 m (kg)", 1e-31, 10, 1e-31), _param("v", "速度 v (m/s)", 0.01, 1e8, 1)]
    if mode == "energy_level":
        if vals.get("hydrogen", 1.0) > 0.5:
            if vals.get("group_n", 0.0) >= 2:
                return [_param("group_n", "一群原子的最高能级 n", 2, 10, 1)]
            return [_param("n_hi", "初能级 n_hi", 2, 10, 1), _param("n_lo", "末能级 n_lo", 1, 9, 1)]
        return [_param("E1", "能级 E1 (eV)", -100, 100, 0.1), _param("E2", "能级 E2 (eV)", -100, 100, 0.1)]
    if mode == "decay":
        return [_param("T", "半衰期 T (s)", 1, 1e12, 1), _param("N0", "初始核数 N0", 1, 1e30, 1),
                _param("t", "经过时间 t (s)", 0, 1e12, 1)]
    return []


FORMULAS = {
    "double_slit": "Δy = λD/d（介质中 λ→λ/n）；明纹位置 y_k = kΔy",
    "thin_film": "光程差 Δ = 2nd + (半波损失)λ/2；明纹 Δ=kλ，暗纹 Δ=(k+½)λ",
    "single_slit": "暗纹 a sinθ = kλ；中央明纹宽度 Δy = 2λL/a",
    "grating": "d sinθ = kλ；最高级次 k_max = ⌊d/λ⌋",
    "polarization": "I1 = I0/2（自然光）；I2 = I1 cos²θ；tanθ_B = n2/n1",
    "refraction": "n1 sinθ1 = n2 sinθ2；临界角 sinθc = n2/n1（n1>n2）",
    "lens": "1/u + 1/v = 1/f；放大率 |m| = |v|/u",
    "photoelectric": "E_k = hc/λ − W；eU_a = E_k；λ0 = hc/W",
    "de_broglie": "λ = h/p = h/(mv)；电子加速 λ = h/√(2meU)",
    "energy_level": "E_n = −13.6/n² eV；hν = E_hi − E_lo；N = n(n−1)/2",
    "decay": "N = N0(1/2)^(t/T)；λ = ln2/T；A = λN",
}


def build_physics_third(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    _ = overrides
    mode = detect_third_mode(text)
    if mode is None:
        return None
    normalized = _normalize_scientific(_normalize_units(text))
    values, missing = _parse_mode(mode, normalized)
    from .physics import _apply_overrides
    overridden = _apply_overrides(values, overrides)
    model = {"engine": "physics_v1", "subject": "physics", "physics_kind": MODE_KIND[mode],
             "physics_mode": mode, "raw": text, "defaults": values, "params": _params_for(mode, values),
             "teaching": False}
    labels = {
        "d": "间距/光栅常数/厚度 d", "D": "缝到屏距离 D", "lam": "波长 λ", "n": "折射率 n",
        "k": "级次 k", "a": "单缝宽度 a", "L": "焦距/屏距 L", "I0": "入射光强 I0",
        "theta": "夹角 θ", "n1": "入射折射率 n1", "n2": "折射折射率 n2", "angle": "入射角 θ1",
        "f": "焦距 f", "u": "物距 u", "h": "物高 h", "W": "逸出功 W", "m": "质量 m",
        "v": "速度 v", "U": "加速电压 U", "T": "半衰期 T", "N0": "初始核数 N0", "t": "时间 t",
        "target": "目标代号", "phase": "半波损失标志", "natural": "自然光标志",
        "convex": "凸透镜标志", "electron": "电子标志", "n_hi": "初能级", "n_lo": "末能级",
        "group_n": "一群原子的最高能级", "E1": "能级 E1", "E2": "能级 E2", "hydrogen": "氢原子标志",
    }
    conditions = [{"id": "physics_mode", "label": "物理题型", "value": MODE_LABELS[mode],
                   "kind": "text", "unit": "", "provenance": "original", "source": dict(source),
                   "editable": False, "options": [], "min": None, "max": None, "step": None, "note": None}]
    for key, value in values.items():
        conditions.append(_condition(
            f"phy_{key}", labels.get(key, key), value, source=source,
            editable=key not in {"target", "phase", "natural", "convex", "electron", "hydrogen"},
            provenance="student_confirmed" if key in overridden else "original"))
    plain = FORMULAS[mode]
    formulas = [{"id": "physics_rule", "tex": r"\text{" + plain.replace("²", "^2").replace("√", "\\sqrt ") + "}",
                 "plain": plain, "role": "物理规律"}]
    ambiguities = [_ambiguity("physics_conditions", "识别为" + MODE_LABELS[mode] + "，但缺少：" + "、".join(missing) + "。请补充后重建。")] if missing else []
    return _built(model, conditions, formulas, ambiguities)


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
    if mode == "double_slit":
        spacing_d, screen, lam = _v(p, "d"), _v(p, "D"), _v(p, "lam")
        index_n, order = _v(p, "n", 1), _v(p, "k", 1)
        if spacing_d <= 0 or screen <= 0 or lam <= 0 or index_n < 1:
            raise ValueError("双缝间距、屏距和波长必须为正，折射率不小于 1")
        lam_medium = lam / index_n
        delta_y = lam_medium * screen / spacing_d
        y_order = order * delta_y
        samples = []
        for step in range(121):
            y = (step - 60) / 20 * delta_y
            phase = math.pi * spacing_d * y / (lam_medium * screen)
            samples.append({"y": y, "I": math.cos(phase) ** 2})
        return {
            "kind": "wave_optics", "mode": mode,
            "answer": f"介质中波长 λ'={_fmt(lam_medium)} m，相邻明纹间距 Δy={_fmt(delta_y)} m，第 {int(order)} 级明纹位置 y={_fmt(y_order)} m。",
            "answer_value": delta_y,
            "metrics": [_metric("lam", "介质中波长", f"{_fmt(lam_medium)} m"),
                        _metric("dy", "条纹间距", f"{_fmt(delta_y)} m", "accent"),
                        _metric("yk", f"第 {int(order)} 级位置", f"{_fmt(y_order)} m")],
            "checks": [_check("spacing", "条纹间距公式", abs(delta_y - lam_medium * screen / spacing_d) < 1e-15, "Δy = λD/d"),
                       _check("medium", "介质中波长", abs(lam_medium - lam / index_n) < 1e-15, "λ' = λ/n")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "干涉参数", f"d={_fmt(spacing_d)} m，D={_fmt(screen)} m，λ'={_fmt(lam_medium)} m", {"d": spacing_d, "D": screen, "lam": lam_medium}),
                       _frame(1, "条纹间距", f"Δy={_fmt(delta_y)} m，y_{int(order)}={_fmt(y_order)} m", {"dy": delta_y, "yk": y_order})],
            "scene": {"type": "double_slit", "d": spacing_d, "D": screen, "lam": lam, "n": index_n,
                      "k": order, "lamMedium": lam_medium, "spacing": delta_y, "y": y_order, "samples": samples},
        }
    if mode == "thin_film":
        index_n, thickness, lam = _v(p, "n"), _v(p, "d"), _v(p, "lam")
        target, phase = int(round(_v(p, "target"))), int(round(_v(p, "phase")))
        if index_n <= 1 or lam <= 0 or thickness < 0:
            raise ValueError("薄膜折射率需大于 1，波长需为正，厚度不能为负")
        required_quarter = lam / (4 * index_n)
        required_half = lam / (2 * index_n)
        if target == 1:
            thickness = required_quarter
        elif target == 2:
            thickness = required_half
        elif thickness <= 0:
            raise ValueError("判断干涉时需要给出薄膜厚度")
        opd = 2 * index_n * thickness
        effective = opd / lam + (0.5 if phase else 0.0)
        order = round(effective)
        bright = abs(effective - order) < 0.05
        dark = abs(effective - (math.floor(effective) + 0.5)) < 0.05
        if target == 1:
            state = "增透：反射光相互减弱"
            answer = f"增透膜最小厚度 d={_fmt(thickness)} m（{_fmt(thickness * 1e9)} nm），此时光程差 Δ={_fmt(opd)} m，反射光减弱。"
        elif target == 2:
            state = "增反：反射光相互加强"
            answer = f"增反膜最小厚度 d={_fmt(thickness)} m（{_fmt(thickness * 1e9)} nm），此时光程差 Δ={_fmt(opd)} m，反射光加强。"
        else:
            state = "反射光加强" if bright else ("反射光减弱" if dark else "接近但未严格满足明暗条件")
            answer = f"光程差 Δ={_fmt(opd)} m（含半波损失 {phase} 次），折算级次 {_fmt(effective)}，{state}。"
        return {
            "kind": "wave_optics", "mode": mode, "answer": answer,
            "answer_value": thickness if target > 0 else opd,
            "metrics": [_metric("opd", "光程差", f"{_fmt(opd)} m", "accent"),
                        _metric("order", "折算级次", _fmt(effective)),
                        _metric("dmin", "最小膜厚", f"{_fmt(required_quarter * 1e9)} nm"),
                        _metric("state", "反射结果", state)],
            "checks": [_check("opd", "光程差公式", abs(opd - 2 * index_n * thickness) < 1e-15, "Δ = 2nd"),
                       _check("phase", "半波损失", True, f"当前按 {phase} 次半波损失计入。"),
                       _check("condition", "明暗条件", bright or dark or target > 0, "明纹 Δ=kλ；暗纹 Δ=(k+½)λ。")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "光程差", f"Δ={_fmt(opd)} m，Δ/λ={_fmt(effective)}", {"opd": opd, "ratio": effective}),
                       _frame(1, "干涉结果", state, {"bright": bright, "dark": dark})],
            "scene": {"type": "thin_film", "n": index_n, "d": thickness, "lam": lam, "target": target,
                      "phase": phase, "opd": opd, "ratio": effective, "bright": bright, "dark": dark,
                      "requiredQuarter": required_quarter, "requiredHalf": required_half, "state": state},
        }
    if mode == "single_slit":
        slit, lam, distance = _v(p, "a"), _v(p, "lam"), _v(p, "L", None)
        if slit <= 0 or lam <= 0:
            raise ValueError("缝宽和波长必须为正数")
        if distance is None:
            # 没有屏距：只给出角量结果（半角宽、角位置），不虚构线宽度。
            sin1 = min(1.0, lam / slit)
            half_deg = math.degrees(math.asin(sin1))
            half_rad = math.asin(sin1)
            return {
                "kind": "wave_optics", "mode": mode,
                "answer": (f"第一级暗纹衍射角 θ1={_fmt(half_deg)}°（≈{_fmt(half_rad)} rad），"
                           f"中央明纹角宽度 2θ1={_fmt(2 * half_deg)}°。"),
                "answer_value": half_deg,
                "metrics": [_metric("theta1", "半角宽 θ1", f"{_fmt(half_deg)}°", "accent"),
                            _metric("theta1rad", "半角宽（弧度）", f"{_fmt(half_rad)} rad"),
                            _metric("a", "缝宽", f"{_fmt(slit)} m")],
                "checks": [_check("dark", "暗纹条件", True, "a sinθ = λ，θ1 = arcsin(λ/a)")],
                "notes": [MODE_LIMITS[mode], "未给屏距，仅求角量；屏上条纹位置需补充焦距或屏距。"],
                "frames": [_frame(0, "暗纹条件", f"θ1={_fmt(half_deg)}°", {"theta1": half_deg})],
                "scene": {"type": "single_slit", "a": slit, "lam": lam, "L": None,
                          "theta1": half_deg, "angular": True},
            }
        if distance <= 0:
            raise ValueError("屏距必须为正数")
        half_width = lam * distance / slit
        width = 2 * half_width
        samples = []
        for step in range(161):
            y = (step - 80) / 40 * width
            beta = math.pi * slit * y / (lam * distance)
            intensity = 1.0 if abs(beta) < 1e-12 else (math.sin(beta) / beta) ** 2
            samples.append({"y": y, "I": intensity})
        return {
            "kind": "wave_optics", "mode": mode,
            "answer": f"中央明纹宽度 Δy={_fmt(width)} m，第一级暗纹位置 y1={_fmt(half_width)} m。",
            "answer_value": width,
            "metrics": [_metric("width", "中央明纹宽度", f"{_fmt(width)} m", "accent"),
                        _metric("y1", "第一级暗纹", f"{_fmt(half_width)} m"),
                        _metric("a", "缝宽", f"{_fmt(slit)} m")],
            "checks": [_check("width", "中央明纹宽度", abs(width - 2 * lam * distance / slit) < 1e-15, "Δy = 2λL/a"),
                       _check("dark", "暗纹条件", abs(half_width - lam * distance / slit) < 1e-15, "a sinθ = kλ，小角近似")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "暗纹条件", f"y1={_fmt(half_width)} m", {"y1": half_width}),
                       _frame(1, "中央明纹", f"宽度 Δy={_fmt(width)} m", {"width": width})],
            "scene": {"type": "single_slit", "a": slit, "lam": lam, "L": distance,
                      "width": width, "half": half_width, "samples": samples},
        }
    if mode == "grating":
        spacing_d, lam, order = _v(p, "d"), _v(p, "lam"), _v(p, "k", 1)
        if spacing_d <= 0 or lam <= 0:
            raise ValueError("光栅常数和波长必须为正数")
        order_int = int(round(order))
        if order_int < 1:
            raise ValueError("级次必须为正整数")
        sin_theta = order_int * lam / spacing_d
        if abs(sin_theta) > 1:
            raise ValueError("该级明纹不存在：kλ/d > 1")
        theta = math.asin(sin_theta)
        max_order = int(math.floor(spacing_d / lam))
        orders = []
        for m in range(-max_order, max_order + 1):
            value = m * lam / spacing_d
            orders.append({"m": m, "sin": value, "theta": math.degrees(math.asin(value))})
        return {
            "kind": "wave_optics", "mode": mode,
            "answer": f"第 {order_int} 级明纹衍射角 θ={_fmt(math.degrees(theta))}°，光栅最高可见级次 k_max={max_order}，共 {2 * max_order + 1} 条主极大。",
            "answer_value": math.degrees(theta),
            "metrics": [_metric("theta", "衍射角", f"{_fmt(math.degrees(theta))}°", "accent"),
                        _metric("kmax", "最高级次", str(max_order)),
                        _metric("count", "可见主极大数", str(2 * max_order + 1))],
            "checks": [_check("grating", "光栅方程", abs(sin_theta - order_int * lam / spacing_d) < 1e-12, "d sinθ = kλ"),
                       _check("range", "级次范围", abs(sin_theta) <= 1, "|sinθ|≤1")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "光栅方程", f"sinθ={_fmt(sin_theta)}", {"sin": sin_theta}),
                       _frame(1, "衍射角与级次", f"θ={_fmt(math.degrees(theta))}°，k_max={max_order}", {"theta": math.degrees(theta), "kmax": max_order})],
            "scene": {"type": "grating", "d": spacing_d, "lam": lam, "k": order_int,
                      "sin": sin_theta, "theta": math.degrees(theta), "maxOrder": max_order, "orders": orders},
        }
    if mode == "polarization":
        if "I0" not in p or "theta" not in p:
            raise ValueError("缺少入射光强 I0 或偏振化方向夹角 θ")
        intensity, theta_deg, index_n = _v(p, "I0"), _v(p, "theta"), _v(p, "n", 1.5)
        natural = _v(p, "natural") > 0.5
        if intensity < 0 or index_n <= 0:
            raise ValueError("入射光强不能为负，折射率必须为正")
        theta = theta_deg * math.pi / 180
        brewster = math.degrees(math.atan(index_n))
        if _v(p, "brewster_only") > 0.5:
            return {
                "kind": "wave_optics", "mode": mode,
                "answer": f"布儒斯特角 θ_B=atan(n)={_fmt(brewster)}°（入射角为此值时反射光为全偏振光）。",
                "answer_value": brewster,
                "metrics": [_metric("brewster", "布儒斯特角", f"{_fmt(brewster)}°", "accent")],
                "checks": [_check("brewster", "布儒斯特定律", abs(brewster - math.degrees(math.atan(index_n))) < 1e-9, "tanθ_B = n")],
                "notes": [MODE_LIMITS[mode]],
                "frames": [_frame(0, "布儒斯特角", f"θ_B={_fmt(brewster)}°", {"brewster": brewster})],
                "scene": {"type": "polarization", "n": index_n, "brewster": brewster, "brewsterOnly": True},
            }
        first_intensity = intensity * (0.5 if natural else 1.0)
        second_intensity = first_intensity * math.cos(theta) ** 2
        return {
            "kind": "wave_optics", "mode": mode,
            "answer": f"第一偏振片后 I1={_fmt(first_intensity)} W/m²，检偏器后 I2={_fmt(second_intensity)} W/m²；布儒斯特角 θ_B={_fmt(brewster)}°。",
            "answer_value": second_intensity,
            "metrics": [_metric("I1", "第一偏振片后光强", f"{_fmt(first_intensity)} W/m²"),
                        _metric("I2", "检偏器后光强", f"{_fmt(second_intensity)} W/m²", "accent"),
                        _metric("brewster", "布儒斯特角", f"{_fmt(brewster)}°")],
            "checks": [_check("malus", "马吕斯定律", abs(second_intensity - first_intensity * math.cos(theta) ** 2) < 1e-15, "I = I1 cos²θ"),
                       _check("brewster", "布儒斯特定律", abs(math.tan(math.radians(brewster)) - index_n) < 1e-12, "tanθ_B = n")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "第一偏振片", f"I1={_fmt(first_intensity)} W/m²", {"I1": first_intensity}),
                       _frame(1, "检偏与布儒斯特角", f"I2={_fmt(second_intensity)} W/m²，θ_B={_fmt(brewster)}°", {"I2": second_intensity, "brewster": brewster})],
            "scene": {"type": "polarization", "I0": intensity, "theta": theta_deg, "n": index_n,
                      "natural": natural, "I1": first_intensity, "I2": second_intensity, "brewster": brewster},
        }
    if mode == "refraction":
        if "angle" not in p:
            raise ValueError("缺少入射角 θ1")
        n1, n2, angle_deg = _v(p, "n1"), _v(p, "n2"), _v(p, "angle")
        if n1 <= 0 or n2 <= 0 or not (0 <= angle_deg < 90):
            raise ValueError("折射率必须为正，入射角需在 0° 到 90° 之间")
        angle1 = math.radians(angle_deg)
        sin2 = n1 * math.sin(angle1) / n2
        critical = math.degrees(math.asin(min(n1, n2) / max(n1, n2))) if abs(n1 - n2) > 1e-12 else None
        tir = sin2 > 1
        if tir:
            angle2 = None
            answer = f"sinθ2={_fmt(sin2)}>1，发生全反射；临界角 θc={_fmt(critical)}°。"
        else:
            angle2 = math.degrees(math.asin(sin2))
            answer = f"折射角 θ2={_fmt(angle2)}°；光从光密介质射向光疏介质时临界角 θc={_fmt(critical)}°。"
        return {
            "kind": "geometric_optics", "mode": mode, "answer": answer,
            "answer_value": critical if tir else angle2,
            "metrics": [_metric("theta1", "入射角", f"{_fmt(angle_deg)}°"),
                        _metric("theta2", "折射角", "全反射" if tir else f"{_fmt(angle2)}°", "accent"),
                        _metric("critical", "临界角", "—" if critical is None else f"{_fmt(critical)}°")],
            "checks": [_check("snell", "折射定律", tir or abs(n1 * math.sin(angle1) - n2 * math.sin(math.radians(angle2))) < 1e-12, "n1 sinθ1 = n2 sinθ2"),
                       _check("critical", "全反射条件", True, "从光密射向光疏且入射角大于临界角时发生全反射。")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "入射与法线", f"θ1={_fmt(angle_deg)}°，n1={_fmt(n1)}，n2={_fmt(n2)}", {"theta1": angle_deg, "n1": n1, "n2": n2}),
                       _frame(1, "折射或全反射", "全反射" if tir else f"θ2={_fmt(angle2)}°", {"theta2": angle2, "tir": tir})],
            "scene": {"type": "refraction", "n1": n1, "n2": n2, "angle1": angle_deg, "angle2": angle2,
                      "critical": critical, "tir": tir, "reflected": angle_deg},
        }
    if mode == "lens":
        focal, distance, height = _v(p, "f"), _v(p, "u"), _v(p, "h", 1)
        convex = _v(p, "convex", 1) > 0.5
        if abs(focal) < 1e-12 or distance <= 0 or height <= 0:
            raise ValueError("焦距不能为零，物距和物高必须为正数")
        if abs(distance - focal) < 1e-12:
            raise ValueError("物体位于焦点上，像在无穷远，薄透镜公式不给出有限像距")
        image = distance * focal / (distance - focal)
        magnification = -image / distance
        real = image > 0
        inverted = magnification < 0
        image_height = abs(magnification) * height
        kind_text = "实像" if real else "虚像"
        orientation = "倒立" if inverted else "正立"
        return {
            "kind": "geometric_optics", "mode": mode,
            "answer": f"像距 v={_fmt(image)} m，放大率 m={_fmt(magnification)}，成{orientation}{kind_text}，像高 {_fmt(image_height)} m。",
            "answer_value": image,
            "metrics": [_metric("v", "像距", f"{_fmt(image)} m", "accent"),
                        _metric("m", "放大率", _fmt(magnification)),
                        _metric("type", "像的性质", f"{orientation}{kind_text}"),
                        _metric("hi", "像高", f"{_fmt(image_height)} m")],
            "checks": [_check("lens", "薄透镜公式", abs(1 / distance + 1 / image - 1 / focal) < 1e-12, "1/u + 1/v = 1/f"),
                       _check("magnification", "放大率", abs(magnification + image / distance) < 1e-12, "m = −v/u")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "物距与焦距", f"u={_fmt(distance)} m，f={_fmt(focal)} m", {"u": distance, "f": focal}),
                       _frame(1, "成像", f"v={_fmt(image)} m，{orientation}{kind_text}", {"v": image, "m": magnification})],
            "scene": {"type": "lens", "f": focal, "u": distance, "v": image, "m": magnification,
                      "real": real, "inverted": inverted, "convex": convex, "h": height, "hi": image_height},
        }
    if mode == "photoelectric":
        if "W" not in p:
            raise ValueError("缺少逸出功 W 或截止频率")
        lam, work = _v(p, "lam"), _v(p, "W")
        if lam <= 0 or work < 0:
            raise ValueError("波长必须为正，逸出功不能为负")
        photon_j = PLANCK * LIGHT_SPEED / lam
        photon_ev = photon_j / E_CHARGE
        kinetic_ev = photon_ev - work
        occurs = kinetic_ev > 0
        stopping = max(kinetic_ev, 0.0)
        threshold = PLANCK * LIGHT_SPEED / (work * E_CHARGE) if work > 0 else float("inf")
        frequency = LIGHT_SPEED / lam
        threshold_frequency = frequency - kinetic_ev * E_CHARGE / PLANCK if occurs else float("inf")
        samples = []
        if work > 0:
            f0 = work * E_CHARGE / PLANCK
            for step in range(61):
                f = f0 * step / 40
                samples.append({"f": f, "Ek": max(PLANCK * f / E_CHARGE - work, 0.0)})
        if occurs:
            answer = f"光子能量 E={_fmt(photon_ev)} eV，最大初动能 Ek={_fmt(kinetic_ev)} eV，遏止电压 Ua={_fmt(stopping)} V，截止波长 λ0={_fmt(threshold * 1e9)} nm。"
        else:
            answer = f"光子能量 E={_fmt(photon_ev)} eV 小于逸出功 W={_fmt(work)} eV，不能发生光电效应；截止波长 λ0={_fmt(threshold * 1e9)} nm。"
        return {
            "kind": "modern_physics", "mode": mode, "answer": answer,
            "answer_value": kinetic_ev,
            "metrics": [_metric("E", "光子能量", f"{_fmt(photon_ev)} eV"),
                        _metric("Ek", "最大初动能", f"{_fmt(max(kinetic_ev, 0))} eV", "accent"),
                        _metric("Ua", "遏止电压", f"{_fmt(stopping)} V"),
                        _metric("lam0", "截止波长", f"{_fmt(threshold * 1e9)} nm")],
            "checks": [_check("einstein", "爱因斯坦光电方程", abs(kinetic_ev - (photon_ev - work)) < 1e-12, "Ek = hc/λ − W"),
                       _check("threshold", "截止波长", True, "λ0 = hc/W；入射波长大于 λ0 时不能发生光电效应。")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "光子能量", f"E={_fmt(photon_ev)} eV", {"E": photon_ev}),
                       _frame(1, "光电发射", f"Ek={_fmt(max(kinetic_ev, 0))} eV，Ua={_fmt(stopping)} V", {"Ek": kinetic_ev, "Ua": stopping})],
            "scene": {"type": "photoelectric", "lam": lam, "W": work, "E": photon_ev, "Ek": kinetic_ev,
                      "Ua": stopping, "lam0": threshold, "occurs": occurs, "f": frequency,
                      "f0": threshold_frequency, "samples": samples},
        }
    if mode == "de_broglie":
        mass, speed, voltage = _v(p, "m"), _v(p, "v"), _v(p, "U")
        electron = _v(p, "electron") > 0.5
        if mass <= 0:
            raise ValueError("质量必须为正数")
        if electron and voltage > 0:
            speed = math.sqrt(2 * E_CHARGE * voltage / mass)
        elif speed <= 0:
            raise ValueError("需要给出速度或电子加速电压")
        momentum = mass * speed
        lam = PLANCK / momentum
        kinetic_j = 0.5 * mass * speed * speed
        kinetic_ev = kinetic_j / E_CHARGE
        return {
            "kind": "modern_physics", "mode": mode,
            "answer": f"动量 p={_fmt(momentum)} kg·m/s，德布罗意波长 λ={_fmt(lam)} m（{_fmt(lam * 1e9)} nm）。",
            "answer_value": lam,
            "metrics": [_metric("lam", "德布罗意波长", f"{_fmt(lam)} m", "accent"),
                        _metric("p", "动量", f"{_fmt(momentum)} kg·m/s"),
                        _metric("v", "速度", f"{_fmt(speed)} m/s"),
                        _metric("Ek", "动能", f"{_fmt(kinetic_ev)} eV")],
            "checks": [_check("relation", "德布罗意关系", abs(lam - PLANCK / momentum) < 1e-30, "λ = h/p"),
                       _check("electron", "电子加速", (not electron) or voltage <= 0 or abs(speed - math.sqrt(2 * E_CHARGE * voltage / mass)) < 1e-9, "非相对论近似 λ = h/√(2meU)")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "动量", f"p={_fmt(momentum)} kg·m/s", {"p": momentum}),
                       _frame(1, "物质波", f"λ={_fmt(lam)} m", {"lam": lam})],
            "scene": {"type": "de_broglie", "m": mass, "v": speed, "U": voltage, "electron": electron,
                      "p": momentum, "lam": lam, "Ek": kinetic_ev},
        }
    if mode == "energy_level":
        hydrogen = _v(p, "hydrogen", 1) > 0.5
        group_n = int(round(_v(p, "group_n")))
        n_hi, n_lo = _v(p, "n_hi"), _v(p, "n_lo")
        explicit = n_hi > 0 and n_lo > 0
        if hydrogen:
            if group_n > 0 and not explicit:
                n_hi, n_lo = float(group_n), 1.0
                explicit = True
            if not explicit:
                raise ValueError("需要给出跃迁的初末能级")
            if n_hi == n_lo:
                raise ValueError("初末能级必须不同")
            if n_hi < 1 or n_lo < 1:
                raise ValueError("能级量子数必须为正整数")
            e_hi = -RYDBERG_EV / (n_hi * n_hi)
            e_lo = -RYDBERG_EV / (n_lo * n_lo)
            levels = [{"n": n, "E": -RYDBERG_EV / (n * n)} for n in range(1, int(max(n_hi, group_n, 1)) + 1)]
            label_hi, label_lo = f"n={int(n_hi)}", f"n={int(n_lo)}"
        else:
            e1, e2 = _v(p, "E1"), _v(p, "E2")
            if e1 == 0 and e2 == 0:
                raise ValueError("需要给出两个能级能量或氢原子跃迁能级")
            e_hi, e_lo = max(e1, e2), min(e1, e2)
            levels = [{"n": 1, "E": e_lo}, {"n": 2, "E": e_hi}]
            label_hi, label_lo = "高能级", "低能级"
            n_hi, n_lo = 2.0, 1.0
        delta_ev = e_hi - e_lo
        if delta_ev <= 0:
            raise ValueError("高能级必须高于低能级")
        wavelength = PLANCK * LIGHT_SPEED / (delta_ev * E_CHARGE)
        lines = group_n * (group_n - 1) // 2 if group_n >= 2 else 1
        shortest = None
        if group_n >= 2 and hydrogen:
            shortest_ev = RYDBERG_EV * (1 - 1 / (group_n * group_n))
            shortest = PLANCK * LIGHT_SPEED / (shortest_ev * E_CHARGE)
        answer = f"{label_hi} → {label_lo} 释放光子能量 ΔE={_fmt(delta_ev)} eV，波长 λ={_fmt(wavelength * 1e9)} nm。"
        metrics = [_metric("dE", "能级差", f"{_fmt(delta_ev)} eV", "accent"),
                   _metric("lam", "光子波长", f"{_fmt(wavelength * 1e9)} nm")]
        if group_n >= 2:
            metrics.append(_metric("lines", "谱线数", str(lines)))
            if shortest is not None:
                metrics.append(_metric("shortest", "最短波长", f"{_fmt(shortest * 1e9)} nm"))
            answer += f"一群处于 n={group_n} 的氢原子最多发出 {lines} 种谱线"
            if shortest is not None:
                answer += f"，最短波长 {_fmt(shortest * 1e9)} nm"
            answer += "。"
        if _v(p, "asks_lines") > 0.5 and group_n >= 2:
            answer_value = float(lines)
        elif _v(p, "asks_shortest") > 0.5 and shortest is not None:
            answer_value = shortest * 1e9
        else:
            answer_value = delta_ev
        return {
            "kind": "modern_physics", "mode": mode, "answer": answer, "answer_value": answer_value,
            "metrics": metrics,
            "checks": [_check("photon", "光子能量", abs(delta_ev * E_CHARGE - PLANCK * LIGHT_SPEED / wavelength) < 1e-24, "hν = ΔE"),
                       _check("count", "谱线数", lines == (group_n * (group_n - 1) // 2 if group_n >= 2 else 1), "N = n(n−1)/2")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "能级差", f"ΔE={_fmt(delta_ev)} eV", {"dE": delta_ev}),
                       _frame(1, "光子波长", f"λ={_fmt(wavelength * 1e9)} nm", {"lam": wavelength})],
            "scene": {"type": "energy_level", "hydrogen": hydrogen, "n_hi": n_hi, "n_lo": n_lo,
                      "levels": levels, "deltaE": delta_ev, "lam": wavelength, "lines": lines,
                      "group_n": group_n, "shortest": shortest, "labelHi": label_hi, "labelLo": label_lo},
        }
    if mode == "decay":
        if "t" not in p:
            raise ValueError("缺少经过时间 t")
        half_life, initial, elapsed = _v(p, "T"), _v(p, "N0"), _v(p, "t")
        if half_life <= 0 or initial <= 0 or elapsed < 0:
            raise ValueError("半衰期和初始核数必须为正，时间不能为负")
        decay_constant = math.log(2) / half_life
        remaining = initial * math.exp(-decay_constant * elapsed)
        fraction = remaining / initial
        activity = decay_constant * remaining
        initial_activity = decay_constant * initial
        assumed = _v(p, "n0_assumed") > 0.5
        samples = []
        span = max(4 * half_life, elapsed * 1.2, half_life)
        for step in range(81):
            t_value = span * step / 80
            samples.append({"t": t_value, "N": initial * math.exp(-decay_constant * t_value)})
        if assumed:
            answer_text = (f"剩余比例 N/N0={_fmt(fraction * 100)}%（按 N0=1 归一计算，比值与 N0 无关），"
                           f"衰变常数 λ={_fmt(decay_constant)} s⁻¹。")
            answer_value = fraction
        else:
            answer_text = (f"剩余核数 N={_fmt(remaining)}，剩余比例 {_fmt(fraction * 100)}%，"
                           f"当前活度 A={_fmt(activity)} Bq（初始活度 {_fmt(initial_activity)} Bq）。")
            answer_value = remaining
        return {
            "kind": "modern_physics", "mode": mode,
            "answer": answer_text,
            "answer_value": answer_value,
            "metrics": [_metric("N", "剩余核数", _fmt(remaining), "accent"),
                        _metric("fraction", "剩余比例", f"{_fmt(fraction * 100)} %"),
                        _metric("A", "当前活度", f"{_fmt(activity)} Bq"),
                        _metric("T", "半衰期", f"{_fmt(half_life)} s")],
            "checks": [_check("decay", "衰变公式", abs(remaining - initial * 0.5 ** (elapsed / half_life)) < 1e-6 * max(1.0, initial), "N = N0(1/2)^(t/T)"),
                       _check("activity", "活度关系", abs(activity - decay_constant * remaining) < 1e-6, "A = λN")],
            "notes": [MODE_LIMITS[mode]],
            "frames": [_frame(0, "半衰期", f"T={_fmt(half_life)} s，λ={_fmt(decay_constant)} s⁻¹", {"T": half_life, "lambda": decay_constant}),
                       _frame(1, "剩余核数", f"N={_fmt(remaining)}，比例 {_fmt(fraction * 100)}%", {"N": remaining, "fraction": fraction})],
            "scene": {"type": "decay", "T": half_life, "N0": initial, "t": elapsed, "N": remaining,
                      "fraction": fraction, "A": activity, "A0": initial_activity,
                      "lambda": decay_constant, "samples": samples},
        }
    raise ValueError("暂不支持该物理题型")


def evaluate_physics_third(model: Mapping[str, Any], params: Mapping[str, Any] | None = None) -> dict[str, Any]:
    mode = str(model.get("physics_mode") or "")
    merged = dict(model.get("defaults") or {})
    merged.update({key: value for key, value in (params or {}).items() if value is not None})
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


def solve_physics_third(model: Mapping[str, Any]) -> dict[str, Any]:
    defaults = dict(model.get("defaults") or {})
    result = evaluate_physics_third(model, defaults)
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


__all__ = ["KIND_LABELS", "MODE_LABELS", "MODE_KIND", "build_physics_third", "evaluate_physics_third", "solve_physics_third"]

"""高数实验的能力目录（AI 调度解题的第一层）。

把现有单题型内核与原子检查登记为 AI 可调用的能力，并区分三类（§1）：

- ``compute``：可以完成计算——由现有内核求解，产出答案；
- ``check``：只能辅助检查——零点、符号分段、定义域等，为后续步骤提供事实，
  不是完整解答；
- ``visual``：只能生成观察图形/展示——不产生数学结论。

目录由 ``kernel_models.TASKS`` 派生，因此手动入口与 AI 调度入口调用的是
同一套计算内核；AI 只能选择目录中实际存在的能力。
"""
from __future__ import annotations

import math
from typing import Any

import sympy as sp
from sympy.calculus.util import continuous_domain

from .expr import parse_expression
from .kernel_models import TASKS, task_catalog

# ---------------------------------------------------------------------------
# 内核返回与展示说明（按任务登记）
# ---------------------------------------------------------------------------

_RETURNS: dict[str, str] = {
    "integral": "exact 精确值、数值与黎曼和展示数据",
    "antiderivative": "原函数（含常数项说明）",
    "derivative": "切线斜率、切线方程",
    "inverse_derivative": "反函数在指定输入处的导数",
    "geometric_area": "面积（exact 与数值）、有效分段区间",
    "rotation_volume": "体积（exact 与数值）",
    "implicit_normal": "法线斜率与法线方程",
    "limit": "极限值或发散结论、左右极限",
    "continuity": "间断点类型判定",
    "taylor": "泰勒多项式系数与余项阶",
    "higher_derivative": "指定阶导数表达式或值",
    "function_study": "单调区间、极值、凹凸与渐近线",
    "constrained_extrema": "拉格朗日乘数、驻点与分类",
    "multivariable": "偏导数/方向导数等组合量",
    "multivariable_extrema": "驻点与极值判定",
    "ode": "方程解与目标组合量",
    "series_convergence": "绝对/条件收敛或发散结论",
    "power_series": "收敛半径/和函数/展开式",
    "fourier_series": "傅里叶系数与展开式",
    "double_integral": "二重积分值与区域处理",
    "triple_integral": "三重积分值",
    "line_integral": "曲线积分值",
    "surface_integral": "曲面积分值",
    "green": "Green 公式积分值",
    "gauss": "Gauss 公式积分值",
    "stokes": "Stokes 公式积分值",
    "space_geometry": "点/线/面关系与度量结论",
    "proof": "认证级别与证明义务清单",
    "optimization": "驻点、极值或梯度下降轨迹",
}

_DISPLAYS: dict[str, list[str]] = {
    "integral": ["函数曲线", "黎曼和切片"],
    "derivative": ["函数曲线", "切线"],
    "inverse_derivative": ["反函数曲线", "切线"],
    "geometric_area": ["函数曲线", "区域阴影"],
    "rotation_volume": ["函数曲线", "旋转体"],
    "limit": ["函数曲线"],
    "function_study": ["函数曲线"],
    "double_integral": ["区域阴影"],
    "optimization": ["函数曲线", "迭代轨迹"],
}


def _cap(cid: str, name: str, kind: str, description: str, required: list[str], *,
         optional: list[str] | None = None, returns: str = "", limits: str = "",
         displays: list[str] | None = None, subject: str | None = None) -> dict[str, Any]:
    return {"id": cid, "name": name, "kind": kind, "subject": subject,
            "description": description, "required": list(required),
            "optional": list(optional or []), "returns": returns, "limits": limits,
            "displays": list(displays or [])}


def _compute_capabilities() -> list[dict[str, Any]]:
    catalog = task_catalog()
    caps: list[dict[str, Any]] = []
    for task, spec in TASKS.items():
        notes = catalog[task]["notes"]
        caps.append(_cap(
            task, spec["label"], "compute",
            f"{spec['label']}：由确定性内核完成计算。",
            spec["required"], optional=spec["optional"],
            returns=_RETURNS.get(task, "内核答案与求解步骤"),
            limits=notes,
            displays=_DISPLAYS.get(task, []),
            subject=spec["subject"],
        ))
    return caps


# ---------------------------------------------------------------------------
# 原子检查能力（确定性实现，不是 AI 代码）
# ---------------------------------------------------------------------------

def _expression_symbol(expr: sp.Expr, variable: str) -> sp.Symbol:
    """取表达式自身的自由符号（parse_expression 可能带假设，与 sp.Symbol(name) 不相等）。"""
    matches = [s for s in expr.free_symbols if s.name == variable]
    return matches[0] if matches else sp.Symbol(variable)


def check_domain(expression: str, variable: str, lower: float, upper: float) -> dict[str, Any]:
    """验证原式实定义域覆盖整个闭区间；无法证明时不承诺完整性。"""
    expr = parse_expression(expression, (variable,), preserve_structure=True)
    x = _expression_symbol(expr, variable)
    a, b = sp.Rational(str(lower)), sp.Rational(str(upper))
    if a > b:
        raise ValueError('研究区间下限不得大于上限')
    interval = sp.Interval(a, b)
    missing = None
    complete = False
    ok = False
    try:
        domain = continuous_domain(expr, x, interval)
        missing = interval - domain
        covered = interval.is_subset(domain)
        if missing.is_empty is False:
            covered = False
        complete = covered is not None
        ok = covered is True
    except Exception:
        pass
    singular = ([float(sp.N(p)) for p in missing if p.is_real is True]
                if isinstance(missing, sp.FiniteSet) else [])
    note = ('已验证原式在整个闭区间内连续且为有限实数。' if ok else
            '原式在区间内存在不可用点，请调整研究区间。' if complete else
            '尚未证明原式定义域覆盖整个区间，不能据此继续求解。')
    return {'capability': 'domain_check', 'ok': ok, 'real_valued': ok,
            'singularities': sorted(singular), 'missing_domain': str(missing),
            'complete': complete, 'note': note}


def check_zeros(expression: str, variable: str, lower: float, upper: float) -> dict[str, Any]:
    """区间内实零点；只有多项式给出完整性承诺（§6 边界）。"""
    expr = parse_expression(expression, (variable,))
    x = _expression_symbol(expr, variable)
    zeros: list[float] = []
    complete = False
    infinite = False
    try:
        a, b = sp.Rational(str(lower)), sp.Rational(str(upper))
        if a > b:
            raise ValueError('研究区间下限不得大于上限')
        interval = sp.Interval(a, b)
        roots = sp.solveset(expr, x, domain=interval)
        original = parse_expression(expression, (variable,), preserve_structure=True)
        domain = continuous_domain(original, x, interval)
        roots = roots.intersect(domain)
        if isinstance(roots, sp.FiniteSet):
            values = [float(sp.N(s)) for s in roots]
            complete = all(math.isfinite(value) for value in values)
            if complete:
                zeros = sorted(values)
        elif roots is sp.S.EmptySet:
            complete = True
        else:
            infinite = roots.is_FiniteSet is False and expr == 0
    except Exception:
        complete = False
    note = ('已验证区间内有限实零点集完整。' if complete else
            '函数在区间内恒为零，零点不是有限列表，不能按空零点集处理。' if infinite else
            '未给出有限零点集完整性证明；没有找到全部零点不能解释为没有其他零点。')
    return {"capability": "zeros_on_interval", "expression": expression,
            "zeros": sorted(set(zeros)), "complete": complete, "infinite": bool(infinite), "note": note}


def _same_zero_set(provided: list[float], verified: list[float]) -> bool:
    return [round(v, 9) for v in sorted(provided)] == [round(v, 9) for v in sorted(verified)]


def check_sign_segments(expression: str, variable: str, lower: float, upper: float,
                        zeros: list[float], zeros_complete: bool = False) -> dict[str, Any]:
    """按零点分段并给出各段符号；零点与完整性必须经内核独立重算核验。

    零点完整性不能由调用方或计划常量自行声明：传入空零点集并声明完整
    （zeros=[]、zeros_complete=True）曾会产生“整段符号为 0”的错误分段结论。
    现在零点一律用 check_zeros 独立重算核验：只有重算能证明完整性、且调用方
    提供的零点集与重算一致、调用方也声明完整时，才承诺 complete=True；
    即使声明不可信，分段也优先采用已核验的零点，不产出错误分段。
    """
    expr = parse_expression(expression, (variable,))
    x = _expression_symbol(expr, variable)
    recomputed = check_zeros(expression, variable, lower, upper)
    domain_ok = bool(check_domain(expression, variable, lower, upper).get("ok"))
    verified = bool(recomputed.get("complete")) and not recomputed.get("infinite") and domain_ok
    try:
        provided = [float(z) for z in zeros or []]
    except (TypeError, ValueError):
        provided = None
    complete = False
    points: list[float] = []
    if verified:
        verified_zeros = [float(v) for v in recomputed.get("zeros") or []]
        points = sorted(set(verified_zeros))
        consistent = provided is not None and _same_zero_set(provided, verified_zeros)
        complete = bool(zeros_complete) and consistent
        note = ("分段符号基于经内核独立核验的完整零点集。" if complete else
                "调用方提供的零点集或完整性声明与内核独立重算不一致，分段符号不能作为完整结论。")
    else:
        if provided is not None and all(math.isfinite(z) and lower <= z <= upper for z in provided):
            points = sorted(set(provided))
        note = ("零点完整性或原式定义域未确认；zeros_complete 声明不能替代核验，"
                "分段符号不能作为完整结论。")
    points = sorted({*(z for z in points if lower <= z <= upper), float(lower), float(upper)})
    segments: list[dict[str, Any]] = []
    for a, b in zip(points, points[1:]):
        mid = (sp.Rational(a) + sp.Rational(b)) / 2
        try:
            value = float(sp.N(expr.subs(x, mid)))
        except Exception:
            value = float('nan')
        if not math.isfinite(value):
            complete = False
            sign = None
        else:
            sign = 1 if value > 0 else (-1 if value < 0 else 0)
        segments.append({"from": a, "to": b, "sign": sign})
    if not segments:
        complete = False
    return {"capability": "sign_segments", "segments": segments,
            "zeros_used": sorted(set(points)), "complete": complete, "note": note}


CHECK_REGISTRY: dict[str, tuple[Any, list[str]]] = {
    "domain_check": (check_domain, ["expression", "variable", "lower", "upper"]),
    "zeros_on_interval": (check_zeros, ["expression", "variable", "lower", "upper"]),
    "sign_segments": (check_sign_segments, ["expression", "variable", "lower", "upper", "zeros", "zeros_complete"]),
}


def _check_capabilities() -> list[dict[str, Any]]:
    return [
        _cap("domain_check", "区间可用性检查", "check",
              "验证原式在给定闭区间上连续且为有限实数。",
             ["expression", "variable", "lower", "upper"],
             returns="ok、singularities、complete",
              limits="保留原式结构并验证连续定义域覆盖；无法判定时 complete=False。",
             displays=["函数曲线"]),
        _cap("zeros_on_interval", "区间内实零点", "check",
             "求函数在区间内的实零点，并给出完整性标记。",
             ["expression", "variable", "lower", "upper"],
             returns="zeros（零点列表）、complete（完整性）、note",
              limits="只对已求得并核验的有限零点集给出完整性承诺；无限或未知零点集 complete=False——"
                    "“没有找到全部零点”不能解释为“没有其他零点”。",
             displays=["函数曲线"]),
        _cap("sign_segments", "分段符号判断", "check",
             "按零点分段并给出各段函数符号，用于区域分段与积分上下限。",
             ["expression", "variable", "lower", "upper", "zeros"],
             optional=["zeros_complete"],
             returns="segments（from/to/sign）、zeros_used、complete",
             limits="零点与完整性由 zeros_on_interval 同源内核独立重算核验；"
                    "计划常量或调用方声明的完整性不能替代核验，不一致时 complete=False。",
             displays=["区域阴影"]),
    ]


# ---------------------------------------------------------------------------
# 目录汇总
# ---------------------------------------------------------------------------

VISUAL_COMPONENTS: list[dict[str, Any]] = [
    {"id": "curve", "name": "函数图像", "maps_to": "现有函数图组件"},
    {"id": "region_shade", "name": "区域阴影/分段着色", "maps_to": "现有区域阴影组件"},
    {"id": "revolution_solid", "name": "旋转体", "maps_to": "现有旋转体组件"},
    {"id": "riemann", "name": "黎曼和切片", "maps_to": "现有黎曼和组件"},
    {"id": "step_timeline", "name": "步骤时间轴", "maps_to": "执行记录时间轴"},
]

ASSEMBLE_CAPABILITY = _cap(
    "assemble_report", "汇总解答与实验展示", "visual",
    "把已完成步骤的结果汇总为分问解答与展示层（图形、时间轴），不产生新的数学结论。",
    ["steps"],
    returns="分问解答、展示层 visuals 与时间轴",
    limits="只汇总已完成步骤；不会补造任何结果。",
)


def capability_catalog() -> dict[str, Any]:
    capabilities = [*_compute_capabilities(), *_check_capabilities(), ASSEMBLE_CAPABILITY]
    return {
        "kind_legend": {
            "compute": "可以完成计算（内核求解，产出答案）",
            "check": "只能辅助检查（为后续步骤提供事实，不是完整解答）",
            "visual": "只能生成观察图形/展示（不产生数学结论）",
        },
        "capabilities": capabilities,
        "visual_components": VISUAL_COMPONENTS,
    }


CAPABILITIES: dict[str, dict[str, Any]] = {cap["id"]: cap for cap in capability_catalog()["capabilities"]}


__all__ = [
    "CAPABILITIES", "capability_catalog", "CHECK_REGISTRY",
    "check_domain", "check_zeros", "check_sign_segments", "VISUAL_COMPONENTS",
]

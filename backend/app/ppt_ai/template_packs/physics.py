"""物理模板：抛体运动、弹簧简谐振动。"""

from __future__ import annotations

from ..recognition_types import ConditionSet, MatchDecision, TemplateDescriptor, TemplateParameterSpec
from ..types import InteractionOption, Region, SourceSnapshot
from .base import make_option

PROJECTILE = TemplateDescriptor(
    template_id="physics.projectile",
    version="1.0",
    operator_id="physics.projectile",
    renderer="projectile",
    title="抛体运动",
    categories=("physics",),
    description="二维恒定重力、无空气阻力；初速度单位先规范化，再计算位置、射程与最高点。",
    aliases=("抛体运动", "平抛运动", "斜抛运动", "projectile", "初速度"),
    keywords=("抛体", "平抛", "斜抛", "projectile", "仰角", "初速度", "重力"),
    formula_patterns=(r"v0\s*=|初速度",),
    negative_keywords=("弹簧", "简谐", "振动"),
    required_conditions=("v0",),
    parameter_specs=(
        TemplateParameterSpec(
            name="v0",
            label="初速度 v0",
            type="number",
            required=True,
            default=None,
            min=0,
            max=1000,
            step=0.1,
            unit="m/s",
            source_keys=("v0",),
            needs_review_on_default=True,
        ),
        TemplateParameterSpec(
            name="angle_deg",
            label="抛射角",
            type="number",
            required=False,
            default=0.0,
            min=-90,
            max=90,
            step=1,
            unit="deg",
            source_keys=("angle_deg",),
            needs_review_on_default=False,
        ),
        TemplateParameterSpec(
            name="y0",
            label="初始高度",
            type="number",
            required=False,
            default=0.0,
            min=-1000,
            max=1000,
            step=0.1,
            unit="m",
            source_keys=("y0",),
            needs_review_on_default=False,
        ),
        TemplateParameterSpec(
            name="g",
            label="重力加速度",
            type="number",
            required=False,
            default=9.8,
            min=0.001,
            max=100,
            step=0.1,
            unit="m/s^2",
            source_keys=("g",),
            needs_review_on_default=False,
        ),
        TemplateParameterSpec(
            name="t",
            label="时刻 t",
            type="number",
            required=False,
            default=1.0,
            min=0,
            max=1000,
            step=0.1,
            unit="s",
            source_keys=("t",),
            needs_review_on_default=False,
        ),
    ),
    views=(("curve", "轨迹"), ("metrics", "位置与射程"), ("table", "速度分解"), ("text", "原稿依据")),
    examples=("36 km/h、仰角 30°、g=9.8", "平抛 10 m/s、高度 5 m"),
    eval_cases=("projectile_kmh_conversion", "projectile_horizontal", "projectile_missing_speed"),
)

SPRING = TemplateDescriptor(
    template_id="physics.spring_oscillator",
    version="1.0",
    operator_id="physics.spring",
    renderer="spring",
    title="弹簧简谐振动",
    categories=("physics",),
    description="一维无阻尼弹簧振子；质量与劲度系数必须为正，同时给出位移、速度与能量。",
    aliases=("弹簧振子", "简谐振动", "简谐运动", "spring", "oscillator"),
    keywords=("弹簧", "简谐", "振动", "劲度系数", "质量", "位移"),
    formula_patterns=(r"k\s*=|劲度系数",),
    negative_keywords=("抛体", "平抛", "重力加速度"),
    required_conditions=("m", "k", "x0", "v0"),
    parameter_specs=(
        TemplateParameterSpec(name="m", label="质量 m", type="number", required=True, default=None, min=0.0001, max=1000, step=0.1, unit="kg", source_keys=("m",)),
        TemplateParameterSpec(name="k", label="劲度系数 k", type="number", required=True, default=None, min=0.0001, max=100000, step=0.1, unit="N/m", source_keys=("k",)),
        TemplateParameterSpec(name="x0", label="初位移 x0", type="number", required=True, default=None, min=-100, max=100, step=0.1, unit="m", source_keys=("x0",)),
        TemplateParameterSpec(name="v0", label="初速度 v0", type="number", required=True, default=None, min=-1000, max=1000, step=0.1, unit="m/s", source_keys=("v0",)),
        TemplateParameterSpec(
            name="t",
            label="时刻 t",
            type="number",
            required=False,
            default=1.0,
            min=0,
            max=1000,
            step=0.1,
            unit="s",
            source_keys=("t",),
            needs_review_on_default=False,
        ),
    ),
    views=(("curve", "位移-时间曲线"), ("metrics", "位移、速度与能量"), ("table", "状态量"), ("text", "原稿依据")),
    examples=("m=2kg, k=8N/m, x0=0.1m", "质量 0.5kg，劲度系数 2N/m，静止释放"),
    eval_cases=("spring_basic", "spring_narrative", "spring_negative_k"),
)


def build_projectile(decision: MatchDecision, condition_set: ConditionSet, region: Region, snapshot: SourceSnapshot) -> InteractionOption:
    return make_option(
        descriptor=PROJECTILE,
        decision=decision,
        condition_set=condition_set,
        region=region,
        snapshot=snapshot,
        provider={},
        purpose="先规范化初速度单位，再用同一组条件计算轨迹、射程与最高点。",
    )


def build_spring(decision: MatchDecision, condition_set: ConditionSet, region: Region, snapshot: SourceSnapshot) -> InteractionOption:
    return make_option(
        descriptor=SPRING,
        decision=decision,
        condition_set=condition_set,
        region=region,
        snapshot=snapshot,
        provider={},
        purpose="质量与劲度系数为正时给出位移、速度、加速度与能量；非法参数明确停止。",
    )


TEMPLATES = (PROJECTILE, SPRING)
BUILDERS = {
    "physics.projectile": build_projectile,
    "physics.spring_oscillator": build_spring,
}

__all__ = ["BUILDERS", "PROJECTILE", "SPRING", "TEMPLATES"]

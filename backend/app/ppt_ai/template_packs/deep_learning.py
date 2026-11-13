"""深度学习模板：激活函数与梯度、卷积/池化。"""

from __future__ import annotations

from ..recognition_types import ConditionSet, MatchDecision, TemplateDescriptor, TemplateParameterSpec
from ..types import InteractionOption, Region, SourceSnapshot
from .base import make_option

ACTIVATION = TemplateDescriptor(
    template_id="deep_learning.activation_gradient",
    version="1.0",
    operator_id="deep_learning.activation",
    renderer="activation",
    title="激活函数与梯度",
    categories=("network",),
    description="计算 Sigmoid/Tanh/ReLU 的激活值、局部导数与反向梯度；ReLU 在零点采用导数 0。",
    aliases=("激活函数", "ReLU", "Sigmoid", "Tanh", "梯度"),
    keywords=("激活", "relu", "sigmoid", "tanh", "梯度", "反向传播"),
    formula_patterns=(r"(?:relu|sigmoid|tanh)",),
    negative_keywords=("卷积", "池化", "矩阵变换"),
    required_conditions=("activation", "x"),
    parameter_specs=(
        TemplateParameterSpec(
            name="activation",
            label="激活函数",
            type="enum",
            required=True,
            default="relu",
            options=["relu", "sigmoid", "tanh"],
            source_keys=("activation",),
            needs_review_on_default=True,
        ),
        TemplateParameterSpec(
            name="x",
            label="输入 x",
            type="number",
            required=True,
            default=0.0,
            min=-20,
            max=20,
            step=0.1,
            source_keys=("x",),
            needs_review_on_default=True,
        ),
        TemplateParameterSpec(
            name="upstream",
            label="上游梯度",
            type="number",
            required=False,
            default=1.0,
            min=-100,
            max=100,
            step=0.1,
            source_keys=("upstream",),
            needs_review_on_default=False,
        ),
    ),
    views=(("curve", "激活函数曲线"), ("metrics", "激活值与梯度"), ("text", "原稿依据")),
    examples=("ReLU 在 x=-0.5，上游梯度 2", "Sigmoid x=0.8"),
    eval_cases=("relu_negative", "sigmoid_point", "relu_zero_convention", "activation_missing_x"),
)

CONV_POOL = TemplateDescriptor(
    template_id="deep_learning.conv_pool",
    version="1.0",
    operator_id="deep_learning.conv_pool",
    renderer="conv_pool",
    title="卷积与池化",
    categories=("network", "matrix"),
    description="单通道小矩阵的互相关卷积或最大/平均池化；步长、填充与输出形状同时显示。",
    aliases=("卷积", "池化", "conv", "pool", "feature map", "卷积核"),
    keywords=("卷积", "池化", "conv", "pool", "步长", "填充", "卷积核"),
    formula_patterns=(),
    negative_keywords=("激活函数", "矩阵变换"),
    required_conditions=("matrix",),
    parameter_specs=(
        TemplateParameterSpec(
            name="matrix",
            label="输入矩阵",
            type="number_matrix",
            required=True,
            default=None,
            source_keys=("matrix",),
            description="单通道二维数值矩阵。",
        ),
        TemplateParameterSpec(
            name="kernel",
            label="卷积核",
            type="number_matrix",
            required=False,
            default=None,
            source_keys=("kernel",),
            description="池化时可省略，由池化窗口形状决定。",
        ),
        TemplateParameterSpec(
            name="mode",
            label="模式",
            type="enum",
            required=False,
            default="conv",
            options=["conv", "maxpool", "avgpool"],
            source_keys=("mode",),
            needs_review_on_default=False,
        ),
        TemplateParameterSpec(
            name="stride",
            label="步长",
            type="integer",
            required=False,
            default=1,
            min=1,
            max=8,
            step=1,
            source_keys=("stride",),
            needs_review_on_default=False,
        ),
        TemplateParameterSpec(
            name="padding",
            label="填充",
            type="integer",
            required=False,
            default=0,
            min=0,
            max=8,
            step=1,
            source_keys=("padding",),
            needs_review_on_default=False,
        ),
    ),
    views=(("table", "输入与特征图"), ("metrics", "输出形状"), ("text", "约定与原文")),
    examples=("3×3 输入与 3×3 卷积核，步长 1", "4×4 输入 2×2 最大池化"),
    eval_cases=("conv_cross_correlation", "maxpool_2x2", "conv_missing_matrix"),
)


def build_activation(decision: MatchDecision, condition_set: ConditionSet, region: Region, snapshot: SourceSnapshot) -> InteractionOption:
    return make_option(
        descriptor=ACTIVATION,
        decision=decision,
        condition_set=condition_set,
        region=region,
        snapshot=snapshot,
        provider={},
        purpose="激活值、局部导数与反向梯度来自同一次求值；ReLU 零点约定明确显示。",
    )


def build_conv_pool(decision: MatchDecision, condition_set: ConditionSet, region: Region, snapshot: SourceSnapshot) -> InteractionOption:
    values = condition_set.values()
    window = values.get("window")
    return make_option(
        descriptor=CONV_POOL,
        decision=decision,
        condition_set=condition_set,
        region=region,
        snapshot=snapshot,
        provider={"window": window if isinstance(window, list) else None},
        purpose="卷积使用深度学习互相关约定；池化窗口、步长和填充不会隐式改变。",
    )


TEMPLATES = (ACTIVATION, CONV_POOL)
BUILDERS = {
    "deep_learning.activation_gradient": build_activation,
    "deep_learning.conv_pool": build_conv_pool,
}

__all__ = ["ACTIVATION", "BUILDERS", "CONV_POOL", "TEMPLATES"]

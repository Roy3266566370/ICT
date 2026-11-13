"""能力注册表：只有登记过的算子才可被规划采用和执行。

每个算子声明：输入类型/维度、参数约束、求值器、轨迹结构、可用视图、
性质检查与在线/离线能力。新增能力先登记，再允许模型提议。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping

from . import REGISTRY_VERSION
from .types import CanonicalValue, OutputSpec, PlanParameter


class RegistryError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class OperatorSpec:
    operator_id: str
    version: str
    title: str
    categories: tuple[str, ...]
    input_types: tuple[str, ...]
    outputs: tuple[str, ...]
    evaluator: str
    views: tuple[str, ...]
    checks: tuple[str, ...]
    offline_supported: bool
    description: str = ""
    #: 可跨页引用的派生概念；未声明的结果只留在 derived 快照里。
    derived_outputs: tuple[OutputSpec, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {
            "operator_id": self.operator_id,
            "version": self.version,
            "title": self.title,
            "categories": list(self.categories),
            "input_types": list(self.input_types),
            "outputs": list(self.outputs),
            "derived_outputs": [item.model_dump(mode="json") for item in self.derived_outputs],
            "evaluator": self.evaluator,
            "views": list(self.views),
            "checks": list(self.checks),
            "offline_supported": self.offline_supported,
            "description": self.description,
        }


def _derived(key: str, name: str, type_: str = "number", unit: str = "") -> OutputSpec:
    """算子声明的输出；``concept_id`` 在编译期按节点填成稳定 ID。"""

    return OutputSpec(key=key, concept_id=f"decl:{key}", name=name, type=type_, unit=unit)  # type: ignore[arg-type]


_OPERATORS: tuple[OperatorSpec, ...] = (
    OperatorSpec(
        operator_id="lab.calculus.integral",
        version="1.0",
        title="定积分探索",
        categories=("formula",),
        input_types=("number",),
        outputs=("approx", "exact", "error", "curve", "rects"),
        evaluator="lab.calculus.integral",
        views=("curve", "metrics", "table", "text"),
        checks=("finite", "domain", "riemann_convergence"),
        offline_supported=True,
        description="被积函数、上下限与分割数来自原稿/用户核对；黎曼和与解析值读取同一表达式。",
        derived_outputs=(_derived("exact", "解析值"), _derived("approx", "黎曼和")),
    ),
    OperatorSpec(
        operator_id="lab.calculus.derivative",
        version="1.0",
        title="导数与切线",
        categories=("formula",),
        input_types=("number",),
        outputs=("value", "slope", "secant", "curve", "tangent"),
        evaluator="lab.calculus.derivative",
        views=("curve", "metrics", "table", "text"),
        checks=("point_defined", "secant_converges"),
        offline_supported=True,
        description="切线、割线与中心差商读取同一函数表达式。",
        derived_outputs=(_derived("value", "函数值"), _derived("slope", "切线斜率")),
    ),
    OperatorSpec(
        operator_id="lab.calculus.expression",
        version="1.0",
        title="函数表达式探索",
        categories=("formula", "text"),
        input_types=("number",),
        outputs=("value", "curve"),
        evaluator="lab.calculus.expression",
        views=("curve", "metrics", "text"),
        checks=("finite", "domain"),
        offline_supported=True,
        description="无法归类为积分/导数时，只对已识别的表达式做采样与求值。",
        derived_outputs=(_derived("value", "函数值"),),
    ),
    OperatorSpec(
        operator_id="native.chart.explore",
        version="1.0",
        title="原生图表筛选",
        categories=("chart",),
        input_types=("enum",),
        outputs=("rows", "chart"),
        evaluator="native.chart",
        views=("table", "metrics", "text"),
        checks=("source_match",),
        offline_supported=True,
        description="分类与数值来自 PPTX 原生 chart，不做视觉拟合。",
    ),
    OperatorSpec(
        operator_id="native.table.explore",
        version="1.0",
        title="原生表格筛选",
        categories=("table",),
        input_types=("enum",),
        outputs=("rows", "summary"),
        evaluator="native.table",
        views=("table", "text"),
        checks=("source_match",),
        offline_supported=True,
        description="表头与单元格来自 PPTX 原生 table。",
    ),
    OperatorSpec(
        operator_id="algorithm.bfs",
        version="1.0",
        title="BFS 轨迹",
        categories=("algorithm",),
        input_types=("string",),
        outputs=("order", "visited", "parent"),
        evaluator="lab.algorithm.bfs",
        views=("table", "text"),
        checks=("queue_order", "visited_once"),
        offline_supported=True,
        description="只有原稿明确给出有向边与起点时才执行 BFS；箭头本身不足以证明算法。",
    ),
    OperatorSpec(
        operator_id="optimization.gradient",
        version="1.0",
        title="梯度下降轨迹",
        categories=("optimization",),
        input_types=("number", "integer"),
        outputs=("trajectory", "loss", "grad_norm"),
        evaluator="lab.optimization.gradient",
        views=("curve", "table", "metrics", "text"),
        checks=("gradient_finite", "convergence"),
        offline_supported=True,
        description="目标函数、梯度、初值和方法都必须有原稿依据或明确标为补充实验条件。",
        derived_outputs=(_derived("loss", "当前损失"), _derived("grad_norm", "梯度范数")),
    ),
    OperatorSpec(
        operator_id="deep_learning.forward",
        version="1.0",
        title="小型网络计算流",
        categories=("network",),
        input_types=("number", "integer"),
        outputs=("loss_history", "forward"),
        evaluator="lab.deep_learning",
        views=("table", "metrics", "text"),
        checks=("dimension_match", "loss_finite"),
        offline_supported=True,
        description="缺权重时只做结构讲解或核对后的教学小模型，不冒充原稿真实训练日志。",
    ),
    OperatorSpec(
        operator_id="matrix.transform",
        version="1.0",
        title="矩阵与向量变换",
        categories=("matrix",),
        input_types=("matrix2", "vector2"),
        outputs=("product", "det", "inverse"),
        views=("table", "metrics", "text"),
        evaluator="matrix.transform",
        checks=("dimension_match", "finite"),
        offline_supported=True,
        description="矩阵元素来自原稿或用户核对；奇异矩阵给出明确状态，不强行取逆。",
        derived_outputs=(
            _derived("det", "行列式"),
            _derived("product", "矩阵乘积", "vector2"),
            _derived("inverse", "逆矩阵", "matrix2"),
        ),
    ),
    OperatorSpec(
        operator_id="matrix.change_of_basis",
        version="1.0",
        title="换基观察",
        categories=("matrix",),
        input_types=("matrix2", "number"),
        outputs=("basis", "inverse_basis", "transformed", "invariants", "coordinates"),
        evaluator="matrix.change_of_basis",
        views=("table", "metrics", "text"),
        checks=("finite", "basis_invertible", "invariants_preserved"),
        offline_supported=True,
        description="二维旋转基 P=[[cosθ,-sinθ],[sinθ,cosθ]]；输出 B=P⁻¹AP、坐标与不变量，P 不可逆时明确提示。",
        derived_outputs=(
            _derived("det", "行列式 det(A)"),
            _derived("trace", "迹 tr(A)"),
            _derived("transformed", "换基后的矩阵", "matrix2"),
        ),
    ),
    OperatorSpec(
        operator_id="calculus.taylor",
        version="1.0",
        title="泰勒近似",
        categories=("formula", "calculus"),
        input_types=("number", "integer", "string"),
        outputs=("coefficients", "approx", "error", "series"),
        evaluator="template.taylor",
        views=("curve", "metrics", "table", "text"),
        checks=("supported_family", "order_range", "finite", "domain"),
        offline_supported=True,
        description="sin/cos/exp/ln(1+x)/低阶多项式，展开点、阶数与估计点均来自原稿或核对。",
        derived_outputs=(_derived("approx", "近似值"), _derived("error", "误差")),
    ),
    OperatorSpec(
        operator_id="calculus.double_integral",
        version="1.0",
        title="二重积分网格",
        categories=("formula", "calculus"),
        input_types=("number", "integer", "string"),
        outputs=("numeric", "analytic", "error", "grid"),
        evaluator="template.double_integral",
        views=("table", "metrics", "text"),
        checks=("rectangular_domain", "grid_limit", "finite"),
        offline_supported=True,
        description="矩形区域上的多项式/低复杂度函数；同时给出网格累加与解析参考值。",
        derived_outputs=(_derived("numeric", "网格值"), _derived("analytic", "解析值"), _derived("error", "误差")),
    ),
    OperatorSpec(
        operator_id="optimization.newton_1d",
        version="1.0",
        title="一维牛顿优化",
        categories=("optimization",),
        input_types=("string", "number", "integer"),
        # 输出键必须与内核结果键一致：内核返回 f_final（不是 loss），
        # 声明键取不到值时派生引用会永远显示“上游无可用值”。
        outputs=("trajectory", "f_final", "curvature", "converged"),
        evaluator="template.newton_1d",
        views=("curve", "table", "metrics", "text"),
        checks=("curvature_positive", "finite", "iteration_limit"),
        offline_supported=True,
        description="解析导数与二阶导；曲率非正时明确停止，不把求根牛顿法当优化结果。",
        derived_outputs=(_derived("f_final", "f(x*)"), _derived("curvature", "二阶导")),
    ),
    OperatorSpec(
        operator_id="optimization.least_squares_line",
        version="1.0",
        title="最小二乘直线拟合",
        categories=("optimization", "table"),
        input_types=("number_list",),
        outputs=("slope", "intercept", "residuals", "r_squared"),
        evaluator="template.least_squares",
        views=("curve", "table", "metrics", "text"),
        checks=("same_length", "full_rank", "finite"),
        offline_supported=True,
        description="小型二维数据；秩不足时不伪称唯一解。",
        derived_outputs=(
            _derived("slope", "斜率"),
            _derived("intercept", "截距"),
            _derived("r_squared", "决定系数"),
        ),
    ),
    OperatorSpec(
        operator_id="data_structures.stack_queue",
        version="1.0",
        title="栈与队列",
        categories=("data_structure", "algorithm"),
        input_types=("number_list", "string", "enum", "integer"),
        outputs=("steps", "final_state", "errors"),
        evaluator="template.stack_queue",
        views=("table", "metrics", "text"),
        checks=("operation_valid", "capacity", "empty_state"),
        offline_supported=True,
        description="按明确操作序列单步执行；空栈/空队列与容量问题明确报告。",
    ),
    OperatorSpec(
        operator_id="data_structures.sorting",
        version="1.0",
        title="基础排序",
        categories=("data_structure", "algorithm"),
        input_types=("number_list", "enum"),
        outputs=("steps", "comparisons", "swaps", "sorted"),
        evaluator="template.sorting",
        views=("table", "metrics", "text"),
        checks=("length_limit", "algorithm_registered", "finite"),
        offline_supported=True,
        description="冒泡/插入排序，最多 32 个元素；比较次数与稳定性的口径固定。",
    ),
    OperatorSpec(
        operator_id="deep_learning.activation",
        version="1.0",
        title="激活函数与梯度",
        categories=("network",),
        input_types=("enum", "number"),
        outputs=("activation_value", "gradient", "series"),
        evaluator="template.activation",
        views=("curve", "metrics", "text"),
        checks=("activation_registered", "finite", "relu_zero_convention"),
        offline_supported=True,
        description="Sigmoid/Tanh/ReLU；ReLU 在零点导数采用 0 的约定并明确显示。",
        derived_outputs=(_derived("activation_value", "激活值"), _derived("gradient", "梯度")),
    ),
    OperatorSpec(
        operator_id="deep_learning.conv_pool",
        version="1.0",
        title="卷积与池化",
        categories=("network", "matrix"),
        input_types=("number_matrix", "integer", "enum"),
        outputs=("feature_map", "shape", "operations"),
        evaluator="template.conv_pool",
        views=("table", "metrics", "text"),
        checks=("shape_match", "stride_positive", "padding_range"),
        offline_supported=True,
        description="单通道小矩阵；卷积采用深度学习的互相关约定，明确步长与填充。",
    ),
    OperatorSpec(
        operator_id="physics.projectile",
        version="1.0",
        title="抛体运动",
        categories=("physics",),
        input_types=("number",),
        outputs=("position", "range", "apex", "series"),
        evaluator="template.projectile",
        views=("curve", "metrics", "table", "text"),
        checks=("gravity_positive", "speed_positive", "unit_normalized"),
        offline_supported=True,
        description="二维、恒定重力、无空气阻力；初值需有依据或明确确认。",
        derived_outputs=(_derived("range", "射程"), _derived("apex", "最高点")),
    ),
    OperatorSpec(
        operator_id="physics.spring",
        version="1.0",
        title="弹簧简谐振动",
        categories=("physics",),
        input_types=("number",),
        outputs=("position", "velocity", "energy", "series"),
        evaluator="template.spring",
        views=("curve", "metrics", "table", "text"),
        checks=("mass_positive", "stiffness_positive", "energy_conserved"),
        offline_supported=True,
        description="一维无阻尼；质量与劲度系数必须为正，输出位移、速度与能量。",
    ),
    OperatorSpec(
        operator_id="explain.text",
        version="1.0",
        title="原文说明",
        categories=("text", "diagram", "image"),
        input_types=("string",),
        outputs=(),
        evaluator="explain",
        views=("text",),
        checks=(),
        offline_supported=True,
        description="无法恢复计算关系时只展示原文与边界说明，不伪造可调参数。",
    ),
)


class CapabilityRegistry:
    def __init__(self, operators: Iterable[OperatorSpec] = _OPERATORS) -> None:
        self.version = REGISTRY_VERSION
        self._operators = {spec.operator_id: spec for spec in operators}

    def get(self, operator_id: str) -> OperatorSpec:
        spec = self._operators.get(operator_id)
        if spec is None:
            raise RegistryError(f"算子未登记：{operator_id}")
        return spec

    def has(self, operator_id: str) -> bool:
        return operator_id in self._operators

    def for_category(self, category: str) -> list[OperatorSpec]:
        return [spec for spec in self._operators.values() if category in spec.categories]

    def list(self) -> list[dict[str, Any]]:
        return [spec.as_dict() for spec in self._operators.values()]

    def validate_parameters(self, operator_id: str, parameters: list[PlanParameter]) -> list[str]:
        spec = self.get(operator_id)
        errors: list[str] = []
        if spec.operator_id == "explain.text" and parameters:
            errors.append("说明型算子不接受可调参数")
        if spec.operator_id != "explain.text" and not parameters:
            errors.append("交互算子缺少可调参数")
        supported = {
            "number", "integer", "boolean", "string", "enum",
            "matrix2", "vector2", "number_list", "number_matrix",
        }
        for parameter in parameters:
            if parameter.type not in supported:
                errors.append(f"参数 {parameter.id} 类型不支持")
            if parameter.type in ("number", "integer"):
                if not isinstance(parameter.default, (int, float)) or isinstance(parameter.default, bool):
                    errors.append(f"参数 {parameter.id} 必须是数值默认值")
            if parameter.type in ("number_list", "number_matrix", "matrix2", "vector2"):
                if not isinstance(parameter.default, list):
                    errors.append(f"参数 {parameter.id} 必须是数组/矩阵默认值")
        return errors

    def validate_value(self, parameter: PlanParameter, value: CanonicalValue) -> str | None:
        if parameter.type in ("number", "integer"):
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                return f"{parameter.label} 必须是数值"
            if parameter.type == "integer" and not float(value).is_integer():
                return f"{parameter.label} 必须是整数"
            if parameter.min is not None and float(value) < parameter.min:
                return f"{parameter.label} 小于允许范围"
            if parameter.max is not None and float(value) > parameter.max:
                return f"{parameter.label} 大于允许范围"
        elif parameter.type in ("number_list", "number_matrix", "matrix2", "vector2"):
            try:
                PlanParameter.model_validate(
                    {
                        **parameter.model_dump(mode="python"),
                        "default": value,
                    }
                )
            except ValueError as exc:
                return f"{parameter.label} 数组值不合法：{exc}"
        elif parameter.type == "boolean" and not isinstance(value, bool):
            return f"{parameter.label} 必须是布尔值"
        elif parameter.type in ("string", "enum") and not isinstance(value, str):
            return f"{parameter.label} 必须是文本"
        elif parameter.type == "enum" and parameter.options and str(value) not in parameter.options:
            return f"{parameter.label} 不在可选项中"
        return None


REGISTRY = CapabilityRegistry()


def registry_version() -> str:
    return REGISTRY.version


__all__ = [
    "CapabilityRegistry",
    "OperatorSpec",
    "REGISTRY",
    "RegistryError",
    "registry_version",
]

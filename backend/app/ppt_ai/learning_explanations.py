"""概念讲解与变化解释：确定性事实 + 受控文案（``ppt-learning.1`` §5.6/§6.4）。

数学数字、解类型和验证来自统一求值，不由模型改写。模型不可用或输出不合规时，
这里提供的确定性模板仍能给出可读答案；绑定当前 ``input_hash`` 的结果不会在条件
变化后冒充当前答案。
"""

from __future__ import annotations

import math
from typing import Any, Mapping

from sqlalchemy.orm import Session

from ..db.models import MaterialRecord
from ..db.ppt_ai_models import PptAiTaskRecord
from .evaluation import evaluate_node
from .learning import descriptor_for_node
from .learning_context import FrozenLearningContext, LearningContextError, validate_learning_context
from .learning_types import (
    LearningContext,
    LearningResultCard,
    LearningVerification,
)
from .types import CanonicalValues
from .util import hash_json, new_id


def _fmt(value: float) -> str:
    if abs(value - round(value)) < 1e-10:
        return str(int(round(value)))
    return f"{value:.6g}"


def _verification_from_checks(checks: list[Mapping[str, Any]]) -> list[LearningVerification]:
    result: list[LearningVerification] = []
    for check in checks[:8]:
        status = check.get("status")
        result.append(
            LearningVerification(
                label=str(check.get("label") or check.get("id") or "检查"),
                expected="",
                actual=str(check.get("detail") or check.get("message") or ""),
                residual=None,
                status="pass" if status == "pass" else "fail" if status == "fail" else "not_checked",
            )
        )
    return result


def _values_text(values: Mapping[str, Any], node) -> str:
    parts: list[str] = []
    for parameter in node.parameters:
        value = values.get(parameter.concept_id, parameter.default)
        parts.append(f"{parameter.label}={_fmt(float(value)) if isinstance(value, (int, float)) and not isinstance(value, bool) else value}")
    for key in sorted(values):
        if key.startswith("teaching."):
            parts.append(f"{key}={_fmt(float(values[key]))}")
    return "，".join(parts)


def _matrix_from(values: Mapping[str, Any], node) -> list[list[float]]:
    result = [[1.0, 0.0], [0.0, 1.0]]
    for row in range(2):
        for column in range(2):
            parameter = next((item for item in node.parameters if item.id == f"a{row + 1}{column + 1}"), None)
            result[row][column] = float(
                values.get(parameter.concept_id, parameter.default) if parameter is not None else result[row][column]
            )
    return result


def _vector_from(values: Mapping[str, Any], node) -> list[float] | None:
    provider_vector = node.provider.get("vector") if isinstance(node.provider.get("vector"), list) else [1.0, 0.0]
    vector: list[float] = []
    for index in range(2):
        parameter = next((item for item in node.parameters if item.id == f"v{index + 1}"), None)
        if parameter is not None:
            vector.append(float(values.get(parameter.concept_id, parameter.default)))
        elif f"teaching.v{index + 1}" in values:
            vector.append(float(values[f"teaching.v{index + 1}"]))
        elif len(provider_vector) > index and isinstance(provider_vector[index], (int, float)):
            vector.append(float(provider_vector[index]))
        else:
            return None
    return vector


def _eigen_card(frozen: FrozenLearningContext, descriptor) -> LearningResultCard:
    node = frozen.node
    evaluation = evaluate_node(node, frozen.effective_values)["result"]
    geometry = evaluation.get("geometry") if isinstance(evaluation.get("geometry"), Mapping) else None
    matrix = _matrix_from(frozen.effective_values, node)
    vector = _vector_from(frozen.effective_values, node)
    steps: list[str] = ["从原稿读取矩阵 A 与当前向量 v。"]
    conclusion = "当前参数下没有可绘制的几何事实；请核对矩阵与向量来源。"
    if geometry and vector is not None:
        product = geometry.get("product")
        steps = [
            f"矩阵 A = [[{_fmt(matrix[0][0])}, {_fmt(matrix[0][1])}], [{_fmt(matrix[1][0])}, {_fmt(matrix[1][1])}]]。",
            f"当前 v = ({_fmt(vector[0])}, {_fmt(vector[1])})。",
            f"计算 Av = ({_fmt(product[0])}, {_fmt(product[1])})。",
        ]
        if geometry.get("zero_vector"):
            conclusion = "v=(0,0) 是零向量，零向量不能作为特征向量；请换一个非零向量。"
        elif geometry.get("av_zero"):
            conclusion = "Av=(0,0)。这是一个非零特征向量，特征值为 0；它与输入零向量不是一回事。"
        elif geometry.get("collinear"):
            ratio = float(geometry.get("ratio") or 0.0)
            conclusion = f"Av 与 v 共线，倍率约为 {_fmt(ratio)}；因此这个方向是矩阵的特征方向。"
            steps.append(f"用 Av = {_fmt(ratio)}·v 验证倍率。")
        else:
            conclusion = "Av 与 v 不共线，当前向量不是特征向量；可以拖动向量继续观察方向变化。"

    card = LearningResultCard(
        card_id=new_id("card"),
        title="为什么这个方向会保持不变？",
        conclusion=conclusion,
        solution=None,
        steps=steps,
        verification=_verification_from_checks(evaluation.get("checks", [])),
        source_refs=descriptor.source_refs,
        scope={
            "input_hash": frozen.input_hash,
            "values": {key: value for key, value in frozen.effective_values.items() if isinstance(value, (int, float, bool, str))},
        },
        limitations=["解释只对应当前矩阵与向量；改变任一条件后需要重新解释。"],
        next_actions=["拖动 v 观察是否共线", "问一个关于倍率的问题"],
        input_hash=frozen.input_hash,
        request_hash=hash_json({"mode": "concept", "input_hash": frozen.input_hash}),
        task_id="",
        result_kind="explanation",
    )
    return card


def _inverse_card(frozen: FrozenLearningContext, descriptor) -> LearningResultCard:
    node = frozen.node
    evaluation = evaluate_node(node, frozen.effective_values)["result"]
    matrix = _matrix_from(frozen.effective_values, node)
    det = matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]
    if abs(det) > 1e-12:
        conclusion = (
            f"det(A) = {_fmt(det)} ≠ 0，矩阵可逆。已知 y 时存在唯一输入 v = A⁻¹y；"
            "把目标向量 y 填入后运行目标反求即可得到答案与残差。"
        )
        steps = [
            f"矩阵 A = [[{_fmt(matrix[0][0])}, {_fmt(matrix[0][1])}], [{_fmt(matrix[1][0])}, {_fmt(matrix[1][1])}]]。",
            f"det(A) = {_fmt(det)}，不等于 0。",
            "解方程 Av = y：先求 A⁻¹，再计算 v。",
        ]
    else:
        conclusion = (
            "det(A) = 0，矩阵奇异。已知 y 时可能无解，也可能有无穷多解；"
            "需要比较 rank(A) 与 rank([A|y])，不能直接取逆。"
        )
        steps = [
            f"矩阵 A = [[{_fmt(matrix[0][0])}, {_fmt(matrix[0][1])}], [{_fmt(matrix[1][0])}, {_fmt(matrix[1][1])}]]。",
            "det(A) = 0，A⁻¹ 不存在。",
            "比较 rank(A) 与增广矩阵 rank([A|y])：相等则多解，否则无解。",
        ]
    return LearningResultCard(
        card_id=new_id("card"),
        title="已知结果，怎样反求输入？",
        conclusion=conclusion,
        solution=None,
        steps=steps,
        verification=_verification_from_checks(evaluation.get("checks", [])),
        source_refs=descriptor.source_refs,
        scope={
            "input_hash": frozen.input_hash,
            "values": {key: value for key, value in frozen.effective_values.items() if isinstance(value, (int, float, bool, str))},
        },
        limitations=["有限搜索未发现不等于数学无解；这里只解释当前矩阵的可解性结构。"],
        next_actions=["填入目标向量 y 后运行目标反求", "问一个关于奇异矩阵的问题"],
        input_hash=frozen.input_hash,
        request_hash=hash_json({"mode": "concept", "input_hash": frozen.input_hash}),
        task_id="",
        result_kind="explanation",
    )


def _change_card(frozen: FrozenLearningContext, descriptor) -> LearningResultCard:
    node = frozen.node
    evaluation = evaluate_node(node, frozen.effective_values)["result"]
    transformed = evaluation.get("transformed")
    invariants = evaluation.get("invariants") if isinstance(evaluation.get("invariants"), Mapping) else None
    basis_angle = evaluation.get("basis_angle_deg")
    if transformed and invariants:
        conclusion = (
            f"换基后 B = P⁻¹AP = [[{_fmt(transformed[0][0])}, {_fmt(transformed[0][1])}], "
            f"[{_fmt(transformed[1][0])}, {_fmt(transformed[1][1])}]]；"
            f"迹仍为 {_fmt(float(invariants['trace']))}，行列式仍为 {_fmt(float(invariants['det']))}。"
            "同一个线性变换在不同坐标下表示不同，但不变量保持。"
        )
        steps = [
            f"基旋转角 θ = {_fmt(float(basis_angle))}°。",
            "构造 P = [[cosθ, -sinθ], [sinθ, cosθ]] 并求 P⁻¹。",
            "计算 B = P⁻¹AP，比较迹与行列式。",
        ]
    else:
        conclusion = "当前坐标基不可逆，无法构造 P⁻¹AP；没有显示逆矩阵或伪造结果。"
        steps = ["检查 P 的行列式是否为 0。", "换一个可逆的基角度后重新观察。"]
    return LearningResultCard(
        card_id=new_id("card"),
        title="换基后为什么迹和行列式不变？",
        conclusion=conclusion,
        solution=None,
        steps=steps,
        verification=_verification_from_checks(evaluation.get("checks", [])),
        source_refs=descriptor.source_refs,
        scope={"input_hash": frozen.input_hash, "basis_angle_deg": basis_angle},
        limitations=["A 与换基关系必须来自原稿或用户确认；旋转角是教学探针。"],
        next_actions=["换一个角度观察 B", "比较世界坐标中的 x 与 Ax"],
        input_hash=frozen.input_hash,
        request_hash=hash_json({"mode": "concept", "input_hash": frozen.input_hash}),
        task_id="",
        result_kind="explanation",
    )


def _generic_card(frozen: FrozenLearningContext, descriptor) -> LearningResultCard:
    node = frozen.node
    evaluation = evaluate_node(node, frozen.effective_values)
    result = evaluation["result"]
    metrics = result.get("metrics") if isinstance(result.get("metrics"), list) else []
    metric_text = "，".join(
        f"{metric.get('label')}={metric.get('value')}" for metric in metrics if isinstance(metric, Mapping)
    )
    text = str(result.get("text") or node.title)
    conclusion = metric_text or text or "当前内容可阅读，但没有可计算的数值结论。"
    return LearningResultCard(
        card_id=new_id("card"),
        title=node.title or "当前内容说明了什么？",
        conclusion=conclusion,
        solution=None,
        steps=[f"当前条件：{_values_text(frozen.effective_values, node)}。"],
        verification=_verification_from_checks(evaluation.get("checks", [])),
        source_refs=descriptor.source_refs,
        scope={
            "input_hash": frozen.input_hash,
            "values": {key: value for key, value in frozen.effective_values.items() if isinstance(value, (int, float, bool, str))},
        },
        limitations=["解释只对应当前条件；原稿事实与教学推断分别标注。"],
        next_actions=["改变一个参数观察结果", "查看原稿依据"],
        input_hash=frozen.input_hash,
        request_hash=hash_json({"mode": "concept", "input_hash": frozen.input_hash}),
        task_id="",
        result_kind="explanation",
    )


def build_concept_card(frozen: FrozenLearningContext) -> LearningResultCard:
    descriptor = descriptor_for_node(frozen.node, material_id=frozen.bundle.material_id, bundle=frozen.bundle)
    if descriptor.goal_id == "eigen_direction":
        return _eigen_card(frozen, descriptor)
    if descriptor.goal_id == "inverse_mapping":
        return _inverse_card(frozen, descriptor)
    if descriptor.goal_id == "change_of_basis":
        return _change_card(frozen, descriptor)
    return _generic_card(frozen, descriptor)


def build_change_card(
    frozen: FrozenLearningContext, baseline_values: Mapping[str, Any]
) -> LearningResultCard:
    """比较课件基准与当前练习条件；只解释实际发生的变化。"""

    descriptor = descriptor_for_node(frozen.node, material_id=frozen.bundle.material_id, bundle=frozen.bundle)
    current = build_concept_card(frozen)
    changed: list[str] = []
    for parameter in frozen.node.parameters:
        base = baseline_values.get(parameter.concept_id, parameter.default)
        now = frozen.effective_values.get(parameter.concept_id, parameter.default)
        if isinstance(base, (int, float)) and isinstance(now, (int, float)) and not isinstance(base, bool):
            if not math.isclose(float(base), float(now), rel_tol=1e-9, abs_tol=1e-12):
                changed.append(f"{parameter.label}：{_fmt(float(base))} → {_fmt(float(now))}")
    current.steps = [f"与课件基准相比：{'；'.join(changed)}。" if changed else "当前条件与课件基准一致。", *current.steps]
    current.title = "这次改动带来了什么变化？"
    current.request_hash = hash_json(
        {"mode": "change", "input_hash": frozen.input_hash, "baseline": dict(baseline_values)}
    )
    current.limitations = [
        "变化解释只对应当前练习条件；课件基准讲解不冒充已改参数后的图形解释。",
        *current.limitations,
    ]
    return current


def handle_learning_explain_task(
    db: Session,
    material: MaterialRecord,
    task: PptAiTaskRecord,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    context = LearningContext.model_validate(payload.get("context") or {})
    mode = str(payload.get("mode") or "concept")
    try:
        frozen = validate_learning_context(
            db, material=material, session_id=task.session_id, context=context
        )
    except LearningContextError as exc:
        raise ValueError(str(exc)) from exc
    if mode == "change":
        baseline = dict(frozen.branch.canonical_values or {})
        card = build_change_card(frozen, baseline)
    else:
        card = build_concept_card(frozen)
    card = card.model_copy(update={"task_id": task.id})
    return {
        "card": card.model_dump(mode="json"),
        "input_hash": frozen.input_hash,
        "mode": "change" if mode == "change" else "concept",
    }


__all__ = [
    "build_change_card",
    "build_concept_card",
    "handle_learning_explain_task",
]

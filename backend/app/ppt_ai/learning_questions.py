"""上下文提问与受限草案执行（``ppt-learning.1`` §5.4/§6.3）。

本轮不建设通用聊天命令：
- 解释问题直接返回确定性答案卡；
- 实验/求解问题只生成待确认草案，模型输出不能携带脚本、URL 或画布命令；
- 执行时重新验证上下文哈希，条件已改变则返回 stale，不偷偷套用旧条件。
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from sqlalchemy.orm import Session

from ..db.models import MaterialRecord
from ..db.ppt_ai_models import PptAiTaskRecord
from .evaluation import evaluate_node
from .experiments import handle_experiment_task
from .learning import descriptor_for_node
from .learning_context import (
    FrozenLearningContext,
    LearningContextError,
    validate_learning_context,
)
from .learning_explanations import build_change_card, build_concept_card
from .learning_types import (
    LearningActionDraft,
    LearningCondition,
    LearningContext,
    LearningReply,
    LearningResultCard,
    LearningVerification,
)
from .targets import handle_target_task
from .types import ExperimentRequest, TargetRequest, TargetSolution
from .util import hash_json, new_id, now_iso

ACTION_PREFIX = "act_"
ACTION_TTL = timedelta(hours=1)
_FORBIDDEN = ("脚本", "代码", "画布", "跳页", "播放", "直接修改", "改PPT", "改原稿")
_VECTOR_RE = re.compile(r"[\(（]\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)\s*[\)）]")
_NUMBER_RE = re.compile(r"-?\d+(?:\.\d+)?")


class LearningQuestionError(ValueError):
    pass


def _conditions(frozen: FrozenLearningContext) -> list[LearningCondition]:
    items: list[LearningCondition] = []
    for parameter in frozen.node.parameters:
        value = frozen.effective_values.get(parameter.concept_id, parameter.default)
        items.append(
            LearningCondition(
                concept_id=parameter.concept_id,
                label=parameter.label,
                value=value,
                origin_type=parameter.provenance.origin_type,
                note=parameter.provenance.evidence or parameter.provenance.inference,
            )
        )
    for key in sorted(frozen.effective_values):
        if key.startswith("teaching."):
            items.append(
                LearningCondition(
                    concept_id=key,
                    label=key,
                    value=frozen.effective_values[key],
                    origin_type="teaching",
                    note="教学探针，不声称原稿给出了该值。",
                )
            )
    return items


def _first_editable(frozen: FrozenLearningContext):
    descriptor = descriptor_for_node(frozen.node, material_id=frozen.bundle.material_id, bundle=frozen.bundle)
    editable = set(descriptor.editable_roles)
    for parameter in frozen.node.parameters:
        if parameter.type not in ("number", "integer"):
            continue
        if "parameters" in editable or parameter.id in ("v1", "v2", "basis_angle_deg"):
            return parameter
    return next(
        (parameter for parameter in frozen.node.parameters if parameter.type in ("number", "integer")),
        None,
    )


def _output_hint(frozen: FrozenLearningContext) -> str:
    result = evaluate_node(frozen.node, frozen.effective_values)["result"]
    metrics = result.get("metrics") if isinstance(result.get("metrics"), list) else []
    ids = [str(metric.get("id")) for metric in metrics if isinstance(metric, Mapping)]
    for preferred in ("ratio", "trace", "det", "value", "exact"):
        if preferred in ids:
            return preferred
    return ids[0] if ids else ""


def _reply(
    frozen: FrozenLearningContext,
    task: PptAiTaskRecord,
    question: str,
    *,
    state: str,
    answer_card: LearningResultCard | None = None,
    clarification: str = "",
    action_draft: LearningActionDraft | None = None,
) -> dict[str, Any]:
    request_hash = hash_json(
        {"question": question, "input_hash": frozen.input_hash, "draft_revision": frozen.context.draft_revision}
    )
    reply = LearningReply(
        reply_id=new_id("reply"),
        material_id=frozen.bundle.material_id,
        page_no=frozen.context.page_no,
        node_id=frozen.node.node_id,
        branch_id=frozen.branch.id,
        client_request_id=frozen.context.client_request_id,
        draft_revision=frozen.context.draft_revision,
        input_hash=frozen.input_hash,
        request_hash=request_hash,
        state=state,  # type: ignore[arg-type]
        answer_card=answer_card,
        clarification=clarification,
        action_draft=action_draft,
        task_id=task.id,
    )
    return reply.model_dump(mode="json")


def _explanation_reply(
    frozen: FrozenLearningContext, task: PptAiTaskRecord, question: str, mode: str
) -> dict[str, Any]:
    if mode == "change":
        card = build_change_card(frozen, dict(frozen.branch.canonical_values or {}))
    else:
        card = build_concept_card(frozen)
    card = card.model_copy(update={"task_id": task.id})
    return _reply(frozen, task, question, state="answered", answer_card=card)


def _target_draft(
    frozen: FrozenLearningContext, task: PptAiTaskRecord, question: str
) -> dict[str, Any]:
    vector = _VECTOR_RE.search(question)
    if vector is None:
        return _reply(
            frozen,
            task,
            question,
            state="needs_clarification",
            clarification="请给出目标向量 y，例如 y=(7,5)，再运行目标反求。",
        )
    target = [float(vector.group(1)), float(vector.group(2))]
    action = LearningActionDraft(
        action_id=f"{ACTION_PREFIX}{task.id}",
        kind="solve_target",
        context=frozen.context,
        summary=f"在冻结条件上求满足 Av=({target[0]:g}, {target[1]:g}) 的输入向量。",
        conditions=_conditions(frozen),
        added_conditions=[
            LearningCondition(
                concept_id="target.y",
                label="目标向量 y",
                value=target,
                origin_type="user_input",
                note="来自本次提问，不写回课件基准。",
            )
        ],
        execution_payload={
            "node_id": frozen.node.node_id,
            "output": "product",
            "target_value": 0.0,
            "target_vector": target,
            "variables": ["v1", "v2"],
            "tolerance": 1e-6,
        },
        created_at=now_iso(),
    )
    return _reply(frozen, task, question, state="action_ready", action_draft=action)


def _experiment_draft(
    frozen: FrozenLearningContext, task: PptAiTaskRecord, question: str
) -> dict[str, Any]:
    parameter = _first_editable(frozen)
    if parameter is None:
        return _reply(
            frozen,
            task,
            question,
            state="unsupported",
            clarification="当前内容没有可改变的数值参数；可以先阅读讲解或查看原稿。",
        )
    low = parameter.min if parameter.min is not None else float(parameter.default) - 5.0
    high = parameter.max if parameter.max is not None else float(parameter.default) + 5.0
    if high <= low:
        high = low + 1.0
    recipe = "sensitivity"
    if any(word in question for word in ("反例", "不成立", "违反")):
        recipe = "counterexample"
    elif any(word in question for word in ("对比", "比较", "差异")):
        recipe = "compare"
    action = LearningActionDraft(
        action_id=f"{ACTION_PREFIX}{task.id}",
        kind="run_experiment",
        context=frozen.context,
        summary=f"改变「{parameter.label}」并比较结果；其余条件保持当前冻结值。",
        conditions=_conditions(frozen),
        added_conditions=[
            LearningCondition(
                concept_id=parameter.concept_id,
                label=f"{parameter.label} 的搜索范围",
                value=[float(low), float(high)],
                origin_type="teaching",
                note="教学搜索范围，不改变原模型合法域。",
            )
        ],
        execution_payload={
            "question": question[:1000],
            "recipe_hint": recipe,
            "selection": {
                "node_id": frozen.node.node_id,
                "output": _output_hint(frozen),
            },
            "allowed_variables": [parameter.concept_id],
            "ranges": {parameter.concept_id: [float(low), float(high)]},
        },
        created_at=now_iso(),
    )
    return _reply(frozen, task, question, state="action_ready", action_draft=action)


def build_question_reply(
    frozen: FrozenLearningContext,
    task: PptAiTaskRecord,
    question: str,
    *,
    suggested_action: str | None = None,
) -> dict[str, Any]:
    text = question.strip()
    if any(word in text for word in _FORBIDDEN):
        return _reply(
            frozen,
            task,
            question,
            state="unsupported",
            clarification="本轮不支持通过提问直接修改原稿、当前画布、参数池或播放状态。",
        )
    if suggested_action == "explain":
        return _explanation_reply(frozen, task, text, "concept")
    if suggested_action == "solve_target":
        return _target_draft(frozen, task, text)
    if suggested_action in ("run_experiment", "compare", "counterexample"):
        return _experiment_draft(frozen, task, text)
    if ("求" in text or "反求" in text) and ("向量" in text or "Av" in text or "输入" in text):
        return _target_draft(frozen, task, text)
    if any(word in text for word in ("为什么", "解释", "意思", "原理", "理解", "区别", "是什么")):
        mode = "change" if any(word in text for word in ("变化", "改动", "这次", "调参")) else "concept"
        return _explanation_reply(frozen, task, text, mode)
    if any(word in text for word in ("如果", "换成", "试试", "改变", "拖动", "会怎样", "比较", "反例")):
        return _experiment_draft(frozen, task, text)
    return _reply(
        frozen,
        task,
        question,
        state="needs_clarification",
        clarification="可以问「为什么共线」「把向量换成 (1,0) 会怎样」或「已知 Av，求输入 v」。",
    )


def handle_learning_question_task(
    db: Session,
    material: MaterialRecord,
    task: PptAiTaskRecord,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    context = LearningContext.model_validate(payload.get("context") or {})
    question = str(payload.get("question") or "").strip()
    if not 1 <= len(question) <= 2000:
        raise LearningQuestionError("问题长度需为 1–2000 个字符")
    try:
        frozen = validate_learning_context(
            db, material=material, session_id=task.session_id, context=context
        )
    except LearningContextError as exc:
        raise LearningQuestionError(str(exc)) from exc
    reply = build_question_reply(
        frozen, task, question, suggested_action=payload.get("suggested_action")
    )
    return {
        "__status__": "succeeded",
        "__stage__": "learning_answered",
        "reply": reply,
        "input_hash": frozen.input_hash,
        "request_hash": reply["request_hash"],
    }


def _parse_time(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _find_action_task(db: Session, task: PptAiTaskRecord, action_id: str) -> PptAiTaskRecord:
    if not action_id.startswith(ACTION_PREFIX):
        raise LearningQuestionError("动作标识不属于已落库的学习问题")
    source_task_id = action_id[len(ACTION_PREFIX) :]
    row = db.get(PptAiTaskRecord, source_task_id)
    if (
        row is None
        or row.session_id != task.session_id
        or row.material_id != task.material_id
        or row.kind != "ai_learn_question"
    ):
        raise LearningQuestionError("动作草案不存在或不属于当前材料")
    result = row.result if isinstance(row.result, Mapping) else {}
    draft = result.get("reply", {}).get("action_draft") if isinstance(result.get("reply"), Mapping) else None
    if not isinstance(draft, Mapping) or draft.get("action_id") != action_id:
        raise LearningQuestionError("动作草案已失效，请重新提问")
    return row


def _target_card(
    frozen: FrozenLearningContext, request: TargetRequest, result: Mapping[str, Any]
) -> LearningResultCard:
    candidates = result.get("candidates") if isinstance(result.get("candidates"), list) else []
    solution: TargetSolution | None = None
    if candidates and isinstance(candidates[0], Mapping):
        raw_solution = candidates[0].get("solution")
        if isinstance(raw_solution, Mapping):
            solution = TargetSolution.model_validate(raw_solution)
        else:
            values = candidates[0].get("values")
            if isinstance(values, Mapping):
                selected = [values.get(name) for name in request.variables]
                if all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in selected):
                    solution = TargetSolution(
                        unknowns=request.variables,
                        values=[float(item) for item in selected],
                        classification="scalar_candidate",
                        verification=[
                            {
                                "label": "旧结果缺少显式解；请重新求解以核对",
                                "expected": "",
                                "actual": str(candidates[0].get("residual")),
                                "residual": candidates[0].get("residual"),
                                "status": "not_checked",
                            }
                        ],
                    )
    def number(value: Any) -> str:
        if value is None:
            return "—"
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return str(value)
        if abs(float(value) - round(float(value))) < 1e-9:
            return str(int(round(float(value))))
        return f"{float(value):.6g}"

    status = str(result.get("status") or "unknown")
    if status == "found":
        title = "目标反求：找到解"
        conclusion = (
            f"{solution.unknowns[0] if solution else '未知量'} = {number(solution.values[0]) if solution else '—'}，"
            f"残差 {number(result.get('residual'))}。"
            if solution is not None
            else "找到候选解，但旧结果缺少显式解；请重新求解。"
        )
    elif status == "multiple":
        title = "目标反求：存在多解"
        conclusion = (
            "线性方程组有无穷多解；下面给出一个可验证特解，解集未完全枚举。"
            if solution is not None
            else "存在多解，但没有可验证特解；请重新求解。"
        )
    elif status == "none_in_scope":
        title = "目标反求：范围内未找到"
        conclusion = "在声明范围或候选内没有找到满足目标的解；这不等于数学无解。"
    elif status == "infeasible_proven":
        title = "目标反求：无解"
        conclusion = "在明确方程条件下已验证不相容，未把伪逆结果当成精确解。"
    elif status == "timeout":
        title = "目标反求：超时"
        conclusion = "搜索超时；没有把未完成搜索表述为无解，可缩小范围后重试。"
    else:
        title = "目标反求：需要复核"
        conclusion = "当前求解状态未给出确定答案；请检查条件与范围后重试。"
    equations = list(solution.equations) if solution is not None else []
    verification = [
        LearningVerification(
            label=str(item.get("label") or "代回验证"),
            expected=str(item.get("expected") or ""),
            actual=str(item.get("actual") or ""),
            residual=item.get("residual") if isinstance(item.get("residual"), (int, float)) else None,
            status=item.get("status") if item.get("status") in ("pass", "fail", "not_checked") else "not_checked",
        )
        for item in (solution.verification if solution is not None else [])
    ]
    return LearningResultCard(
        card_id=new_id("card"),
        title=title,
        conclusion=conclusion,
        solution=solution,
        steps=[*equations, *([f"特殊说明：{solution.free_variables} 为自由变量。"] if solution and solution.free_variables else [])],
        verification=verification,
        source_refs=descriptor_for_node(frozen.node, material_id=frozen.bundle.material_id, bundle=frozen.bundle).source_refs,
        scope={"search_scope": result.get("search_scope"), "tolerance": request.tolerance},
        limitations=["有限搜索未发现不等于数学无解；多解仅展示一个特解。"],
        next_actions=["在原页继续调参", "保存这次探索"],
        input_hash=frozen.input_hash,
        request_hash=hash_json({"request": request.model_dump(mode="json"), "input_hash": frozen.input_hash}),
        task_id="",
        result_kind="target",
    )


def _experiment_card(
    frozen: FrozenLearningContext, question: str, result: Mapping[str, Any]
) -> LearningResultCard:
    status = str(result.get("status") or "unknown")
    status_text = {
        "found": "在声明范围内找到有差异的候选",
        "not_found_in_scope": "声明范围内未发现差异",
        "unknown": "结果未知",
        "timeout": "搜索超时",
        "infeasible_proven": "已证不可行",
    }.get(status, status)
    paths = result.get("paths") if isinstance(result.get("paths"), list) else []
    steps: list[str] = []
    for path in paths[:5]:
        if not isinstance(path, Mapping):
            continue
        label = str(path.get("label") or "")
        values = path.get("values") if isinstance(path.get("values"), Mapping) else {}
        geometry_text = ""
        try:
            values_for_node = {**frozen.effective_values, **values}
            evaluation = evaluate_node(frozen.node, values_for_node)["result"]
            geometry = evaluation.get("geometry") if isinstance(evaluation.get("geometry"), Mapping) else None
            if geometry:
                geometry_text = f"；{geometry.get('message')}"
        except (ValueError, TypeError):
            geometry_text = ""
        steps.append(f"{label}：输出 {path.get('output_value')}{geometry_text}")
    return LearningResultCard(
        card_id=new_id("card"),
        title="实验草案执行结果",
        conclusion=f"{status_text}。问题：{question[:300]}",
        solution=None,
        steps=steps,
        verification=[
            LearningVerification(
                label=str(check.get("id") or "检查"),
                expected="",
                actual=str(check.get("message") or ""),
                status=(
                    "pass"
                    if check.get("status") == "pass"
                    else "fail"
                    if check.get("status") == "fail"
                    else "not_checked"
                ),
            )
            for check in (result.get("checks") if isinstance(result.get("checks"), list) else [])
            if isinstance(check, Mapping)
        ],
        source_refs=descriptor_for_node(frozen.node, material_id=frozen.bundle.material_id, bundle=frozen.bundle).source_refs,
        scope={"used_scope": result.get("used_scope"), "stop_reason": result.get("stop_reason")},
        limitations=[
            "有限采样或候选只覆盖声明范围，不把“未发现”当作全局证明。",
            "执行产生独立候选分支；课件基准不变。",
        ],
        next_actions=["打开候选分支", "保存这次探索"],
        input_hash=frozen.input_hash,
        request_hash=hash_json({"question": question, "input_hash": frozen.input_hash}),
        task_id="",
        result_kind="experiment",
    )


def handle_learning_execute_task(
    db: Session,
    material: MaterialRecord,
    task: PptAiTaskRecord,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    action_id = str(payload.get("action_id") or "")
    context = LearningContext.model_validate(payload.get("context") or {})
    source_task = _find_action_task(db, task, action_id)
    source_result = source_task.result if isinstance(source_task.result, Mapping) else {}
    draft = source_result.get("reply", {}).get("action_draft")
    if not isinstance(draft, Mapping):
        raise LearningQuestionError("动作草案已失效，请重新提问")
    created = _parse_time(str(draft.get("created_at") or ""))
    if created is None or datetime.now(tz=timezone.utc) - created > ACTION_TTL:
        return {
            "__status__": "needs_review",
            "__stage__": "stale",
            "state": "stale",
            "reason": "动作草案已过期，请基于当前条件重新提问。",
        }
    draft_context = LearningContext.model_validate(draft.get("context") or {})
    if (
        draft_context.bundle_id != context.bundle_id
        or draft_context.bundle_revision != context.bundle_revision
        or draft_context.branch_id != context.branch_id
        or draft_context.branch_revision != context.branch_revision
        or draft_context.node_id != context.node_id
        or draft_context.input_values != context.input_values
    ):
        return {
            "__status__": "needs_review",
            "__stage__": "stale",
            "state": "stale",
            "reason": "条件已改变；旧草案未执行，请基于当前条件重新提问。",
        }
    try:
        frozen = validate_learning_context(
            db, material=material, session_id=task.session_id, context=context
        )
    except LearningContextError as exc:
        return {
            "__status__": "needs_review",
            "__stage__": "stale",
            "state": "stale",
            "reason": str(exc),
        }
    execution = draft.get("execution_payload") if isinstance(draft.get("execution_payload"), Mapping) else {}
    kind = str(draft.get("kind") or "")
    if kind == "solve_target":
        request = TargetRequest(
            node_id=str(execution.get("node_id") or frozen.node.node_id),
            output=str(execution.get("output") or "product"),
            target_value=float(execution.get("target_value") or 0.0),
            target_vector=[float(item) for item in execution.get("target_vector") or []],
            variables=[str(item) for item in execution.get("variables") or ["v1", "v2"]],
            tolerance=float(execution.get("tolerance") or 1e-6),
            operation_id=f"learn_{task.id}",
            expected_branch_revision=context.branch_revision,
        )
        outcome = handle_target_task(
            db,
            material,
            task,
            {
                "bundle_id": context.bundle_id,
                "branch_id": context.branch_id,
                "request": request.model_dump(mode="json"),
                "values": frozen.effective_values,
            },
        )
        if outcome.get("__status__") == "superseded":
            return {**outcome, "state": "stale"}
        raw_result = outcome.get("result") if isinstance(outcome.get("result"), Mapping) else {}
        card = _target_card(frozen, request, raw_result)
        card = card.model_copy(update={"task_id": task.id})
        return {
            "__status__": "succeeded",
            "__stage__": "learning_result",
            "state": "answered",
            "kind": "solve_target",
            "card": card.model_dump(mode="json"),
            "candidate_branch_id": outcome.get("branch_id"),
            "target_status": raw_result.get("status"),
        }
    if kind == "run_experiment":
        experiment_request = ExperimentRequest(
            question=str(execution.get("question") or "学习实验")[:1000],
            recipe_hint=execution.get("recipe_hint"),
            selection=execution.get("selection") or {"node_id": frozen.node.node_id},
            allowed_variables=[str(item) for item in execution.get("allowed_variables") or []],
            ranges={str(key): [float(value[0]), float(value[1])] for key, value in (execution.get("ranges") or {}).items()},
            expected_branch_revision=context.branch_revision,
            operation_id=f"learn_{task.id}",
        )
        outcome = handle_experiment_task(
            db,
            material,
            task,
            {
                "bundle_id": context.bundle_id,
                "branch_id": context.branch_id,
                "request": experiment_request.model_dump(mode="json"),
                "values": frozen.effective_values,
            },
        )
        if outcome.get("__status__") == "superseded":
            return {**outcome, "state": "stale"}
        from .store import get_experiment_row, experiment_from_row

        experiment_id = str(outcome.get("experiment_id") or "")
        raw_result: Mapping[str, Any] = {}
        if experiment_id:
            raw_result = experiment_from_row(
                get_experiment_row(db, experiment_id, task.session_id, material.id)
            ).result.model_dump(mode="json") if experiment_from_row(
                get_experiment_row(db, experiment_id, task.session_id, material.id)
            ).result else {}
        card = _experiment_card(frozen, experiment_request.question, raw_result)
        card = card.model_copy(update={"task_id": task.id})
        return {
            "__status__": "succeeded",
            "__stage__": "learning_result",
            "state": "answered",
            "kind": "run_experiment",
            "card": card.model_dump(mode="json"),
            "experiment_id": experiment_id,
            "candidate_branch_id": outcome.get("candidate_branch_id"),
            "experiment_status": raw_result.get("status") if isinstance(raw_result, Mapping) else None,
        }
    raise LearningQuestionError("动作类型未登记")


__all__ = [
    "LearningQuestionError",
    "build_question_reply",
    "handle_learning_execute_task",
    "handle_learning_question_task",
]

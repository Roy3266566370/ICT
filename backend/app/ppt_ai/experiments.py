"""问题驱动的补充实验：生成草案、有限搜索、独立候选分支。

- 原实验/原分支不改；新 experiment 有独立 experiment_id 与 branch_id。
- 搜索被转成登记 recipe + 目标谓词 + 有限候选计划，不让模型反复猜答案。
- ``not_found_in_scope`` / ``timeout`` / ``unknown`` 绝不显示成“已证明/无解”。
"""

from __future__ import annotations

import logging
import time
from typing import Any, Mapping, Sequence

from sqlalchemy.orm import Session

from ..db.models import MaterialRecord
from ..db.ppt_ai_models import PptAiTaskRecord
from ..settings import get_settings
from .branches import create_branch
from .evaluation import EvaluationError, evaluate_model, numeric_output
from .recipes import boundary, compare, counterexample, sensitivity
from .recipes.common import RecipeContext
from .store import get_branch_row, get_bundle, save_experiment
from .types import (
    Experiment,
    ExperimentCondition,
    ExperimentDraft,
    ExperimentRequest,
    ExperimentResult,
    FrozenContext,
    InteractionBundle,
    PlanReviewItem,
)
from .util import hash_json, new_id, now_iso, stable_id

logger = logging.getLogger(__name__)

RECIPES = {
    "compare": compare.run,
    "counterexample": counterexample.run,
    "boundary": boundary.run,
    "sensitivity": sensitivity.run,
}


def _infer_recipe(question: str, hint: str | None) -> str:
    if hint in RECIPES and hint != "counterexample":
        return hint
    if any(word in question for word in ("边界", "临界", "何时", "转折", "变化点", "分界")):
        return "boundary"
    if any(word in question for word in ("对比", "比较", "顺序", "差异", "哪个")):
        return "compare"
    return "sensitivity"


def _select_node(bundle: InteractionBundle, selection: Mapping[str, Any]):
    node_id = selection.get("node_id")
    if isinstance(node_id, str):
        for node in bundle.compiled.nodes:
            if node.node_id == node_id:
                return node
        raise EvaluationError(f"选中的节点不存在：{node_id}")
    concept_id = selection.get("concept_id")
    if isinstance(concept_id, str):
        for node in bundle.compiled.nodes:
            if any(parameter.concept_id == concept_id for parameter in node.parameters):
                return node
    for node in bundle.compiled.nodes:
        if any(parameter.type in ("number", "integer", "enum", "boolean") for parameter in node.parameters):
            return node
    raise EvaluationError("当前 bundle 没有可做补充实验的数值参数")


def _experimental_parameters(node) -> list:
    return [
        parameter
        for parameter in node.parameters
        if parameter.type in ("number", "integer", "enum", "boolean")
    ]


def _numeric_parameters(node) -> list:
    return [parameter for parameter in node.parameters if parameter.type in ("number", "integer")]


def _resolve_variables(node, requested: Sequence[str]) -> list[str]:
    numeric = _experimental_parameters(node)
    known = {parameter.concept_id for parameter in numeric} | {parameter.id for parameter in numeric}
    if requested:
        resolved = []
        for item in requested:
            if item not in known:
                raise EvaluationError(f"变量不可改变：{item}")
            parameter = next(
                (param for param in numeric if param.concept_id == item or param.id == item), None
            )
            if parameter is not None:
                resolved.append(parameter.concept_id)
        return list(dict.fromkeys(resolved))
    return [parameter.concept_id for parameter in numeric][:8]


def _effective_ranges(node, variables: Sequence[str], requested: Mapping[str, list[float]]) -> dict[str, list[float]]:
    ranges: dict[str, list[float]] = {}
    for concept_id in variables:
        parameter = next((param for param in node.parameters if param.concept_id == concept_id), None)
        if parameter is None or parameter.type not in ("number", "integer"):
            continue
        if concept_id in requested:
            ranges[concept_id] = [float(requested[concept_id][0]), float(requested[concept_id][1])]
            continue
        default = float(parameter.default) if isinstance(parameter.default, (int, float)) else 0.0
        low = float(parameter.min) if parameter.min is not None else default - 5.0
        high = float(parameter.max) if parameter.max is not None else default + 5.0
        if high - low > 40:
            low, high = default - 10.0, default + 10.0
        if high <= low:
            high = low + 1.0
        ranges[concept_id] = [low, high]
    return ranges


def _frozen_context(bundle: InteractionBundle, branch, selection: Mapping[str, Any]) -> FrozenContext:
    evaluation = branch.evaluation if isinstance(branch.evaluation, Mapping) else {}
    return FrozenContext(
        bundle_id=bundle.bundle_id,
        bundle_revision=bundle.bundle_revision,
        branch_id=branch.id,
        branch_revision=branch.revision,
        values=dict(branch.canonical_values or {}),
        evaluation_hash=str(evaluation.get("evaluation_hash") or "0" * 64),
        selection=dict(selection),
        source_projection=[
            {
                "node_id": node.node_id,
                "region_id": node.region_id,
                "page": node.source.page,
                "bbox": node.source.bbox.model_dump(mode="json"),
                "excerpt": node.source.excerpt,
                "title": node.title,
            }
            for node in bundle.compiled.nodes
        ],
    )


def generate_experiment(
    request: ExperimentRequest,
    source: FrozenContext,
    *,
    bundle: InteractionBundle,
) -> ExperimentDraft:
    recipe_id = _infer_recipe(request.question, request.recipe_hint)
    selection = dict(request.selection or source.selection)
    source = source.model_copy(update={"selection": selection})
    node = _select_node(bundle, selection)
    variables = _resolve_variables(node, request.allowed_variables)
    ranges = _effective_ranges(node, variables, request.ranges)
    output = str(selection.get("output") or "")
    predicate = counterexample.parse_predicate(request.question) if recipe_id == "counterexample" else None
    review_items: list[PlanReviewItem] = []
    status = "draft"
    notes: list[str] = []
    if recipe_id == "counterexample" and predicate is None:
        status = "needs_review"
        review_items.append(
            PlanReviewItem(
                item_id=stable_id("experiment", "predicate", request.question[:40]),
                kind="expression",
                prompt="问题中没有可核验的数值命题；请补充形如“输出 > 0 / = 4”的候选命题。",
                required=True,
            )
        )
        notes.append("未执行反例搜索：缺少明确谓词，避免把任意数值当成反例。")
    if not variables:
        status = "unsupported"
        notes.append("选中的节点没有可改变的数值变量。")
    for variable in variables:
        parameter = next((item for item in node.parameters if item.concept_id == variable), None)
        if parameter is not None and parameter.type in ("number", "integer") and parameter.provenance.origin_type in ("model_inference", "teaching"):
            review_items.append(
                PlanReviewItem(
                    item_id=stable_id("experiment", "range", variable),
                    kind="range",
                    prompt=f"确认「{parameter.label}」的搜索范围 {ranges.get(variable)}。",
                    required=False,
                )
            )
    original_conditions = []
    for parameter in _experimental_parameters(node):
        if parameter.concept_id not in variables:
            continue
        raw = source.values.get(parameter.concept_id, parameter.default)
        origin = parameter.provenance.origin_type
        original_conditions.append(
            ExperimentCondition(
                concept_id=parameter.concept_id,
                label=parameter.label,
                value=raw,  # type: ignore[arg-type]
                origin_type=origin if origin in ("native", "ocr", "user_input", "model_inference", "teaching", "supplement") else "model_inference",
                note="来自冻结分支的当前值。" if origin == "user_input" else "来自原稿/识别结果。",
            )
        )
    frozen = [
        parameter.concept_id
        for parameter in _experimental_parameters(node)
        if parameter.concept_id not in variables
    ]
    return ExperimentDraft(
        draft_id=new_id("experiment"),
        experiment_id=None,
        recipe_id=recipe_id,  # type: ignore[arg-type]
        question=request.question,
        context=source,
        original_conditions=original_conditions,
        supplement_conditions=[],
        variables=variables,
        frozen_variables=frozen,
        search_ranges=ranges,
        comparison_scale="所有路径使用同一输出口径、单位与坐标范围。",
        stop_rule="最多 3 条对照路径 / 200 个候选点；超时或预算耗尽即停止。",
        predicate=predicate,
        candidates=[],
        status=status,  # type: ignore[arg-type]
        review_items=review_items[:40],
        notes=notes,
        result_hash="",
    )


def run_experiment(
    draft: ExperimentDraft,
    registry: Any = None,
    *,
    bundle: InteractionBundle,
    base_values: Mapping[str, Any] | None = None,
) -> ExperimentResult:
    if draft.status == "unsupported":
        return ExperimentResult(
            status="unknown",
            recipe_id=draft.recipe_id,
            used_scope=draft.search_ranges,
            candidate_count=0,
            paths=[],
            checks=[{"id": "scope", "status": "fail", "message": "没有可改变的变量"}],
            result_hash=hash_json({"status": "unknown", "reason": "unsupported"}),
            explanation=draft.notes,
            stop_reason="unsupported",
        )
    node = _select_node(bundle, draft.context.selection)
    output = str(draft.context.selection.get("output") or "")
    values = dict(base_values or draft.context.values)

    def evaluate(candidate_values):
        # 全量求值再取目标节点：上游派生输出（det/trace 等）才能进入补充实验。
        snapshot = evaluate_model(bundle, candidate_values)
        result = snapshot.derived.get(node.node_id, {})
        return result, numeric_output(result, output)

    context = RecipeContext(
        node=node,
        base_values=values,
        allowed_variables=list(draft.variables),
        ranges=draft.search_ranges,
        output=output,
        tolerance=1e-6,
        deadline=time.monotonic() + float(get_settings().ppt_ai_task_timeout_s),
        evaluate=evaluate,
        predicate=draft.predicate,
    )
    outcome = RECIPES[draft.recipe_id](context)
    result_hash = hash_json(
        {
            "recipe": draft.recipe_id,
            "status": outcome.status,
            "scope": draft.search_ranges,
            "paths": [item.model_dump(mode="json") for item in outcome.paths],
            "predicate": outcome.predicate,
        }
    )
    checks = [
        {"id": "frozen_source", "status": "pass", "message": f"使用冻结分支 revision {draft.context.branch_revision}。"},
        *outcome.checks,
    ]
    return ExperimentResult(
        status=outcome.status,  # type: ignore[arg-type]
        recipe_id=draft.recipe_id,
        used_scope=draft.search_ranges,
        candidate_count=outcome.evaluated,
        paths=outcome.paths,
        checks=checks,
        result_hash=result_hash,
        branch_id=None,
        explanation=[*draft.notes, *outcome.notes],
        stop_reason=outcome.stop_reason or outcome.status,
    )


def handle_experiment_task(
    db: Session,
    material: MaterialRecord,
    task: PptAiTaskRecord,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    bundle_id = str(payload.get("bundle_id") or "")
    branch_id = str(payload.get("branch_id") or "")
    if not bundle_id or not branch_id:
        raise ValueError("缺少 bundle_id 或 branch_id")
    request = ExperimentRequest.model_validate(payload.get("request") or {})
    bundle = get_bundle(db, bundle_id, task.session_id, material.id)
    branch = get_branch_row(db, branch_id, task.session_id, material.id)
    if branch.bundle_id != bundle.bundle_id:
        raise ValueError("分支不属于该 bundle")
    if request.expected_branch_revision is not None and request.expected_branch_revision != branch.revision:
        return {
            "__status__": "superseded",
            "__stage__": "superseded",
            "reason": f"分支已更新（当前 revision={branch.revision}）；未基于旧值生成实验。",
        }
    context = _frozen_context(bundle, branch, request.selection)
    override = payload.get("values")
    if isinstance(override, Mapping) and override:
        context = context.model_copy(update={"values": {**context.values, **override}})
    try:
        draft = generate_experiment(request, context, bundle=bundle)
        if draft.status == "unsupported":
            result = run_experiment(draft, bundle=bundle)
        elif draft.status == "needs_review":
            result = run_experiment(draft, bundle=bundle)
        else:
            result = run_experiment(draft, bundle=bundle)
    except EvaluationError as exc:
        raise ValueError(str(exc)) from exc
    experiment_id = new_id("experiment")
    draft.experiment_id = experiment_id
    draft.result_hash = result.result_hash
    candidate_branch = create_branch(
        db,
        session_id=task.session_id,
        material_id=material.id,
        bundle=bundle,
        values=context.values,
        parent_branch_id=branch.id,
        status="candidate",
    )
    result.branch_id = candidate_branch.id
    experiment = Experiment(
        experiment_id=experiment_id,
        material_id=material.id,
        bundle_id=bundle.bundle_id,
        branch_id=candidate_branch.id,
        parent_branch_id=branch.id,
        question=request.question,
        recipe_id=draft.recipe_id,
        draft=draft,
        result=result,
        status="succeeded" if result.status not in ("unknown",) else "needs_review",
        created_at=now_iso(),
    )
    save_experiment(db, session_id=task.session_id, material_id=material.id, experiment=experiment)
    return {
        "__status__": "succeeded" if experiment.status == "succeeded" else "needs_review",
        "__stage__": "experiment_ready",
        "experiment_id": experiment_id,
        "recipe_id": draft.recipe_id,
        "result_status": result.status,
        "candidate_branch_id": candidate_branch.id,
        "branch_id": candidate_branch.id,
        "result_hash": result.result_hash,
        "path_count": len(result.paths),
        "stop_reason": result.stop_reason,
    }


__all__ = [
    "RECIPES",
    "generate_experiment",
    "handle_experiment_task",
    "run_experiment",
]

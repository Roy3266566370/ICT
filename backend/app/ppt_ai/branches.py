"""分支状态与事务：一次人工参数变更 = 一个 revision。

- 同一 branch 的写入使用 ``WHERE revision=expected`` 的条件更新；并发后提交者得到
  ``BranchConflict``（HTTP 409），不静默覆盖。
- 原始分支与新实验分支分开；创建候选分支不修改父分支。
- 求值快照与 branch revision 一起落库；所有视图读取同一 revision。
"""

from __future__ import annotations

import logging
from typing import Any, Mapping, Sequence

from sqlalchemy import update
from sqlalchemy.orm import Session

from ..db.ppt_ai_models import PptAiBranchRecord
from .evaluation import EvaluationError, evaluate_model
from .registry import REGISTRY
from .types import BranchState, CanonicalValues, InteractionBundle
from .util import now_iso

logger = logging.getLogger(__name__)


class BranchConflict(ValueError):
    pass


def _validate_values(bundle: InteractionBundle, values: CanonicalValues) -> None:
    for node in bundle.compiled.nodes:
        for parameter in node.parameters:
            if parameter.concept_id not in values:
                continue
            error = REGISTRY.validate_value(parameter, values[parameter.concept_id])
            if error:
                raise EvaluationError(error)


def _snapshot(
    bundle: InteractionBundle,
    values: CanonicalValues,
    revision: int,
    overrides: Mapping[str, Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    snapshot = evaluate_model(
        bundle, values, branch_revision=revision, overrides=overrides or None
    )
    return snapshot.model_dump(mode="json")


def _validate_overrides(
    bundle: InteractionBundle, overrides: Mapping[str, Mapping[str, Any]] | None
) -> dict[str, CanonicalValues]:
    cleaned: dict[str, CanonicalValues] = {}
    parameters = {
        parameter.concept_id: parameter
        for node in bundle.compiled.nodes
        for parameter in node.parameters
    }
    node_ids = {node.node_id for node in bundle.compiled.nodes}
    for node_id, values in (overrides or {}).items():
        if node_id not in node_ids:
            raise EvaluationError(f"未知节点：{node_id}")
        cleaned[node_id] = {}
        for concept_id, value in values.items():
            parameter = parameters.get(concept_id)
            if parameter is None:
                raise EvaluationError(f"未知概念：{concept_id}")
            error = REGISTRY.validate_value(parameter, value)
            if error:
                raise EvaluationError(error)
            cleaned[node_id][concept_id] = value
    return cleaned


def derived_kind(record: PptAiBranchRecord) -> str:
    """旧库回填兜底：根活动分支视为课件基准，其余为候选。"""

    kind = getattr(record, "kind", "") or ""
    if kind in ("baseline", "practice", "candidate"):
        return kind
    if record.parent_branch_id is None and record.status == "active":
        return "baseline"
    return "candidate"


def _clamp_value(bounds: Mapping[str, Any], value: Any) -> tuple[Any, str]:
    """把迁移值收敛到新参数定义域内；返回 (值, 调整说明)。

    同一概念可能被多个参数共享（合并后）：数值边界取所有参数的严格交集。
    """

    if bounds.get("type") not in ("number", "integer"):
        return value, ""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value, ""
    number = float(value)
    note = ""
    low = bounds.get("min")
    high = bounds.get("max")
    if low is not None and number < low:
        number = float(low)
        note = f"参数“{bounds.get('label', '')}”的值已收敛到合并后定义域下界 {low:g}。"
    if high is not None and number > high:
        number = float(high)
        note = f"参数“{bounds.get('label', '')}”的值已收敛到合并后定义域上界 {high:g}。"
    if not note:
        return value, ""
    return (int(round(number)) if bounds.get("type") == "integer" else number), note


def _concept_bounds(parameters: Sequence[Any]) -> dict[str, Any]:
    """聚合共享同一概念的多个参数的取值边界（合并后各页可保留不同范围）。"""

    bounds: dict[str, Any] = {"min": None, "max": None, "type": None, "label": ""}
    for parameter in parameters:
        if parameter.binding.mode == "linked":
            continue
        bounds["type"] = bounds["type"] or parameter.type
        bounds["label"] = bounds["label"] or parameter.label
        if parameter.min is not None:
            bounds["min"] = (
                parameter.min
                if bounds["min"] is None
                else max(bounds["min"], parameter.min)
            )
        if parameter.max is not None:
            bounds["max"] = (
                parameter.max
                if bounds["max"] is None
                else min(bounds["max"], parameter.max)
            )
    return bounds


def migrate_branch_state(
    new_bundle: InteractionBundle,
    concept_remap: Mapping[str, str],
    values: Mapping[str, Any],
    overrides: Mapping[str, Mapping[str, Any]] | None,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]], list[str]]:
    """把当前分支值/局部覆盖迁移到关联确认后的新 bundle。

    - 合并把参数概念 ID 改写到保留概念：旧 ID 的值跟随映射迁移；
      保留概念自身的值优先于被合并成员的值。
    - 派生绑定后的参数本地值是死数据（读取走派生值），一律丢弃；
      它的局部覆盖（“本页独立”）保留。
    - 超出合并后定义域的数值收敛到边界并记说明，不让确认因校验失败。
    """

    parameters_by_concept: dict[str, list[Any]] = {}
    for node in new_bundle.compiled.nodes:
        for parameter in node.parameters:
            parameters_by_concept.setdefault(parameter.concept_id, []).append(parameter)
    free_concepts = {
        concept_id
        for concept_id, parameters in parameters_by_concept.items()
        if any(parameter.binding.mode != "linked" for parameter in parameters)
    }
    notes: list[str] = []
    migrated: dict[str, Any] = {}

    def accept(concept_id: str, value: Any) -> None:
        if concept_id not in free_concepts or concept_id in migrated:
            return
        bounds = _concept_bounds(parameters_by_concept.get(concept_id, []))
        migrated[concept_id], note = _clamp_value(bounds, value)
        if note:
            notes.append(note)

    # 第一轮：保留概念自身的值优先。
    for concept_id, value in values.items():
        if concept_remap.get(concept_id, concept_id) != concept_id:
            continue
        accept(concept_id, value)
    # 第二轮：被合并改写 ID 的成员值迁移到保留概念。
    for concept_id, value in values.items():
        target = concept_remap.get(concept_id)
        if target is None or target == concept_id:
            continue
        accept(target, value)

    migrated_overrides: dict[str, dict[str, Any]] = {}
    for node in new_bundle.compiled.nodes:
        per_node = (overrides or {}).get(node.node_id)
        if not per_node:
            continue
        node_parameters = {parameter.concept_id: parameter for parameter in node.parameters}
        cleaned: dict[str, Any] = {}
        for concept_id, value in per_node.items():
            target = concept_remap.get(concept_id, concept_id)
            parameter = node_parameters.get(target)
            if parameter is None:
                notes.append(f"第 {node.source.page} 页的局部覆盖已随关联调整移除。")
                continue
            bounds = _concept_bounds([parameter])
            cleaned[target], note = _clamp_value(bounds, value)
            if note:
                notes.append(note)
        if cleaned:
            migrated_overrides[node.node_id] = cleaned
    return migrated, migrated_overrides, notes


def to_state(record: PptAiBranchRecord) -> BranchState:
    return BranchState(
        branch_id=record.id,
        bundle_id=record.bundle_id,
        material_id=record.material_id,
        revision=record.revision,
        status=record.status,  # type: ignore[arg-type]
        kind=derived_kind(record),  # type: ignore[arg-type]
        title=getattr(record, "title", "") or "",
        parent_branch_id=record.parent_branch_id,
        canonical_values=record.canonical_values or {},
        overrides=getattr(record, "overrides_json", None) or {},
        evaluation=record.evaluation,
        learning=getattr(record, "learning_json", None) or {},
        updated_at=record.updated_at,
    )


def create_branch(
    db: Session,
    *,
    session_id: str,
    material_id: str,
    bundle: InteractionBundle,
    values: Mapping[str, Any] | None = None,
    parent_branch_id: str | None = None,
    status: str = "active",
    kind: str | None = None,
    title: str = "",
    learning: Mapping[str, Any] | None = None,
    overrides: Mapping[str, Mapping[str, Any]] | None = None,
) -> PptAiBranchRecord:
    merged = dict(bundle.seed_values)
    if values:
        _validate_values(bundle, dict(values))
        merged.update(values)
    snapshot = _snapshot(bundle, merged, 1, overrides)
    resolved_kind = kind or (
        "candidate"
        if status == "candidate"
        else "baseline"
        if parent_branch_id is None
        else "candidate"
    )
    if resolved_kind not in ("baseline", "practice", "candidate"):
        raise ValueError(f"未知分支用途：{resolved_kind}")
    created = now_iso()
    record = PptAiBranchRecord(
        id=f"brn_{__import__('secrets').token_hex(12)}",
        session_id=session_id,
        material_id=material_id,
        bundle_id=bundle.bundle_id,
        parent_branch_id=parent_branch_id,
        revision=1,
        status=status,
        kind=resolved_kind,
        title=(title or "")[:200],
        canonical_values=merged,
        evaluation=snapshot,
        overrides_json=dict(overrides or {}),
        learning_json=dict(learning or {}),
        applied_operations=[],
        created_at=created,
        updated_at=created,
    )
    db.add(record)
    db.flush()
    return record


def patch_branch(
    db: Session,
    record: PptAiBranchRecord,
    bundle: InteractionBundle,
    *,
    expected_revision: int,
    operation_id: str,
    values: Mapping[str, Any],
    overrides: Mapping[str, Mapping[str, Any]] | None = None,
) -> PptAiBranchRecord:
    """人工参数变更；同一 operation_id 幂等，不重复增加 revision。"""

    if operation_id in (record.applied_operations or []):
        return record
    if int(expected_revision) != int(record.revision):
        raise BranchConflict(f"分支已在其他窗口更新（当前 revision={record.revision}）")
    merged = dict(record.canonical_values or {})
    _validate_values(bundle, dict(values))
    merged.update(values)
    cleaned_overrides = (
        _validate_overrides(bundle, overrides)
        if overrides is not None
        else dict(getattr(record, "overrides_json", None) or {})
    )
    new_revision = record.revision + 1
    snapshot = _snapshot(bundle, merged, new_revision, cleaned_overrides)
    operations = (list(record.applied_operations or []) + [operation_id])[-100:]
    updated_at = now_iso()
    result = db.execute(
        update(PptAiBranchRecord)
        .where(
            PptAiBranchRecord.id == record.id,
            PptAiBranchRecord.revision == expected_revision,
        )
        .values(
            revision=new_revision,
            canonical_values=merged,
            overrides_json=cleaned_overrides,
            evaluation=snapshot,
            applied_operations=operations,
            updated_at=updated_at,
        )
    )
    if result.rowcount == 0:
        db.rollback()
        raise BranchConflict("分支已在其他窗口更新，请重新载入后再提交")
    db.commit()
    db.refresh(record)
    logger.info("PPT AI 分支更新：%s revision=%d operation=%s", record.id, record.revision, operation_id)
    return record


def branch_hash(record: PptAiBranchRecord) -> str:
    evaluation = record.evaluation if isinstance(record.evaluation, Mapping) else {}
    return str(evaluation.get("evaluation_hash") or "")


def bundle_for_branch(db: Session, record: PptAiBranchRecord) -> InteractionBundle:
    from .store import get_bundle

    return get_bundle(db, record.bundle_id, record.session_id, record.material_id)


def branch_state_from_values(bundle: InteractionBundle, values: CanonicalValues) -> dict[str, Any]:
    snapshot = evaluate_model(bundle, values)
    return snapshot.model_dump(mode="json")


__all__ = [
    "BranchConflict",
    "branch_hash",
    "branch_state_from_values",
    "bundle_for_branch",
    "create_branch",
    "migrate_branch_state",
    "patch_branch",
    "to_state",
]

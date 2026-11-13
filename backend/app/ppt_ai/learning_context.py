"""学习上下文校验与冻结（``ppt-learning.1`` §5.1）。

服务端不信任前端自报的版本或哈希：每次提问、求解或保存练习都重新核对
文档版本、bundle、branch、节点/区域身份与参数合法域，再用统一哈希工具复算
``input_hash``。前端只负责收集草稿值，不能自行定义权威条件。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping

from sqlalchemy.orm import Session

from ..db.models import MaterialRecord
from ..db.ppt_ai_models import PptAiBranchRecord
from ..documents.store import read_document
from .evaluation import EvaluationError, evaluate_model
from .learning_types import LearningContext
from .registry import REGISTRY
from .store import get_branch_row, get_bundle
from .types import CanonicalValue, CanonicalValues, CompiledNode, InteractionBundle
from .util import hash_json


class LearningContextError(ValueError):
    """上下文不合法；``code`` 供路由映射到 409/422。"""

    def __init__(self, message: str, *, code: str = "INVALID_CONTEXT", stale: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.stale = stale


@dataclass(frozen=True, slots=True)
class FrozenLearningContext:
    context: LearningContext
    bundle: InteractionBundle
    branch: PptAiBranchRecord
    node: CompiledNode
    effective_values: CanonicalValues
    input_hash: str
    document_revision: int


def document_revision_for(material_id: str, fallback: int = 0) -> int:
    try:
        document = read_document(material_id)
        if isinstance(document, Mapping) and isinstance(document.get("revision"), int):
            return int(document["revision"])
    except (OSError, ValueError):
        pass
    return int(fallback)


def _hash_payload(context: LearningContext) -> dict[str, Any]:
    return {
        "contract_version": context.contract_version,
        "document_revision": context.document_revision,
        "source_hash": context.source_hash,
        "bundle_id": context.bundle_id,
        "bundle_revision": context.bundle_revision,
        "node_id": context.node_id,
        "branch_id": context.branch_id,
        "branch_revision": context.branch_revision,
        "draft_revision": context.draft_revision,
        "input_values": context.input_values,
    }


def build_learning_input_hash(context: LearningContext) -> str:
    """权威哈希：字段与排序固定；不包含时间戳、展示文案或客户端请求 ID。"""

    return hash_json(_hash_payload(context))


def _node_parameter(node: CompiledNode, key: str):
    return next(
        (
            parameter
            for parameter in node.parameters
            if parameter.concept_id == key or parameter.id == key
        ),
        None,
    )


def _validate_values(node: CompiledNode, values: Mapping[str, Any]) -> CanonicalValues:
    known = {parameter.concept_id for parameter in node.parameters}
    resolved: CanonicalValues = {}
    for key, value in values.items():
        parameter = _node_parameter(node, key)
        if parameter is not None:
            error = REGISTRY.validate_value(parameter, value)
            if error:
                raise LearningContextError(error, code="INVALID_VALUE")
            resolved[parameter.concept_id] = value
            continue
        if key.startswith("teaching."):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(
                float(value)
            ):
                raise LearningContextError(f"教学探针 {key} 必须是有限数值", code="INVALID_VALUE")
            resolved[key] = float(value)
            continue
        if key not in known:
            raise LearningContextError(f"未知学习参数：{key}", code="INVALID_VALUE")
    return resolved


def validate_learning_context(
    db: Session,
    *,
    material: MaterialRecord,
    session_id: str,
    context: LearningContext,
) -> FrozenLearningContext:
    bundle = get_bundle(db, context.bundle_id, session_id, material.id)
    if bundle.bundle_revision != context.bundle_revision:
        raise LearningContextError(
            f"bundle 已更新（当前 revision={bundle.bundle_revision}）",
            code="STALE_CONTEXT",
            stale=True,
        )
    if bundle.source_hash != context.source_hash:
        raise LearningContextError(
            "来源内容已变化，请重新准备后再提问", code="STALE_CONTEXT", stale=True
        )
    current_revision = document_revision_for(material.id, fallback=bundle.source_revision)
    if context.document_revision != current_revision:
        raise LearningContextError(
            f"文档已更新（当前 revision={current_revision}），请重新载入",
            code="STALE_CONTEXT",
            stale=True,
        )
    branch = get_branch_row(db, context.branch_id, session_id, material.id)
    if branch.bundle_id != bundle.bundle_id:
        raise LearningContextError("分支不属于该 bundle", code="INVALID_CONTEXT")
    if branch.revision != context.branch_revision:
        raise LearningContextError(
            f"分支已更新（当前 revision={branch.revision}）；请基于新条件继续",
            code="STALE_CONTEXT",
            stale=True,
        )
    node = next((item for item in bundle.compiled.nodes if item.node_id == context.node_id), None)
    if node is None:
        raise LearningContextError("学习节点不存在", code="INVALID_CONTEXT")
    if node.region_id != context.region_id:
        raise LearningContextError("节点与区域身份不一致", code="INVALID_CONTEXT")
    if node.source.page != context.page_no:
        raise LearningContextError("节点不属于当前页", code="INVALID_CONTEXT")
    if node.operator_id == "explain.text" and context.input_values:
        raise LearningContextError("说明型内容不接受可调参数", code="INVALID_VALUE")
    effective = dict(branch.canonical_values or {})
    effective.update(_validate_values(node, context.input_values))
    # 学习节点可能引用上游派生输出；冻结前按拓扑求值一次并解出本节点的链接参数，
    # 避免后续直接 evaluate_node 时退回到参数默认值。
    try:
        snapshot = evaluate_model(
            bundle,
            effective,
            overrides=getattr(branch, "overrides_json", None) or None,
        )
        effective.update(snapshot.derived_values)
        for parameter in node.parameters:
            binding = parameter.binding
            if binding.mode == "linked" and binding.concept_id in snapshot.derived_values:
                value = snapshot.derived_values[binding.concept_id]
                factor = float(binding.factor or 1.0)
                if factor != 1.0 and isinstance(value, (int, float)) and not isinstance(value, bool):
                    value = value * factor
                elif factor != 1.0 and isinstance(value, list):
                    value = [
                        [cell * factor for cell in row] if isinstance(row, list) else row * factor
                        for row in value
                        if isinstance(row, (int, float, list))
                    ]
                effective[parameter.concept_id] = value
    except (EvaluationError, ValueError, TypeError):
        # 求值失败不阻断上下文校验；后续学习步骤会显式报告无定义。
        pass
    computed = build_learning_input_hash(context)
    if context.input_hash is not None and context.input_hash != computed:
        raise LearningContextError(
            "条件已改变，旧哈希不再对应当前参数；请重新提交", code="STALE_CONTEXT", stale=True
        )
    return FrozenLearningContext(
        context=context,
        bundle=bundle,
        branch=branch,
        node=node,
        effective_values=effective,
        input_hash=computed,
        document_revision=current_revision,
    )


__all__ = [
    "FrozenLearningContext",
    "LearningContextError",
    "build_learning_input_hash",
    "document_revision_for",
    "validate_learning_context",
]

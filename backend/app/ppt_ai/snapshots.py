"""发布/离线冻结：读取一个选定的完整 bundle + branch 快照，禁止拼接“各表最新”。

公开投影只包含教学内容、已确认关系、分支当前值、实验与验收摘要；不带 session、
material_id、文件系统路径、模型诊断日志或未验收的专用视图程序。
"""

from __future__ import annotations

import logging
from typing import Any, Mapping

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import MaterialRecord
from ..db.ppt_ai_models import (
    PptAiArtifactRecord,
    PptAiBranchRecord,
    PptAiBundleRecord,
    PptAiExperimentRecord,
    PptAiValidationReportRecord,
)
from ..settings import get_settings
from . import REGISTRY_VERSION
from .contracts import validate_contract
from .evaluation import KERNEL_VERSION
from .store import baseline_branch_row, get_branch_row, get_bundle, latest_bundle_row
from .types import FrozenInteractionSnapshot
from .util import hash_json, new_id, now_iso

logger = logging.getLogger(__name__)

SNAPSHOT_VERSION = "ppt-ai.frozen.2"
PUBLIC_RUNTIME_VERSION = "ppt-ai.runtime.1"
MAX_ARTIFACT_BYTES = 8 * 1024 * 1024


class SnapshotConflict(ValueError):
    pass


def _public_anchor(anchor: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in anchor.items() if key != "material_id"}


def _public_graph_node(node: Mapping[str, Any]) -> dict[str, Any]:
    result = dict(node)
    source = result.get("source")
    if isinstance(source, Mapping):
        result["source"] = _public_anchor(source)
    return result


def _public_bundle(bundle, node_ids: set[str] | None = None) -> dict[str, Any]:
    graph = bundle.graph
    compiled = bundle.compiled.model_dump(mode="json")
    if node_ids is not None:
        compiled["nodes"] = [
            node for node in compiled.get("nodes", []) if node.get("node_id") in node_ids
        ]
        compiled["order"] = [item for item in compiled.get("order", []) if item in node_ids]
    for node in compiled.get("nodes", []):
        if not isinstance(node, dict):
            continue
        if isinstance(node.get("source"), Mapping):
            node["source"] = _public_anchor(node["source"])
        for parameter in node.get("parameters", []):
            if isinstance(parameter, dict) and isinstance(parameter.get("source"), Mapping):
                parameter["source"] = _public_anchor(parameter["source"])
    allowed_concepts = {
        parameter.get("concept_id")
        for node in compiled.get("nodes", [])
        for parameter in node.get("parameters", [])
    }
    graph_nodes = [
        _public_graph_node(node.model_dump(mode="json"))
        for node in graph.nodes
        if node_ids is None or node.source.node_id in node_ids
    ]
    relations = [
        relation.model_dump(mode="json")
        for relation in graph.relations
        if relation.review_status == "confirmed"
        and all(concept in allowed_concepts for concept in relation.outputs)
    ]
    return {
        "bundle_revision": bundle.bundle_revision,
        "schema_version": bundle.schema_version,
        "source_revision": bundle.source_revision,
        "source_hash": bundle.source_hash,
        "registry_version": bundle.registry_version,
        "content_hash": bundle.content_hash,
        "compiled": compiled,
        "seed_values": bundle.seed_values,
        "graph": {
            "nodes": graph_nodes,
            "relations": relations,
            "graph_revision": graph.graph_revision,
        },
    }


def _public_branch(branch) -> dict[str, Any]:
    evaluation = branch.evaluation if isinstance(branch.evaluation, Mapping) else {}
    return {
        "branch_id": branch.id,
        "revision": branch.revision,
        "kind": getattr(branch, "kind", "candidate") or "candidate",
        "title": getattr(branch, "title", "") or "",
        "canonical_values": branch.canonical_values,
        "overrides": getattr(branch, "overrides_json", None) or {},
        "evaluation": {
            "evaluation_hash": evaluation.get("evaluation_hash"),
            "input_hash": evaluation.get("input_hash"),
            "branch_revision": evaluation.get("branch_revision"),
            "derived": evaluation.get("derived"),
            "derived_values": evaluation.get("derived_values", {}),
            "checks": evaluation.get("checks", []),
            "violations": evaluation.get("violations", []),
            "stop_reason": evaluation.get("stop_reason"),
            "kernel_version": evaluation.get("kernel_version"),
        },
        "updated_at": branch.updated_at,
    }


def _experiments(
    db: Session, bundle_id: str, experiment_ids: list[str] | None = None
) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(PptAiExperimentRecord)
        .where(PptAiExperimentRecord.bundle_id == bundle_id)
        .order_by(PptAiExperimentRecord.created_at.asc())
        .limit(100)
    ).all()
    if experiment_ids is not None:
        allowed = set(experiment_ids)
        rows = [row for row in rows if row.id in allowed]
    items = []
    for row in rows:
        draft = row.draft if isinstance(row.draft, Mapping) else {}
        result = row.result if isinstance(row.result, Mapping) else None
        items.append(
            {
                "experiment_id": row.id,
                "recipe_id": row.recipe_id,
                "question": row.question[:1000],
                "status": row.status,
                "search_ranges": draft.get("search_ranges", {}),
                "supplement_conditions": [
                    item for item in draft.get("supplement_conditions", []) if isinstance(item, Mapping)
                ],
                "result": {
                    "status": result.get("status"),
                    "used_scope": result.get("used_scope"),
                    "paths": [
                        {
                            "label": path.get("label"),
                            "values": path.get("values"),
                            "output_value": path.get("output_value"),
                            "witness": path.get("witness"),
                        }
                        for path in result.get("paths", [])
                        if isinstance(path, Mapping)
                    ][:20],
                    "checks": result.get("checks", [])[:20],
                    "result_hash": result.get("result_hash"),
                    "explanation": result.get("explanation", [])[:15],
                    "stop_reason": result.get("stop_reason"),
                }
                if isinstance(result, Mapping)
                else None,
            }
        )
    return items


def _artifacts(db: Session, bundle_id: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows = db.scalars(
        select(PptAiArtifactRecord)
        .where(PptAiArtifactRecord.bundle_id == bundle_id)
        .order_by(PptAiArtifactRecord.created_at.asc())
        .limit(50)
    ).all()
    accepted: list[dict[str, Any]] = []
    manifest: list[dict[str, Any]] = []
    total = 0
    for row in rows:
        encoded = (len(row.program.encode("utf-8")) + len(str(row.ast).encode("utf-8")))
        if row.acceptance_status != "accepted":
            manifest.append(
                {
                    "artifact_id": row.id,
                    "type": "generated_view",
                    "status": row.acceptance_status,
                    "offline_supported": False,
                    "note": "未通过隔离验收，公开分享与离线导出不包含该试验视图。",
                }
            )
            continue
        total += encoded
        if total > MAX_ARTIFACT_BYTES:
            raise SnapshotConflict("新增视图资源超过 8MB 上限，暂不能冻结/导出")
        accepted.append(
            {
                "artifact_id": row.id,
                "content_hash": row.content_hash,
                "view_contract_version": row.view_contract_version,
                "program": row.program,
                "ast": row.ast,
                "supported_interactions": row.supported_interactions,
                "offline_supported": bool(row.offline_supported),
                "isolation": {
                    "iframe_sandbox": row.isolation.get("iframe_sandbox"),
                    "opaque_origin": row.isolation.get("opaque_origin"),
                    "worker": row.isolation.get("worker"),
                    "timeout_ms": row.isolation.get("timeout_ms"),
                    "max_nodes": row.isolation.get("max_nodes"),
                    "node_id": row.isolation.get("node_id"),
                },
                "acceptance_status": "accepted",
            }
        )
        manifest.append(
            {
                "artifact_id": row.id,
                "type": "generated_view",
                "status": "accepted",
                "offline_supported": bool(row.offline_supported),
                "content_hash": row.content_hash,
                "bytes": encoded,
            }
        )
    return accepted, manifest


def _reports(db: Session, bundle_id: str) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(PptAiValidationReportRecord)
        .where(PptAiValidationReportRecord.bundle_id == bundle_id)
        .order_by(PptAiValidationReportRecord.created_at.desc())
        .limit(10)
    ).all()
    return [
        {
            "status": row.status,
            "summary": (row.report or {}).get("summary", {}),
            "bundle_hash": row.bundle_hash,
            "branch_hash": row.branch_hash,
            "kernel_version": row.kernel_version,
            "runtime_version": row.runtime_version,
            "browser": {
                "status": (row.report or {}).get("browser", {}).get("status"),
                "viewport": (row.report or {}).get("browser", {}).get("viewport"),
            },
            "created_at": row.created_at,
            "stale": row.stale,
        }
        for row in rows
    ]


def freeze_interactions(
    db: Session,
    *,
    material: MaterialRecord,
    session_id: str,
    bundle_id: str | None = None,
    branch_id: str | None = None,
    expected_revision: int | None = None,
    expected_bundle_revision: int | None = None,
    learning_item_ids: list[str] | None = None,
    experiment_ids: list[str] | None = None,
    capabilities: Mapping[str, Any] | None = None,
) -> FrozenInteractionSnapshot | None:
    """冻结选定 bundle/branch；没有新交互时返回 ``None``（旧材料保持原行为）。

    默认选择 ``kind=baseline`` 的课件基准；不再取最新候选分支。
    """

    if bundle_id is None:
        bundle_row = latest_bundle_row(db, session_id, material.id)
        if bundle_row is None:
            return None
        bundle_id = bundle_row.id
    else:
        bundle_row = db.get(PptAiBundleRecord, bundle_id)
        if bundle_row is None or bundle_row.session_id != session_id or bundle_row.material_id != material.id:
            raise SnapshotConflict("bundle 不存在或不属于当前材料")
    if expected_bundle_revision is not None and expected_bundle_revision != bundle_row.bundle_revision:
        raise SnapshotConflict(f"bundle 已更新（当前 revision={bundle_row.bundle_revision}）")
    bundle = get_bundle(db, bundle_id, session_id, material.id)
    if branch_id is None:
        branch_row = baseline_branch_row(db, bundle.bundle_id, session_id, material.id)
        if branch_row is None:
            return None
    else:
        branch_row = get_branch_row(db, branch_id, session_id, material.id)
    if branch_row.bundle_id != bundle.bundle_id:
        raise SnapshotConflict("分支不属于选定 bundle")
    if expected_revision is not None and expected_revision != branch_row.revision:
        raise SnapshotConflict(f"分支已更新（当前 revision={branch_row.revision}）")
    evaluation = branch_row.evaluation if isinstance(branch_row.evaluation, Mapping) else {}
    branch_hash = str(evaluation.get("evaluation_hash") or hash_json(branch_row.canonical_values))
    artifacts, artifact_manifest = _artifacts(db, bundle.bundle_id)
    reports = _reports(db, bundle.bundle_id)
    selected_nodes = [node for node in bundle.compiled.nodes if learning_item_ids is None or node.node_id in set(learning_item_ids)]
    selected_node_ids = {node.node_id for node in selected_nodes}
    public_sources = [
        {
            "page": node.source.page,
            "node_id": node.source.node_id,
            "element_id": node.source.element_id,
            "bbox": node.source.bbox.model_dump(mode="json"),
            "excerpt": node.source.excerpt,
            "semantic_content_hash": node.source.semantic_content_hash,
            "title": node.title,
            "region_id": node.region_id,
        }
        for node in selected_nodes
    ]
    from .learning import descriptor_for_node
    from .learning_context import FrozenLearningContext, build_learning_input_hash
    from .learning_explanations import build_concept_card
    from .learning_types import LearningContext

    learning_payload = []
    for node in selected_nodes:
        descriptor = descriptor_for_node(node, material_id=material.id, bundle=bundle)
        item = descriptor.model_dump(mode="json")
        item["node_id"] = node.node_id
        item["region_id"] = node.region_id
        context = LearningContext(
            document_revision=bundle.source_revision,
            source_hash=bundle.source_hash,
            bundle_id=bundle.bundle_id,
            bundle_revision=bundle.bundle_revision,
            page_no=node.source.page,
            node_id=node.node_id,
            region_id=node.region_id,
            branch_id=branch_row.id,
            branch_revision=branch_row.revision,
            draft_revision=0,
            client_request_id="freeze",
            input_values={},
            input_hash=None,
        )
        frozen_learning = FrozenLearningContext(
            context=context,
            bundle=bundle,
            branch=branch_row,
            node=node,
            effective_values=dict(branch_row.canonical_values or {}),
            input_hash=build_learning_input_hash(context),
            document_revision=bundle.source_revision,
        )
        item["packaged_explanation"] = build_concept_card(frozen_learning).model_copy(
            update={"task_id": ""}
        ).model_dump(mode="json")
        learning_payload.append(item)
    resource_manifest = [
        {
            "id": "compiled_nodes",
            "type": "view_contract",
            "count": len(selected_nodes),
            "version": bundle.compiled.view_contract_version,
        },
        *artifact_manifest,
    ]
    frozen_at = now_iso()
    payload = {
        "snapshot_version": SNAPSHOT_VERSION,
        "frozen_at": frozen_at,
        "document_revision": bundle.source_revision,
        "bundle_id": bundle.bundle_id,
        "bundle_revision": bundle.bundle_revision,
        "bundle_hash": hash_json(bundle.model_dump(mode="json")),
        "branch_id": branch_row.id,
        "branch_revision": branch_row.revision,
        "branch_hash": branch_hash,
        "runtime_version": PUBLIC_RUNTIME_VERSION,
        "kernel_version": KERNEL_VERSION,
        "registry_version": REGISTRY_VERSION,
        "bundle": _public_bundle(bundle, selected_node_ids if learning_item_ids is not None or experiment_ids is not None else None),
        "branch": _public_branch(branch_row),
        "experiments": _experiments(db, bundle.bundle_id, experiment_ids),
        "artifacts": artifacts,
        "reports": reports,
        "public_sources": public_sources[:500],
        "resource_manifest": resource_manifest,
        "learning": learning_payload,
        "capabilities": dict(capabilities or {}),
    }
    content_hash = hash_json(payload)
    snapshot = FrozenInteractionSnapshot(
        snapshot_version=SNAPSHOT_VERSION,  # type: ignore[arg-type]
        frozen_at=frozen_at,
        document_revision=bundle.source_revision,
        bundle_id=bundle.bundle_id,
        bundle_revision=bundle.bundle_revision,
        bundle_hash=payload["bundle_hash"],
        branch_id=branch_row.id,
        branch_revision=branch_row.revision,
        branch_hash=branch_hash,
        runtime_version=PUBLIC_RUNTIME_VERSION,
        kernel_version=KERNEL_VERSION,
        registry_version=REGISTRY_VERSION,
        bundle=payload["bundle"],
        branch=payload["branch"],
        experiments=payload["experiments"],
        artifacts=payload["artifacts"],
        reports=payload["reports"],
        public_sources=payload["public_sources"],
        resource_manifest=payload["resource_manifest"],
        learning=payload["learning"],
        capabilities=payload["capabilities"],
        content_hash=content_hash,
    )
    logger.info(
        "PPT AI 冻结：material=%s bundle=%s rev=%d branch=%s rev=%d hash=%s",
        material.id,
        bundle.bundle_id,
        bundle.bundle_revision,
        branch_row.id,
        branch_row.revision,
        content_hash[:12],
    )
    return snapshot


def public_projection(snapshot: FrozenInteractionSnapshot | None) -> dict[str, Any] | None:
    """发布/离线公开投影；任何私有标识、诊断日志与未验收产物都不出现。"""

    if snapshot is None:
        return None
    return {
        "snapshot_version": snapshot.snapshot_version,
        "frozen_at": snapshot.frozen_at,
        "bundle_revision": snapshot.bundle_revision,
        "bundle_hash": snapshot.bundle_hash,
        "branch_revision": snapshot.branch_revision,
        "branch_hash": snapshot.branch_hash,
        "runtime_version": snapshot.runtime_version,
        "kernel_version": snapshot.kernel_version,
        "registry_version": snapshot.registry_version,
        "bundle": snapshot.bundle,
        "branch": snapshot.branch,
        "experiments": snapshot.experiments,
        "artifacts": [
            {
                "artifact_id": artifact.get("artifact_id"),
                "content_hash": artifact.get("content_hash"),
                "view_contract_version": artifact.get("view_contract_version"),
                "program": artifact.get("program"),
                "ast": artifact.get("ast"),
                "supported_interactions": artifact.get("supported_interactions"),
                "offline_supported": artifact.get("offline_supported"),
                "acceptance_status": artifact.get("acceptance_status", "accepted"),
                "isolation": artifact.get("isolation"),
            }
            for artifact in snapshot.artifacts
            if artifact.get("content_hash")
        ],
        "reports": snapshot.reports,
        "public_sources": snapshot.public_sources,
        "resource_manifest": snapshot.resource_manifest,
        "learning": [
            {
                **item,
                "source_refs": [
                    {key: value for key, value in ref.items() if key != "material_id"}
                    for ref in item.get("source_refs", [])
                    if isinstance(ref, Mapping)
                ],
                **(
                    {
                        "packaged_explanation": {
                            **item["packaged_explanation"],
                            "source_refs": [
                                {key: value for key, value in ref.items() if key != "material_id"}
                                for ref in item["packaged_explanation"].get("source_refs", [])
                                if isinstance(ref, Mapping)
                            ],
                        }
                    }
                    if isinstance(item.get("packaged_explanation"), Mapping)
                    else {}
                ),
            }
            for item in snapshot.learning
            if isinstance(item, Mapping)
        ],
        "capabilities": snapshot.capabilities,
        "content_hash": snapshot.content_hash,
    }


__all__ = [
    "MAX_ARTIFACT_BYTES",
    "PUBLIC_RUNTIME_VERSION",
    "SNAPSHOT_VERSION",
    "SnapshotConflict",
    "freeze_interactions",
    "public_projection",
]

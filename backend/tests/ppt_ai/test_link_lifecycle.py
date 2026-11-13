"""A1/A3/A5/B1/C2/C3/C4：关联确认后的分支值迁移、共享概念全绑、声明对照与可逆操作。

覆盖 test_relations.py 抓不住的链路：
- confirm 派生候选 → 绑定 → 重求值传播（绑定不止一个共享参数）；
- preview / apply 后分支值迁移与陈旧候选（旧概念 ID）的 remap；
- unlink 单条解除与 batch 顺序规范化；
- 页面声明（declaration）确认后的运行时校验。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.ppt_ai.branches import migrate_branch_state
from app.ppt_ai.evaluation import declaration_checks, evaluate_model
from app.ppt_ai.linking import dependency_order
from app.ppt_ai.relations import (
    RelationConflict,
    apply_link_decisions,
    apply_link_decisions_with_remap,
    preview_link_decisions,
    unlink_relation,
)
from app.ppt_ai.types import (
    InteractionBundle,
    LinkCandidate,
    LinkDecision,
    ModelNode,
    ModelRelation,
    ParameterBinding,
    Provenance,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
GOLDEN = REPO_ROOT / "fixtures" / "ppt-ai" / "linking" / "golden_bundle.json"


def _golden() -> InteractionBundle:
    return InteractionBundle.model_validate(json.loads(GOLDEN.read_text(encoding="utf-8")))


def _free_all(bundle: InteractionBundle) -> InteractionBundle:
    """把 golden 里已链接的 a11 参数恢复自由，并移除两条派生关系。"""

    for node_id in ("ain_page5", "ain_page9"):
        node = next(item for item in bundle.compiled.nodes if item.node_id == node_id)
        node.parameters[0].binding = ParameterBinding(mode="free", concept_id="")
    bundle.graph.relations = [
        relation
        for relation in bundle.graph.relations
        if relation.relation_id not in ("rel_1", "rel_2")
    ]
    order, _cycles = dependency_order(bundle.compiled.nodes)
    bundle.graph.dependency_order = order
    return bundle


def _merge_candidate(left: str = "cpt_p5_a11", right: str = "cpt_p9_a11") -> LinkCandidate:
    return LinkCandidate(
        candidate_id="cand_merge_p5_p9",
        left_concept_id=left,
        right_concept_id=right,
        concept_ids=[left, right],
        relation_type="same_parameter",
        reason="两页同名参数 a11。",
        confidence=0.9,
        occurrences=[
            {
                "concept_id": left,
                "name": "a11",
                "page": 5,
                "excerpt": "a11",
                "default": 6.0,
                "unit": "",
                "type": "number",
                "shape": [],
            },
            {
                "concept_id": right,
                "name": "a11",
                "page": 9,
                "excerpt": "a11",
                "default": 6.0,
                "unit": "",
                "type": "number",
                "shape": [],
            },
        ],
        normalized_name="a11",
    )


def _derived_candidate(right: str = "cpt_p9_a11") -> LinkCandidate:
    """det 供下游 a11 使用；right 故意传「合并后会被改写的旧概念 ID」。"""

    return LinkCandidate(
        candidate_id="cand_derived_det",
        left_concept_id="out:ain_page1:det",
        right_concept_id=right,
        concept_ids=["out:ain_page1:det", right],
        relation_type="derived_from",
        reason="第 1 页的行列式输出与下游参数同名。",
        confidence=0.66,
        source_node_id="ain_page1",
        source_output="det",
    )


def _decision(candidate_id: str, concept_id: str | None = None) -> LinkDecision:
    return LinkDecision(candidate_id=candidate_id, decision="confirm", concept_id=concept_id)


def test_derived_after_merge_binds_all_shared_parameters() -> None:
    bundle = _free_all(_golden())
    bundle.graph.candidates = [_merge_candidate(), _derived_candidate()]
    # 故意按「先派生、后合并」的顺序提交：历史上这个顺序会因合并拒绝
    # linked 成员而直接失败；现在两种顺序必须等价（C2）。
    applied = apply_link_decisions(
        bundle,
        [
            _decision("cand_derived_det"),
            _decision("cand_merge_p5_p9", concept_id="cpt_p5_a11"),
        ],
    )
    for node_id in ("ain_page5", "ain_page9"):
        node = next(item for item in applied.compiled.nodes if item.node_id == node_id)
        parameter = node.parameters[0]
        assert parameter.concept_id == "cpt_p5_a11"
        assert parameter.binding.mode == "linked", node_id
        assert parameter.binding.concept_id == "out:ain_page1:det"
    relation = next(
        item for item in applied.graph.relations if item.type == "derived_from"
    )
    # relation.outputs 记录的是合并后的存活 ID，而不是已死的成员 ID（C4）。
    assert relation.outputs == ["cpt_p5_a11"]
    snapshot = evaluate_model(applied, dict(applied.seed_values))
    assert snapshot.derived_values["out:ain_page1:det"] == pytest.approx(6.0)
    assert snapshot.derived_values["out:ain_page5:det"] == pytest.approx(6.0)
    assert snapshot.derived_values["out:ain_page9:det"] == pytest.approx(6.0)
    # 两个消费者都绑定到同一输出，传导不再一分为二。
    assert snapshot.derived_values["out:ain_page5:det"] == snapshot.derived_values["out:ain_page9:det"]


def test_batch_decision_order_does_not_change_result() -> None:
    def _prepared() -> InteractionBundle:
        prepared = _free_all(_golden())
        prepared.graph.candidates = [_merge_candidate(), _derived_candidate()]
        return prepared

    forward = apply_link_decisions(
        _prepared(),
        [
            _decision("cand_merge_p5_p9", concept_id="cpt_p5_a11"),
            _decision("cand_derived_det"),
        ],
    )
    backward = apply_link_decisions(
        _prepared(),
        [
            _decision("cand_derived_det"),
            _decision("cand_merge_p5_p9", concept_id="cpt_p5_a11"),
        ],
    )
    forward_bindings = [
        (node.node_id, parameter.concept_id, parameter.binding.concept_id)
        for node in forward.compiled.nodes
        for parameter in node.parameters
    ]
    backward_bindings = [
        (node.node_id, parameter.concept_id, parameter.binding.concept_id)
        for node in backward.compiled.nodes
        for parameter in node.parameters
    ]
    assert forward_bindings == backward_bindings
    assert forward.graph.relations == backward.graph.relations


def test_merge_rejects_colliding_chosen_concept() -> None:
    bundle = _free_all(_golden())
    bundle.graph.candidates = [_merge_candidate()]
    # 保留名撞上已有概念 cpt_p1_a11：必须拒绝，不能把两组概念静默焊死（C3）。
    with pytest.raises(RelationConflict):
        apply_link_decisions(
            bundle, [_decision("cand_merge_p5_p9", concept_id="cpt_p1_a11")]
        )


def test_migrate_branch_state_maps_members_and_prefers_chosen() -> None:
    bundle = _free_all(_golden())
    bundle.graph.candidates = [_merge_candidate()]
    new_bundle, remap = apply_link_decisions_with_remap(
        bundle, [_decision("cand_merge_p5_p9", concept_id="cpt_p5_a11")]
    )
    assert remap == {"cpt_p9_a11": "cpt_p5_a11"}
    values = {
        "cpt_p5_a11": 3.0,   # 保留概念自身的值优先
        "cpt_p9_a11": 7.0,   # 被合并改写 ID 的成员值
        "cpt_p1_a11": 2.0,
        "cpt_p5_a22": 1.5,
    }
    migrated, overrides, notes = migrate_branch_state(
        new_bundle, remap, values, {"ain_page5": {"cpt_p5_a22": 4.0}}
    )
    assert migrated["cpt_p5_a11"] == 3.0
    assert migrated["cpt_p1_a11"] == 2.0
    assert migrated["cpt_p5_a22"] == 1.5
    # 旧成员 ID 不再作为死数据落库。
    assert "cpt_p9_a11" not in migrated
    assert overrides == {"ain_page5": {"cpt_p5_a22": 4.0}}
    assert notes == []


def test_migrate_branch_state_member_value_moves_to_chosen() -> None:
    bundle = _free_all(_golden())
    bundle.graph.candidates = [_merge_candidate()]
    new_bundle, remap = apply_link_decisions_with_remap(
        bundle, [_decision("cand_merge_p5_p9", concept_id="cpt_p5_a11")]
    )
    # 用户只调过被改写 ID 的成员：值必须跟着迁移，而不是丢掉。
    migrated, _overrides, _notes = migrate_branch_state(
        new_bundle, remap, {"cpt_p9_a11": 7.0}, None
    )
    assert migrated == {"cpt_p5_a11": 7.0}


def test_migrate_branch_state_clamps_to_merged_domain() -> None:
    bundle = _free_all(_golden())
    for node_id, (low, high) in {
        "ain_page5": (0.0, 4.0),
        "ain_page9": (2.0, 8.0),
    }.items():
        node = next(item for item in bundle.compiled.nodes if item.node_id == node_id)
        node.parameters[0].min = low
        node.parameters[0].max = high
    bundle.graph.candidates = [_merge_candidate()]
    new_bundle, remap = apply_link_decisions_with_remap(
        bundle, [_decision("cand_merge_p5_p9", concept_id="cpt_p5_a11")]
    )
    migrated, _overrides, notes = migrate_branch_state(
        new_bundle, remap, {"cpt_p9_a11": 7.0}, None
    )
    # 合并后定义域是 [2, 4]：越界值收敛到上界并记说明，确认不能因校验失败。
    assert migrated["cpt_p5_a11"] == 4.0
    assert any("上界" in note for note in notes)


def test_migrate_branch_state_drops_linked_local_values() -> None:
    bundle = _free_all(_golden())
    bundle.graph.candidates = [_merge_candidate(), _derived_candidate()]
    new_bundle, remap = apply_link_decisions_with_remap(
        bundle,
        [
            _decision("cand_derived_det"),
            _decision("cand_merge_p5_p9", concept_id="cpt_p5_a11"),
        ],
    )
    migrated, overrides, _notes = migrate_branch_state(
        new_bundle, remap, {"cpt_p5_a11": 3.0, "cpt_p5_a22": 1.5}, None
    )
    # cpt_p5_a11 已是派生绑定：本地值是死数据，一律丢弃。
    assert "cpt_p5_a11" not in migrated
    assert migrated["cpt_p5_a22"] == 1.5
    assert overrides == {}


def test_preview_uses_same_value_migration_as_confirm() -> None:
    bundle = _free_all(_golden())
    bundle.graph.candidates = [_merge_candidate()]
    values = {**bundle.seed_values, "cpt_p5_a11": 3.0, "cpt_p9_a11": 7.0}
    preview = preview_link_decisions(
        bundle,
        [_decision("cand_merge_p5_p9", concept_id="cpt_p5_a11")],
        values=values,
    )
    # 预览的 after 值与确认后的迁移规则一致：成员值归到保留概念，旧 ID 消失（A2）。
    assert preview["after"]["values"]["cpt_p5_a11"] == pytest.approx(3.0)
    assert "cpt_p9_a11" not in preview["after"]["values"]


def test_unlink_relation_frees_binding_and_keeps_other_relations() -> None:
    bundle = _golden()
    unlinked = unlink_relation(bundle, "rel_1")
    page5 = next(item for item in unlinked.compiled.nodes if item.node_id == "ain_page5")
    assert page5.parameters[0].binding.mode == "free"
    assert page5.parameters[0].binding.concept_id == ""
    assert all(relation.relation_id != "rel_1" for relation in unlinked.graph.relations)
    # rel_2 保留：页 9 仍由页 5 派生。
    assert any(relation.relation_id == "rel_2" for relation in unlinked.graph.relations)
    assert unlinked.graph.graph_revision == bundle.graph.graph_revision + 1
    assert any(item.get("decision") == "unlink" for item in unlinked.graph.conflicts)
    # 原 bundle 未被修改（不可变）。
    page5_original = next(item for item in bundle.compiled.nodes if item.node_id == "ain_page5")
    assert page5_original.parameters[0].binding.mode == "linked"


def test_unlink_rejects_same_parameter_and_unknown_relations() -> None:
    bundle = _free_all(_golden())
    bundle.graph.candidates = [_merge_candidate()]
    applied = apply_link_decisions(
        bundle, [_decision("cand_merge_p5_p9", concept_id="cpt_p5_a11")]
    )
    merged = next(
        relation
        for relation in applied.graph.relations
        if relation.type == "same_parameter"
    )
    # 同名合并的成员 ID 已被改写，无法单条解除：只能整次回退。
    with pytest.raises(RelationConflict):
        unlink_relation(applied, merged.relation_id)
    with pytest.raises(RelationConflict):
        unlink_relation(applied, "rel_missing")


def test_declaration_checks_flag_drift() -> None:
    bundle = _golden()
    anchor = bundle.compiled.nodes[0].source.model_copy(deep=True)
    declaration = ModelNode(
        concept_id="decl_det_page1",
        name="det 的页面声明",
        type="number",
        unit="",
        dimension="scalar",
        domain={},
        default=6.0,
        source=anchor,
        semantic_role="declaration",
        provenance=Provenance(
            origin_type="native",
            evidence="det = 6",
            method="page_declaration",
        ),
    )
    bundle.graph.nodes.append(declaration)
    bundle.graph.relations.append(
        ModelRelation(
            relation_id="rel_decl_det",
            type="derived_from",
            inputs=["out:ain_page1:det"],
            outputs=["decl_det_page1"],
            review_status="confirmed",
            note="用户确认页面声明与输出对照。",
        )
    )
    matched = evaluate_model(bundle, dict(bundle.seed_values))
    check = next(
        item for item in matched.checks if item["id"].startswith("declaration_match")
    )
    assert check["status"] == "pass"
    # 未确认的声明不产生对照（缺 derived_from 关系）。
    assert declaration_checks(bundle, matched.derived_values)
    drifted_values = dict(bundle.seed_values)
    drifted_values["cpt_p1_a11"] = 4.0
    drifted = evaluate_model(bundle, drifted_values)
    drifted_check = next(
        item for item in drifted.checks if item["id"].startswith("declaration_match")
    )
    assert drifted_check["status"] == "fail"
    assert "偏离" in drifted_check["detail"]

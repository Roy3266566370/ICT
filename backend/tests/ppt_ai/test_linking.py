"""全表联动：黄金 bundle、拓扑/环、候选分组与增量一致性。"""

from __future__ import annotations

import json
import random
from pathlib import Path

import pytest

from app.ppt_ai.evaluation import evaluate_model, evaluate_model_incremental
from app.ppt_ai.linking import (
    convert_parameter_to_unit,
    dependency_order,
    group_same_parameter_candidates,
    normalize_concept_name,
    scan_numeric_declarations,
)
from app.ppt_ai.types import (
    CompiledNode,
    InteractionBundle,
    ModelNode,
    ParameterBinding,
    PlanParameter,
    SemanticGraph,
    SourceAnchor,
    SourceSnapshot,
)
from app.ppt_ai.util import hash_json

REPO_ROOT = Path(__file__).resolve().parents[3]
GOLDEN = REPO_ROOT / "fixtures" / "ppt-ai" / "linking" / "golden_bundle.json"


def golden_bundle() -> InteractionBundle:
    return InteractionBundle.model_validate(json.loads(GOLDEN.read_text(encoding="utf-8")))


def _anchor(page: int, text: str) -> SourceAnchor:
    from app.ppt_ai.evidence import build_anchor

    return build_anchor(
        material_id="mat_prop",
        page=page,
        bbox={"x": 0.1, "y": 0.1, "w": 0.3, "h": 0.2},
        excerpt=text,
        source_version=0,
        semantic_hash=hash_json({"page": page, "text": text}),
    )


def _param(concept_id: str, default: float, page: int, linked: str | None = None) -> PlanParameter:
    from app.ppt_ai.evidence import build_provenance

    return PlanParameter(
        concept_id=concept_id,
        id="a11",
        label="a11",
        type="number",
        default=default,
        min=0,
        max=100,
        step=0.1,
        source=_anchor(page, f"a11={default}"),
        provenance=build_provenance("model_inference", inference="属性测试"),
        binding=ParameterBinding(mode="linked", concept_id=linked) if linked else ParameterBinding(),
    )


def _second_parameter(concept_id: str, page: int) -> PlanParameter:
    parameter = _param(concept_id, 1.0, page)
    parameter.id = "a22"
    return parameter


def _random_bundle(rng: random.Random) -> InteractionBundle:
    count = rng.randint(2, 7)
    nodes: list[CompiledNode] = []
    free: list[str] = []
    for index in range(count):
        page = index + 1
        node_id = f"ain_chain_{index}"
        predecessor = nodes[rng.randrange(len(nodes))].node_id if nodes and rng.random() < 0.75 else None
        concept = f"cpt_chain_{index}"
        linked = f"out:{predecessor}:det" if predecessor else None
        if not linked:
            free.append(concept)
        node = CompiledNode(
            node_id=node_id,
            option_id=f"opt_chain_{index}",
            region_id=f"rgn_chain_{index}",
            operator_id="matrix.transform",
            title=f"链节点 {index}",
            parameters=[
                _param(concept, round(rng.uniform(0.5, 9.0), 3), page, linked),
                _second_parameter(f"cpt_chain_{index}_a22", page),
            ],
            outputs=[
                {
                    "key": "det",
                    "concept_id": f"out:{node_id}:det",
                    "name": "行列式",
                    "type": "number",
                    "unit": "",
                }
            ],
            provider={"kind": "matrix", "matrix": [[1, 0], [0, 1]]},
            offline_supported=True,
            source=_anchor(page, f"链节点 {index}"),
        )
        nodes.append(node)
    graph_nodes = [
        ModelNode(
            concept_id=node.parameters[0].concept_id,
            name="a11",
            type="number",
            unit="",
            domain={"min": 0, "max": 100},
            default=node.parameters[0].default,
            source=node.parameters[0].source,
            semantic_role="parameter",
            provenance=node.parameters[0].provenance,
        )
        for node in nodes
    ]
    order, cycles = dependency_order(nodes)
    assert not cycles
    graph = SemanticGraph(
        nodes=graph_nodes,
        relations=[],
        candidates=[],
        conflicts=[],
        graph_revision=1,
        dependency_order=order,
    )
    seed = {}
    for node in nodes:
        for parameter in node.parameters:
            if parameter.binding.mode == "free":
                seed.setdefault(parameter.concept_id, parameter.default)
    return InteractionBundle(
        bundle_id="bnd_prop",
        bundle_revision=1,
        schema_version="ppt-ai.2",
        material_id="mat_prop",
        source_revision=0,
        source_hash="b" * 64,
        content_hash=hash_json({"prop": count}),
        graph=graph,
        compiled={"nodes": [node.model_dump(mode="json") for node in nodes]},
        seed_values=seed,
        created_at="2026-11-09T00:00:00+00:00",
    )


def test_golden_bundle_propagates_hand_calculated_values() -> None:
    bundle = golden_bundle()
    values = dict(bundle.seed_values)
    first = evaluate_model(bundle, values)
    assert first.derived_values["out:ain_page1:det"] == pytest.approx(6.0)
    assert first.derived_values["out:ain_page5:det"] == pytest.approx(6.0)
    assert first.derived_values["out:ain_page9:det"] == pytest.approx(6.0)

    values["cpt_p1_a11"] = 4.0
    second = evaluate_model(bundle, values)
    assert second.derived_values["out:ain_page1:det"] == pytest.approx(12.0)
    assert second.derived_values["out:ain_page5:det"] == pytest.approx(12.0)
    assert second.derived_values["out:ain_page9:det"] == pytest.approx(12.0)


def test_incremental_matches_full_on_random_dags() -> None:
    rng = random.Random(20261109)
    for _case in range(30):
        bundle = _random_bundle(rng)
        values = dict(bundle.seed_values)
        previous = evaluate_model(bundle, values)
        free = sorted(
            parameter.concept_id
            for node in bundle.compiled.nodes
            for parameter in node.parameters
            if parameter.binding.mode == "free"
        )
        changed = rng.choice(free)
        values = dict(values)
        values[changed] = round(rng.uniform(0.5, 9.0), 3)
        incremental, affected = evaluate_model_incremental(
            bundle, values, previous, [changed]
        )
        full = evaluate_model(bundle, values)
        assert affected, "改动的自由参数必须影响至少一个节点"
        assert any(
            previous.derived_values.get(key) != value
            for key, value in full.derived_values.items()
        ), "至少一个派生输出应随输入变化"
        assert incremental.derived_values == full.derived_values
        assert incremental.evaluation_hash == full.evaluation_hash
        assert incremental.checks == full.checks
        assert incremental.violations == full.violations
        assert incremental.input_hash == full.input_hash


def test_incremental_matches_full_with_local_overrides() -> None:
    bundle = golden_bundle()
    values = dict(bundle.seed_values)
    previous = evaluate_model(bundle, values)
    overrides = {"ain_page5": {"cpt_p5_a11": 1.0}}
    incremental, affected = evaluate_model_incremental(
        bundle,
        values,
        previous,
        [],
        overrides=overrides,
        changed_overrides=["ain_page5"],
    )
    full = evaluate_model(bundle, values, overrides=overrides)
    assert incremental.derived_values == full.derived_values
    assert incremental.evaluation_hash == full.evaluation_hash
    assert {"ain_page5", "ain_page9"} <= affected
    assert full.derived_values["out:ain_page5:det"] == pytest.approx(1.0)


def test_unit_conversion_and_unitless_normalization() -> None:
    parameter = _param("cpt_speed", 3.6, 1)
    parameter.unit = "km/h"
    parameter.max = 36
    assert convert_parameter_to_unit(parameter, "m/s") is True
    assert parameter.unit == "m/s"
    assert parameter.default == pytest.approx(1.0)
    assert parameter.max == pytest.approx(10.0)
    assert normalize_concept_name("eigenvalue") == "eigenvalue"
    assert normalize_concept_name("速度 v（km/h）") == normalize_concept_name("速度 v（m/s）")


def test_group_candidate_converts_units_before_merge() -> None:
    from app.ppt_ai.relations import _apply_same_parameter
    from app.ppt_ai.types import CompiledPayload, LinkCandidate

    def make_node(node_id: str, concept: str, unit: str, default: float, page: int) -> CompiledNode:
        parameter = _param(concept, default, page)
        parameter.label = "长度 L"
        parameter.unit = unit
        parameter.min = 0
        parameter.max = 10 if unit == "m" else 1000
        second = _param(f"{concept}_a22", 1.0, page)
        second.id = "a22"
        return CompiledNode(
            node_id=node_id,
            option_id=f"opt_{node_id}",
            region_id=f"rgn_{node_id}",
            operator_id="matrix.transform",
            title=f"节点 {node_id}",
            parameters=[parameter, second],
            outputs=[{
                "key": "det", "concept_id": f"out:{node_id}:det",
                "name": "行列式", "type": "number", "unit": "",
            }],
            provider={"kind": "matrix", "matrix": [[1, 0], [0, 1]]},
            offline_supported=True,
            source=_anchor(page, f"节点 {node_id}"),
        )

    left = make_node("ain_m", "cpt_m", "m", 1.0, 1)
    right = make_node("ain_cm", "cpt_cm", "cm", 100.0, 2)
    graph_nodes = [
        ModelNode(concept_id="cpt_m", name="长度 L", type="number", unit="m",
            domain={"min": 0, "max": 10}, default=1.0, source=_anchor(1, "长度 L"),
            semantic_role="parameter", provenance=left.parameters[0].provenance),
        ModelNode(concept_id="cpt_cm", name="长度 L", type="number", unit="cm",
            domain={"min": 0, "max": 1000}, default=100.0, source=_anchor(2, "长度 L"),
            semantic_role="parameter", provenance=right.parameters[0].provenance),
    ]
    nodes = [left, right]
    candidates = group_same_parameter_candidates(graph_nodes)
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate.conflict is False
    bundle = InteractionBundle(
        bundle_id="bnd_units", bundle_revision=1, schema_version="ppt-ai.2",
        material_id="mat_units", source_revision=0, source_hash="d" * 64,
        content_hash=hash_json({"units": True}),
        graph=SemanticGraph(nodes=graph_nodes, relations=[], candidates=[candidate],
            conflicts=[], graph_revision=1, dependency_order=["ain_m", "ain_cm"]),
        compiled=CompiledPayload(nodes=nodes, order=["ain_m", "ain_cm"], ispecs=[], checks=[], resources=[]),
        seed_values={"cpt_m": 1.0, "cpt_m_a22": 1.0, "cpt_cm": 100.0, "cpt_cm_a22": 1.0},
        created_at="2026-11-09T00:00:00+00:00",
    )
    from app.ppt_ai.relations import apply_link_decisions
    from app.ppt_ai.types import LinkDecision

    applied = apply_link_decisions(
        bundle,
        [LinkDecision(candidate_id=candidate.candidate_id, decision="confirm", concept_id="cpt_m")],
    )
    for node in applied.compiled.nodes:
        parameter = node.parameters[0]
        assert parameter.concept_id == "cpt_m"
        assert parameter.unit == "m"
        assert parameter.default == pytest.approx(1.0)
        assert parameter.max == pytest.approx(10.0)
    evaluated = evaluate_model(applied, {"cpt_m": 2.0, "cpt_m_a22": 1.0})
    assert evaluated.derived_values["out:ain_m:det"] == pytest.approx(2.0)
    assert evaluated.derived_values["out:ain_cm:det"] == pytest.approx(2.0)


def test_cycle_is_detected_and_rejected_by_order() -> None:
    bundle = _random_bundle(random.Random(1))
    first, second = bundle.compiled.nodes[0], bundle.compiled.nodes[1]
    first.parameters[0].binding = ParameterBinding(
        mode="linked", concept_id=f"out:{second.node_id}:det"
    )
    second.parameters[0].binding = ParameterBinding(
        mode="linked", concept_id=f"out:{first.node_id}:det"
    )
    order, cycles = dependency_order(bundle.compiled.nodes)
    assert order == []
    assert any(set(cycle) == {first.node_id, second.node_id} for cycle in cycles)
    snapshot = evaluate_model(bundle, dict(bundle.seed_values))
    assert any(item.get("code") == "dependency_cycle" for item in snapshot.violations)


def test_self_reference_is_a_cycle() -> None:
    bundle = _random_bundle(random.Random(3))
    node = bundle.compiled.nodes[0]
    node.parameters[0].binding = ParameterBinding(
        mode="linked", concept_id=f"out:{node.node_id}:det"
    )
    order, cycles = dependency_order(bundle.compiled.nodes)
    assert order == []
    assert [node.node_id] in cycles


def test_normalized_names_and_group_candidates() -> None:
    assert normalize_concept_name("矩阵 A") == normalize_concept_name("A")
    assert normalize_concept_name("变换矩阵 A") == "a"
    assert normalize_concept_name("θ") == normalize_concept_name("theta")
    assert normalize_concept_name("面积 A") != normalize_concept_name("A")

    nodes = [
        ModelNode(
            concept_id="cpt_a1",
            name="矩阵 A",
            type="number",
            unit="",
            domain={"min": 0, "max": 10},
            default=2.0,
            source=_anchor(1, "矩阵 A"),
            semantic_role="parameter",
            provenance=_param("cpt_a1", 2.0, 1).provenance,
        ),
        ModelNode(
            concept_id="cpt_a2",
            name="A",
            type="number",
            unit="",
            domain={"min": 1, "max": 8},
            default=2.0,
            source=_anchor(2, "A"),
            semantic_role="parameter",
            provenance=_param("cpt_a2", 2.0, 2).provenance,
        ),
        ModelNode(
            concept_id="cpt_area",
            name="面积 A",
            type="number",
            unit="",
            domain={"min": 0, "max": 10},
            default=2.0,
            source=_anchor(3, "面积 A"),
            semantic_role="parameter",
            provenance=_param("cpt_area", 2.0, 3).provenance,
        ),
    ]
    candidates = group_same_parameter_candidates(nodes)
    assert len(candidates) == 1
    assert set(candidates[0].concept_ids) == {"cpt_a1", "cpt_a2"}
    assert candidates[0].conflict is False


def test_matrix_operator_registers_derived_outputs() -> None:
    from tests.ppt_ai import helpers

    _extraction, _plan, bundle = helpers.bundle_for(helpers.matrix_snapshot())
    node = bundle.compiled.nodes[0]
    assert {output.key for output in node.outputs} == {"det", "product", "inverse"}
    assert bundle.schema_version == "ppt-ai.2"
    assert bundle.graph.dependency_order == [node.node_id]
    assert any(item.semantic_role == "derived_output" for item in bundle.graph.nodes)
    evaluated = evaluate_model(bundle, dict(bundle.seed_values))
    assert evaluated.derived_values[f"out:{node.node_id}:det"] == pytest.approx(2.0)
    assert evaluated.derived_values[f"out:{node.node_id}:product"] == [8.0, 3.0]


def test_declaration_matching_finds_page_value() -> None:
    snapshot = SourceSnapshot(
        material_id="mat_decl",
        document_revision=0,
        source_hash="c" * 64,
        page_count=1,
        title="声明页",
        pages=[
            {
                "page_no": 1,
                "width": 1000,
                "height": 600,
                "elements": [
                    {
                        "element_id": "e1",
                        "kind": "text",
                        "text": "det = 3",
                        "bbox": {"x": 100, "y": 100, "w": 200, "h": 100},
                    }
                ],
            }
        ],
    )
    from app.ppt_ai.types import OutputSpec

    declarations = scan_numeric_declarations(
        snapshot,
        [OutputSpec(key="det", concept_id="out:x:det", name="行列式")],
        material_id="mat_decl",
        source_version=0,
    )
    assert len(declarations) == 1
    assert declarations[0].semantic_role == "declaration"
    assert declarations[0].default == 3.0
    assert declarations[0].source.page == 1

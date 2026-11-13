"""PPT AI 测试夹具：合成来源、规划与编译（不访问真实模型）。"""

from __future__ import annotations

from typing import Any

from app.ppt_ai.compiler import compile_plan
from app.ppt_ai.planner import plan_interactions
from app.ppt_ai.registry import REGISTRY
from app.ppt_ai.types import CallBudget, SourceSnapshot

PAGE_W = 12192000
PAGE_H = 6858000


def element(
    element_id: str,
    kind: str,
    *,
    text: str | None = None,
    bbox: tuple[float, float, float, float] = (100000, 100000, 5000000, 1000000),
    chart_data: dict[str, Any] | None = None,
    table_data: dict[str, Any] | None = None,
    math_text: str | None = None,
) -> dict[str, Any]:
    x, y, w, h = bbox
    return {
        "element_id": element_id,
        "kind": kind,
        "text": text,
        "bbox": {"x": x, "y": y, "w": w, "h": h},
        "chart_data": chart_data,
        "table_data": table_data,
        "math_text": math_text,
    }


def snapshot(
    material_id: str = "mat_test",
    *,
    pages: list[dict[str, Any]] | None = None,
    hash_char: str = "a",
    revision: int = 0,
    scene_document: dict[str, Any] | None = None,
) -> SourceSnapshot:
    return SourceSnapshot(
        material_id=material_id,
        document_revision=revision,
        source_hash=hash_char * 64,
        page_count=len(pages or []),
        title="测试材料",
        pages=pages or [],
        scene_document=scene_document,
    )


def integral_snapshot(material_id: str = "mat_integral") -> SourceSnapshot:
    return snapshot(
        material_id,
        hash_char="b",
        pages=[
            {
                "page_no": 1,
                "width": PAGE_W,
                "height": PAGE_H,
                "elements": [
                    element("e1", "text", text="计算定积分 ∫_0^1 1/(x+1) dx"),
                ],
            }
        ],
    )


def expression_snapshot(material_id: str = "mat_expr") -> SourceSnapshot:
    return snapshot(
        material_id,
        hash_char="c",
        pages=[
            {
                "page_no": 1,
                "width": PAGE_W,
                "height": PAGE_H,
                "elements": [element("e1", "text", text="y = x^2")],
            }
        ],
    )


def matrix_snapshot(material_id: str = "mat_matrix", text: str = "A = [[2,0],[0,1]]，v = (4,3)") -> SourceSnapshot:
    return snapshot(
        material_id,
        hash_char="d",
        pages=[
            {
                "page_no": 1,
                "width": PAGE_W,
                "height": PAGE_H,
                "elements": [element("e1", "text", text=text)],
            }
        ],
    )


def chart_snapshot(material_id: str = "mat_chart") -> SourceSnapshot:
    return snapshot(
        material_id,
        hash_char="e",
        pages=[
            {
                "page_no": 1,
                "width": PAGE_W,
                "height": PAGE_H,
                "elements": [
                    element(
                        "e1",
                        "chart",
                        bbox=(300000, 2000000, 6000000, 3000000),
                        chart_data={
                            "chart_type": "COLUMN_CLUSTERED",
                            "categories": ["一月", "二月"],
                            "series": [
                                {"name": "销量", "values": [42, 51]},
                                {"name": "利润", "values": [18, 21]},
                            ],
                            "title": "月度数据",
                        },
                    )
                ],
            }
        ],
    )


def plan_for(snapshot_value: SourceSnapshot):
    from app.ppt_ai.regions import extract_regions

    extraction = extract_regions(snapshot_value)
    return extraction, plan_interactions(
        extraction,
        snapshot_value,
        budget=CallBudget(max_calls=0),
        client=None,
    )


def bundle_for(snapshot_value: SourceSnapshot, *, selected: list[str] | None = None):
    extraction, plan = plan_for(snapshot_value)
    if selected is None:
        selected = [option.option_id for option in plan.options if option.support_status in ("supported", "explanation_only")]
    if not selected:
        selected = [plan.options[0].option_id] if plan.options else []
    bundle = compile_plan(
        plan,
        REGISTRY,
        bundle_revision=1,
        selected_option_ids=selected,
        snapshot=snapshot_value,
    )
    return extraction, plan, bundle


def node_of(bundle, operator_fragment: str):
    for node in bundle.compiled.nodes:
        if operator_fragment in node.operator_id:
            return node
    raise AssertionError(f"没有算子 {operator_fragment} 的节点")

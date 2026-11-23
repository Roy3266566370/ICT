"""M6 任务 1：ViewAST 新增 arrow / polygon / formula 与 drag-handle 契约校验测试。"""
from __future__ import annotations

import pytest

from app.ppt_ai.contracts import ContractError, validate_view_ast


def _base_ast(*, nodes, interactions=None):
    return {
        "version": "ppt-ai.view.1",
        "width": 720,
        "height": 420,
        "interactions": interactions or [],
        "nodes": nodes,
    }


def test_view_ast_accepts_arrow_polygon_formula_and_drag_handle():
    ast = _base_ast(
        nodes=[
            {
                "id": "poly_region",
                "type": "polygon",
                "points": [[120, 300], [280, 300], [280, 160], [180, 160]],
                "style": {"fill": "#3b82f6", "stroke": "#1d4ed8", "strokeWidth": 2, "opacity": 0.25},
            },
            {
                "id": "vec_b2",
                "type": "arrow",
                "x1": 120,
                "y1": 300,
                "x2": 260,
                "y2": 180,
                "label": "b₂",
                "style": {"stroke": "#c4622d", "strokeWidth": 3},
            },
            {
                "id": "eq_1",
                "type": "formula",
                "x": 420,
                "y": 80,
                "tex": r"\vec{v} = a\vec{b}_1 + b\vec{b}_2",
                "style": {"fill": "#0f172a", "fontSize": 18},
            },
        ],
        interactions=[
            {
                "type": "drag-handle",
                "id": "handle_b2",
                "targetNodeId": "vec_b2",
                "label": "拖动 b₂",
                "x": 260,
                "y": 180,
                "xParam": "bx",
                "yParam": "by",
                "bounds": {"xMin": 120, "xMax": 520, "yMin": 60, "yMax": 340},
                "valueRange": {"x": [0, 4], "y": [0, 3]},
            }
        ],
    )
    validate_view_ast(ast)


def test_view_ast_rejects_invalid_polygon_formula_and_drag_handle():
    # polygon 少于 3 个顶点
    with pytest.raises(ContractError, match="polygon.points"):
        validate_view_ast(_base_ast(nodes=[{"id": "p1", "type": "polygon", "points": [[0, 0], [10, 10]]}]))

    # formula 包含危险 HTML 或链接宏
    with pytest.raises(ContractError, match="formula.tex"):
        validate_view_ast(
            _base_ast(nodes=[{"id": "f1", "type": "formula", "x": 100, "y": 100, "tex": r"\href{javascript:alert(1)}{x}"}])
        )

    # drag-handle 未绑定任何参数
    with pytest.raises(ContractError, match="至少需要绑定"):
        validate_view_ast(
            _base_ast(
                nodes=[],
                interactions=[
                    {
                        "type": "drag-handle",
                        "id": "h1",
                        "x": 100,
                        "y": 100,
                        "bounds": {"xMin": 0, "xMax": 200, "yMin": 0, "yMax": 200},
                        "valueRange": {},
                    }
                ],
            )
        )

    # drag-handle 缺少对应 valueRange.x
    with pytest.raises(ContractError, match="valueRange.x"):
        validate_view_ast(
            _base_ast(
                nodes=[],
                interactions=[
                    {
                        "type": "drag-handle",
                        "id": "h2",
                        "x": 100,
                        "y": 100,
                        "xParam": "bx",
                        "bounds": {"xMin": 0, "xMax": 200, "yMin": 0, "yMax": 200},
                        "valueRange": {},
                    }
                ],
            )
        )

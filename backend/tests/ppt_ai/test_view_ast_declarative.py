"""验证 ViewAST 新增的 mermaid 与 chart 声明式节点契约、安全过滤与 PageLab 沙箱试运行。"""

from __future__ import annotations

import pytest

from app.ppt_ai.contracts import ContractError, validate_view_ast
from app.ppt_ai.page_lab import validate_lab


def test_validate_view_ast_accepts_mermaid_and_chart_nodes():
    ast = {
        "version": "ppt-ai.view.1",
        "width": 720,
        "height": 420,
        "interactions": [],
        "nodes": [
            {
                "id": "flow1",
                "type": "mermaid",
                "x": 20,
                "y": 20,
                "w": 320,
                "h": 380,
                "mermaid": {
                    "code": "flowchart TD\nA[输入]-->B[处理]\nB-->C[输出]",
                    "activeNodes": ["B"],
                },
            },
            {
                "id": "chart1",
                "type": "chart",
                "x": 360,
                "y": 20,
                "w": 340,
                "h": 380,
                "chart": {
                    "chartType": "bar",
                    "title": "概率分布",
                    "categories": ["x1", "x2", "x3"],
                    "series": [{"name": "P", "values": [0.2, 0.5, 0.3], "color": "#c4622d"}],
                    "yDomain": [0, 1],
                },
            },
        ],
    }
    validate_view_ast(ast)


def test_validate_view_ast_accepts_scatter_chart():
    ast = {
        "version": "ppt-ai.view.1",
        "width": 720,
        "height": 420,
        "interactions": [],
        "nodes": [
            {
                "id": "sc1",
                "type": "chart",
                "x": 20,
                "y": 20,
                "w": 680,
                "h": 380,
                "chart": {
                    "chartType": "scatter",
                    "title": "样本散点",
                    "series": [{"name": "样本", "values": [[0.1, 0.5], [1.2, 2.3]]}],
                },
            }
        ],
    }
    validate_view_ast(ast)


def test_validate_view_ast_rejects_unsafe_mermaid_and_invalid_chart():
    unsafe_mermaid = {
        "version": "ppt-ai.view.1",
        "width": 720,
        "height": 420,
        "interactions": [],
        "nodes": [
            {
                "id": "bad_flow",
                "type": "mermaid",
                "mermaid": {
                    "code": 'flowchart LR\nA-->B\nclick A "javascript:alert(1)"',
                },
            }
        ],
    }
    with pytest.raises(ContractError):
        validate_view_ast(unsafe_mermaid)

    bad_chart = {
        "version": "ppt-ai.view.1",
        "width": 720,
        "height": 420,
        "interactions": [],
        "nodes": [
            {
                "id": "bad_chart",
                "type": "chart",
                "chart": {
                    "chartType": "bar",
                    "categories": ["A", "B", "C"],
                    "series": [{"name": "S1", "values": [1, 2]}],
                },
            }
        ],
    }
    with pytest.raises(ContractError):
        validate_view_ast(bad_chart)


def test_page_lab_probe_accepts_dynamic_mermaid_step_highlight():
    raw_lab = {
        "title": "BFS 遍历流程演示",
        "summary": "随时间轴高亮当前访问节点，并调节分支数观察队列规模",
        "params": [{"id": "branch", "label": "分支数", "min": 1, "max": 4, "step": 1, "default": 2}],
        "public_params": ["branch"],
        "timeline": {
            "duration_s": 6,
            "stops": [
                {"t": 0, "label": "起点入队"},
                {"t": 0.5, "label": "出队扩展"},
                {"t": 1, "label": "遍历完成"},
            ],
        },
        "explain": ["高亮节点随播放步骤推进"],
        "program": (
            "function render(input){"
            "var ids=['A','B','C'];"
            "var idx=Math.min(2,Math.max(0,Math.floor(input.t*2.99)));"
            "return {version:'ppt-ai.view.1',width:720,height:420,interactions:[],nodes:["
            "{id:'m1',type:'mermaid',x:20,y:20,w:680,h:380,mermaid:{"
            "code:'flowchart LR\\nA[起点]-->B[扩展'+input.branch+'路]\\nB-->C[完成]',"
            "activeNodes:[ids[idx]]}}]};}"
        ),
    }
    validated = validate_lab(raw_lab, probe=True)
    assert validated["title"] == "BFS 遍历流程演示"

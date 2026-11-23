"""M6 任务 2：page_lab 融合 FigureScene、动态关系、视觉看图与 drag-handle 试运行测试。"""
from __future__ import annotations

from types import SimpleNamespace
import pytest

from app.ppt_ai.page_lab import (
    PAGE_LAB_VERSION,
    PageLabError,
    _summarize_figure_scenes,
    _summarize_relations,
    generate_page_lab,
    validate_lab,
)


def test_figure_scene_and_relations_summary_strip_base64():
    scene_page = {
        "figure_scenes": {
            "img_1": {
                "image_data": "data:image/png;base64,HUGE_PAYLOAD",
                "objects": [
                    {"id": "b1", "kind": "arrow", "role": "basis", "label": "b₁", "color": "#0284c7", "start": [100, 300], "end": [220, 300]},
                    {"id": "b2", "kind": "arrow", "role": "basis", "label": "b₂", "color": "#c4622d", "start": [100, 300], "end": [180, 200]},
                ],
            }
        },
        "relations": [
            {"id": "rel_1", "kind": "basis_decompose", "enabled": True, "firstId": "b1", "secondId": "b2", "resultId": "v", "labelTemplate": "({a}, {b})"},
            {"id": "rel_disabled", "kind": "expr", "enabled": False, "targetId": "t1", "expression": "1"},
        ],
    }
    figs = _summarize_figure_scenes(scene_page)
    rels = _summarize_relations(scene_page)
    assert len(figs) == 2
    assert figs[0]["label"] == "b₁"
    assert "image_data" not in str(figs)
    assert len(rels) == 1
    assert rels[0]["kind"] == "basis_decompose"


def test_validate_lab_runs_arrow_polygon_formula_and_drag_handle():
    program = (
        "function render(input){"
        "var x=160+input.bx*60*Math.max(0.2,input.t),y=300-input.by*50;"
        "return {version:'ppt-ai.view.1',width:720,height:420,"
        "interactions:[{type:'drag-handle',id:'h_b2',label:'拖动 b2',x:x,y:y,xParam:'bx',yParam:'by',"
        "bounds:{xMin:160,xMax:400,yMin:120,yMax:300},valueRange:{x:[0,4],y:[0,3.6]}}],"
        "nodes:["
        "{id:'poly',type:'polygon',points:[[160,300],[280,300],[x+120,y],[x,y]],style:{fill:'#3b82f6',stroke:'#1d4ed8',strokeWidth:1.5,opacity:0.2}},"
        "{id:'vec',type:'arrow',x1:160,y1:300,x2:x,y2:y,label:'b2',style:{stroke:'#c4622d',strokeWidth:3}},"
        "{id:'eq',type:'formula',x:440,y:80,tex:'\\\\vec{v}=a\\\\vec{b}_1+b\\\\vec{b}_2',style:{fill:'#0f172a',fontSize:16}}"
        "]};}"
    )
    lab = validate_lab(
        {
            "title": "斜基变换演示",
            "summary": "拖动 b2 观察平行四边形分解变化",
            "params": [
                {"id": "bx", "label": "b2 横分量", "min": 0, "max": 4, "step": 0.1, "default": 1.5},
                {"id": "by", "label": "b2 纵分量", "min": 0, "max": 3.6, "step": 0.1, "default": 2.0},
            ],
            "public_params": ["bx", "by"],
            "timeline": {
                "duration_s": 6,
                "stops": [{"t": 0, "label": "起点"}, {"t": 0.5, "label": "展开"}, {"t": 1, "label": "完成"}],
            },
            "program": program,
        },
        probe=True,
    )
    assert lab["title"] == "斜基变换演示"
    assert len(lab["params"]) == 2


def test_validate_lab_rejects_drag_handle_with_unknown_param():
    program = (
        "function render(input){"
        "var x=160+input.bx*40+input.t*60;"
        "return {version:'ppt-ai.view.1',width:720,height:420,"
        "interactions:[{type:'drag-handle',id:'h_bad',x:x,y:200,xParam:'missing_param',"
        "bounds:{xMin:100,xMax:500,yMin:80,yMax:320},valueRange:{x:[0,4]}}],"
        "nodes:[{id:'vec',type:'arrow',x1:100,y1:200,x2:x,y2:200,style:{stroke:'#c4622d',strokeWidth:3}}]};}"
    )
    with pytest.raises(PageLabError, match="missing_param"):
        validate_lab(
            {
                "title": "非法手柄",
                "summary": "引用未定义参数",
                "params": [{"id": "bx", "label": "bx", "min": 0, "max": 4, "step": 0.1, "default": 1}],
                "timeline": {"duration_s": 4, "stops": [{"t": 0, "label": "开始"}, {"t": 1, "label": "结束"}]},
                "program": program,
            },
            probe=True,
        )


def test_generate_page_lab_passes_vision_image_and_falls_back_cleanly(monkeypatch):
    captured: list[dict] = []

    class FakeClient:
        def __init__(self, *, vision_ok: bool):
            self._vision_ok = vision_ok
            self.settings = SimpleNamespace(llm_model="test-model")

        def available(self):
            return True

        def generate_json(self, task, payload, version, budget, **kwargs):
            budget.used_calls += 1
            captured.append({"payload": payload, "image_urls": kwargs.get("image_urls")})
            return SimpleNamespace(
                data={
                    "title": "视觉融合演示",
                    "summary": "随时间展示向量伸缩",
                    "params": [{"id": "gain", "label": "增益", "min": 0.5, "max": 2.0, "step": 0.1, "default": 1.0}],
                    "public_params": ["gain"],
                    "timeline": {"duration_s": 5, "stops": [{"t": 0, "label": "初始"}, {"t": 1, "label": "终点"}]},
                    "program": (
                        "function render(input){var x=100+input.t*input.gain*180;"
                        "return {version:'ppt-ai.view.1',width:720,height:420,interactions:[],"
                        "nodes:[{id:'v',type:'arrow',x1:100,y1:210,x2:x,y2:210,label:'v',style:{stroke:'#2563eb',strokeWidth:3}}]};}"
                    ),
                }
            )

    context = {
        "material_title": "线性代数",
        "page_no": 1,
        "page_title": "基变换",
        "page_text": "One displacement, two coordinate systems",
        "figure_summary": [{"id": "b2", "kind": "arrow", "label": "b₂"}],
        "relations_summary": [{"id": "rel_1", "kind": "basis_decompose"}],
        "_image_data_uri": "data:image/jpeg;base64,FAKE_IMG",
    }

    # 1. 视觉模型可用：传递 image_urls，且 payload["page"] 中不含内部 _image_data_uri
    monkeypatch.setattr("app.model_profiles.vision_profile", lambda _s: SimpleNamespace(available=True))
    lab_vision = generate_page_lab(context, client=FakeClient(vision_ok=True))
    assert lab_vision["version"] == PAGE_LAB_VERSION
    assert captured[-1]["image_urls"] == ["data:image/jpeg;base64,FAKE_IMG"]
    assert "_image_data_uri" not in captured[-1]["payload"]["page"]
    assert captured[-1]["payload"]["page"]["figure_summary"][0]["id"] == "b2"

    # 2. 视觉模型未配置：平滑降级为纯文本（image_urls 为 None），仍保留 figure_summary 与 relations_summary
    monkeypatch.setattr("app.model_profiles.vision_profile", lambda _s: SimpleNamespace(available=False))
    lab_text = generate_page_lab(context, client=FakeClient(vision_ok=False))
    assert lab_text["version"] == PAGE_LAB_VERSION
    assert captured[-1]["image_urls"] is None
    assert captured[-1]["payload"]["page"]["relations_summary"][0]["kind"] == "basis_decompose"

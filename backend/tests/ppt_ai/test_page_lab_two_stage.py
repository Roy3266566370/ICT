"""验证通文册 page_lab 两段式（视觉图示描述 -> 主力文本写交互图画）与交互图画硬校验。"""

from __future__ import annotations

from typing import Any, Mapping
import pytest

from app.ppt_ai.client import PPTAIClient, PPTAIError, PPTAIResponse
from app.ppt_ai.page_lab import PageLabError, generate_page_lab, validate_lab
from app.ppt_ai.types import CallBudget
from app.settings import Settings


def _valid_interactive_drawing_lab() -> dict[str, Any]:
    return {
        "title": "斜面受力矢量交互",
        "summary": "拖动倾角与播放时间轴，观察滑块下滑与重力分解矢量变化",
        "params": [{"id": "angle", "label": "斜面倾角", "min": 15, "max": 60, "step": 1, "default": 30}],
        "public_params": ["angle"],
        "timeline": {
            "duration_s": 6,
            "stops": [
                {"t": 0, "label": "初始释放"},
                {"t": 0.5, "label": "沿斜面加速"},
                {"t": 1, "label": "到达底端"},
            ],
        },
        "explain": ["倾角越大，沿斜面分力越大", "可直接在图画上拖动控制手柄"],
        "program": """function render(input) {
  var rad = (input.angle || 30) * Math.PI / 180;
  var dist = 40 + (input.t || 0) * 180;
  var bx = 140 + dist * Math.cos(rad);
  var by = 120 + dist * Math.sin(rad);
  var fx = 70 * Math.sin(rad);
  return {
    version: 'ppt-ai.view.1',
    width: 720,
    height: 420,
    interactions: [{
      type: 'drag-handle',
      id: 'h_angle',
      label: '拖动调倾角',
      x: Math.round(bx),
      y: Math.round(by),
      xParam: 'angle',
      bounds: { xMin: 140, xMax: 520, yMin: 100, yMax: 340 },
      valueRange: { x: [15, 60] }
    }],
    nodes: [
      { id: 'slope', type: 'line', x1: 120, y1: 110, x2: 120 + 320 * Math.cos(rad), y2: 110 + 320 * Math.sin(rad), style: { stroke: '#334155', strokeWidth: 3 } },
      { id: 'block', type: 'circle', cx: bx, cy: by, r: 16, style: { fill: '#3b82f6', stroke: '#1e3a8a', strokeWidth: 2 } },
      { id: 'force', type: 'arrow', x1: bx, y1: by, x2: bx + fx * Math.cos(rad), y2: by + fx * Math.sin(rad), label: 'mgsinθ', style: { stroke: '#dc2626', strokeWidth: 2.5 } },
      { id: 'lbl', type: 'text', x: 40, y: 40, text: 'θ=' + input.angle + '°', style: { fill: '#0f172a', fontSize: 16 } }
    ]
  };
}""",
    }


class _FakeTwoStageClient(PPTAIClient):
    def __init__(self, *, vision_available: bool = True, fail_vision: bool = False) -> None:
        settings = Settings(
            llm_provider="maas",
            llm_model="qwen-coder-text",
            llm_base_url="https://text.example.com/v1",
            llm_api_key="sk-text",
            living_figure_vision_provider="maas" if vision_available else "none",
            living_figure_vision_model="qwen-vl-vision" if vision_available else "",
            living_figure_vision_base_url="https://vision.example.com/v1" if vision_available else "",
            living_figure_vision_api_key="sk-vision" if vision_available else "",
        )
        super().__init__(settings=settings)
        self._vision_ok = vision_available
        self._fail_vision = fail_vision
        self.calls: list[dict[str, Any]] = []

    def has_vision_target(self) -> bool:
        return self._vision_ok

    def available(self) -> bool:
        return True

    def generate_json(
        self,
        task_type: str,
        input_payload: Mapping[str, Any],
        schema_version: str,
        budget: CallBudget,
        **kwargs: Any,
    ) -> PPTAIResponse:
        budget.used_calls += 1
        self.calls.append({
            "task_type": task_type,
            "target_role": kwargs.get("target_role"),
            "image_urls": kwargs.get("image_urls"),
            "input_payload": input_payload,
        })
        if task_type == "page_lab_vision_describe":
            if self._fail_vision:
                raise PPTAIError("timeout", "视觉模型超时")
            return PPTAIResponse(
                data={
                    "has_figure": True,
                    "visual_type": "力学受力图",
                    "layout_and_elements": "左侧倾角为θ的斜面，滑块在斜面上，红色箭头表示重力分力",
                    "symbols": ["θ", "m", "g"],
                    "interactive_blueprint": "画斜面与滑块及受力箭头，随t下滑，调θ改变斜面倾角",
                    "suggested_drag_handle": "滑块位置绑定倾角",
                },
                raw_text="{}",
                used_calls=1,
                prompt_tokens=10,
                completion_tokens=10,
                finish_reason="stop",
                model="qwen-vl-vision",
            )
        return PPTAIResponse(
            data=_valid_interactive_drawing_lab(),
            raw_text="{}",
            used_calls=budget.used_calls,
            prompt_tokens=10,
            completion_tokens=10,
            finish_reason="stop",
            model="qwen-coder-text",
        )


def test_generate_page_lab_uses_vision_for_brief_and_text_model_for_code():
    client = _FakeTwoStageClient(vision_available=True)
    ctx = {
        "page_no": 3,
        "page_title": "斜面受力分析",
        "page_text": "物体沿倾角为 θ 的光滑斜面下滑",
        "_image_data_uri": "data:image/jpeg;base64,ZmFrZQ==",
    }
    lab = generate_page_lab(ctx, client=client)

    assert len(client.calls) == 2
    # 阶段 1：视觉模型只看图出描述
    assert client.calls[0]["task_type"] == "page_lab_vision_describe"
    assert client.calls[0]["target_role"] == "vision"
    assert client.calls[0]["image_urls"] == ["data:image/jpeg;base64,ZmFrZQ=="]

    # 阶段 2：主力文本模型写代码，不再传大图，而是消费 visual_figure_brief
    assert client.calls[1]["task_type"] == "page_lab"
    assert client.calls[1]["target_role"] == "text"
    assert client.calls[1]["image_urls"] is None
    page_sent = client.calls[1]["input_payload"]["page"]
    assert page_sent["visual_figure_brief"]["visual_type"] == "力学受力图"
    assert "θ" in page_sent["visual_figure_brief"]["symbols"]

    assert lab["generator"]["pipeline"] == "vision_describe+text_code"
    assert lab["generator"]["model"] == "qwen-coder-text"
    assert lab["generator"]["vision_model"] == "qwen-vl-vision"


def test_generate_page_lab_gracefully_falls_back_when_vision_stage_fails():
    client = _FakeTwoStageClient(vision_available=True, fail_vision=True)
    ctx = {
        "page_no": 4,
        "page_title": "斜面受力分析",
        "page_text": "物体沿倾角为 θ 的光滑斜面下滑",
        "_image_data_uri": "data:image/jpeg;base64,ZmFrZQ==",
    }
    lab = generate_page_lab(ctx, client=client)

    assert len(client.calls) == 2
    assert client.calls[1]["target_role"] == "text"
    assert "visual_figure_brief" not in client.calls[1]["input_payload"]["page"]
    assert lab["generator"]["pipeline"] == "text_code"
    assert lab["generator"]["model"] == "qwen-coder-text"


def test_validate_lab_rejects_text_only_and_non_interactive_params():
    # 1) 纯文字无图画被拒绝
    text_only = {
        "title": "纯文字演示",
        "summary": "没有图形节点",
        "params": [{"id": "k", "label": "系数", "min": 1, "max": 5, "step": 1, "default": 2}],
        "public_params": ["k"],
        "timeline": {"duration_s": 5, "stops": [{"t": 0, "label": "开始"}, {"t": 1, "label": "结束"}]},
        "program": """function render(input) {
  return {
    version: 'ppt-ai.view.1', width: 720, height: 420, interactions: [],
    nodes: [{ id: 't1', type: 'text', x: 50 + (input.t || 0) * 100, y: 100, text: 'val=' + input.k, style: { fill: '#111111', fontSize: 16 } }]
  };
}""",
    }
    with pytest.raises(PageLabError, match="可视化图画节点"):
        validate_lab(text_only)

    # 2) 摆设参数（只随 t 动，改滑块图画完全不变）被拒绝
    fake_param = {
        "title": "摆设参数演示",
        "summary": "滑块不影响图形",
        "params": [{"id": "k", "label": "摆设参数", "min": 1, "max": 5, "step": 1, "default": 2}],
        "public_params": ["k"],
        "timeline": {"duration_s": 5, "stops": [{"t": 0, "label": "开始"}, {"t": 1, "label": "结束"}]},
        "program": """function render(input) {
  return {
    version: 'ppt-ai.view.1', width: 720, height: 420, interactions: [],
    nodes: [
      { id: 'c1', type: 'circle', cx: 100 + (input.t || 0) * 200, cy: 200, r: 20, style: { fill: '#2563eb' } },
      { id: 't1', type: 'text', x: 40, y: 40, text: 'k=' + input.k, style: { fill: '#111111', fontSize: 14 } }
    ]
  };
}""",
    }
    with pytest.raises(PageLabError, match="调节参数滑块时图画视觉状态未发生任何变化"):
        validate_lab(fake_param)


def test_ppt_ai_client_role_routing_separates_vision_and_text_models():
    settings = Settings(
        llm_provider="maas",
        llm_model="qwen-coder-text",
        llm_base_url="https://text.example.com/v1",
        llm_api_key="sk-text",
        living_figure_vision_provider="maas",
        living_figure_vision_model="qwen-vl-vision",
        living_figure_vision_base_url="https://vision.example.com/v1",
        living_figure_vision_api_key="sk-vision",
    )
    client = PPTAIClient(settings=settings)
    assert client.has_vision_target() is True
    assert client._active_target("vision")[1] == "qwen-vl-vision"  # type: ignore[index]
    assert client._active_target("text")[1] == "qwen-coder-text"  # type: ignore[index]
    assert client._active_target("auto")[1] == "qwen-vl-vision"  # type: ignore[index]


"""验证视觉模型（Qwen3-VL-32B）接入 ispec 主识别与通用图表截图提取通路。"""

from __future__ import annotations

import io
from types import SimpleNamespace

from PIL import Image

from app.ispec.builder import build_ispecs_detailed
from app.ispec.chart_extract import (
    extract_chart_from_image,
    looks_like_chart_candidate,
    validate_extracted_chart,
)
from app.ispec.llm import MaasProvider, NoopProvider, build_provider


def _make_png(width: int = 400, height: int = 260, color: tuple[int, int, int] = (245, 245, 245)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format="PNG")
    return buf.getvalue()


def test_build_provider_prefers_vision_profile_over_text_llm():
    settings = SimpleNamespace(
        living_figure_vision_provider="siliconflow",
        living_figure_vision_base_url="https://api.siliconflow.cn/v1",
        living_figure_vision_model="Qwen/Qwen3-VL-32B-Instruct",
        living_figure_vision_api_key="sk-vision-test",
        living_figure_vision_timeout_s=90,
        living_figure_max_calls=12,
        llm_provider="maas",
        llm_api_key="sk-text-test",
        llm_model="deepseek-v4.1-flash-1017",
        llm_base_url="https://api.modelarts-maas.com/v2",
        llm_timeout_s=60,
    )
    provider = build_provider(settings)
    assert isinstance(provider, MaasProvider)
    assert provider._model == "Qwen/Qwen3-VL-32B-Instruct"
    assert provider._endpoint == "https://api.siliconflow.cn/v1/chat/completions"


def test_build_provider_falls_back_to_maas_and_noop():
    maas_only = SimpleNamespace(
        living_figure_vision_provider="none",
        living_figure_vision_base_url="",
        living_figure_vision_model="",
        living_figure_vision_api_key="",
        living_figure_vision_timeout_s=90,
        living_figure_max_calls=12,
        llm_provider="maas",
        llm_api_key="sk-text-test",
        llm_model="deepseek-v4.1-flash-1017",
        llm_base_url="https://api.modelarts-maas.com/v2",
        llm_timeout_s=60,
    )
    p1 = build_provider(maas_only)
    assert isinstance(p1, MaasProvider)
    assert p1._model == "deepseek-v4.1-flash-1017"

    disabled = SimpleNamespace(
        living_figure_vision_provider="none",
        living_figure_vision_base_url="",
        living_figure_vision_model="",
        living_figure_vision_api_key="",
        living_figure_vision_timeout_s=90,
        living_figure_max_calls=12,
        llm_provider="none",
        llm_api_key="",
        llm_model="",
        llm_base_url="",
        llm_timeout_s=60,
    )
    assert isinstance(build_provider(disabled), NoopProvider)


def test_looks_like_chart_candidate_filters_non_charts():
    blob = _make_png(480, 300)
    assert looks_like_chart_candidate(blob, ocr_text="2024年季度营收趋势\nQ1 120 Q2 180") is True
    assert looks_like_chart_candidate(blob, ocr_text="纯文字介绍，没有数据") is False
    assert looks_like_chart_candidate(blob, ocr_text="2 1 1 2", has_matrix=True) is False
    assert looks_like_chart_candidate(_make_png(80, 50), ocr_text="Q1 10 Q2 20") is False


def test_validate_extracted_chart_accepts_valid_and_rejects_bad():
    ok = validate_extracted_chart({
        "is_chart": True,
        "chart_type": "line",
        "title": "训练 Loss 曲线",
        "categories": ["Epoch 1", "Epoch 2", "Epoch 3"],
        "series": [{"name": "Train Loss", "values": [1.2, 0.7, 0.35]}],
        "confidence": 0.91,
    })
    assert ok is not None
    assert ok["chart_type"] == "LINE"
    assert ok["categories"] == ["Epoch 1", "Epoch 2", "Epoch 3"]
    assert ok["series"][0]["values"] == [1.2, 0.7, 0.35]

    assert validate_extracted_chart({"is_chart": False}) is None
    assert validate_extracted_chart({
        "is_chart": True,
        "categories": ["A", "B"],
        "series": [{"name": "S", "values": [1.0]}],  # 长度不匹配
        "confidence": 0.9,
    }) is None
    assert validate_extracted_chart({
        "is_chart": True,
        "categories": ["A", "B"],
        "series": [{"name": "S", "values": [1.0, 2.0]}],
        "confidence": 0.4,  # 置信度不足
    }) is None


def test_extract_chart_from_image_caches_and_builds_vega_ispec(tmp_path, monkeypatch):
    import app.ispec.chart_extract as mod

    monkeypatch.setattr(mod, "DATA_DIR", tmp_path)

    class StubVisionClient:
        available = True
        profile = SimpleNamespace(model="Qwen/Qwen3-VL-32B-Instruct")

        def __init__(self) -> None:
            self.calls = 0

        def generate_json(self, *, image_png: bytes, prompt: str, max_output_tokens: int = 2048, response_model=None):
            self.calls += 1
            return {
                "is_chart": True,
                "chart_type": "column",
                "title": "模型准确率对比",
                "categories": ["ResNet", "ViT", "ConvNeXt"],
                "series": [{"name": "Top-1 (%)", "values": [76.2, 81.8, 83.1]}],
                "confidence": 0.94,
            }

    client = StubVisionClient()
    blob = _make_png(500, 320)
    chart_data, used1 = extract_chart_from_image(
        blob,
        ocr_text="模型准确率对比 76.2% 81.8% 83.1%",
        page_title="实验结果",
        client=client,
    )
    assert used1 is True
    assert chart_data is not None
    assert client.calls == 1

    # 二次调用命中内容寻址缓存，不再消耗视觉模型额度
    chart_data2, used2 = extract_chart_from_image(
        blob,
        ocr_text="模型准确率对比 76.2% 81.8% 83.1%",
        page_title="实验结果",
        client=client,
    )
    assert used2 is False
    assert chart_data2 == chart_data
    assert client.calls == 1

    # 直接喂进现有 build_ispecs_detailed，无需修改任何下游或前端代码即可产出 Vega 交互图表
    parsed = {
        "pages": [{
            "page_no": 1,
            "title": "实验结果",
            "width": 12192000,
            "height": 6858000,
            "elements": [{
                "element_id": "p01_s02",
                "kind": "picture",
                "bbox": {"x": 1000000, "y": 1500000, "w": 6000000, "h": 4000000},
                "chart_data": chart_data,
            }],
        }],
    }
    res = build_ispecs_detailed(parsed, material_id="mat_test_chart", llm=NoopProvider())
    assert len(res.ispecs) == 1
    spec = res.ispecs[0]
    assert spec["kind"] == "filter"
    assert any(v.get("type") == "vega" for v in spec.get("views", []))


def test_ppt_ai_client_prefers_vision_model_for_ai_interaction():
    from app.ppt_ai.client import PPTAIClient
    from app.ppt_ai.types import CallBudget

    captured = {}

    class CaptureTransport:
        def post(self, url, *, headers, json_body, timeout):
            captured["url"] = url
            captured["auth"] = headers["Authorization"]
            captured["model"] = json_body["model"]
            captured["timeout"] = timeout
            return 200, {
                "choices": [{"finish_reason": "stop", "message": {"content": '{"ok": true}'}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5},
            }

    settings = SimpleNamespace(
        living_figure_vision_provider="siliconflow",
        living_figure_vision_base_url="https://api.siliconflow.cn/v1",
        living_figure_vision_model="Qwen/Qwen3-VL-32B-Instruct",
        living_figure_vision_api_key="sk-vision-key",
        living_figure_vision_timeout_s=90,
        living_figure_max_calls=12,
        llm_provider="maas",
        llm_api_key="sk-text-key",
        llm_model="deepseek-v4.1-flash-1017",
        llm_base_url="https://api.modelarts-maas.com/v2",
        llm_timeout_s=60,
        llm_json_schema=False,
        ppt_ai_task_max_calls=8,
        ppt_ai_max_llm_tokens=4000,
    )
    client = PPTAIClient(settings=settings, transport=CaptureTransport())
    assert client.available() is True
    assert client.status()["model"] == "Qwen/Qwen3-VL-32B-Instruct"

    resp = client.generate_json(
        "test_transport",
        {"page_text": "test"},
        "v1",
        CallBudget(max_calls=2, output_tokens_limit=4000),
    )
    assert resp.data == {"ok": True}
    assert captured["url"] == "https://api.siliconflow.cn/v1/chat/completions"
    assert captured["auth"] == "Bearer sk-vision-key"
    assert captured["model"] == "Qwen/Qwen3-VL-32B-Instruct"
    assert captured["timeout"] == 90.0

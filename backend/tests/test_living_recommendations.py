"""AI 筛选交互知识点：覆盖全文、排除已有模型并校验来源。"""
from types import SimpleNamespace
import pytest

from app.living import ai


def document():
    return {"title": "注意力讲义", "revision": 1, "blocks": [
        {"id": "s", "type": "section", "data": {"heading": "第 1 页 · 注意力"}},
        {"id": "b1", "type": "text", "source": {"file_id": "f1", "page": 1}, "data": {"md": "注意力权重通过 Softmax 计算，可以改变温度观察分布。"}},
        {"id": "s2", "type": "section", "data": {"heading": "第 75 页 · 层归一化"}},
        {"id": "b2", "type": "text", "source": {"file_id": "f1", "page": 75}, "data": {"md": "层归一化对特征求均值和方差，再用缩放系数和平移量变换。"}},
    ]}


class Client:
    def generate_json(self, task_type, payload, *args, **kwargs):
        self.task_type, self.payload = task_type, payload
        return SimpleNamespace(data={"summary": "优先选择可调参数和可观测结果明确的内容", "recommendations": [
            {"block_id": "b2", "title": "层归一化实验", "reason": "可比较变换前后的分布",
             "interaction": "调节缩放和平移参数", "observation": "查看均值、方差和特征柱状图"},
            {"block_id": "invented", "title": "伪造页", "reason": "无来源", "interaction": "调参", "observation": "图形"},
            {"block_id": "b2", "title": "重复", "reason": "重复", "interaction": "调参", "observation": "图形"},
        ]})


def test_recommender_reads_last_page_and_returns_grounded_unique_suggestions():
    client = Client()
    result = ai.recommend_models(document(), client=client)
    assert client.task_type == "living_interaction_selection"
    assert [b["block_id"] for b in client.payload["candidates"]] == ["b1", "b2"]
    assert result["reviewed_blocks"] == 2
    assert len(result["recommendations"]) == 1
    assert result["recommendations"][0]["page"] == 75
    assert "缩放" in result["recommendations"][0]["design_goal"]


def test_recommender_excludes_existing_models_but_passes_their_topics():
    doc = document()
    doc["blocks"].append({"id": "m", "type": "canvas", "data": {"doc": {
        "template": "ai_model", "anchor_id": "b1", "model": {"title": "注意力权重实验"}}}})
    client = Client()
    result = ai.recommend_models(doc, client=client)
    assert [b["block_id"] for b in client.payload["candidates"]] == ["b2"]
    assert "注意力权重实验" in str(client.payload["existing_topics"])
    assert result["existing_models"] == 1


def test_long_document_keeps_all_candidates_with_bounded_excerpts():
    doc = {"title": "长讲义", "blocks": [{"id": f"b{i}", "type": "text", "data": {"md": "开始" + "内容" * 10000 + "结尾"}} for i in range(300)]}
    client = Client()
    result = ai.recommend_models(doc, client=client)
    assert len(client.payload["candidates"]) == 300
    assert sum(len(c["excerpt"]) for c in client.payload["candidates"]) <= 70000
    assert client.payload["candidates"][-1]["excerpt"].endswith("结尾")
    assert result["truncated_blocks"] == 300


def test_no_eligible_text_does_not_call_model():
    result = ai.recommend_models({"blocks": []}, client=object())
    assert result["recommendations"] == []
    assert result["reviewed_blocks"] == 0


def test_malformed_ai_response_is_not_reported_as_no_interactive_content():
    class BadClient:
        def generate_json(self, *args, **kwargs):
            return SimpleNamespace(data={"recommendations": "broken"})
    with pytest.raises(ValueError):
        ai.recommend_models(document(), client=BadClient())

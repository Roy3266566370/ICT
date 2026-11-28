"""AI 规则方块：结构化清洗与未配置模型的明确状态。"""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.workshop import ai_rule


VALID_CODE = (
    "function run({ params }) {"
    " const frames = [];"
    " for (let i = 0; i < params.n; i += 1) frames.push({ title: String(i), summary: '帧' });"
    " return { data: {}, frames: frames };"
    "}"
)


def test_normalize_rule_payload_keeps_contract_and_filters_unknown_preset_params():
    result = ai_rule.normalize_rule_payload({
        "prompt": "演示一个计数过程",
        "title": "计数",
        "summary": "逐帧计数",
        "controls": [
            {"key": "n", "label": "次数", "value": 3, "min": 1, "max": 9, "step": 1},
            {"key": "bad key", "label": "坏", "value": 1},
        ],
        "presets": [
            {"name": "小规模", "params": {"n": 2}, "text": "1 2"},
            {"title": "未知参数", "params": {"unknown": 1}},
            {"label": "无参数", "params": {"n": 3}},
        ],
        "preferredView": "timeline",
        "code": VALID_CODE,
        "verificationNote": "n=2 时两帧",
    })
    assert result["version"] == 1
    assert result["preferredView"] == "timeline"
    assert result["controls"] == [
        {"key": "n", "label": "次数", "value": 3.0, "min": 1.0, "max": 9.0, "step": 1.0}
    ]
    assert result["presets"] == [
        {"label": "小规模", "params": {"n": 2.0}, "text": "1 2"},
        {"label": "无参数", "params": {"n": 3.0}},
    ]
    assert result["verificationNote"] == "n=2 时两帧"


def test_normalize_rule_payload_rejects_missing_run_and_forbidden_apis():
    with pytest.raises(ValueError, match="function run"):
        ai_rule.normalize_rule_payload({"code": "return 1", "controls": []})
    with pytest.raises(ValueError, match="被禁止"):
        ai_rule.normalize_rule_payload({
            "code": "function run(){ fetch('/api') }",
            "controls": [],
        })
    with pytest.raises(ValueError, match="被禁止"):
        ai_rule.normalize_rule_payload({
            "code": "async function run(){ return {} }",
            "controls": [],
        })


def test_generate_ai_rule_without_model_returns_readable_unavailable_error():
    stub = SimpleNamespace(llm_api_key="", llm_model="", llm_provider="none", llm_base_url="")
    with patch.object(ai_rule, "get_settings", return_value=stub):
        with pytest.raises(ai_rule.AiRuleUnavailable, match="LLM_API_KEY"):
            ai_rule.generate_ai_rule("生成一个实验")


@pytest.mark.parametrize("view", ["shapes", "grid"])
def test_normalize_rule_payload_supports_new_visual_views(view):
    result = ai_rule.normalize_rule_payload({"code": VALID_CODE, "preferredView": view})
    assert result["preferredView"] == view

def test_generate_ai_rule_reports_the_failed_validation(monkeypatch):
    settings = SimpleNamespace(
        llm_api_key="test", llm_model="test", llm_provider="test",
        llm_base_url="https://example.invalid/v1", llm_timeout_s=10,
    )
    monkeypatch.setattr(ai_rule, "get_settings", lambda: settings)
    monkeypatch.setattr(ai_rule.HttpxTransport, "post", lambda *args, **kwargs: (
        200, {"choices": [{"message": {"content": '{"code":"invalid"}'}}]},
    ))

    with pytest.raises(ai_rule.AiRuleUnavailable, match="code 必须包含 function run"):
        ai_rule.generate_ai_rule("生成一个实验")


def test_normalize_rule_payload_supports_custom_inputs_and_outputs():
    result = ai_rule.normalize_rule_payload({
        "code": VALID_CODE,
        "inputs": [
            {"id": "supply", "label": "供给量", "kind": "scalar"},
            {"id": "demand", "label": "需求量", "kind": "scalar"},
            {"id": "bad id", "label": "非法", "kind": "scalar"},
            {"id": "supply", "label": "重复", "kind": "scalar"},
        ],
        "outputs": [
            {"id": "price", "label": "均衡价", "kind": "scalar"},
            {"id": "curve", "label": "曲线", "kind": "series"},
            {"id": "wrong", "label": "非法输出类型", "kind": "matrix2"},
        ],
    })
    assert result["inputs"] == [
        {"id": "supply", "label": "供给量", "kind": "scalar"},
        {"id": "demand", "label": "需求量", "kind": "scalar"},
    ]
    assert result["outputs"] == [
        {"id": "price", "label": "均衡价", "kind": "scalar"},
        {"id": "curve", "label": "曲线", "kind": "series"},
    ]


def test_fuse_ai_rule_and_summarize_composite_handle_unavailable_and_success(monkeypatch):
    stub_off = SimpleNamespace(llm_api_key="", llm_model="", llm_provider="none", llm_base_url="")
    with patch.object(ai_rule, "get_settings", return_value=stub_off):
        with pytest.raises(ai_rule.AiRuleUnavailable, match="LLM_API_KEY"):
            ai_rule.fuse_ai_rule([{"id": "a"}, {"id": "b"}], [], {}, "合并为综合图")
        with pytest.raises(ai_rule.AiRuleUnavailable, match="LLM_API_KEY"):
            ai_rule.summarize_composite([{"id": "a", "type": "slider", "title": "滑杆"}], [], [])

    settings = SimpleNamespace(
        llm_api_key="test", llm_model="test", llm_provider="test",
        llm_base_url="https://example.invalid/v1", llm_timeout_s=15,
    )
    monkeypatch.setattr(ai_rule, "get_settings", lambda: settings)
    monkeypatch.setattr(ai_rule.HttpxTransport, "post", lambda *args, **kwargs: (
        200,
        {"choices": [{"message": {"content": '{"title":"供需均衡组","summary":"根据弹性与税率计算均衡价格"}'}}]},
    ))
    summary = ai_rule.summarize_composite(
        [{"id": "n1", "type": "slider", "title": "弹性"}],
        [],
        [{"id": "po1", "dir": "out", "label": "价格"}],
    )
    assert summary == {"title": "供需均衡组", "summary": "根据弹性与税率计算均衡价格"}



def test_normalize_compose_plan_filters_invalid_types_and_wires() -> None:
    plan = ai_rule.normalize_compose_plan(
        {
            "title": "弹簧能量实验",
            "summary": "弹簧振子连接轨迹仪与能量表",
            "add_nodes": [
                {"ref": "osc", "type": "springOsc", "params": {"k": 4, "bad": float("nan")}},
                {"ref": "meter", "type": "energyMeter"},
                {"ref": "evil", "type": "notInCatalog"},
            ],
            "wires": [
                {"from": "osc", "fromPort": "out", "to": "meter", "toPort": "in"},
                {"from": "osc", "fromPort": "out", "to": "osc", "toPort": "in"},
                {"from": "exist_1", "fromPort": "out", "to": "meter", "toPort": "in"},
                {"from": "evil", "fromPort": "out", "to": "meter", "toPort": "in"},
            ],
        },
        allowed_types={"springOsc", "energyMeter"},
        existing_ids={"exist_1"},
    )
    assert len(plan["add_nodes"]) == 2
    assert plan["add_nodes"][0]["params"] == {"k": 4.0}
    # 同一输入口 (meter, in) 去重只保留首条有效连线，自环与无效 ref 均被过滤
    assert plan["wires"] == [{"from": "osc", "fromPort": "out", "to": "meter", "toPort": "in"}]

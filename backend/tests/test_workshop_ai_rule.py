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

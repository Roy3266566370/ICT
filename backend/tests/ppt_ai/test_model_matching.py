"""模型参与匹配：正确建议被采用；不一致建议不能覆盖原文。"""

from __future__ import annotations

import json

from app.ppt_ai.conditions import extract_conditions
from app.ppt_ai.client import PPTAIClient
from app.ppt_ai.planner import plan_interactions
from app.ppt_ai.regions import extract_regions
from app.ppt_ai.types import CallBudget
from app.settings import Settings
from tests.ppt_ai import helpers


class ReplayTransport:
    def __init__(self, region_id: str):
        self.region_id = region_id
        self.calls = 0

    def post(self, url, *, headers, json_body, timeout):
        self.calls += 1
        payload = json_body["messages"][1]["content"]
        task_type = json.loads(payload)["task_type"]
        if task_type == "match_propose":
            content = {
                "regions": [
                    {
                        "region_id": self.region_id,
                        "abstain": False,
                        "reason": "单位换算后采用",
                        "candidates": [
                            {
                                "template_ref": {"id": "physics.projectile", "version": "1.0"},
                                "parameters": [],
                                "missing": [],
                                "conflicts": [],
                                "rationale": "原文是抛体运动",
                                "confidence": 0.9,
                            }
                        ],
                    }
                ]
            }
        else:
            content = {"options": []}
        return 200, {
            "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(content, ensure_ascii=False)}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1},
        }


def _settings() -> Settings:
    return Settings(
        llm_provider="maas",
        llm_api_key="unit-test-key",
        llm_model="unit-model",
        llm_base_url="https://example.invalid/v2",
        llm_timeout_s=5,
        ppt_ai_max_llm_tokens=1024,
    )


def test_model_proposal_is_adopted_only_after_program_checks() -> None:
    snapshot = helpers.snapshot(
        "mat_model_projectile",
        hash_char="6",
        pages=[
            {
                "page_no": 1,
                "width": helpers.PAGE_W,
                "height": helpers.PAGE_H,
                "elements": [helpers.element("e1", "text", text="抛体运动：初速度 v0 = 10 m/s，仰角 30°，g = 9.8 m/s^2，t = 1 s。")],
            }
        ],
    )
    extraction = extract_regions(snapshot)
    condition_sets = extract_conditions(snapshot, extraction.regions)
    transport = ReplayTransport(condition_sets[0].region_id)
    budget = CallBudget(max_calls=2)
    plan = plan_interactions(
        extraction,
        snapshot,
        budget=budget,
        client=PPTAIClient(_settings(), transport=transport),
    )
    option = next(item for item in plan.options if item.operator_id == "physics.projectile")
    assert option.support_status == "supported"
    assert option.provider["matching"]["model_used"] is True
    assert budget.used_calls == 2
    assert transport.calls == 2

"""AI 调度解题：能力目录、计划校验、调度执行、完整性边界与版本绑定。"""
from __future__ import annotations

import math

import pytest

from app.labs.capabilities import capability_catalog
from app.labs.orchestrator import (
    MAX_STEPS,
    build_understanding,
    deterministic_plan,
    execute_plan,
    should_recompute,
    solve_composite,
    validate_plan,
)

TEXT = "在0≤x≤2内，求曲线y=x²−x与x轴之间的面积，以及该区域绕x轴旋转所得旋转体的体积。"


def test_capability_catalog_distinguishes_kinds():
    catalog = capability_catalog()
    kinds = {c["kind"] for c in catalog["capabilities"]}
    assert kinds == {"compute", "check", "visual"}
    ids = {c["id"] for c in catalog["capabilities"]}
    assert {"integral", "geometric_area", "rotation_volume",
            "zeros_on_interval", "assemble_report"} <= ids
    for cap in catalog["capabilities"]:
        assert cap["required"] is not None
        assert cap["limits"] and cap["returns"]
    by_id = {c["id"]: c["kind"] for c in catalog["capabilities"]}
    assert by_id["integral"] == "compute"
    assert by_id["zeros_on_interval"] == "check"
    assert by_id["assemble_report"] == "visual"
    assert catalog["kind_legend"]["check"]


def test_understanding_and_plan_are_separate_documents():
    understanding = build_understanding(TEXT, use_ai=False)
    assert len(understanding["asked"]) == 2          # 两个小问
    assert any("面积" in q["goal"] for q in understanding["asked"])
    assert any("体积" in q["goal"] for q in understanding["asked"])
    plan = deterministic_plan(TEXT, understanding)
    assert plan is not None
    check = validate_plan(plan, understanding)
    assert check["ok"], check["errors"]
    caps = [s["capability"] for s in plan["steps"]]
    assert "geometric_area" in caps and "rotation_volume" in caps
    area_step = next(s for s in plan["steps"] if s["capability"] == "geometric_area")
    # 专用内核覆盖零点、分段正负与分段积分，而不是机械拆成微步骤（§4）
    assert {"判断分段正负", "计算分段面积"} <= set(area_step["covers"])
    assert any(row["source"] == "原题" for row in check["provenance"])


def test_composite_execution_matches_hand_results():
    result = solve_composite(TEXT, use_ai=False)
    assert result["plan_check"]["ok"]
    assert result["status"] == "完成"
    by_goal = {a["goal"]: a for a in result["answers"]}
    q1 = next(v for k, v in by_goal.items() if "面积" in k)
    q2 = next(v for k, v in by_goal.items() if "体积" in k)
    assert q1["value"] == pytest.approx(1.0)                    # 手算：1/6 + 5/6
    assert q2["value"] == pytest.approx(16 * math.pi / 15)      # 手算：π∫₀²(x²−x)²
    provenance = result["solve"]["provenance"]
    assert any(row["source"] == "原题" for row in provenance)
    shade = next(v for v in result["presentation"]["visuals"] if v["kind"] == "region_shade")
    assert shade["zeros"] == [0.0, 1.0]                         # 分段点来自零点步骤
    assert "S2" in shade["provenance"]["zeros"]
    states = {s["id"]: s["state"] for s in result["solve"]["steps"]}
    assert all(state == "完成且满足要求" for state in states.values())
    kinds = {v["kind"] for v in result["presentation"]["visuals"]}
    assert {"curve", "region_shade", "revolution_solid", "step_timeline"} <= kinds


def test_validator_rejects_unknown_capability_and_missing_inputs():
    understanding = build_understanding(TEXT, use_ai=False)
    bad = {"steps": [{"id": "S1", "goal": "求面积", "capability": "huffman", "inputs": {}}]}
    check = validate_plan(bad, understanding)
    assert not check["ok"]
    assert any("不在目录" in e for e in check["errors"])
    bad2 = {"steps": [{"id": "S1", "goal": "求面积", "capability": "geometric_area", "inputs": {}}]}
    check2 = validate_plan(bad2, understanding)
    assert any("缺少必需输入" in e for e in check2["errors"])


def test_validator_rejects_circular_dependency():
    understanding = build_understanding(TEXT, use_ai=False)
    circular = {"steps": [
        {"id": "S1", "goal": "求面积", "capability": "geometric_area", "subquestion": "Q1",
         "inputs": {"expression": {"source": "step", "ref": "S2", "value": "x^2-x"},
                    "lower": {"source": "plan", "value": 0}, "upper": {"source": "plan", "value": 2},
                    "region_kind": {"source": "plan", "value": "between_axis"}}},
        {"id": "S2", "goal": "求零点", "capability": "zeros_on_interval",
         "inputs": {"expression": {"source": "step", "ref": "S1", "value": "x^2-x"},
                    "variable": {"source": "plan", "value": "x"},
                    "lower": {"source": "plan", "value": 0}, "upper": {"source": "plan", "value": 2}}},
    ]}
    check = validate_plan(circular, understanding)
    assert any("循环依赖" in e for e in check["errors"])


def test_unused_condition_is_warning_not_error():
    understanding = build_understanding(TEXT, use_ai=False)
    plan = deterministic_plan(TEXT, understanding)
    understanding["given"].append({"id": "G9", "item": "一段未被使用的备注", "ref": "extra"})
    check = validate_plan(plan, understanding)
    assert check["ok"]
    assert any("G9" in w for w in check["warnings"])


def test_budget_limits_steps():
    understanding = build_understanding(TEXT, use_ai=False)
    steps = [{"id": f"S{i}", "goal": "检查", "capability": "domain_check",
              "inputs": {"expression": {"source": "plan", "value": "x^2"},
                         "variable": {"source": "plan", "value": "x"},
                         "lower": {"source": "plan", "value": 0},
                         "upper": {"source": "plan", "value": 2}}}
             for i in range(MAX_STEPS + 1)]
    check = validate_plan({"steps": steps}, understanding)
    assert any("超出预算" in e for e in check["errors"])


def test_zeros_incompleteness_blocks_dependents():
    plan = {"steps": [
        {"id": "S1", "goal": "求零点", "capability": "zeros_on_interval",
         "inputs": {"expression": {"source": "plan", "value": "x+cos(x)"},
                    "variable": {"source": "plan", "value": "x"},
                    "lower": {"source": "plan", "value": 0}, "upper": {"source": "plan", "value": 4}}},
        {"id": "S2", "goal": "确认分段符号", "capability": "sign_segments",
         "inputs": {"expression": {"source": "plan", "value": "x+cos(x)"},
                    "variable": {"source": "plan", "value": "x"},
                    "lower": {"source": "plan", "value": 0}, "upper": {"source": "plan", "value": 4},
                    "zeros": {"source": "step", "ref": "S1", "field": "zeros"}}},
    ]}
    execution = execute_plan(TEXT, plan, build_understanding(TEXT, use_ai=False))
    states = {s["id"]: s["state"] for s in execution["solve"]["steps"]}
    # §6 边界：“没找到全部零点”不能当成“没有其他零点”→ 完整性未确认 → 依赖步骤等待
    assert states["S1"] == "等待确认"
    assert states["S2"] == "未执行（依赖未满足）"
    # 步骤结果的传递在条件来源中留痕（§5）
    assert any(row["source"] == "前序步骤" for row in execution["solve"]["provenance"])


def test_replan_is_bounded_and_recorded():
    plan = {"steps": [
        {"id": "S1", "goal": "面积", "capability": "geometric_area", "subquestion": "Q1",
         "inputs": {"expression": {"source": "plan", "value": "x^^2"},
                    "lower": {"source": "plan", "value": 0}, "upper": {"source": "plan", "value": 2},
                    "region_kind": {"source": "plan", "value": "between_axis"}}},
        {"id": "S2", "goal": "汇总", "capability": "assemble_report",
         "inputs": {"steps": {"source": "plan", "value": ["S1"]}}},
    ]}
    calls = {"n": 0}

    def replan(step, error):
        calls["n"] += 1
        return {"id": step["id"], "goal": step["goal"], "capability": "domain_check",
                "inputs": {"expression": {"source": "plan", "value": "x^^2"},
                           "variable": {"source": "plan", "value": "x"},
                           "lower": {"source": "plan", "value": 0},
                           "upper": {"source": "plan", "value": 2}}}

    execution = execute_plan(TEXT, plan, build_understanding(TEXT, use_ai=False), replan=replan)
    assert calls["n"] == 1  # Changing a compute obligation to a check is rejected immediately.
    assert len(execution["solve"]["adjustments"]) == 1
    assert execution["solve"]["adjustments"][0]["step"] == "S1"
    assert execution["solve"]["adjustments"][0]["from"] == "geometric_area"
    assert execution["solve"]["adjustments"][0]["rejected"]
    assert execution["results"]["S1"]["state"] != "完成且满足要求"


def test_version_binding_and_previous_preserved():
    result = solve_composite(TEXT, use_ai=False)
    version = result["problem"]["version"]
    assert version
    assert not should_recompute(result, TEXT)                # 题面未变（如只改笔记）→ 不重算
    reused = solve_composite(TEXT, previous=result, use_ai=False)
    assert reused.get("reused") is True
    new_text = TEXT.replace("0≤x≤2", "0≤x≤3")
    assert should_recompute(result, new_text)
    updated = solve_composite(new_text, previous=result, use_ai=False)
    assert updated["problem"]["version"] != version
    assert updated["previous_summary"]["version"] == version  # 原题结果保留，便于比较
    q1 = next(a for a in updated["answers"] if "面积" in (a.get("goal") or ""))
    assert q1["value"] == pytest.approx(29 / 6)               # [0,3]：1/6 + 14/3（内核手算双验）


def test_ai_failure_falls_back_to_deterministic(monkeypatch):
    import app.labs.orchestrator as orch

    def boom(*args, **kwargs):
        raise RuntimeError("maas offline")

    monkeypatch.setattr(orch, "_ai_available", lambda: True)
    monkeypatch.setattr("app.labs.staged_understanding.request_json", boom)
    result = solve_composite(TEXT)
    assert result["plan_check"]["ok"]
    assert result["planner"]["mode"] == "deterministic"
    assert result["status"] == "完成"


def test_ai_plan_used_when_available(monkeypatch):
    import app.labs.orchestrator as orch

    understanding = build_understanding(TEXT, use_ai=False)
    plan = deterministic_plan(TEXT, understanding)

    def fake_request_json(messages, schema, deadline):
        if schema is orch.UNDERSTANDING_SCHEMA:
            return {"given": [{"id": "A0", "item": "AI 补充：被积函数为多项式"}],
                    "asked": [], "ambiguities": []}
        return plan

    monkeypatch.setattr(orch, "_ai_available", lambda: True)
    monkeypatch.setattr("app.labs.staged_understanding.request_json", fake_request_json)
    result = solve_composite(TEXT)
    assert result["planner"]["mode"] == "ai"
    assert result["plan_check"]["ok"]
    assert result["status"] == "完成"

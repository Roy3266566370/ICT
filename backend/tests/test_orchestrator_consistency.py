"""调度一致性回归：分问条件、AI 合并、计划语义校验、重规划溯源与统一时限。"""
from __future__ import annotations

import time

import pytest

from app.labs import orchestrator as o


def test_each_subquestion_updates_its_own_interval():
    text = "在0≤x≤1内，求曲线y=x^2与x轴之间的面积，第二问改为[0,2]的同一区域面积。"
    understanding = o.build_understanding(text, use_ai=False)
    assert [q["id"] for q in understanding["asked"]] == ["Q1", "Q2"]
    assert understanding["mapping"]["Q1"]["interval"] != understanding["mapping"]["Q2"]["interval"]
    result = o.solve_composite(text, use_ai=False)
    assert result["status"] == "完成", result["plan_check"]["errors"]
    assert sorted(a["value"] for a in result["answers"]) == pytest.approx([1 / 3, 8 / 3])


def test_each_subquestion_updates_its_own_second_boundary():
    text = "在0≤x≤1内，求曲线y=x^2与直线y=1之间的面积，第二问边界改为y=2，求同一区域面积。"
    understanding = o.build_understanding(text, use_ai=False)
    assert [q["id"] for q in understanding["asked"]] == ["Q1", "Q2"]
    assert understanding["mapping"]["Q1"]["second"] != understanding["mapping"]["Q2"]["second"]
    result = o.solve_composite(text, use_ai=False)
    assert result["status"] == "完成", result["plan_check"]["errors"]
    assert sorted(a["answer"] for a in result["answers"]) == ["2/3", "5/3"]


def test_two_curve_area_volume_keeps_second_boundary_and_rejects():
    text = "在0≤x≤1内，求曲线y=x^2与y=1之间的面积，以及该区域绕x轴旋转所得旋转体的体积。"
    understanding = o.build_understanding(text, use_ai=False)
    assert any("两条非零曲线" in note for note in understanding["ambiguities"])
    result = o.solve_composite(text, use_ai=False)
    assert result["status"] == "needs_review"
    assert result["answers"] == []
    assert all(step.get("capability") != "rotation_volume" for step in (result["plan"] or {}).get("steps", []))


def test_multiple_rotation_axes_are_not_collapsed_to_the_first_axis():
    text = "曲线y=x与x轴围成的区域，分别绕x轴、y轴旋转，x∈[0,1]，求旋转体体积。"
    understanding = o.build_understanding(text, use_ai=False)
    assert len(understanding["asked"]) == 2
    assert any("x 轴" in q["goal"] for q in understanding["asked"])
    assert any("y 轴" in q["goal"] for q in understanding["asked"])
    assert any("仅支持绕 x 轴" in note for note in understanding["ambiguities"])
    result = o.solve_composite(text, use_ai=False)
    assert result["status"] == "needs_review"
    assert result["answers"] == []


def test_inverse_derivative_is_not_original_derivative():
    text = "求函数f(x)=x^3的反函数在x=2处的导数。"
    result = o.solve_composite(text, use_ai=False)
    assert result["status"] == "完成", result["plan_check"]["errors"]
    assert result["plan"]["steps"][0]["capability"] == "inverse_derivative"
    answer = result["answers"][0]
    assert float(answer["answer"]) == pytest.approx(1 / (3 * 2 ** (2 / 3)), rel=1e-6)
    assert float(answer["answer"]) != pytest.approx(12.0)


def test_ai_cannot_use_original_derivative_capability_for_inverse_goal():
    text = "求函数f(x)=x^3的反函数在x=2处的导数。"
    understanding = o.build_understanding(text, use_ai=False)
    plan = {"steps": [
        {"id": "S1", "goal": "计算反函数导数", "capability": "derivative", "subquestion": "Q1",
         "inputs": {"expression": {"source": "problem", "ref": "G1", "value": "x^3"},
                    "variable": {"source": "problem", "ref": "G2", "value": "x"},
                    "point": {"source": "problem", "ref": "G3", "value": 2}},
         "feeds": ["S2"]},
        {"id": "S2", "goal": "汇总", "capability": "assemble_report",
         "inputs": {"steps": {"source": "plan", "value": ["S1"]}}},
    ]}
    check = o.validate_plan(plan, understanding)
    assert not check["ok"]
    assert any("inverse_derivative" in note or "反函数导数" in note for note in check["errors"])


def test_ai_added_question_gets_condition_mapping(monkeypatch):
    text = "已知 f(x)=sin(x)，求 f 在 x=0 处的导数。"
    from app.labs import staged_understanding

    monkeypatch.setattr(staged_understanding, "request_json", lambda *args, **kwargs: {
        "given": [
            {"id": "A0", "item": "f(x)=sin(x)", "ref": "expression", "value": "sin(x)"},
            {"id": "A1", "item": "在 x=0 处", "ref": "point", "value": 0},
        ],
        "asked": [{"id": "AQ1", "goal": "求 f 在 x=0 处的导数"}],
        "ambiguities": [],
    })
    understanding = o.build_understanding(text, use_ai=True)
    qid = understanding["id_aliases"]["AQ1"]
    mapping = understanding["mapping"][qid]
    assert mapping["task"] == "derivative"
    assert mapping["fields"] == {"expression": "A0", "point": "A1"}
    plan = {"steps": [
        {"id": "S1", "goal": "求导", "capability": "derivative", "subquestion": "AQ1",
         "inputs": {"expression": {"source": "problem", "ref": "A0", "value": "sin(x)"},
                    "variable": {"source": "plan", "value": "x"},
                    "point": {"source": "problem", "ref": "A1", "value": 0}},
         "feeds": ["S2"]},
        {"id": "S2", "goal": "汇总", "capability": "assemble_report",
         "inputs": {"steps": {"source": "plan", "value": ["S1"]}}},
    ]}
    check = o.validate_plan(plan, understanding)
    assert check["ok"], check["errors"]
    execution = o.execute_plan(text, plan, understanding)
    assert execution["results"]["S1"]["state"] == o.STATE_DONE
    assert execution["results"]["S1"]["outputs"]["answer"] == "1"


def test_ai_understanding_cannot_delete_same_kind_rule_question(monkeypatch):
    text = "在0≤x≤1内，求曲线y=x^2与x轴之间的面积，再求曲线y=x与x轴之间的面积。"
    monkeypatch.setattr(o, "_ai_available", lambda: True)

    def fake_request_json(messages, schema, deadline):
        if schema is o.UNDERSTANDING_SCHEMA:
            return {"given": [], "asked": [{"id": "Q1", "goal": "求曲线y=x^2与x轴之间的面积"}],
                    "ambiguities": []}
        raise RuntimeError("no plan")

    monkeypatch.setattr("app.labs.staged_understanding.request_json", fake_request_json)
    understanding = o.build_understanding(text, use_ai=True)
    assert [q["id"] for q in understanding["asked"]] == ["Q1", "Q2"]
    assert any("Q2" in note and "保留" in note for note in understanding["ai_warnings"])
    result = o.solve_composite(text, use_ai=False)
    assert result["status"] == "完成"
    assert sorted(a["value"] for a in result["answers"]) == pytest.approx([1 / 3, 1 / 2])


def test_ai_plan_alias_is_mapped_back_to_stable_rule_question(monkeypatch):
    text = "在0≤x≤1内，求曲线y=x与x轴之间的面积。"
    understanding = o.build_understanding(text, use_ai=False)
    base_plan = o.deterministic_plan(text, understanding)
    assert base_plan is not None
    ai_plan = {"steps": [{**step, "subquestion": "Q9" if step.get("subquestion") else step.get("subquestion")}
                         for step in base_plan["steps"]]}
    monkeypatch.setattr(o, "_ai_available", lambda: True)

    def fake_request_json(messages, schema, deadline):
        if schema is o.UNDERSTANDING_SCHEMA:
            return {"given": [], "asked": [{"id": "Q9", "goal": "求面积"}], "ambiguities": []}
        return ai_plan

    monkeypatch.setattr("app.labs.staged_understanding.request_json", fake_request_json)
    result = o.solve_composite(text)
    assert result["planner"]["mode"] == "ai"
    assert result["plan_check"]["ok"], result["plan_check"]["errors"]
    assert result["answers"][0]["subquestion"] == "Q1"
    assert result["plan"]["steps"][2]["subquestion"] == "Q1"
    assert result["status"] == "完成"


def test_plan_cannot_replace_original_area_region_with_rectangle():
    text = "在0≤x≤1内，求曲线y=x^2与直线y=1之间的面积。"
    understanding = o.build_understanding(text, use_ai=False)
    plan = {"steps": [
        {"id": "S1", "goal": "矩形面积", "capability": "double_integral", "subquestion": "Q1",
         "inputs": {"integrand": {"source": "plan", "value": "1"},
                    "outer_variable": {"source": "plan", "value": "x"},
                    "outer_bounds": {"source": "problem", "ref": "G2", "value": ["0", "1"]},
                    "inner_bounds": {"source": "plan", "value": ["0", "2"]}}},
        {"id": "S2", "goal": "汇总", "capability": "assemble_report",
         "inputs": {"steps": {"source": "plan", "value": ["S1"]}}},
    ]}
    checked = o.validate_plan(plan, understanding)
    assert not checked["ok"]
    assert any("inner_bounds" in error and "原题区域" in error for error in checked["errors"])


def test_plan_cannot_replace_outer_bounds_or_integrand():
    text = "在0≤x≤1内，求曲线y=x^2与直线y=1之间的面积。"
    understanding = o.build_understanding(text, use_ai=False)
    base = {"id": "S1", "goal": "面积", "capability": "double_integral", "subquestion": "Q1",
            "inputs": {"integrand": {"source": "plan", "value": "1"},
                       "outer_variable": {"source": "plan", "value": "x"},
                       "outer_bounds": {"source": "problem", "ref": "G2", "value": ["0", "1"]},
                       "inner_bounds": {"source": "plan", "value": ["x^2", "1"]}}}
    tail = {"id": "S2", "goal": "汇总", "capability": "assemble_report",
            "inputs": {"steps": {"source": "plan", "value": ["S1"]}}}
    bad_outer = {**base, "inputs": {**base["inputs"],
                                    "outer_bounds": {"source": "plan", "value": ["0", "1"]}}}
    checked = o.validate_plan({"steps": [bad_outer, tail]}, understanding)
    assert not checked["ok"]
    assert any("outer_bounds" in error and "原题区间" in error for error in checked["errors"])
    bad_integrand = {**base, "inputs": {**base["inputs"],
                                       "integrand": {"source": "plan", "value": "x"}}}
    checked = o.validate_plan({"steps": [bad_integrand, tail]}, understanding)
    assert not checked["ok"]
    assert any("integrand" in error and "被积函数" in error for error in checked["errors"])


def test_derivative_question_cannot_be_covered_by_determinant():
    text = "求函数y=x^2在x=1处的导数。"
    understanding = o.build_understanding(text, use_ai=False)
    plan = {"steps": [
        {"id": "S1", "goal": "求行列式", "capability": "determinant", "subquestion": "Q_extra_导数",
         "inputs": {"matrix_a": {"source": "plan", "value": [[7]]}}},
        {"id": "S2", "goal": "汇总", "capability": "assemble_report",
         "inputs": {"steps": {"source": "plan", "value": ["S1"]}}},
    ]}
    checked = o.validate_plan(plan, understanding)
    assert not checked["ok"]
    assert any("求解义务" in error and "导数" in error for error in checked["errors"])


def test_successful_replan_returns_actual_plan_and_input_provenance():
    text = "在0≤x≤1内，求曲线y=x与x轴之间的面积。"
    understanding = o.build_understanding(text, use_ai=False)
    plan = {"steps": [
        {"id": "S1", "goal": "面积", "capability": "geometric_area", "subquestion": "Q1",
         "inputs": {"expression": {"source": "plan", "value": "x^^2"},
                    "lower": {"source": "plan", "value": 0},
                    "upper": {"source": "plan", "value": 1},
                    "region_kind": {"source": "plan", "value": "between_axis"}}},
        {"id": "S2", "goal": "汇总", "capability": "assemble_report",
         "inputs": {"steps": {"source": "plan", "value": ["S1"]}}},
    ]}

    def replan(step, error):
        return {"id": "S1", "goal": "用二重积分求面积", "capability": "double_integral",
                "inputs": {"integrand": {"source": "plan", "value": "1"},
                           "outer_variable": {"source": "plan", "value": "x"},
                           "outer_bounds": {"source": "problem", "ref": "G2", "value": ["0", "1"]},
                           "inner_bounds": {"source": "plan", "value": ["0", "x"]}}}

    execution = o.execute_plan(text, plan, understanding, replan=replan)
    assert execution["results"]["S1"]["state"] == o.STATE_DONE
    assert [s["capability"] for s in execution["plan"]["steps"]][:2] == ["double_integral", "assemble_report"]
    adjustment = execution["solve"]["adjustments"][0]
    assert adjustment["from"] == "geometric_area" and adjustment["to"] == "double_integral"
    assert adjustment["from_inputs"]["expression"]["value"] == "x^^2"
    assert adjustment["to_inputs"]["inner_bounds"]["value"] == ["0", "x"]
    assert any(row["source"] == "原题" for row in execution["solve"]["provenance"])


def test_execute_plan_respects_absolute_deadline():
    text = "在0≤x≤1内，求曲线y=x与x轴之间的面积。"
    understanding = o.build_understanding(text, use_ai=False)
    plan = o.deterministic_plan(text, understanding)
    assert plan is not None
    execution = o.execute_plan(text, plan, understanding, deadline=time.monotonic() - 1)
    assert any(step["state"] == o.STATE_TIMEOUT for step in execution["solve"]["steps"])


def test_boundary_order_runs_with_remaining_budget(monkeypatch):
    calls: list[float] = []

    def fake_run_internal(capability, resolved, timeout):
        calls.append(timeout)
        return o.STATE_TIMEOUT, {"error": "timeout"}

    monkeypatch.setattr("app.labs.orchestrator_worker.run_internal", fake_run_internal)
    deadline = time.monotonic() + 0.5
    upper, reason = o._bounded_upper_boundary("x^2", "2", 0, 1, deadline)
    assert upper is None
    assert "时间预算" in reason
    assert calls and calls[0] <= 0.5


def test_invalid_ai_plan_is_reported_in_diagnostics(monkeypatch):
    text = "在0≤x≤1内，求曲线y=x与x轴之间的面积。"
    monkeypatch.setattr(o, "_ai_available", lambda: True)

    def fake_request_json(messages, schema, deadline):
        if schema is o.UNDERSTANDING_SCHEMA:
            return {"given": [], "asked": [], "ambiguities": []}
        return {"steps": [{"id": "S1", "goal": "求面积", "capability": "determinant",
                           "inputs": {"matrix_a": {"source": "plan", "value": [[7]]}}}]}

    monkeypatch.setattr("app.labs.staged_understanding.request_json", fake_request_json)
    result = o.solve_composite(text)
    assert result["status"] == "完成"
    assert result["planner"]["mode"] == "deterministic"
    assert "AI 计划未通过校验" in str(result["planner"]["error"])

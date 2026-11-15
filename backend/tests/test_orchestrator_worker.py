import subprocess

import pytest

from app.labs.orchestrator_worker import run_step


def test_worker_preserves_compiled_model_and_solution():
    state, outputs = run_step("compute", "geometric_area", {
        "expression": "x^2", "region_kind": "between_axis", "lower": 0, "upper": 1,
    }, 15)
    assert state == "完成且满足要求"
    assert outputs["quantities"]["area"]["value"] == pytest.approx(1 / 3)
    assert outputs["problem"]["solution"] == outputs["solution"]
    assert outputs["inputs"]["upper"] == 1


def test_worker_check_rejection_is_not_success():
    state, outputs = run_step("check", "domain_check", {
        "expression": "1/(x-1)", "variable": "x", "lower": 0, "upper": 2,
    }, 15)
    assert outputs["ok"] is False
    assert state == "条件不成立"


def test_worker_timeout_stops_child(monkeypatch):
    def timeout(*args, **kwargs):
        assert kwargs["timeout"] == .01
        raise subprocess.TimeoutExpired(args[0], .01)
    monkeypatch.setattr(subprocess, "run", timeout)
    state, outputs = run_step("check", "zeros_on_interval", {}, .01)
    assert state == "超时未完成"


def test_unknown_capability_rejected_before_spawn():
    with pytest.raises(ValueError, match="目录"):
        run_step("compute", "invented", {}, 10)


def test_expired_budget_does_not_start_child(monkeypatch):
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: pytest.fail("must not spawn"))
    assert run_step("compute", "integral", {}, 0)[0] == "超时未完成"

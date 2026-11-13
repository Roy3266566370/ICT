"""对抗演示：四类注入均被拦截，干净输入不误拦。"""

from app.adversarial import run_demo


def test_four_faults_are_intercepted_and_clean_input_is_not() -> None:
    demo = run_demo()
    assert demo["summary"]["injected"] == 4
    assert demo["summary"]["intercepted"] == 4
    assert demo["summary"]["clean_false_positive"] == 0
    assert demo["clean"]["trust"]["level"] == "green"
    defenses = {
        log["defense"]
        for scenario in demo["scenarios"]
        for log in scenario["logs"]
    }
    assert defenses == {"source_anchor", "schema", "independent", "declaration"}


def test_forged_excerpt_and_declaration_are_visible_in_logs() -> None:
    demo = run_demo()
    scenarios = {item["scenario"]: item for item in demo["scenarios"]}
    forged = scenarios["forged_excerpt"]
    assert forged["intercepted"] is True
    assert any(log["defense"] == "source_anchor" for log in forged["logs"])
    declaration = scenarios["declaration"]
    assert declaration["intercepted"] is True
    assert any(log["defense"] == "declaration" for log in declaration["logs"])
    assert declaration["trust"]["level"] == "red"

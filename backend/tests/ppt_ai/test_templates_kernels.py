"""十个新模板的确定性内核：标准值与边界值。"""

from __future__ import annotations

import math

import pytest

from app.ppt_ai.templates_kernels import evaluate_template


def test_taylor_sin() -> None:
    result = evaluate_template(
        "taylor",
        {"expression": "sin(x)"},
        {"expression": "sin(x)", "x0": 0, "order": 5, "x_eval": 0.5},
    )
    assert result["value"] == pytest.approx(math.sin(0.5), abs=1e-9)
    assert result["approx"] == pytest.approx(0.4794270833, abs=2e-6)
    assert result["error"] == pytest.approx(1.6e-6, abs=2e-6)
    assert len(result["series"]) == 241
    assert len(result["overlay_series"]) == 241


def test_double_integral_polynomial() -> None:
    result = evaluate_template(
        "double_integral",
        {"expression": "x^2 + y"},
        {"expression": "x^2 + y", "ax": 0, "bx": 2, "ay": 0, "by": 1, "nx": 40, "ny": 40},
    )
    assert result["numeric"] == pytest.approx(11 / 3, abs=2e-3)
    assert result["analytic"] == pytest.approx(11 / 3, abs=1e-9)
    assert result["error"] < 2e-3


def test_newton_finds_minimum_and_stops_on_concavity() -> None:
    result = evaluate_template(
        "newton_1d",
        {"expression": "x^2 - 4*x + 1"},
        {"expression": "x^2 - 4*x + 1", "x0": 3, "max_iter": 8},
    )
    assert result["x_final"] == pytest.approx(2.0, abs=1e-6)
    assert result["f_final"] == pytest.approx(-3.0, abs=1e-6)
    assert result["classification"] == "local_minimum"

    concave = evaluate_template(
        "newton_1d",
        {"expression": "-x^2 + 4*x"},
        {"expression": "-x^2 + 4*x", "x0": 3, "max_iter": 8},
    )
    assert concave["status"] == "non_positive_curvature"
    assert concave["classification"] == "local_maximum"


def test_least_squares_line_and_rank_deficiency() -> None:
    result = evaluate_template(
        "least_squares",
        {},
        {"xs": [1, 2, 3, 4], "ys": [2, 3, 5, 4]},
    )
    assert result["slope"] == pytest.approx(0.8, abs=1e-9)
    assert result["intercept"] == pytest.approx(1.5, abs=1e-9)
    assert result["r_squared"] == pytest.approx(0.64, abs=1e-9)
    assert len(result["table"]["rows"]) == 4

    degenerate = evaluate_template("least_squares", {}, {"xs": [1, 1, 1], "ys": [1, 2, 3]})
    assert "秩不足" in degenerate["error"]


def test_stack_queue_and_sorting() -> None:
    stack = evaluate_template(
        "stack_queue",
        {},
        {"mode": "stack", "initial": [3, 1, 4], "operations": "push 2; pop; push 5; pop", "capacity": 8},
    )
    assert stack["final_state"] == [3.0, 1.0, 4.0]
    assert stack["errors"] == []
    assert len(stack["table"]["rows"]) == 4

    queue = evaluate_template(
        "stack_queue",
        {},
        {"mode": "queue", "initial": [2, 5, 7], "operations": "enqueue 9; dequeue; enqueue 1", "capacity": 8},
    )
    assert queue["final_state"] == [5.0, 7.0, 9.0, 1.0]

    sorting = evaluate_template(
        "sorting",
        {},
        {"values": [5, 1, 4, 2, 8], "algorithm": "bubble"},
    )
    assert sorting["sorted"] == [1.0, 2.0, 4.0, 5.0, 8.0]
    assert sorting["comparisons"] == 9


def test_activation_convolution_and_pooling() -> None:
    sigmoid = evaluate_template(
        "activation",
        {},
        {"activation": "sigmoid", "x": 0.0, "upstream": 2.0},
    )
    assert sigmoid["value"] == pytest.approx(0.5, abs=1e-12)
    assert sigmoid["gradient"] == pytest.approx(0.5, abs=1e-12)

    relu_zero = evaluate_template(
        "activation",
        {},
        {"activation": "relu", "x": 0.0, "upstream": 3.0},
    )
    assert relu_zero["gradient"] == 0
    assert any(item["id"] == "relu_zero_convention" for item in relu_zero["checks"])

    conv = evaluate_template(
        "conv_pool",
        {"window": None},
        {
            "matrix": [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
            "kernel": [[1, 0, -1], [1, 0, -1], [1, 0, -1]],
            "mode": "conv",
            "stride": 1,
            "padding": 0,
        },
    )
    assert conv["output"] == [[-6.0]]

    pool = evaluate_template(
        "conv_pool",
        {"window": [2, 2]},
        {
            "matrix": [[1, 3, 2, 4], [5, 6, 7, 8], [9, 2, 1, 0], [3, 4, 5, 6]],
            "mode": "maxpool",
            "stride": 2,
            "padding": 0,
        },
    )
    assert pool["output"] == [[6.0, 8.0], [9.0, 6.0]]


def test_projectile_and_spring() -> None:
    projectile = evaluate_template(
        "projectile",
        {},
        {"v0": 10.0, "angle_deg": 30, "y0": 0, "g": 9.8, "t": 1},
    )
    assert projectile["position"][0] == pytest.approx(8.660254, abs=1e-5)
    assert projectile["position"][1] == pytest.approx(0.1, abs=1e-9)
    assert projectile["range"] == pytest.approx(8.83699, abs=1e-4)

    spring = evaluate_template(
        "spring",
        {},
        {"m": 2, "k": 8, "x0": 0.1, "v0": 0, "t": 2},
    )
    assert spring["x"] == pytest.approx(0.1 * math.cos(4), abs=1e-9)
    assert spring["energy"] == pytest.approx(0.04, abs=1e-9)

    invalid = evaluate_template(
        "spring",
        {},
        {"m": 1, "k": -4, "x0": 0.1, "v0": 0, "t": 1},
    )
    assert "为正" in invalid["error"]


def test_registry_declared_outputs_are_reachable_in_kernel_results() -> None:
    """A4：注册表声明的派生输出键必须能被 declared_output_value 取到。

    死键（如 newton_1d 历史声明的 loss，内核只返回 f_final）会让链接后的
    每个快照都报“上游输出没有可用值”，前后端取数口径必须一致。
    """

    from app.ppt_ai.evaluation import declared_output_value
    from app.ppt_ai.registry import REGISTRY
    from app.ppt_ai.types import OutputSpec

    def spec(key: str) -> OutputSpec:
        return OutputSpec(key=key, concept_id=f"decl:{key}", name=key, type="number", unit="")

    taylor = evaluate_template(
        "taylor",
        {"expression": "sin(x)"},
        {"expression": "sin(x)", "x0": 0, "order": 5, "x_eval": 0.5},
    )
    assert declared_output_value(taylor, spec("approx")) == pytest.approx(
        0.4794270833, abs=2e-6
    )
    assert declared_output_value(taylor, spec("error")) is not None

    newton = evaluate_template(
        "newton_1d",
        {"expression": "x^2 - 4*x + 1"},
        {"expression": "x^2 - 4*x + 1", "x0": 3, "max_iter": 8},
    )
    # 注册表已把 loss 改成 f_final：声明键必须与内核结果键一致。
    newton_spec = next(
        operator
        for operator in REGISTRY.list()
        if operator["operator_id"] == "optimization.newton_1d"
    )
    declared_keys = {item["key"] for item in newton_spec["derived_outputs"]}
    assert declared_keys == {"f_final", "curvature"}
    assert declared_output_value(newton, spec("f_final")) == pytest.approx(-3, abs=1e-9)
    assert declared_output_value(newton, spec("curvature")) == pytest.approx(2, abs=1e-9)


def test_gradient_lab_exposes_declared_loss_and_grad_norm() -> None:
    """A4：optimization.gradient 声明的 loss/grad_norm 在结果顶层可达。"""

    from app.labs.solvers import evaluate_problem
    from app.ppt_ai.evaluation import declared_output_value
    from app.ppt_ai.types import OutputSpec

    model = {
        "subject": "optimization",
        "expression": "x^2 + y^2",
        "variables": ["x", "y"],
        "defaults": {"x0": 2.0, "y0": 3.0, "learning_rate": 0.1, "iterations": 5},
    }
    result = evaluate_problem(
        model, {"x0": 2.0, "y0": 3.0, "learning_rate": 0.1, "iterations": 5}
    )
    loss = declared_output_value(
        result,
        OutputSpec(key="loss", concept_id="decl:loss", name="loss", type="number", unit=""),
    )
    grad_norm = declared_output_value(
        result,
        OutputSpec(
            key="grad_norm", concept_id="decl:grad_norm", name="grad_norm", type="number", unit=""
        ),
    )
    assert loss is not None and math.isfinite(float(loss))
    assert grad_norm is not None and math.isfinite(float(grad_norm))

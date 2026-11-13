"""T06：特征方向、零向量与零特征值的几何事实（G01—G04、G15）。"""

from __future__ import annotations

import pytest

from app.ppt_ai.evaluation import evaluate_node
from tests.ppt_ai import helpers


def _node_and_values(text: str):
    _extraction, _plan, bundle = helpers.bundle_for(helpers.matrix_snapshot("mat_geo", text))
    node = helpers.node_of(bundle, "matrix")
    values = {parameter.concept_id: parameter.default for parameter in node.parameters}
    return node, values


def _set_vector(node, values, vector):
    for index, value in enumerate(vector):
        parameter = next(parameter for parameter in node.parameters if parameter.id == f"v{index + 1}")
        values[parameter.concept_id] = value
    return values


def test_eigen_direction_golden_cases() -> None:
    node, values = _node_and_values("A = [[2,1],[1,2]]，v = (1,1)")
    cases = [
        ((1, 1), True, pytest.approx(3.0)),
        ((1, -1), True, pytest.approx(1.0)),
        ((1, 0), False, None),
    ]
    for vector, collinear, ratio in cases:
        result = evaluate_node(node, _set_vector(node, dict(values), vector))["result"]
        geometry = result["geometry"]
        assert geometry["collinear"] is collinear
        if ratio is None:
            assert geometry["ratio"] is None
        else:
            assert geometry["ratio"] == ratio
        assert geometry["product"] == pytest.approx(
            [2 * vector[0] + vector[1], vector[0] + 2 * vector[1]]
        )


def test_zero_vector_and_zero_eigenvalue_are_distinct() -> None:
    node, values = _node_and_values("A = [[2,1],[1,2]]，v = (0,0)")
    zero = evaluate_node(node, _set_vector(node, dict(values), (0, 0)))["result"]["geometry"]
    assert zero["zero_vector"] is True
    assert zero["is_eigenvector"] is False
    assert "零向量" in zero["message"]

    node2, values2 = _node_and_values("A = [[1,0],[0,0]]，v = (0,1)")
    zero_eigen = evaluate_node(node2, _set_vector(node2, dict(values2), (0, 1)))["result"]["geometry"]
    assert zero_eigen["av_zero"] is True
    assert zero_eigen["zero_vector"] is False
    assert zero_eigen["is_eigenvector"] is True
    assert zero_eigen["eigenvalue"] == pytest.approx(0.0)
    assert "特征值为 0" in zero_eigen["message"]

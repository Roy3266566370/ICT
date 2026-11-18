"""手写圈选识别：栅格化、LaTeX 子集转换与拒绝路径。"""
from __future__ import annotations

from app.labs import ink


def test_ink_rasterizes_and_returns_latex_and_expression(monkeypatch):
    seen: dict[str, object] = {}

    def fake_ocr(image, *, loose=False):
        seen["size"] = image.size
        seen["loose"] = loose
        return "x^{2}+1"

    monkeypatch.setattr(ink, "_math_ocr", fake_ocr)
    points = [[index * 10, 20 + (index % 3) * 8] for index in range(12)]
    result = ink.ink_to_formula([{"points": points, "width": 2.5}])

    assert result["supported"] is True
    assert result["latex"] == "x^{2}+1"
    assert result["node_type"] == "functionSource"
    assert result["expression"] and "x^2" in result["expression"]
    assert seen["loose"] is True
    assert seen["size"] != (0, 0)


def test_ink_rejects_unavailable_ocr_bad_coordinates_and_sparse_strokes(monkeypatch):
    monkeypatch.setattr(ink, "_math_ocr", lambda image, *, loose=False: None)
    dense = [{"points": [[index * 6, (index % 4) * 5] for index in range(12)], "width": 2}]
    no_ocr = ink.ink_to_formula(dense)
    assert no_ocr["supported"] is False
    assert "识别" in no_ocr["reason"]

    bad = ink.ink_to_formula([{"points": [[float("nan"), 0]], "width": 2}])
    assert bad["supported"] is False

    sparse = ink.ink_to_formula([{"points": [[0, 0], [20, 20]], "width": 2}])
    assert sparse["supported"] is False
    assert "稀疏" in sparse["reason"]


def test_symbol_only_ocr_hallucination_is_rejected(monkeypatch):
    dense = [{"points": [[index * 6, (index % 4) * 5] for index in range(12)], "width": 2}]
    for hallucination in (r"\mathbf{\nabla}\times\mathbf{\nabla}", r"{\mathcal{N}}\subset{\mathcal{N}}"):
        monkeypatch.setattr(ink, "_math_ocr", lambda image, *, loose=False, value=hallucination: value)
        result = ink.ink_to_formula(dense)
        assert result["supported"] is False


def test_matrix_and_latex_fallback_nodes(monkeypatch):
    dense = [{"points": [[index * 6, (index % 4) * 5] for index in range(12)], "width": 2}]
    monkeypatch.setattr(ink, "_math_ocr", lambda image, *, loose=False: r"\begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}")
    matrix = ink.ink_to_formula(dense)
    assert matrix["supported"] is True
    assert matrix["node_type"] == "matrixSource"
    assert matrix["matrix"] == {"a": 1.0, "b": 2.0, "c": 3.0, "d": 4.0}

    assert ink.latex_to_node(r"\int_0^1 x \, dx")["node_type"] == "latexNote"
    assert ink.latex_to_node(r"\lim_{x\to 0} \frac{\sin x}{x}")["node_type"] == "latexNote"
    assert ink.latex_to_node("x^{2}+1")["node_type"] == "functionSource"


def test_latex_subset_converts_to_frontend_expression():
    assert ink.latex_to_expression("x^{2}+1") and "x^2" in ink.latex_to_expression("x^{2}+1")
    assert ink.latex_to_expression(r"\frac{1}{x+1}")
    assert ink.latex_to_expression(r"\sqrt{x^2+1}")
    assert ink.latex_to_expression(r"\sin x") == "sin(x)"
    assert ink.latex_to_expression(r"\pi x") and "pi" in ink.latex_to_expression(r"\pi x")


def test_y_prefix_parameters_and_inverse_trig_are_supported():
    squared = ink.latex_to_expression(r"y = x^{2}+1")
    assert squared and "x^2" in squared
    assert ink.latex_to_expression(r"f(x) = \sin x") == "sin(x)"
    assert ink.latex_to_expression(r"f\left(x\right)=\arctan x") == "atan(x)"
    assert ink.latex_to_expression(r"y = \arctan x") == "atan(x)"
    parametrized = ink.latex_to_expression(r"a x^{2}+b")
    assert parametrized and "a" in parametrized and "b" in parametrized
    assert ink.latex_to_expression(r"y = x + y") is None


def test_integrals_subscripts_and_multi_variable_are_not_guessed():
    assert ink.latex_to_expression(r"\int_0^1 x \, dx") is None
    assert ink.latex_to_expression("x_{1}") is None
    assert ink.latex_to_expression("y^{2}+x") is None
    assert ink.latex_to_expression("") is None
"""线性代数识别与确定性消元轨迹：Ax=b、行列式、逆矩阵、矩阵运算。"""
import pytest

from app.labs import linalg
from app.labs.recognize import build_problem


def build(text, **overrides):
    return linalg.build_linalg(text, {"file_id": "f1", "page": 1}, overrides)


def test_linear_system_from_chinese_equations():
    built = build("解方程组：2x+y-z=8，-3x-y+2z=-11，-2x+y+2z=-3")
    assert built["recognized"]
    model = built["model"]
    assert model["la_kind"] == "linear_system"
    assert model["variables"] == ["x", "y", "z"]
    result = linalg.evaluate_linalg(model, {})
    assert result["status"] == "ok"
    assert result["solution"] == pytest.approx([2, 3, -1])
    residual = [c for c in result["checks"] if c["id"] == "residual"][0]
    assert residual["status"] == "pass"
    back_subs = [f for f in result["trace"] if f["action"] == "back_sub"]
    assert len(back_subs) == 3
    assert linalg.solve_linalg(model)["answer"] == "x = 2，y = 3，z = -1"


def test_linear_system_from_matrix_literal_and_vector():
    built = build("求解线性方程组 Ax=b，其中 A=[[2,1],[1,-1]]，b=[5,1]")
    assert built["recognized"]
    result = linalg.evaluate_linalg(built["model"], {})
    assert result["solution"] == pytest.approx([2, 1])


def test_augmented_matrix_literal_splits_last_column():
    built = build("用高斯消元解方程组，增广矩阵为 [[2,1,5],[1,-1,1]]")
    assert built["recognized"]
    model = built["model"]
    assert model["matrix_a"] == [[2.0, 1.0], [1.0, -1.0]]
    assert model["vector_b"] == [5.0, 1.0]
    assert linalg.evaluate_linalg(model, {})["solution"] == pytest.approx([2, 1])


def test_determinant_with_swap_sign():
    built = build("计算行列式 |A|，A=[[0,1],[2,3]]")
    assert built["recognized"]
    model = built["model"]
    assert model["la_kind"] == "determinant"
    result = linalg.evaluate_linalg(model, {})
    assert result["status"] == "ok"
    assert result["det"] == pytest.approx(-2)
    swaps = [f for f in result["trace"] if f["action"] == "swap"]
    assert swaps, "0 主元应触发一次换行"
    assert linalg.solve_linalg(model)["answer_value"] == pytest.approx(-2)


def test_inverse_gauss_and_jordan_agree():
    built = build("求矩阵 A 的逆，A=[[1,2],[3,4]]")
    model = built["model"]
    assert model["la_kind"] == "inverse"
    gauss = linalg.evaluate_linalg(model, {"method": "gauss"})
    jordan = linalg.evaluate_linalg(model, {"method": "jordan"})
    expected = [-2.0, 1.0, 1.5, -0.5]
    for res in (gauss, jordan):
        assert res["status"] == "ok"
        assert [v for row in res["inverse"] for v in row] == pytest.approx(expected)
        check = [c for c in res["checks"] if c["id"] == "inverse"][0]
        assert check["status"] == "pass"


def test_singular_matrix_keeps_trace_instead_of_fabricating():
    built = build("求逆矩阵 A=[[1,2],[2,4]]")
    result = linalg.evaluate_linalg(built["model"], {})
    assert result["status"] == "ok"
    assert result["stop_reason"] == "singular"
    assert any(f["action"] == "singular" for f in result["trace"])
    with pytest.raises(ValueError):
        linalg.solve_linalg(built["model"])


def test_pivoting_strategy_changes_trace():
    # 必要换行两种策略都会做；差别在主动把绝对值最大的主元换上来。
    built = build("解方程组 Ax=b，A=[[0.001,1],[1,1]]，b=[1,2]")
    partial = linalg.evaluate_linalg(built["model"], {"pivoting": "partial"})
    assert any(f["action"] == "swap" for f in partial["trace"])
    none = linalg.evaluate_linalg(built["model"], {"pivoting": "none"})
    assert not any(f["action"] == "swap" for f in none["trace"])
    assert partial["solution"] == pytest.approx(none["solution"], abs=1e-6)


def test_no_pivoting_still_swaps_when_pivot_is_zero():
    built = build("解方程组 Ax=b，A=[[0,1],[1,1]]，b=[1,2]")
    result = linalg.evaluate_linalg(built["model"], {"pivoting": "none"})
    assert result["status"] == "ok"
    assert result["solution"] == pytest.approx([1, 1])
    assert any(f["action"] == "swap" for f in result["trace"])


def test_matmul_trace_and_ba_order():
    built = build("计算矩阵乘积 A·B，A=[[1,2],[3,4]]，B=[[5,6],[7,8]]")
    assert built["recognized"]
    model = built["model"]
    assert model["op"] == "mul"
    result = linalg.evaluate_linalg(model, {})
    assert result["result_matrix"] == [[19.0, 22.0], [43.0, 50.0]]
    cells = [f for f in result["trace"] if f["action"] == "element"]
    assert len(cells) == 4
    assert cells[0]["values"]["terms"] == [5.0, 14.0]
    ba = linalg.evaluate_linalg(model, {"order": "ba"})
    assert ba["result_matrix"] == [[23.0, 34.0], [31.0, 46.0]]


def test_matrix_add_sub_scalar():
    for op_text, expected, op in (
        ("计算 A+B，A=[[1,2],[3,4]]，B=[[5,6],[7,8]]", [[6, 8], [10, 12]], "add"),
        ("计算 A-B，A=[[1,2],[3,4]]，B=[[5,6],[7,8]]", [[-4, -4], [-4, -4]], "sub"),
    ):
        built = build(op_text)
        assert built["recognized"]
        assert built["model"]["op"] == op
        flat = [v for row in linalg.evaluate_linalg(built["model"], {})["result_matrix"] for v in row]
        assert flat == pytest.approx([v for row in expected for v in row])
    built = build("矩阵 A=[[1,2],[3,4]]，求数乘 3A")
    assert built["model"]["op"] == "scalar"
    assert built["model"]["defaults"]["scalar"] == 3.0
    assert linalg.evaluate_linalg(built["model"], {})["result_matrix"] == [[3, 6], [9, 12]]
    scaled = linalg.evaluate_linalg(built["model"], {"scalar": -1})
    assert scaled["result_matrix"] == [[-1, -2], [-3, -4]]


def test_missing_data_blocks_without_fabricating():
    built = build("求矩阵的逆")
    assert not built["recognized"]
    assert any(a["severity"] == "blocking" for a in built["ambiguities"])
    result = linalg.evaluate_linalg(built["model"], {})
    assert result["status"] == "blocked"


def test_subject_classification_and_document_pipeline():
    problem = build_problem("解方程组：x+y=3，x-y=1")
    assert problem["subject"] == "linear_algebra"
    assert problem["model"]["la_kind"] == "linear_system"
    from app.labs.solvers import solve_problem
    assert solve_problem(problem["model"])["answer"] == "x = 2，y = 1"
    assert problem["status"] == "ready"

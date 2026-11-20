"""线性代数识别与确定性轨迹：消元、矩阵运算与精确特征空间。"""
import json

import pytest
import sympy as sp

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


@pytest.mark.parametrize('literal', ['|12;34|', '|123;456;789|', '[12;34]', '|-12;34|'])
def test_joined_digits_are_not_split_into_a_square_matrix(literal):
    built = build(f'求行列式 {literal} 的值。')
    assert not built['recognized']
    assert all(len(row) == 1 for row in built['model']['matrix_a'])
    assert any(item['id'] == 'matrix_layout_ambiguity' for item in built['ambiguities'])
    assert linalg.evaluate_linalg(built['model'], {})['status'] == 'blocked'


def test_explicit_multidigit_entries_and_column_matrix_are_preserved():
    built = build('求行列式 A=[[12]] 的值。')
    assert built['recognized']
    assert linalg.solve_linalg(built['model'])['answer_value'] == 12
    column = build('矩阵 A=[12;34]，求数乘 2A。')
    assert column['recognized']
    assert column['model']['matrix_a'] == [[12], [34]]
    assert linalg.evaluate_linalg(column['model'], {})['status'] == 'ok'


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


def eigen_result(text="求矩阵 A 的特征值与特征向量", **overrides):
    built = build(text, **overrides)
    assert built["recognized"], built["ambiguities"]
    assert built["model"]["la_kind"] == "eigen"
    result = linalg.evaluate_linalg(built["model"], {})
    assert result["status"] == "ok", result.get("reason")
    assert all(check["status"] == "pass" for check in result["checks"])
    for space in result["eigenvalues"]:
        assert space["geometric_multiplicity"] == len(space["basis"])
        for check in space["verification"]:
            assert check["exact"] is True
            assert check["residual"] == ["0"] * len(result["matrix_a_exact"])
    json.dumps({"built": built, "result": result}, allow_nan=False)
    return result


def test_eigen_symmetric_matrix_exact_roots_and_trace():
    text = "求 A=[[2,1],[1,2]] 的特征值和特征向量"
    result = eigen_result(text)
    spaces = {space["value"]: space for space in result["eigenvalues"]}
    assert set(spaces) == {"1", "3"}
    assert spaces["1"]["basis"] == [["-1", "1"]]
    assert spaces["3"]["basis"] == [["1", "1"]]
    assert all(space["algebraic_multiplicity"] == 1 for space in spaces.values())
    assert result["charpoly"]["coefficients"] == ["1", "-4", "3"]
    assert result["charpoly"]["convention"] == "det(lambda*I - A)"
    assert result["pseudocode"] == linalg.EIGEN_PSEUDOCODE
    assert result["pseudocode"] != linalg.PSEUDOCODE
    assert {frame["action"] for frame in result["trace"]} == {
        "initial", "charpoly", "eigenvalues", "eigenspace", "verify_eigenvector", "result",
    }
    assert [frame["index"] for frame in result["trace"]] == list(range(len(result["trace"])))
    assert all(1 <= frame["pseudocodeLine"] <= len(result["pseudocode"]) for frame in result["trace"])
    built = build(text)
    assert built["model"]["engine"] == "gauss_v1"
    assert built["model"]["params"] == []
    assert built["formulas"][0]["id"] == "eigen_rule"


@pytest.mark.parametrize("value", [0, 2])
@pytest.mark.parametrize("size", [1, 3, linalg.MAX_DIM])
def test_eigen_repeated_root_has_full_eigenspace(value, size):
    matrix = [[value if i == j else 0 for j in range(size)] for i in range(size)]
    result = eigen_result(matrix_a=matrix)
    assert len(result["eigenvalues"]) == 1
    space = result["eigenvalues"][0]
    assert space["value"] == str(value)
    assert space["algebraic_multiplicity"] == size
    assert space["geometric_multiplicity"] == size
    assert sp.Matrix(space["basis"]).rank() == size


def test_eigen_jordan_defect_is_not_mistaken_for_missing_roots():
    result = eigen_result("求 A=[[2,1],[0,2]] 的特征值与特征向量")
    space = result["eigenvalues"][0]
    assert space["value"] == "2"
    assert space["algebraic_multiplicity"] == 2
    assert space["geometric_multiplicity"] == 1
    assert space["basis"] == [["1", "0"]]
    assert result["stop_reason"] == "done"
    assert "diagonalization" not in result


def test_eigen_complex_roots_and_radical_roots():
    rotation = eigen_result("求 A=[[0,-1],[1,0]] 的特征向量")
    assert {space["value"] for space in rotation["eigenvalues"]} == {"-I", "I"}
    assert rotation["charpoly"]["coefficients"] == ["1", "0", "1"]
    radical = eigen_result(matrix_a=[[0, 2], [1, 0]])
    assert {space["value"] for space in radical["eigenvalues"]} == {"-sqrt(2)", "sqrt(2)"}
    assert all("sqrt" in space["latex"] for space in radical["eigenvalues"])


@pytest.mark.parametrize("raw", [
    "[[1/3,0],[0,2/3]]", "[1/3 0;0 2/3]", "[[1 / 3,0],[0,2 / 3]]",
    "[[0.333333333333333333333333333333,0],[0,.1]]",
    "[[0.1,0],[0,2.50]]", "[[1e-2,0],[0,2E+1]]",
])
def test_eigen_text_literals_keep_exact_precision(raw):
    result = eigen_result(f"A={raw}，求特征根")
    expected = {
        "[[1/3,0],[0,2/3]]": {"1/3", "2/3"},
        "[1/3 0;0 2/3]": {"1/3", "2/3"},
        "[[1 / 3,0],[0,2 / 3]]": {"1/3", "2/3"},
        "[[0.333333333333333333333333333333,0],[0,.1]]": {
            "333333333333333333333333333333/1000000000000000000000000000000", "1/10",
        },
        "[[0.1,0],[0,2.50]]": {"1/10", "5/2"},
        "[[1e-2,0],[0,2E+1]]": {"1/100", "20"},
    }[raw]
    assert {space["value"] for space in result["eigenvalues"]} == expected


@pytest.mark.parametrize("matrix", [
    [["1/3", 0], [0, "2/3"]], "[[1/3,0],[0,2/3]]", "[1/3 0;0 2/3]",
    '[["1/3",0],[0,"2/3"]]', (("1/3", 0), (0, "2/3")),
])
def test_eigen_override_preserves_fraction_and_condition_roundtrip(matrix):
    built = build("A=[[9,0],[0,9]]，求特征值", condition_values={"matrix_a": matrix})
    assert built["recognized"]
    assert built["model"]["matrix_a_exact"] == [["1/3", "0"], ["0", "2/3"]]
    condition = next(item for item in built["conditions"] if item["id"] == "matrix_a")
    assert "1/3" in condition["value"]
    rebuilt = build("求特征值", matrix_a=condition["value"])
    assert rebuilt["model"]["matrix_a_exact"] == built["model"]["matrix_a_exact"]
    assert {space["value"] for space in eigen_result(matrix_a=matrix)["eigenvalues"]} == {"1/3", "2/3"}


def test_eigen_numeric_decimal_input_and_exact_model_authority():
    result = eigen_result(matrix_a=[[0.1, 0], [0, 0.2]])
    assert {space["value"] for space in result["eigenvalues"]} == {"1/10", "1/5"}
    model = build("A=[[1/3,0],[0,2/3]]，求特征值")["model"]
    model["matrix_a"] = [[0.33333, 0], [0, 0.66667]]
    result = linalg.evaluate_linalg(model, {})
    assert {space["value"] for space in result["eigenvalues"]} == {"1/3", "2/3"}
    legacy = linalg.evaluate_linalg({"la_kind": "eigen", "matrix_a": [[0.1, 0], [0, 2]]}, {})
    assert legacy["status"] == "ok"
    assert legacy["matrix_a_exact"][0][0] == "1/10"


@pytest.mark.parametrize("matrix", [
    None, [], [[]], [1, 2], [[1, 2, 3], [4, 5, 6]], [[1, 2], [3]],
    [[1] * 6 for _ in range(6)], [[float("nan")]], [[float("inf")]], [[float("-inf")]],
    [[True]], [[1j]], [["nan"]], [["oo"]], [["1/0"]], [["1e309"]], [["x"]],
    "[[1,,2],[3,4]]", "[[1/0,0],[0,2]]", "[[float('inf'),0],[0,2]]",
    "[[__import__('os').getcwd(),0],[0,2]]", "[[2**3,0],[0,2]]", "[[1+2,0],[0,2]]",
])
def test_eigen_invalid_input_blocks_without_fallback(matrix):
    built = build("A=[[2,1],[1,2]]，求特征值", matrix_a=matrix)
    assert not built["recognized"]
    assert any(item["severity"] == "blocking" for item in built["ambiguities"])
    result = linalg.evaluate_linalg(built["model"], {})
    assert result["status"] == "blocked"
    assert result["eigenvalues"] == []
    assert "answer" not in result
    with pytest.raises(ValueError):
        linalg.solve_linalg(built["model"])
    direct = linalg.evaluate_linalg({"la_kind": "eigen", "matrix_a": matrix}, {})
    assert direct["status"] == "blocked"
    json.dumps({"built": built, "result": result, "direct": direct}, allow_nan=False)


@pytest.mark.parametrize("text", [
    "求特征值", "A=[[1,2,3],[4,5,6]]，求特征值", "A=[[1/0,0],[0,2]]，求特征值",
    "A=[[nan,0],[0,2]]，求特征值", "A=[[1e309,0],[0,2]]，求特征值",
    "A=[[bad,0],[0,2]]，B=[[3,0],[0,4]]，求特征值",
    "A=[[1,2],[3,[[4]]]]，求特征值", "A=[[1,2],[3,4]，求特征值",
])
def test_eigen_invalid_text_or_missing_matrix_blocks(text):
    built = build(text)
    assert not built["recognized"]
    assert linalg.evaluate_linalg(built["model"], {})["status"] == "blocked"


@pytest.mark.parametrize("kind", ["unknown", "diagonalization", "jordan_form", "svd"])
def test_unknown_or_unsupported_kind_remains_blocked(kind):
    built = build("A=[[2,1],[1,2]]", la_kind=kind)
    assert not built["recognized"]
    assert any(item["id"] == "la_unsupported" for item in built["ambiguities"])
    assert linalg.evaluate_linalg(built["model"], {})["status"] == "blocked"
    with pytest.raises(ValueError):
        linalg.solve_linalg(built["model"])


@pytest.mark.parametrize("goal", [
    "求对角化", "求特征值并对角化", "判断是否可对角化", "diagonalize A", "diagonalise A",
    "求若尔当标准形", "求广义特征向量", "Jordan form", "求谱分解", "求奇异值分解",
])
def test_unsupported_goals_cannot_be_silently_reduced_to_eigen(goal):
    for overrides in ({}, {"la_kind": "eigen"}):
        built = build(f"A=[[2,1],[1,2]]，{goal}", **overrides)
        assert not built["recognized"]
        assert built["model"]["la_kind"] != "eigen"
        assert linalg.evaluate_linalg(built["model"], {})["status"] == "blocked"


def test_eigen_build_solve_json_roundtrip_and_document_pipeline():
    text = "求矩阵 A=[[2,1],[1,2]] 的特征值及特征向量"
    built = json.loads(json.dumps(build(text), allow_nan=False))
    solution = linalg.solve_linalg(built["model"])
    decoded = json.loads(json.dumps(solution, allow_nan=False))
    assert decoded == solution
    assert {space["value"] for space in solution["eigenvalues"]} == {"1", "3"}
    assert len(solution["steps"]) == len(solution["trace"])
    assert all(step["id"] == f"la_{frame['index']}" for step, frame in zip(solution["steps"], solution["trace"]))
    assert "特征" in solution["summary"] and "回代" not in solution["summary"]
    from app.labs.recognize import _attach_solution
    problem = build_problem(text)
    _attach_solution(problem)
    assert problem["status"] == "ready"
    assert "λ=1" in problem["solution"]["answer"]
    assert "λ=3" in problem["solution"]["answer"]
    json.dumps(problem, allow_nan=False)


def test_eigen_incomplete_symbolic_solver_is_honestly_blocked(monkeypatch):
    monkeypatch.setattr(sp.MutableDenseMatrix, "eigenvects", lambda *args, **kwargs: [(sp.Integer(2), 1, [sp.Matrix([1, 0])])])
    model = build("A=[[2,0],[0,2]]，求特征值")["model"]
    result = linalg.evaluate_linalg(model, {})
    assert result["status"] == "blocked"
    assert "未求全" in result["reason"]
    with pytest.raises(ValueError):
        linalg.solve_linalg(model)


def test_eigen_algebraic_quintic_roots_have_exact_zero_residuals():
    result = eigen_result(matrix_a=[
        [0, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 0, 0, 0],
        [0, 0, 1, 0, 0], [0, 0, 0, 1, 0],
    ])
    assert result["charpoly"]["coefficients"] == ["1", "0", "0", "0", "-1", "-1"]
    assert len(result["eigenvalues"]) == 5
    assert all(space["value"].startswith("CRootOf(") for space in result["eigenvalues"])


def test_eigen_singleton_fraction_condition_roundtrip():
    built = build("A=[[-1 / 3]]，求特征空间")
    condition = next(item for item in built["conditions"] if item["id"] == "matrix_a")
    result = eigen_result(matrix_a=condition["value"])
    assert result["eigenvalues"][0]["value"] == "-1/3"
    assert result["eigenvalues"][0]["basis"] == [["1"]]


def test_eigen_input_never_executes_user_expression(monkeypatch):
    calls = []
    monkeypatch.setattr("os.system", lambda command: calls.append(command) or 1)
    built = build("求特征值 A=[[__import__('os').system('eigen-test'),0],[0,2]]")
    assert not built["recognized"]
    assert linalg.evaluate_linalg(built["model"], {})["status"] == "blocked"
    assert calls == []


def test_eigen_failed_exact_verification_does_not_report_success(monkeypatch):
    monkeypatch.setattr(sp.MutableDenseMatrix, "eigenvects", lambda *args, **kwargs: [(sp.Integer(3), 2, [sp.Matrix([1, 0])])])
    result = linalg.evaluate_linalg({"la_kind": "eigen", "matrix_a": [[2, 0], [0, 2]]}, {})
    assert result["status"] == "blocked"
    assert result["checks"][0]["status"] == "fail"
    assert result["eigenvalues"] == []
    assert "answer" not in result

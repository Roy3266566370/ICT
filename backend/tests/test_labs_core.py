"""题目交互实验室：识别、求解、状态与本地讲解的针对性测试。

这些用例只走纯函数与临时目录，不调用任何外部模型；OCR 用打桩结果验证流程。
"""

from __future__ import annotations

import io
import math
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

from app.labs.ai import LabAI
from app.labs.assistant import ask, check_attempt
from app.labs.extract import extract_files, text_source
from app.labs.expr import parse_expression
from app.labs.recognize import build_lab_document, build_problem, split_problems
from app.labs.solvers import evaluate_problem, solve_problem
from app.labs.store import normalize_params, normalize_state, save_state, shared_snapshot
from app.settings import get_settings


GOLDEN = "使用梯度下降法求 f(x)=(x-3)^2 的最小值，初始点为 x0=0，学习率为 0.1。"


def _lab(text: str = GOLDEN) -> dict[str, Any]:
    doc = build_lab_document(
        lab_id="lab_test",
        title="测试",
        source=text_source(text, lab_id="lab_test"),
        files=text_source(text, lab_id="lab_test")["files"],
        now_iso="2026-11-07T00:00:00Z",
    )
    return doc


# ---------------------------------------------------------------------------
# 识别
# ---------------------------------------------------------------------------


def test_golden_gradient_descent_conditions_and_answer() -> None:
    problem = build_problem(GOLDEN)
    assert problem["subject"] == "optimization"
    assert problem["status"] == "ready"
    assert problem["model"]["defaults"]["x0"] == 0.0
    assert problem["model"]["defaults"]["learning_rate"] == 0.1
    assert problem["model"]["expression"] == "(x-3)^2"
    solution = solve_problem(problem["model"])
    assert "极小值点 x=3" in solution["answer"]
    assert "全局最小值 0" in solution["answer"]
    assert solution["answer_value"] == pytest.approx(0.0)


def test_integral_exact_value_and_missing_limit_question() -> None:
    problem = build_problem("计算定积分 ∫_0^2 x^2 dx。")
    assert problem["subject"] == "calculus"
    assert problem["status"] == "ready"
    solution = solve_problem(problem["model"])
    assert abs(float(solution["answer_value"]) - 8 / 3) < 1e-9
    assert "8/3" in solution["exact"]

    unsafe = build_problem("计算定积分 x^2 dx。")
    ids = {item["id"] for item in unsafe["recognition"]["ambiguities"] if item["severity"] == "blocking"}
    assert "limits" in ids
    assert unsafe["status"] == "needs_review"


def test_latex_formula_ocr_integral_is_recognized_with_nested_fraction() -> None:
    latex = r"\textstyle\int_{0}^{1}\!\!{\frac{1}{(x+1)(x^{2}-2x+2)}}d x"

    problem = build_problem(latex)

    assert problem["subject"] == "calculus"
    assert problem["model"]["kind"] == "integral"
    assert problem["model"]["teaching"] is False
    assert problem["model"]["expression"] == "1/((x + 1)*(x^2 - 2*x + 2))"
    assert problem["model"]["defaults"]["lower"] == 0.0
    assert problem["model"]["defaults"]["upper"] == 1.0
    assert not [
        item
        for item in problem["recognition"]["ambiguities"]
        if item["severity"] == "blocking" and not item["resolved"]
    ]
    solution = solve_problem(problem["model"])
    assert solution["answer_value"] is not None


def test_improper_integral_keeps_infinity_and_solves_exactly() -> None:
    problem = build_problem("∫_2^+∞ (5)/(x^4+3x^2-4) dx")

    assert problem["status"] == "ready"
    assert problem["model"]["improper_upper"] is True
    assert problem["model"]["defaults"]["lower"] == 2.0
    assert problem["model"]["defaults"]["upper"] == 10.0  # 图像截断区间
    assert problem["model"]["defaults"]["n"] == 32
    assert r"\int_{2}^{+\infty}" in problem["recognition"]["formulas"][0]["tex"]
    upper_condition = next(
        item for item in problem["recognition"]["conditions"] if item["id"] == "upper"
    )
    assert upper_condition["value"] == "+∞"

    solution = solve_problem(problem["model"])
    assert solution["answer_value"] == pytest.approx(0.15660706, rel=1e-6)
    assert "log(3)" in solution["exact"]
    assert "+∞" in solution["limitations"][-1]


def test_indefinite_integral_is_recognized_as_antiderivative_family() -> None:
    problem = build_problem("求不定积分 ∫x^2 dx。")

    assert problem["subject"] == "calculus"
    assert problem["status"] == "ready"
    model = problem["model"]
    assert model["kind"] == "antiderivative"
    assert model["engine"] == "antiderivative_v1"
    assert model["expression"] == "x^2"
    assert model["antiderivative_expression"] == "x^3/3"
    assert model["defaults"] == {"c": 0.0}
    # 不定积分没有上下限，不能再伪造 0 到 1 的“教学区间”。
    assert "lower" not in model["defaults"]
    assert "upper" not in model["defaults"]
    blocking = [
        item
        for item in problem["recognition"]["ambiguities"]
        if item["severity"] == "blocking" and not item["resolved"]
    ]
    assert blocking == []

    solution = solve_problem(model)
    assert "+C" in solution["answer"]
    assert solution["answer_value"] is None
    assert [step["id"] for step in solution["steps"]] == ["integrand", "antiderivative", "verify"]

    evaluation = evaluate_problem(model, model["defaults"])
    assert evaluation["kind"] == "antiderivative"
    assert evaluation["series"]
    assert all(point["y"] is not None for point in evaluation["series"][:20])
    assert [frame["label"] for frame in evaluation["trace"]] == ["C=-2", "C=-1", "C=0", "C=1", "C=2"]
    assert any(
        check["id"] == "derivative" and check["status"] == "pass"
        for check in evaluation["checks"]
    )


def test_indefinite_integral_keeps_full_integrand_for_products_and_fractions() -> None:
    cases = {
        "求不定积分 ∫(3x^2+2x+1)dx。": "3*x**2 + 2*x + 1",
        "求∫x*exp(x)dx。": "x*exp(x)",
        "计算不定积分 ∫ 1/(1+x^2) dx。": "1/(x**2 + 1)",
    }
    for text, expected in cases.items():
        problem = build_problem(text)
        model = problem["model"]
        assert model["kind"] == "antiderivative", text
        assert str(parse_expression(model["expression"], ("x",))) == expected
        assert "lower" not in model["defaults"]
        solution = solve_problem(model)
        assert "+C" in solution["answer"], text

    latex = build_problem(r"\int x^{2} dx")
    assert latex["model"]["kind"] == "antiderivative"
    assert latex["model"]["expression"] == "x^2"


def test_indefinite_integral_attempt_accepts_antiderivative_text_and_rejects_wrong_one() -> None:
    problem = build_problem("求不定积分 ∫x^2 dx。")
    problem["solution"] = solve_problem(problem["model"])

    accepted = check_attempt(problem, {}, answer="x^3/3+C")
    assert accepted["correct"] is True
    without_constant = check_attempt(problem, {}, answer="x^3/3")
    assert without_constant["correct"] is True
    rejected = check_attempt(problem, {}, answer="x^2")
    assert rejected["correct"] is False
    assert "原函数" in rejected["feedback"]


def test_numbered_problems_split_and_cross_page_merge() -> None:
    files = [{"file_id": "f1", "role": "problem", "name": "试卷.pdf", "kind": "pdf"}]
    pages = [
        {"file_id": "f1", "page": 1, "text": "1. 求 f(x)=(x-3)^2 的最小值。", "method": "pdf_text"},
        {"file_id": "f1", "page": 2, "text": "续：初始点 x0=0，学习率 0.1。", "method": "pdf_text"},
        {"file_id": "f1", "page": 3, "text": "2. 计算 ∫_0^1 x dx。", "method": "pdf_text"},
    ]
    split = split_problems(pages, files)
    assert len(split) == 2
    assert "学习率" in split[0]["text"]
    assert split[0]["page_to"] == 2
    assert split[1]["number"] == "2"


def test_bfs_and_deep_learning_defaults_are_executable() -> None:
    bfs = build_problem("从 A 开始执行广度优先搜索，边：A-B, A-C, B-D, C-D, D-E。")
    assert bfs["subject"] == "algorithm"
    assert bfs["model"]["start"] == "A"
    evaluation = evaluate_problem(bfs["model"], bfs["model"]["defaults"])
    assert evaluation["order"] == ["A", "B", "C", "D", "E"]
    assert evaluation["checks"][0]["status"] == "pass"

    dl = build_problem(
        "对 2-3-1 神经网络做反向传播，输入 x=[0.6,-0.2]，目标 y=1，学习率 0.1，训练 5 轮。"
    )
    assert dl["subject"] == "deep_learning"
    assert dl["model"]["defaults"]["epochs"] == 5
    result = evaluate_problem(dl["model"], dl["model"]["defaults"])
    assert result["subject"] == "deep_learning"
    assert len(result["loss_history"]) == 6
    assert result["loss_history"][-1] < result["loss_history"][0]
    gradient_check = next(item for item in result["checks"] if item["id"] == "gradient")
    assert gradient_check["status"] == "pass"


# ---------------------------------------------------------------------------
# 求解与轨迹
# ---------------------------------------------------------------------------


def test_optimization_trajectory_matches_gradient_descent() -> None:
    problem = build_problem(GOLDEN)
    result = evaluate_problem(problem["model"], {**problem["model"]["defaults"], "iterations": 5})
    points = [frame["point"][0] for frame in result["trajectory"]]
    assert points[0] == 0
    assert points[1] == pytest.approx(0.6)
    assert points[2] == pytest.approx(1.08)
    assert result["trajectory"][-1]["f"] < result["trajectory"][0]["f"]
    assert result["stop_reason"]


def test_riemann_frames_approach_integral() -> None:
    problem = build_problem("计算定积分 ∫_0^1 x^2 dx。")
    result = evaluate_problem(problem["model"], {**problem["model"]["defaults"], "n": 8})
    errors = [abs(frame["values"]["sum"] - 1 / 3) for frame in result["trace"]]
    assert errors[0] > errors[-1]
    assert abs(result["exact"] - 1 / 3) < 1e-9


# ---------------------------------------------------------------------------
# 状态、讲解与分享
# ---------------------------------------------------------------------------


def test_state_save_attaches_computed_trace_and_blocks_ambiguous_problem() -> None:
    document = _lab()
    problem = document["problems"][0]
    state = normalize_state(
        {
            "params": {"x0": 0, "learning_rate": 0.1, "iterations": 6},
            "step": 3,
            "mode": "guided",
            "notes": "观察负梯度",
            "scenarios": [{"id": "baseline", "name": "原题", "params": problem["model"]["defaults"]}],
        },
        problem["model"],
    )
    save_state(document, problem["problem_id"], state)
    evaluated = document["problems"][0]["states"]["evaluated"]
    assert evaluated["status"] == "ok"
    assert len(evaluated["trace"]) == 7
    assert evaluated["trace"][3]["values"]["point"] == [1.464]

    blocked = build_problem("计算定积分 x^2 dx。")
    blocked_doc = {
        "problems": [blocked],
        "selected_problem_id": blocked["problem_id"],
        "revision": 1,
    }
    save_state(blocked_doc, blocked["problem_id"], {})
    assert blocked_doc["problems"][0]["states"]["evaluated"]["status"] == "blocked"


def test_attempts_use_deterministic_answers() -> None:
    problem = build_problem(GOLDEN)
    evaluation = evaluate_problem(problem["model"], problem["model"]["defaults"])
    correct = check_attempt(problem, evaluation, answer="3", field="point")
    assert correct["correct"] is True
    wrong = check_attempt(problem, evaluation, answer="2", field="point")
    assert wrong["correct"] is False
    assert "驻点" in wrong["feedback"]


def test_local_assistant_reads_current_step() -> None:
    problem = build_problem(GOLDEN)
    evaluation = evaluate_problem(
        problem["model"], {**problem["model"]["defaults"], "iterations": 5}
    )
    result = ask(
        problem,
        evaluation,
        question="为什么往这个方向移动？",
        mode="explore",
        step=2,
    )
    assert result["local"] is True
    assert "第 2 步" in result["answer"]
    assert "梯度" in result["answer"]
    assert result["context"]["step"] == 2


def test_ai_gate_is_closed_by_default() -> None:
    settings = get_settings()
    assert settings.lab_ai_enabled is False
    assert LabAI(settings).available() is False


def test_shared_snapshot_has_no_stored_paths() -> None:
    document = _lab()
    document["source"]["files"][0]["stored_name"] = "files/f1.txt"
    snapshot = shared_snapshot(document, share_id="share_test")
    assert snapshot["share_id"] == "share_test"
    assert "stored_name" not in snapshot["source"]["files"][0]
    assert "session_id" not in snapshot


# ---------------------------------------------------------------------------
# 文件提取（不触发 OCR 模型）
# ---------------------------------------------------------------------------


def test_extract_text_and_pdf(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr("app.labs.extract.LABS_DIR", tmp_path)

    text_result = extract_files(
        [("f1", "题目.txt", "problem", "1. 求 f(x)=(x-3)^2 的最小值。".encode("utf-8"))],
        lab_id="lab_extract_text",
    )
    assert text_result["pages"][0]["text"].startswith("1.")
    assert text_result["pages"][0]["image_key"]

    pymupdf = pytest.importorskip("pymupdf")
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 100), "2. Calculate integral int_0^2 x^2 dx", fontsize=12)
    pdf_bytes = document.tobytes()
    document.close()
    pdf_result = extract_files(
        [("f1", "试卷.pdf", "problem", pdf_bytes)],
        lab_id="lab_extract_pdf",
    )
    assert "integral" in pdf_result["pages"][0]["text"]
    assert pdf_result["pages"][0]["image_key"]
    assert (tmp_path / "lab_extract_pdf" / "previews" / "f1_p1.png").is_file()


def test_extract_pptx_text(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr("app.labs.extract.LABS_DIR", tmp_path)
    from pptx import Presentation
    from pptx.util import Inches

    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(2))
    box.text_frame.text = "3. Use BFS from A. Edges A-B, B-C, C-D."
    buffer = io.BytesIO()
    presentation.save(buffer)
    result = extract_files(
        [("f1", "课件.pptx", "courseware", buffer.getvalue())],
        lab_id="lab_extract_pptx",
    )
    assert "BFS" in result["pages"][0]["text"]
    assert result["files"][0]["kind"] == "pptx"
    assert result["pages"][0]["image_key"] is None


def test_extract_image_uses_ocr_hook(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr("app.labs.extract.LABS_DIR", tmp_path)
    monkeypatch.setattr("app.labs.extract._ocr", lambda image: ("3. 执行 BFS，从 A 开始。", 0.91))
    monkeypatch.setattr(
        "app.labs.extract._math_ocr",
        lambda image: (_ for _ in ()).throw(AssertionError("普通文字图片不应调用公式 OCR")),
    )
    image = Image.new("RGB", (640, 360), "white")
    buffer = tmp_path / "question.png"
    image.save(buffer)
    result = extract_files(
        [("f1", "截图.png", "problem", buffer.read_bytes())],
        lab_id="lab_extract_image",
    )
    assert "BFS" in result["pages"][0]["text"]
    assert result["files"][0]["kind"] == "image"
    preview = tmp_path / "lab_extract_image" / "previews" / "f1_p1.png"
    assert preview.is_file()


def test_extract_image_uses_math_ocr_for_formula_screenshot(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("app.labs.extract.LABS_DIR", tmp_path)
    monkeypatch.setattr("app.labs.extract._ocr", lambda image: ("1\ndx.", 0.91))
    latex = r"\int_{0}^{1}\frac{1}{(x+1)(x^{2}-2x+2)}d x"
    monkeypatch.setattr("app.labs.extract._math_ocr", lambda image: latex)
    image = Image.new("RGB", (375, 117), "white")
    buffer = tmp_path / "formula.png"
    image.save(buffer)

    result = extract_files(
        [("f1", "公式.png", "problem", buffer.read_bytes())],
        lab_id="lab_extract_formula",
    )

    page = result["pages"][0]
    assert page["text"] == "∫_0^1 (1)/((x+1)(x^2-2x+2)) dx"
    assert page["math_text"] == latex
    assert page["ocr_text"] == "1\ndx."
    assert page["method"] == "image_math_ocr"
    problem = build_problem(page["text"])
    assert problem["model"]["teaching"] is False
    assert parse_expression(problem['model']['expression']) == parse_expression('1/((x+1)*(x^2-2*x+2))')


def test_normalize_params_rejects_unknown_keys() -> None:
    model = {"defaults": {"x0": 0.0, "learning_rate": 0.1, "iterations": 30}}
    result = normalize_params({"x0": "2", "learning_rate": "0.05", "iterations": 3.7, "evil": 1}, model)
    assert result == {"x0": 2.0, "learning_rate": 0.05, "iterations": 4}


def test_all_results_are_json_finite() -> None:
    for text in (
        "计算定积分 ∫_0^1 x^2 dx。",
        GOLDEN,
        "从 A 开始执行广度优先搜索，边：A-B, B-C。",
        "对 2-2-1 网络训练 3 轮，学习率 0.1。",
    ):
        problem = build_problem(text)
        result = evaluate_problem(problem["model"], problem["model"]["defaults"])
        for metric in result["metrics"]:
            assert "nan" not in str(metric.get("value", "")).lower()
        for frame in result.get("trace", [])[:3]:
            for value in (frame.get("values") or {}).values():
                if isinstance(value, float):
                    assert math.isfinite(value)


def test_expression_work_budget_rejects_power_towers() -> None:
    from app.labs.expr import ExprError

    assert parse_expression("2**3**2") == 512
    for hostile in ("2**(2**33)", "9**9**9**9", "x+2**(2**33)"):
        with pytest.raises(ExprError):
            parse_expression(hostile)

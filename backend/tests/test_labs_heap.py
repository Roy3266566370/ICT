"""Binary heap deletion uses actual sift-down snapshots, never BFS data."""
import pytest

from app.labs import heap


SAMPLE = "大根堆的初始序列为（28,22,20,19,8,12,15,5），连续删除两次堆顶后，堆的序列是？\nA. 20,19,15,8,5,12\nB. 20,19,15,5,8,12"


def build(text=SAMPLE, **overrides):
    return heap.build_heap(text, {"file_id": "f1", "page": 1}, overrides)


def test_heap_exam_deletes_twice_with_actual_intermediates():
    built = build()
    assert built["recognized"]
    model = built["model"]
    assert model["algorithm"] == "heap"
    result = heap.evaluate_heap(model, {})
    assert result["status"] == "ok"
    assert result["deleted"] == [28, 22]
    assert result["snapshots"] == [[28, 22, 20, 19, 8, 12, 15, 5], [22, 19, 20, 5, 8, 12, 15], [20, 19, 15, 5, 8, 12]]
    swaps = [frame for frame in result["trace"] if frame["action"] == "sift_down"]
    assert swaps[0]["array"] == [22, 5, 20, 19, 8, 12, 15]
    assert swaps[0]["swapped_indices"] == [0, 1]
    assert swaps[-1]["array"] == [20, 19, 15, 5, 8, 12]
    assert all(frame["heap_valid"] for frame in result["trace"] if frame["action"] in ("initial", "deletion_done", "done"))
    assert heap.solve_heap(model)["answer_order"] == ["20", "19", "15", "5", "8", "12"]
    assert heap.solve_heap(model)["answer_choice"] == "B"


@pytest.mark.parametrize("text,expected,deleted", [
    ("小根堆的序列为 [1,3,2,7,4,5]，删除一次堆顶", [2,3,5,7,4], [1]),
    ("大顶堆初始序列 [9,9,8,4,4]，删除2次堆顶", [8,4,4], [9,9]),
    ("最大堆初始序列 [7]，删除1次根节点", [], [7]),
])
def test_heap_variants(text, expected, deleted):
    built = build(text)
    assert built["recognized"]
    result = heap.evaluate_heap(built["model"], {})
    assert result["final_heap"] == expected
    assert result["deleted"] == deleted


def test_heap_parameters_recompute_and_do_not_mutate_original():
    model = build()["model"]
    result = heap.evaluate_heap(model, {"deletion_count": 1})
    assert result["final_heap"] == [22,19,20,5,8,12,15]
    assert model["initial_heap"] == [28,22,20,19,8,12,15,5]
    assert heap.evaluate_heap(model, {"deletion_count": 0})["final_heap"] == model["initial_heap"]


@pytest.mark.parametrize("text", [
    "大根堆初始序列 [1,9,2]，删除1次堆顶",
    "大根堆初始序列 [9,2,1]，删除4次堆顶",
    "大根堆初始序列 [9,2,1]，删除堆顶若干次",
    "堆初始序列 [9,2,1]，删除1次堆顶",
    "大根堆删除两次堆顶，结果是哪项？\nA. [9,2,1]\nB. [8,2,1]",
])
def test_missing_or_invalid_heap_is_blocking_without_invented_input(text):
    built = build(text)
    assert built is not None
    assert not built["recognized"]
    assert any(a["severity"] == "blocking" and not a["resolved"] for a in built["ambiguities"])


@pytest.mark.parametrize("params", [{"deletion_count": -1}, {"deletion_count": 99}, {"deletion_count": 1.5}, {"deletion_count": "garbage"}])
def test_invalid_exploration_does_not_clamp_into_a_fabricated_answer(params):
    result = heap.evaluate_heap(build()["model"], params)
    assert result["status"] == "blocked"
    assert not result["trace"]


def test_heap_recognizer_ignores_unrelated_algorithms_and_answer_options():
    assert build("用 BFS 遍历图 A-B, B-C") is None
    built = build("大根堆的初始序列为（40，30，20，10），删除一次堆顶。\nA. [99,80,50]\nB. [30,10,20]")
    assert built["model"]["initial_heap"] == [40,30,20,10]


def test_heap_does_not_read_inline_options_or_a_final_state_as_initial_data():
    for text in (
        "大根堆删除两次堆顶，结果是？A.[9,2,1] B.[8,2,1]",
        "大根堆删除两次堆顶后，最终结果为 [9,2,1]，求初始堆。",
    ):
        built = build(text)
        assert not built["recognized"]
        assert built["model"]["initial_heap"] == []


def test_confirmed_conditions_resolve_missing_inputs():
    built = build("二叉堆连续删除根节点", initial_heap=[8,5,3], heap_type="max", deletion_count=1)
    assert built["recognized"]
    assert all(c["provenance"] == "user_confirmed" for c in built["conditions"])


def test_heap_trace_budget_blocks_excess_work_with_actionable_reason():
    built = build("大根堆删除1次堆顶", initial_heap=list(range(127, 0, -1)))
    assert built["recognized"]
    result = heap.evaluate_heap(built["model"], {"deletion_count": 127})
    assert result["status"] == "blocked"
    assert "200" in result["reason"] and "减少" in result["reason"]
    assert result["trace"] == []


def test_heap_recognizes_count_after_root_word_without_guessing_heap_type():
    built = build("大根堆初始序列 [9,8,7,5]，连续删除堆顶两次")
    assert built["recognized"]
    assert built["model"]["defaults"]["deletion_count"] == 2
    ambiguous = build("大根堆或小根堆初始序列 [9]，删除一次堆顶")
    assert not ambiguous["recognized"]


def insert_model(sequence, kind="max"):
    return {"engine": "heap_v1", "subject": "algorithm", "algorithm": "heap", "heap_type": kind,
            "initial_heap": list(sequence), "operation": "insert", "count_comparisons": False,
            "defaults": {"operation": "insert", "count_comparisons": False}, "params": []}


def test_heap_insert_build_reports_each_step_and_final_heap():
    result = heap.evaluate_heap(insert_model([5, 3, 8, 1, 9]), {})
    assert result["status"] == "ok"
    assert result["snapshots"] == [[], [5], [5, 3], [8, 3, 5], [8, 3, 5, 1], [9, 8, 5, 1, 3]]
    assert result["final_heap"] == [9, 8, 5, 1, 3]
    assert result["trace_kind"] == "heap_insertion"
    assert [f["action"] for f in result["trace"] if f["action"] == "sift_up"]
    assert all(f["heap_valid"] for f in result["trace"] if f["action"] == "insert_done")
    assert heap.solve_heap(insert_model([5, 3, 8, 1, 9]))["answer_order"] == ["9", "8", "5", "1", "3"]


def test_heap_insert_build_min_heap_sifts_up():
    result = heap.evaluate_heap(insert_model([5, 3, 8, 1, 9], "min"), {})
    assert result["final_heap"] == [1, 3, 8, 5, 9]
    assert result["snapshots"][-1] == [1, 3, 8, 5, 9]


@pytest.mark.parametrize("model", [
    {"heap_type": "max", "operation": "insert"},
    {"heap_type": "max", "initial_heap": [], "operation": "insert"},
    {"initial_heap": [5, 3, 8], "operation": "insert"},
    {"heap_type": "max", "initial_heap": [5, 3, 8], "operation": "invented"},
])
def test_heap_insert_build_rejects_incomplete_input(model):
    result = heap.evaluate_heap(model, {})
    assert result["status"] == "blocked"
    assert result["reason"] and not result["trace"]


def test_heap_compare_count_follows_documented_definition():
    deletion = heap.evaluate_heap({"heap_type": "max", "initial_heap": [9, 7, 8, 1, 5], "operation": "delete",
                                   "deletion_count": 1, "count_comparisons": True}, {})
    assert deletion["status"] == "ok"
    # 每层一次孩子比较 + 一次父与优先孩子比较：9,7,8,1,5 删除堆顶共 2 次比较。
    assert deletion["compare_count"] == 2
    assert any("关键字比较" in note or "比较" in note for note in deletion["notes"])
    insertion = heap.evaluate_heap({**insert_model([5, 3, 8, 1, 9]), "count_comparisons": True}, {})
    assert insertion["compare_count"] == 5


def test_heap_compare_count_is_absent_by_default():
    result = heap.evaluate_heap(build()["model"], {})
    assert result["status"] == "ok"
    assert "compare_count" not in result

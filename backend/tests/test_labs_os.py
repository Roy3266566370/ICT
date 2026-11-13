"""操作系统题目：CPU 调度、页面置换、磁盘调度与银行家算法的识别和确定性轨迹。"""
import pytest

from app.labs import opsys
from app.labs.assistant import check_attempt
from app.labs.recognize import build_problem
from app.labs.solvers import evaluate_problem, solve_problem


def build(text, **overrides):
    return opsys.build_os(text, {"file_id": "f1", "page": 1}, overrides)


SCHED_TEXT = "下列进程采用调度算法执行：\n进程 到达时间 服务时间\nP1 0 7\nP2 2 4\nP3 4 1\nP4 5 4\n求平均周转时间和平均等待时间。"


def run(model, **params):
    return opsys.evaluate_os(model, params)


def test_schedule_table_text_and_classic_averages():
    built = build(SCHED_TEXT)
    assert built["recognized"]
    model = built["model"]
    assert model["os_kind"] == "cpu_schedule"
    assert [p["id"] for p in model["processes"]] == ["P1", "P2", "P3", "P4"]
    expected = {"fcfs": (8.75, 4.75), "sjf": (8.0, 4.0), "srtf": (7.0, 3.0)}
    for algorithm, (turnaround, waiting) in expected.items():
        result = run(model, algorithm=algorithm)
        assert result["status"] == "ok"
        assert result["stats"]["avg_turnaround"] == pytest.approx(turnaround)
        assert result["stats"]["avg_waiting"] == pytest.approx(waiting)
        assert all(check["status"] == "pass" for check in result["checks"])
        assert result["trace"][0]["action"] == "initial" and result["trace"][-1]["action"] == "result"


def test_srtf_preempts_and_gantt_is_merged():
    result = run(build(SCHED_TEXT)["model"], algorithm="srtf")
    gantt = result["stats"]["gantt"]
    assert [(g["id"], g["start"], g["end"]) for g in gantt] == [
        ("P1", 0, 2), ("P2", 2, 4), ("P3", 4, 5), ("P2", 5, 7), ("P4", 7, 11), ("P1", 11, 16)]
    assert result["stats"]["switches"] == 5


def test_round_robin_queue_convention():
    model = build("时间片轮转，时间片为2。\nP1 0 5\nP2 1 3\nP3 2 1")["model"]
    assert model["defaults"]["algorithm"] == "rr" and model["defaults"]["quantum"] == 2
    result = run(model)
    gantt = [(g["id"], g["start"], g["end"]) for g in result["stats"]["gantt"]]
    assert gantt == [("P1", 0, 2), ("P2", 2, 4), ("P3", 4, 5), ("P1", 5, 7), ("P2", 7, 8), ("P1", 8, 9)]
    assert result["stats"]["avg_waiting"] == pytest.approx(10 / 3)
    assert result["stats"]["avg_turnaround"] == pytest.approx(19 / 3)


def test_priority_needs_all_priorities_and_picks_smallest_number():
    model = build("优先级调度（数小优先）。\nP1 0 4 3\nP2 0 2 1\nP3 0 3 2")["model"]
    assert model["has_priority"] and model["defaults"]["algorithm"] == "priority"
    result = run(model)
    assert [g["id"] for g in result["stats"]["gantt"]] == ["P2", "P3", "P1"]
    plain = build(SCHED_TEXT)["model"]
    assert run(plain, algorithm="priority")["status"] == "blocked"


def test_schedule_idle_gap_and_inline_and_list_formats():
    idle = run(build("FCFS\nP1 0 2\nP2 5 2")["model"])
    assert [(g["id"], g["start"], g["end"]) for g in idle["stats"]["gantt"]] == [("P1", 0, 2), (None, 2, 5), ("P2", 5, 7)]
    inline = build("进程P1到达时间为0，服务时间为7；进程P2到达时间为2，服务时间为4；进程P3到达时间为4，服务时间为1。")
    assert [(p["id"], p["arrival"], p["burst"]) for p in inline["model"]["processes"]] == [
        ("P1", 0, 7), ("P2", 2, 4), ("P3", 4, 1)]
    listed = build("进程P1,P2,P3到达时间分别为0,1,2，服务时间分别为5,3,1，时间片为2")
    assert [(p["id"], p["arrival"], p["burst"]) for p in listed["model"]["processes"]] == [
        ("P1", 0, 5), ("P2", 1, 3), ("P3", 2, 1)]
    assert listed["model"]["defaults"]["algorithm"] == "rr"


def test_schedule_missing_table_blocks_without_fabricating():
    built = build("进程调度算法有哪些？")
    assert not built["recognized"]
    assert any(item["severity"] == "blocking" for item in built["ambiguities"])
    assert run(built["model"])["status"] == "blocked"


REFERENCE = "7,0,1,2,0,3,0,4,2,3,0,3,2,1,2,0,1,7,0,1"
PAGE_TEXT = f"页面访问序列为 {REFERENCE}，物理块数为3，分别采用 FIFO、LRU、OPT 算法，求缺页次数。"


def test_page_replacement_classic_counts_and_default_algorithm():
    built = build(PAGE_TEXT)
    assert built["recognized"]
    model = built["model"]
    assert model["os_kind"] == "page_replace"
    assert model["reference"] == REFERENCE.split(",")
    assert model["defaults"] == {"algorithm": "fifo", "frames": 3}
    for algorithm, faults in {"fifo": 15, "lru": 12, "opt": 9}.items():
        result = run(model, algorithm=algorithm)
        assert result["stats"]["faults"] == faults
        assert result["answer_value"] == faults
        assert result["stats"]["compare"] == {"fifo": 15, "lru": 12, "opt": 9}
        assert result["trace"][-1]["values"]["faults"] == faults
    replaced = [f for f in run(model)["trace"] if f["action"] == "replace"]
    assert replaced[0]["values"]["evicted"] == "7"


def test_page_belady_anomaly_is_reported():
    text = "页面访问序列为 1,2,3,4,1,2,5,1,2,3,4,5，物理块数为3，FIFO 置换算法。"
    model = build(text)["model"]
    three = run(model)
    four = run(model, frames=4)
    assert (three["stats"]["faults"], four["stats"]["faults"]) == (9, 10)
    belady = [c for c in three["checks"] if c["id"] == "belady"][0]
    assert belady["status"] == "warn"
    lru = run(model, algorithm="lru")
    assert [c for c in lru["checks"] if c["id"] == "belady"][0]["status"] == "pass"


def test_page_missing_reference_blocks():
    built = build("某系统采用页面置换，物理块数为3，求缺页次数。")
    assert not built["recognized"]
    assert run(built["model"])["status"] == "blocked"


NONEMPTY_PAGE_TEXT = ("采用LRU固定分配局部页面置换，为进程分配3个页框。页面访问序列0,1,2,0,5,1,4,3,0,2,3,2,0，"
                      "其中0,1,2已调入内存。求缺页次数。")


def test_page_replacement_nonempty_initial_state_counts_exam_answer():
    built = build(NONEMPTY_PAGE_TEXT)
    assert built["recognized"]
    model = built["model"]
    assert model["initial_frames"] == ["0", "1", "2"]
    result = run(model)
    assert result["status"] == "ok"
    assert result["stats"]["faults"] == 6
    assert result["trace"][0]["action"] == "initial"
    assert "初始" in result["trace"][0]["label"] and result["trace"][0]["values"]["frames"] == ["0", "1", "2"]
    assert result["trace"][1]["action"] == "hit", "初态驻留再访问不算缺页"


def test_page_replacement_nonempty_initial_state_does_not_change_empty_path():
    model = build(PAGE_TEXT)["model"]
    assert model["initial_frames"] == []
    assert run(model)["stats"]["faults"] == 15
    assert run(model)["trace"][0]["values"]["frames"] == [None, None, None]


@pytest.mark.parametrize("initial", [["0", "1", "2", "3"], ["0", "0", "1"]])
def test_page_replacement_invalid_initial_state_is_blocked(initial):
    model = build(PAGE_TEXT)["model"]
    result = run({**model, "initial_frames": initial}, frames=3)
    assert result["status"] == "blocked"
    assert result["reason"]


DISK_TEXT = ("磁盘请求队列为 98, 183, 37, 122, 14, 124, 65, 67，磁头当前位于 53 号磁道，磁道范围 0~199，"
             "向磁道号增加方向移动。分别采用 FCFS、SSTF、SCAN 算法。")


def test_disk_scheduling_classic_totals():
    built = build(DISK_TEXT)
    assert built["recognized"]
    model = built["model"]
    assert model["os_kind"] == "disk_schedule"
    assert model["head"] == 53 and model["max_track"] == 199 and model["defaults"]["algorithm"] == "fcfs"
    totals = {"fcfs": 640, "sstf": 236, "scan": 331, "look": 299, "cscan": 382, "clook": 322}
    for algorithm, total in totals.items():
        result = run(model, algorithm=algorithm)
        assert result["stats"]["total"] == total, algorithm
        assert all(check["status"] == "pass" for check in result["checks"])
    assert run(model, algorithm="cscan", return_cost="skip")["stats"]["total"] == 183
    assert run(model, algorithm="scan", direction="down")["stats"]["total"] == 236
    sstf = run(model, algorithm="sstf")["stats"]["served"]
    assert sstf == [65, 67, 37, 14, 98, 122, 124, 183]


def test_disk_out_of_range_is_blocking():
    built = build("磁盘请求队列为 10, 250，磁头当前位于 53 号磁道，磁道范围 0~199，SCAN")
    assert any(item["id"] == "max_track" for item in built["ambiguities"])
    assert run(built["model"])["status"] == "blocked"


BANKER_TEXT = ("系统有 5 个进程 P0~P4，3 类资源 A、B、C。Allocation=[[0,1,0],[2,0,0],[3,0,2],[2,1,1],[0,0,2]]，"
               "Max=[[7,5,3],[3,2,2],[9,0,2],[2,2,2],[4,3,3]]，Available=[3,3,2]。"
               "判断系统是否处于安全状态，并给出安全序列。")


def test_banker_safe_sequence_and_student_sequences():
    built = build(BANKER_TEXT)
    assert built["recognized"]
    model = built["model"]
    assert model["os_kind"] == "banker"
    assert model["need"][0] == [7, 4, 3]
    result = run(model)
    assert result["stats"]["safe"] and result["answer_order"] == ["P1", "P3", "P0", "P2", "P4"]
    ok, _ = opsys.check_banker_sequence(model, ["P1", "P3", "P4", "P0", "P2"])
    assert ok
    bad, note = opsys.check_banker_sequence(model, ["P0", "P1", "P2", "P3", "P4"])
    assert not bad and "P0" in note


def test_banker_request_granted_and_denied():
    granted = build(BANKER_TEXT + "此时 P1 请求资源(1,0,2)，能否立即分配？")["model"]
    assert granted["request"] == {"process": "P1", "vector": [1, 0, 2]}
    result = run(granted)
    assert result["stats"]["granted"] is True and result["stats"]["safe"]
    assert [f["action"] for f in result["trace"]][:3] == ["initial", "request_check", "request_try"]
    ignored = run(granted, request_mode="ignore")
    assert ignored["stats"]["granted"] is None and ignored["answer_order"] == ["P1", "P3", "P0", "P2", "P4"]
    denied = build(BANKER_TEXT + "此时 P4 请求资源(3,3,0)。")["model"]
    outcome = run(denied)
    assert outcome["stats"]["granted"] is False
    assert outcome["trace"][-2]["action"] == "unsafe"
    assert outcome["stats"]["state"]["available"] == [3, 3, 2], "撤销试分配后应回到原状态"
    assert run(build(BANKER_TEXT + "此时 P0 请求资源(0,2,0)。")["model"])["stats"]["granted"] is True
    over = run(build(BANKER_TEXT + "此时 P1 请求资源(5,0,0)。")["model"])
    assert over["stats"]["granted"] is False
    assert over["trace"][1]["action"] == "request_deny"


def test_banker_unsafe_state_and_table_format():
    unsafe = build("银行家算法。Allocation=[[1,0],[0,1]]，Max=[[3,3],[3,3]]，Available=[0,0]，判断是否安全。")
    result = run(unsafe["model"])
    assert result["status"] == "ok" and not result["stats"]["safe"]
    assert result["answer_order"] is None and result["stop_reason"] == "unsafe"
    table = build("银行家算法，判断安全性。\n进程 Allocation Max Available\nP0 0 1 0 7 5 3 3 3 2\nP1 2 0 0 3 2 2\n"
                  "P2 3 0 2 9 0 2\nP3 2 1 1 2 2 2\nP4 0 0 2 4 3 3")
    assert table["recognized"]
    assert table["model"]["available"] == [3, 3, 2]
    assert run(table["model"])["answer_order"] == ["P1", "P3", "P0", "P2", "P4"]


def test_subject_classification_and_document_pipeline():
    for text, kind in ((SCHED_TEXT, "cpu_schedule"), (PAGE_TEXT, "page_replace"),
                       (DISK_TEXT, "disk_schedule"), (BANKER_TEXT, "banker")):
        problem = build_problem(text)
        assert problem["subject"] == "operating_system", text
        assert problem["model"]["os_kind"] == kind
        assert problem["status"] == "ready"
        solution = solve_problem(problem["model"])
        assert solution["answer"] and solution["steps"]
        assert evaluate_problem(problem["model"], {})["status"] == "ok"
    assert solve_problem(build_problem(PAGE_TEXT)["model"])["answer_value"] == 15
    # 既有学科的归类不被抢走。
    assert build_problem("对下图从 A 开始执行广度优先搜索。边：A-B, A-C, B-D, C-D, D-E。")["subject"] == "algorithm"
    assert build_problem("解方程组：x+y=3，x-y=1")["subject"] == "linear_algebra"


UI_SAMPLES = (
    "采用最短剩余时间优先（抢占）调度下列进程，求平均周转时间和平均等待时间。\n进程 到达时间 服务时间\nP1 0 7\nP2 2 4\nP3 4 1\nP4 5 4",
    "页面访问序列为 1,2,3,4,1,2,5,1,2,3,4,5，物理块数为3，采用 FIFO 置换算法，求缺页次数。",
    "磁盘请求队列为 98, 183, 37, 122, 14, 124, 65, 67，磁头当前位于 53 号磁道，磁道范围 0~199，向磁道号增加方向移动，采用 SCAN 算法，求磁头总移动距离。",
    BANKER_TEXT + "此时 P1 请求资源(1,0,2)，判断能否立即分配，并给出安全序列。",
)


def test_front_end_sample_texts_are_recognised_and_solved():
    answers = []
    for text in UI_SAMPLES:
        problem = build_problem(text)
        assert problem["subject"] == "operating_system" and problem["status"] == "ready", text
        answers.append(solve_problem(problem["model"]))
    assert answers[0]["answer_value"] == pytest.approx(3.0)
    assert answers[1]["answer_value"] == 9
    assert answers[2]["answer_value"] == 331
    assert "可以分配" in answers[3]["answer"]


def test_attempt_checks_for_os_problems():
    problem = build_problem(PAGE_TEXT)
    problem["solution"] = solve_problem(problem["model"])
    evaluation = evaluate_problem(problem["model"], {})
    good = check_attempt(problem, evaluation, answer="15", field="numeric")
    assert good["correct"]
    assert not check_attempt(problem, evaluation, answer="12", field="numeric")["correct"]
    banker = build_problem(BANKER_TEXT)
    banker["solution"] = solve_problem(banker["model"])
    banker_eval = evaluate_problem(banker["model"], {})
    assert check_attempt(banker, banker_eval, answer="P1 → P3 → P4 → P0 → P2", field="order")["correct"]
    assert not check_attempt(banker, banker_eval, answer="P0 P1 P2 P3 P4", field="order")["correct"]

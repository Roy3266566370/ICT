"""408 模块修复反例：DFS/BFS 识别、网络题科目判断、能力判断与内核同步、中文图条件提取。"""
from __future__ import annotations

import pytest

from app.labs.recognize import _attach_solution, _parse_edges, build_problem
from app.labs.solvers import evaluate_problem
from app.labs.goal_actions import task_limit
from app.labs.staged_understanding import candidate_tasks, compile_page_facts, validate_page_model


# ---------------------------------------------------------------------------
# 高优先级：DFS 不能被当成 BFS 求解
# ---------------------------------------------------------------------------

DFS_TEXT = "对有向图进行深度优先遍历（DFS），边：A→B，A→C，B→D。从A开始，写出访问顺序。"
BFS_TEXT = "对有向图进行广度优先遍历（BFS），边：A→B，A→C，B→D。从A开始，写出访问顺序。"


def test_dfs_recognized_and_solved_in_dfs_order():
    problem = build_problem(DFS_TEXT)
    assert problem["subject"] == "algorithm"
    assert problem["model"]["algorithm"] == "dfs"
    assert problem["model"]["engine"] == "dfs_v1"
    assert problem["model"]["start"] == "A"
    _attach_solution(problem)
    # 按编号优先的 DFS：A→B→D→C，而不是 BFS 的 A→B→C→D。
    assert problem["solution"]["answer_order"] == ["A", "B", "D", "C"]


def test_dfs_evaluation_trace_uses_stack():
    problem = build_problem(DFS_TEXT)
    result = evaluate_problem(problem["model"], {"start": "A"})
    assert result["algorithm"] == "dfs"
    assert result["order"] == ["A", "B", "D", "C"]
    assert result["trace"][0]["stack"] == ["A"]
    assert any(frame["action"] == "backtrack" for frame in result["trace"])


def test_bfs_still_solved_in_bfs_order():
    problem = build_problem(BFS_TEXT)
    assert problem["model"]["algorithm"] == "bfs"
    assert problem["model"]["engine"] == "bfs_v1"
    _attach_solution(problem)
    assert problem["solution"]["answer_order"] == ["A", "B", "C", "D"]


# ---------------------------------------------------------------------------
# 高优先级：网络题不能误入微积分（含 ∫₀¹x²dx 教学示例）
# ---------------------------------------------------------------------------

TCP_TEXT = (
    "主机甲与主机乙之间建立一个TCP连接，采用慢启动算法，初始拥塞窗口为1，"
    "经过3个RTT后拥塞窗口增长到多大？"
)


def test_tcp_slow_start_classified_as_computer_network():
    subject, confidence = __import__("app.labs.recognize", fromlist=["classify_subject"]).classify_subject(TCP_TEXT)
    assert subject == "computer_network"
    assert confidence >= 0.55


def test_tcp_slow_start_never_becomes_calculus_teaching_example():
    problem = build_problem(TCP_TEXT)
    assert problem["subject"] == "computer_network"
    assert problem["status"] == "unsupported"
    assert problem["subject_label"] == "计算机网络"
    for ambiguity in problem["recognition"]["ambiguities"]:
        assert "∫" not in str(ambiguity.get("question") or "")
        assert "教学示例" not in str(ambiguity.get("question") or "")


def test_graph_question_still_recognized_as_algorithm():
    problem = build_problem(DFS_TEXT)
    assert problem["subject"] == "algorithm"
    assert problem["status"] in ("ready", "needs_review")


# ---------------------------------------------------------------------------
# 中优先级：能力判断规则要跟上内核（堆插入/比较次数、折半查找、非空初态页面置换）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "question",
    [
        "对初始堆依次插入关键字，得到插入后的新堆。",
        "对该堆进行删除操作时，关键字比较次数是多少？",
        "对长度为1024的有序表进行折半查找，最坏情况下需要比较多少次？",
        "系统已将页面1、2、3调入内存，物理块数为3，之后访问序列4,1,2,5，采用LRU算法，求缺页次数。",
    ],
)
def test_kernel_supported_tasks_no_longer_rejected(question):
    assert task_limit(question) == ""


def test_unsupported_kernel_limits_still_rejected():
    assert task_limit("分析该程序段的时间复杂度。") != ""
    # 哈夫曼/散列已由 ds_advanced 支持：不再是能力边界。
    assert task_limit("对给定权值构造哈夫曼编码并求带权路径长度。") == ""
    assert task_limit("散列表采用线性探查，求查找失败的平均查找长度。") == ""


# ---------------------------------------------------------------------------
# 中优先级：中文图条件提取（边A→B 不把“边A”当节点；起点为 A 能提取）
# ---------------------------------------------------------------------------


def test_parse_edges_strips_role_words():
    edges, directed = _parse_edges("有向边A→B，边B→C。")
    assert directed is True
    assert edges == [{"from": "A", "to": "B"}, {"from": "B", "to": "C"}]


def test_parse_edges_undirected_with_role_words():
    edges, directed = _parse_edges("结点A—B，顶点C-D")
    assert directed is False
    assert {"from": "A", "to": "B"} in edges
    assert {"from": "C", "to": "D"} in edges


def test_start_extraction_qidian_wei():
    problem = build_problem("对无向图进行广度优先遍历，边：A-B，A-C，B-D。起点为 A。")
    assert problem["model"]["start"] == "A"


def test_start_extraction_cong_chufa_and_yi_wei():
    problem = build_problem("无向图边：A-B，B-C，C-D。从B出发进行DFS。")
    assert problem["model"]["algorithm"] == "dfs"
    assert problem["model"]["start"] == "B"

    problem2 = build_problem("图：A-B，A-C。以A为起点做BFS。")
    assert problem2["model"]["start"] == "A"


def test_start_extraction_chinese_node_names():
    problem = build_problem("边：甲→乙，甲→丙，乙→丁。起点为甲。")
    model = problem["model"]
    assert [node["id"] for node in model["nodes"]] == ["甲", "乙", "丙", "丁"]
    assert model["start"] == "甲"
    # 起点已识别，不再出现“没有明确识别出起点”的阻断。
    assert problem["recognition"]["ambiguities"] == []


def test_start_extraction_chinese_with_modifier():
    problem = build_problem("无向图边：甲-乙，乙-丙。从图中甲出发。")
    assert problem["model"]["start"] == "甲"


def test_chinese_tiangen_nodes_use_textbook_order():
    problem = build_problem("边：甲→乙，甲→丙，乙→丁。起点为甲。")
    _attach_solution(problem)
    # 甲的邻居按教材序（甲乙丙丁…）排序：先乙后丙；BFS 顺序 甲乙丙丁。
    assert problem["solution"]["answer_order"] == ["甲", "乙", "丙", "丁"]
    problem2 = build_problem("对有向图进行深度优先遍历，边：甲→乙，甲→丙，乙→丁。起点为甲。")
    _attach_solution(problem2)
    assert problem2["solution"]["answer_order"] == ["甲", "乙", "丁", "丙"]


# ---------------------------------------------------------------------------
# 中优先级：分阶段理解管线——DFS 路由与页面非空初态
# ---------------------------------------------------------------------------


def test_candidate_tasks_routes_dfs():
    assert "dfs" in candidate_tasks({"question": "对给定图进行深度优先遍历dfs", "target": ""})


def _page_reading():
    return {
        "question": "系统已将页面1、2、3调入内存，物理块数为3，之后访问序列4,1,2,5，采用LRU算法，求缺页次数。",
        "target": "",
        "conditions": [
            {"id": "c1", "value": "LRU", "excerpt": "采用LRU算法"},
            {"id": "c2", "value": "3", "excerpt": "物理块数为3"},
            {"id": "c3", "value": "4,1,2,5", "excerpt": "访问序列4,1,2,5"},
            {"id": "c4", "value": "1,2,3", "excerpt": "已将页面1、2、3调入内存"},
        ],
        "uncertainties": [],
    }


def test_page_replace_compiles_non_empty_initial_frames():
    reading = _page_reading()
    model = compile_page_facts(reading)
    assert model is not None
    assert model["conditions"]["initial_frames"] == [1, 2, 3]
    # 内核已支持非空初态：校验不得再以“只支持空初态”拒绝。
    validate_page_model(reading, model, reading["question"])


def test_page_replace_rejects_mismatched_initial_frames():
    reading = _page_reading()
    model = compile_page_facts(reading)
    model["conditions"]["initial_frames"] = [2, 1, 3]
    with pytest.raises(ValueError):
        validate_page_model(reading, model, reading["question"])

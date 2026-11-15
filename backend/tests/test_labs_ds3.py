"""408 算法设计题：链表/数组/树/图设计模式、伪代码补全、正确性与复杂度。"""
from __future__ import annotations

import pytest

from app.labs.recognize import _attach_solution, build_problem


def _solve(text: str):
    problem = build_problem(text)
    assert problem["subject"] == "algorithm", (text, problem["subject"])
    assert problem["model"].get("engine") == "ds_algo_design_v1", (text, problem["model"].get("engine"))
    assert problem["model"].get("ds_kind") == "algo_design"
    _attach_solution(problem)
    return problem


def test_llist_reverse_design():
    problem = _solve("设计一个算法，将带头结点的单链表就地逆置，要求时间复杂度 O(n)、空间复杂度 O(1)。")
    solution = problem["solution"]
    answer = solution["answer"]
    assert "就地逆置" in answer or "逆置" in answer
    assert "O(n)" in answer and "O(1)" in answer
    # 四要素：思想、伪代码补全、正确性（不变式）、复杂度
    kinds = {f.get("title", "") for f in solution.get("steps", [])}
    assert any("基本思想" in k for k in kinds)
    assert any("伪代码" in k for k in kinds)
    assert any("正确性" in k for k in kinds)
    assert any("复杂度" in k for k in kinds)


def test_llist_cycle_design():
    problem = _solve("设计一个算法判断带头结点的单链表是否存在环。")
    answer = problem["solution"]["answer"]
    assert "快" in answer or "环" in answer


def test_array_shift_design():
    problem = _solve("设计一个在时间和空间上都尽可能高效的算法，将数组中的整数循环左移 p 个位置。")
    answer = problem["solution"]["answer"]
    assert "O(n)" in answer and "O(1)" in answer
    # 2010 年统考真题：三次逆置法
    assert any("逆置" in f.get("detail", "") for f in problem["solution"].get("steps", []))


def test_array_shift_right_uses_right_template():
    problem = _solve("设计一个算法，将数组中的整数循环右移 p 个位置。")
    assert problem["model"]["pattern"] == "array_shift_right"
    answer = problem["solution"]["answer"]
    assert "循环右移" in answer
    assert "循环左移" not in answer


def test_array_shift_right_direction_words():
    problem = _solve("设计算法将数组A循环移位 p 位，方向为右。")
    assert problem["model"]["pattern"] == "array_shift_right"
    problem2 = _solve("设计算法将数组中的元素向右循环移动 p 个位置。")
    assert problem2["model"]["pattern"] == "array_shift_right"


def test_array_shift_without_direction_is_blocked():
    problem = build_problem("设计算法将数组循环移位 p 位。")
    assert problem["status"] == "needs_review"
    assert "方向" in str(problem["model"].get("blocked") or "")


def test_majority_element_design():
    problem = _solve("设计一个在时间和空间上尽可能高效的算法，找出数组中的主元素。")
    answer = problem["solution"]["answer"]
    assert "O(n)" in answer and "O(1)" in answer


def test_array_median_design():
    problem = _solve("设计一个高效算法，求两个等长升序数组的中位数。")
    assert "O(log" in problem["solution"]["answer"]


def test_bst_check_design():
    problem = _solve("设计一个算法判断二叉树是否为二叉排序树。")
    answer = problem["solution"]["answer"]
    assert "中序" in answer


def test_graph_shortest_path_design():
    problem = _solve("设计一个算法，求无权图中从源点到其余各顶点的最短路径。")
    answer = problem["solution"]["answer"]
    assert "O(n + e)" in answer or "BFS" in answer


def test_graph_cycle_design():
    problem = _solve("设计一个算法判断有向图是否存在回路。")
    answer = problem["solution"]["answer"]
    assert "拓扑" in answer


def test_pseudocode_completion_frame():
    problem = _solve("设计一个算法，将带头结点的单链表就地逆置，并补全伪代码。")
    frames = problem["solution"].get("steps", []) or []
    # 伪代码补全：模板与补全后两个阶段都出现
    assert any("空位" in f.get("title", "") or "空位" in f.get("detail", "") for f in frames)


def test_unmatched_design_blocked_honestly():
    problem = build_problem("设计一个算法，求二叉树的宽度。")
    assert problem["status"] == "needs_review"
    assert problem["model"].get("engine") == "ds_algo_design_v1"
    assert problem["model"].get("blocked")


def test_concrete_list_operation_not_hijacked():
    problem = build_problem("将单链表(1,2,3)逆置。")
    assert problem["model"].get("engine") != "ds_design_v1"


def test_goal_boundary_allows_design_questions():
    from app.labs.goal_actions import unsupported_reason
    assert unsupported_reason("设计一个算法判断单链表是否有环") == ""
    assert unsupported_reason("设计一个在时间和空间上尽可能高效的算法，找出数组中的主元素") == ""

"""操作系统新增题型：基础、进程线程、同步、死锁、连续内存分配与 HRRN。"""
from __future__ import annotations

import pytest

from app.labs import opsys
from app.labs.recognize import _attach_solution, build_problem
from app.labs.solvers import evaluate_problem, solve_problem


def _solve(text: str):
    problem = build_problem(text)
    assert problem["subject"] == "operating_system", (text, problem["subject"], problem["model"])
    _attach_solution(problem)
    assert problem["solution"].get("answer"), problem["solution"]
    return problem


def test_hrrn_scheduling():
    problem = _solve("进程表：P1 0 7; P2 2 4; P3 4 1，采用高响应比优先，求平均等待时间。")
    assert problem["model"]["os_kind"] == "cpu_schedule"
    assert problem["solution"]["answer_value"] == pytest.approx(3.0)
    assert "高响应比" in problem["solution"]["summary"]


def test_os_basics_user_kernel_and_syscall():
    problem = _solve("说明用户态和内核态的区别，系统调用如何进入内核态。")
    assert problem["model"]["os_kind"] == "os_basics"
    answer = problem["solution"]["answer"]
    assert "用户态" in answer and "内核态" in answer and "系统调用" in answer
    assert "os_result" in problem["model"]


def test_process_state_transition_validation():
    legal = _solve("进程状态转换为 创建→就绪→运行→阻塞→就绪→运行→终止，判断是否合法。")
    assert "合法" in legal["solution"]["answer"]
    illegal = _solve("进程状态转换为 创建→运行→阻塞，判断是否合法。")
    assert "非法" in illegal["solution"]["answer"]


def test_semaphore_pv_trace():
    problem = _solve("信号量S初值为2，依次执行 P(S),P(S),P(S),V(S)，求S的值和等待进程数。")
    assert problem["model"]["os_kind"] == "sync"
    result = problem["model"]["os_result"]
    assert result["stats"]["values"]["S"] == 0
    assert result["stats"]["waiting"]["S"] == 0
    blocked = _solve("信号量S初值为1，依次执行 P(S),P(S),P(S)，求S的值和等待进程数。")
    assert blocked["model"]["os_result"]["stats"]["waiting"]["S"] == 2


def test_deadlock_rag_cycle_detection():
    problem = _solve("资源分配图：P1→R1，R1→P2，P2→R2，R2→P1，判断是否死锁。")
    assert problem["model"]["os_kind"] == "deadlock"
    assert "环路" in problem["solution"]["answer"] and "死锁" in problem["solution"]["answer"]
    safe = _solve("资源分配图：P1→R1，P2→R2，判断是否死锁。")
    assert "无环" in safe["solution"]["answer"] or "没有死锁" in safe["solution"]["answer"]


def test_contiguous_memory_allocation_algorithms():
    first = _solve("空闲区为 100,500,200,300，采用首次适应，请求分配 120，求分配结果。")
    assert "选择 500" in first["solution"]["answer"]
    assert "100、380、200、300" in first["solution"]["answer"]
    best = _solve("空闲区为 100,500,200,300，采用最佳适应，请求分配 120，求分配结果。")
    assert "选择 200" in best["solution"]["answer"]
    worst = _solve("空闲区为 100,500,200,300，采用最坏适应，请求分配 120，求分配结果。")
    assert "选择 500" in worst["solution"]["answer"]


def test_new_os_result_is_embedded_and_attempt_checked():
    problem = _solve("空闲区为 100,500,200,300，采用首次适应，请求分配 120，求分配结果。")
    assert problem["model"]["os_result"]["engine"] == "os_memory_v1"
    evaluation = evaluate_problem(problem["model"], {})
    assert evaluation["status"] == "ok"
    assert solve_problem(problem["model"])["answer"] == problem["solution"]["answer"]


def test_os_unknown_subkind_blocks_honestly():
    problem = build_problem("操作系统：请说明进程和文件系统的关系。")
    assert problem["subject"] == "operating_system"
    assert problem["model"].get("os_kind") is None
    assert problem["status"] == "needs_review"

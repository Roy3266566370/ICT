"""AI 准备入口的 408 概念题支持判断。"""
from __future__ import annotations

from app.labs.goal_actions import classify_goal_action, unsupported_reason
from app.labs.recognize import build_problem


def test_network_concept_can_use_actual_kernel():
    text = "说明ARP、DHCP、ICMP、NAT的作用。"
    problem = build_problem(text)
    assert problem["subject"] == "computer_network"
    assert problem["model"]["net_kind"] == "network_layer"
    assert classify_goal_action(text) == "concept"
    assert unsupported_reason(text, subject=problem["subject"], model=problem["model"]) == ""


def test_os_and_co_concepts_can_use_actual_kernels():
    process = build_problem("说明进程和线程的区别。")
    assert process["model"]["os_kind"] == "process_thread"
    assert unsupported_reason("说明进程和线程的区别。", subject=process["subject"],
                              model=process["model"]) == ""
    cache = build_problem("说明Cache写回和写直达的区别。")
    assert cache["model"]["co_kind"] == "cache"
    assert unsupported_reason("说明Cache写回和写直达的区别。", subject=cache["subject"],
                              model=cache["model"]) == ""


def test_unrecognized_or_non_408_concepts_remain_rejected():
    generic = build_problem("计算机网络有哪些应用？")
    assert generic["model"].get("net_kind") is None
    assert unsupported_reason("计算机网络有哪些应用？", subject=generic["subject"],
                              model=generic["model"])
    algorithm = build_problem("说明快速排序的基本思想。")
    assert unsupported_reason("说明快速排序的基本思想。", subject=algorithm["subject"],
                              model=algorithm["model"])

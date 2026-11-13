"""``bfs_flow`` 内核单元测试（C-BFS@1，T8 验收 5）。

覆盖：黄金夹具逐字段对照、D 只入队一次（already_queued）、有环正常终止、
不可达节点、max_steps 防御上限、规模限制、两种公开调用形态与入参不可变。
"""

from __future__ import annotations

import copy
from typing import Any

import pytest

from app.engines import KernelError, bfs_run


def _load_case(load_golden: Any, case_id: str) -> dict[str, Any]:
    golden = load_golden("bfs_flow")
    assert golden["templateId"] == "bfs_flow"
    for case in golden["cases"]:
        if case["id"] == case_id:
            return case
    raise AssertionError(f"黄金夹具中不存在用例 {case_id}")


def _run_case(case: dict[str, Any]) -> dict[str, Any]:
    data = case["input"]
    # T8 任务书位置形态：(nodes, edges, directed, start, neighbor_order, max_steps)
    return bfs_run(
        data["nodes"],
        data["edges"],
        data["directed"],
        data["start_node_id"],
        "lexicographic_by_id",
        data.get("max_steps", 200),
    )


def test_bfs_golden(load_golden: Any, assert_subset: Any) -> None:
    """R8-AC1/R8-AC2：菱形图访问 A,B,C,D；D 只入队一次并给出跳过理由。"""

    case = _load_case(load_golden, "bfs_golden")
    result = _run_case(case)
    assert_subset(result, case["expected"], "bfs_golden")

    assert result["order"] == ["A", "B", "C", "D"]
    assert result["enqueue_order"] == ["A", "B", "C", "D"]
    assert result["enqueue_order"].count("D") == 1
    assert result["parent"] == {"A": None, "B": "A", "C": "A", "D": "B"}
    assert result["level"] == {"A": 0, "B": 1, "C": 1, "D": 2}
    assert result["rejected_edges"] == [
        {"from": "C", "to": "D", "reason": "D 已在队列中"}
    ]
    assert result["has_cycle"] is False
    assert result["terminated_reason"] == "completed"

    skip_events = [
        step
        for step in result["trace"]
        if step["kind"] == "skip" and step["from"] == "C" and step["node"] == "D"
    ]
    assert len(skip_events) == 1
    assert skip_events[0]["reason"] == "already_queued"


def test_bfs_cycle(load_golden: Any, assert_subset: Any) -> None:
    """R8-AC3：有环图正常终止；has_cycle=true；邻居已访问记 already_visited。"""

    case = _load_case(load_golden, "bfs_cycle")
    result = _run_case(case)
    assert_subset(result, case["expected"], "bfs_cycle")

    assert result["order"] == ["A", "B", "C"]
    assert result["has_cycle"] is True
    assert result["terminated_reason"] == "completed"

    visited_skips = [step for step in result["trace"] if step["kind"] == "skip"]
    assert any(
        step["from"] == "C" and step["node"] == "A" and step["reason"] == "already_visited"
        for step in visited_skips
    )


def test_bfs_unreachable(load_golden: Any, assert_subset: Any) -> None:
    """R8-AC4：不可达节点列入 unvisited，不伪造访问。"""

    case = _load_case(load_golden, "bfs_unreachable")
    result = _run_case(case)
    assert_subset(result, case["expected"], "bfs_unreachable")

    assert result["order"] == ["A", "B"]
    assert result["unvisited"] == ["C"]
    assert "C" not in result["visited"]
    assert "C" not in result["parent"]
    assert "C" not in result["level"]


def test_neighbor_order_lexicographic() -> None:
    """邻居按 id 的 Unicode 码点升序：A→C、A→B 时先 B 后 C。"""

    result = bfs_run(
        [{"id": "A", "label": "A"}, {"id": "B", "label": "B"}, {"id": "C", "label": "C"}],
        [{"from": "A", "to": "C"}, {"from": "A", "to": "B"}],
        True,
        "A",
    )
    assert result["order"] == ["A", "B", "C"]


def test_max_steps_reached() -> None:
    """§2.2.5 规则 4：max_steps 仅作防御上限，命中时标记 max_steps_reached。"""

    result = bfs_run(
        [{"id": "A", "label": "A"}, {"id": "B", "label": "B"}, {"id": "C", "label": "C"}],
        [{"from": "A", "to": "B"}, {"from": "B", "to": "C"}],
        True,
        "A",
        max_steps=1,
    )
    assert result["order"] == ["A"]
    assert result["terminated_reason"] == "max_steps_reached"
    assert result["unvisited"] == ["B", "C"]


def test_node_limit_is_enforced() -> None:
    nodes = [{"id": f"N{index:02d}", "label": str(index)} for index in range(21)]
    with pytest.raises(KernelError) as excinfo:
        bfs_run(nodes, [], True, "N00")
    assert excinfo.value.code == "MISSING_FIELD"
    assert "节点数" in excinfo.value.message


def test_edge_limit_is_enforced() -> None:
    nodes = [{"id": f"N{index:02d}", "label": str(index)} for index in range(20)]
    edges = [{"from": "N00", "to": f"N{index:02d}"} for index in range(1, 20)]
    edges += [{"from": "N01", "to": "N02"} for _ in range(22)]
    assert len(edges) == 41

    with pytest.raises(KernelError) as excinfo:
        bfs_run(nodes, edges, True, "N00")
    assert excinfo.value.code == "MISSING_FIELD"
    assert "边数" in excinfo.value.message


def test_start_node_must_exist() -> None:
    with pytest.raises(KernelError) as excinfo:
        bfs_run([{"id": "A", "label": "A"}], [], True, "Z")
    assert excinfo.value.code == "MISSING_FIELD"
    assert excinfo.value.field == "start_node_id"


def test_unknown_neighbor_order_is_rejected() -> None:
    with pytest.raises(KernelError) as excinfo:
        bfs_run([{"id": "A", "label": "A"}], [], True, "A", "random")
    assert excinfo.value.code == "MISSING_FIELD"
    assert excinfo.value.field == "neighbor_order"


def test_undirected_graph_traverses_reverse_edges() -> None:
    result = bfs_run(
        [{"id": "A", "label": "A"}, {"id": "B", "label": "B"}],
        [{"from": "A", "to": "B"}],
        False,
        "B",
    )
    assert result["order"] == ["B", "A"]
    assert result["has_cycle"] is False


def test_engine_signature_is_supported() -> None:
    """C-ENGINE@1 的位置形态：(nodes, edges, start_node_id, directed, max_steps)。"""

    nodes = [{"id": "A", "label": "A"}, {"id": "B", "label": "B"}]
    edges = [{"from": "A", "to": "B"}]

    task_form = bfs_run(nodes, edges, True, "A", "lexicographic_by_id", 200)
    engine_form = bfs_run(nodes, edges, "A", True, 200)
    assert task_form == engine_form


def test_bfs_inputs_are_not_mutated() -> None:
    """T8 验收 7：nodes / edges 深比较前后相等。"""

    nodes = [{"id": "A", "label": "A"}, {"id": "B", "label": "B"}]
    edges = [{"from": "A", "to": "B"}]
    nodes_before = copy.deepcopy(nodes)
    edges_before = copy.deepcopy(edges)

    bfs_run(nodes, edges, True, "A")
    assert nodes == nodes_before
    assert edges == edges_before
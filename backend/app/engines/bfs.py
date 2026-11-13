# [legacy] 不再参与主链路，保留为 iSpec 表达式求值器的领域扩展参考（见 backend/legacy/README.md）。
"""``bfs_flow`` 确定性内核（C-BFS@1，plan §2.2.5）。

纯函数、无 I/O、不修改入参。返回结构与
``contracts/schemas/template_bfs_flow.schema.json`` 的 ``BfsFlowResult``
逐字一致（snake_case）。

关键规则：

- 起点先入队并标记 ``enqueued``；``visited`` 在出队时标记。
- 邻居按 ``id`` 的 Unicode 码点字典序升序遍历。
- 同一节点只入队一次；重复边记 ``skip/already_queued`` 并写入 ``rejected_edges``。
- 有环图靠 ``visited``/队列判定终止，``max_steps`` 仅作防御上限。
- 不可达节点进入 ``unvisited``，不伪造访问。
"""

from __future__ import annotations

from collections import deque
from collections.abc import Mapping, Sequence
from typing import Any

from .types import KernelError

#: 图规模上限（R8-AC6）。
MAX_NODES = 20
MAX_EDGES = 40

#: 唯一允许的邻居遍历顺序（C-BFS@1）。
NEIGHBOR_ORDER = "lexicographic_by_id"

#: 步数上限（§2.2.5 规则 4）。
MAX_STEPS = 200


def _read_nodes(nodes: object) -> list[str]:
    """校验节点表，返回按输入顺序排列的节点 id 列表。"""

    if not isinstance(nodes, (list, tuple)) or not nodes:
        raise KernelError("MISSING_FIELD", "节点列表不能为空", "nodes")
    if len(nodes) > MAX_NODES:
        raise KernelError(
            "MISSING_FIELD", f"节点数超过上限 {MAX_NODES}", "nodes"
        )

    node_ids: list[str] = []
    for index, node in enumerate(nodes):
        field = f"nodes[{index}]"
        if not isinstance(node, Mapping):
            raise KernelError("MISSING_FIELD", f"{field} 必须是对象", field)
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            raise KernelError("MISSING_FIELD", f"{field}.id 必须是非空字符串", f"{field}.id")
        if node_id in node_ids:
            raise KernelError("MISSING_FIELD", f"节点 id 重复：{node_id}", f"{field}.id")
        node_ids.append(node_id)
    return node_ids


def _read_edges(edges: object, node_ids: list[str]) -> list[tuple[str, str]]:
    """校验边表，返回 ``(from, to)`` 列表。"""

    if not isinstance(edges, (list, tuple)):
        raise KernelError("MISSING_FIELD", "边列表必须是数组", "edges")
    if len(edges) > MAX_EDGES:
        raise KernelError("MISSING_FIELD", f"边数超过上限 {MAX_EDGES}", "edges")

    known = set(node_ids)
    checked: list[tuple[str, str]] = []
    for index, edge in enumerate(edges):
        field = f"edges[{index}]"
        if not isinstance(edge, Mapping):
            raise KernelError("MISSING_FIELD", f"{field} 必须是对象", field)
        source = edge.get("from")
        target = edge.get("to")
        if not isinstance(source, str) or not source:
            raise KernelError("MISSING_FIELD", f"{field}.from 必须是非空字符串", f"{field}.from")
        if not isinstance(target, str) or not target:
            raise KernelError("MISSING_FIELD", f"{field}.to 必须是非空字符串", f"{field}.to")
        if source not in known:
            raise KernelError("MISSING_FIELD", f"{field}.from 指向不存在的节点：{source}", f"{field}.from")
        if target not in known:
            raise KernelError("MISSING_FIELD", f"{field}.to 指向不存在的节点：{target}", f"{field}.to")
        checked.append((source, target))
    return checked


def _build_adjacency(
    node_ids: Sequence[str], edges: Sequence[tuple[str, str]], directed: bool
) -> dict[str, list[str]]:
    """构建邻接表；邻居按 id 的 Unicode 码点升序排序（R8-AC1）。"""

    adjacency: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    for source, target in edges:
        adjacency[source].append(target)
        if not directed:
            adjacency[target].append(source)
    for node_id in adjacency:
        adjacency[node_id].sort()
    return adjacency


def _has_cycle(adjacency: Mapping[str, Sequence[str]], directed: bool) -> bool:
    """检测环：有向图用三色 DFS，无向图用父节点回溯。

    仅用于展示提示，不阻止执行（R8-AC3、R8-AC7）。
    """

    if directed:
        white, gray, black = 0, 1, 2
        colors: dict[str, int] = {node_id: white for node_id in adjacency}

        def visit(node_id: str) -> bool:
            colors[node_id] = gray
            for neighbor in adjacency[node_id]:
                if colors[neighbor] == gray:
                    return True
                if colors[neighbor] == white and visit(neighbor):
                    return True
            colors[node_id] = black
            return False

        return any(colors[node_id] == white and visit(node_id) for node_id in adjacency)

    visited: set[str] = set()

    def visit_undirected(node_id: str, parent: str | None) -> bool:
        visited.add(node_id)
        for neighbor in adjacency[node_id]:
            if neighbor == parent:
                continue
            if neighbor in visited or visit_undirected(neighbor, node_id):
                return True
        return False

    return any(node_id not in visited and visit_undirected(node_id, None) for node_id in adjacency)


def _normalize_arguments(
    directed: object,
    start: object,
    start_node_id: object,
) -> tuple[bool, str]:
    """兼容两种公开调用形式并返回 ``(directed, start)``。

    1. §2.2.9 C-ENGINE@1：``bfs_run(nodes, edges, start_node_id, directed=True, ...)``
       第三个位置参数是起点字符串。
    2. T8 任务书：``bfs_run(nodes, edges, directed, start, neighbor_order, max_steps)``
       第三个位置参数是布尔值；本函数在检测到 ``(bool, str)`` 组合时交换两位。
    """

    if isinstance(start, bool) and isinstance(directed, str):
        directed, start = start, directed

    if not isinstance(directed, bool):
        raise KernelError("MISSING_FIELD", "directed 必须是布尔值", "directed")

    if start is None and isinstance(start_node_id, str) and start_node_id:
        start = start_node_id
    elif isinstance(start_node_id, str) and start_node_id and start not in (None, start_node_id):
        raise KernelError(
            "MISSING_FIELD", "start 与 start_node_id 不一致", "start_node_id"
        )

    if not isinstance(start, str) or not start:
        raise KernelError("MISSING_FIELD", "缺少起点 start_node_id", "start_node_id")
    return directed, start


def _read_max_steps(raw: object) -> int:
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise KernelError("MISSING_FIELD", "max_steps 必须是整数", "max_steps")
    if not 1 <= raw <= MAX_STEPS:
        raise KernelError(
            "MISSING_FIELD", f"max_steps 必须在 1 到 {MAX_STEPS} 之间", "max_steps"
        )
    return raw


def bfs_run(
    nodes: Sequence[Mapping[str, Any]],
    edges: Sequence[Mapping[str, Any]],
    directed: bool = True,
    start: str | None = None,
    neighbor_order: str = NEIGHBOR_ORDER,
    max_steps: int = MAX_STEPS,
    *,
    start_node_id: str | None = None,
) -> dict[str, Any]:
    """广度优先遍历，返回 ``BfsFlowResult`` 的 dict 形式。

    示例（R8-AC1/R8-AC2）::

        >>> bfs_run([{"id": "A", "label": "A"}, {"id": "B", "label": "B"}],
        ...         [{"from": "A", "to": "B"}], True, "A")["order"]
        ['A', 'B']
    """

    directed_flag, start_id = _normalize_arguments(directed, start, start_node_id)

    # 兼容 C-ENGINE@1 的第 5 个位置参数（max_steps）：该签名没有 neighbor_order。
    if isinstance(neighbor_order, int) and not isinstance(neighbor_order, bool) and max_steps == MAX_STEPS:
        neighbor_order, max_steps = NEIGHBOR_ORDER, neighbor_order

    steps_limit = _read_max_steps(max_steps)

    if neighbor_order != NEIGHBOR_ORDER:
        raise KernelError(
            "MISSING_FIELD",
            f"neighbor_order 只支持 {NEIGHBOR_ORDER}",
            "neighbor_order",
        )

    node_ids = _read_nodes(nodes)
    if start_id not in node_ids:
        raise KernelError(
            "MISSING_FIELD", f"起点不存在于节点表中：{start_id}", "start_node_id"
        )
    edge_list = _read_edges(edges, node_ids)
    adjacency = _build_adjacency(node_ids, edge_list, directed_flag)

    order: list[str] = []
    enqueue_order: list[str] = [start_id]
    visited: set[str] = set()
    parent: dict[str, str | None] = {start_id: None}
    level: dict[str, int] = {start_id: 0}
    spanning_edges: list[dict[str, str]] = []
    rejected_edges: list[dict[str, str]] = []
    trace: list[dict[str, Any]] = []

    queue: deque[str] = deque([start_id])
    in_queue: set[str] = {start_id}
    terminated_reason = "completed"
    step_index = 0
    dequeued = 0

    while queue:
        if dequeued >= steps_limit:
            terminated_reason = "max_steps_reached"
            break

        node_id = queue.popleft()
        in_queue.discard(node_id)
        visited.add(node_id)
        order.append(node_id)
        dequeued += 1

        trace.append(
            {
                "index": step_index,
                "kind": "dequeue",
                "node": node_id,
                "queue_after": list(queue),
                "visited_after": list(order),
            }
        )
        step_index += 1

        for neighbor in adjacency[node_id]:
            if neighbor in visited:
                reason_text = f"{neighbor} 已访问"
                rejected_edges.append({"from": node_id, "to": neighbor, "reason": reason_text})
                trace.append(
                    {
                        "index": step_index,
                        "kind": "skip",
                        "node": neighbor,
                        "from": node_id,
                        "reason": "already_visited",
                    }
                )
            elif neighbor in in_queue:
                reason_text = f"{neighbor} 已在队列中"
                rejected_edges.append({"from": node_id, "to": neighbor, "reason": reason_text})
                trace.append(
                    {
                        "index": step_index,
                        "kind": "skip",
                        "node": neighbor,
                        "from": node_id,
                        "reason": "already_queued",
                    }
                )
            else:
                in_queue.add(neighbor)
                queue.append(neighbor)
                enqueue_order.append(neighbor)
                parent[neighbor] = node_id
                level[neighbor] = level[node_id] + 1
                spanning_edges.append({"from": node_id, "to": neighbor})
                trace.append(
                    {
                        "index": step_index,
                        "kind": "enqueue",
                        "node": neighbor,
                        "from": node_id,
                        "queue_after": list(queue),
                    }
                )
            step_index += 1

    unvisited = [node_id for node_id in node_ids if node_id not in visited]
    return {
        "order": order,
        "enqueue_order": enqueue_order,
        "visited": list(order),
        "unvisited": unvisited,
        "parent": parent,
        "level": level,
        "edges_of_spanning_tree": spanning_edges,
        "rejected_edges": rejected_edges,
        "trace": trace,
        "terminated_reason": terminated_reason,
        "has_cycle": _has_cycle(adjacency, directed_flag),
    }

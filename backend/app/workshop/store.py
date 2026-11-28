"""工坊作品的装配、列表摘要、发布快照与 ID。"""

from __future__ import annotations

import secrets
from typing import Any, Mapping

from ..schemas.common import to_iso, utc_now


def new_work_id() -> str:
    return f"wk_{secrets.token_hex(12)}"


def new_share_id() -> str:
    return secrets.token_urlsafe(12)


def new_blueprint_id() -> str:
    return f"bp_{secrets.token_hex(10)}"


def summary(row: Any) -> dict[str, Any]:
    """列表卡片所需的最小信息（不加载 document）。"""

    return {
        "work_id": row.id,
        "title": row.title,
        "node_count": row.node_count,
        "revision": row.revision,
        "forked_from_share": row.forked_from_share,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def share_summary(row: Any) -> dict[str, Any]:
    return {
        "share_id": row.share_id,
        "title": row.title,
        "node_count": row.node_count,
        "forks": row.forks,
        "published_at": row.created_at,
    }


def snapshot(work: Any, *, share_id: str) -> dict[str, Any]:
    """发布快照：冻结 document，附元数据；不含会话与内部字段。"""

    import copy

    doc = copy.deepcopy(work.document or {})
    return {
        "share_id": share_id,
        "work_id": work.id,
        "title": work.title,
        "published_at": to_iso(utc_now()),
        "document": doc,
    }


# ---------------------------------------------------------------------------
# 广场封面拓扑摘要：把画布节点/连线压缩成 < 1KB 的轻量缩略图数据
# ---------------------------------------------------------------------------

MAX_TOPOLOGY_NODES = 18
MAX_TOPOLOGY_WIRES = 24

# 归一化视窗：x ∈ [8, 92]，y ∈ [14, 86]（百分比坐标，四周留白）
_TOPO_X_RANGE = (8.0, 92.0)
_TOPO_Y_RANGE = (14.0, 86.0)

_TYPE_LABELS = {
    "slider": "滑杆",
    "ticker": "时钟",
    "matrixSource": "矩阵源",
    "textNote": "便签",
    "latexNote": "公式",
    "physicsStage": "物理",
    "lab408Stage": "408",
    "calculusStage": "高数",
    "businessStage": "决策",
    "aiRuleBlock": "AI 规则",
    "universalStageView": "舞台",
    "composite": "复合积木",
    "functionSource": "函数源",
    "transformView": "变换视图",
    "trailView": "轨迹仪",
    "energyMeter": "能量表",
    "spark": "记录仪",
    "quiz": "预测闸门",
}


def _topology_kind(node_type: str) -> str:
    """把开放节点类型归并为封面渲染的四类色标。"""

    if node_type in ("textNote", "latexNote"):
        return "note"
    if node_type in ("slider", "ticker", "delayRegister") or node_type.endswith("Source"):
        return "control"
    if node_type.endswith(("View", "Meter", "Gauge", "Plot", "Read")) or node_type in ("spark", "quiz"):
        return "plot"
    return "stage"


def _topology_label(node: Mapping[str, Any]) -> str:
    text = node.get("text")
    if isinstance(text, str) and text.strip():
        return text.strip()[:10]
    node_type = str(node.get("type") or "")
    if node_type in _TYPE_LABELS:
        return _TYPE_LABELS[node_type]
    payload = node.get("payload")
    if isinstance(payload, str) and "/" in payload:
        head = payload.split("/", 1)[0].strip()
        if head and len(head) <= 14 and not head.startswith("{"):
            return head[:10]
    return node_type[:10] or "节点"


def extract_canvas_topology(document: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """提取画布轻量拓扑：归一化坐标 + 类型色标 + 微标签，供广场封面渲染。

    最多保留前 ``MAX_TOPOLOGY_NODES`` 个节点与 ``MAX_TOPOLOGY_WIRES`` 条连线；
    连线以节点下标引用（``{"f": 0, "t": 2}``），总量控制在 1KB 以内。
    画布为空时返回 ``None``，由前端回退到骨架图。
    """

    if not isinstance(document, Mapping):
        return None
    raw_nodes = document.get("nodes")
    if not isinstance(raw_nodes, list) or not raw_nodes:
        return None
    nodes = [n for n in raw_nodes if isinstance(n, Mapping)][:MAX_TOPOLOGY_NODES]
    if not nodes:
        return None

    xs = [float(n.get("x") or 0) for n in nodes]
    ys = [float(n.get("y") or 0) for n in nodes]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max(max_x - min_x, 1e-6)
    span_y = max(max_y - min_y, 1e-6)
    # 单节点或零跨度时居中，避免除零压缩到边缘。
    cx, cy = sum(_TOPO_X_RANGE) / 2, sum(_TOPO_Y_RANGE) / 2

    def nx(value: float) -> float:
        if max_x - min_x < 1e-6:
            return cx
        return round(_TOPO_X_RANGE[0] + (value - min_x) / span_x * (_TOPO_X_RANGE[1] - _TOPO_X_RANGE[0]), 1)

    def ny(value: float) -> float:
        if max_y - min_y < 1e-6:
            return cy
        return round(_TOPO_Y_RANGE[0] + (value - min_y) / span_y * (_TOPO_Y_RANGE[1] - _TOPO_Y_RANGE[0]), 1)

    index: dict[str, int] = {}
    topo_nodes: list[dict[str, Any]] = []
    for position, node in enumerate(nodes):
        node_id = str(node.get("id") or "")
        if node_id:
            index[node_id] = position
        topo_nodes.append({
            "x": nx(float(node.get("x") or 0)),
            "y": ny(float(node.get("y") or 0)),
            "kind": _topology_kind(str(node.get("type") or "")),
            "label": _topology_label(node),
        })

    topo_wires: list[dict[str, int]] = []
    raw_wires = document.get("wires")
    if isinstance(raw_wires, list):
        for wire in raw_wires:
            if len(topo_wires) >= MAX_TOPOLOGY_WIRES:
                break
            if not isinstance(wire, Mapping):
                continue
            src, dst = index.get(str(wire.get("from") or "")), index.get(str(wire.get("to") or ""))
            if src is None or dst is None or src == dst:
                continue
            topo_wires.append({"f": src, "t": dst})

    return {"nodes": topo_nodes, "wires": topo_wires}


def workshop_cover_meta(document: Any) -> dict[str, Any]:
    """定象坊作品上架封面的公共元数据：连线数 + 轻量拓扑缩略图。"""

    wires = document.get("wires") if isinstance(document, Mapping) else None
    cover: dict[str, Any] = {"wire_count": len(wires) if isinstance(wires, list) else 0}
    topology = extract_canvas_topology(document)
    if topology:
        cover["topology"] = topology
    return cover


__all__ = [
    "extract_canvas_topology", "new_blueprint_id", "new_share_id", "new_work_id",
    "share_summary", "snapshot", "summary", "workshop_cover_meta",
]

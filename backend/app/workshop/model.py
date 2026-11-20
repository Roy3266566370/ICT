"""工坊作品 ``CanvasDoc`` 结构校验（与前端 ``canvas/types.ts`` 逐字对应）。

只校验结构与上限，不校验节点类型名——前端 NODE_DEFS 是开放注册表，
旧版本遇到未知节点类型会自行过滤，后端不替它做白名单。
"""

from __future__ import annotations

import re
from typing import Any, Mapping

MAX_NODES = 300
MAX_WIRES = 600
MAX_STROKES = 400
MAX_STROKE_POINTS = 4000
MAX_TITLE = 120
MAX_TEXT = 8000
MAX_PAYLOAD = 32768
MAX_PAYLOAD_TOTAL = 131072
MAX_PANEL_PARAMS = 20
MAX_PANEL_VIEWS = 60
_ID_RE = re.compile(r"^[\w\-]{1,48}$")


def _num(value: Any, lo: float = -1e6, hi: float = 1e6) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and lo <= float(value) <= hi:
        return float(value)
    return None


_PORT_KINDS = {"matrix2", "scalar", "body", "function"}


def _wires(raw_list: Any, id_set: set[str]) -> list[dict[str, Any]]:
    wires: list[dict[str, Any]] = []
    if not isinstance(raw_list, list):
        return wires
    for item in raw_list:
        if not isinstance(item, Mapping):
            continue
        frm, to = str(item.get("from") or ""), str(item.get("to") or "")
        if frm not in id_set or to not in id_set:
            continue  # 悬线直接丢，不算错误
        wires.append({
            "id": str(item.get("id") or "")[:48] or f"w{len(wires)}",
            "from": frm,
            "to": to,
            **({"fromPort": str(item["fromPort"])[:24]} if isinstance(item.get("fromPort"), str) else {}),
            **({"toPort": str(item["toPort"])[:24]} if isinstance(item.get("toPort"), str) else {}),
        })
    return wires


def _nodes(raw_list: Any, *, depth: int) -> list[dict[str, Any]]:
    if not isinstance(raw_list, list) or len(raw_list) > MAX_NODES:
        raise ValueError(f"节点超过上限 {MAX_NODES}")
    nodes = [_node(item, depth=depth) for item in raw_list]
    ids = [n["id"] for n in nodes]
    if len(set(ids)) != len(ids):
        raise ValueError("节点 id 重复")
    if sum(len(n.get("payload") or "") for n in nodes) > MAX_PAYLOAD_TOTAL:
        raise ValueError(f"节点 payload 总量超过上限 {MAX_PAYLOAD_TOTAL}")
    return nodes


def _node(raw: Any, *, depth: int) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise ValueError("节点必须是对象")
    node_id = str(raw.get("id") or "")
    node_type = str(raw.get("type") or "")
    if not _ID_RE.match(node_id) or not node_type:
        raise ValueError("节点缺 id/type")
    x = _num(raw.get("x"), -1e4, 1e4)
    y = _num(raw.get("y"), -1e4, 1e4)
    if x is None or y is None:
        raise ValueError("节点坐标非法")
    params = raw.get("params")
    node: dict[str, Any] = {
        "id": node_id,
        "type": node_type[:40],
        "x": x,
        "y": y,
        "params": dict(params) if isinstance(params, Mapping) else {},
    }
    text = raw.get("text")
    if isinstance(text, str):
        node["text"] = text[:MAX_TEXT]
    # ``payload`` 承载自包含仿真节点的数据载荷（AI 交互程序的 JSON 等），
    # 与 text 分离：text 是用户便签，payload 是物化产物，不参与连线求值。
    payload = raw.get("payload")
    if isinstance(payload, str) and payload:
        node["payload"] = payload[:MAX_PAYLOAD]

    # composite 自制积木：递归校验子图（限深防恶意嵌套）
    sub = raw.get("sub")
    if sub is not None and depth < 3 and isinstance(sub, Mapping):
        inner = _nodes(sub.get("nodes"), depth=depth + 1)
        inner_ids = {n["id"] for n in inner}
        ports: list[dict[str, Any]] = []
        for p in (sub.get("ports") or [])[:60]:
            if not isinstance(p, Mapping):
                continue
            pid, pdir = str(p.get("id") or ""), p.get("dir")
            if pid not in inner_ids or pdir not in ("in", "out"):
                continue
            ports.append({
                "id": pid,
                "dir": pdir,
                "label": str(p.get("label") or "")[:48],
                **({"kind": p["kind"]} if p.get("kind") in _PORT_KINDS else {}),
            })
        node["sub"] = {
            "nodes": inner,
            "wires": _wires(sub.get("wires"), inner_ids),
            "ports": ports,
        }
    return node


def _panel(raw: Any) -> dict[str, Any]:
    """``panel`` 仪器面板契约：嵌入活页时以精简模式呈现。

    ``view_node_ids`` 是主观察节点集合；``exposed_params`` 把内部节点的
    参数外露为面板控件（``{node_id, param_key, label?, min?, max?, step?}``）。
    引用缺失节点由前端降级为警告（宁可漏不锁死），校验层只保证形态。
    """
    if not isinstance(raw, Mapping):
        raise ValueError("panel 必须是对象")
    out: dict[str, Any] = {}
    title = raw.get("title")
    if isinstance(title, str) and title.strip():
        out["title"] = title.strip()[:MAX_TITLE]
    exposed: list[dict[str, Any]] = []
    for item in (raw.get("exposed_params") or [])[:MAX_PANEL_PARAMS]:
        if not isinstance(item, Mapping):
            continue
        node_id = str(item.get("node_id") or "")[:48]
        param_key = str(item.get("param_key") or "")[:48]
        if not node_id or not param_key:
            continue
        entry: dict[str, Any] = {
            "node_id": node_id,
            "param_key": param_key,
            "label": str(item.get("label") or "")[:48],
        }
        for key in ("min", "max", "step"):
            bound = _num(item.get(key), -1e6, 1e6)
            if bound is not None:
                entry[key] = bound
        if entry.get("min") is not None and entry.get("max") is not None and not entry["min"] < entry["max"]:
            continue  # 非法范围的外露参数直接丢弃
        exposed.append(entry)
    out["exposed_params"] = exposed
    view = raw.get("view_node_ids")
    out["view_node_ids"] = (
        [str(v)[:48] for v in view[:MAX_PANEL_VIEWS] if isinstance(v, str) and v.strip()]
        if isinstance(view, list) else []
    )
    if raw.get("read_only_layout"):
        out["read_only_layout"] = True
    return out


def validate_canvas_doc(raw: Any) -> dict[str, Any]:
    """校验并规范化画布文档；非法输入抛 ``ValueError``。"""

    if not isinstance(raw, Mapping):
        raise ValueError("文档必须是对象")
    nodes_raw = raw.get("nodes")
    wires_raw = raw.get("wires")
    if not isinstance(nodes_raw, list) or not isinstance(wires_raw, list):
        raise ValueError("文档缺 nodes/wires")
    if len(nodes_raw) > MAX_NODES:
        raise ValueError(f"节点超过上限 {MAX_NODES}")
    if len(wires_raw) > MAX_WIRES:
        raise ValueError(f"连线超过上限 {MAX_WIRES}")

    nodes = _nodes(nodes_raw, depth=0)
    id_set = {n["id"] for n in nodes}
    wires = _wires(wires_raw, id_set)

    strokes: list[dict[str, Any]] = []
    for item in (raw.get("strokes") or [])[:MAX_STROKES]:
        if not isinstance(item, Mapping):
            continue
        pts = item.get("points")
        if not isinstance(pts, list) or len(pts) < 2 or len(pts) > MAX_STROKE_POINTS:
            continue
        points: list[list[float]] = []
        for p in pts:
            if isinstance(p, (list, tuple)) and len(p) == 2:
                px, py = _num(p[0], -1e4, 1e4), _num(p[1], -1e4, 1e4)
                if px is not None and py is not None:
                    points.append([px, py])
        if len(points) < 2:
            continue
        strokes.append({
            "id": str(item.get("id") or "")[:48] or f"s{len(strokes)}",
            "color": str(item.get("color") or "#2F3A49")[:24],
            "width": max(0.5, min(30.0, _num(item.get("width"), 0.5, 30) or 2.4)),
            "points": points,
        })

    zoom = _num(raw.get("zoom"), 0.2, 3.0)
    doc: dict[str, Any] = {
        "version": 1,
        "title": str(raw.get("title") or "")[:MAX_TITLE],
        "nodes": nodes,
        "wires": wires,
        "strokes": strokes,
        "zoom": zoom if zoom is not None else 1.0,
    }
    if raw.get("panel") is not None:
        doc["panel"] = _panel(raw.get("panel"))
    return doc


__all__ = ["validate_canvas_doc"]

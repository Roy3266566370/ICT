"""流程图（diagram）数据契约与转译工具。

契约与视觉模型输出共用同一形状::

    {
      "version": 1,
      "nodes": [{"id", "label", "x", "y", "shape"}],   # x/y 为 0..1 归一化中心
      "edges": [{"from", "to", "label"}],
      "order": [node_id, ...],
      "confidence": 0..1,
      "warnings": [str, ...],
    }

来源两条：PPTX 组合形状 + 连接线的确定性转译（``diagram_from_shapes``），
以及视觉模型 JSON 的严格校验（``diagram_from_vision``，含 OCR 证据匹配与
低置信度降级）。两者都收敛到同一份可校验结构，供 ``diagram`` 块与
``region.diagram`` 使用。
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Any, Mapping, Sequence

DIAGRAM_MAX_NODES = 40
DIAGRAM_MAX_EDGES = 60
DIAGRAM_MAX_LABEL = 60
DIAGRAM_MAX_WARNINGS = 8
DIAGRAM_VERSION = 1
DIAGRAM_PROMPT_VERSION = "v1"

SHAPES = {"rect", "rounded", "diamond", "oval", "text"}

_EDGE_ENDPOINT_RADIUS = 0.16
_EVIDENCE_MIN_RATIO = 0.34


def _clamp_num(value: Any, low: float = 0.0, high: float = 1.0, default: float = 0.5) -> float:
    try:
        num = float(value)
    except (TypeError, ValueError, OverflowError):
        return default
    return max(low, min(high, num)) if math.isfinite(num) else default


def _text(value: Any, limit: int) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit]


def validate_diagram(raw: Any) -> dict[str, Any]:
    """规范化并校验图结构；非法输入抛 ``ValueError``。"""
    if not isinstance(raw, Mapping):
        raise ValueError("diagram 必须是对象")
    raw_nodes = raw.get("nodes")
    if not isinstance(raw_nodes, list) or not raw_nodes:
        raise ValueError("diagram 缺少 nodes")
    if len(raw_nodes) > DIAGRAM_MAX_NODES:
        raise ValueError(f"diagram 节点数超过上限 {DIAGRAM_MAX_NODES}")

    nodes: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, item in enumerate(raw_nodes):
        if not isinstance(item, Mapping):
            raise ValueError("diagram 节点必须是对象")
        node_id = _text(item.get("id"), 40) or f"n{index + 1}"
        if node_id in seen:
            raise ValueError(f"diagram 节点 id 重复：{node_id}")
        seen.add(node_id)
        shape = str(item.get("shape") or "rect").strip().lower()
        nodes.append({
            "id": node_id,
            "label": _text(item.get("label"), DIAGRAM_MAX_LABEL),
            "x": round(_clamp_num(item.get("x")), 4),
            "y": round(_clamp_num(item.get("y")), 4),
            "shape": shape if shape in SHAPES else "rect",
        })

    raw_edges = raw.get("edges") or []
    if not isinstance(raw_edges, list) or len(raw_edges) > DIAGRAM_MAX_EDGES:
        raise ValueError(f"diagram 边必须是数组且不超过 {DIAGRAM_MAX_EDGES} 条")
    edges: list[dict[str, Any]] = []
    for item in raw_edges:
        if not isinstance(item, Mapping):
            continue
        source = _text(item.get("from"), 40)
        target = _text(item.get("to"), 40)
        if source not in seen or target not in seen or source == target:
            continue  # 悬空/自环边剔除而非整体拒绝
        edges.append({"from": source, "to": target,
                      "label": _text(item.get("label"), DIAGRAM_MAX_LABEL)})

    raw_order = raw.get("order")
    order: list[str] = []
    if isinstance(raw_order, list):
        for value in raw_order:
            node_id = _text(value, 40)
            if node_id in seen and node_id not in order:
                order.append(node_id)
    if not order:
        order = [node["id"] for node in sorted(nodes, key=lambda n: (n["y"], n["x"]))]

    raw_warnings = raw.get("warnings", [])
    if not isinstance(raw_warnings, list):
        raise ValueError("diagram warnings must be an array")
    warnings = [
        _text(warning, 120)
        for warning in raw_warnings[:DIAGRAM_MAX_WARNINGS]
        if _text(warning, 120)
    ]
    confidence = _clamp_num(raw.get("confidence"), 0.0, 1.0, 0.5)

    out: dict[str, Any] = {
        "version": DIAGRAM_VERSION,
        "nodes": nodes,
        "edges": edges,
        "order": order,
        "confidence": round(confidence, 3),
        "warnings": warnings,
    }
    original = raw.get("original_positions")
    if isinstance(original, Mapping):
        out["original_positions"] = {
            node_id: {"x": _clamp_num(pos.get("x")), "y": _clamp_num(pos.get("y"))}
            for node_id, pos in original.items() if node_id in seen and isinstance(pos, Mapping)
        }
    cache_key = _text(raw.get("cache_key"), 80)
    if cache_key:
        out["cache_key"] = cache_key
    return out


def merge_diagram_progress(previous: Any, value: Mapping[str, Any],
                           diagram: Any) -> dict[str, Any] | None:
    total = len(diagram.get("nodes", [])) if isinstance(diagram, Mapping) else 0
    step = value.get("step")
    if type(step) is not int or not 1 <= step <= total or value.get("total") != total:
        return None
    previous = previous if isinstance(previous, Mapping) else {}
    peak = min(total, max(step, previous.get("step", 0)))
    return {"step": peak, "total": total, "completed": peak == total}


def _norm_token(text: str) -> str:
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", text.lower())


def diagram_from_vision(payload: Any, evidence: Sequence[str]) -> dict[str, Any]:
    """视觉输出 → 校验过的 diagram。

    额外做 OCR 证据匹配：节点文字应大多能在 ``evidence``（区域 OCR 标签 /
    文本 / 图注）里找到。证据缺失比例过高时加警告并下调置信度——
    低置信度结果由调用方决定是否丢弃，这里只负责标注。
    """
    diagram = validate_diagram(payload)
    tokens = [token for text in evidence if (token := _norm_token(text))]
    matched = 0
    for node in diagram["nodes"]:
        label = _norm_token(node["label"])
        if not label:
            continue
        if any(label in token or token in label for token in tokens):
            matched += 1
    total = sum(1 for node in diagram["nodes"] if _norm_token(node["label"]))
    if total:
        ratio = matched / total
        if ratio < _EVIDENCE_MIN_RATIO:
            diagram["warnings"].append(
                f"仅 {matched}/{total} 个节点文字与 OCR 证据一致，请核对裁剪内容"
            )
            diagram["confidence"] = round(min(diagram["confidence"], 0.35), 3)
        elif ratio < 0.6:
            diagram["warnings"].append(
                f"部分节点文字（{matched}/{total}）未在 OCR 证据中出现"
            )
            diagram["confidence"] = round(min(diagram["confidence"], 0.65), 3)
    return diagram


def cache_key(png_bytes: bytes, *, prompt_version: str = DIAGRAM_PROMPT_VERSION,
              model: str = "", evidence: Sequence[str] = ()) -> str:
    digest = hashlib.sha256()
    digest.update(png_bytes)
    digest.update(json.dumps([prompt_version, model, list(evidence)], ensure_ascii=False).encode())
    return digest.hexdigest()[:32]


def diagram_prompt(evidence: Sequence[str]) -> str:
    hints = "、".join(_text(text, 60) for text in evidence if str(text or "").strip())[:600]
    return (
        "把这张流程图/示意图转译成可编辑的节点-边结构，只返回 JSON，不要解释。\n"
        '输出契约：{"nodes":[{"id","label","x","y","shape"}],'
        '"edges":[{"from","to","label"}],"order":[],"confidence":0,"warnings":[]}\n'
        "规则：x/y 是节点中心在图中的 0..1 归一化坐标；"
        "shape 只能取 rect|rounded|diamond|oval|text（判断/分支用 diamond，起止用 oval）；"
        f"nodes ≤ {DIAGRAM_MAX_NODES}，edges ≤ {DIAGRAM_MAX_EDGES}，label ≤ 40 字；"
        "edges 的 from/to 必须引用 nodes 中的 id；order 按流程先后顺序；"
        "confidence 是 0..1 自评置信度；看不清的部分写入 warnings，不要编造。\n"
        f"图中可辨识的文字证据：{hints or '（无 OCR 证据，请以图像为准）'}"
    )


def diagram_from_shapes(items: Sequence[Mapping[str, Any]],
                        connectors: Sequence[Mapping[str, Any]]) -> dict[str, Any] | None:
    """PPTX 确定性转译：区域内带文字的形状 → 节点；连接线 → 边。

    ``items`` 形状以 ``box``（相对区域 0..1）与 ``text`` 描述；
    ``connectors`` 每条给出归一化 ``begin``/``end`` 点，以及可选的
    ``begin_id``/``end_id``（精确连接点形状 id → ``items`` 的 ``entry_id``）。
    至少 2 节点 + 1 边才产出图。
    """
    nodes: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        text = _text(item.get("text"), DIAGRAM_MAX_LABEL)
        box = item.get("box")
        if not text or not isinstance(box, Sequence) or len(box) != 4:
            continue
        cx = (float(box[0]) + float(box[2])) / 2
        cy = (float(box[1]) + float(box[3])) / 2
        shape = str(item.get("shape_kind") or "rect")
        nodes.append({
            "id": f"n{len(nodes) + 1}",
            "label": text,
            "x": round(cx, 4), "y": round(cy, 4),
            "shape": shape if shape in SHAPES else "rect",
            "_entry_id": item.get("entry_id"),
        })
    if len(nodes) < 2:
        return None
    by_entry = {node["_entry_id"]: node["id"] for node in nodes if node.get("_entry_id")}

    def nearest(point: Sequence[float] | None) -> str | None:
        if not isinstance(point, Sequence) or len(point) != 2:
            return None
        best: tuple[float, str] | None = None
        for node in nodes:
            dist = (float(point[0]) - node["x"]) ** 2 + (float(point[1]) - node["y"]) ** 2
            if best is None or dist < best[0]:
                best = (dist, node["id"])
        if best is not None and best[0] <= _EDGE_ENDPOINT_RADIUS ** 2:
            return best[1]
        return None

    edges: list[dict[str, Any]] = []
    seen_pairs: set[tuple[str, str]] = set()
    for connector in connectors:
        source = by_entry.get(connector.get("begin_id")) or nearest(connector.get("begin"))
        target = by_entry.get(connector.get("end_id")) or nearest(connector.get("end"))
        if not source or not target or source == target:
            continue
        if (source, target) in seen_pairs:
            continue
        seen_pairs.add((source, target))
        edges.append({"from": source, "to": target, "label": ""})
    if not edges:
        return None

    for node in nodes:
        node.pop("_entry_id", None)
    return validate_diagram({
        "nodes": nodes, "edges": edges, "confidence": 0.85,
        "warnings": [], "cache_key": "pptx_shapes",
    })


__all__ = [
    "DIAGRAM_MAX_EDGES", "DIAGRAM_MAX_LABEL", "DIAGRAM_MAX_NODES",
    "DIAGRAM_PROMPT_VERSION", "DIAGRAM_VERSION", "SHAPES",
    "cache_key", "diagram_from_shapes", "diagram_from_vision",
    "diagram_prompt", "validate_diagram",
]

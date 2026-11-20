"""``canvas_object`` 建议 → 真实 ``CanvasDoc``（v1）的模板注册表。

AI 与启发式建议只携带模板名和载荷；物化在这里落成标准画布文档——
真实、可编辑、可克隆的节点，而不是黑盒 ``template`` 标记。
前端按节点类型渲染（``attentionSim``/``pageLabSim`` 等自包含节点），
不再有针对建议的 if-else 特判。
"""

from __future__ import annotations

import json
from typing import Any, Mapping


def attention_doc() -> dict[str, Any]:
    """注意力教学实验 → ``attentionSim`` 自包含节点。"""
    return {
        "version": 1,
        "title": "注意力实验",
        "nodes": [{
            "id": "attn_sim",
            "type": "attentionSim",
            "x": 80.0,
            "y": 60.0,
            "params": {"query": 1.0, "temperature": 1.0, "causal": 0.0},
        }],
        "wires": [],
        "strokes": [],
        "zoom": 1.0,
    }


def page_lab_doc(proposal: Mapping[str, Any]) -> dict[str, Any]:
    """AI 设计的 page_lab 模型 → ``pageLabSim`` 自包含节点。

    模型载荷（程序、参数元数据、标题等）放进 ``node.payload`` JSON；
    可调参数的当前值落在 ``node.params`` ——因此 ``node_id.param_key``
    坐标可以直接被页面级 ``bindings`` 驱动，AI 交互第一次接入活变量。
    """
    raw_lab = proposal.get("lab")
    if not isinstance(raw_lab, Mapping):
        raise ValueError("AI 交互建议缺少模型载荷")
    from ..ppt_ai.page_lab import validate_lab

    lab = validate_lab(raw_lab, probe=False)
    payload = {
        "kind": "page_lab",
        "title": lab["title"],
        "summary": lab["summary"],
        "explain": lab["explain"],
        "params": lab["params"],
        "program": lab["program"],
        "anchor_id": str(proposal.get("anchor_id") or "")[:40],
        "input_hash": str(proposal.get("input_hash") or "")[:100],
        "instruction": str(proposal.get("instruction") or "")[:1000],
    }
    return {
        "version": 1,
        "title": str(lab["title"] or "AI 交互实验")[:120],
        "nodes": [{
            "id": "sim1",
            "type": "pageLabSim",
            "x": 80.0,
            "y": 60.0,
            "params": {str(p["id"])[:48]: float(p["default"]) for p in lab["params"]},
            "payload": json.dumps(payload, ensure_ascii=False),
        }],
        "wires": [],
        "strokes": [],
        "zoom": 1.0,
    }


def build_canvas_doc(template: str, proposal: Mapping[str, Any]) -> dict[str, Any]:
    """按模板名物化画布文档；未知模板抛 ``ValueError``（不静默生成假块）。"""
    if template == "attention":
        return attention_doc()
    if template == "page_lab":
        return page_lab_doc(proposal)
    raise ValueError(f"未知的活对象模板：{template or '(空)'}")


__all__ = ["build_canvas_doc"]

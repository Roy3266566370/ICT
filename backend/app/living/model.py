"""活页 ``page.1`` 文档模型：块联合校验、建议物化、文档装配。

块是判别联合（与前端 ``living/types.ts`` 镜像一致）：

- 保真层：``page`` / ``text`` / ``figure`` / ``formula`` / ``section`` —— 任何文件
  都能落成这些块，转换永远不失败；
- 激活层：``lab`` / ``canvas`` / ``quiz`` / ``checkpoint`` / ``embed`` —— 由
  ``ActivationSuggestion`` 被接受后物化出来，或用户手动插入。

建议不是块：它挂在保真块上，``accept`` 时由 :func:`materialize` 生成替换块并保
留 ``source`` 回溯链，``dismiss`` 只改状态——识别错误不会污染文档。
"""

from __future__ import annotations

import copy
import re
import secrets
from typing import Any, Mapping, Sequence

SCHEMA_VERSION = "page.1"

BLOCK_TYPES = {
    "page", "text", "figure", "formula", "section",
    "lab", "canvas", "quiz", "checkpoint", "embed",
}
FLOOR_TYPES = {"page", "text", "figure", "formula", "section"}
SUGGESTION_KINDS = {"formula", "lab", "canvas_object", "quiz", "section"}
SUGGESTION_STATUS = {"pending", "accepted", "dismissed"}

MAX_BLOCKS = 400
MAX_SUGGESTIONS = 60
MAX_TEXT = 20000
MAX_URL = 2000


def new_page_id() -> str:
    return f"pg_{secrets.token_hex(12)}"


def new_block_id() -> str:
    return f"blk_{secrets.token_hex(8)}"


def new_suggestion_id() -> str:
    return f"sug_{secrets.token_hex(8)}"


def _clamp_text(value: Any, limit: int = MAX_TEXT) -> str:
    return str(value or "")[:limit]


def _source_ref(raw: Any) -> dict[str, Any] | None:
    """块出处：来自哪个文件的哪一页/哪一段（可回溯=可对照原文）。"""
    if not isinstance(raw, Mapping):
        return None
    ref: dict[str, Any] = {}
    if isinstance(raw.get("file_id"), str) and raw["file_id"]:
        ref["file_id"] = raw["file_id"][:64]
    if isinstance(raw.get("page"), int):
        ref["page"] = raw["page"]
    span = raw.get("span")
    if (
        isinstance(span, Sequence)
        and not isinstance(span, str)
        and len(span) == 2
        and all(isinstance(v, int) for v in span)
    ):
        ref["span"] = [max(0, span[0]), max(0, span[1])]
    return ref or None


def validate_block(raw: Any) -> dict[str, Any]:
    """校验并规范化一个块；非法输入抛 ``ValueError``。"""
    if not isinstance(raw, Mapping):
        raise ValueError("块必须是对象")
    kind = str(raw.get("type") or "")
    if kind not in BLOCK_TYPES:
        raise ValueError(f"不支持的块类型：{kind or '(空)'}")
    data = raw.get("data")
    if not isinstance(data, Mapping):
        raise ValueError(f"块 {kind} 缺少 data")
    block: dict[str, Any] = {
        "id": str(raw.get("id") or new_block_id())[:40],
        "type": kind,
        "data": _validate_data(kind, data),
    }
    ref = _source_ref(raw.get("source"))
    if ref is not None:
        block["source"] = ref
    if raw.get("floor"):
        block["floor"] = True
    return block


def _validate_data(kind: str, data: Mapping[str, Any]) -> dict[str, Any]:
    if kind == "page":
        out = {"alt": _clamp_text(data.get("alt"), 300)}
        if isinstance(data.get("image_key"), str) and data["image_key"]:
            out["image_key"] = str(data["image_key"])[:80]
        out["collapsed"] = bool(data.get("collapsed"))
        for key in ("width", "height"):
            value = data.get(key)
            if isinstance(value, (int, float)) and 0 < value <= 100000:
                out[key] = int(value)
        return out
    if kind == "text":
        return {"md": _clamp_text(data.get("md")), **({"collapsed": True} if data.get("collapsed") else {})}
    if kind == "figure":
        return {
            "asset_id": _clamp_text(data.get("asset_id"), 80),
            "caption": _clamp_text(data.get("caption"), 300),
        }
    if kind == "formula":
        return {"latex": _clamp_text(data.get("latex"), 4000)}
    if kind == "section":
        level = data.get("level")
        return {
            "heading": _clamp_text(data.get("heading"), 200),
            "level": int(level) if level in (1, 2, 3) else 2,
        }
    if kind == "lab":
        problem = data.get("problem")
        if not isinstance(problem, Mapping) or not isinstance(problem.get("model"), Mapping):
            raise ValueError("lab 块缺少冻结的 problem（含 model）")
        params = data.get("engine_params")
        return {
            "problem": dict(problem),
            "engine_params": dict(params) if isinstance(params, Mapping) else {},
            "collapsed": bool(data.get("collapsed")),
        }
    if kind == "canvas":
        doc = data.get("doc")
        if not isinstance(doc, Mapping) or not isinstance(doc.get("nodes"), list):
            raise ValueError("canvas 块缺少 doc.nodes")
        if doc.get("template") == "ai_model":
            from ..ppt_ai.page_lab import validate_lab
            model = doc.get("model")
            if not isinstance(model, Mapping):
                raise ValueError("AI 交互模型缺少 model")
            normalized = validate_lab(model, probe=False)
            normalized.update({key: _clamp_text(model.get(key), 100) for key in ("version", "content_hash", "created_at")})
            page_no = model.get("page_no")
            normalized["page_no"] = page_no if isinstance(page_no, int) else 1
            generator = model.get("generator") or {}
            normalized["generator"] = {"model": _clamp_text(generator.get("model"), 100) if isinstance(generator, Mapping) else ""}
            return {"doc": {"nodes": [], "template": "ai_model", "model": normalized,
                            "anchor_id": _clamp_text(doc.get("anchor_id"), 40),
                            "input_hash": _clamp_text(doc.get("input_hash"), 100),
                            "instruction": _clamp_text(doc.get("instruction"), 1000)}}
        if doc.get("version") == 1:
            # 与工坊保存同源校验：节点上限、composite 深度、连线端点与坐标都由
            # validate_canvas_doc 统一收敛，避免活页成为绕过校验的写入口。
            from ..workshop.model import validate_canvas_doc
            return {"doc": validate_canvas_doc(doc)}
        return {"doc": dict(doc)}
    if kind == "quiz":
        out = {
            "question": _clamp_text(data.get("question"), 400) or "先猜再看",
            "answer": _clamp_text(data.get("answer"), 200),
            "explain": _clamp_text(data.get("explain"), 600),
        }
        for key in ("min", "max", "value"):
            try:
                out[key] = float(data.get(key))
            except (TypeError, ValueError):
                out[key] = {"min": 0.0, "max": 4.0, "value": 1.0}[key]
        return out
    if kind == "checkpoint":
        return {
            "prompt": _clamp_text(data.get("prompt"), 600) or "写下你的答案",
            "expected": _clamp_text(data.get("expected"), 400),
            "placeholder": _clamp_text(data.get("placeholder"), 200),
        }
    # embed
    url = _clamp_text(data.get("url"), MAX_URL)
    if url and not re.match(r"^https?://", url):
        raise ValueError("embed 块只接受 http/https 链接")
    try:
        height = max(120, min(1200, int(data.get("height") or 360)))
    except (TypeError, ValueError):
        height = 360
    return {"url": url, "height": height}


def validate_blocks(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        raise ValueError("blocks 必须是数组")
    if len(raw) > MAX_BLOCKS:
        raise ValueError(f"块数量超过上限 {MAX_BLOCKS}")
    blocks = [validate_block(item) for item in raw]
    ids = [b["id"] for b in blocks]
    if len(set(ids)) != len(ids):
        raise ValueError("块 id 重复")
    return blocks


def make_suggestion(
    kind: str,
    block_id: str,
    proposal: Mapping[str, Any],
    reason: str,
    *,
    confidence: float = 0.0,
) -> dict[str, Any]:
    return {
        "id": new_suggestion_id(),
        "block_id": block_id,
        "kind": kind,
        "confidence": round(float(confidence), 3),
        "status": "pending",
        "proposal": dict(proposal),
        "reason": reason[:300],
    }


def validate_suggestion(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise ValueError("建议必须是对象")
    kind = str(raw.get("kind") or "")
    if kind not in SUGGESTION_KINDS:
        raise ValueError(f"不支持的建议类型：{kind or '(空)'}")
    status = str(raw.get("status") or "pending")
    return {
        "id": str(raw.get("id") or new_suggestion_id())[:40],
        "block_id": str(raw.get("block_id") or "")[:40],
        "kind": kind,
        "confidence": max(0.0, min(1.0, float(raw.get("confidence") or 0))),
        "status": status if status in SUGGESTION_STATUS else "pending",
        "proposal": dict(raw.get("proposal") or {}),
        "reason": _clamp_text(raw.get("reason"), 300),
    }


def materialize(suggestion: Mapping[str, Any], anchor: Mapping[str, Any]) -> list[dict[str, Any]]:
    """把一条被接受的建议物化成替换块序列（保留锚块的 ``source`` 链）。

    ``anchor`` 是建议挂载的保真块。物化失败（如题目识别不出）抛
    ``ValueError``，由路由层转成可提示用户的错误——**不静默生成假块**。
    """

    kind = str(suggestion.get("kind") or "")
    proposal = suggestion.get("proposal") or {}
    source = anchor.get("source")

    if kind == "lab":
        text = str(proposal.get("text") or "").strip()
        if not text:
            raise ValueError("建议缺少题目文本")
        problem = build_problem_snapshot(text)
        return [{
            "id": new_block_id(),
            "type": "lab",
            "source": source,
            "data": {
                "problem": problem,
                "engine_params": dict((problem.get("model") or {}).get("defaults") or {}),
            },
        }]

    if kind == "formula":
        latex = str(proposal.get("latex") or "").strip()
        if not latex:
            raise ValueError("建议缺少公式内容")
        out: list[dict[str, Any]] = []
        before = str(proposal.get("before") or "").strip()
        after = str(proposal.get("after") or "").strip()
        if before:
            out.append({"id": new_block_id(), "type": "text", "source": source,
                        "data": {"md": before}})
        out.append({"id": new_block_id(), "type": "formula", "source": source,
                    "data": {"latex": latex}})
        if after:
            out.append({"id": new_block_id(), "type": "text", "source": source,
                        "data": {"md": after}})
        return out

    if kind == "quiz":
        return [{
            "id": new_block_id(),
            "type": "quiz",
            "source": source,
            "data": dict(proposal),
        }]

    if kind == "canvas_object" and proposal.get("template") == "attention":
        return [copy.deepcopy(anchor), {
            "id": new_block_id(), "type": "canvas", "source": source,
            "data": {"doc": {"nodes": [], "template": "attention"}},
        }]

    raise ValueError(f"暂不支持激活 {kind} 建议")


def build_problem_snapshot(text: str) -> dict[str, Any]:
    """识别一段题目文本，返回冻结的 problem（model+solution，剥掉学生态）。"""
    from ..labs.recognize import RecognitionError, build_lab_document
    from ..labs.store import new_lab_id
    from ..schemas.common import to_iso, utc_now
    from .store import text_page_source

    lab_id = new_lab_id()
    source = text_page_source(text, lab_id=lab_id)
    try:
        document = build_lab_document(
            lab_id=lab_id,
            title=text.strip()[:60],
            source=source,
            files=list(source.get("files") or []),
            now_iso=to_iso(utc_now()),
            max_problems=1,
        )
    except RecognitionError as exc:
        raise ValueError(f"这段文字识别不成题目：{exc}") from exc
    problems = document.get("problems") or []
    if not problems:
        raise ValueError("这段文字识别不成题目")
    problem = copy.deepcopy(problems[0])
    if problem.get("subject") == "unknown" or problem.get("status") == "unsupported":
        raise ValueError("这段文字识别不成可求解的题目，请补充条件或换一段")
    problem.pop("states", None)
    for page in problem.get("source_pages") or []:
        page.pop("stored_name", None)
    return problem


def apply_suggestion(document: dict[str, Any], suggestion_id: str) -> dict[str, Any]:
    """接受建议：用物化块替换锚块；返回替换进来的块列表。"""
    suggestions = document.get("suggestions") or []
    target = next((s for s in suggestions if s.get("id") == suggestion_id), None)
    if target is None:
        raise ValueError("建议不存在")
    if target.get("status") != "pending":
        raise ValueError("建议已处理过")
    blocks = document.get("blocks") or []
    index = next((i for i, b in enumerate(blocks) if b.get("id") == target.get("block_id")), None)
    if index is None:
        raise ValueError("建议指向的块已不存在，请先忽略该建议")
    anchor = blocks[index]
    fresh = [validate_block(b) for b in materialize(target, anchor)]
    blocks[index:index + 1] = fresh
    target["status"] = "accepted"
    conversion = (document.get("provenance") or {}).get("conversion")
    if isinstance(conversion, dict):
        conversion["accepted"] = int(conversion.get("accepted") or 0) + 1
    return {"inserted": fresh, "anchor_id": anchor["id"]}


def dismiss_suggestion(document: dict[str, Any], suggestion_id: str) -> None:
    target = next(
        (s for s in (document.get("suggestions") or []) if s.get("id") == suggestion_id),
        None,
    )
    if target is None:
        raise ValueError("建议不存在")
    if target.get("status") != "pending":
        raise ValueError("建议已处理过")
    target["status"] = "dismissed"


__all__ = [
    "BLOCK_TYPES",
    "FLOOR_TYPES",
    "SCHEMA_VERSION",
    "SUGGESTION_KINDS",
    "apply_suggestion",
    "build_problem_snapshot",
    "dismiss_suggestion",
    "make_suggestion",
    "materialize",
    "new_block_id",
    "new_page_id",
    "new_suggestion_id",
    "validate_block",
    "validate_blocks",
    "validate_suggestion",
]

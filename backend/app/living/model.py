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
import json
import math
import re
from urllib.parse import urlsplit
import secrets
from typing import Any, Mapping, Sequence

SCHEMA_VERSION = "page.1"

BLOCK_TYPES = {
    "page", "text", "figure", "formula", "section", "diagram",
    "lab", "canvas", "quiz", "checkpoint", "embed", "callout",
}
FLOOR_TYPES = {"page", "text", "figure", "formula", "section"}
SUGGESTION_KINDS = {"formula", "lab", "canvas_object", "quiz", "section"}
SUGGESTION_STATUS = {"pending", "accepted", "dismissed"}

MAX_BLOCKS = 400
MAX_SUGGESTIONS = 60
MAX_TEXT = 20000
MAX_URL = 2000
MAX_BLOCK_TYPE = 128
MAX_VARIABLES = 40
MAX_BINDINGS = 32
MAX_REGIONS = 12
REGION_KINDS = {"figure", "diagram", "formula", "table"}
CALLOUT_KINDS = {"theorem", "proof", "example", "warning"}
VARIABLE_TYPES = {"number", "select"}
_VAR_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,31}")
MAX_OPAQUE_BYTES = 64 * 1024
MAX_OPAQUE_TOTAL_BYTES = 1024 * 1024
MAX_OPAQUE_DEPTH = 16
MAX_OPAQUE_NODES = 4096


def _opaque_data(data: Mapping[str, Any]) -> dict[str, Any]:
    """未知块仅作为有界 JSON 数据保存，不解释 HTML 或任何内部字段。"""
    nodes = 0
    size = 0

    def check(value: Any, depth: int) -> None:
        nonlocal nodes, size
        nodes += 1
        if nodes > MAX_OPAQUE_NODES or depth > MAX_OPAQUE_DEPTH:
            raise ValueError("未知块 data 超过节点数或深度上限")
        if isinstance(value, dict):
            for key, item in value.items():
                if not isinstance(key, str):
                    raise ValueError("未知块 data 的 JSON 键必须是字符串")
                check(key, depth + 1)
                check(item, depth + 1)
        elif isinstance(value, list):
            for item in value:
                check(item, depth + 1)
        elif value is None or isinstance(value, (str, bool, int, float)):
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError("未知块 data 数值必须有限")
            if isinstance(value, str) and len(value) > MAX_OPAQUE_BYTES:
                raise ValueError("未知块 data 超过尺寸上限")
            try:
                size += len(json.dumps(value, ensure_ascii=True, allow_nan=False))
            except (ValueError, OverflowError) as exc:
                raise ValueError("未知块 data 必须是合法 JSON") from exc
            if size > MAX_OPAQUE_BYTES:
                raise ValueError("未知块 data 超过尺寸上限")
        else:
            raise ValueError("未知块 data 必须是合法 JSON")

    payload = dict(data)
    check(payload, 0)
    if len(json.dumps(payload, ensure_ascii=True, separators=(",", ":"))) > MAX_OPAQUE_BYTES:
        raise ValueError("未知块 data 超过尺寸上限")
    return copy.deepcopy(payload)


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
    region = raw.get("region")
    if isinstance(region, str) and region.strip():
        ref["region"] = region.strip()[:40]
    return ref or None


def validate_block(raw: Any) -> dict[str, Any]:
    """校验并规范化一个块；非法输入抛 ``ValueError``。"""
    if not isinstance(raw, Mapping):
        raise ValueError("块必须是对象")
    kind = raw.get("type")
    if (not isinstance(kind, str) or not kind.strip() or len(kind) > MAX_BLOCK_TYPE
            or kind != kind.strip() or any(ord(c) < 32 or ord(c) == 127 for c in kind)):
        raise ValueError("块 type 必须是非空、无控制字符且不超过 128 字符的字符串")
    data = raw.get("data")
    if not isinstance(data, Mapping):
        raise ValueError(f"块 {kind} 缺少 data")
    block: dict[str, Any] = {
        "id": str(raw.get("id") or new_block_id())[:40],
        "type": kind,
        "data": _validate_data(kind, data) if kind in BLOCK_TYPES else _opaque_data(data),
    }
    ref = _source_ref(raw.get("source"))
    if ref is not None:
        block["source"] = ref
    if raw.get("floor"):
        block["floor"] = True
    bindings = raw.get("bindings")
    if bindings is not None:
        block["bindings"] = _validate_bindings(bindings)
    outputs = raw.get("outputs")
    if outputs is not None:
        # Phase 1 只预留字段位：允许空对象透传，拒绝任何实际映射。
        if not isinstance(outputs, Mapping) or outputs:
            raise ValueError("outputs 派生输出尚未启用，仅允许空对象预留")
        block["outputs"] = {}
    locked_until = raw.get("locked_until")
    if locked_until is not None:
        gate = _validate_locked_until(locked_until)
        if gate["block_id"] == block["id"]:
            raise ValueError("locked_until 不能指向块自身")
        block["locked_until"] = gate
    return block


_LOCKED_RULES = {"submitted", "correct"}


def _validate_locked_until(raw: Any) -> dict[str, Any]:
    """``locked_until`` 门控：``{block_id, rule}``，指向需先完成的兄弟块。

    目标缺失按全局悬挂规则处理——前端降级为解锁+警告，校验层只保证形态。
    """
    if not isinstance(raw, Mapping):
        raise ValueError("locked_until 必须是对象")
    target = raw.get("block_id")
    if not isinstance(target, str) or not target.strip():
        raise ValueError("locked_until.block_id 必须是非空字符串")
    rule = str(raw.get("rule") or "submitted")
    if rule not in _LOCKED_RULES:
        raise ValueError("locked_until.rule 必须是 submitted/correct 之一")
    return {"block_id": target.strip()[:40], "rule": rule}


def _validate_bindings(raw: Any) -> dict[str, str]:
    """块级 ``bindings``：``{块内参数键: 页面变量名}``。

    键是块内部参数坐标（lab 为引擎参数名，canvas 为 ``node_id.param_key``）；
    值必须是一个合法页面变量名。指向不存在的变量由前端按"降级为静态值"
    处理，校验层只保证形态。
    """
    if not isinstance(raw, Mapping):
        raise ValueError("bindings 必须是对象")
    if len(raw) > MAX_BINDINGS:
        raise ValueError("bindings 超过上限")
    out: dict[str, str] = {}
    for key, value in raw.items():
        name = str(key)[:120]
        if not name:
            raise ValueError("bindings 参数键不能为空")
        if not isinstance(value, str) or not _VAR_NAME.fullmatch(value):
            raise ValueError(f"bindings.{name} 必须指向一个合法变量名")
        out[name] = value
    return out


def validate_variables(raw: Any) -> dict[str, dict[str, Any]]:
    """页面级 ``variables``：``{名: {label,type,value,min?,max?,step?,options?,unit?}}``。

    Phase 1 只做 number/select 两类标量；数值范围与选项数量收敛，缺失字段
    按原样回传，便于旧文档直接通过。
    """
    if not isinstance(raw, Mapping):
        raise ValueError("variables 必须是对象")
    if len(raw) > MAX_VARIABLES:
        raise ValueError(f"变量数量超过上限 {MAX_VARIABLES}")
    out: dict[str, dict[str, Any]] = {}
    for name, spec in raw.items():
        if not isinstance(name, str) or not _VAR_NAME.fullmatch(name):
            raise ValueError(f"变量名不合法：{name!r}")
        if not isinstance(spec, Mapping):
            raise ValueError(f"变量 {name} 的定义必须是对象")
        kind = str(spec.get("type") or "number")
        if kind not in VARIABLE_TYPES:
            raise ValueError(f"变量 {name} 的类型必须是 {sorted(VARIABLE_TYPES)} 之一")
        entry: dict[str, Any] = {
            "label": _clamp_text(spec.get("label") or name, 80),
            "type": kind,
        }
        unit = spec.get("unit")
        if isinstance(unit, str) and unit.strip():
            entry["unit"] = _clamp_text(unit, 20)
        if kind == "number":
            value = _finite_float(spec.get("value"), f"变量 {name}")
            entry["value"] = value
            for key in ("min", "max", "step"):
                raw_bound = spec.get(key)
                if raw_bound is None:
                    continue
                entry[key] = _finite_float(raw_bound, f"变量 {name} 的 {key}")
            if "min" in entry and "max" in entry and not entry["min"] < entry["max"]:
                raise ValueError(f"变量 {name} 必须满足 min < max")
            if "step" in entry and entry["step"] <= 0:
                raise ValueError(f"变量 {name} 的 step 必须为正")
            lo = entry.get("min")
            hi = entry.get("max")
            if lo is not None and value < lo or hi is not None and value > hi:
                raise ValueError(f"变量 {name} 的默认值超出 min/max 范围")
        else:
            options = spec.get("options")
            if (not isinstance(options, list) or not options or len(options) > 20
                    or any(not isinstance(item, str) or not item.strip() or len(item) > 80 for item in options)):
                raise ValueError(f"变量 {name} 的 options 必须是 1-20 个非空字符串")
            entry["options"] = [item.strip()[:80] for item in options]
            value = str(spec.get("value") or "")
            entry["value"] = value if value in entry["options"] else entry["options"][0]
        out[name] = entry
    return out


def _finite_float(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{label} 必须是有限数值") from exc
    if isinstance(value, bool) or not math.isfinite(number):
        raise ValueError(f"{label} 必须是有限数值")
    return number


def _validate_regions(raw: Any) -> list[dict[str, Any]]:
    """页内区域：归一化 bbox + 裁剪资产 + 类型；越界直接拒绝，不静默漂移。"""
    if not isinstance(raw, list):
        raise ValueError("page.regions 必须是数组")
    if len(raw) > MAX_REGIONS:
        raise ValueError(f"page.regions 超过上限 {MAX_REGIONS}")
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, Mapping):
            raise ValueError("区域必须是对象")
        kind = str(item.get("kind") or "figure")
        if kind not in REGION_KINDS:
            raise ValueError(f"区域类型必须是 {sorted(REGION_KINDS)} 之一")
        box = item.get("bbox")
        if not isinstance(box, (list, tuple)) or len(box) != 4:
            raise ValueError("区域 bbox 必须是 4 个归一化数值")
        values = [_finite_float(value, "区域 bbox") for value in box]
        x0, y0, x1, y1 = (
            max(0.0, min(1.0, values[0])), max(0.0, min(1.0, values[1])),
            max(0.0, min(1.0, values[2])), max(0.0, min(1.0, values[3])),
        )
        if x1 <= x0 or y1 <= y0:
            raise ValueError("区域 bbox 必须满足 x1 > x0 且 y1 > y0")
        identifier = str(item.get("id") or "").strip()
        if not identifier or len(identifier) > 40:
            raise ValueError("区域 id 必须是非空且不超过 40 字符的字符串")
        asset_id = str(item.get("asset_id") or "").strip()
        if not asset_id or len(asset_id) > 80:
            raise ValueError("区域 asset_id 必须是非空且不超过 80 字符的字符串")
        confidence = item.get("confidence", 0.0)
        try:
            confidence_value = float(confidence)
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError("区域 confidence 必须是有限数值") from exc
        if isinstance(confidence, bool) or not math.isfinite(confidence_value):
            raise ValueError("区域 confidence 必须是有限数值")
        region: dict[str, Any] = {
            "id": identifier,
            "kind": kind,
            "bbox": [round(x0, 6), round(y0, 6), round(x1, 6), round(y1, 6)],
            "asset_id": asset_id,
            "label": _clamp_text(item.get("label") or "区域", 200),
            "caption": _clamp_text(item.get("caption"), 300),
            "text": _clamp_text(item.get("text"), 2000),
            "source": _clamp_text(item.get("source"), 40),
            "confidence": round(max(0.0, min(1.0, confidence_value)), 3),
        }
        latex = item.get("latex")
        if isinstance(latex, str) and latex.strip():
            region["latex"] = latex.strip()[:4000]
        expression = item.get("expression")
        if isinstance(expression, str) and expression.strip():
            region["expression"] = expression.strip()[:500]
        params = item.get("params")
        if isinstance(params, list):
            keep = [p for p in dict.fromkeys(str(v) for v in params[:4])
                    if p in ("a", "b", "c")]
            if keep:
                region["params"] = keep
        labels = item.get("labels")
        if isinstance(labels, list):
            cleaned: list[dict[str, Any]] = []
            for entry in labels[:10]:
                if not isinstance(entry, Mapping):
                    continue
                text = _clamp_text(entry.get("text"), 80).strip()
                box = entry.get("bbox")
                if not text or not isinstance(box, (list, tuple)) or len(box) != 4:
                    continue
                try:
                    lv = [float(v) for v in box]
                except (TypeError, ValueError):
                    continue
                if any(not math.isfinite(v) for v in lv):
                    continue
                lx0 = max(0.0, min(1.0, lv[0]))
                ly0 = max(0.0, min(1.0, lv[1]))
                lx1 = max(0.0, min(1.0, lv[2]))
                ly1 = max(0.0, min(1.0, lv[3]))
                if lx1 <= lx0 or ly1 <= ly0:
                    continue
                cleaned.append({"text": text,
                                "bbox": [round(v, 6) for v in (lx0, ly0, lx1, ly1)]})
            if cleaned:
                region["labels"] = cleaned
        block_id = item.get("block_id")
        if isinstance(block_id, str) and block_id.strip():
            region["block_id"] = block_id.strip()[:40]
        canvas_block_id = item.get("canvas_block_id")
        if isinstance(canvas_block_id, str) and canvas_block_id.strip():
            region["canvas_block_id"] = canvas_block_id.strip()[:40]
        if item.get("diagram") is not None:
            from .diagram import validate_diagram
            try:
                region["diagram"] = validate_diagram(item["diagram"])
            except ValueError:
                pass  # 非法图数据剔除，不拖垮整页
        out.append(region)
    return out


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
        if data.get("regions") is not None:
            regions = _validate_regions(data.get("regions"))
            if regions:
                out["regions"] = regions
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
    if kind == "diagram":
        from .diagram import validate_diagram
        doc = data.get("doc")
        if not isinstance(doc, Mapping):
            raise ValueError("diagram 块缺少 doc")
        return {"doc": validate_diagram(doc)}
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
            value = data.get(key, {"min": 0.0, "max": 4.0, "value": 1.0}[key])
            try:
                out[key] = float(value)
            except (TypeError, ValueError, OverflowError) as exc:
                raise ValueError("quiz 数值必须有限") from exc
            if isinstance(value, bool) or not math.isfinite(out[key]):
                raise ValueError("quiz 数值必须有限")
        if not out["min"] < out["max"] or not out["min"] <= out["value"] <= out["max"]:
            raise ValueError("quiz 必须满足 min < max 且 value 在范围内")
        return out
    if kind == "checkpoint":
        out = {
            "prompt": _clamp_text(data.get("prompt"), 600) or "写下你的答案",
            "expected": _clamp_text(data.get("expected"), 400),
            "placeholder": _clamp_text(data.get("placeholder"), 200),
        }
        grading = str(data.get("grading") or "exact")
        if grading not in {"exact", "expr", "numeric"}:
            raise ValueError("checkpoint 判分模式必须是 exact/expr/numeric 之一")
        out["grading"] = grading
        return out
    if kind == "callout":
        callout_kind = str(data.get("kind") or "")
        if callout_kind not in CALLOUT_KINDS:
            raise ValueError(f"callout 类型必须是 {sorted(CALLOUT_KINDS)} 之一")
        return {
            "kind": callout_kind,
            "title": _clamp_text(data.get("title"), 200),
            "md": _clamp_text(data.get("md")),
            "collapsible": bool(data.get("collapsible")),
        }
    # embed
    url = data.get("url", "")
    if not isinstance(url, str) or len(url) > MAX_URL:
        raise ValueError("embed URL 必须是长度不超过 2000 的字符串")
    if url:
        try:
            parsed = urlsplit(url)
            host = parsed.hostname
            if (parsed.scheme not in {"http", "https"} or not host
                    or parsed.username is not None or parsed.password is not None
                    or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in url)
                    or "\\" in url or not re.fullmatch(r"[\w.:-]+", host)
                    or parsed.port == 0 or parsed.netloc.endswith(":")):
                raise ValueError("invalid URL")
        except ValueError as exc:
            raise ValueError("embed 块只接受合法 http/https 链接") from exc
    try:
        height = max(120, min(1200, int(data.get("height") or 360)))
    except (TypeError, ValueError, OverflowError):
        height = 360
    return {"url": url, "height": height}


def validate_blocks(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        raise ValueError("blocks 必须是数组")
    if len(raw) > MAX_BLOCKS:
        raise ValueError(f"块数量超过上限 {MAX_BLOCKS}")
    blocks = []
    opaque_bytes = 0
    for item in raw:
        block = validate_block(item)
        if block["type"] not in BLOCK_TYPES:
            opaque_bytes += len(json.dumps(block["data"], ensure_ascii=True, separators=(",", ":")))
            if opaque_bytes > MAX_OPAQUE_TOTAL_BYTES:
                raise ValueError("未知块 data 总尺寸超过上限")
        blocks.append(block)
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

    if kind == "canvas_object":
        template = str(proposal.get("template") or "")
        from .canvas_templates import build_canvas_doc

        doc = build_canvas_doc(template, proposal)
        return [copy.deepcopy(anchor), {
            "id": new_block_id(), "type": "canvas", "source": source,
            "data": {"doc": doc},
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
    if problem.get("subject") == "unknown" or problem.get("status") != "ready":
        raise ValueError("这段文字缺少可计算的完整条件，无法直接生成实验块，请补充条件或保留原文")
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
    # 重新设计已物化模型：建议 proposal.replaces 指向旧的激活块，激活新
    # 版本时一并移除（仅允许 canvas 块，防止建议误删保真内容）。
    replaced_id = str((target.get("proposal") or {}).get("replaces") or "")
    if replaced_id:
        stale = next((i for i, b in enumerate(blocks)
                      if b.get("id") == replaced_id and b.get("type") == "canvas"), None)
        if stale is not None:
            blocks.pop(stale)
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
    "CALLOUT_KINDS",
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
    "validate_variables",
]

"""PPT AI 通用工具：稳定 ID、内容哈希与时间。"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
from typing import Any

from ..schemas.common import to_iso, utc_now

ID_PREFIXES = {
    "task": "tsk_",
    "plan": "pln_",
    "bundle": "bnd_",
    "branch": "brn_",
    "experiment": "exp_",
    "artifact": "art_",
    "report": "rpt_",
    "region": "rgn_",
    "cond": "cnd_",
    "review": "rvw_",
    "option": "opt_",
    "node": "ain_",
    "concept": "cpt_",
    "candidate": "lnk_",
    "view": "viw_",
    "card": "lrc_",
    "reply": "lrp_",
    "practice": "lpr_",
    "action": "act_",
}

_SAFE_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,96}$")


def new_id(kind: str) -> str:
    prefix = ID_PREFIXES.get(kind)
    if prefix is None:
        raise ValueError(f"未知 ID 类型：{kind}")
    return prefix + secrets.token_hex(12)


def stable_id(kind: str, *parts: Any) -> str:
    """由内容生成稳定 ID（重试同一输入不改变 region/concept 身份）。"""

    prefix = ID_PREFIXES.get(kind)
    if prefix is None:
        raise ValueError(f"未知 ID 类型：{kind}")
    raw = "\x1f".join(str(part) for part in parts if part not in (None, ""))
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
    return prefix + digest


def safe_id(value: str, fallback_kind: str) -> str:
    text = str(value or "").strip()
    if _SAFE_ID.match(text):
        return text
    return stable_id(fallback_kind, text)


def hash_json(value: Any) -> str:
    """规范化 JSON 哈希：字典排序、紧凑分隔符、拒绝 NaN。"""

    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def semantic_content_hash(payload: Any) -> str:
    """语义内容哈希：调用方只放入文本/公式/数据/关系，不放入位置/颜色/缩放。"""

    return hash_json(payload)


def now_iso() -> str:
    return to_iso(utc_now())


def excerpt(text: str, limit: int = 160) -> str:
    normalized = re.sub(r"\s+", " ", str(text or "")).strip()
    return normalized[:limit]


def template_tokens(text: str) -> set[str]:
    """模板召回用的轻量 token：拉丁词 + 中文二元组。"""
    value = re.sub(r"\s+", "", str(text or "")).casefold()
    tokens = set(re.findall(r"[a-z][a-z0-9_]{1,}", value))
    chunks = re.findall(r"[\u4e00-\u9fff]+", value)
    for chunk in chunks:
        if len(chunk) == 1:
            tokens.add(chunk)
        else:
            tokens.update(chunk[index : index + 2] for index in range(len(chunk) - 1))
    return tokens


def ensure_finite_tree(value: Any) -> bool:
    import math

    if isinstance(value, bool) or value is None or isinstance(value, str):
        return True
    if isinstance(value, (int, float)):
        return math.isfinite(float(value))
    if isinstance(value, list):
        return all(ensure_finite_tree(item) for item in value)
    if isinstance(value, dict):
        return all(isinstance(key, str) and ensure_finite_tree(item) for key, item in value.items())
    return False


__all__ = [
    "ID_PREFIXES",
    "ensure_finite_tree",
    "excerpt",
    "hash_json",
    "hash_text",
    "new_id",
    "now_iso",
    "safe_id",
    "semantic_content_hash",
    "stable_id",
    "template_tokens",
]

"""来源证据与出处核验（禁止伪造原文摘录）。"""

from __future__ import annotations

import re
from typing import Any, Mapping

from .types import Provenance, RegionEvidence, SourceAnchor, UserCheck
from .util import excerpt as clamp_excerpt
from .util import hash_json, now_iso


def normalize_text(text: Any) -> str:
    return re.sub(r"\s+", "", str(text or ""))


def excerpt_in_source(candidate: str, source: str, *, min_chars: int = 2) -> bool:
    """核对摘录确实出现在来源文本中（忽略空白）。

    模型提议的 excerpt 必须能在该页原文中找到；只有数字/符号的短摘录不算证据。
    """

    needle = normalize_text(candidate)
    haystack = normalize_text(source)
    if len(needle) < min_chars:
        return False
    return needle in haystack


def verify_anchor(
    anchor: Mapping[str, Any], page_texts: Mapping[int, str], *, require_excerpt: bool = True
) -> list[str]:
    """核对一个 SourceAnchor/参数来源，返回错误列表（空表示通过）。"""

    errors: list[str] = []
    page = anchor.get("page")
    if isinstance(page, bool) or not isinstance(page, int) or page < 1:
        errors.append("来源页码不合法")
        return errors
    if page not in page_texts:
        errors.append(f"来源页码不存在：{page}")
        return errors
    raw_excerpt = str(anchor.get("excerpt") or "").strip()
    if require_excerpt and not raw_excerpt:
        errors.append("来源缺少原文摘录")
    elif raw_excerpt and not excerpt_in_source(raw_excerpt, page_texts[page]):
        errors.append(f"摘录未在第 {page} 页原文中找到，已拒收")
    bbox = anchor.get("bbox")
    if bbox is not None:
        if not isinstance(bbox, Mapping):
            errors.append("来源 bbox 不是对象")
        else:
            try:
                x, y, w, h = (float(bbox[key]) for key in ("x", "y", "w", "h"))
            except (KeyError, TypeError, ValueError):
                errors.append("来源 bbox 缺少数值")
            else:
                if not all(0 <= value <= 1 for value in (x, y)) or w <= 0 or h <= 0 or x + w > 1.000001 or y + h > 1.000001:
                    errors.append("来源 bbox 超出 0—1 页面范围")
    return errors


def build_provenance(
    origin_type: str,
    *,
    evidence: str = "",
    inference: str = "",
    method: str = "",
    checks: list[UserCheck] | None = None,
) -> Provenance:
    return Provenance(
        origin_type=origin_type,  # type: ignore[arg-type]
        evidence=evidence[:4000],
        inference=inference[:2000],
        method=method[:120],
        user_checks=list(checks or []),
    )


def build_anchor(
    *,
    material_id: str,
    page: int,
    bbox: Any,
    excerpt: str,
    source_version: int,
    semantic_hash: str,
    node_id: str | None = None,
    element_id: str | None = None,
) -> SourceAnchor:
    return SourceAnchor(
        material_id=material_id,
        page=max(1, int(page)),
        node_id=node_id,
        element_id=element_id,
        bbox=bbox,
        excerpt=clamp_excerpt(excerpt),
        source_version=max(0, int(source_version)),
        semantic_content_hash=semantic_hash,
    )


def provenance_hash(provenance: Provenance) -> str:
    return hash_json(provenance.model_dump(mode="json"))


def user_check(decision: str, note: str = "", before: str = "", after: str = "") -> UserCheck:
    return UserCheck(
        check_id=f"chk_{hash_json([decision, note, now_iso()])[:12]}",
        decision=decision,  # type: ignore[arg-type]
        note=note[:500],
        checked_at=now_iso(),
        before_hash=before[:64],
        after_hash=after[:64],
    )


def evidence_item(
    source: str, method: str, text: str, *, element_id: str | None = None, note: str = ""
) -> RegionEvidence:
    return RegionEvidence(
        source=source,  # type: ignore[arg-type]
        method=method[:120],
        element_id=element_id,
        text=text[:4000],
        note=note[:1000],
    )


__all__ = [
    "build_anchor",
    "build_provenance",
    "evidence_item",
    "excerpt_in_source",
    "normalize_text",
    "provenance_hash",
    "user_check",
    "verify_anchor",
]

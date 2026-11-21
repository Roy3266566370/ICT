"""活页文档装配、公开快照、列表摘要与资产白名单。"""

from __future__ import annotations

import copy
import secrets
from typing import Any, Mapping, Sequence

from ..schemas.common import to_iso, utc_now
from .blockify import blockify
from .enrich import suggest_for_blocks
from .model import SCHEMA_VERSION, new_page_id, validate_blocks, validate_suggestion


def new_share_id() -> str:
    return secrets.token_urlsafe(12)


def text_page_source(text: str, *, lab_id: str) -> dict[str, Any]:
    """纯文本来源结构（不写文件）——与 ``labs.extract.text_source`` 同形，
    供实验室识别器复用；命名面向"粘贴一段文字"的活页场景。"""

    _ = lab_id
    return {
        "files": [
            {
                "file_id": "f1",
                "name": "粘贴的文字",
                "role": "courseware",
                "role_label": "课件",
                "kind": "text",
                "stored_name": None,
                "pages": 1,
                "chars": len(text),
                "methods": ["typed_text"],
            }
        ],
        "pages": [
            {
                "file_id": "f1",
                "page": 1,
                "text": text,
                "method": "typed_text",
                "image_key": None,
            }
        ],
        "method": "typed_text",
    }


def build_document(
    *,
    title: str,
    source: Mapping[str, Any],
    page_id: str | None = None,
    now_iso: str | None = None,
) -> dict[str, Any]:
    """抽取产物 → 完整活页文档（blocks + suggestions + provenance）。"""

    now = now_iso or to_iso(utc_now())
    blocks, notes = blockify(source)
    blocks = validate_blocks(blocks)
    suggestions = [validate_suggestion(s) for s in suggest_for_blocks(blocks)]
    files = [
        {k: v for k, v in f.items() if k != "stored_name" or True}
        for f in (source.get("files") or [])
    ]
    pages = list(source.get("pages") or [])
    return {
        "schema_version": SCHEMA_VERSION,
        "page_id": page_id or new_page_id(),
        "title": title.strip()[:120] or _default_title(files),
        "created_at": now,
        "updated_at": now,
        "revision": 1,
        "blocks": blocks,
        "suggestions": suggestions,
        "variables": {},
        "source": {
            "files": files,
            "pages": pages,
            "method": str(source.get("method") or ""),
        },
        "provenance": {
            "files": [
                {
                    "file_id": f.get("file_id"),
                    "name": f.get("name"),
                    "kind": f.get("kind"),
                    "pages": f.get("pages"),
                }
                for f in files
            ],
            "conversion": {
                "pages_total": len(pages),
                "blocks_faithful": sum(1 for b in blocks if b["type"] in ("page", "text", "figure", "formula", "section")),
                "suggestions": len(suggestions),
                "accepted": 0,
                "notes": notes,
            },
        },
        "settings": {
            "answers_visible": "after_attempt",
            "allow_fork": True,
            "collect_progress": True,
        },
    }


def _default_title(files: Sequence[Mapping[str, Any]]) -> str:
    if files:
        return str(files[0].get("name") or "未命名活页")[:120]
    return "未命名活页"


def asset_keys(document: Mapping[str, Any]) -> set[str]:
    """公开资产白名单：原页图 ``image_key`` + 图片块 ``asset_id``。"""

    keys: set[str] = set()
    for page in (document.get("source") or {}).get("pages") or []:
        key = page.get("image_key")
        if isinstance(key, str) and key:
            keys.add(key)
        for region in page.get("regions") or []:
            if isinstance(region, dict):
                key = region.get("asset_id")
                if isinstance(key, str) and key:
                    keys.add(key)
    for block in document.get("blocks") or []:
        data = block.get("data") or {}
        for field in ("image_key", "asset_id"):
            key = data.get(field)
            if isinstance(key, str) and key:
                keys.add(key)
        for region in data.get("regions") or []:
            if isinstance(region, dict):
                key = region.get("asset_id")
                if isinstance(key, str) and key:
                    keys.add(key)
    return keys


def snapshot(document: Mapping[str, Any], *, share_id: str) -> dict[str, Any]:
    """公开只读快照：去掉建议（老师侧工件）、stored_name 等内部字段。"""

    snap = copy.deepcopy(document)
    snap["share_id"] = share_id
    snap["published_at"] = to_iso(utc_now())
    snap.pop("suggestions", None)
    for item in (snap.get("source") or {}).get("files") or []:
        item.pop("stored_name", None)
    for page in (snap.get("source") or {}).get("pages") or []:
        page.pop("stored_name", None)
    for block in snap.get("blocks") or []:
        if block.get("type") == "lab":
            for page in (block.get("data") or {}).get("problem", {}).get("source_pages") or []:
                page.pop("stored_name", None)
    return snap


def summary(document: Mapping[str, Any]) -> dict[str, Any]:
    conversion = (document.get("provenance") or {}).get("conversion") or {}
    return {
        "page_id": document.get("page_id"),
        "title": document.get("title"),
        "block_count": len(document.get("blocks") or []),
        "suggestions_pending": sum(
            1 for s in (document.get("suggestions") or []) if s.get("status") == "pending"
        ),
        "pages_total": conversion.get("pages_total"),
        "created_at": document.get("created_at"),
        "updated_at": document.get("updated_at"),
        "revision": document.get("revision"),
    }


__all__ = [
    "asset_keys",
    "build_document",
    "new_share_id",
    "snapshot",
    "summary",
    "text_page_source",
]

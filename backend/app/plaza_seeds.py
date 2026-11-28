"""Curated entries use the same public preview and fork routes as user snapshots."""

from functools import lru_cache
from hashlib import md5
import json
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .db.models import PlazaItemRecord
from .db.session import session_scope
from .documents.native_deck import create_native_deck
from .schemas.common import to_iso, utc_now
from .workshop.store import workshop_cover_meta

WORKSHOP = json.loads((Path(__file__).parent / "workshop" / "plaza_templates.json").read_text(encoding="utf-8"))
DECKS = {
    "linear-algebra": ("特征值与几何变换", "math", "lecture", "la01-matrix-det-basis",
                       "改变矩阵，比较变换前后的网格和向量。"),
    "projectile": ("抛体运动实验", "physics", "lab", "projectile-drag",
                   "改变初速度、角度与阻力，观察轨迹和能量。"),
    "defense": ("毕业论文答辩框架", "ppt", "defense", "taylor-error",
                "用背景、方法和结论组织答辩，并参考可替换的交互演示页。"),
    "business": ("商务数据分析汇报", "business", "business", "biz-breakeven",
                 "调整成本、定价和销量，比较盈亏平衡点。"),
}


@lru_cache(maxsize=4)
def official_deck(share_id):
    entry = DECKS.get(share_id.removeprefix("tpl_deck_")) if share_id.startswith("tpl_deck_") else None
    if entry is None:
        return None
    title, _, template, plugin, summary = entry
    outline = [
        SimpleNamespace(title=title, layout_id="cover", points=[summary]),
        SimpleNamespace(title="互动演示", layout_id="text-plugin", points=[summary, "改变一项参数，对照调整前后的结果。"], template_kind=plugin),
        SimpleNamespace(title="观察与结论", layout_id="lesson", points=["记录你的观察。", "说明变量之间的关系，并给出一个新的应用场景。"]),
    ]
    return create_native_deck(title, "16:9", template, None, outline)


def official_work(share_id):
    entry = WORKSHOP.get(share_id.removeprefix("tpl_")) if share_id.startswith("tpl_") else None
    return entry["document"] if entry else None


def seed_plaza():
    now = to_iso(utc_now())
    entries = []
    for key, entry in WORKSHOP.items():
        doc = entry["document"]
        entries.append(("workshop", f"tpl_{key}", doc["title"], entry["summary"], entry["subject"],
                        {"node_count": len(doc["nodes"]), "preview_template": key, **workshop_cover_meta(doc)}))
    for key, (title, subject, _, _, summary) in DECKS.items():
        share_id = f"tpl_deck_{key}"
        doc = official_deck(share_id)
        entries.append(("deck", share_id, title, summary, subject,
                        {"page_count": len(doc["pages"]), "theme_id": doc["theme"]["id"]}))
    with session_scope() as db:
        existing = set(db.scalars(select(PlazaItemRecord.share_id).where(PlazaItemRecord.is_featured)).all())
        for kind, share_id, title, summary, subject, cover in entries:
            if share_id in existing:
                # 已播种的历史条目：补齐后加的封面元数据（拓扑缩略图、连线数），其余字段不动。
                if kind == "workshop":
                    row = db.scalar(select(PlazaItemRecord).where(PlazaItemRecord.share_id == share_id))
                    if row is not None and ("topology" not in row.cover_meta_json or "wire_count" not in row.cover_meta_json):
                        row.cover_meta_json = {**row.cover_meta_json, **cover}
                continue
            try:
                with db.begin_nested():
                    db.add(PlazaItemRecord(
                        id="plz_" + md5(share_id.encode(), usedforsecurity=False).hexdigest(),
                        kind=kind, share_id=share_id, title=title, summary=summary, subject=subject,
                        cover_meta_json=cover, is_featured=True, created_at=now, updated_at=now,
                    ))
            except IntegrityError:
                # Another application worker might seed the same entry on startup.
                if not db.scalar(select(PlazaItemRecord.id).where(PlazaItemRecord.share_id == share_id)):
                    raise

"""Public catalog, account-owned listings, and lightweight reactions."""

from collections import defaultdict
from threading import Lock
from time import monotonic
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, exists, func, or_, select, update
from sqlalchemy.exc import IntegrityError

from ..accounts.avatars import avatar_path
from ..db.account_models import UserProfileRecord, UserRecord
from ..db.models import MaterialRecord, PlazaItemRecord as Item, PlazaReactionRecord as Reaction, ShareRecord, WorkshopShareRecord
from ..schemas.common import to_iso, utc_now
from ..schemas.errors import ApiError, auth_required, missing_field, rate_limited, resource_unavailable
from . import API_PREFIX, DBDep, empty, ok, require_session
from .routes_auth import AuthSessionDep, AuthWriteDep, interests_of, require_auth_session

router = APIRouter(prefix=API_PREFIX, tags=["plaza"])

Kind = Literal["workshop", "deck"]
Subject = Literal["math", "physics", "cs", "ai", "business", "ppt", "general"]

_rate_lock = Lock()
_rate_counts: dict[tuple[str, str], int] = {}
_rate_minute = -1


def limit_account(user_id: str, action: str, limit: int) -> None:
    global _rate_minute
    with _rate_lock:
        minute = int(monotonic() // 60)
        if minute != _rate_minute:
            _rate_minute = minute
            _rate_counts.clear()
        key = (user_id, action)
        count = _rate_counts.get(key, 0)
        if count >= limit:
            raise rate_limited("操作过于频繁，请稍后再试")
        _rate_counts[key] = count + 1


def active_account(db, user_id):
    user = db.get(UserRecord, user_id)
    if user is None or user.status != "active":
        raise auth_required()
    return user


class ListingOptions(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    subject: Subject
    summary: str = Field(default="", max_length=120)
    allow_fork: bool = True
    tags: list[str] = Field(default_factory=list, max_length=4)


class ListingCreate(ListingOptions):
    kind: Kind
    share_id: str = Field(min_length=1, max_length=64)


class ListingPatch(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(default="", max_length=120, min_length=1)
    summary: str = Field(default="", max_length=120)
    subject: Subject = "general"
    allow_fork: bool = True
    pinned: bool = False


class ReactRequest(BaseModel):
    kind: Literal["like", "bookmark"]


def item_for_share(db, share_id):
    return db.scalar(select(Item).where(Item.share_id == share_id))


def unlist_shares(db, share_ids):
    db.execute(update(Item).where(Item.share_id.in_(share_ids)).values(
        status="unlisted", updated_at=to_iso(utc_now()),
    ))


def lock_fork(db, share_id):
    # A no-op update locks the record on both SQLite and MySQL before the policy check.
    db.execute(update(Item).where(Item.share_id == share_id).values(forks=Item.forks))
    item = db.scalar(select(Item).where(Item.share_id == share_id).with_for_update())
    if item and not item.allow_fork:
        raise resource_unavailable(reason="作者关闭了复刻")
    if item:
        item.forks += 1


def list_share(db, kind, share, user_id, options, *, title, cover, forks=0):
    active_account(db, user_id)
    limit_account(user_id, "publish", 12)
    item = item_for_share(db, share.share_id)
    if item and item.author_user_id != user_id:
        raise resource_unavailable()
    now = to_iso(utc_now())
    if item is None:
        item = Item(id=f"plz_{uuid4().hex}", kind=kind, share_id=share.share_id,
                    author_user_id=user_id, author_session_id=share.session_id,
                    title=title[:120], cover_meta_json=cover, created_at=now, updated_at=now, forks=forks)
        db.add(item)
    item.summary = options.summary
    item.subject = options.subject
    item.tags_json = [tag.strip()[:32] for tag in options.tags if tag.strip()]
    item.allow_fork = options.allow_fork
    item.status = "published"
    item.updated_at = now
    return item


def visible():
    workshop = exists().where(WorkshopShareRecord.share_id == Item.share_id, WorkshopShareRecord.revoked_at.is_(None))
    deck = exists().where(ShareRecord.share_id == Item.share_id, ShareRecord.revoked_at.is_(None),
                          MaterialRecord.id == ShareRecord.material_id, MaterialRecord.expires_at > to_iso(utc_now()))
    active = exists().where(UserRecord.id == Item.author_user_id, UserRecord.status == "active")
    return and_(Item.status == "published", or_(Item.is_featured, and_(active, or_(
        and_(Item.kind == "workshop", workshop), and_(Item.kind == "deck", deck),
    ))))


def avatar_url(profile):
    if profile is not None and profile.avatar_id:
        return f"{API_PREFIX}/creators/{profile.user_id}/avatar?v={profile.avatar_id}"
    return None


def dto(db, items, user_id):
    author_ids = {item.author_user_id for item in items if item.author_user_id}
    authors = {user.id: (user, profile) for user, profile in db.execute(
        select(UserRecord, UserProfileRecord).outerjoin(UserProfileRecord, UserProfileRecord.user_id == UserRecord.id)
        .where(UserRecord.id.in_(author_ids))
    )} if author_ids else {}
    reactions = defaultdict(set)
    if user_id and items:
        for reaction in db.scalars(select(Reaction).where(
            Reaction.user_id == user_id, Reaction.plaza_item_id.in_([item.id for item in items]),
        )):
            reactions[reaction.plaza_item_id].add(reaction.kind)
    data = []
    for item in items:
        author, profile = authors.get(item.author_user_id, (None, None))
        cover = item.cover_meta_json
        data.append({
            "id": item.id, "kind": item.kind, "share_id": item.share_id,
            "title": item.title, "summary": item.summary, "subject": item.subject,
            "tags": item.tags_json, "allow_fork": item.allow_fork, "is_featured": item.is_featured,
            "pinned": bool(cover.get("pinned")),
            "views": item.views, "likes": item.likes, "bookmarks": item.bookmarks, "forks": item.forks,
            "liked_by_me": "like" in reactions[item.id], "bookmarked_by_me": "bookmark" in reactions[item.id],
            "can_manage": user_id is not None and user_id == item.author_user_id,
            "created_at": item.created_at, "updated_at": item.updated_at,
            "cover": {key: cover[key] for key in ("node_count", "wire_count", "page_count", "theme_id", "preview_template", "page_no", "topology") if key in cover},
            "author": {"id": author.id if author else None, "display_name": author.display_name if author else "万象官方教研组",
                       "avatar_url": avatar_url(profile)},
        })
    return data


def optional_user(request, db):
    try:
        if not request.cookies:
            return None
        return active_account(db, require_auth_session(request, db).user_id).id
    except ApiError:
        return None


def private_response(request, data):
    response = ok(request, data)
    response.headers["Cache-Control"] = "private, no-store"
    return response


@router.get("/plaza")
def gallery(request: Request, db: DBDep, kind: Literal["workshop", "deck", "official"] | None = None,
            subject: Subject | None = None, q: str = Query("", max_length=120),
            sort: Literal["featured", "forks", "latest"] = "featured", author_id: str | None = None,
            source: Literal["all", "official", "community"] = "all",
            limit: int = Query(48, ge=1, le=100), offset: int = Query(0, ge=0)):
    user_id = optional_user(request, db)
    statement = select(Item).where(visible())
    if kind == "official":
        statement = statement.where(Item.is_featured)
    elif kind:
        statement = statement.where(Item.kind == kind)
    if source == "official":
        statement = statement.where(Item.is_featured)
    elif source == "community":
        statement = statement.where(Item.is_featured.is_(False))
    if subject:
        statement = statement.where(Item.subject == subject)
    if author_id:
        statement = statement.where(Item.author_user_id == author_id)
    if q.strip():
        statement = statement.where(or_(Item.title.icontains(q.strip(), autoescape=True),
                                         Item.summary.icontains(q.strip(), autoescape=True)))
    if sort != "latest":
        statement = statement.order_by((Item.forks if sort == "forks" else Item.is_featured).desc())
    rows = list(db.scalars(statement.order_by(Item.created_at.desc(), Item.id).offset(offset).limit(limit + 1)))
    return private_response(request, {"items": dto(db, rows[:limit], user_id), "has_more": len(rows) > limit})


@router.get("/plaza/shares/{share_id}")
def share_listing(share_id: str, request: Request, db: DBDep):
    user_id = optional_user(request, db)
    item = db.scalar(select(Item).where(visible(), Item.share_id == share_id))
    if item is None:
        raise resource_unavailable()
    db.execute(update(Item).where(Item.id == item.id).values(views=Item.views + 1))
    db.commit()
    result = dto(db, [item], user_id)[0]
    origin_id = item.cover_meta_json.get("origin")
    if origin_id:
        origin = db.scalar(select(Item).where(visible(), Item.share_id == origin_id))
        if origin:
            result["origin"] = dto(db, [origin], user_id)[0]
    return private_response(request, result)


@router.post("/plaza/items", status_code=201)
def add_listing(body: ListingCreate, request: Request, auth: AuthWriteDep, db: DBDep):
    ctx = require_session(request, db)
    if body.kind == "deck":
        from .routes_publish import load_shared, deck_listing_cover
        share, material = load_shared(db, body.share_id)
        title = share.snapshot_json.get("title") or material.title
        cover = deck_listing_cover(share.snapshot_json)
        forks = 0
    else:
        share = db.get(WorkshopShareRecord, body.share_id)
        if share is None or share.revoked_at:
            raise resource_unavailable()
        title = share.title
        from ..workshop.store import workshop_cover_meta
        cover = {"node_count": share.node_count, "origin": share.snapshot_json.get("forked_from_share"),
                 **workshop_cover_meta(share.snapshot_json.get("document"))}
        forks = share.forks
    if share.session_id != ctx.session_id:
        raise resource_unavailable()
    item = list_share(db, body.kind, share, auth.user_id, body, title=title, cover=cover, forks=forks)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise missing_field("作品已上架，请刷新广场后重试") from error
    return ok(request, dto(db, [item], auth.user_id)[0], 201)


def owned_listing(db, item_id, auth):
    active_account(db, auth.user_id)
    item = db.get(Item, item_id)
    if item is None or item.author_user_id != auth.user_id:
        raise resource_unavailable()
    return item


@router.patch("/plaza/items/{item_id}")
def change_listing(item_id: str, body: ListingPatch, request: Request, auth: AuthWriteDep, db: DBDep):
    item = owned_listing(db, item_id, auth)
    changes = body.model_dump(exclude_unset=True)
    pinned = changes.pop("pinned", None)
    if pinned is not None:
        # Serialize pin changes for the same creator, including concurrent requests.
        db.execute(update(UserRecord).where(UserRecord.id == auth.user_id).values(status=UserRecord.status))
        if pinned:
            for previous in db.scalars(select(Item).where(
                Item.author_user_id == auth.user_id, Item.id != item.id,
                Item.cover_meta_json["pinned"].as_boolean().is_(True),
            ).with_for_update()):
                previous.cover_meta_json = {**previous.cover_meta_json, "pinned": False}
        db.refresh(item, with_for_update=True)
        item.cover_meta_json = {**item.cover_meta_json, "pinned": pinned}
    for key, value in changes.items():
        setattr(item, key, value)
    item.updated_at = to_iso(utc_now())
    db.commit()
    return ok(request, dto(db, [item], auth.user_id)[0])


@router.delete("/plaza/items/{item_id}", status_code=204)
def remove_listing(item_id: str, request: Request, auth: AuthWriteDep, db: DBDep):
    item = owned_listing(db, item_id, auth)
    unlist_shares(db, [item.share_id])
    db.commit()
    return empty(request)


@router.post("/plaza/items/{item_id}/react")
def react(item_id: str, body: ReactRequest, request: Request, auth: AuthWriteDep, db: DBDep):
    active_account(db, auth.user_id)
    limit_account(auth.user_id, "react", 90)
    db.execute(update(Item).where(Item.id == item_id).values(likes=Item.likes))
    item = db.scalar(select(Item).where(Item.id == item_id, visible()).with_for_update())
    if item is None:
        raise resource_unavailable()
    reaction = db.scalar(select(Reaction).where(
        Reaction.plaza_item_id == item.id, Reaction.user_id == auth.user_id, Reaction.kind == body.kind,
    ).with_for_update())
    field = "likes" if body.kind == "like" else "bookmarks"
    if reaction:
        db.delete(reaction)
        setattr(item, field, max(0, getattr(item, field) - 1))
    else:
        db.add(Reaction(id=f"pr_{uuid4().hex}", plaza_item_id=item.id, user_id=auth.user_id,
                        kind=body.kind, created_at=to_iso(utc_now())))
        setattr(item, field, getattr(item, field) + 1)
    db.commit()
    return ok(request, dto(db, [item], auth.user_id)[0])


@router.get("/plaza/bookmarks")
def bookmarks(request: Request, auth: AuthSessionDep, db: DBDep, kind: Literal["workshop", "deck"] | None = None,
              limit: int = Query(48, ge=1, le=100), offset: int = Query(0, ge=0)):
    active_account(db, auth.user_id)
    filters = [visible(), Reaction.user_id == auth.user_id, Reaction.kind == "bookmark"]
    if kind:
        filters.append(Item.kind == kind)
    rows = list(db.scalars(select(Item).join(Reaction, Reaction.plaza_item_id == Item.id)
                .where(*filters)
                .order_by(Reaction.created_at.desc(), Reaction.id).offset(offset).limit(limit + 1)))
    return private_response(request, {"items": dto(db, rows[:limit], auth.user_id), "has_more": len(rows) > limit})


@router.get("/creators/{user_id}")
def creator(user_id: str, request: Request, db: DBDep, kind: Literal["workshop", "deck"] | None = None,
            limit: int = Query(48, ge=1, le=100), offset: int = Query(0, ge=0)):
    user = db.get(UserRecord, user_id)
    if user is None or user.status != "active":
        raise resource_unavailable()
    profile = db.get(UserProfileRecord, user_id)
    filt = [visible(), Item.author_user_id == user_id]
    if kind:
        filt.append(Item.kind == kind)
    filt = tuple(filt)
    count, likes, forks = db.execute(select(func.count(), func.sum(Item.likes), func.sum(Item.forks)).where(*filt)).one()
    items = list(db.scalars(select(Item).where(*filt).order_by(
        Item.cover_meta_json["pinned"].as_boolean().is_(True).desc(), Item.created_at.desc(), Item.id,
    ).offset(offset).limit(limit)))
    return private_response(request, {
        "id": user.id, "display_name": user.display_name, "avatar_url": avatar_url(profile),
        "bio": profile.bio if profile else "", "occupation": profile.occupation if profile else "",
        "school": profile.school if profile else "", "interests": interests_of(profile) if profile else [],
        "stats": {"count": count, "likes": likes or 0, "forks": forks or 0},
        "items": dto(db, items, optional_user(request, db)), "has_more": count > offset + limit,
    })


@router.get("/creators/{user_id}/avatar")
def creator_avatar(user_id: str, db: DBDep):
    user = db.get(UserRecord, user_id)
    profile = db.get(UserProfileRecord, user_id)
    if user is None or user.status != "active" or profile is None or not profile.avatar_id:
        raise resource_unavailable()
    path = avatar_path(user.id)
    if not path.is_file():
        raise resource_unavailable()
    return FileResponse(path, media_type="image/jpeg", headers={
        "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff",
    })

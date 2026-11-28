from .test_workshop import owner, guest, app, _session, _h


def test_plaza_seed_and_deck_fork(owner, guest):
    assert len(guest.get("/api/v1/plaza?kind=official").json()["data"]["items"]) == 12
    response = guest.get("/api/v1/plaza?kind=deck")
    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert len(items) >= 4
    entry = items[0]
    assert guest.get(f"/api/v1/p/{entry['share_id']}").status_code == 200
    session = _session(guest)
    response = guest.post(f"/api/v1/p/{entry['share_id']}/fork", headers=_h(session))
    assert response.status_code == 201, response.text
    material_id = response.json()["data"]["material_id"]
    _session(owner)
    assert owner.get(f"/api/v1/materials/{material_id}").status_code == 404
    assert guest.get(f"/api/v1/materials/{material_id}").status_code == 200
    current = guest.get(f"/api/v1/plaza/shares/{entry['share_id']}").json()["data"]
    assert current["forks"] == entry["forks"] + 1

def _account(client, name):
    from app.accounts import create_auth_session, register_account
    from app.db.session import session_scope
    from app.settings import get_settings

    with session_scope() as db:
        user = register_account(db, username=name, email=f"{name}@example.com", password="PlazaTest2026Pass")
        auth = create_auth_session(db, user_id=user.id, remember=False)
        client.cookies.set(get_settings().auth_cookie_name, auth.raw_token)
        return user.id, {"X-CSRF-Token": auth.csrf_token}


def test_account_listing_reactions_and_unlist(owner, guest):
    from .test_workshop import _create, DOC

    session = _session(owner)
    guest_session = _session(guest)
    guest_id, guest_auth = _account(guest, "plaza_reader")
    work_id = _create(owner, session)["work_id"]
    publish_url = f"/api/v1/works/{work_id}/publish"
    options = {"subject": "physics", "summary": "校验跨账号复刻"}
    assert owner.post(publish_url, headers=_h(session), json=options).status_code == 401
    user_id, owner_auth = _account(owner, "plaza_teacher")
    published = owner.post(publish_url, headers=_h(session), json=options)
    assert published.status_code == 201, published.text
    listing_id = published.json()["data"]["plaza_item_id"]
    share_id = published.json()["data"]["share_id"]
    listing = f"/api/v1/plaza/items/{listing_id}"
    share = f"/api/v1/work-shares/{share_id}"
    items = guest.get("/api/v1/plaza?kind=workshop&subject=physics&q=跨账号").json()["data"]["items"]
    assert [item["id"] for item in items] == [listing_id]
    assert items[0]["author"]["id"] == user_id
    assert next(i for i in guest.get("/api/v1/work-shares").json()["data"]["items"]
                if i["share_id"] == share_id)["can_delete"] is False
    assert guest.post("/api/v1/plaza/items", headers=guest_auth,
                      json={**options, "kind": "workshop", "share_id": share_id}).status_code == 404
    assert guest.patch(listing, headers=guest_auth, json={"title": "越权修改"}).status_code == 404
    assert guest.delete(listing, headers=guest_auth).status_code == 404
    assert guest.delete(share, headers=_h(guest_session)).status_code == 404
    assert guest.post(f"{listing}/react", headers=guest_auth, json={"kind": "like"}).json()["data"]["likes"] == 1
    assert guest.post(f"{listing}/react", headers=guest_auth, json={"kind": "like"}).json()["data"]["likes"] == 0
    assert guest.post(f"{listing}/react", headers=guest_auth, json={"kind": "bookmark"}).json()["data"]["bookmarked_by_me"]
    assert [i["id"] for i in guest.get("/api/v1/plaza/bookmarks").json()["data"]["items"]] == [listing_id]
    clone = guest.post(f"{share}/fork", headers=_h(guest_session))
    assert clone.status_code == 201, clone.text
    clone_id = clone.json()["data"]["work_id"]
    change = guest.patch(f"/api/v1/works/{clone_id}", headers=_h(guest_session),
                         json={"expected_revision": 1, "document": dict(DOC, title="独立修改")})
    assert change.status_code == 200, change.text
    assert guest.get(share).json()["data"]["title"] == DOC["title"]
    creator = guest.get(f"/api/v1/creators/{user_id}").json()["data"]
    assert creator["stats"] == {"count": 1, "likes": 0, "forks": 1}
    assert not ({"email", "phone", "session_id"} & creator.keys())
    assert guest_id != user_id
    assert owner.patch(listing, headers=owner_auth, json={"allow_fork": False, "pinned": True}).status_code == 200
    assert guest.get(f"/api/v1/creators/{user_id}").json()["data"]["items"][0]["pinned"]
    assert guest.post(f"{share}/fork", headers=_h(guest_session)).status_code == 404
    assert owner.delete(listing, headers=owner_auth).status_code == 204
    assert guest.get(share).status_code == 200
    assert guest.get(f"/api/v1/plaza/shares/{share_id}").status_code == 404
    assert guest.get("/api/v1/plaza/bookmarks").json()["data"]["items"] == []


def test_deck_publish_remix_uses_public_snapshot(owner, guest):
    session = _session(owner)
    _account(owner, "plaza_deck_author")
    created = owner.post("/api/v1/materials/blank", headers=_h(session), json={
        "title": "矩阵实验课", "template_id": "lecture",
    })
    assert created.status_code == 201, created.text
    material_id = created.json()["data"]["material_id"]
    url = f"/api/v1/materials/{material_id}"
    published = owner.post(f"{url}/publish", headers=_h(session), json={"plaza": {"subject": "math"}})
    assert published.status_code == 201, published.text
    share_id = published.json()["data"]["share_id"]
    assert owner.patch(url, headers=_h(session), json={"title": "后续修改"}).status_code == 200
    guest_session = _session(guest)
    restored = guest.post(f"/api/v1/p/{share_id}/fork", headers=_h(guest_session))
    assert restored.status_code == 201, restored.text
    restored_id = restored.json()["data"]["material_id"]
    document = guest.get(f"/api/v1/materials/{restored_id}/document").json()["data"]
    assert document["title"] == "矩阵实验课 · 改造"
    assert len(document["pages"]) == 4
    assert any(node["text"] == "矩阵实验课" for node in document["pages"][0]["nodes"])
    assert guest.post(f"/api/v1/materials/{restored_id}/publish", headers=_h(guest_session)).status_code == 201


def test_extract_canvas_topology_unit():
    from app.workshop.store import extract_canvas_topology

    doc = {
        "nodes": [
            {"id": "a", "type": "slider", "x": 0, "y": 0, "params": {}},
            {"id": "b", "type": "physicsStage", "x": 100, "y": 0, "params": {}},
            {"id": "c", "type": "trailView", "x": 100, "y": 100, "params": {}},
            {"id": "d", "type": "textNote", "x": 0, "y": 100, "params": {}, "text": "便签内容"},
        ],
        "wires": [
            {"id": "w1", "from": "a", "to": "b"},
            {"id": "w2", "from": "b", "to": "c"},
            {"id": "w3", "from": "a", "to": "ghost"},
        ],
    }
    topo = extract_canvas_topology(doc)
    assert topo is not None
    assert len(topo["nodes"]) == 4
    xs = [node["x"] for node in topo["nodes"]]
    ys = [node["y"] for node in topo["nodes"]]
    assert min(xs) >= 8 and max(xs) <= 92
    assert min(ys) >= 14 and max(ys) <= 86
    kinds = {node["kind"] for node in topo["nodes"]}
    assert kinds == {"control", "stage", "plot", "note"}
    assert all(len(node["label"]) <= 10 for node in topo["nodes"])
    # 悬空连线被丢弃，连线以节点下标引用
    assert topo["wires"] == [{"f": 0, "t": 1}, {"f": 1, "t": 2}]
    import json as _json
    assert len(_json.dumps(topo, ensure_ascii=False).encode("utf-8")) < 1024
    # 空画布与缺失文档返回 None，交由前端骨架图兜底
    assert extract_canvas_topology({}) is None
    assert extract_canvas_topology(None) is None
    # 超量节点与连线被截断
    big = {
        "nodes": [{"id": f"n{i}", "type": "slider", "x": i, "y": i % 7, "params": {}} for i in range(40)],
        "wires": [{"id": f"w{i}", "from": f"n{i}", "to": f"n{i + 1}"} for i in range(17)],
    }
    clipped = extract_canvas_topology(big)
    assert len(clipped["nodes"]) == 18
    assert len(clipped["wires"]) == 17  # 只有前 18 节点之间的连线有效


def test_workshop_listing_cover_topology_and_source_filter(owner, guest):
    from .test_workshop import _create

    session = _session(owner)
    _account(owner, "plaza_topo_author")
    work_id = _create(owner, session)["work_id"]
    published = owner.post(f"/api/v1/works/{work_id}/publish", headers=_h(session),
                           json={"subject": "physics", "summary": "拓扑封面校验"})
    assert published.status_code == 201, published.text
    share_id = published.json()["data"]["share_id"]
    listing = guest.get(f"/api/v1/plaza/shares/{share_id}").json()["data"]
    cover = listing["cover"]
    assert cover["wire_count"] == 1
    topo = cover.get("topology")
    assert topo and len(topo["nodes"]) == 2
    assert topo["wires"] == [{"f": 0, "t": 1}]
    assert all(set(node) == {"x", "y", "kind", "label"} for node in topo["nodes"])

    # source 过滤：官方精选 vs 创作者作品
    official = guest.get("/api/v1/plaza?kind=workshop&source=official").json()["data"]["items"]
    assert official and all(item["is_featured"] for item in official)
    assert all(item["share_id"] != share_id for item in official)
    community = guest.get("/api/v1/plaza?kind=workshop&source=community").json()["data"]["items"]
    assert any(item["share_id"] == share_id for item in community)
    assert not any(item["is_featured"] for item in community)
    mixed = guest.get("/api/v1/plaza?kind=workshop&source=all").json()["data"]["items"]
    assert any(item["is_featured"] for item in mixed)
    assert any(item["share_id"] == share_id for item in mixed)

    # 官方种子的封面元数据包含拓扑与连线数（seed 兜底一致）
    seeded = next(item for item in official if item["cover"].get("preview_template") == "projectile-drag")
    assert seeded["cover"]["wire_count"] == 5
    assert len(seeded["cover"]["topology"]["nodes"]) == 6

    # bookmarks 与 creator 的 kind 过滤
    user_id = listing["author"]["id"]
    _, owner_auth = _account(guest, "plaza_topo_reader")
    listing_id = listing["id"]
    guest.post(f"/api/v1/plaza/items/{listing_id}/react", headers=owner_auth, json={"kind": "bookmark"})
    saved = guest.get("/api/v1/plaza/bookmarks?kind=workshop").json()["data"]["items"]
    assert [item["id"] for item in saved] == [listing_id]
    deck_only = guest.get("/api/v1/plaza/bookmarks?kind=deck").json()["data"]["items"]
    assert deck_only == []
    creator_items = guest.get(f"/api/v1/creators/{user_id}?kind=workshop").json()["data"]["items"]
    assert any(item["id"] == listing_id for item in creator_items)
    creator_decks = guest.get(f"/api/v1/creators/{user_id}?kind=deck").json()["data"]
    assert creator_decks["items"] == []
    assert creator_decks["stats"]["count"] == 0

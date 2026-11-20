"""万象工坊 HTTP 端点集成测试：存取、发布画廊、fork、校验。"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Iterator

import pytest

_TMP_DIR = Path(tempfile.mkdtemp(prefix="xiangsheng-workshop-"))
os.environ["DATABASE_URL"] = "sqlite:///" + (_TMP_DIR / "test.db").as_posix()
os.environ["SESSION_COOKIE_SECURE"] = "false"
os.environ["ENFORCE_CSRF"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.db.session import reset_engine_cache  # noqa: E402
from app.settings import get_settings  # noqa: E402

get_settings.cache_clear()
reset_engine_cache()

from app.main import create_app  # noqa: E402


DOC = {
    "version": 1,
    "title": "抛体实验",
    "nodes": [
        {"id": "n1", "type": "projectile", "x": 10, "y": 10, "params": {"v0": 8}},
        {"id": "n2", "type": "trailView", "x": 300, "y": 10, "params": {}},
    ],
    "wires": [{"id": "w1", "from": "n1", "fromPort": "out", "to": "n2", "toPort": "in"}],
    "strokes": [],
    "zoom": 1,
}


def _session(client: TestClient) -> dict[str, Any]:
    resp = client.post("/api/v1/sessions")
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]


def _h(session: dict[str, Any]) -> dict[str, str]:
    return {"X-CSRF-Token": str(session["csrf_token"])}


@pytest.fixture(scope="module")
def app() -> Any:
    return create_app()


@pytest.fixture
def owner(app: Any) -> Iterator[TestClient]:
    with TestClient(app) as client:
        yield client


@pytest.fixture
def guest(app: Any) -> Iterator[TestClient]:
    with TestClient(app) as client:
        yield client


@pytest.fixture(scope="module", autouse=True)
def _cleanup() -> Iterator[None]:
    yield
    shutil.rmtree(_TMP_DIR, ignore_errors=True)


def _create(client: TestClient, session: dict[str, Any] | None = None, doc: dict[str, Any] | None = None) -> dict[str, Any]:
    session = session or _session(client)
    resp = client.post("/api/v1/works", headers=_h(session), json={"document": doc if doc is not None else DOC})
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]


def _patch(client: TestClient, session: dict[str, Any], wid: str, rev: int, doc: dict[str, Any]) -> Any:
    return client.patch(f"/api/v1/works/{wid}", headers=_h(session), json={"expected_revision": rev, "document": doc})


def test_create_list_patch(owner: TestClient) -> None:
    session = _session(owner)
    data = _create(owner, session)
    wid = data["work_id"]
    assert data["document"]["nodes"][0]["type"] == "projectile"

    lst = owner.get("/api/v1/works").json()["data"]["works"]
    assert any(w["work_id"] == wid for w in lst)

    resp = _patch(owner, session, wid, 1, dict(DOC, title="改名"))
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"]["revision"] == 2
    assert _patch(owner, session, wid, 1, dict(DOC)).status_code == 409  # 乐观锁


def test_publish_gallery_fork(owner: TestClient, guest: TestClient) -> None:
    session = _session(owner)
    wid = _create(owner, session)["work_id"]
    pub = owner.post(f"/api/v1/works/{wid}/publish", headers=_h(session))
    assert pub.status_code == 201, pub.text
    sid = pub.json()["data"]["share_id"]

    items = owner.get("/api/v1/work-shares").json()["data"]["items"]
    assert any(i["share_id"] == sid for i in items)

    snap = guest.get(f"/api/v1/work-shares/{sid}")
    assert snap.status_code == 200
    assert snap.json()["data"]["document"]["nodes"]

    gsession = _session(guest)
    fork = guest.post(f"/api/v1/work-shares/{sid}/fork", headers=_h(gsession))
    assert fork.status_code == 201, fork.text
    got = guest.get(f"/api/v1/works/{fork.json()['data']['work_id']}").json()["data"]
    assert got["forked_from_share"] == sid
    assert "改造" in got["document"]["title"]
    item = next(i for i in owner.get("/api/v1/work-shares").json()["data"]["items"] if i["share_id"] == sid)
    assert item["forks"] == 1

    assert owner.delete(f"/api/v1/work-shares/{sid}", headers=_h(session)).status_code == 204
    assert guest.get(f"/api/v1/work-shares/{sid}").status_code == 404


def test_validation_and_ownership(owner: TestClient, guest: TestClient) -> None:
    session = _session(owner)
    bad = dict(DOC, nodes=[{"id": "x"}], wires=[])
    assert owner.post("/api/v1/works", headers=_h(session), json={"document": bad}).status_code == 422
    dangling = dict(DOC, wires=[{"id": "w9", "from": "n1", "to": "ghost"}])
    data = _create(owner, session, dangling)
    assert data["document"]["wires"] == []
    _session(guest)
    assert guest.get(f"/api/v1/works/{data['work_id']}").status_code == 404


def test_composite_doc_validation(owner: TestClient) -> None:
    """自制积木文档：sub 子图与端口声明通过校验；非法端口被过滤。"""
    doc = {
        "version": 1, "title": "积木", "zoom": 1, "strokes": [],
        "nodes": [
            {"id": "s1", "type": "slider", "x": 0, "y": 0, "params": {"v": 0.5}},
            {
                "id": "c1", "type": "composite", "x": 10, "y": 10, "params": {}, "text": "旋转积木",
                "sub": {
                    "nodes": [
                        {"id": "pi1", "type": "portIn", "x": 0, "y": 0, "params": {}},
                        {"id": "r1", "type": "rotor", "x": 5, "y": 5, "params": {}},
                        {"id": "po1", "type": "portOut", "x": 9, "y": 9, "params": {}},
                    ],
                    "wires": [
                        {"id": "w1", "from": "pi1", "to": "r1", "toPort": "in"},
                        {"id": "w2", "from": "r1", "to": "po1", "toPort": "in"},
                    ],
                    "ports": [
                        {"id": "pi1", "dir": "in", "label": "t", "kind": "scalar"},
                        {"id": "po1", "dir": "out", "label": "M", "kind": "matrix2"},
                        {"id": "ghost", "dir": "out", "label": "x"},  # 非内部节点 → 应被过滤
                    ],
                },
            },
        ],
        "wires": [{"id": "w0", "from": "s1", "to": "c1", "toPort": "pi1"}],
    }
    data = _create(owner, doc=doc)
    sub = data["document"]["nodes"][1]["sub"]
    assert len(sub["nodes"]) == 3 and len(sub["wires"]) == 2
    assert [p["id"] for p in sub["ports"]] == ["pi1", "po1"]


def test_delete_work(owner: TestClient) -> None:
    session = _session(owner)
    wid = _create(owner, session)["work_id"]
    assert owner.delete(f"/api/v1/works/{wid}", headers=_h(session)).status_code == 204
    assert owner.get(f"/api/v1/works/{wid}").status_code == 404


def test_panel_contract_validation(owner: TestClient) -> None:
    session = _session(owner)
    doc = dict(
        DOC,
        panel={
            "title": "抛体面板",
            "view_node_ids": ["n2"],
            "exposed_params": [
                {"node_id": "n1", "param_key": "v0", "label": "初速度", "min": 1, "max": 30, "step": 1},
                {"node_id": "n1", "param_key": "bad", "label": "非法范围", "min": 10, "max": 5},
            ],
            "read_only_layout": True,
        },
    )
    created = _create(owner, session, doc)
    panel = created["document"]["panel"]
    assert panel["title"] == "抛体面板"
    assert panel["view_node_ids"] == ["n2"]
    assert len(panel["exposed_params"]) == 1
    assert panel["exposed_params"][0]["max"] == 30
    assert panel["read_only_layout"] is True

    # 显式传入 panel=None 不报错，且不持久化空字段
    cleared = _create(owner, session, dict(DOC, panel=None))
    assert "panel" not in cleared["document"]

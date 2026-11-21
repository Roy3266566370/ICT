"""万象活页 HTTP 端点集成测试（独立临时数据库与资产目录，不触发真实模型）。"""

from __future__ import annotations

import io
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Iterator

import pytest

_TMP_DIR = Path(tempfile.mkdtemp(prefix="xiangsheng-living-"))
os.environ["DATABASE_URL"] = "sqlite:///" + (_TMP_DIR / "test.db").as_posix()
os.environ["SESSION_COOKIE_SECURE"] = "false"
os.environ["ENFORCE_CSRF"] = "true"
os.environ["LAB_AI_ENABLED"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from app.db.session import reset_engine_cache  # noqa: E402
from app.settings import get_settings  # noqa: E402

get_settings.cache_clear()
reset_engine_cache()

from app.main import create_app  # noqa: E402

import app.api.routes_living as routes_living  # noqa: E402

routes_living.LIVING_DIR = _TMP_DIR / "living"


def _session(client: TestClient) -> dict[str, Any]:
    response = client.post("/api/v1/sessions")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _headers(session: dict[str, Any]) -> dict[str, str]:
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


PROBLEM = "解方程组：2x+y-z=8，-3x-y+2z=-11，-2x+y+2z=-3"
TEXT = f"第三章 线性方程组\n\n本章学习高斯消元。\n\n{PROBLEM}"


def _create_text_page(client: TestClient, text: str = TEXT) -> tuple[dict[str, Any], dict[str, Any]]:
    session = _session(client)
    response = client.post(
        "/api/v1/pages/text",
        headers=_headers(session),
        json={"title": "测试活页", "text": text},
    )
    assert response.status_code == 201, response.text
    return session, response.json()["data"]


def test_text_page_lifecycle(owner: TestClient) -> None:
    session, document = _create_text_page(owner)
    page_id = document["page_id"]

    assert document["schema_version"] == "page.1"
    assert document["blocks"], "应有保真块"
    conversion = document["provenance"]["conversion"]
    assert conversion["pages_total"] == 1

    suggestions = [s for s in document["suggestions"] if s["status"] == "pending"]
    assert any(s["kind"] == "lab" for s in suggestions), "应检测到题目并给出实验建议"

    # 列表与详情
    listing = owner.get("/api/v1/pages", headers={})
    assert listing.status_code == 200
    assert any(p["page_id"] == page_id for p in listing.json()["data"]["pages"])

    fetched = owner.get(f"/api/v1/pages/{page_id}")
    assert fetched.status_code == 200

    # 乐观锁：错 revision 拒绝
    bad = owner.patch(
        f"/api/v1/pages/{page_id}",
        headers=_headers(session),
        json={"expected_revision": 99, "title": "改名"},
    )
    assert bad.status_code == 409, bad.text

    # 改标题 + 重排块（把首块挪到末尾）
    blocks = list(document["blocks"])
    blocks.append(blocks.pop(0))
    patched = owner.patch(
        f"/api/v1/pages/{page_id}",
        headers=_headers(session),
        json={"expected_revision": document["revision"], "title": "活页A", "blocks": blocks},
    )
    assert patched.status_code == 200, patched.text
    updated = patched.json()["data"]
    assert updated["title"] == "活页A"
    assert updated["revision"] == document["revision"] + 1


def test_unknown_blocks_save_move_read_publish(owner: TestClient, guest: TestClient) -> None:
    session, document = _create_text_page(owner, "旧版普通文档")
    url = f"/api/v1/pages/{document['page_id']}"
    unknown = {"id": "future_block", "type": "vendor.future", "data": {
        "html": '<script>alert(1)</script><img src=x onerror="alert(2)">',
        "nested": {"items": [None, True, 42, 1.25, "中文"]},
        "problem": {"source_pages": [{"stored_name": "opaque-data"}]},
        "url": "javascript:alert(3)", "type": "lab"}}
    blocks = [unknown, *document["blocks"]]
    for ordered in (blocks, blocks[1:] + blocks[:1]):
        response = owner.patch(url, headers=_headers(session), json={
            "expected_revision": document["revision"], "title": "多字段保存", "blocks": ordered})
        assert response.status_code == 200, response.text
        document = response.json()["data"]
        assert document["blocks"] == ordered
        fetched = owner.get(url)
        assert fetched.status_code == 200
        assert fetched.headers["content-type"].startswith("application/json")
        assert fetched.json()["data"] == document
        assert document["schema_version"] == "page.1"
    published = owner.post(url + "/publish", headers=_headers(session))
    assert published.status_code == 201, published.text
    public = guest.get(f"/api/v1/page-shares/{published.json()['data']['share_id']}")
    assert public.status_code == 200
    assert public.headers["content-type"].startswith("application/json")
    snap = public.json()["data"]
    assert snap["schema_version"] == "page.1"
    assert snap["blocks"] == document["blocks"]
    assert snap["blocks"][-1] == unknown


@pytest.mark.parametrize("kind,data", [("lab", {}), ("canvas", {}),
    ("quiz", {"value": "NaN"}), ("quiz", {"min": 4, "max": 2, "value": 3}),
    ("embed", {"url": "https://"}), ("embed", {"url": "javascript:alert(1)"}),
    ("future", {"payload": "x" * 65536})])
def test_invalid_block_edit_is_atomic(owner: TestClient, kind, data) -> None:
    session, document = _create_text_page(owner, "旧版普通文档")
    url = f"/api/v1/pages/{document['page_id']}"
    response = owner.patch(url, headers=_headers(session), json={
        "expected_revision": document["revision"], "title": "不应保存",
        "blocks": [{"id": "bad", "type": kind, "data": data}]})
    assert response.status_code == 422, response.text
    assert owner.get(url).json()["data"] == document


def test_suggestion_accept_and_dismiss(owner: TestClient) -> None:
    session, document = _create_text_page(owner)
    page_id = document["page_id"]
    lab_sug = next(s for s in document["suggestions"] if s["kind"] == "lab")

    accepted = owner.post(
        f"/api/v1/pages/{page_id}/suggestions/{lab_sug['id']}/accept",
        headers=_headers(session),
    )
    assert accepted.status_code == 200, accepted.text
    inserted = accepted.json()["data"]["inserted"]
    assert inserted[0]["type"] == "lab"
    problem = inserted[0]["data"]["problem"]
    assert problem["subject"] == "linear_algebra"
    assert "states" not in problem

    # 重复接受 → 422
    again = owner.post(
        f"/api/v1/pages/{page_id}/suggestions/{lab_sug['id']}/accept",
        headers=_headers(session),
    )
    assert again.status_code == 422

    # 忽略
    formula_sug = next(
        (s for s in document["suggestions"] if s["kind"] == "formula"), None
    )
    if formula_sug is not None:
        dismissed = owner.post(
            f"/api/v1/pages/{page_id}/suggestions/{formula_sug['id']}/dismiss",
            headers=_headers(session),
        )
        assert dismissed.status_code == 200


def test_lab_block_endpoint(owner: TestClient) -> None:
    session, document = _create_text_page(owner)
    page_id = document["page_id"]
    response = owner.post(
        f"/api/v1/pages/{page_id}/lab-block",
        headers=_headers(session),
        json={"text": "求矩阵 A=[[2,1],[1,3]] 的行列式"},
    )
    assert response.status_code == 201, response.text
    block = response.json()["data"]["block"]
    assert block["type"] == "lab"
    assert block["data"]["problem"]["model"].get("la_kind") == "determinant"

    bad = owner.post(
        f"/api/v1/pages/{page_id}/lab-block",
        headers=_headers(session),
        json={"text": "今天天气很好去公园散步"},
    )
    assert bad.status_code == 422


def _png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (320, 200), "#ffffff")
    draw = ImageDraw.Draw(image)
    draw.text((20, 80), "x+1=3", fill="#222222")
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def test_image_upload_exposes_region_hotspots(owner: TestClient) -> None:
    session = _session(owner)
    response = owner.post(
        "/api/v1/pages",
        headers=_headers(session),
        files=[("files", ("formula.png", _png_bytes(), "image/png"))],
    )
    assert response.status_code == 201, response.text
    document = response.json()["data"]
    page = next(block for block in document["blocks"] if block["type"] == "page")
    regions = page["data"].get("regions") or []
    assert regions, "图片上传应留下原页热区"
    region = regions[0]
    assert 0 <= region["bbox"][0] < region["bbox"][2] <= 1
    asset = owner.get(f"/api/v1/pages/{document['page_id']}/assets/{region['asset_id']}")
    assert asset.status_code == 200

    published = owner.post(
        f"/api/v1/pages/{document['page_id']}/publish", headers=_headers(session),
    )
    assert published.status_code == 201, published.text
    share_id = published.json()["data"]["share_id"]
    public_asset = owner.get(f"/api/v1/page-shares/{share_id}/assets/{region['asset_id']}")
    assert public_asset.status_code == 200


def test_upload_publish_progress_and_insights(owner: TestClient, guest: TestClient) -> None:
    session = _session(owner)
    response = owner.post(
        "/api/v1/pages",
        headers=_headers(session),
        files=[("files", ("note.txt", TEXT.encode("utf-8"), "text/plain"))],
    )
    assert response.status_code == 201, response.text
    document = response.json()["data"]
    page_id = document["page_id"]

    # 发布
    image_key = document["source"]["pages"][0]["image_key"]
    assert owner.get(f"/api/v1/pages/{page_id}/assets/{image_key}").status_code == 200
    published = owner.post(f"/api/v1/pages/{page_id}/publish", headers=_headers(session))
    assert published.status_code == 201, published.text
    share = published.json()["data"]
    share_id = share["share_id"]
    assert guest.get(f"/api/v1/page-shares/{share_id}/assets/{image_key}").status_code == 200

    # 公开读取（游客无需会话）：快照不含 suggestions 与 stored_name
    public = guest.get(f"/api/v1/page-shares/{share_id}")
    assert public.status_code == 200
    snap = public.json()["data"]
    assert "suggestions" not in snap
    assert snap["share_id"] == share_id

    # 游客上报进度（先建自己的会话）
    guest_session = _session(guest)
    blocks = [b for b in snap["blocks"] if b["type"] != "section"]
    target = blocks[0]["id"]
    progress = guest.post(
        f"/api/v1/page-shares/{share_id}/progress",
        headers=_headers(guest_session),
        json={"block_id": target, "patch": {"quiz_guess": 2.5}},
    )
    assert progress.status_code == 200, progress.text

    # 不存在的块 → 422
    bad = guest.post(
        f"/api/v1/page-shares/{share_id}/progress",
        headers=_headers(guest_session),
        json={"block_id": "blk_nope", "patch": {}},
    )
    assert bad.status_code == 422

    # 老师端聚合
    insights = owner.get(f"/api/v1/pages/{page_id}/insights")
    assert insights.status_code == 200
    data = insights.json()["data"]
    assert data["viewers"] == 1
    assert data["blocks"][target]["visits"] == 1
    assert data["blocks"][target]["quiz_guesses"] == [2.5]

    # 删除后公开链接 404
    deleted = owner.delete(f"/api/v1/pages/{page_id}", headers=_headers(session))
    assert deleted.status_code == 204
    assert guest.get(f"/api/v1/page-shares/{share_id}").status_code == 404


def test_upload_rejects_bad_file(owner: TestClient) -> None:
    session = _session(owner)
    response = owner.post(
        "/api/v1/pages",
        headers=_headers(session),
        files=[("files", ("evil.exe", b"MZ\x90\x00" * 10, "application/octet-stream"))],
    )
    assert response.status_code == 400, response.text


def test_other_session_cannot_read(owner: TestClient, guest: TestClient) -> None:
    _, document = _create_text_page(owner)
    page_id = document["page_id"]
    _session(guest)  # 有会话但不是所有者 → 404 而非 401
    assert guest.get(f"/api/v1/pages/{page_id}").status_code == 404


def test_ai_model_generation_cache_replace_and_publish(owner: TestClient, guest: TestClient, monkeypatch) -> None:
    import app.ppt_ai.page_lab as page_lab
    calls = []

    def generate(context, **kwargs):
        calls.append(context)
        return {
            "version": page_lab.PAGE_LAB_VERSION, "page_no": 1, "title": "AI 自行设计的归一化实验",
            "summary": "调节温度观察权重", "params": [{"id": "t", "label": "温度", "min": 0.1,
                "max": 3, "step": 0.1, "default": 1, "unit": ""}], "explain": ["示例数据"],
            "program": page_lab.EXAMPLE_PROGRAM.replace("input.temp", "input.t"),
            "content_hash": "test-model", "generator": {"model": "test-ai", "attempts": 1}, "created_at": "2026-11-11T00:00:00Z",
        }

    monkeypatch.setattr(page_lab, "generate_page_lab", generate)
    session, doc = _create_text_page(owner, "自注意力模型通过 Query 和 Key 计算权重，对 Value 加权求和。")
    anchor = next(b for b in doc["blocks"] if b["type"] == "text")
    url = f"/api/v1/pages/{doc['page_id']}/ai-models"
    body = {"block_id": anchor["id"], "expected_revision": doc["revision"], "instruction": "设计可比较温度的实验，不复刻原图"}
    response = owner.post(url, headers=_headers(session), json=body)
    assert response.status_code == 200, response.text
    result = response.json()["data"]
    assert result["cached"] is False
    # 新契约：AI 只产 pending 建议，文档块不变
    assert result["document"]["blocks"] == doc["blocks"]
    sug = result["suggestion"]
    assert sug["status"] == "pending" and sug["kind"] == "canvas_object"
    assert sug["proposal"]["template"] == "page_lab"
    assert sug["proposal"]["anchor_id"] == anchor["id"]
    assert sug["proposal"]["lab"]["program"]
    assert calls[0]["design_goal"] == body["instruction"]
    assert "自注意力" in calls[0]["page_text"]

    # 相同输入再调命中缓存，不再调 AI
    body["expected_revision"] = result["document"]["revision"]
    cached = owner.post(url, headers=_headers(session), json=body).json()["data"]
    assert cached["cached"] is True and len(calls) == 1
    assert cached["suggestion"]["id"] == sug["id"]

    # force 重新设计：新建议替换同块旧 pending 建议
    body["force"] = True
    regenerated = owner.post(url, headers=_headers(session), json=body)
    assert regenerated.status_code == 200, regenerated.text
    fresh = regenerated.json()["data"]
    assert len(calls) == 2
    pending_lab = [s for s in fresh["document"]["suggestions"]
                   if s["status"] == "pending" and s["kind"] == "canvas_object"
                   and s["proposal"]["template"] == "page_lab"]
    assert len(pending_lab) == 1
    sug2 = pending_lab[0]

    # 激活建议 → 物化为真实可编辑的 pageLabSim 画布块
    accepted = owner.post(
        f"/api/v1/pages/{doc['page_id']}/suggestions/{sug2['id']}/accept",
        headers=_headers(session))
    assert accepted.status_code == 200, accepted.text
    blocks = accepted.json()["data"]["document"]["blocks"]
    canvas = next(b for b in blocks if b["type"] == "canvas")
    cdoc = canvas["data"]["doc"]
    assert cdoc["version"] == 1
    node = next(n for n in cdoc["nodes"] if n["type"] == "pageLabSim")
    payload = json.loads(node["payload"])
    assert payload["anchor_id"] == anchor["id"]
    assert payload["kind"] == "page_lab"
    assert payload["program"]
    # 可调参数落进 node.params → 页面级 bindings 可驱动
    assert node["params"]["t"] == pytest.approx(1.0)
    sug2_state = next(s for s in accepted.json()["data"]["document"]["suggestions"]
                      if s["id"] == sug2["id"])
    assert sug2_state["status"] == "accepted"

    published = owner.post(f"/api/v1/pages/{doc['page_id']}/publish", headers=_headers(session)).json()["data"]
    public = guest.get(f"/api/v1/page-shares/{published['share_id']}").json()["data"]
    assert any(b["type"] == "canvas" and b["data"]["doc"]["version"] == 1
               and any(n["type"] == "pageLabSim" for n in b["data"]["doc"]["nodes"])
               for b in public["blocks"])


def test_canvas_block_uses_workshop_validation(owner: TestClient) -> None:
    session, doc = _create_text_page(owner)
    page_url = f"/api/v1/pages/{doc['page_id']}"
    canvas = {
        "id": "canvas_valid", "type": "canvas",
        "data": {"doc": {
            "version": 1, "title": "工坊验收",
            "nodes": [{"id": "n1", "type": "functionSource", "x": 10, "y": 20, "params": {"a": 1, "b": 0, "c": 0}, "text": "x^2"}],
            "wires": [], "strokes": [], "zoom": 1,
        }},
    }
    saved = owner.patch(page_url, headers=_headers(session),
                        json={"expected_revision": doc["revision"], "blocks": [canvas]})
    assert saved.status_code == 200, saved.text
    saved_block = saved.json()["data"]["blocks"][0]
    assert saved_block["data"]["doc"]["nodes"][0]["type"] == "functionSource"

    oversized = {
        "id": "canvas_too_large", "type": "canvas",
        "data": {"doc": {
            "version": 1,
            "nodes": [{"id": f"n{index}", "type": "functionSource", "x": 0, "y": 0, "params": {}}
                      for index in range(301)],
            "wires": [], "strokes": [], "zoom": 1,
        }},
    }
    rejected = owner.patch(page_url, headers=_headers(session),
                           json={"expected_revision": saved.json()["data"]["revision"], "blocks": [oversized]})
    assert rejected.status_code == 422, rejected.text


def test_ai_model_rejects_unowned_stale_and_empty_without_calling_ai(owner: TestClient, guest: TestClient, monkeypatch) -> None:
    import app.ppt_ai.page_lab as page_lab
    monkeypatch.setattr(page_lab, "generate_page_lab", lambda *a, **k: pytest.fail("invalid request must not call AI"))
    session, doc = _create_text_page(owner)
    anchor = next(b for b in doc["blocks"] if b["type"] == "text")
    url = f"/api/v1/pages/{doc['page_id']}/ai-models"
    body = {"block_id": anchor["id"], "expected_revision": 999}
    assert owner.post(url, headers=_headers(session), json=body).status_code == 409
    other = _session(guest)
    body["expected_revision"] = doc["revision"]
    assert guest.post(url, headers=_headers(other), json=body).status_code == 404
    body["block_id"] = doc["blocks"][0]["id"]
    assert owner.post(url, headers=_headers(session), json=body).status_code == 422


def test_ai_failure_keeps_document(owner: TestClient, monkeypatch) -> None:
    import app.ppt_ai.page_lab as page_lab
    from app.ppt_ai.client import PPTAIError
    def fail(*args, **kwargs):
        raise PPTAIError("timeout", "模型调用超时")
    monkeypatch.setattr(page_lab, "generate_page_lab", fail)
    session, doc = _create_text_page(owner)
    anchor = next(b for b in doc["blocks"] if b["type"] == "text")
    response = owner.post(f"/api/v1/pages/{doc['page_id']}/ai-models", headers=_headers(session),
                          json={"block_id": anchor["id"], "expected_revision": doc["revision"]})
    assert response.status_code == 503
    assert owner.get(f"/api/v1/pages/{doc['page_id']}").json()["data"] == doc


def test_ai_generation_cannot_overwrite_concurrent_edit(owner: TestClient, monkeypatch) -> None:
    from app.db.session import get_session_factory
    from app.db.models import LivingPageRecord
    from app.ppt_ai import page_lab
    session, doc = _create_text_page(owner)
    anchor = next(b for b in doc["blocks"] if b["type"] == "text")
    def concurrent(context, **kwargs):
        with get_session_factory()() as db:
            row = db.get(LivingPageRecord, doc["page_id"])
            updated = dict(row.document)
            updated["title"] = "并发编辑后的标题"
            updated["revision"] = row.revision + 1
            row.document = updated
            row.revision += 1
            row.title = updated["title"]
            db.commit()
        return {"version": page_lab.PAGE_LAB_VERSION, "page_no": 1, "title": "生成模型",
                "summary": "模型", "explain": [], "params": [{"id": "temp", "min": 0.1, "max": 3, "default": 1}],
                "program": page_lab.EXAMPLE_PROGRAM, "generator": {"model": "test"}, "content_hash": "test"}
    monkeypatch.setattr(page_lab, "generate_page_lab", concurrent)
    response = owner.post(f"/api/v1/pages/{doc['page_id']}/ai-models", headers=_headers(session),
                          json={"block_id": anchor["id"], "expected_revision": doc["revision"]})
    assert response.status_code == 409, response.text
    latest = owner.get(f"/api/v1/pages/{doc['page_id']}").json()["data"]
    assert latest["title"] == "并发编辑后的标题"
    assert latest["blocks"] == doc["blocks"]


def test_ai_recommendations_cache_and_content_invalidation(owner: TestClient, guest: TestClient, monkeypatch) -> None:
    from app.living import ai
    calls = []
    def recommend(document):
        calls.append(document)
        anchor = next(b for b in document["blocks"] if b["type"] == "text")
        return {"summary": "适合交互", "reviewed_blocks": 1, "existing_models": 0, "truncated_blocks": 0,
                "recommendations": [{"block_id": anchor["id"], "title": "权重实验", "page": 1,
                  "reason": "观察分布", "interaction": "调温度", "observation": "权重", "design_goal": "观察温度影响"}]}
    monkeypatch.setattr(ai, "recommend_models", recommend)
    session, doc = _create_text_page(owner)
    url = f"/api/v1/pages/{doc['page_id']}/ai-recommendations"
    body = {"expected_revision": doc["revision"]}
    response = owner.post(url, headers=_headers(session), json=body)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["cached"] is False
    assert owner.post(url, headers=_headers(session), json=body).json()["data"]["cached"] is True
    assert len(calls) == 1
    assert owner.get(f"/api/v1/pages/{doc['page_id']}").json()["data"] == doc
    edited = owner.patch(f"/api/v1/pages/{doc['page_id']}", headers=_headers(session),
                         json={"expected_revision": doc["revision"], "title": "修订讲义"}).json()["data"]
    body["expected_revision"] = edited["revision"]
    assert owner.post(url, headers=_headers(session), json=body).json()["data"]["cached"] is False
    assert len(calls) == 2
    other = _session(guest)
    assert guest.post(url, headers=_headers(other), json=body).status_code == 404
    body["expected_revision"] = 999
    assert owner.post(url, headers=_headers(session), json=body).status_code == 409
    assert len(calls) == 2


def test_ai_recommendations_discard_result_after_concurrent_edit(owner: TestClient, monkeypatch) -> None:
    from app.living import ai
    from app.db.session import get_session_factory
    from app.db.models import LivingPageRecord
    session, doc = _create_text_page(owner)
    def recommend(document):
        with get_session_factory()() as db:
            row = db.get(LivingPageRecord, doc["page_id"])
            row.revision += 1
            db.commit()
        return {"recommendations": []}
    monkeypatch.setattr(ai, "recommend_models", recommend)
    response = owner.post(f"/api/v1/pages/{doc['page_id']}/ai-recommendations", headers=_headers(session),
                          json={"expected_revision": doc["revision"]})
    assert response.status_code == 409, response.text


def test_grade_endpoint(owner: TestClient) -> None:
    session = _session(owner)
    grade = lambda body: owner.post("/api/v1/living/grade", headers=_headers(session), json=body)
    assert grade({"answer": "1/2", "expected": "0.5", "mode": "expr"}).json()["data"]["correct"] is True
    assert grade({"answer": "x^2+C", "expected": "C+x^2", "mode": "expr"}).json()["data"]["correct"] is True
    assert grade({"answer": "x+1", "expected": "x^2", "mode": "expr"}).json()["data"]["correct"] is False
    assert grade({"answer": "1/2", "expected": "0.5", "mode": "exact"}).json()["data"]["correct"] is False
    assert grade({"answer": "x+1", "expected": "2", "mode": "numeric"}).json()["data"]["correct"] is False
    result = grade({"answer": "0.5", "expected": "1/2", "mode": "numeric"})
    assert result.status_code == 200 and result.json()["data"]["correct"] is True


def test_variables_patch_roundtrip_and_publish(owner: TestClient, guest: TestClient) -> None:
    session, doc = _create_text_page(owner)
    assert doc.get("variables") == {}
    variables = {"eta": {"label": "学习率", "type": "number", "value": 0.05, "min": 0, "max": 1, "step": 0.01}}
    patched = owner.patch(f"/api/v1/pages/{doc['page_id']}", headers=_headers(session),
                          json={"expected_revision": doc["revision"], "variables": variables})
    assert patched.status_code == 200, patched.text
    assert patched.json()["data"]["variables"]["eta"]["label"] == "学习率"
    # 非法变量被拒且文档不变
    bad = owner.patch(f"/api/v1/pages/{doc['page_id']}", headers=_headers(session),
                      json={"expected_revision": patched.json()["data"]["revision"],
                            "variables": {"1bad": {"type": "number", "value": 0}}})
    assert bad.status_code == 422, bad.text
    # 变量+绑定块一起发布，分享快照冻结
    latest = patched.json()["data"]
    blocks = latest["blocks"] + [{"id": "blk_v1", "type": "text",
                                  "data": {"md": "当前学习率 ${eta}"},
                                  "bindings": None}]
    saved = owner.patch(f"/api/v1/pages/{doc['page_id']}", headers=_headers(session),
                        json={"expected_revision": latest["revision"], "blocks": [
                            {k: v for k, v in b.items() if v is not None} for b in blocks]})
    assert saved.status_code == 200, saved.text
    published = owner.post(f"/api/v1/pages/{doc['page_id']}/publish", headers=_headers(session))
    assert published.status_code == 201, published.text
    share_url = published.json()["data"]["share_url"]
    share_id = share_url.rstrip("/").split("/")[-1]
    other = _session(guest)
    shared = guest.get(f"/api/v1/page-shares/{share_id}", headers=_headers(other))
    assert shared.status_code == 200, shared.text
    assert shared.json()["data"]["variables"]["eta"]["value"] == pytest.approx(0.05)


def test_region_formula_ocr_on_demand(owner: TestClient, monkeypatch) -> None:
    """P1.1：公式 OCR 只在点击时跑一次，latex/expression 缓存回文档。"""
    import app.labs.extract as extract_mod

    session = _session(owner)
    response = owner.post(
        "/api/v1/pages",
        headers=_headers(session),
        files=[("files", ("formula.png", _png_bytes(), "image/png"))],
    )
    assert response.status_code == 201, response.text
    doc = response.json()["data"]
    page = next(b for b in doc["blocks"] if b["type"] == "page")
    region = (page["data"].get("regions") or [])[0]
    # 上传后区域应不带 latex（公式 OCR 已移出上传链路）
    assert not region.get("latex")

    # 把区域标为公式类型（模拟公式热区）
    page["data"]["regions"][0]["kind"] = "formula"
    patched = owner.patch(
        f"/api/v1/pages/{doc['page_id']}", headers=_headers(session),
        json={"expected_revision": doc["revision"], "blocks": doc["blocks"]},
    )
    assert patched.status_code == 200, patched.text
    doc = patched.json()["data"]

    calls: list[object] = []
    monkeypatch.setattr(extract_mod, "_math_ocr",
                        lambda img: calls.append(img) or "y = x^{2} + a")
    ok = owner.post(
        f"/api/v1/pages/{doc['page_id']}/regions/{region['id']}/formula-ocr",
        headers=_headers(session),
        json={"expected_revision": doc["revision"]},
    )
    assert ok.status_code == 200, ok.text
    latest = ok.json()["data"]
    updated = next(b for b in latest["blocks"] if b["type"] == "page")["data"]["regions"][0]
    assert updated["latex"] == "y = x^{2} + a"
    assert "x^2" in updated["expression"] and "a" in updated["expression"]
    assert updated["params"] == ["a"]
    assert len(calls) == 1

    # 已有 latex → 缓存命中，不再调用 OCR
    again = owner.post(
        f"/api/v1/pages/{doc['page_id']}/regions/{region['id']}/formula-ocr",
        headers=_headers(session),
        json={"expected_revision": latest["revision"]},
    )
    assert again.status_code == 200, again.text
    assert len(calls) == 1

    # 非公式区域 → 拒绝；OCR 无结果 → 4xx，区域不伪造 latex
    doc2 = again.json()["data"]
    page2 = next(b for b in doc2["blocks"] if b["type"] == "page")
    page2["data"]["regions"][0]["kind"] = "diagram"
    page2["data"]["regions"][0].pop("latex", None)
    page2["data"]["regions"][0].pop("expression", None)
    page2["data"]["regions"][0].pop("params", None)
    patched2 = owner.patch(
        f"/api/v1/pages/{doc2['page_id']}", headers=_headers(session),
        json={"expected_revision": doc2["revision"], "blocks": doc2["blocks"]},
    )
    assert patched2.status_code == 200, patched2.text
    doc3 = patched2.json()["data"]
    wrong_kind = owner.post(
        f"/api/v1/pages/{doc3['page_id']}/regions/{region['id']}/formula-ocr",
        headers=_headers(session),
        json={"expected_revision": doc3["revision"]},
    )
    assert wrong_kind.status_code in (400, 422), wrong_kind.text

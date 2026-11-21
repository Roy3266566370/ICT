"""P2 流程图：图结构校验、视觉证据匹配、PPTX 连接线确定性转译、按需转译端点。"""

from __future__ import annotations

import io
import os
import tempfile
from pathlib import Path
from typing import Any, Iterator

import pytest
from PIL import Image
from pptx import Presentation
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.util import Emu

from app.documents.regions import regions_for_pptx_slide
from app.living.diagram import (
    cache_key,
    diagram_from_shapes,
    diagram_from_vision,
    validate_diagram,
)


def _doc(nodes=None, edges=None, **kw):
    return {
        "nodes": nodes or [
            {"id": "a", "label": "输入", "x": 0.2, "y": 0.3, "shape": "rect"},
            {"id": "b", "label": "输出", "x": 0.8, "y": 0.7, "shape": "oval"},
        ],
        "edges": edges or [{"from": "a", "to": "b", "label": "经过"}],
        **kw,
    }


def test_validate_diagram_normalizes_and_caps() -> None:
    doc = validate_diagram(_doc(
        nodes=[{"id": "a", "label": "  输入 框 ", "x": -0.5, "y": 1.8, "shape": "DIAMOND"},
               {"id": "b", "label": "x" * 100, "x": 0.5, "y": 0.5, "shape": "weird"}],
        edges=[{"from": "a", "to": "b"}, {"from": "a", "to": "ghost"},
               {"from": "a", "to": "a"}, {"from": "b", "to": "a", "label": "回"}],
        order=["b", "ghost", "a", "a"],
        warnings=["w1", " ", "w3"],
        confidence=7,
    ))
    assert doc["nodes"][0]["shape"] == "diamond"
    assert doc["nodes"][0]["x"] == 0.0 and doc["nodes"][0]["y"] == 1.0
    assert doc["nodes"][1]["shape"] == "rect" and len(doc["nodes"][1]["label"]) == 60
    assert [e["from"] + e["to"] for e in doc["edges"]] == ["ab", "ba"], "悬空/自环边剔除"
    assert doc["order"] == ["b", "a"]
    assert doc["warnings"] == ["w1", "w3"]
    assert doc["confidence"] == 1.0


def test_validate_diagram_rejects_bad_input() -> None:
    with pytest.raises(ValueError):
        validate_diagram({"nodes": []})
    with pytest.raises(ValueError):
        validate_diagram(_doc(nodes=[{"id": "a", "label": "", "x": 0, "y": 0},
                                     {"id": "a", "label": "b", "x": 1, "y": 1}]))
    with pytest.raises(ValueError):
        validate_diagram(_doc(nodes=[{"id": f"n{i}", "label": "", "x": 0, "y": 0}
                                     for i in range(41)]))


def test_diagram_from_vision_evidence_matching() -> None:
    """节点文字应在 OCR 证据里出现；大面积缺失 → 置信度降级 + 警告。"""
    good = diagram_from_vision(_doc(), evidence=["输入数据进入", "输出结果", "经过处理"])
    assert good["confidence"] == 0.5 and not good["warnings"]

    bad = diagram_from_vision(
        _doc(nodes=[{"id": "a", "label": "完全无关", "x": 0.2, "y": 0.3},
                    {"id": "b", "label": "也不沾边", "x": 0.8, "y": 0.7},
                    {"id": "c", "label": "输入", "x": 0.5, "y": 0.5}]),
        evidence=["输入数据进入", "输出结果"],
    )
    assert bad["confidence"] <= 0.35
    assert any("OCR 证据" in w for w in bad["warnings"])


def test_diagram_from_shapes_precise_and_proximity() -> None:
    items = [
        {"entry_id": "10", "box": [0.1, 0.1, 0.3, 0.3], "text": "开始"},
        {"entry_id": "11", "box": [0.6, 0.1, 0.9, 0.3], "text": "处理"},
        {"entry_id": "12", "box": [0.3, 0.6, 0.7, 0.9], "text": "结束",
         "shape_kind": "oval"},
    ]
    connectors = [
        # 精确连接点：shape_id 10 → 11
        {"begin_id": "10", "end_id": "11"},
        # 无连接点 → 端点邻近匹配（n2 中心 0.75,0.2 / n3 中心 0.5,0.75）
        {"begin": [0.74, 0.22], "end": [0.52, 0.73]},
        # 挂不上节点的线被丢弃
        {"begin": [0.0, 0.0], "end": [0.01, 0.01]},
    ]
    doc = diagram_from_shapes(items, connectors)
    assert doc is not None
    assert len(doc["nodes"]) == 3 and len(doc["edges"]) == 2
    pairs = {(e["from"], e["to"]) for e in doc["edges"]}
    assert ("n1", "n2") in pairs and ("n2", "n3") in pairs
    assert doc["nodes"][2]["shape"] == "oval"
    assert doc["cache_key"] == "pptx_shapes"

    # 没有连接线 → 不成图
    assert diagram_from_shapes(items, []) is None


def _pptx_with_connector() -> Presentation:
    """顶层两个文本框 + 一条连接线（无组合）→ 连接线簇。"""
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    slide.shapes.add_textbox(Emu(914400), Emu(914400), Emu(1500000), Emu(600000)
                             ).text_frame.text = "开始"
    slide.shapes.add_textbox(Emu(5400000), Emu(914400), Emu(1500000), Emu(600000)
                             ).text_frame.text = "结束"
    slide.shapes.add_connector(
        MSO_CONNECTOR.STRAIGHT, Emu(2500000), Emu(1200000), Emu(5350000), Emu(1200000))
    return prs


def test_pptx_top_level_connector_cluster_makes_diagram(tmp_path: Path) -> None:
    prs = _pptx_with_connector()
    slide = prs.slides[0]
    preview = Image.new("RGB", (1280, 720), "white")
    regions = regions_for_pptx_slide(
        slide, prs.slide_width, prs.slide_height, preview, tmp_path, "f1", 1)
    assert regions, "文本框+连接线应聚成流程图区域"
    region = regions[0]
    assert region["kind"] == "diagram" and region["source"] == "pptx_connectors"
    diagram = region.get("diagram")
    assert diagram is not None, "确定性转译应直接给出 diagram"
    labels = {node["label"] for node in diagram["nodes"]}
    assert labels == {"开始", "结束"}
    assert len(diagram["edges"]) == 1


def test_cache_key_stable() -> None:
    a = cache_key(b"png-bytes", model="m1")
    assert a == cache_key(b"png-bytes", model="m1")
    assert a != cache_key(b"png-bytes", model="m2")
    assert a != cache_key(b"other", model="m1")


# ---------------- 按需转译端点 ----------------

_TMP_DIR = Path(tempfile.mkdtemp(prefix="xiangsheng-diagram-"))
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


@pytest.fixture()
def owner() -> Iterator[TestClient]:
    with TestClient(create_app()) as client:
        yield client


@pytest.fixture()
def guest() -> Iterator[TestClient]:
    with TestClient(create_app()) as client:
        yield client


def _session(client: TestClient) -> dict[str, Any]:
    response = client.post("/api/v1/sessions")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _headers(session: dict[str, Any]) -> dict[str, str]:
    return {"X-CSRF-Token": session["csrf_token"]}


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (320, 200), "white").save(buf, format="PNG")
    return buf.getvalue()


class _FakeVision:
    """替代 LivingVisionClient：记录调用次数，返回固定 JSON。"""

    calls = 0
    profile_model = "fake-vl"

    def __init__(self):
        self.profile = type("P", (), {
            "available": True, "model": self.profile_model, "max_calls": 2})()

    @property
    def available(self):
        return True

    def generate_json(self, *, image_png, prompt, **kw):
        type(self).calls += 1
        return _doc()


def _page_with_diagram_region(owner: TestClient):
    session = _session(owner)
    response = owner.post(
        "/api/v1/pages", headers=_headers(session),
        files=[("files", ("flow.png", _png(), "image/png"))],
    )
    assert response.status_code == 201, response.text
    doc = response.json()["data"]
    page = next(b for b in doc["blocks"] if b["type"] == "page")
    region = (page["data"].get("regions") or [])[0]
    page["data"]["regions"][0]["kind"] = "diagram"
    patched = owner.patch(
        f"/api/v1/pages/{doc['page_id']}", headers=_headers(session),
        json={"expected_revision": doc["revision"], "blocks": doc["blocks"]},
    )
    assert patched.status_code == 200, patched.text
    return session, patched.json()["data"], region["id"]


def test_region_diagram_endpoint_budget_cache(owner: TestClient, monkeypatch) -> None:
    from app.ppt_ai.client import PPTAIError

    class Fake(_FakeVision):
        calls = 0

    monkeypatch.setattr(routes_living, "LivingVisionClient", Fake)
    session, doc, region_id = _page_with_diagram_region(owner)

    ok = owner.post(
        f"/api/v1/pages/{doc['page_id']}/regions/{region_id}/diagram",
        headers=_headers(session), json={"expected_revision": doc["revision"]})
    assert ok.status_code == 200, ok.text
    doc = ok.json()["data"]
    region = next(b for b in doc["blocks"] if b["type"] == "page")["data"]["regions"][0]
    assert region["diagram"]["nodes"][0]["label"] == "输入"
    assert region["diagram"]["cache_key"]
    assert doc["vision_calls"] == 1 and Fake.calls == 1

    # 缓存命中：不重复调用
    again = owner.post(
        f"/api/v1/pages/{doc['page_id']}/regions/{region_id}/diagram",
        headers=_headers(session), json={"expected_revision": doc["revision"]})
    assert again.status_code == 200
    assert Fake.calls == 1

    # 清空 diagram 强行走视觉 → 第 2 次调用；预算=2 → 第 3 次拒绝
    page = next(b for b in doc["blocks"] if b["type"] == "page")
    page["data"]["regions"][0].pop("diagram")
    patched = owner.patch(
        f"/api/v1/pages/{doc['page_id']}", headers=_headers(session),
        json={"expected_revision": doc["revision"], "blocks": doc["blocks"]})
    doc = patched.json()["data"]
    ok2 = owner.post(
        f"/api/v1/pages/{doc['page_id']}/regions/{region_id}/diagram",
        headers=_headers(session), json={"expected_revision": doc["revision"]})
    assert ok2.status_code == 200, ok2.text
    doc = ok2.json()["data"]
    assert doc["vision_calls"] == 2

    page = next(b for b in doc["blocks"] if b["type"] == "page")
    page["data"]["regions"][0].pop("diagram")
    patched = owner.patch(
        f"/api/v1/pages/{doc['page_id']}", headers=_headers(session),
        json={"expected_revision": doc["revision"], "blocks": doc["blocks"]})
    doc = patched.json()["data"]
    over = owner.post(
        f"/api/v1/pages/{doc['page_id']}/regions/{region_id}/diagram",
        headers=_headers(session), json={"expected_revision": doc["revision"]})
    assert over.status_code in (400, 422), over.text

    # 视觉调用抛错：预算照样计数，区域无 diagram
    class Boom(_FakeVision):
        def generate_json(self, **kw):
            raise PPTAIError("transport", "服务不可用", retryable=True)

    monkeypatch.setattr(routes_living, "LivingVisionClient", Boom)
    fail = owner.post(
        f"/api/v1/pages/{doc['page_id']}/regions/{region_id}/diagram",
        headers=_headers(session), json={"expected_revision": doc["revision"]})
    assert fail.status_code in (400, 422)
    latest = owner.get(f"/api/v1/pages/{doc['page_id']}").json()["data"]
    assert latest["vision_calls"] == 2


def test_diagram_block_validation() -> None:
    from app.living.model import validate_block
    out = validate_block({"id": "d1", "type": "diagram", "data": {"doc": _doc()}})
    assert out["data"]["doc"]["nodes"][0]["id"] == "a"
    with pytest.raises(ValueError):
        validate_block({"id": "d2", "type": "diagram", "data": {"doc": {"nodes": []}}})

def test_diagram_rejects_non_array_warnings() -> None:
    with pytest.raises(ValueError, match="warnings"):
        validate_diagram(_doc(warnings={"message": "wrong shape"}))


def test_cache_key_changes_with_evidence() -> None:
    assert cache_key(b"image", evidence=["start"]) != cache_key(b"image", evidence=["end"])

def test_pptx_adjacent_text_boxes_are_candidates_without_invented_edges(tmp_path: Path) -> None:
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    for i, label in enumerate(("Start", "Process", "End")):
        slide.shapes.add_textbox(
            Emu(900000 + 2400000 * i), Emu(1500000), Emu(1500000), Emu(600000),
        ).text_frame.text = label
    regions = regions_for_pptx_slide(
        slide, prs.slide_width, prs.slide_height,
        Image.new("RGB", (1280, 720), "white"), tmp_path, "f1", 1,
    )
    cluster = next(r for r in regions if r["source"] == "pptx_text_cluster")
    assert cluster["kind"] == "diagram" and "diagram" not in cluster


def test_inflight_diagram_preserves_concurrent_edit(owner: TestClient, monkeypatch) -> None:
    session, doc, region_id = _page_with_diagram_region(owner)
    headers = _headers(session)
    page_url = f"/api/v1/pages/{doc['page_id']}"

    class ConcurrentEdit(_FakeVision):
        def generate_json(self, **kw):
            current = owner.get(page_url).json()["data"]
            assert current["vision_calls"] == 1
            edited = owner.patch(page_url, headers=headers, json={
                "expected_revision": current["revision"], "title": "Concurrent title",
            })
            assert edited.status_code == 200
            return _doc()

    monkeypatch.setattr(routes_living, "LivingVisionClient", ConcurrentEdit)
    response = owner.post(f"{page_url}/regions/{region_id}/diagram", headers=headers,
                          json={"expected_revision": doc["revision"]})
    assert response.status_code == 409
    assert owner.get(page_url).json()["data"]["title"] == "Concurrent title"


def test_retry_spends_budget_and_returns_revision_on_failure(owner: TestClient, monkeypatch) -> None:
    from app.ppt_ai.client import PPTAIError

    class FailingVision(_FakeVision):
        calls = 0

        def generate_json(self, **kw):
            type(self).calls += 1
            raise PPTAIError("transport", "retry test", retryable=True)

    monkeypatch.setattr(routes_living, "LivingVisionClient", FailingVision)
    session, doc, region_id = _page_with_diagram_region(owner)
    page_url = f"/api/v1/pages/{doc['page_id']}"
    response = owner.post(f"{page_url}/regions/{region_id}/diagram", headers=_headers(session),
                          json={"expected_revision": doc["revision"]})
    current = owner.get(page_url).json()["data"]
    assert response.status_code == 400
    assert FailingVision.calls == current["vision_calls"] == 2
    assert response.json()["error"]["details"]["revision"] == current["revision"]

def test_freeform_arrow_uses_path_endpoints() -> None:
    from types import SimpleNamespace
    from lxml import etree
    from app.documents.regions import _connector_ends, _is_connector

    element = etree.fromstring(b"""
    <sp xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:custGeom><a:pathLst><a:path w="100" h="100">
        <a:moveTo><a:pt x="10" y="80"/></a:moveTo>
        <a:cubicBezTo><a:pt x="30" y="10"/><a:pt x="75" y="10"/>
          <a:pt x="90" y="60"/></a:cubicBezTo>
      </a:path></a:pathLst></a:custGeom>
      <a:ln><a:tailEnd type="triangle"/></a:ln>
    </sp>
    """)
    item = {"shape": SimpleNamespace(element=element), "bbox": [100, 200, 400, 500]}
    assert _is_connector(item)
    assert _connector_ends(item, 1000, 1000) == {"begin": [0.14, 0.6], "end": [0.46, 0.5]}


def test_original_positions_round_trip_in_block() -> None:
    """P3：作者编辑持久化——original_positions 经块校验往返不丢。"""
    from app.living.model import validate_block
    doc = _doc()
    doc["original_positions"] = {"a": {"x": 0.2, "y": 0.3},
                                 "ghost": {"x": 0.1, "y": 0.1},
                                 "b": {"x": "bad", "y": 0.7}}
    out = validate_block({"id": "d3", "type": "diagram", "data": {"doc": doc}})
    saved = out["data"]["doc"]["original_positions"]
    assert set(saved) == {"a", "b"}, "只保留引用存在节点的原始位置"
    assert saved["a"] == {"x": 0.2, "y": 0.3}
    assert saved["b"] == {"x": 0.5, "y": 0.7}, "非法值收敛到默认 0.5"


def test_diagram_progress_states_and_insights(owner: TestClient, guest: TestClient) -> None:
    """P3 学情：diagram_states 合并 + insights 聚合最大步序/完成人数。"""
    session = _session(owner)
    response = owner.post(
        "/api/v1/pages", headers=_headers(session),
        files=[("files", ("note.txt", "hello living page".encode(), "text/plain"))],
    )
    assert response.status_code == 201, response.text
    document = response.json()["data"]
    page_id = document["page_id"]
    # 植入一个 diagram 块
    blocks = document["blocks"]
    blocks.append({"id": "blk_d", "type": "diagram", "data": {"doc": _doc()}})
    patched = owner.patch(
        f"/api/v1/pages/{page_id}", headers=_headers(session),
        json={"expected_revision": document["revision"], "blocks": blocks})
    assert patched.status_code == 200, patched.text
    published = owner.post(f"/api/v1/pages/{page_id}/publish", headers=_headers(session))
    share_id = published.json()["data"]["share_id"]

    guest_session = _session(guest)
    report = guest.post(
        f"/api/v1/page-shares/{share_id}/progress",
        headers=_headers(guest_session),
        json={"block_id": "blk_d",
              "patch": {"diagram_states": {"step": 2, "total": 2, "completed": True}}},
    )
    assert report.status_code == 200, report.text
    # 非法形状被忽略而不是炸掉行
    report2 = guest.post(
        f"/api/v1/page-shares/{share_id}/progress",
        headers=_headers(guest_session),
        json={"block_id": "blk_d",
              "patch": {"diagram_states": {"step": "bad"}}},
    )
    assert report2.status_code == 200

    back = guest.post(
        f"/api/v1/page-shares/{share_id}/progress", headers=_headers(guest_session),
        json={"block_id": "blk_d",
              "patch": {"diagram_states": {"step": 1, "total": 2, "completed": False}}},
    )
    assert back.status_code == 200

    republished = owner.post(f"/api/v1/pages/{page_id}/publish", headers=_headers(session))
    second_share = republished.json()["data"]["share_id"]
    repeated = guest.post(
        f"/api/v1/page-shares/{second_share}/progress", headers=_headers(guest_session),
        json={"block_id": "blk_d", "patch": {"diagram_states": {"step": 2, "total": 2}}},
    )
    assert repeated.status_code == 200

    insights = owner.get(f"/api/v1/pages/{page_id}/insights")
    stat = insights.json()["data"]["blocks"]["blk_d"]
    assert stat["diagram_step_max"] == 2 and stat["diagram_completed"] == 1

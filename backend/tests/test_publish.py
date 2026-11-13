"""发布 / 只读分享链路测试（P2-10 / P2-11）。

覆盖：
- ``share_id`` 的不可预测性（长度、字符集、唯一性）；
- 归属与 CSRF：匿名不能发布、缺 CSRF 不能发布、跨会话 404；
- 发布 → 无 Cookie 读取快照 → revoke 后 404；
- 快照冻结：发布后改对象参数，已发布链接内容不变；
- 公开页图：只在快照白名单内、且不暴露文件系统路径；
- 单文件 HTML 导出：附件头、内联数据、离线运行时自检标记；
- 删除材料级联删除分享。

测试使用独立的临时 SQLite（不污染 ``backend/data/xiangsheng.db``）。
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any, Iterator

import pytest

# 必须在导入 app.main 之前固定测试数据库（create_app 读 settings 单例）。
_TMP_DIR = Path(tempfile.mkdtemp(prefix="xiangsheng-publish-test-"))
os.environ["DATABASE_URL"] = "sqlite:///" + (_TMP_DIR / "test.db").as_posix()
os.environ["SESSION_COOKIE_SECURE"] = "false"
os.environ["ENFORCE_CSRF"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.api.routes_publish import (  # noqa: E402
    build_snapshot,
    document_to_ispec,
    new_share_id,
    public_payload,
)
from app.db.models import KnowledgeObjectRecord, MaterialRecord, ShareRecord  # noqa: E402
from app.db.session import reset_engine_cache, session_scope  # noqa: E402
from app.render import pages_dir, render_dir  # noqa: E402
from app.settings import get_settings  # noqa: E402

get_settings.cache_clear()
reset_engine_cache()

from app.main import create_app  # noqa: E402

#: 1×1 透明 PNG（只用于验证"公开页图确实由 share 端点返回"）。
_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _csrf(headers: dict[str, str], session: dict[str, Any]) -> dict[str, str]:
    merged = dict(headers)
    merged["X-CSRF-Token"] = str(session["csrf_token"])
    return merged


def _create_session(client: TestClient) -> dict[str, Any]:
    response = client.post("/api/v1/sessions")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _clone_matrix_example(client: TestClient, session: dict[str, Any]) -> dict[str, Any]:
    response = client.post(
        "/api/v1/examples/example_matrix_2d/clone", headers=_csrf({}, session)
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def _publish(client: TestClient, session: dict[str, Any], material_id: str) -> dict[str, Any]:
    response = client.post(
        f"/api/v1/materials/{material_id}/publish", headers=_csrf({}, session)
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


@pytest.fixture(scope="module")
def app() -> Any:
    return create_app()


@pytest.fixture
def teacher(app: Any) -> Iterator[TestClient]:
    with TestClient(app) as client:
        yield client


@pytest.fixture
def guest(app: Any) -> Iterator[TestClient]:
    """没有任何 Cookie 的"学生端"。"""

    with TestClient(app) as client:
        yield client


@pytest.fixture(scope="module", autouse=True)
def _cleanup_tmp_dir() -> Iterator[None]:
    yield
    shutil.rmtree(_TMP_DIR, ignore_errors=True)


# ---------------------------------------------------------------------------
# share_id
# ---------------------------------------------------------------------------


def test_share_id_is_unguessable_and_unique() -> None:
    ids = [new_share_id() for _ in range(50)]
    assert len(set(ids)) == len(ids)
    for share_id in ids:
        assert len(share_id) == 16
        assert all(ch.isalnum() or ch in "-_" for ch in share_id)


# ---------------------------------------------------------------------------
# 鉴权
# ---------------------------------------------------------------------------


def test_publish_requires_session(guest: TestClient) -> None:
    response = guest.post("/api/v1/materials/mat_missing/publish")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "SESSION_EXPIRED"


def test_publish_requires_csrf(teacher: TestClient) -> None:
    session = _create_session(teacher)
    cloned = _clone_matrix_example(teacher, session)
    response = teacher.post(f"/api/v1/materials/{cloned['material_id']}/publish")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "MISSING_FIELD"


def test_publish_other_session_material_is_404(app: Any, teacher: TestClient) -> None:
    session = _create_session(teacher)
    cloned = _clone_matrix_example(teacher, session)
    with TestClient(app) as other:
        other_session = _create_session(other)
        response = other.post(
            f"/api/v1/materials/{cloned['material_id']}/publish",
            headers=_csrf({}, other_session),
        )
    assert response.status_code == 404
    assert response.json()["error"]["message"] == "资源不可用"


# ---------------------------------------------------------------------------
# 发布 → 公开读取 → 撤销
# ---------------------------------------------------------------------------


def test_publish_public_read_and_revoke(teacher: TestClient, guest: TestClient) -> None:
    session = _create_session(teacher)
    cloned = _clone_matrix_example(teacher, session)
    material_id = cloned["material_id"]

    published = _publish(teacher, session, material_id)
    share_id = published["share_id"]
    assert published["share_url"] == f"/p/{share_id}"
    assert share_id not in material_id

    # 无 Cookie 读取（主路径 + 任务书字面路径别名）
    for path in (f"/api/v1/p/{share_id}", f"/p/{share_id}"):
        response = guest.get(path)
        assert response.status_code == 200, response.text
        payload = response.json()["data"]
        assert payload["title"]
        assert isinstance(payload["regions"], list)
        assert isinstance(payload["ispecs"], list)
        assert isinstance(payload["pages"], list)
        assert payload["page_count"] >= 1

    payload = guest.get(f"/api/v1/p/{share_id}").json()["data"]
    # 示例对象被合成为可交互 iSpec：矩阵 A 展开为 4 个标量。
    matrix_spec = next(spec for spec in payload["ispecs"] if spec.get("parameters"))
    flags = {parameter["id"] for parameter in matrix_spec["parameters"]}
    assert {"matrix_A_a11", "matrix_A_a12", "matrix_A_a21", "matrix_A_a22"} <= flags
    assert any(view.get("type") == "table" for view in matrix_spec["views"])
    assert any(view.get("type") == "text" for view in matrix_spec["views"])

    # 快照里绝不含教师侧标识 / 文件系统路径 / 邮箱。
    raw = json.dumps(payload, ensure_ascii=False)
    for forbidden in ("session_id", "material_id", "ses_", "backend", "data/renders"):
        assert forbidden not in raw
    assert re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", raw) is None

    # 示例材料没有页图 → 页图端点 404（而不是 200 空图）。
    assert guest.get(f"/api/v1/p/{share_id}/pages/1").status_code == 404

    revoked = teacher.delete(
        f"/api/v1/materials/{material_id}/publish", headers=_csrf({}, session)
    )
    assert revoked.status_code == 200
    assert revoked.json()["data"]["revoked"] >= 1

    assert guest.get(f"/api/v1/p/{share_id}").status_code == 404
    assert guest.get("/p/%s" % share_id).status_code == 404
    # 幂等：再次撤销返回 0。
    again = teacher.delete(
        f"/api/v1/materials/{material_id}/publish", headers=_csrf({}, session)
    )
    assert again.json()["data"]["revoked"] == 0


def test_public_page_requires_known_share(guest: TestClient) -> None:
    assert guest.get("/api/v1/p/not-a-real-share").status_code == 404
    assert guest.get("/api/v1/p/not-a-real-share/pages/1").status_code == 404


# ---------------------------------------------------------------------------
# 快照冻结
# ---------------------------------------------------------------------------


def test_snapshot_is_frozen(teacher: TestClient, guest: TestClient) -> None:
    session = _create_session(teacher)
    cloned = _clone_matrix_example(teacher, session)
    published = _publish(teacher, session, cloned["material_id"])
    share_id = published["share_id"]

    before = guest.get(f"/api/v1/p/{share_id}").json()["data"]
    before_spec = next(spec for spec in before["ispecs"] if spec.get("parameters"))
    before_value = before_spec["parameters"][0]["default"]

    # 教师侧修改对象参数（模拟发布后继续编辑材料）。
    with session_scope() as db:
        row = db.get(KnowledgeObjectRecord, cloned["object_id"])
        assert row is not None
        document = dict(row.document)
        parameters = [dict(item) for item in document.get("parameters", [])]
        parameters[0]["value"] = [[9, 9], [9, 9]]
        document["parameters"] = parameters
        row.document = document

    after = guest.get(f"/api/v1/p/{share_id}").json()["data"]
    after_spec = next(spec for spec in after["ispecs"] if spec.get("parameters"))
    assert after_spec["parameters"][0]["default"] == before_value


def test_delete_material_cascades_shares(teacher: TestClient, guest: TestClient) -> None:
    session = _create_session(teacher)
    cloned = _clone_matrix_example(teacher, session)
    published = _publish(teacher, session, cloned["material_id"])
    share_id = published["share_id"]

    response = teacher.delete(
        f"/api/v1/materials/{cloned['material_id']}", headers=_csrf({}, session)
    )
    assert response.status_code == 204
    assert guest.get(f"/api/v1/p/{share_id}").status_code == 404


# ---------------------------------------------------------------------------
# 公开页图（真实文件）
# ---------------------------------------------------------------------------


def test_public_page_endpoint_serves_only_snapshot_files(
    teacher: TestClient, guest: TestClient
) -> None:
    session = _create_session(teacher)
    cloned = _clone_matrix_example(teacher, session)
    material_id = cloned["material_id"]
    target_dir = pages_dir(material_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / "s01.png").write_bytes(_PNG_BYTES)
    (target_dir / "s01_erased.png").write_bytes(_PNG_BYTES)
    try:
        published = _publish(teacher, session, material_id)
        share_id = published["share_id"]

        snapshot = guest.get(f"/api/v1/p/{share_id}").json()["data"]
        assert snapshot["pages"][0]["page_no"] == 1
        assert snapshot["pages"][0]["image_url"] == (
            f"/api/v1/p/{share_id}/pages/1"
        )
        assert snapshot["pages"][0]["erased_image_url"] == (
            f"/api/v1/p/{share_id}/pages/1?variant=erased"
        )

        response = guest.get(f"/api/v1/p/{share_id}/pages/1")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("image/png")
        assert response.content == _PNG_BYTES

        erased = guest.get(f"/api/v1/p/{share_id}/pages/1?variant=erased")
        assert erased.status_code == 200
        assert erased.headers["content-type"].startswith("image/png")
        # 不暴露文件系统路径 / 文件名以外的东西。
        assert "backend" not in response.headers.get("content-disposition", "")

        # 快照中不存在的页、非法页号一律 404。
        assert guest.get(f"/api/v1/p/{share_id}/pages/2").status_code == 404
        assert guest.get(f"/api/v1/p/{share_id}/pages/0").status_code == 404
    finally:
        shutil.rmtree(render_dir(material_id), ignore_errors=True)


# ---------------------------------------------------------------------------
# 单文件静态导出
# ---------------------------------------------------------------------------


def test_export_single_file_html(teacher: TestClient) -> None:
    session = _create_session(teacher)
    cloned = _clone_matrix_example(teacher, session)
    response = teacher.post(
        f"/api/v1/materials/{cloned['material_id']}/export-html",
        headers=_csrf({}, session),
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "attachment" in response.headers["content-disposition"]
    assert "xiangsheng-export.html" in response.headers["content-disposition"]

    text = response.text
    assert "<!doctype html>" in text
    assert 'id="export-data"' in text
    assert 'id="offline-root"' in text
    assert '<script src=' not in text
    assert '<link ' not in text
    assert "matrix_A_a11" in text
    # 导出产物不含教师侧标识。
    data=re.search(r'<script id="export-data" type="application/json">(.*?)</script>',text,re.S)[1]
    for forbidden in ("session_id", "material_id", "ses_"):
        assert forbidden not in data
    assert re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", data) is None


# ---------------------------------------------------------------------------
# 纯函数
# ---------------------------------------------------------------------------


def test_document_to_ispec_expands_matrix_and_hides_material(
    repo_root: Path,
) -> None:
    path = repo_root / "fixtures" / "materials" / "matrix-courseware" / "objects.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    document = payload["objects"][0]

    spec = document_to_ispec(document, 1)
    assert spec["spec_version"] == "1.0"
    assert spec["object_id"] == "spec_1"
    identifiers = {parameter["id"] for parameter in spec["parameters"]}
    assert {"matrix_A_a11", "matrix_A_a12", "matrix_A_a21", "matrix_A_a22"} <= identifiers
    # vector2 不伪造标量。
    assert all(not identifier.startswith("vector_x") for identifier in identifiers)
    assert all(parameter["source"]["excerpt"] for parameter in spec["parameters"])

    raw = json.dumps(spec, ensure_ascii=False)
    assert "material_id" not in raw
    assert "session_id" not in raw
    # object_id 已重写为 spec_N，绝不透传内部对象 id。
    assert document["object_id"] not in raw


def test_build_snapshot_and_public_payload_are_whitelisted(
    app: Any, teacher: TestClient
) -> None:
    session = _create_session(teacher)
    cloned = _clone_matrix_example(teacher, session)


    with session_scope() as db:
        material = db.get(MaterialRecord, cloned["material_id"])
        assert material is not None
        snapshot = build_snapshot(db, material)
        # 伪造一条带教师字段的区域，验证公开投影仍然只输出教学字段。
        snapshot["regions"] = [
            {
                "region_id": "rgn_demo",
                "page": 1,
                "material_id": material.id,
                "session_id": "ses_leak",
                "source_filename": "教师私有文件名.pptx",
                "bbox": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
                "coordinate_system": {
                    "view_box": [1920, 1350],
                    "origin": [640, 770],
                    "unit": 150,
                    "y_axis": "up",
                },
                "script_id": "matrix_eigen_2d",
                "status": "confirmed",
                "original_params": {"a11": 2},
                "linked_texts": [],
                "assets": {"page_image": "pages/s01.png", "erased_image": ""},
                "has_override": True,
                "fact_signature": "deadbeef",
                "note": "教师备注",
            }
        ]
        share = ShareRecord(
            share_id="shr_test_whitelist",
            material_id=material.id,
            session_id=session["session_id"],
            created_at="2026-11-02T00:00:00Z",
            revoked_at=None,
            snapshot_json=snapshot,
        )
        payload = public_payload(share)

    raw = json.dumps(payload, ensure_ascii=False)
    for forbidden in ("session_id", "material_id", "source_filename", "教师私有", "deadbeef"):
        assert forbidden not in raw
    assert payload["regions"][0]["region_id"] == "rgn_demo"
    assert payload["regions"][0]["status"] == "confirmed"


def test_compat_publish_excludes_unselected_personal_experiments(
    app: Any, teacher: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    session = _create_session(teacher)
    cloned = _clone_matrix_example(teacher, session)
    captured: dict[str, Any] = {}
    import app.ppt_ai.snapshots as snapshots

    def fake_freeze_interactions(db, *, material, session_id, **kwargs):
        captured.update(kwargs)
        return None

    monkeypatch.setattr(snapshots, "freeze_interactions", fake_freeze_interactions)
    with session_scope() as db:
        material = db.get(MaterialRecord, cloned["material_id"])
        assert material is not None
        build_snapshot(db, material)
    # 旧调用没有显式选择：未选择的个人实验不得进入公开快照。
    assert captured.get("experiment_ids") == []

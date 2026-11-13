"""iSpec 参数跨会话持久化测试（整改文件 §10.1 第 5 步）。

覆盖：
- ``PUT`` 后 ``GET`` 读到同一组值；
- 进程重启后仍存在（子进程重新导入 ``load_values``，不是读同一份内存）；
- 陌生 ``object_id`` → 404 ``MISSING_FIELD``；
- ``expected_updated_at`` 不匹配 → 409 ``VERSION_CONFLICT``（details 带当前值）；
- 跨会话访问同一材料 → 404 ``SESSION_EXPIRED``；
- 端到端：真实后端 PUT 后，**全新的 TestClient 携带同一会话 Cookie** GET 值一致；
- 共享池桶 ``__shared__`` 与标量/规模约束。

测试使用独立的临时 SQLite 与临时参数目录（通过 ``ISPEC_VALUES_DIR`` 重定向），
不污染 ``backend/data``。
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterator

import pytest

# 必须在导入 app.main 之前固定测试环境（create_app 读 settings 单例）。
_TMP_DIR = Path(tempfile.mkdtemp(prefix="xiangsheng-ispec-values-test-"))
_VALUES_DIR = _TMP_DIR / "ispec-values"
os.environ["DATABASE_URL"] = "sqlite:///" + (_TMP_DIR / "test.db").as_posix()
os.environ["SESSION_COOKIE_SECURE"] = "false"
os.environ["ENFORCE_CSRF"] = "true"
os.environ["ISPEC_VALUES_DIR"] = str(_VALUES_DIR)

from fastapi.testclient import TestClient  # noqa: E402

from app.db.session import reset_engine_cache  # noqa: E402
from app.ispec.persistence import (  # noqa: E402
    InvalidISpecValues,
    SHARED_OBJECT_ID,
    VersionConflict,
    clear_values,
    load_values,
    save_values,
)
from app.settings import get_settings  # noqa: E402

get_settings.cache_clear()
reset_engine_cache()

from app.main import create_app  # noqa: E402

#: 会话 Cookie 名（与 settings 默认值一致，测试直接复用）。
COOKIE_NAME = "xiangsheng_session"


# ---------------------------------------------------------------------------
# 辅助
# ---------------------------------------------------------------------------


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


def _values_url(material_id: str, object_id: str) -> str:
    return f"/api/v1/materials/{material_id}/ispecs/{object_id}/values"


class MaterialFixture:
    """一次克隆出的材料 + 会话，供多个用例复用（模块级）。"""

    def __init__(self, client: TestClient, session: dict[str, Any], material_id: str, object_id: str):
        self.client = client
        self.session = session
        self.material_id = material_id
        self.object_id = object_id


@pytest.fixture(scope="module")
def app() -> Any:
    return create_app()


@pytest.fixture(scope="module")
def teacher(app: Any) -> Iterator[TestClient]:
    with TestClient(app) as client:
        yield client


@pytest.fixture(scope="module")
def material(teacher: TestClient) -> MaterialFixture:
    session = _create_session(teacher)
    clone = _clone_matrix_example(teacher, session)
    return MaterialFixture(
        teacher, session, str(clone["material_id"]), str(clone["object_id"])
    )


@pytest.fixture(scope="module", autouse=True)
def _cleanup_tmp_dir() -> Iterator[None]:
    yield
    shutil.rmtree(_TMP_DIR, ignore_errors=True)


# ---------------------------------------------------------------------------
# 端点行为
# ---------------------------------------------------------------------------


def test_put_then_get_returns_same_values(material: MaterialFixture) -> None:
    values = {"matrix_A": 4, "visible": True, "label": "矩阵"}
    response = material.client.put(
        _values_url(material.material_id, material.object_id),
        headers=_csrf({}, material.session),
        json={"values": values},
    )
    assert response.status_code == 200, response.text
    saved = response.json()["data"]
    assert saved["object_id"] == material.object_id
    assert saved["values"] == values
    assert isinstance(saved["updated_at"], str) and saved["updated_at"].endswith("Z")

    read = material.client.get(_values_url(material.material_id, material.object_id))
    assert read.status_code == 200, read.text
    payload = read.json()["data"]
    assert payload["values"] == values
    assert payload["updated_at"] == saved["updated_at"]


def test_values_survive_process_restart(material: MaterialFixture, repo_root: Path) -> None:
    """模拟"重启进程"：在子进程里重新导入模块再读取，而不是复用当前内存状态。"""

    values = {"a11": 7}
    response = material.client.put(
        _values_url(material.material_id, material.object_id),
        headers=_csrf({}, material.session),
        json={"values": values},
    )
    assert response.status_code == 200, response.text

    backend_dir = repo_root / "backend"
    script = (
        "import json, sys\n"
        "from app.ispec.persistence import load_values\n"
        "payload = load_values(sys.argv[1])\n"
        "print(json.dumps(payload[sys.argv[2]]['values'], ensure_ascii=False))\n"
    )
    env = dict(os.environ)
    env["PYTHONPATH"] = str(backend_dir)
    env["ISPEC_VALUES_DIR"] = str(_VALUES_DIR)
    completed = subprocess.run(
        [sys.executable, "-c", script, material.material_id, material.object_id],
        cwd=str(backend_dir),
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    assert json.loads(completed.stdout.strip()) == values


def test_unknown_object_id_returns_404(material: MaterialFixture) -> None:
    response = material.client.get(_values_url(material.material_id, "obj_not_exists"))
    assert response.status_code == 404, response.text
    error = response.json()["error"]
    assert error["code"] == "MISSING_FIELD"


def test_stale_expected_updated_at_returns_409_with_current_values(
    material: MaterialFixture,
) -> None:
    first = material.client.put(
        _values_url(material.material_id, material.object_id),
        headers=_csrf({}, material.session),
        json={"values": {"a11": 1, "a12": 2}},
    )
    assert first.status_code == 200, first.text
    current = first.json()["data"]

    stale = material.client.put(
        _values_url(material.material_id, material.object_id),
        headers=_csrf({}, material.session),
        json={
            "values": {"a11": 9},
            "expected_updated_at": "2000-01-01T00:00:00Z",
        },
    )
    assert stale.status_code == 409, stale.text
    error = stale.json()["error"]
    assert error["code"] == "VERSION_CONFLICT"
    details = error["details"]
    assert details["current_values"] == {"a11": 1, "a12": 2}
    assert details["current_updated_at"] == current["updated_at"]

    # 带上正确版本即可成功。
    retried = material.client.put(
        _values_url(material.material_id, material.object_id),
        headers=_csrf({}, material.session),
        json={"values": {"a11": 9}, "expected_updated_at": current["updated_at"]},
    )
    assert retried.status_code == 200, retried.text
    assert retried.json()["data"]["values"] == {"a11": 9}


def test_other_session_cannot_read_material(app: Any, material: MaterialFixture) -> None:
    with TestClient(app) as stranger:
        _create_session(stranger)
        response = stranger.get(_values_url(material.material_id, material.object_id))
    assert response.status_code == 404, response.text
    error = response.json()["error"]
    assert error["code"] == "SESSION_EXPIRED"
    assert error["message"] == "资源不可用"


def test_new_client_with_same_cookie_reads_saved_values(
    app: Any, material: MaterialFixture
) -> None:
    """端到端：真实后端保存 → 全新 TestClient（同一会话 Cookie）读到同一组值。"""

    values = {"a11": 3, "a22": 5, "label": "换浏览器后仍应恢复"}
    response = material.client.put(
        _values_url(material.material_id, material.object_id),
        headers=_csrf({}, material.session),
        json={"values": values},
    )
    assert response.status_code == 200, response.text

    cookie = material.client.cookies.get(COOKIE_NAME)
    assert cookie, "会话 Cookie 未下发，测试前提不成立"

    with TestClient(app) as reopened:
        reopened.cookies.set(COOKIE_NAME, cookie)
        read = reopened.get(_values_url(material.material_id, material.object_id))
    assert read.status_code == 200, read.text
    assert read.json()["data"]["values"] == values


def test_shared_pool_bucket_is_persisted(material: MaterialFixture) -> None:
    response = material.client.put(
        _values_url(material.material_id, SHARED_OBJECT_ID),
        headers=_csrf({}, material.session),
        json={"values": {"shared_销售额_a1b2c3d4": 120}},
    )
    assert response.status_code == 200, response.text
    read = material.client.get(_values_url(material.material_id, SHARED_OBJECT_ID))
    assert read.status_code == 200, read.text
    assert read.json()["data"]["values"] == {"shared_销售额_a1b2c3d4": 120}


def test_empty_values_clears_bucket(material: MaterialFixture) -> None:
    material.client.put(
        _values_url(material.material_id, material.object_id),
        headers=_csrf({}, material.session),
        json={"values": {"a11": 1}},
    )
    cleared = material.client.put(
        _values_url(material.material_id, material.object_id),
        headers=_csrf({}, material.session),
        json={"values": {}},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["data"]["values"] == {}
    assert cleared.json()["data"]["updated_at"] is None
    read = material.client.get(_values_url(material.material_id, material.object_id))
    assert read.json()["data"] == {
        "object_id": material.object_id,
        "values": {},
        "updated_at": None,
    }


def test_non_scalar_value_is_rejected(material: MaterialFixture) -> None:
    response = material.client.put(
        _values_url(material.material_id, material.object_id),
        headers=_csrf({}, material.session),
        json={"values": {"matrix_A": [[1, 2], [3, 4]]}},
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "MISSING_FIELD"


def test_delete_material_removes_values_file(app: Any) -> None:
    """删除材料必须同时清理 ``data/ispec-values/<material_id>.json``（无孤儿数据）。"""

    with TestClient(app) as client:
        session = _create_session(client)
        clone = _clone_matrix_example(client, session)
        material_id = str(clone["material_id"])
        object_id = str(clone["object_id"])

        saved = client.put(
            _values_url(material_id, object_id),
            headers=_csrf({}, session),
            json={"values": {"a11": 2}},
        )
        assert saved.status_code == 200, saved.text
        path = _VALUES_DIR / f"{material_id}.json"
        assert path.is_file()

        deleted = client.delete(
            f"/api/v1/materials/{material_id}", headers=_csrf({}, session)
        )
        assert deleted.status_code == 204, deleted.text
        assert not path.exists()
        assert load_values(material_id) == {}


# ---------------------------------------------------------------------------
# 持久化层（不经 HTTP）
# ---------------------------------------------------------------------------


def test_persistence_enforces_scale_limit(tmp_path: Path) -> None:
    too_many = {f"p{index}": index for index in range(501)}
    with pytest.raises(InvalidISpecValues):
        save_values("mat_unit_scale", "obj_unit", too_many, None)


def test_persistence_atomic_write_leaves_no_tmp_file(tmp_path: Path) -> None:
    save_values("mat_unit_atomic", "obj_unit", {"a": 1}, None)
    files = sorted(item.name for item in _VALUES_DIR.glob("mat_unit_atomic*"))
    assert files == ["mat_unit_atomic.json"]
    assert load_values("mat_unit_atomic")["obj_unit"]["values"] == {"a": 1}


def test_persistence_version_conflict_reports_current() -> None:
    save_values("mat_unit_conflict", "obj_unit", {"a": 1}, None)
    first = load_values("mat_unit_conflict")["obj_unit"]
    with pytest.raises(VersionConflict) as excinfo:
        save_values("mat_unit_conflict", "obj_unit", {"a": 2}, "2000-01-01T00:00:00Z")
    assert excinfo.value.current_values == {"a": 1}
    assert excinfo.value.current_updated_at == first["updated_at"]


def test_clear_values_removes_file() -> None:
    save_values("mat_unit_clear", "obj_unit", {"a": 1}, None)
    clear_values("mat_unit_clear")
    assert load_values("mat_unit_clear") == {}
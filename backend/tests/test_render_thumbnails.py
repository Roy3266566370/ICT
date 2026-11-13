"""页图 WebP 缩略图（``GET /materials/{id}/renders/{file}?w=``）测试。

覆盖：宽度白名单、非法宽度、归属校验、响应类型、版本化缓存头、
并发生成只写一次。测试使用独立临时 SQLite 与临时产物目录。
"""

from __future__ import annotations

import os
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

import pytest

_TMP_DIR = Path(tempfile.mkdtemp(prefix="xiangsheng-thumb-test-"))
os.environ["DATABASE_URL"] = "sqlite:///" + (_TMP_DIR / "test.db").as_posix()
os.environ["SESSION_COOKIE_SECURE"] = "false"

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app.api import routes_materials  # noqa: E402
from app.db.models import MaterialRecord  # noqa: E402
from app.db.session import reset_engine_cache, session_scope  # noqa: E402
from app.schemas.common import to_iso, utc_now  # noqa: E402
from app.settings import get_settings  # noqa: E402

get_settings.cache_clear()
reset_engine_cache()

from app.main import create_app  # noqa: E402

MATERIAL_ID = "mat_thumb_test"


@pytest.fixture(scope="module")
def app() -> Any:
    return create_app()


@pytest.fixture
def pages(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """临时产物目录：一张 960×540 的真实 PNG 页图。"""

    target = tmp_path / "pages"
    target.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (960, 540), (240, 236, 228)).save(target / "s01.png")
    Image.new("RGB", (960, 540), (255, 255, 255)).save(target / "s01_erased.png")
    monkeypatch.setattr(routes_materials, "pages_dir", lambda _material_id: target)
    return target


def _new_session(client: TestClient) -> str:
    response = client.post("/api/v1/sessions")
    assert response.status_code == 200, response.text
    return str(response.json()["data"]["session_id"])


@pytest.fixture
def owner(app: Any, pages: Path) -> Iterator[TestClient]:
    with TestClient(app) as client:
        session_id = _new_session(client)
        now = datetime.now(tz=timezone.utc).replace(microsecond=0)
        with session_scope() as db:
            existing = db.get(MaterialRecord, MATERIAL_ID)
            if existing is not None:
                db.delete(existing)
                db.flush()
            db.add(
                MaterialRecord(
                    id=MATERIAL_ID,
                    session_id=session_id,
                    title="缩略图测试",
                    status="ready",
                    page_count=1,
                    candidates=[],
                    created_at=to_iso(utc_now()),
                    expires_at=(now + timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
                )
            )
        yield client


@pytest.fixture
def guest(app: Any) -> Iterator[TestClient]:
    with TestClient(app) as client:
        _new_session(client)
        yield client


@pytest.fixture(scope="module", autouse=True)
def _cleanup() -> Iterator[None]:
    yield
    shutil.rmtree(_TMP_DIR, ignore_errors=True)


def test_thumbnail_is_webp_with_allowed_width(owner: TestClient, pages: Path) -> None:
    response = owner.get(f"/api/v1/materials/{MATERIAL_ID}/renders/s01.png", params={"w": 240})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("image/webp")
    cached = pages / "thumbs" / "s01_w240.webp"
    assert cached.is_file()
    with Image.open(cached) as image:
        assert image.format == "WEBP"
        assert image.width == 240
        assert image.height == 135


def test_erased_page_can_be_thumbnailed(owner: TestClient, pages: Path) -> None:
    response = owner.get(
        f"/api/v1/materials/{MATERIAL_ID}/renders/s01_erased.png", params={"w": 320}
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("image/webp")
    assert (pages / "thumbs" / "s01_erased_w320.webp").is_file()


def test_display_width_is_webp(owner: TestClient, pages: Path) -> None:
    response = owner.get(
        f"/api/v1/materials/{MATERIAL_ID}/renders/s01.png", params={"w": 1600}
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("image/webp")
    cached = pages / "thumbs" / "s01_w1600.webp"
    with Image.open(cached) as image:
        # 源图只有 960 宽时不放大，保持原尺寸。
        assert image.width == 960
        assert image.format == "WEBP"


@pytest.mark.parametrize("width", [0, 100, 300, 999, -240])
def test_invalid_width_is_rejected(owner: TestClient, width: int) -> None:
    response = owner.get(
        f"/api/v1/materials/{MATERIAL_ID}/renders/s01.png", params={"w": width}
    )
    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "INVALID_FILE"


def test_thumbnail_of_foreign_material_is_hidden(guest: TestClient) -> None:
    response = guest.get(f"/api/v1/materials/{MATERIAL_ID}/renders/s01.png", params={"w": 240})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "SESSION_EXPIRED"


def test_cache_control_only_with_version(owner: TestClient) -> None:
    plain = owner.get(f"/api/v1/materials/{MATERIAL_ID}/renders/s01.png")
    assert plain.status_code == 200
    assert plain.headers["content-type"].startswith("image/png")
    assert "immutable" not in plain.headers.get("cache-control", "")

    versioned = owner.get(
        f"/api/v1/materials/{MATERIAL_ID}/renders/s01.png", params={"v": "12345"}
    )
    assert versioned.status_code == 200
    assert versioned.headers["cache-control"] == "private, max-age=31536000, immutable"

    thumb = owner.get(
        f"/api/v1/materials/{MATERIAL_ID}/renders/s01.png", params={"w": 240, "v": "12345"}
    )
    assert thumb.status_code == 200
    assert thumb.headers["content-type"].startswith("image/webp")
    assert thumb.headers["cache-control"] == "private, max-age=31536000, immutable"


def test_concurrent_requests_generate_once(
    pages: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = pages / "s01.png"
    destination = pages / "thumbs" / "s01_w480.webp"
    calls: list[int] = []
    original = routes_materials._write_webp_thumbnail

    def counted(path: Path, target: Path, width: int) -> None:
        calls.append(width)
        original(path, target, width)

    monkeypatch.setattr(routes_materials, "_write_webp_thumbnail", counted)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(
            pool.map(
                lambda _index: routes_materials._ensure_thumbnail(source, destination, 480),
                range(8),
            )
        )
    assert results == [True] * 8
    assert calls == [480]
    with Image.open(destination) as image:
        assert image.width == 480


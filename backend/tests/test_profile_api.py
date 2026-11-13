"""账号资料与头像 API 测试（``C-PROFILE@1``）。

覆盖：
- 注册/登录后 ``/me`` 自带默认资料，``avatar_url`` 为空；
- ``PATCH /me`` 更新昵称、简介与偏好，并做长度/枚举校验；
- 资料修改必须带 CSRF，未登录 401；
- 头像上传（PNG 900×600）→ 服务端重编码为 512×512 JPEG，可读取、可删除；
- 非图片 400 ``INVALID_FILE``，超 2MB 413 ``LIMIT_EXCEEDED``。
"""

from __future__ import annotations

import io
import os
import tempfile
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

import pytest
from PIL import Image

# 必须在导入 ``app.main`` 之前固定测试数据库（``create_app`` 读 settings 单例）。
_TMP_DIR = Path(tempfile.mkdtemp(prefix="xiangsheng-profile-api-"))
os.environ["DATABASE_URL"] = "sqlite:///" + (_TMP_DIR / "bootstrap.db").as_posix()
os.environ["SESSION_COOKIE_SECURE"] = "false"
os.environ["ENFORCE_CSRF"] = "true"
os.environ["AUTH_COOKIE_NAME"] = "xs_auth"

from fastapi.testclient import TestClient  # noqa: E402

from app.db.session import get_engine, reset_engine_cache  # noqa: E402
from app.main import create_app  # noqa: E402
from app.settings import get_settings  # noqa: E402

get_settings.cache_clear()
reset_engine_cache()

PASSWORD = "example-password-2026"
AUTH_COOKIE = "xs_auth"


@pytest.fixture()
def client() -> Iterator[TestClient]:
    db_path = _TMP_DIR / f"profile-{uuid4().hex}.db"
    os.environ["DATABASE_URL"] = "sqlite:///" + db_path.as_posix()
    get_settings.cache_clear()
    reset_engine_cache()

    app = create_app()
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        get_engine().dispose()
        get_settings.cache_clear()
        reset_engine_cache()
        try:
            db_path.unlink(missing_ok=True)
        except OSError:  # pragma: no cover - 句柄延迟释放时交给临时目录清理
            pass


@pytest.fixture()
def avatar_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """把头像目录指到临时路径，避免测试污染 ``backend/data/avatars``。"""

    from app.accounts import avatars

    target = tmp_path / "avatars"
    monkeypatch.setattr(avatars, "AVATAR_DIR", target)
    return target


def _register_and_login(client: TestClient, *, email: str = "a@example.com") -> str:
    username = f"user_{uuid4().hex[:8]}"
    registered = client.post(
        "/api/v1/auth/register",
        json={"username": username, "email": email, "password": PASSWORD},
    )
    assert registered.status_code == 201
    assert registered.json()["data"]["avatar_url"] is None
    response = client.post(
        "/api/v1/auth/login",
        json={"identifier": username, "password": PASSWORD},
    )
    assert response.status_code == 200
    return str(response.json()["data"]["csrf_token"])


def _me(client: TestClient) -> dict[str, Any]:
    response = client.get("/api/v1/me")
    assert response.status_code == 200
    return response.json()["data"]


def _patch_me(client: TestClient, csrf: str | None, payload: dict[str, Any]) -> Any:
    headers: dict[str, str] = {}
    if csrf is not None:
        headers["X-CSRF-Token"] = csrf
    return client.patch("/api/v1/me", json=payload, headers=headers)


def _png_bytes(width: int, height: int, color: tuple[int, int, int]) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# 默认资料
# ---------------------------------------------------------------------------


def test_me_includes_default_profile(client: TestClient) -> None:
    _register_and_login(client)

    data = _me(client)

    assert data["user"]["avatar_url"] is None
    profile = data["profile"]
    assert profile["bio"] == ""
    assert profile["occupation"] == ""
    assert profile["school"] == ""
    assert profile["phone"] == ""
    assert profile["interests"] == []
    assert profile["preferred_subject"] == ""
    assert profile["default_entry"] == "space"
    assert profile["updated_at"].endswith("Z")


# ---------------------------------------------------------------------------
# PATCH /me
# ---------------------------------------------------------------------------


def test_patch_me_updates_display_name_and_preferences(client: TestClient) -> None:
    csrf = _register_and_login(client)

    response = _patch_me(
        client,
        csrf,
        {
            "display_name": "  林老师  ",
            "bio": " 把矩阵讲成可以拖动的东西。 ",
            "occupation": "教师",
            "school": "中国石油大学",
            "phone": " +86 138-1234-5678 ",
            "interests": [" 线性代数 ", "", "可视化", "线性代数"],
            "preferred_subject": "calculus",
            "default_entry": "labs",
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["user"]["display_name"] == "林老师"
    assert data["profile"]["bio"] == "把矩阵讲成可以拖动的东西。"
    assert data["profile"]["occupation"] == "教师"
    assert data["profile"]["school"] == "中国石油大学"
    assert data["profile"]["phone"] == "13812345678"
    assert data["profile"]["interests"] == ["线性代数", "可视化"]
    assert data["profile"]["preferred_subject"] == "calculus"
    assert data["profile"]["default_entry"] == "labs"

    refreshed = _me(client)["profile"]
    assert refreshed["bio"] == "把矩阵讲成可以拖动的东西。"
    assert refreshed["phone"] == "13812345678"
    assert refreshed["default_entry"] == "labs"

    # 选填字段可以留空清除。
    cleared = _patch_me(client, csrf, {"phone": ""})
    assert cleared.status_code == 200
    assert cleared.json()["data"]["profile"]["phone"] == ""


@pytest.mark.parametrize(
    "payload",
    [
        {"display_name": "   "},
        {"display_name": "x" * 65},
        {"bio": "x" * 201},
        {"interests": ["x" * 25]},
        {"interests": [f"t{i}" for i in range(9)]},
        {"default_entry": "home"},
        {"preferred_subject": "x" * 33},
        {"phone": "12345"},
        {"phone": "12812345678"},
        {"phone": "+86 1234"},
        {"phone": "138123456789"},
        {"unknown_field": True},
    ],
)
def test_patch_me_rejects_invalid_payload(client: TestClient, payload: dict[str, Any]) -> None:
    csrf = _register_and_login(client)

    response = _patch_me(client, csrf, payload)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "MISSING_FIELD"


def test_patch_me_requires_csrf_and_login(client: TestClient) -> None:
    csrf = _register_and_login(client)

    missing_csrf = _patch_me(client, None, {"bio": "x"})
    assert missing_csrf.status_code == 422
    assert missing_csrf.json()["error"]["code"] == "MISSING_FIELD"

    client.cookies.delete(AUTH_COOKIE)
    anonymous = _patch_me(client, csrf, {"bio": "x"})
    assert anonymous.status_code == 401
    assert anonymous.json()["error"]["code"] == "AUTH_REQUIRED"


# ---------------------------------------------------------------------------
# 头像
# ---------------------------------------------------------------------------


def test_avatar_upload_serve_and_delete(
    client: TestClient, avatar_dir: Path
) -> None:
    csrf = _register_and_login(client)

    uploaded = client.post(
        "/api/v1/me/avatar",
        files={"file": ("photo.png", _png_bytes(900, 600, (200, 60, 40)), "image/png")},
        headers={"X-CSRF-Token": csrf},
    )

    assert uploaded.status_code == 200
    data = uploaded.json()["data"]
    avatar_url = data["user"]["avatar_url"]
    assert isinstance(avatar_url, str)
    assert avatar_url.startswith("/api/v1/me/avatar?v=")

    served = client.get("/api/v1/me/avatar")
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/jpeg"
    width, height = Image.open(io.BytesIO(served.content)).size
    assert (width, height) == (512, 512)  # 服务端方形重编码

    me = _me(client)
    assert me["user"]["avatar_url"] == avatar_url
    assert me["profile"]["bio"] == ""

    deleted = client.delete("/api/v1/me/avatar", headers={"X-CSRF-Token": csrf})
    assert deleted.status_code == 200
    assert deleted.json()["data"]["user"]["avatar_url"] is None
    assert client.get("/api/v1/me/avatar").status_code == 404
    if avatar_dir.exists():
        assert list(avatar_dir.glob("*.jpg")) == []


def test_avatar_rejects_non_image_and_oversize(
    client: TestClient, avatar_dir: Path
) -> None:
    csrf = _register_and_login(client)
    headers = {"X-CSRF-Token": csrf}

    not_image = client.post(
        "/api/v1/me/avatar",
        files={"file": ("notes.png", b"this is not an image", "image/png")},
        headers=headers,
    )
    assert not_image.status_code == 400
    assert not_image.json()["error"]["code"] == "INVALID_FILE"

    oversize = client.post(
        "/api/v1/me/avatar",
        files={"file": ("huge.png", b"0" * (2 * 1024 * 1024 + 1), "image/png")},
        headers=headers,
    )
    assert oversize.status_code == 413
    assert oversize.json()["error"]["code"] == "LIMIT_EXCEEDED"

    # 失败上传不得留下文件，也不得改变资料。
    assert _me(client)["user"]["avatar_url"] is None

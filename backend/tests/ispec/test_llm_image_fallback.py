"""MaaS provider 与"逐页图片兜底"的测试。

覆盖：

1. ``MaasProvider`` 发出的请求形状（Bearer、模型名、图片 data URI）；
2. 非 200 / 401 → ``LLMUnavailable``，不抛裸异常；
3. 没配 Key 时 ``available()`` 为假且不发请求；
4. ``build_provider`` 在未配置时退回 ``NoopProvider``；
5. 逐页图片兜底：OCR 文本可作为证据、已有原生对象的页跳过、受调用预算约束。

全部用本地假服务，不访问外网、不需要 Key。
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.ispec import builder as builder_module
from app.ispec import build_ispecs_detailed
from app.ispec.llm import LLMRequest, LLMResponse, LLMUnavailable, MaasProvider, NoopProvider, build_provider


# ---------------------------------------------------------------------------
# 本地假服务
# ---------------------------------------------------------------------------


class _Handler(BaseHTTPRequestHandler):
    status = 200
    body: dict = {}
    last_headers: dict = {}
    last_payload: dict = {}
    calls = 0

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        type(self).last_payload = json.loads(self.rfile.read(length) or b"{}")
        type(self).last_headers = {k.lower(): v for k, v in self.headers.items()}
        type(self).calls += 1
        payload = json.dumps(self.body, ensure_ascii=False).encode("utf-8")
        self.send_response(self.status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args) -> None:
        return


@pytest.fixture()
def fake_maas():
    handler = type("Handler", (_Handler,), {"status": 200, "body": {}, "calls": 0})
    server = HTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield SimpleNamespace(
            handler=handler,
            base_url=f"http://127.0.0.1:{server.server_port}/openai/v1",
        )
    finally:
        server.shutdown()
        server.server_close()


def _ok_body(text: str) -> dict:
    return {"choices": [{"message": {"content": text}}]}


# ---------------------------------------------------------------------------
# 1~2. 请求形状与错误映射
# ---------------------------------------------------------------------------


def test_maas_provider_sends_bearer_model_and_image(fake_maas) -> None:
    fake_maas.handler.body = _ok_body("[]")
    provider = MaasProvider(api_key="k-test", model="glm-5.3", base_url=fake_maas.base_url)

    request = LLMRequest(
        pages=[{"page_no": 3, "text": "第 3 页原文", "elements_summary": "p3_s1（picture）"}],
        images=[{"page_no": 3, "data_uri": "data:image/png;base64,AAAA"}],
    )
    response = provider.propose(request)

    assert response.raw_text == "[]"
    assert fake_maas.handler.last_headers["authorization"] == "Bearer k-test"
    payload = fake_maas.handler.last_payload
    assert payload["model"] == "glm-5.3"
    parts = payload["messages"][1]["content"]
    assert parts[0]["type"] == "text"
    assert "第 3 页原文" in parts[0]["text"]
    assert parts[1] == {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}


def test_maas_provider_maps_http_errors_to_unavailable(fake_maas) -> None:
    fake_maas.handler.status = 401
    fake_maas.handler.body = {"error": "invalid api key"}
    provider = MaasProvider(api_key="bad", model="glm-5.3", base_url=fake_maas.base_url)

    with pytest.raises(LLMUnavailable):
        provider.propose(LLMRequest(pages=[{"page_no": 1, "text": "x"}]))


def test_maas_provider_is_unavailable_without_key() -> None:
    provider = MaasProvider(api_key="", model="glm-5.3", base_url="http://127.0.0.1:9/openai/v1")
    assert provider.available() is False
    with pytest.raises(LLMUnavailable):
        provider.propose(LLMRequest(pages=[]))


# ---------------------------------------------------------------------------
# 4. 工厂
# ---------------------------------------------------------------------------


def test_build_provider_returns_noop_until_configured() -> None:
    assert isinstance(build_provider(SimpleNamespace(llm_provider="none", llm_api_key="")), NoopProvider)
    assert isinstance(build_provider(SimpleNamespace(llm_provider="maas", llm_api_key="")), NoopProvider)
    configured = build_provider(
        SimpleNamespace(
            llm_provider="maas",
            llm_api_key="k",
            llm_model="glm-5.3",
            llm_base_url="http://127.0.0.1:1/openai/v1",
            llm_timeout_s=10,
        )
    )
    assert isinstance(configured, MaasProvider)


# ---------------------------------------------------------------------------
# 5. 逐页图片兜底
# ---------------------------------------------------------------------------

OCR_TEXT = "旋转矩阵 R（图上标注）"
PAGE_TEXT = "旋转九十度"


def _picture_page(page_no: int = 1) -> dict:
    return {
        "page_no": page_no,
        "title": "",
        "paragraphs": [PAGE_TEXT],
        "elements": [
            {
                "element_id": f"p{page_no}_s1",
                "kind": "picture",
                "text": OCR_TEXT,
                "bbox": {"x": 0, "y": 0, "w": 100, "h": 100},
            }
        ],
    }


def _spec(excerpt: str, object_id: str = "llm_rot_p1") -> dict:
    return {
        "spec_version": "1.0",
        "object_id": object_id,
        "title": "旋转矩阵",
        "kind": "filter",
        "parameters": [
            {
                "id": "category",
                "label": "分类",
                "type": "enum",
                "default": "全部",
                "options": ["全部", "一", "二"],
                "source": {"page": 1, "status": "original", "excerpt": excerpt},
            }
        ],
        "views": [{"type": "table", "columns": ["category"], "title": "候选数据"}],
    }


class _MockProvider:
    name = "mock"

    def __init__(self, raw_text: str) -> None:
        self._raw_text = raw_text
        self.calls = 0
        self.requests: list[LLMRequest] = []

    def available(self) -> bool:
        return True

    def propose(self, request: LLMRequest) -> LLMResponse:
        self.calls += 1
        self.requests.append(request)
        return LLMResponse(raw_text=self._raw_text, model="mock")


def test_page_fallback_accepts_ocr_text_as_evidence(tmp_path: Path, monkeypatch) -> None:
    page_dir = tmp_path / "mat_img" / "pages"
    page_dir.mkdir(parents=True)
    (page_dir / "s01.png").write_bytes(b"\x89PNG-fake")
    monkeypatch.setattr("app.settings.RENDERS_DIR", tmp_path)
    monkeypatch.setattr(builder_module, "_llm_budget", lambda: 3)

    provider = _MockProvider(json.dumps([_spec("旋转矩阵")], ensure_ascii=False))
    parsed = {"material_id": "mat_img", "slides": [_picture_page()]}

    result = build_ispecs_detailed(parsed, material_id="mat_img", llm=provider)

    assert provider.calls == 1
    assert [spec["object_id"] for spec in result.ispecs] == ["llm_rot_p1"]
    request = provider.requests[0]
    assert request.images and request.images[0]["data_uri"].startswith("data:image/png;base64,")
    assert OCR_TEXT in request.pages[0]["text"]


def test_page_fallback_rejects_ungrounded_excerpt(tmp_path: Path, monkeypatch) -> None:
    page_dir = tmp_path / "mat_img2" / "pages"
    page_dir.mkdir(parents=True)
    (page_dir / "s01.png").write_bytes(b"\x89PNG-fake")
    monkeypatch.setattr("app.settings.RENDERS_DIR", tmp_path)
    monkeypatch.setattr(builder_module, "_llm_budget", lambda: 3)

    provider = _MockProvider(json.dumps([_spec("图里没有这句话")], ensure_ascii=False))
    result = build_ispecs_detailed(
        {"material_id": "mat_img2", "slides": [_picture_page()]},
        material_id="mat_img2",
        llm=provider,
    )

    assert result.ispecs == []
    assert any(item.get("code") == "LLM_EVIDENCE_REJECTED" for item in result.errors)


def test_page_fallback_skips_pages_that_already_have_objects(tmp_path: Path, monkeypatch) -> None:
    page_dir = tmp_path / "mat_native" / "pages"
    page_dir.mkdir(parents=True)
    (page_dir / "s01.png").write_bytes(b"\x89PNG-fake")
    monkeypatch.setattr("app.settings.RENDERS_DIR", tmp_path)
    monkeypatch.setattr(builder_module, "_llm_budget", lambda: 3)

    page = _picture_page()
    page["elements"].append(
        {
            "element_id": "p1_t1",
            "kind": "table",
            "table_data": {"headers": ["姓名", "分数"], "rows": [["张三", "95"]]},
        }
    )
    provider = _MockProvider(json.dumps([_spec("旋转矩阵")], ensure_ascii=False))
    result = build_ispecs_detailed(
        {"material_id": "mat_native", "slides": [page]},
        material_id="mat_native",
        llm=provider,
    )

    assert result.ispecs  # 原生表格已产出
    assert provider.calls == 0


def test_page_fallback_respects_budget(tmp_path: Path, monkeypatch) -> None:
    page_dir = tmp_path / "mat_budget" / "pages"
    page_dir.mkdir(parents=True)
    for page_no in (1, 2, 3):
        (page_dir / f"s{page_no:02d}.png").write_bytes(b"\x89PNG-fake")
    monkeypatch.setattr("app.settings.RENDERS_DIR", tmp_path)
    monkeypatch.setattr(builder_module, "_llm_budget", lambda: 1)

    provider = _MockProvider("[]")
    parsed = {"material_id": "mat_budget", "slides": [_picture_page(1), _picture_page(2), _picture_page(3)]}
    build_ispecs_detailed(parsed, material_id="mat_budget", llm=provider)

    assert provider.calls == 1

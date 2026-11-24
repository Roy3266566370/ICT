"""T02：PPTAIClient 的故障分类、预算与安全边界（不访问真实 API）。"""

from __future__ import annotations

import json

import pytest

from app.ppt_ai.client import PPTAIClient, PPTAIError
from app.ppt_ai.types import CallBudget
from app.settings import Settings


class FakeTransport:
    def __init__(self, status: int = 200, payload: dict | None = None, error: Exception | None = None):
        self.status = status
        self.payload = payload or {}
        self.error = error
        self.requests: list[dict] = []

    def post(self, url, *, headers, json_body, timeout):
        self.requests.append({"url": url, "headers": dict(headers), "body": json_body, "timeout": timeout})
        if self.error:
            raise self.error
        return self.status, self.payload


def settings(**overrides) -> Settings:
    values = {
        "llm_provider": "maas",
        "llm_api_key": "unit-test-key-not-real",
        "llm_model": "unit-model",
        "llm_base_url": "https://example.invalid/v2",
        "llm_timeout_s": 5,
        "ppt_ai_max_llm_tokens": 1024,
        "living_figure_vision_provider": "none",
        "living_figure_vision_api_key": "",
        "living_figure_vision_model": "",
        "living_figure_vision_base_url": "",
    }
    values.update(overrides)
    return Settings(**values)


def response(content: str | None, *, finish_reason: str = "stop", usage: dict | None = None) -> dict:
    return {
        "choices": [
            {
                "finish_reason": finish_reason,
                "message": {"content": content},
            }
        ],
        "usage": usage or {"prompt_tokens": 12, "completion_tokens": 7},
    }


def test_auth_and_rate_limit_are_classified() -> None:
    client = PPTAIClient(settings(), transport=FakeTransport(401, {"error": "bad"}))
    with pytest.raises(PPTAIError) as exc:
        client.generate_json("plan", {"text": "x"}, "v1", CallBudget(max_calls=1))
    assert exc.value.kind == "auth"
    assert "unit-test-key-not-real" not in str(exc.value)

    client = PPTAIClient(settings(), transport=FakeTransport(429, {}))
    with pytest.raises(PPTAIError) as exc:
        client.generate_json("plan", {"text": "x"}, "v1", CallBudget(max_calls=1))
    assert exc.value.kind == "rate_limit" and exc.value.retryable


def test_model_schema_is_sent_only_when_endpoint_support_is_enabled():
    from app.labs.model_contract import contract_payload
    for enabled in (False, True):
        transport = FakeTransport(200, response('{"question":"原题","model":{"kind":"none"},"answer":"概念解释"}'))
        client = PPTAIClient(settings(llm_json_schema=enabled), transport=transport)
        client.generate_json('lab_model_question', contract_payload(), 'v1', CallBudget(max_calls=1))
        fmt = transport.requests[0]['body']['response_format']
        assert fmt['type'] == ('json_schema' if enabled else 'json_object')
        if enabled:
            assert fmt['json_schema']['schema']['properties']['model']['anyOf'][0] == contract_payload()['generic_schema']


def test_invalid_schema_json_gets_one_budgeted_compatibility_retry():
    class Transport(FakeTransport):
        def post(self, url, **kwargs):
            super().post(url, **kwargs)
            return 200, response('{bad json' if len(self.requests) == 1 else '{"model":{"kind":"none"},"answer":"参考"}')

    transport = Transport()
    budget = CallBudget(max_calls=2)
    client = PPTAIClient(settings(llm_json_schema=True), transport=transport)
    result = client.generate_json('model', {'response_schema': {'type': 'object'}}, 'v1', budget)
    assert budget.used_calls == 2
    assert transport.requests[1]['body']['response_format']['type'] == 'json_object'
    assert result.data['_format_recovery']['previous_output'] == '{bad json'


def test_invalid_schema_json_never_exceeds_budget():
    transport = FakeTransport(200, response('{bad json'))
    client = PPTAIClient(settings(llm_json_schema=True), transport=transport)
    with pytest.raises(PPTAIError, match='JSON'):
        client.generate_json('model', {'response_schema': {'type': 'object'}}, 'v1', CallBudget(max_calls=1))
    assert len(transport.requests) == 1


def test_schema_http_400_retries_in_json_object_mode():
    class Transport(FakeTransport):
        def post(self, url, **kwargs):
            super().post(url, **kwargs)
            return (400, {}) if len(self.requests) == 1 else (200, response('{"ok":true}'))

    transport = Transport()
    budget = CallBudget(max_calls=2)
    result = PPTAIClient(settings(llm_json_schema=True), transport=transport).generate_json(
        'model', {'response_schema': {'type': 'object'}}, 'v1', budget)
    assert result.data['ok'] is True
    assert budget.used_calls == 2
    assert transport.requests[1]['body']['response_format']['type'] == 'json_object'


def test_failed_calls_consume_persisted_budget_before_http() -> None:
    transport = FakeTransport(500, {})
    budget = CallBudget(max_calls=1)
    attempts: list[int] = []
    client = PPTAIClient(settings(), transport=transport)
    with pytest.raises(PPTAIError) as exc:
        client.generate_json("plan", {"text": "x"}, "v1", budget, on_attempt=attempts.append)
    assert exc.value.kind == "transport"
    assert budget.used_calls == 1
    assert attempts == [1]
    assert len(transport.requests) == 1

    with pytest.raises(PPTAIError) as exhausted:
        client.generate_json("plan", {"text": "x"}, "v1", budget, on_attempt=attempts.append)
    assert exhausted.value.kind == "budget"
    assert len(transport.requests) == 1
    assert attempts == [1]


def test_timeout_and_truncation() -> None:
    client = PPTAIClient(settings(), transport=FakeTransport(error=TimeoutError("late")))
    with pytest.raises(PPTAIError) as exc:
        client.generate_json("plan", {}, "v1", CallBudget(max_calls=1))
    assert exc.value.kind == "timeout"

    client = PPTAIClient(settings(), transport=FakeTransport(200, response("{\"a\":1}", finish_reason="length")))
    with pytest.raises(PPTAIError) as exc:
        client.generate_json("plan", {}, "v1", CallBudget(max_calls=1))
    assert exc.value.kind == "truncated"


def test_invalid_json_and_schema_rejection() -> None:
    client = PPTAIClient(settings(), transport=FakeTransport(200, response("not json")))
    with pytest.raises(PPTAIError) as exc:
        client.generate_json("plan", {}, "v1", CallBudget(max_calls=1))
    assert exc.value.kind == "invalid_json"

    client = PPTAIClient(settings(), transport=FakeTransport(200, response("{\"answer\": 1}")))
    with pytest.raises(PPTAIError) as exc:
        client.generate_json(
            "plan",
            {},
            "v1",
            CallBudget(max_calls=1),
            validator=lambda data: (_ for _ in ()).throw(ValueError("missing options")),
        )
    assert exc.value.kind == "schema"


def test_instructor_reasks_for_truncation_and_wrong_field_type():
    class SequenceTransport(FakeTransport):
        def post(self, url, **kwargs):
            super().post(url, **kwargs)
            return 200, [
                response('{"program":', finish_reason="length"),
                response('{"program":42}'),
                response('{"program":"function render(input) {}"}'),
            ][len(self.requests)-1]

    transport = SequenceTransport()
    attempts = []
    result = PPTAIClient(settings(), transport=transport).generate_json(
        'generated_view', {}, 'v1', CallBudget(max_calls=3), on_attempt=attempts.append,
    )
    assert result.data['program'].startswith('function render')
    assert attempts == [1, 2, 3]
    assert '截断' in transport.requests[1]['body']['messages'][-1]['content']
    assert 'program' in transport.requests[2]['body']['messages'][-1]['content']


def test_budget_is_enforced_and_success_increments() -> None:
    transport = FakeTransport(200, response(json.dumps({"ok": True})))
    client = PPTAIClient(settings(), transport=transport)
    budget = CallBudget(max_calls=1, used_calls=1)
    with pytest.raises(PPTAIError) as exc:
        client.generate_json("plan", {}, "v1", budget)
    assert exc.value.kind == "budget"
    assert transport.requests == []

    budget = CallBudget(max_calls=2)
    result = client.generate_json("plan", {"text": "untrusted"}, "v1", budget)
    assert result.data == {"ok": True}
    assert budget.used_calls == 1
    assert transport.requests[0]["url"] == "https://example.invalid/v2/chat/completions"
    body = transport.requests[0]["body"]
    assert "不可信数据" in body["messages"][0]["content"]
    assert "unit-test-key-not-real" not in json.dumps(body, ensure_ascii=False)
    assert transport.requests[0]["headers"]["Authorization"].startswith("Bearer ")


def test_request_limit_and_unavailable() -> None:
    client = PPTAIClient(settings(), transport=FakeTransport())
    budget = CallBudget(max_calls=1, request_bytes_limit=64)
    with pytest.raises(PPTAIError) as exc:
        client.generate_json("plan", {"text": "x" * 500}, "v1", budget)
    assert exc.value.kind == "request_too_large"

    unavailable = PPTAIClient(settings(llm_provider="none"))
    with pytest.raises(PPTAIError) as exc:
        unavailable.generate_json("plan", {}, "v1", CallBudget(max_calls=1))
    assert exc.value.kind == "disabled"


def test_httpx_transport_falls_back_to_physical_nic_only_on_fake_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx
    import app.ppt_ai.client as client_mod

    client_mod._DIRECT_ROUTE_CACHE.clear()
    calls: list[dict] = []

    class DummyResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"ok": True}

    class DummyClient:
        def __init__(self, *, transport=None, trust_env=True, **kwargs):
            self.transport = transport
            self.trust_env = trust_env

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, *, headers=None, json=None, extensions=None):
            calls.append({"url": url, "headers": headers, "trust_env": self.trust_env, "extensions": extensions})
            if len(calls) == 1:
                raise httpx.ConnectError("[SSL: UNEXPECTED_EOF_WHILE_READING]")
            return DummyResponse()

    monkeypatch.setattr(httpx, "Client", DummyClient)
    monkeypatch.setattr(client_mod, "_host_resolves_to_fake_ip", lambda host: host == "api.modelarts-maas.com")
    monkeypatch.setattr(client_mod, "_probe_direct_route", lambda host: ("172.25.108.233", "1.95.59.212"))

    status, payload = client_mod.HttpxTransport().post(
        "https://api.modelarts-maas.com/v2/chat/completions",
        headers={"Authorization": "Bearer test", "host": "api.modelarts-maas.com", "content-length": "999"},
        json_body={"model": "x"},
        timeout=5.0,
    )
    assert status == 200
    assert payload == {"ok": True}
    assert len(calls) == 2
    assert calls[0]["url"] == "https://api.modelarts-maas.com/v2/chat/completions"
    assert "host" not in calls[0]["headers"]
    assert "content-length" not in calls[0]["headers"]
    assert calls[1]["url"] == "https://1.95.59.212/v2/chat/completions"
    assert calls[1]["headers"]["Host"] == "api.modelarts-maas.com"
    assert "host" not in calls[1]["headers"]
    assert "content-length" not in calls[1]["headers"]
    assert calls[1]["extensions"] == {"sni_hostname": "api.modelarts-maas.com"}
    assert calls[1]["trust_env"] is False
    client_mod._DIRECT_ROUTE_CACHE.clear()


def test_httpx_transport_ignores_unparseable_proxy_env(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx
    import app.ppt_ai.client as client_mod

    calls: list[dict] = []

    class DummyResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"ok": True}

    class EnvAwareClient:
        def __init__(self, *, trust_env=True, **kwargs):
            if trust_env:
                raise httpx.InvalidURL("Invalid port: ':1]'")
            self.trust_env = trust_env

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, *, headers=None, json=None):
            calls.append({"url": url, "trust_env": self.trust_env})
            return DummyResponse()

    monkeypatch.setattr(httpx, "Client", EnvAwareClient)

    status, payload = client_mod.HttpxTransport().post(
        "https://api.modelarts-maas.com/v2/chat/completions",
        headers={"Authorization": "Bearer test"},
        json_body={"model": "x"},
        timeout=5.0,
    )
    assert status == 200
    assert payload == {"ok": True}
    assert calls == [{"url": "https://api.modelarts-maas.com/v2/chat/completions", "trust_env": False}]

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

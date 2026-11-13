"""P1-08：LLM 识别层接口、prompt、响应解析与证据拒收的单元测试。

覆盖六条验收（全部使用测试内 Mock provider，**不访问任何网络**）：

1. 合法 JSON（page + excerpt 命中原文）→ 产出 iSpec；
2. excerpt 不在原文 → 拒收，``rejected`` 有原因；
3. 缺 ``source.page`` → 拒收；
4. 非法 JSON → ``ok=False`` 且不抛异常；
5. ``NoopProvider.available() == False`` → 不调用、不报错、reason 含"LLM 未配置"；
6. 原生已有 iSpec 时不调用 LLM（调用次数为 0）。
"""

from __future__ import annotations

import json
from typing import Any

from app.ispec import build_ispecs_detailed
from app.ispec.llm import (
    LLMRequest,
    LLMResponse,
    LLMUnavailable,
    NoopProvider,
    build_prompt,
    parse_ispecs,
)

PAGE_TEXT = "季度销售额：一月、二月、三月；成本同步展示。"
PAGES: list[dict[str, Any]] = [{"page_no": 1, "text": PAGE_TEXT}]


def _valid_ispec(
    *,
    object_id: str = "ispec_llm_chart_p01",
    excerpt: str = "季度销售额",
    with_page: bool = True,
    page: int = 1,
) -> dict[str, Any]:
    """构造一条 Schema 合法的 filter iSpec（证据字段可定制）。"""

    source: dict[str, Any] = {"status": "original", "excerpt": excerpt}
    if with_page:
        source["page"] = page
    return {
        "spec_version": "1.0",
        "object_id": object_id,
        "title": "季度销售额图表",
        "kind": "filter",
        "parameters": [
            {
                "id": "category",
                "label": "分类",
                "type": "enum",
                "default": "全部",
                "options": ["全部", "一月", "二月", "三月"],
                "source": source,
            }
        ],
        "views": [
            {
                "type": "table",
                "columns": ["category", "value"],
                "title": "LLM 提议的只读数据",
            }
        ],
    }


class MockProvider:
    """测试用 provider：返回预设文本，并记录调用次数与请求。"""

    name = "mock"

    def __init__(self, raw_text: str, *, available: bool = True) -> None:
        self._raw_text = raw_text
        self._available = available
        self.calls = 0
        self.last_request: LLMRequest | None = None

    def available(self) -> bool:
        return self._available

    def propose(self, request: LLMRequest) -> LLMResponse:
        self.calls += 1
        self.last_request = request
        return LLMResponse(raw_text=self._raw_text, model="mock-model")


def _payload(*specs: dict[str, Any]) -> str:
    return json.dumps(list(specs), ensure_ascii=False)


# ---------------------------------------------------------------------------
# 1. 合法 JSON + excerpt 命中原文 → 产出 iSpec
# ---------------------------------------------------------------------------


def test_valid_response_with_matching_excerpt_produces_ispec() -> None:
    provider = MockProvider(_payload(_valid_ispec()))
    parsed = {
        "material_id": "mat_llm_valid",
        "slides": [
            {
                "page_no": 1,
                "title": "",
                "elements": [],
                "paragraphs": [PAGE_TEXT],
            }
        ],
    }

    result = build_ispecs_detailed(parsed, material_id="mat_llm_valid", llm=provider)

    assert provider.calls == 1
    assert [spec["object_id"] for spec in result.ispecs] == ["ispec_llm_chart_p01"]
    assert result.recognition["found"] is True
    assert "LLM 提议" in result.recognition["reason"]

    # 请求形状：pages 带 page_no/text/elements_summary，hints 给出 kind 与上限。
    assert provider.last_request is not None
    assert provider.last_request.pages[0]["page_no"] == 1
    assert PAGE_TEXT in provider.last_request.pages[0]["text"]
    assert "elements_summary" in provider.last_request.pages[0]
    assert provider.last_request.hints["max_specs"] == 8
    assert "filter" in provider.last_request.hints["supported_kinds"]


# ---------------------------------------------------------------------------
# 2. excerpt 不在原文 → 拒收
# ---------------------------------------------------------------------------


def test_excerpt_not_in_source_is_rejected() -> None:
    outcome = parse_ispecs(
        _payload(_valid_ispec(excerpt="原文里根本不存在的句子")),
        pages=PAGES,
    )

    assert outcome.ok is True
    assert outcome.ispecs == []
    assert outcome.rejected == [
        {"index": 0, "reason": "excerpt 未在原文中出现"}
    ]


# ---------------------------------------------------------------------------
# 3. 缺 source.page → 拒收
# ---------------------------------------------------------------------------


def test_missing_source_page_is_rejected() -> None:
    outcome = parse_ispecs(
        _payload(_valid_ispec(with_page=False)),
        pages=PAGES,
    )

    assert outcome.ok is True
    assert outcome.ispecs == []
    assert len(outcome.rejected) == 1
    assert "source.page" in outcome.rejected[0]["reason"]


# ---------------------------------------------------------------------------
# 4. 非法 JSON → ok=False 且不抛异常
# ---------------------------------------------------------------------------


def test_invalid_json_does_not_raise() -> None:
    outcome = parse_ispecs("这不是 JSON，模型跑偏了。", pages=PAGES)

    assert outcome.ok is False
    assert outcome.reason
    assert outcome.ispecs == []

    # 经过 builder 时也只记录诊断，不抛异常、不影响原生结果（此处原生为空）。
    provider = MockProvider("不是 JSON")
    result = build_ispecs_detailed(
        {"material_id": "mat_bad_json", "slides": []},
        material_id="mat_bad_json",
        llm=provider,
    )
    assert result.ispecs == []
    assert any(item.get("code") == "LLM_RESPONSE_INVALID" for item in result.errors)


# ---------------------------------------------------------------------------
# 5. NoopProvider 不可用 → 不调用、不报错、reason 含"LLM 未配置"
# ---------------------------------------------------------------------------


def test_noop_provider_degrades_without_error() -> None:
    result = build_ispecs_detailed(
        {"material_id": "mat_noop", "slides": []},
        material_id="mat_noop",
        llm=NoopProvider(),
    )

    assert result.ispecs == []
    assert result.recognition["found"] is False
    assert "LLM 未配置" in result.recognition["reason"]
    # 未配置不是错误：不得出现 MODEL_UNAVAILABLE 记录。
    assert not any(item.get("code") == "MODEL_UNAVAILABLE" for item in result.errors)


# ---------------------------------------------------------------------------
# 6. 原生已有 iSpec → 不调用 LLM
# ---------------------------------------------------------------------------


def test_native_ispec_skips_llm() -> None:
    provider = MockProvider(_payload(_valid_ispec(object_id="llm_should_not_be_used")))
    parsed = {
        "material_id": "mat_native_table",
        "slides": [
            {
                "page_no": 1,
                "title": "成绩表",
                "paragraphs": ["姓名 分数"],
                "elements": [
                    {
                        "element_id": "p01_s01",
                        "kind": "table",
                        "table_data": {
                            "headers": ["姓名", "分数"],
                            "rows": [["张三", "95"]],
                        },
                    }
                ],
            }
        ],
    }

    result = build_ispecs_detailed(parsed, material_id="mat_native_table", llm=provider)

    assert provider.calls == 0
    assert result.ispecs
    assert "llm_should_not_be_used" not in {
        spec.get("object_id") for spec in result.ispecs
    }
    # 原生已成功，不需要再提示 LLM 边界。
    assert "LLM 未配置" not in result.recognition["reason"]


# ---------------------------------------------------------------------------
# 附：provider 调用异常 → MODEL_UNAVAILABLE，不抛裸异常
# ---------------------------------------------------------------------------


class BoomProvider:
    """可用但调用一定失败的 provider。"""

    name = "boom"

    def available(self) -> bool:
        return True

    def propose(self, request: LLMRequest) -> LLMResponse:
        raise LLMUnavailable("模拟模型服务不可用")


def test_provider_exception_maps_to_model_unavailable() -> None:
    result = build_ispecs_detailed(
        {"material_id": "mat_boom", "slides": []},
        material_id="mat_boom",
        llm=BoomProvider(),
    )

    assert result.ispecs == []
    assert any(item.get("code") == "MODEL_UNAVAILABLE" for item in result.errors)
    assert "MODEL_UNAVAILABLE" in result.recognition["reason"]


# ---------------------------------------------------------------------------
# prompt 约束（不单独计数验收，但保证模板真的要求证据字段）
# ---------------------------------------------------------------------------


def test_prompt_requires_json_array_and_evidence_fields() -> None:
    prompt = build_prompt(
        LLMRequest(
            pages=[
                {
                    "page_no": 1,
                    "text": PAGE_TEXT,
                    "elements_summary": "p01_s01（chart）",
                }
            ],
            hints={"supported_kinds": ["filter"], "max_specs": 8},
        )
    )

    assert "JSON 数组" in prompt
    assert "source.page" in prompt
    assert "excerpt" in prompt
    assert "逐字复制" in prompt
    assert PAGE_TEXT in prompt
    assert "最多 8 个元素" in prompt
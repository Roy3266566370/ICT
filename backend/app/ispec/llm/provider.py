"""iSpec proposal provider interface.

Providers can validate the response shape before returning the JSON proposals.
The builder verifies every accepted proposal against the source material.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol, Sequence, runtime_checkable


@dataclass(frozen=True, slots=True)
class LLMRequest:
    """发给模型的识别请求（只含只读原文，不含用户凭据）。

    :param pages: 页面列表，元素形状为
        ``{"page_no": int, "text": str, "elements_summary": str}``；
        ``text`` 是该页**原文**，也是后续 ``excerpt`` 的唯一核验依据。
    :param hints: 提示信息，如 ``{"supported_kinds": [...], "max_specs": 8}``。
    """

    pages: Sequence[Mapping[str, Any]] = field(default_factory=tuple)
    hints: Mapping[str, Any] = field(default_factory=dict)
    #: 与 ``pages`` 对应的整页图，形状 ``{"page_no": int, "data_uri": str}``。
    #: 纯文本 provider 会忽略它；多模态 provider 把它作为 ``image_url`` 发送。
    images: Sequence[Mapping[str, Any]] = field(default_factory=tuple)
    material_id: str | None = None


@dataclass(frozen=True, slots=True)
class LLMResponse:
    """交给识别层核验的 JSON 文本及模型标识。"""

    raw_text: str
    model: str


class LLMUnavailable(RuntimeError):
    """provider 未配置或调用失败时抛出（调用方映射为 ``MODEL_UNAVAILABLE``）。"""


class LLMResponseInvalid(LLMUnavailable):
    """The configured model exhausted its bounded output repair attempts."""


@runtime_checkable
class ISpecLLMProvider(Protocol):
    """识别层对模型的唯一依赖面。

    ``available()`` 必须是无副作用的探针：返回 ``False`` 表示未配置/不可用，
    调用方应静默降级而不是报错；``propose()`` 只在 ``available()`` 为真时调用。
    """

    name: str

    def available(self) -> bool:
        """是否可用（未配置时返回 ``False``，不得抛异常）。"""

        ...

    def propose(self, request: LLMRequest) -> LLMResponse:
        """把请求交给模型并返回原始文本；失败时抛 :class:`LLMUnavailable`。"""

        ...


__all__ = [
    "ISpecLLMProvider",
    "LLMRequest",
    "LLMResponse",
    "LLMUnavailable",
]

"""LLM provider 抽象（**仅接口，不含任何真实网络调用**）。

设计约束
========

* 识别层只依赖 :class:`ISpecLLMProvider`，不关心底层是哪个厂商的模型；
* 本仓库**没有**实现真实 provider：没有密钥、没有 URL、没有外网调用。
  接入真实模型时，需要实现本协议并在调用方注入，至少补齐：

  ==============  ==========================================================
  需要补的东西      说明
  ==============  ==========================================================
  ``base_url``     厂商的 ``/chat/completions`` 之类端点（禁止写死在代码里）
  ``api_key``      从环境变量读取（``ISEPC_LLM_API_KEY``），不得硬编码
  ``model``        模型名（``ISEPC_LLM_MODEL``）
  响应格式假设      返回 JSON 对象，正文位于 ``choices[0].message.content``
                    （OpenAI 兼容格式）；provider 负责把正文放进
                    :attr:`LLMResponse.raw_text`，解析与校验仍由
                    :func:`app.ispec.llm.parse.parse_ispecs` 完成
  HTTP 客户端      ``urllib.request`` 或已批准依赖；须设置
                    ``ISEPC_LLM_TIMEOUT_S`` 超时、失败重试上限
                    ``ISEPC_LLM_MAX_CALLS``
  ==============  ==========================================================

* provider 只负责"把请求发出去、把原始文本收回来"，**不得**自行相信模型输出；
* 任何异常都由调用方捕获并降级为 ``MODEL_UNAVAILABLE``。
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


@dataclass(frozen=True, slots=True)
class LLMResponse:
    """模型返回的原始文本；解析、Schema 校验与证据核验都不在这里做。"""

    raw_text: str
    model: str


class LLMUnavailable(RuntimeError):
    """provider 未配置或调用失败时抛出（调用方映射为 ``MODEL_UNAVAILABLE``）。"""


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
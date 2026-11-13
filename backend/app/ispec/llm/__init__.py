"""识别层的 LLM 接口（``P1-08``）：抽象 provider + prompt + 响应解析与证据校验。

**重要边界**：本包只提供接口、降级与严格拒收，**没有接入任何真实大模型**，
也不会发起任何网络请求。真实 provider 需由部署方按
:mod:`app.ispec.llm.provider` 的接口另行实现并注入。

识别流程（见 :func:`app.ispec.builder.build_ispecs_detailed`）：

1. 原生图表/表格/公式优先（确定性直读，不经过模型）；
2. 原生没有产出任何 iSpec 时，才尝试 LLM（``available()`` 为真才会调用）；
3. LLM 响应必须逐条满足 ``source.page`` + ``source.excerpt`` 且 ``excerpt``
   能在该页原文中找到，否则整条丢弃——**无证据不出结论**；
4. 模型不可用/调用失败只记录 ``MODEL_UNAVAILABLE``，不影响原生结果。
"""

from __future__ import annotations

from typing import Any

from .fault import FaultInjectionProvider, SCENARIOS
from .maas import MaasProvider
from .noop import NoopProvider
from .parse import ParseOutcome, parse_ispecs
from .prompt import build_prompt
from .provider import (
    ISpecLLMProvider,
    LLMRequest,
    LLMResponse,
    LLMUnavailable,
)


def build_provider(settings: Any = None) -> ISpecLLMProvider:
    """按配置返回 provider；任何缺项都退回 :class:`NoopProvider`（不联网）。

    ``LLM_PROVIDER=maas`` 且 ``LLM_API_KEY`` 非空时才启用真实调用；
    默认 ``none``，保证无 Key 环境与 CI 环境行为不变。
    """

    if settings is None:
        from ...settings import get_settings

        settings = get_settings()

    provider = str(getattr(settings, "llm_provider", "none") or "none").strip().lower()
    api_key = str(getattr(settings, "llm_api_key", "") or "").strip()
    if provider != "maas" or not api_key:
        return NoopProvider()

    return MaasProvider(
        api_key=api_key,
        model=str(getattr(settings, "llm_model", "") or ""),
        base_url=str(getattr(settings, "llm_base_url", "") or ""),
        timeout_s=int(getattr(settings, "llm_timeout_s", 60) or 60),
    )


__all__ = [
    "ISpecLLMProvider",
    "LLMRequest",
    "LLMResponse",
    "LLMUnavailable",
    "FaultInjectionProvider",
    "SCENARIOS",
    "MaasProvider",
    "NoopProvider",
    "ParseOutcome",
    "build_prompt",
    "build_provider",
    "parse_ispecs",
]
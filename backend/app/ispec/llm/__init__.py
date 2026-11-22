"""识别层的 LLM 接口（``P1-08``）：抽象 provider + prompt + 响应解析与证据校验。

识别流程（见 :func:`app.ispec.builder.build_ispecs_detailed`）：

1. 原生图表/表格/公式优先（确定性直读，不经过模型）；
2. 原生没有产出任何 iSpec 时，才尝试 LLM（``available()`` 为真才会调用）；
   优先使用支持图像输入的视觉模型配置（``LIVING_FIGURE_VISION_*``），
   未配置时回落到 ``LLM_PROVIDER=maas``，均未配置则返回 :class:`NoopProvider`；
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
    """按配置返回 provider；优先使用视觉模型配置（支持图片输入），缺项时回落文本模型或 NoopProvider。"""

    if settings is None:
        from ...settings import get_settings

        settings = get_settings()

    # 优先复用活页视觉模型（如 Qwen3-VL-32B），避免把图片发给纯文本模型导致空转。
    try:
        from ...model_profiles import vision_profile

        vp = vision_profile(settings)
        if vp.available:
            return MaasProvider(
                api_key=vp.api_key,
                model=vp.model,
                base_url=vp.base_url,
                timeout_s=vp.timeout_s,
                max_tokens=4096,
            )
    except Exception:  # noqa: BLE001 - 配置读取异常时安全回落
        pass

    provider = str(getattr(settings, "llm_provider", "none") or "none").strip().lower()
    api_key = str(getattr(settings, "llm_api_key", "") or "").strip()
    if provider != "maas" or not api_key:
        return NoopProvider()

    return MaasProvider(
        api_key=api_key,
        model=str(getattr(settings, "llm_model", "") or ""),
        base_url=str(getattr(settings, "llm_base_url", "") or ""),
        timeout_s=int(getattr(settings, "llm_timeout_s", 60) or 60),
        max_tokens=4096,
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
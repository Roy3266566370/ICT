"""未配置模型时的空实现：``available()`` 恒 ``False``，``propose()`` 必抛。

它的存在是为了让调用链有一个**明确的降级分支**，而不是用 ``None`` 隐式判断；
真实 provider 未接入时，识别层必须能稳定地走到"LLM 未配置"的提示上。
"""

from __future__ import annotations

from .provider import LLMRequest, LLMResponse, LLMUnavailable

#: 未配置时展示给调用方的统一文案（builder 会把它拼进 ``recognition.reason``）。
UNAVAILABLE_MESSAGE = "LLM 未配置：未启用图片/截图识别"


class NoopProvider:
    """永远不可用的 provider；不发起任何网络请求。"""

    name = "none"

    def available(self) -> bool:
        return False

    def propose(self, request: LLMRequest) -> LLMResponse:
        """未配置时拒绝调用，避免上层误以为已经接入模型。"""

        raise LLMUnavailable(UNAVAILABLE_MESSAGE)


__all__ = ["UNAVAILABLE_MESSAGE", "NoopProvider"]
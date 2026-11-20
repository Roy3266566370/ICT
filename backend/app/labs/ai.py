"""题目实验室的可选模型增强。

默认 ``LAB_AI_ENABLED=false``，即使项目根目录已经配置了 LLM 凭据也不会发起调用。
只有同时满足以下条件才会联网：

- ``LAB_AI_ENABLED=true``；
- ``LLM_PROVIDER`` 为 ``maas``；
- ``LLM_API_KEY`` 与 ``LLM_MODEL`` 非空，地址不是占位域名。

讲解请求只发送当前题目文字、已计算出的轨迹摘要和学生问题，不发送原始文件、Cookie
或密钥。调用失败一律由上层降级到本地讲解，不阻断实验。
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass

from ..settings import Settings, get_settings

logger = logging.getLogger(__name__)

PLACEHOLDER_HINTS = ("replace-me", "example.invalid", "your-key", "changeme")


class LabAIUnavailable(RuntimeError):
    """模型未启用/未配置或调用失败。"""


@dataclass(frozen=True, slots=True)
class AIResult:
    text: str
    provider: str
    model: str


class LabAI:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()

    def available(self) -> bool:
        settings = self._settings
        if not settings.lab_ai_enabled:
            return False
        if str(settings.llm_provider).strip().lower() != "maas":
            return False
        if not settings.llm_api_key.strip() or not settings.llm_model.strip():
            return False
        base = settings.llm_base_url.strip().lower()
        if not base.startswith("http") or any(hint in base for hint in PLACEHOLDER_HINTS):
            return False
        return True

    def complete(self, *, system: str, user: str, max_tokens: int = 900) -> AIResult:
        if not self.available():
            raise LabAIUnavailable("模型增强未启用或配置不完整")
        settings = self._settings
        endpoint = f"{settings.llm_base_url.rstrip('/')}/chat/completions"
        payload = {
            "model": settings.llm_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.2,
            "max_tokens": max_tokens,
        }
        request = urllib.request.Request(
            endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.llm_api_key}",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=settings.llm_timeout_s) as response:
                raw = response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            # 只记录状态码，不记录响应体（可能包含服务端细节或密钥回显）。
            raise LabAIUnavailable(f"模型服务返回 HTTP {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise LabAIUnavailable(f"模型服务调用失败：{type(exc).__name__}") from exc
        try:
            body = json.loads(raw)
            text = body["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise LabAIUnavailable("模型响应结构不符合 OpenAI 兼容格式") from exc
        if not isinstance(text, str) or not text.strip():
            raise LabAIUnavailable("模型返回空内容")
        return AIResult(text=text.strip(), provider=str(settings.llm_provider), model=settings.llm_model)


__all__ = ["AIResult", "LabAI", "LabAIUnavailable"]

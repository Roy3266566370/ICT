"""华为云 MaaS（OpenAI 兼容）provider：只负责把请求发出去、把原始文本收回来。

边界（与 :mod:`.provider` 一致）：

* 不做解析、不做证据核验、不信任模型输出——解析与 Schema 校验仍由
  :func:`app.ispec.llm.parse.parse_ispecs` 完成；
* ``available()`` 是无副作用的探针：没配 Key 或显式关闭时返回 ``False``，
  识别层静默降级，绝不发起网络请求；
* 任何网络/协议异常都收敛成 :class:`LLMUnavailable`，由 builder 映射为
  ``MODEL_UNAVAILABLE``，不影响原生识别结果。

环境变量（也可用 ``Settings`` 字段覆盖）::

    LLM_PROVIDER=maas
    LLM_API_KEY=...
    LLM_MODEL=glm-5.3
    LLM_BASE_URL=https://api.modelarts-maas.com/openai/v1
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any, Mapping

from .prompt import build_prompt
from .provider import LLMRequest, LLMResponse, LLMUnavailable


class MaasProvider:
    """OpenAI 兼容端点上的模型调用（支持纯文本与图片输入）。"""

    name = "maas"

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str,
        timeout_s: int = 60,
        max_tokens: int = 2000,
        temperature: float = 0.1,
    ) -> None:
        self._api_key = (api_key or "").strip()
        self._model = (model or "").strip()
        self._endpoint = f"{(base_url or '').rstrip('/')}/chat/completions"
        self._timeout = max(5, int(timeout_s))
        self._max_tokens = max(256, int(max_tokens))
        self._temperature = float(temperature)

    # --- 探针 -------------------------------------------------------------
    def available(self) -> bool:
        """有 Key、有模型名、有端点才认为可用；不联网。"""

        return bool(self._api_key and self._model and self._endpoint.startswith("http"))

    # --- 调用 -------------------------------------------------------------
    def _content(self, request: LLMRequest) -> list[dict[str, Any]]:
        parts: list[dict[str, Any]] = [{"type": "text", "text": build_prompt(request)}]
        for image in request.images:
            uri = image.get("data_uri") if isinstance(image, Mapping) else None
            if isinstance(uri, str) and uri.startswith("data:image/"):
                parts.append({"type": "image_url", "image_url": {"url": uri}})
        return parts

    def propose(self, request: LLMRequest) -> LLMResponse:
        if not self.available():
            raise LLMUnavailable("MaaS 未配置：缺少 API Key 或模型名")

        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "system",
                    "content": "你是把课件页面内容编译成 iSpec JSON 的编译器，只输出 JSON，不要解释。",
                },
                {"role": "user", "content": self._content(request)},
            ],
            "temperature": self._temperature,
            "max_tokens": self._max_tokens,
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        http_request = urllib.request.Request(
            self._endpoint,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._api_key}",
            },
        )

        started = time.monotonic()
        try:
            with urllib.request.urlopen(http_request, timeout=self._timeout) as response:
                raw = response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as error:
            detail = ""
            try:
                detail = error.read().decode("utf-8", "replace")[:300]
            except Exception:  # noqa: BLE001 - 读错误体失败不影响分类
                detail = ""
            raise LLMUnavailable(f"MaaS 返回 HTTP {error.code}：{detail}") from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            try:
                from ...ppt_ai.client import HttpxTransport, _host_resolves_to_fake_ip
                from urllib.parse import urlsplit

                host = urlsplit(self._endpoint).hostname or ""
                if not _host_resolves_to_fake_ip(host):
                    raise error
                status, fallback_payload = HttpxTransport().post(
                    self._endpoint,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {self._api_key}",
                    },
                    json_body=payload,
                    timeout=float(self._timeout),
                )
                if status >= 400:
                    raise LLMUnavailable(f"MaaS 返回 HTTP {status}")
                raw = json.dumps(fallback_payload, ensure_ascii=False)
            except LLMUnavailable:
                raise
            except Exception:  # noqa: BLE001
                raise LLMUnavailable(f"MaaS 调用失败：{type(error).__name__}") from error

        try:
            parsed = json.loads(raw)
            text = parsed["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as error:
            raise LLMUnavailable("MaaS 响应结构不符合 OpenAI 兼容格式") from error

        if not isinstance(text, str) or not text.strip():
            raise LLMUnavailable("MaaS 返回空内容")

        latency_ms = int((time.monotonic() - started) * 1000)
        return LLMResponse(raw_text=text, model=f"{self._model}@{latency_ms}ms")


__all__ = ["MaasProvider"]

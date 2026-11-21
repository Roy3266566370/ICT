"""活页图示视觉模型客户端（LIVING_FIGURE_VISION_* 独立配置）。

与文本 LLM（``PPTAIClient``）完全解耦：自己的 Key、端点、模型、超时与
文档预算（``living_figure_max_calls``）。传输层复用 ``HttpxTransport``
的反 SSRF/Fake-IP 直连兜底，错误统一抛 ``PPTAIError``。
"""

from __future__ import annotations

import base64
import json
import logging
import time
from typing import Any, Mapping

from ..model_profiles import ModelProfile, vision_profile
from ..ppt_ai.client import (
    HttpxTransport,
    PPTAIError,
    Transport,
    _endpoint,
    _strip_fence,
)
from ..settings import Settings, get_settings

logger = logging.getLogger(__name__)


class LivingVisionClient:
    """单张裁剪图 → JSON 的最小视觉调用封装。"""

    def __init__(self, settings: Settings | None = None, *,
                 transport: Transport | None = None) -> None:
        self.settings = settings or get_settings()
        self.transport = transport or HttpxTransport()

    @property
    def profile(self) -> ModelProfile:
        return vision_profile(self.settings)

    @property
    def available(self) -> bool:
        return self.profile.available

    def status(self) -> dict[str, Any]:
        return self.profile.status()

    def generate_json(
        self,
        *,
        image_png: bytes,
        prompt: str,
        max_output_tokens: int = 4096,
        timeout_s: float | None = None,
    ) -> dict[str, Any]:
        """一次 chat/completions 调用；返回解析后的 JSON 对象。

        不做重试与预算记账——重试由调用方决定，预算在调用前已占用。
        """
        profile = self.profile
        if not profile.available:
            raise PPTAIError("disabled", "未配置活页图示视觉模型；区域保留原图")
        data_url = "data:image/png;base64," + base64.b64encode(image_png).decode("ascii")
        if len(data_url) > 6 * 1024 * 1024:
            raise PPTAIError("request_too_large", "区域裁剪过大，请改用更小的选区")
        request_body = {
            "model": profile.model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_url}},
                    {"type": "text", "text": prompt[:8000]},
                ],
            }],
            "temperature": 0.1,
            "max_tokens": int(max_output_tokens),
            "response_format": {"type": "json_object"},
        }
        url = _endpoint(profile.base_url)
        headers = {
            "Authorization": f"Bearer {profile.api_key}",
            "Content-Type": "application/json",
        }
        started = time.monotonic()
        try:
            status, payload = self.transport.post(
                url, headers=headers, json_body=request_body,
                timeout=float(timeout_s or profile.timeout_s),
            )
        except PPTAIError:
            raise
        except TimeoutError as exc:
            raise PPTAIError("timeout", "视觉模型调用超时", retryable=True) from exc
        except Exception as exc:  # noqa: BLE001 - 传输失败统一降级
            raise PPTAIError("transport", f"视觉模型调用失败：{type(exc).__name__}: {exc}",
                             retryable=True) from exc

        elapsed = time.monotonic() - started
        if status in (401, 403):
            raise PPTAIError("auth", "视觉模型鉴权失败，请检查 LIVING_FIGURE_VISION_API_KEY",
                             status=status)
        if status == 429:
            raise PPTAIError("rate_limit", "视觉模型限流，请稍后重试",
                             retryable=True, status=status)
        if status >= 500:
            raise PPTAIError("transport", "视觉模型服务暂时不可用",
                             retryable=True, status=status)
        if status >= 400:
            raise PPTAIError("transport", f"视觉模型拒绝了请求（HTTP {status}）",
                             status=status)

        try:
            if not isinstance(payload, Mapping):
                raise ValueError("response must be an object")
            choices = payload.get("choices")
            if not isinstance(choices, list) or not choices or not isinstance(choices[0], Mapping):
                raise ValueError("choices 缺失")
            choice = choices[0]
            finish_reason = str(choice.get("finish_reason") or "")
            if finish_reason == "length":
                raise PPTAIError("truncated", "视觉模型输出被截断", status=status)
            message = choice.get("message")
            content = message.get("content") if isinstance(message, Mapping) else None
            if not isinstance(content, str) or not content.strip():
                raise ValueError("content 为空")
        except (ValueError, TypeError) as exc:
            if isinstance(exc, PPTAIError):
                raise
            raise PPTAIError("invalid_json", "视觉模型响应结构不完整", status=status) from exc

        raw_text = _strip_fence(content)
        try:
            data = json.loads(raw_text)
            if not isinstance(data, dict):
                raise ValueError("顶层必须是对象")
        except ValueError as exc:
            raise PPTAIError("invalid_json", "视觉模型没有返回有效 JSON",
                             status=status) from exc
        usage = payload.get("usage") if isinstance(payload.get("usage"), Mapping) else {}
        logger.info(
            "活页图示视觉调用完成（status=%s elapsed=%.2fs prompt_tokens=%s completion_tokens=%s）",
            status, elapsed, usage.get("prompt_tokens"), usage.get("completion_tokens"),
        )
        return data


__all__ = ["LivingVisionClient"]

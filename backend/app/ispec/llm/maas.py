from __future__ import annotations

import hashlib
import json
import time
import logging
import re
import tempfile
from pathlib import Path
from threading import Lock
from typing import Any, Literal, Mapping

from pydantic import BaseModel, Field, StrictBool, StrictFloat, StrictInt, StrictStr, ValidationError, model_validator

from ...settings import DATA_DIR
from ...structured_llm import JsonObject, complete_json
from ...ppt_ai.client import HttpxTransport, _endpoint
from ..validator import validate_ispec

from .prompt import build_prompt
from .provider import LLMRequest, LLMResponse, LLMResponseInvalid, LLMUnavailable


logger = logging.getLogger(__name__)
_TRACE_LOCK = Lock()
_LLM_CACHE_VERSION = "v1"
_VIEW_ALLOWED_KEYS: dict[str, frozenset[str]] = {
    "vega": frozenset({"type", "spec_ref", "x", "y", "title", "dataset"}),
    "table": frozenset({"type", "columns", "title", "dataset"}),
    "text": frozenset({"type", "template", "title"}),
    "figure": frozenset({"type", "spec_ref", "title"}),
}


class ProposalSource(BaseModel):
    model_config = {'extra': 'allow'}
    page: StrictInt = Field(ge=1)
    excerpt: StrictStr = Field(min_length=1)
    status: Literal['original', 'inferred', 'confirmed', 'manual_demo']


class ProposalParameter(BaseModel):
    model_config = {'extra': 'allow'}
    id: StrictStr
    label: StrictStr
    default: StrictInt | StrictFloat | StrictBool | StrictStr
    source: ProposalSource


class ISpecProposal(BaseModel):
    model_config = {'extra': 'allow'}
    spec_version: Literal['1.0']
    object_id: StrictStr
    kind: Literal['parametric', 'filter', 'step', 'geometric', 'branch']
    parameters: list[ProposalParameter] = Field(min_length=1)
    views: list[dict] = Field(min_length=1)

    @model_validator(mode='after')
    def validate_ispec_shape(self):
        cleaned_views: list[dict] = []
        for view in self.views:
            if isinstance(view, dict):
                allowed = _VIEW_ALLOWED_KEYS.get(str(view.get("type") or ""))
                if allowed is not None and "parameters" in view:
                    view = {k: v for k, v in view.items() if k != "parameters"}
            cleaned_views.append(view)
        self.views = cleaned_views
        errors = validate_ispec(self.model_dump(exclude_unset=True))
        if errors:
            raise ValueError('；'.join(errors[:6])[:600])
        return self


class ISpecProposalBatch(JsonObject):
    ispecs: list[ISpecProposal] = Field(max_length=8)


def _record_attempts(material_id, attempts):
    if not material_id or not re.fullmatch(r'[A-Za-z0-9_-]{1,96}', material_id) or not attempts:
        return
    target = DATA_DIR/'ispecs'/f'{material_id}.llm.json'
    with _TRACE_LOCK:
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                previous = json.loads(target.read_text(encoding='utf-8')).get('attempts', [])
            except (OSError, ValueError, AttributeError):
                previous = []
            if not isinstance(previous, list):
                previous = []
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=target.parent,
                                             delete=False, suffix='.tmp') as file:
                temporary = Path(file.name)
                json.dump({'material_id': material_id, 'attempts': (previous+attempts)[-50:]},
                          file, ensure_ascii=False)
            try:
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
        except OSError:
            logger.warning('Could not write iSpec model diagnostics for %s', material_id)


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
        max_tokens: int = 5120,
        temperature: float = 0.1,
    ) -> None:
        self._api_key = (api_key or "").strip()
        self._model = (model or "").strip()
        self._base_url = base_url
        self._endpoint = _endpoint(base_url)
        self._timeout = max(5, int(timeout_s))
        self._max_tokens = max(256, int(max_tokens))
        self._temperature = float(temperature)

    # --- 探针 -------------------------------------------------------------
    def available(self) -> bool:
        """有 Key、有模型名、有端点才认为可用；不联网。"""

        return bool(self._api_key and self._model and self._endpoint.startswith("http"))

    # --- 调用 -------------------------------------------------------------
    def _content(self, request: LLMRequest) -> list[dict[str, Any]]:
        parts: list[dict[str, Any]] = [{"type": "text", "text": build_prompt(request, json_object=True)}]
        for image in request.images:
            uri = image.get("data_uri") if isinstance(image, Mapping) else None
            if isinstance(uri, str) and uri.startswith("data:image/"):
                parts.append({"type": "image_url", "image_url": {"url": uri}})
        return parts

    def _cache_file(self, content_parts: list[dict[str, Any]]) -> Path | None:
        if any(host in self._endpoint for host in ("127.0.0.1", "localhost")):
            return None
        digest = hashlib.sha256()
        digest.update(f"{_LLM_CACHE_VERSION}|{self._model}|".encode("utf-8"))
        digest.update(json.dumps(content_parts, ensure_ascii=False, sort_keys=True).encode("utf-8"))
        return DATA_DIR / "ocr" / f"llm_ispec_{_LLM_CACHE_VERSION}_{digest.hexdigest()[:32]}.json"

    def propose(self, request: LLMRequest) -> LLMResponse:
        if not self.available():
            raise LLMUnavailable("MaaS 未配置：缺少 API Key 或模型名")

        content_parts = self._content(request)
        cache_file = self._cache_file(content_parts)
        if cache_file is not None and cache_file.is_file():
            try:
                cached = json.loads(cache_file.read_text(encoding="utf-8"))
                if isinstance(cached, dict) and cached.get("version") == _LLM_CACHE_VERSION:
                    if cached.get("invalid"):
                        raise LLMResponseInvalid("模型缓存显示该页未返回符合 iSpec 结构的 JSON")
                    raw_cached = cached.get("raw_text")
                    if isinstance(raw_cached, str):
                        return LLMResponse(raw_text=raw_cached, model=f"{self._model}@cache")
            except LLMResponseInvalid:
                raise
            except (OSError, ValueError):
                pass

        transport = HttpxTransport()
        attempts = []
        started = time.monotonic()
        is_local = any(host in self._endpoint for host in ("127.0.0.1", "localhost"))

        def summary(text):
            text = re.sub(r'data:[^\s"\']+', '[image data removed]', str(text or ''))
            return text.replace(self._api_key, '[redacted]')[:1200]

        def send(url, *, headers, json_body):
            messages = json_body['messages']
            entry = {'model': self._model, 'timestamp': time.time(),
                     'pages': [p.get('page_no') for p in request.pages],
                     'request': {'max_tokens': json_body['max_tokens'], 'messages': len(messages),
                                 'images': len(request.images), 'last_message': summary(
                                     messages[-1]['content'][0].get('text', '') if isinstance(messages[-1]['content'], list)
                                     else messages[-1]['content'])}}
            attempts.append(entry)
            began = time.monotonic()
            try:
                status, raw = transport.post(url, headers=headers, json_body=json_body, timeout=self._timeout)
                items = raw.get('choices')
                choice = items[0] if isinstance(items, list) and items and isinstance(items[0], dict) else {}
                message = choice.get('message')
                entry['response'] = {'status': status, 'finish_reason': choice.get('finish_reason'),
                                     'excerpt': summary(message.get('content') if isinstance(message, dict) else ''),
                                     'usage': {key: raw['usage'].get(key) for key in ('prompt_tokens', 'completion_tokens')
                                               if isinstance(raw.get('usage'), dict)}}
                return status, raw
            except Exception as error:
                entry['response'] = {'error': type(error).__name__}
                raise
            finally:
                entry['latency_ms'] = round((time.monotonic() - began)*1000)

        try:
            batch, _ = complete_json(
                base_url=self._base_url, api_key=self._api_key, send=send,
                response_model=ISpecProposalBatch, max_retries=2 if is_local else 1, model=self._model,
                messages=[
                    {'role': 'system', 'content': '把课件编译成 iSpec，只输出 JSON 对象。'},
                    {'role': 'user', 'content': content_parts},
                ], temperature=self._temperature, max_tokens=self._max_tokens,
            )
        except Exception as error:
            if attempts:
                attempts[-1]['failure'] = type(error).__name__
            if isinstance(error, (ValidationError, json.JSONDecodeError)):
                if cache_file is not None:
                    try:
                        cache_file.parent.mkdir(parents=True, exist_ok=True)
                        cache_file.write_text(
                            json.dumps({"version": _LLM_CACHE_VERSION, "invalid": True}, ensure_ascii=False),
                            encoding="utf-8",
                        )
                    except OSError:
                        pass
                raise LLMResponseInvalid('模型重试后仍未返回符合 iSpec 结构的 JSON') from error
            raise LLMUnavailable(f'MaaS 调用失败：{type(error).__name__}') from error
        finally:
            _record_attempts(request.material_id, attempts)
        latency_ms = int((time.monotonic() - started) * 1000)
        # Downstream still checks the complete iSpec schema and original evidence.
        raw_text = json.dumps([item.model_dump(exclude_unset=True) for item in batch.ispecs], ensure_ascii=False)
        if cache_file is not None:
            try:
                cache_file.parent.mkdir(parents=True, exist_ok=True)
                cache_file.write_text(
                    json.dumps({"version": _LLM_CACHE_VERSION, "raw_text": raw_text}, ensure_ascii=False),
                    encoding="utf-8",
                )
            except OSError:
                pass
        return LLMResponse(raw_text=raw_text, model=f'{self._model}@{latency_ms}ms')


__all__ = ['MaasProvider']

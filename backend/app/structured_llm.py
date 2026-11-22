"""Instructor JSON mode over the application's existing HTTP transport."""
import json

import httpx
import instructor
from instructor.function_calls import OpenAISchema
from openai import OpenAI
from pydantic import ValidationError, model_validator
from tenacity import Retrying, retry_if_exception, stop_after_attempt


class StructuredOutput(OpenAISchema):
    @classmethod
    def from_response(cls, completion, *args, **kwargs):
        if completion.choices[0].finish_reason == 'length':
            # Instructor 1.0 only attaches repair feedback for validation errors.
            reason = ValueError('上次输出被截断，请缩短内容并返回完整 JSON 对象')
            raise ValidationError.from_exception_data(cls.__name__, [{
                'type': 'value_error', 'loc': (), 'input': None, 'ctx': {'error': reason},
            }])
        return super().from_response(completion, *args, **kwargs)

    @model_validator(mode='after')
    def validate_contract(self, info):
        validator = (info.context or {}).get('validator')
        if validator:
            try:
                validator(self.model_dump(exclude_unset=True))
            except Exception as error:
                raise ValueError(str(error)[:500]) from error
        return self


class JsonObject(StructuredOutput):
    model_config = {'extra': 'allow'}


def complete_json(*, base_url, api_key, send, response_model, max_retries=2, validator=None,
                  retry_error=None, **payload):
    def handle(request):
        status, raw = send(str(request.url), headers=dict(request.headers),
                           json_body=json.loads(request.content))
        if status >= 400:
            return httpx.Response(status, json=raw)
        # Some compatible endpoints omit bookkeeping fields. Keep the actual
        # assistant content and finish reason so Instructor can reask on them.
        choices = raw.get('choices')
        choice = choices[0] if isinstance(choices, list) and choices and isinstance(choices[0], dict) else {}
        message = choice.get('message')
        content = message.get('content') if isinstance(message, dict) else None
        usage = raw.get('usage') if isinstance(raw.get('usage'), dict) else {}
        return httpx.Response(status, json={
            'id': raw.get('id') or 'completion', 'created': 0, 'object': 'chat.completion',
            'model': raw.get('model') or payload['model'],
            'choices': [{'index': 0, 'finish_reason': choice.get('finish_reason') or 'stop',
                         'message': {'role': 'assistant', 'content': content if isinstance(content, str) else ''}}],
            'usage': {key: usage.get(key) or 0 for key in ('prompt_tokens', 'completion_tokens', 'total_tokens')},
        })

    def can_retry(error):
        return isinstance(error, (ValidationError, json.JSONDecodeError)) or bool(retry_error and retry_error(error))

    with OpenAI(base_url=base_url.rstrip('/').removesuffix('/chat/completions')+'/', api_key=api_key,
                max_retries=0, http_client=httpx.Client(transport=httpx.MockTransport(handle))) as client:
        structured = instructor.from_openai(client, mode=instructor.Mode.JSON)
        # Instructor 1.0 counts total attempts. The public option counts retries.
        retries = Retrying(stop=stop_after_attempt(max_retries+1), retry=retry_if_exception(can_retry), reraise=True)
        return structured.create_with_completion(response_model=response_model, max_retries=retries,
                                                 validation_context={'validator': validator}, **payload)

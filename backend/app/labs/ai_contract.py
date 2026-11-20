"""AI 题目理解的共享契约、原图编码整理与确定性内核交接。

仅保留云端 MaaS 路径所需的 Pydantic 契约、JPEG 原图整理及内核交接逻辑，
不包含任何本机 Ollama 或本地视觉推理调用。
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import re
import time
from pathlib import Path

from PIL import Image, ImageOps
from pydantic import BaseModel, ConfigDict, Field

from ..ppt_ai.util import hash_json, now_iso
from ..settings import LABS_DIR, get_settings
from .kernel_models import FIELD_LABELS, TASKS, ModelConditionsError

VERSION = 'ai-understanding.1'

CLOUD_IMAGE_MAX_EDGE = 1800
CLOUD_IMAGE_MAX_BYTES = 900 * 1024


def _prepare_cloud_image(raw: bytes, *, max_bytes: int = CLOUD_IMAGE_MAX_BYTES) -> bytes:
    with Image.open(io.BytesIO(raw)) as source:
        image = ImageOps.exif_transpose(source).convert('RGBA')
        background = Image.new('RGBA', image.size, 'white')
        image = Image.alpha_composite(background, image).convert('RGB')
        image.thumbnail((CLOUD_IMAGE_MAX_EDGE, CLOUD_IMAGE_MAX_EDGE), Image.LANCZOS)
        while True:
            buffer = io.BytesIO()
            image.save(buffer, format='JPEG', quality=88, optimize=True)
            if buffer.tell() <= max_bytes:
                return buffer.getvalue()
            # 逐次等比缩放，避免多页放大裁片超出云端请求体预算。
            image = image.resize((max(1, int(image.width * 0.8)), max(1, int(image.height * 0.8))), Image.LANCZOS)


class Condition(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=64)
    value: str = Field(max_length=1500)
    unit: str = Field(max_length=100)
    excerpt: str = Field(max_length=1500)
    page_key: str | None
    bbox: list[float] | None


class Understanding(BaseModel):
    question: str = Field(min_length=1, max_length=12000)
    subquestions: list[str] = Field(max_length=12)
    relations: list[str] = Field(max_length=20)
    target: str = Field(max_length=2000)
    conditions: list[Condition] = Field(max_length=40)
    uncertainties: list[str] = Field(max_length=20)
    model: dict
    unsupported_reason: str = Field(max_length=2000)


def source_images(
    lab_id: str | None,
    problem: dict,
    *,
    cloud: bool | None = None,
    detail: bool = False,
) -> list[dict]:
    """为云端 MaaS 视觉接口准备题目原图与可选放大裁片。"""
    _ = cloud  # 统一仅走 MaaS 云端 JPEG 编码预算
    pages = [p for p in problem.get('source_pages', []) if p.get('image_key')]
    if not pages:
        return []
    if not lab_id or not re.fullmatch(r'lab_[a-zA-Z0-9]+', lab_id):
        raise ValueError('题目来源标识无效')
    if len(pages) > 3:
        raise ValueError('当前一次支持最多3张题目页，请拆分题目后重试')
    base = (LABS_DIR / lab_id / 'previews').resolve()
    images = []
    total = 0
    for page in pages:
        key = page['image_key']
        if not isinstance(key, str) or not re.fullmatch(r'[a-zA-Z0-9_-]+', key):
            raise ValueError('题目图片来源无效')
        path = (base / (key + '.png')).resolve()
        analysis_base = (LABS_DIR / lab_id / 'analysis').resolve()
        analysis = (analysis_base / (key + '.png')).resolve()
        if not path.is_relative_to(base) or not analysis.is_relative_to(analysis_base):
            raise ValueError('题目图片来源无效')
        if analysis.is_file():
            path = analysis
        if not path.is_file():
            raise ValueError('题目原图不可用，请重新上传')
        raw = path.read_bytes()
        views = [('page', raw)]
        if detail:
            with Image.open(io.BytesIO(raw)) as image:
                image = ImageOps.exif_transpose(image)
                w, h = image.size
                boxes = [(0, 0, w, math.ceil(h * 0.6)), (0, math.floor(h * 0.4), w, h)] if h >= w else [
                    (0, 0, math.ceil(w * 0.6), h), (math.floor(w * 0.4), 0, w, h)
                ]
                for index, box in enumerate(boxes):
                    buffer = io.BytesIO()
                    image.crop(box).save(buffer, format='PNG')
                    views.append((f'detail_{index + 1}', buffer.getvalue()))
        for view, view_raw in views:
            prepared = _prepare_cloud_image(
                view_raw,
                max_bytes=min(CLOUD_IMAGE_MAX_BYTES, 2400000 // (len(pages) * len(views))),
            )
            total += len(prepared)
            if total > 12 * 1024 * 1024:
                raise ValueError('题目图片超过12MB预算，请裁剪后上传')
            with Image.open(io.BytesIO(prepared)) as image:
                if image.width * image.height > 16000000:
                    raise ValueError('题目图片分辨率过大，请裁剪题目区域')
                image_budget = math.ceil(image.width / 14) * math.ceil(image.height / 14) + 256
            images.append(
                dict(
                    key=key,
                    page=page.get('page'),
                    view=view,
                    mime_type='image/jpeg',
                    token_budget=image_budget,
                    sha256=hashlib.sha256(prepared).hexdigest(),
                    image=base64.b64encode(prepared).decode('ascii'),
                )
            )
    return images


def input_hash(problem: dict, lab_id: str, mode: str) -> str:
    """计算基于当前 MaaS 配置、原题文字与图片摘要的缓存键。"""
    from .ai_solve import VERSION as cloud_version

    images = source_images(lab_id, problem)
    settings = get_settings()
    return hash_json(
        dict(
            version=cloud_version,
            provider=settings.llm_provider,
            model=settings.llm_model,
            base_url=settings.llm_base_url,
            text=problem['text'],
            pages=[{k: v for k, v in p.items() if k != 'image'} for p in images],
            ambiguities=problem.get('recognition', {}).get('ambiguities', []),
            mode=mode,
        )
    )


def validate_understanding(data: dict, page_keys: list[str]) -> dict:
    parsed = Understanding.model_validate(data).model_dump()
    for key in ('subquestions', 'relations', 'uncertainties'):
        parsed[key] = [v.strip() for v in parsed[key] if v.strip()]
    for c in parsed['conditions']:
        if c['page_key'] is not None and c['page_key'] not in page_keys:
            raise ValueError('条件引用了不属于本题的图片')
        if c['page_key'] is None and len(page_keys) == 1:
            c['page_key'] = page_keys[0]
        box = c['bbox']
        if box is not None and (
            c['page_key'] is None
            or len(box) != 4
            or not all(0 <= v <= 1 for v in box)
            or box[0] >= box[2]
            or box[1] >= box[3]
        ):
            raise ValueError('条件图片坐标无效')
    if len({c['id'] for c in parsed['conditions']}) != len(parsed['conditions']):
        raise ValueError('条件编号重复')
    model = parsed['model']
    if len(json.dumps(model, allow_nan=False)) > 15000:
        raise ValueError('模型超出预算')
    if model.get('kind') not in ('kernel', 'evaluate', 'equations', 'double_integral', 'none'):
        raise ValueError('不支持的模型类型')
    if model.get('kind') == 'kernel' and model.get('task') not in TASKS:
        raise ValueError('不支持的内核任务')
    if model.get('kind') == 'none' and not parsed['unsupported_reason']:
        raise ValueError('请说明不能交给内核的原因')
    return parsed


def finish_understanding(data: dict, problem: dict) -> dict:
    from .ai_solve import KernelTimeoutError, run_kernel, trace_entry

    recognition = problem.get('recognition') or {}
    trace = []
    if problem.get('source_pages'):
        trace.append(
            trace_entry(
                'ocr',
                'ok' if problem.get('text') else 'warn',
                detail=f'识别方式：{recognition.get("method") or "未知"}',
            )
        )
    quality = recognition.get('quality') or {}
    if quality:
        trace.append(
            trace_entry(
                'quality',
                'warn' if quality.get('untrusted') else 'ok',
                code='OCR_GARBLED' if quality.get('untrusted') else None,
                detail='；'.join(quality.get('issues') or []),
            )
        )
    trace.append(trace_entry('ai_read', 'ok', detail='AI 已读取题干与条件。'))
    trace.append(trace_entry('ai_model', 'ok', detail=f'模型建议 kind={data["model"].get("kind")}'))
    unreviewed = any(
        a.get('id') == 'source_formula_confirmation' and not a.get('resolved')
        for a in problem.get('recognition', {}).get('ambiguities', [])
    )
    result = dict(
        version=VERSION,
        source_hash=hash_json(problem.get('text', '')),
        agent_understanding=data,
        question=data['question'],
        interpretation=data['question'],
        conditions=[c['value'] for c in data['conditions']],
        missing_conditions=data['uncertainties'][:],
        proposed_model=data['model'],
        verification='needs_review',
        checkable=False,
        source_review_required=unreviewed,
        computation=None,
        options=[],
        answer_choices=[],
        answer='',
        steps=[],
        reference_answer='',
        reference_steps=[],
        limitations=[],
        model_name=get_settings().llm_model,
        created_at=now_iso(),
        model_condition_labels=FIELD_LABELS,
        trace=trace,
    )
    if data.get('_source_recovery'):
        result['source_recovery'] = data['_source_recovery']
    if data['uncertainties']:
        trace.append(
            trace_entry(
                'validate',
                'warn',
                code='MISSING_CONDITIONS',
                detail='；'.join(str(v)[:200] for v in data['uncertainties'][:3]),
            )
        )
        return result
    if data['model'].get('kind') == 'none':
        result['limitations'].append(data['unsupported_reason'])
        trace.append(trace_entry('validate', 'reference', code='AI_CHOSE_NONE', detail=data['unsupported_reason']))
        return result
    kernel_started = time.monotonic()
    try:
        computed = run_kernel(data['model'])
        for i, step in enumerate(computed['steps']):
            step.setdefault('id', f'kernel_{i}')
        result.update(
            verification='kernel',
            computation=computed,
            answer=computed['answer'],
            steps=computed['steps'],
            checkable=not unreviewed and computed.get('checkable', True),
            verification_level=computed.get('verification_level', 'kernel'),
        )
        trace.append(trace_entry('kernel', 'ok', detail='内核完成计算并通过独立核验。', started=kernel_started))
        if unreviewed:
            result['limitations'].append('模型待核对：以下为候选模型试算，不能据此判定原题答案正确。')
        if data['model'].get('task') in TASKS:
            result['model_task_label'] = TASKS[data['model']['task']]['label']
    except ModelConditionsError as exc:
        result['missing_conditions'].extend(exc.missing_conditions)
        trace.append(
            trace_entry(
                'kernel',
                'error',
                code='MISSING_CONDITIONS',
                detail='；'.join(exc.missing_conditions[:3]),
            )
        )
    except KernelTimeoutError as exc:
        result['limitations'].append('内核未能计算或复核：' + str(exc)[:250])
        trace.append(
            trace_entry(
                'kernel',
                'error',
                code='KERNEL_TIMEOUT',
                detail=str(exc)[:300],
                started=kernel_started,
            )
        )
    except (ValueError, TypeError, ArithmeticError, KeyError) as exc:
        result['limitations'].append('内核未能计算或复核：' + str(exc)[:250])
        trace.append(
            trace_entry(
                'kernel',
                'error',
                code='KERNEL_ERROR',
                detail=str(exc)[:300],
                started=kernel_started,
            )
        )
    if data.get('pipeline_review_only'):
        result['checkable'] = False
        result['pipeline_version'] = data['pipeline_review_only']
        result['limitations'].append('来源到模型的语义一致性尚待核对；条件映射不等于证明。')
    return result


def understanding_schema() -> dict:
    schema = Understanding.model_json_schema()
    fields = {}
    arrays = {
        'outer_bounds', 'inner_bounds', 'variables', 'equations', 'nodes', 'initial_point', 'vector_b',
        'activations', 'initial_heap', 'requests', 'reference', 'available', 'names', 'layers', 'input',
        'target', 'initial_conditions', 'curve', 't_bounds', 'surface', 'point', 'plane', 'line_point',
        'line_direction', 'plane2', 'field', 'uv_bounds', 'steps',
    }
    nested = {'matrix_a', 'matrix_b', 'weights', 'biases', 'allocation', 'max'}
    numbers = {
        'point', 'lower', 'upper', 'learning_rate', 'iterations', 'epochs', 'frames',
        'quantum', 'head', 'max_track', 'scalar', 'deletion_count', 'point_x', 'point_y',
        'index_start', 'order', 'center',
    }
    for name in FIELD_LABELS:
        if name in arrays:
            fields[name] = {'type': 'array', 'items': {'type': ['string', 'number']}}
        elif name in nested:
            fields[name] = {'type': 'array', 'items': {'type': 'array', 'items': {'type': 'number'}}}
        elif name in ('edges', 'processes'):
            fields[name] = {'type': 'array', 'items': {'type': 'object'}}
        elif name == 'bounds':
            fields[name] = {'type': 'object'}
        elif name in ('directed', 'swap_order'):
            fields[name] = {'type': 'boolean'}
        elif name == 'pieces':
            fields[name] = {'type': 'array', 'items': {'type': 'object'}}
        elif name == 'polar':
            fields[name] = {'type': 'object'}
        elif name in numbers:
            fields[name] = {'type': ['string', 'number']}
        else:
            fields[name] = {'type': 'string'}
    fields['region'] = {'type': 'object'}
    fields['region_text'] = {'type': 'string'}
    fields['weights'] = {'type': 'array', 'items': {'type': 'array', 'items': {'type': 'array', 'items': {'type': 'number'}}}}
    fields['request'] = {
        'type': 'object',
        'properties': {'process': {'type': 'string'}, 'vector': {'type': 'array', 'items': {'type': 'number'}}},
        'required': ['process', 'vector'],
    }
    fields['biases'] = {'type': 'array', 'items': {'type': 'array', 'items': {'type': 'number'}}}
    schema['properties']['model'] = {
        'type': 'object',
        'properties': {
            'kind': {'type': 'string', 'enum': ['kernel', 'none']},
            'task': {'type': 'string', 'enum': list(TASKS)},
            'conditions': {'type': 'object', 'properties': fields, 'additionalProperties': False},
        },
        'required': ['kind'],
        'additionalProperties': False,
    }
    return schema

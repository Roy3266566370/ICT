"""On-demand, content-addressed figure previews for the document editor."""
from __future__ import annotations

import base64
from concurrent.futures import Future
import hashlib
import io
import json
import logging
import math
import os
import re
import threading
import time
from uuid import uuid4

import numpy as np
from PIL import Image, ImageOps

from .figure_scene import FigureScene, make_scene
from .layers import layer_dir, manifest_ready, native_asset_path, read_manifest, source_page_number
from .store import DocumentConflict, document_root, read_document
from ..ispec.image_text import engine
from ..living.vision import LivingVisionClient
from ..ppt_ai.client import HttpxTransport, PPTAIError
from ..render import PAGE_IMAGE_PATTERN, pages_dir

logger = logging.getLogger(__name__)
VERSION = 'figure.6'
_LOCKS = tuple(threading.Lock() for _ in range(64))
_VISION_LOCK = threading.Lock()
_VISION_INFLIGHT = {}
_OCR_LOCK = threading.Lock()
_ID = re.compile(r'^[a-f0-9]{64}$')


def _digest(value):
    if not isinstance(value, bytes):
        value = json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()
    return hashlib.sha256(value).hexdigest()


def _atomic(path, blob):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.parent / f'.{uuid4().hex[:12]}.tmp'
    try:
        temp.write_bytes(blob)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def _write(path, data):
    _atomic(path, json.dumps(data, ensure_ascii=False, allow_nan=False).encode())


def _read(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def _png(image):
    output = io.BytesIO()
    image.save(output, 'PNG', compress_level=2)
    return output.getvalue()


def _root(material_id, page_no):
    if type(page_no) is not int or not 1 <= page_no <= 10000:
        raise ValueError('页面编号无效')
    return document_root(material_id) / 'figures' / f'p{page_no:02d}'


def asset_path(material_id, page_no, asset_id, kind='cleaned'):
    if not isinstance(asset_id, str) or not _ID.fullmatch(asset_id) or kind not in ('source', 'cleaned'):
        return None
    path = _root(material_id, page_no) / 'previews' / asset_id / f'{kind}.png'
    return path if path.is_file() else None


def asset_url(material_id, page_no, identifier, kind):
    return f'/api/v1/materials/{material_id}/pages/{page_no}/figures/assets/{identifier}/{kind}.png'


def node_fingerprint(source_key, node):
    fields = ('id', 'type', 'asset_id', 'render_file', 'image_data', 'x', 'y', 'width', 'height',
              'rotation', 'crop', 'opacity', 'deleted', 'hidden', 'z')
    return _digest([source_key, {key: node.get(key) for key in fields}])


def validate_asset_binding(material_id, page_no, source_key, node, asset_id):
    if asset_path(material_id, page_no, asset_id) is None:
        raise ValueError('清底资产不存在')
    saved = _read(_root(material_id, page_no) / 'previews' / asset_id / 'pixel.json')
    if not saved or saved['fingerprint'] != node_fingerprint(source_key, node):
        raise ValueError('原图已变化，请重新矢量化')
    try:
        blob, _ = _source_blob(material_id, page_no, source_key, node)
    except OSError as error:
        raise ValueError('原图已丢失，请重新矢量化') from error
    if saved.get('source_digest') != _digest(blob):
        raise ValueError('原图已变化，请重新矢量化')


def _source_blob(material_id, page_no, source_key, node):
    data = node.get('image_data')
    entry = {}
    document = read_document(material_id)
    page = next((p for p in (document or {}).get('pages',[]) if p['page_no']==page_no),None)
    asset_page = source_page_number(page) if page is not None else page_no
    native = native_asset_path(material_id,source_key,asset_page,node.get('native_file'))
    if data:
        try:
            blob = base64.b64decode(data.split(',', 1)[1], validate=True)
        except (IndexError, ValueError) as error:
            raise ValueError('原图内容无效') from error
    elif node.get('render_file'):
        filename = node['render_file']
        match = PAGE_IMAGE_PATTERN.fullmatch(filename)
        if not match or match.group('erased') or int(match.group('page_no')) != asset_page:
            raise ValueError('页面原图标识无效')
        blob = (pages_dir(material_id) / filename).read_bytes()
    elif native is not None:
        blob = native.read_bytes()
    else:
        if asset_page is None:
            raise ValueError('图片没有可读取的源文件')
        manifest = read_manifest(material_id, source_key, asset_page)
        if node['id'] in manifest.get('frozen_ids', []):
            raise ValueError('该图未与页面背景分离，请选择可编辑图片')
        entry = manifest.get('objects', {}).get(node.get('asset_id'), {})
        filename = entry.get('asset')
        if not manifest_ready(manifest) or not isinstance(filename, str) or not re.fullmatch(r'n_\d+\.png', filename):
            raise ValueError('图片图层尚未就绪，请等待自由编辑准备完成')
        blob = (layer_dir(material_id, source_key, asset_page) / filename).read_bytes()
    if len(blob) > 24_000_000:
        raise ValueError('图片资产过大，请缩小图片后再试')
    return blob, entry


def _source(material_id, page_no, source_key, node):
    blob, entry = _source_blob(material_id, page_no, source_key, node)
    with Image.open(io.BytesIO(blob)) as image:
        if image.width * image.height > 30_000_000:
            raise ValueError('图片像素过大')
        original = ImageOps.exif_transpose(image).convert('RGBA')
    crop = node.get('crop') or {}
    left = round(crop.get('left', 0) * original.width)
    top = round(crop.get('top', 0) * original.height)
    right = original.width - round(crop.get('right', 0) * original.width)
    bottom = original.height - round(crop.get('bottom', 0) * original.height)
    if right-left < 10 or bottom-top < 10:
        raise ValueError('图像裁剪区域过小')
    box = (left, top, right, bottom)
    visible = original.crop(box)
    rgb = Image.new('RGB', visible.size, 'white')
    rgb.paste(visible, mask=visible.getchannel('A'))
    limit = (1600, 1600)
    if (page_no == 1 and node.get('source_element_id') == 'p01_s00'
            and node.get('source_shape_id') is not None and not node.get('image_data') and not node.get('render_file')):
        # Office can enlarge the single bitmap in the image-upload wrapper
        # before export. Detect at its input resolution; place with the
        # measured raster frame and retain the full exported PNG for cleanup.
        root = document_root(material_id).parent
        upload = next((root / f'original{ext}' for ext in ('.png', '.jpg', '.jpeg')
                       if (root / f'original{ext}').is_file()), None)
        if upload:
            try:
                with Image.open(upload) as uploaded:
                    width, height = uploaded.size
                    if uploaded.getexif().get(274) in (5, 6, 7, 8):
                        width, height = height, width
                limit = (min(1600, max(10, round(width * (right-left)/original.width))),
                         min(1600, max(10, round(height * (bottom-top)/original.height))))
            except (OSError, ValueError):
                pass
    rgb.thumbnail(limit, Image.Resampling.LANCZOS)
    return original, rgb, box, entry, _digest(blob)


def read_ocr(image):
    with _OCR_LOCK:
        rows, _ = engine()(np.asarray(image))
    return [{'box': np.clip(box, (0, 0), image.size).tolist(), 'text': str(text)[:500], 'score': float(score)}
            for box, text, score in (rows or []) if np.shape(box) == (4, 2) and np.isfinite(box).all()
            and math.isfinite(float(score)) and .55 <= float(score) <= 1][:96]


def detect_figure(image, rows):
    from .auto_vectors import detect_figure as detect
    return detect(image, rows)


def _detect_at_source_scale(image, rows):
    systems, objects = detect_figure(image, rows)
    if max(image.size) <= 1000 or any(item['type'] != 'text' for item in objects):
        return image, rows, systems, objects
    # Rendered PDF/PPT images may contain enlarged pixels with widened
    # strokes. Reuse OCR evidence at a smaller scale before giving up.
    smaller = image.copy()
    smaller.thumbnail((900, 900), Image.Resampling.LANCZOS)
    sx, sy = smaller.width/image.width, smaller.height/image.height
    scaled = [{**row, 'box': [[x*sx, y*sy] for x, y in row['box']]} for row in rows]
    smaller_systems, smaller_objects = detect_figure(smaller, scaled)
    if any(item['type'] != 'text' for item in smaller_objects):
        return smaller, scaled, smaller_systems, smaller_objects
    return image, rows, systems, objects


def _cleaned_image(original, image, box, scene):
    from .auto_vectors import clean_figure
    if not scene.objects:
        return None, set()
    verified = set()
    clean = clean_figure(image, [item.model_dump(mode='json') for item in scene.objects], verified_ids=verified)
    difference = np.any(np.asarray(clean) != np.asarray(image), axis=2)
    if not np.any(difference):
        return None, set()
    full_size = (box[2]-box[0], box[3]-box[1])
    mask = Image.fromarray(difference).resize(full_size, Image.Resampling.NEAREST)
    restored = clean.resize(full_size, Image.Resampling.BILINEAR)
    if original.getchannel('A').getextrema() == (255, 255):
        output = original.convert('RGB')
    else:
        output = original.copy()
        restored = restored.convert('RGBA')
        # The detector sees a white composite. On a transparent figure erase
        # the stroke by restoring transparent pixels, not white paint.
        alpha = original.getchannel('A').crop(box)
        if np.median(np.asarray(alpha)) < 64:
            restored.putalpha(0)
        else:
            restored.putalpha(alpha)
    output.paste(restored, box[:2], mask)
    return output, verified


def _scene_nodes(node, scene, entry, identifier):
    from .auto_vectors import _vector

    width, height = node['width'], node['height']
    frame, size = entry.get('asset_frame'), entry.get('asset_size')
    rendered = not node.get('crop') and frame and size and entry.get('asset_scale', 0) > 0
    scale_x = (size[0] if rendered else width) / scene.frame.width
    scale_y = (size[1] if rendered else height) / scene.frame.height
    radians = math.radians(node['rotation'])
    cos, sin = math.cos(radians), math.sin(radians)
    cx, cy = node['x'] + width/2, node['y'] + height/2

    def point(raw):
        x = raw[0] * scale_x - width/2 - (frame[0] if rendered else 0)
        y = raw[1] * scale_y - height/2 - (frame[1] if rendered else 0)
        return cx + x*cos - y*sin, cy + x*sin + y*cos

    nodes = []
    for item in scene.objects:
        item_key = _digest(item.id)[:14]
        common = {'id': f'u_f_{identifier[:16]}_{item_key}', 'figure_source_id': node['id'],
                  'figure_object_id': item.id, 'figure_provenance': item.provenance,
                  'z': math.floor(node['z']),
                  'locked': False, 'hidden': False, 'deleted': False,
                  'opacity': node.get('opacity', 1), 'base_style': {}, 'base_text': None,
                  'shape': 'rect', 'style': {}, 'text': ''}
        if item.type == 'text':
            px, py = point(item.points[0])
            box = item.bbox or (0, 0, max(12, len(item.text) * 9), 16)
            tw, th = (box[2]-box[0])*scale_x, (box[3]-box[1])*scale_y
            if min(tw, th) < .1:
                continue
            nodes.append({**common, 'type': 'text', 'name': item.text[:80], 'text': item.text,
                          'x': px-tw/2, 'y': py-th/2, 'width': tw, 'height': th, 'word_wrap': False,
                          'rotation': node['rotation'], 'style': {'font_size': max(1, min(500, th*.88)),
                          'align': 'left', 'vertical_align': 'middle', 'color': item.style.stroke}})
        else:
            for number, (start, end) in enumerate(zip(item.points, item.points[1:])):
                vector = _vector({**common, 'id': f"{common['id']}_{number}",
                                  'name': {'axis': '坐标轴', 'dashed': '虚线', 'vector': '向量'}.get(item.type, '线段')},
                                 point(start), point(end),
                                 {'stroke': item.style.stroke, 'stroke_width': max(.4, min(100, item.style.width * min(scale_x, scale_y))),
                                  'line_style': 'dashed' if item.type == 'dashed' else 'solid',
                                  'arrow_start': False, 'arrow_end': item.type == 'vector'})
                if vector:
                    nodes.append(vector)
    return nodes


_COORD_PAIR_RE = re.compile(r'[\(（]\s*[-−+]?\d+(?:\.\d+)?\s*[,，]\s*[-−+]?\d+(?:\.\d+)?\s*[\)）]')


def _materialize_relations(scene, nodes, identifier):
    """Materialize FigureScene relations into ScenePage relations and assign fine-grained viewer permissions."""
    from .relations import validate_page_relations

    by_obj: dict[str, dict] = {}
    for item in nodes:
        obj_id = item.get('figure_object_id')
        if obj_id and obj_id not in by_obj:
            by_obj[obj_id] = item

    raw_relations = []
    movable_ids: set[str] = set()
    for index, rel in enumerate(scene.relations):
        if rel.kind != 'basis_decompose' or len(rel.objects) < 3:
            continue
        first_id, second_id, result_id = rel.objects[:3]
        first_node = by_obj.get(first_id)
        second_node = by_obj.get(second_id)
        result_node = by_obj.get(result_id)
        if not first_node or not second_node or not result_node:
            continue
        if any(n.get('type') != 'vector' for n in (first_node, second_node, result_node)):
            continue
        guide_ids = []
        label_node = None
        for extra_id in rel.objects[3:]:
            target_node = by_obj.get(extra_id)
            if not target_node:
                continue
            if target_node.get('type') == 'vector' and len(guide_ids) < 4:
                guide_ids.append(target_node['id'])
            elif target_node.get('type') == 'text' and label_node is None:
                label_node = target_node
        label_template = None
        if label_node and isinstance(label_node.get('text'), str):
            text = label_node['text'].strip()
            if _COORD_PAIR_RE.search(text):
                label_template = _COORD_PAIR_RE.sub('({a}, {b})', text, count=1)
        entry = {
            'id': f'rel_{identifier[:12]}_{index + 1}',
            'kind': 'basis_decompose',
            'name': '换基坐标分解',
            'enabled': True,
            'provenance': 'auto',
            'firstId': first_node['id'],
            'secondId': second_node['id'],
            'resultId': result_node['id'],
            **({'guideIds': guide_ids} if guide_ids else {}),
            **({'labelId': label_node['id']} if label_node else {}),
            **({'labelTemplate': label_template} if label_template else {}),
        }
        raw_relations.append(entry)
        movable_ids.add(second_node['id'])

    if not raw_relations:
        return []

    validated = validate_page_relations(raw_relations, nodes)
    for item in nodes:
        if item['id'] in movable_ids:
            item['viewer_editable'] = True
            item['viewer_parameters'] = ['end', 'color', 'line_style', 'stroke_width']
        else:
            item['viewer_editable'] = False
    return validated


def match_labels(scene, output):
    from pydantic import BaseModel, ConfigDict
    from .figure_scene import Ident

    class Match(BaseModel):
        model_config = ConfigDict(extra='forbid')
        object_id: Ident
        label_id: Ident | None = None
        role: str | None = None

    proposed = output.get('matches')
    if not isinstance(proposed, list):
        return scene, ['模型没有返回 matches 列表']
    objects = {item.id: item for item in scene.objects}
    labels = {item.label_id for item in scene.objects if item.label_id}
    allowed_roles = {'axis': {'coordinate_axis'}, 'dashed': {'guide'}, 'polyline': {'guide'},
                     'vector': {'basis_vector', 'result_vector'}, 'text': {'coordinate_label'}}
    rejected = []
    for raw in proposed[:64]:
        try:
            match = Match.model_validate(raw)
            item = objects.get(match.object_id)
            if not item or (not match.role and not match.label_id):
                raise ValueError('没有匹配的候选证据')
            if match.role and match.role not in allowed_roles.get(item.type, set()):
                raise ValueError('语义分类与候选类型不符')
            if match.label_id and match.label_id != item.label_id:
                label = objects.get(match.label_id)
                if not label or item.type == 'text' or label.type != 'text':
                    raise ValueError('关联文字没有 OCR 证据')
                if item.label_id or label.id in labels or (label.system_id and item.system_id != label.system_id):
                    raise ValueError('重复关联或跨坐标系')
                max_distance = max(18, scene.frame.width*.08)
                if math.dist(item.points[-1], label.points[0]) > max_distance:
                    raise ValueError('文字位置与候选对象不相邻')
                labels.add(label.id)
            objects[item.id] = item.model_copy(update={'label_id': match.label_id or item.label_id,
                                                      'role': match.role or item.role})
        except ValueError as error:
            rejected.append(str(error).splitlines()[0][:160])
    return scene.model_copy(update={'objects': list(objects.values())}), rejected


class _DiagnosticTransport:
    def __init__(self):
        self.transport = HttpxTransport()
        self.responses = []

    def post(self, url, *, headers, json_body, timeout):
        status, raw = self.transport.post(url, headers=headers, json_body=json_body, timeout=timeout)
        self.responses.append({'http_status': status, 'response': raw})
        return status, raw


def _vision(directory, pixel):
    transport = _DiagnosticTransport()
    client = LivingVisionClient(transport=transport)
    started = time.monotonic()
    stage = {'scene': pixel['scene'], 'warnings': [], 'vision_status': 'skipped'}
    if not client.available:
        stage['warnings'].append('未配置视觉模型，已保留像素和 OCR 结果')
        return stage
    scene = FigureScene.model_validate(pixel['scene'])
    if not scene.objects or not any(item.type == 'text' for item in scene.objects):
        stage['warnings'].append('图中缺少可匹配的几何或文字证据')
        return stage
    diagnostic = {'rejected': [], 'responses': transport.responses}
    try:
        evidence = [{'id': item.id, 'type': item.type, 'points': item.points,
                     'text': item.text, 'system': item.system_id}
                    for item in scene.objects]
        prompt = ('用像素候选和 OCR 文字框判断几何对象语义和所属标签；只返回 JSON '
                  '{"matches":[{"object_id":"候选ID","label_id":"可选文字ID","role":"可选角色"}]}。'
                  '角色限 basis_vector,result_vector,coordinate_axis,guide,coordinate_label。'
                  '同一标签至多关联一次，不得新增几何坐标。候选：'
                  + json.dumps(evidence, ensure_ascii=False) + '\nOCR 框：'
                  + json.dumps(pixel['ocr'][:40], ensure_ascii=False))
        output = client.generate_json(image_png=(directory / 'detector.png').read_bytes(),
                                      prompt=prompt, timeout_s=15, max_output_tokens=650,
                                      retry_without_response_format=False)
        result, rejected = match_labels(scene, output)
        diagnostic['rejected'] = rejected
        stage['vision_status'] = 'applied' if not rejected or result != scene else 'failed'
        stage['scene'] = result.model_dump(mode='json')
        if rejected:
            stage['warnings'].append(f'{len(rejected)} 条视觉建议没有匹配证据')
        # Cache only successfully returned inference. Transient errors can be retried.
        if directory.is_dir() and stage['vision_status'] == 'applied':
            _write(directory / 'vision.json', stage)
    except PPTAIError as error:
        diagnostic['error'] = error.kind
        if error.status is not None:
            diagnostic['http_status'] = error.status
        stage['vision_status'] = 'failed'
        stage['warnings'].append('视觉增强暂不可用，已保留本地候选')
    finally:
        diagnostic['elapsed_ms'] = round((time.monotonic()-started)*1000)
        if directory.is_dir():
            try:
                _write(directory / f'vision-{time.time_ns()}.json', diagnostic)
            except OSError:
                logger.warning('Could not save figure vision diagnostics')
    return stage


def _vision_once(directory, pixel):
    cached = _read(directory / 'vision.json')
    if cached is not None:
        return cached
    with _VISION_LOCK:
        cached = _read(directory / 'vision.json')
        if cached is not None:
            return cached
        future = _VISION_INFLIGHT.get(directory)
        leader = future is None
        if leader:
            future = _VISION_INFLIGHT[directory] = Future()
    if not leader:
        return future.result()
    try:
        result = _vision(directory, pixel)
        future.set_result(result)
        return result
    except Exception as error:
        future.set_exception(error)
        raise
    finally:
        with _VISION_LOCK:
            _VISION_INFLIGHT.pop(directory, None)


def vectorize(material_id, page_no, element_id, *, expected_revision, stage='pixel', preview_id=None):
    started = time.monotonic()
    document = read_document(material_id)
    if not document:
        raise ValueError('请先打开自由编辑')
    if document['revision'] != expected_revision:
        raise DocumentConflict('文档已更新，请重新选图')
    page = next((page for page in document['pages'] if page['page_no'] == page_no), None)
    node = next((item for item in (page or {}).get('nodes', []) if
                 element_id in (item['id'], item.get('source_element_id'))), None)
    if not node or node['type'] != 'image' or node.get('deleted') or node.get('hidden') or node.get('matrix_ocr'):
        raise ValueError('请选择页面上的普通图片')
    original, image, box, entry, source_digest = _source(material_id, page_no, document['source_key'], node)
    fingerprint = node_fingerprint(document['source_key'], node)
    root = _root(material_id, page_no)
    key = _digest([VERSION, source_digest, fingerprint, box, 'rapidocr'])
    cache = root / 'cache' / f'{key}.json'
    lock_slot = int(key[:4], 16) % len(_LOCKS)
    with _LOCKS[lock_slot]:
        cached = _read(cache)
        identifier = cached.get('preview_id') if cached else None
        directory = root / 'previews' / identifier if isinstance(identifier, str) and _ID.fullmatch(identifier) else None
        pixel = _read(directory / 'pixel.json') if directory else None
        cache_hit = pixel is not None
        if stage == 'vision' and (not pixel or preview_id != identifier):
            raise DocumentConflict('该识别预览已失效，请重新矢量化')
        if pixel is None:
            warnings = []
            ocr_failed = False
            try:
                rows = read_ocr(image)
            except Exception as error:
                logger.info('Figure OCR unavailable (%s)', type(error).__name__)
                rows = []
                ocr_failed = True
                warnings.append('文字 OCR 暂不可用，继续检测几何')
            ocr_ms = round((time.monotonic()-started)*1000)
            identifier = _digest([key, rows])
            directory = root / 'previews' / identifier
            image, rows, systems, objects = _detect_at_source_scale(image, rows)
            scene = make_scene(image, systems, objects, warnings)
            cleaned, applicable = _cleaned_image(original, image, box, scene)
            unsafe = len(scene.objects) - len(applicable)
            if unsafe:
                scene.warnings = [*scene.warnings[:23], f'{unsafe} 个对象的清底无法验证，仅在校对预览中显示']
            if not read_document(material_id):
                raise DocumentConflict('材料已失效')
            _atomic(directory / 'source.png', _png(original.crop(box)))
            _atomic(directory / 'detector.png', _png(image))
            if cleaned:
                _atomic(directory / 'cleaned.png', _png(cleaned))
            pixel = {'fingerprint': fingerprint, 'source_digest': source_digest, 'scene': scene.model_dump(mode='json'),
                     'ocr': rows, 'ocr_ms': ocr_ms, 'cleaned': cleaned is not None,
                     'applicable_ids': sorted(applicable)}
            _write(directory / 'pixel.json', pixel)
            if not ocr_failed:
                _write(cache, {'preview_id': identifier})
    result = pixel
    vision_available = LivingVisionClient().available
    if stage == 'vision':
        result = _vision_once(directory, pixel)
    latest = read_document(material_id)
    if not latest or latest['revision'] != expected_revision:
        raise DocumentConflict('识别期间文档已更新，请重新选图')
    scene = FigureScene.model_validate(result['scene'])
    applicable = set(pixel['applicable_ids'])
    renderable = scene.model_copy(update={'objects': [item for item in scene.objects if item.id in applicable]})
    scene_nodes = _scene_nodes(node, renderable, entry, identifier)
    page_relations = _materialize_relations(renderable, scene_nodes, identifier)
    warnings = result.get('warnings', [])
    if not vision_available and stage == 'pixel':
        warnings = [*warnings, '未配置视觉模型，仍可使用本地识别或手工添加']
    return {'preview_id': identifier, 'source_node_id': node['id'], 'source_revision': expected_revision,
            'source_url': asset_url(material_id, page_no, identifier, 'source'),
            'scene': scene.model_dump(mode='json'), 'nodes': scene_nodes, 'relations': page_relations,
            'cleaned_asset_id': identifier if pixel['cleaned'] else None,
            'cleaned_url': asset_url(material_id, page_no, identifier, 'cleaned') if pixel['cleaned'] else None,
            'vision_available': vision_available and bool(scene.objects) and any(item.type == 'text' for item in scene.objects),
            'diagnostics': {'cache_hit': cache_hit, 'elapsed_ms': round((time.monotonic()-started)*1000),
                            'ocr_ms': pixel['ocr_ms'], 'warnings': warnings,
                            **({'vision_status': result['vision_status']} if stage == 'vision' else {})}}

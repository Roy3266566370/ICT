"""Confirmed element bindings plus conservative local image understanding."""
from __future__ import annotations

import math
import re
import unicodedata
from copy import deepcopy

from pptx import Presentation

from ..editing import working_path
from ..parsers.pptx_parser import _walk_shapes
from .image_text import recognize_image
from .native_math import _expression, _parameter, _source, _spec, build_native_math_specs
from .scene_definitions import ensure_scene_definition
from .validator import validate_ispec


def validate_interaction(config: dict) -> None:
    kind = config.get('kind')
    if kind == 'matrix':
        matrix = config.get('matrix')
        if not isinstance(matrix, list) or len(matrix) != 2 or any(not isinstance(row, list) or len(row)!=2 for row in matrix):
            raise ValueError('请填写完整的2×2矩阵')
        if any(type(v) not in (int, float) or not math.isfinite(v) or abs(v)>10000 for row in matrix for v in row):
            raise ValueError('矩阵元素须为有限数，范围±10000')
        vector = config.get('vector', [1, 0])
        if not isinstance(vector, list) or len(vector)!=2 or any(type(v) not in (int,float) or not math.isfinite(v) or abs(v)>10000 for v in vector):
            raise ValueError('请填写二维输入向量')
    elif kind == 'formula':
        text = config.get('formula', '')
        parts = text.split('=', 1)
        if len(parts)!=2 or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,23}', parts[0].strip()) or _expression(parts[1]) is None:
            raise ValueError('公式须形如 y = x^2 + 2*x，支持有限算术与白名单函数')
        variables=[name for name in _expression(parts[1])[1] if name!='pi']
        if not variables or parts[0].strip() in variables or len(variables)>12:
            raise ValueError('公式须包含1至12个独立输入，输出不能引用自身')
        defaults = config.get('defaults', {})
        if not isinstance(defaults, dict) or len(defaults)>12 or any(type(v) not in (int,float) or not math.isfinite(v) for v in defaults.values()):
            raise ValueError('公式默认值须为有限数值')
    elif kind == 'chart':
        categories, series = config.get('categories', []), config.get('series', [])
        if not isinstance(categories,list) or not 1<=len(categories)<=100 or not isinstance(series,list) or not 1<=len(series)<=12:
            raise ValueError('请填写图表的分类和数值系列')
        for item in series:
            values = item.get('values', [])
            if len(values)!=len(categories) or any(type(v) not in (int,float) or not math.isfinite(v) for v in values):
                raise ValueError('图表分类数和数值数必须一致')
    elif kind != 'none':
        raise ValueError('请选择支持的交互类型')


def _anchor(spec, page, element):
    spec['anchor'] = {'page': page['page_no'], 'element_id': element['element_id'], 'bbox': element['bbox']}
    return spec


def _caption_runs(shape) -> list[dict]:
    """图下文字的 run 级样式（文字/颜色/字号/字体），供前端原位改写时保持原排版。"""
    runs = []
    text_frame = getattr(shape, 'text_frame', None)
    if text_frame is None:
        return runs
    for para in text_frame.paragraphs:
        for run in para.runs:
            color = None
            try:
                color = str(run.font.color.rgb)
            except Exception:
                pass
            runs.append({'text': run.text, 'color': color,
                         'size_pt': run.font.size.pt if run.font.size else None,
                         'font': run.font.name})
    return runs


def _caption_align(shape) -> str | None:
    try:
        para = shape.text_frame.paragraphs[0]
        align = getattr(para, 'alignment', None)
        name = getattr(align, 'name', None)
        return str(name).lower() if name else None
    except Exception:
        return None


def _match_caption(pic_bbox: dict, texts: list[dict]) -> dict | None:
    """图下文字：左边界与图对齐（±1mm）、顶部紧邻图底（0~2.5mm）的文本形状。"""
    left = pic_bbox.get('x', 0)
    bottom = pic_bbox.get('y', 0) + pic_bbox.get('h', 0)
    best = None
    for item in texts:
        bbox = item['bbox']
        if abs(bbox.get('x', 0) - left) > 36000:
            continue
        gap = bbox.get('y', 0) - bottom
        if not (-36000 <= gap <= 91440):
            continue
        if best is None or gap < best[0]:
            best = (gap, item)
    return best[1] if best else None


def enrich_recognition(parsed: dict, material_id: str, metadata: dict):
    enriched = deepcopy(parsed)
    evidence = {}
    figure_scenes: dict[str, dict] = {}
    source = working_path(material_id)
    if source.exists():
        deck = Presentation(source)
        count = 0
        vision_chart_calls = 0
        from .chart_extract import MAX_CHART_CALLS_PER_DECK, extract_chart_from_image
        for number, slide in enumerate(deck.slides, 1):
            page = next((p for p in enriched.get('pages', []) if p['page_no']==number), None)
            if page is None:
                continue
            by_id = {e['element_id']: e for e in page['elements']}
            page_pictures: list[dict] = []
            text_shapes: list[dict] = []
            for shape, _, identifier, _, _ in _walk_shapes(slide.shapes, page_no=number, parent_transform=(1.,1.,0.,0.)):
                if getattr(shape, 'has_text_frame', False) and shape.text_frame.text.strip():
                    element = by_id.get(identifier)
                    if element is not None:
                        text_shapes.append({'element_id': identifier, 'shape': shape, 'bbox': element['bbox'],
                                            'text': shape.text_frame.text})
                if not hasattr(shape, 'image') or count>=40:
                    continue
                element=by_id.get(identifier)
                if element and element['bbox']['w']*element['bbox']['h'] > page.get('width',1)*page.get('height',1)*.9:
                    continue  # Decorative full-page backgrounds are not formula candidates.
                count += 1
                override = metadata.get('overrides', {}).get(identifier, {})
                if override.get('formula_latex'):
                    from .image_text import _latex_matrix
                    latex = override['formula_latex']
                    recognition = {'text': latex, 'math_text': latex, 'rows': [],
                                   'matrix': _latex_matrix(latex), 'status': 'user_confirmed', 'reason': None}
                else:
                    recognition = recognize_image(shape.image.blob)
                evidence[identifier] = {**recognition, 'page_no': number}
                element = by_id.get(identifier)
                if element is not None:
                    waiting = recognition.get('status') == 'needs_review'
                    text = '' if waiting else recognition.get('text', '')
                    if recognition.get('matrix'):
                        text += '\nA = ' + str(recognition['matrix'])
                    element['text'] = text
                    element['math_text'] = None if waiting else recognition.get('math_text')
                    element['recognition_method'] = 'local_ocr'
                    # 供区域识别与文本/OCR 表格启发式复用；只保留证据字段。
                    element['image_recognition'] = {
                        key: recognition.get(key)
                        for key in ('text', 'math_text', 'matrix', 'rows', 'method', 'backend', 'reason', 'status')
                    }
                    if waiting:
                        element['image_recognition']['rows'] = []
                        continue
                    page_pictures.append({'element_id': identifier, 'bbox': element['bbox'],
                                          'blob': shape.image.blob})
            # 位图读图重建：坐标轴 + 单位方格变换像这一类图还原为可操作场景；
            # 校验不过的图不产出（前端保持原图），不阻断其他识别。
            if page_pictures:
                for pic in page_pictures:
                    caption = _match_caption(pic['bbox'], text_shapes)
                    if caption is not None:
                        pic['caption'] = {'element_id': caption['element_id'], 'bbox_emu': caption['bbox'],
                                          'text': caption['text'], 'runs': _caption_runs(caption['shape']),
                                          'align': _caption_align(caption['shape'])}
                try:
                    from .figure_scene import recognize_slide_scenes
                    figure_scenes.update(recognize_slide_scenes(number, page_pictures,
                                                                ocr_lookup=recognize_image))
                except Exception:  # noqa: BLE001 - 读图失败不影响 OCR/原生识别
                    pass
                # 通用图表截图提取：复用已配置的视觉模型（如 Qwen3-VL-32B），
                # 把统计图表截图还原成标准 chart_data，直通下游 _chart_ispec 生成交互图表。
                page_title = str(page.get('title') or '')
                for pic in page_pictures:
                    if vision_chart_calls >= MAX_CHART_CALLS_PER_DECK:
                        break
                    eid = pic['element_id']
                    if eid in figure_scenes:
                        continue
                    element = by_id.get(eid)
                    if element is None or element.get('chart_data'):
                        continue
                    rec = evidence.get(eid) or {}
                    try:
                        chart_data, used_call = extract_chart_from_image(
                            pic['blob'],
                            ocr_text=str(rec.get('text') or ''),
                            ocr_rows=rec.get('rows') or (),
                            has_matrix=bool(rec.get('matrix')),
                            page_title=page_title,
                        )
                    except Exception:  # noqa: BLE001 - 视觉图表提取异常不得阻断其他识别
                        continue
                    if used_call:
                        vision_chart_calls += 1
                    if chart_data:
                        element['chart_data'] = chart_data
                        element['recognition_method'] = 'vision_chart'
                        element.setdefault('image_recognition', {})['chart_extracted'] = True
    for page in enriched.get('pages', []):
        for element in page['elements']:
            override = metadata.get('overrides', {}).get(element['element_id'])
            if override and override.get('text'):
                if element.get('image_recognition', {}).get('status') != 'user_confirmed':
                    element['text'] = override['text']
                element['recognition_method'] = 'user_confirmed'
    return enriched, evidence, figure_scenes


def _configured_spec(page, element, config):
    validate_interaction(config)
    kind = config.get('kind')
    if kind == 'none':
        return []
    source = _source(page['page_no'], element, element.get('text') or element.get('name') or '用户在所选元素配置的交互', 'confirmed')
    source['bbox'] = element['bbox']
    identifier = f'configured_{element["element_id"]}'
    if kind == 'matrix':
        values = [v for row in config['matrix'] for v in row]
        params = [_parameter(key, value, deepcopy(source), f'矩阵 {key}') for key,value in zip('abcd',values)]
        params += [_parameter(key, value, deepcopy(source), f'输入向量 {key[0]}') for key,value in zip(('x1','y1'),config.get('vector',[1,0]))]
        spec = _spec(identifier, config.get('title') or '矩阵与向量', 'geometric', params,
            [{'id':'u1','expr':'a*x1+b*y1'},{'id':'v1','expr':'c*x1+d*y1'},{'id':'det','expr':'a*d-b*c'}],
            [{'type':'figure','spec_ref':'grid_transform','title':'拖动矩阵列向量'},
             {'type':'text','title':'当前计算结果','template':'A·x = ({{u1}}, {{v1}})\ndet(A) = {{det}}'}],
            '用户根据所选原图确认并配置，不冒充自动识别。')
        return [_anchor(spec,page,element)]
    if kind == 'formula':
        synthetic = deepcopy(element)
        synthetic['text'] = config['formula'] + '\n' + '\n'.join(f'{k} = {v}' for k,v in config.get('defaults',{}).items())
        specs = build_native_math_specs({**page,'elements':[synthetic]}, identifier)
        if not specs:
            raise ValueError('该公式没有可调输入，请使用包含变量的标量公式')
        for spec in specs:
            for param in spec['parameters']:
                param['source']['status']='confirmed'
                param['source']['bbox']=element['bbox']
            _anchor(spec,page,element)
            spec['notes']='用户确认的公式与参数，绑定到当前选中元素。'
        return specs
    from .builder import _chart_ispec
    synthetic = {**element,'chart_data': {'title':config.get('title') or '自定义图表',
        'chart_type':'COLUMN_CLUSTERED','categories':config['categories'],'series':config['series']}}
    spec,_ = _chart_ispec(element=synthetic,page=page['page_no'],material_id=identifier)
    if not spec:
        raise ValueError('图表数据无法生成交互')
    spec['notes']='用户从当前原图确认并录入的数据，不是自动图像数值识别。'
    for parameter in spec['parameters']:
        parameter['source']['status']='confirmed'
    return [_anchor(spec,page,element)]


def apply_user_interactions(specs, parsed, metadata):
    result=list(specs)
    for page in parsed.get('pages',[]):
        by_id={element['element_id']:element for element in page['elements']}
        for spec in result:
            if spec.get('anchor') or not spec.get('parameters') or spec['parameters'][0]['source']['page']!=page['page_no']:
                continue
            parameter=spec['parameters'][0]
            source_element=by_id.get(parameter['source'].get('element_id'))
            if source_element and source_element.get('kind')=='picture':
                pictures=[e for e in page['elements'] if e.get('kind')=='picture']
                if spec['kind']=='geometric' and source_element['bbox']['w']*source_element['bbox']['h'] < page.get('width',1)*page.get('height',1)*.08:
                    source_element=max(pictures,key=lambda e:e['bbox']['w']*e['bbox']['h'])
                _anchor(spec,page,source_element)
        for identifier,override in metadata.get('overrides',{}).items():
            if identifier not in by_id or not override.get('interaction'):
                continue
            result=[spec for spec in result if spec.get('anchor',{}).get('element_id')!=identifier]
            result.extend(_configured_spec(page,by_id[identifier],override['interaction']))
    return [spec for spec in result if not validate_ispec(spec)]

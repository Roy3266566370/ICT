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


def _diagram_bbox(pictures, page, nearest):
    """多张并列示意图（如 SVD 三联图）用并集作交互浮层区域。

    单图不合并；并集超过页面 85% 时退回单图。并集过扁时按 16:9 左右
    扩成一个可读区域，避免交互图被压成一条窄带。
    """
    if len(pictures) < 2:
        return nearest['bbox']
    x0=min(e['bbox']['x'] for e in pictures)
    y0=min(e['bbox']['y'] for e in pictures)
    x1=max(e['bbox']['x']+e['bbox']['w'] for e in pictures)
    y1=max(e['bbox']['y']+e['bbox']['h'] for e in pictures)
    width=x1-x0
    height=y1-y0
    page_w=float(page.get('width') or 0)
    page_h=float(page.get('height') or 0)
    if page_w<=0 or page_h<=0 or width<=0 or height<=0 or width*height>page_w*page_h*.85:
        return nearest['bbox']

    if width/height>2.0:
        center_x=nearest['bbox']['x']+nearest['bbox']['w']/2
        center_y=nearest['bbox']['y']+nearest['bbox']['h']/2
        # 取页面内容区可容纳的 16:9 区域；至少 45% 宽，避免又缩回一条窄带。
        target_h=min(page_h*.60,page_w*.85/1.78)
        target_w=max(target_h*1.78,page_w*.45)
        x0=max(0.0,min(page_w-target_w,center_x-target_w/2))
        y0=max(page_h*.15,min(page_h-target_h,center_y-target_h/2))
        return {'x':x0,'y':y0,'w':target_w,'h':target_h}

    return {'x':x0,'y':y0,'w':width,'h':height}


def _integer_parameter(identifier, value, source, label=None, minimum=1, maximum=3):
    return {"id": identifier, "label": label or identifier, "type": "integer", "unit": "",
            "default": int(value), "min": minimum, "max": maximum, "source": source}


def _string_parameter(identifier, value, source, label=None):
    return {"id": identifier, "label": label or identifier, "type": "string",
            "default": value, "source": source}


def _readable_bbox(bbox, page):
    """把图示区域扩成接近 16:9、可读且不覆盖标题的浮层框。"""
    page_w=float(page.get('width') or 0)
    page_h=float(page.get('height') or 0)
    width=float(bbox.get('w') or 0)
    height=float(bbox.get('h') or 0)
    if page_w<=0 or page_h<=0 or width<=0 or height<=0:
        return bbox
    aspect=16/9
    if width/height>aspect:
        target_w=width
        target_h=width/aspect
    else:
        target_h=height
        target_w=height*aspect
    target_w=max(target_w,page_w*.42)
    target_h=max(target_h,target_w/aspect)
    if target_h>page_h*.66:
        target_h=page_h*.66
        target_w=target_h*aspect
    center_x=bbox['x']+width/2
    center_y=bbox['y']+height/2
    if width/height<.95:
        # 竖长的单图向页面中心一侧展开，尽量不遮住另一侧的大号标注文字。
        x0=(min(page_w-target_w,bbox['x']) if center_x<page_w/2
            else max(0.0,bbox['x']+width-target_w))
    else:
        x0=max(0.0,min(page_w-target_w,center_x-target_w/2))
    y0=max(page_h*.15,min(page_h-target_h,center_y-target_h/2))
    return {'x':x0,'y':y0,'w':target_w,'h':target_h}


def _concept_anchor(page, elements):
    """为概念交互选一个图示区域：优先大图/大面板，否则用右侧内容区。

    返回 ``(anchor_element, bbox)``；anchor_element 只用于热区归属，
    真正浮层大小使用 bbox。
    """
    page_w=float(page.get('width') or 0)
    page_h=float(page.get('height') or 0)
    page_area=page_w*page_h
    pictures=[e for e in elements if e.get('kind')=='picture'
              and (e.get('bbox') or {}).get('w',0)*(e.get('bbox') or {}).get('h',0)>=page_area*.02]
    shapes=[e for e in elements if e.get('kind')=='shape'
            and page_area*.08<=(e.get('bbox') or {}).get('w',0)*(e.get('bbox') or {}).get('h',0)<=page_area*.28
            and (e.get('bbox') or {}).get('w',0)<page_w*.8 and (e.get('bbox') or {}).get('h',0)<page_h*.8]
    visual=pictures+shapes
    if visual:
        x0=min(e['bbox']['x'] for e in visual)
        y0=min(e['bbox']['y'] for e in visual)
        x1=max(e['bbox']['x']+e['bbox']['w'] for e in visual)
        y1=max(e['bbox']['y']+e['bbox']['h'] for e in visual)
        anchor=max(visual,key=lambda e:e['bbox']['w']*e['bbox']['h'])
        return anchor, _readable_bbox({'x':x0,'y':y0,'w':x1-x0,'h':y1-y0},page)
    # 没有大图：用右侧 16:9 内容区，仍由页面尺寸推导，不写死像素。
    width=page_w*.55
    height=width*9/16
    bbox={'x':page_w*.41,'y':max(page_h*.15,page_h*.2),'w':width,'h':height}
    texts=[e for e in elements if e.get('kind')=='text' and str(e.get('text') or '').strip()]
    anchor=max(texts,key=lambda e:len(str(e.get('text') or '')),default=None)
    return anchor, bbox


def _concept_source(page, element, excerpt):
    source=_source(page['page_no'],element,excerpt,'inferred')
    source['bbox']=element.get('bbox') if element else None
    return source


def _concept_spec(page, anchor_element, anchor_bbox, identifier, title, params, expressions, views, notes):
    spec=_spec(identifier,title,'geometric',params,expressions,views,notes)
    if anchor_element is not None:
        _anchor(spec,page,anchor_element)
        spec['anchor']['bbox']=anchor_bbox
    return spec


def _concept_specs(page):
    """从页面文字与图示识别概念型交互，选择不同的图形模板。"""
    elements=[e for e in page.get('elements',[]) if isinstance(e,dict)]
    page_text='\n'.join(str(e.get('text') or '') for e in elements)
    anchor_element, anchor_bbox=_concept_anchor(page,elements)
    if anchor_element is None:
        return []
    text_elements=[e for e in elements if e.get('kind')=='text' and str(e.get('text') or '').strip()]
    short_texts=[str(e.get('text') or '').strip() for e in text_elements
                 if len(str(e.get('text') or '').strip())<=30]

    def has_short(*keywords):
        return any(all(keyword in text for keyword in keywords) for text in short_texts)

    def representative(*keywords):
        for element in text_elements:
            text=str(element.get('text') or '')
            if any(keyword in text for keyword in keywords):
                return element, text
        return (text_elements[0], str(text_elements[0].get('text') or '')) if text_elements else (anchor_element, page_text)

    def matrix_params(values, source, labels=('a','b','c','d')):
        return [_parameter(key,value,deepcopy(source),label)
                for key,value,label in zip(('a','b','c','d'),values,labels)]

    # 特征向量定义页：给一个探针向量和可换预设的矩阵。
    if ('特征向量' in page_text and any(word in page_text for word in ('旋转','剪切','恒等'))
            and ('A v = λ v' in page_text or 'A v = λv' in page_text or '定义' in page_text)):
        element, excerpt=representative('剪切','特征向量')
        source=_concept_source(page,element,excerpt)
        params=matrix_params((1.0,1.0,0.0,1.0),source,('矩阵 a','矩阵 b','矩阵 c','矩阵 d'))
        params += [_parameter('vx',1.0,deepcopy(source),'探针向量 x'),
                   _parameter('vy',1.0,deepcopy(source),'探针向量 y')]
        spec=_concept_spec(page,anchor_element,anchor_bbox,
            f'concept_{page["page_no"]}_eigen_probe','特征向量探针',
            params,
            [{'id':'u','expr':'a*vx+b*vy'},{'id':'v','expr':'c*vx+d*vy'}],
            [{'type':'figure','spec_ref':'eigen_probe','title':'拖动探针向量，看它是否留在原方向'},
             {'type':'text','title':'当前计算结果','template':'A·v = ({{u}}, {{v}})'}],
            '按原页“剪切”示例取单位剪切矩阵；矩阵 A 可切换旋转/恒等预设。拖动向量端点观察 A·v 是否与 v 共线。')
        return [spec]

    # 换基页：从原页两组坐标反推斜基，保持同一个点不动。
    coordinate_matches=re.findall(r'坐标\s*=\s*\(\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*\)',page_text)
    if ('换基' in page_text or ('正交基' in page_text and '斜基' in page_text)) and len(coordinate_matches)>=2:
        point_x,point_y=map(float,coordinate_matches[0])
        coord_1,coord_2=map(float,coordinate_matches[1])
        if abs(coord_2)>1e-9:
            b2x=(point_x-coord_1)/coord_2
            b2y=point_y/coord_2
            element, excerpt=representative('坐标','斜基','换基')
            source=_concept_source(page,element,excerpt)
            params=[_parameter('point_x',point_x,deepcopy(source),'固定点 x'),
                    _parameter('point_y',point_y,deepcopy(source),'固定点 y'),
                    _parameter('b2x',b2x,deepcopy(source),'斜基 b₂·x'),
                    _parameter('b2y',b2y,deepcopy(source),'斜基 b₂·y')]
            spec=_concept_spec(page,anchor_element,anchor_bbox,
                f'concept_{page["page_no"]}_basis_change','同一个点，两套坐标',
                params,
                [{'id':'coord_a','expr':'(point_x*b2y-b2x*point_y)/b2y'},
                 {'id':'coord_b','expr':'point_y/b2y'}],
                [{'type':'figure','spec_ref':'basis_change','title':'拖动 P 或 b₂ 看坐标怎样变'},
                 {'type':'text','title':'当前坐标','template':'A 坐标 = ({{point_x}}, {{point_y}})\nB 坐标 = ({{coord_a}}, {{coord_b}})'}],
                '第一组坐标按正交基读取；斜基由原页第二组坐标反推，b₁ 取水平方向。拖动 P 或 b₂ 可观察倍数变化。')
            return [spec]

    # 条件数页 / 特征值 vs 奇异值页：并排对比两个椭圆的奇异值与 κ。
    singular_compare = (
        has_short('条件数')
        or ('奇异值' in page_text and '特征值' in page_text and has_short('奇异值','特征值'))
    )
    if singular_compare:
        pairs=re.findall(r'(\d+(?:\.\d+)?)\s*[/与]\s*(\d+(?:\.\d+)?)',page_text)
        condition_mode=has_short('条件数')
        if condition_mode or len(pairs)>=2:
            element, excerpt=representative('条件数','奇异值')
            source=_concept_source(page,element,excerpt)
            if condition_mode:
                defaults=(1.0,0.01,100.0,100.0)
                title='条件数：压扁不是整体缩放'
                note='A 把纵向压到 1%，条件数约 100；B 所有方向一起缩 100 倍，圆还是圆，条件数仍是 1。'
            else:
                defaults=(float(pairs[0][0]),float(pairs[0][1]),float(pairs[1][0]),float(pairs[1][1]))
                title='奇异值对比：同样没变形假象，被拉扁的程度不同'
                note='两个矩阵的特征值都是 1、1；奇异值分别为 4 个默认数值，条件数 = 最长半轴 / 最短半轴。'
            params=[_parameter('s1a',defaults[0],deepcopy(source),'A · σ₁'),
                    _parameter('s2a',defaults[1],deepcopy(source),'A · σ₂'),
                    _parameter('s1b',defaults[2],deepcopy(source),'B · σ₁'),
                    _parameter('s2b',defaults[3],deepcopy(source),'B · σ₂')]
            for param in params:
                param['min']=0
                param['max']=max(10.0,abs(param['default'])*2)
            spec=_concept_spec(page,anchor_element,anchor_bbox,
                f'concept_{page["page_no"]}_singular_compare',title,
                params,
                [{'id':'area_a','expr':'s1a*s2a'},{'id':'area_b','expr':'s1b*s2b'}],
                [{'type':'figure','spec_ref':'singular_compare','title':'调整奇异值，比较两个椭圆的形状'},
                 {'type':'text','title':'当前结果','template':'|det A| = {{area_a}}　|det B| = {{area_b}}'}],
                note)
            return [spec]

    # 维度与秩页：用行列数/秩的逻辑网格表示张成维度。
    dimensions=re.findall(r'(\d)\s*[×x]\s*(\d)',page_text)
    if '秩' in page_text and ('行数' in page_text or '列数' in page_text) and dimensions:
        rows,cols=map(int,dimensions[0])
        element, excerpt=representative('秩','行数','列数')
        source=_concept_source(page,element,excerpt)
        params=[_integer_parameter('rows',rows,deepcopy(source),'行数（输出维度）',1,3),
                _integer_parameter('cols',cols,deepcopy(source),'列数（输入维度）',1,3),
                _integer_parameter('rank',min(rows,cols),deepcopy(source),'秩（实际张成）',0,3)]
        spec=_concept_spec(page,anchor_element,anchor_bbox,
            f'concept_{page["page_no"]}_rank_map','行数列数说维度，秩说张成',
            params,[],
            [{'type':'figure','spec_ref':'rank_map','title':'调行数、列数与秩，看维度损失'},
             {'type':'text','title':'当前维度','template':'输入 {{cols}} 维 → 输出 {{rows}} 维，秩 = {{rank}}'}],
            '行数与列数取自原页的“3×2 / 2×3”示例；秩不超过两者的较小值，正奇异值个数 = 秩。')
        return [spec]

    # 行列式页：四格面积；单元方格、轴向伸缩、剪切、投影。
    scale=re.search(r'横向\s*(\d+(?:\.\d+)?)\s*倍[、,，\s]*纵向\s*(\d+(?:\.\d+)?)\s*倍',page_text)
    if ('行列式' in page_text and '面积' in page_text and '单位方格' in page_text
            and '剪切' in page_text and ('压到横轴' in page_text or '投影' in page_text) and scale):
        sx,sy=map(float,scale.groups())
        cells=[('单位方格',(1.0,0.0,0.0,1.0)),
               (f'横向 {scale.group(1)} 倍、纵向 {scale.group(2)} 倍',(sx,0.0,0.0,sy)),
               ('剪切',(1.0,1.0,0.0,1.0)),
               ('压到横轴',(1.0,0.0,0.0,0.0))]
        element, excerpt=representative('行列式','单位方格','面积')
        source=_concept_source(page,element,excerpt)
        params=[]
        for index,(label,values) in enumerate(cells):
            for row in range(2):
                for col in range(2):
                    params.append(_parameter(f'cells_{index}_matrix_{row}_{col}',values[row*2+col],
                                             deepcopy(source),f'格 {index+1} · 元素 {row+1}{col+1}'))
            params.append(_string_parameter(f'cells_{index}_label',label,deepcopy(source),f'格 {index+1} 标题'))
        spec=_concept_spec(page,anchor_element,anchor_bbox,
            f'concept_{page["page_no"]}_det_area','一块小方格怎样改变',
            params,
            [{'id':'area_scale','expr':f'{sx}*{sy}'}],
            [{'type':'figure','spec_ref':'det_area','title':'四格面积与定向对比'},
             {'type':'text','title':'面积倍率','template':'伸缩格面积 = {{area_scale}}　压到横轴的格面积 = 0'}],
            '四格按原页“单位方格 / 横向纵向伸缩 / 剪切 / 压到横轴”建立；剪切与投影取单位示例，可修改每个矩阵。')
        return [spec]

    # 求逆页：剪切矩阵的逆映射；投影预设展示无唯一原像。
    if ('求逆' in page_text or '逆矩阵' in page_text) and '剪切' in page_text and '投影' in page_text:
        element, excerpt=representative('剪切的逆','求逆','投影')
        source=_concept_source(page,element,excerpt)
        params=matrix_params((1.0,1.0,0.0,1.0),source,('矩阵 a','矩阵 b','矩阵 c','矩阵 d'))
        params += [_parameter('target_x',2.0,deepcopy(source),'目标点 b · x'),
                   _parameter('target_y',1.0,deepcopy(source),'目标点 b · y')]
        spec=_concept_spec(page,anchor_element,anchor_bbox,
            f'concept_{page["page_no"]}_inverse_map','能不能把每个点送回原位',
            params,
            [{'id':'det','expr':'a*d-b*c'}],
            [{'type':'figure','spec_ref':'inverse_map','title':'拖动目标点，看原像是否唯一'},
             {'type':'text','title':'当前结果','template':'det(A) = {{det}}'}],
            '剪切矩阵取自原页“横坐标减掉纵坐标”的逆；目标点为示意，可拖动。矩阵实验台切到投影可观察无解/整条原像。')
        return [spec]

    return []


def _spatial_specs(page):
    """Recognize explicit operations, never infer unknown matrix coefficients."""
    specs=[]
    elements=page.get('elements',[])
    pictures=[e for e in elements if e.get('kind')=='picture']
    page_text='\n'.join(str(e.get('text') or '') for e in elements)
    for element in elements:
        text=unicodedata.normalize('NFKC',str(element.get('text') or ''))
        rotation=re.search(r'(?:旋转|转)\s*(-?\d+(?:\.\d+)?)\s*°',text)
        stretch=re.search(r'横(?:向)?(?:拉伸|伸长|拉)?\s*(\d+(?:\.\d+)?)\s*倍',text)
        if rotation and stretch:
            source=_source(page['page_no'],element,text,'inferred')
            source['bbox']=element['bbox']
            theta,k=float(rotation[1]),float(stretch[1])
            params=[_parameter('steps_rotate_angle_deg',theta,deepcopy(source),'旋转角度（度）'),
                    _parameter('steps_stretch_factor_x',k,deepcopy(source),'横向倍率'),
                    _parameter('steps_stretch_factor_y',1,deepcopy(source),'纵向倍率')]
            angle='steps_rotate_angle_deg*3.141592653589793/180'
            spec=_spec(f'image_steps_{element["element_id"]}','旋转与伸缩：比较顺序','step',params,
                [{'id':'rsx','expr':f'steps_stretch_factor_x*cos({angle})'},
                 {'id':'rsy','expr':f'steps_stretch_factor_y*sin({angle})'},
                 {'id':'srx','expr':f'steps_stretch_factor_x*cos({angle})'},
                 {'id':'sry','expr':f'steps_stretch_factor_x*sin({angle})'}],
                [{'type':'figure','spec_ref':'step_diagram','title':'播放中间状态'},
                 {'type':'text','template':'先转后拉：({{rsx}}, {{rsy}})\n先拉后转：({{srx}}, {{sry}})','title':'当前计算结果'}],
                '旋转角与横向倍率来自原图文字，纵向倍率1是“只横向拉伸”的含义；输入为原图(1,0)。请核对图片识别。')
            ensure_scene_definition(spec)
            if element.get('kind')=='picture':
                specs.append(_anchor(spec,page,element))
        scale=re.search(r'横向\s*(\d+(?:\.\d+)?)\s*倍[、,，\s]*纵向\s*(\d+(?:\.\d+)?)\s*倍',text)
        singular=re.search(r'(\d+\.\d+)\s*与\s*(\d+\.\d+)',text) if ('SVD' in page_text or '奇异值分解' in page_text) else None
        if singular and pictures and not any(
                s['object_id'].startswith('inferred_scale_')
                and s['parameters'] and s['parameters'][0]['source']['page'] == page['page_no']
                for s in specs
            ):
            # SVD/奇异值页：单位圆在两个正交方向伸缩后变成椭圆。
            # 只使用原文明确给出的两个奇异值，不推断原页未给出的旋转角。
            values=[float(v) for v in singular.groups()]
            box=element['bbox']
            nearest=min(pictures,key=lambda e: abs(e['bbox']['x']+e['bbox']['w']/2-box['x']-box['w']/2)+abs(e['bbox']['y']+e['bbox']['h']-box['y']))
            diagram=_diagram_bbox(pictures,page,nearest)
            source=_source(page['page_no'],element,text,'inferred')
            source['bbox']=nearest['bbox']
            params=[_parameter('a',values[0],deepcopy(source),'伸缩 σ₁'),
                    _parameter('b',0.0,deepcopy(source),'交叉项 b'),
                    _parameter('c',0.0,deepcopy(source),'交叉项 c'),
                    _parameter('d',values[1],deepcopy(source),'伸缩 σ₂')]
            spec=_spec(f'inferred_scale_{element["element_id"]}','圆变成椭圆：奇异值伸缩','geometric',params,
                [{'id':'det','expr':'a*d-b*c'},{'id':'trace','expr':'a+d'}],
                [{'type':'figure','spec_ref':'circle_ellipse','title':'单位圆 → 椭圆'},
                 {'type':'text','title':'当前计算结果','template':'det(A) = {{det}}\n迹 = {{trace}}'}],
                '两个伸缩倍率来自原页明确数值；初始交叉项为 0，表示只识别到正交方向的伸缩，旋转方向未由原页给出。')
            _anchor(spec,page,nearest)
            spec['anchor']['bbox']=diagram
            specs.append(spec)
        elif (scale or singular) and pictures:
            values=[float(v) for v in (scale or singular).groups()]
            box=element['bbox']
            nearest=min(pictures,key=lambda e: abs(e['bbox']['x']+e['bbox']['w']/2-box['x']-box['w']/2)+abs(e['bbox']['y']+e['bbox']['h']-box['y']))
            diagram=_diagram_bbox(pictures,page,nearest)
            config={'kind':'matrix','matrix':[[values[0],0],[0,values[1]]],'title':'轴向伸缩与面积','vector':[1,1]}
            spec=_configured_spec(page,nearest,config)[0]
            spec['object_id']=f'inferred_scale_{element["element_id"]}'
            spec['notes']='两轴倍率来自原页明确数值；只表示已识别的轴向伸缩，不推断未知旋转。'
            if spec.get('anchor'):
                spec['anchor']['bbox']=diagram
            for param in spec['parameters']:
                param['source']=_source(page['page_no'],element,text,'inferred')
                param['source']['bbox']=nearest['bbox']
            specs.append(spec)
    return specs


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
        result.extend(_spatial_specs(page))
        concepts=_concept_specs(page)
        if concepts:
            # 行列式页的四格面积比单个轴向伸缩更完整，替换掉旧的 scale 占位交互。
            page_no=page.get('page_no')
            result=[spec for spec in result if not (
                spec.get('parameters') and spec['parameters'][0]['source']['page']==page_no
                and spec['object_id'].startswith('inferred_scale_')
            )]
            result.extend(concepts)
        for identifier,override in metadata.get('overrides',{}).items():
            if identifier not in by_id or not override.get('interaction'):
                continue
            result=[spec for spec in result if spec.get('anchor',{}).get('element_id')!=identifier]
            result.extend(_configured_spec(page,by_id[identifier],override['interaction']))
    return [spec for spec in result if not validate_ispec(spec)]

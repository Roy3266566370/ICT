from __future__ import annotations
import colorsys
from hashlib import sha256
import math
from pathlib import Path
import re

import numpy as np
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.oxml import parse_xml
from pptx.oxml.ns import qn
from ..parsers.pptx_parser import _walk_shapes

EMU_PER_POINT=12700

def _color(font):
    try:
        if font.color.rgb is not None:
            return '#'+str(font.color.rgb)
    except (ValueError,AttributeError):
        pass
    return None

def _font(font, resolve_color=None):
    result={}
    for name,attribute in [('font_family','name'),('bold','bold'),('italic','italic'),('underline','underline')]:
        value=getattr(font,attribute,None)
        if value is not None: result[name]=bool(value) if attribute in ('bold','italic','underline') else value
    if font.size is not None: result['font_size']=font.size.pt
    if resolve_color:
        fill = font._rPr.find(qn('a:solidFill'))
        color = resolve_color(fill) if fill is not None and len(fill) else None
    else:
        color = _color(font)
    if color: result['color']=color
    try:
        # DrawingML stores character spacing in 1/100 pt as `spc` on rPr.
        rpr=getattr(font,'_rPr',None)
        raw=rpr.get('spc') if rpr is not None else None
        if raw is not None and float(raw)!=0:result['letter_spacing']=float(raw)/100
    except (TypeError,ValueError,AttributeError):pass
    return result

def _text_properties(frame, style, resolve_color=None):
    for attr in ('left','right','top','bottom'):style['padding_'+attr]=getattr(frame,'margin_'+attr)/EMU_PER_POINT
    style['vertical_align']={1:'top',3:'middle',4:'bottom'}.get(int(frame.vertical_anchor or 1),'top')
    paragraphs=[]
    for p in frame.paragraphs:
        align={1:'left',2:'center',3:'right',4:'justify'}.get(int(p.alignment or 1),'left')
        runs=[{'text':r.text,'style':_font(r.font, resolve_color)} for r in p.runs]
        paragraph={'text':p.text,'align':align,'runs':runs}
        if p.line_spacing is not None:
            if resolve_color and hasattr(p.line_spacing, 'pt'):paragraph['line_spacing_pt']=p.line_spacing.pt
            elif isinstance(p.line_spacing, (int, float)) and p.line_spacing>0:
                paragraph['line_height']=float(p.line_spacing)
            elif hasattr(p.line_spacing, 'pt'):paragraph['line_spacing_pt']=p.line_spacing.pt
        for name in ('space_before','space_after'):
            extent=getattr(p,name,None)
            if hasattr(extent, 'pt'):paragraph[name]=extent.pt
        paragraphs.append(paragraph)
    if frame.paragraphs:
        p=frame.paragraphs[0]
        style.update(_font(p.font, resolve_color))
        style['align']=paragraphs[0]['align']
        if p.runs:style.update(_font(p.runs[0].font, resolve_color))
    return paragraphs


def _translation(x, y):
    return np.array(((1, 0, x), (0, 1, y), (0, 0, 1)), dtype=float)


def _transform(xfrm, *, group=False):
    x, y = xfrm.off.x.pt, xfrm.off.y.pt
    width, height = xfrm.ext.cx.pt, xfrm.ext.cy.pt
    angle = math.radians(int(xfrm.get('rot', '0')) / 60000)
    cos, sin = math.cos(angle), math.sin(angle)
    rotation = np.array(((cos, -sin, 0), (sin, cos, 0), (0, 0, 1)))
    flip = np.diag([-1 if xfrm.get(key) in ('1', 'true') else 1 for key in ('flipH', 'flipV')] + [1])
    transform = _translation(x + width / 2, y + height / 2) @ rotation @ flip @ _translation(-width / 2, -height / 2)
    if group:
        child_width, child_height = xfrm.chExt.cx.pt, xfrm.chExt.cy.pt
        if (not child_width and width) or (not child_height and height):
            raise ValueError('Invalid group coordinate extent')
        scale = np.diag((width / child_width if child_width else 1,
                         height / child_height if child_height else 1, 1))
        transform = transform @ scale @ _translation(-xfrm.chOff.x.pt, -xfrm.chOff.y.pt)
    if not np.isfinite(transform).all():
        raise ValueError('Invalid shape transform')
    return transform


def _theme(part):
    layout = part.slide_layout.part
    master = layout.slide_master.part
    mapping = master._element.find(qn('p:clrMap'))
    for current in (part, layout):
        override = current._element.find(f'{qn("p:clrMapOvr")}/{qn("a:overrideClrMapping")}')
        if override is not None:
            mapping = override
            break
    relation = next((rel for rel in master.rels.values() if rel.reltype.endswith('/theme')), None)
    return (parse_xml(relation.target_part.blob) if relation else None), mapping


def _theme_color(fill, theme, mapping, placeholder=None):
    if fill is None or len(fill) != 1:
        raise ValueError('Unavailable solid color')
    color = fill[0]
    tag = color.tag
    value = color.get('val')
    if tag == qn('a:schemeClr'):
        if value == 'phClr':
            value = placeholder
        else:
            name = mapping.get(value, value) if mapping is not None else value
            scheme = theme.find('.//' + qn('a:clrScheme')) if theme is not None else None
            entry = scheme.find(qn('a:' + name)) if scheme is not None else None
            value = _theme_color(entry, theme, mapping)
    elif tag == qn('a:sysClr'):
        value = color.get('lastClr')
    elif tag != qn('a:srgbClr'):
        raise ValueError('Unsupported color space')
    if not value or not re.fullmatch(r'#[0-9a-fA-F]{6}|[0-9a-fA-F]{6}', value):
        raise ValueError('Invalid source color')
    value = value.lstrip('#')
    channels = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    for transform in color:
        amount = int(transform.get('val', '0')) / 100000
        if transform.tag == qn('a:shade'):
            channels = [channel * amount for channel in channels]
        elif transform.tag == qn('a:tint'):
            channels = [channel * amount + 1 - amount for channel in channels]
        elif transform.tag in (qn('a:lumMod'), qn('a:lumOff'), qn('a:satMod')):
            hue, light, saturation = colorsys.rgb_to_hls(*channels)
            if transform.tag == qn('a:lumMod'):
                light *= amount
            elif transform.tag == qn('a:lumOff'):
                light += amount
            else:
                saturation *= amount
            channels = colorsys.hls_to_rgb(hue, min(1, max(0, light)), min(1, max(0, saturation)))
        elif transform.tag != qn('a:alpha') or amount != 1:
            raise ValueError('Unsupported source color effect')
    return '#' + ''.join(f'{round(max(0, min(channel, 1)) * 255):02x}' for channel in channels)


def _line_style(shape, theme, mapping):
    props = shape._element.spPr
    geometry = props.find(qn('a:prstGeom'))
    if geometry is None or geometry.get('prst') != 'line':
        raise ValueError('Only straight connectors can be edited')
    if any(child.tag not in (qn('a:xfrm'), qn('a:prstGeom'), qn('a:ln')) for child in props):
        raise ValueError('Unsupported connector appearance')
    line = props.find(qn('a:ln'))
    reference = shape._element.find(f'{qn("p:style")}/{qn("a:lnRef")}')
    inherited = None
    if reference is not None and theme is not None:
        styles = theme.find('.//' + qn('a:lnStyleLst'))
        index = int(reference.get('idx', '0')) - 1
        if styles is not None and 0 <= index < len(styles):
            inherited = styles[index]

    def property_of(*tags):
        tags = {qn('a:' + tag) for tag in tags}
        for source in (line, inherited):
            if source is not None:
                for child in source:
                    if child.tag in tags:
                        return child
        return None

    fill = property_of('noFill', 'solidFill', 'gradFill', 'pattFill')
    if fill is None or fill.tag != qn('a:solidFill'):
        raise ValueError('Unsupported line fill')
    placeholder = None
    if fill[0].get('val') == 'phClr':
        placeholder = _theme_color(reference, theme, mapping)
    color = _theme_color(fill, theme, mapping, placeholder)
    width = next((int(source.get('w')) / EMU_PER_POINT for source in (line, inherited)
                  if source is not None and source.get('w') is not None), 1)
    if not 0 < width <= 100:
        raise ValueError('Invalid line width')

    def arrow(tag):
        marker = property_of(tag)
        kind = marker.get('type', 'none') if marker is not None else 'none'
        if kind not in ('none', 'triangle', 'stealth', 'arrow'):
            raise ValueError('Unsupported arrow marker')
        return kind != 'none'

    dash = property_of('prstDash', 'custDash')
    if dash is not None and dash.tag == qn('a:custDash'):
        raise ValueError('Unsupported custom dash')
    pattern = dash.get('val', 'solid').lower() if dash is not None else 'solid'
    return {'stroke': color, 'stroke_width': width,
            'line_style': 'dotted' if 'dot' in pattern and 'dash' not in pattern
            else 'solid' if pattern == 'solid' else 'dashed',
            'arrow_start': arrow('headEnd'), 'arrow_end': arrow('tailEnd')}


def native_group_nodes(shape, node: dict) -> list[dict] | None:
    """Replace a group only when every visible object has an editable representation."""
    from .auto_vectors import _vector

    if shape.shape_type != MSO_SHAPE_TYPE.GROUP:
        return None
    children = []
    try:
        theme, mapping = _theme(shape.part)
        slide = shape.part.package.presentation_part.presentation
        page_width, page_height = slide.slide_width.pt, slide.slide_height.pt

        def point(transform, x, y):
            px, py = (transform @ (x, y, 1))[:2]
            if not (-1e-6 <= px <= page_width + 1e-6 and -1e-6 <= py <= page_height + 1e-6):
                raise ValueError('Native geometry exceeds page bounds')
            return float(px), float(py)

        def walk(current, parent):
            if current.shape_type == MSO_SHAPE_TYPE.GROUP:
                group_props = current._element.grpSpPr
                if any(child.tag != qn('a:xfrm') for child in group_props):
                    raise ValueError('Unsupported group appearance')
                transform = parent @ _transform(group_props.xfrm, group=True)
                shapes = list(current.shapes)
                member_count = sum(child.tag not in (qn('p:nvGrpSpPr'), qn('p:grpSpPr'))
                                   for child in current._element)
                if len(shapes) != member_count:
                    raise ValueError('Unsupported group member')
                for child in shapes:
                    walk(child, transform)
                return

            props = current._element.spPr
            xfrm = props.xfrm
            transform = parent @ _transform(xfrm)
            width, height = xfrm.ext.cx.pt, xfrm.ext.cy.pt
            base = {**node, 'id': f'n_{current.shape_id}', 'source_shape_id': current.shape_id,
                    'source_element_id': None, 'name': current.name, 'asset_id': None,
                    'background_asset_id': None, 'whole_group': False, 'locked': False,
                    'figure_provenance': 'native'}
            if current.shape_type == MSO_SHAPE_TYPE.LINE:
                appearance = _line_style(current, theme, mapping)
                result = _vector(base, point(transform, 0, 0), point(transform, width, height), appearance)
                if result is None:
                    raise ValueError('Degenerate line')
            elif current.shape_type == MSO_SHAPE_TYPE.TEXT_BOX and current.text.strip():
                if (width < .1 or height < .1 or props.find(qn('a:noFill')) is None
                        or any(child.tag not in {qn('a:' + tag) for tag in ('xfrm', 'prstGeom', 'noFill')}
                               and not (child.tag == qn('a:ln') and child.find(qn('a:noFill')) is not None)
                               for child in props)):
                    raise ValueError('Unsupported text box appearance')
                for corner in ((0, 0), (0, height), (width, 0), (width, height)):
                    point(transform, *corner)
                cx, cy = point(transform, width / 2, height / 2)
                a, b, c, d = transform[:2, :2].flatten(order='F')
                angle = math.atan2(b, a)
                cos, sin = math.cos(angle), math.sin(angle)
                remainder = [float(math.hypot(a, b)), 0.0, float(cos * c + sin * d), float(-sin * c + cos * d)]
                if abs(remainder[0] * remainder[3]) < 1e-9:
                    raise ValueError('Degenerate text box')
                style = dict(node['style'])
                frame = current.text_frame
                body = frame._txBody.bodyPr
                if (body.get('vert', 'horz') != 'horz' or int(body.get('rot', '0'))
                        or int(body.get('numCol', '1')) != 1 or body.get('upright') in ('1', 'true')
                        or any(p.text != ''.join(run.text for run in p.runs) for p in frame.paragraphs)):
                    raise ValueError('Unsupported native text layout')
                paragraphs = _text_properties(frame, style, lambda fill: _theme_color(fill, theme, mapping))
                result = {**base, 'type': 'text', 'text': current.text, 'base_text': current.text,
                          'x': cx - width / 2, 'y': cy - height / 2, 'width': width, 'height': height,
                          'rotation': math.degrees(angle), 'text_transform': remainder,
                          'style': style, 'paragraphs': paragraphs, 'word_wrap': frame.word_wrap,
                          'auto_size': int(frame.auto_size or 0)}
            else:
                raise ValueError('Unsupported group child')
            result.update({f'base_{key}': result[key] for key in ('x', 'y', 'width', 'height', 'rotation')},
                          base_style=dict(result['style']))
            children.append(result)

        walk(shape, np.eye(3))
    except (AttributeError, IndexError, KeyError, OverflowError, TypeError, ValueError):
        return None

    if not children or len({child['id'] for child in children}) != len(children):
        return None
    for index, child in enumerate(children, 1):
        child['z'] = node['z'] + index / (len(children) + 1)
    return children


def native_figure_scene(nodes: list[dict], page: dict) -> dict | None:
    """Record the native evidence in slide coordinates, alongside its editable nodes."""
    from .figure_scene import FigureScene

    if not nodes:
        return None
    try:
        width, height = page['width'], page['height']
        objects = []
        for node in nodes:
            shape_id = node.get('source_shape_id')
            if node.get('figure_provenance') != 'native' or type(shape_id) is not int or shape_id < 1:
                return None
            w, h = node['width']/2, node['height']/2
            cx, cy = node['x'] + w, node['y'] + h
            angle = math.radians(node['rotation'])
            cos, sin = math.cos(angle), math.sin(angle)
            style = node['style']
            item = {'id': node['id'], 'provenance': 'native', 'evidence': [f'pptx:shape:{shape_id}']}

            def point(x, y):
                px, py = cx + x*cos - y*sin, cy + x*sin + y*cos
                if not (-1e-6 <= px <= width + 1e-6 and -1e-6 <= py <= height + 1e-6):
                    raise ValueError('Native evidence exceeds page bounds')
                return (min(width, max(0, px)), min(height, max(0, py)))

            if node['type'] == 'vector':
                endpoints = [point(-w, 0), point(w, 0)]
                head, tail = style.get('arrow_start', False), style.get('arrow_end', False)
                pattern = style.get('line_style', 'solid')
                if head and not tail:
                    endpoints.reverse()
                if head:
                    item['evidence'].append('pptx:headEnd')
                if tail:
                    item['evidence'].append('pptx:tailEnd')
                if pattern != 'solid':
                    item['evidence'].append(f'pptx:line:{pattern}')
                item.update(type='vector' if head or tail else 'segment' if pattern == 'solid' else 'dashed',
                            points=endpoints, style={'stroke': style['stroke'], 'width': style['stroke_width']})
            elif node['type'] == 'text':
                a, b, c, d = node.get('text_transform', (1, 0, 0, 1))
                corners = [point(a*x + c*y, b*x + d*y) for x in (-w, w) for y in (-h, h)]
                xs, ys = zip(*corners)
                item.update(type='text', text=node['text'], points=[point(0, 0)],
                            bbox=(min(xs), min(ys), max(xs), max(ys)), style={'stroke': style['color']})
            else:
                return None
            objects.append(item)
        return FigureScene(version=1, frame={'width': math.ceil(width), 'height': math.ceil(height)},
                           objects=objects).model_dump(mode='json')
    except (KeyError, OverflowError, TypeError, ValueError):
        return None


def import_document(source:Path,title:str)->dict:
    ppt=Presentation(source)
    pages=[]
    for number,slide in enumerate(ppt.slides,1):
        nodes=[]
        for shape,index,legacy,group_path,bbox in _walk_shapes(slide.shapes,page_no=number,parent_transform=(1,1,0,0)):
            # Top-level groups are preserved as one accurate object; children are not drawn twice.
            if group_path is not None: continue
            native_kind=str(shape.shape_type)
            has_text=bool(getattr(shape,'has_text_frame',False))
            text=shape.text if has_text else ''
            kind='text' if has_text and (text or 'TEXT_BOX' in native_kind) else 'shape'
            if getattr(shape,'has_chart',False):kind='chart'
            elif getattr(shape,'has_table',False):kind='table'
            elif 'PICTURE' in native_kind or 'GROUP' in native_kind:kind='image'
            style={'font_size':18,'font_family':'Arial','color':'#18233D','bold':False,'italic':False,
                   'underline':False,'align':'left','vertical_align':'top','line_height':1.15,
                   'padding_left':0,'padding_right':0,'padding_top':0,'padding_bottom':0}
            paragraphs=[]
            if has_text:
                paragraphs = _text_properties(shape.text_frame, style)
            node={'id':f'n_{shape.shape_id}','source_element_id':legacy,'source_shape_id':shape.shape_id,
              'name':shape.name or ('文字' if has_text else '对象'),'type':kind,
              'x':bbox['x']/EMU_PER_POINT,'y':bbox['y']/EMU_PER_POINT,
              'width':max(.1,bbox['w']/EMU_PER_POINT),'height':max(.1,bbox['h']/EMU_PER_POINT),
              'rotation':float(shape.rotation),'z':index,'opacity':1,
              'locked':not bool(text) and bbox['w']*bbox['h']>ppt.slide_width*ppt.slide_height*.9,'hidden':False,'deleted':False,
              'text':text,'base_text':text,'style':style,'base_style':dict(style),'paragraphs':paragraphs,
              'word_wrap':bool(getattr(shape.text_frame,'word_wrap',True)) if has_text else None,
              'auto_size':int(getattr(shape.text_frame,'auto_size',0) or 0) if has_text else None,
              'shape':'rect',
              'asset_id':f'n_{shape.shape_id}','background_asset_id':f'n_{shape.shape_id}_empty' if has_text else None,
              'whole_group':'GROUP' in native_kind}
            node['base_width']=node['width'];node['base_height']=node['height']
            node['base_x']=node['x'];node['base_y']=node['y'];node['base_rotation']=node['rotation']
            try:
                if 'OVAL' in str(shape.auto_shape_type):node['shape']='ellipse'
            except (AttributeError,ValueError):pass
            if kind=='table':
                node['table']=[[c.text for c in row.cells] for row in shape.table.rows]
                node['base_table']=[list(row) for row in node['table']]
            if kind=='chart':
                from ..parsers.pptx_parser import _chart_data
                node['chart']=_chart_data(shape)[0]
                from copy import deepcopy
                node['base_chart']=deepcopy(node['chart'])
            nodes.append(node)
        pages.append({'page_no':number,'id':f'p_{number}','width':ppt.slide_width/EMU_PER_POINT,
                      'height':ppt.slide_height/EMU_PER_POINT,'nodes':nodes,'modified':False})
    return {'schema_version':'1.0','revision':0,'title':title,'source_key':sha256(source.read_bytes()).hexdigest()[:24],
            'pages':pages,'applied_operations':[]}

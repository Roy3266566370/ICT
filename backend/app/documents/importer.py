from __future__ import annotations
from copy import deepcopy
import colorsys
from hashlib import sha256
from io import BytesIO
import math
from pathlib import Path
import re

import numpy as np
from PIL import Image
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.oxml import parse_xml
from pptx.oxml.ns import qn
from pptx.text.text import Font
from ..parsers.pptx_parser import _walk_shapes

EMU_PER_POINT=12700
NATIVE_IMPORT_VERSION = 2
NATIVE_PRESETS = {
    'rect', 'ellipse', 'roundRect', 'diamond', 'parallelogram', 'trapezoid',
    'triangle', 'rtTriangle', 'hexagon', 'octagon', 'pentagon', 'star5', 'chevron',
    'rightArrow', 'leftArrow', 'upArrow', 'downArrow', 'leftRightArrow',
    'leftBrace', 'rightBrace', 'wedgeRectCallout', 'plus', 'cloud',
}
PATH_COMMANDS = {'moveTo':('M',1), 'lnTo':('L',1), 'quadBezTo':('Q',2), 'cubicBezTo':('C',3), 'close':('Z',0)}
PATH_STEPS = {code:(tag,count) for tag,(code,count) in PATH_COMMANDS.items()}


def shape_path_steps(path):
    """Parse the bounded, absolute path representation used by scene shapes."""
    if not isinstance(path,str) or len(path)>20_000:
        raise ValueError('Invalid custom path')
    tokens=iter(path.split())
    steps=[]
    try:
        for code in tokens:
            tag,count=PATH_STEPS[code]
            points=[(int(next(tokens)),int(next(tokens))) for _ in range(count)]
            if len(steps)>=200 or any(abs(coord)>2**31 for point in points for coord in point):
                raise ValueError('Invalid custom path coordinate')
            steps.append((tag,points))
    except (KeyError,StopIteration) as error:
        raise ValueError('Unsupported custom path command') from error
    if not steps or steps[0][0]!='moveTo':
        raise ValueError('Invalid custom path origin')
    return steps


def valid_shape_paths(paths):
    if not isinstance(paths,list) or not 1<=len(paths)<=8:
        return False
    for item in paths:
        if (not isinstance(item,dict) or item.keys()!={'width','height','path','fill','stroke'}
                or any(type(item[k]) is not int or not 0<item[k]<=2**31 for k in ('width','height'))
                or any(type(item[k]) is not bool for k in ('fill','stroke'))):
            return False
        try:
            shape_path_steps(item['path'])
        except ValueError:
            return False
    return True

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
        baseline=rpr.get('baseline') if rpr is not None else None
        if baseline is not None:result['baseline']=max(-100,min(100,int(baseline)/1000))
        highlight=rpr.find(qn('a:highlight')) if rpr is not None else None
        if highlight is not None and resolve_color:
            color=resolve_color(highlight)
            if color:result['highlight']=color
    except (TypeError,ValueError,AttributeError):pass
    return result

def _text_properties(frame, style, resolve_color=None):
    for attr in ('left','right','top','bottom'):style['padding_'+attr]=getattr(frame,'margin_'+attr)/EMU_PER_POINT
    style['vertical_align']={1:'top',3:'middle',4:'bottom'}.get(int(frame.vertical_anchor or 1),'top')
    paragraphs=[]
    list_style=frame._txBody.find(qn('a:lstStyle'))
    paragraph_fonts=[]
    for p in frame.paragraphs:
        align={1:'left',2:'center',3:'right',4:'justify'}.get(int(p.alignment or 1),'left')
        runs=[]
        inherited={}
        if list_style is not None:
            for tag in ('a:defPPr', f'a:lvl{p.level+1}pPr'):
                props=list_style.find(qn(tag))
                default_font=props.find(qn('a:defRPr')) if props is not None else None
                if default_font is not None:
                    inherited.update(_font(Font(default_font),resolve_color))
        paragraph_font={**inherited,**_font(p.font,resolve_color)}
        paragraph_fonts.append(paragraph_font)
        ordinary=iter(p.runs)
        for entry in p._p:
            if entry.tag==qn('a:r'):
                r=next(ordinary)
                runs.append({'text':r.text,'style':{**paragraph_font,**_font(r.font,resolve_color)}})
            elif entry.tag==qn('a:br'):
                runs.append({'text':'\v','style':{}})
            elif entry.tag==qn('a:fld'):
                text=entry.find(qn('a:t'))
                if text is not None:
                    runs.append({'text':text.text or '','style':{}})
        paragraph={'text':p.text,'align':align,'runs':runs}
        props=p._p.pPr
        if props is not None and any(props.find(qn('a:'+kind)) is not None for kind in ('buChar','buAutoNum')):
            paragraph['bullet']=True
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
        style.update(paragraph_fonts[0])
        style['align']=paragraphs[0]['align']
        if paragraphs[0]['runs']:style.update(paragraphs[0]['runs'][0]['style'])
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


def _theme_color(fill, theme, mapping, placeholder=None, *, ignore_alpha=False):
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
            value = _theme_color(entry, theme, mapping, ignore_alpha=ignore_alpha)
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
        elif transform.tag != qn('a:alpha') or (amount != 1 and not ignore_alpha):
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


def _resolved_color(fill, theme, mapping, placeholder=None, *, ignore_alpha=False):
    try:
        return _theme_color(fill, theme, mapping, placeholder, ignore_alpha=ignore_alpha)
    except (ValueError, TypeError, IndexError):
        return None


def _format_style(theme, reference, list_name, offset=1):
    if theme is None or reference is None:
        return None
    styles = theme.find('.//' + qn('a:' + list_name))
    index = int(reference.get('idx', '0')) - offset
    return styles[index] if styles is not None and 0 <= index < len(styles) else None


def _shape_appearance(shape, style, theme, mapping, background, complex_background):
    props = shape._element.spPr
    appearance = shape._element.find(qn('p:style'))
    preset = props.find(qn('a:prstGeom'))
    geometry = preset.get('prst', 'rect') if preset is not None else 'rect'
    complex_geometry = geometry not in NATIVE_PRESETS
    if preset is not None:
        adjustment = preset.find(qn('a:avLst'))
        complex_geometry |= adjustment is not None and bool(len(adjustment))

    def read_paint(explicit, inherited, reference):
        tags = {qn('a:' + name) for name in ('solidFill', 'noFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill')}
        paint = next((child for child in explicit if child.tag in tags), None) if explicit is not None else None
        if paint is None:
            paint = inherited
        if paint is None or paint.tag == qn('a:noFill'):
            return None, False, 1
        placeholder = _resolved_color(reference, theme, mapping) if reference is not None else None
        value = _resolved_color(paint, theme, mapping, placeholder, ignore_alpha=True) if paint.tag == qn('a:solidFill') else None
        alpha=paint[0].find(qn('a:alpha')) if value else None
        opacity=max(0,min(1,int(alpha.get('val','100000'))/100000)) if alpha is not None else 1
        return value, value is None, opacity

    if shape._element.get('useBgFill') in ('1', 'true'):
        fill, complex_fill, fill_opacity = background or '#ffffff', complex_background, 1
    else:
        fill_ref = appearance.find(qn('a:fillRef')) if appearance is not None else None
        fill, complex_fill, fill_opacity = read_paint(props, _format_style(theme, fill_ref, 'fillStyleLst'), fill_ref)
    if fill:
        style['fill'] = fill
    line = props.find(qn('a:ln'))
    line_ref = appearance.find(qn('a:lnRef')) if appearance is not None else None
    inherited_line = _format_style(theme, line_ref, 'lnStyleLst')
    inherited_paint = inherited_line.find(qn('a:solidFill')) if inherited_line is not None else None
    stroke, complex_stroke, stroke_opacity = read_paint(line, inherited_paint, line_ref)
    if stroke:
        style['stroke'] = stroke
        style['stroke_width'] = next((int(candidate.get('w')) / EMU_PER_POINT for candidate in (line, inherited_line)
                                      if candidate is not None and candidate.get('w') is not None), 1)
    effect = any(len(child) for child in props if child.tag in {qn('a:'+tag) for tag in ('effectLst','effectDag','scene3d','sp3d')})
    complex_styles = bool(fill and stroke and fill_opacity!=stroke_opacity)
    opacity=fill_opacity if fill else stroke_opacity
    return geometry if not complex_geometry else 'rect', bool(complex_geometry or complex_fill or complex_stroke or effect or complex_styles), opacity


def _shape_paths(shape):
    geometry=shape._element.spPr.find(qn('a:custGeom'))
    paths=geometry.find(qn('a:pathLst')) if geometry is not None else None
    if paths is None:
        return None
    if not 1<=len(paths)<=8:
        raise ValueError('Unsupported custom geometry')
    result=[]
    for path in paths:
        width=int(path.get('w',str(shape.width)))
        height=int(path.get('h',str(shape.height)))
        if not (0<width<=2**31 and 0<height<=2**31 and 0<len(path)<=200):
            raise ValueError('Invalid custom path dimensions')
        steps=[]
        for command in path:
            code, count=PATH_COMMANDS.get(command.tag.rsplit('}',1)[-1],(None,-1))
            if len(command)!=count:
                raise ValueError('Unsupported custom path command')
            points=[int(point.get(key)) for point in command for key in ('x','y')]
            if any(abs(point)>2**31 for point in points):
                raise ValueError('Invalid custom path coordinate')
            steps.append(' '.join([code,*map(str,points)]))
        if not steps[0].startswith('M '):
            raise ValueError('Invalid custom path origin')
        fill=path.get('fill','norm')
        if fill not in ('norm','none'):
            raise ValueError('Unsupported custom path fill mode')
        result.append({'width':width,'height':height,'path':' '.join(steps),'fill':fill!='none',
                       'stroke':path.get('stroke','true') not in ('false','0')})
    return result


def _background(slide, theme, mapping):
    owners = (slide, slide.slide_layout, slide.slide_layout.slide_master)
    for owner in owners:
        bg = owner._element.find(f'{qn("p:cSld")}/{qn("p:bg")}')
        if bg is None:
            continue
        props = bg.find(qn('p:bgPr'))
        reference = bg.find(qn('p:bgRef'))
        fill = props.find(qn('a:solidFill')) if props is not None else None
        if reference is not None:
            fill = _format_style(theme, reference, 'bgFillStyleLst', 1001)
            if fill is None:
                fill = _format_style(theme, reference, 'fillStyleLst')
        color = _resolved_color(fill, theme, mapping, _resolved_color(reference, theme, mapping))
        return color, color is None
    return None, False


def _native_picture(shape, target):
    try:
        blob=shape.image.blob
        with Image.open(BytesIO(blob)) as image:
            if image.width * image.height > 30_000_000:
                return False
            target.parent.mkdir(parents=True, exist_ok=True)
            if image.format=='PNG' and not getattr(image,'is_animated',False):
                image.verify()
                target.write_bytes(blob)
            else:
                image.convert('RGBA').save(target,compress_level=2)
        return True
    except (AttributeError, KeyError, OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        return False


def import_document(source:Path,title:str,*,asset_root:Path|None=None)->dict:
    from .auto_vectors import _vector
    ppt=Presentation(source)
    pages=[]
    for number,slide in enumerate(ppt.slides,1):
        nodes=[]
        theme, mapping = _theme(slide.part)
        background, complex_background = _background(slide, theme, mapping)
        fallback = complex_background or any(not shape.is_placeholder for shape in slide.slide_layout.shapes)
        if slide._element.get('showMasterSp') not in ('0', 'false'):
            fallback |= any(not shape.is_placeholder for shape in slide.slide_layout.slide_master.shapes)
        for shape,index,legacy,group_path,bbox in _walk_shapes(slide.shapes,page_no=number,parent_transform=(1,1,0,0)):
            # Top-level groups are preserved as one accurate object; children are not drawn twice.
            if group_path is not None: continue
            native_kind=str(shape.shape_type)
            has_text=bool(getattr(shape,'has_text_frame',False))
            text=shape.text if has_text else ''
            kind='text' if has_text and (text or 'TEXT_BOX' in native_kind) else 'shape'
            if getattr(shape,'has_chart',False):kind='chart'
            elif getattr(shape,'has_table',False):kind='table'
            elif shape._element.tag==qn('p:pic') or 'PICTURE' in native_kind or 'GROUP' in native_kind:kind='image'
            style={'font_size':18,'font_family':'Arial','color':'#18233D','bold':False,'italic':False,
                   'underline':False,'align':'left','vertical_align':'top','line_height':1.15,
                   'padding_left':0,'padding_right':0,'padding_top':0,'padding_bottom':0}
            paragraphs=[]
            if has_text:
                paragraphs = _text_properties(shape.text_frame, style, lambda fill: _resolved_color(fill, theme, mapping))
            node={'id':f'n_{shape.shape_id}','source_element_id':legacy,'source_shape_id':shape.shape_id,
              'name':shape.name or ('文字' if has_text else '对象'),'type':kind,
              'x':bbox['x']/EMU_PER_POINT,'y':bbox['y']/EMU_PER_POINT,
              'width':max(.1,bbox['w']/EMU_PER_POINT),'height':max(.1,bbox['h']/EMU_PER_POINT),
              'rotation':float(shape.rotation),'z':index,'opacity':1,
              'locked':not bool(text) and bbox['w']*bbox['h']>ppt.slide_width*ppt.slide_height*.9,'hidden':False,'deleted':False,
              'text':text,'base_text':text,'style':style,'base_style':dict(style),'paragraphs':paragraphs,
              'word_wrap':shape.text_frame.word_wrap if has_text else None,
              'auto_size':int(getattr(shape.text_frame,'auto_size',0) or 0) if has_text else None,
              'shape':'rect',
              'asset_id':f'n_{shape.shape_id}','background_asset_id':f'n_{shape.shape_id}_empty' if has_text else None,
              'whole_group':'GROUP' in native_kind}
            complex_shape = False
            if shape.shape_type == MSO_SHAPE_TYPE.LINE:
                try:
                    props = shape._element.spPr
                    transform = _transform(props.xfrm)
                    first = (transform @ (0, 0, 1))[:2]
                    last = (transform @ (props.xfrm.ext.cx.pt, props.xfrm.ext.cy.pt, 1))[:2]
                    vector = _vector(node, first, last, _line_style(shape, theme, mapping))
                    if vector is None:
                        raise ValueError('Empty line')
                    node = vector
                except (AttributeError, TypeError, ValueError, OverflowError):
                    complex_shape = True
            elif shape._element.tag==qn('p:pic') and asset_root is not None:
                filename = f'n_{shape.shape_id}.png'
                if _native_picture(shape, asset_root / f'p{number:02d}' / filename):
                    node['native_file'] = filename
                    crop = {side: getattr(shape, 'crop_' + side, 0) for side in ('left', 'top', 'right', 'bottom')}
                    if (any(crop.values()) and all(0 <= value < 1 for value in crop.values())
                            and crop['left']+crop['right'] < 1 and crop['top']+crop['bottom'] < 1):
                        node['crop'] = crop
                        node['base_crop'] = dict(crop)
                    elif any(crop.values()):
                        complex_shape = True
                else:
                    complex_shape = True
            elif shape.shape_type in (MSO_SHAPE_TYPE.AUTO_SHAPE, MSO_SHAPE_TYPE.TEXT_BOX,
                                      MSO_SHAPE_TYPE.PLACEHOLDER, MSO_SHAPE_TYPE.FREEFORM):
                try:
                    node['shape'], complex_shape, node['opacity'] = _shape_appearance(shape, style, theme, mapping, background, complex_background)
                    transform=shape._element.spPr.xfrm
                    if (kind=='text' and transform is not None and transform.get('flipV') in ('1','true')
                            and not (style.get('fill') or style.get('stroke'))):
                        node['text_rotation_offset']=180
                    paths=_shape_paths(shape)
                    if paths:
                        node['shape_paths']=paths
                except (AttributeError, TypeError, ValueError, OverflowError):
                    complex_shape = True
            elif kind not in ('table', 'chart'):
                complex_shape = True
            if kind=='table':
                node['table']=[[c.text for c in row.cells] for row in shape.table.rows]
                node['base_table']=[list(row) for row in node['table']]
            if kind=='chart':
                from ..parsers.pptx_parser import _chart_data
                node['chart']=_chart_data(shape)[0]
                node['base_chart']=deepcopy(node['chart'])
                complex_shape |= not bool(node['chart'] and node['chart']['categories'])
            node.update({f'base_{key}': node[key] for key in ('x', 'y', 'width', 'height', 'rotation')},
                        base_style=dict(node['style']), base_opacity=node['opacity'], native_fallback=complex_shape)
            fallback |= complex_shape
            nodes.append(node)
        notes = slide.notes_slide.notes_text_frame if slide.has_notes_slide else None
        pages.append({'page_no':number,'id':f'p_{number}','width':ppt.slide_width/EMU_PER_POINT,
                      'height':ppt.slide_height/EMU_PER_POINT,'nodes':nodes,'modified':False,
                      'native_ready':True,'native_fallback':fallback,
                      **({'notes':notes.text} if notes is not None and notes.text else {}),
                      **({'background_color':background} if background else {})})
    return {'schema_version':'1.0','revision':0,'title':title,'source_key':sha256(source.read_bytes()).hexdigest()[:24],
            'native_import_version':NATIVE_IMPORT_VERSION,
            'pages':pages,'applied_operations':[]}

"""Project SceneDocument edits back into native PowerPoint slides."""
from __future__ import annotations

import base64
from copy import deepcopy
from io import BytesIO
import math
import re

from PIL import Image
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.dml import MSO_LINE_DASH_STYLE
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE, MSO_CONNECTOR, MSO_SHAPE_TYPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Emu, Pt

from .importer import _group_members, shape_path_steps, valid_fill_gradient, valid_shape_paths
from .layers import layer_dir, native_asset_path, source_page_number
from ..render import PAGE_IMAGE_PATTERN, pages_dir

INTERACTIVE_TYPES = {'workshop_plugin', 'diagram'}
PRESETS = {item.xml_value:item for item in MSO_AUTO_SHAPE_TYPE}
ALIGN = {'left':PP_ALIGN.LEFT, 'center':PP_ALIGN.CENTER, 'right':PP_ALIGN.RIGHT, 'justify':PP_ALIGN.JUSTIFY}
ANCHOR = {'top':MSO_ANCHOR.TOP, 'middle':MSO_ANCHOR.MIDDLE, 'bottom':MSO_ANCHOR.BOTTOM}
REL_NS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
IMAGE_DATA = re.compile(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)')
TEXT_STYLE = {'font_family','font_size','bold','italic','underline','color','letter_spacing',
              'baseline','highlight','line_height','align','vertical_align','padding_left',
              'padding_top','padding_right','padding_bottom'}


def snapshot_png(data):
    match=IMAGE_DATA.fullmatch(data) if isinstance(data,str) and len(data)<=5_600_050 else None
    if match is None or match[1]!='png':
        raise ValueError('交互快照必须是 PNG 图片')
    raw=base64.b64decode(match[2],validate=True)
    if len(raw)>4*1024*1024:
        raise ValueError('交互快照文件超过 4 MB')
    try:
        with Image.open(BytesIO(raw)) as image:
            if (image.format!='PNG' or max(image.size)>4096 or image.width*image.height>8_000_000
                    or getattr(image,'is_animated',False)):
                raise ValueError('交互快照尺寸或格式无效')
            image.verify()
            return raw
    except (OSError,Image.DecompressionBombError) as error:
        raise ValueError('交互快照无法读取') from error


def _copy_slide(deck, source):
    slide=deck.slides.add_slide(source.slide_layout)
    rel_map={}
    for rel in source.part.rels.values():
        if not rel.reltype.endswith('/notesSlide'):
            target=rel.target_ref if rel.is_external else rel.target_part
            rel_map[rel.rId]=slide.part.relate_to(target,rel.reltype,is_external=rel.is_external)
    copy=deepcopy(source._element)
    for element in copy.iter():
        for key,value in tuple(element.attrib.items()):
            if key.startswith(REL_NS) and value in rel_map:
                element.set(key,rel_map[value])
    slide._element.attrib.update(copy.attrib)
    slide._element[:] = list(copy)
    # add_slide caches the placeholder tree before the source XML replaces it.
    slide.__dict__.pop('shapes',None)
    if source.has_notes_slide:
        original_notes=source.notes_slide.notes_text_frame
        if original_notes is not None:
            notes=slide.notes_slide.notes_text_frame
            if notes is not None:
                notes.text=original_notes.text
    return slide


def _output_slides(deck, pages):
    ids=deck.slides._sldIdLst
    originals={i:(slide,entry) for i,(slide,entry) in enumerate(zip(deck.slides,list(ids)),1)}
    output=[]
    for page in pages:
        source_no=source_page_number(page)
        original=originals.get(source_no)
        if original and source_no==page['page_no']:
            slide,entry=original
        else:
            slide=_copy_slide(deck,original[0]) if original else deck.slides.add_slide(
                min(deck.slide_layouts,key=lambda layout:len(layout.placeholders)))
            entry=ids[-1]
        output.append((slide,entry))
    retained={entry.rId for _,entry in output}
    removed={slide.part for slide,entry in originals.values() if entry.rId not in retained}
    for entry in list(ids):
        ids.remove(entry)
        if entry.rId not in retained:
            deck.part.drop_rel(entry.rId)
    for slide,entry in output:
        ids.append(entry)
        discarded={rel.rId for rel in slide.part.rels.values() if not rel.is_external
                   and rel.reltype.endswith('/slide') and rel.target_part in removed}
        for element in list(slide._element.iter()):
            if element.tag in (qn('a:hlinkClick'),qn('a:hlinkMouseOver')) and element.get(qn('r:id')) in discarded:
                element.getparent().remove(element)
        for relation in discarded:
            slide.part.drop_rel(relation)
    return [slide for slide,_ in output]


def _rgb(value):
    return RGBColor.from_string(value[1:].upper()) if isinstance(value,str) and re.fullmatch(r'#[a-fA-F0-9]{6}',value) else None


def _child(parent, tag):
    child=parent.find(qn(tag))
    if child is None:
        child=OxmlElement(tag)
        parent.append(child)
    return child


def _alpha(element,opacity):
    fill=element.find(qn('a:solidFill'))
    if fill is not None and len(fill):
        _child(fill[0],'a:alpha').set('val',str(round(opacity*100000)))


def _write_gradient(props, gradient):
    fill = OxmlElement('a:gradFill')
    stops = _child(fill, 'a:gsLst')
    for item in gradient['stops']:
        stop = OxmlElement('a:gs')
        linear='angle' in gradient
        stop.set('pos', str(round(item['position']*100000)) if linear else str(item['position']))
        color = _child(stop, 'a:srgbClr')
        color.set('val', item['color'][1:].upper())
        alpha=round(item.get('opacity',1)*100000) if linear else item['opacity']
        _child(color, 'a:alpha').set('val', str(alpha))
        stops.append(stop)
    if 'angle' in gradient:
        _child(fill,'a:lin').set('ang',str(round((gradient['angle']-90)%360*60000)))
    else:
        path = _child(fill, 'a:path')
        path.set('path', 'circle')
        rect = _child(path, 'a:fillToRect')
        for key, value in zip('ltrb', gradient['bounds']):
            rect.set(key, str(value))
    props._remove_eg_fillProperties()
    props.insert_element_before(fill, 'a:ln', 'a:effectLst', 'a:effectDag', 'a:extLst')


def _write_shadow(props,shadow):
    effects=props.find(qn('a:effectLst'))
    if effects is not None:
        old=effects.find(qn('a:outerShdw'))
        if old is not None:effects.remove(old)
    if not shadow:
        return
    if effects is None:
        effects=OxmlElement('a:effectLst')
        props.insert_element_before(effects,'a:scene3d','a:sp3d','a:extLst')
    node=_child(effects,'a:outerShdw')
    angle=math.degrees(math.atan2(shadow['y'],shadow['x']))%360
    node.set('dir',str(round(angle*60000)))
    node.set('dist',str(round(math.hypot(shadow['x'],shadow['y'])*12700)))
    node.set('blurRad',str(round(shadow['blur']*12700)))
    color=_child(node,'a:srgbClr')
    color.set('val',shadow['color'][1:].upper())
    _child(color,'a:alpha').set('val',str(round(shadow['opacity']*100000)))


def _line(shape, style, opacity, arrows=False):
    line=shape.line
    if 'stroke' in style:
        color=_rgb(style['stroke'])
        if color is not None:
            line.color.rgb=color
        else:
            line.fill.background()
    if 'stroke_width' in style:
        line.width=Pt(style['stroke_width'])
    if 'line_style' in style:
        line.dash_style={'dashed':MSO_LINE_DASH_STYLE.DASH,'dotted':MSO_LINE_DASH_STYLE.ROUND_DOT}.get(style['line_style'],MSO_LINE_DASH_STYLE.SOLID)
    if arrows:
        for key,name in (('arrow_start','headEnd'),('arrow_end','tailEnd')):
            if key in style:
                _child(line._get_or_add_ln(),'a:'+name).set('type','triangle' if style[key] else 'none')
    if opacity!=1 or 'stroke_opacity' in style:
        _alpha(line._get_or_add_ln(),opacity*style.get('stroke_opacity',1))


def _write_text(frame,node,changed_style):
    style=node.get('style',{})
    frame.clear()
    frame.word_wrap=node.get('word_wrap')
    for side in ('left','top','right','bottom'):
        key='padding_'+side
        if key in style:
            setattr(frame,'margin_'+side,Pt(style[key]))
    if style.get('vertical_align') in ANCHOR:
        frame.vertical_anchor=ANCHOR[style['vertical_align']]
    text=node.get('text','')
    paragraphs=node.get('paragraphs') or []
    if '\n'.join(p.get('text','') for p in paragraphs)!=text:
        paragraphs=[{'text':line} for line in text.split('\n')]
    ordinal=0
    for i,paragraph in enumerate(paragraphs):
        out=frame.add_paragraph() if i else frame.paragraphs[0]
        out.alignment=ALIGN.get(changed_style.get('align',paragraph.get('align',style.get('align'))))
        if 'line_spacing_pt' in paragraph:
            out.line_spacing=Pt(paragraph['line_spacing_pt'])
        elif paragraph.get('line_height') or style.get('line_height'):
            out.line_spacing=paragraph.get('line_height') or style['line_height']
        for key in ('space_before','space_after'):
            if key in paragraph:
                setattr(out,key,Pt(paragraph[key]))
        ordered=paragraph.get('list_type')=='ordered'
        ordinal=ordinal+1 if ordered else 0
        if ordered:
            bullet=_child(out._p.get_or_add_pPr(),'a:buAutoNum')
            bullet.set('type','arabicPeriod')
            bullet.set('startAt',str(ordinal))
        elif paragraph.get('bullet') or paragraph.get('list_type')=='bullet':
            _child(out._p.get_or_add_pPr(),'a:buChar').set('char','•')
        for entry in paragraph.get('runs') or [paragraph]:
            attrs={**style,**entry.get('style',{}),**changed_style}
            for index,line in enumerate(entry.get('text','').split('\v')):
                if index:
                    out.add_line_break()
                if not line:
                    continue
                run=out.add_run()
                run.text=line
                for key,attribute in (('font_family','name'),('bold','bold'),('italic','italic'),('underline','underline')):
                    if key in attrs:
                        setattr(run.font,attribute,attrs[key])
                if 'font_size' in attrs:
                    run.font.size=Pt(attrs['font_size'])
                if (color:=_rgb(attrs.get('color'))) is not None:
                    run.font.color.rgb=color
                if node.get('opacity',1)!=1:
                    _alpha(run.font._rPr,node['opacity'])
                for key,attr,scale in (('letter_spacing','spc',100),('baseline','baseline',1000)):
                    if key in attrs:
                        run.font._rPr.set(attr,str(round(attrs[key]*scale)))
                if (highlight:=_rgb(attrs.get('highlight'))) is not None:
                    _child(_child(run.font._rPr,'a:highlight'),'a:srgbClr').set('val',str(highlight))


def _picture(material_id,doc,page,node):
    from .figure_service import asset_path

    cleaned=node.get('cleaned_asset_id')
    if cleaned:
        path=asset_path(material_id,node.get('cleaned_asset_page_no',page['page_no']),cleaned)
        if path:
            return str(path)
    data=node.get('image_data')
    match=IMAGE_DATA.fullmatch(data) if isinstance(data,str) else None
    if match:
        raw=BytesIO(base64.b64decode(match[2],validate=True))
        if match[1]=='webp':
            output=BytesIO()
            with Image.open(raw) as image:
                image.convert('RGBA').save(output,format='PNG')
            return output
        return raw
    source_no=source_page_number(page)
    if name:=node.get('render_file'):
        rendered=PAGE_IMAGE_PATTERN.fullmatch(name)
        if rendered and not rendered.group('erased') and int(rendered.group('page_no'))==source_no:
            path=pages_dir(material_id)/name
            if path.is_file():
                return str(path)
    key=doc.get('source_key')
    if key and source_no:
        native=native_asset_path(material_id,key,source_no,node.get('native_file'))
        if native is not None:
            return str(native)
        filename=(node.get('image_url') or '').rsplit('/',1)[-1]
        if re.fullmatch(r'n_\d+\.png',filename):
            path=layer_dir(material_id,key,source_no)/filename
            if path.is_file():
                return str(path)
    return None


def _chart(shapes,box,config,palette=None):
    categories=config.get('categories',[])
    series=config.get('series',[])
    if not categories or not series:
        return None
    data=CategoryChartData()
    data.categories=categories
    for item in series:
        values=item['values']
        data.add_series(item.get('name',''),(values[i] if i<len(values) else None for i in range(len(categories))))
    kind=XL_CHART_TYPE.__members__.get(config.get('chart_type',''),XL_CHART_TYPE.COLUMN_CLUSTERED)
    try:
        graphic=shapes.add_chart(kind,*box,data)
    except (KeyError,NotImplementedError,ValueError):
        graphic=shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED,*box,data)
    if config.get('title'):
        graphic.chart.chart_title.text_frame.text=config['title']
    if palette:
        colors=[palette['primary'],palette['accent'],palette['secondary'],'#7760A1','#B18739','#408B8D']
        for i,item in enumerate(graphic.chart.series):
            if kind in (XL_CHART_TYPE.PIE,XL_CHART_TYPE.DOUGHNUT):
                for j,point in enumerate(item.points):
                    point.format.fill.solid()
                    point.format.fill.fore_color.rgb=_rgb(colors[j%len(colors)])
            elif kind==XL_CHART_TYPE.LINE:
                item.format.line.color.rgb=_rgb(colors[i%len(colors)])
            else:
                item.format.fill.solid()
                item.format.fill.fore_color.rgb=_rgb(colors[i%len(colors)])
    return graphic


def _table(shapes,box,rows,existing,settings=None,palette=None):
    cols=max((len(row) for row in rows),default=0)
    if not cols:
        return existing
    if (existing is None or len(existing.table.rows)!=len(rows)
            or len(existing.table.columns)!=cols):
        existing=shapes.add_table(len(rows),cols,*box)
    settings=settings or {}
    palette=palette or {}
    for i,row in enumerate(rows):
        for j in range(cols):
            cell=existing.table.cell(i,j)
            value=row[j] if j<len(row) else ''
            if cell.text!=value:
                cell.text=value
            if not settings:
                continue
            header=i==0 and settings.get('header_row')
            banded=i%2 and settings.get('banded_rows')
            fill=_rgb(settings.get('header_fill',palette.get('primary','#233A63')) if header else
                      settings.get('band_fill','#EDF1F7') if banded else '#FFFFFF')
            if fill:
                cell.fill.solid()
                cell.fill.fore_color.rgb=fill
            cell.vertical_anchor=MSO_ANCHOR.MIDDLE
            if header:
                color=_rgb(settings.get('header_color','#FFFFFF'))
                for paragraph in cell.text_frame.paragraphs:
                    for run in paragraph.runs:
                        run.font.bold=True
                        if color:run.font.color.rgb=color
            border=_rgb(settings.get('border_color',palette.get('border','#B9C4D6')))
            if border:
                properties=cell._tc.get_or_add_tcPr()
                for side in ('lnL','lnR','lnT','lnB'):
                    line=properties.find(qn('a:'+side))
                    if line is None:
                        line=OxmlElement('a:'+side)
                        properties.insert_element_before(line,'a:cell3D','a:noFill','a:solidFill','a:gradFill','a:blipFill','a:pattFill','a:grpFill')
                    line.set('w','12700')
                    _child(_child(line,'a:solidFill'),'a:srgbClr').set('val',str(border))
    return existing


def _interactive(shapes,box,node,snapshot):
    if snapshot:
        return shapes.add_picture(BytesIO(snapshot),*box)
    kind=node['type']
    data=node.get(kind) or {}
    title=data.get('title') or {'diagram':'流程图',
                               'workshop_plugin':'定象坊插件'}[kind]
    if kind=='diagram':
        extra=' → '.join(str(entry.get('label','')) for entry in data.get('nodes',[])[:6])
    else:
        extra=data.get('summary') or data.get('category') or ''
    shape=shapes.add_shape(MSO_AUTO_SHAPE_TYPE.ROUNDED_RECTANGLE,*box)
    shape.fill.solid()
    shape.fill.fore_color.rgb=RGBColor.from_string('F0F5FA')
    shape.line.color.rgb=RGBColor.from_string('B9CCD9')
    frame=shape.text_frame
    frame.word_wrap=True
    frame.vertical_anchor=MSO_ANCHOR.MIDDLE
    for i,(value,size) in enumerate(((title,18),(extra,12),('在通文册中查看互动演示',10))):
        if value:
            paragraph=frame.add_paragraph() if i else frame.paragraphs[0]
            paragraph.text=str(value)
            paragraph.font.size=Pt(size)
            paragraph.font.color.rgb=RGBColor.from_string('284763')
            paragraph.alignment=PP_ALIGN.CENTER
    return shape


def _apply_node(material_id,doc,page,slide,node,shape,sx,sy,snapshot):
    x,y,w,h=[node[key] for key in ('x','y','width','height')]
    box=(Emu(round(x*sx)),Emu(round(y*sy)),Emu(max(1,round(w*sx))),Emu(max(1,round(h*sy))))
    style=node.get('style',{})
    changes={k:v for k,v in style.items() if node.get('base_style',{}).get(k)!=v}
    opacity=node.get('opacity',1)
    kind=node['type']
    initial=shape
    rotation=node.get('rotation',0)
    moved=any(node.get('base_'+key,node.get(key))!=node.get(key) for key in ('x','y','width','height','rotation'))
    if kind=='vector':
        if shape is None or moved:
            angle=math.radians(rotation)
            cx,cy=x+w/2,y+h/2
            dx,dy=math.cos(angle)*w/2,math.sin(angle)*w/2
            shape=slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT,Emu(round((cx-dx)*sx)),Emu(round((cy-dy)*sy)),
                                             Emu(round((cx+dx)*sx)),Emu(round((cy+dy)*sy)))
        _line(shape,style if shape is not initial else changes,opacity,arrows=True)
        return shape
    if kind=='table' and (shape is None or node.get('table')!=node.get('base_table') or node.get('table_style')):
        shape=_table(slide.shapes,box,node.get('table') or [],shape,node.get('table_style'),(doc.get('theme') or {}).get('palette'))
    elif kind=='chart' and (shape is None or node.get('chart')!=node.get('base_chart')):
        shape=_chart(slide.shapes,box,node.get('chart') or {},(doc.get('theme') or {}).get('palette')) or shape
    elif kind=='image' and (shape is None or node.get('cleaned_asset_id') or node.get('image_data')):
        picture=_picture(material_id,doc,page,node)
        if picture:
            shape=slide.shapes.add_picture(picture,*box)
    elif kind in INTERACTIVE_TYPES:
        shape=_interactive(slide.shapes,box,node,snapshot)
    elif kind in ('shape','text') and shape is None:
        preset=PRESETS.get(node.get('shape'),MSO_AUTO_SHAPE_TYPE.RECTANGLE)
        if kind=='text' and not (style.get('fill') or style.get('stroke') or preset!=MSO_AUTO_SHAPE_TYPE.RECTANGLE):
            shape=slide.shapes.add_textbox(*box)
        else:
            shape=slide.shapes.add_shape(preset,*box)
        if node.get('shape_paths'):
            _custom_geometry(shape,node['shape_paths'])
    if shape is None:
        return None
    new=shape is not initial
    if new or moved:
        shape.left,shape.top,shape.width,shape.height=box
        shape.rotation=rotation
    if kind=='image' and hasattr(shape,'crop_left'):
        if new or node.get('crop')!=node.get('base_crop'):
            crop=node.get('crop') or {}
            for side in ('left','right','top','bottom'):
                setattr(shape,'crop_'+side,crop.get(side,0))
        if opacity!=1:
            blip=shape._element.find('.//'+qn('a:blip'))
            _child(blip,'a:alphaModFix').set('amt',str(round(opacity*100000)))
    elif kind in ('text','shape') and hasattr(shape,'fill'):
        if new and not style.get('fill') and valid_fill_gradient(node.get('fill_gradient')):
            _write_gradient(shape._element.spPr, node['fill_gradient'])
        elif new or 'fill' in changes:
            fill=_rgb(style.get('fill'))
            if fill is None:
                shape.fill.background()
            else:
                shape.fill.solid()
                shape.fill.fore_color.rgb=fill
        if style.get('linear_gradient'):
            _write_gradient(shape._element.spPr,style['linear_gradient'])
        elif 'linear_gradient' in changes and not node.get('fill_gradient'):
            fill=_rgb(style.get('fill'))
            if fill:
                shape.fill.solid()
                shape.fill.fore_color.rgb=fill
            else:
                shape.fill.background()
        if 'shadow' in style:
            _write_shadow(shape._element.spPr,style['shadow'])
        if kind=='shape' and 'border_radius' in style and node.get('shape') in (None,'rect','roundRect'):
            geometry=shape._element.spPr.find(qn('a:prstGeom'))
            if geometry is not None:
                radius=style['border_radius']
                geometry.set('prst','roundRect' if radius or node.get('shape')=='roundRect' else 'rect')
                values=_child(geometry,'a:avLst')
                for item in list(values):values.remove(item)
                if radius:
                    adjustment=_child(values,'a:gd')
                    adjustment.set('name','adj')
                    adjustment.set('fmla',f'val {round(100000*min(.5,radius/min(node["width"],node["height"])))}')
        if (new and (opacity!=1 or 'fill_opacity' in style)) or opacity!=node.get('base_opacity',1) or 'fill_opacity' in changes:
            _alpha(shape._element.spPr,opacity*style.get('fill_opacity',1))
        if new and not style.get('stroke'):
            shape.line.fill.background()
        else:
            _line(shape,style if new else changes,opacity)
        text_changes={k:v for k,v in changes.items() if k in TEXT_STYLE}
        if (kind=='text' or kind=='shape' and (node.get('text') or node.get('base_text'))) and shape.has_text_frame and (new or node.get('text')!=node.get('base_text') or text_changes
                or opacity!=node.get('base_opacity',1)
                or ('base_paragraphs' in node and node.get('paragraphs')!=node['base_paragraphs'])):
            if 'base_paragraphs' in node:
                text_changes={k:v for k,v in text_changes.items() if k=='align'}
            _write_text(shape.text_frame,node,text_changes)
    return shape


def _custom_geometry(shape, paths):
    if not valid_shape_paths(paths):
        return
    props=shape._element.spPr
    preset=props.find(qn('a:prstGeom'))
    index=props.index(preset)
    props.remove(preset)
    geometry=OxmlElement('a:custGeom')
    props.insert(index,geometry)
    for tag in ('avLst','gdLst','ahLst','cxnLst'):
        geometry.append(OxmlElement('a:'+tag))
    rectangle=_child(geometry,'a:rect')
    rectangle.attrib.update({'l':'l','t':'t','r':'r','b':'b'})
    path_list=_child(geometry,'a:pathLst')
    for data in paths:
        path=OxmlElement('a:path')
        path.attrib.update({'w':str(data['width']),'h':str(data['height']),
                            'fill':'norm' if data['fill'] else 'none','stroke':'1' if data['stroke'] else '0'})
        path_list.append(path)
        for tag,points in shape_path_steps(data['path']):
            command=OxmlElement('a:'+tag)
            path.append(command)
            for x,y in points:
                point=OxmlElement('a:pt')
                point.attrib.update({'x':str(x),'y':str(y)})
                command.append(point)


def _changed(node):
    return (node.get('hidden') or node.get('deleted') or
            any(node.get('base_'+key,node.get(key))!=node.get(key) for key in
                ('x','y','width','height','rotation','opacity','text','style','paragraphs')))


def _referenced_relations(element):
    return {value for child in element.iter() for key,value in child.attrib.items() if key.startswith(REL_NS)}


def _write_master(doc,page,slide,sx,sy):
    theme=doc.get('theme') or {}
    master=theme.get('master') or {}
    if not master or page.get('hide_master'):
        return
    width,height=page['width'],page['height']
    palette=theme.get('palette') or {}
    accent=_rgb(palette.get('accent'))
    bar=master.get('accent_bar')
    boxes={'top':(0,0,width,5),'left':(0,0,5,height),'bottom':(0,height-5,width,5)}
    if accent and bar in boxes:
        x,y,w,h=boxes[bar]
        shape=slide.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.RECTANGLE,Emu(round(x*sx)),Emu(round(y*sy)),
                                    Emu(round(w*sx)),Emu(round(h*sy)))
        shape.fill.solid()
        shape.fill.fore_color.rgb=accent
        shape.line.fill.background()
    number=next(index for index,other in enumerate(doc['pages'],1) if other['page_no']==page['page_no'])
    labels=[(master.get('header_text'),24,14,width-48,'left'),
            (master.get('footer_text'),24,height-30,width-160,'left')]
    if master.get('show_page_number'):
        labels.append((f'{number} / {len(doc["pages"])}',width-124,height-30,100,'right'))
    for text,x,y,w,align in labels:
        if not text:
            continue
        box=slide.shapes.add_textbox(Emu(round(x*sx)),Emu(round(y*sy)),Emu(round(w*sx)),Emu(round(18*sy)))
        _write_text(box.text_frame,{'text':text,'style':{'font_size':13,'font_family':(theme.get('fonts') or {}).get('body','Arial'),
                    'color':palette.get('muted','#444444'),'align':align,'padding_left':0,'padding_top':0,
                    'padding_right':0,'padding_bottom':0}}, {})


def _write_page_background(material_id,doc,page,slide,sx,sy):
    background=page.get('background')
    if not background:
        return
    kind=background['kind']
    if kind=='solid':
        slide.background.fill.solid()
        slide.background.fill.fore_color.rgb=_rgb(background['color'])
    elif kind=='gradient':
        _write_gradient(slide.background._cSld.get_or_add_bgPr(),background['gradient'])
    elif kind=='image':
        picture=_picture(material_id,doc,page,{'image_data':background['image_data']})
        if picture is not None:
            if background.get('overlay_color'):
                slide.background.fill.solid()
                slide.background.fill.fore_color.rgb=_rgb(background['overlay_color'])
            shape=slide.shapes.add_picture(picture,0,0,Emu(round(page['width']*sx)),Emu(round(page['height']*sy)))
            opacity=background.get('image_opacity',1)
            if opacity<1:
                _child(shape._element.blipFill.blip,'a:alphaModFix').set('amt',str(round(opacity*100000)))


def _update_slide(material_id,doc,page,slide,sx,sy,work_url,snapshots,has_source):
    if 'transition' in page:
        slide_xml=slide._element
        for old in slide_xml.xpath('./p:transition'):
            slide_xml.remove(old)
        kind=(page.get('transition') or {}).get('kind')
        tag={'fade':'fade','slide':'wipe','push':'push','zoom':'zoom'}.get(kind)
        if tag:
            transition=OxmlElement('p:transition')
            effect=OxmlElement(f'p:{tag}')
            if tag in ('push','wipe'):effect.set('dir','l')
            transition.append(effect)
            slide_xml.insert_element_before(transition,'p:timing','p:extLst')
    initial=list(slide.shapes)
    old_relations=_referenced_relations(slide._element)
    by_id={shape.shape_id:shape for shape in initial}
    if page.get('rendered_only'):
        by_id={}
        for shape in initial:
            shape._element.getparent().remove(shape._element)
    def native_children(group):
        for child in _group_members(group):
            if child.shape_type==MSO_SHAPE_TYPE.GROUP:
                yield from native_children(child)
            else:
                yield child.shape_id

    # Automatic vectorisation may replace a group with editable children.
    nodes_by_source={node.get('source_shape_id'):node for node in page['nodes'] if node.get('source_shape_id')}
    untouched_group_members={}
    for shape in by_id.values():
        if shape.shape_type!=MSO_SHAPE_TYPE.GROUP or shape.shape_id in nodes_by_source:
            continue
        try:
            children=[nodes_by_source.get(number) for number in native_children(shape)]
        except ValueError:
            continue
        if not children or not all(n and n.get('figure_provenance')=='native' for n in children):
            continue
        if any(_changed(node) for node in children):
            shape._element.getparent().remove(shape._element)
        else:
            untouched_group_members.update({node['id']:shape._element for node in children})
    if page.get('background_modified') or ((source_page_number(page) is None or not has_source) and page.get('background_color')):
        color=_rgb(page.get('background_color'))
        if color is None:
            slide.follow_master_background=True
        else:
            slide.background.fill.solid()
            slide.background.fill.fore_color.rgb=color
    if not has_source and isinstance(page.get('background_url'),str):
        background=_picture(material_id,doc,page,{'image_data':page['background_url']})
        if background:
            slide.shapes.add_picture(background,Emu(0),Emu(0),Emu(round(page['width']*sx)),Emu(round(page['height']*sy)))
    _write_page_background(material_id,doc,page,slide,sx,sy)
    _write_master(doc,page,slide,sx,sy)
    ordered=[]
    interactive=False
    for node in sorted(page['nodes'],key=lambda item:item['z']):
        if node['id'] in untouched_group_members:
            element=untouched_group_members[node['id']]
            if element not in ordered:
                ordered.append(element)
            continue
        original=by_id.get(node.get('source_shape_id'))
        if node.get('hidden') or node.get('deleted') or node['type']=='demo':
            if original is not None:
                original._element.getparent().remove(original._element)
            continue
        interactive |= node['type'] in INTERACTIVE_TYPES
        current=_apply_node(material_id,doc,page,slide,node,original,sx,sy,
                            snapshots.get((page['page_no'],node['id'])))
        if current is not None:
            ordered.append(current._element)
            if original is not None and current is not original:
                original._element.getparent().remove(original._element)
    tree=slide.shapes._spTree
    for element in ordered:
        tree.remove(element)
        tree.insert_element_before(element,'p:extLst')
    for relation in old_relations-_referenced_relations(slide._element):
        slide.part.drop_rel(relation)
    if 'notes' in page or interactive:
        frame=slide.notes_slide.notes_text_frame
        if frame is not None:
            notes=page.get('notes',frame.text)
            if frame.text!=notes:
                frame.text=notes
            if interactive and work_url:
                paragraph=frame.add_paragraph() if frame.text else frame.paragraphs[0]
                paragraph.add_run().text='在通文册打开互动版：'
                link=paragraph.add_run()
                link.text=f'{work_url}?page={page["page_no"]}'
                link.hyperlink.address=link.text


def export_pptx(material_id,source,document,*,work_url='',snapshots=None):
    has_source=source is not None and source.is_file()
    if has_source and (not document or (not document.get('structure_modified')
                                       and not any(p.get('modified') for p in document['pages']))):
        return source.read_bytes()
    deck=Presentation(source) if has_source else Presentation()
    pages=document['pages']
    if not has_source:
        deck.slide_width=Pt(pages[0]['width'])
        deck.slide_height=Pt(pages[0]['height'])
    slides=_output_slides(deck,pages)
    for slide,page in zip(slides,pages):
        if page.get('modified') or source_page_number(page)!=page['page_no'] or not has_source:
            _update_slide(material_id,document,page,slide,deck.slide_width/page['width'],
                          deck.slide_height/page['height'],work_url,snapshots or {},has_source)
    stream=BytesIO()
    deck.save(stream)
    return stream.getvalue()

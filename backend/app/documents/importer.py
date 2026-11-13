from __future__ import annotations
from hashlib import sha256
from pathlib import Path
from pptx import Presentation
from ..parsers.pptx_parser import _walk_shapes

EMU_PER_POINT=12700

def _color(font):
    try:
        if font.color.rgb is not None:
            return '#'+str(font.color.rgb)
    except (ValueError,AttributeError):
        pass
    return None

def _font(font):
    result={}
    for name,attribute in [('font_family','name'),('bold','bold'),('italic','italic'),('underline','underline')]:
        value=getattr(font,attribute,None)
        if value is not None: result[name]=bool(value) if attribute in ('bold','italic','underline') else value
    if font.size is not None: result['font_size']=font.size.pt
    color=_color(font)
    if color: result['color']=color
    try:
        # DrawingML stores character spacing in 1/100 pt as `spc` on rPr.
        rpr=getattr(font,'_rPr',None)
        raw=rpr.get('spc') if rpr is not None else None
        if raw is not None and float(raw)!=0:result['letter_spacing']=float(raw)/100
    except (TypeError,ValueError,AttributeError):pass
    return result

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
                frame=shape.text_frame
                for attr in ('left','right','top','bottom'):style['padding_'+attr]=getattr(frame,'margin_'+attr)/EMU_PER_POINT
                style['vertical_align']={1:'top',3:'middle',4:'bottom'}.get(int(frame.vertical_anchor or 1),'top')
                for p in frame.paragraphs:
                    align={1:'left',2:'center',3:'right',4:'justify'}.get(int(p.alignment or 1),'left')
                    runs=[{'text':r.text,'style':_font(r.font)} for r in p.runs]
                    paragraph={'text':p.text,'align':align,'runs':runs}
                    if isinstance(p.line_spacing,(int,float)) and p.line_spacing>0:
                        paragraph['line_height']=float(p.line_spacing)
                    elif p.line_spacing is not None:
                        try:paragraph['line_spacing_pt']=p.line_spacing.pt
                        except AttributeError:pass
                    for name,attribute in (('space_before','space_before'),('space_after','space_after')):
                        extent=getattr(p,attribute,None)
                        if extent is not None:
                            try:paragraph[name]=extent.pt
                            except AttributeError:pass
                    paragraphs.append(paragraph)
                if frame.paragraphs:
                    p=frame.paragraphs[0]
                    style.update(_font(p.font))
                    style['align']=paragraphs[0]['align']
                    if p.runs:style.update(_font(p.runs[0].font))
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

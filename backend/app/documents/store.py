from __future__ import annotations
from copy import deepcopy
from pathlib import Path
import json,math,os,re,threading
from uuid import uuid4
from ..settings import UPLOAD_DIR

LOCK=threading.RLock()
class DocumentConflict(ValueError):pass

def document_root(material_id:str)->Path:
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,96}',material_id):raise ValueError('材料标识不合法')
    return UPLOAD_DIR/material_id/'document'

def read_document(material_id:str)->dict|None:
    path=document_root(material_id)/'document.json'
    if not path.exists():return None
    with LOCK:return json.loads(path.read_text(encoding='utf-8'))

def write_document(material_id:str,document:dict)->None:
    with LOCK:
        root=document_root(material_id);root.mkdir(parents=True,exist_ok=True)
        temp=root/f'document.{uuid4().hex}.tmp'
        temp.write_text(json.dumps(document,ensure_ascii=False,allow_nan=False),encoding='utf-8')
        os.replace(temp,root/'document.json')

def _number(value,minimum,maximum):
    if type(value) not in (float,int) or not math.isfinite(value) or not minimum<=value<=maximum:
        raise ValueError('位置、大小和样式须为允许范围内的有限数值')

def validate_patch(patch:dict)->dict:
    normalized=deepcopy(patch)
    numeric={'x':(-20000,20000),'y':(-20000,20000),'width':(.1,20000),'height':(.1,20000),
      'rotation':(-36000,36000),'z':(-10000,10000),'opacity':(0,1)}
    allowed=set(numeric)|{'locked','hidden','deleted','text','style','table','chart','crop','interaction','basis','flow','viewer_editable','viewer_parameters','math_scene','matrix_ocr','diagram','demo',
        'cleaned_asset_id','figure_scene','figure_source_id','figure_object_id','figure_provenance'}
    if set(patch)-allowed:raise ValueError('修改包含不可编辑字段')
    for key,value in patch.items():
        if key in numeric:_number(value,*numeric[key])
        elif key in ('locked','hidden','deleted','viewer_editable'):
            if type(value) is not bool:raise ValueError('开关字段类型不合法')
        elif key=='viewer_parameters':
            if (not isinstance(value,list) or len(value)>3 or any(k not in ('geometry','style','flow') for k in value)
                    or len(set(value))!=len(value)):
                raise ValueError('观众可编辑线条参数不合法')
        elif key=='cleaned_asset_id':
            if value is not None and (not isinstance(value,str) or not re.fullmatch(r'[a-f0-9]{64}',value)):
                raise ValueError('清底资产标识不合法')
        elif key=='figure_scene':
            if value is not None:
                from .figure_scene import FigureScene
                normalized[key]=FigureScene.model_validate(value).model_dump(mode='json')
        elif key in ('figure_source_id','figure_object_id'):
            if value is not None and (not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,96}',value)):
                raise ValueError('图示来源标识不合法')
        elif key=='figure_provenance':
            if value not in (None,'pixel','vision','user_confirmed'):
                raise ValueError('图示来源类型不可写入')
        elif key=='math_scene':
            from .math_scene import validate_math_scene
            validate_math_scene(value)
        elif key=='diagram':
            from .inline_systems import validate_scene_diagram
            normalized[key]=validate_scene_diagram(value)
        elif key=='demo':
            from .inline_systems import validate_scene_demo
            normalized[key]=validate_scene_demo(value)
        elif key=='matrix_ocr':
            from .math_scene import validate_matrix_ocr
            validate_matrix_ocr(value)
        elif key=='flow':
            if not isinstance(value,dict) or set(value)!={'enabled','speed'} or type(value['enabled']) is not bool:
                raise ValueError('流动动画配置不合法')
            _number(value['speed'],.1,10)
        elif key=='text':
            if not isinstance(value,str) or len(value)>20000:raise ValueError('文字过长')
        elif key=='style':
            if not isinstance(value,dict):raise ValueError('样式类型不合法')
            for name,item in value.items():
                if name=='font_size':_number(item,1,500)
                elif name=='line_height':_number(item,.5,5)
                elif name=='letter_spacing':_number(item,-20,100)
                elif name.startswith('padding_') and name[8:] in ('left','right','top','bottom'):_number(item,0,500)
                elif name in ('color','fill','stroke'):
                    if item!='transparent' and not (isinstance(item,str) and re.fullmatch(r'#[0-9a-fA-F]{6}',item)):raise ValueError('颜色须为十六进制值')
                elif name=='font_family':
                    if not isinstance(item,str) or len(item)>100 or re.search(r'[<>;{}]',item):raise ValueError('字体名称不合法')
                elif name in ('bold','italic','underline','arrow_start','arrow_end'):
                    if type(item) is not bool:raise ValueError('样式类型不合法')
                elif name=='align':
                    if item not in ('left','center','right','justify'):raise ValueError('对齐方式不合法')
                elif name=='vertical_align':
                    if item not in ('top','middle','bottom'):raise ValueError('对齐方式不合法')
                elif name=='stroke_width':_number(item,0,100)
                elif name=='line_style':
                    if item not in ('solid','dashed','dotted'):raise ValueError('线型不合法')
                elif name=='anim_step':
                    if type(item) is not int or not 0<=item<=8:raise ValueError('动画步序须为0至8的整数')
                elif name=='bind_mode':
                    if item not in ('none','scale','rotate'):raise ValueError('联动模式不合法')
                else:raise ValueError('未知样式字段')
        elif key=='crop':
            if not isinstance(value,dict) or set(value)!={'left','right','top','bottom'}:raise ValueError('裁剪参数不完整')
            for n in value.values():_number(n,0,.95)
            if value['left']+value['right']>=.98 or value['top']+value['bottom']>=.98:raise ValueError('裁剪区域为空')
        elif key=='table':
            if not isinstance(value,list) or len(value)>100 or any(not isinstance(r,list) or len(r)>50 or any(not isinstance(c,str) or len(c)>2000 for c in r) for r in value):raise ValueError('表格数据不合法')
        elif key=='chart':
            from ..ispec.user_config import validate_interaction
            validate_interaction({'kind':'chart',**value})
        elif key=='interaction':
            from ..ispec.node_interaction import validate_node_interaction
            if value is None:
                continue
            validate_node_interaction(value)
        elif key=='basis':
            if value is None:
                continue
            if not isinstance(value,dict):raise ValueError('换基联动配置不合法')
            ids=('firstId','secondId','resultId')
            title,size=value.get('title'),value.get('fontSize')
            if (not all(isinstance(value.get(k),str) and 1<=len(value[k])<=100 for k in ids)
                or len({value[k] for k in ids})!=3
                or not isinstance(title,list) or len(title)!=2
                or not all(type(v) in (int,float) and math.isfinite(v) for v in title)
                or type(size) not in (int,float) or not 0<size<=200):
                raise ValueError('换基联动配置不合法')
    return normalized

def _create(page,identifier,data):
    if not isinstance(data,dict):raise ValueError('新增对象数据不合法')
    source=data.get('duplicate_from')
    if source:
        original=next((n for n in page['nodes'] if n['id']==source),None)
        if original is None:raise ValueError('复制源对象不存在')
        node=deepcopy(original)
        for key in ('cleaned_asset_id','figure_scene','figure_source_id','figure_object_id','figure_provenance'):
            node.pop(key,None)
        node.update(id=identifier,source_element_id=None,source_shape_id=None,duplicate_from=source,
                    name=original['name']+' 副本',deleted=False,locked=False)
        update={k:v for k,v in data.items() if k!='duplicate_from'}
        update=validate_patch(update);node.update(update)
    else:
        if set(data)-{'type','name','text','x','y','width','height','rotation','z','style','image_data','shape','opacity','locked','hidden','deleted','crop','interaction','basis','flow','viewer_editable','viewer_parameters','math_scene','matrix_ocr','diagram','demo','figure_provenance','figure_source_id','figure_object_id'}:raise ValueError('新增对象包含不可用字段')
        kind=data.get('type','text')
        if kind not in ('text','shape','image','vector','math_scene','diagram','demo'):raise ValueError('对象类型不支持新增')
        if kind=='diagram' and 'diagram' not in data:raise ValueError('流程图缺少节点和连线')
        if kind=='math_scene' and 'math_scene' not in data:raise ValueError('数学图缺少配置')
        style={'font_size':28,'font_family':'Arial','color':'#18233D','align':'left','vertical_align':'top','line_height':1.15,
               'padding_left':0,'padding_right':0,'padding_top':0,'padding_bottom':0}
        style.update(data.get('style',{}))
        node={'id':identifier,'type':kind,'name':{'text':'新文字','shape':'新图形','vector':'线条','math_scene':'矩阵变换图','diagram':'原位流程图','demo':'AI 演示框'}.get(kind,'新图片'),
          'x':80,'y':80,'width':300,'height':70,'rotation':0,'z':max((n['z'] for n in page['nodes']),default=0)+1,
          'text':data.get('text','新文字'),'base_text':None,'style':style,'base_style':{},'paragraphs':[],
          'opacity':1,'locked':False,'hidden':False,'deleted':False,'source_element_id':None,'source_shape_id':None,
          'asset_id':None,'background_asset_id':None,'shape':data.get('shape','rect')}
        if 'name' in data:
            if not isinstance(data['name'],str) or not data['name'].strip() or len(data['name'])>100:
                raise ValueError('对象名称不合法')
            node['name']=data['name']
        update={k:v for k,v in data.items() if k not in ('type','image_data','shape','name')}
        update=validate_patch(update)
        node.update(update);node['style']=style
        if 'interaction' in update:
            from ..ispec.node_interaction import validate_node_interaction
            validate_node_interaction(update['interaction'])
        if kind=='image':
            import base64,io
            from PIL import Image
            raw=data.get('image_data','')
            if not isinstance(raw,str) or len(raw)>6_000_000 or not re.match(r'^data:image/(png|jpeg|webp);base64,',raw):raise ValueError('图片须为PNG、JPEG或WebP且小于4MB')
            try:
                blob=base64.b64decode(raw.split(',',1)[1],validate=True)
                with Image.open(io.BytesIO(blob)) as image:
                    if image.width*image.height>30_000_000:raise ValueError('图片像素过大')
                    image.verify()
            except (OSError,ValueError) as error:raise ValueError('图片内容无法读取，请使用有效的PNG、JPEG或WebP图片') from error
            node['image_data']=raw
    return node

def reinteract_page(material_id:str,expected_revision:int,page_no:int)->dict:
    """Mark a page to be recognised from its current scene content.

    The interaction specs are rebuilt from the document on every read, so the
    flag and revision are the only persisted state.
    """
    from ..ispec.node_interaction import refresh_paused_user_interaction
    with LOCK:
        original=read_document(material_id)
        if original is None:raise ValueError('请先打开自由编辑文档')
        if expected_revision!=original['revision']:raise DocumentConflict('文档已在其他窗口更新，请刷新后重试')
        document=deepcopy(original)
        page=next((p for p in document['pages'] if p['page_no']==page_no),None)
        if page is None:raise ValueError('页面不存在')
        refreshed=0
        for node in page['nodes']:
            config=node.get('interaction')
            if not isinstance(config,dict):
                continue
            if config.get('kind')=='formula':
                updated=refresh_paused_user_interaction(node,page_no)
                if updated:
                    node['interaction']=updated
                    refreshed+=1
                else:
                    node['interaction']={**config,'status':'paused',
                                         'reason':'当前文字中没有可解析的公式，请在自由编辑中填写计算关系。'}
            elif config.get('kind')=='chart' and isinstance(node.get('chart'),dict):
                node['interaction']={**config,'kind':'chart','status':'active',
                                     'categories':node['chart'].get('categories',[]),
                                     'series':node['chart'].get('series',[])}
                node['interaction'].pop('reason',None)
                refreshed+=1
        page['reinteraction']=True
        page['reinteraction_revision']=document['revision']+1
        document['revision']+=1
        write_document(material_id,document)
        return {'revision':document['revision'],'page_no':page_no,'refreshed_user_interactions':refreshed,
                'reinteraction_revision':page['reinteraction_revision']}

def patch_document(material_id:str,expected_revision:int,operation_id:str,changes:list[dict])->dict:
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',operation_id):raise ValueError('操作标识不合法')
    if len(changes)>1000:raise ValueError('一次修改对象过多')
    with LOCK:
        original=read_document(material_id)
        if original is None:raise ValueError('请先打开自由编辑文档')
        if operation_id in original.get('applied_operations',[]):return original
        if expected_revision!=original['revision']:raise DocumentConflict('文档已在其他窗口更新，本地修改已保留')
        document=deepcopy(original)
        for change in changes:
            page=next((p for p in document['pages'] if p['page_no']==change.get('page_no')),None)
            if page is None:raise ValueError('页面不存在')
            identifier=change.get('id','')
            if not isinstance(identifier,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,96}',identifier):raise ValueError('对象标识不合法')
            node=next((n for n in page['nodes'] if n['id']==identifier),None)
            manifest_path=document_root(material_id)/'layers'/document['source_key']/f'p{page["page_no"]:02d}'/'manifest.json'
            manifest=json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {}
            if identifier in manifest.get('frozen_ids',[]):raise ValueError('该对象未能独立分离，暂不支持编辑')
            if 'create' in change:
                if not identifier.startswith('u_'):raise ValueError('新增对象标识须使用u_前缀')
                if node and not node.get('deleted'):raise ValueError('新增对象标识已存在')
                if not node and len(page['nodes'])>=1000:raise ValueError('本页对象过多')
                restored=_create(page,identifier,change['create'])
                if node:page['nodes']=[restored if n['id']==identifier else n for n in page['nodes']]
                else:page['nodes'].append(restored)
            else:
                if node is None:raise ValueError('该对象不属于所选页面')
                patch=change.get('patch')
                if not isinstance(patch,dict):raise ValueError('修改字段缺失')
                patch=validate_patch(patch)
                if patch.get('cleaned_asset_id'):
                    if node['type']!='image':
                        raise ValueError('清底资产只能应用于图片')
                    from .figure_service import validate_asset_binding
                    validate_asset_binding(material_id,page['page_no'],document['source_key'],
                                           {**node,**patch},patch['cleaned_asset_id'])
                if 'style' in patch:
                    node['style']={**node['style'],**patch['style']}
                    node['style_modified']=list(set(node.get('style_modified',[]))|set(patch['style']))
                node.update({k:deepcopy(v) for k,v in patch.items() if k!='style'})
                if any(k in patch for k in ('text','table','chart')):
                    node['content_changed']=any(node.get(field)!=node.get('base_'+field) for field in ('text','table','chart') if field in node)
            page['modified']=True
        document['revision']+=1
        document['applied_operations']=(document.get('applied_operations',[])+[operation_id])[-100:]
        write_document(material_id,document)
        return document

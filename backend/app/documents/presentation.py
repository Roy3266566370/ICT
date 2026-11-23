"""Project edited layout into viewing, evidence anchors, and frozen deliveries."""
from __future__ import annotations
from copy import deepcopy
import base64,re,math
from .store import read_document,document_root
from .layers import hydrate_document,layer_dir,manifest_ready,read_manifest

def current_document(material_id:str):
    document=read_document(material_id)
    return hydrate_document(material_id,document) if document else None

def apply_document_specs(material_id:str,specs:list[dict])->list[dict]:
    """Project recognised specs onto the current scene and merge node-level interactions.

    - geometry-only edits keep the interaction and move/scale its anchor;
    - edits to the evidence content pause the affected spec with a readable
      reason instead of silently dropping it;
    - content edited in the web document is re-derived locally (formula, chart,
      table, explicit page re-recognition) without rerunning the upload job;
    - user-configured interactions stored on nodes replace automatic ones and
      always use the node's current bounds.
    """
    # The scene document is created lazily by the free editor. Recognition must
    # not change just because that document does not exist yet.
    document=read_document(material_id) or {'pages':[]}
    from ..ispec.node_interaction import node_interaction_specs
    from .scene_recognition import build_node_scene_specs,build_scene_specs
    pages={p['page_no']:p for p in document['pages']}
    user_by_page=node_interaction_specs(document)
    def node_page(node):
        return next((page_no for page_no,page in pages.items() if node in page.get('nodes',[])),1)
    def owner(page_no,element):
        if not element:return None
        return next((n for n in pages.get(page_no,{}).get('nodes',[]) if n.get('source_element_id') and
          (element==n['source_element_id'] or element.startswith(n['source_element_id']+'_g'))),None)
    def content_changed(node):
        if not node:return False
        if node.get('content_changed'):return True
        for field in ('text','table','chart'):
            if field in node and node.get(field)!=node.get('base_'+field):return True
        return False
    def spec_pages(spec):
        found=set()
        anchor=spec.get('anchor') or {}
        if isinstance(anchor.get('page'),int):found.add(anchor['page'])
        for parameter in spec.get('parameters',[]):
            page_no=parameter.get('source',{}).get('page')
            if isinstance(page_no,int):found.add(page_no)
        return found
    def node_for_spec(spec):
        anchor=spec.get('anchor') or {}
        node=owner(anchor.get('page'),anchor.get('element_id'))
        if node:return node
        for parameter in spec.get('parameters',[]):
            source=parameter.get('source',{})
            node=owner(source.get('page'),source.get('element_id'))
            if node:return node
        return None
    def owned_by(spec,node):
        if not node:return False
        anchor=spec.get('anchor') or {}
        if anchor.get('element_id') and anchor.get('element_id')==node.get('source_element_id'):return True
        return any(parameter.get('source',{}).get('element_id')==node.get('source_element_id')
                   for parameter in spec.get('parameters',[]))
    def projected(source):
        node=owner(source.get('page'),source.get('element_id'))
        if not node:return source
        if node.get('deleted') or node.get('hidden'):return None
        old=source.get('bbox') or {}
        if source['element_id']==node['source_element_id']:
            moved=any(abs(node.get(key,0)-node.get('base_'+key,node.get(key,0)))>0.01
                      for key in ('x','y','width','height'))
            if not moved:
                # 未移动时保留规格里的锚点框：它可能是多张图组成的交互区域。
                return source
            base={'x':node.get('base_x',node['x'])*12700,'y':node.get('base_y',node['y'])*12700,
                  'w':max(1,node.get('base_width',node['width'])*12700),'h':max(1,node.get('base_height',node['height'])*12700)}
            custom=any(abs(old.get(key,0)-base[key])>max(1,base[key]*1e-6) for key in ('x','y','w','h'))
            if custom:
                # A custom (often multi-picture) region has no single picture's
                # base box; scale it together with the node so hotspots follow.
                sx=node['width']/(base['w']/12700);sy=node['height']/(base['h']/12700)
                x=node['x']+(old.get('x',0)/12700-base['x']/12700)*sx
                y=node['y']+(old.get('y',0)/12700-base['y']/12700)*sy
                w=old.get('w',0)/12700*sx;h=old.get('h',0)/12700*sy
            else:
                x,y,w,h=node['x'],node['y'],node['width'],node['height']
        else:
            sx=node['width']/node.get('base_width',node['width']);sy=node['height']/node.get('base_height',node['height'])
            x=node['x']+(old.get('x',0)/12700-node.get('base_x',node['x']))*sx
            y=node['y']+(old.get('y',0)/12700-node.get('base_y',node['y']))*sy
            w=old.get('w',0)/12700*sx;h=old.get('h',0)/12700*sy
        theta=math.radians(node['rotation']);cx=node['x']+node['width']/2;cy=node['y']+node['height']/2
        points=[(cx+(px-cx)*math.cos(theta)-(py-cy)*math.sin(theta),cy+(px-cx)*math.sin(theta)+(py-cy)*math.cos(theta))
          for px,py in ((x,y),(x+w,y),(x+w,y+h),(x,y+h))]
        left=min(p[0] for p in points);top=min(p[1] for p in points)
        return {**source,'bbox':{'x':left*12700,'y':top*12700,'w':(max(p[0] for p in points)-left)*12700,'h':(max(p[1] for p in points)-top)*12700}}
    result=[]
    for original in specs:
        spec=deepcopy(original);anchor=spec.get('anchor',{})
        updated_anchor=projected(anchor) if anchor else anchor
        if updated_anchor is None:continue
        if anchor:spec['anchor']=updated_anchor
        valid=True
        for param in spec.get('parameters',[]):
            source=projected(param.get('source',{}))
            if source is None:valid=False;break
            param['source']=source
        if not valid:continue
        node=node_for_spec(spec)
        if node:
            spec['node_id']=node['id']
            if not spec.get('anchor'):
                spec['anchor']={'page':node_page(node),'element_id':node.get('source_element_id') or node['id'],
                                'bbox':{'x':node['x']*12700,'y':node['y']*12700,
                                        'w':node['width']*12700,'h':node['height']*12700}}
            spec['anchor']['node_id']=node['id']
        result.append(spec)
    for page_no,page in pages.items():
        page_specs=[spec for spec in result if page_no in spec_pages(spec)]
        # Explicit page re-recognition replaces automatic specs with ones derived
        # from the current visible text and data.
        if page.get('reinteraction'):
            result=[spec for spec in result if page_no not in spec_pages(spec)]
            user_specs=user_by_page.get(page_no,[])
            user_node_ids={spec.get('node_id') for spec in user_specs}
            result.extend(spec for spec in build_scene_specs(page,material_id)
                          if spec.get('node_id') not in user_node_ids)
            result.extend(user_specs)
            continue
        changed_nodes=[node for node in page.get('nodes',[]) if not node.get('deleted') and not node.get('hidden') and content_changed(node)]
        if not changed_nodes and page_no not in user_by_page:continue
        user_specs=user_by_page.get(page_no,[])
        for node in changed_nodes:
            if any(spec.get('node_id')==node['id'] for spec in user_specs):
                continue
            derived=build_node_scene_specs(page,node,material_id)
            if derived:
                result=[spec for spec in result if not owned_by(spec,node)]
                result.extend(derived)
            else:
                for spec in result:
                    if owned_by(spec,node):
                        spec['availability']='needs_review'
                        spec['availability_reason']='来源内容已在自由编辑中修改；可重新提取当前内容，或撤销修改恢复原交互。'
        if user_specs:
            user_node_ids={spec.get('node_id') for spec in user_specs}
            result=[spec for spec in result if spec.get('node_id') not in user_node_ids]
            result.extend(user_specs)
    try:
        from ..ispec.advanced_scenes import apply_advanced_scenes
        from ..ispec.scene_definitions import ensure_scene_definition
        result=apply_advanced_scenes(material_id,result)
        for spec in result:
            ensure_scene_definition(spec)
    except (ValueError, TypeError, OSError):
        pass
    try:
        from ..ispec.persistence import load_values
        saved=load_values(material_id)
        def compatible(default,value):
            if isinstance(default,bool) or isinstance(value,bool):return type(default) is type(value)
            if isinstance(default,(int,float)) and isinstance(value,(int,float)):
                return math.isfinite(value)
            return type(default) is type(value)
        for spec in result:
            values=saved.get(spec.get('object_id'),{}).get('values',{})
            for parameter in spec.get('parameters',[]):
                value=values.get(parameter.get('id'))
                if value is not None and compatible(parameter.get('default'),value):
                    parameter.setdefault('source_default',parameter['default'])
                    parameter['default']=value
    except (ValueError,OSError):
        pass
    try:
        from ..api.routes_jobs import read_ispec_payload
        from ..ispec.figure_scene import attach_figure_scenes
        scenes=(read_ispec_payload(material_id) or {}).get('figure_scenes') or {}
        attach_figure_scenes(result,scenes,projected)
    except Exception:  # noqa: BLE001 - 读图场景挂载失败不得影响其他识别结果
        pass
    try:
        from ..api.routes_jobs import read_ispec_payload
        from ..trust import build_trust_report, page_texts_from_payload
        page_texts=page_texts_from_payload(read_ispec_payload(material_id) or {})
        for spec in result:
            spec['trust']=build_trust_report(spec,page_texts)
    except Exception:  # noqa: BLE001 - 可信报告失败不得阻断阅读
        pass
    def _is_meaningful_experiment(spec: dict) -> bool:
        scene_type = str((spec.get('scene') or {}).get('scene_type') or '')
        if scene_type == 'relation_types':
            return False
        notes = str(spec.get('notes') or '')
        views = [v for v in (spec.get('views') or []) if isinstance(v, dict)]
        has_visual = any(v.get('type') in ('figure', 'vega', 'table') for v in views)
        has_expr = bool(spec.get('expressions'))
        if not has_visual and not has_expr and ('omml_formula' in notes or '不执行公式求值' in notes):
            return False
        return True

    result = [spec for spec in result if _is_meaningful_experiment(spec)]
    return result

def freeze_document(material_id:str)->dict|None:
    from .figure_service import asset_path
    from ..render import PAGE_IMAGE_PATTERN, pages_dir

    document=read_document(material_id)
    if not document or not any(p.get('modified') for p in document['pages']):return None
    for page in document['pages']:
        if not page.get('modified'):continue
        # Publishing must stay a short request: object preparation is an
        # explicit, pollable step handled before publish/download.
        if not page.get('rendered_only') and not manifest_ready(read_manifest(material_id,document['source_key'],page['page_no'])):
            raise ValueError(f'第{page["page_no"]}页对象仍在准备，请等待准备完成后再发布')
    document=hydrate_document(material_id,document)
    cache={};total=0
    def embed(target):
        nonlocal total
        if target in cache:return cache[target]
        remaining=64*1024*1024-total
        if target.stat().st_size>remaining:raise ValueError('编辑页的资源超过64MB，暂无法打包')
        blob=target.read_bytes();total+=len(blob)
        if total>64*1024*1024:raise ValueError('编辑页的资源超过64MB，暂无法打包')
        value='data:image/png;base64,'+base64.b64encode(blob).decode('ascii');cache[target]=value;return value

    def embed_layer(url,page):
        if not url:return None
        filename=url.rsplit('/',1)[-1]
        if not re.fullmatch(r'(background|n_\d+(_empty)?)\.png',filename):raise ValueError('页面资源名称不合法')
        target=layer_dir(material_id,document['source_key'],page['page_no'])/filename
        return embed(target)

    pages=[]
    for page in document['pages']:
        if not page.get('modified'):continue
        if page.get('preparation',{}).get('status')!='ready':raise ValueError(f'第{page["page_no"]}页尚未完成对象准备，暂不能发布')
        page['background_url']=embed_layer(page.get('background_url'),page)
        page['nodes']=[n for n in page['nodes'] if not n.get('hidden') and not n.get('deleted')]
        for node in page['nodes']:
            text_changed=node.get('text')!=node.get('base_text')
            if text_changed:
                node['base_text']=None;node['paragraphs']=[]
            # Don't deliver the raster containing superseded text or data.
            raster_changed=(node['type']=='text' and (text_changed or node['style']!=node['base_style'] or
              node.get('base_width',node['width'])!=node['width'] or node.get('base_height',node['height'])!=node['height'])) or \
              (node['type']=='table' and node.get('table')!=node.get('base_table')) or \
              (node['type']=='chart' and node.get('chart')!=node.get('base_chart'))
            cleaned = asset_path(material_id,page['page_no'],node.get('cleaned_asset_id')) if node['type']=='image' else None
            if cleaned is not None:
                # Delivery uses the substitute as the ordinary image so existing players
                # render it beneath the editable vectors without drawing the source ink.
                node['image_url']=embed(cleaned)
                node.pop('image_data',None)
            elif raster_changed:
                node['image_url']=None
            elif page.get('rendered_only') and node.get('render_file'):
                filename=node['render_file']
                match=PAGE_IMAGE_PATTERN.fullmatch(filename) if isinstance(filename,str) else None
                if not match or match.group('erased') or int(match.group('page_no'))!=page['page_no']:
                    raise ValueError('页面原图标识无效')
                node['image_url']=embed(pages_dir(material_id)/filename)
            else:
                node['image_url']=embed_layer(node.get('image_url'),page)
            node['background_url']=embed_layer(node.get('background_url'),page)
            for kind in ('table','chart'):
                if node.get(kind)!=node.get('base_'+kind):node.pop('base_'+kind,None)
        pages.append(page)
    return public_document({'schema_version':'1.0','revision':document['revision'],'title':document['title'],'pages':pages})


def public_document(raw)->dict|None:
    """A second whitelist at the delivery boundary, including nested scene fields."""
    if not isinstance(raw,dict):return None
    style_keys={'font_size','font_family','color','bold','italic','underline','letter_spacing','align','vertical_align','line_height',
      'padding_left','padding_right','padding_top','padding_bottom','fill','stroke','stroke_width','line_style','arrow_start','arrow_end','anim_step','bind_mode'}
    node_keys={'id','type','x','y','width','height','rotation','z','opacity','text','base_text','base_width','base_height','shape','whole_group','word_wrap'}
    def style(value):return {k:v for k,v in value.items() if k in style_keys and type(v) in (str,float,int,bool)} if isinstance(value,dict) else {}
    def image(value):return value if isinstance(value,str) and re.fullmatch(r'data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+',value) else None
    def chart(value):
        if not isinstance(value,dict):return None
        return {'categories':[v for v in value.get('categories',[]) if isinstance(v,str)],
          'series':[{'name':str(s.get('name','')),'values':[v for v in s.get('values',[]) if type(v) in (int,float)]}
            for s in value.get('series',[]) if isinstance(s,dict)],
          **{k:v for k,v in value.items() if k in ('title','chart_type') and isinstance(v,str)}}
    pages=[]
    for page in raw.get('pages',[]):
        if not isinstance(page,dict):continue
        nodes=[]
        for source in page.get('nodes',[]):
            if not isinstance(source,dict) or source.get('hidden') or source.get('deleted'):continue
            node={k:deepcopy(v) for k,v in source.items() if k in node_keys and (v is None or type(v) in (str,int,float,bool))}
            node.update(name=source.get('type','对象'),style=style(source.get('style')),base_style=style(source.get('base_style')),
              locked=False,hidden=False,deleted=False)
            transform=source.get('text_transform')
            if (source.get('type')=='text' and isinstance(transform,list) and len(transform)==4
                and all(type(value) in (int,float) and -1e6<=value<=1e6 for value in transform)
                and abs(transform[0]*transform[3]-transform[1]*transform[2])>1e-9):
                node['text_transform']=list(transform)
            provenance=source.get('figure_provenance')
            if provenance in ('native','pixel','vision','user_confirmed'):
                node['figure_provenance']=provenance
            for fig_key in ('figure_source_id','figure_object_id'):
                fig_val=source.get(fig_key)
                if isinstance(fig_val,str) and re.fullmatch(r'[A-Za-z0-9_-]{1,96}',fig_val):
                    node[fig_key]=fig_val
            basis = source.get('basis')
            if source.get('type') == 'vector' and isinstance(basis, dict):
                ids = ('firstId', 'secondId', 'resultId')
                title, size = basis.get('title'), basis.get('fontSize')
                if (all(isinstance(basis.get(k), str) and len(basis[k]) <= 100 for k in ids)
                    and isinstance(title, list) and len(title) == 2
                    and all(type(value) in (int, float) and math.isfinite(value) for value in title)
                    and type(size) in (int, float) and 0 < size <= 200):
                    node['basis'] = {**{key: basis[key] for key in ids}, 'title': title, 'fontSize': size}
            for key in ('image_url','background_url','image_data'):
                if image(source.get(key)):node[key]=source[key]
            for key in ('image_scale','background_scale'):
                if type(source.get(key)) in (int,float) and 0<source[key]<=100:
                    node[key]=float(source[key])
            for key in ('image_frame','image_size','background_frame','background_size'):
                value=source.get(key)
                if isinstance(value,list) and len(value)==2 and all(type(v) in (int,float) and math.isfinite(v) for v in value):
                    node[key]=[float(v) for v in value]
            if isinstance(source.get('crop'),dict):node['crop']={k:v for k,v in source['crop'].items() if k in ('left','right','top','bottom') and type(v) in (int,float)}
            if isinstance(source.get('interaction'),dict):
                from ..ispec.node_interaction import validate_node_interaction
                config=deepcopy(source['interaction'])
                try:validate_node_interaction(config)
                except (ValueError,TypeError):pass
                else:node['interaction']=config
            if type(source.get('viewer_editable')) is bool:
                node['viewer_editable']=source['viewer_editable']
            vp=source.get('viewer_parameters')
            from .relations import VIEWER_PARAMETERS,validate_page_relations
            if (isinstance(vp,list) and len(vp)<=len(VIEWER_PARAMETERS)
                    and all(k in VIEWER_PARAMETERS for k in vp) and len(set(vp))==len(vp)):
                node['viewer_parameters']=list(vp)
            fl=source.get('flow')
            if (isinstance(fl,dict) and set(fl)=={'enabled','speed'} and type(fl['enabled']) is bool
                    and type(fl['speed']) in (int,float) and math.isfinite(fl['speed']) and .1<=fl['speed']<=10):
                node['flow']={'enabled':fl['enabled'],'speed':float(fl['speed'])}
            if isinstance(source.get('math_scene'),dict):
                from .math_scene import validate_math_scene
                ms=deepcopy(source['math_scene'])
                try:validate_math_scene(ms)
                except (ValueError,TypeError):pass
                else:node['math_scene']=ms
            if isinstance(source.get('matrix_ocr'),dict):
                from .math_scene import validate_matrix_ocr
                mo=deepcopy(source['matrix_ocr'])
                try:validate_matrix_ocr(mo)
                except (ValueError,TypeError):pass
                else:node['matrix_ocr']=mo
            if isinstance(source.get('diagram'),dict):
                from .inline_systems import validate_scene_diagram
                try:node['diagram']=validate_scene_diagram(deepcopy(source['diagram']))
                except (ValueError,TypeError):pass
            if isinstance(source.get('demo'),dict):
                from .inline_systems import validate_scene_demo
                try:node['demo']=validate_scene_demo(deepcopy(source['demo']))
                except (ValueError,TypeError):pass
            for key in ('chart','base_chart'):
                if isinstance(source.get(key),dict):node[key]=chart(source[key])
            for key in ('table','base_table'):
                if isinstance(source.get(key),list):node[key]=[[v for v in row if isinstance(v,str)] for row in source[key] if isinstance(row,list)]
            node['paragraphs']=[{'text':str(p.get('text','')),'align':p.get('align','left'),
              **{key:float(p[key]) for key in ('line_height','line_spacing_pt','space_before','space_after')
                 if type(p.get(key)) in (int,float)},
              'runs':[{'text':str(r.get('text','')),'style':style(r.get('style'))} for r in p.get('runs',[]) if isinstance(r,dict)]}
              for p in source.get('paragraphs',[]) if isinstance(p,dict)]
            nodes.append(node)
        page_relations=[]
        if isinstance(page.get('relations'),list) and page['relations']:
            from .relations import validate_page_relations
            try:
                page_relations=validate_page_relations(page['relations'],nodes)
            except (ValueError,TypeError):
                page_relations=[]
        pages.append({k:deepcopy(page[k]) for k in ('page_no','width','height') if k in page}|
          {'modified':True,'nodes':nodes,'background_url':image(page.get('background_url')),
           **({'relations':page_relations} if page_relations else {}),
           'preparation':{'status':'ready','frozen_ids':[v for v in page.get('preparation',{}).get('frozen_ids',[]) if isinstance(v,str)]}})
    return {'schema_version':'1.0','revision':raw.get('revision',0),'title':str(raw.get('title','')),'pages':pages}

"""Fast webpage editing: content/layout patches never enqueue PPT or OCR jobs."""
from __future__ import annotations
import json,re,time
from fastapi import APIRouter,BackgroundTasks,Request
from fastapi.responses import FileResponse
from pydantic import BaseModel,ConfigDict,Field
from . import API_PREFIX,DBDep,SessionDep,WriteDep,ok,owned_material
from ..documents.store import DocumentConflict,patch_document,read_document,reinteract_page
from ..documents.layers import ensure_document,hydrate_document,layer_dir,manifest_ready,prepare_page,read_manifest
from ..documents.capabilities import layer_editor_available
from ..schemas.errors import missing_field,resource_unavailable,version_conflict

router=APIRouter(prefix=API_PREFIX,tags=['documents'])

class DocumentPatch(BaseModel):
    model_config=ConfigDict(extra='forbid')
    expected_revision:int=Field(ge=0)
    operation_id:str=Field(min_length=1,max_length=100)
    changes:list[dict]=Field(max_length=1000)

class ReinteractRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    expected_revision:int=Field(ge=0)

class DiagramRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    text:str=Field(default='',max_length=6000)
    ai:bool=False

@router.post('/materials/{material_id}/document/pages/{page_no}/diagram')
def create_inline_diagram(material_id:str,page_no:int,payload:DiagramRequest,request:Request,ctx:WriteDep,db:DBDep):
    from ..documents.inline_systems import diagram_from_text
    from ..documents.diagram_generation import generate_inline_diagram
    from ..ppt_ai.page_lab import collect_page_context,PageLabError
    from ..ppt_ai.client import PPTAIClient,PPTAIError
    from ..schemas.errors import model_unavailable
    material=owned_material(db,ctx,material_id)
    document=ensure_document(material_id,material.title)
    if not any(page['page_no']==page_no for page in document['pages']):raise missing_field('页面不存在')
    try:
        if payload.ai:
            context=collect_page_context(db,material_id,page_no,material.title)
            diagram=generate_inline_diagram(context,client=PPTAIClient(),instruction=payload.text)
        else:
            diagram=diagram_from_text(payload.text)
    except PPTAIError as error:raise model_unavailable(str(error)) from error
    except (ValueError,PageLabError) as error:raise missing_field(str(error),field='text') from error
    return ok(request,{'diagram':diagram})

@router.get('/materials/{material_id}/document')
def get_document(material_id:str,request:Request,ctx:SessionDep,db:DBDep):
    material=owned_material(db,ctx,material_id)
    if material.status=='processing':raise missing_field('材料正在处理，请原页就绪后再打开自由编辑')
    try:document=ensure_document(material_id,material.title)
    except (ValueError,OSError) as error:raise missing_field(str(error)) from error
    return ok(request,document)

@router.patch('/materials/{material_id}/document')
def update_document(material_id:str,payload:DocumentPatch,request:Request,ctx:WriteDep,db:DBDep):
    owned_material(db,ctx,material_id)
    if len(json.dumps(payload.model_dump(),ensure_ascii=False))>8_000_000:raise missing_field('本次修改过大，请分批添加图片')
    try:document=patch_document(material_id,payload.expected_revision,payload.operation_id,payload.changes)
    except DocumentConflict as error:
        current=read_document(material_id) or {}
        raise version_conflict(str(error),current_revision=current.get('revision')) from error
    except (ValueError,TypeError,KeyError) as error:raise missing_field(str(error)) from error
    return ok(request,{'revision':document['revision'],'operation_id':payload.operation_id})

@router.post('/materials/{material_id}/document/pages/{page_no}/prepare',status_code=202)
def prepare_document_page(material_id:str,page_no:int,request:Request,ctx:WriteDep,db:DBDep,background_tasks:BackgroundTasks):
    material=owned_material(db,ctx,material_id)
    document=ensure_document(material_id,material.title)
    if page_no not in [p['page_no'] for p in document['pages']]:raise missing_field('页面不存在')
    manifest=read_manifest(material_id,document['source_key'],page_no)
    if manifest_ready(manifest):
        status='ready'
    elif manifest.get('status') in ('queued','preparing'):
        status=manifest['status']
    else:
        # Includes ready manifests produced by an older exporter: they must be
        # regenerated rather than served with stale geometry.
        status='unprepared'
    if status not in ('ready','queued','preparing') or (status in ('queued','preparing') and time.time()-manifest.get('started_at',0)>130):
        target=layer_dir(material_id,document['source_key'],page_no);target.mkdir(parents=True,exist_ok=True)
        (target/'manifest.json').write_text(json.dumps({'status':'queued','started_at':time.time()}),encoding='utf-8')
        background_tasks.add_task(prepare_page,material_id,page_no)
        status='queued'
    return ok(request,{'status':status},status_code=202)

@router.post('/materials/{material_id}/document/pages/{page_no}/reinteract')
def reinteract_document_page(material_id:str,page_no:int,payload:ReinteractRequest,request:Request,ctx:WriteDep,db:DBDep):
    """Re-recognise one page from the current free-edited content only."""
    material=owned_material(db,ctx,material_id)
    ensure_document(material_id,material.title)
    try:
        result=reinteract_page(material_id,payload.expected_revision,page_no)
    except DocumentConflict as error:
        current=read_document(material_id) or {}
        raise version_conflict(str(error),current_revision=current.get('revision')) from error
    except (ValueError,TypeError,KeyError) as error:raise missing_field(str(error)) from error
    return ok(request,result)

@router.get('/materials/{material_id}/document/capabilities')
def document_capabilities(material_id:str,request:Request,ctx:SessionDep,db:DBDep):
    owned_material(db,ctx,material_id)
    available,reason,engine=layer_editor_available()
    return ok(request,{'free_editing':available,'engine':engine,'reason':reason})

@router.get('/materials/{material_id}/document/assets/{key}/{page_no}/{filename}')
def document_asset(material_id:str,key:str,page_no:int,filename:str,ctx:SessionDep,db:DBDep):
    owned_material(db,ctx,material_id)
    document=read_document(material_id)
    if not document or key!=document['source_key'] or not re.fullmatch(r'(background|n_\d+(_empty)?)\.png',filename):raise resource_unavailable()
    manifest=read_manifest(material_id,key,page_no)
    allowed={'background.png'}
    for entry in manifest.get('objects',{}).values():allowed.update([entry.get('asset'),entry.get('empty')])
    target=layer_dir(material_id,key,page_no)/filename
    if filename not in allowed or not target.is_file():raise resource_unavailable()
    return FileResponse(target,media_type='image/png',headers={'Cache-Control':'private, max-age=31536000, immutable'})

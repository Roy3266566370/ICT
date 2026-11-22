from __future__ import annotations
from copy import deepcopy
from pathlib import Path
import json,os,re,shutil,subprocess,sys,threading,time
from .store import LOCK,document_root,read_document,write_document
from .importer import import_document
from .layer_export import EXPORTER_VERSION
from ..editing import working_path

_RENDER_LOCKS:dict[str,threading.Lock]={}
_RENDER_LOCKS_GUARD=threading.Lock()
# PowerPoint may share its automation process even with DispatchEx. A second
# export closing that process invalidates the first page's shape proxies.
_COM_SLOTS=threading.BoundedSemaphore(1)


def _render_lock(material_id:str,page_no:int)->threading.Lock:
    key=f'{material_id}:{page_no}'
    with _RENDER_LOCKS_GUARD:
        return _RENDER_LOCKS.setdefault(key,threading.Lock())

def ensure_document(material_id:str,title:str)->dict:
    with LOCK:
        document=read_document(material_id)
        if document is None:
            source=working_path(material_id)
            if not source.exists():raise ValueError('这份材料没有可编辑的PPT原件，请上传PPT后使用自由编辑')
            root=document_root(material_id);root.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(source,root/'source.pptx')
            document=import_document(root/'source.pptx',title)
            write_document(material_id,document)
        return hydrate_document(material_id,document)

def layer_dir(material_id:str,key:str,page_no:int)->Path:
    # key 参与目录拼接（来源含导入工程包的 source_key），必须拒绝路径分隔符与 ..。
    if not isinstance(key,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,96}',key):
        raise ValueError('图层缓存标识不合法')
    return document_root(material_id)/'layers'/key/f'p{page_no:02d}'

def read_manifest(material_id:str,key:str,page_no:int)->dict:
    path=layer_dir(material_id,key,page_no)/'manifest.json'
    if not path.exists():return {'status':'unprepared'}
    try:return json.loads(path.read_text(encoding='utf-8'))
    except (ValueError,OSError):return {'status':'unprepared'}

#: Version 2 introduced measured bitmap geometry; later versions refined probe
#: placement and chart/table handling without changing the scene contract.
MIN_COMPATIBLE_EXPORTER_VERSION = 2

def manifest_ready(manifest:dict)->bool:
    """A cached page is usable when its geometry contract is compatible.

    Older manifests with frozen objects are re-exported because their failures
    predate the direct-export fallback. Current manifests may keep frozen
    objects: the background still renders them and the remaining objects stay
    editable, which is preferable to blocking the whole page.
    """
    version=manifest.get('exporter_version')
    if (manifest.get('status')!='ready' or not isinstance(version,int)
            or version<MIN_COMPATIBLE_EXPORTER_VERSION):
        return False
    return not manifest.get('frozen_ids') or version>=EXPORTER_VERSION

def hydrate_document(material_id:str,document:dict)->dict:
    result=deepcopy(document);result.pop('applied_operations',None)
    for page in result['pages']:
        manifest=read_manifest(material_id,result['source_key'],page['page_no'])
        prefix=f'/api/v1/materials/{material_id}/document/assets/{result["source_key"]}/{page["page_no"]}/'
        page['preparation']={k:v for k,v in manifest.items() if k in ('status','message','errors','seconds','frozen_ids','exporter_version')}
        if not manifest_ready(manifest):
            # A cached page produced by an older exporter would still carry the
            # stretched raster geometry; hide it until the page is prepared again.
            if manifest.get('status')=='ready':page['preparation']={**page['preparation'],'status':'unprepared'}
            continue
        page['background_url']=prefix+manifest['background']
        for node in page['nodes']:
            entry=manifest.get('objects',{}).get(node.get('asset_id'))
            if not entry:continue
            node['image_url']=prefix+entry['asset']
            node['background_url']=prefix+entry['empty'] if entry.get('empty') else None
            for source,key in (('asset','image'),('empty','background')):
                if entry.get(source):
                    node[f'{key}_frame']=entry.get(f'{source}_frame')
                    node[f'{key}_scale']=entry.get(f'{source}_scale')
                    node[f'{key}_size']=entry.get(f'{source}_size')
                else:
                    node.pop(f'{key}_frame',None);node.pop(f'{key}_scale',None);node.pop(f'{key}_size',None)
            if 'word_wrap' in entry:node['word_wrap']=entry['word_wrap']
            font=entry.get('font',{})
            for key,value in font.items():
                node['base_style'][key]=value
                if key not in node.get('style_modified',[]):node['style'][key]=value
    return result

def _prepare_remote(source:Path,page_no:int,target:Path)->None:
    """Delegate object separation to a standalone Windows service."""
    import io,zipfile
    import httpx
    from .capabilities import remote_service
    token=os.environ.get('LAYER_EXPORT_SERVICE_TOKEN','')
    headers={'Authorization':f'Bearer {token}'} if token else {}
    url=f'{remote_service()}/export'
    with source.open('rb') as handle:
        response=httpx.post(url,files={'file':(source.name,handle,'application/vnd.openxmlformats-officedocument.presentationml.presentation')},
                            data={'page':str(page_no)},headers=headers,timeout=180.0)
    response.raise_for_status()
    if len(response.content)>128*1024*1024:raise ValueError('转换服务返回的文件过大')
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names=archive.namelist()
        if 'manifest.json' not in names:raise ValueError('转换服务返回包缺少 manifest.json')
        allowed=[name for name in names if re.fullmatch(r'(manifest\.json|background\.png|n_\d+(_empty)?\.png)',name)]
        if len(allowed)!=len(names):raise ValueError('转换服务返回包含不安全的文件名')
        for name in allowed:
            if name=='manifest.json':continue
            (target/name).write_bytes(archive.read(name))
        (target/'manifest.json').write_bytes(archive.read('manifest.json'))
    result=json.loads((target/'manifest.json').read_text(encoding='utf-8'))
    if result.get('status')!='ready':
        raise ValueError(result.get('message') or '转换服务未产出可用的页面对象')
    return

def prepare_page(material_id:str,page_no:int)->None:
    document=read_document(material_id)
    if not document:return
    target=layer_dir(material_id,document['source_key'],page_no)
    with _render_lock(material_id,page_no):
        if manifest_ready(read_manifest(material_id,document['source_key'],page_no)):return
        target.mkdir(parents=True,exist_ok=True)
        from .capabilities import layer_editor_available,remote_service
        available,reason,_engine=layer_editor_available()
        if not available:
            (target/'manifest.json').write_text(json.dumps(
              {'status':'failed','message':reason or '本机没有可用的对象分离引擎','errors':[]},ensure_ascii=False),encoding='utf-8')
            return
        (target/'manifest.json').write_text(json.dumps({'status':'preparing','started_at':time.time()}),encoding='utf-8')
        if remote_service():
            try:
                _prepare_remote(document_root(material_id)/'source.pptx',page_no,target)
                return
            except Exception as error:
                (target/'manifest.json').write_text(json.dumps(
                  {'status':'failed','message':f'Windows 转换服务调用失败：{error}'},ensure_ascii=False),encoding='utf-8')
                return
        backend=Path(__file__).resolve().parents[2]
        environment=dict(os.environ);environment['PYTHONPATH']=str(backend)
        from ..settings import get_settings
        timeout_s=float(get_settings().render_timeout_s)
        # Give the child watchdog a chance to Quit PowerPoint before the parent
        # force-kills the Python process tree.
        child_timeout=max(5.0,timeout_s-10.0)
        command=[sys.executable,'-m','app.documents.layer_export','--source',str(document_root(material_id)/'source.pptx'),
          '--out',str(target),'--page',str(page_no),'--timeout',str(child_timeout)]
        with _COM_SLOTS:
            try:
                process=subprocess.Popen(command,cwd=backend,env=environment,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            except Exception as error:
                (target/'manifest.json').write_text(json.dumps(
                  {'status':'failed','message':f'对象分离进程启动失败：{error}'},ensure_ascii=False),encoding='utf-8')
                return
            try:
                _,err=process.communicate(timeout=timeout_s)
                if process.returncode and read_manifest(material_id,document['source_key'],page_no).get('status')=='preparing':
                    detail=err.decode('utf-8','replace').strip()[-300:]
                    raise RuntimeError(detail or f'对象分离超时或异常退出（code={process.returncode}）')
            except Exception as error:
                from ..render.engine_com import _terminate_process_tree
                _terminate_process_tree(process)
                (target/'manifest.json').write_text(json.dumps({'status':'failed','message':f'页面准备未完成：{error}'},ensure_ascii=False),encoding='utf-8')

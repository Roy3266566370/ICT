from __future__ import annotations
from copy import deepcopy
from hashlib import sha256
import logging
from pathlib import Path
import json,os,re,shutil,subprocess,sys,threading,time
from zipfile import BadZipFile
from pptx.exc import PackageNotFoundError
from .store import LOCK,document_root,read_document,write_document
from .importer import NATIVE_IMPORT_VERSION,import_document
from .capabilities import layer_editor_available
from .layer_export import EXPORTER_VERSION
from ..editing import working_path

_RENDER_LOCKS:dict[str,threading.Lock]={}
_RENDER_LOCKS_GUARD=threading.Lock()
# PowerPoint may share its automation process even with DispatchEx. A second
# export closing that process invalidates the first page's shape proxies.
_COM_SLOTS=threading.BoundedSemaphore(1)
logger=logging.getLogger(__name__)


def _render_lock(material_id:str,page_no:int)->threading.Lock:
    key=f'{material_id}:{page_no}'
    with _RENDER_LOCKS_GUARD:
        return _RENDER_LOCKS.setdefault(key,threading.Lock())

def ensure_document(material_id:str,title:str)->dict:
    with LOCK:
        document=read_document(material_id)
        root=document_root(material_id)
        source=root/'source.pptx'
        original=working_path(material_id)
        if (document is None or (document.get('native_import_version') or 0)<NATIVE_IMPORT_VERSION
                or (original.is_file() and not source.is_file())):
            if not source.is_file() and original.is_file():
                root.mkdir(parents=True,exist_ok=True)
                shutil.copyfile(original,source)
            if source.is_file():
                try:
                    key=sha256(source.read_bytes()).hexdigest()[:24]
                    imported=import_document(source,title,asset_root=root/'native'/key)
                    if document is None or (document.get('revision')==0
                            and not any(page.get('modified') for page in document['pages'])
                            and all(page.get('rendered_only') for page in document['pages'])):
                        document=imported
                    elif key==document['source_key']:
                        _upgrade_document(document,imported)
                except (ValueError,OSError,KeyError,AttributeError,BadZipFile,PackageNotFoundError,SyntaxError) as error:
                    logger.warning('Could not import editable PPTX %s: %s',material_id,type(error).__name__)
                    if document is None and not has_rendered_pages(material_id):
                        raise ValueError('这份材料的 PPTX 结构无法读取') from error
            if document is None:
                document=rendered_document(material_id,title)
            document['native_import_version']=NATIVE_IMPORT_VERSION
            write_document(material_id,document)
        return hydrate_document(material_id,document)


def _upgrade_document(document, imported):
    source_pages={page['page_no']:page for page in imported['pages']}
    for page in [*document['pages'],*document.get('archived_pages',[])]:
        source=source_pages.get(page.get('source_page_no',page['page_no']))
        if source is None or page.get('rendered_only'):
            continue
        for key in ('notes','background_color','native_ready','native_fallback'):
            if key in source:
                page.setdefault(key,source[key])
        source_nodes={node['source_shape_id']:node for node in source['nodes']}
        for node in page['nodes']:
            original=source_nodes.get(node.get('source_shape_id'))
            if not original or node.get('figure_provenance') or (node['type']!=original['type'] and page.get('modified')):
                continue
            if node['type']!=original['type']:
                node.update({k:original[k] for k in ('type','x','y','height','width','rotation',
                    'base_x','base_y','base_width','base_height','base_rotation','locked')})
            for key in ('native_file','native_fallback','crop','base_crop','shape_paths','base_opacity'):
                if key in original:
                    node.setdefault(key,original[key])
            if not page.get('modified') or node.get('shape') in (None,'rect'):
                node['shape']=original['shape']
            if not page.get('modified'):
                node['opacity']=original['opacity']
            style_changes={key:value for key,value in node['style'].items()
                           if key in node.get('style_modified',[]) or node['base_style'].get(key)!=value}
            node['style']={**original['style'],**style_changes}
            node['base_style']=dict(original['base_style'])
            if 'text_rotation_offset' in original:
                node['text_rotation_offset']=original['text_rotation_offset']
            if 'paragraphs' in original and not node.get('rich_text_edited') and node.get('text')==node.get('base_text'):
                node['paragraphs']=original['paragraphs']


def source_page_number(page):
    return page.get('source_page_no',page['page_no'])


def native_asset_path(material_id, key, page_no, filename):
    if (re.fullmatch(r'[A-Za-z0-9_-]{1,96}',key) and type(page_no) is int and 0<page_no<=10000
            and isinstance(filename,str) and re.fullmatch(r'n_\d+\.png',filename)):
        path=document_root(material_id)/'native'/key/f'p{page_no:02d}'/filename
        if path.is_file():
            return path
    return None


def has_rendered_pages(material_id:str)->bool:
    from ..render import PAGE_IMAGE_PATTERN, existing_page_images

    return any((match:=PAGE_IMAGE_PATTERN.fullmatch(image.name)) and not match.group('erased')
               for image in existing_page_images(material_id))


def rendered_document(material_id:str,title:str)->dict:
    from hashlib import sha256
    from PIL import Image
    from ..render import PAGE_IMAGE_PATTERN, existing_page_images, pages_dir, read_render_manifest

    manifest=read_render_manifest(material_id) or {}
    paths={}
    for image in existing_page_images(material_id):
        match=PAGE_IMAGE_PATTERN.fullmatch(image.name)
        if match and not match.group('erased'):
            paths.setdefault(int(match.group('page_no')),image)
    for entry in manifest.get('pages',[]):
        if isinstance(entry,dict) and isinstance(entry.get('file'),str):
            match=PAGE_IMAGE_PATTERN.fullmatch(entry['file'])
            if match and not match.group('erased'):
                path=pages_dir(material_id)/entry['file']
                if path.is_file():
                    paths[int(match.group('page_no'))]=path
    if not paths:
        raise ValueError('这份材料没有可编辑原件或已渲染页图')
    pages=[]
    for number,path in sorted(paths.items()):
        with Image.open(path) as image:
            width,height=image.size
        if not (0<width<=20000 and 0<height<=20000):
            raise ValueError('页面图像尺寸超出编辑范围')
        style={}
        node={'id':f'render_p{number:02d}','type':'image','name':'页面原图','x':0,'y':0,'width':width,
              'height':height,'z':0,'rotation':0,'opacity':1,'locked':False,'hidden':False,'deleted':False,
              'style':style,'base_style':{},'text':'','base_text':'','asset_id':None,
              'source_element_id':None,'render_file':path.name}
        pages.append({'page_no':number,'id':f'p_{number}','width':width,'height':height,'nodes':[node],
                      'modified':False,'rendered_only':True})
    signature=sha256(','.join(path.name for path in paths.values()).encode()).hexdigest()[:24]
    return {'schema_version':'1.0','revision':0,'title':title,'source_key':signature,
            'pages':pages,'applied_operations':[]}

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
    from .figure_service import asset_path, asset_url

    result=deepcopy(document);result.pop('applied_operations',None);result.pop('archived_pages',None)
    for page in result['pages']:
        asset_page=source_page_number(page)
        if page.get('background_modified'):
            page.pop('background_url',None)
        for node in page['nodes']:
            identifier=node.get('cleaned_asset_id')
            cleaned_page=node.get('cleaned_asset_page_no',page['page_no'])
            if identifier and asset_path(material_id,cleaned_page,identifier):
                node['cleaned_url']=asset_url(material_id,cleaned_page,identifier,'cleaned')
            if native_asset_path(material_id,result['source_key'],asset_page,node.get('native_file')):
                node['image_url']=f'/api/v1/materials/{material_id}/document/native-assets/{result["source_key"]}/{asset_page}/{node["native_file"]}'
        if page.get('rendered_only') or asset_page is None:
            page['preparation']={'status':'ready'}
            for node in page['nodes']:
                if node.get('render_file'):
                    node['image_url']=f'/api/v1/materials/{material_id}/renders/{node["render_file"]}'
            continue
        manifest=read_manifest(material_id,result['source_key'],asset_page)
        prefix=f'/api/v1/materials/{material_id}/document/assets/{result["source_key"]}/{asset_page}/'
        page['preparation']={k:v for k,v in manifest.items() if k in ('status','message','errors','seconds','frozen_ids','exporter_version')}
        if not manifest_ready(manifest):
            if page.get('native_ready'):
                fallback_status=manifest.get('status','unprepared')
                if page.get('native_fallback') and not layer_editor_available()[0]:
                    fallback_status='unavailable'
                page['preparation']={'status':'ready','fallback_status':fallback_status}
                continue
            # A cached page produced by an older exporter would still carry the
            # stretched raster geometry; hide it until the page is prepared again.
            if manifest.get('status')=='ready':page['preparation']={**page['preparation'],'status':'unprepared'}
            continue
        if not page.get('background_modified'):
            page['background_url']=prefix+manifest['background']
        if page.get('native_ready'):
            page['preparation']['fallback_status']='ready'
        for node in page['nodes']:
            entry=manifest.get('objects',{}).get(node.get('asset_id'))
            if not entry:continue
            if ((node.get('native_file') and node.get('image_url'))
                    or node.get('text_rotation_offset')
                    or (node.get('base_opacity',1)!=1 and not node.get('native_fallback'))):
                continue
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
    page=next((item for item in document['pages'] if item['page_no']==page_no),None)
    if page is None or source_page_number(page) is None or page.get('rendered_only'):
        return
    page_no=source_page_number(page)
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

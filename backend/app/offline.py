"""Package the production presentation runtime with its complete frozen content."""
from __future__ import annotations

import base64
import hashlib
import html
import json
from pathlib import Path
from collections.abc import Mapping
from typing import Any, Callable

ASSETS=Path(__file__).parent/'static'/'offline'
MAX_PAGE_BYTES=64*1024*1024


def render_offline_deck(snapshot:Mapping[str,Any], material_id:str,
                        find_page:Callable[[str,str],Path|None])->str:
    runtime=ASSETS/'runtime.js'
    stylesheet=ASSETS/'runtime.css'
    if not runtime.exists() or not stylesheet.exists():
        from .schemas.errors import missing_field
        raise missing_field('离线运行时尚未构建，请先在 frontend 运行 npm run build:offline')
    backup = {
        'schema_version': 'xsproj.backup.1',
        'title': snapshot.get('title') or '项目备份',
        'page_count': snapshot.get('page_count'),
        'source_pptx_sha256': snapshot.get('source_pptx_sha256') or '',
        'scene_document': snapshot.get('scene_document'),
        'ispecs': snapshot.get('ispecs', []),
        'values': {
            spec.get('object_id'): {parameter.get('id'): parameter.get('default') for parameter in spec.get('parameters', [])}
            for spec in snapshot.get('ispecs', []) if isinstance(spec, Mapping) and isinstance(spec.get('object_id'), str)
        },
        'pages': [
            {key: page.get(key) for key in ('page_no', 'title', 'width', 'height')}
            for page in snapshot.get('pages', []) if isinstance(page, Mapping)
        ],
        'created_at': snapshot.get('published_at'),
    }
    backup_json = json.dumps(backup, ensure_ascii=False, allow_nan=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    pages=[]
    total=0
    for raw in snapshot.get('pages',[]):
        if not isinstance(raw,Mapping) or not isinstance(raw.get('page_no'),int):
            continue
        image=None
        if raw.get('image'):
            file=find_page(material_id,raw['image'])
            if file is None:
                from .schemas.errors import missing_field
                raise missing_field(f'第 {raw["page_no"]} 页预览不可用，请重新生成后导出')
            payload=file.read_bytes()
            total+=len(payload)
            if total>MAX_PAGE_BYTES:
                from .schemas.errors import missing_field
                raise missing_field('整份课件的预览超过 64MB，暂不能打包为单文件，请使用分享网页')
            image='data:image/png;base64,'+base64.b64encode(payload).decode('ascii')
        # The offline viewer needs only slide geometry, text, and object anchors.
        elements=[{key:e[key] for key in ('element_id','kind','bbox','text','name') if key in e}
                  for e in raw.get('elements',[]) if isinstance(e,Mapping)]
        pages.append({'page_no':raw['page_no'],'title':raw.get('title') or f'第 {raw["page_no"]} 页',
          'width':raw.get('width',12192000),'height':raw.get('height',6858000),
          'image_url':image,'elements':elements})
    specs=snapshot.get('ispecs',[])
    content={'title':snapshot.get('title','万象演示文稿'),'pages':pages,'specs':specs,'document':snapshot.get('scene_document'),'pptAi':snapshot.get('ppt_ai')}
    signature=hashlib.sha256(json.dumps(content,ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:24]
    content['identity']='offline.'+signature
    data=json.dumps(content,ensure_ascii=False).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')
    script=runtime.read_text(encoding='utf-8').replace('</script','<\\/script')
    css=stylesheet.read_text(encoding='utf-8').replace('</style','<\\/style')
    title=html.escape(str(content['title']),quote=True)
    return ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
      '<meta name="viewport" content="width=device-width,initial-scale=1">'
      f'<title>{title} · 万象交互网页</title><style>{css}</style></head><body>'
      '<div id="offline-root"></div><noscript>请启用 JavaScript 以展示交互课件。</noscript>'
      '<button id="project-backup-download" type="button" style="position:fixed;right:16px;bottom:16px;z-index:30;padding:8px 12px;border:1px solid #d5ccb9;border-radius:999px;background:#fff;color:#2f3a49;font:12px sans-serif;cursor:pointer">导出工程备份</button>'
      f'<script id="project-backup" type="application/json">{backup_json}</script>'
      '<script>(function(){const button=document.getElementById("project-backup-download");const node=document.getElementById("project-backup");if(!button||!node)return;button.addEventListener("click",function(){const blob=new Blob([node.textContent||"{}"],{type:"application/json"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="xiangsheng-project-backup.json";document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(link.href)},30000);});})();</script>'
      f'<script id="export-data" type="application/json">{data}</script>'
      f'<script>{script}</script></body></html>')

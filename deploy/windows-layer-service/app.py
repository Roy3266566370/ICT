"""Standalone Windows object-separation service for 象生 free editing.

Run this on a Windows machine with desktop PowerPoint:

    set LAYER_EXPORT_SERVICE_TOKEN=long-random-token
    set XIANG_BACKEND_DIR=E:\\代码\\ICT\\backend
    uvicorn app:app --host 0.0.0.0 --port 8090

Then point the main backend at it:

    LAYER_EXPORT_SERVICE_URL=http://windows-host:8090
    LAYER_EXPORT_SERVICE_TOKEN=long-random-token
"""
from __future__ import annotations

import hmac
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse

TOKEN = os.environ.get('LAYER_EXPORT_SERVICE_TOKEN', '')
ALLOW_ANONYMOUS = os.environ.get('LAYER_EXPORT_ALLOW_ANONYMOUS', '') == '1'
if not TOKEN and not ALLOW_ANONYMOUS:
    # Fail closed: an unauthenticated conversion service is reachable by anyone
    # who can hit the port and consumes native PowerPoint conversion resources.
    raise SystemExit(
        'LAYER_EXPORT_SERVICE_TOKEN is not set; refusing to start an '
        'unauthenticated conversion service. Set a long random token, or '
        'set LAYER_EXPORT_ALLOW_ANONYMOUS=1 and bind 127.0.0.1 for local '
        'development only.'
    )
BACKEND_DIR = Path(os.environ.get('XIANG_BACKEND_DIR', Path(__file__).resolve().parents[2] / 'backend'))
MAX_UPLOAD = 200 * 1024 * 1024

app = FastAPI(title='象生 Windows 对象分离服务', version='1.0')


def _authorized(header: str | None) -> bool:
    if not TOKEN:
        # Reachable only via explicit anonymous opt-in.
        return ALLOW_ANONYMOUS
    return bool(header) and hmac.compare_digest(
        header.encode('utf-8'), f'Bearer {TOKEN}'.encode('utf-8')
    )


@app.get('/health')
def health():
    return {'status': 'ok', 'platform': sys.platform, 'backend': str(BACKEND_DIR)}


@app.post('/export')
async def export(file: UploadFile = File(...), page: int = Form(...), authorization: str | None = Header(default=None)):
    if not _authorized(authorization):
        raise HTTPException(status_code=401, detail='invalid token')
    if page < 1:
        raise HTTPException(status_code=422, detail='page must be >= 1')
    with tempfile.TemporaryDirectory(prefix='xiangsheng-layer-') as temporary:
        root = Path(temporary)
        source = root / 'source.pptx'
        size = 0
        with source.open('wb') as target:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise HTTPException(status_code=413, detail='file too large')
                target.write(chunk)
        output = root / 'layers'
        environment = dict(os.environ)
        environment['PYTHONPATH'] = str(BACKEND_DIR)
        process = subprocess.run(
            [sys.executable, '-m', 'app.documents.layer_export', '--source', str(source),
             '--out', str(output), '--page', str(page)],
            cwd=BACKEND_DIR, env=environment, capture_output=True, timeout=180,
        )
        manifest = output / 'manifest.json'
        if not manifest.is_file():
            detail = process.stderr.decode('utf-8', 'replace')[-800:] or 'no manifest produced'
            raise HTTPException(status_code=502, detail=detail)
        archive = root / 'layers.zip'
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
            bundle.write(manifest, 'manifest.json')
            for path in output.iterdir():
                if path.is_file() and path.name != 'manifest.json':
                    bundle.write(path, path.name)
        return FileResponse(archive, media_type='application/zip', filename=f'layers-p{page}.zip')

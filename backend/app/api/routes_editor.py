"""Material-owned editing and re-recognition, with revision checks and real rebuilds."""
from __future__ import annotations

from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from . import API_PREFIX, DBDep, SessionDep, WriteDep, ok, owned_material
from ..db.models import JobRecord
from ..editing import EDIT_LOCK, apply_native_edits, metadata_path, read_metadata, working_path, write_metadata
from ..parsers import parse_pptx
from ..schemas.common import to_iso, utc_now
from ..schemas.errors import missing_field, version_conflict
from .routes_jobs import run_upload_job, read_ispec_payload

router = APIRouter(prefix=API_PREFIX, tags=['editor'])


class ElementChange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    page: int = Field(ge=1, le=60)
    element_id: str = Field(min_length=1, max_length=96)
    kind: Literal['text', 'table', 'chart', 'recognition', 'interaction']
    text: str | None = Field(default=None, max_length=20000)
    rows: list[list[str]] | None = None
    categories: list[str] | None = None
    series: list[dict[str, Any]] | None = None
    interaction: dict[str, Any] | None = None


class EditRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_revision: int = Field(ge=0)
    changes: list[ElementChange] = Field(default_factory=list, max_length=100)


@router.get('/materials/{material_id}/editor')
def get_editor(material_id: str, request: Request, ctx: SessionDep, db: DBDep):
    material = owned_material(db, ctx, material_id)
    source = working_path(material.id)
    if not source.exists():
        raise missing_field('示例材料没有上传原件，请上传自己的PPT后编辑')
    _, parsed = parse_pptx(str(source), material_id=material.id)
    metadata = read_metadata(material.id)
    recognition = (read_ispec_payload(material.id) or {}).get('image_recognition', {})
    for page in parsed['pages']:
        for element in page['elements']:
            element['recognition'] = recognition.get(element['element_id'])
            element['override'] = metadata.get('overrides', {}).get(element['element_id'])
    return ok(request, {'revision': metadata['revision'], 'pages': parsed['pages']})


@router.put('/materials/{material_id}/editor', status_code=202)
def put_editor(material_id: str, payload: EditRequest, request: Request, ctx: WriteDep,
               db: DBDep, background_tasks: BackgroundTasks):
    material = owned_material(db, ctx, material_id)
    with EDIT_LOCK:
        metadata = read_metadata(material.id)
        if metadata['revision'] != payload.expected_revision:
            raise version_conflict('材料已被其他窗口编辑，请重新载入', current_revision=metadata['revision'])
        latest_job=db.scalars(select(JobRecord).where(JobRecord.material_id==material.id)
                             .order_by(JobRecord.created_at.desc(),JobRecord.id.desc()).limit(1)).first()
        if material.status == 'processing' or (latest_job and latest_job.stage not in ('awaiting_confirmation','ready','failed')):
            raise missing_field('材料正在处理，请完成后再编辑')
        source = working_path(material.id)
        if not source.exists():
            raise missing_field('没有可编辑的上传原件')
        changes = [change.model_dump(exclude_none=True) for change in payload.changes]
        try:
            for change in changes:
                if change['kind'] in ('interaction', 'recognition'):
                    if change.get('interaction'):
                        from ..ispec.user_config import validate_interaction
                        validate_interaction(change['interaction'])
                    overrides=metadata.setdefault('overrides', {})
                    overrides[change['element_id']] = {**overrides.get(change['element_id'],{}), **change}
            apply_native_edits(source, metadata_path(material.id).parent/'edited.pptx', changes)
        except (ValueError, KeyError, TypeError) as error:
            raise missing_field(str(error)) from error
        metadata['revision'] += 1
        write_metadata(material.id, metadata)
        now = to_iso(utc_now())
        job_id = f'job_{uuid4().hex}'
        db.add(JobRecord(id=job_id, material_id=material.id, session_id=ctx.session_id,
                         kind='upload', stage='queued', attempt=1, progress_pct=None,
                         created_at=now, updated_at=now))
        material.status = 'processing'
        db.commit()
    background_tasks.add_task(run_upload_job, job_id)
    return ok(request, {'revision': metadata['revision'], 'job_id': job_id,
                        'material_id': material.id}, status_code=202)

"""验证上传转换流水线的并发解析、实时占位页落库与非阻塞收尾行为。"""
from __future__ import annotations

import threading
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.api import routes_jobs
from app.db.base import Base
from app.db.models import JobRecord, MaterialRecord, PageRecord
from app.documents import auto_vectors


def test_upload_pipeline_seeds_pages_before_render_and_skips_blocking_vectors(tmp_path, monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)

    source = tmp_path / "original.pptx"
    source.write_bytes(b"placeholder")
    monkeypatch.setattr("app.editing.working_path", lambda _: source)
    monkeypatch.setattr(routes_jobs, "ISpec_DIR", tmp_path / "ispecs")

    render_started = threading.Event()
    parse_called = threading.Event()
    seeded_count_at_render = []

    def fake_render_pages(db, job, material, source_file):
        # 渲染开始时，占位页必须已提交落库，前端才能实时点亮逐页渲染进度
        count = len(db.scalars(select(PageRecord).where(PageRecord.material_id == material.id)).all())
        seeded_count_at_render.append(count)
        routes_jobs.transition(db, job, "rendering", progress_pct=None)
        render_started.set()
        parse_called.wait(timeout=2.0)
        material.status = routes_jobs.READINESS_READABLE
        db.commit()
        return None

    def fake_parse_pptx(_path: str):
        parse_called.set()
        render_started.wait(timeout=2.0)
        return (
            {"title": "测试并发课件", "page_count": 3},
            {
                "pages": [
                    {"page_no": i, "title": f"第 {i} 页", "paragraphs": [], "excerpt": "", "elements": []}
                    for i in range(1, 4)
                ],
                "assets": [],
            },
        )

    def forbidden_prepare_vectors(*_args, **_kwargs):
        raise AssertionError("上传主链路不得同步调用阻塞的 prepare_source_vectors")

    monkeypatch.setattr(routes_jobs, "_render_pages", fake_render_pages)
    monkeypatch.setattr(
        routes_jobs,
        "load_parser_bundle",
        lambda: routes_jobs.ParserBundle(parse_pptx=fake_parse_pptx, map_candidates=lambda _m, _s: []),
    )
    monkeypatch.setattr(auto_vectors, "prepare_source_vectors", forbidden_prepare_vectors)

    with Session(engine) as db:
        material = MaterialRecord(
            id="mat_fast_upload",
            session_id="ses_test",
            title="原始文件名",
            status="processing",
            page_count=3,
            candidates=[],
            created_at="2026-11-27T00:00:00Z",
            expires_at="2026-11-28T00:00:00Z",
        )
        job = JobRecord(
            id="job_fast_upload",
            session_id="ses_test",
            material_id="mat_fast_upload",
            kind="upload",
            stage="queued",
            attempt=1,
            created_at="2026-11-27T00:00:00Z",
            updated_at="2026-11-27T00:00:00Z",
        )
        db.add(material)
        db.flush()
        db.add(job)
        db.commit()

        routes_jobs._run_upload_pipeline(db, job, material, native_changed=True)

        assert seeded_count_at_render == [3]
        assert parse_called.is_set()
        assert job.stage == "awaiting_confirmation"
        assert material.status == "awaiting_confirmation"
        assert material.title == "测试并发课件"
        assert material.page_count == 3
        pages = db.scalars(
            select(PageRecord).where(PageRecord.material_id == material.id).order_by(PageRecord.page_no.asc())
        ).all()
        assert [p.title for p in pages] == ["第 1 页", "第 2 页", "第 3 页"]

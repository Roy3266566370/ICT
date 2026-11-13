"""识别/编译失败不得让材料不可读（spec §3.1 末条）。

用内存 SQLite 直接测 ``mark_failed`` 的状态保留规则与材料状态投影，
不需要起服务、不需要渲染。
"""

from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.routes_jobs import mark_failed
from app.api.routes_materials import material_summary, public_material_status
from app.db.base import Base
from app.db.models import JobRecord, MaterialRecord
from app.render import READINESS_READABLE
from app.schemas.errors import model_unavailable

TIMESTAMP = "2026-11-01T00:00:00Z"


def _session() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def _material(status: str) -> MaterialRecord:
    return MaterialRecord(
        id="mat_1",
        session_id="ses_1",
        title="课程件",
        status=status,
        page_count=24,
        source_filename="deck.pptx",
        clone_of_example_id=None,
        candidates=[],
        created_at=TIMESTAMP,
        expires_at="2026-11-02T00:00:00Z",
    )


def _job() -> JobRecord:
    return JobRecord(
        id="job_1",
        session_id="ses_1",
        material_id="mat_1",
        object_id=None,
        kind="upload",
        stage="rendering",
        attempt=1,
        progress_pct=None,
        created_at=TIMESTAMP,
        updated_at=TIMESTAMP,
    )


def test_mark_failed_keeps_readable_material() -> None:
    """已渲染（``readable``）的材料，任务失败后仍然可读。"""

    db = _session()
    material = _material(READINESS_READABLE)
    job = _job()
    db.add(material)
    db.add(job)
    db.commit()

    mark_failed(db, job, material, model_unavailable("规则化解析不可用"))

    assert job.stage == "failed"
    assert job.error_code == "MODEL_UNAVAILABLE"
    assert job.progress_pct is None
    # 关键断言：识别失败不能让已生成的整页底图不可访问
    assert material.status == READINESS_READABLE


def test_mark_failed_marks_unrendered_material_failed() -> None:
    """还没进过渲染阶段（``processing``）的材料，失败时如实置 ``failed``。"""

    db = _session()
    material = _material("processing")
    job = _job()
    db.add(material)
    db.add(job)
    db.commit()

    mark_failed(db, job, material, model_unavailable("渲染前失败"))

    assert job.stage == "failed"
    assert material.status == "failed"


def test_public_status_projection_keeps_contract_values() -> None:
    """内部 ``readable`` 投影为契约四值之一；其它状态原样返回。"""

    assert public_material_status(READINESS_READABLE) == "awaiting_confirmation"
    for status in ("processing", "awaiting_confirmation", "ready", "failed"):
        assert public_material_status(status) == status


def test_readable_material_during_extracting_stays_processing() -> None:
    """页图可读不代表识别完成：extracting 期间对外仍是 processing。"""

    assert public_material_status(READINESS_READABLE, "extracting") == "processing"
    assert public_material_status(READINESS_READABLE, "rendering") == "processing"
    assert public_material_status(READINESS_READABLE, "failed") == "failed"
    assert public_material_status(READINESS_READABLE, "awaiting_confirmation") == "awaiting_confirmation"


def test_material_summary_reads_latest_job_stage() -> None:
    db = _session()
    material = _material(READINESS_READABLE)
    job = _job()
    job.stage = "extracting"
    db.add(material)
    db.add(job)
    db.commit()

    assert material_summary(db, material).status == "processing"

    job.stage = "awaiting_confirmation"
    db.commit()
    assert material_summary(db, material).status == "awaiting_confirmation"
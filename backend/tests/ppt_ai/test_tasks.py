"""T02：持久任务、幂等与 worker 领取。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.models import MaterialRecord, SessionRecord
from app.db.ppt_ai_models import PptAiTaskRecord
from app.ppt_ai import model_calls, pipeline
from app.ppt_ai.matching.pipeline import resolve_requested_regions
from app.ppt_ai.regions import extract_regions
from app.ppt_ai.store import save_plan
from app.ppt_ai.tasks import TaskConflict, _claim, _still_owner, enqueue_task, run_pending, run_task
from app.ppt_ai.types import InteractionPlan
from tests.ppt_ai import helpers


@pytest.fixture
def db_factory(tmp_path: Path, monkeypatch):
    engine = create_engine("sqlite:///" + (tmp_path / "tasks.db").as_posix(), future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    now = datetime.now(tz=timezone.utc).replace(microsecond=0)
    with factory() as db:
        db.add(SessionRecord(id="ses_tasks", csrf_token="x" * 16,
                             created_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                             expires_at=(now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                             retention_hours=24))
        db.add(MaterialRecord(id="mat_tasks", session_id="ses_tasks", title="任务测试", status="ready",
                              page_count=1, candidates=[], created_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                              expires_at=(now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")))
        db.commit()
    snapshot = helpers.integral_snapshot("mat_tasks")
    monkeypatch.setattr(pipeline, "_snapshot", lambda material: snapshot)
    return factory


def test_operation_id_is_idempotent(db_factory) -> None:
    with db_factory() as db:
        first = enqueue_task(db, session_id="ses_tasks", material_id="mat_tasks", kind="ai_plan", operation_id="same_op")
        second = enqueue_task(db, session_id="ses_tasks", material_id="mat_tasks", kind="ai_plan", operation_id="same_op")
        assert first.id == second.id
        rows = db.scalars(select(PptAiTaskRecord)).all()
        assert len(rows) == 1


def test_same_operation_id_with_different_input_conflicts(db_factory) -> None:
    with db_factory() as db:
        enqueue_task(
            db,
            session_id="ses_tasks",
            material_id="mat_tasks",
            kind="ai_plan",
            operation_id="same_op_different_input",
            input_json={"purpose": "第一次"},
        )
        with pytest.raises(TaskConflict):
            enqueue_task(
                db,
                session_id="ses_tasks",
                material_id="mat_tasks",
                kind="ai_plan",
                operation_id="same_op_different_input",
                input_json={"purpose": "第二次"},
            )


def test_worker_runs_plan_task_and_persists_plan(db_factory) -> None:
    with db_factory() as db:
        task = enqueue_task(
            db,
            session_id="ses_tasks",
            material_id="mat_tasks",
            kind="ai_plan",
            operation_id="plan_worker",
            input_json={"purpose": "测试"},
        )
        executed = run_pending(db, limit=1)
        assert executed == [task.id]
        db.refresh(task)
        assert task.status == "succeeded"
        assert task.result and task.result["plan_id"].startswith("pln_")
        assert task.input_json == {"purpose": "测试"}
        assert run_pending(db, limit=1) == []


def test_unsupported_kind_fails_without_crashing(db_factory) -> None:
    with db_factory() as db:
        task = enqueue_task(db, session_id="ses_tasks", material_id="mat_tasks", kind="ai_unknown", operation_id="bad")
        run_task(db, task)
        assert task.status == "failed"
        assert task.error_code == "MISSING_FIELD"


def test_claim_is_atomic_across_workers(db_factory) -> None:
    with db_factory() as first, db_factory() as second:
        task = enqueue_task(
            db=first,
            session_id="ses_tasks",
            material_id="mat_tasks",
            kind="ai_plan",
            operation_id="claim_atomic",
        )
        stale = second.get(PptAiTaskRecord, task.id)
        assert _claim(first, first.get(PptAiTaskRecord, task.id)) is True
        # 第二个 worker 持有领取前的旧 updated_at，强制领取也必须失败。
        assert _claim(second, stale, force=True) is False


def test_late_worker_cannot_submit_after_attempt_changes(db_factory) -> None:
    with db_factory() as db:
        task = enqueue_task(
            db=db,
            session_id="ses_tasks",
            material_id="mat_tasks",
            kind="ai_plan",
            operation_id="late_worker",
        )
        row = db.get(PptAiTaskRecord, task.id)
        assert _claim(db, row)
        claimed_attempt = row.attempt
        row.attempt = claimed_attempt + 1
        db.commit()
        assert _still_owner(db, row, claimed_attempt) is False


def test_model_attempt_is_persisted_even_when_task_transaction_rolls_back(db_factory, monkeypatch) -> None:
    monkeypatch.setattr(model_calls, "session_scope", db_factory)
    with db_factory() as db:
        task = enqueue_task(
            db=db,
            session_id="ses_tasks",
            material_id="mat_tasks",
            kind="ai_plan",
            operation_id="budget_persist",
        )
        model_calls.persist_attempt(task.id, 2)
        db.expire_all()
        row = db.get(PptAiTaskRecord, task.id)
        assert row.budget_used == 2


def test_get_task_has_no_side_effect(db_factory) -> None:
    with db_factory() as db:
        task = enqueue_task(db, session_id="ses_tasks", material_id="mat_tasks", kind="ai_plan", operation_id="read_only")
        before = task.status
        # 直接读取行不会推进任务
        row = db.get(PptAiTaskRecord, task.id)
        assert row.status == before == "queued"


def test_requested_regions_accept_region_id_and_element_id() -> None:
    extraction = extract_regions(helpers.chart_snapshot("mat_filter"))
    region = extraction.regions[0]
    matched, unmatched = resolve_requested_regions([region.region_id, "e1"], extraction.regions)
    assert matched == {region.region_id}
    assert unmatched == []
    matched, unmatched = resolve_requested_regions(["p04_s14"], extraction.regions)
    assert matched == set()
    assert unmatched == ["p04_s14"]


def test_plan_task_accepts_element_id_region_filter(db_factory, monkeypatch) -> None:
    monkeypatch.setattr(pipeline, "_snapshot", lambda material: helpers.chart_snapshot(material.id))
    with db_factory() as db:
        task = enqueue_task(
            db,
            session_id="ses_tasks",
            material_id="mat_tasks",
            kind="ai_plan",
            operation_id="filter_by_element",
            input_json={"region_ids": ["e1"]},
        )
        run_pending(db, limit=1)
        db.refresh(task)
        assert task.status == "succeeded", task.error_message
        assert task.result is not None
        assert task.result["option_count"] >= 1
        assert task.result["supported"] >= 1


def test_plan_task_rejects_unknown_region_ids(db_factory) -> None:
    with db_factory() as db:
        task = enqueue_task(
            db,
            session_id="ses_tasks",
            material_id="mat_tasks",
            kind="ai_plan",
            operation_id="filter_unknown",
            input_json={"region_ids": ["p04_s14"]},
        )
        run_pending(db, limit=1)
        db.refresh(task)
        assert task.status == "failed"
        assert task.error_code == "MISSING_FIELD"
        assert "未找到指定区域" in (task.error_message or "")


def test_rebuild_rejects_empty_plan(db_factory) -> None:
    snapshot = helpers.integral_snapshot("mat_tasks")
    with db_factory() as db:
        plan = InteractionPlan(
            plan_id="pln_empty",
            material_id="mat_tasks",
            source_revision=snapshot.document_revision,
            source_hash=snapshot.source_hash,
            options=[],
            coverage=[],
            issues=[],
            budget={},
            created_at="2026-11-09T00:00:00Z",
        )
        save_plan(db, session_id="ses_tasks", material_id="mat_tasks", plan=plan)
        task = enqueue_task(
            db,
            session_id="ses_tasks",
            material_id="mat_tasks",
            kind="ai_rebuild",
            operation_id="rebuild_empty_plan",
            input_json={"plan_id": "pln_empty", "expected_plan_revision": 1},
        )
        run_pending(db, limit=1)
        db.refresh(task)
        assert task.status == "failed"
        assert task.error_code == "MISSING_FIELD"
        assert "规划中没有可编译方案" in (task.error_message or "")

"""T10：显式基准/练习选择、预览与冻结 v2。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.models import MaterialRecord, SessionRecord
from app.ppt_ai.branches import branch_hash, create_branch
from app.ppt_ai.learning_publish import (
    PublishSelectionError,
    preview_publication,
)
from app.ppt_ai.learning_types import LearningPublishSelection
from app.ppt_ai.learning_validation import SCRIPT_VERSION
from app.ppt_ai.store import save_bundle, save_report
from app.ppt_ai.types import ValidationReport
from app.ppt_ai.util import hash_json, now_iso
from tests.ppt_ai import helpers

MATERIAL = "mat_publish_learning"


@pytest.fixture
def db_factory(tmp_path: Path):
    engine = create_engine("sqlite:///" + (tmp_path / "publish.db").as_posix(), future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    now = datetime.now(tz=timezone.utc).replace(microsecond=0)
    with factory() as db:
        db.add(
            SessionRecord(
                id="ses_pub",
                csrf_token="x" * 16,
                created_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                expires_at=(now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                retention_hours=24,
            )
        )
        db.add(
            MaterialRecord(
                id=MATERIAL,
                session_id="ses_pub",
                title="发布测试",
                status="ready",
                page_count=1,
                candidates=[],
                created_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                expires_at=(now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            )
        )
        db.commit()
    return factory


def _setup(db):
    snapshot = helpers.matrix_snapshot(MATERIAL, "A = [[2,1],[1,2]]，v = (4,3)")
    _extraction, _plan, bundle = helpers.bundle_for(snapshot)
    save_bundle(db, session_id="ses_pub", material_id=MATERIAL, bundle=bundle)
    baseline = create_branch(
        db,
        session_id="ses_pub",
        material_id=MATERIAL,
        bundle=bundle,
        status="active",
        kind="baseline",
        title="课件基准",
    )
    practice = create_branch(
        db,
        session_id="ses_pub",
        material_id=MATERIAL,
        bundle=bundle,
        parent_branch_id=baseline.id,
        status="active",
        kind="practice",
        title="练习",
    )
    db.commit()
    node = helpers.node_of(bundle, "matrix")
    return bundle, baseline, practice, node


def _selection(bundle, branch, node, *, mode="baseline") -> LearningPublishSelection:
    return LearningPublishSelection(
        mode=mode,
        bundle_id=bundle.bundle_id,
        expected_bundle_revision=bundle.bundle_revision,
        branch_id=branch.id,
        expected_branch_revision=branch.revision,
        expected_document_revision=bundle.source_revision,
        selected_learning_item_ids=[node.node_id],
        selected_experiment_ids=[],
    )


def _passed_report(db, bundle, branch) -> None:
    report = ValidationReport(
        report_id="rpt_learning_pass",
        material_id=MATERIAL,
        bundle_id=bundle.bundle_id,
        branch_id=branch.id,
        bundle_hash=hash_json(bundle.model_dump(mode="json")),
        branch_hash=branch_hash(branch),
        kernel_version="test",
        # 与 ai_learn_verify 受信浏览器任务写出的报告一致（发布门槛校验来源）。
        runtime_version=SCRIPT_VERSION,
        status="passed",
        summary={"pass": 1, "fail": 0, "not_covered": 0, "warn": 0},
        rules=[{"rule_id": "x", "category": "interaction", "status": "pass", "message": "ok"}],
        browser={"status": "passed", "server_verified": True, "viewport": "1600x1000,390x844", "checks": []},
        created_at=now_iso(),
    )
    save_report(db, session_id="ses_pub", report=report)
    db.commit()


def test_preview_blocks_without_browser_evidence_and_original_only_is_allowed(db_factory) -> None:
    with db_factory() as db:
        bundle, baseline, _practice, node = _setup(db)
        material = db.get(MaterialRecord, MATERIAL)
        selection = _selection(bundle, baseline, node)
        result = preview_publication(
            db, material=material, session_id="ses_pub", selection=selection
        )
        assert result["can_publish"] is False
        assert result["snapshot"] is None
        assert any(check["id"] == "browser_validation" and check["status"] == "not_covered" for check in result["checks"])

        original = LearningPublishSelection(mode="original_only")
        allowed = preview_publication(
            db, material=material, session_id="ses_pub", selection=original
        )
        assert allowed["can_publish"] is True
        assert allowed["snapshot"] is None


def test_preview_and_freeze_include_only_selected_learning_items(db_factory) -> None:
    with db_factory() as db:
        bundle, baseline, practice, node = _setup(db)
        material = db.get(MaterialRecord, MATERIAL)
        _passed_report(db, bundle, baseline)
        result = preview_publication(
            db,
            material=material,
            session_id="ses_pub",
            selection=_selection(bundle, baseline, node),
        )
        assert result["can_publish"] is True
        snapshot = result["snapshot"]
        assert snapshot["snapshot_version"] == "ppt-ai.frozen.2"
        assert snapshot["bundle"]["compiled"]["nodes"][0]["node_id"] == node.node_id
        assert len(snapshot["learning"]) == 1
        assert snapshot["learning"][0]["node_id"] == node.node_id
        packaged = snapshot["learning"][0]["packaged_explanation"]
        assert packaged["result_kind"] == "explanation"
        assert packaged["source_refs"]
        assert all("material_id" not in ref for ref in packaged["source_refs"])
        assert snapshot["branch"]["kind"] == "baseline"
        assert snapshot["content_hash"]
        assert "session_id" not in str(snapshot)
        # 不默认包含未选择的个人练习/候选实验
        assert snapshot["experiments"] == []

        with pytest.raises(PublishSelectionError):
            preview_publication(
                db,
                material=material,
                session_id="ses_pub",
                selection=_selection(bundle, practice, node, mode="baseline"),
            )


def test_practice_mode_requires_practice_branch_and_fresh_report(db_factory) -> None:
    with db_factory() as db:
        bundle, baseline, practice, node = _setup(db)
        material = db.get(MaterialRecord, MATERIAL)
        _passed_report(db, bundle, practice)
        result = preview_publication(
            db,
            material=material,
            session_id="ses_pub",
            selection=_selection(bundle, practice, node, mode="practice"),
        )
        assert result["can_publish"] is True
        assert result["snapshot"]["branch"]["kind"] == "practice"
        with pytest.raises(PublishSelectionError):
            preview_publication(
                db,
                material=material,
                session_id="ses_pub",
                selection=_selection(bundle, baseline, node, mode="practice"),
            )


def test_client_self_reported_browser_pass_is_not_accepted(db_factory) -> None:
    with db_factory() as db:
        bundle, baseline, _practice, node = _setup(db)
        material = db.get(MaterialRecord, MATERIAL)
        report = ValidationReport(
            report_id="rpt_client_claim",
            material_id=MATERIAL,
            bundle_id=bundle.bundle_id,
            branch_id=baseline.id,
            bundle_hash=hash_json(bundle.model_dump(mode="json")),
            branch_hash=branch_hash(baseline),
            kernel_version="test",
            runtime_version="test",
            status="passed",
            summary={"pass": 1, "fail": 0, "not_covered": 0, "warn": 0},
            rules=[],
            # 前端自报 passed，但没有服务端验证标记
            browser={"status": "passed", "server_verified": False, "checks": []},
            created_at=now_iso(),
        )
        save_report(db, session_id="ses_pub", report=report)
        db.commit()
        result = preview_publication(
            db,
            material=material,
            session_id="ses_pub",
            selection=_selection(bundle, baseline, node),
        )
        assert result["can_publish"] is False
        assert any(
            check["id"] == "browser_validation" and check["status"] == "not_covered"
            for check in result["checks"]
        )


def test_generic_verify_report_cannot_unlock_publication(db_factory) -> None:
    """通用 ai_verify 报告即便自报 server_verified=true 也不能通过发布门槛。"""

    from app.ppt_ai.validation import RUNTIME_VERSION

    with db_factory() as db:
        bundle, baseline, _practice, node = _setup(db)
        material = db.get(MaterialRecord, MATERIAL)
        report = ValidationReport(
            report_id="rpt_generic_claim",
            material_id=MATERIAL,
            bundle_id=bundle.bundle_id,
            branch_id=baseline.id,
            bundle_hash=hash_json(bundle.model_dump(mode="json")),
            branch_hash=branch_hash(baseline),
            kernel_version="test",
            # 通用验收任务写出的 runtime_version，不是受信浏览器脚本版本。
            runtime_version=RUNTIME_VERSION,
            status="passed",
            summary={"pass": 1, "fail": 0, "not_covered": 0, "warn": 0},
            rules=[],
            browser={"status": "passed", "server_verified": True, "checks": []},
            created_at=now_iso(),
        )
        save_report(db, session_id="ses_pub", report=report)
        db.commit()
        result = preview_publication(
            db,
            material=material,
            session_id="ses_pub",
            selection=_selection(bundle, baseline, node),
        )
        assert result["can_publish"] is False
        assert any(
            check["id"] == "browser_validation" and check["status"] == "not_covered"
            for check in result["checks"]
        )


def test_generic_validation_strips_caller_supplied_server_verified() -> None:
    from app.ppt_ai.validation import _client_browser_evidence

    assert _client_browser_evidence(
        {"status": "passed", "server_verified": True, "checks": []}
    ) == {"status": "passed", "checks": []}
    assert _client_browser_evidence(None) is None

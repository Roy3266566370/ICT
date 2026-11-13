"""T12：发布/离线冻结与公开投影边界。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.models import MaterialRecord, SessionRecord
from app.ppt_ai.branches import create_branch
from app.ppt_ai.generated_views import AREA_PROGRAM
from app.ppt_ai.snapshots import SnapshotConflict, freeze_interactions, public_projection
from app.ppt_ai.store import save_artifact, save_bundle
from app.ppt_ai.types import GeneratedViewArtifact
from app.ppt_ai.util import hash_json, now_iso
from tests.ppt_ai import helpers


@pytest.fixture
def db_factory(tmp_path: Path):
    engine = create_engine("sqlite:///" + (tmp_path / "snapshot.db").as_posix(), future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    now = datetime.now(tz=timezone.utc).replace(microsecond=0)
    with factory() as db:
        db.add(SessionRecord(id="ses_snap", csrf_token="x" * 16,
                             created_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                             expires_at=(now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                             retention_hours=24))
        db.add(MaterialRecord(id="mat_snap", session_id="ses_snap", title="冻结测试", status="ready",
                              page_count=1, candidates=[], created_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                              expires_at=(now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")))
        db.commit()
    return factory


def _store_bundle(db):
    _extraction, _plan, bundle = helpers.bundle_for(helpers.chart_snapshot("mat_snap"))
    row = save_bundle(db, session_id="ses_snap", material_id="mat_snap", bundle=bundle)
    branch = create_branch(db, session_id="ses_snap", material_id="mat_snap", bundle=bundle)
    db.commit()
    return bundle, row, branch


def test_freeze_uses_one_bundle_and_branch(db_factory) -> None:
    with db_factory() as db:
        bundle, _row, branch = _store_bundle(db)
        frozen = freeze_interactions(db, material=db.get(MaterialRecord, "mat_snap"), session_id="ses_snap")
        assert frozen is not None
        assert frozen.bundle_id == bundle.bundle_id
        assert frozen.bundle_revision == bundle.bundle_revision
        assert frozen.branch_id == branch.id
        assert frozen.branch_revision == branch.revision
        assert frozen.bundle_hash and frozen.branch_hash and frozen.content_hash
        projection = public_projection(frozen)
        assert projection is not None
        text = str(projection)
        assert "ses_snap" not in text
        assert "mat_snap" not in text
        assert "data/renders" not in text
        assert projection["bundle"]["compiled"]["nodes"]


def _text_snapshot(text: str):
    return helpers.snapshot(
        "mat_snap",
        hash_char="7",
        pages=[
            {
                "page_no": 1,
                "width": helpers.PAGE_W,
                "height": helpers.PAGE_H,
                "elements": [helpers.element("e1", "text", text=text)],
            }
        ],
    )


def test_template_ref_and_version_survive_freeze_and_public_projection(db_factory) -> None:
    with db_factory() as db:
        _extraction, _plan, bundle = helpers.bundle_for(
            _text_snapshot("抛体运动：初速度 v0 = 36 km/h，仰角 30°，g = 9.8 m/s^2，t = 1 s。")
        )
        save_bundle(db, session_id="ses_snap", material_id="mat_snap", bundle=bundle)
        create_branch(db, session_id="ses_snap", material_id="mat_snap", bundle=bundle)
        db.commit()
        frozen = freeze_interactions(db, material=db.get(MaterialRecord, "mat_snap"), session_id="ses_snap")
        assert frozen is not None
        projection = public_projection(frozen)
        assert projection is not None
        node = projection["bundle"]["compiled"]["nodes"][0]
        assert node["provider"]["template_ref"] == {
            "id": "physics.projectile",
            "version": "1.0",
            "adapter_version": "1",
        }
        assert node["provider"]["parameters"]["v0"] == pytest.approx(10.0)
        assert "mat_snap" not in str(projection)


def test_array_parameters_survive_freeze_and_offline_projection(db_factory) -> None:
    with db_factory() as db:
        text = "单通道卷积：输入矩阵 [[1,2,3],[4,5,6],[7,8,9]]，卷积核 [[1,0,-1],[1,0,-1],[1,0,-1]]，步长 1，填充 0。"
        _extraction, _plan, bundle = helpers.bundle_for(_text_snapshot(text))
        save_bundle(db, session_id="ses_snap", material_id="mat_snap", bundle=bundle)
        create_branch(db, session_id="ses_snap", material_id="mat_snap", bundle=bundle)
        db.commit()
        frozen = freeze_interactions(db, material=db.get(MaterialRecord, "mat_snap"), session_id="ses_snap")
        assert frozen is not None
        node = frozen.bundle["compiled"]["nodes"][0]
        assert node["provider"]["parameters"]["matrix"] == [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0], [7.0, 8.0, 9.0]]
        projection = public_projection(frozen)
        assert projection is not None
        public_node = projection["bundle"]["compiled"]["nodes"][0]
        assert public_node["provider"]["parameters"]["kernel"] == [[1.0, 0.0, -1.0], [1.0, 0.0, -1.0], [1.0, 0.0, -1.0]]


def test_expected_revision_mismatch_is_rejected(db_factory) -> None:
    with db_factory() as db:
        _bundle, _row, branch = _store_bundle(db)
        with pytest.raises(SnapshotConflict):
            freeze_interactions(db, material=db.get(MaterialRecord, "mat_snap"),
                                session_id="ses_snap", branch_id=branch.id, expected_revision=branch.revision + 1)


def test_no_bundle_returns_none_for_old_material(db_factory) -> None:
    with db_factory() as db:
        assert freeze_interactions(db, material=db.get(MaterialRecord, "mat_snap"), session_id="ses_snap") is None


def test_only_accepted_artifacts_enter_offline_projection(db_factory) -> None:
    with db_factory() as db:
        bundle, _row, _branch = _store_bundle(db)
        ast = {"version": "ppt-ai.view.1", "nodes": [{"id": "t", "type": "text", "x": 1, "y": 1, "text": "x"}], "interactions": []}
        for status, identifier in (("pending", "art_p"), ("accepted", "art_a")):
            save_artifact(db, session_id="ses_snap", artifact=GeneratedViewArtifact(
                artifact_id=identifier,
                material_id="mat_snap",
                bundle_id=bundle.bundle_id,
                content_hash=hash_json([status, identifier]),
                view_contract_version="ppt-ai.view.1",
                program=AREA_PROGRAM,
                ast=ast,
                resources=[],
                supported_interactions=[],
                offline_supported=status == "accepted",
                acceptance_status=status,
                isolation={"iframe_sandbox": "allow-scripts", "opaque_origin": True, "worker": True, "timeout_ms": 200, "max_nodes": 2000},
                created_at=now_iso(),
            ))
        db.commit()
        frozen = freeze_interactions(db, material=db.get(MaterialRecord, "mat_snap"), session_id="ses_snap")
        assert frozen is not None
        assert [item["artifact_id"] for item in frozen.artifacts] == ["art_a"]
        assert any(item.get("status") == "pending" for item in frozen.resource_manifest)

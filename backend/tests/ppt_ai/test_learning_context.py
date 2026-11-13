"""T02：学习上下文哈希、版本校验与参数合法域。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.models import MaterialRecord, SessionRecord
from app.ppt_ai.branches import create_branch
from app.ppt_ai.learning_context import (
    LearningContextError,
    build_learning_input_hash,
    validate_learning_context,
)
from app.ppt_ai.learning_types import LearningContext
from app.ppt_ai.store import save_bundle
from tests.ppt_ai import helpers

MATERIAL = "mat_context"


@pytest.fixture
def db_factory(tmp_path: Path):
    engine = create_engine("sqlite:///" + (tmp_path / "ctx.db").as_posix(), future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    now = datetime.now(tz=timezone.utc).replace(microsecond=0)
    with factory() as db:
        db.add(
            SessionRecord(
                id="ses_ctx",
                csrf_token="x" * 16,
                created_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                expires_at=(now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                retention_hours=24,
            )
        )
        db.add(
            MaterialRecord(
                id=MATERIAL,
                session_id="ses_ctx",
                title="上下文测试",
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
    save_bundle(db, session_id="ses_ctx", material_id=MATERIAL, bundle=bundle)
    branch = create_branch(
        db,
        session_id="ses_ctx",
        material_id=MATERIAL,
        bundle=bundle,
        status="active",
        kind="baseline",
        title="课件基准",
    )
    db.commit()
    node = helpers.node_of(bundle, "matrix")
    return bundle, branch, node


def _context(bundle, branch, node, **overrides) -> LearningContext:
    payload = {
        "document_revision": bundle.source_revision,
        "source_hash": bundle.source_hash,
        "bundle_id": bundle.bundle_id,
        "bundle_revision": bundle.bundle_revision,
        "page_no": node.source.page,
        "node_id": node.node_id,
        "region_id": node.region_id,
        "branch_id": branch.id,
        "branch_revision": branch.revision,
        "draft_revision": 0,
        "client_request_id": "req_1",
        "input_values": {},
        "input_hash": None,
    }
    payload.update(overrides)
    return LearningContext.model_validate(payload)


def test_hash_is_stable_and_ignores_request_id(db_factory) -> None:
    with db_factory() as db:
        bundle, branch, node = _setup(db)
        material = db.get(MaterialRecord, MATERIAL)
        first = _context(bundle, branch, node)
        second = _context(bundle, branch, node, client_request_id="req_2")
        assert build_learning_input_hash(first) == build_learning_input_hash(second)
        changed = _context(bundle, branch, node, draft_revision=1)
        assert build_learning_input_hash(changed) != build_learning_input_hash(first)
        frozen = validate_learning_context(
            db, material=material, session_id="ses_ctx", context=first
        )
        assert frozen.input_hash == build_learning_input_hash(first)
        assert frozen.node.node_id == node.node_id


def test_stale_and_invalid_inputs_are_rejected(db_factory) -> None:
    with db_factory() as db:
        bundle, branch, node = _setup(db)
        material = db.get(MaterialRecord, MATERIAL)
        v1 = next(parameter for parameter in node.parameters if parameter.id == "v1")
        context = _context(bundle, branch, node, input_values={v1.concept_id: 1.0})
        computed = build_learning_input_hash(context)
        with pytest.raises(LearningContextError) as stale:
            validate_learning_context(
                db,
                material=material,
                session_id="ses_ctx",
                context=_context(bundle, branch, node, input_values={v1.concept_id: 1.0}, input_hash="0" * 64),
            )
        assert stale.value.stale is True

        with pytest.raises(LearningContextError):
            validate_learning_context(
                db,
                material=material,
                session_id="ses_ctx",
                context=_context(bundle, branch, node, input_values={v1.concept_id: 1e9}),
            )
        with pytest.raises(LearningContextError):
            validate_learning_context(
                db,
                material=material,
                session_id="ses_ctx",
                context=_context(bundle, branch, node, page_no=99),
            )
        with pytest.raises(LearningContextError):
            validate_learning_context(
                db,
                material=material,
                session_id="ses_ctx",
                context=_context(bundle, branch, node, branch_revision=99),
            )
        valid = _context(bundle, branch, node, input_values={v1.concept_id: 1.0}, input_hash=computed)
        frozen = validate_learning_context(
            db, material=material, session_id="ses_ctx", context=valid
        )
        assert frozen.effective_values[v1.concept_id] == 1.0


def test_teaching_probe_is_allowed_but_arbitrary_keys_are_not(db_factory) -> None:
    with db_factory() as db:
        bundle, branch, node = _setup(db)
        material = db.get(MaterialRecord, MATERIAL)
        context = _context(bundle, branch, node, input_values={"teaching.v1": 1.0, "teaching.v2": 0.0})
        frozen = validate_learning_context(
            db, material=material, session_id="ses_ctx", context=context
        )
        assert frozen.effective_values["teaching.v1"] == 1.0
        with pytest.raises(LearningContextError):
            validate_learning_context(
                db,
                material=material,
                session_id="ses_ctx",
                context=_context(bundle, branch, node, input_values={"draw.canvas": 1}),
            )


def test_document_revision_mismatch_is_stale(db_factory) -> None:
    with db_factory() as db:
        bundle, branch, node = _setup(db)
        material = db.get(MaterialRecord, MATERIAL)
        with pytest.raises(LearningContextError) as stale:
            validate_learning_context(
                db,
                material=material,
                session_id="ses_ctx",
                context=_context(bundle, branch, node, document_revision=999),
            )
        assert stale.value.stale is True

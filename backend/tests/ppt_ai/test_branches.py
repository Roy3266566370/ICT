"""T06：分支事务、版本冲突与幂等。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.models import MaterialRecord, SessionRecord
from app.ppt_ai.branches import BranchConflict, create_branch, patch_branch
from app.ppt_ai.types import CanonicalValues
from tests.ppt_ai import helpers


@pytest.fixture
def db_factory(tmp_path: Path):
    engine = create_engine("sqlite:///" + (tmp_path / "branches.db").as_posix(), future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    now = datetime.now(tz=timezone.utc).replace(microsecond=0)
    with factory() as db:
        db.add(
            SessionRecord(
                id="ses_test",
                csrf_token="x" * 16,
                created_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                expires_at=(now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                retention_hours=24,
            )
        )
        db.add(
            MaterialRecord(
                id="mat_branch",
                session_id="ses_test",
                title="分支测试",
                status="ready",
                page_count=1,
                candidates=[],
                created_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                expires_at=(now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            )
        )
        db.commit()
    return factory


def _bundle():
    _extraction, _plan, bundle = helpers.bundle_for(helpers.expression_snapshot("mat_branch"))
    return bundle


def test_branch_patch_increments_revision_and_conflicts(db_factory) -> None:
    bundle = _bundle()
    with db_factory() as db:
        branch = create_branch(db, session_id="ses_test", material_id="mat_branch", bundle=bundle)
        db.commit()
        assert branch.revision == 1
        concept = next(iter(bundle.seed_values))
        updated = patch_branch(
            db,
            branch,
            bundle,
            expected_revision=1,
            operation_id="op_1",
            values={concept: 2},
        )
        assert updated.revision == 2
        # 幂等：同一个 operation_id 不重复增加 revision
        again = patch_branch(
            db,
            updated,
            bundle,
            expected_revision=2,
            operation_id="op_1",
            values={concept: 3},
        )
        assert again.revision == 2
    # 两个窗口都从 revision 2 开始，后提交者冲突
    with db_factory() as first, db_factory() as second:
        from app.db.ppt_ai_models import PptAiBranchRecord

        row_a = first.get(PptAiBranchRecord, branch.id)
        row_b = second.get(PptAiBranchRecord, branch.id)
        patch_branch(first, row_a, bundle, expected_revision=2, operation_id="op_a", values={concept: 4})
        with pytest.raises(BranchConflict):
            patch_branch(second, row_b, bundle, expected_revision=2, operation_id="op_b", values={concept: 5})


def test_branch_overrides_persist_and_affect_snapshot(db_factory) -> None:
    from app.ppt_ai.branches import to_state
    from app.ppt_ai.evaluation import evaluate_model

    bundle = _bundle()
    node_id = bundle.compiled.nodes[0].node_id
    concept = next(iter(bundle.seed_values))
    with db_factory() as db:
        branch = create_branch(db, session_id="ses_test", material_id="mat_branch", bundle=bundle)
        db.commit()
        updated = patch_branch(
            db,
            branch,
            bundle,
            expected_revision=1,
            operation_id="op_override",
            values={},
            overrides={node_id: {concept: 2}},
        )
        assert updated.revision == 2
        assert getattr(updated, "overrides_json") == {node_id: {concept: 2}}
        state = to_state(updated)
        assert state.overrides == {node_id: {concept: 2}}
        expected = evaluate_model(
            bundle, updated.canonical_values, overrides=updated.overrides_json
        )
        assert updated.evaluation["evaluation_hash"] == expected.evaluation_hash


def test_original_branch_values_are_unchanged_by_candidate(db_factory) -> None:
    bundle = _bundle()
    with db_factory() as db:
        parent = create_branch(db, session_id="ses_test", material_id="mat_branch", bundle=bundle)
        db.commit()
        concept = next(iter(bundle.seed_values))
        candidate = create_branch(
            db,
            session_id="ses_test",
            material_id="mat_branch",
            bundle=bundle,
            values={concept: 3},
            parent_branch_id=parent.id,
            status="candidate",
        )
        db.commit()
        assert parent.canonical_values[concept] == 1
        assert candidate.canonical_values[concept] == 3
        assert candidate.parent_branch_id == parent.id


def test_branch_kind_and_title_are_persisted(db_factory) -> None:
    from app.ppt_ai.branches import to_state
    from app.ppt_ai.store import baseline_branch_row, list_practice_branches

    bundle = _bundle()
    with db_factory() as db:
        baseline = create_branch(
            db,
            session_id="ses_test",
            material_id="mat_branch",
            bundle=bundle,
            status="active",
            kind="baseline",
            title="课件基准",
        )
        practice = create_branch(
            db,
            session_id="ses_test",
            material_id="mat_branch",
            bundle=bundle,
            parent_branch_id=baseline.id,
            status="active",
            kind="practice",
            title="第 1 页 · 函数探索",
            learning={"node_id": "ain_1", "page_no": 1},
        )
        candidate = create_branch(
            db,
            session_id="ses_test",
            material_id="mat_branch",
            bundle=bundle,
            parent_branch_id=baseline.id,
            status="candidate",
            title="反求候选",
        )
        db.commit()
        state = to_state(practice)
        assert state.kind == "practice"
        assert state.title == "第 1 页 · 函数探索"
        assert state.learning["node_id"] == "ain_1"
        assert to_state(candidate).kind == "candidate"
        assert baseline_branch_row(db, bundle.bundle_id, "ses_test", "mat_branch").id == baseline.id
        practices = list_practice_branches(db, "ses_test", "mat_branch")
        assert [item.id for item in practices] == [practice.id]


def test_client_cannot_self_report_baseline_through_learning_route() -> None:
    """创建练习的公开服务固定 kind=practice，不接受客户端自报 baseline。"""

    from app.ppt_ai.learning_practices import PracticeError, validate_practice_kind

    validate_practice_kind("practice")
    with pytest.raises(PracticeError):
        validate_practice_kind("baseline")

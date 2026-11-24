"""T11：PPT AI 私有 API 的完整工作流与安全边界。"""

from __future__ import annotations

import os
import shutil
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

import pytest

_TMP_DIR = Path(tempfile.mkdtemp(prefix="xiangsheng-ppt-ai-api-"))
os.environ["DATABASE_URL"] = "sqlite:///" + (_TMP_DIR / "test.db").as_posix()
os.environ["SESSION_COOKIE_SECURE"] = "false"
os.environ["ENFORCE_CSRF"] = "true"
os.environ["PPT_AI_ENABLED"] = "true"
os.environ["PPT_AI_GENERATED_VIEWS_ENABLED"] = "false"
os.environ["LLM_PROVIDER"] = "none"
os.environ["LLM_API_KEY"] = ""

from fastapi.testclient import TestClient  # noqa: E402

from app.db.models import MaterialRecord  # noqa: E402
from app.db.session import reset_engine_cache, session_scope  # noqa: E402
from app.ppt_ai import pipeline  # noqa: E402
from app.schemas.common import to_iso, utc_now  # noqa: E402
from app.settings import get_settings  # noqa: E402
from tests.ppt_ai import helpers  # noqa: E402

get_settings.cache_clear()
reset_engine_cache()

from app.main import create_app  # noqa: E402

MATERIAL_ID = "mat_pptai_api"
_SNAPSHOT = helpers.expression_snapshot(MATERIAL_ID)


def _session(client: TestClient) -> dict[str, Any]:
    response = client.post("/api/v1/sessions")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _headers(session: dict[str, Any]) -> dict[str, str]:
    return {"X-CSRF-Token": str(session["csrf_token"])}


def _wait(client: TestClient, task_id: str, material_id: str = MATERIAL_ID) -> dict[str, Any]:
    for _ in range(120):
        response = client.get(f"/api/v1/materials/{material_id}/ai-tasks/{task_id}")
        assert response.status_code == 200, response.text
        task = response.json()["data"]
        if task["status"] in ("succeeded", "needs_review", "failed", "superseded"):
            return task
        time.sleep(0.08)
    raise AssertionError("任务等待超时")


@pytest.fixture(scope="module")
def app(offline_ppt_ai_models: pytest.MonkeyPatch) -> Any:
    offline_ppt_ai_models.setattr(pipeline, "_snapshot", lambda material: _SNAPSHOT.model_copy(
        update={"material_id": material.id, "title": material.title}
    ))
    return create_app()


@pytest.fixture
def owner(app: Any) -> Iterator[TestClient]:
    with TestClient(app) as client:
        session = _session(client)
        now = datetime.now(tz=timezone.utc).replace(microsecond=0)
        with session_scope() as db:
            if db.get(MaterialRecord, MATERIAL_ID) is None:
                db.add(
                    MaterialRecord(
                        id=MATERIAL_ID,
                        session_id=session["session_id"],
                        title="API 测试",
                        status="ready",
                        page_count=1,
                        candidates=[],
                        created_at=to_iso(utc_now()),
                        expires_at=(now + timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
                    )
                )
        yield client


@pytest.fixture
def guest(app: Any) -> Iterator[TestClient]:
    with TestClient(app) as client:
        _session(client)
        yield client


@pytest.fixture(scope="module", autouse=True)
def _cleanup() -> Iterator[None]:
    yield
    shutil.rmtree(_TMP_DIR, ignore_errors=True)


def test_ppt_ai_full_workflow(owner: TestClient) -> None:
    session = owner.get("/api/v1/sessions/current").json()["data"]
    headers = _headers(session)
    material_url = f"/api/v1/materials/{MATERIAL_ID}"

    # 缺 CSRF 的写请求被拒绝
    assert owner.post(f"{material_url}/ai-plans", json={"operation_id": "no_csrf"}).status_code == 422

    created = owner.post(f"{material_url}/ai-plans", headers=headers, json={"operation_id": "plan_api", "expected_document_revision": 0})
    assert created.status_code == 202, created.text
    plan_task = _wait(owner, created.json()["data"]["task_id"])
    assert plan_task["status"] == "succeeded"
    plan_id = plan_task["result"]["plan_id"]

    plan = owner.get(f"{material_url}/ai-plans/{plan_id}", headers=headers).json()["data"]
    option_id = plan["options"][0]["option_id"]
    applied = owner.post(
        f"{material_url}/ai-plans/{plan_id}/apply",
        headers=headers,
        json={
            "expected_plan_revision": 1,
            "expected_document_revision": 0,
            "operation_id": "apply_api",
            "selected_option_ids": [option_id],
            "parameter_overrides": {option_id: {"x": {"value": 1, "min": -3, "max": 3}}},
        },
    )
    assert applied.status_code == 202, applied.text
    apply_task = _wait(owner, applied.json()["data"]["task_id"])
    assert apply_task["status"] == "succeeded", apply_task
    bundle_id = apply_task["result"]["bundle_id"]
    branch_id = apply_task["result"]["branch_id"]

    bundle = owner.get(f"{material_url}/ai-bundles/{bundle_id}", headers=headers).json()["data"]
    assert bundle["compiled"]["nodes"]
    node = bundle["compiled"]["nodes"][0]
    concept = next(parameter["concept_id"] for parameter in node["parameters"] if parameter["id"] == "x")
    assert concept in bundle["seed_values"]

    branch = owner.get(f"{material_url}/ai-branches/{branch_id}", headers=headers).json()["data"]
    patched = owner.patch(
        f"{material_url}/ai-branches/{branch_id}",
        headers=headers,
        json={"expected_revision": branch["revision"], "operation_id": "branch_api", "values": {concept: 2}},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["data"]["revision"] == branch["revision"] + 1
    conflict = owner.patch(
        f"{material_url}/ai-branches/{branch_id}",
        headers=headers,
        json={"expected_revision": branch["revision"], "operation_id": "branch_api_2", "values": {concept: 3}},
    )
    assert conflict.status_code == 409

    experiment = owner.post(
        f"{material_url}/ai-bundles/{bundle_id}/experiments",
        headers=headers,
        json={
            "branch_id": branch_id,
            "expected_branch_revision": branch["revision"] + 1,
            "operation_id": "experiment_api",
            "question": "比较不同输入下的结果差异",
            "recipe_hint": "compare",
            "selection": {"node_id": node["node_id"], "output": "value"},
            "allowed_variables": [concept],
            "ranges": {concept: [0, 3]},
        },
    )
    assert experiment.status_code == 202, experiment.text
    experiment_task = _wait(owner, experiment.json()["data"]["task_id"])
    assert experiment_task["status"] == "succeeded", experiment_task
    experiment_id = experiment_task["result"]["experiment_id"]
    detail = owner.get(f"{material_url}/ai-experiments/{experiment_id}", headers=headers).json()["data"]
    assert detail["result"]["status"] in ("found", "not_found_in_scope")
    assert detail["result"]["branch_id"]

    target = owner.post(
        f"{material_url}/ai-bundles/{bundle_id}/target-search",
        headers=headers,
        json={
            "branch_id": branch_id,
            "expected_branch_revision": branch["revision"] + 1,
            "operation_id": "target_api",
            "node_id": node["node_id"],
            "output": "value",
            "target_value": 4,
            "variables": [concept],
            "ranges": {concept: [0, 3]},
            "tolerance": 1e-6,
        },
    )
    assert target.status_code == 202, target.text
    target_task = _wait(owner, target.json()["data"]["task_id"])
    assert target_task["status"] == "succeeded", target_task
    assert target_task["result"]["status"] == "found"

    verify = owner.post(
        f"{material_url}/ai-bundles/{bundle_id}/validate",
        headers=headers,
        json={
            "branch_id": branch_id,
            "expected_branch_revision": branch["revision"] + 1,
            "operation_id": "verification_api",
            "auto_repair": True,
        },
    )
    assert verify.status_code == 202, verify.text
    verify_task = _wait(owner, verify.json()["data"]["task_id"])
    assert verify_task["status"] == "succeeded"
    report_id = verify_task["result"]["report_id"]
    report = owner.get(f"{material_url}/ai-reports/{report_id}", headers=headers).json()["data"]
    assert report["status"] in ("passed", "needs_review", "failed")
    assert report["browser"]["status"] == "skipped"

    # 专用视图开关关闭
    generated = owner.post(
        f"{material_url}/ai-bundles/{bundle_id}/generated-views",
        headers=headers,
        json={"branch_id": branch_id, "node_id": node["node_id"], "requirement": "面积视图", "operation_id": "codegen_api"},
    )
    assert generated.status_code == 403

    active = owner.get(f"{material_url}/ai-active", headers=headers).json()["data"]
    assert active["bundle"]["bundle_id"] == bundle_id

    published = owner.post(f"{material_url}/publish", headers=headers)
    assert published.status_code == 201, published.text
    share_id = published.json()["data"]["share_id"]
    snapshot = owner.get(f"/api/v1/p/{share_id}").json()["data"]
    assert snapshot["ppt_ai"] is not None
    assert "session" not in str(snapshot["ppt_ai"]).lower() or "session_id" not in str(snapshot["ppt_ai"])


def test_other_session_cannot_read_ppt_ai(owner: TestClient, guest: TestClient) -> None:
    response = guest.get(f"/api/v1/materials/{MATERIAL_ID}/ai-overview")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "SESSION_EXPIRED"


def test_apply_without_selected_ids_uses_default_selection(owner: TestClient, monkeypatch) -> None:
    """省略 selected_option_ids 时必须按默认选择编译，而不是编译 0 节点。"""

    monkeypatch.setattr(
        pipeline,
        "_snapshot",
        lambda material: helpers.chart_snapshot(material.id),
    )
    session = owner.get("/api/v1/sessions/current").json()["data"]
    headers = _headers(session)
    material_id = "mat_default_apply_api"
    now = datetime.now(tz=timezone.utc).replace(microsecond=0)
    with session_scope() as db:
        if db.get(MaterialRecord, material_id) is None:
            db.add(MaterialRecord(
                id=material_id, session_id=str(session["session_id"]), title="默认选择测试",
                status="ready", page_count=1, candidates=[],
                created_at=to_iso(utc_now()),
                expires_at=(now + timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
            ))
    created = owner.post(
        f"/api/v1/materials/{material_id}/ai-plans",
        headers=headers,
        json={"operation_id": "default.select.plan", "expected_document_revision": 0},
    )
    assert created.status_code == 202, created.text
    plan_task = _wait(owner, created.json()["data"]["task_id"], material_id)
    assert plan_task["status"] == "succeeded", plan_task
    result = plan_task["result"]
    assert result["supported"] >= 1, result
    applied = owner.post(
        f"/api/v1/materials/{material_id}/ai-plans/{result['plan_id']}/apply",
        headers=headers,
        json={
            "operation_id": "default.select.apply",
            "expected_plan_revision": result["plan_revision"],
            "expected_document_revision": 0,
        },
    )
    assert applied.status_code == 202, applied.text
    apply_task = _wait(owner, applied.json()["data"]["task_id"], material_id)
    assert apply_task["status"] == "succeeded", apply_task
    assert apply_task["result"]["node_count"] >= 1, apply_task["result"]


def test_apply_empty_plan_is_rejected(owner: TestClient) -> None:
    """区域过滤未命中产生的空规划不得编译成 0 节点 bundle。"""

    from app.ppt_ai.store import save_plan
    from app.ppt_ai.types import InteractionPlan

    session = owner.get("/api/v1/sessions/current").json()["data"]
    material_id = "mat_empty_plan_api"
    snapshot = _SNAPSHOT.model_copy(update={"material_id": material_id})
    with session_scope() as db:
        if db.get(MaterialRecord, material_id) is None:
            now = datetime.now(tz=timezone.utc).replace(microsecond=0)
            db.add(MaterialRecord(
                id=material_id, session_id=str(session["session_id"]), title="空规划测试",
                status="ready", page_count=1, candidates=[],
                created_at=to_iso(utc_now()),
                expires_at=(now + timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
            ))
        save_plan(
            db,
            session_id=str(session["session_id"]),
            material_id=material_id,
            plan=InteractionPlan(
                plan_id="pln_empty_api",
                material_id=material_id,
                source_revision=snapshot.document_revision,
                source_hash=snapshot.source_hash,
                options=[],
                coverage=[],
                issues=[],
                budget={},
                created_at="2026-11-09T00:00:00Z",
            ),
        )
    response = owner.post(
        f"/api/v1/materials/{material_id}/ai-plans/pln_empty_api/apply",
        headers=_headers(session),
        json={"operation_id": "empty.plan.apply", "expected_plan_revision": 1},
    )
    assert response.status_code == 422, response.text
    detail = response.json()["error"]
    assert detail["code"] == "MISSING_FIELD"
    assert "规划中没有可编译方案" in detail["message"]


def test_ispec_endpoint_exposes_recognition_coverage(owner: TestClient) -> None:
    """0 条 iSpec 时前端仍能拿到覆盖说明与分页统计。"""

    from app.api.routes_jobs import write_ispec_payload

    session = owner.get("/api/v1/sessions/current").json()["data"]
    material_id = "mat_coverage_api"
    with session_scope() as db:
        if db.get(MaterialRecord, material_id) is None:
            now = datetime.now(tz=timezone.utc).replace(microsecond=0)
            db.add(MaterialRecord(
                id=material_id, session_id=session["session_id"], title="覆盖说明测试",
                status="ready", page_count=1, candidates=[],
                created_at=to_iso(utc_now()),
                expires_at=(now + timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
            ))
    path = write_ispec_payload(
        material_id,
        {
            "schema_version": "1.0",
            "material_id": material_id,
            "ispecs": [],
            "recognition": {
                "found": False,
                "reason": "未识别到交互区域：本页为文字/位图内容",
                "coverage": {"pages": 1, "pages_text_only": 1, "images": 2},
            },
        },
    )
    try:
        response = owner.get(f"/api/v1/materials/{material_id}/ispecs")
        assert response.status_code == 200, response.text
        recognition = response.json()["data"]["recognition"]
        assert recognition["found"] is False
        assert "文字/位图" in recognition["reason"]
        assert recognition["coverage"]["images"] == 2
    finally:
        path.unlink(missing_ok=True)
        with session_scope() as db:
            row = db.get(MaterialRecord, material_id)
            if row is not None:
                db.delete(row)


def test_unknown_route_is_distinguishable_from_ownership_failure(owner: TestClient) -> None:
    """路径错误与归属失败都是 404，但错误码/文案必须能区分。"""

    missing = owner.get("/api/v1/definitely-not-a-route")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "MISSING_FIELD"
    assert "接口不存在" in missing.json()["error"]["message"]

    wrong_prefix = owner.post(
        f"/api/v1/ppt-ai/materials/{MATERIAL_ID}/ai-plans",
        json={"operation_id": "wrong_prefix"},
    )
    assert wrong_prefix.status_code == 404
    detail = wrong_prefix.json()["error"]
    assert detail["code"] == "MISSING_FIELD"
    assert "/api/v1/materials/{material_id}/ai-*" in detail["message"]


def test_ispec_trust_confirmation_can_turn_yellow_green(owner: TestClient) -> None:
    """确认推断参数后 TrustReport 从黄色变为绿色；锚点必须仍在原文中。"""
    from app.api.routes_jobs import write_ispec_payload

    session = owner.get("/api/v1/sessions/current").json()["data"]
    material_id = "mat_trust_confirm_test"
    with session_scope() as db:
        if db.get(MaterialRecord, material_id) is None:
            now = datetime.now(tz=timezone.utc).replace(microsecond=0)
            db.add(MaterialRecord(
                id=material_id, session_id=session["session_id"], title="可信确认测试",
                status="ready", page_count=1, candidates=[],
                created_at=to_iso(utc_now()),
                expires_at=(now + timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
            ))
    page_text = "矩阵 [[1, 0], [0, 1]]，det = 1。"
    payload = {
        "schema_version": "1.0",
        "material_id": material_id,
        "ispecs": [
            {
                "spec_version": "1.0",
                "object_id": "spec_trust_confirm",
                "title": "可信确认测试",
                "kind": "geometric",
                "parameters": [
                    {
                        "id": key,
                        "label": key,
                        "type": "number",
                        "default": value,
                        "source": {
                            "page": 1,
                            "element_id": "e1",
                            "bbox": None,
                            "status": "inferred",
                            "excerpt": "矩阵 [[1, 0], [0, 1]]",
                        },
                    }
                    for key, value in (("a", 1.0), ("b", 0.0), ("c", 0.0), ("d", 1.0))
                ],
                "expressions": [{"id": "det", "expr": "a*d-b*c"}],
                "views": [{"type": "text", "template": "det = {{det}}"}],
            }
        ],
        "page_layouts": [
            {
                "page_no": 1,
                "width": 12192000,
                "height": 6858000,
                "title": "第 1 页",
                "elements": [{"element_id": "e1", "text": page_text}],
            }
        ],
    }
    path = write_ispec_payload(material_id, payload)
    try:
        material = owner.get(f"/api/v1/materials/{material_id}")
        assert material.status_code == 200, material.text
        spec = material.json()["data"]["ispecs"][0]
        assert spec["trust"]["level"] == "yellow"
        headers = {"X-CSRF-Token": str(session["csrf_token"])}
        for parameter in spec["parameters"]:
            response = owner.post(
                f"/api/v1/materials/{material_id}/ispecs/spec_trust_confirm/parameters/{parameter['id']}/confirm",
                headers=headers,
                json={"action": "confirm", "note": "测试确认"},
            )
            assert response.status_code == 200, response.text
        repeated = owner.post(
            f"/api/v1/materials/{material_id}/ispecs/spec_trust_confirm/parameters/a/confirm",
            headers=headers,
            json={"action": "confirm", "note": "同值重复确认"},
        )
        assert repeated.status_code == 200, repeated.text
        repeated_checks = repeated.json()["data"]["trust"]["parameters"][0]["user_checks"]
        assert len(repeated_checks) == 1, repeated_checks
        material = owner.get(f"/api/v1/materials/{material_id}")
        confirmed = material.json()["data"]["ispecs"][0]
        assert confirmed["trust"]["level"] == "green"
        assert all(item["status"] == "confirmed" for item in confirmed["trust"]["parameters"])
    finally:
        path.unlink(missing_ok=True)
        with session_scope() as db:
            row = db.get(MaterialRecord, material_id)
            if row is not None:
                db.delete(row)


# ---------------------------------------------------------------------------
# A1/A2/B1：关联确认的分支值迁移、拒绝不重建分支、bundle 回退（可逆决策）
# ---------------------------------------------------------------------------

_TWO_PAGE_SNAPSHOT = helpers.snapshot(
    MATERIAL_ID,
    hash_char="1",
    pages=[
        {
            "page_no": 1,
            "width": helpers.PAGE_W,
            "height": helpers.PAGE_H,
            "elements": [helpers.element("e1", "text", text="∫_0^1 x dx")],
        },
        {
            "page_no": 2,
            "width": helpers.PAGE_W,
            "height": helpers.PAGE_H,
            "elements": [helpers.element("e2", "text", text="∫_0^2 x dx")],
        },
    ],
)


def _register_material(headers_session: dict, material_id: str) -> None:
    """按当前会话注册一个临时材料（共享 MATERIAL_ID 属于首个会话）。"""

    now = datetime.now(tz=timezone.utc).replace(microsecond=0)
    with session_scope() as db:
        if db.get(MaterialRecord, material_id) is None:
            db.add(
                MaterialRecord(
                    id=material_id,
                    session_id=str(headers_session["session_id"]),
                    title="关联链路测试",
                    status="ready",
                    page_count=2,
                    candidates=[],
                    created_at=to_iso(utc_now()),
                    expires_at=(now + timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
                )
            )


def _apply_two_page_bundle(
    owner: TestClient, headers: dict[str, str], material_id: str, operation: str
) -> tuple[str, str]:
    """规划并编译一个两页积分 bundle（存在同名参数合并候选）。"""

    original = pipeline._snapshot
    pipeline._snapshot = lambda material: _TWO_PAGE_SNAPSHOT.model_copy(
        update={"material_id": material.id, "title": material.title}
    )
    try:
        created = owner.post(
            f"/api/v1/materials/{material_id}/ai-plans",
            headers=headers,
            json={"operation_id": f"plan_{operation}", "expected_document_revision": 0},
        )
        assert created.status_code == 202, created.text
        task = _wait(owner, created.json()["data"]["task_id"], material_id)
        assert task["status"] == "succeeded", task
        plan_id = task["result"]["plan_id"]
        plan = owner.get(
            f"/api/v1/materials/{material_id}/ai-plans/{plan_id}", headers=headers
        ).json()["data"]
        applied = owner.post(
            f"/api/v1/materials/{material_id}/ai-plans/{plan_id}/apply",
            headers=headers,
            json={
                "expected_plan_revision": 1,
                "expected_document_revision": 0,
                "operation_id": f"apply_{operation}",
                "selected_option_ids": [option["option_id"] for option in plan["options"]],
            },
        )
        assert applied.status_code == 202, applied.text
        apply_task = _wait(owner, applied.json()["data"]["task_id"], material_id)
        assert apply_task["status"] == "succeeded", apply_task
        return apply_task["result"]["bundle_id"], apply_task["result"]["branch_id"]
    finally:
        pipeline._snapshot = original


def _same_parameter_candidate(bundle: dict) -> dict:
    """挑一个数值型合并候选（整数参数不便用于调参断言）。"""

    return next(
        item
        for item in bundle["graph"]["candidates"]
        if item["relation_type"] != "derived_from"
        and item["occurrences"]
        and all(item.get("type") == "number" for item in item["occurrences"])
    )


def test_confirm_link_migrates_tuned_branch_values(owner: TestClient) -> None:
    session = owner.get("/api/v1/sessions/current").json()["data"]
    headers = _headers(session)
    material_id = "mat_link_migrate_api"
    _register_material(session, material_id)
    material_url = f"/api/v1/materials/{material_id}"
    bundle_id, branch_id = _apply_two_page_bundle(owner, headers, material_id, "migrate")
    bundle = owner.get(f"{material_url}/ai-bundles/{bundle_id}", headers=headers).json()["data"]
    candidate = _same_parameter_candidate(bundle)
    chosen = candidate["left_concept_id"]
    # 用户在分支上把保留概念的值调到 1.5（revision 2）。
    tuned = owner.patch(
        f"{material_url}/ai-branches/{branch_id}",
        headers=headers,
        json={"expected_revision": 1, "operation_id": "tune_migrate", "values": {chosen: 1.5}},
    )
    assert tuned.status_code == 200, tuned.text
    confirmed = owner.post(
        f"{material_url}/ai-bundles/{bundle_id}/links",
        headers=headers,
        json={
            "expected_bundle_revision": bundle["bundle_revision"],
            "operation_id": "confirm_migrate",
            "decisions": [
                {
                    "candidate_id": candidate["candidate_id"],
                    "decision": "confirm",
                    "concept_id": chosen,
                }
            ],
            "branch_id": branch_id,
        },
    )
    assert confirmed.status_code == 201, confirmed.text
    payload = confirmed.json()["data"]
    assert payload["bundle_id"] != bundle_id
    assert payload["branch_id"]
    assert payload["branch_id"] != branch_id
    new_branch = owner.get(
        f"{material_url}/ai-branches/{payload['branch_id']}", headers=headers
    ).json()["data"]
    assert new_branch["bundle_id"] == payload["bundle_id"]
    # A1：已调参数必须迁移到新分支，而不是被重置回种子值。
    assert new_branch["canonical_values"].get(chosen) == pytest.approx(1.5)
    # 合并后两页参数共享保留概念。
    new_bundle = owner.get(
        f"{material_url}/ai-bundles/{payload['bundle_id']}", headers=headers
    ).json()["data"]
    concepts = {
        parameter["concept_id"]
        for node in new_bundle["compiled"]["nodes"]
        for parameter in node["parameters"]
    }
    assert chosen in concepts


def test_reject_link_repoints_branch_without_rebuilding(owner: TestClient) -> None:
    session = owner.get("/api/v1/sessions/current").json()["data"]
    headers = _headers(session)
    material_id = "mat_link_reject_api"
    _register_material(session, material_id)
    material_url = f"/api/v1/materials/{material_id}"
    bundle_id, branch_id = _apply_two_page_bundle(owner, headers, material_id, "reject")
    bundle = owner.get(f"{material_url}/ai-bundles/{bundle_id}", headers=headers).json()["data"]
    candidate = _same_parameter_candidate(bundle)
    tuned = owner.patch(
        f"{material_url}/ai-branches/{branch_id}",
        headers=headers,
        json={
            "expected_revision": 1,
            "operation_id": "tune_reject",
            "values": {candidate["left_concept_id"]: 1.5},
            "overrides": {},
        },
    )
    assert tuned.status_code == 200, tuned.text
    rejected = owner.post(
        f"{material_url}/ai-bundles/{bundle_id}/links",
        headers=headers,
        json={
            "expected_bundle_revision": bundle["bundle_revision"],
            "operation_id": "reject_link",
            "decisions": [
                {"candidate_id": candidate["candidate_id"], "decision": "reject"}
            ],
            "branch_id": branch_id,
        },
    )
    assert rejected.status_code == 201, rejected.text
    payload = rejected.json()["data"]
    # 拒绝不重建分支：同一分支原样挂到新 bundle，revision 与已调值都保留。
    assert payload["branch_id"] == branch_id
    branch = owner.get(
        f"{material_url}/ai-branches/{branch_id}", headers=headers
    ).json()["data"]
    assert branch["bundle_id"] == payload["bundle_id"]
    assert branch["revision"] == 2
    assert branch["canonical_values"].get(candidate["left_concept_id"]) == pytest.approx(1.5)
    overview = owner.get(f"{material_url}/ai-overview", headers=headers).json()["data"]
    assert overview["bundle"]["bundle_id"] == payload["bundle_id"]
    assert any(item["branch_id"] == branch_id for item in overview["branches"])
    # 拒绝的候选不再出现。
    assert all(
        item["candidate_id"] != candidate["candidate_id"]
        for item in overview["bundle"]["graph"]["candidates"]
    )


def test_revert_bundle_undoes_last_link_batch(owner: TestClient) -> None:
    session = owner.get("/api/v1/sessions/current").json()["data"]
    headers = _headers(session)
    material_id = "mat_link_revert_api"
    _register_material(session, material_id)
    material_url = f"/api/v1/materials/{material_id}"
    bundle_id, _branch_id = _apply_two_page_bundle(owner, headers, material_id, "revert")
    bundle = owner.get(f"{material_url}/ai-bundles/{bundle_id}", headers=headers).json()["data"]
    candidate = _same_parameter_candidate(bundle)
    confirmed = owner.post(
        f"{material_url}/ai-bundles/{bundle_id}/links",
        headers=headers,
        json={
            "expected_bundle_revision": bundle["bundle_revision"],
            "operation_id": "confirm_revert",
            "decisions": [
                {
                    "candidate_id": candidate["candidate_id"],
                    "decision": "confirm",
                    "concept_id": candidate["left_concept_id"],
                }
            ],
        },
    )
    assert confirmed.status_code == 201, confirmed.text
    new_bundle_id = confirmed.json()["data"]["bundle_id"]
    overview = owner.get(f"{material_url}/ai-overview", headers=headers).json()["data"]
    assert overview["bundle"]["bundle_id"] == new_bundle_id
    reverted = owner.post(
        f"{material_url}/ai-bundles/{new_bundle_id}/revert",
        headers=headers,
        json={
            "expected_bundle_revision": bundle["bundle_revision"] + 1,
            "operation_id": "revert_links",
            "target_bundle_id": bundle_id,
        },
    )
    assert reverted.status_code == 200, reverted.text
    assert reverted.json()["data"]["bundle_id"] == bundle_id
    overview = owner.get(f"{material_url}/ai-overview", headers=headers).json()["data"]
    # 总览回到旧 bundle，候选重新可见（决策可逆）。
    assert overview["bundle"]["bundle_id"] == bundle_id
    assert any(
        item["candidate_id"] == candidate["candidate_id"]
        for item in overview["bundle"]["graph"]["candidates"]
    )
    # 回退后旧的 bundle 不再活跃：expected revision 校验以新活跃 bundle 为准。
    stale = owner.post(
        f"{material_url}/ai-bundles/{new_bundle_id}/revert",
        headers=headers,
        json={
            "expected_bundle_revision": bundle["bundle_revision"] + 1,
            "operation_id": "revert_stale",
            "target_bundle_id": bundle_id,
        },
    )
    assert stale.status_code == 409

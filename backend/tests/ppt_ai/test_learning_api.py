"""T04—T09：学习投影、讲解、提问、执行与个人练习的 API 闭环。"""

from __future__ import annotations

import os
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

import pytest

_TMP_DIR = Path(tempfile.mkdtemp(prefix="xiangsheng-learning-api-"))
os.environ["DATABASE_URL"] = "sqlite:///" + (_TMP_DIR / "test.db").as_posix()
os.environ["SESSION_COOKIE_SECURE"] = "false"
os.environ["ENFORCE_CSRF"] = "true"
os.environ["PPT_AI_ENABLED"] = "true"
os.environ["PPT_AI_LEARNING_ENABLED"] = "true"
os.environ["PPT_AI_GENERATED_VIEWS_ENABLED"] = "false"
os.environ["LLM_PROVIDER"] = "none"
os.environ["LLM_API_KEY"] = ""

from fastapi.testclient import TestClient  # noqa: E402

from app.db.models import MaterialRecord  # noqa: E402
from app.db.session import reset_engine_cache, session_scope  # noqa: E402
from app.ppt_ai import learning  # noqa: E402
from app.schemas.common import to_iso, utc_now  # noqa: E402
from app.settings import get_settings  # noqa: E402
from tests.ppt_ai import helpers  # noqa: E402

get_settings.cache_clear()
reset_engine_cache()

from app.main import create_app  # noqa: E402

MATERIAL_ID = "mat_learning_api"
_SNAPSHOT = helpers.matrix_snapshot(MATERIAL_ID, "A = [[2,1],[1,2]]，v = (4,3)")


def _session(client: TestClient) -> dict[str, Any]:
    response = client.post("/api/v1/sessions")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _headers(session: dict[str, Any]) -> dict[str, str]:
    return {"X-CSRF-Token": str(session["csrf_token"])}


def _wait(client: TestClient, task_id: str) -> dict[str, Any]:
    for _ in range(160):
        response = client.get(f"/api/v1/materials/{MATERIAL_ID}/ai-tasks/{task_id}")
        assert response.status_code == 200, response.text
        task = response.json()["data"]
        if task["status"] in ("succeeded", "needs_review", "failed", "superseded"):
            return task
        time.sleep(0.05)
    raise AssertionError("任务等待超时")


@pytest.fixture(scope="module")
def app() -> Any:
    learning._snapshot = lambda material: _SNAPSHOT.model_copy(
        update={"material_id": material.id, "title": material.title}
    )
    return create_app()


@pytest.fixture(scope="module")
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
                        title="学习 API 测试",
                        status="ready",
                        page_count=1,
                        candidates=[],
                        created_at=to_iso(utc_now()),
                        expires_at=(now + timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
                    )
                )
        client.session = session  # type: ignore[attr-defined]
        yield client


def _prepare(client: TestClient) -> dict[str, Any]:
    session = client.session  # type: ignore[attr-defined]
    response = client.post(
        f"/api/v1/materials/{MATERIAL_ID}/ai-learning/prepare",
        headers=_headers(session),
        json={"operation_id": "op_prepare_1"},
    )
    assert response.status_code == 202, response.text
    task = _wait(client, response.json()["data"]["task_id"])
    assert task["status"] == "succeeded", task
    return task["result"]


def _page(client: TestClient, node_id: str | None = None) -> dict[str, Any]:
    url = f"/api/v1/materials/{MATERIAL_ID}/ai-learning?page_no=1"
    if node_id:
        url += f"&node_id={node_id}"
    response = client.get(url)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _context(
    page: dict[str, Any],
    item: dict[str, Any],
    *,
    values: dict[str, Any] | None = None,
    draft_revision: int = 0,
    request_id: str = "req_1",
) -> dict[str, Any]:
    return {
        "document_revision": page["document_revision"],
        "source_hash": page["source_hash"],
        "bundle_id": page["bundle_id"],
        "bundle_revision": page["bundle_revision"],
        "page_no": page["page_no"],
        "node_id": item["node_id"],
        "region_id": item["region_id"],
        "branch_id": page["branch_id"],
        "branch_revision": page["branch_revision"],
        "draft_revision": draft_revision,
        "client_request_id": request_id,
        "input_values": values or {},
        "input_hash": None,
    }


def test_learning_page_projection_prepare_and_read(owner: TestClient) -> None:
    page = _page(owner)
    assert page["state"] == "unprepared"
    assert page["items"] == []
    assert page["capabilities"]["can_ask_online"] is True
    result = _prepare(owner)
    assert result["node_count"] >= 1
    page = _page(owner)
    assert page["state"] == "ready"
    assert page["bundle_id"]
    assert page["branch_kind"] == "baseline"
    item = page["items"][0]
    assert item["descriptor"]["goal_id"] in ("eigen_direction", "inverse_mapping")
    assert all("material_id" not in ref or ref["material_id"] == MATERIAL_ID for ref in item["descriptor"]["source_refs"])
    # GET 不产生模型调用或新任务
    tasks_before = owner.get(f"/api/v1/materials/{MATERIAL_ID}/ai-overview").json()["data"]["branches"]
    _page(owner)
    tasks_after = owner.get(f"/api/v1/materials/{MATERIAL_ID}/ai-overview").json()["data"]["branches"]
    assert tasks_before == tasks_after


def test_explanation_question_and_answer_card(owner: TestClient) -> None:
    _prepare(owner)
    page = _page(owner)
    item = page["items"][0]
    session = owner.session  # type: ignore[attr-defined]
    context = _context(page, item, request_id="req_explain")
    response = owner.post(
        f"/api/v1/materials/{MATERIAL_ID}/ai-learning/explanations",
        headers=_headers(session),
        json={"context": context, "mode": "concept", "operation_id": "op_explain_1"},
    )
    assert response.status_code == 202, response.text
    task = _wait(owner, response.json()["data"]["task_id"])
    assert task["status"] == "succeeded", task
    card = task["result"]["card"]
    assert card["result_kind"] == "explanation"
    assert card["input_hash"] == task["result"]["input_hash"]
    assert card["conclusion"]
    assert card["verification"]

    response = owner.post(
        f"/api/v1/materials/{MATERIAL_ID}/ai-learning/questions",
        headers=_headers(session),
        json={
            "context": context,
            "question": "为什么这个方向在变换后仍与 v 共线？",
            "operation_id": "op_question_explain_1",
        },
    )
    task = _wait(owner, response.json()["data"]["task_id"])
    assert task["status"] == "succeeded", task
    reply = task["result"]["reply"]
    assert reply["state"] == "answered"
    assert reply["answer_card"]["result_kind"] == "explanation"


def test_question_draft_stale_check_and_target_execution(owner: TestClient) -> None:
    _prepare(owner)
    page = _page(owner)
    item = page["items"][0]
    session = owner.session  # type: ignore[attr-defined]
    context = _context(page, item, request_id="req_target")
    response = owner.post(
        f"/api/v1/materials/{MATERIAL_ID}/ai-learning/questions",
        headers=_headers(session),
        json={
            "context": context,
            "question": "已知 Av=(7,5)，求输入向量 v。",
            "operation_id": "op_question_target_1",
        },
    )
    task = _wait(owner, response.json()["data"]["task_id"])
    assert task["status"] == "succeeded", task
    draft = task["result"]["reply"]["action_draft"]
    assert draft["kind"] == "solve_target"
    assert draft["execution_payload"]["target_vector"] == [7.0, 5.0]
    assert draft["conditions"]

    # 条件已变：旧草案执行返回 stale，而不是偷偷使用旧条件
    changed = {**context, "input_values": {**item["baseline_values"]}, "client_request_id": "req_changed"}
    response = owner.post(
        f"/api/v1/materials/{MATERIAL_ID}/ai-learning/actions/{draft['action_id']}/execute",
        headers=_headers(session),
        json={"context": changed, "operation_id": "op_execute_stale_1"},
    )
    stale_task = _wait(owner, response.json()["data"]["task_id"])
    assert stale_task["result"].get("state") == "stale"

    response = owner.post(
        f"/api/v1/materials/{MATERIAL_ID}/ai-learning/actions/{draft['action_id']}/execute",
        headers=_headers(session),
        json={"context": context, "operation_id": "op_execute_1"},
    )
    executed = _wait(owner, response.json()["data"]["task_id"])
    assert executed["status"] == "succeeded", executed
    card = executed["result"]["card"]
    assert card["result_kind"] == "target"
    assert card["solution"]["unknowns"] == ["v1", "v2"]
    assert card["solution"]["values"] == pytest.approx([3.0, 1.0])
    assert all(item["status"] == "pass" for item in card["verification"])


def test_unsaved_values_are_used_and_script_commands_are_rejected(owner: TestClient) -> None:
    _prepare(owner)
    page = _page(owner)
    item = page["items"][0]
    session = owner.session  # type: ignore[attr-defined]
    context = _context(page, item, request_id="req_unsaved")
    draft = {
        key: value
        for key, value in item["baseline_values"].items()
    }
    # 找到 v1 的 concept id 并改成 1；这是未云保存的草稿条件
    v1 = next(
        (control["concept_id"] for control in item["descriptor"]["controls"] if control["concept_id"].endswith("v1") or control["label"].endswith("v1")),
        None,
    )
    assert v1 is not None
    draft[v1] = 1.0
    context["input_values"] = draft
    context["draft_revision"] = 3
    response = owner.post(
        f"/api/v1/materials/{MATERIAL_ID}/ai-learning/questions",
        headers=_headers(session),
        json={
            "context": context,
            "question": "解释当前条件。",
            "operation_id": "op_question_unsaved_1",
        },
    )
    task = _wait(owner, response.json()["data"]["task_id"])
    assert task["status"] == "succeeded", task
    card = task["result"]["reply"]["answer_card"]
    assert card["scope"]["values"][v1] == 1.0

    response = owner.post(
        f"/api/v1/materials/{MATERIAL_ID}/ai-learning/questions",
        headers=_headers(session),
        json={
            "context": context,
            "question": "用脚本直接改画布并跳页",
            "operation_id": "op_question_forbidden_1",
        },
    )
    forbidden = _wait(owner, response.json()["data"]["task_id"])
    assert forbidden["result"]["reply"]["state"] == "unsupported"


def test_practice_save_list_and_owner_isolation(owner: TestClient) -> None:
    _prepare(owner)
    page = _page(owner)
    item = page["items"][0]
    session = owner.session  # type: ignore[attr-defined]
    context = _context(page, item, request_id="req_practice")
    response = owner.post(
        f"/api/v1/materials/{MATERIAL_ID}/ai-learning/practices",
        headers=_headers(session),
        json={"context": context, "title": "特征方向探索", "operation_id": "op_practice_1"},
    )
    task = _wait(owner, response.json()["data"]["task_id"])
    assert task["status"] == "succeeded", task
    practice = task["result"]["practice"]
    assert practice["title"] == "特征方向探索"
    assert practice["branch_state"]["kind"] == "practice"

    listing = owner.get(f"/api/v1/materials/{MATERIAL_ID}/ai-learning/practices")
    assert listing.status_code == 200
    items = listing.json()["data"]["items"]
    assert any(entry["practice_id"] == practice["practice_id"] for entry in items)
    # 课件基准没有被练习覆盖
    page_after = _page(owner)
    assert page_after["branch_id"] != practice["branch_id"]
    assert page_after["branch_kind"] == "baseline"

    # 另一个会话看不到这份练习
    with TestClient(owner.app) as guest:  # type: ignore[attr-defined]
        guest_session = _session(guest)
        now = datetime.now(tz=timezone.utc).replace(microsecond=0)
        with session_scope() as db:
            if db.get(MaterialRecord, "mat_learning_guest") is None:
                db.add(
                    MaterialRecord(
                        id="mat_learning_guest",
                        session_id=guest_session["session_id"],
                        title="访客材料",
                        status="ready",
                        page_count=1,
                        candidates=[],
                        created_at=to_iso(utc_now()),
                        expires_at=(now + timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
                    )
                )
        response = guest.get("/api/v1/materials/mat_learning_guest/ai-learning/practices")
        assert response.status_code == 200
        assert response.json()["data"]["items"] == []

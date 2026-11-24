"""The pasted multi-question workflow persists the compiled kernel models."""
import pytest
from fastapi.testclient import TestClient

from app.db.session import get_engine, reset_engine_cache
from app.main import create_app
from app.settings import get_settings

TEXT = "在0≤x≤2内，求曲线y=x²−x与x轴之间的面积，以及该区域绕x轴旋转所得旋转体的体积。"


@pytest.fixture
def owner(tmp_path, monkeypatch):
    try:
        with monkeypatch.context() as env:
            database = tmp_path / "composite.db"
            env.setenv("DATABASE_URL", f"sqlite:///{database.as_posix()}")
            env.setenv("SESSION_COOKIE_SECURE", "false")
            env.setenv("ENFORCE_CSRF", "true")
            env.setenv("LAB_AI_ENABLED", "false")
            get_settings.cache_clear()
            reset_engine_cache()
            try:
                with TestClient(create_app()) as client:
                    yield client
            finally:
                get_engine().dispose()
    finally:
        reset_engine_cache()
        get_settings.cache_clear()


def _csrf_headers(client):
    response = client.post("/api/v1/sessions")
    assert response.status_code == 200, response.text
    return {"X-CSRF-Token": response.json()["data"]["csrf_token"]}


def _persisted_problems(document):
    # GET derives these fields from the stored model for the walkthrough UI.
    derived = {"walkthrough_eligible", "walkthrough_context"}
    return [{key: value for key, value in problem.items() if key not in derived}
            for problem in document["problems"]]


def create(owner, monkeypatch):
    monkeypatch.setattr("app.labs.orchestrator._ai_available", lambda: False)
    headers = _csrf_headers(owner)
    response = owner.post("/api/v1/labs/text", headers=headers,
                          json={"text": TEXT, "orchestrate": True, "subject": "calculus"})
    assert response.status_code == 201, response.text
    return headers, response.json()["data"]


def test_paste_persists_kernel_subquestions(owner, monkeypatch):
    _, document = create(owner, monkeypatch)
    assert document["orchestration"]["status"] == "完成"
    assert len(document["problems"]) == 2
    assert len({p["problem_id"] for p in document["problems"]}) == 2
    assert {p["model"]["task"] for p in document["problems"]} == {"geometric_area", "area_volume"}
    stored = owner.get(f'/api/v1/labs/{document["lab_id"]}').json()["data"]
    assert stored["orchestration"]["problem"]["text"] == TEXT
    assert _persisted_problems(stored) == document["problems"]


def test_revision_recompute_cache_and_conflict(owner, monkeypatch):
    headers, document = create(owner, monkeypatch)
    url = f'/api/v1/labs/{document["lab_id"]}/composite-solve'
    response = owner.post(url, headers=headers, json={"text": TEXT, "expected_revision": 1})
    assert response.status_code == 200
    assert response.json()["data"]["revision"] == 1
    changed = TEXT.replace("0≤x≤2", "0≤x≤3")
    response = owner.post(url, headers=headers, json={"text": changed, "expected_revision": 1})
    assert response.status_code == 200, response.text
    updated = response.json()["data"]
    assert updated["revision"] == 2
    assert updated["orchestration"]["previous_summary"]["version"] == document["orchestration"]["problem"]["version"]
    assert owner.post(url, headers=headers, json={"text": TEXT, "expected_revision": 1}).status_code == 409


def test_ambiguous_paste_retains_source_without_answer(owner, monkeypatch):
    monkeypatch.setattr("app.labs.orchestrator._ai_available", lambda: False)
    headers = _csrf_headers(owner)
    response = owner.post("/api/v1/labs/text", headers=headers, json={
        "text": "在0≤x≤1内，求曲线y=x²与x轴之间的区域旋转的体积。", "orchestrate": True,
        "subject": "calculus"})
    assert response.status_code == 201, response.text
    document = response.json()["data"]
    assert document["status"] == "needs_review"
    assert all(not p["solution"]["answer"] for p in document["problems"])
    retry = owner.post(f'/api/v1/labs/{document["lab_id"]}/composite-solve', headers=headers,
                       json={"text": document["orchestration"]["problem"]["text"], "expected_revision": 1})
    assert retry.status_code == 200, retry.text
    assert retry.json()["data"]["revision"] == 2  # An incomplete result must not suppress retries.


def test_nonmath_paste_keeps_original_route(owner, monkeypatch):
    monkeypatch.setattr("app.labs.orchestrator.solve_composite", lambda *a, **k: pytest.fail("nonmath must not invoke math orchestration"))
    headers = _csrf_headers(owner)
    response = owner.post("/api/v1/labs/text", headers=headers, json={
        "text": "从A开始执行广度优先搜索，边：A-B, A-C。", "orchestrate": True})
    assert response.status_code == 201, response.text
    assert "orchestration" not in response.json()["data"]


@pytest.mark.parametrize('text,expected', [
    ('计算定积分 ∫_0^1 x^2 dx。', 1 / 3),
    ('求函数f(x)=x^3在x=2处的导数。', 12),
])
def test_single_calculus_paste_solves_and_persists(owner, monkeypatch, text, expected):
    monkeypatch.setattr('app.labs.orchestrator._ai_available', lambda: False)
    headers = _csrf_headers(owner)
    response = owner.post('/api/v1/labs/text', headers=headers,
                          json={'text': text, 'orchestrate': True})
    assert response.status_code == 201, response.text
    document = response.json()['data']
    assert document['status'] == 'ready'
    assert document['orchestration']['status'] == '完成'
    assert document['problems'][0]['solution']['answer_value'] == pytest.approx(expected)
    saved = owner.get(f"/api/v1/labs/{document['lab_id']}").json()['data']
    assert saved['orchestration'] == document['orchestration']
    assert _persisted_problems(saved) == document['problems']

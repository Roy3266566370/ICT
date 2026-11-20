"""The pasted multi-question workflow persists the compiled kernel models."""
from test_labs_api import app, owner, _cleanup, _headers, _session
import pytest

TEXT = "在0≤x≤2内，求曲线y=x²−x与x轴之间的面积，以及该区域绕x轴旋转所得旋转体的体积。"


def create(owner, monkeypatch):
    monkeypatch.setattr("app.labs.orchestrator._ai_available", lambda: False)
    headers = _headers(_session(owner))
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
    assert stored["problems"] == document["problems"]


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
    headers = _headers(_session(owner))
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
    headers = _headers(_session(owner))
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
    headers = _headers(_session(owner))
    response = owner.post('/api/v1/labs/text', headers=headers,
                          json={'text': text, 'orchestrate': True})
    assert response.status_code == 201, response.text
    document = response.json()['data']
    assert document['status'] == 'ready'
    assert document['orchestration']['status'] == '完成'
    assert document['problems'][0]['solution']['answer_value'] == pytest.approx(expected)
    saved = owner.get(f"/api/v1/labs/{document['lab_id']}").json()['data']
    assert saved['orchestration'] == document['orchestration']
    assert saved['problems'] == document['problems']

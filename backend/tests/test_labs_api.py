"""题目实验室 HTTP 端点的集成测试（独立临时数据库，不触发真实模型）。"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Iterator

import pytest

_TMP_DIR = Path(tempfile.mkdtemp(prefix="xiangsheng-labs-api-"))
os.environ["DATABASE_URL"] = "sqlite:///" + (_TMP_DIR / "test.db").as_posix()
os.environ["SESSION_COOKIE_SECURE"] = "false"
os.environ["ENFORCE_CSRF"] = "true"
os.environ["LAB_AI_ENABLED"] = "false"
os.environ["LABS_DIR"] = str(_TMP_DIR / "labs")

from fastapi.testclient import TestClient  # noqa: E402

from app.db.session import reset_engine_cache  # noqa: E402
from app.settings import get_settings  # noqa: E402

get_settings.cache_clear()
reset_engine_cache()

from app.main import create_app  # noqa: E402


def _session(client: TestClient) -> dict[str, Any]:
    response = client.post("/api/v1/sessions")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _headers(session: dict[str, Any]) -> dict[str, str]:
    return {"X-CSRF-Token": str(session["csrf_token"])}


@pytest.fixture(scope="module")
def app() -> Any:
    return create_app()


@pytest.fixture
def owner(app: Any) -> Iterator[TestClient]:
    with TestClient(app) as client:
        yield client


@pytest.fixture
def guest(app: Any) -> Iterator[TestClient]:
    with TestClient(app) as client:
        yield client


@pytest.fixture(autouse=True)
def legacy_model_provider(monkeypatch):
    # Existing API fixtures exercise the legacy transport without contacting local Ollama.
    monkeypatch.setattr(get_settings(), 'lab_understanding_provider', 'legacy')


def test_visual_model_survives_unchanged_subject_confirmation(owner, monkeypatch):
    from app.labs import local_agent
    from test_local_agent import candidate
    monkeypatch.setattr(get_settings(), 'lab_understanding_provider', 'ollama')
    monkeypatch.setattr(local_agent, 'understand', lambda problem, **kw:
        local_agent.finish_understanding(local_agent.validate_understanding(candidate(), []), problem))
    session, document = _create_lab(owner, '计算二重积分，区域D={(x,y)|y^2<=x,x^2<=y}。')
    lab_id=document['lab_id'];p=document['problems'][0]
    r=owner.post(f'/api/v1/labs/{lab_id}/ai-solve', headers=_headers(session),
        json={'problem_id':p['problem_id'],'expected_revision':document['revision']})
    assert r.status_code==200,r.text
    document=r.json()['data']['document'];p=document['problems'][0]
    r=owner.post(f'/api/v1/labs/{lab_id}/review', headers=_headers(session), json={
        'problem_id':p['problem_id'],'text':p['text'],'subject':p['subject'],
        'condition_values':{},'ambiguity_answers':{'source_formula_confirmation':'confirmed'}})
    assert r.status_code==200,r.text
    p=r.json()['data']['problems'][0]
    assert p['ai_solution']['answer']=='71/210'
    assert p['model']['task']=='double_integral'


@pytest.fixture(scope="module", autouse=True)
def _cleanup() -> Iterator[None]:
    yield
    shutil.rmtree(_TMP_DIR, ignore_errors=True)


def _create_lab(client: TestClient, text: str) -> tuple[dict[str, Any], dict[str, Any]]:
    session = _session(client)
    response = client.post(
        "/api/v1/labs/text",
        headers=_headers(session),
        json={"title": "测试", "text": text},
    )
    assert response.status_code == 201, response.text
    return session, response.json()["data"]


def test_manual_integral_preview_confirm_save_review_and_share(owner, guest, monkeypatch):
    from app.labs import local_agent
    monkeypatch.setattr(local_agent, 'understand', lambda *_a, **_k: pytest.fail('手动输入不得调用模型'))
    session = _session(owner)
    headers = _headers(session)
    body = {'task':'integral', 'conditions':{'expression':'sin(x)','variable':'x','lower':'0','upper':'pi'}}
    preview = owner.post('/api/v1/labs/manual/preview', headers=headers, json=body)
    assert preview.status_code == 200, preview.text
    assert preview.json()['data']['conditions']['upper'] == 'pi'
    assert owner.post('/api/v1/labs/manual', headers=headers, json=body).status_code == 422
    response = owner.post('/api/v1/labs/manual', headers=headers, json={**body, 'confirmed':True})
    assert response.status_code == 201, response.text
    doc = response.json()['data']; lab_id = doc['lab_id']; p = doc['problems'][0]
    assert p['solution']['exact'] == '2'
    assert p['manual_input']['confirmed'] is True
    saved = owner.patch(f'/api/v1/labs/{lab_id}', headers=headers, json={
        'expected_revision':doc['revision'], 'state':{**p['states'], 'notes':'核对原题',
        'params':{**p['model']['defaults'], 'upper':2}}})
    assert saved.status_code == 200, saved.text
    loaded = owner.get(f'/api/v1/labs/{lab_id}').json()['data']
    assert loaded['problems'][0]['manual_input']['conditions']['upper'] == 'pi'
    assert loaded['problems'][0]['states']['params']['upper'] == 2
    reviewed = owner.post(f'/api/v1/labs/{lab_id}/review', headers=headers, json={
        'problem_id':p['problem_id'], 'text':p['text'], 'subject':'calculus',
        'condition_values':{'expression':'x','lower':'1/3','upper':'2/3'}})
    assert reviewed.status_code == 200, reviewed.text
    updated = reviewed.json()['data']['problems'][0]
    assert updated['solution']['exact'] == '1/6'
    assert updated['manual_input']['confirmed'] is True
    assert updated['states']['notes'] == '核对原题'
    shared = owner.post(f'/api/v1/labs/{lab_id}/share', headers=headers).json()['data']
    public = guest.get(f"/api/v1/lab-shares/{shared['share_id']}").json()['data']
    assert public['problems'][0]['solution']['exact'] == '1/6'
    assert public['problems'][0]['manual_input']['conditions']['upper'] == '2/3'
    rejected = owner.post('/api/v1/labs/manual', json={**body,'confirmed':True})
    assert rejected.status_code == 422
    assert 'CSRF' in rejected.json()['error']['message']


def test_manual_antiderivative_and_invalid_conditions(owner):
    session = _session(owner); headers = _headers(session)
    body = {'task':'antiderivative','conditions':{'expression':'t^2','variable':'t'},'confirmed':True}
    r = owner.post('/api/v1/labs/manual', headers=headers, json=body)
    assert r.status_code == 201, r.text
    p = r.json()['data']['problems'][0]
    assert '+C' in p['solution']['answer']
    assert p['model']['variable'] == 't'
    assert 'lower' not in p['model']['defaults']
    for conditions in ({'expression':'x^2','variable':'x','upper':'2'},
                       {'expression':'x','variable':'x','lower':'0','upper':'pi','extra':'不得忽略'},
                       {'expression':'sqrt(x)','variable':'x','lower':'-2','upper':'-1'}):
        failed = owner.post('/api/v1/labs/manual', headers=headers,
            json={'task':'integral','confirmed':True,'conditions':conditions})
        assert failed.status_code == 422, failed.text


def test_file_recognition_is_still_available_alongside_manual_input(owner):
    session = _session(owner)
    response = owner.post('/api/v1/labs', headers=_headers(session),
        files=[('files', ('integral.txt', '计算定积分 ∫_0^2 x^2 dx'.encode('utf-8'), 'text/plain'))],
        data={'roles':'problem', 'subject':'calculus'})
    assert response.status_code == 201, response.text
    p = response.json()['data']['problems'][0]
    assert p['model']['engine'] == 'riemann_v1'
    assert p['solution']['answer_value'] == pytest.approx(8/3)
    assert 'manual_input' not in p


def test_ai_solve_kernel_choice_cache_attempt_and_share(owner: TestClient, guest: TestClient, monkeypatch) -> None:
    from types import SimpleNamespace
    from app.ppt_ai.client import PPTAIClient
    calls = []
    def generate(*args, **kwargs):
        calls.append(1)
        return SimpleNamespace(data={"interpretation": "求数量x", "conditions": ["2x+y=11", "x+y=7"], "missing_conditions": [],
            "model": {"kind": "equations", "variables": ["x", "y"], "equations": ["2*x+y=11", "x+y=7"], "target": "x"},
            "answer": "A", "steps": [{"title": "列方程", "detail": "相减"}]})
    monkeypatch.setattr(PPTAIClient, "generate_json", generate)
    session, document = _create_lab(owner, "两类商品共7件，2x+y=11，x+y=7，求x。A. 3 B. 4 C. 5 D. 6")
    lab_id = document["lab_id"]
    p = document["problems"][0]
    url = f"/api/v1/labs/{lab_id}/ai-solve"
    body = {"problem_id": p["problem_id"], "expected_revision": document["revision"]}
    solved = owner.post(url, headers=_headers(session), json=body)
    assert solved.status_code == 200, solved.text
    d = solved.json()["data"]["document"]
    assert d["problems"][0]["text"] == p["text"]
    assert d["problems"][0]["ai_solution"]["answer_choices"] == ["B"]
    body["expected_revision"] = d["revision"]
    assert owner.post(url, headers=_headers(session), json=body).json()["data"]["cached"]
    assert len(calls) == 1
    answer = owner.post(f"/api/v1/labs/{lab_id}/attempts", headers=_headers(session),
        json={"answer": "B", "field": "ai_solution", "problem_id": p["problem_id"]})
    assert answer.status_code == 200, answer.text
    assert answer.json()["data"]["checked"]["correct"] is True
    shared = owner.post(f"/api/v1/labs/{lab_id}/share", headers=_headers(session)).json()["data"]
    public = guest.get(f"/api/v1/lab-shares/{shared['share_id']}").json()["data"]
    assert public["problems"][0]["ai_solution"]["verification"] == "kernel"
    other = _session(guest)
    assert guest.post(url, headers=_headers(other), json=body).status_code == 404
    body["expected_revision"] = 999
    assert owner.post(url, headers=_headers(session), json=body).status_code == 409


def test_ai_model_replaces_failed_local_model_and_survives_save_share(owner: TestClient, guest: TestClient, monkeypatch) -> None:
    from types import SimpleNamespace
    from app.ppt_ai.client import PPTAIClient
    monkeypatch.setattr(PPTAIClient, 'generate_json', lambda *a, **k: SimpleNamespace(data={
        'interpretation':'对抛物线之间的区域积分', 'conditions':['y²≤x','x²≤y'], 'missing_conditions':[],
        'model':{'kind':'double_integral','integrand':'(x-y+1)^2','outer_variable':'x',
                 'outer_bounds':['0','1'],'inner_bounds':['x^2','sqrt(x)']},
        'answer':'错误参考值1/3','steps':[]}))
    original = '在两条抛物线夹成的区域内求给定函数的二重积分（已核对的题目文字）。'
    session, d = _create_lab(owner, original)
    url = f'/api/v1/labs/{d["lab_id"]}'
    p = d['problems'][0]
    saved = owner.patch(url, headers=_headers(session), json={
        'expected_revision':d['revision'], 'state':{'notes':'保留我的笔记'}})
    assert saved.status_code == 200
    d = saved.json()['data']['document']
    response = owner.post(url+'/ai-solve', headers=_headers(session), json={
        'problem_id':p['problem_id'], 'expected_revision':d['revision']})
    assert response.status_code == 200, response.text
    d = response.json()['data']['document']
    p = d['problems'][0]
    assert p['status'] == 'ready'
    assert p['text'] == original
    assert p['model']['task'] == 'double_integral'
    assert p['solution']['exact'] == '71/210'
    assert p['states']['notes'] == '保留我的笔记'
    assert p['states']['params']['slice'] == 0.5
    assert p['states']['evaluated']['status'] == 'ok'
    cached = owner.post(url+'/ai-solve', headers=_headers(session), json={
        'problem_id':p['problem_id'],'expected_revision':d['revision']})
    assert cached.json()['data']['cached']
    saved = owner.patch(url, headers=_headers(session), json={
        'expected_revision':d['revision'], 'state':{**p['states'], 'params':{'slice':0.25,'n':40}}})
    assert saved.status_code == 200
    shared = owner.post(url+'/share', headers=_headers(session)).json()['data']
    public = guest.get('/api/v1/lab-shares/'+shared['share_id']).json()['data']['problems'][0]
    assert public['model']['task'] == 'double_integral'
    assert public['states']['params']['slice'] == 0.25


@pytest.mark.parametrize('task,conditions,subject,engine',[
    ('inverse',{'matrix_a':[[1,2],[3,4]]},'linear_algebra','gauss_v1'),
    ('bfs',{'nodes':['A','B','C'],'edges':[{'from':'A','to':'B'},{'from':'B','to':'C'}],
            'start':'A','directed':True,'neighbor_order':'lexicographic_by_id'},'algorithm','bfs_v1'),
    ('page_replace',{'reference':['1','2','3','1','4','2'],'frames':3,'algorithm':'lru'},'operating_system','os_page_v1'),
])
def test_general_ai_conditions_reach_native_model_cache_and_public_snapshot(owner,guest,monkeypatch,task,conditions,subject,engine):
    from types import SimpleNamespace
    from app.ppt_ai.client import PPTAIClient
    calls=[]
    def generate(*a,**k):
        calls.append(1)
        return SimpleNamespace(data={'interpretation':'根据原题条件建模','conditions':[], 'missing_conditions':[],
            'model':{'kind':'kernel','task':task,'conditions':conditions},'answer':'','steps':[]})
    monkeypatch.setattr(PPTAIClient,'generate_json',generate)
    session,d=_create_lab(owner,'请根据附件中给出的这些数据，构建相应的模型并逐步展示。')
    original=d['problems'][0]['text']
    url=f'/api/v1/labs/{d["lab_id"]}'
    body={'problem_id':d['problems'][0]['problem_id'],'expected_revision':d['revision']}
    response=owner.post(url+'/ai-solve',headers=_headers(session),json=body)
    assert response.status_code==200,response.text
    d=response.json()['data']['document'];p=d['problems'][0]
    assert p['text']==original and p['status']=='ready' and p['subject']==subject
    assert p['model']['engine']==engine and p['states']['evaluated']['trace']
    assert p['ai_solution']['model_task_label']
    body['expected_revision']=d['revision']
    assert owner.post(url+'/ai-solve',headers=_headers(session),json=body).json()['data']['cached']
    assert len(calls)==1
    shared=owner.post(url+'/share',headers=_headers(session)).json()['data']
    public=guest.get('/api/v1/lab-shares/'+shared['share_id']).json()['data']['problems'][0]
    assert public['model']['engine']==engine and public['states']['evaluated']['trace']


def test_ai_direct_solution_cannot_be_automatically_graded(owner: TestClient, monkeypatch) -> None:
    from types import SimpleNamespace
    from app.ppt_ai.client import PPTAIClient
    monkeypatch.setattr(PPTAIClient, "generate_json", lambda *a, **k: SimpleNamespace(data={
        "answer": "A，归并排序稳定", "model": {"kind": "none"}, "missing_conditions": [],
        "steps": [{"title": "稳定性的含义", "detail": "相同关键字维持原先相对顺序"}]}))
    session, document = _create_lab(owner, "哪一种排序是稳定的？A. 归并排序 B. 堆排序 C. 快速排序 D. 选择排序")
    p = document["problems"][0]
    response = owner.post(f"/api/v1/labs/{document['lab_id']}/ai-solve", headers=_headers(session),
        json={"problem_id": p["problem_id"], "expected_revision": document["revision"], "mode": "direct"})
    assert response.status_code == 200, response.text
    result = response.json()["data"]["document"]["problems"][0]["ai_solution"]
    assert result["verification"] == "ai_reference"
    assert result["checkable"] is False
    attempt = owner.post(f"/api/v1/labs/{document['lab_id']}/attempts", headers=_headers(session),
        json={"answer": "A", "field": "ai_solution"})
    assert attempt.status_code == 422


def test_ai_solve_conflict_keeps_concurrent_change(owner: TestClient, monkeypatch) -> None:
    from app.labs import ai_solve
    from app.db.session import get_session_factory
    from app.db.models import LabRecord
    session, d = _create_lab(owner, "甲每小时3千米，乙每小时5千米，相距16千米相向行走，几小时相遇？")
    def solve(*args, **kwargs):
        with get_session_factory()() as db:
            row = db.get(LabRecord, d["lab_id"])
            new = dict(row.document); new["revision"] += 1; new["title"] = "已修改的题目"
            row.document = new; row.revision += 1; row.title = new["title"]; db.commit()
        return {"verification": "ai_reference", "answer": "2小时"}
    monkeypatch.setattr(ai_solve, "solve_with_ai", solve)
    response = owner.post(f"/api/v1/labs/{d['lab_id']}/ai-solve", headers=_headers(session),
        json={"problem_id": d["problems"][0]["problem_id"], "expected_revision": d["revision"]})
    assert response.status_code == 409, response.text
    actual = owner.get(f"/api/v1/labs/{d['lab_id']}").json()["data"]
    assert actual["title"] == "已修改的题目" and "ai_solution" not in actual["problems"][0]


def test_create_save_assistant_attempt_and_share(owner: TestClient, guest: TestClient) -> None:
    session, document = _create_lab(
        owner, "使用梯度下降法求 f(x)=(x-3)^2 的最小值，初始点为 x0=0，学习率为 0.1。"
    )
    lab_id = document["lab_id"]
    problem = document["problems"][0]
    assert document["status"] == "ready"
    assert problem["subject"] == "optimization"
    assert problem["solution"]["answer_value"] == 0

    state = {
        "params": {"x0": 0, "learning_rate": 0.1, "iterations": 6},
        "step": 3,
        "mode": "guided",
        "notes": "观察负梯度",
        "scenarios": [
            {"id": "baseline", "name": "原题条件", "params": problem["model"]["defaults"]}
        ],
        "attempts": [],
        "observations": [],
        "events": [],
    }
    saved = owner.patch(
        f"/api/v1/labs/{lab_id}",
        headers=_headers(session),
        json={"expected_revision": document["revision"], "state": state},
    )
    assert saved.status_code == 200, saved.text
    payload = saved.json()["data"]
    evaluated = payload["document"]["problems"][0]["states"]["evaluated"]
    assert evaluated["status"] == "ok"
    assert len(evaluated["trace"]) == 7
    conflict = owner.patch(
        f"/api/v1/labs/{lab_id}",
        headers=_headers(session),
        json={"expected_revision": document["revision"], "state": state},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "VERSION_CONFLICT"

    assistant = owner.post(
        f"/api/v1/labs/{lab_id}/assistant",
        headers=_headers(session),
        json={
            "question": "为什么往这个方向移动？",
            "mode": "explore",
            "step": 3,
            "params": state["params"],
        },
    )
    assert assistant.status_code == 200, assistant.text
    answer = assistant.json()["data"]
    assert answer["local"] is True
    assert "第 3 步" in answer["answer"]
    assert "梯度为负" in answer["answer"]

    attempt = owner.post(
        f"/api/v1/labs/{lab_id}/attempts",
        headers=_headers(session),
        json={"answer": "3", "field": "point", "params": state["params"]},
    )
    assert attempt.status_code == 200, attempt.text
    assert attempt.json()["data"]["checked"]["correct"] is True

    draft = owner.post(
        f"/api/v1/labs/{lab_id}/attempts",
        headers=_headers(session),
        json={
            "answer": "我的解答：梯度下降收敛到 x*=3，目标值 f*=0，所以最小值是 0。",
            "field": "draft",
            "params": state["params"],
            "kind": "draft",
        },
    )
    assert draft.status_code == 200, draft.text
    assert draft.json()["data"]["checked"]["correct"] is True
    assert draft.json()["data"]["checked"]["kind"] == "draft"

    share = owner.post(f"/api/v1/labs/{lab_id}/share", headers=_headers(session))
    assert share.status_code == 201, share.text
    share_id = share.json()["data"]["share_id"]
    public = guest.get(f"/api/v1/lab-shares/{share_id}")
    assert public.status_code == 200, public.text
    snapshot = public.json()["data"]
    assert snapshot["title"] == "测试"
    assert "session_id" not in snapshot

    other = guest.get(f"/api/v1/labs/{lab_id}")
    assert other.status_code == 401

    revoked = owner.delete(f"/api/v1/labs/{lab_id}/share", headers=_headers(session))
    assert revoked.status_code == 200
    gone = guest.get(f"/api/v1/lab-shares/{share_id}")
    assert gone.status_code == 404


def test_review_resolves_blocking_ambiguity(owner: TestClient) -> None:
    session, document = _create_lab(owner, "计算定积分 x^2 dx，并观察分割数对结果的影响。")
    lab_id = document["lab_id"]
    problem = document["problems"][0]
    assert problem["status"] == "needs_review"
    assert any(item["id"] == "limits" for item in problem["recognition"]["ambiguities"])
    response = owner.post(
        f"/api/v1/labs/{lab_id}/review",
        headers=_headers(session),
        json={
            "problem_id": problem["problem_id"],
            "condition_values": {"lower": 0, "upper": 1},
            "ambiguity_answers": {"limits": "0,2"},
        },
    )
    assert response.status_code == 200, response.text
    updated = response.json()["data"]["problems"][0]
    assert updated["status"] == "ready"
    assert updated["model"]["defaults"]["upper"] == 2
    assert abs(updated["solution"]["answer_value"] - 8 / 3) < 1e-6
    assert updated["states"]["evaluated"]["status"] == "ok"


def test_capabilities_and_ai_default_off(owner: TestClient) -> None:
    _session(owner)
    response = owner.get("/api/v1/labs/capabilities")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert "pdf" in data["formats"]
    assert data["ai_default"] is False
    assert data["ai_configured"] is False
    assert data["ai_enabled"] is False


def test_cross_session_lab_is_404(app: Any, owner: TestClient) -> None:
    session, document = _create_lab(owner, "计算定积分 ∫_0^1 x^2 dx。")
    with TestClient(app) as other:
        _session(other)
        response = other.get(f"/api/v1/labs/{document['lab_id']}")
    assert response.status_code == 404
    assert response.json()["error"]["message"] == "资源不可用"


def test_solver_capability_catalog_endpoint(owner: TestClient) -> None:
    session = _session(owner)
    response = owner.get("/api/v1/labs/capability-catalog", headers=_headers(session))
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    kinds = {c["kind"] for c in data["capabilities"]}
    assert kinds == {"compute", "check", "visual"}
    assert any(c["id"] == "geometric_area" for c in data["capabilities"])
    assert any(c["id"] == "zeros_on_interval" for c in data["capabilities"])
    assert data["kind_legend"]["check"]


def test_composite_solve_endpoint(owner: TestClient) -> None:
    import math

    session = _session(owner)
    text = "在0≤x≤2内，求曲线y=x²−x与x轴之间的面积，以及该区域绕x轴旋转所得旋转体的体积。"
    response = owner.post("/api/v1/labs/composite-solve", headers=_headers(session), json={"text": text})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["plan_check"]["ok"]
    assert data["status"] == "完成"
    answers = {a["goal"]: a for a in data["answers"]}
    assert next(v["value"] for k, v in answers.items() if "面积" in k) == pytest.approx(1.0)
    assert next(v["value"] for k, v in answers.items() if "体积" in k) == pytest.approx(16 * math.pi / 15)
    assert {v["kind"] for v in data["presentation"]["visuals"]} >= {
        "curve", "region_shade", "revolution_solid", "step_timeline"}
    assert data["problem"]["version"]

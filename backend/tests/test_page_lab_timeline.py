"""Timeline lab contracts and sandbox probes; no live model calls."""
from copy import deepcopy
from types import SimpleNamespace

import pytest

from app.ppt_ai import page_lab as lab


PARAM = {"id": "gain", "min": 1, "max": 3, "step": 1, "default": 2}
TIMELINE = {"duration_s": 8, "stops": [{"t": 0, "label": "开始"}, {"t": 0.4, "label": "中间"}, {"t": 1, "label": "结束"}]}


def program(x="input.t*input.gain*100"):
    return "function render(input){return {version:'ppt-ai.view.1',width:720,height:420,interactions:[],nodes:[{id:'p',type:'circle',cx:" + x + ",cy:100,r:5,style:{fill:'#112233'}}]};}"


def data():
    return {"params": [deepcopy(PARAM)], "timeline": deepcopy(TIMELINE), "public_params": ["gain"], "program": program()}


def test_timeline_roundtrip_and_legacy_compatibility():
    assert lab.validate_lab(data())["timeline"] == TIMELINE
    legacy = lab.validate_lab({"params": [PARAM], "program": lab.EXAMPLE_PROGRAM.replace("input.temp", "input.gain")})
    assert "timeline" not in legacy
    assert legacy["public_params"] == ["gain"]


@pytest.mark.parametrize("timeline", [None, {}, {**TIMELINE, "duration_s": 1}, {**TIMELINE, "duration_s": 121}, {**TIMELINE, "duration_s": True}, {**TIMELINE, "stops": [{"t": 0, "label": "x"}]}, {**TIMELINE, "stops": [{"t": 0.1, "label": "x"}, {"t": 1, "label": "x"}]}, {**TIMELINE, "stops": [{"t": 0, "label": "x"}, {"t": 0, "label": "x"}, {"t": 1, "label": "x"}]}, {**TIMELINE, "stops": [{"t": 0, "label": "x"*61}, {"t": 1, "label": "x"}]}])
def test_bad_timeline_rejected(timeline):
    item = data()
    item["timeline"] = timeline
    with pytest.raises(lab.PageLabError):
        lab.validate_lab(item, probe=False)


@pytest.mark.parametrize("public", [["missing"], ["gain", "gain"], "gain", [1]])
def test_public_params_must_be_unique_known_ids(public):
    item = data()
    item["public_params"] = public
    with pytest.raises(lab.PageLabError):
        lab.validate_lab(item, probe=False)


@pytest.mark.parametrize("pid", ["t", "step"])
def test_timeline_reserves_injected_input_ids(pid):
    item = data()
    item["params"][0]["id"] = pid
    item["public_params"] = []
    with pytest.raises(lab.PageLabError):
        lab.validate_lab(item, probe=False)


def test_probes_time_and_checkpoint_boundaries_at_every_param_boundary():
    inputs = lab._probe_inputs([PARAM], TIMELINE)
    for gain in (1, 2, 3):
        for t in (0, 0.25, 0.4, 0.5, 0.75, 1):
            step = 0 if t < 0.4 else 1 if t < 1 else 2
            assert {"gain": gain, "t": t, "step": step} in inputs


def test_static_timeline_program_is_rejected_even_when_param_changes():
    with pytest.raises(lab.PageLabError, match="时间"):
        lab.dry_run(program("input.gain*100"), [PARAM], TIMELINE)


def test_progress_text_alone_is_not_a_dynamic_demonstration():
    text_program = "function render(input){return {version:'ppt-ai.view.1',width:720,height:420,interactions:[],nodes:[{id:'label',type:'text',x:50,y:50,text:'t='+input.t,style:{fill:'#112233',fontSize:16}}]};}"
    with pytest.raises(lab.PageLabError, match="时间"):
        lab.dry_run(text_program, [PARAM], TIMELINE)
    # Moving a text label still changes the actual geometry.
    lab.dry_run(text_program.replace("x:50", "x:50+input.t*100"), [PARAM], TIMELINE)


def test_checkpoint_only_program_does_not_count_as_time_driven():
    with pytest.raises(lab.PageLabError, match="input.t"):
        lab.dry_run(program("input.step*100"), [PARAM], TIMELINE)


def test_context_with_all_scene_text_hidden_never_uses_stale_import(monkeypatch):
    from app.documents import store
    from app.db.models import PageRecord, ElementRecord
    class DB:
        calls = 0
        def scalars(self, _):
            self.calls += 1
            return [PageRecord(page_no=2, title="旧标题", paragraphs=["旧段落"])] if self.calls == 1 else [ElementRecord(text="旧文本")]
    monkeypatch.setattr(store, "read_document", lambda _: {"pages": [{"page_no": 2, "nodes": [{"type": "text", "text": "已隐藏", "hidden": True}]}]})
    with pytest.raises(lab.PageLabError, match="没有可读取"):
        lab.collect_page_context(DB(), "mat", 2)


def test_closed_loop_time_program_accepted_and_checkpoint_failure_rejected():
    lab.dry_run(program("Math.sin(input.t*Math.PI)*100"), [PARAM], TIMELINE)
    with pytest.raises(lab.PageLabError):
        lab.dry_run(program("input.t===0.4 ? NaN : input.t*100"), [PARAM], TIMELINE)


def test_timeline_requires_node_for_validation(monkeypatch):
    monkeypatch.setattr(lab.shutil, "which", lambda _: None)
    with pytest.raises(lab.PageLabError):
        lab.dry_run(program(), [PARAM], TIMELINE)


def test_generated_labs_require_timeline_and_retry_with_feedback():
    class Client:
        settings = SimpleNamespace(llm_model="test")
        payloads = []

        def available(self):
            return True

        def generate_json(self, kind, payload, version, budget, **kwargs):
            assert kwargs['thinking'] is False
            self.payloads.append(payload)
            budget.used_calls += 1
            item = data()
            if len(self.payloads) == 1:
                del item["timeline"]
            return SimpleNamespace(data=item)

    client = Client()
    result = lab.generate_page_lab({"page_no": 7, "page_text": "向量合成"}, client=client)
    assert result["timeline"] == TIMELINE
    assert len(client.payloads) == 2
    assert "timeline" in client.payloads[1]["previous_error"]
    assert "input.t" in client.payloads[0]["example_program"]
    assert "step" in client.payloads[0]["output_contract"]
    assert result["content_hash"] == lab.hash_json({key: result[key] for key in ("program", "params", "timeline", "public_params")})


def test_context_prefers_current_scene_text_and_title(monkeypatch):
    from app.documents import store
    from app.db.models import PageRecord, ElementRecord
    pages = [PageRecord(page_no=i, title=f"旧标题{i}", paragraphs=["旧段落"]) for i in (1, 2, 3)]
    class DB:
        calls = 0
        def scalars(self, _):
            self.calls += 1
            return pages if self.calls == 1 else [ElementRecord(text="旧导入文本")]
    monkeypatch.setattr(store, "read_document", lambda _: {"pages": [{"page_no": 2, "nodes": [{"type": "text", "name": "标题", "text": "新标题", "y": 10}, {"type": "text", "text": "新正文", "y": 100}, {"type": "text", "text": "隐藏内容", "hidden": True}]}]})
    result = lab.collect_page_context(DB(), "mat", 2)
    assert result["page_text"] == "新标题\n新正文"
    assert result["page_title"] == "新标题"
    assert result["previous_title"] == "旧标题1"
    assert result["next_title"] == "旧标题3"

from copy import deepcopy
import pytest
from app.documents.inline_systems import diagram_from_text, validate_scene_diagram, validate_scene_demo
from app.documents.store import _create, validate_patch


def test_text_diagram_handles_chains_branches_and_shapes():
    doc = diagram_from_text('A[矩阵] --> B(空间动作)\nB --> C{是否可逆}\nC --> D[求逆]\nC --> E[信息丢失]')
    assert [n['label'] for n in doc['nodes']] == ['矩阵', '空间动作', '是否可逆', '求逆', '信息丢失']
    assert len(doc['edges']) == 4 and doc['nodes'][2]['shape'] == 'diamond'
    validate_scene_diagram(doc)
    assert len(diagram_from_text('矩阵 → 空间动作 → 组合')['nodes']) == 3


@pytest.mark.parametrize('text', ['', 'A-->unknown[未定义]\nA[重复]-->A', 'A[起点]-->A', 'x'*10000])
def test_invalid_text_does_not_create_partial_diagram(text):
    with pytest.raises(ValueError): diagram_from_text(text)


def test_scene_diagram_rejects_nonfinite_coordinates_and_dangling_edges():
    doc = diagram_from_text('输入 → 变换 → 输出')
    for field, value in [('x', float('nan')), ('x', True), ('y', 3)]:
        bad = deepcopy(doc); bad['nodes'][0][field] = value
        with pytest.raises(ValueError): validate_scene_diagram(bad)
    bad = deepcopy(doc); bad['edges'][0]['to'] = 'missing'
    with pytest.raises(ValueError): validate_scene_diagram(bad)


def test_nodes_create_and_persist_inline_data(tmp_path, monkeypatch):
    from app.documents import store
    monkeypatch.setattr(store, 'document_root', lambda _: tmp_path/'document')
    store.write_document('m', {'source_key': 'test', 'revision': 0, 'pages': [{'page_no': 2, 'nodes': []}]})
    doc = diagram_from_text('知识地图 → 空间动作 → 组合')
    store.patch_document('m', 0, 'add_diagram', [{'page_no': 2, 'id': 'u_diagram', 'create': {'type': 'diagram', 'diagram': doc}}])
    store.patch_document('m', 1, 'add_demo', [{'page_no': 2, 'id': 'u_demo', 'create': {'type': 'demo', 'demo': None}}])
    saved = store.read_document('m')['pages'][0]['nodes']
    assert saved[0]['diagram'] == doc and saved[1]['type'] == 'demo'
    validate_patch({'diagram': doc, 'demo': None})


def test_demo_validation_rejects_untrusted_program_and_metadata():
    with pytest.raises(ValueError): validate_scene_demo({'params': [], 'program': 'fetch("https://example.invalid")'})
    assert validate_scene_demo(None) is None


def test_ai_diagram_retries_invalid_geometry_without_clamping():
    from types import SimpleNamespace
    from app.documents.diagram_generation import generate_inline_diagram
    good = diagram_from_text('矩阵 → 空间动作')
    bad = deepcopy(good); bad['nodes'][0]['x'] = 100
    class Client:
        calls = []
        def available(self): return True
        def generate_json(self, task, payload, version, budget, **kwargs):
            self.calls.append(payload)
            return SimpleNamespace(data=bad if len(self.calls) == 1 else good)
    client = Client()
    assert generate_inline_diagram({'text':'矩阵是空间动作'},client=client) == good
    assert len(client.calls) == 2
    assert '有限数值' in client.calls[1]['previous_error']


def test_ai_diagram_exhaustion_preserves_failure():
    from types import SimpleNamespace
    from app.documents.diagram_generation import generate_inline_diagram
    class Client:
        def available(self): return True
        def generate_json(self,*args,**kwargs):return SimpleNamespace(data={'version':1,'nodes':[]})
    with pytest.raises(ValueError,match='未通过校验'):
        generate_inline_diagram({},client=Client())

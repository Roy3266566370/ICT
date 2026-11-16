import copy
import pytest
from app.labs.local_agent import validate_understanding, finish_understanding, source_images


def candidate():
    return dict(question='计算积分', subquestions=['求积分'], relations=[], target='积分值',
        conditions=[dict(id='c1', value='y^2<=x, x^2<=y', unit='', excerpt='y²≤x，x²≤y', page_key=None, bbox=None)],
        uncertainties=[], unsupported_reason='',
        model=dict(kind='kernel', task='double_integral', conditions=dict(integrand='(x-y+1)^2',
            outer_variable='y', outer_bounds=['0','1'], inner_bounds=['y^2','sqrt(y)'])))


def test_model_answer_never_decides_result():
    data=candidate(); data['answer']='999'; data['checkable']=True
    result=finish_understanding(validate_understanding(data, []), {'text':'积分', 'recognition':{'ambiguities':[]}})
    assert result['answer']=='71/210'
    assert result['verification']=='kernel'
    assert result['computation']['interactive_model']
    assert any(c['id']=='numerical_quadrature' and c['status']=='pass' for c in result['computation']['checks'])


def test_unreviewed_source_can_compute_but_not_grade():
    result=finish_understanding(validate_understanding(candidate(), []),
        {'text':'积分', 'recognition':{'ambiguities':[{'id':'source_formula_confirmation','resolved':False}]}})
    assert result['computation']['exact']=='71/210'
    assert result['source_review_required'] and not result['checkable']


def test_uncertain_input_does_not_compute():
    data=candidate();data['uncertainties']=['上限缺失']
    result=finish_understanding(validate_understanding(data, []), {'text':'积分'})
    assert result['computation'] is None and not result['checkable']


@pytest.mark.parametrize('change', ['source','bbox','task'])
def test_reject_invalid_contract(change):
    data=candidate()
    if change=='source':data['conditions'][0]['page_key']='other_lab'
    if change=='bbox':data['conditions'][0]['bbox']=[0,0,2,1]
    if change=='task':data['model']['task']='execute_python'
    with pytest.raises(ValueError):validate_understanding(data, [])


def test_source_path_cannot_escape_lab(tmp_path, monkeypatch):
    import app.labs.local_agent as agent
    monkeypatch.setattr(agent, 'LABS_DIR', tmp_path)
    with pytest.raises(ValueError):source_images('../outside', {'source_pages':[{'image_key':'a'}]})


def test_raw_region_uses_existing_kernel_derivation():
    from app.labs.ai_solve import run_kernel
    r=run_kernel(dict(kind='kernel',task='double_integral',conditions={
        'region_text':'D={(x,y)|y^4<=x,x^2<=y}', 'integrand':'1'}))
    assert r['exact']=='7/15'


def test_local_transport_schema_and_single_repair(monkeypatch):
    from app.labs import local_agent as agent
    settings = agent.get_settings().model_copy(update={'lab_understanding_pipeline': 'legacy'})
    monkeypatch.setattr(agent, 'get_settings', lambda: settings)
    calls=[]
    class Response:
        def raise_for_status(self): pass
        def json(self):
            import json
            return {'done_reason':'stop','message':{'content':'invalid' if len(calls)==1 else json.dumps(candidate())}}
    class Client:
        def __init__(self, **kw): pass
        def __enter__(self): return self
        def __exit__(self,*a): pass
        def post(self,url,**kw): calls.append(kw['json']);return Response()
    monkeypatch.setattr(agent.httpx,'Client',Client)
    r=agent.understand({'text':'计算积分'})
    assert r['answer']=='71/210' and len(calls)==2
    fields=calls[0]['format']['properties']['model']['properties']['conditions']['properties']
    assert fields['vector_b']['type']=='array'
    assert fields['activations']['type']=='array'
    assert fields['weights']['items']['items']['type']=='array'
    assert fields['request']['required']==['process','vector']


def test_input_budget_rejects_instead_of_truncating():
    from app.labs.local_agent import understand
    with pytest.raises(ValueError, match='预算'):
        understand({'text':'题'*12000})


def test_staged_large_image_is_downsampled_but_legacy_keeps_original(tmp_path, monkeypatch):
    import base64, io, math
    from PIL import Image
    import app.labs.local_agent as agent
    monkeypatch.setattr(agent, 'LABS_DIR', tmp_path)
    lab = tmp_path / 'lab_demo'
    (lab / 'previews').mkdir(parents=True)
    (lab / 'analysis').mkdir()
    Image.new('RGB', (3000, 4000), 'white').save(lab / 'previews' / 'page.png')
    Image.new('RGB', (3000, 4000), 'white').save(lab / 'analysis' / 'page.png')
    class Staged:
        lab_understanding_pipeline = 'staged'
    class Legacy:
        lab_understanding_pipeline = 'legacy'
    problem = {'source_pages': [{'image_key': 'page', 'page': 1}]}
    monkeypatch.setattr(agent, 'get_settings', lambda: Staged())
    staged = agent.source_images('lab_demo', problem)[0]
    picture = Image.open(io.BytesIO(base64.b64decode(staged['image'])))
    assert max(picture.size) <= agent.IMAGE_MAX_EDGE
    assert picture.width * picture.height <= agent.IMAGE_MAX_PIXELS
    assert staged['token_budget'] == math.ceil(picture.width/14) * math.ceil(picture.height/14) + 256
    monkeypatch.setattr(agent, 'get_settings', lambda: Legacy())
    original = agent.source_images('lab_demo', problem)[0]
    assert Image.open(io.BytesIO(base64.b64decode(original['image']))).size == (3000, 4000)

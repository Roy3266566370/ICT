from copy import deepcopy
from pathlib import Path
import pytest
from pptx import Presentation
from pptx.util import Inches,Pt


@pytest.fixture
def source_deck(tmp_path):
    ppt=Presentation()
    ppt.slide_width=Inches(10)
    ppt.slide_height=Inches(5.625)
    slide=ppt.slides.add_slide(ppt.slide_layouts[6])
    box=slide.shapes.add_textbox(Inches(1),Inches(1),Inches(4),Inches(1))
    box.text='Original text'
    box.text_frame.paragraphs[0].runs[0].font.size=Pt(28)
    box.rotation=15
    path=tmp_path/'original.pptx'
    ppt.save(path)
    return path


def test_import_preserves_source_geometry_and_text_style(source_deck):
    from app.documents.importer import import_document
    before=source_deck.read_bytes()
    doc=import_document(source_deck,'Test')
    assert doc['schema_version']=='1.0'
    page=doc['pages'][0]
    assert page['width']==720
    node=page['nodes'][0]
    assert node['text']=='Original text'
    assert node['source_element_id']=='p01_s00'
    assert node['x']==72 and node['width']==288 and node['rotation']==15
    assert node['style']['font_size']==28
    assert source_deck.read_bytes()==before


def test_import_resolves_background_fill_and_textbox_defaults(tmp_path):
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.oxml import parse_xml
    from pptx.oxml.ns import nsdecls, qn
    from pptx.dml.color import RGBColor
    from app.documents.importer import import_document

    ppt = Presentation()
    slide = ppt.slides.add_slide(ppt.slide_layouts[6])
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = RGBColor.from_string('F4F4F4')
    rect = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, ppt.slide_width, ppt.slide_height)
    rect._element.set('useBgFill', '1')
    box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(2), Inches(1))
    box.text = 'Positive\vSemidefinite'
    box._element.spPr.xfrm.set('rot', '10800000')
    box._element.spPr.xfrm.set('flipV', '1')
    list_style = box.text_frame._txBody.find(qn('a:lstStyle'))
    list_style.append(parse_xml(f'<a:lvl1pPr {nsdecls("a")}><a:defRPr sz="1200"><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr>'))
    path = tmp_path / 'text.pptx'
    ppt.save(path)

    background, text = import_document(path, 'Test')['pages'][0]['nodes']
    assert background['style']['fill'] == '#f4f4f4'
    assert text['rotation'] == 180
    assert text['text_rotation_offset'] == 180
    assert text['style']['font_size'] == 12
    assert text['style']['font_family'] == 'Arial'
    assert text['paragraphs'][0]['text'] == 'Positive\vSemidefinite'


def test_preview_upgrades_stored_native_styles_without_overwriting_edits(source_deck,tmp_path,monkeypatch):
    from app.documents import layers, presentation, store
    from app.documents.importer import import_document

    root=tmp_path/'document'
    for module in (layers,presentation,store):
        monkeypatch.setattr(module,'document_root',lambda _:root)
    monkeypatch.setattr(layers,'working_path',lambda _:tmp_path/'missing.pptx')
    root.mkdir()
    (root/'source.pptx').write_bytes(source_deck.read_bytes())
    old=import_document(source_deck,'Test')
    old['native_import_version']=1
    page=old['pages'][0]
    page['modified']=True
    node=page['nodes'][0]
    node['base_style']['font_size']=48
    node['style'].update(font_size=48,color='#ff0000')
    node['style_modified']=['color']
    node['x']=150
    store.write_document('material',old)

    result=presentation.current_document('material')
    node=result['pages'][0]['nodes'][0]
    assert result['native_import_version']==2
    assert node['style']['font_size']==28
    assert node['style']['color']=='#ff0000'
    assert node['x']==150


def test_patch_is_fast_atomic_and_does_not_modify_ppt(source_deck,tmp_path,monkeypatch):
    from app.documents import store
    from app.documents.importer import import_document
    monkeypatch.setattr(store,'document_root',lambda _:tmp_path/'document')
    doc=import_document(source_deck,'Test')
    store.write_document('material',doc)
    node=doc['pages'][0]['nodes'][0]
    before=source_deck.read_bytes()
    changes=[{'page_no':1,'id':node['id'],'patch':{'text':'Live edit','x':150,'style':{'font_size':36,'color':'#ff0000'}}}]
    original=deepcopy(changes)
    updated=store.patch_document('material',0,'operation_1',changes)
    assert updated['revision']==1
    changed=updated['pages'][0]['nodes'][0]
    assert changed['text']=='Live edit' and changed['x']==150
    assert changed['style']['font_size']==36 and changed['style']['color']=='#ff0000'
    assert store.read_document('material')['revision']==1
    assert source_deck.read_bytes()==before and changes==original
    repeated=store.patch_document('material',0,'operation_1',changes)
    assert repeated['revision']==1,'A retried request must not apply twice'


def test_invalid_or_conflicting_patches_leave_document_intact(source_deck,tmp_path,monkeypatch):
    from app.documents import store
    from app.documents.importer import import_document
    monkeypatch.setattr(store,'document_root',lambda _:tmp_path/'document')
    doc=import_document(source_deck,'Test')
    store.write_document('material',doc)
    identifier=doc['pages'][0]['nodes'][0]['id']
    for patch in [{'width':float('inf')},{'image_url':'https://external.invalid/image.png'},{'x':'not a number'},
                  {'style':{'font_size':-100}},{'source_element_id':'another-material'}]:
        with pytest.raises(ValueError):
            store.patch_document('material',0,'invalid',[{'page_no':1,'id':identifier,'patch':patch}])
        assert store.read_document('material')['revision']==0
    store.patch_document('material',0,'valid',[{'page_no':1,'id':identifier,'patch':{'x':140}}])
    with pytest.raises(store.DocumentConflict):
        store.patch_document('material',0,'stale',[{'page_no':1,'id':identifier,'patch':{'x':200}}])
    assert store.read_document('material')['pages'][0]['nodes'][0]['x']==140


def test_duplicate_delete_and_restore_are_object_operations(source_deck,tmp_path,monkeypatch):
    from app.documents import store
    from app.documents.importer import import_document
    monkeypatch.setattr(store,'document_root',lambda _:tmp_path/'document')
    store.write_document('material',import_document(source_deck,'Test'))
    node=store.read_document('material')['pages'][0]['nodes'][0]
    updated=store.patch_document('material',0,'copy',[{'page_no':1,'id':'u_copy',
      'create':{'duplicate_from':node['id'],'x':160,'y':170}}])
    copy=updated['pages'][0]['nodes'][-1]
    assert copy['text']=='Original text' and copy['source_element_id'] is None
    store.patch_document('material',1,'delete',[{'page_no':1,'id':node['id'],'patch':{'deleted':True}}])
    restored=store.patch_document('material',2,'undo',[{'page_no':1,'id':node['id'],'patch':{'deleted':False}}])
    assert not restored['pages'][0]['nodes'][0]['deleted']


def test_native_chart_and_table_are_imported_as_editable_data(tmp_path):
    from pptx.chart.data import ChartData
    from pptx.enum.chart import XL_CHART_TYPE
    from app.documents.importer import import_document
    ppt=Presentation();slide=ppt.slides.add_slide(ppt.slide_layouts[6])
    data=ChartData();data.categories=['Jan','Feb'];data.add_series('Sales',[2,4])
    slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED,0,0,Inches(4),Inches(3),data)
    table=slide.shapes.add_table(2,2,0,Inches(3),Inches(4),Inches(1)).table
    table.cell(0,0).text='Category';table.cell(1,0).text='Jan'
    source=tmp_path/'data.pptx';ppt.save(source)
    nodes=import_document(source,'Data')['pages'][0]['nodes']
    assert nodes[0]['chart']['categories']==['Jan','Feb']
    assert nodes[0]['chart']['series'][0]['values']==[2,4]
    assert nodes[1]['table'][1][0]=='Jan'


def test_new_object_undo_saved_and_redo_restores_tombstone(source_deck,tmp_path,monkeypatch):
    from app.documents import store
    from app.documents.importer import import_document
    monkeypatch.setattr(store,'document_root',lambda _:tmp_path/'document')
    store.write_document('material',import_document(source_deck,'Test'))
    creation={'page_no':1,'id':'u_added','create':{'type':'text','text':'Added','x':100}}
    store.patch_document('material',0,'add',[creation])
    store.patch_document('material',1,'undo',[{'page_no':1,'id':'u_added','patch':{'deleted':True}}])
    result=store.patch_document('material',2,'redo',[creation])
    assert len([n for n in result['pages'][0]['nodes'] if n['id']=='u_added'])==1
    assert not result['pages'][0]['nodes'][-1]['deleted']


def test_new_object_initial_mutable_properties_survive_first_save(source_deck,tmp_path,monkeypatch):
    from app.documents import store
    from app.documents.importer import import_document
    monkeypatch.setattr(store,'document_root',lambda _:tmp_path/'document')
    store.write_document('material',import_document(source_deck,'Test'))
    result=store.patch_document('material',0,'add',[{'page_no':1,'id':'u_added','create':{'type':'shape','opacity':.25,'hidden':True,'locked':True,
      'crop':{'left':.1,'right':0,'top':0,'bottom':0}}}])
    node=result['pages'][0]['nodes'][-1]
    assert node['opacity']==.25 and node['hidden'] and node['locked'] and node['crop']['left']==.1


def test_frozen_delivery_contains_only_visible_current_content(source_deck,tmp_path,monkeypatch):
    import json
    from PIL import Image
    from app.documents import store,layers,presentation
    from app.documents.importer import import_document
    root=tmp_path/'document'
    for module in (store,layers,presentation):monkeypatch.setattr(module,'document_root',lambda _:root)
    doc=import_document(source_deck,'Test');node=doc['pages'][0]['nodes'][0]
    node['text']='Current only';node['content_changed']=True
    hidden={**deepcopy(node),'id':'u_hidden','text':'Hidden secret','hidden':True}
    doc['pages'][0].update(modified=True,nodes=[node,hidden]);store.write_document('material',doc)
    target=layers.layer_dir('material',doc['source_key'],1);target.mkdir(parents=True)
    for name in ('background.png',node['id']+'.png',node['id']+'_empty.png'):Image.new('RGBA',(2,2)).save(target/name)
    (target/'manifest.json').write_text(json.dumps({'status':'ready','exporter_version':4,'background':'background.png','objects':{
      node['id']:{'asset':node['id']+'.png','empty':node['id']+'_empty.png','asset_frame':[4,4],'asset_scale':2.66667,'asset_size':[10,10]}}}),encoding='utf-8')
    frozen=presentation.freeze_document('material')
    raw=json.dumps(frozen)
    assert 'Original text' not in raw and 'Hidden secret' not in raw
    assert len(frozen['pages'][0]['nodes'])==1
    assert frozen['pages'][0]['nodes'][0].get('image_url') is None


def test_frozen_objects_and_invalid_images_are_rejected_atomically(source_deck,tmp_path,monkeypatch):
    import json
    from app.documents import store
    from app.documents.importer import import_document
    root=tmp_path/'document';monkeypatch.setattr(store,'document_root',lambda _:root)
    doc=import_document(source_deck,'Test');store.write_document('material',doc)
    target=root/'layers'/doc['source_key']/'p01';target.mkdir(parents=True)
    (target/'manifest.json').write_text(json.dumps({'frozen_ids':[doc['pages'][0]['nodes'][0]['id']]}))
    with pytest.raises(ValueError,match='独立分离'):
        store.patch_document('material',0,'frozen',[{'page_no':1,'id':doc['pages'][0]['nodes'][0]['id'],'patch':{'deleted':True}}])
    for data in ('data:image/png;base64,INVALID','data:image/png;base64,YWJjZA=='):
        with pytest.raises(ValueError,match='图片内容'):
            store.patch_document('material',0,'image',[{'page_no':1,'id':'u_image','create':{'type':'image','image_data':data}}])
    assert store.read_document('material')['revision']==0


def test_public_scene_is_a_nested_whitelist():
    from app.documents.presentation import public_document
    dirty={'revision':2,'title':'Test','session_id':'secret','source_key':'source','pages':[{'page_no':1,'width':720,'height':405,'file_path':'secret',
      'background_url':'http://private/asset.png','nodes':[{'id':'n_1','type':'text','text':'Current','base_text':None,'material_id':'secret',
        'image_url':'/api/v1/materials/private/image.png','style':{'color':'#ffffff','secret':'secret'},'base_style':{},'image_frame':[4,6],'image_scale':2.66667,'image_size':[120,80],'background_frame':[4,4],'background_scale':2.66667,'background_size':[100,50],'word_wrap':False,
        'paragraphs':[{'text':'Current','private':'secret','runs':[{'text':'Current','style':{'bold':True,'private':'secret'}}]}]}]}]}
    safe=public_document(dirty)
    import json
    assert 'secret' not in json.dumps(safe) and 'private' not in json.dumps(safe)
    assert safe['pages'][0]['nodes'][0]['text']=='Current'
    assert safe['pages'][0]['nodes'][0]['image_frame']==[4.0,6.0] and safe['pages'][0]['nodes'][0]['image_scale']==2.66667
    assert safe['pages'][0]['nodes'][0]['word_wrap'] is False


def test_document_api_auth_conflict_assets_and_no_render_jobs(source_deck,tmp_path,monkeypatch):
    import json
    from fastapi.testclient import TestClient
    from sqlalchemy import select,func
    from app.documents import store,layers,presentation
    from app.db.models import MaterialRecord,JobRecord
    from app.db.session import session_scope,reset_engine_cache
    from app.settings import get_settings
    from app.main import create_app
    from app.schemas.common import to_iso,utc_now
    monkeypatch.setenv('DATABASE_URL','sqlite:///'+(tmp_path/'api.db').as_posix())
    monkeypatch.setenv('SESSION_COOKIE_SECURE','false');monkeypatch.setenv('ENFORCE_CSRF','true')
    get_settings.cache_clear();reset_engine_cache()
    root=tmp_path/'document'
    for module in (store,layers,presentation):monkeypatch.setattr(module,'document_root',lambda _:root)
    monkeypatch.setattr(layers,'working_path',lambda _:source_deck)
    try:
        app=create_app()
        with TestClient(app) as owner,TestClient(app) as other,TestClient(app) as anonymous:
            session=owner.post('/api/v1/sessions').json()['data'];guest=other.post('/api/v1/sessions').json()['data']
            headers={'X-CSRF-Token':session['csrf_token']}
            with session_scope() as db:
                db.add(MaterialRecord(id='mat_free_api',session_id=session['session_id'],title='Test',status='ready',page_count=1,
                  created_at=to_iso(utc_now()),expires_at='2035-01-01T00:00:00Z'))
            url='/api/v1/materials/mat_free_api/document'
            assert anonymous.get(url).status_code==401
            assert other.get(url).status_code==404
            doc=owner.get(url).json()['data'];node=doc['pages'][0]['nodes'][0]
            patch={'expected_revision':0,'operation_id':'api_edit','changes':[{'page_no':1,'id':node['id'],'patch':{'text':'Current','x':180}}]}
            assert owner.patch(url,json=patch).status_code==422
            assert other.patch(url,json=patch,headers={'X-CSRF-Token':guest['csrf_token']}).status_code==404
            before=source_deck.read_bytes()
            assert owner.patch(url,json=patch,headers=headers).status_code==200
            assert owner.patch(url,json=patch,headers=headers).json()['data']['revision']==1
            patch['operation_id']='conflicting'
            response=owner.patch(url,json=patch,headers=headers)
            assert response.status_code==409 and response.json()['error']['code']=='VERSION_CONFLICT'
            assert owner.get(url).json()['data']['pages'][0]['nodes'][0]['text']=='Current'
            assert source_deck.read_bytes()==before
            with session_scope() as db:assert db.scalar(select(func.count()).select_from(JobRecord))==0
            from PIL import Image
            target=layers.layer_dir('mat_free_api',doc['source_key'],1);target.mkdir(parents=True)
            for name in ('background.png',node['id']+'.png',node['id']+'_empty.png'):Image.new('RGBA',(2,2)).save(target/name)
            (target/'manifest.json').write_text(json.dumps({'status':'ready','exporter_version':4,'background':'background.png','objects':{
              node['id']:{'asset':node['id']+'.png','empty':node['id']+'_empty.png','asset_frame':[4,4],'asset_scale':2.66667,'asset_size':[10,10]}}}))
            asset=f'{url}/assets/{doc["source_key"]}/1/{node["id"]}.png'
            assert owner.get(asset).status_code==200
            assert other.get(asset).status_code==404
            assert owner.get(asset.replace(node['id']+'.png','manifest.json')).status_code==404
            published=owner.post('/api/v1/materials/mat_free_api/publish',headers=headers)
            assert published.status_code==201,published.text
            share=published.json()['data']['share_id']
            snapshot=anonymous.get('/api/v1/p/'+share).json()['data']
            assert snapshot['pages'][0]['image_url'] is None and snapshot['pages'][0]['elements']==[]
            assert snapshot['scene_document']['pages'][0]['nodes'][0]['text']=='Current'
            assert 'Original text' not in json.dumps(snapshot) and 'mat_free_api' not in json.dumps(snapshot)
            patch.update(expected_revision=1,operation_id='after_publish',changes=[{'page_no':1,'id':node['id'],'patch':{'text':'Later'}}])
            assert owner.patch(url,json=patch,headers=headers).status_code==200
            assert anonymous.get('/api/v1/p/'+share).json()['data']['scene_document']['pages'][0]['nodes'][0]['text']=='Current'
    finally:
        reset_engine_cache();get_settings.cache_clear()


def test_freeze_fails_fast_when_edited_page_is_not_prepared(source_deck, tmp_path, monkeypatch):
    """Publish/export must not run PowerPoint synchronously for legacy missing layers."""
    from app.documents import layers, presentation, store
    from app.documents.importer import import_document
    root = tmp_path / 'document'
    for module in (store, layers, presentation):
        monkeypatch.setattr(module, 'document_root', lambda _: root)
    doc = import_document(source_deck, 'Test')
    doc['pages'][0]['modified'] = True
    doc['pages'][0].pop('native_ready')
    store.write_document('material', doc)
    with pytest.raises(ValueError, match='仍在准备'):
        presentation.freeze_document('material')

def test_vector_create_and_style_validation():
    from app.documents.store import _create, validate_patch
    node = _create({"nodes": []}, "arrow", {
        "type": "vector", "x": 80, "y": 60, "width": 120, "height": 16,
        "rotation": -30, "style": {"stroke": "#123456", "stroke_width": 3,
                                    "line_style": "dashed", "arrow_end": True},
    })
    assert node["type"] == "vector"
    assert node["style"]["line_style"] == "dashed"
    assert node["style"]["arrow_end"] is True
    with pytest.raises(ValueError):
        validate_patch({"style": {"line_style": "arbitrary"}})
    with pytest.raises(ValueError):
        validate_patch({"style": {"arrow_end": "true"}})
    validate_patch({"style": {"anim_step": 2, "bind_mode": "scale"}})
    validate_patch({"basis": {"firstId": "a", "secondId": "b", "resultId": "c", "title": [40, 24], "fontSize": 20}})
    validate_patch({"basis": None})
    with pytest.raises(ValueError):
        validate_patch({"style": {"anim_step": 12}})
    with pytest.raises(ValueError):
        validate_patch({"style": {"bind_mode": "unknown"}})
    with pytest.raises(ValueError):
        validate_patch({"basis": {"firstId": "a", "secondId": "a", "resultId": "c", "title": [40, 24], "fontSize": 20}})

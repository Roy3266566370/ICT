import base64
from io import BytesIO

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE, MSO_CONNECTOR
from pptx.util import Inches


def test_native_import_materializes_shape_line_picture_and_notes(tmp_path):
    from app.documents.importer import import_document

    source = tmp_path / 'source.pptx'
    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[6])
    slide.notes_slide.notes_text_frame.text = '教学备注'
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = RGBColor.from_string('FBF0D0')
    shape = slide.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.DIAMOND, 0, 0, Inches(2), Inches(1))
    shape.fill.solid()
    shape.fill.fore_color.rgb = RGBColor.from_string('00AACC')
    slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, 0, 0, Inches(2), Inches(1))
    image = BytesIO()
    Image.new('RGB', (20, 20), 'red').save(image, format='PNG')
    slide.shapes.add_picture(image, 0, 0)
    deck.save(source)

    page = import_document(source, 'Demo', asset_root=tmp_path / 'native')['pages'][0]
    assert page['notes'] == '教学备注'
    assert page['background_color'] == '#fbf0d0'
    assert page['native_ready'] and not page['native_fallback']
    assert page['nodes'][0]['shape'] == 'diamond'
    assert page['nodes'][0]['style']['fill'] == '#00aacc'
    assert page['nodes'][1]['type'] == 'vector'
    assert (tmp_path / 'native' / 'p01' / page['nodes'][2]['native_file']).is_file()


def test_export_writes_and_reorders_editable_objects(tmp_path):
    from app.documents.importer import import_document
    from app.documents.pptx_export import export_pptx

    source = tmp_path / 'source.pptx'
    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[6])
    slide.shapes.add_textbox(10, 20, Inches(1), Inches(1)).text = 'Remove me'
    deck.save(source)
    document = import_document(source, 'Demo')
    page = document['pages'][0]
    page['nodes'][0]['deleted'] = True
    layout = {**page['nodes'][0], 'source_shape_id': None, 'source_element_id': None,
              'asset_id': None, 'deleted': False, 'x': 20, 'y': 30, 'width': 150, 'height': 100}
    image = BytesIO()
    Image.new('RGB', (20, 20), 'red').save(image, format='PNG')
    picture = 'data:image/png;base64,' + base64.b64encode(image.getvalue()).decode()
    new_nodes = [
        {**layout, 'id': 'new_shape', 'type': 'shape', 'shape': 'diamond'},
        {**layout, 'id': 'new_line', 'type': 'vector', 'rotation': 45, 'style': {'arrow_end': True}},
        {**layout, 'id': 'new_chart', 'type': 'chart',
         'chart': {'categories': ['A', 'B'], 'series': [{'name': 'Data', 'values': [1, 2]}]}},
        {**layout, 'id': 'new_table', 'type': 'table', 'table': [['1', '2']]},
        {**layout, 'id': 'new_image', 'type': 'image', 'image_data': picture},
        {**layout, 'id': 'new_workshop', 'type': 'workshop_plugin', 'workshop_plugin': {'title': '教学演示'}},
    ]
    page.update(modified=True, notes='Speaker notes')
    new_page = {**page, 'page_no': 2, 'source_page_no': None, 'nodes': new_nodes, 'notes': 'New slide notes'}
    document.update(structure_modified=True, pages=[new_page, page])
    result = Presentation(BytesIO(export_pptx('material', source, document, work_url='https://example.test/work')))
    shapes = list(result.slides[0].shapes)
    assert len(shapes) == 6 and not len(result.slides[1].shapes)
    assert shapes[0].auto_shape_type == MSO_AUTO_SHAPE_TYPE.DIAMOND
    assert shapes[2].chart.series[0].values == (1.0, 2.0)
    assert shapes[3].table.cell(0, 1).text == '2'
    assert shapes[4].image.size == (20, 20)
    assert '教学演示' in shapes[5].text
    assert result.slides[0].notes_slide.notes_text_frame.text.startswith('New slide notes')
    assert 'https://example.test/work' in result.slides[0].notes_slide.notes_text_frame.text
    assert result.slides[1].notes_slide.notes_text_frame.text == 'Speaker notes'

    from app.documents.pptx_export import snapshot_png
    rendered=Presentation(BytesIO(export_pptx('material',source,document,
        snapshots={(2,'new_workshop'):snapshot_png(picture)})))
    assert rendered.slides[0].shapes[-1].image.size == (20,20)


def test_copy_source_page_preserves_assets_and_original_notes(tmp_path):
    from copy import deepcopy
    from app.documents.importer import import_document
    from app.documents.pptx_export import export_pptx

    source=tmp_path/'source.pptx'
    deck=Presentation()
    slide=deck.slides.add_slide(deck.slide_layouts[6])
    slide.notes_slide.notes_text_frame.text='Original notes'
    image=BytesIO()
    Image.new('RGB',(20,20),'red').save(image,format='PNG')
    slide.shapes.add_picture(image,0,0)
    line=slide.shapes.build_freeform(0,0)
    line.add_line_segments([(2400,300),(1700,2000)])
    line.convert_to_shape()
    deck.save(source)
    doc=import_document(source,'Demo',asset_root=tmp_path/'native')
    page=doc['pages'][0]
    assert page['nodes'][1]['shape_paths'][0]['path'].startswith('M 0 0 L 2400 300')
    copy=deepcopy(page)
    copy.update(page_no=2,source_page_no=1,modified=True,notes='Copied notes')
    copy['nodes'].append({**copy['nodes'][1], 'id':'u_freeform', 'source_shape_id':None,
                          'source_element_id':None, 'x':120, 'z':2})
    doc.update(pages=[copy,page],structure_modified=True)
    modified=Presentation(BytesIO(export_pptx('material',source,doc)))
    assert modified.slides[0].shapes[0].image.size==(20,20)
    assert modified.slides[0].shapes[1].shape_type.name=='FREEFORM'
    assert modified.slides[0].shapes[2].shape_type.name=='FREEFORM'
    assert modified.slides[0].notes_slide.notes_text_frame.text=='Copied notes'
    assert modified.slides[1].notes_slide.notes_text_frame.text=='Original notes'


def test_pptx_notes_link_uses_only_public_share_at_matching_revision():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from starlette.requests import Request
    from app.api.routes_materials import _pptx_interactive_url
    from app.db.models import ShareRecord

    engine=create_engine('sqlite://')
    ShareRecord.__table__.create(engine)
    request=Request({'type':'http','scheme':'https','server':('example.test',443),'path':'/','headers':[]})
    with Session(engine) as db:
        db.add_all([
            ShareRecord(share_id='matching',material_id='material',session_id='owner',
                        created_at='2026-11-22',snapshot_json={'scene_document':{'revision':2}}),
            ShareRecord(share_id='stale',material_id='material',session_id='owner',
                        created_at='2026-11-23',snapshot_json={'scene_document':{'revision':1}}),
            ShareRecord(share_id='revoked',material_id='material',session_id='owner',revoked_at='2026-11-23',
                        created_at='2026-11-23',snapshot_json={'scene_document':{'revision':2}}),
        ])
        db.flush()
        assert _pptx_interactive_url(db,request,'material',2)=='https://example.test/p/matching'
        assert _pptx_interactive_url(db,request,'material',3)=='https://example.test/materials/material/work'

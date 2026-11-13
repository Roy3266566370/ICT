from pathlib import Path
from copy import deepcopy

import pytest
from pptx import Presentation
from pptx.chart.data import ChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches, Pt


@pytest.fixture
def editable_deck(tmp_path):
    source = tmp_path / 'uploaded.pptx'
    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[6])
    text = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(5), Inches(1))
    text.text = 'Original heading'
    text.text_frame.paragraphs[0].runs[0].font.size = Pt(27)
    table = slide.shapes.add_table(2, 2, Inches(1), Inches(3), Inches(5), Inches(1)).table
    table.cell(0, 0).text, table.cell(0, 1).text = 'Name', 'Score'
    table.cell(1, 0).text, table.cell(1, 1).text = 'A', '3'
    data = ChartData()
    data.categories = ['A', 'B']
    data.add_series('Values', [2, 3])
    slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1), Inches(4), Inches(5), Inches(2), data)
    deck.save(source)
    return source


def test_editing_changes_real_text_preserving_original_and_font(editable_deck, tmp_path):
    from app.editing import apply_native_edits
    target = tmp_path / 'working.pptx'
    before = editable_deck.read_bytes()
    apply_native_edits(editable_deck, target, [{'page': 1, 'element_id': 'p01_s00', 'kind': 'text', 'text': 'Edited heading'}])
    changed = Presentation(target).slides[0].shapes[0]
    assert changed.text == 'Edited heading'
    assert changed.text_frame.paragraphs[0].runs[0].font.size == Pt(27)
    assert editable_deck.read_bytes() == before


def test_editing_changes_native_chart_and_table(editable_deck, tmp_path):
    from app.editing import apply_native_edits
    target = tmp_path / 'working.pptx'
    changes = [
        {'page': 1, 'element_id': 'p01_s01', 'kind': 'table', 'rows': [['Name', 'Score'], ['A', '42']]},
        {'page': 1, 'element_id': 'p01_s02', 'kind': 'chart', 'categories': ['A', 'B'],
         'series': [{'name': 'Values', 'values': [8, 9]}]},
    ]
    expected = deepcopy(changes)
    apply_native_edits(editable_deck, target, changes)
    shapes = Presentation(target).slides[0].shapes
    assert shapes[1].table.cell(1, 1).text == '42'
    assert list(shapes[2].chart.series[0].values) == [8, 9]
    assert changes == expected


def test_unknown_or_mismatched_element_does_not_create_working_file(editable_deck, tmp_path):
    from app.editing import apply_native_edits
    target = tmp_path / 'working.pptx'
    with pytest.raises(ValueError):
        apply_native_edits(editable_deck, target, [{'page': 2, 'element_id': 'p01_s00', 'kind': 'text', 'text': 'wrong'}])
    assert not target.exists()


def test_nonfinite_chart_data_is_rejected(editable_deck, tmp_path):
    from app.editing import apply_native_edits
    with pytest.raises(ValueError):
        apply_native_edits(editable_deck, tmp_path/'working.pptx', [{'page': 1, 'element_id': 'p01_s02',
            'kind': 'chart', 'categories': ['A'], 'series': [{'name': 'Values', 'values': [float('inf')]}]}])


def test_editing_native_equation_removes_old_math_xml(editable_deck, tmp_path):
    from lxml import etree
    from app.editing import apply_native_edits
    deck=Presentation(editable_deck)
    shape=deck.slides[0].shapes[0]
    shape.text=''
    math=etree.fromstring(b'<a14:m xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:oMath><m:r><m:t>y=x+1</m:t></m:r></m:oMath></a14:m>')
    shape.text_frame.paragraphs[0]._p.append(math)
    deck.save(editable_deck)
    target=tmp_path/'edited-equation.pptx'
    apply_native_edits(editable_deck,target,[{'page':1,'element_id':'p01_s00','kind':'text','text':'y=x+2'}])
    changed=Presentation(target).slides[0].shapes[0]
    assert changed.text=='y=x+2'
    assert 'y=x+1' not in changed._element.xml


def test_editor_blocks_an_in_progress_readable_material(tmp_path, monkeypatch):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from types import SimpleNamespace
    from app.api import routes_editor
    from app.db.base import Base
    from app.db.models import JobRecord
    from app.schemas.errors import ApiError
    material=SimpleNamespace(id='mat_busy',status='readable')
    monkeypatch.setattr(routes_editor,'owned_material',lambda *args:material)
    monkeypatch.setattr(routes_editor,'read_metadata',lambda _: {'revision':0})
    engine=create_engine('sqlite://')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(JobRecord(id='job_busy',material_id='mat_busy',session_id='session',kind='upload',
          stage='extracting',attempt=1,created_at='2026-11-02T00:00:00Z',updated_at='2026-11-02T00:00:00Z'))
        db.commit()
        with pytest.raises(ApiError,match='正在处理'):
            routes_editor.put_editor('mat_busy',routes_editor.EditRequest(expected_revision=0),None,
                                     SimpleNamespace(session_id='session'),db,None)

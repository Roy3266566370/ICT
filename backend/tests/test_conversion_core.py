"""Conversion regressions: source evidence, actual computations, and delivered pages."""
from copy import deepcopy

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.base import Base
from app.db.models import PageRecord, ElementRecord
from app.ispec import build_ispecs_detailed, validate_ispec


def page_payload(texts, page_no=1):
    return {"material_id": "mat_unfamiliar", "pages": [{
        "page_no": page_no, "title": "An unfamiliar lesson", "width": 9144000,
        "height": 6858000, "paragraphs": texts,
        "elements": [{"element_id": f"p{page_no}_e{i}", "kind": "text", "text": text,
                      "bbox": {"x": 100000, "y": 500000 + i * 400000, "w": 4000000, "h": 300000}}
                     for i, text in enumerate(texts)]}]}


def test_detail_uses_the_materials_rendered_page(monkeypatch):
    from app.api import routes_materials as routes
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(routes, "_render_pages_payload", lambda _: [
        {"page_no": 1, "image_url": "renders/s01.png"}])
    with Session(engine) as db:
        db.add(PageRecord(id="pg_test", material_id="mat_test", page_no=1,
                          title="Own page", paragraphs=[], excerpt=""))
        db.commit()
        assert routes._slides(db, "mat_test")[0].image_url == "/api/v1/materials/mat_test/renders/s01.png"


def test_material_detail_accepts_native_chart_and_table_elements(monkeypatch):
    from app.api import routes_materials as routes
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    monkeypatch.setattr(routes, '_render_pages_payload', lambda _: [])
    with Session(engine) as db:
        db.add(PageRecord(id='pg_chart', material_id='mat_chart', page_no=1, title='Native content', paragraphs=[], excerpt=''))
        for kind in ('chart', 'table', 'group'):
            db.add(ElementRecord(id=f'el_{kind}', material_id='mat_chart', page_id='pg_chart',
                                 page_no=1, element_id=f'p1_{kind}', kind=kind, name=kind))
        db.commit()
        assert [e.kind for e in routes._slides(db, 'mat_chart')[0].elements] == ['chart', 'group', 'table']


def test_text_formula_produces_a_real_computation():
    result = build_ispecs_detailed(page_payload(["s = 0.5 * a * t^2", "a = 2", "t = 3"]))
    spec = next((s for s in result.ispecs if any(e["id"] == "s" for e in s.get("expressions", []))), None)
    assert spec is not None, "A readable formula must produce a computable iSpec"
    assert {p["id"]: p["default"] for p in spec["parameters"]} == {"a": 2, "t": 3}
    assert not validate_ispec(spec)
    assert all(p["source"]["page"] == 1 for p in spec["parameters"])


def test_formula_does_not_invent_output_parameters_or_execute_code():
    result = build_ispecs_detailed(page_payload(["y = x + 2", "x = 3"]))
    assert result.ispecs, "Plain text arithmetic is part of basic conversion"
    assert [p["id"] for p in result.ispecs[0]["parameters"]] == ["x"]
    dangerous = build_ispecs_detailed(page_payload(["y = __import__('os').system('echo unsafe')"]))
    assert not dangerous.ispecs


def test_vector_mapping_is_derived_from_source_and_survives_page_reordering():
    data = page_payload(["(1, 0) → (2, 1)", "(1, 1) → (3, 3)", "(1, -1) → (1, -1)"], page_no=7)
    before = deepcopy(data)
    result = build_ispecs_detailed(data)
    spec = next((s for s in result.ispecs if any(v["type"] == "figure" for v in s["views"])), None)
    assert spec is not None, "Native vector mappings must reach the general runtime"
    values = {p["id"]: p["default"] for p in spec["parameters"]}
    assert [values[k] for k in ("a", "b", "c", "d")] == [2, 1, 1, 2]
    assert all(p["source"]["page"] == 7 for p in spec["parameters"])
    assert not validate_ispec(spec)
    assert data == before


def test_inconsistent_or_insufficient_mappings_are_not_activated():
    assert not build_ispecs_detailed(page_payload(["(1, 0) → (2, 1)"])).ispecs
    assert not build_ispecs_detailed(page_payload([
        "(1, 0) → (2, 1)", "(0, 1) → (1, 2)", "(1, 1) → (9, 9)"])).ispecs


def test_formula_default_cannot_be_a_numeric_prefix_of_another_expression():
    result = build_ispecs_detailed(page_payload(["y = x + 1", "x = 2*t", "t = 3"]))
    spec = next(s for s in result.ispecs if any(e['id'] == 'y' for e in s['expressions']))
    parameter = next(p for p in spec['parameters'] if p['id'] == 'x')
    assert parameter['source']['status'] == 'inferred'
    assert parameter['default'] != 2


def test_all_superscript_digits_are_exponents_and_arity_matches_runtime():
    result = build_ispecs_detailed(page_payload(["y = x⁵", "x = 2"]))
    assert result.ispecs[0]['expressions'][-1]['expr'] == 'x ** 5'
    assert not build_ispecs_detailed(page_payload(["y = sqrt(x,2)", "x = 4"])).ispecs
    assert not build_ispecs_detailed(page_payload(["B = PᵀAP"])).ispecs


def test_same_symbol_on_unrelated_native_pages_is_not_automatically_shared():
    payload = page_payload(["s = a*t", "a = 2", "t = 3"])
    payload['pages'] += page_payload(["y = a*x", "a = 10", "x = 4"], page_no=2)['pages']
    result = build_ispecs_detailed(payload)
    assert len(result.ispecs) == 2
    assert all('shared_key' not in p for s in result.ispecs for p in s['parameters'])


def test_extracted_small_decimals_are_not_forced_onto_a_coarse_slider_grid():
    spec = build_ispecs_detailed(page_payload(['y = x*2', 'x = 0.01'])).ispecs[0]
    parameter = spec['parameters'][0]
    assert parameter['default'] == 0.01
    assert 'step' not in parameter or (parameter['default'] - parameter['min']) / parameter['step'] == pytest.approx(
        round((parameter['default'] - parameter['min']) / parameter['step']))


def test_render_pipeline_preserves_a_four_by_three_deck(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from zipfile import ZipFile
    from app.api import routes_jobs
    source = tmp_path / 'portrait-free-name.pptx'
    with ZipFile(source, 'w') as archive:
        archive.writestr('ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldSz cx="9144000" cy="6858000"/></p:presentation>')
    options = {}
    def capture(*args, **kwargs):
        options.update(kwargs)
    monkeypatch.setattr(routes_jobs, 'transition', lambda *args, **kwargs: None)
    monkeypatch.setattr(routes_jobs, 'render_for_material', capture)
    routes_jobs._render_pages(SimpleNamespace(commit=lambda: None), None,
        SimpleNamespace(id='mat_ratio', status='processing'), source)
    assert options['width'] == 1920
    assert options['height'] == 1440
    assert options['page_size_in'] == (10, 7.5)


def test_share_delivers_parsed_ispecs_instead_of_losing_them(monkeypatch):
    from app.api import routes_jobs, routes_publish
    spec = {"spec_version": "1.0", "object_id": "own_formula", "kind": "parametric",
            "parameters": [{"id": "x", "label": "x", "default": 2,
                            "source": {"page": 1, "element_id": "e1", "bbox": None,
                                       "status": "original", "excerpt": "x=2"}}],
            "expressions": [{"id": "answer", "expr": "x+3"}],
            "views": [{"type": "text", "template": "{{answer}}"}]}
    monkeypatch.setattr(routes_jobs, "read_ispec_payload", lambda _: {"ispecs": [spec]})
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        assert routes_publish._build_ispecs(db, "mat_unfamiliar") == [spec]


def test_failed_or_active_conversion_is_not_reupgraded_by_material_read():
    from app.api.routes_materials import should_upgrade_conversion
    assert should_upgrade_conversion(1, None, 'readable', True) is True
    assert should_upgrade_conversion(2, None, 'readable', True) is True
    assert should_upgrade_conversion(3, None, 'readable', True) is False
    assert should_upgrade_conversion(1, 'failed', 'readable', True) is False
    assert should_upgrade_conversion(1, 'extracting', 'readable', True) is False
    assert should_upgrade_conversion(1, None, 'failed', True) is False
    assert should_upgrade_conversion(1, None, 'processing', True) is False
    assert should_upgrade_conversion(1, None, 'readable', False) is False

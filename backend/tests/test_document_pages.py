from copy import deepcopy

import pytest

from app.documents import store


def test_page_order_copies_archive_restore_and_rich_text(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'document_root', lambda _: tmp_path)
    paragraphs = [{'text': 'orig', 'runs': [{'text': 'orig', 'style': {'bold': True}}]}]
    node = {'id': 'n_title', 'text': 'orig', 'base_text': 'orig', 'paragraphs': paragraphs, 'style': {}}
    page = {'page_no': 1, 'width': 720, 'height': 405, 'nodes': [node]}
    store.write_document('deck', {'revision': 0, 'source_key': 'source', 'pages': [page]})

    def action(page_no, kind, **fields):
        return {'page_no': page_no, 'id': '__page__', 'page_action': {'kind': kind, **fields}}

    rich = [{'text': 'edited', 'bullet': True, 'runs': [{'text': 'edited', 'style': {'baseline': 25, 'highlight': '#FFFF00'}}]}]
    document = store.patch_document('deck', 0, 'arrange', [
        action(2, 'duplicate_page', **{'from': 1}),
        action(3, 'add_page', width=720, height=405),
        action(0, 'reorder_pages', order=[2, 3, 1]),
        action(2, 'page_metadata', patch={'notes': '讲稿', 'background_color': '#FFEECC'}),
        {'page_no': 2, 'id': 'n_title', 'patch': {'text': 'edited', 'paragraphs': rich}},
    ])
    assert [page['page_no'] for page in document['pages']] == [2, 3, 1]
    assert document['structure_modified']
    assert document['pages'][0]['source_page_no'] == 1
    assert document['pages'][0]['notes'] == '讲稿'
    assert document['pages'][0]['nodes'][0]['paragraphs'] == rich
    assert document['pages'][0]['nodes'][0]['base_paragraphs'] == paragraphs
    assert document['pages'][1]['source_page_no'] is None
    before = deepcopy(document)
    with pytest.raises(ValueError):
        store.patch_document('deck', 1, 'invalid', [action(0, 'reorder_pages', order=[1, 2, 2])])
    assert store.read_document('deck') == before
    removed = store.patch_document('deck', 1, 'remove', [action(2, 'delete_page')])
    assert [page['page_no'] for page in removed['pages']] == [3, 1]
    restored = store.patch_document('deck', 2, 'restore', [action(2, 'restore_page'), action(0, 'reorder_pages', order=[2, 3, 1])])
    assert restored['pages'] == before['pages']


def test_native_shape_table_and_chart_insertions(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'document_root', lambda _: tmp_path)
    page = {'page_no': 1, 'width': 720, 'height': 405, 'nodes': []}
    store.write_document('deck', {'revision': 0, 'source_key': 'source', 'pages': [page]})
    table = [['项目', '数值'], ['甲', '3']]
    chart = {'categories': ['甲'], 'series': [{'name': '示例', 'values': [3]}]}
    updated = store.patch_document('deck', 0, 'insert', [
        {'page_no': 1, 'id': 'u_brace', 'create': {'type': 'shape', 'name': '左大括号', 'shape': 'leftBrace'}},
        {'page_no': 1, 'id': 'u_table', 'create': {'type': 'table', 'table': table}},
        {'page_no': 1, 'id': 'u_chart', 'create': {'type': 'chart', 'chart': chart}},
    ])
    shape, table_node, chart_node = updated['pages'][0]['nodes']
    assert (shape['shape'], shape['name']) == ('leftBrace', '左大括号')
    assert table_node['table'] == table
    assert chart_node['chart'] == chart


def test_material_stats_include_visible_objects_on_saved_pages(tmp_path, monkeypatch):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from app.api.routes_materials import material_stats
    from app.db.models import KnowledgeObjectRecord, RunRecord

    monkeypatch.setattr(store, 'UPLOAD_DIR', tmp_path)
    engine = create_engine('sqlite://')
    KnowledgeObjectRecord.__table__.create(engine)
    RunRecord.__table__.create(engine)
    store.write_document('deck', {'revision': 0, 'pages': [
        {'page_no': 1, 'width': 720, 'height': 405, 'nodes': [{'type': 'text'}]},
    ]})

    with Session(engine) as db:
        assert material_stats(db, ['deck', 'legacy'])['deck']['object_count'] == 0
        store.patch_document('deck', 0, 'insert', [
            {'page_no': 2, 'id': '__page__', 'page_action': {'kind': 'add_page', 'width': 720, 'height': 405}},
            {'page_no': 2, 'id': 'u_line', 'create': {'type': 'vector'}},
            {'page_no': 2, 'id': 'u_plugin', 'create': {
                'type': 'workshop_plugin',
                'workshop_plugin': {'template_kind': 'biz-breakeven', 'title': '经营沙盘'},
            }},
            {'page_no': 2, 'id': 'u_chart', 'create': {
                'type': 'chart', 'chart': {'categories': ['甲'], 'series': [{'name': '示例', 'values': [3]}]},
            }},
            {'page_no': 2, 'id': '__page__', 'relations': [
                {'id': 'resize_chart', 'kind': 'expr', 'targetId': 'u_chart', 'targetProperty': 'width', 'expression': '100'},
            ]},
        ])
        assert material_stats(db, ['deck'])['deck']['object_count'] == 3
        store.patch_document('deck', 1, 'hide', [
            {'page_no': 2, 'id': 'u_plugin', 'patch': {'hidden': True}},
        ])
        assert material_stats(db, ['deck'])['deck']['object_count'] == 2
        store.patch_document('deck', 2, 'remove', [
            {'page_no': 2, 'id': '__page__', 'page_action': {'kind': 'delete_page'}},
        ])
        assert material_stats(db, ['deck'])['deck']['object_count'] == 0

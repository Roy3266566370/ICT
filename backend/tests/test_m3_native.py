import math
from pathlib import Path
from collections import Counter

import pytest
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_LINE_DASH_STYLE, MSO_THEME_COLOR
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE, MSO_CONNECTOR
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Pt

from app.documents import importer


def _group_frame(group, *, position, size, child_position, child_size, rotation=0, flip=None):
    xfrm = group._element.grpSpPr.xfrm
    xfrm.off.x, xfrm.off.y = map(Pt, position)
    xfrm.ext.cx, xfrm.ext.cy = map(Pt, size)
    xfrm.chOff.x, xfrm.chOff.y = map(Pt, child_position)
    xfrm.chExt.cx, xfrm.chExt.cy = map(Pt, child_size)
    group.rotation = rotation
    if flip:
        xfrm.set(flip, "1")


def _endpoints(node):
    angle = math.radians(node["rotation"])
    dx = math.cos(angle) * node["width"] / 2
    dy = math.sin(angle) * node["width"] / 2
    x = node["x"] + node["width"] / 2
    y = node["y"] + node["height"] / 2
    return (x - dx, y - dy), (x + dx, y + dy)


def test_native_group_keeps_nested_endpoints_style_source_and_order(tmp_path):
    ppt = Presentation()
    slide = ppt.slides.add_slide(ppt.slide_layouts[6])
    group = slide.shapes.add_group_shape()
    inside = group.shapes.add_group_shape()
    line = inside.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Pt(40), Pt(20), Pt(20), Pt(10))
    line.rotation = 90
    line.line.color.theme_color = MSO_THEME_COLOR.ACCENT_2
    line.line.width = Pt(3)
    line.line.dash_style = MSO_LINE_DASH_STYLE.DASH
    marker = OxmlElement("a:headEnd")
    marker.set("type", "triangle")
    line._element.spPr.ln.append(marker)
    label = inside.shapes.add_textbox(Pt(20), Pt(20), Pt(20), Pt(10))
    label.rotation = 30
    run = label.text_frame.paragraphs[0].add_run()
    run.text = "b₁"
    run.font.name = "Arial"
    run.font.size = Pt(14)
    run.font.bold = True
    run.font.color.rgb = RGBColor.from_string("13579B")
    axis = group.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Pt(10), Pt(15), Pt(30), Pt(15))
    _group_frame(inside, position=(10, 20), size=(80, 40), child_position=(10, 10),
                 child_size=(40, 40), rotation=90, flip="flipV")
    _group_frame(group, position=(200, 100), size=(270, 80), child_position=(0, 10),
                 child_size=(90, 80), rotation=90, flip="flipH")
    path = tmp_path / "nested.pptx"
    ppt.save(path)
    page = importer.import_document(path, "nested")["pages"][0]
    root = page["nodes"][0]
    shape = Presentation(path).slides[0].shapes[0]

    nodes = importer.native_group_nodes(shape, root)
    assert nodes is not None
    arrow, text, guide = nodes
    assert [node["source_shape_id"] for node in nodes] == [line.shape_id, label.shape_id, axis.shape_id]
    assert all(node["figure_provenance"] == "native" and node["asset_id"] is None for node in nodes)
    assert arrow["z"] < text["z"] < guide["z"] < root["z"] + 1
    start, end = _endpoints(arrow)
    assert start == pytest.approx((355, 140))
    assert end == pytest.approx((335, 200))
    assert arrow["style"] == {**root["style"], "stroke": "#c0504d", "stroke_width": 3,
                              "line_style": "dashed", "arrow_start": True, "arrow_end": False}
    assert text["type"] == "text" and text["text"] == "b₁"
    assert text["style"]["font_size"] == 14
    assert text["style"]["bold"] is True
    assert text["style"]["color"] == "#13579b"
    assert (text["x"], text["y"]) == pytest.approx((335, 135))
    a, b, c, d = text["text_transform"]
    x, y = a * -10 + c * -5, b * -10 + d * -5
    angle = math.radians(text["rotation"])
    corner = (345 + x * math.cos(angle) - y * math.sin(angle),
              140 + x * math.sin(angle) + y * math.cos(angle))
    assert corner == pytest.approx((357.3205081, 167.9903811))
    assert guide["style"]["stroke"] == "#4f81bd"

    scene = importer.native_figure_scene(nodes, page)
    assert scene is not None
    assert scene["frame"] == {"width": 720, "height": 540}
    assert [item["id"] for item in scene["objects"]] == [node["id"] for node in nodes]
    arrow_evidence, text_evidence, guide_evidence = scene["objects"]
    assert arrow_evidence["points"][0] == pytest.approx((335, 200))
    assert arrow_evidence["points"][1] == pytest.approx((355, 140))
    assert arrow_evidence["type"] == "vector"
    assert f"pptx:shape:{line.shape_id}" in arrow_evidence["evidence"]
    assert text_evidence["points"][0] == pytest.approx((345, 140))
    assert text_evidence["bbox"] == pytest.approx((322.6794919, 112.0096189, 367.3205081, 167.9903811))
    assert guide_evidence["type"] == "segment"


def test_native_group_with_unrepresented_content_preserves_whole_raster(tmp_path):
    ppt = Presentation()
    slide = ppt.slides.add_slide(ppt.slide_layouts[6])
    group = slide.shapes.add_group_shape()
    group.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Pt(20), Pt(20), Pt(70), Pt(35))
    group.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.ARC, Pt(30), Pt(30), Pt(40), Pt(40))
    path = tmp_path / "mixed.pptx"
    ppt.save(path)
    nodes = importer.import_document(path, "mixed")["pages"][0]["nodes"]

    assert len(nodes) == 1
    assert nodes[0]["whole_group"] is True
    assert nodes[0]["asset_id"] == f"n_{group.shape_id}"
    assert importer.native_group_nodes(Presentation(path).slides[0].shapes[0], nodes[0]) is None


def test_linear_algebra_slide_two_matrix_group_is_editable():
    from app.documents.pptx_export import _update_slide

    path = Path(__file__).resolve().parents[2] / 'the_art_of_linear_algebra.pptx'
    page = importer.import_document(path, 'linear-algebra')['pages'][1]
    root = next(node for node in page['nodes'] if node['whole_group'])
    group = next(shape for shape in Presentation(path).slides[1].shapes
                 if shape.shape_id == root['source_shape_id'])
    nodes = importer.native_group_nodes(group, root)

    assert nodes is not None
    assert Counter(node['type'] for node in nodes) == {'shape': 32, 'text': 4}
    assert len({node['id'] for node in nodes}) == len(nodes)
    assert all(node['asset_id'] is None and not node['whole_group'] for node in nodes)
    assert sum(bool(node.get('shape_paths')) for node in nodes) == 8
    assert sum(node['text'] == '$=$' for node in nodes) == 3
    equation = next(node['text'] for node in nodes if 'gathered' in (node['text'] or ''))
    assert equation.count(r'\begin{gathered}') == 3
    page['nodes'] = [node for node in page['nodes'] if node is not root] + nodes
    original_deck = Presentation(path)
    original_slide = original_deck.slides[1]
    scale = importer.EMU_PER_POINT
    _update_slide('linear-algebra', {}, page, original_slide, scale, scale, '', {}, True)
    assert len(original_slide.shapes) == 5

    edited_deck = Presentation(path)
    edited_slide = edited_deck.slides[1]
    nodes[0]['x'] += 10
    _update_slide('linear-algebra', {}, page, edited_slide, scale, scale, '', {}, True)
    assert len(edited_slide.shapes) == 40
    assert all(shape.shape_type.name != 'GROUP' for shape in edited_slide.shapes)


def test_linear_algebra_groups_across_entire_deck_are_editable(tmp_path):
    from app.documents.pptx_export import _write_gradient

    source = Path(__file__).resolve().parents[2] / 'the_art_of_linear_algebra.pptx'
    deck = Presentation(source)
    count = 0
    types = set()
    for page_no, slide in enumerate(deck.slides, 1):
        for group in slide.shapes:
            if group.shape_type.name != 'GROUP':
                continue
            nodes = importer.native_group_nodes(
                group, {'style': {}, 'z': 0, 'opacity': 1}, asset_root=tmp_path / str(page_no),
            )
            assert nodes and len(nodes) > 1, (page_no, group.name)
            count += 1
            for node in nodes:
                types.add(node['type'])
                if 'fill_gradient' in node:
                    assert importer.valid_fill_gradient(node['fill_gradient'])
                    shape = slide.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.RECTANGLE, Pt(0), Pt(0), Pt(10), Pt(10))
                    _write_gradient(shape._element.spPr, node['fill_gradient'])
                    assert shape._element.spPr.xpath('./a:gradFill/a:path/a:fillToRect')
                if node['type'] == 'image':
                    assert (tmp_path / str(page_no) / node['native_file']).is_file()
    assert count == 102
    assert types == {'image', 'shape', 'text', 'vector'}


def test_native_group_preserves_raster_when_connector_uses_effect(tmp_path):
    ppt = Presentation()
    slide = ppt.slides.add_slide(ppt.slide_layouts[6])
    group = slide.shapes.add_group_shape()
    line = group.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Pt(20), Pt(20), Pt(70), Pt(35))
    effects = OxmlElement("a:effectLst")
    glow = OxmlElement("a:glow")
    glow.set("rad", str(Pt(8)))
    color = OxmlElement("a:srgbClr")
    color.set("val", "FF0000")
    glow.append(color)
    effects.append(glow)
    line._element.spPr.append(effects)
    path = tmp_path / "glowing.pptx"
    ppt.save(path)

    root = importer.import_document(path, "glowing")["pages"][0]["nodes"][0]
    assert importer.native_group_nodes(Presentation(path).slides[0].shapes[0], root) is None


def test_upload_switches_only_groups_excluded_from_exported_background(tmp_path, monkeypatch):
    import json

    from app.documents import auto_vectors, capabilities, layers, store
    from app.documents.layer_export import EXPORTER_VERSION

    root = tmp_path / "document"
    root.mkdir()
    source = root / "source.pptx"
    ppt = Presentation()
    for _ in range(2):
        slide = ppt.slides.add_slide(ppt.slide_layouts[6])
        slide.shapes.add_textbox(Pt(5), Pt(5), Pt(30), Pt(10)).text = "Back"
        group = slide.shapes.add_group_shape()
        group.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Pt(20), Pt(30), Pt(70), Pt(30))
        group.shapes.add_textbox(Pt(40), Pt(30), Pt(20), Pt(10)).text = "b"
        slide.shapes.add_textbox(Pt(5), Pt(5), Pt(30), Pt(10)).text = "Front"
    ppt.save(source)
    doc = importer.import_document(source, "layered")
    doc["pages"][0]["modified"] = True
    doc["pages"][0]["nodes"][1]["x"] += 10
    for module in (auto_vectors, layers, store):
        monkeypatch.setattr(module, "document_root", lambda _: root)
    monkeypatch.setattr(capabilities, "layer_editor_available", lambda: (True, None))
    monkeypatch.setattr(auto_vectors, "prepare_page", lambda *_: None)
    store.write_document("test", doc)
    for page in doc["pages"]:
        number = page["page_no"]
        group_id = page["nodes"][1]["id"]
        target = layers.layer_dir("test", doc["source_key"], number)
        target.mkdir(parents=True)
        manifest = {"status": "ready", "background": "background.png", "exporter_version": EXPORTER_VERSION,
                    "objects": {group_id: {"asset": group_id + ".png"}} if number == 1 else {},
                    "frozen_ids": [] if number == 1 else [group_id]}
        (target / "manifest.json").write_text(json.dumps(manifest))

    auto_vectors.prepare_source_vectors("test", "layered", retry_groups=True)

    updated = store.read_document("test")
    extracted, frozen = updated["pages"]
    assert [node["type"] for node in extracted["nodes"]] == ["text", "vector", "text", "text"]
    assert [node["z"] for node in extracted["nodes"]] == [0, 1, 2, 3]
    assert [node["figure_provenance"] for node in extracted["nodes"][1:3]] == ["native", "native"]
    assert all(node["x"] == pytest.approx(node["base_x"] + 10) for node in extracted["nodes"][1:3])
    assert frozen == doc["pages"][1]
    assert updated["revision"] == 1


def test_public_scene_keeps_valid_native_transform_and_provenance():
    from app.documents.presentation import public_document

    valid = {"id": "valid", "type": "text", "text_transform": [2, 0, -.5, 1],
             "figure_provenance": "native"}
    invalid = {**valid, "id": "invalid", "text_transform": [2, 0, float("inf"), 1],
               "figure_provenance": "other", "cleaned_url": "https://internal/asset.png"}
    good, bad = public_document({"pages": [{"nodes": [valid, invalid]}]})["pages"][0]["nodes"]
    assert good["text_transform"] == [2, 0, -.5, 1]
    assert good["figure_provenance"] == "native"
    assert not {"text_transform", "figure_provenance", "cleaned_url"}.intersection(bad)


def test_frozen_rendered_pages_embed_cleaned_or_original_png(tmp_path, monkeypatch):
    from base64 import b64decode

    from PIL import Image

    from app import render
    from app.documents import figure_service, layers, presentation, store

    document_root = tmp_path / "document"
    pages = tmp_path / "pages"
    pages.mkdir()
    for module in (figure_service, layers, store):
        monkeypatch.setattr(module, "document_root", lambda _: document_root)
    monkeypatch.setattr(render, "pages_dir", lambda _: pages)
    originals = []
    for number, color in enumerate(("red", "blue"), 1):
        original = pages / f"s{number:02d}.png"
        Image.new("RGB", (10, 10), color).save(original)
        originals.append(original)
    identifier = "a" * 64
    cleaned = document_root / "figures" / "p01" / "previews" / identifier / "cleaned.png"
    cleaned.parent.mkdir(parents=True)
    Image.new("RGB", (10, 10), "white").save(cleaned)
    original_pages = []
    for number, original in enumerate(originals, 1):
        node = {"id": f"render_{number}", "type": "image", "text": "", "base_text": "",
                "style": {}, "base_style": {}, "render_file": original.name}
        if number == 1:
            node["cleaned_asset_id"] = identifier
        original_pages.append({"page_no": number, "nodes": [node], "rendered_only": True, "modified": True})
    doc = {"source_key": "renders", "title": "pages", "revision": 1, "pages": original_pages}
    store.write_document("test", doc)

    frozen = presentation.freeze_document("test")
    delivered = [page["nodes"][0] for page in frozen["pages"]]
    assert [b64decode(node["image_url"].split(",", 1)[1]) for node in delivered] == [
        cleaned.read_bytes(), originals[1].read_bytes()]
    assert all("cleaned_asset_id" not in node for node in delivered)
    assert store.read_document("test") == doc

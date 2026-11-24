"""工程包导出/导入：哈希、节点 id、页面图与参数值。"""

from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.models import MaterialRecord, PageRecord, SessionRecord
from app.project_package import ProjectPackageError, build_project_archive, import_project_archive


@pytest.mark.parametrize("rendered_only", [False, True])
def test_project_package_roundtrips_applied_figure_without_preview_diagnostics(tmp_path, monkeypatch, rendered_only):
    import base64
    from hashlib import sha256

    from PIL import Image

    from app import project_package as package
    from app.documents import figure_service, layers, store

    def document_root(material_id):
        return tmp_path / "uploads" / material_id / "document"

    for module in (figure_service, layers, package, store):
        monkeypatch.setattr(module, "document_root", document_root)
    for attribute, value in {"UPLOAD_DIR": tmp_path / "uploads", "DATA_DIR": tmp_path / "data",
                             "pages_dir": lambda mid: tmp_path / "renders" / mid / "pages",
                             "render_dir": lambda mid: tmp_path / "renders" / mid,
                             "read_document": store.read_document, "write_document": store.write_document,
                             "load_values": lambda _: {}}.items():
        monkeypatch.setattr(package, attribute, value)
    material_id = "mat_applied"
    pages = package.pages_dir(material_id)
    pages.mkdir(parents=True)
    monkeypatch.setattr(figure_service, "pages_dir", package.pages_dir)
    source = pages / ("s01_v100.png" if rendered_only else "s01.png")
    Image.new("RGBA", (20, 20), "red").save(source)
    raw = source.read_bytes()
    identifier = "a" * 64
    cleaned = document_root(material_id) / "figures/p01/previews" / identifier / "cleaned.png"
    cleaned.parent.mkdir(parents=True)
    Image.new("RGBA", (20, 20), "white").save(cleaned)
    node = {"id": "figure", "type": "image", "cleaned_asset_id": identifier,
            "image_data": "data:image/png;base64," + base64.b64encode(raw).decode()}
    if rendered_only:
        node.pop("image_data")
        node["render_file"] = source.name
        Image.new("RGBA", (20, 20), "blue").save(pages / "s01_v99.png")
    doc = {"source_key": "drawings", "revision": 1,
           "pages": [{"page_no": 1, "nodes": [node], "rendered_only": rendered_only}]}
    store.write_document(material_id, doc)
    (cleaned.parent / "pixel.json").write_text(json.dumps({
        "fingerprint": figure_service.node_fingerprint(doc["source_key"], node),
        "source_digest": sha256(raw).hexdigest(), "diagnostics": "secret vision output"}))
    (cleaned.parent / "source.png").write_bytes(raw)
    material = MaterialRecord(id=material_id, title="Applied figure", page_count=1)

    data = build_project_archive(material, {"page_layouts": [{"page_no": 1}]})
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assets = [name for name in archive.namelist() if name.startswith("figures/")]
        assert assets == [f"figures/p01/previews/{identifier}/cleaned.png"]
        assert b"secret vision output" not in archive.read("manifest.json")
        members = {name: archive.read(name) for name in archive.namelist()}
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, future=True)
    with factory() as db:
        db.add(SessionRecord(id="ses_pkg", csrf_token="x" * 16,
                             created_at="2026-01-01T00:00:00Z", expires_at="2026-01-02T00:00:00Z",
                             retention_hours=24))
        db.commit()
        result = import_project_archive(data, session_id="ses_pkg", db=db)
        imported = result["material_id"]
        assert store.read_document(imported) == doc
        assert figure_service.asset_path(imported, 1, identifier).read_bytes() == cleaned.read_bytes()
        figure_service.validate_asset_binding(imported, 1, doc["source_key"], node, identifier)

        tampered = io.BytesIO()
        with zipfile.ZipFile(tampered, "w") as archive:
            for name, content in members.items():
                archive.writestr(name, raw if name in assets else content)
        with pytest.raises(ProjectPackageError):
            import_project_archive(tampered.getvalue(), session_id="ses_pkg", db=db)


def test_project_package_roundtrip_preserves_node_ids_and_hashes(tmp_path, monkeypatch) -> None:
    import app.project_package as package

    package.UPLOAD_DIR = tmp_path / "uploads"
    package.DATA_DIR = tmp_path / "data"
    package.pages_dir = lambda material_id: tmp_path / "pages"
    package.render_dir = lambda material_id: tmp_path / "render"
    (tmp_path / "pages").mkdir()
    (tmp_path / "pages" / "s01.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
    package.load_values = lambda material_id: {"obj_matrix": {"values": {"a": 2}, "updated_at": "x"}}
    written = {}

    def write_document(material_id, document):
        written["document"] = (material_id, document)

    def save_values(material_id, object_id, values):
        written.setdefault("values", []).append((material_id, object_id, values))

    package.write_document = write_document
    package.save_values = save_values
    material = MaterialRecord(
        id="mat_pkg_source",
        session_id="ses_pkg",
        title="工程包源材料",
        status="ready",
        page_count=1,
        candidates=[],
        created_at="2026-01-01T00:00:00Z",
        expires_at="2026-01-02T00:00:00Z",
    )
    payload = {
        "schema_version": "1.0",
        "material_id": "mat_pkg_source",
        "ispecs": [{"object_id": "obj_matrix", "spec_version": "1.0", "kind": "geometric",
                    "parameters": [], "views": []}],
        "page_layouts": [{"page_no": 1, "width": 12192000, "height": 6858000, "title": "页 1", "elements": []}],
    }
    archive = build_project_archive(material, payload)
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        names = set(zipped.namelist())
        assert {"manifest.json", "scene_document.json", "ispecs.json", "values.json", "pages/s01.png"} <= names
        manifest = json.loads(zipped.read("manifest.json"))
        assert manifest["schema_version"] == "xsproj.1"
        assert manifest["hashes"]["scene_document"]
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    with factory() as db:
        db.add(SessionRecord(id="ses_pkg", csrf_token="x" * 16,
                             created_at="2026-01-01T00:00:00Z", expires_at="2026-01-02T00:00:00Z",
                             retention_hours=24))
        db.commit()
        result = import_project_archive(archive, session_id="ses_pkg", db=db)
        assert result["material_id"].startswith("mat_")
        assert result["page_count"] == 1
        assert db.get(MaterialRecord, result["material_id"]) is not None
        pages = db.scalars(select(PageRecord)).all()
        assert [page.page_no for page in pages] == [1]
        assert written["document"][1]["schema_version"] == "1.0"
        assert written["values"][0][1] == "obj_matrix"
        assert (tmp_path / "pages" / "s01.png").is_file()
        assert (tmp_path / "render" / "render.json").is_file()


def test_project_package_hash_mismatch_is_rejected(tmp_path, monkeypatch) -> None:
    import app.project_package as package

    package.UPLOAD_DIR = tmp_path / "uploads"
    package.DATA_DIR = tmp_path / "data"
    package.pages_dir = lambda material_id: tmp_path / "pages"
    package.render_dir = lambda material_id: tmp_path / "render"
    (tmp_path / "pages").mkdir()
    (tmp_path / "pages" / "s01.png").write_bytes(b"png")
    package.load_values = lambda material_id: {}
    package.write_document = lambda material_id, document: None
    package.save_values = lambda material_id, object_id, values: None
    material = MaterialRecord(
        id="mat_hash", session_id="ses_pkg", title="t", status="ready", page_count=1,
        candidates=[], created_at="2026-01-01T00:00:00Z", expires_at="2026-01-02T00:00:00Z",
    )
    payload = {"ispecs": [], "page_layouts": [{"page_no": 1, "width": 1, "height": 1, "elements": []}]}
    archive = build_project_archive(material, payload)
    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        members = {name: source.read(name) for name in source.namelist()}
    members["scene_document.json"] = b'{"tampered":true}'
    tampered = io.BytesIO()
    with zipfile.ZipFile(tampered, "w") as target:
        for name, content in members.items():
            target.writestr(name, content)
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    with factory() as db:
        db.add(SessionRecord(id="ses_pkg", csrf_token="x" * 16,
                             created_at="2026-01-01T00:00:00Z", expires_at="2026-01-02T00:00:00Z",
                             retention_hours=24))
        db.commit()
        with pytest.raises(ProjectPackageError):
            import_project_archive(tampered.getvalue(), session_id="ses_pkg", db=db)


def test_project_package_rejects_member_count_and_unzipped_size(monkeypatch) -> None:
    import app.project_package as package

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for index in range(3):
            archive.writestr(f"pages/p{index}.png", b"x")
    data = buffer.getvalue()

    monkeypatch.setattr(package, "MAX_PACKAGE_MEMBERS", 2)
    with pytest.raises(ProjectPackageError, match="条目数"):
        package.import_project_archive(data, session_id="ses_pkg", db=None)

    monkeypatch.setattr(package, "MAX_PACKAGE_MEMBERS", 10)
    monkeypatch.setattr(package, "MAX_PACKAGE_UNZIPPED_BYTES", 2)
    with pytest.raises(ProjectPackageError, match="解压后体积"):
        package.import_project_archive(data, session_id="ses_pkg", db=None)


def test_project_package_rejects_unsafe_source_key() -> None:
    import app.project_package as package

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("manifest.json", json.dumps({"schema_version": "xsproj.1"}))
        archive.writestr("scene_document.json", json.dumps({"source_key": "../escape"}))
        archive.writestr("ispecs.json", "{}")
        archive.writestr("values.json", "{}")
    with pytest.raises(ProjectPackageError, match="source_key"):
        package.import_project_archive(buffer.getvalue(), session_id="ses_pkg", db=None)


def test_offline_html_export_and_reimport_roundtrip(tmp_path, monkeypatch) -> None:
    import base64
    from app.documents.layers import hydrate_document
    from app.documents.presentation import public_document
    import app.documents.store as doc_store
    import app.project_package as package

    monkeypatch.setattr(package, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(package, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(doc_store, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(package, "write_document", doc_store.write_document)
    monkeypatch.setattr(package, "pages_dir", lambda material_id: tmp_path / "renders" / material_id / "pages")
    monkeypatch.setattr(package, "render_dir", lambda material_id: tmp_path / "renders" / material_id)
    saved_values = []
    monkeypatch.setattr(package, "save_values", lambda material_id, object_id, values: saved_values.append((material_id, object_id, dict(values))))

    # 造两张合法 PNG（1x1 像素）
    from PIL import Image
    png_buf = io.BytesIO()
    Image.new("RGB", (8, 8), (240, 244, 255)).save(png_buf, format="PNG")
    valid_png = png_buf.getvalue()
    valid_data_uri = "data:image/png;base64," + base64.b64encode(valid_png).decode("ascii")

    src_pages_dir = tmp_path / "src_pages"
    src_pages_dir.mkdir()
    (src_pages_dir / "s02.png").write_bytes(valid_png)

    source_document = {
        "schema_version": "1.0",
        "revision": 4,
        "title": "矩阵空间视角",
        "source_key": "rendered_only",
        "pages": [{
            "page_no": 1,
            "width": 960,
            "height": 540,
            "modified": True,
            "background_url": valid_data_uri,
            "preparation": {"status": "ready", "frozen_ids": []},
            "nodes": [
                {
                    "id": "mat_1", "type": "image", "x": 40, "y": 80, "width": 200, "height": 120,
                    "rotation": 0, "z": 1, "opacity": 1, "text": "", "style": {},
                    "image_url": valid_data_uri,
                    "viewer_editable": True,
                    "matrix_ocr": {
                        "matrices": [{"values": [[1, 2], [0, 1]], "cells": [
                            {"row": 0, "col": 0, "bbox": [0.1, 0.1, 0.3, 0.3]},
                            {"row": 0, "col": 1, "bbox": [0.5, 0.1, 0.3, 0.3]},
                            {"row": 1, "col": 0, "bbox": [0.1, 0.5, 0.3, 0.3]},
                            {"row": 1, "col": 1, "bbox": [0.5, 0.5, 0.3, 0.3]},
                        ]}],
                    },
                },
                {
                    "id": "math_1", "type": "math_scene", "x": 300, "y": 80, "width": 480, "height": 360,
                    "rotation": 0, "z": 2, "opacity": 1, "text": "", "style": {"stroke": "#008844", "line_style": "dashed"},
                    "flow": {"enabled": True, "speed": 2},
                    "viewer_editable": True,
                    "math_scene": {
                        "template": "circle_ellipse",
                        "view_box": {"x": [-4, 4], "y": [-3, 3]},
                        "matrix": [[2, 0], [0, 1]],
                        "vector": [1, 0],
                        "show_grid": True,
                        "show_circle": True,
                        "radius": 1,
                        "progress": 1,
                        "animation_step": 0.02,
                        "viewer_parameters": ["vector", "progress"],
                    },
                },
            ],
        }],
    }
    plugin = {
        "template_kind": "biz-breakeven",
        "title": "经营盈亏平衡与定价沙盘",
        "category": "办公决策",
        "work_id": "work_original",
        "display_mode": "stage_only",
        "transparent_bg": True,
        "hide_border": False,
        "theme": "dark",
        "visible_params": ["price"],
        "presets": [{"id": "season_offer", "label": "促销情景", "params": {"price": 99, "growthRate": .1}, "cursor": .5}],
        "preview_data": valid_data_uri,
    }
    plugin_doc = {
        "version": 1,
        "title": plugin["title"],
        "zoom": 0.69,
        "nodes": [
            {"id": "source", "type": "businessStage", "x": 0, "y": 0,
             "payload": "biz-breakeven/source", "params": {"price": 139, "growthRate": -0.04},
             "text": "调整后的经营假设"},
            {"id": "main", "type": "businessStage", "x": 400, "y": 0,
             "payload": "biz-breakeven/main", "params": {}},
        ],
        "wires": [{"id": "w1", "from": "source", "fromPort": "out", "to": "main", "toPort": "in"}],
        "strokes": [],
        "panel": {
            "title": plugin["title"],
            "view_node_ids": ["main"],
            "exposed_params": [{"node_id": "source", "param_key": "price", "label": "客单价",
                                "min": 20, "max": 500, "step": 1}],
        },
    }
    plugin_id = "u_business_plugin"
    doc_store.write_document("mat_src", source_document)
    doc_store.patch_document("mat_src", 4, "insert_business_plugin", [{
        "page_no": 1, "id": plugin_id, "create": {
            "type": "workshop_plugin", "workshop_plugin": plugin, "viewer_editable": True,
            "x": 80, "y": 80, "width": 700, "height": 400,
        },
    }])
    saved_plugin = {**plugin, "doc": plugin_doc}
    document = doc_store.patch_document("mat_src", 5, "adjust_business_model", [{
        "page_no": 1, "id": plugin_id, "patch": {"workshop_plugin": saved_plugin},
    }])
    scene_doc = public_document(document)
    spec = {
        "spec_version": "1.0",
        "object_id": "obj_scale",
        "kind": "parametric",
        "parameters": [{"id": "k", "label": "倍率", "default": 2}],
        "views": [],
    }
    snapshot = {
        "title": "矩阵空间视角",
        "published_at": "2026-11-21T00:00:00Z",
        "page_count": 2,
        "pages": [
            {"page_no": 1, "title": "第 1 页", "width": 12192000, "height": 6858000, "image": None},
            {"page_no": 2, "title": "第 2 页", "width": 12192000, "height": 6858000, "image": "s02.png"},
        ],
        "ispecs": [spec],
        "scene_document": scene_doc,
    }
    from app.offline import render_offline_deck
    exported_html = render_offline_deck(snapshot, "mat_src", lambda _mid, name: src_pages_dir / name if (src_pages_dir / name).is_file() else None)
    exported_data = json.loads(re.search(
        r'<script id="export-data" type="application/json">(.*?)</script>', exported_html, re.S,
    )[1])
    exported_plugin = next(n for n in exported_data["document"]["pages"][0]["nodes"] if n["id"] == plugin_id)
    assert exported_plugin["workshop_plugin"] == saved_plugin
    assert exported_plugin["viewer_editable"] is True

    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    with factory() as db:
        db.add(SessionRecord(
            id="ses_html", csrf_token="x" * 16,
            created_at="2026-01-01T00:00:00Z", expires_at="2026-01-02T00:00:00Z",
            retention_hours=24,
        ))
        db.commit()
        result = package.import_project_file(
            exported_html.encode("utf-8"),
            session_id="ses_html",
            db=db,
            filename="矩阵空间视角-交互网页.html",
        )
        new_id = result["material_id"]
        assert new_id.startswith("mat_")
        assert result["page_count"] == 2
        assert result["title"] == "矩阵空间视角"
        assert db.get(MaterialRecord, new_id) is not None
        assert [p.page_no for p in db.scalars(select(PageRecord).order_by(PageRecord.page_no)).all()] == [1, 2]
        assert (tmp_path / "renders" / new_id / "pages" / "s01.png").is_file()
        assert (tmp_path / "renders" / new_id / "pages" / "s02.png").is_file()
        assert (tmp_path / "renders" / new_id / "render.json").is_file()

        reloaded = doc_store.read_document(new_id)
        assert reloaded is not None
        hydrated = hydrate_document(new_id, reloaded)
        assert len(hydrated["pages"]) == 2
        assert hydrated["pages"][0]["preparation"]["status"] == "ready"
        assert hydrated["pages"][1]["preparation"]["status"] == "ready"
        nodes_by_id = {n["id"]: n for n in hydrated["pages"][0]["nodes"]}
        assert nodes_by_id["math_1"]["math_scene"]["matrix"] == [[2, 0], [0, 1]]
        assert nodes_by_id["math_1"]["flow"] == {"enabled": True, "speed": 2.0}
        assert nodes_by_id["mat_1"]["matrix_ocr"]["matrices"][0]["values"] == [[1, 2], [0, 1]]
        assert nodes_by_id["mat_1"]["image_url"].endswith("/n_1.png")
        assert nodes_by_id[plugin_id]["type"] == "workshop_plugin"
        assert nodes_by_id[plugin_id]["workshop_plugin"] == saved_plugin
        assert nodes_by_id[plugin_id]["viewer_editable"] is True
        assert saved_values == [(new_id, "obj_scale", {"k": 2})]


@pytest.mark.parametrize("invalid", [
    {"display_mode": "overlay"},
    {"transparent_bg": 1},
    {"hide_border": "true"},
    {"theme": "night"},
    {"work_id": "../original"},
    {"visible_params": ["price"] * 25},
    {"visible_params": ["x" * 65]},
    {"presets": [{"id": "scenario", "label": "x" * 25, "params": {}}]},
    {"presets": [{"id": "scenario", "label": "有效名称", "params": {"price": float("inf")}}]},
    {"presets": [{"id": "scenario", "label": "有效名称", "params": {"price": True}}]},
    {"presets": [{"id": "scenario", "label": "有效名称", "params": {}, "cursor": 1.1}]},
    {"doc": {"nodes": [{"type": "slider", "id": "node", "x": 10 ** 400, "y": 0}], "wires": []}},
    {"preview_data": "data:image/svg+xml;base64,AAAA"},
    {"preview_data": "data:image/png;base64,invalid###"},
    {"preview_data": "data:image/png;base64," + "A" * 350_000},
])
def test_workshop_plugin_rejects_invalid_settings(invalid):
    from app.documents.store import validate_patch

    with pytest.raises(ValueError, match="工坊插件"):
        validate_patch({"workshop_plugin": {"template_kind": "biz-breakeven", "title": "经营沙盘", **invalid}})


def test_offline_html_import_rejects_invalid_or_legacy_html() -> None:
    import app.project_package as package

    with pytest.raises(ProjectPackageError, match="为空"):
        package.import_project_file(b"", session_id="ses", db=None, filename="empty.html")

    with pytest.raises(ProjectPackageError, match="export-data"):
        package.import_project_file(b"<!doctype html><html><body>hello</body></html>", session_id="ses", db=None, filename="plain.html")

    legacy_living = '<!doctype html><html><body><script id="export-data" type="application/json">{"living":{"title":"old","blocks":[]}}</script></body></html>'
    with pytest.raises(ProjectPackageError, match="纵向活页"):
        package.import_project_file(legacy_living.encode("utf-8"), session_id="ses", db=None, filename="old.html")

    with pytest.raises(ProjectPackageError, match="仅支持导入"):
        package.import_project_file(b"not a zip or html", session_id="ses", db=None, filename="notes.txt")

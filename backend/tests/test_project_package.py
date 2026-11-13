"""工程包导出/导入：哈希、节点 id、页面图与参数值。"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.models import MaterialRecord, PageRecord, SessionRecord
from app.project_package import ProjectPackageError, build_project_archive, import_project_archive


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

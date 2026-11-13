"""``.xsproj`` 离线工程包：可分享，也可再次导入编辑。

包内包含 SceneDocument（稳定节点 id + 修订号）、iSpecs、当前参数值、页面图片和
可选原 PPTX。导入时校验 schema 与哈希，创建新材料，节点 id 保持不变。
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from pathlib import Path
from typing import Any, Mapping
from uuid import uuid4

from sqlalchemy.orm import Session

from .db.models import MaterialRecord, PageRecord
from .documents.store import read_document, write_document
from .ispec.persistence import load_values, save_values
from .render import pages_dir, render_dir
from .settings import DATA_DIR, UPLOAD_DIR, get_settings
from .schemas.common import iso_after, to_iso, utc_now

PACKAGE_SCHEMA = "xsproj.1"
MAX_PACKAGE_BYTES = 64 * 1024 * 1024
# 上传体积不是解压后体积：压缩率极高的 zip 可以很小却解压出数十 GB，
# 因此另有解压总量与条目数上限（与 upload_material 的 max_unzipped_bytes 一致）。
MAX_PACKAGE_UNZIPPED_BYTES = 200 * 1024 * 1024
MAX_PACKAGE_MEMBERS = 256
ORIGINAL_FILE_NAME = "original.pptx"
_KEY_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,96}")
_ALLOWED_MEMBERS = ("manifest.json", "scene_document.json", "ispecs.json", "values.json")
_ALLOWED_PREFIXES = ("pages/", "source/")


def _hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _json(data: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


def _safe_member(name: str) -> bool:
    if name.startswith("/") or ".." in Path(name).parts or "\\" in name:
        return False
    return name in _ALLOWED_MEMBERS or name.startswith(_ALLOWED_PREFIXES)


def _pages_for_material(material_id: str, payload: Mapping[str, Any]) -> list[dict[str, Any]]:
    layouts = {
        int(page["page_no"]): page
        for page in payload.get("page_layouts", [])
        if isinstance(page, Mapping) and isinstance(page.get("page_no"), int)
    }
    directory = pages_dir(material_id)
    files: dict[int, Path] = {}
    if directory.is_dir():
        for path in sorted(directory.glob("s*.png")):
            import re

            match = re.fullmatch(r"s(\d{1,3})(?:_v\d+)?\.png", path.name)
            if match and not path.name.endswith("_erased.png"):
                files[int(match.group(1))] = path
    result = []
    for page_no, layout in sorted(layouts.items()):
        path = files.get(page_no)
        if path is None or not path.is_file():
            continue
        result.append(
            {
                "page_no": page_no,
                "width": int(layout.get("width") or 12192000),
                "height": int(layout.get("height") or 6858000),
                "file": f"pages/s{page_no:02d}.png",
                "bytes": path.read_bytes(),
            }
        )
    return result


def build_project_archive(material: MaterialRecord, payload: Mapping[str, Any] | None = None) -> bytes:
    """生成 ``.xsproj`` zip；不把页面图片二次 base64 进 JSON。"""

    material_id = material.id
    payload = payload or {}
    document = read_document(material_id) or {
        "schema_version": "1.0",
        "revision": 0,
        "title": material.title,
        "pages": [],
    }
    ispecs_payload = {
        key: payload.get(key)
        for key in ("schema_version", "conversion_version", "material_id", "ispecs", "edit_revision",
                    "page_layouts", "image_recognition", "figure_scenes", "recognition", "errors", "generated_at")
        if key in payload
    }
    if "material_id" in ispecs_payload:
        ispecs_payload["material_id"] = material_id
    values = load_values(material_id)
    pages = _pages_for_material(material_id, payload)
    source_path = UPLOAD_DIR / material_id / ORIGINAL_FILE_NAME
    source_bytes = source_path.read_bytes() if source_path.is_file() else None
    source_hash = _hash_bytes(source_bytes) if source_bytes else ""
    document_bytes = _json(document)
    ispecs_bytes = _json(ispecs_payload)
    values_bytes = _json(values)
    manifest = {
        "schema_version": PACKAGE_SCHEMA,
        "created_at": to_iso(utc_now()),
        "app_version": get_settings().app_version,
        "material": {
            "title": material.title,
            "page_count": material.page_count,
            "source_filename": material.source_filename,
        },
        "source_pptx": {
            "included": source_bytes is not None,
            "sha256": source_hash,
            "filename": material.source_filename or "",
        },
        "hashes": {
            "scene_document": _hash_bytes(document_bytes),
            "ispecs": _hash_bytes(ispecs_bytes),
            "values": _hash_bytes(values_bytes),
        },
        "pages": [
            {"page_no": page["page_no"], "width": page["width"], "height": page["height"], "file": page["file"], "bytes": len(page["bytes"])}
            for page in pages
        ],
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr("manifest.json", _json(manifest))
        archive.writestr("scene_document.json", document_bytes)
        archive.writestr("ispecs.json", ispecs_bytes)
        archive.writestr("values.json", values_bytes)
        for page in pages:
            archive.writestr(page["file"], page["bytes"])
        if source_bytes is not None:
            archive.writestr("source/original.pptx", source_bytes)
    return buffer.getvalue()


def import_project_archive(
    data: bytes,
    *,
    session_id: str,
    db: Session,
) -> dict[str, Any]:
    """校验 zip、创建新材料，保留 SceneDocument 节点 id 与 iSpec object_id。"""

    if not data:
        raise ProjectPackageError("工程包为空")
    if len(data) > MAX_PACKAGE_BYTES:
        raise ProjectPackageError("工程包超过 64MB")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ProjectPackageError("不是有效的 .xsproj zip") from exc
    names = [name for name in archive.namelist() if not name.endswith("/")]
    if any(not _safe_member(name) for name in names):
        raise ProjectPackageError("工程包包含不允许的路径")
    infos = [info for info in archive.infolist() if not info.filename.endswith("/")]
    if len(infos) > MAX_PACKAGE_MEMBERS:
        raise ProjectPackageError("工程包条目数超过上限")
    if sum(info.file_size for info in infos) > MAX_PACKAGE_UNZIPPED_BYTES:
        raise ProjectPackageError("工程包解压后体积超过上限")
    # file_size 来自 zip 元数据，可被伪造；实际读取时再按累计解压体积封顶。
    budget = MAX_PACKAGE_UNZIPPED_BYTES

    def _read(name: str) -> bytes:
        nonlocal budget
        with archive.open(name) as handle:
            data = handle.read(budget + 1)
        if len(data) > budget:
            raise ProjectPackageError("工程包解压后体积超过上限")
        budget -= len(data)
        return data

    try:
        manifest = json.loads(_read("manifest.json").decode("utf-8"))
    except (KeyError, ValueError, UnicodeDecodeError) as exc:
        raise ProjectPackageError("缺少或无法读取 manifest.json") from exc
    if not isinstance(manifest, Mapping) or manifest.get("schema_version") != PACKAGE_SCHEMA:
        raise ProjectPackageError("工程包 schema_version 不受支持")
    hashes = manifest.get("hashes") if isinstance(manifest.get("hashes"), Mapping) else {}
    document_bytes = _read("scene_document.json")
    ispecs_bytes = _read("ispecs.json")
    values_bytes = _read("values.json")
    for key, content in (("scene_document", document_bytes), ("ispecs", ispecs_bytes), ("values", values_bytes)):
        expected = hashes.get(key)
        if isinstance(expected, str) and expected and expected != _hash_bytes(content):
            raise ProjectPackageError(f"{key} 哈希不一致，拒绝导入")
    try:
        document = json.loads(document_bytes.decode("utf-8"))
        ispecs_payload = json.loads(ispecs_bytes.decode("utf-8"))
        values = json.loads(values_bytes.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise ProjectPackageError("工程包 JSON 无法解析") from exc
    if not isinstance(document, dict) or not isinstance(ispecs_payload, dict) or not isinstance(values, dict):
        raise ProjectPackageError("工程包结构不合法")
    # source_key 参与图层缓存目录拼接，必须是无路径语义的标识符。
    source_key = document.get("source_key")
    if source_key is not None and not (
        isinstance(source_key, str) and _KEY_PATTERN.fullmatch(source_key)
    ):
        raise ProjectPackageError("工程包 source_key 不合法")
    pages = manifest.get("pages") if isinstance(manifest.get("pages"), list) else []
    page_bytes = {}
    for page in pages:
        if not isinstance(page, Mapping):
            continue
        file_name = str(page.get("file") or "")
        if not file_name.startswith("pages/") or file_name not in names:
            raise ProjectPackageError(f"页面图缺失：{file_name}")
        page_bytes[str(page.get("page_no"))] = _read(file_name)
    if not page_bytes:
        raise ProjectPackageError("工程包没有页面图片")
    source = manifest.get("source_pptx") if isinstance(manifest.get("source_pptx"), Mapping) else {}
    source_content = _read("source/original.pptx") if "source/original.pptx" in names else None
    if source_content is not None:
        expected = source.get("sha256")
        if isinstance(expected, str) and expected and expected != _hash_bytes(source_content):
            raise ProjectPackageError("原 PPTX 哈希不一致")

    now = utc_now()
    now_iso = to_iso(now)
    material_id = f"mat_{uuid4().hex}"
    material_info = manifest.get("material") if isinstance(manifest.get("material"), Mapping) else {}
    material = MaterialRecord(
        id=material_id,
        session_id=session_id,
        title=str(material_info.get("title") or "导入的工程"),
        status="ready",
        page_count=len(page_bytes),
        source_filename=str(material_info.get("source_filename") or ""),
        clone_of_example_id=None,
        candidates=[],
        created_at=now_iso,
        expires_at=iso_after(get_settings().material_retention_hours, base=now),
    )
    db.add(material)
    for index, page in enumerate(pages):
        if not isinstance(page, Mapping):
            continue
        page_no = int(page.get("page_no") or index + 1)
        if str(page_no) not in page_bytes:
            continue
        db.add(
            PageRecord(
                id=f"page_{uuid4().hex}",
                material_id=material_id,
                page_no=page_no,
                title="",
                paragraphs=[],
                excerpt="",
                image_asset_id=None,
            )
        )
    db.commit()

    write_document(material_id, document)
    target_payload = dict(ispecs_payload)
    target_payload["material_id"] = material_id
    (DATA_DIR / "ispecs").mkdir(parents=True, exist_ok=True)
    temp = DATA_DIR / "ispecs" / f"{material_id}.{uuid4().hex}.tmp"
    temp.write_text(json.dumps(target_payload, ensure_ascii=False), encoding="utf-8")
    temp.replace(DATA_DIR / "ispecs" / f"{material_id}.json")

    target_pages = pages_dir(material_id)
    target_pages.mkdir(parents=True, exist_ok=True)
    page_entries = []
    for page in pages:
        if not isinstance(page, Mapping):
            continue
        page_no = int(page.get("page_no") or 0)
        content = page_bytes.get(str(page_no))
        if content is None:
            continue
        name = f"s{page_no:02d}.png"
        (target_pages / name).write_bytes(content)
        page_entries.append(
            {
                "page_no": page_no,
                "file": name,
                "bytes": len(content),
                "width": page.get("width"),
                "height": page.get("height"),
            }
        )
    render_dir(material_id).mkdir(parents=True, exist_ok=True)
    (render_dir(material_id) / "render.json").write_text(
        json.dumps(
            {
                "render_engine": "project_package",
                "fidelity": "exact",
                "render_status": "ready",
                "page_count": len(page_entries),
                "pages": page_entries,
                "rendered_at": now_iso,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    for object_id, entry in values.items():
        if isinstance(object_id, str) and isinstance(entry, Mapping) and isinstance(entry.get("values"), Mapping):
            save_values(material_id, object_id, entry["values"])
    if source_content is not None:
        target_source = UPLOAD_DIR / material_id
        target_source.mkdir(parents=True, exist_ok=True)
        (target_source / ORIGINAL_FILE_NAME).write_bytes(source_content)
    return {"material_id": material_id, "page_count": len(page_entries), "title": material.title}


class ProjectPackageError(ValueError):
    pass


__all__ = [
    "MAX_PACKAGE_BYTES",
    "MAX_PACKAGE_MEMBERS",
    "MAX_PACKAGE_UNZIPPED_BYTES",
    "PACKAGE_SCHEMA",
    "ProjectPackageError",
    "build_project_archive",
    "import_project_archive",
]

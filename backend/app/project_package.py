"""``.xsproj`` 离线工程包与单文件交互 HTML 的导出/导入：可分享，也可再次导入编辑。

包内包含 SceneDocument（稳定节点 id + 修订号）、iSpecs、当前参数值、页面图片和
可选原 PPTX / 图层缓存。导入时校验 schema、哈希与资源安全边界，创建新材料并保留节点 id。
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import zipfile
from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping
from uuid import uuid4

from PIL import Image
from sqlalchemy.orm import Session

from .db.models import MaterialRecord, PageRecord
from .documents.layer_export import EXPORTER_VERSION
from .documents.layers import layer_dir
from .documents.presentation import public_document
from .documents.store import document_root, read_document, write_document
from .ispec.persistence import load_values, save_values
from .render import PAGE_IMAGE_PATTERN, pages_dir, render_dir
from .settings import DATA_DIR, UPLOAD_DIR, get_settings
from .schemas.common import iso_after, to_iso, utc_now

PACKAGE_SCHEMA = "xsproj.1"
MAX_PACKAGE_BYTES = 64 * 1024 * 1024
# 上传体积不是解压后体积：压缩率极高的 zip 可以很小却解压出数十 GB，
# 因此另有解压总量与条目数上限（与 upload_material 的 max_unzipped_bytes 一致）。
MAX_PACKAGE_UNZIPPED_BYTES = 200 * 1024 * 1024
MAX_PACKAGE_MEMBERS = 1024
ORIGINAL_FILE_NAME = "original.pptx"
_KEY_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,96}")
_LAYER_MEMBER_PATTERN = re.compile(r"layers/[A-Za-z0-9_-]{1,96}/p\d{2,3}/(manifest\.json|background\.png|n_\d+(_empty)?\.png)")
_FIGURE_MEMBER_PATTERN = re.compile(r"figures/p\d{2,5}/previews/[a-f0-9]{64}/cleaned\.png")
_DIGEST_PATTERN = re.compile(r"[a-f0-9]{64}")
_FIGURE_BINDING_FIELDS = ("fingerprint", "source_digest")
_DATA_IMAGE_PATTERN = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$")
_EXPORT_DATA_SCRIPT = re.compile(
    r'<script\b[^>]*\bid=["\']export-data["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)
_BACKUP_DATA_SCRIPT = re.compile(
    r'<script\b[^>]*\bid=["\']project-backup["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)
_ALLOWED_MEMBERS = ("manifest.json", "scene_document.json", "ispecs.json", "values.json")
_ALLOWED_PREFIXES = ("pages/", "source/", "layers/")


def _hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _json(data: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


def _safe_member(name: str) -> bool:
    if name.startswith("/") or ".." in Path(name).parts or "\\" in name:
        return False
    if name in _ALLOWED_MEMBERS:
        return True
    if name.startswith("layers/"):
        return _LAYER_MEMBER_PATTERN.fullmatch(name) is not None
    if name.startswith("figures/"):
        return _FIGURE_MEMBER_PATTERN.fullmatch(name) is not None
    return name.startswith(("pages/", "source/"))


def _document_resources(document):
    figures, rendered = {}, {}
    pages = document.get("pages", [])
    if not isinstance(pages, list):
        raise ProjectPackageError("工程包页面结构不合法")
    for page in pages:
        if not isinstance(page, dict) or not isinstance(page.get("nodes", []), list):
            raise ProjectPackageError("工程包页面结构不合法")
        page_no = page.get("page_no")
        for node in page.get("nodes", []):
            if not isinstance(node, dict):
                raise ProjectPackageError("工程包页面节点结构不合法")
            if page.get("rendered_only") and node.get("render_file"):
                filename = node["render_file"]
                match = PAGE_IMAGE_PATTERN.fullmatch(filename) if isinstance(filename, str) else None
                if (not match or match.group("erased") or type(page_no) is not int
                    or int(match.group("page_no")) != page_no
                    or page_no in rendered and rendered[page_no] != filename):
                    raise ProjectPackageError("工程包页面原图标识不合法")
                rendered[page_no] = filename
            asset_id = node.get("cleaned_asset_id")
            if asset_id is None:
                continue
            if (node.get("type") != "image" or not isinstance(asset_id, str)
                or not _DIGEST_PATTERN.fullmatch(asset_id) or type(page_no) is not int
                or not 1 <= page_no <= 10000 or not document.get("source_key")):
                raise ProjectPackageError("工程包包含无效的图示清底资产引用")
            figures[f"figures/p{page_no:02d}/previews/{asset_id}/cleaned.png"] = page_no
    return figures, rendered


def _figure_metadata(data, keys):
    if not isinstance(data, dict) or any(
        not isinstance(data.get(key), str) or not _DIGEST_PATTERN.fullmatch(data[key]) for key in keys
    ):
        raise ProjectPackageError("工程包图示清底资产校验信息不合法")
    return {key: data[key] for key in keys}


def _validate_figure_png(blob):
    if not 0 < len(blob) <= MAX_PACKAGE_BYTES:
        raise ProjectPackageError("工程包图示清底资产体积超出上限")
    try:
        with Image.open(io.BytesIO(blob), formats=["PNG"]) as image:
            if not 0 < image.width * image.height <= 30_000_000 or getattr(image, "is_animated", False):
                raise ProjectPackageError("工程包图示清底资产尺寸不合法")
            image.verify()
    except (OSError, SyntaxError, ValueError, Image.DecompressionBombError) as exc:
        raise ProjectPackageError("工程包图示清底资产不是有效的 PNG") from exc


def _layers_for_material(material_id: str, document: Mapping[str, Any]) -> list[tuple[str, bytes]]:
    source_key = document.get("source_key")
    if not isinstance(source_key, str) or not _KEY_PATTERN.fullmatch(source_key):
        return []
    base = document_root(material_id) / "layers" / source_key
    if not base.is_dir():
        return []
    entries: list[tuple[str, bytes]] = []
    for path in sorted(base.rglob("*")):
        if not path.is_file():
            continue
        rel = f"layers/{source_key}/{path.relative_to(base).as_posix()}"
        if _LAYER_MEMBER_PATTERN.fullmatch(rel):
            entries.append((rel, path.read_bytes()))
    return entries


def _pages_for_material(material_id: str, payload: Mapping[str, Any], rendered: Mapping[int, str]) -> list[dict[str, Any]]:
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
        path = directory / rendered[page_no] if page_no in rendered else files.get(page_no)
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
    figures, rendered = _document_resources(document)
    pages = _pages_for_material(material_id, payload, rendered)
    if (set(figures.values()) | rendered.keys()) - {page["page_no"] for page in pages}:
        raise ProjectPackageError("工程包图示所在的页面原图缺失")
    figure_assets, figure_hashes = {}, {}
    for member in sorted(figures):
        target = document_root(material_id) / member
        if target.is_file() and target.stat().st_size > MAX_PACKAGE_BYTES:
            raise ProjectPackageError("工程包图示清底资产体积超出上限")
        try:
            blob = target.read_bytes()
            binding = json.loads(target.with_name("pixel.json").read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ProjectPackageError("无法读取已应用的图示清底资产") from exc
        _validate_figure_png(blob)
        figure_assets[member] = blob
        figure_hashes[member] = {"sha256": _hash_bytes(blob), **_figure_metadata(binding, _FIGURE_BINDING_FIELDS)}
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
    if figure_hashes:
        manifest["figure_assets"] = figure_hashes
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr("manifest.json", _json(manifest))
        archive.writestr("scene_document.json", document_bytes)
        archive.writestr("ispecs.json", ispecs_bytes)
        archive.writestr("values.json", values_bytes)
        for page in pages:
            archive.writestr(page["file"], page["bytes"])
        for rel, blob in _layers_for_material(material_id, document):
            archive.writestr(rel, blob)
        for member, blob in figure_assets.items():
            archive.writestr(member, blob)
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
    referenced_figures, rendered = _document_resources(document)
    if any(str(page_no) not in page_bytes for page_no in set(referenced_figures.values()) | rendered.keys()):
        raise ProjectPackageError("工程包图示所在的页面原图缺失")
    figure_names = [name for name in names if name.startswith("figures/")]
    figure_hashes = manifest.get("figure_assets", {})
    if (not isinstance(figure_hashes, dict) or figure_hashes.keys() != referenced_figures.keys()
        or set(figure_names) != referenced_figures.keys() or len(figure_names) != len(referenced_figures)):
        raise ProjectPackageError("工程包的图示清底资产不完整或未被页面引用")
    figure_files = []
    for member in figure_names:
        metadata = _figure_metadata(figure_hashes[member], ("sha256", *_FIGURE_BINDING_FIELDS))
        blob = _read(member)
        if metadata.pop("sha256") != _hash_bytes(blob):
            raise ProjectPackageError("工程包图示清底资产哈希不一致")
        _validate_figure_png(blob)
        figure_files.append((member, blob, metadata))
    layer_files: list[tuple[str, bytes]] = []
    for name in names:
        if name.startswith("layers/") and _LAYER_MEMBER_PATTERN.fullmatch(name):
            layer_files.append((name, _read(name)))
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
        name = rendered.get(page_no, f"s{page_no:02d}.png")
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
    for rel, blob in layer_files:
        target_layer = UPLOAD_DIR / material_id / "document" / rel
        target_layer.parent.mkdir(parents=True, exist_ok=True)
        target_layer.write_bytes(blob)
    for member, blob, binding in figure_files:
        target = document_root(material_id) / member
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(blob)
        target.with_name("pixel.json").write_bytes(_json(binding))
    if source_content is not None:
        target_source = UPLOAD_DIR / material_id
        target_source.mkdir(parents=True, exist_ok=True)
        (target_source / ORIGINAL_FILE_NAME).write_bytes(source_content)
    return {"material_id": material_id, "page_count": len(page_entries), "title": material.title}


def _decode_data_image(raw: Any, budget: list[int]) -> bytes | None:
    """安全解码内联 data:image/...;base64,...；遵守累计字节上限。"""

    if not isinstance(raw, str):
        return None
    match = _DATA_IMAGE_PATTERN.fullmatch(raw.strip())
    if match is None:
        return None
    try:
        blob = base64.b64decode(match.group(2), validate=True)
    except (ValueError, TypeError) as exc:
        raise ProjectPackageError("离线 HTML 中的内联图片格式不合法") from exc
    if len(blob) > budget[0]:
        raise ProjectPackageError("离线 HTML 解码后的图片总体积超过上限")
    budget[0] -= len(blob)
    return blob


def _blank_slide_png(width_pt: float, height_pt: float) -> bytes:
    """生成兜底纯白画布 PNG（仅在导出页不含任何底图时使用）。"""

    w = max(160, min(1920, int(round(width_pt))))
    h = max(90, min(1080, int(round(height_pt))))
    buffer = io.BytesIO()
    Image.new("RGB", (w, h), (255, 255, 255)).save(buffer, format="PNG")
    return buffer.getvalue()


def _extract_script_json(html_text: str, pattern: re.Pattern[str], label: str) -> dict[str, Any] | None:
    match = pattern.search(html_text)
    if match is None:
        return None
    raw = match.group(1).strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except ValueError as exc:
        raise ProjectPackageError(f"离线 HTML 中的 {label} 数据无法解析") from exc
    if not isinstance(parsed, dict):
        raise ProjectPackageError(f"离线 HTML 中的 {label} 结构不合法")
    return parsed


def import_offline_html(
    data: bytes,
    *,
    session_id: str,
    db: Session,
) -> dict[str, Any]:
    """从万象导出的单文件交互 HTML 恢复为可继续编辑的动态 PPT 材料。"""

    if not data:
        raise ProjectPackageError("导入文件为空")
    if len(data) > MAX_PACKAGE_BYTES:
        raise ProjectPackageError("离线 HTML 文件超过 64MB")
    try:
        html_text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ProjectPackageError("不是有效的 UTF-8 离线 HTML 文件") from exc

    export_data = _extract_script_json(html_text, _EXPORT_DATA_SCRIPT, "export-data")
    if export_data is None:
        raise ProjectPackageError("未在 HTML 中找到万象导出数据（export-data），请确认是由万象导出的交互网页")
    if "living" in export_data and "pages" not in export_data:
        raise ProjectPackageError("该 HTML 为旧版纵向活页导出，暂不支持导入到横向 PPT 工作台")

    backup_data = _extract_script_json(html_text, _BACKUP_DATA_SCRIPT, "project-backup") or {}
    raw_pages = export_data.get("pages") if isinstance(export_data.get("pages"), list) else []
    raw_document = export_data.get("document")
    if raw_document is None and isinstance(backup_data.get("scene_document"), dict):
        raw_document = backup_data.get("scene_document")

    cleaned_document = public_document(raw_document) if isinstance(raw_document, dict) else None
    scene_pages_by_no: dict[int, dict[str, Any]] = {}
    if cleaned_document is not None:
        for page in cleaned_document.get("pages", []):
            page_no = page.get("page_no")
            if isinstance(page_no, int) and page_no >= 1:
                scene_pages_by_no[page_no] = page

    page_meta_by_no: dict[int, dict[str, Any]] = {}
    for item in raw_pages:
        if not isinstance(item, Mapping):
            continue
        page_no = item.get("page_no")
        if not isinstance(page_no, int) or page_no < 1:
            continue
        page_meta_by_no[page_no] = {
            "page_no": page_no,
            "title": str(item.get("title") or f"第 {page_no} 页"),
            "width": int(item.get("width") or 12192000),
            "height": int(item.get("height") or 6858000),
            "image_url": item.get("image_url"),
            "elements": item.get("elements") if isinstance(item.get("elements"), list) else [],
        }

    page_nos = set(page_meta_by_no) | set(scene_pages_by_no)
    exported_order = (cleaned_document or {}).get("page_order") or [*page_meta_by_no, *scene_pages_by_no]
    all_page_nos = list(dict.fromkeys(number for number in exported_order if number in page_nos))
    all_page_nos.extend(sorted(page_nos - set(all_page_nos)))
    if not all_page_nos:
        raise ProjectPackageError("离线 HTML 中没有可恢复的幻灯片页面")
    if len(all_page_nos) > 200:
        raise ProjectPackageError("离线 HTML 页数超过上限（200 页）")

    decode_budget = [MAX_PACKAGE_UNZIPPED_BYTES]
    source_key = "html_import"
    now = utc_now()
    now_iso = to_iso(now)
    material_id = f"mat_{uuid4().hex}"
    title = str(export_data.get("title") or backup_data.get("title") or "导入的交互网页").strip() or "导入的交互网页"

    page_blobs: dict[int, bytes] = {}
    layer_writes: list[tuple[int, str, bytes]] = []
    rebuilt_scene_pages: list[dict[str, Any]] = []
    page_layouts: list[dict[str, Any]] = []

    for page_no in all_page_nos:
        meta = page_meta_by_no.get(page_no)
        scene_page = scene_pages_by_no.get(page_no)
        width_emu = int(meta["width"]) if meta else int(round(float((scene_page or {}).get("width") or 960) * 12700))
        height_emu = int(meta["height"]) if meta else int(round(float((scene_page or {}).get("height") or 540) * 12700))
        width_pt = float((scene_page or {}).get("width") or round(width_emu / 12700, 2))
        height_pt = float((scene_page or {}).get("height") or round(height_emu / 12700, 2))

        raw_page_blob = _decode_data_image(meta.get("image_url"), decode_budget) if meta else None
        if scene_page is not None:
            bg_blob = _decode_data_image(scene_page.get("background_url"), decode_budget)
            if bg_blob is None:
                bg_blob = raw_page_blob or _blank_slide_png(width_pt, height_pt)
            layer_writes.append((page_no, "background.png", bg_blob))
            manifest_objects: dict[str, dict[str, Any]] = {}
            rebuilt_nodes: list[dict[str, Any]] = []
            for idx, node in enumerate(scene_page.get("nodes", []), start=1):
                rebuilt = dict(node)
                asset_id = f"n_{idx}"
                node_img = _decode_data_image(rebuilt.pop("image_url", None), decode_budget)
                node_bg = _decode_data_image(rebuilt.pop("background_url", None), decode_budget)
                if node_img is not None or node_bg is not None:
                    entry: dict[str, Any] = {}
                    if node_img is not None:
                        asset_name = f"{asset_id}.png"
                        layer_writes.append((page_no, asset_name, node_img))
                        entry["asset"] = asset_name
                        for field in ("frame", "scale", "size"):
                            if f"image_{field}" in rebuilt:
                                entry[f"asset_{field}"] = rebuilt.pop(f"image_{field}")
                    if node_bg is not None:
                        empty_name = f"{asset_id}_empty.png"
                        layer_writes.append((page_no, empty_name, node_bg))
                        entry["empty"] = empty_name
                        for field in ("frame", "scale", "size"):
                            if f"background_{field}" in rebuilt:
                                entry[f"empty_{field}"] = rebuilt.pop(f"background_{field}")
                    if "word_wrap" in rebuilt:
                        entry["word_wrap"] = rebuilt["word_wrap"]
                    manifest_objects[asset_id] = entry
                    rebuilt["asset_id"] = asset_id
                rebuilt_nodes.append(rebuilt)

            manifest_payload = {
                "status": "ready",
                "exporter_version": EXPORTER_VERSION,
                "background": "background.png",
                "objects": manifest_objects,
                "frozen_ids": list(scene_page.get("preparation", {}).get("frozen_ids", [])),
            }
            layer_writes.append((page_no, "manifest.json", _json(manifest_payload)))
            rebuilt_scene_pages.append(
                {
                    "page_no": page_no,
                    "width": width_pt,
                    "height": height_pt,
                    "modified": True,
                    "nodes": rebuilt_nodes,
                    **{key:deepcopy(scene_page[key]) for key in (
                        "background_color","background_modified","background","transition","hide_master","layout_id",
                    ) if key in scene_page},
                    **({"relations": deepcopy(scene_page["relations"])} if isinstance(scene_page.get("relations"), list) and scene_page["relations"] else {}),
                }
            )
            page_blobs[page_no] = raw_page_blob or bg_blob
        else:
            bg_blob = raw_page_blob or _blank_slide_png(width_pt, height_pt)
            layer_writes.append((page_no, "background.png", bg_blob))
            manifest_payload = {
                "status": "ready",
                "exporter_version": EXPORTER_VERSION,
                "background": "background.png",
                "objects": {},
                "frozen_ids": [],
            }
            layer_writes.append((page_no, "manifest.json", _json(manifest_payload)))
            rebuilt_scene_pages.append(
                {
                    "page_no": page_no,
                    "width": width_pt,
                    "height": height_pt,
                    "modified": False,
                    "nodes": [],
                }
            )
            page_blobs[page_no] = bg_blob

        page_layouts.append(
            {
                "page_no": page_no,
                "width": width_emu,
                "height": height_emu,
                "title": meta["title"] if meta else f"第 {page_no} 页",
                "elements": meta["elements"] if meta else [],
            }
        )

    material = MaterialRecord(
        id=material_id,
        session_id=session_id,
        title=title,
        status="ready",
        page_count=len(all_page_nos),
        source_filename=f"{title}.html",
        clone_of_example_id=None,
        candidates=[],
        created_at=now_iso,
        expires_at=iso_after(get_settings().material_retention_hours, base=now),
    )
    db.add(material)
    for page_no in all_page_nos:
        meta = page_meta_by_no.get(page_no)
        db.add(
            PageRecord(
                id=f"page_{uuid4().hex}",
                material_id=material_id,
                page_no=page_no,
                title=meta["title"] if meta else f"第 {page_no} 页",
                paragraphs=[],
                excerpt="",
                image_asset_id=None,
            )
        )
    db.commit()

    document_revision = int((cleaned_document or {}).get("revision") or 0)
    document_to_save = {
        "schema_version": "1.0",
        "revision": document_revision,
        "source_key": source_key,
        "title": title,
        "pages": rebuilt_scene_pages,
        "structure_modified": True,
        **({"theme": deepcopy(cleaned_document["theme"])} if cleaned_document and "theme" in cleaned_document else {}),
    }
    write_document(material_id, document_to_save)

    for page_no, file_name, blob in layer_writes:
        target = UPLOAD_DIR / material_id / "document" / "layers" / source_key / f"p{page_no:02d}" / file_name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(blob)

    raw_specs = export_data.get("specs") if isinstance(export_data.get("specs"), list) else []
    if not raw_specs and isinstance(backup_data.get("ispecs"), list):
        raw_specs = backup_data.get("ispecs")
    target_payload = {
        "schema_version": "1.0",
        "material_id": material_id,
        "ispecs": [spec for spec in raw_specs if isinstance(spec, Mapping)],
        "page_layouts": page_layouts,
    }
    (DATA_DIR / "ispecs").mkdir(parents=True, exist_ok=True)
    temp = DATA_DIR / "ispecs" / f"{material_id}.{uuid4().hex}.tmp"
    temp.write_text(json.dumps(target_payload, ensure_ascii=False), encoding="utf-8")
    temp.replace(DATA_DIR / "ispecs" / f"{material_id}.json")

    target_pages = pages_dir(material_id)
    target_pages.mkdir(parents=True, exist_ok=True)
    page_entries = []
    for layout in page_layouts:
        page_no = int(layout["page_no"])
        content = page_blobs[page_no]
        name = f"s{page_no:02d}.png"
        (target_pages / name).write_bytes(content)
        page_entries.append(
            {
                "page_no": page_no,
                "file": name,
                "bytes": len(content),
                "width": layout["width"],
                "height": layout["height"],
            }
        )
    render_dir(material_id).mkdir(parents=True, exist_ok=True)
    (render_dir(material_id) / "render.json").write_text(
        json.dumps(
            {
                "render_engine": "offline_html_import",
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

    backup_values = backup_data.get("values") if isinstance(backup_data.get("values"), Mapping) else {}
    for object_id, entry in backup_values.items():
        if isinstance(object_id, str) and isinstance(entry, Mapping):
            values_map = entry.get("values") if isinstance(entry.get("values"), Mapping) else entry
            if isinstance(values_map, Mapping):
                save_values(material_id, object_id, values_map)

    return {"material_id": material_id, "page_count": len(page_entries), "title": material.title}


def import_project_file(
    data: bytes,
    *,
    session_id: str,
    db: Session,
    filename: str = "",
) -> dict[str, Any]:
    """统一导入入口：支持 ``.xsproj`` zip 工程包和万象导出的单文件 ``.html``。"""

    if not data:
        raise ProjectPackageError("导入文件为空")
    lower_name = filename.lower().strip()
    if data[:4] == b"PK\x03\x04" or (lower_name.endswith(".xsproj") and not lower_name.endswith(".html")):
        return import_project_archive(data, session_id=session_id, db=db)
    stripped = data.lstrip()
    if (
        lower_name.endswith((".html", ".htm"))
        or stripped.startswith((b"<!doctype html", b"<!DOCTYPE html", b"<html", b"<HTML"))
        or b'id="export-data"' in data[:4096]
    ):
        return import_offline_html(data, session_id=session_id, db=db)
    raise ProjectPackageError("仅支持导入 .xsproj 工程包或万象导出的单文件 .html 交互网页")


class ProjectPackageError(ValueError):
    pass


__all__ = [
    "MAX_PACKAGE_BYTES",
    "MAX_PACKAGE_MEMBERS",
    "MAX_PACKAGE_UNZIPPED_BYTES",
    "PACKAGE_SCHEMA",
    "ProjectPackageError",
    "build_project_archive",
    "import_offline_html",
    "import_project_archive",
    "import_project_file",
]

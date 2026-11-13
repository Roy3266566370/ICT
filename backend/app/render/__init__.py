"""渲染包（R1 / spec §3）：PowerPoint COM → LibreOffice → 结构化兜底。

模块职责：

* :mod:`app.render.engine_com`         —— Windows PowerPoint COM 导出（独立子进程 + 超时）
* :mod:`app.render.engine_libreoffice` —— soffice + pymupdf
* :mod:`app.render.engine_select`      —— 优先级与 fidelity 判定
* :mod:`app.render.erase`              —— 环带校验 + 擦除底图（禁止硬盖）
* :mod:`app.render.assets`             —— pptx 图片按 sha1 去重落盘
* :mod:`app.render.pipeline`           —— 编排、产物目录、``render.json``

导入示例::

    from app.render import RenderError, render_for_material, select_engine

    choice = select_engine()
    outcome = render_for_material(material_id, pptx_path)
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Final

from ..settings import DATA_DIR, REPO_ROOT
from .assets import ASSET_ID_PREFIX, AssetIndex, ImageAsset, extract_assets
from .engine_select import EngineChoice, select_engine, select_engine_dict
from .erase import EraseReport, erase_regions, ring_stats, sample_background
from .errors import (
    ENGINE_COM,
    ENGINE_LIBREOFFICE,
    ENGINE_SVG,
    FIDELITY_HIGH,
    FIDELITY_LOW,
    RENDER_ERROR_CODES,
    RenderError,
)
from .pipeline import (
    ASSETS_DIR_NAME,
    PAGES_DIR_NAME,
    READINESS_FAILED,
    READINESS_PENDING,
    READINESS_READABLE,
    RENDER_MANIFEST_NAME,
    RENDER_STATUS_FAILED,
    RENDER_STATUS_FALLBACK,
    RENDER_STATUS_OK,
    RenderOutcome,
    erased_image_name,
    load_manifest,
    page_image_name,
    render_material,
)

#: 渲染产物根目录：``backend/data/renders/``（按 material_id 隔离，spec §3.2）。
RENDERS_DIR: Final[Path] = DATA_DIR / "renders"
#: 只允许这种页图文件名（``s01.png`` / ``s06_erased.png``），杜绝路径穿越。
PAGE_IMAGE_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^s(?P<page_no>\d{2,3})(?:_v\d{1,8})?(?P<erased>_erased)?\.png$"
)


# ---------------------------------------------------------------------------
# 产物路径
# ---------------------------------------------------------------------------


def render_dir(material_id: str) -> Path:
    """``backend/data/renders/<material_id>/``。"""

    return RENDERS_DIR / material_id


def pages_dir(material_id: str) -> Path:
    """整页底图目录。"""

    return render_dir(material_id) / PAGES_DIR_NAME


def assets_dir(material_id: str) -> Path:
    """抽取图片目录。"""

    return render_dir(material_id) / ASSETS_DIR_NAME


def manifest_path(material_id: str) -> Path:
    """渲染审计清单 ``render.json`` 的路径。"""

    return render_dir(material_id) / RENDER_MANIFEST_NAME


def read_render_manifest(material_id: str) -> dict[str, Any] | None:
    """读取该材料的 ``render.json``；缺失/损坏返回 ``None``（读取路径不得 500）。"""

    return load_manifest(render_dir(material_id))


def has_render_manifest(material_id: str) -> bool:
    """该材料是否已经过渲染阶段（有 ``render.json`` 即认为渲染已完成）。"""

    return manifest_path(material_id).is_file()


def existing_page_images(material_id: str) -> list[Path]:
    """扫描已落盘的整页图（``render.json`` 缺失时的兜底来源）。"""

    directory = pages_dir(material_id)
    if not directory.is_dir():
        return []
    images = [
        path
        for path in directory.glob("s*.png")
        if path.is_file() and PAGE_IMAGE_PATTERN.match(path.name) is not None
    ]
    images.sort(key=lambda item: item.name)
    return images


def render_for_material(material_id: str, pptx_path: str | Path, **kwargs: Any) -> RenderOutcome:
    """按材料渲染并写 ``render.json``（产物根固定为 ``backend/data/renders``）。"""

    revision = kwargs.pop('revision', 0)
    if revision:
        import shutil
        outcome = render_material(pptx_path, f'v{revision}',
            renders_dir=render_dir(material_id)/'revisions', repo_root=REPO_ROOT, **kwargs)
        target = pages_dir(material_id)
        target.mkdir(parents=True, exist_ok=True)
        revised = {}
        for page_no, source in outcome.pages.items():
            destination = target / f's{page_no:02d}_v{revision}.png'
            shutil.copy2(source, destination)
            revised[page_no] = destination
        outcome.pages = revised
        outcome.material_id = material_id
        outcome.directory = render_dir(material_id)
        outcome.write_manifest()
        return outcome
    return render_material(
        pptx_path,
        material_id,
        renders_dir=RENDERS_DIR,
        repo_root=REPO_ROOT,
        **kwargs,
    )


__all__ = [
    "ASSET_ID_PREFIX",
    "ASSETS_DIR_NAME",
    "AssetIndex",
    "ENGINE_COM",
    "ENGINE_LIBREOFFICE",
    "ENGINE_SVG",
    "EngineChoice",
    "EraseReport",
    "FIDELITY_HIGH",
    "FIDELITY_LOW",
    "ImageAsset",
    "PAGES_DIR_NAME",
    "PAGE_IMAGE_PATTERN",
    "READINESS_FAILED",
    "READINESS_PENDING",
    "READINESS_READABLE",
    "RENDERS_DIR",
    "RENDER_ERROR_CODES",
    "RENDER_MANIFEST_NAME",
    "RENDER_STATUS_FAILED",
    "RENDER_STATUS_FALLBACK",
    "RENDER_STATUS_OK",
    "RenderError",
    "RenderOutcome",
    "assets_dir",
    "erase_regions",
    "erased_image_name",
    "existing_page_images",
    "extract_assets",
    "has_render_manifest",
    "load_manifest",
    "manifest_path",
    "page_image_name",
    "pages_dir",
    "read_render_manifest",
    "render_dir",
    "render_for_material",
    "render_material",
    "ring_stats",
    "sample_background",
    "select_engine",
    "select_engine_dict",
]

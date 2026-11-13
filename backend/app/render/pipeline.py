"""渲染流水线：引擎选择 → 整页导出 → 图片提取 → 可选擦除 → 产物清单。

产物目录（spec §3.2，按 material_id 隔离）::

    backend/data/renders/<material_id>/
      pages/s01.png … s24.png        # 整页 1920x1080
      pages/s06_erased.png           # 该页交互区域已擦除的底图（有 region 时）
      assets/<sha1>.<ext>            # 从 pptx 提取的原始图片（按 sha1 去重）
      render.json                    # 本次渲染的审计清单

设计原则：

* **渲染失败不抛给调用方**：返回 :class:`RenderOutcome`，``render_status`` 表明是
  真实渲染（``render_ok``）、结构化兜底（``svg_fallback``）还是彻底失败（``render_failed``）。
* 图片提取与渲染解耦：即使页面渲染不可用，提取出的图片仍可用于阅读。
* 擦除只针对调用方明确给出、且通过环带校验的 region；校验不过的一律 ``static_only``。
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

from . import engine_com, engine_libreoffice
from .assets import AssetIndex, extract_assets
from .engine_select import EngineChoice, select_engine
from .erase import (
    DEFAULT_BACKGROUND,
    DEFAULT_BACKGROUND_TOLERANCE,
    DEFAULT_PAGE_HEIGHT_IN,
    DEFAULT_PAGE_WIDTH_IN,
    DEFAULT_RING_PX,
    DEFAULT_VARIANCE_THRESHOLD,
    EraseReport,
    erase_regions,
)
from .errors import (
    ENGINE_COM,
    ENGINE_LIBREOFFICE,
    ENGINE_SVG,
    FIDELITY_HIGH,
    FIDELITY_LOW,
    RenderError,
)

logger = logging.getLogger(__name__)

#: 产物清单文件名。
RENDER_MANIFEST_NAME = "render.json"
#: 产物清单结构版本（与前端无需对齐，仅本模块内部与审计使用）。
RENDER_MANIFEST_VERSION = "0.3"
#: 页图子目录名与擦除图后缀。
PAGES_DIR_NAME = "pages"
ASSETS_DIR_NAME = "assets"
ERASED_SUFFIX = "_erased"
#: 渲染状态取值。
RENDER_STATUS_OK = "render_ok"
RENDER_STATUS_FALLBACK = "svg_fallback"
RENDER_STATUS_FAILED = "render_failed"
#: 可读状态取值（写入 materials.readiness）。
READINESS_READABLE = "readable"
READINESS_PENDING = "pending"
READINESS_FAILED = "render_failed"


def page_image_name(page_no: int) -> str:
    """整页图文件名：``s01.png``。"""

    return f"s{int(page_no):02d}.png"


def erased_image_name(page_no: int) -> str:
    """擦除版文件名：``s06_erased.png``。"""

    return f"s{int(page_no):02d}{ERASED_SUFFIX}.png"


@dataclass(slots=True)
class RenderOutcome:
    """一次材料渲染的结果（不含数据库状态，调用方据此落库）。"""

    material_id: str
    engine: str
    fidelity: str
    render_status: str
    directory: Path
    pages: dict[int, Path] = field(default_factory=dict)
    erased: dict[int, Path] = field(default_factory=dict)
    assets: AssetIndex = field(default_factory=AssetIndex)
    erase_reports: list[EraseReport] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    background: tuple[int, int, int] | None = None
    duration_s: float = 0.0
    page_size: tuple[int, int] = (0, 0)

    # --- 便捷视图 ---

    @property
    def page_count(self) -> int:
        return len(self.pages)

    @property
    def readable(self) -> bool:
        """有页图，或至少有可用的结构/图片素材 → 材料可读。"""

        return bool(self.pages) or self.render_status == RENDER_STATUS_FALLBACK

    def page_file(self, page_no: int) -> Path | None:
        return self.pages.get(int(page_no))

    def erased_file(self, page_no: int) -> Path | None:
        return self.erased.get(int(page_no))

    def asset_map(self) -> dict[str, str]:
        """``asset_id`` → 文件路径（相对仓库根）。"""

        return {asset_id: asset.file for asset_id, asset in self.assets.entries.items()}

    def asset_map_by_sha1(self) -> dict[str, str]:
        """``sha1`` → 文件路径，用于把解析产物的图片元素回填到落盘资源。"""

        return {asset.sha1: asset.file for asset in self.assets.entries.values()}

    def asset_id_by_sha1(self) -> dict[str, str]:
        return {asset.sha1: asset.asset_id for asset in self.assets.entries.values()}

    def manifest(self, **extra: Any) -> dict[str, Any]:
        """审计清单（写入 ``render.json``）。"""

        pages: list[dict[str, Any]] = []
        for page_no in sorted(self.pages):
            path = self.pages[page_no]
            erased = self.erased.get(page_no)
            pages.append(
                {
                    "page_no": page_no,
                    "file": f"{PAGES_DIR_NAME}/{path.name}",
                    "bytes": path.stat().st_size if path.is_file() else 0,
                    "erased_file": (f"{PAGES_DIR_NAME}/{erased.name}" if erased else None),
                    "erased_bytes": erased.stat().st_size if erased and erased.is_file() else None,
                }
            )
        payload: dict[str, Any] = {
            "schema_version": RENDER_MANIFEST_VERSION,
            "material_id": self.material_id,
            "render_engine": self.engine,
            "fidelity": self.fidelity,
            "render_status": self.render_status,
            "page_count": len(self.pages),
            "page_size": list(self.page_size),
            "background": list(self.background) if self.background else None,
            "pages": pages,
            "assets": self.assets.as_dict(),
            "erase": [report.as_dict() for report in self.erase_reports],
            "errors": list(self.errors),
            "duration_s": round(self.duration_s, 3),
            "rendered_at": _now_iso(),
        }
        payload.update(extra)
        return payload

    def write_manifest(self, **extra: Any) -> Path:
        """把清单写到 ``<directory>/render.json``，返回路径。"""

        self.directory.mkdir(parents=True, exist_ok=True)
        target = self.directory / RENDER_MANIFEST_NAME
        target.write_text(
            json.dumps(self.manifest(**extra), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return target


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def _render_with_engine(
    engine: str,
    pptx_path: Path,
    pages_dir: Path,
    *,
    width: int,
    height: int,
    timeout_s: float,
) -> list[Path]:
    """按引擎名调用对应实现。"""

    if engine == ENGINE_COM:
        return engine_com.render_pptx(
            pptx_path, pages_dir, width=width, height=height, timeout_s=timeout_s
        )
    if engine == ENGINE_LIBREOFFICE:
        return engine_libreoffice.render_pptx(
            pptx_path, pages_dir, width=width, height=height, timeout_s=timeout_s
        )
    raise RenderError("engine_unavailable", f"未知渲染引擎：{engine}")


def _try_render(
    pptx_path: Path,
    pages_dir: Path,
    choice: EngineChoice,
    *,
    width: int,
    height: int,
    timeout_s: float,
) -> tuple[EngineChoice, list[Path], list[str]]:
    """执行渲染；首选失败时按 auto 语义回退到另一引擎，仍失败则回 svg_fallback。"""

    errors: list[str] = []
    order: list[str] = []
    if choice.engine != ENGINE_SVG:
        order.append(choice.engine)
    # auto 模式下补充备选引擎（显式指定引擎时不偷偷换）
    if choice.reason is None or "回退" in (choice.reason or ""):
        for candidate in (ENGINE_COM, ENGINE_LIBREOFFICE):
            if candidate not in order and (
                (candidate == ENGINE_COM and engine_com.is_available())
                or (candidate == ENGINE_LIBREOFFICE and engine_libreoffice.is_available())
            ):
                order.append(candidate)
    if not order:
        errors.append(choice.reason or "没有可用的渲染引擎")
        return EngineChoice(ENGINE_SVG, FIDELITY_LOW, choice.reason), [], errors

    for engine in order:
        try:
            files = _render_with_engine(
                engine, pptx_path, pages_dir, width=width, height=height, timeout_s=timeout_s
            )
        except RenderError as exc:
            errors.append(f"{engine}: {exc.code}: {exc.message}")
            logger.warning("引擎 %s 渲染失败：%s（%s）", engine, exc.code, exc.message)
            continue
        fidelity = FIDELITY_HIGH
        return EngineChoice(engine, fidelity, choice.reason), files, errors

    errors.append("全部渲染引擎失败，已降级为 svg_fallback（fidelity=low）")
    return EngineChoice(ENGINE_SVG, FIDELITY_LOW, "全部渲染引擎失败"), [], errors


def _verify_pages(files: Sequence[Path], width: int, height: int) -> list[str]:
    """抽检页图尺寸；不一致只记录 warning（不阻断可读性）。"""

    warnings: list[str] = []
    if not files:
        return warnings
    try:
        from PIL import Image  # noqa: PLC0415

        sample = list(files[:3]) + list(files[-1:])
        for item in sample:
            with Image.open(item) as image:
                if abs(image.width - width) > 2 or abs(image.height - height) > 2:
                    warnings.append(
                        f"{item.name} 尺寸 {image.width}x{image.height} 与目标 {width}x{height} 不一致"
                    )
    except Exception as exc:  # noqa: BLE001 - 校验失败不影响渲染结果
        warnings.append(f"页图尺寸校验跳过：{type(exc).__name__}")
    return warnings


def render_material(
    pptx_path: str | Path,
    material_id: str,
    *,
    renders_dir: str | Path,
    repo_root: str | Path | None = None,
    prefer: str | None = None,
    width: int = engine_com.DEFAULT_WIDTH,
    height: int = engine_com.DEFAULT_HEIGHT,
    timeout_s: float = engine_com.DEFAULT_TIMEOUT_S,
    expected_page_count: int | None = None,
    regions: Sequence[Mapping[str, Any]] | None = None,
    page_size_in: tuple[float, float] = (DEFAULT_PAGE_WIDTH_IN, DEFAULT_PAGE_HEIGHT_IN),
    erase_ring_px: int = DEFAULT_RING_PX,
    erase_variance_threshold: float = DEFAULT_VARIANCE_THRESHOLD,
    erase_background_tolerance: float = DEFAULT_BACKGROUND_TOLERANCE,
    extract_images: bool = True,
) -> RenderOutcome:
    """渲染一份材料：页图、图片素材、可选擦除版、审计清单。

    :param pptx_path: 上传原件或仓库样例。
    :param material_id: 材料 id（产物目录隔离依据）。
    :param renders_dir: ``backend/data/renders``。
    :param expected_page_count: 解析得到的页数；仅用于告警不一致。
    :param regions: ``PageRegion`` 序列；为空则不做擦除（上传时的常规路径）。
    """

    started = time.monotonic()
    material_root = Path(renders_dir) / material_id
    pages_dir = material_root / PAGES_DIR_NAME
    assets_dir = material_root / ASSETS_DIR_NAME
    material_root.mkdir(parents=True, exist_ok=True)

    choice = select_engine(prefer)
    outcome = RenderOutcome(
        material_id=material_id,
        engine=choice.engine,
        fidelity=choice.fidelity,
        render_status=RENDER_STATUS_FALLBACK if choice.engine == ENGINE_SVG else RENDER_STATUS_OK,
        directory=material_root,
        page_size=(int(width), int(height)),
    )
    if choice.reason:
        outcome.errors.append(f"engine_select: {choice.reason}")

    source = Path(pptx_path)
    final_choice, files, render_errors = _try_render(
        source,
        pages_dir,
        choice,
        width=width,
        height=height,
        timeout_s=timeout_s,
    )
    outcome.engine = final_choice.engine
    outcome.fidelity = final_choice.fidelity
    outcome.errors.extend(render_errors)

    if files:
        outcome.render_status = RENDER_STATUS_OK
        outcome.pages = {index: path for index, path in enumerate(files, start=1)}
        outcome.errors.extend(_verify_pages(files, width, height))
        if expected_page_count is not None and len(files) != int(expected_page_count):
            outcome.errors.append(
                f"页数不一致：渲染 {len(files)} 页，解析 {int(expected_page_count)} 页"
            )
        if files:
            try:
                outcome.background = _sample_page_background(files[0])
            except Exception:  # noqa: BLE001 - 背景色仅用于擦除默认值
                outcome.background = DEFAULT_BACKGROUND
    else:
        # 无页图：结构化兜底（前端按 slides 还原，fidelity=low）
        outcome.render_status = (
            RENDER_STATUS_FALLBACK if choice.engine != ENGINE_SVG or not render_errors else RENDER_STATUS_FALLBACK
        )
        outcome.engine = ENGINE_SVG
        outcome.fidelity = FIDELITY_LOW

    # 图片素材：与渲染解耦，失败不影响可读性
    if extract_images:
        try:
            outcome.assets = extract_assets(source, assets_dir, repo_root=repo_root)
        except Exception as exc:  # noqa: BLE001 - 提取失败只记录
            outcome.errors.append(f"assets: {type(exc).__name__}: {exc}")
        outcome.errors.extend(outcome.assets.errors)

    # 擦除：只对通过环带校验的区域落盘
    if regions and outcome.pages:
        for page_no in sorted({int(item.get("page", 0)) for item in regions}):
            page_file = outcome.pages.get(page_no)
            if page_file is None:
                outcome.errors.append(f"erase: 第 {page_no} 页没有页图，跳过擦除")
                continue
            try:
                report = erase_regions(
                    page_file,
                    pages_dir / erased_image_name(page_no),
                    regions,
                    page=page_no,
                    page_size_in=page_size_in,
                    ring_px=erase_ring_px,
                    variance_threshold=erase_variance_threshold,
                    background_tolerance=erase_background_tolerance,
                    background=outcome.background,
                )
            except Exception as exc:  # noqa: BLE001 - 擦除失败不影响原页
                outcome.errors.append(f"erase: 第 {page_no} 页失败 {type(exc).__name__}: {exc}")
                continue
            outcome.erase_reports.append(report)
            if report.ok and report.output is not None:
                outcome.erased[page_no] = report.output

    outcome.duration_s = time.monotonic() - started
    try:
        outcome.write_manifest(
            expected_page_count=expected_page_count,
            prefer=prefer or "auto",
            page_size_in=list(page_size_in),
        )
    except OSError as exc:  # pragma: no cover - 磁盘异常
        outcome.errors.append(f"manifest: {type(exc).__name__}: {exc}")

    logger.info(
        "材料 %s 渲染完成：engine=%s fidelity=%s status=%s pages=%d erased=%d assets=%d %.1fs",
        material_id,
        outcome.engine,
        outcome.fidelity,
        outcome.render_status,
        len(outcome.pages),
        len(outcome.erased),
        len(outcome.assets),
        outcome.duration_s,
    )
    return outcome


def _sample_page_background(page_file: Path) -> tuple[int, int, int]:
    """取首页四角中位数作为背景色（擦除填充默认值）。"""

    from PIL import Image  # noqa: PLC0415

    from .erase import sample_background  # noqa: PLC0415

    with Image.open(page_file) as image:
        return sample_background(image)


def load_manifest(directory: str | Path) -> dict[str, Any] | None:
    """读取 ``render.json``；不存在或损坏返回 ``None``。"""

    path = Path(directory) / RENDER_MANIFEST_NAME
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.warning("render.json 读取失败：%s", path)
        return None


__all__ = [
    "ASSETS_DIR_NAME",
    "ERASED_SUFFIX",
    "PAGES_DIR_NAME",
    "READINESS_FAILED",
    "READINESS_PENDING",
    "READINESS_READABLE",
    "RENDER_MANIFEST_NAME",
    "RENDER_MANIFEST_VERSION",
    "RENDER_STATUS_FAILED",
    "RENDER_STATUS_FALLBACK",
    "RENDER_STATUS_OK",
    "RenderOutcome",
    "erased_image_name",
    "load_manifest",
    "page_image_name",
    "render_material",
]
"""从 PPTX 提取原始图片（spec §0 第 5 条、§3.2 ``assets/``）。

规则：

1. 只读取 ``shape.image.blob``，**不解码、不执行任何内容**（python-pptx 纯读取）。
2. 按 ``sha1`` 去重：同一张图（多页复用）只落盘一次，文件名为 ``<sha1>.<ext>``。
3. ``asset_id`` 取 ``ast_<sha1[:12]>``：同一字节流在任何材料里都是同一个 id，
   便于解析产物、DB 与前端缓存对齐。
4. 非 Web 友好格式（``emf``/``wmf``/``tiff``）仍保存原文件，但 ``web_safe=false``，
   由调用方决定是否转码或跳过。
5. 任何异常都只记录到 ``errors``，不抛裸异常——图片提取失败不应让页面不可读。
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping

logger = logging.getLogger(__name__)

#: 浏览器可直接显示的图片扩展名。
WEB_SAFE_EXTENSIONS: frozenset[str] = frozenset(
    {"png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"}
)

#: 单张图片大小上限（超过则不落盘，只记录）。
DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024

#: asset_id 前缀。
ASSET_ID_PREFIX = "ast_"


@dataclass(frozen=True, slots=True)
class ImageAsset:
    """一张被提取的图片。"""

    asset_id: str
    sha1: str
    ext: str
    file: str
    byte_size: int
    width: int | None
    height: int | None
    web_safe: bool
    occurrences: tuple[dict[str, Any], ...] = ()

    @property
    def page_no(self) -> int | None:
        """首次出现页码。"""

        return int(self.occurrences[0]["page_no"]) if self.occurrences else None

    def as_dict(self) -> dict[str, Any]:
        return {
            "asset_id": self.asset_id,
            "sha1": self.sha1,
            "ext": self.ext,
            "file": self.file,
            "byte_size": self.byte_size,
            "width": self.width,
            "height": self.height,
            "web_safe": self.web_safe,
            "occurrences": [dict(item) for item in self.occurrences],
        }


@dataclass(slots=True)
class AssetIndex:
    """一次提取的结果。"""

    entries: dict[str, ImageAsset] = field(default_factory=dict)
    written: int = 0
    deduplicated: int = 0
    skipped: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    directory: Path | None = None

    def __len__(self) -> int:
        return len(self.entries)

    def by_sha1(self) -> dict[str, ImageAsset]:
        """``sha1`` → 资源（解析产物用 sha1 回填 asset_id）。"""

        return {asset.sha1: asset for asset in self.entries.values()}

    def as_dict(self) -> dict[str, Any]:
        return {
            "directory": self.directory.name if self.directory else None,
            "count": len(self.entries),
            "written": self.written,
            "deduplicated": self.deduplicated,
            "skipped": list(self.skipped),
            "errors": list(self.errors),
            "assets": {key: value.as_dict() for key, value in self.entries.items()},
        }


def _relative_to(path: Path, root: Path | None) -> str:
    """尽量返回相对仓库根的路径（跨机器可迁移），失败则用绝对路径。"""

    resolved = path.resolve()
    if root is not None:
        try:
            return resolved.relative_to(root.resolve()).as_posix()
        except ValueError:
            pass
    return resolved.as_posix()


def _image_size(blob: bytes) -> tuple[int | None, int | None]:
    """用 Pillow 读图片尺寸；失败返回 ``(None, None)``（不抛异常）。"""

    try:
        from io import BytesIO  # noqa: PLC0415

        from PIL import Image  # noqa: PLC0415

        with Image.open(BytesIO(blob)) as image:
            return int(image.width), int(image.height)
    except Exception:  # noqa: BLE001 - 尺寸只是附加信息
        return None, None


def _picture_shapes(presentation: Any) -> Iterable[tuple[int, int, Any]]:
    """按页序产出 ``(page_no, shape_index, shape)``，仅图片形状。"""

    for page_index, slide in enumerate(presentation.slides, start=1):
        for shape_index, shape in enumerate(slide.shapes):
            image = getattr(shape, "image", None)
            if image is None:
                continue
            yield page_index, shape_index, shape


def extract_assets(
    pptx_path: str | Path,
    out_dir: str | Path,
    *,
    repo_root: str | Path | None = None,
    max_bytes: int = DEFAULT_MAX_IMAGE_BYTES,
) -> AssetIndex:
    """提取 pptx 内的全部图片并去重落盘。

    :param pptx_path: 源 pptx（只读）。
    :param out_dir: ``renders/<material_id>/assets``。
    :param repo_root: 用于把落盘路径转成相对路径（写入 ``asset_file``）。
    :param max_bytes: 单张图上限；超过记录到 ``skipped``，不落盘。
    :returns: :class:`AssetIndex`；失败时 ``entries`` 为空且 ``errors`` 非空。
    """

    source = Path(pptx_path)
    target_dir = Path(out_dir)
    index = AssetIndex(directory=target_dir)

    if not source.is_file() or source.stat().st_size == 0:
        index.errors.append(f"源文件不存在或为空：{source.name}")
        return index

    try:
        from pptx import Presentation  # noqa: PLC0415
    except Exception as exc:  # pragma: no cover - python-pptx 缺失
        index.errors.append(f"python-pptx 不可用：{type(exc).__name__}")
        return index

    try:
        presentation = Presentation(str(source))
    except Exception as exc:  # noqa: BLE001 - 损坏/加密
        index.errors.append(f"无法打开 pptx：{type(exc).__name__}")
        return index

    target_dir.mkdir(parents=True, exist_ok=True)
    seen_sha1: dict[str, ImageAsset] = {}
    root = Path(repo_root) if repo_root is not None else None

    try:
        for page_no, shape_index, shape in _picture_shapes(presentation):
            try:
                image = shape.image
                blob: bytes = bytes(image.blob)
                ext = str(getattr(image, "ext", "") or "bin").lower().lstrip(".")
            except Exception as exc:  # noqa: BLE001 - 个别形状读不出图
                index.skipped.append(
                    {"page_no": page_no, "shape_index": shape_index, "reason": f"读取失败：{type(exc).__name__}"}
                )
                continue

            if not blob:
                index.skipped.append(
                    {"page_no": page_no, "shape_index": shape_index, "reason": "图片字节为空"}
                )
                continue
            if len(blob) > max_bytes:
                index.skipped.append(
                    {
                        "page_no": page_no,
                        "shape_index": shape_index,
                        "reason": f"超过单图上限 {max_bytes} 字节",
                        "byte_size": len(blob),
                    }
                )
                continue

            digest = hashlib.sha1(blob).hexdigest()
            occurrence = {
                "page_no": page_no,
                "shape_index": shape_index,
                "bbox_emu": {
                    "x": int(getattr(shape, "left", 0) or 0),
                    "y": int(getattr(shape, "top", 0) or 0),
                    "w": int(getattr(shape, "width", 0) or 0),
                    "h": int(getattr(shape, "height", 0) or 0),
                },
            }
            existing = seen_sha1.get(digest)
            if existing is not None:
                seen_sha1[digest] = _with_occurrence(existing, occurrence)
                index.deduplicated += 1
                continue

            file_path = target_dir / f"{digest}.{ext}"
            if not file_path.is_file():
                try:
                    file_path.write_bytes(blob)
                    index.written += 1
                except OSError as exc:
                    index.skipped.append(
                        {
                            "page_no": page_no,
                            "shape_index": shape_index,
                            "reason": f"写入失败：{type(exc).__name__}",
                        }
                    )
                    continue

            width, height = _image_size(blob)
            asset = ImageAsset(
                asset_id=f"{ASSET_ID_PREFIX}{digest[:12]}",
                sha1=digest,
                ext=ext,
                file=_relative_to(file_path, root),
                byte_size=len(blob),
                width=width,
                height=height,
                web_safe=ext in WEB_SAFE_EXTENSIONS,
                occurrences=(occurrence,),
            )
            seen_sha1[digest] = asset
            index.entries[asset.asset_id] = asset
    except Exception as exc:  # noqa: BLE001 - 遍历失败不阻断渲染
        index.errors.append(f"遍历幻灯片失败：{type(exc).__name__}: {exc}")

    logger.info(
        "提取图片 %d 张（新增 %d、去重 %d、跳过 %d）→ %s",
        len(index.entries),
        index.written,
        index.deduplicated,
        len(index.skipped),
        target_dir,
    )
    return index


def _with_occurrence(asset: ImageAsset, occurrence: Mapping[str, Any]) -> ImageAsset:
    """同 sha1 的新出现位置合并进 ``occurrences``。"""

    return ImageAsset(
        asset_id=asset.asset_id,
        sha1=asset.sha1,
        ext=asset.ext,
        file=asset.file,
        byte_size=asset.byte_size,
        width=asset.width,
        height=asset.height,
        web_safe=asset.web_safe,
        occurrences=asset.occurrences + (dict(occurrence),),
    )


__all__ = [
    "ASSET_ID_PREFIX",
    "DEFAULT_MAX_IMAGE_BYTES",
    "WEB_SAFE_EXTENSIONS",
    "AssetIndex",
    "ImageAsset",
    "extract_assets",
]
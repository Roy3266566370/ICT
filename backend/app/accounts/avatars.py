"""账号头像：校验、方形裁剪、重编码与落盘（``C-PROFILE@1``）。

- 只接受 JPG / PNG / WebP；上限 2MB（``AVATAR_MAX_BYTES``，可配置）；
- 解码前先校验像素总量，避免解压炸弹；解码失败按 ``INVALID_FILE``（400）处理；
- 统一转 RGB、居中裁成正方形、缩放到 ``AVATAR_SIZE`` 后重新编码为 JPEG，
  因此 EXIF、ICC 与原始元数据不会随头像落盘；
- 文件名固定为 ``<user_id>.jpg``，重复上传直接覆盖；数据库只保存 ``avatar_id``
  用于 URL 版本号，浏览器缓存随标识变化自然失效。
"""

from __future__ import annotations

import io
import logging
import os
from pathlib import Path
from uuid import uuid4

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session

from ..db.account_models import UserProfileRecord, utc_now
from ..schemas.errors import invalid_file, limit_exceeded
from ..settings import AVATAR_DIR, get_settings

logger = logging.getLogger(__name__)

#: Pillow 识别出的合法格式（扩展名与 Content-Type 均不可信，只认实际内容）。
ALLOWED_FORMATS: frozenset[str] = frozenset({"JPEG", "PNG", "WEBP"})

#: 单边像素上限与总像素上限：本地课堂场景足够，且能挡住解压炸弹。
MAX_SOURCE_DIMENSION = 8192
MAX_SOURCE_PIXELS = 40_000_000

AVATAR_JPEG_QUALITY = 88


def avatar_path(user_id: str) -> Path:
    """头像文件路径（文件名为 ``user_id``，因此不需要做路径清洗）。"""

    return AVATAR_DIR / f"{user_id}.jpg"


def _validate_size(content: bytes) -> None:
    settings = get_settings()
    if not content:
        raise invalid_file("头像文件为空")
    if len(content) > settings.avatar_max_bytes:
        limit_mb = max(1, settings.avatar_max_bytes // (1024 * 1024))
        raise limit_exceeded(f"头像图片不能超过 {limit_mb}MB", max_bytes=settings.avatar_max_bytes)


def _decode_square_image(content: bytes) -> Image.Image:
    """校验并解码为方形 RGB 图像；任何异常都转成契约错误码。"""

    _validate_size(content)
    try:
        image = Image.open(io.BytesIO(content))
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise invalid_file("头像仅支持 JPG、PNG 或 WebP 图片") from None

    if image.format not in ALLOWED_FORMATS:
        raise invalid_file("头像仅支持 JPG、PNG 或 WebP 图片")
    width, height = image.size
    if width <= 0 or height <= 0:
        raise invalid_file("头像图片尺寸无效")
    if (
        width > MAX_SOURCE_DIMENSION
        or height > MAX_SOURCE_DIMENSION
        or width * height > MAX_SOURCE_PIXELS
    ):
        raise limit_exceeded("头像图片尺寸过大，请换一张更小的图片")

    try:
        image.load()
    except (OSError, ValueError, Image.DecompressionBombError):
        raise invalid_file("头像图片已损坏，请换一张图片") from None

    image = ImageOps.exif_transpose(image)

    # 透明背景填白：头像最终是 JPEG，alpha 通道不能保留。
    if image.mode in ("RGBA", "LA", "P"):
        rgba = image.convert("RGBA")
        canvas = Image.new("RGB", rgba.size, (255, 255, 255))
        canvas.paste(rgba, mask=rgba.split()[-1])
        image = canvas
    else:
        image = image.convert("RGB")

    side = min(image.width, image.height)
    left = (image.width - side) // 2
    top = (image.height - side) // 2
    image = image.crop((left, top, left + side, top + side))

    size = get_settings().avatar_size
    return image.resize((size, size), Image.LANCZOS)


def save_avatar(
    db: Session, profile: UserProfileRecord, *, user_id: str, content: bytes
) -> UserProfileRecord:
    """校验、重编码并覆盖头像文件；成功后更新资料行并提交。"""

    image = _decode_square_image(content)

    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    target = avatar_path(user_id)
    temp_path = target.with_suffix(".jpg.tmp")
    image.save(temp_path, format="JPEG", quality=AVATAR_JPEG_QUALITY, optimize=True)
    os.replace(temp_path, target)

    moment = utc_now()
    profile.avatar_id = uuid4().hex
    profile.avatar_updated_at = moment
    profile.updated_at = moment
    db.commit()
    logger.info("已更新账号头像 user_id=%s size=%d", user_id, len(content))
    return profile


def delete_avatar(db: Session, profile: UserProfileRecord, *, user_id: str) -> UserProfileRecord:
    """恢复默认头像：删除文件并清空标识（文件已不存在也视为成功）。"""

    avatar_path(user_id).unlink(missing_ok=True)
    if profile.avatar_id is not None:
        profile.avatar_id = None
        profile.avatar_updated_at = None
        profile.updated_at = utc_now()
        db.commit()
        logger.info("已恢复默认头像 user_id=%s", user_id)
    return profile


__all__ = [
    "ALLOWED_FORMATS",
    "AVATAR_JPEG_QUALITY",
    "avatar_path",
    "delete_avatar",
    "save_avatar",
]

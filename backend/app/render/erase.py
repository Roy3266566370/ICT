"""擦除底图生成（spec §3.3）：**先校验后擦除，宁可 static_only 也不硬盖**。

规则（逐条对应 spec）：

1. 每个待替换区域在填充前必须通过"环带校验"：bbox **四边外 2px 环带**必须是纯色——
   每通道像素方差 < 阈值；超过即判"不可分离"，该区域不填充，标记 ``static_only``。
2. 通过校验后，填充色取**环带自身的中位色**，而不是硬编码页背景色：
   S6/S9/S10/S14 的图区四周是页面底色（实测 ``#F6F3EC``），而 S18 的四格落在
   更暗一层的浅色卡片里（实测环带 ``(234,233,227)``）。若统一用页背景色填充，
   S18 会留下 4 个更亮的方块接缝——这正是 v0.2 被判"盖白块"的原因。
3. 外扩 ``fill_bleed`` 像素一并填充，消除图片边缘的抗锯齿细边（环带已确认纯色，安全）。
4. 原图由多个形状组成时，由调用方只传"确认要替换"的区域（本模块不做语义判断）。
5. 全部区域都不通过校验时不写 erased 文件（避免产出"假擦除图"）。

所有坐标以**英寸**传入，按页图尺寸与页面英寸尺寸换算为像素，与 pptx 的 13.333x7.5
页面一致（spec §4 的 bbox 即为英寸）。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

#: 页面实测背景色（仅作审计对照，**不作为填充色**）。
DEFAULT_BACKGROUND: tuple[int, int, int] = (246, 243, 236)
#: 环带宽度（像素）：spec 要求"bbox 四边外 2px 环带"。
DEFAULT_RING_PX = 2
#: 环带方差阈值：纯色环带实测 0.0～0.02，含纹理/边框会远超，留足余量。
DEFAULT_VARIANCE_THRESHOLD = 6.0
#: 环带均值与页背景的最大通道差：仅用于审计标注（S18 卡片会超过该值，属预期）。
DEFAULT_BACKGROUND_TOLERANCE = 8.0
#: 填充外扩像素：环带已确认纯色，外扩 1px 可消除抗锯齿接缝。
DEFAULT_FILL_BLEED = 1

#: 标准 16:9 页面尺寸（英寸），与课程材料一致。
DEFAULT_PAGE_WIDTH_IN = 13.3333
DEFAULT_PAGE_HEIGHT_IN = 7.5


@dataclass(frozen=True, slots=True)
class RingStats:
    """bbox 外环带的统计量（用于判定"是否纯色"）。"""

    variance: float
    mean: tuple[float, float, float]
    background_delta: float
    pixel_count: int
    #: 填充色：环带像素的中位色（比均值更抗边缘杂点）。
    fill: tuple[int, int, int] = DEFAULT_BACKGROUND

    @property
    def color_matches_page(self) -> bool:
        """环带颜色是否接近页背景色（仅审计用）。"""

        return self.background_delta <= DEFAULT_BACKGROUND_TOLERANCE

    def as_dict(self) -> dict[str, Any]:
        return {
            "variance": round(self.variance, 4),
            "mean": [round(value, 1) for value in self.mean],
            "background_delta": round(self.background_delta, 3),
            "pixel_count": self.pixel_count,
            "fill_rgb": list(self.fill),
        }


@dataclass(slots=True)
class SkippedRegion:
    """被判定为不可擦除的区域。"""

    region_id: str
    reason: str
    stats: RingStats | None = None

    def as_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"region_id": self.region_id, "reason": self.reason}
        if self.stats is not None:
            payload["ring"] = self.stats.as_dict()
        return payload


@dataclass(slots=True)
class EraseReport:
    """一次擦除的结果。"""

    page: int
    output: Path | None
    background: tuple[int, int, int]
    applied: list[str] = field(default_factory=list)
    skipped: list[SkippedRegion] = field(default_factory=list)
    fills: dict[str, list[int]] = field(default_factory=dict)
    #: 每个评估过的 region 的环带统计（通过与否都记录，供 regions.json 审计）。
    checks: dict[str, RingStats] = field(default_factory=dict)
    width: int = 0
    height: int = 0

    @property
    def ok(self) -> bool:
        """是否至少擦除了一个区域并写出了文件。"""

        return bool(self.applied) and self.output is not None and self.output.is_file()

    @property
    def static_only(self) -> list[str]:
        """因环带校验不通过而保持静态的区域 id。"""

        return [item.region_id for item in self.skipped]

    def as_dict(self) -> dict[str, Any]:
        return {
            "page": self.page,
            "output": self.output.name if self.output else None,
            "background": list(self.background),
            "applied": list(self.applied),
            "skipped": [item.as_dict() for item in self.skipped],
            "fills": dict(self.fills),
            "checks": {key: value.as_dict() for key, value in self.checks.items()},
            "size": [self.width, self.height],
            "ok": self.ok,
        }


def sample_background(image: Image.Image, *, patch: int = 8) -> tuple[int, int, int]:
    """取四角 ``patch x patch`` 像素的中位数作为页背景色（审计/展示用）。"""

    rgb = image.convert("RGB")
    width, height = rgb.size
    boxes = (
        (0, 0, patch, patch),
        (max(0, width - patch), 0, width, patch),
        (0, max(0, height - patch), patch, height),
        (max(0, width - patch), max(0, height - patch), width, height),
    )
    samples = [np.asarray(rgb.crop(box)).reshape(-1, 3) for box in boxes]
    stacked = np.concatenate(samples, axis=0).astype(float)
    median = np.median(stacked, axis=0)
    return tuple(int(round(value)) for value in median)  # type: ignore[return-value]


def ring_stats(
    array: np.ndarray,
    box: tuple[float, float, float, float],
    *,
    background: tuple[int, int, int],
    ring_px: int = DEFAULT_RING_PX,
) -> RingStats | None:
    """统计 ``box`` 外 ``ring_px`` 环带的方差、均值与中位色；越界返回 ``None``。

    :param array: 页图的 ``(H, W, 3)`` 数组。
    :param box: ``(left, top, right, bottom)`` 像素坐标（浮点）。
    """

    height, width = array.shape[0], array.shape[1]
    left, top, right, bottom = box
    outer_left = int(np.floor(left - ring_px))
    outer_top = int(np.floor(top - ring_px))
    outer_right = int(np.ceil(right + ring_px))
    outer_bottom = int(np.ceil(bottom + ring_px))
    if (
        outer_left < 0
        or outer_top < 0
        or outer_right > width
        or outer_bottom > height
        or outer_right - outer_left <= 0
        or outer_bottom - outer_top <= 0
    ):
        return None

    patch = array[outer_top:outer_bottom, outer_left:outer_right].astype(float)
    mask = np.ones(patch.shape[:2], dtype=bool)
    # 把 bbox 内部（含边界）剔除，仅保留环带
    inner_left = max(0, int(np.floor(left)) - outer_left)
    inner_top = max(0, int(np.floor(top)) - outer_top)
    inner_right = min(patch.shape[1], int(np.ceil(right)) - outer_left)
    inner_bottom = min(patch.shape[0], int(np.ceil(bottom)) - outer_top)
    if inner_right > inner_left and inner_bottom > inner_top:
        mask[inner_top:inner_bottom, inner_left:inner_right] = False

    pixels = patch[mask]
    if pixels.size == 0:
        return None

    channels = pixels.reshape(-1, 3)
    variance = float(np.max(np.var(channels, axis=0)))
    mean = tuple(float(value) for value in channels.mean(axis=0))
    delta = max(abs(mean[index] - float(background[index])) for index in range(3))
    median = np.median(channels, axis=0)
    fill = tuple(int(round(float(value))) for value in median)  # type: ignore[misc]
    return RingStats(
        variance=variance,
        mean=mean,  # type: ignore[arg-type]
        background_delta=delta,
        pixel_count=int(channels.shape[0]),
        fill=fill,  # type: ignore[arg-type]
    )


def bbox_to_pixels(
    bbox: Mapping[str, float],
    image_size: tuple[int, int],
    page_size_in: tuple[float, float],
) -> tuple[float, float, float, float]:
    """把英寸 bbox 换算成页图像素坐标 ``(left, top, right, bottom)``。"""

    width, height = image_size
    page_width, page_height = page_size_in
    scale_x = width / page_width
    scale_y = height / page_height
    left = float(bbox.get("x", 0.0)) * scale_x
    top = float(bbox.get("y", 0.0)) * scale_y
    right = left + float(bbox.get("w", 0.0)) * scale_x
    bottom = top + float(bbox.get("h", 0.0)) * scale_y
    return left, top, right, bottom


def erase_regions(
    page_image: str | Path,
    output_path: str | Path,
    regions: Sequence[Mapping[str, Any]],
    *,
    page: int | None = None,
    page_size_in: tuple[float, float] = (DEFAULT_PAGE_WIDTH_IN, DEFAULT_PAGE_HEIGHT_IN),
    ring_px: int = DEFAULT_RING_PX,
    variance_threshold: float = DEFAULT_VARIANCE_THRESHOLD,
    background_tolerance: float = DEFAULT_BACKGROUND_TOLERANCE,  # noqa: ARG001 - 仅保留兼容/审计
    background: tuple[int, int, int] | None = None,
    fill_bleed: int = DEFAULT_FILL_BLEED,
) -> EraseReport:
    """按 region 列表擦除一页并写出 erased 图。

    :param page_image: 原页图（整页 PNG）。
    :param output_path: erased 图输出路径（``pages/s06_erased.png``）。
    :param regions: ``PageRegion`` 形状的字典序列；只处理 ``page`` 与参数一致的项。
    :param page: 目标页码；``None`` 时用第一个 region 的 ``page``。
    :raises FileNotFoundError: 原页图不存在。
    """

    source = Path(page_image)
    if not source.is_file():
        raise FileNotFoundError(f"页图不存在：{source}")

    target = Path(output_path)
    with Image.open(source) as opened:
        image = opened.convert("RGB")
    array = np.asarray(image).astype(np.uint8)
    resolved_background = background or sample_background(image)

    page_no = page
    if page_no is None:
        page_no = int(regions[0].get("page", 0)) if regions else 0

    report = EraseReport(
        page=int(page_no),
        output=None,
        background=tuple(resolved_background),  # type: ignore[arg-type]
        width=image.width,
        height=image.height,
    )

    # 先在**原始图像**上完成全部校验，避免先擦一个把后一个的环带也改了。
    decisions: list[tuple[str, RingStats, tuple[int, int, int, int]]] = []
    for region in regions:
        region_id = str(region.get("region_id") or "")
        if not region_id:
            logger.warning("跳过没有 region_id 的区域")
            continue
        try:
            region_page = int(region.get("page", page_no))
        except (TypeError, ValueError):
            region_page = int(page_no)
        if region_page != int(page_no):
            continue

        bbox = region.get("bbox") or {}
        box = bbox_to_pixels(bbox, (image.width, image.height), page_size_in)
        if box[2] - box[0] <= 0 or box[3] - box[1] <= 0:
            report.skipped.append(SkippedRegion(region_id, "bbox 宽高必须为正"))
            continue

        stats = ring_stats(
            array,
            box,
            background=tuple(resolved_background),  # type: ignore[arg-type]
            ring_px=ring_px,
        )
        if stats is None:
            report.skipped.append(SkippedRegion(region_id, "bbox 超出页面范围或环带为空"))
            continue
        report.checks[region_id] = stats
        if stats.variance >= variance_threshold:
            report.skipped.append(
                SkippedRegion(region_id, "环带像素方差超阈值，区域不可分离（static_only）", stats)
            )
            continue

        left = max(0, int(np.floor(box[0])) - fill_bleed)
        top = max(0, int(np.floor(box[1])) - fill_bleed)
        right = min(image.width, int(np.ceil(box[2])) + fill_bleed)
        bottom = min(image.height, int(np.ceil(box[3])) + fill_bleed)
        if right - left <= 0 or bottom - top <= 0:
            report.skipped.append(SkippedRegion(region_id, "填充区域与页面无交集", stats))
            continue
        decisions.append((region_id, stats, (left, top, right, bottom)))

    # 再统一填充：色值来自该区域自己的环带中位色（不是页背景）。
    working = array.copy()
    for region_id, stats, (left, top, right, bottom) in decisions:
        working[top:bottom, left:right] = np.asarray(stats.fill, dtype=np.uint8)
        report.applied.append(region_id)
        report.fills[region_id] = list(stats.fill)

    if not report.applied:
        logger.warning("第 %s 页没有任何区域通过环带校验，未生成 erased 图", page_no)
        return report

    target.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(working, mode="RGB").save(target, format="PNG", optimize=True)
    report.output = target
    logger.info(
        "第 %s 页擦除完成：%d 个区域，跳过 %d 个 → %s",
        page_no,
        len(report.applied),
        len(report.skipped),
        target.name,
    )
    return report


__all__ = [
    "DEFAULT_BACKGROUND",
    "DEFAULT_BACKGROUND_TOLERANCE",
    "DEFAULT_FILL_BLEED",
    "DEFAULT_PAGE_HEIGHT_IN",
    "DEFAULT_PAGE_WIDTH_IN",
    "DEFAULT_RING_PX",
    "DEFAULT_VARIANCE_THRESHOLD",
    "EraseReport",
    "RingStats",
    "SkippedRegion",
    "bbox_to_pixels",
    "erase_regions",
    "ring_stats",
    "sample_background",
]
"""擦除底图生成的单元测试（spec §3.3）。

覆盖：环带纯色才擦、环带不纯 → static_only 且原图不动、S18 卡片色取样、
越界 bbox、多区域校验互不干扰、四角背景取样。
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.render.erase import (
    DEFAULT_VARIANCE_THRESHOLD,
    erase_regions,
    ring_stats,
    sample_background,
)

# 用 100 px/英寸 的合成页图，便于把英寸 bbox 心算成像素。
PAGE_WIDTH_PX = 1333
PAGE_HEIGHT_PX = 750
PAGE_SIZE_IN = (13.3333, 7.5)
PAGE_BACKGROUND = (246, 243, 236)
CARD_BACKGROUND = (234, 233, 227)


def _make_page(path: Path, background: tuple[int, int, int]) -> Path:
    """整页纯背景 + 左上角一块"交互图"（1in,1in 起，2in x 2in）。"""

    array = np.full((PAGE_HEIGHT_PX, PAGE_WIDTH_PX, 3), background, dtype=np.uint8)
    array[100:300, 100:300] = (20, 40, 80)  # 深色图形，位于 bbox (1,1,2,2) 内
    Image.fromarray(array, mode="RGB").save(path)
    return path


def _box(x: float, y: float, w: float, h: float) -> dict[str, float]:
    return {"x": x, "y": y, "w": w, "h": h}


def test_pure_ring_is_erased_with_its_own_color(tmp_path: Path) -> None:
    """环带纯背景 → 允许擦除，且填充色等于环带色（不是硬编码白色）。"""

    page = _make_page(tmp_path / "page.png", PAGE_BACKGROUND)
    output = tmp_path / "page_erased.png"

    report = erase_regions(
        page,
        output,
        [{"region_id": "rgn_a", "page": 1, "bbox": _box(1, 1, 2, 2)}],
        page=1,
        page_size_in=PAGE_SIZE_IN,
    )

    assert report.ok is True
    assert report.applied == ["rgn_a"]
    assert report.skipped == []
    assert report.fills["rgn_a"] == list(PAGE_BACKGROUND)
    assert report.checks["rgn_a"].variance == pytest.approx(0.0)

    erased = np.asarray(Image.open(output).convert("RGB"))
    assert set(map(tuple, erased[100:300, 100:300].reshape(-1, 3).tolist())) == {
        PAGE_BACKGROUND
    }


def test_card_background_uses_ring_color_not_page_background(tmp_path: Path) -> None:
    """S18 场景：图块落在更暗的浅色卡片里，必须取卡片色，否则留下亮块接缝。"""

    page = _make_page(tmp_path / "card.png", CARD_BACKGROUND)
    output = tmp_path / "card_erased.png"

    report = erase_regions(
        page,
        output,
        [{"region_id": "rgn_card", "page": 18, "bbox": _box(1, 1, 2, 2)}],
        page=18,
        page_size_in=PAGE_SIZE_IN,
    )

    assert report.applied == ["rgn_card"]
    assert report.fills["rgn_card"] == list(CARD_BACKGROUND)
    assert report.fills["rgn_card"] != list(PAGE_BACKGROUND)

    erased = np.asarray(Image.open(output).convert("RGB"))
    assert set(map(tuple, erased[100:300, 100:300].reshape(-1, 3).tolist())) == {
        CARD_BACKGROUND
    }


def test_impure_ring_is_rejected_and_left_untouched(tmp_path: Path) -> None:
    """环带里混入线条 → 判不可分离，区域保持原样（禁止硬盖）。"""

    page = _make_page(tmp_path / "impure.png", PAGE_BACKGROUND)
    array = np.asarray(Image.open(page).convert("RGB")).copy()
    # 在 bbox 右边界外 1px（环带内）画一条黑线 → 方差远超阈值
    array[100:300, 301] = (0, 0, 0)
    Image.fromarray(array, mode="RGB").save(page)

    output = tmp_path / "impure_erased.png"
    report = erase_regions(
        page,
        output,
        [{"region_id": "rgn_busy", "page": 6, "bbox": _box(1, 1, 2, 2)}],
        page=6,
        page_size_in=PAGE_SIZE_IN,
    )

    assert report.ok is False
    assert report.applied == []
    assert [item.region_id for item in report.skipped] == ["rgn_busy"]
    assert report.skipped[0].stats is not None
    assert report.skipped[0].stats.variance > DEFAULT_VARIANCE_THRESHOLD
    # 全部被拒时不产生 erased 文件，前端自然回退原页图
    assert not output.exists()


def test_out_of_page_bbox_is_rejected(tmp_path: Path) -> None:
    """bbox 越界 → static_only（不抛异常）。"""

    page = _make_page(tmp_path / "out.png", PAGE_BACKGROUND)
    report = erase_regions(
        page,
        tmp_path / "out_erased.png",
        [{"region_id": "rgn_out", "page": 9, "bbox": _box(12.0, 7.0, 2.0, 2.0)}],
        page=9,
        page_size_in=PAGE_SIZE_IN,
    )

    assert report.applied == []
    assert [item.region_id for item in report.skipped] == ["rgn_out"]
    assert "超出" in report.skipped[0].reason


def test_multiple_regions_checked_against_original_image(tmp_path: Path) -> None:
    """多区域校验基于原图：擦掉第一个不改变第二个的环带判定。"""

    page = _make_page(tmp_path / "multi.png", PAGE_BACKGROUND)
    array = np.asarray(Image.open(page).convert("RGB")).copy()
    array[100:300, 400:600] = (200, 90, 60)  # 第二个交互图，bbox (4,1,2,2)
    Image.fromarray(array, mode="RGB").save(page)

    output = tmp_path / "multi_erased.png"
    report = erase_regions(
        page,
        output,
        [
            {"region_id": "rgn_first", "page": 14, "bbox": _box(1, 1, 2, 2)},
            {"region_id": "rgn_second", "page": 14, "bbox": _box(4, 1, 2, 2)},
        ],
        page=14,
        page_size_in=PAGE_SIZE_IN,
    )

    assert report.applied == ["rgn_first", "rgn_second"]
    assert set(report.checks) == {"rgn_first", "rgn_second"}
    assert report.checks["rgn_first"].variance == pytest.approx(0.0)
    assert report.checks["rgn_second"].variance == pytest.approx(0.0)


def test_ring_stats_and_background_sample(tmp_path: Path) -> None:
    """环带统计与四角背景取样。"""

    page = _make_page(tmp_path / "stats.png", PAGE_BACKGROUND)
    array = np.asarray(Image.open(page).convert("RGB"))

    stats = ring_stats(
        array,
        (100.0, 100.0, 300.0, 300.0),
        background=PAGE_BACKGROUND,
        ring_px=2,
    )
    assert stats is not None
    assert stats.variance == pytest.approx(0.0)
    assert stats.fill == PAGE_BACKGROUND
    assert stats.color_matches_page is True

    with Image.open(page) as opened:
        assert sample_background(opened) == PAGE_BACKGROUND
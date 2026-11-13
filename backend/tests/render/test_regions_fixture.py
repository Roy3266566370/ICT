"""课程件 ``regions.json`` 与页图产物的契约测试（spec §4）。

只在产物存在时校验（CI 未跑渲染脚本时自动 skip），保证：
字段名与 ``frontend/src/regions/types.ts`` 对齐、5 个 region、白名单 script_id、
统一坐标系、S6/S18 的原始参数与 linked_texts、擦除底图真实存在。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
REGIONS_PATH = REPO_ROOT / "fixtures" / "materials" / "matrix-courseware" / "regions.json"
PAGES_DIR = REPO_ROOT / "fixtures" / "pages"
MATERIAL_ID = "mat_matrix_courseware"

SCRIPT_WHITELIST = {
    "matrix_eigen_2d",
    "matrix_columns_2d",
    "matrix_order_2d",
    "svd_steps_2d",
    "det_area_2d",
}
REQUIRED_KEYS = {
    "region_id",
    "material_id",
    "page",
    "bbox",
    "coordinate_system",
    "script_id",
    "status",
    "original_params",
    "linked_texts",
    "assets",
    "notes",
}
COORDINATE_SYSTEM = {
    "view_box": [1920, 1350],
    "origin": [640, 770],
    "unit": 150,
    "y_axis": "up",
}


@pytest.fixture(scope="module")
def regions() -> list[dict[str, Any]]:
    if not REGIONS_PATH.is_file():
        pytest.skip("regions.json 尚未生成（先跑 backend/scripts/render_courseware.py）")
    payload = json.loads(REGIONS_PATH.read_text(encoding="utf-8"))
    assert isinstance(payload, list)
    return payload


def test_five_regions_with_contract_fields(regions: list[dict[str, Any]]) -> None:
    assert len(regions) == 5
    for region in regions:
        assert REQUIRED_KEYS <= set(region), region["region_id"]
        assert region["material_id"] == MATERIAL_ID
        assert isinstance(region["page"], int) and 1 <= region["page"] <= 24
        assert region["script_id"] in SCRIPT_WHITELIST
        assert region["status"] in {"pending", "confirmed", "static_only", "unsupported"}
        bbox = region["bbox"]
        assert set(bbox) == {"x", "y", "w", "h"}
        assert bbox["w"] > 0 and bbox["h"] > 0
        # 页面 13.333x7.5，bbox 必须完整落在页内
        assert bbox["x"] >= 0 and bbox["y"] >= 0
        assert bbox["x"] + bbox["w"] <= 13.334
        assert bbox["y"] + bbox["h"] <= 7.501


def test_coordinate_system_is_unified(regions: list[dict[str, Any]]) -> None:
    for region in regions:
        assert region["coordinate_system"] == COORDINATE_SYSTEM


def test_pages_and_scripts_cover_five_slides(regions: list[dict[str, Any]]) -> None:
    mapping = {region["page"]: region["script_id"] for region in regions}
    assert mapping == {
        6: "matrix_eigen_2d",
        9: "matrix_columns_2d",
        10: "matrix_order_2d",
        14: "svd_steps_2d",
        18: "det_area_2d",
    }


def test_s06_original_params_and_linked_texts(regions: list[dict[str, Any]]) -> None:
    region = next(item for item in regions if item["page"] == 6)
    assert region["original_params"] == {
        "a11": 2,
        "a12": 1,
        "a21": 1,
        "a22": 2,
        "vectors": [[1, 0], [1, 1], [1, -1]],
    }
    links = region["linked_texts"]
    assert len(links) == 3
    assert [item["element_id"] for item in links] == ["p06_s09", "p06_s12", "p06_s14"]
    for item in links:
        assert set(item["bbox"]) == {"x", "y", "w", "h"}
        assert item["template"] == "({x0}, {y0}) → ({x1}, {y1})"
        assert item["kind"] in {"result", "hint"}


def test_s18_has_four_semantic_cells(regions: list[dict[str, Any]]) -> None:
    region = next(item for item in regions if item["page"] == 18)
    cells = region["original_params"]["cells"]
    assert len(cells) == 4
    assert [cell["op"] for cell in cells] == ["identity", "stretch", "shear", "flip"]
    determinants = [cell["determinant"] for cell in cells]
    assert determinants == [1, 6, 1, 0]
    # 四格逐格擦除，契约 bbox 取包络
    assert len(region["erase_bboxes"]) == 4
    assert len(region["erase_check"]) == 4


def test_erase_check_reports_ring_variance(regions: list[dict[str, Any]]) -> None:
    for region in regions:
        checks = region["erase_check"]
        assert checks, region["region_id"]
        for check in checks:
            assert check["status"] in {"erased", "static_only"}

            assert "ring_variance" in check
            if check["status"] == "erased":
                assert check["ring_variance"] is not None
                assert check["ring_variance"] < 6.0
                assert check["fill_rgb"] is not None


def test_s18_fill_uses_card_color_not_page_background(
    regions: list[dict[str, Any]],
) -> None:
    """S18 四格在浅色卡片内：填充色必须是环带取样的卡片色，不能是页背景。"""

    region = next(item for item in regions if item["page"] == 18)
    fills = {tuple(check["fill_rgb"]) for check in region["erase_check"]}
    assert fills == {(234, 233, 227)}
    assert (246, 243, 236) not in fills


def test_images_referenced_by_regions_exist(regions: list[dict[str, Any]]) -> None:
    for region in regions:
        for key in ("page_image", "erased_image"):
            name = Path(region["assets"][key]).name
            assert (PAGES_DIR / name).is_file(), f"{region['region_id']} 缺少 {key}: {name}"


def test_whole_deck_pages_are_full_size(regions: list[dict[str, Any]]) -> None:
    """24 页整页图必须存在且为 1920x1080（S6 等 5 页由 region 引用）。"""

    from PIL import Image

    for page_no in range(1, 25):
        path = PAGES_DIR / f"s{page_no:02d}.png"
        assert path.is_file(), f"缺少第 {page_no} 页页图"
        with Image.open(path) as image:
            assert image.size == (1920, 1080)
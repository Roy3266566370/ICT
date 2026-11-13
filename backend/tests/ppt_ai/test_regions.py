"""T03：区域提取、覆盖表与按内容哈希的缓存。"""

from __future__ import annotations

from app.ppt_ai.regions import extract_regions, load_region_cache, save_region_cache
from tests.ppt_ai import helpers


def test_native_chart_formula_and_decorative_image() -> None:
    snap = helpers.snapshot(
        "mat_regions",
        pages=[
            {
                "page_no": 1,
                "width": helpers.PAGE_W,
                "height": helpers.PAGE_H,
                "elements": [
                    helpers.element(
                        "chart",
                        "chart",
                        bbox=(300000, 300000, 5000000, 3000000),
                        chart_data={
                            "categories": ["A", "B"],
                            "series": [{"name": "s", "values": [1, 2]}],
                            "title": "图表",
                        },
                    ),
                    helpers.element(
                        "pic_formula",
                        "picture",
                        text="∫_0^1 1/(x+1) dx",
                        bbox=(6000000, 300000, 3000000, 1200000),
                    ),
                    helpers.element("background", "picture", bbox=(0, 0, helpers.PAGE_W, helpers.PAGE_H)),
                    helpers.element("icon", "picture", bbox=(100, 100, 10000, 10000)),
                ],
            }
        ],
    )
    result = extract_regions(snap)
    categories = {region.category for region in result.regions}
    assert "chart" in categories
    assert "formula" in categories
    assert all(region.extraction_state != "skipped" for region in result.regions)
    coverage = result.coverage[0]
    assert "chart" in coverage.native
    assert "pic_formula" in coverage.ocr
    assert "background" in coverage.skipped
    assert "icon" in coverage.skipped


def test_visual_image_requires_review_not_fake_interaction() -> None:
    snap = helpers.snapshot(
        "mat_visual",
        pages=[
            {
                "page_no": 1,
                "width": helpers.PAGE_W,
                "height": helpers.PAGE_H,
                "elements": [
                    helpers.element("photo", "picture", bbox=(1000000, 1000000, 3000000, 2500000)),
                ],
            }
        ],
    )
    result = extract_regions(snap)
    assert result.regions[0].extraction_state == "visual"
    assert result.regions[0].provenance.origin_type == "model_inference"
    assert any(issue.code == "requires_visual_understanding" for issue in result.regions[0].issues)
    assert "photo" in result.coverage[0].visual


def test_layout_move_keeps_semantic_hash_but_updates_bbox() -> None:
    element = helpers.element("e1", "text", text="∫_0^1 x^2 dx", bbox=(100000, 100000, 3000000, 1000000))
    base = helpers.snapshot(
        "mat_layout",
        pages=[{"page_no": 1, "width": helpers.PAGE_W, "height": helpers.PAGE_H, "elements": [element]}],
    )
    first = extract_regions(base)
    scene = {
        "revision": 1,
        "pages": [
            {
                "page_no": 1,
                "width": 960,
                "height": 540,
                "nodes": [
                    {
                        "id": "n1",
                        "source_element_id": "e1",
                        "type": "text",
                        "x": 300,
                        "y": 200,
                        "width": 400,
                        "height": 120,
                        "text": "∫_0^1 x^2 dx",
                    }
                ],
            }
        ],
    }
    moved = helpers.snapshot(
        "mat_layout",
        revision=1,
        scene_document=scene,
        pages=base.pages,
    )
    second = extract_regions(moved)
    assert first.regions[0].semantic_content_hash == second.regions[0].semantic_content_hash
    assert (first.regions[0].bbox.x, first.regions[0].bbox.y) != (second.regions[0].bbox.x, second.regions[0].bbox.y)
    assert second.regions[0].node_ids == ["n1"]


def test_cache_is_granular_and_reused(tmp_path, monkeypatch) -> None:
    snap = helpers.snapshot(
        "mat_cache",
        pages=[
            {
                "page_no": 1,
                "width": helpers.PAGE_W,
                "height": helpers.PAGE_H,
                "elements": [
                    helpers.element("a", "text", text="∫_0^1 x dx"),
                    helpers.element("b", "text", text="A = [[1,0],[0,1]]", bbox=(6000000, 100000, 3000000, 1000000)),
                ],
            }
        ],
    )
    cache: dict = {}
    extract_regions(snap, cache_out=cache)
    assert len(cache) == 2
    second_cache: dict = {}
    extract_regions(snap, cache=cache, cache_out=second_cache)
    assert set(second_cache) == set(cache)
    # 只改一个区域：另一个 cache key 保持不变
    changed_pages = [dict(snap.pages[0])]
    changed_pages[0]["elements"] = [dict(snap.pages[0]["elements"][0]), {**snap.pages[0]["elements"][1], "text": "A = [[2,0],[0,1]]"}]
    changed = helpers.snapshot("mat_cache", pages=changed_pages)
    third: dict = {}
    extract_regions(changed, cache=cache, cache_out=third)
    old_a = next(key for key in cache if key.startswith("1:a:"))
    assert old_a in third
    assert set(cache) - set(third)  # 至少一个区域因内容变化失效

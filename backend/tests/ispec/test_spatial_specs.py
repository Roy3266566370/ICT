"""文本启发式空间交互测试：SVD 页用圆→椭圆，轴向倍率页用网格变换。"""

from __future__ import annotations

from app.ispec.user_config import _spatial_specs, apply_user_interactions
from app.ispec.validator import validate_ispec


def _page(text: str, title: str = "02 · 奇异值分解") -> dict:
    return {
        "page_no": 14,
        "width": 960,
        "height": 540,
        "elements": [
            {
                "element_id": "p14_s02",
                "kind": "text",
                "bbox": {"x": 54, "y": 42, "w": 400, "h": 30},
                "text": title,
            },
            {
                "element_id": "p14_s09",
                "kind": "text",
                "bbox": {"x": 300, "y": 120, "w": 200, "h": 40},
                "text": text,
            },
            {
                "element_id": "p14_s08",
                "kind": "picture",
                "bbox": {"x": 300, "y": 200, "w": 260, "h": 180},
                "text": "",
            },
        ],
    }


def test_svd_page_uses_circle_ellipse_and_keeps_declared_sigmas():
    specs = _spatial_specs(_page("两个奇异值 1.618 与 0.618，圆在这里变成椭圆。SVD A = UΣVᵀ"))

    assert len(specs) == 1
    spec = specs[0]
    assert spec["object_id"] == "inferred_scale_p14_s09"
    assert spec["title"] == "圆变成椭圆：奇异值伸缩"
    assert spec["views"][0]["spec_ref"] == "circle_ellipse"
    assert [p["default"] for p in spec["parameters"]] == [1.618, 0.0, 0.0, 0.618]
    assert all(p["source"]["status"] == "inferred" for p in spec["parameters"])
    assert validate_ispec(spec) == []


def test_multi_panel_svd_anchor_covers_whole_diagram():
    page = _page("两个奇异值 1.618 与 0.618，圆在这里变成椭圆。SVD A = UΣVᵀ")
    page["elements"] = [
        page["elements"][0],
        page["elements"][1],
        {"element_id": "p14_left", "kind": "picture", "bbox": {"x": 60, "y": 200, "w": 260, "h": 180}, "text": ""},
        {"element_id": "p14_mid", "kind": "picture", "bbox": {"x": 340, "y": 200, "w": 260, "h": 180}, "text": ""},
        {"element_id": "p14_right", "kind": "picture", "bbox": {"x": 620, "y": 200, "w": 260, "h": 180}, "text": ""},
    ]

    specs = _spatial_specs(page)

    assert len(specs) == 1
    bbox = specs[0]["anchor"]["bbox"]
    # 三联图太扁时扩成接近 16:9 的可读区域，且不覆盖页面标题区（前 15%）。
    assert bbox["w"] / bbox["h"] <= 2.0
    assert bbox["y"] >= page["height"] * 0.15
    assert bbox["x"] <= 340 and bbox["x"] + bbox["w"] >= 600


def test_axis_scale_page_keeps_grid_transform():
    specs = _spatial_specs(_page("横向 2 倍、纵向 3 倍　面积 6", title="03 · 行列式"))

    assert len(specs) == 1
    spec = specs[0]
    assert spec["object_id"] == "inferred_scale_p14_s09"
    assert spec["title"] == "轴向伸缩与面积"
    assert spec["views"][0]["spec_ref"] == "grid_transform"
    assert [p["default"] for p in spec["parameters"][:4]] == [2.0, 0.0, 0.0, 3.0]
    assert validate_ispec(spec) == []


def test_upload_does_not_generate_picture_rotation_and_stretch_defaults():
    page = _page('图示说明', title='示意图')
    page['elements'][-1]['text'] = '旋转 30° 后横向拉伸 2 倍'
    assert [spec['object_id'] for spec in _spatial_specs(page)] == ['image_steps_p14_s08']
    assert apply_user_interactions([], {'pages': [page]}, {}) == []

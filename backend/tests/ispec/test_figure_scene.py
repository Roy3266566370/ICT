"""读图重建场景：合成图 → 识别 → 校验 → 绑定 → 降级。"""
import io

import numpy as np
import pytest
from PIL import Image, ImageDraw

from app.ispec.figure_scene import attach_figure_scenes, recognize_slide_scenes
from app.ispec.validator import validate_ispec

AX = (121, 136, 163)
INK = (196, 98, 45)


def _figure_png(matrix, unit=150, size=(852, 570), origin=(185, 495)):
    """画一张"坐标轴 + M·单位正方形"的位图，风格贴近课件第18页。"""
    a, b = matrix[0]
    c, d = matrix[1]
    img = Image.new("RGBA", size, (255, 255, 255, 255))
    draw = ImageDraw.Draw(img)
    ox, oy = origin
    draw.line([(ox - 65, oy), (ox + 564, oy)], fill=AX + (96,), width=4)
    draw.line([(ox, oy + 50), (ox, oy - 465)], fill=AX + (96,), width=4)
    pts = [(ox + unit * (a * x + b * y), oy - unit * (c * x + d * y))
           for x, y in ((0, 0), (1, 0), (1, 1), (0, 1))]
    if abs(a * d - b * c) < 1e-9:
        draw.line([pts[0], pts[1]], fill=INK + (255,), width=8)
    else:
        draw.polygon(pts, fill=(196, 98, 49, 26))
        draw.line(pts + [pts[0]], fill=INK + (255,), width=8, joint="curve")
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _pic(element_id, matrix, caption_text):
    return {
        "element_id": element_id,
        "bbox": {"x": 0, "y": 0, "w": 100, "h": 100},
        "blob": _figure_png(matrix),
        "caption": {"element_id": element_id + "_cap",
                    "bbox_emu": {"x": 0, "y": 0, "w": 100, "h": 10},
                    "text": caption_text, "runs": [], "align": None},
    }


NO_OCR = lambda blob: {"rows": []}


def test_recognize_scale_figure_with_shared_calibration():
    scenes = recognize_slide_scenes(18, [
        _pic("fig_ref", [[1, 0], [0, 1]], "单位方格　面积 1"),
        _pic("fig_scale", [[2, 0], [0, 3]], "横向 2 倍、纵向 3 倍　面积 6"),
    ], ocr_lookup=NO_OCR)
    assert set(scenes) == {"fig_ref", "fig_scale"}
    scene = scenes["fig_scale"]
    assert scene["baseline"] == [2.0, 0.0, 0.0, 3.0]
    assert scene["unit_px"] == pytest.approx(150, abs=1.5)
    assert scene["confidence"] == "high"
    assert all(check["pass"] for check in scene["checks"])
    assert scene["caption"]["template"] == "scale"


def test_recognize_shear_and_collapsed_figures():
    scenes = recognize_slide_scenes(18, [
        _pic("fig_ref", [[1, 0], [0, 1]], "单位方格　面积 1"),
        _pic("fig_shear", [[1, 1], [0, 1]], "剪切　面积仍是 1"),
    ], ocr_lookup=NO_OCR)
    assert scenes["fig_shear"]["baseline"] == [1.0, 1.0, 0.0, 1.0]


def test_unrecognizable_image_produces_nothing():
    rng = np.random.default_rng(0)
    noise = Image.fromarray(rng.integers(0, 255, (300, 200, 3), dtype=np.uint8))
    buf = io.BytesIO()
    noise.save(buf, "PNG")
    scenes = recognize_slide_scenes(3, [
        {"element_id": "p3_s01", "bbox": {"x": 0, "y": 0, "w": 1, "h": 1}, "blob": buf.getvalue()},
    ], ocr_lookup=NO_OCR)
    assert scenes == {}


def test_contradicting_caption_rejects_scene():
    """文字说面积 5 但图上是 2×3=6：确定性校验不过，不出结论。"""
    scenes = recognize_slide_scenes(18, [
        _pic("fig_ref", [[1, 0], [0, 1]], "单位方格　面积 1"),
        _pic("fig_bad", [[2, 0], [0, 3]], "横向 2 倍、纵向 3 倍　面积 5"),
    ], ocr_lookup=NO_OCR)
    assert "fig_bad" not in scenes


def _cells_spec():
    params = []
    for i, label in enumerate(("单位方格", "横向 2 倍、纵向 3 倍　面积 6")):
        for r in (0, 1):
            for c in (0, 1):
                params.append({
                    "id": f"cells_{i}_matrix_{r}_{c}", "label": f"格 {i+1}",
                    "type": "number", "min": -10, "max": 10, "default": 1.0,
                    "source": {"page": 18, "element_id": "p18_s01",
                               "bbox": {"x": 0, "y": 0, "w": 1, "h": 1},
                               "status": "inferred", "excerpt": "格"},
                })
        params.append({"id": f"cells_{i}_label", "label": "标题", "default": label,
                       "source": {"page": 18, "element_id": "p18_s01",
                                  "bbox": {"x": 0, "y": 0, "w": 1, "h": 1},
                                  "status": "inferred", "excerpt": "格"}})
    return {
        "spec_version": "1.0", "object_id": "concept_18_det_area", "kind": "geometric",
        "title": "四格", "parameters": params,
        "anchor": {"page": 18, "element_id": "p18_s04",
                   "bbox": {"x": 0, "y": 0, "w": 10, "h": 10}},
        "views": [{"type": "figure", "spec_ref": "det_area"}],
    }


def test_attach_binds_cells_and_syncs_baseline():
    scenes = recognize_slide_scenes(18, [
        _pic("fig_ref", [[1, 0], [0, 1]], "单位方格　面积 1"),
        _pic("fig_scale", [[2, 0], [0, 3]], "横向 2 倍、纵向 3 倍　面积 6"),
    ], ocr_lookup=NO_OCR)
    spec = _cells_spec()
    attached = attach_figure_scenes([spec], scenes, lambda src: src)
    assert attached == 2
    mounted = spec["scene"]["figure_scenes"]
    assert {s["element_id"] for s in mounted} == {"fig_ref", "fig_scale"}
    bind = next(s["bind"] for s in mounted if s["element_id"] == "fig_scale")
    params = {p["id"]: p for p in spec["parameters"]}
    assert params[bind["a"]]["source_default"] == 2.0
    assert params[bind["d"]]["source_default"] == 3.0
    assert params[bind["a"]]["default"] == 2.0
    assert not validate_ispec(spec)


def test_attach_preserves_saved_user_value():
    """source_default 已存在（用户保存过值）时，只更新基准，不覆盖当前值。"""
    scenes = recognize_slide_scenes(18, [
        _pic("fig_ref", [[1, 0], [0, 1]], "单位方格　面积 1"),
    ], ocr_lookup=NO_OCR)
    spec = _cells_spec()
    param = next(p for p in spec["parameters"] if p["id"] == "cells_0_matrix_0_0")
    param["default"] = 5.0          # 用户当前值
    param["source_default"] = 0.5   # 旧基准
    attach_figure_scenes([spec], scenes, lambda src: src)
    assert param["default"] == 5.0
    assert param["source_default"] == 1.0


def test_attach_skips_spec_without_matching_params():
    scenes = recognize_slide_scenes(18, [
        _pic("fig_ref", [[1, 0], [0, 1]], "单位方格　面积 1"),
    ], ocr_lookup=NO_OCR)
    spec = {"spec_version": "1.0", "object_id": "other", "kind": "parametric",
            "parameters": [{"id": "x", "type": "number", "default": 1,
                            "source": {"page": 18, "element_id": "e",
                                       "bbox": {"x": 0, "y": 0, "w": 1, "h": 1},
                                       "status": "original", "excerpt": "x"}}],
            "anchor": {"page": 18, "element_id": "e", "bbox": {"x": 0, "y": 0, "w": 1, "h": 1}},
            "views": [{"type": "text", "template": "x={{x}}"}]}
    assert attach_figure_scenes([spec], scenes, lambda src: src) == 0
    assert "figure_scenes" not in spec.get("scene", {})

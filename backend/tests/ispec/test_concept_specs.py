"""概念型交互识别测试：不同数学结构选择不同的 figure 模板。"""

from __future__ import annotations

from app.ispec.user_config import _concept_specs, _readable_bbox
from app.ispec.validator import validate_ispec

W = 12192000
H = 6858000


def _page(texts: list[str], *, title: str = "", pictures: int = 1) -> dict:
    elements = [
        {
            "element_id": f"p_s{index:02d}",
            "kind": "text",
            "bbox": {"x": 685800, "y": 400000 + index * 300000, "w": 5000000, "h": 260000},
            "text": text,
        }
        for index, text in enumerate(texts)
    ]
    for index in range(pictures):
        elements.append(
            {
                "element_id": f"pic_{index}",
                "kind": "picture",
                "bbox": {"x": 5000000 + index * 2200000, "y": 1800000, "w": 2000000, "h": 1600000},
                "text": "",
            }
        )
    return {"page_no": 7, "width": W, "height": H, "title": title, "elements": elements}


def _one(texts: list[str], *, title: str = "", pictures: int = 1) -> dict:
    specs = _concept_specs(_page(texts, title=title, pictures=pictures))
    assert len(specs) == 1, specs
    spec = specs[0]
    assert validate_ispec(spec) == []
    return spec


def test_eigen_definition_page_gets_probe():
    spec = _one(
        ["01 · 特征向量", "定义：输出正好是原向量的某个倍数", "一句话：A v = λ v。", "旋转 90°：一条都没有", "剪切：只有一条"],
        title="定义：输出正好是原向量的某个倍数",
    )
    assert spec["views"][0]["spec_ref"] == "eigen_probe"
    assert [p["id"] for p in spec["parameters"]] == ["a", "b", "c", "d", "vx", "vy"]
    assert spec["parameters"][0]["default"] == 1.0


def test_eigen_decomposition_page_is_not_definition_probe():
    assert _concept_specs(_page(["02 · 特征分解", "以特征向量为基", "旋转 90° 一条都没有，剪切只有一条"])) == []


def test_basis_page_derives_slanted_basis_from_coordinates():
    spec = _one(
        ["A　正交基", "坐标 = (2.0, 1.0)", "B　斜基", "坐标 = (1.0, 1.25)", "向量本身不动，换基改的只是组合倍数。"],
        title="两个向量",
        pictures=2,
    )
    assert spec["views"][0]["spec_ref"] == "basis_change"
    values = {p["id"]: p["default"] for p in spec["parameters"]}
    assert values["point_x"] == 2.0 and values["point_y"] == 1.0
    assert values["b2x"] == 0.8 and values["b2y"] == 0.8


def test_singular_compare_reads_two_declared_pairs():
    spec = _one(
        ["02 · 特征值 vs 奇异值", "奇异值", "1.618 / 0.618", "100 / 0.01", "特征值 1, 1"],
        title="看着什么都没发生，可圆早被拉扁了",
    )
    assert spec["views"][0]["spec_ref"] == "singular_compare"
    values = {p["id"]: p["default"] for p in spec["parameters"]}
    assert values == {"s1a": 1.618, "s2a": 0.618, "s1b": 100.0, "s2b": 0.01}


def test_condition_page_uses_condition_defaults():
    spec = _one(
        ["04 · 条件数", "纵向压到 1% 后，恢复所需的放大倍数", "所有方向一起缩 100 倍：圆还是圆，条件数 = 1。"],
        title="压到 1%，就要放大 100 倍",
    )
    assert spec["views"][0]["spec_ref"] == "singular_compare"
    values = {p["id"]: p["default"] for p in spec["parameters"]}
    assert values == {"s1a": 1.0, "s2a": 0.01, "s1b": 100.0, "s2b": 100.0}


def test_rank_page_uses_declared_dimensions():
    spec = _one(
        ["03 · 维度与秩", "列数 = 输入维度，行数 = 输出维度", "秩 = 输出实际张成的维度", "3×2", "2×3"],
        title="行数列数说维度",
        pictures=0,
    )
    assert spec["views"][0]["spec_ref"] == "rank_map"
    values = {p["id"]: p["default"] for p in spec["parameters"]}
    assert values == {"rows": 3, "cols": 2, "rank": 2}


def test_determinant_page_builds_four_area_cells():
    spec = _one(
        ["03 · 行列式", "单位方格　面积 1", "横向 2 倍、纵向 3 倍　面积 6", "剪切　面积仍是 1", "压到横轴　面积 0"],
        title="一块小方格怎样改变",
        pictures=4,
    )
    assert spec["views"][0]["spec_ref"] == "det_area"
    assert len(spec["parameters"]) == 20
    by_id = {p["id"]: p["default"] for p in spec["parameters"]}
    assert by_id["cells_1_matrix_0_0"] == 2.0
    assert by_id["cells_1_matrix_1_1"] == 3.0
    assert by_id["cells_2_label"] == "剪切"
    assert by_id["cells_3_matrix_1_1"] == 0.0


def test_inverse_page_builds_shear_inverse():
    spec = _one(
        ["04 · 求逆", "求逆 = 找把每个点送回原位的变换；剪切的逆：横坐标减掉纵坐标。", "投影不可逆：高度无从判定。"],
        title="能不能把每个点送回原位",
    )
    assert spec["views"][0]["spec_ref"] == "inverse_map"
    values = {p["id"]: p["default"] for p in spec["parameters"]}
    assert values["a"] == 1.0 and values["b"] == 1.0
    assert values["target_x"] == 2.0 and values["target_y"] == 1.0


def test_summary_page_is_not_condition_interaction():
    assert _concept_specs(_page(["把运算放回空间", "行列式看面积倍率与定向，奇异值看各方向伸缩，条件数看最坏的相对敏感性。"], pictures=0)) == []


def test_tall_picture_expands_away_from_left_annotations():
    bbox = {"x": 4611370, "y": 1124585, "w": 2381250, "h": 3575050}
    out = _readable_bbox(bbox, {"width": W, "height": H})
    assert out["x"] == bbox["x"]
    assert out["w"] > bbox["w"]
    assert out["y"] >= H * 0.15
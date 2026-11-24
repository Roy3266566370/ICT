"""iSpec 识别层测试：任意 PPT 的原生内容都能产出 iSpec。

覆盖三条验收：

1. 原生柱状图 → ``kind="filter"``，且 ``chart_data.series[].values`` 与写入值完全一致；
2. 原生表格 → 产出 ``table`` 视图；
3. 组合图形内的文字不被丢弃（解析结果非空）。

另加：无原生内容时返回空列表（不回退公共示例区域）、候选优先走 iSpec、
无 iSpec 时正则兜底带 ``regex_fallback`` 标记、Schema 校验丢弃坏 spec。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.ispec import build_ispecs, build_ispecs_detailed, filter_valid_ispecs, validate_ispec
from app.parsers import map_candidates, parse_pptx

CHART_CATEGORIES = ["一月", "二月", "三月"]
CHART_SERIES: dict[str, list[int]] = {"销售额": [10, 20, 30], "成本": [4, 8, 12]}
CHART_TITLE = "季度销售额"
TABLE_ROWS = [
    ["姓名", "科目", "分数"],
    ["张三", "数学", 95],
    ["李四", "物理", 88],
]
GROUP_TEXT = "组合里的文字：向量 v = (1, 2)"
MATERIAL_ID = "mat_ispec_nonmatrix"
TEMPLATE_IDS = {"matrix_2d", "force_2d", "bfs_flow", "budget_compare"}


@pytest.fixture(scope="module")
def nonmatrix_pptx(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """用 python-pptx 生成一份非矩阵 PPT：图表页 + 表格页 + 组合图形页。"""
    from pptx import Presentation
    from pptx.chart.data import ChartData
    from pptx.enum.chart import XL_CHART_TYPE
    from pptx.util import Inches

    path = tmp_path_factory.mktemp("ispec") / "nonmatrix.pptx"
    prs = Presentation()

    # 第 1 页：原生柱状图（两个系列）
    chart_slide = prs.slides.add_slide(prs.slide_layouts[6])
    chart_data = ChartData()
    chart_data.categories = CHART_CATEGORIES
    for name, values in CHART_SERIES.items():
        chart_data.add_series(name, values)
    chart_shape = chart_slide.shapes.add_chart(
        XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1), Inches(1), Inches(6), Inches(4), chart_data
    )
    chart_shape.chart.has_title = True
    chart_shape.chart.chart_title.text_frame.text = CHART_TITLE

    # 第 2 页：原生表格
    table_slide = prs.slides.add_slide(prs.slide_layouts[6])
    table = table_slide.shapes.add_table(
        len(TABLE_ROWS), len(TABLE_ROWS[0]), Inches(1), Inches(1), Inches(6), Inches(2)
    ).table
    for row_index, row in enumerate(TABLE_ROWS):
        for column_index, value in enumerate(row):
            table.cell(row_index, column_index).text = str(value)

    # 第 3 页：组合图形，文字只在组合内部
    group_slide = prs.slides.add_slide(prs.slide_layouts[6])
    group = group_slide.shapes.add_group_shape()
    textbox = group.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1))
    textbox.text_frame.text = GROUP_TEXT

    prs.save(path)
    return path


@pytest.fixture(scope="module")
def parsed(nonmatrix_pptx: Path) -> dict:
    """解析产物（slides.json 字典）。"""
    _material, slides = parse_pptx(str(nonmatrix_pptx), material_id=MATERIAL_ID)
    return slides


@pytest.fixture(scope="module")
def ispecs(parsed: dict) -> list[dict]:
    return build_ispecs(parsed, material_id=MATERIAL_ID)


def _spec_by_suffix(ispecs: list[dict], suffix: str) -> dict:
    matched = [spec for spec in ispecs if str(spec.get("object_id", "")).endswith(suffix)]
    assert len(matched) == 1, f"期望 1 条 {suffix} iSpec，实际 {len(matched)} 条"
    return matched[0]


def test_chart_page_yields_filter_ispec_with_exact_values(parsed: dict, ispecs: list[dict]) -> None:
    """图表页：kind=filter，参数为 category，chart_data 数值与写入值逐值一致。"""
    spec = _spec_by_suffix(ispecs, "chart")
    assert spec["kind"] == "filter"
    assert spec["spec_version"] == "1.0"

    parameter = spec["parameters"][0]
    assert parameter["id"] == "category"
    assert parameter["type"] == "enum"
    assert parameter["default"] == "全部"
    assert parameter["options"] == ["全部", *CHART_CATEGORIES]
    # source.page / element_id / excerpt 必须可回溯到源页
    assert parameter["source"]["page"] == 1
    assert parameter["source"]["element_id"] == "p01_s00"
    assert parameter["source"]["status"] == "original"
    assert parameter["source"]["excerpt"] == CHART_TITLE
    assert parameter["source"]["excerpt"] in {parsed["slides"][0]["title"], CHART_TITLE}

    view_types = [view["type"] for view in spec["views"]]
    assert view_types == ["vega", "table"]
    assert spec["views"][0]["spec_ref"] == "bar"

    # datasets 是运行时的数据通道：行必须与 chart_data.series[].values 逐值相等
    dataset = spec["datasets"][0]
    assert dataset["id"] == "chart_p01"
    assert dataset["columns"] == ["category", "series", "value"]
    expected_rows = [
        [category, name, value]
        for name, values in CHART_SERIES.items()
        for category, value in zip(CHART_CATEGORIES, values)
    ]
    assert dataset["rows"] == expected_rows
    for row, (category, name, value) in zip(dataset["rows"], expected_rows):
        assert row[0] == category and row[1] == name
        assert float(row[2]) == float(value)  # 容差 0
    assert spec["views"][0]["dataset"] == dataset["id"]
    assert spec["views"][1]["dataset"] == dataset["id"]
    assert dataset["source"] == {"page": 1, "element_id": "p01_s00"}

    chart_data = parsed["slides"][0]["elements"][0]["chart_data"]
    assert chart_data is not None
    assert chart_data["categories"] == CHART_CATEGORIES
    assert chart_data["title"] == CHART_TITLE
    assert chart_data["series"] == [
        {"name": name, "values": values} for name, values in CHART_SERIES.items()
    ]
    # 源图表已直读成功，不得残留 chart_data_not_parsed
    assert parsed["slides"][0]["elements"][0]["unsupported_reason"] is None


def test_table_page_yields_table_view(parsed: dict, ispecs: list[dict]) -> None:
    """表格页：kind=filter，视图为 table，列名来自表头原文。"""
    spec = _spec_by_suffix(ispecs, "table")
    assert spec["kind"] == "filter"

    table_views = [view for view in spec["views"] if view["type"] == "table"]
    assert len(table_views) == 1
    assert table_views[0]["columns"] == TABLE_ROWS[0]

    dataset = spec["datasets"][0]
    assert dataset["id"] == "table_p02"
    assert dataset["columns"] == TABLE_ROWS[0]
    assert dataset["rows"] == [[str(cell) for cell in row] for row in TABLE_ROWS[1:]]
    assert table_views[0]["dataset"] == dataset["id"]
    assert dataset["source"] == {"page": 2, "element_id": "p02_s00"}

    parameter = spec["parameters"][0]
    assert parameter["label"] == "筛选列"
    assert parameter["options"] == ["全部", *TABLE_ROWS[0]]
    assert parameter["default"] == "全部"
    assert parameter["source"]["page"] == 2
    assert parameter["source"]["excerpt"] == " | ".join(TABLE_ROWS[0])
    # excerpt 口径：解析层规范行文本（与 element.text 一致），不是单元格直接拼接。
    assert parsed["slides"][1]["elements"][0]["text"].splitlines()[0] == parameter["source"]["excerpt"]
    assert "规范行文本" in spec["notes"]

    table_data = parsed["slides"][1]["elements"][0]["table_data"]
    # 契约要求 ``table_data.rows`` 为 string[][]：单元格文本保持原文（不转数值）。
    assert table_data == {
        "headers": TABLE_ROWS[0],
        "rows": [[str(cell) for cell in row] for row in TABLE_ROWS[1:]],
    }


def test_group_text_is_not_lost(parsed: dict) -> None:
    """组合图形递归展开：子形状带 group_path，组合内文字保留在元素与段落里。"""
    group_page = parsed["slides"][2]
    group_element = group_page["elements"][0]
    assert group_element["kind"] == "group"
    assert group_element["group_path"] is None

    children = [element for element in group_page["elements"] if element["group_path"] is not None]
    assert children, "组合子形状没有被展开"
    child = children[0]
    assert child["group_path"] == [0]
    assert child["element_id"] == "p03_s00_g0"
    assert child["text"] == GROUP_TEXT
    assert GROUP_TEXT in group_page["paragraphs"]
    assert GROUP_TEXT in group_page["excerpt"]


def test_empty_material_returns_empty_list(repo_root: Path) -> None:
    """无原生图表/表格 → 空列表，绝不回退到公共示例区域，也不再自动识别纯公式文本。"""
    assert build_ispecs({}) == []
    assert build_ispecs({"material_id": "mat_x", "slides": []}) == []

    courseware = repo_root / "用空间视角理解矩阵运算.pptx"
    if not courseware.is_file():
        pytest.skip("课程件 pptx 不在仓库中")
    _material, slides = parse_pptx(str(courseware), material_id="mat_matrix_courseware")
    result = build_ispecs_detailed(slides, material_id="mat_matrix_courseware")
    assert result.ispecs == []
    assert result.recognition["found"] is False


def test_candidates_prefer_ispec_for_non_matrix(parsed: dict) -> None:
    """非矩阵材料：候选来自 iSpec（候选集不再为空），template_id 仍在契约白名单内。"""
    candidates = map_candidates(MATERIAL_ID, parsed)
    assert len(candidates) >= 2
    assert all(candidate["template_id"] in TEMPLATE_IDS for candidate in candidates)
    assert all("识别方式: ispec" in candidate["notes"] for candidate in candidates)
    assert {candidate["kind"] for candidate in candidates} == {"filter"}
    for candidate in candidates:
        assert candidate["candidate_id"]
        assert candidate["fields"]


def test_regex_fallback_is_marked_when_no_ispec() -> None:
    """没有 iSpec 时保留矩阵正则兜底，并标注 ``识别方式: regex_fallback``。"""
    slides = {
        "material_id": "mat_matrix_regex",
        "slides": [
            {
                "page_no": 1,
                "title": "矩阵",
                "paragraphs": [],
                "elements": [
                    {
                        "element_id": "p01_s00",
                        "kind": "text",
                        "text": "det A = 3，rank A = 2",
                    }
                ],
            }
        ],
    }
    candidates = map_candidates("mat_matrix_regex", slides)
    assert candidates, "矩阵正则兜底必须仍然可用"
    assert all(candidate["notes"] == "识别方式: regex_fallback" for candidate in candidates)
    assert all(candidate["template_id"] == "matrix_2d" for candidate in candidates)


def test_chart_dataset_mismatch_blocks_ispec(monkeypatch: pytest.MonkeyPatch) -> None:
    """datasets 与 chart_data 数值不一致时：不产出 iSpec，并在 errors 记录原因。"""
    from app.ispec import builder

    chart_data = {
        "chart_type": "COLUMN_CLUSTERED",
        "categories": ["A", "B"],
        "series": [{"name": "s", "values": [1, 2]}],
        "title": "t",
    }
    good_rows = [["A", "s", 1], ["B", "s", 2]]
    bad_rows = [["A", "s", 1], ["B", "s", 3]]
    assert builder._chart_rows_match_source(chart_data, good_rows)
    assert not builder._chart_rows_match_source(chart_data, bad_rows)

    slides = {
        "material_id": "mat_bad_chart",
        "slides": [
            {
                "page_no": 1,
                "title": "",
                "elements": [
                    {"element_id": "p01_s00", "kind": "chart", "chart_data": chart_data}
                ],
            }
        ],
    }
    # 强制复核失败，确认 builder 丢弃该条并记录原因（不让坏数据进入运行时）
    monkeypatch.setattr(builder, "_chart_rows_match_source", lambda *_args, **_kwargs: False)
    result = builder.build_ispecs_detailed(slides, material_id="mat_bad_chart")
    assert result.ispecs == []
    assert any("不一致" in "".join(error["errors"]) for error in result.errors)
    assert result.recognition["found"] is False


def test_native_chart_example_has_datasets_and_matches_schema(repo_root: Path) -> None:
    """契约示例必须带 datasets，且能被运行时直接渲染。"""
    import json

    example = repo_root / "contracts" / "spec" / "examples" / "native_chart_bar.json"
    payload = json.loads(example.read_text(encoding="utf-8"))
    assert validate_ispec(payload) == []
    dataset = payload["datasets"][0]
    assert dataset["id"] == payload["views"][0]["dataset"] == payload["views"][1]["dataset"]
    assert dataset["columns"] == ["category", "series", "value"]
    values = [row[2] for row in dataset["rows"]]
    assert values == [10, 20, 30, 4, 8, 12]


def test_validator_drops_invalid_spec() -> None:
    """Schema 校验失败只丢弃该条，不影响其他条目。"""
    assert validate_ispec({"spec_version": "1.0"}), "缺 required 字段必须报错"
    valid, errors = filter_valid_ispecs([{"spec_version": "1.0"}, {"foo": "bar"}])
    assert valid == []
    assert len(errors) == 2
    assert errors[0]["errors"]

def test_omml_math_node_is_flattened_to_latex() -> None:
    """OMML 节点 → 简化 LaTeX：上标与分式结构不丢。"""
    from lxml import etree

    from app.parsers.pptx_parser import _omml_node_text

    namespace = "http://schemas.openxmlformats.org/officeDocument/2006/math"
    xml = (
        f'<m:oMath xmlns:m="{namespace}">'
        "<m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e>"
        "<m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>"
        "<m:f><m:num><m:r><m:t>1</m:t></m:r></m:num>"
        "<m:den><m:r><m:t>2</m:t></m:r></m:den></m:f>"
        "</m:oMath>"
    )
    assert _omml_node_text(etree.fromstring(xml)) == "x^{2}\\frac{1}{2}"


def test_formula_ispec_is_parametric_and_marks_inferred() -> None:
    """OMML 公式 → kind=parametric：变量取字母，无赋值时标记 inferred 并在 notes 说明。"""
    from app.ispec.builder import _formula_ispec, _formula_variables, _variable_value

    text = "A = [[2,1],[1,2]]，λ = 3"
    assert [item[1] for item in _formula_variables(text)] == ["A", "lambda"]
    assert _variable_value(text, "λ") == 3
    assert _variable_value(text, "A") is None  # 矩阵字面量不是标量赋值，不猜测

    spec = _formula_ispec(
        element={"element_id": "p05_s01", "kind": "text", "math_text": text},
        page=5,
        material_id="mat_formula",
        page_title="",
    )
    assert spec is not None
    assert spec["kind"] == "parametric"
    assert spec["views"][0]["type"] == "text"
    assert spec["views"][0]["template"] == f"公式：{text}"
    statuses = {item["id"]: item["source"]["status"] for item in spec["parameters"]}
    assert statuses == {"A": "inferred", "lambda": "original"}
    assert "inferred" in spec["notes"]
    assert spec["parameters"][0]["source"]["page"] == 5
    assert validate_ispec(spec) == []

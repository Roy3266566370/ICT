"""§9-4 跨页参数同一性：共享键分配、冲突标记与跨 iSpec 汇总。

覆盖验收四条：

1. 两条 iSpec 都有 ``label="销售额", unit="万元"`` → 同一 ``shared_key``，``occurrences`` 长度 2；
2. 只在一个 iSpec 出现的参数**不分配** ``shared_key``；
3. 同签名但 ``default`` 不同 → ``conflict=True``，且**不改**各自的默认值；
4. 全角/空白差异（``"销售额"`` vs ``" 销售额 "``）判定为同一签名。

另加一条端到端：两页表格（表头都含"销售额"）经 ``parse_pptx`` →
``build_ispecs_detailed`` 后，两条 iSpec 的同名参数共享同一个键。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.ispec import build_ispecs_detailed
from app.ispec.shared import (
    SHARED_KEY_PREFIX,
    apply_shared_keys,
    assign_shared_keys,
    normalize_token,
    parameter_signature,
    shared_key_for,
)
from app.ispec.validator import validate_ispec

MATERIAL_ID = "mat_shared_params"


def _parameter(
    *,
    parameter_id: str = "sales",
    label: str = "销售额",
    unit: str = "万元",
    default: float | int = 10,
    page: int = 1,
    excerpt: str = "销售额（万元）",
    parameter_type: str = "number",
) -> dict[str, Any]:
    """构造一个最小合法参数（来源必须齐备：无证据不出结论）。"""
    return {
        "id": parameter_id,
        "label": label,
        "type": parameter_type,
        "unit": unit,
        "default": default,
        "source": {
            "page": page,
            "element_id": f"p{page:02d}_s00",
            "bbox": None,
            "status": "original",
            "excerpt": excerpt,
        },
    }


def _spec(object_id: str, parameters: list[dict[str, Any]], page: int = 1) -> dict[str, Any]:
    """构造一条最小合法 iSpec（filter + table 视图）。"""
    return {
        "spec_version": "1.0",
        "object_id": object_id,
        "title": f"第 {page} 页表格",
        "kind": "filter",
        "parameters": parameters,
        "expressions": [],
        "datasets": [],
        "views": [{"type": "table", "columns": ["销售额"], "title": "原始表格"}],
        "constraints": [],
        "checks": [],
    }


# ---------------------------------------------------------------------------
# ① 同一变量跨两条 iSpec → 同一 shared_key
# ---------------------------------------------------------------------------


def test_same_variable_across_specs_shares_key() -> None:
    specs = [
        _spec("ispec_p01_table", [_parameter(page=1)], page=1),
        _spec(
            "ispec_p07_table",
            [_parameter(parameter_id="sales_total", page=7, excerpt="销售额 | 万元")],
            page=7,
        ),
    ]

    result = assign_shared_keys(specs)
    shared_keys = {member for group in result.assignments.values() for member in group.values()}

    assert len(result.groups) == 1, "同一签名只应产生一个共享组"
    group = result.shared_groups[0]
    assert len(shared_keys) == 1, "两条 iSpec 必须拿到同一个 shared_key"
    assert group["shared_key"].startswith(SHARED_KEY_PREFIX)
    assert group["shared_key"] == result.assignments["ispec_p01_table"]["sales"]
    assert group["shared_key"] == result.assignments["ispec_p07_table"]["sales_total"]
    assert len(group["occurrences"]) == 2
    assert [item["page"] for item in group["occurrences"]] == [1, 7]
    assert {item["object_id"] for item in group["occurrences"]} == {
        "ispec_p01_table",
        "ispec_p07_table",
    }
    assert group["conflict"] is False
    assert group["defaults"] == [10]

    # 写回后仍然通过 Schema 校验（shared_key 是 Schema 里的可选字段）
    for spec in apply_shared_keys(specs, result):
        assert validate_ispec(spec) == []


# ---------------------------------------------------------------------------
# ② 只出现一次的参数不分配
# ---------------------------------------------------------------------------


def test_single_occurrence_is_not_shared() -> None:
    specs = [
        _spec("ispec_p01_table", [_parameter(page=1)]),
        _spec(
            "ispec_p02_table",
            [_parameter(parameter_id="cost", label="成本", page=2)],
            page=2,
        ),
    ]

    result = assign_shared_keys(specs)

    assert result.groups == {}
    assert result.assignments == {}
    applied = apply_shared_keys(specs, result)
    assert all("shared_key" not in parameter for spec in applied for parameter in spec["parameters"])

    # 同一签名在**同一条** iSpec 内出现两次也不算跨页共享
    duplicated = [_spec("ispec_p01_table", [_parameter(), _parameter(parameter_id="sales_2")])]
    assert assign_shared_keys(duplicated).groups == {}


# ---------------------------------------------------------------------------
# ③ 同签名不同 default → conflict，且不改默认值
# ---------------------------------------------------------------------------


def test_default_conflict_is_reported_without_rewriting() -> None:
    specs = [
        _spec("ispec_p01_table", [_parameter(default=12, page=1)], page=1),
        _spec("ispec_p07_table", [_parameter(default=25, page=7)], page=7),
    ]
    before = [
        [parameter["default"] for parameter in spec["parameters"]] for spec in specs
    ]

    result = assign_shared_keys(specs)
    group = result.shared_groups[0]

    assert group["conflict"] is True
    assert group["defaults"] == [12, 25]
    assert result.conflicts == [group]

    # 只写 shared_key，绝不自动统一默认值（交给用户确认）
    applied = apply_shared_keys(specs, result)
    after = [
        [parameter["default"] for parameter in spec["parameters"]] for spec in applied
    ]
    assert after == before
    assert [parameter["default"] for parameter in applied[0]["parameters"]] == [12]
    assert [parameter["default"] for parameter in applied[1]["parameters"]] == [25]


# ---------------------------------------------------------------------------
# ④ 全角 / 空白 / 大小写差异 → 同一签名
# ---------------------------------------------------------------------------


def test_signature_normalizes_whitespace_and_full_width() -> None:
    assert normalize_token(" 销售额 ") == normalize_token("销售额")
    assert normalize_token("销售额\u3000") == "销售额"  # 全角空格
    assert normalize_token("Ｓａｌｅｓ") == "sales"  # 全角拉丁字母
    assert normalize_token("％") == "%"

    plain = _spec("ispec_p01_table", [_parameter(label="销售额", unit="万元", page=1)], page=1)
    padded = _spec(
        "ispec_p07_table",
        [_parameter(parameter_id="sales_2", label=" 销售额 ", unit="万元", page=7)],
        page=7,
    )

    assert parameter_signature(plain["parameters"][0]) == parameter_signature(
        padded["parameters"][0]
    )
    result = assign_shared_keys([plain, padded])
    assert len(result.groups) == 1
    assert result.shared_groups[0]["conflict"] is False

    # 单位/类型的差异必须区分开（同标签、不同单位不是同一个变量）
    other_unit = _spec(
        "ispec_p03_table",
        [_parameter(label="销售额", unit="元", page=3)],
        page=3,
    )
    mixed = assign_shared_keys([plain, other_unit])
    assert mixed.groups == {}, "单位不同不得合并"

    # shared_key 由签名决定：同签名必然同键，不同签名必然异键
    assert shared_key_for("a", "销售额") == shared_key_for("a", "销售额")
    assert shared_key_for("a", "销售额") != shared_key_for("b", "销售额")


# ---------------------------------------------------------------------------
# 端到端：两页表格（表头都含"销售额"）→ build_ispecs_detailed 输出同键
# ---------------------------------------------------------------------------


def _build_two_page_sales_pptx(path: Path) -> None:
    """两页各一个表格，表头都含"销售额"（第二页默认值不同，用来触发冲突提示）。"""
    from pptx import Presentation
    from pptx.util import Inches

    prs = Presentation()
    rows = [
        ("月份", "销售额"),
        ("一月", "120"),
        ("二月", "150"),
    ]
    for factor in (1, 2):
        slide = prs.slides.add_slide(prs.slide_layouts[6])
        table = slide.shapes.add_table(
            len(rows), 2, Inches(1), Inches(1), Inches(6), Inches(2)
        ).table
        for row_index, row in enumerate(rows):
            for column_index, text in enumerate(row):
                table.cell(row_index, column_index).text = (
                    f"{text}（第{factor}季度）" if row_index == 0 else text
                )
    prs.save(path)


def test_builder_assigns_shared_key_across_pages(tmp_path: Path) -> None:
    """两页表格都含"销售额"表头 → 两条 iSpec 的同一参数拿到同一个 shared_key。"""
    from app.parsers import parse_pptx

    pptx_path = tmp_path / "shared_sales.pptx"
    _build_two_page_sales_pptx(pptx_path)

    _material, slides = parse_pptx(str(pptx_path), material_id=MATERIAL_ID)
    result = build_ispecs_detailed(slides, material_id=MATERIAL_ID)

    assert len(result.ispecs) == 2, "两页表格应各产出一条 iSpec"
    assert result.shared_groups, "两页同类参数必须汇总出共享组"

    # 表格 iSpec 目前只暴露 filter_column（表头集合），两页表头都含"销售额"，签名一致。
    shared_keys = {
        parameter.get("shared_key")
        for spec in result.ispecs
        for parameter in spec["parameters"]
        if parameter.get("shared_key")
    }
    assert len(shared_keys) == 1, f"应只有一个共享键，实际 {shared_keys}"
    shared_key = shared_keys.pop()
    assert isinstance(shared_key, str) and shared_key.startswith(SHARED_KEY_PREFIX)

    group = result.shared_groups[0]
    assert group["shared_key"] == shared_key
    assert len(group["occurrences"]) == 2
    assert {item["page"] for item in group["occurrences"]} == {1, 2}
    assert all("销售额" in item["excerpt"] for item in group["occurrences"])
    # 两页均默认展示全部列，首列标题的差异不再导致默认筛选状态冲突。
    assert group["conflict"] is False
    assert group["defaults"] == ["全部"]

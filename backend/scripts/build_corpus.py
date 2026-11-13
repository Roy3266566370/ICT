"""程序化构造"陌生 PPT 验收集"（整改文件 §10.2/§10.3，任务 P1-09）。

本脚本只做一件事：用 ``python-pptx`` 从零生成 20 份结构各异的 PPTX，按
**整份文件**隔离为开发集（``fixtures/corpus/dev/``，10 份）与验收集
（``fixtures/corpus/eval/``，10 份），并写出 ``fixtures/corpus/manifest.json``。

覆盖的结构（每类结构至少出现在 2 份材料中，见 manifest ``kind`` / ``notes``）：

====================  ================================================  ============
类别                   构造方式                                            预期结果
====================  ================================================  ============
原生柱状图              ``COLUMN_CLUSTERED`` + ``CategoryChartData``         产出 iSpec
原生折线图              ``LINE_MARKERS``，多系列                              产出 iSpec
原生饼图                ``PIE``                                              产出 iSpec
原生表格                ``shapes.add_table``（3 行 × 4 列）                   产出 iSpec
表格 + 图表混排         同页放置 table 与 chart                               产出 2 条
组合内文字              ``group.shapes.add_textbox``                         不产出
组合内表格/图表          ``group.shapes.add_table`` / ``add_chart``            产出 iSpec
OMML 公式              ``a14:m`` / ``m:oMath`` 写入 ``txBody/extLst``        产出 iSpec
纯文字                  只有标题与正文                                       不产出
纯图片                  图表先渲染为 PNG 再插入                               不产出
多页混合                图表页 + 表格页 + 文字页 + 空页 + 图片页              产出 2 条
60 页边界              1 页图表 + 59 页文字/空页（``MAX_PAGES=60``）          产出 iSpec
====================  ================================================  ============

约定：

* 只写 ``fixtures/corpus/**``，不触碰 ``contracts/**`` / ``backend/app/**``；
* 单份文件控制在 1MB 内（当前实现均为 30KB ~ 60KB 量级）；
* 生成过程确定性：分类/数值/文本全部在源码内固定，不使用随机数；
* 图片页的临时 PNG 只用于嵌入，不落盘到仓库（``TemporaryDirectory``）。
"""

from __future__ import annotations

import json
import tempfile
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.oxml import parse_xml
from pptx.util import Inches, Pt

#: 仓库根目录（``backend/scripts/build_corpus.py`` 向上 2 层）。
REPO_ROOT = Path(__file__).resolve().parents[2]
#: 验收集根目录。
CORPUS_DIR = REPO_ROOT / "fixtures" / "corpus"
DEV_DIR = CORPUS_DIR / "dev"
EVAL_DIR = CORPUS_DIR / "eval"
#: manifest 文件。
MANIFEST_PATH = CORPUS_DIR / "manifest.json"

#: 16:9 页面尺寸（与仓库现有课件一致）。
SLIDE_WIDTH = Inches(13.333)
SLIDE_HEIGHT = Inches(7.5)

#: 单份材料的目标体积上限（字节）；超出只告警，不失败。
MAX_FILE_BYTES = 1024 * 1024

#: OMML 扩展在 ``a:ext/@uri`` 上使用的稳定 GUID（同一份材料内不重复）。
_OMML_EXT_URI = "{3B4E1F2A-6C2D-4C7E-9A11-8E5C0F000001}"

_NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
_NS_A14 = "http://schemas.microsoft.com/office/drawing/2010/main"
_NS_M = "http://schemas.openxmlformats.org/officeDocument/2006/math"


@dataclass(frozen=True, slots=True)
class CorpusSpec:
    """一份语料材料的构造说明。"""

    file: str
    split: str
    kind: str
    expect: str
    notes: str
    build: Callable[[Presentation], None]


# ---------------------------------------------------------------------------
# 基础构造助手
# ---------------------------------------------------------------------------


def _new_presentation(title: str) -> Presentation:
    """新建 16:9 空白演示文稿并写入核心属性标题。"""
    presentation = Presentation()
    presentation.slide_width = SLIDE_WIDTH
    presentation.slide_height = SLIDE_HEIGHT
    presentation.core_properties.title = title
    presentation.core_properties.author = "build_corpus.py"
    return presentation


def _blank_slide(presentation: Presentation, heading: str) -> Any:
    """新增一页空白版式，并在顶部放一个中文标题文本框。

    标题文本参与页面 ``title`` 选举（解析器优先取"带中文的最大字号首行"），
    因此后续表格类 iSpec 的标题即来自这里。
    """
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    box = slide.shapes.add_textbox(Inches(0.6), Inches(0.35), Inches(12), Inches(0.8))
    frame = box.text_frame
    frame.word_wrap = True
    paragraph = frame.paragraphs[0]
    paragraph.text = heading
    paragraph.font.size = Pt(26)
    paragraph.font.bold = True
    return slide


def _add_body_text(slide: Any, lines: Sequence[str], *, top: float = 1.6) -> None:
    """在页面左侧追加一段多行正文（纯文字，无任何原生结构）。"""
    box = slide.shapes.add_textbox(Inches(0.8), Inches(top), Inches(11.5), Inches(4.6))
    frame = box.text_frame
    frame.word_wrap = True
    for index, line in enumerate(lines):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        paragraph.text = line
        paragraph.font.size = Pt(16)


def _add_chart(
    slide: Any,
    *,
    chart_type: Any,
    title: str,
    categories: Sequence[str],
    series: Sequence[tuple[str, Sequence[float | int]]],
    left: float = 1.0,
    top: float = 1.6,
    width: float = 7.6,
    height: float = 4.8,
) -> Any:
    """新增原生图表（类别轴 + 若干系列），标题写入图表自身。

    ``chart_title`` 会被解析器写入 ``chart_data.title``，也是 iSpec 参数
    ``source.excerpt`` 的首选原文片段。
    """
    chart_data = CategoryChartData()
    chart_data.categories = list(categories)
    for name, values in series:
        chart_data.add_series(name, list(values))
    frame = slide.shapes.add_chart(
        chart_type,
        Inches(left),
        Inches(top),
        Inches(width),
        Inches(height),
        chart_data,
    )
    chart = frame.chart
    chart.has_title = True
    chart.chart_title.text_frame.text = title
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.BOTTOM
    chart.legend.include_in_layout = False
    return frame


def _add_table(
    slide: Any,
    *,
    headers: Sequence[str],
    rows: Sequence[Sequence[str]],
    left: float = 1.0,
    top: float = 1.8,
    width: float = 11.2,
    height: float = 2.4,
) -> Any:
    """新增原生表格；首行必须是表头（解析器把首行放进 ``table_data.headers``）。"""
    column_count = len(headers)
    frame = slide.shapes.add_table(
        len(rows) + 1,
        column_count,
        Inches(left),
        Inches(top),
        Inches(width),
        Inches(height),
    )
    table = frame.table
    for index, header in enumerate(headers):
        table.cell(0, index).text = str(header)
    for row_index, row in enumerate(rows, start=1):
        for column_index, value in enumerate(row):
            table.cell(row_index, column_index).text = str(value)
    return frame


def _add_group_textbox(slide: Any) -> Any:
    """组合图形内只放文本框：子形状 kind=text，当前识别链路不产出 iSpec。"""
    group = slide.shapes.add_group_shape()
    first = group.shapes.add_textbox(Inches(1.2), Inches(2.0), Inches(5.0), Inches(1.2))
    first.text_frame.text = "组合内的说明文字（无原生图表/表格/公式）"
    second = group.shapes.add_textbox(Inches(1.2), Inches(3.4), Inches(5.0), Inches(1.2))
    second.text_frame.text = "组合仅改变排版，不改变'无结构'这一事实。"
    return group


def _add_group_table(slide: Any) -> Any:
    """组合图形内嵌原生表格。

    ``python-pptx`` 的 ``GroupShapes`` 没有 ``add_table``，因此先在页面上建表，
    再把 ``graphicFrame`` 的 XML 移到组合的 ``spTree`` 下；解析器的组合递归
    （``_walk_shapes``）会把子形状展开为 ``pNN_sMM_gK`` 并直读 ``table_data``。
    """
    group = slide.shapes.add_group_shape()
    table_frame = _add_table(
        slide,
        headers=["指标", "Q1", "Q2", "Q3"],
        rows=[["销量", "120", "135", "150"], ["成本", "80", "84", "88"]],
        left=1.4,
        top=2.4,
        width=9.0,
        height=1.8,
    )
    slide.shapes._spTree.remove(table_frame._element)
    group.shapes._spTree.append(table_frame._element)
    return group


def _add_group_chart(slide: Any) -> Any:
    """组合图形内嵌原生图表（``GroupShapes.add_chart`` 受支持）。"""
    group = slide.shapes.add_group_shape()
    chart_data = CategoryChartData()
    chart_data.categories = ["甲", "乙", "丙", "丁"]
    chart_data.add_series("抽样值", (4, 9, 6, 11))
    frame = group.shapes.add_chart(
        XL_CHART_TYPE.COLUMN_CLUSTERED,
        Inches(2.0),
        Inches(2.2),
        Inches(6.4),
        Inches(3.8),
        chart_data,
    )
    chart = frame.chart
    chart.has_title = True
    chart.chart_title.text_frame.text = "组合内柱状图（原生图表）"
    chart.has_legend = False
    return group


def _add_omml_formula(slide: Any, formula: str, *, left: float = 1.2, top: float = 2.4) -> Any:
    """把一段 OMML 公式写入文本框的 ``txBody/a:extLst/a:ext/a14:m``。

    解析器用 ``shape._element.findall(".//m:oMath")`` 提取公式文本，因此这里按
    Office 2010 的扩展结构写入（``a14:m`` 包装 ``m:oMathPara``）即可，无需
    真实排版引擎参与。``m:r/m:t`` 内的文本就是参数来源的"原文"。
    """
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(7.0), Inches(1.4))
    xml = (
        f'<a:extLst xmlns:a="{_NS_A}" xmlns:a14="{_NS_A14}" xmlns:m="{_NS_M}">'
        f'<a:ext uri="{_OMML_EXT_URI}"><a14:m><m:oMathPara><m:oMath>'
        "<m:r><m:t>"
        f"{formula}"
        "</m:t></m:r>"
        "</m:oMath></m:oMathPara></a14:m></a:ext></a:extLst>"
    )
    box._element.txBody.append(parse_xml(xml))
    return box


def _add_rendered_chart_picture(
    slide: Any,
    *,
    categories: Sequence[str],
    values: Sequence[float | int],
    series_name: str,
    title: str,
    left: float = 1.4,
    top: float = 1.8,
    width: float = 7.2,
    height: float = 4.6,
) -> Any:
    """把柱状图用 matplotlib 渲染成 PNG 后作为图片插入（图片内图表不可识别）。"""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    figure, axes = plt.subplots(figsize=(7.2, 4.6), dpi=110)
    axes.bar(list(categories), [float(value) for value in values], color="#4C78A8")
    axes.set_title(title, fontsize=13)
    axes.set_ylabel(series_name)
    axes.grid(axis="y", alpha=0.3)
    figure.tight_layout()

    with tempfile.TemporaryDirectory(prefix="corpus_png_") as temp_dir:
        png_path = Path(temp_dir) / "chart.png"
        figure.savefig(png_path, format="png")
        plt.close(figure)
        return slide.shapes.add_picture(
            str(png_path), Inches(left), Inches(top), Inches(width), Inches(height)
        )


def _add_empty_slide(presentation: Presentation) -> Any:
    """纯空页：没有任何形状（解析器输出 ``elements=[]``，不失败）。"""
    return presentation.slides.add_slide(presentation.slide_layouts[6])


# ---------------------------------------------------------------------------
# 各份材料的具体构造
# ---------------------------------------------------------------------------


def _dev_bar_single(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "季度营收（原生柱状图，单系列）")
    _add_chart(
        slide,
        chart_type=XL_CHART_TYPE.COLUMN_CLUSTERED,
        title="2024 年季度营收（万元）",
        categories=["第一季度", "第二季度", "第三季度", "第四季度"],
        series=[("营收（万元）", [128, 156, 141, 189])],
    )


def _eval_bar_single(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "年度产量（原生柱状图，单系列）")
    _add_chart(
        slide,
        chart_type=XL_CHART_TYPE.COLUMN_CLUSTERED,
        title="2019-2024 年钢产量（百万吨）",
        categories=["2019", "2020", "2021", "2022", "2023", "2024"],
        series=[("产量（百万吨）", [98, 105, 112, 118, 124, 131])],
    )


def _dev_line_multi(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "气温与降水（原生折线图，多系列）")
    _add_chart(
        slide,
        chart_type=XL_CHART_TYPE.LINE_MARKERS,
        title="城市月度气温（摄氏度）",
        categories=["1月", "2月", "3月", "4月", "5月", "6月"],
        series=[
            ("北京", [1.2, 3.8, 9.4, 16.1, 22.5, 26.4]),
            ("上海", [4.6, 6.3, 10.1, 15.7, 21.2, 25.1]),
            ("广州", [13.9, 15.2, 18.1, 22.4, 26.0, 27.8]),
        ],
    )


def _eval_line_multi(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "用户增长（原生折线图，多系列）")
    _add_chart(
        slide,
        chart_type=XL_CHART_TYPE.LINE_MARKERS,
        title="半年活跃用户（万人）",
        categories=["1月", "2月", "3月", "4月", "5月", "6月"],
        series=[
            ("注册用户", [32, 41, 47, 55, 63, 70]),
            ("付费用户", [3.2, 4.1, 5.6, 6.8, 8.1, 9.4]),
        ],
        width=8.2,
    )


def _dev_pie(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "支出结构（原生饼图）")
    _add_chart(
        slide,
        chart_type=XL_CHART_TYPE.PIE,
        title="部门年度支出占比",
        categories=["研发", "市场", "运营", "行政"],
        series=[("支出（万元）", [420, 260, 180, 140])],
        left=2.2,
        width=6.4,
    )


def _eval_pie(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "能源结构（原生饼图）")
    _add_chart(
        slide,
        chart_type=XL_CHART_TYPE.PIE,
        title="一次能源消费占比（%）",
        categories=["煤炭", "石油", "天然气", "水电", "其他"],
        series=[("占比", [55.4, 18.6, 8.9, 8.1, 9.0])],
        left=2.2,
        width=6.4,
    )


def _dev_table_3x4(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "课程成绩表（原生 3×4 表格）")
    _add_table(
        slide,
        headers=["科目", "第一学期", "第二学期", "合计"],
        rows=[["数学", "88", "92", "180"], ["语文", "85", "87", "172"]],
        top=2.6,
        height=1.6,
    )


def _eval_table_3x4(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "项目预算表（原生 3×4 表格）")
    _add_table(
        slide,
        headers=["项目", "预算（万元）", "实际（万元）", "差异"],
        rows=[["设备采购", "320", "305", "-15"], ["人员培训", "48", "52", "4"]],
        top=2.6,
        height=1.6,
    )


def _dev_table_chart_mix(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "表格与图表混排（原生结构）")
    _add_table(
        slide,
        headers=["月份", "线上", "线下", "合计"],
        rows=[["1月", "42", "18", "60"], ["2月", "51", "21", "72"]],
        top=1.6,
        left=0.9,
        width=5.4,
        height=1.5,
    )
    _add_chart(
        slide,
        chart_type=XL_CHART_TYPE.COLUMN_CLUSTERED,
        title="线上线下销售额（万元）",
        categories=["1月", "2月"],
        series=[("线上", [42, 51]), ("线下", [18, 21])],
        left=6.8,
        width=6.0,
        top=1.6,
    )


def _eval_table_chart_mix(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "库存与出库混排（原生结构）")
    _add_table(
        slide,
        headers=["仓库", "库存", "出库", "周转天数"],
        rows=[["华东", "860", "210", "12"], ["华南", "640", "180", "10"]],
        top=1.6,
        left=0.9,
        width=5.6,
        height=1.5,
    )
    _add_chart(
        slide,
        chart_type=XL_CHART_TYPE.BAR_CLUSTERED,
        title="仓库库存与出库对比",
        categories=["华东", "华南"],
        series=[("库存", [860, 640]), ("出库", [210, 180])],
        left=6.8,
        width=6.0,
        top=1.6,
    )


def _dev_group_textbox(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "组合图形内嵌文字（无可识别结构）")
    _add_group_textbox(slide)


def _eval_group_textbox(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "组合图形内只有说明文字（无可识别结构）")
    _add_group_textbox(slide)
    _add_body_text(
        slide,
        ["本页用于验证：组合本身不携带数据，", "纯文字子形状不得被伪造为交互区域。"],
        top=5.2,
    )


def _dev_group_table(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "组合图形内嵌原生表格")
    _add_group_table(slide)


def _eval_group_chart(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "组合图形内嵌原生图表")
    _add_group_chart(slide)


def _dev_omml_formula(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "OMML 公式（变量均带数值）")
    _add_omml_formula(slide, "A = 3，B = 5，det A = 3")
    _add_body_text(slide, ["说明：本页公式由 a14:m / m:oMath 原生写入。"], top=4.4)


def _eval_omml_formula(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "OMML 公式（存在未赋值变量）")
    _add_omml_formula(slide, "x^2 + y^2 = r^2")
    _add_body_text(slide, ["说明：原文未给出 x、y、r 的数值。"], top=4.4)


def _dev_text_only(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "纯文字页（无任何可交互结构）")
    _add_body_text(
        slide,
        [
            "一、背景",
            "本页只有标题与正文段落，没有任何原生图表、表格或公式。",
            "二、结论",
            "按照识别链路的约束，本页不应产出任何 iSpec。",
        ],
    )


def _dev_picture_chart(presentation: Presentation) -> None:
    slide = _blank_slide(presentation, "纯图片页（图表已渲染为位图）")
    _add_rendered_chart_picture(
        slide,
        categories=["Q1", "Q2", "Q3", "Q4"],
        values=[120, 150, 138, 172],
        series_name="Revenue (10k)",
        title="Quarterly Revenue (rendered as PNG)",
    )
    _add_body_text(slide, ["说明：图表在插入前已被渲染为位图，图中数据无法直读。"], top=6.4)


def _eval_multi_page_mix(presentation: Presentation) -> None:
    first = _blank_slide(presentation, "多页混合：原生图表页")
    _add_chart(
        first,
        chart_type=XL_CHART_TYPE.COLUMN_CLUSTERED,
        title="门店月度客流（千人次）",
        categories=["5月", "6月", "7月", "8月"],
        series=[("客流", [86, 94, 101, 97])],
    )

    second = _blank_slide(presentation, "多页混合：原生表格页")
    _add_table(
        second,
        headers=["门店", "面积", "客流", "转化率"],
        rows=[["A 店", "320", "86", "12.5%"], ["B 店", "260", "94", "14.1%"]],
        top=2.4,
        height=1.6,
    )

    third = _blank_slide(presentation, "多页混合：纯文字页")
    _add_body_text(third, ["本页没有原生结构，预期不产出 iSpec。"])

    _add_empty_slide(presentation)

    fifth = presentation.slides.add_slide(presentation.slide_layouts[6])
    _add_rendered_chart_picture(
        fifth,
        categories=["A", "B", "C"],
        values=[7, 12, 9],
        series_name="Count",
        title="Picture-only page",
    )


def _eval_max_pages_60(presentation: Presentation) -> None:
    """60 页边界：恰好等于 ``MAX_PAGES``，解析器不得抛 ``LIMIT_EXCEEDED``。"""
    first = _blank_slide(presentation, "60 页边界：首页原生图表")
    _add_chart(
        first,
        chart_type=XL_CHART_TYPE.LINE_MARKERS,
        title="60 页材料中的折线图",
        categories=["阶段一", "阶段二", "阶段三", "阶段四"],
        series=[("进度", [10, 35, 68, 92])],
    )
    for index in range(2, 61):
        slide = _blank_slide(presentation, f"边界填充页 {index}/60")
        _add_body_text(slide, [f"第 {index} 页为纯文字填充，用于逼近页数上限。"], top=3.0)


# ---------------------------------------------------------------------------
# 语料清单
# ---------------------------------------------------------------------------


def _specs() -> list[CorpusSpec]:
    """返回 20 份材料的构造顺序（dev 10 → eval 10）。"""
    return [
        CorpusSpec("dev_01_bar_single.pptx", "dev", "bar_chart", "should_pass",
                   "原生柱状图，单系列 4 分类。", _dev_bar_single),
        CorpusSpec("dev_02_line_multi.pptx", "dev", "line_chart", "should_pass",
                   "原生折线图，3 系列 6 分类。", _dev_line_multi),
        CorpusSpec("dev_03_pie.pptx", "dev", "pie_chart", "should_pass",
                   "原生饼图，4 分类单系列（无专用模板，降级 bar）。", _dev_pie),
        CorpusSpec("dev_04_table_3x4.pptx", "dev", "table", "should_pass",
                   "原生表格 3 行 × 4 列（首行表头）。", _dev_table_3x4),
        CorpusSpec("dev_05_table_chart_mix.pptx", "dev", "table_chart_mix", "should_pass",
                   "同页原生表格 + 柱状图，预期 2 条 iSpec。", _dev_table_chart_mix),
        CorpusSpec("dev_06_group_textbox.pptx", "dev", "group_textbox", "should_fail",
                   "组合内仅文本框；无原生数据，不得伪造交互。", _dev_group_textbox),
        CorpusSpec("dev_07_group_table.pptx", "dev", "group_table", "should_pass",
                   "组合内嵌原生表格，解析器递归展开子形状后直读。", _dev_group_table),
        CorpusSpec("dev_08_omml_formula.pptx", "dev", "omml_formula", "should_pass",
                   "OMML 公式（a14:m/m:oMath 原生 XML 写入，非降级构造），A/B 均有显式赋值（status=original）。", _dev_omml_formula),
        CorpusSpec("dev_09_text_only.pptx", "dev", "text_only", "should_fail",
                   "纯文字页，无图表/表格/公式。", _dev_text_only),
        CorpusSpec("dev_10_picture_chart.pptx", "dev", "picture_chart", "should_fail",
                   "图表先渲染为 PNG 再插入；图片内图表不可识别。", _dev_picture_chart),
        CorpusSpec("eval_01_bar_single.pptx", "eval", "bar_chart", "should_pass",
                   "陌生柱状图（6 分类），与 dev 数据不同。", _eval_bar_single),
        CorpusSpec("eval_02_line_multi.pptx", "eval", "line_chart", "should_pass",
                   "陌生折线图（2 系列 6 分类）。", _eval_line_multi),
        CorpusSpec("eval_03_pie.pptx", "eval", "pie_chart", "should_pass",
                   "陌生饼图（5 分类）。", _eval_pie),
        CorpusSpec("eval_04_table_3x4.pptx", "eval", "table", "should_pass",
                   "陌生 3×4 表格。", _eval_table_3x4),
        CorpusSpec("eval_05_table_chart_mix.pptx", "eval", "table_chart_mix", "should_pass",
                   "陌生表格 + 条形图混排。", _eval_table_chart_mix),
        CorpusSpec("eval_06_group_textbox.pptx", "eval", "group_textbox", "should_fail",
                   "组合内文字 + 页面正文，均无原生数据。", _eval_group_textbox),
        CorpusSpec("eval_07_group_chart.pptx", "eval", "group_chart", "should_pass",
                   "组合内嵌原生图表。", _eval_group_chart),
        CorpusSpec("eval_08_omml_formula.pptx", "eval", "omml_formula", "should_pass",
                   "OMML 公式（a14:m/m:oMath 原生 XML 写入，非降级构造），x/y/r 无赋值（status=inferred，计入用户纠正成本）。", _eval_omml_formula),
        CorpusSpec("eval_09_multi_page_mix.pptx", "eval", "multi_page_mix", "should_pass",
                   "5 页：图表/表格/文字/空页/纯图片；预期 2 条 iSpec。", _eval_multi_page_mix),
        CorpusSpec("eval_10_max_pages_60.pptx", "eval", "max_pages_boundary", "should_pass",
                   "恰好 60 页（MAX_PAGES 上限），首页图表 + 59 页文字。", _eval_max_pages_60),
    ]


def _manifest_entry(spec: CorpusSpec, path: Path) -> dict[str, Any]:
    """manifest 中的单份材料记录。"""
    return {
        "file": f"{spec.split}/{spec.file}",
        "kind": spec.kind,
        "expect": spec.expect,
        "notes": spec.notes,
        "size_bytes": path.stat().st_size,
    }


def build_corpus(*, clean: bool = True) -> dict[str, Any]:
    """生成全部语料与 manifest，返回 manifest 字典。

    :param clean: 生成前删除旧的 ``*.pptx``（避免残留文件污染统计）。
    """
    DEV_DIR.mkdir(parents=True, exist_ok=True)
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    if clean:
        for directory in (DEV_DIR, EVAL_DIR):
            for stale in directory.glob("*.pptx"):
                stale.unlink()

    entries: dict[str, list[dict[str, Any]]] = {"dev": [], "eval": []}
    for spec in _specs():
        target_dir = DEV_DIR if spec.split == "dev" else EVAL_DIR
        path = target_dir / spec.file
        presentation = _new_presentation(spec.file.removesuffix(".pptx"))
        spec.build(presentation)
        presentation.save(str(path))
        entries[spec.split].append(_manifest_entry(spec, path))
        if path.stat().st_size > MAX_FILE_BYTES:
            print(f"[warn] {spec.file} 超过 1MB：{path.stat().st_size} 字节")

    manifest: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": "backend/scripts/build_corpus.py",
        "generated_by_pptx_version": _pptx_version(),
        "total": len(entries["dev"]) + len(entries["eval"]),
        "dev": entries["dev"],
        "eval": entries["eval"],
    }
    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def _pptx_version() -> str:
    """``python-pptx`` 版本号（写入 manifest，便于复现）。"""
    try:
        import pptx

        return str(getattr(pptx, "__version__", "unknown"))
    except Exception:  # pragma: no cover - 依赖异常
        return "unknown"


def main() -> int:
    """CLI 入口：生成语料并打印逐份结果。"""
    manifest = build_corpus()
    for split in ("dev", "eval"):
        print(f"[{split}] {len(manifest[split])} 份")
        for entry in manifest[split]:
            print(
                f"  {entry['file']:<42} {entry['kind']:<18} "
                f"expect={entry['expect']:<11} {entry['size_bytes']:>7} B"
            )
    print(f"manifest → {MANIFEST_PATH}（共 {manifest['total']} 份）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
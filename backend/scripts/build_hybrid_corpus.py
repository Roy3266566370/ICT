"""构造混合匹配验收语料（``fixtures/corpus-v2``）。

本脚本只生成**仓库内受控变体**，不下载真实课件：

* 10 类交互模板各有 3 种措辞/A-B-C 变体，逐份 PPT 含 3 页（每页一个区域）；
* 每个模板在 dev / calibration / blind 三个集合各有 3 份材料，同一模板共 27 个标注区域；
* 另含 20 份负例材料（非教学内容、缺条件、非法参数），每份 2 页；
* 全部数值固定、无随机数；同一模板的三个变体属于同一 ``family_id``，不跨集合切分。

输出：
    fixtures/corpus-v2/dev/*.pptx
    fixtures/corpus-v2/calibration/*.pptx
    fixtures/corpus-v2/blind/*.pptx
    fixtures/corpus-v2/manifest.json

说明：这不是“200 份真实陌生 PPT”验收，只是可重复的受控回归集；真实材料需另行采集并
按相同 manifest 格式标注。脚本不修改任何业务代码或测试。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pptx import Presentation
from pptx.util import Inches, Pt

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "fixtures" / "corpus-v2"
SPLITS = ("dev", "calibration", "blind")
SLIDE_WIDTH = Inches(13.333)
SLIDE_HEIGHT = Inches(7.5)
GENERATOR_VERSION = "build_hybrid_corpus.py@1"


@dataclass(frozen=True, slots=True)
class Variant:
    key: str
    text: str
    expected_status: str
    required: dict[str, Any] = field(default_factory=dict)
    missing: tuple[str, ...] = ()
    note: str = ""


@dataclass(frozen=True, slots=True)
class TemplateCase:
    template_id: str
    category: str
    label: str
    variants: tuple[Variant, Variant, Variant]


POSITIVE_CASES: tuple[TemplateCase, ...] = (
    TemplateCase(
        template_id="calculus.taylor",
        category="formula",
        label="泰勒近似",
        variants=(
            Variant(
                key="A",
                text="泰勒近似：f(x) = sin(x)，展开点 x0 = 0，阶数 n = 5，估计点 x = 0.5。",
                expected_status="supported",
                required={"x0": 0.0, "order": 5, "x_eval": 0.5},
                note="显式给出展开点、阶数与估计点。",
            ),
            Variant(
                key="B",
                text="用 3 阶泰勒多项式在 x0 = 0 处近似 f(x) = exp(x)，并计算 x = 0.2 处的函数值。",
                expected_status="supported",
                required={"x0": 0.0, "order": 3, "x_eval": 0.2},
                note="中文叙述，阶数在句首。",
            ),
            Variant(
                key="C",
                text="用泰勒多项式近似 f(x) = cos(x)，展开点 x0 = 0。",
                expected_status="needs_review",
                required={"x0": 0.0},
                missing=("order", "x_eval"),
                note="缺少阶数与估计点，不能自动执行。",
            ),
        ),
    ),
    TemplateCase(
        template_id="calculus.double_integral",
        category="formula",
        label="二重积分",
        variants=(
            Variant(
                key="A",
                text="二重积分：∫∫_D (x^2 + y) dA，D: 0 ≤ x ≤ 2, 0 ≤ y ≤ 1，网格 20×20。",
                expected_status="supported",
                required={"ax": 0.0, "bx": 2.0, "ay": 0.0, "by": 1.0, "nx": 20, "ny": 20},
            ),
            Variant(
                key="B",
                text="计算二重积分 ∫∫_D (x*y + 1) dA，其中 x 从 -1 到 1，y 从 0 到 2，使用 24×16 网格。",
                expected_status="supported",
                required={"ax": -1.0, "bx": 1.0, "ay": 0.0, "by": 2.0, "nx": 24, "ny": 16},
                note="“从…到…”措辞与乘号写法。",
            ),
            Variant(
                key="C",
                text="二重积分 ∫∫_D (x^2 + y^2) dA，D 为矩形区域。",
                expected_status="needs_review",
                required={},
                missing=("ax", "bx", "ay", "by"),
                note="缺少区域边界。",
            ),
        ),
    ),
    TemplateCase(
        template_id="optimization.newton_1d",
        category="optimization",
        label="一维牛顿优化",
        variants=(
            Variant(
                key="A",
                text="一维牛顿优化：f(x) = x^2 - 4x + 1，初值 x0 = 3，迭代 8 次。",
                expected_status="supported",
                required={"x0": 3.0, "max_iter": 8},
            ),
            Variant(
                key="B",
                text="用牛顿法求 f(x) = x^4 - 2x^2 + 1 的极小点，起点 x0 = 0.5，最多 10 步。",
                expected_status="supported",
                required={"x0": 0.5, "max_iter": 10},
            ),
            Variant(
                key="C",
                text="用牛顿法优化 f(x) = x^3 - 3x 的极值。",
                expected_status="needs_review",
                required={},
                missing=("x0",),
                note="缺少初值，不能自动执行。",
            ),
        ),
    ),
    TemplateCase(
        template_id="optimization.least_squares_line",
        category="optimization",
        label="最小二乘直线拟合",
        variants=(
            Variant(
                key="A",
                text="最小二乘直线拟合：数据点 (1, 2), (2, 3), (3, 5), (4, 4)。",
                expected_status="supported",
                required={"xs": [1.0, 2.0, 3.0, 4.0], "ys": [2.0, 3.0, 5.0, 4.0]},
            ),
            Variant(
                key="B",
                text="对数据 (0, 1), (1, 2), (2, 2), (3, 4), (4, 5) 做最小二乘拟合。",
                expected_status="supported",
                required={"xs": [0.0, 1.0, 2.0, 3.0, 4.0], "ys": [1.0, 2.0, 2.0, 4.0, 5.0]},
            ),
            Variant(
                key="C",
                text="最小二乘拟合：只有 x 数据 [1, 2, 3]，缺少对应的 y 数据。",
                expected_status="needs_review",
                required={"xs": [1.0, 2.0, 3.0]},
                missing=("ys",),
                note="缺 y 数据。",
            ),
        ),
    ),
    TemplateCase(
        template_id="data_structures.stack_queue",
        category="data_structure",
        label="栈与队列",
        variants=(
            Variant(
                key="A",
                text="栈操作：初始栈 [3, 1, 4]，操作序列 push 2; pop; push 5; pop。",
                expected_status="supported",
                required={"mode": "stack", "initial": [3.0, 1.0, 4.0], "operations": "push 2; pop; push 5; pop"},
            ),
            Variant(
                key="B",
                text="队列演示：初始队列 [2, 5, 7]，依次执行 enqueue 9; dequeue; enqueue 1。",
                expected_status="supported",
                required={"mode": "queue", "initial": [2.0, 5.0, 7.0], "operations": "enqueue 9; dequeue; enqueue 1"},
            ),
            Variant(
                key="C",
                text="栈与队列：初始列表 [3, 1, 4]，请观察空栈情况。",
                expected_status="needs_review",
                required={"initial": [3.0, 1.0, 4.0]},
                missing=("operations",),
                note="缺少明确操作序列。",
            ),
        ),
    ),
    TemplateCase(
        template_id="data_structures.sorting",
        category="data_structure",
        label="基础排序",
        variants=(
            Variant(
                key="A",
                text="冒泡排序：对列表 [5, 1, 4, 2, 8] 升序排序。",
                expected_status="supported",
                required={"algorithm": "bubble", "values": [5.0, 1.0, 4.0, 2.0, 8.0]},
            ),
            Variant(
                key="B",
                text="插入排序演示：输入 [9, 3, 7, 1, 5, 2]，升序排列。",
                expected_status="supported",
                required={"algorithm": "insertion", "values": [9.0, 3.0, 7.0, 1.0, 5.0, 2.0]},
            ),
            Variant(
                key="C",
                text="排序演示：对 [4, 2, 7] 进行排序。",
                expected_status="needs_review",
                required={"values": [4.0, 2.0, 7.0]},
                missing=("algorithm",),
                note="未明确排序算法。",
            ),
        ),
    ),
    TemplateCase(
        template_id="deep_learning.activation_gradient",
        category="network",
        label="激活函数与梯度",
        variants=(
            Variant(
                key="A",
                text="ReLU 激活函数：在 x = -0.5 处求激活值与梯度，上游梯度为 2。",
                expected_status="supported",
                required={"activation": "relu", "x": -0.5, "upstream": 2.0},
            ),
            Variant(
                key="B",
                text="Sigmoid 激活：x = 0.8，反向传播梯度为 1.5。",
                expected_status="supported",
                required={"activation": "sigmoid", "x": 0.8, "upstream": 1.5},
            ),
            Variant(
                key="C",
                text="激活函数与梯度：观察 ReLU 在零点附近的行为。",
                expected_status="needs_review",
                required={"activation": "relu"},
                missing=("x",),
                note="缺少具体输入点。",
            ),
        ),
    ),
    TemplateCase(
        template_id="deep_learning.conv_pool",
        category="network",
        label="卷积与池化",
        variants=(
            Variant(
                key="A",
                text="单通道卷积：输入矩阵 [[1,2,3],[4,5,6],[7,8,9]]，卷积核 [[1,0,-1],[1,0,-1],[1,0,-1]]，步长 1，填充 0。",
                expected_status="supported",
                required={
                    "matrix": [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
                    "kernel": [[1, 0, -1], [1, 0, -1], [1, 0, -1]],
                    "mode": "conv",
                    "stride": 1,
                    "padding": 0,
                },
            ),
            Variant(
                key="B",
                text="最大池化：输入 [[1,3,2,4],[5,6,7,8],[9,2,1,0],[3,4,5,6]]，池化窗口 2×2，步长 2，填充 0。",
                expected_status="supported",
                required={
                    "matrix": [[1, 3, 2, 4], [5, 6, 7, 8], [9, 2, 1, 0], [3, 4, 5, 6]],
                    "mode": "maxpool",
                    "stride": 2,
                    "padding": 0,
                },
            ),
            Variant(
                key="C",
                text="卷积与池化：对单通道矩阵做 3×3 卷积。",
                expected_status="needs_review",
                required={},
                missing=("matrix", "kernel"),
                note="缺少输入矩阵与卷积核。",
            ),
        ),
    ),
    TemplateCase(
        template_id="physics.projectile",
        category="physics",
        label="抛体运动",
        variants=(
            Variant(
                key="A",
                text="抛体运动：初速度 v0 = 36 km/h，仰角 30°，g = 9.8 m/s^2，t = 1 s。",
                expected_status="supported",
                required={"v0": 10.0, "angle_deg": 30.0, "g": 9.8, "t": 1.0, "y0": 0.0},
                note="36 km/h 必须确定性换算为 10 m/s。",
            ),
            Variant(
                key="B",
                text="平抛运动：初速度为 10 m/s，离地高度 5 m，g = 9.8 m/s^2，求 t = 0.5 s 的位置。",
                expected_status="supported",
                required={"v0": 10.0, "angle_deg": 0.0, "y0": 5.0, "g": 9.8, "t": 0.5},
            ),
            Variant(
                key="C",
                text="抛体运动：初速度未知，仰角 45°，求轨迹。",
                expected_status="needs_review",
                required={"angle_deg": 45.0},
                missing=("v0",),
                note="缺少初速度。",
            ),
        ),
    ),
    TemplateCase(
        template_id="physics.spring_oscillator",
        category="physics",
        label="弹簧简谐振动",
        variants=(
            Variant(
                key="A",
                text="弹簧振子：m = 2 kg，k = 8 N/m，初位移 x0 = 0.1 m，初速度 v0 = 0 m/s，t = 2 s。",
                expected_status="supported",
                required={"m": 2.0, "k": 8.0, "x0": 0.1, "v0": 0.0, "t": 2.0},
            ),
            Variant(
                key="B",
                text="简谐振动：质量 0.5 kg，劲度系数 2 N/m，从位移 0.2 m 静止释放，求 t = 1.5 s 的位移与速度。",
                expected_status="supported",
                required={"m": 0.5, "k": 2.0, "x0": 0.2, "v0": 0.0, "t": 1.5},
                note="中文物理量名称。",
            ),
            Variant(
                key="C",
                text="弹簧振子：m = 1 kg，k = -4 N/m，求振动。",
                expected_status="needs_review",
                required={"m": 1.0, "k": -4.0},
                missing=("x0", "v0"),
                note="劲度系数为负，且缺少初值；不得自动执行。",
            ),
        ),
    ),
)

NEGATIVE_TEXTS: tuple[tuple[str, str], ...] = (
    ("非教学目录", "课程安排：第一章 绪论；第二章 极限；第三章 导数。本章重点与考核方式见教学大纲。"),
    ("版权声明", "本课件仅供课堂教学使用，版权所有，未经许可不得复制或传播。"),
    ("方法概述", "牛顿法是一种迭代方法，队列是一种先进先出的数据结构，卷积常用于图像处理。"),
    ("缺少输入", "请计算下面的积分，题目见另一页。"),
    ("无效参数", "弹簧振子：质量 m = -1 kg，劲度系数 k = 0 N/m。"),
    ("纯装饰", "2026 春季学期 · 高等数学 · 第 3 讲"),
)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _new_presentation(title: str) -> Presentation:
    presentation = Presentation()
    presentation.slide_width = SLIDE_WIDTH
    presentation.slide_height = SLIDE_HEIGHT
    presentation.core_properties.title = title
    presentation.core_properties.author = GENERATOR_VERSION
    return presentation


def _add_text_slide(presentation: Presentation, text: str) -> None:
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    box = slide.shapes.add_textbox(Inches(0.7), Inches(0.7), Inches(11.9), Inches(5.8))
    frame = box.text_frame
    frame.word_wrap = True
    for index, line in enumerate(text.split("\n")):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        paragraph.text = line
        paragraph.font.size = Pt(20)


def _case_filename(split: str, template_id: str, index: int) -> str:
    return f"{split}_{template_id.replace('.', '_')}_{index:02d}.pptx"


def _build_positive(split: str, case: TemplateCase, index: int) -> dict[str, Any]:
    material_id = f"{split}_{case.template_id.replace('.', '_')}_{index:02d}"
    presentation = _new_presentation(material_id)
    labels = []
    for page_no, variant in enumerate(case.variants, start=1):
        _add_text_slide(presentation, variant.text)
        labels.append(
            {
                "page_no": page_no,
                "expected_template": case.template_id,
                "expected_category": case.category,
                "expected_status": variant.expected_status,
                "variant": variant.key,
                "required_values": variant.required,
                "missing": list(variant.missing),
                "evidence": variant.text,
                "note": variant.note,
            }
        )
    path = OUT_DIR / split / f"{material_id}.pptx"
    path.parent.mkdir(parents=True, exist_ok=True)
    presentation.save(path)
    return {
        "material_id": material_id,
        "file": f"{split}/{path.name}",
        "split": split,
        "family_id": f"family_{case.template_id}",
        "template_id": case.template_id,
        "kind": "positive_variant",
        "license": "repository-generated",
        "source": "controlled-variant",
        "labels": labels,
    }


def _build_negative(split: str, index: int, name: str, text: str) -> dict[str, Any]:
    material_id = f"{split}_neg_{index:02d}"
    presentation = _new_presentation(material_id)
    _add_text_slide(presentation, text)
    _add_text_slide(presentation, "备注：本页没有需要执行的交互模板。")
    path = OUT_DIR / split / f"{material_id}.pptx"
    path.parent.mkdir(parents=True, exist_ok=True)
    presentation.save(path)
    return {
        "material_id": material_id,
        "file": f"{split}/{path.name}",
        "split": split,
        "family_id": f"family_negative_{name}",
        "template_id": None,
        "kind": "negative",
        "license": "repository-generated",
        "source": "controlled-variant",
        "labels": [
            {
                "page_no": 1,
                "expected_template": None,
                "expected_category": "text",
                "expected_status": "explanation_only",
                "variant": name,
                "required_values": {},
                "missing": [],
                "evidence": text,
                "note": "负例：不得自动生成计算交互。",
            }
        ],
    }


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    materials: list[dict[str, Any]] = []
    for split in SPLITS:
        for case in POSITIVE_CASES:
            # 每个 split 各一份材料，内含 A/B/C 三种措辞；受控回归集不代表真盲测。
            materials.append(_build_positive(split, case, 1))
        negatives = NEGATIVE_TEXTS[: 6 if split == "dev" else 7]
        for index, (name, text) in enumerate(negatives, start=1):
            materials.append(_build_negative(split, index, name, text))
    manifest = {
        "generated_at": _now(),
        "generator": GENERATOR_VERSION,
        "corpus_version": "corpus-v2.1",
        "description": "受控变体语料：不是真实陌生 PPT 验收；用于混合匹配回归与负例测试。",
        "splits": {
            split: [item["material_id"] for item in materials if item["split"] == split]
            for split in SPLITS
        },
        "materials": materials,
        "stats": {
            "materials": len(materials),
            "positive_materials": sum(1 for item in materials if item["kind"] == "positive_variant"),
            "negative_materials": sum(1 for item in materials if item["kind"] == "negative"),
            "annotated_regions": sum(len(item["labels"]) for item in materials),
            "templates": len(POSITIVE_CASES),
        },
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"corpus-v2: {manifest['stats']['materials']} 份材料，"
        f"{manifest['stats']['positive_materials']} 正例 / {manifest['stats']['negative_materials']} 负例，"
        f"{manifest['stats']['annotated_regions']} 个标注区域"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

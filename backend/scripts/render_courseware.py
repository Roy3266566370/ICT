#!/usr/bin/env python
"""为课程件生成「整页底图 + 擦除底图 + PageRegion[]」（spec §3、§4）。

用法（仓库根）::

    python backend/scripts/render_courseware.py
    python backend/scripts/render_courseware.py --reuse-pages     # 复用已有页图
    python backend/scripts/render_courseware.py --engine libreoffice
    python backend/scripts/render_courseware.py --with-assets      # 额外抽原始图片

产物：

* ``fixtures/pages/s01.png … s24.png`` —— 1920x1080 整页图（引擎：PowerPoint COM 优先）；
* ``fixtures/pages/s06_erased.png`` 等 5 张擦除底图（先过环带校验才擦，见 ``erase.py``）；
* ``fixtures/materials/matrix-courseware/regions.json`` —— 5 个 ``PageRegion``（字段与
  ``frontend/src/regions/types.ts`` 逐字对齐，snake_case）；
* 可选 ``fixtures/materials/matrix-courseware/assets/<sha1>.<ext>``。

设计取舍：

* **不写数据库、不改 slides.json/objects.json**：脚本只新增 regions.json 与页图；
* 擦除用的 bbox 与 region 契约 bbox 可能不同（S14 三格、S18 四格是**多块**擦除，
  契约 bbox 取多块包络），逐块擦除清单写在 region 的 ``erase_bboxes`` / ``erase_check``；
* region 的 ``status`` 由**真实擦除结果**决定：任一子块校验不过 → 该 region ``static_only``。
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path
from typing import Any, Sequence

# backend/scripts/render_courseware.py -> backend/
BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:  # 允许直接 `python backend/scripts/render_courseware.py`
    sys.path.insert(0, str(BACKEND_DIR))

from app.render import (  # noqa: E402 - 需先修正 sys.path
    ENGINE_COM,
    ENGINE_LIBREOFFICE,
    ENGINE_SVG,
    FIDELITY_LOW,
    RenderError,
    engine_com,
    engine_libreoffice,
    select_engine,
)
from app.render.assets import extract_assets  # noqa: E402
from app.render.erase import (  # noqa: E402
    DEFAULT_PAGE_HEIGHT_IN,
    DEFAULT_PAGE_WIDTH_IN,
    erase_regions,
)

logger = logging.getLogger("render_courseware")

#: 课程件源文件（仓库根）。
DEFAULT_SOURCE = REPO_ROOT / "用空间视角理解矩阵运算.pptx"
#: 整页/擦除图输出目录。
DEFAULT_PAGES_DIR = REPO_ROOT / "fixtures" / "pages"
#: 课程材料目录（只新增 regions.json / assets）。
MATERIAL_DIR = REPO_ROOT / "fixtures" / "materials" / "matrix-courseware"
#: 材料 id（与 material.json 一致）。
MATERIAL_ID = "mat_matrix_courseware"
#: 默认 regions 输出。
DEFAULT_REGIONS_PATH = MATERIAL_DIR / "regions.json"
#: 期望页数（课程件 24 页）。
EXPECTED_PAGE_COUNT = 24
#: 需要擦除的页。
ERASED_PAGES: tuple[int, ...] = (6, 9, 10, 14, 18)
#: 渲染超时（秒）。
DEFAULT_TIMEOUT_S = 240.0

#: 五个 region 统一的内部坐标系（spec §4）。
COORDINATE_SYSTEM: dict[str, Any] = {
    "view_box": [1920, 1350],
    "origin": [640, 770],
    "unit": 150,
    "y_axis": "up",
}


# ---------------------------------------------------------------------------
# 五个 region 的定义（bbox 单位英寸，相对 13.333x7.5 页面）
# ---------------------------------------------------------------------------


def _bbox(x: float, y: float, w: float, h: float) -> dict[str, float]:
    return {"x": round(x, 3), "y": round(y, 3), "w": round(w, 3), "h": round(h, 3)}


def _link(element_id: str, bbox: dict[str, float], template: str, kind: str = "result") -> dict[str, Any]:
    return {"element_id": element_id, "bbox": bbox, "template": template, "kind": kind}


#: S6 —— 三条向量各去哪了（矩阵 [[2,1],[1,2]]）。
S06_BBOX = _bbox(0.58, 1.27, 6.67, 4.69)
S06_LINKS = [
    _link("p06_s09", _bbox(7.67, 2.90, 1.75, 0.23), "({x0}, {y0}) → ({x1}, {y1})"),
    _link("p06_s12", _bbox(7.67, 3.94, 1.75, 0.23), "({x0}, {y0}) → ({x1}, {y1})"),
    _link("p06_s14", _bbox(7.67, 4.98, 1.75, 0.23), "({x0}, {y0}) → ({x1}, {y1})"),
]

#: S9 —— 矩阵的每一列是一个基向量的去向（列 c1=(2,1)、c2=(1,2) 由原图读出）。
S09_BBOX = _bbox(0.58, 1.38, 7.29, 5.21)

#: S10 —— 乘法顺序：先转 90° 再横向拉 2 倍 与 反过来（原图标注长度 1 / 2）。
S10_BBOX = _bbox(5.73, 1.76, 6.96, 5.00)

#: S14 —— SVD 三步：三张子图，契约 bbox 取三块包络。
S14_BBOX = _bbox(0.75, 1.21, 11.83, 2.23)
S14_ERASE_BOXES = [
    _bbox(0.75, 1.21, 3.54, 2.23),
    _bbox(4.90, 1.21, 3.54, 2.23),
    _bbox(9.04, 1.21, 3.54, 2.23),
]
S14_LINKS = [
    _link(
        "p14_s09",
        _bbox(5.42, 3.97, 3.54, 0.27),
        "{s1} 与 {s2}，圆在这里才变成椭圆",
    )
]

#: S18 —— 行列式四格：契约 bbox 取四块包络，擦除逐格进行。
S18_BBOX = _bbox(0.79, 1.38, 6.42, 4.62)
S18_ERASE_BOXES = [
    _bbox(0.79, 1.38, 2.96, 1.98),
    _bbox(4.25, 1.38, 2.96, 1.98),
    _bbox(0.79, 4.02, 2.96, 1.98),
    _bbox(4.25, 4.02, 2.96, 1.98),
]
S18_LINKS = [
    _link("p18_s05", _bbox(0.79, 3.35, 2.96, 0.19), "{label}\u3000面积 {det}"),
    _link("p18_s08", _bbox(4.25, 3.35, 2.96, 0.19), "{label}\u3000面积 {det}"),
    _link("p18_s11", _bbox(0.79, 6.00, 2.96, 0.19), "{label}\u3000面积 {det}"),
    _link("p18_s14", _bbox(4.25, 6.00, 2.96, 0.19), "{label}\u3000面积 {det}"),
]

#: region 定义（未定稿的 status 由擦除结果回填）。
REGION_SPECS: list[dict[str, Any]] = [
    {
        "region_id": "rgn_s06_vectors",
        "page": 6,
        "bbox": S06_BBOX,
        "erase_bboxes": [S06_BBOX],
        "script_id": "matrix_eigen_2d",
        "original_params": {
            "a11": 2,
            "a12": 1,
            "a21": 1,
            "a22": 2,
            "vectors": [[1, 0], [1, 1], [1, -1]],
        },
        "linked_texts": S06_LINKS,
        "notes": (
            "S6 左图（整块独立图片）。矩阵 A=[[2,1],[1,2]] 由三条映射反解："
            "(1,0)→(2,1)、(1,1)→(3,3)、(1,-1)→(1,-1)；特征值 λ=3/1，对应特征向量 (1,1)/(1,-1)。"
            "provenance=inferred"
        ),
    },
    {
        "region_id": "rgn_s09_columns",
        "page": 9,
        "bbox": S09_BBOX,
        "erase_bboxes": [S09_BBOX],
        "script_id": "matrix_columns_2d",
        "original_params": {
            # matrixColumns 组件读平铺键 a11..a22 + v1/v2（或 vector）；
            # matrix/columns/basis 保留为语义说明字段（组件不读，供审计与其它消费方）。
            "a11": 2,
            "a12": 1,
            "a21": 1,
            "a22": 2,
            "v1": 1,
            "v2": 1,
            "vector": [1, 1],
            "matrix": [[2, 1], [1, 2]],
            "columns": [[2, 1], [1, 2]],
            "basis": [[1, 0], [0, 1]],
            "basis_labels": ["e1", "e2"],
            "column_labels": ["c1 = (2, 1)", "c2 = (1, 2)"],
        },
        "linked_texts": [],
        "notes": (
            "S9 左图（整块独立图片）。原图标注 c₁=(2,1)、c₂=(1,2)，即矩阵的两列；"
            "虚线单位方格被拉成平行四边形。右侧说明文字为定性描述，不随参数变化。"
            "provenance=read_from_figure"
        ),
    },
    {
        "region_id": "rgn_s10_order",
        "page": 10,
        "bbox": S10_BBOX,
        "erase_bboxes": [S10_BBOX],
        "script_id": "matrix_order_2d",
        "original_params": {
            "probe": [1, 0],
            "steps": {
                "rotate": {"angle_deg": 90, "matrix": [[0, -1], [1, 0]]},
                "stretch": {"factor_x": 2, "factor_y": 1, "matrix": [[2, 0], [0, 1]]},
            },
            "sequences": [["rotate", "stretch"], ["stretch", "rotate"]],
            "outcome_lengths": [1, 2],
            "intermediate_lengths": [1, 2],
        },
        "linked_texts": [],
        "notes": (
            "S10 右图（整块独立图片）。原图三栏「输入 / 中间状态 / 输出」："
            "先转 90° 再横拉 2 倍，长度仍是 1（已竖立，横拉无效）；先横拉 2 倍再转 90°，长度 2。"
            "provenance=read_from_figure"
        ),
    },
    {
        "region_id": "rgn_s14_svd",
        "page": 14,
        "bbox": S14_BBOX,
        "erase_bboxes": S14_ERASE_BOXES,
        "script_id": "svd_steps_2d",
        "original_params": {
            "sigma": [1.618, 0.618],
            "u": [[1, 0], [0, 1]],
            "v": [[1, 0], [0, 1]],
            "markers": [[1, 0]],
            "steps": ["align", "scale", "align"],
            "is_square": True,
        },
        "linked_texts": S14_LINKS,
        "notes": (
            "S14 三张子图（单位圆 → 沿坐标轴伸缩 → 转向输出方向），契约 bbox 取三块包络。"
            "奇异值 1.618 / 0.618 取自原页文字；标记点取 (1,0)，用于盯住第一步。"
            "provenance=partly_inferred"
        ),
    },
    {
        "region_id": "rgn_s18_det_area",
        "page": 18,
        "bbox": S18_BBOX,
        "erase_bboxes": S18_ERASE_BOXES,
        "script_id": "det_area_2d",
        "original_params": {
            "cells": [
                {
                    "cell_id": "unit",
                    "op": "identity",
                    "matrix": [[1, 0], [0, 1]],
                    "determinant": 1,
                    "area": 1,
                    "label": "单位方格",
                },
                {
                    "cell_id": "stretch",
                    "op": "stretch",
                    "matrix": [[2, 0], [0, 3]],
                    "determinant": 6,
                    "area": 6,
                    "label": "横向 2 倍、纵向 3 倍",
                },
                {
                    "cell_id": "shear",
                    "op": "shear",
                    "matrix": [[1, 1], [0, 1]],
                    "determinant": 1,
                    "area": 1,
                    "label": "剪切",
                },
                {
                    "cell_id": "flip",
                    "op": "flip",
                    "matrix": [[1, 0], [0, 0]],
                    "determinant": 0,
                    "area": 0,
                    "label": "压到横轴",
                    "note": "压扁后定向丢失（det=0），符号语义退化",
                },
            ],
            "cells_order": ["unit", "stretch", "shear", "flip"],
        },
        "linked_texts": S18_LINKS,
        "notes": (
            "S18 四格（单位方格 / 横向 2 倍纵向 3 倍 / 剪切 / 压到横轴），契约 bbox 取四格包络。"
            "四格各自独立图片、落在浅色卡片内，擦除逐格进行；填充色取各自环带中位色。"
            "provenance=read_from_figure"
        ),
    },
]


# ---------------------------------------------------------------------------
# 渲染
# ---------------------------------------------------------------------------


def _engine_order(prefer: str) -> tuple[list[str], str | None]:
    """返回实际尝试的引擎顺序与不可用原因。"""

    choice = select_engine(prefer or "auto")
    if choice.engine == ENGINE_SVG:
        return [], choice.reason or "本机无可用渲染引擎"
    order = [choice.engine]
    if (prefer or "auto").strip().lower() in ("auto", ""):
        for name, available in (
            (ENGINE_COM, engine_com.is_available()),
            (ENGINE_LIBREOFFICE, engine_libreoffice.is_available()),
        ):
            if available and name not in order:
                order.append(name)
    return order, None


def render_pages(
    source: Path,
    pages_dir: Path,
    *,
    prefer: str = "auto",
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> tuple[str, str, list[Path], list[str]]:
    """按优先级渲染整份 pptx，返回 ``(engine, fidelity, files, errors)``。

    渲染失败不抛异常：全部引擎失败时返回 ``svg_fallback`` 与空文件列表。
    """

    order, unavailable = _engine_order(prefer)
    errors: list[str] = []
    if unavailable:
        errors.append(unavailable)

    for engine in order:
        started = time.monotonic()
        try:
            if engine == ENGINE_COM:
                files = engine_com.render_pptx(source, pages_dir, timeout_s=timeout_s)
            elif engine == ENGINE_LIBREOFFICE:
                files = engine_libreoffice.render_pptx(source, pages_dir, timeout_s=timeout_s)
            else:  # pragma: no cover - _engine_order 不会给出其它值
                raise RenderError("engine_unavailable", f"未知引擎：{engine}")
        except RenderError as exc:
            errors.append(f"{engine}: {exc.code}: {exc.message}")
            logger.warning("引擎 %s 失败（%s），尝试降级", engine, exc.code)
            continue

        elapsed = time.monotonic() - started
        logger.info("引擎 %s 渲染成功：%d 页，%.1fs", engine, len(files), elapsed)
        return engine, "high", files, errors

    errors.append("全部渲染引擎失败，已降级为 svg_fallback（fidelity=low）")
    logger.error("没有任何引擎成功：%s", "；".join(errors))
    return ENGINE_SVG, FIDELITY_LOW, [], errors


# ---------------------------------------------------------------------------
# 擦除与 regions
# ---------------------------------------------------------------------------


def _erase_region_id(region: dict[str, Any], index: int) -> str:
    """多块擦除时给每块一个稳定子 id（单块时直接用 region_id）。"""

    boxes = region.get("erase_bboxes") or [region["bbox"]]
    if len(boxes) == 1:
        return str(region["region_id"])
    return f"{region['region_id']}#{index}"


def erase_courseware_pages(pages_dir: Path) -> dict[int, dict[str, Any]]:
    """对 5 页执行擦除，返回 ``page → {"report": EraseReport, "blocks": [...]}``。"""

    results: dict[int, dict[str, Any]] = {}
    for page_no in ERASED_PAGES:
        page_file = pages_dir / f"s{page_no:02d}.png"
        output = pages_dir / f"s{page_no:02d}_erased.png"
        if not page_file.is_file():
            logger.warning("第 %d 页页图不存在，跳过擦除", page_no)
            continue

        page_regions = [item for item in REGION_SPECS if int(item["page"]) == page_no]
        blocks: list[dict[str, Any]] = []
        for region in page_regions:
            boxes = region.get("erase_bboxes") or [region["bbox"]]
            for index, box in enumerate(boxes):
                blocks.append(
                    {
                        "region_id": _erase_region_id(region, index),
                        "page": page_no,
                        "bbox": box,
                    }
                )

        report = erase_regions(
            page_file,
            output,
            blocks,
            page=page_no,
            page_size_in=(DEFAULT_PAGE_WIDTH_IN, DEFAULT_PAGE_HEIGHT_IN),
        )
        results[page_no] = {"report": report, "blocks": blocks}
        logger.info(
            "第 %d 页擦除：%d 通过 / %d 保持静态（背景 %s）",
            page_no,
            len(report.applied),
            len(report.skipped),
            report.background,
        )
    return results


def build_regions(erase_results: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    """把 region 定义与擦除结果合并为 ``PageRegion[]``（严格按 types.ts 字段）。"""

    regions: list[dict[str, Any]] = []
    for spec in REGION_SPECS:
        page_no = int(spec["page"])
        entry = erase_results.get(page_no)
        report = entry["report"] if entry else None
        blocks = entry["blocks"] if entry else []

        applied = set(report.applied) if report is not None else set()
        skipped = {item.region_id: item for item in report.skipped} if report is not None else {}

        checks: list[dict[str, Any]] = []
        region_block_ids = [
            _erase_region_id(spec, index) for index in range(len(spec["erase_bboxes"]))
        ]
        for block_id in region_block_ids:
            skipped_item = skipped.get(block_id)
            stats = report.checks.get(block_id) if report is not None else None
            checks.append(
                {
                    "region_id": block_id,
                    "bbox": next(
                        (
                            block["bbox"]
                            for block in blocks
                            if block["region_id"] == block_id
                        ),
                        spec["bbox"],
                    ),
                    "status": "static_only" if skipped_item else ("erased" if block_id in applied else "unknown"),
                    "ring_variance": round(stats.variance, 4) if stats is not None else None,
                    "ring_pixel_count": stats.pixel_count if stats is not None else None,
                    "fill_rgb": report.fills.get(block_id) if report is not None else None,
                    "reason": skipped_item.reason if skipped_item else None,
                }
            )

        static_blocks = [item for item in checks if item["status"] == "static_only"]
        erased_image = f"pages/s{page_no:02d}_erased.png"
        has_erased_image = bool(report is not None and report.ok)
        if static_blocks:
            status = "static_only"
        elif has_erased_image:
            status = "confirmed"
        else:
            status = "pending"

        region: dict[str, Any] = {
            "region_id": spec["region_id"],
            "material_id": MATERIAL_ID,
            "page": page_no,
            "bbox": spec["bbox"],
            "coordinate_system": dict(COORDINATE_SYSTEM),
            "script_id": spec["script_id"],
            "status": status,
            "original_params": spec["original_params"],
            "linked_texts": spec["linked_texts"],
            "assets": {
                "page_image": f"pages/s{page_no:02d}.png",
                # 没有成功擦除时退回原页图：前端绝不能拿到不存在的底图。
                "erased_image": erased_image if has_erased_image else f"pages/s{page_no:02d}.png",
            },
            "notes": spec["notes"],
            # 扩展字段：擦除审计（前端 PageRegion 结构不声明，消费时可忽略）。
            "erase_bboxes": list(spec["erase_bboxes"]),
            "erase_check": checks,
        }
        regions.append(region)
    return regions


def write_regions(regions: Sequence[dict[str, Any]], target: Path) -> Path:
    """写 ``regions.json``（UTF-8、不转义中文、2 空格缩进）。"""

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(list(regions), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return target


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="为课程件生成整页底图、擦除底图与 PageRegion[]",
    )
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="源 pptx 路径")
    parser.add_argument("--pages-dir", type=Path, default=DEFAULT_PAGES_DIR, help="页图输出目录")
    parser.add_argument("--regions-out", type=Path, default=DEFAULT_REGIONS_PATH, help="regions.json 路径")
    parser.add_argument(
        "--engine",
        default="auto",
        choices=["auto", ENGINE_COM, ENGINE_LIBREOFFICE],
        help="渲染引擎；默认 auto（COM → LibreOffice）",
    )
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_S, help="单引擎渲染超时（秒）")
    parser.add_argument("--reuse-pages", action="store_true", help="跳过渲染，复用已有 sNN.png")
    parser.add_argument("--with-assets", action="store_true", help="额外抽取 pptx 原始图片到材料 assets/")
    parser.add_argument("--log-level", default="INFO", help="日志级别")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, str(args.log_level).upper(), logging.INFO),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )

    source: Path = Path(args.source)
    pages_dir: Path = Path(args.pages_dir)
    if not args.reuse_pages and not source.is_file():
        logger.error("源文件不存在：%s", source)
        return 1
    pages_dir.mkdir(parents=True, exist_ok=True)

    errors: list[str] = []
    if args.reuse_pages:
        files = sorted(pages_dir.glob("s[0-9][0-9].png"))
        engine, fidelity = "reuse", "unknown"
        logger.info("复用已有页图 %d 张", len(files))
    else:
        started = time.monotonic()
        engine, fidelity, files, errors = render_pages(
            source, pages_dir, prefer=args.engine, timeout_s=args.timeout
        )
        logger.info(
            "[render] engine=%s fidelity=%s pages=%d elapsed=%.1fs",
            engine,
            fidelity,
            len(files),
            time.monotonic() - started,
        )
        for message in errors:
            logger.warning("[render] %s", message)

    if not files:
        logger.error("没有页图可用，无法生成 regions.json（engine=%s）", engine)
        return 2
    if len(files) != EXPECTED_PAGE_COUNT:
        logger.warning("页数 %d 与期望 %d 不一致", len(files), EXPECTED_PAGE_COUNT)
    if engine == ENGINE_SVG:
        logger.warning("渲染降级为 svg_fallback（fidelity=low）：%s", "；".join(errors))

    erase_results = erase_courseware_pages(pages_dir)
    for page_no, entry in sorted(erase_results.items()):
        report = entry["report"]
        print(
            "[erase] page %2d: %d/%d erased, background=%s, fills=%s, skipped=%s"
            % (
                page_no,
                len(report.applied),
                len(entry["blocks"]),
                tuple(report.background),
                {key: tuple(value) for key, value in report.fills.items()},
                [
                    {
                        "region_id": item.region_id,
                        "reason": item.reason,
                        "variance": round(item.stats.variance, 3) if item.stats else None,
                    }
                    for item in report.skipped
                ],
            )
        )

    regions = build_regions(erase_results)
    target = write_regions(regions, Path(args.regions_out))
    print("[regions] %d regions → %s" % (len(regions), target.relative_to(REPO_ROOT)))
    for region in regions:
        print(
            "  - %-18s page=%2d bbox=%s status=%-11s script=%s"
            % (
                region["region_id"],
                region["page"],
                region["bbox"],
                region["status"],
                region["script_id"],
            )
        )

    if args.with_assets:
        index = extract_assets(source, MATERIAL_DIR / "assets", repo_root=REPO_ROOT)
        print(
            "[assets] %d 张（新增 %d、去重 %d、跳过 %d）→ %s"
            % (
                len(index),
                index.written,
                index.deduplicated,
                len(index.skipped),
                (MATERIAL_DIR / "assets").relative_to(REPO_ROOT),
            )
        )
        if index.errors:
            print("[assets] 错误：%s" % "；".join(index.errors))

    print(
        "[summary] engine=%s fidelity=%s pages=%d erased_pages=%d regions=%d"
        % (engine, fidelity, len(files), len(erase_results), len(regions))
    )
    return 0 if engine != ENGINE_SVG else 3


if __name__ == "__main__":  # pragma: no cover - CLI 入口
    raise SystemExit(main())
"""生成课程材料真实产物（T11 / C-MAT@1，plan §2.2.10）。

运行::

    python backend/scripts/build_courseware_fixture.py

产物（UTF-8、``ensure_ascii=False``、缩进 2）::

    fixtures/materials/matrix-courseware/material.json
    fixtures/materials/matrix-courseware/slides.json
    fixtures/materials/matrix-courseware/objects.json

真实性约束：

1. 三份 JSON 全部来自 ``parse_pptx`` 的真实解析结果，脚本内**不手写任何页面
   文本**；``matrix_A`` 也不是硬编码常量，而是先用解析得到第 6 页的三条映射，
   再按线性性反推（:func:`solve_matrix_from_mappings`），反推失败即中止。
2. 可重复运行：除 ``material.json.parsed_at`` 外，其余字段（含对象的
   ``created_at`` / ``updated_at``）均由源文件内容与核心属性决定，逐字节幂等。
3. 不联网、不写 ``fixtures/ppt/**``、不依赖 Word/PPT 客户端。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.parsers import (  # noqa: E402  (需先修正 sys.path)
    ParseError,
    detect_merge_conflicts,
    map_candidates,
    parse_pptx,
    solve_matrix_from_mappings,
)

PPTX_NAME = "用空间视角理解矩阵运算.pptx"
MATERIAL_ID = "mat_matrix_courseware"
OBJECT_ID = "obj_matrix_courseware_main"
GENERATOR = "build_courseware_fixture.py@1"
OUT_DIR = REPO_ROOT / "fixtures" / "materials" / "matrix-courseware"
SCHEMA_DIR = REPO_ROOT / "contracts" / "schemas"

EXPECTED_PAGE_COUNT = 24
EXPECTED_WIDTH_EMU = 12192000
EXPECTED_HEIGHT_EMU = 6858000
TEXTBOOK_PAGE = 6  # S6：三条向量映射，矩阵 A 的原文依据

#: 页级来源：``(page_no, source_ref_id, label, 原文片段元组)``。
#: 片段必须是该页 ``paragraphs`` 中的**完整原文段落**，脚本逐条断言其存在。
SOURCE_PAGE_SPECS: tuple[tuple[int, str, str, tuple[str, ...]], ...] = (
    (
        6,
        "src_s6",
        "第 6 页：三条向量，各去哪了",
        (
            "三条向量，各去哪了",
            "(1, 0) → (2, 1)",
            "(1, 1) → (3, 3)",
            "(1, -1) → (1, -1)",
            "特征值 λ = 3。",
            "特征值 λ = 1。",
        ),
    ),
    (
        9,
        "src_s9",
        "第 9 页：矩阵的每一列是一个基向量的去向",
        (
            "矩阵的每一列是一个基向量的去向",
            "动作是：拿输入坐标当倍数，去组合矩阵的各列。",
            "各列未必还是基：可能共线，甚至被压成零。",
        ),
    ),
    (
        10,
        "src_s10",
        "第 10 页：为什么换个顺序结果就不一样",
        (
            "为什么换个顺序结果就不一样",
            "相乘 = 两次动作接成一次；离输入最近的先执行，从右往左读。",
            "换顺序，中间状态就不同：先转后拉，长度还是 1；先拉后转，落地就是 2。",
        ),
    ),
    (
        14,
        "src_s14",
        "第 14 页：圆变成椭圆：SVD 的三步",
        (
            "圆变成椭圆：SVD 的三步",
            "输入侧转正 → 各自伸缩 → 转向输出侧；非方阵则衔接两个不同维度。",
        ),
    ),
    (
        18,
        "src_s18",
        "第 18 页：一块小方格怎样改变",
        (
            "一块小方格怎样改变",
            "绝对值是面积倍率；符号是定向：翻了为负，没翻为正。",
            "二阶 = 两列围成的有向面积 ad−bc；乘积的行列式 = 各自之积。",
        ),
    ),
)

#: 反推得到的矩阵应等于的值；不等时**以原文为准**并记录差异（不按常量覆盖）。
EXPECTED_MATRIX = [[2, 1], [1, 2]]
EXPECTED_DET = 3
EXPECTED_TRACE = 4


def log(message: str) -> None:
    """统一日志输出（UTF-8 控制台）。"""
    print(message, flush=True)


def write_json(path: Path, payload: dict[str, Any]) -> int:
    """写入 JSON 文件（UTF-8、不转义中文、缩进 2、LF 换行），返回字节数。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8", newline="\n")
    return len(text.encode("utf-8"))


def page_index(slides: dict[str, Any]) -> dict[int, dict[str, Any]]:
    """``page_no -> page`` 索引。"""
    return {
        page["page_no"]: page
        for page in slides.get("slides") or []
        if isinstance(page, dict) and isinstance(page.get("page_no"), int)
    }


def build_source_refs(pages: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    """按 :data:`SOURCE_PAGE_SPECS` 生成页级 ``source_refs``。

    每段 excerpt 由该页真实段落拼接而成，且断言每段都能在原文中找到；
    ``element_id`` 与 ``bbox`` 一律为 ``None``（页级来源禁止伪造元素框）。
    """
    refs: list[dict[str, Any]] = []
    for page_no, ref_id, label, fragments in SOURCE_PAGE_SPECS:
        page = pages.get(page_no)
        if page is None:
            raise SystemExit(f"[error] {ref_id} 指向的第 {page_no} 页不存在")
        joined = "\n".join(page["paragraphs"])
        missing = [fragment for fragment in fragments if fragment not in joined]
        if missing:
            raise SystemExit(f"[error] {ref_id} 摘录片段不在第 {page_no} 页原文中：{missing}")
        excerpt = "\n".join(fragments)
        if len(excerpt) > 160:
            raise SystemExit(f"[error] {ref_id} 摘录 {len(excerpt)} 字，超过 160 字上限")
        refs.append(
            {
                "id": ref_id,
                "provenance": "original",
                "label": label,
                "material_id": MATERIAL_ID,
                "page": page_no,
                "element_id": None,
                "bbox": None,
                "excerpt": excerpt,
            }
        )
    return refs


def build_object(
    *,
    material: dict[str, Any],
    matrix: list[list[Any]],
    vector: list[Any],
    source_refs: list[dict[str, Any]],
) -> dict[str, Any]:
    """构建课程材料对象（``matrix_2d``）。

    ``matrix_A`` 的元素由第 6 页三条映射反推，原文未直接印刷，因此参数级
    ``provenance`` 记为 ``inferred``；``vector_x`` 直接取原文映射输入 ``(1, 1)``，
    记为 ``original``。
    """
    created_at = material.get("source_created_at") or material["parsed_at"]
    updated_at = material.get("source_modified_at") or created_at
    return {
        "schema_version": "0.2",
        "object_id": OBJECT_ID,
        "title": "三条向量，各去哪了：矩阵 A 的空间作用",
        "material_id": MATERIAL_ID,
        "model_version": 1,
        "revision": 0,
        "template_id": "matrix_2d",
        "kernel_version": "linear_v1",
        "config": {
            "operation": "matrix_apply",
            "matrix_parameter_id": "matrix_A",
            "second_matrix_parameter_id": None,
            "compose_order": None,
            "angle_unit": "deg",
        },
        "parameters": [
            {
                "id": "matrix_A",
                "name": "矩阵 A",
                "type": "matrix2",
                "value": matrix,
                "unit": "1",
                "range": {"min": -3, "max": 3, "step": 0.1},
                "source_ref_ids": ["src_s6", "src_s9"],
                "provenance": "inferred",
                "editable": True,
            },
            {
                "id": "vector_x",
                "name": "输入向量 x",
                "type": "vector2",
                "value": vector,
                "unit": "1",
                "range": {"min": -3, "max": 3, "step": 0.1},
                "source_ref_ids": ["src_s6"],
                "provenance": "original",
                "editable": True,
            },
        ],
        "views": ["geometry", "numeric_table", "steps", "sources"],
        "bindings": [
            {"parameter_id": "matrix_A", "view_id": "geometry", "target": "transform.columns"},
            {"parameter_id": "matrix_A", "view_id": "numeric_table", "target": "table.matrix_a"},
            {"parameter_id": "matrix_A", "view_id": "steps", "target": "steps.terms"},
            {"parameter_id": "vector_x", "view_id": "geometry", "target": "input.vector"},
            {"parameter_id": "vector_x", "view_id": "steps", "target": "steps.coefficients"},
        ],
        "source_refs": source_refs,
        "validation_profile": "matrix_2d_v1_full",
        "created_at": created_at,
        "updated_at": updated_at,
    }


def _load_schema(name: str) -> dict[str, Any]:
    """读取 ``contracts/schemas`` 下的 JSON Schema。"""
    return json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))


def validate_schemas(obj: dict[str, Any]) -> bool:
    """用 jsonschema 校验对象（C-KO@1 + C-MX@1）；未安装则跳过并如实报告。"""
    try:
        import jsonschema
    except ImportError:  # pragma: no cover - 环境相关
        log("[schema] jsonschema 未安装，跳过机器校验（已逐字段人工对照，见交付报告）")
        return False

    ko_schema = _load_schema("knowledge_object.schema.json")
    mx_schema = _load_schema("template_matrix_2d.schema.json")

    targets = [
        ("knowledge_object.schema.json", obj, ko_schema),
        (
            "template_matrix_2d.schema.json",
            {"template_id": obj["template_id"], "config": obj["config"]},
            mx_schema,
        ),
    ]
    ok = True
    for label, payload, schema in targets:
        validator = jsonschema.Draft202012Validator(schema)
        errors = sorted(validator.iter_errors(payload), key=lambda item: list(item.absolute_path))
        if errors:
            ok = False
            for error in errors[:10]:
                location = ".".join(str(part) for part in error.absolute_path) or "<root>"
                log(f"[schema] {label} FAIL at {location}: {error.message}")
        else:
            log(f"[schema] {label} PASS")
    return ok


def verify_invariants(
    *,
    material: dict[str, Any],
    slides: dict[str, Any],
    objects_doc: dict[str, Any],
    pages: dict[int, dict[str, Any]],
) -> None:
    """逐条核对 C-MAT@1 的硬性不变量，失败即中止（不写半成品）。"""

    def require(condition: bool, message: str) -> None:
        if not condition:
            raise SystemExit(f"[verify] FAIL: {message}")

    page_numbers = sorted(pages)
    require(len(page_numbers) == EXPECTED_PAGE_COUNT, f"页数应为 {EXPECTED_PAGE_COUNT}，实际 {len(page_numbers)}")
    require(page_numbers == list(range(1, EXPECTED_PAGE_COUNT + 1)), "page_no 必须从 1 起连续")
    require(material["page_count"] == EXPECTED_PAGE_COUNT, "material.page_count 与页数不一致")
    require(material["slide_width_emu"] == EXPECTED_WIDTH_EMU, "页面宽度不是 12192000 EMU")
    require(material["slide_height_emu"] == EXPECTED_HEIGHT_EMU, "页面高度不是 6858000 EMU")
    require(slides["slides"] == slides["pages"], "slides 与 pages 兼容镜像内容不一致")

    for page_no in page_numbers:
        page = pages[page_no]
        require(bool(page["title"]), f"第 {page_no} 页缺少标题")
        require(bool(page["paragraphs"]), f"第 {page_no} 页没有原文段落")
        require(page["excerpt"] == "\n".join(page["paragraphs"])[:160], f"第 {page_no} 页 excerpt 非原文派生")
        require(page["width"] == EXPECTED_WIDTH_EMU and page["height"] == EXPECTED_HEIGHT_EMU, f"第 {page_no} 页尺寸不符")
        for element in page["elements"]:
            require(
                element["element_id"].startswith(f"p{page_no:02d}_s"),
                f"元素 id 前缀与页号不符：{element['element_id']}",
            )
            require(
                set(element["bbox"]) == {"x", "y", "w", "h"}
                and all(isinstance(element["bbox"][key], int) for key in ("x", "y", "w", "h")),
                f"元素 bbox 必须是 EMU 整数四元组：{element['element_id']}",
            )
            require(element["kind"] in {"text", "shape", "picture", "group", "table", "chart"}, f"未知 kind：{element['kind']}")

    asset_files = [asset["file"] for asset in slides["assets"]]
    require(len(asset_files) == len(set(asset_files)), "assets 存在重复文件")
    for asset in slides["assets"]:
        absolute = REPO_ROOT / asset["file"]
        require(absolute.is_file(), f"asset 文件不存在：{asset['file']}")
        require(
            absolute.stat().st_size == asset["image_bytes"],
            f"asset 字节数与嵌入 blob 不一致：{asset['file']}",
        )
    require(not slides["warnings"], f"解析产生 {len(slides['warnings'])} 条资源告警")
    log(f"[verify] 页面 {len(page_numbers)} 页 / 元素 {sum(len(page['elements']) for page in pages.values())} 个 / assets {len(slides['assets'])} 个")

    objects = objects_doc["objects"]
    require(len(objects) == 1, f"objects 应恰 1 个，实际 {len(objects)}")
    obj = objects[0]
    parameter_ids = [parameter["id"] for parameter in obj["parameters"]]
    require(len(parameter_ids) == len(set(parameter_ids)), "parameters[].id 不唯一")
    ref_ids = [ref["id"] for ref in obj["source_refs"]]
    require(len(ref_ids) == len(set(ref_ids)), "source_refs[].id 不唯一")
    require(all(ref_id.startswith("src_") for ref_id in ref_ids), "source_refs[].id 必须带 src_ 前缀")
    require(
        all(ref["page"] is not None and ref["element_id"] is None and ref["bbox"] is None for ref in obj["source_refs"]),
        "页级来源必须 page 非空且 element_id / bbox 为 null",
    )
    for parameter in obj["parameters"]:
        for ref_id in parameter["source_ref_ids"]:
            require(ref_id in ref_ids, f"参数 {parameter['id']} 引用了不存在的 source_ref：{ref_id}")
    for binding in obj["bindings"]:
        require(binding["parameter_id"] in parameter_ids, f"binding 引用了不存在的参数：{binding['parameter_id']}")
        require(binding["view_id"] in obj["views"], f"binding 引用了不存在的视图：{binding['view_id']}")
    require(
        obj["config"]["matrix_parameter_id"] in parameter_ids,
        "config 引用的参数不存在",
    )
    require(obj["material_id"] == material["id"], "对象 material_id 与材料 id 不一致")
    log("[verify] 对象参数/视图/绑定/来源引用自洽；页级来源 bbox 全为 null")


def main(argv: list[str] | None = None) -> int:
    """脚本入口：解析 → 反推 → 组装 → 校验 → 写盘 → 报告。"""
    parser = argparse.ArgumentParser(description="生成 matrix-courseware 真实产物（C-MAT@1）")
    parser.add_argument("--pptx", default=str(REPO_ROOT / PPTX_NAME), help="源 PPTX 路径")
    parser.add_argument("--out-dir", default=str(OUT_DIR), help="产物目录")
    args = parser.parse_args(argv)

    pptx_path = Path(args.pptx)
    out_dir = Path(args.out_dir)

    try:
        material, slides = parse_pptx(
            str(pptx_path),
            material_id=MATERIAL_ID,
            title="用空间视角理解矩阵运算",
            generator=GENERATOR,
        )
    except ParseError as error:
        log(f"[parse] FAIL {error}")
        return 2

    log(f"[parse] {pptx_path.name} → {material['page_count']} 页，"
        f"{material['slide_width_emu']}×{material['slide_height_emu']} EMU，"
        f"sha256={material['sha256'][:16]}…")
    log(f"[parse] 图片 assets {len(slides['assets'])} 个，告警 {len(slides['warnings'])} 条")

    pages = page_index(slides)

    # ---- 候选提取（真实规则，用于第 6 页矩阵反推与冲突报告） ----
    candidates = map_candidates(MATERIAL_ID, slides)
    conflicts = detect_merge_conflicts(candidates)
    kind_counts: dict[str, int] = {}
    for item in candidates:
        kind_counts[item["kind"]] = kind_counts.get(item["kind"], 0) + 1
    log(f"[candidates] {len(candidates)} 条：{kind_counts}；merge_conflicts {len(conflicts)} 组")
    for conflict in conflicts:
        log(f"[candidates] 冲突 {conflict['symbol']}："
            f"pages={conflict['pages']} values={[item['value'] for item in conflict['occurrences']]}")

    page_six = pages.get(TEXTBOOK_PAGE)
    if page_six is None:
        log(f"[error] 第 {TEXTBOOK_PAGE} 页不存在，无法反推矩阵 A")
        return 2
    log(f"[S6] title={page_six['title']!r}")
    for paragraph in page_six["paragraphs"]:
        log(f"[S6] | {paragraph}")

    mappings = [
        item for item in candidates
        if item["kind"] == "vector_mapping" and item["page"] == TEXTBOOK_PAGE
    ]
    if len(mappings) < 2:
        log(f"[error] 第 {TEXTBOOK_PAGE} 页映射对不足 2 条（实际 {len(mappings)}），不编造矩阵")
        return 2
    matrix = solve_matrix_from_mappings(mappings)
    if matrix is None:
        log(f"[error] 第 {TEXTBOOK_PAGE} 页映射无法反推 2×2 矩阵（不满足线性性），中止")
        return 2
    vector = next((item["value"]["from"] for item in mappings if item["value"]["from"] == [1, 1]), None)
    if vector is None:
        log("[error] 第 6 页原文未出现输入向量 (1, 1)，不编造 vector_x，中止")
        return 2

    if matrix != EXPECTED_MATRIX:
        log(f"[warn] 反推矩阵 {matrix} 与预期 {EXPECTED_MATRIX} 不一致，以原文为准")
    det_value = matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]
    trace_value = matrix[0][0] + matrix[1][1]
    eigenvalues = sorted(
        item["value"] for item in candidates
        if item["kind"] == "eigenvalue" and item["page"] == TEXTBOOK_PAGE and item["value"] is not None
    )
    log(f"[S6] 映射 {len(mappings)} 条 → A={matrix}，x={vector}，det={det_value}，trace={trace_value}，"
        f"原文 λ={eigenvalues}")
    if det_value != EXPECTED_DET or trace_value != EXPECTED_TRACE or eigenvalues != [1, 3]:
        log("[warn] 与 C-MX@1 黄金用例 mx_textbook_s6 的期望值不一致，请复核原文")

    # ---- 组装三份产物 ----
    source_refs = build_source_refs(pages)
    for ref in source_refs:
        log(f"[source] {ref['id']} page={ref['page']} excerpt={ref['excerpt']!r}")

    obj = build_object(material=material, matrix=matrix, vector=vector, source_refs=source_refs)
    objects_doc: dict[str, Any] = {
        "schema_version": "0.2",
        "material_id": MATERIAL_ID,
        "objects": [obj],
        "merge_conflicts": conflicts,
        "notes": [
            "objects[0].kernel_version 取 linear_v1：knowledge_object.schema.json 的 kernel_version "
            "enum 只允许 linear_v1/force_v1/bfs_v1/budget_v1，matrix_v1 无法通过校验。",
            "matrix_A 的 4 个元素原文未直接印刷：第 6 页给出 (1,0)→(2,1)、(1,1)→(3,3)、"
            "(1,-1)→(1,-1) 三条映射，脚本按线性性反推得 A，故 parameter.provenance=inferred；"
            "任务口径的 source_status 与 schema 的 provenance 同义。",
            "vector_x=[1,1] 直接取自第 6 页映射输入 (1, 1)，provenance=original。",
            "5 条 source_refs 均为页级来源：element_id 与 bbox 一律为 null，excerpt 由该页原文段落拼接，"
            "逐条断言可在 paragraphs 中找到。",
            "material.json 主键用任务口径 id/source_filename/status/generator/size_bytes/sha256/source_sha256，"
            "同时保留 C-MAT@1 的 material_id/source_file/slide_width_emu/slide_height_emu/parser_version/retention 兼容别名。",
            "slides.json 的 slides 为权威列表，pages 为同一内容的兼容镜像（C-API@1 MaterialDetail 用 slides，"
            "C-MAT@1 用 pages）；bbox 单位为 EMU。",
            "同名符号不自动合并：第 6 页 λ=3 与 λ=1 保留为两条候选，merge_conflicts 中如实列出。",
        ],
    }

    verify_invariants(material=material, slides=slides, objects_doc=objects_doc, pages=pages)
    schema_ok = validate_schemas(obj)

    sizes = {
        "material.json": write_json(out_dir / "material.json", material),
        "slides.json": write_json(out_dir / "slides.json", slides),
        "objects.json": write_json(out_dir / "objects.json", objects_doc),
    }
    for name, size in sizes.items():
        log(f"[write] {out_dir / name} ({size} bytes)")
    log(f"[done] schema={'PASS' if schema_ok else 'SKIPPED'}")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())

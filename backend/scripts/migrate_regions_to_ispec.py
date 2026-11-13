#!/usr/bin/env python
"""把课程件的 ``regions.json`` 迁移为 iSpec（P3-12 / §8 归档前置步骤）。

用法（仓库根）::

    python backend/scripts/migrate_regions_to_ispec.py
    python backend/scripts/migrate_regions_to_ispec.py --dry-run
    python backend/scripts/migrate_regions_to_ispec.py --regions fixtures/materials/matrix-courseware/regions.json

产物：

* ``fixtures/materials/mat_matrix_courseware/ispecs.json`` —— 前端静态运行时读取；
* ``backend/data/ispecs/mat_matrix_courseware.json`` —— ``GET /materials/{id}/ispecs`` 读取。

迁移规则（与任务约定逐条对齐）：

1. ``object_id = spec_<region_id>``；
2. ``kind`` 按脚本映射：``matrix_eigen_2d`` / ``matrix_columns_2d`` / ``svd_steps_2d`` →
   ``geometric``，``det_area_2d`` / ``matrix_order_2d`` → ``step``；
3. ``parameters`` 从 ``original_params`` 扁平化：数字/布尔/文本直接转为标量参数，
   **数组默认跳过并写入 notes**（iSpec 参数只支持标量）；若整条区域没有任何标量，
   才把数组内的标量叶子按索引展开作为兜底，避免整条区域无法迁移；
4. ``source.page`` 取区域页码，``element_id`` / ``bbox`` 取首个 ``linked_texts``（可空），
   ``excerpt`` **只从** ``slides.json`` 对应页的 ``paragraphs`` 截取，绝不编造；
5. ``views`` = 一个 ``figure``（按脚本选择模板）+ 一个 ``text``；
6. 每条都必须通过 ``contracts/spec/ispec.schema.json``；失败条目不产出并打印原因。

设计取舍：

* 脚本只读夹具、只写上述两份产物，不改数据库、不改 ``backend/app/**``；
* Schema 校验复用 ``app.ispec.validate_ispec``（与 API 读取时同一套规则），避免两套真相；
* 所有数组跳过原因都落到 ``notes``，便于详情面板解释"为什么参数少了"。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Final

# backend/scripts/migrate_regions_to_ispec.py -> backend/
BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:  # 允许直接 `python backend/scripts/migrate_regions_to_ispec.py`
    sys.path.insert(0, str(BACKEND_DIR))

from app.ispec import validate_ispec  # noqa: E402 - 需先修正 sys.path

#: 课程件基线目录（region 的 material_id 是 mat_matrix_courseware，目录名是 matrix-courseware）。
SOURCE_MATERIAL_DIR: Final[Path] = REPO_ROOT / "fixtures" / "materials" / "matrix-courseware"
DEFAULT_REGIONS_PATH: Final[Path] = SOURCE_MATERIAL_DIR / "regions.json"
DEFAULT_SLIDES_PATH: Final[Path] = SOURCE_MATERIAL_DIR / "slides.json"
#: 前端 fixtures 通道读取的 iSpec 产物目录（按 material_id 命名）。
FIXTURE_OUT_PATH: Final[Path] = (
    REPO_ROOT / "fixtures" / "materials" / "mat_matrix_courseware" / "ispecs.json"
)
#: API 读取的 iSpec 产物路径（backend/data/ispecs/<material_id>.json）。
API_OUT_PATH: Final[Path] = BACKEND_DIR / "data" / "ispecs" / "mat_matrix_courseware.json"
MATERIAL_ID: Final[str] = "mat_matrix_courseware"

#: script_id → (kind, figure spec_ref)。
SCRIPT_ROUTES: Final[dict[str, tuple[str, str]]] = {
    "matrix_eigen_2d": ("geometric", "circle_ellipse"),
    "matrix_columns_2d": ("geometric", "grid_transform"),
    "matrix_order_2d": ("step", "step_diagram"),
    "svd_steps_2d": ("geometric", "step_diagram"),
    "det_area_2d": ("step", "det_area"),
}

#: 脚本 → 原文关键词（用于挑选真实 excerpt；找不到时退回该页首个非空段落）。
EXCERPT_KEYWORDS: Final[dict[str, tuple[str, ...]]] = {
    "matrix_eigen_2d": ("特征值", "特征向量", "→"),
    "matrix_columns_2d": ("列", "基向量", "空间"),
    "matrix_order_2d": ("顺序", "先转", "先拉"),
    "svd_steps_2d": ("奇异", "伸缩", "单位圆"),
    "det_area_2d": ("面积", "方格", "行列式"),
}

IDENTIFIER_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
NON_IDENTIFIER_CHARS: Final[re.Pattern[str]] = re.compile(r"[^A-Za-z0-9_]")
EXCERPT_MAX_LEN: Final[int] = 80


# ---------------------------------------------------------------------------
# 读取
# ---------------------------------------------------------------------------


def read_json(path: Path) -> Any:
    """读取 JSON；文件缺失或损坏时抛出带路径的 ``RuntimeError``。"""

    if not path.is_file():
        raise RuntimeError(f"缺少输入文件：{path}")
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"读取失败：{path}（{type(exc).__name__}）") from exc


def load_regions(path: Path) -> list[dict[str, Any]]:
    """``regions.json`` 允许 ``[...]`` 或 ``{"regions": [...]}`` 两种形状。"""

    payload = read_json(path)
    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict) and isinstance(payload.get("regions"), list):
        items = payload["regions"]
    else:
        raise RuntimeError("regions.json 顶层必须是数组，或包含 regions 数组")
    return [dict(item) for item in items if isinstance(item, dict)]


def load_slide_paragraphs(path: Path) -> dict[int, tuple[str, list[str]]]:
    """页码 → (页标题, 段落列表)；页码按 ``page_no`` 读取。"""

    payload = read_json(path)
    slides = payload.get("slides") if isinstance(payload, dict) else None
    if not isinstance(slides, list):
        raise RuntimeError("slides.json 缺少 slides 数组")
    result: dict[int, tuple[str, list[str]]] = {}
    for slide in slides:
        if not isinstance(slide, dict):
            continue
        page_no = slide.get("page_no")
        if not isinstance(page_no, int) or page_no < 1:
            continue
        title = slide.get("title")
        paragraphs = slide.get("paragraphs")
        result[page_no] = (
            title if isinstance(title, str) else "",
            [item for item in paragraphs if isinstance(item, str)]
            if isinstance(paragraphs, list)
            else [],
        )
    return result


# ---------------------------------------------------------------------------
# 参数扁平化
# ---------------------------------------------------------------------------


def normalize_identifier(path: str, used: set[str]) -> str:
    """把 ``steps.rotate.angle_deg`` 这类路径归一成合法且唯一的参数 id。"""

    candidate = NON_IDENTIFIER_CHARS.sub("_", path).strip("_").lower()
    if candidate == "" or candidate[0].isdigit():
        candidate = f"p_{candidate}" if candidate else "value"
    if not IDENTIFIER_PATTERN.match(candidate):
        candidate = "value"
    base = candidate
    index = 2
    while candidate in used:
        candidate = f"{base}_{index}"
        index += 1
    used.add(candidate)
    return candidate


def parameter_type(value: Any) -> str:
    """Python 标量 → iSpec 参数类型（bool 必须在 int 之前判断）。"""

    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    return "string"


def make_parameter(
    param_id: str,
    label: str,
    value: Any,
    source: dict[str, Any],
) -> dict[str, Any]:
    """构造单个 iSpec 参数；``source`` 由调用方按区域统一生成。"""

    return {
        "id": param_id,
        "label": label,
        "type": parameter_type(value),
        "default": value,
        "source": dict(source),
    }


def flatten_scalars(
    value: Any,
    path: str,
    notes: list[str],
    used: set[str],
    source: dict[str, Any],
    out: list[dict[str, Any]],
) -> None:
    """递归扁平化标量；数组（以及数组内的值）默认跳过并记录原因。"""

    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else str(key)
            flatten_scalars(child, child_path, notes, used, source, out)
        return
    if isinstance(value, list):
        skipped = path or "<root>"
        notes.append(f"原参数 {skipped} 为数组，iSpec 参数只支持标量，已跳过。")
        return
    if value is None:
        return
    if isinstance(value, (bool, int, float, str)):
        param_id = normalize_identifier(path, used)
        label = path.replace(".", " / ") if path else param_id
        out.append(make_parameter(param_id, label, value, source))
        return
    notes.append(f"原参数 {path or '<root>'} 的类型 {type(value).__name__} 无法表达为标量，已跳过。")


def flatten_fallback_arrays(
    value: Any,
    path: str,
    used: set[str],
    source: dict[str, Any],
    out: list[dict[str, Any]],
) -> bool:
    """兜底：把数组内标量叶子按索引展开；返回是否产出了参数。"""

    produced = False
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else str(key)
            produced = flatten_fallback_arrays(child, child_path, used, source, out) or produced
        return produced
    if isinstance(value, list):
        for index, child in enumerate(value):
            child_path = f"{path}.{index}" if path else str(index)
            produced = flatten_fallback_arrays(child, child_path, used, source, out) or produced
        return produced
    if isinstance(value, (bool, int, float, str)):
        param_id = normalize_identifier(path, used)
        label = path.replace(".", " / ") if path else param_id
        out.append(make_parameter(param_id, label, value, source))
        return True
    return False


# ---------------------------------------------------------------------------
# 原文片段
# ---------------------------------------------------------------------------


def pick_excerpt(script_id: str, paragraphs: list[str]) -> str:
    """从该页真实段落里挑一段作为 ``excerpt``（只截取，不改写）。"""

    candidates = [item.strip() for item in paragraphs if item.strip() != ""]
    if not candidates:
        return ""
    keywords = EXCERPT_KEYWORDS.get(script_id, ())
    for paragraph in candidates:
        if any(keyword in paragraph for keyword in keywords):
            return paragraph[:EXCERPT_MAX_LEN]
    return candidates[0][:EXCERPT_MAX_LEN]


def linked_text_source(region: dict[str, Any]) -> tuple[str | None, dict[str, float] | None]:
    """取首个 ``linked_texts`` 的 element_id / bbox（可空）。"""

    linked = region.get("linked_texts")
    if not isinstance(linked, list):
        return None, None
    for item in linked:
        if not isinstance(item, dict):
            continue
        element_id = item.get("element_id")
        bbox = item.get("bbox")
        if isinstance(bbox, dict) and all(
            isinstance(bbox.get(key), (int, float)) for key in ("x", "y", "w", "h")
        ):
            normalized = {key: float(bbox[key]) for key in ("x", "y", "w", "h")}
        else:
            normalized = None
        return element_id if isinstance(element_id, str) else None, normalized
    return None, None


# ---------------------------------------------------------------------------
# 单条迁移
# ---------------------------------------------------------------------------


def build_text_template(page_title: str, parameters: list[dict[str, Any]]) -> str:
    """生成 text 视图模板：矩阵类给出 A 的四分量，其余给出首个参数值。"""

    by_id = {parameter["id"]: parameter for parameter in parameters}
    if all(key in by_id for key in ("a11", "a12", "a21", "a22")):
        return "A = [[{{a11}}, {{a12}}], [{{a21}}, {{a22}}]]"
    first = parameters[0]["id"] if parameters else ""
    if first == "":
        return page_title
    return f"{page_title} · {first} = {{{{{first}}}}}"


def migrate_region(
    region: dict[str, Any],
    slides: dict[int, tuple[str, list[str]]],
) -> tuple[dict[str, Any] | None, list[str]]:
    """把单个区域转成 iSpec；返回 ``(spec 或 None, 失败原因)``。"""

    region_id = region.get("region_id")
    page = region.get("page")
    script_id = region.get("script_id")
    original_params = region.get("original_params")

    errors: list[str] = []
    if not isinstance(region_id, str) or region_id == "":
        return None, ["缺少 region_id"]
    if not isinstance(page, int) or page < 1:
        return None, [f"{region_id}: page 非法"]
    if not isinstance(script_id, str) or script_id not in SCRIPT_ROUTES:
        return None, [f"{region_id}: script_id={script_id!r} 不在白名单"]
    if not isinstance(original_params, dict):
        return None, [f"{region_id}: original_params 不是对象"]

    page_title, paragraphs = slides.get(page, ("", []))
    excerpt = pick_excerpt(script_id, paragraphs)
    if excerpt == "":
        return None, [f"{region_id}: 第 {page} 页没有可引用的原文段落，excerpt 不能为空"]

    element_id, bbox = linked_text_source(region)
    source: dict[str, Any] = {
        "page": page,
        "element_id": element_id,
        "bbox": bbox,
        "status": "confirmed",
        "excerpt": excerpt,
    }

    notes: list[str] = []
    original_notes = region.get("notes")
    if isinstance(original_notes, str) and original_notes.strip() != "":
        notes.append(original_notes.strip())

    used: set[str] = set()
    parameters: list[dict[str, Any]] = []
    flatten_scalars(original_params, "", notes, used, source, parameters)

    if not parameters:
        # 兜底：整条区域没有标量时，数组/对象内的标量按索引展开，保证能通过 Schema。
        fallback: list[dict[str, Any]] = []
        produced = flatten_fallback_arrays(original_params, "", used, source, fallback)
        if produced:
            parameters = fallback
            notes.append(
                "原参数全部是数组/对象，已按索引展开为标量参数（iSpec 参数只支持标量）。"
            )

    if not parameters:
        return None, [f"{region_id}: original_params 中没有可表达的标量参数"]

    kind, figure_ref = SCRIPT_ROUTES[script_id]
    title = page_title or f"第 {page} 页 · {script_id}"
    spec: dict[str, Any] = {
        "spec_version": "1.0",
        "object_id": f"spec_{region_id}",
        "title": title,
        "kind": kind,
        "parameters": parameters,
        "expressions": [],
        "views": [
            {
                "type": "figure",
                "spec_ref": figure_ref,
                "title": title,
            },
            {
                "type": "text",
                "template": build_text_template(title, parameters),
                "title": "与原页同步",
            },
        ],
        "constraints": [],
        "checks": [
            {
                "id": "C1",
                "type": "source_match",
                "page": page,
                "expect": f"参数与第 {page} 页原文一致（excerpt 取自 slides.json）",
            }
        ],
        "notes": "；".join(notes),
    }

    messages = validate_ispec(spec)
    if messages:
        return None, [f"{region_id}: Schema 校验失败：{message}" for message in messages]
    return spec, errors


# ---------------------------------------------------------------------------
# 产物写入
# ---------------------------------------------------------------------------


def build_payload(specs: list[dict[str, Any]], failures: list[dict[str, Any]]) -> dict[str, Any]:
    """构造与 API 读取形状一致的 iSpec 产物。"""

    found = bool(specs)
    return {
        "schema_version": "1.0",
        "material_id": MATERIAL_ID,
        "ispecs": specs,
        "recognition": {
            "found": found,
            "reason": (
                f"已迁移 {len(specs)} 条 iSpec（来自 regions.json）"
                if found
                else "regions.json 中没有可迁移的 iSpec"
            ),
        },
        "errors": failures,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    """原子写 JSON（先写 .tmp 再替换），避免半成品被前端读到。"""

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    tmp.replace(path)


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="把课程件 regions.json 迁移为 iSpec")
    parser.add_argument("--regions", type=Path, default=DEFAULT_REGIONS_PATH, help="regions.json 路径")
    parser.add_argument("--slides", type=Path, default=DEFAULT_SLIDES_PATH, help="slides.json 路径")
    parser.add_argument("--fixture-out", type=Path, default=FIXTURE_OUT_PATH, help="前端 ispecs.json 产物")
    parser.add_argument("--api-out", type=Path, default=API_OUT_PATH, help="API ispecs 产物")
    parser.add_argument("--dry-run", action="store_true", help="只打印结果，不写文件")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        regions = load_regions(args.regions)
        slides = load_slide_paragraphs(args.slides)
    except RuntimeError as exc:
        print(f"[失败] {exc}", file=sys.stderr)
        return 1

    specs: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for region in regions:
        spec, errors = migrate_region(region, slides)
        if spec is None:
            failures.append({"region_id": region.get("region_id"), "errors": errors})
            print(f"[跳过] {region.get('region_id')}：{'；'.join(errors)}")
            continue
        specs.append(spec)
        print(
            f"[通过] {spec['object_id']} · kind={spec['kind']} · "
            f"参数 {len(spec['parameters'])} 个 · 视图 {len(spec['views'])} 个"
        )

    payload = build_payload(specs, failures)
    print(
        f"迁移结果：{len(specs)}/{len(regions)} 条通过 Schema，"
        f"{len(failures)} 条未产出"
    )
    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        write_json(args.fixture_out, payload)
        write_json(args.api_out, payload)
        print(f"已写入 {args.fixture_out}")
        print(f"已写入 {args.api_out}")
    return 0 if specs else 1


if __name__ == "__main__":
    raise SystemExit(main())
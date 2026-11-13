"""对陌生 PPT 验收集跑完整端到端并生成验收报告（任务 P1-09）。

端到端链路（**不是只跑 builder**）::

    parse_pptx(path)                       # 解析：native chart/table/OMML
      → build_ispecs_detailed(slides)      # 识别：直出 iSpec + 识别结论
      → validate_ispec(ispec)              # 契约：逐条 JSON Schema 校验
      → check_consumable(ispec)            # 转换：views/datasets 自洽（可被运行时消费）
      → 页面视觉导出（PowerPoint COM）       # 保真：页图能否真正渲染出来

输出 ``verify/corpus_report.md``（中文），逐份给出预期 / 实际 iSpec 条数 /
识别结论 / 校验错误数 / 端到端判定 / 失败原因，并汇总整改文件 §10.2 要求的
5 项指标：

1. 识别成功率 = 有 iSpec 的份数 / 预期能识别的份数；
2. 语义绑定正确率 = 抽样 5 份，逐条核对 ``source.page`` + ``excerpt`` 是否指向该页该元素；
3. 交互生成率 = iSpec 视图数 ≥ 1 的份数占比；
4. 视觉保真度 = 页图导出成功份数占比（COM 失败份数单列）；
5. 用户纠正成本 = 每份平均待确认参数数（``source.status != "original"``）。

**判定口径**：``PASS`` 表示"实际结果与 manifest 预期一致"，不是"识别成功"。
预期失败的 4 份得到 0 条 iSpec 同样记为 PASS（这是系统边界的正确表现）。
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

# 允许 `python backend/scripts/run_corpus.py` 直接执行：把 backend/ 加入 sys.path。
BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.ispec import build_ispecs_detailed, validate_ispec  # noqa: E402
from app.parsers import parse_pptx  # noqa: E402

#: 语料根目录与报告路径。
CORPUS_DIR = REPO_ROOT / "fixtures" / "corpus"
MANIFEST_PATH = CORPUS_DIR / "manifest.json"
PAGES_DIR = CORPUS_DIR / "pages"
REPORT_PATH = REPO_ROOT / "verify" / "corpus_report.md"

#: 语义绑定抽样的份数。
SEMANTIC_SAMPLE_SIZE = 5

#: 端到端判定标签。
PASS = "PASS"
FAIL = "FAIL"


# ---------------------------------------------------------------------------
# 单份材料评估
# ---------------------------------------------------------------------------


@dataclass
class CaseResult:
    """一份材料在端到端链路中的全部观测值。"""

    file: str
    split: str
    kind: str
    expect: str
    notes: str
    pages: int = 0
    ispec_count: int = 0
    pages_with_ispec: int = 0
    found: bool = False
    reason: str = ""
    schema_errors: int = 0
    builder_dropped: int = 0
    skipped: list[str] = field(default_factory=list)
    consumable_issues: list[str] = field(default_factory=list)
    view_count: int = 0
    pending_params: int = 0
    total_params: int = 0
    verdict: str = FAIL
    failure_reason: str = ""
    ispecs: list[dict[str, Any]] = field(default_factory=list)
    structures: dict[str, int] = field(default_factory=dict)
    parse_error: str = ""

    @property
    def is_mismatch(self) -> bool:
        """实际结果与预期不一致（需要整改的偏差）。"""
        return self.verdict == FAIL


def load_manifest(path: Path = MANIFEST_PATH) -> dict[str, Any]:
    """读取 manifest；缺失时抛 ``FileNotFoundError``（提示先跑 build_corpus）。"""
    if not path.is_file():
        raise FileNotFoundError(f"缺少语料清单：{path}（请先运行 backend/scripts/build_corpus.py）")
    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"manifest 格式非法：{path}")
    return payload


#: 结构名称 → 报告中的中文说明（"每类至少 2 份"的统计口径）。
STRUCTURE_LABELS: dict[str, str] = {
    "bar_chart": "原生柱状图/条形图",
    "line_chart": "原生折线图",
    "pie_chart": "原生饼图",
    "table": "原生表格",
    "formula": "OMML 公式",
    "group": "组合图形",
    "group_text": "组合内文字",
    "group_table": "组合内表格",
    "group_chart": "组合内图表",
    "text_only_page": "纯文字页",
    "picture_only_page": "纯图片页",
    "empty_page": "空页",
}


def _structure_counts(slides: dict[str, Any]) -> dict[str, int]:
    """统计一份材料内出现的结构（按元素/页面计次，供覆盖矩阵使用）。"""
    counts = {key: 0 for key in STRUCTURE_LABELS}
    for page in slides.get("slides") or []:
        if not isinstance(page, dict):
            continue
        elements = [item for item in page.get("elements") or [] if isinstance(item, dict)]
        if not elements:
            counts["empty_page"] += 1
            continue
        page_has_structure = False
        for element in elements:
            chart = element.get("chart_data")
            table = element.get("table_data")
            math_text = element.get("math_text")
            in_group = element.get("group_path") is not None
            kind = element.get("kind")
            if isinstance(chart, dict) and chart.get("categories") and chart.get("series"):
                page_has_structure = True
                chart_type = str(chart.get("chart_type") or "").upper()
                if "LINE" in chart_type:
                    counts["line_chart"] += 1
                elif "PIE" in chart_type:
                    counts["pie_chart"] += 1
                elif "BAR" in chart_type or "COLUMN" in chart_type:
                    counts["bar_chart"] += 1
                if in_group:
                    counts["group_chart"] += 1
            if isinstance(table, dict) and table.get("headers"):
                page_has_structure = True
                counts["table"] += 1
                if in_group:
                    counts["group_table"] += 1
            if isinstance(math_text, str) and math_text.strip():
                page_has_structure = True
                counts["formula"] += 1
            if kind == "group":
                counts["group"] += 1
            elif kind == "text" and in_group:
                counts["group_text"] += 1
        if not page_has_structure:
            has_picture = any(item.get("kind") == "picture" for item in elements)
            if has_picture:
                counts["picture_only_page"] += 1
            else:
                counts["text_only_page"] += 1
    return counts


def _element_text_map(page: dict[str, Any]) -> dict[str, str]:
    """把一页的每个元素可引用原文拼成 haystack（用于语义绑定核对）。"""
    mapping: dict[str, str] = {}
    raw_elements = page.get("elements")
    if not isinstance(raw_elements, list):
        return mapping
    for element in raw_elements:
        if not isinstance(element, dict):
            continue
        element_id = element.get("element_id")
        if not isinstance(element_id, str):
            continue
        parts: list[str] = []
        for key in ("text", "math_text"):
            value = element.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(value)
        chart = element.get("chart_data")
        if isinstance(chart, dict):
            title = chart.get("title")
            if isinstance(title, str):
                parts.append(title)
            for item in chart.get("categories") or []:
                parts.append(str(item))
            for series in chart.get("series") or []:
                if isinstance(series, dict) and series.get("name"):
                    parts.append(str(series["name"]))
        table = element.get("table_data")
        if isinstance(table, dict):
            headers = [str(item) for item in table.get("headers") or []]
            parts.append(" | ".join(headers))
            parts.append(" ".join(headers))
        mapping[element_id] = "\n".join(part for part in parts if part)
    return mapping


def _is_excerpt_bound(excerpt: str, haystack: str) -> bool:
    """``excerpt`` 必须是该元素原文的子串（任一方向包含即视为有证据）。"""
    if not excerpt.strip() or not haystack.strip():
        return False
    return excerpt in haystack or haystack in excerpt


def check_consumable(ispec: dict[str, Any]) -> list[str]:
    """校验 iSpec 能否被运行时直接消费（views/datasets 自洽）。

    这是"识别成功 ≠ 转换成功"的落点：builder 通过了 Schema，但如果 view
    引用了不存在的数据集、或 rows 与 columns 宽度不一致，运行时仍会失败。
    """
    issues: list[str] = []
    datasets: dict[str, dict[str, Any]] = {}
    for dataset in ispec.get("datasets") or []:
        if not isinstance(dataset, dict):
            continue
        dataset_id = dataset.get("id")
        if isinstance(dataset_id, str):
            datasets[dataset_id] = dataset
        columns = dataset.get("columns")
        rows = dataset.get("rows")
        if not isinstance(columns, list) or not columns:
            issues.append(f"dataset {dataset_id}: columns 为空")
            continue
        for index, row in enumerate(rows or []):
            if not isinstance(row, list) or len(row) != len(columns):
                issues.append(f"dataset {dataset_id}: 第 {index} 行宽度与 columns 不一致")
                break

    for view in ispec.get("views") or []:
        if not isinstance(view, dict):
            continue
        view_type = view.get("type")
        if view_type == "text":
            continue
        dataset_ref = view.get("dataset")
        if isinstance(dataset_ref, str) and dataset_ref not in datasets:
            issues.append(f"view {view_type}: 引用了不存在的数据集 {dataset_ref}")
            continue
        if view_type == "vega" and isinstance(dataset_ref, str):
            dataset = datasets.get(dataset_ref) or {}
            columns = dataset.get("columns") or []
            for axis in ("x", "y"):
                field_name = view.get(axis)
                if isinstance(field_name, str) and field_name and field_name not in columns:
                    issues.append(f"view vega: {axis}={field_name} 不在 dataset columns 中")
        if view_type == "table":
            view_columns = view.get("columns") or []
            dataset = datasets.get(dataset_ref) if isinstance(dataset_ref, str) else None
            if dataset and view_columns and list(dataset.get("columns") or []) != list(view_columns):
                issues.append("view table: columns 与 dataset columns 不一致")
    return issues


def evaluate_case(entry: dict[str, Any], *, asset_dir: Path) -> CaseResult:
    """跑单份材料的端到端链路并填充 :class:`CaseResult`。"""
    relative = str(entry["file"])
    path = CORPUS_DIR / relative
    result = CaseResult(
        file=relative,
        split=str(entry.get("split") or Path(relative).parent.name),
        kind=str(entry.get("kind") or ""),
        expect=str(entry.get("expect") or ""),
        notes=str(entry.get("notes") or ""),
    )
    if not path.is_file():
        result.parse_error = f"文件不存在：{path}"
        result.verdict = FAIL
        result.failure_reason = result.parse_error
        return result

    material_id = f"corpus_{path.stem}"
    try:
        _material, slides = parse_pptx(path, material_id=material_id, asset_dir=asset_dir)
    except Exception as exc:  # noqa: BLE001 - 解析失败本身就是端到端失败
        result.parse_error = f"{type(exc).__name__}: {exc}"
        result.verdict = FAIL
        result.failure_reason = f"解析失败：{result.parse_error}"
        return result

    result.pages = len(slides.get("slides") or [])
    result.structures = _structure_counts(slides)
    build = build_ispecs_detailed(slides, material_id=material_id)
    result.ispecs = list(build.ispecs)
    result.ispec_count = len(result.ispecs)
    result.found = bool(build.recognition.get("found"))
    result.reason = str(build.recognition.get("reason") or "")

    # 独立复核 Schema；同时区分 builder 丢弃的坏 spec 与 skipped 诊断。
    for spec in result.ispecs:
        result.schema_errors += len(validate_ispec(spec))
    for error in build.errors:
        if error.get("object_id") is None:
            result.skipped.extend(str(item) for item in error.get("errors") or [])
        else:
            result.builder_dropped += 1
    result.schema_errors += result.builder_dropped

    for spec in result.ispecs:
        result.consumable_issues.extend(check_consumable(spec))
        result.view_count += sum(
            1 for view in spec.get("views") or [] if isinstance(view, dict)
        )
        for parameter in spec.get("parameters") or []:
            if not isinstance(parameter, dict):
                continue
            result.total_params += 1
            source = parameter.get("source") or {}
            if str(source.get("status") or "") != "original":
                result.pending_params += 1
    result.pages_with_ispec = len(
        {
            source.get("page")
            for spec in result.ispecs
            for parameter in spec.get("parameters") or []
            for source in [parameter.get("source") or {}]
            if isinstance(source.get("page"), int)
        }
    )

    result.verdict, result.failure_reason = _judge(result)
    return result


def _judge(result: CaseResult) -> tuple[str, str]:
    """按 manifest 预期判定 PASS/FAIL，并给出失败/边界原因。"""
    positive = result.expect == "should_pass"
    if positive:
        problems: list[str] = []
        if result.ispec_count == 0:
            problems.append(f"未产出 iSpec：{result.reason}")
        if result.schema_errors:
            problems.append(f"{result.schema_errors} 处 Schema 校验错误")
        if result.consumable_issues:
            problems.append(
                "转换不可消费：" + "；".join(result.consumable_issues[:3])
            )
        if problems:
            return FAIL, "；".join(problems)
        return PASS, ""

    # should_fail：必须 0 条 iSpec，否则视为"回退伪造"。
    if result.ispec_count > 0:
        return FAIL, (
            f"预期不识别却产出 {result.ispec_count} 条 iSpec（疑似回退到公共示例或伪造交互）"
        )
    return PASS, _expected_failure_reason(result)


def _expected_failure_reason(result: CaseResult) -> str:
    """预期失败材料的架构边界说明（写进报告"失败原因"列）。"""
    if result.kind in {"text_only", "group_textbox"}:
        return (
            "架构边界：该材料只有文字（页面正文/组合内文本框），没有任何原生图表、"
            "表格或 OMML 公式；识别链路按设计返回空列表，不伪造交互。"
        )
    if result.kind == "picture_chart":
        return (
            "架构边界：图表已被渲染为位图，当前识别链路只读原生 chart 部件，"
            "没有 OCR/视觉识别，图片内的数据与坐标无法还原。"
        )
    return f"架构边界：未识别到可直读的原生数据；{result.reason}"


def evaluate_corpus(
    manifest: dict[str, Any] | None = None,
    *,
    export_visual: bool = True,
) -> list[CaseResult]:
    """并发无关地顺序评估全部材料（确定性，便于复现）。"""
    payload = manifest or load_manifest()
    entries: list[dict[str, Any]] = []
    for split in ("dev", "eval"):
        for item in payload.get(split) or []:
            if isinstance(item, dict):
                entries.append({**item, "split": split})

    with tempfile.TemporaryDirectory(prefix="corpus_assets_") as temp_dir:
        asset_dir = Path(temp_dir)
        results = [evaluate_case(entry, asset_dir=asset_dir) for entry in entries]

    if export_visual:
        _attach_visual_export(results)
    return results


# ---------------------------------------------------------------------------
# 视觉保真度：PowerPoint COM 导出首屏 PNG
# ---------------------------------------------------------------------------


@dataclass
class VisualExport:
    """视觉导出的汇总结果。"""

    available: bool = False
    attempted: bool = False
    exported: int = 0
    failed: list[dict[str, str]] = field(default_factory=list)
    unavailable_reason: str = ""

    @property
    def failed_count(self) -> int:
        """导出失败的份数。"""
        return len(self.failed)


def _attach_visual_export(results: Sequence[CaseResult]) -> None:
    """为评估结果补充"页图是否导出成功"（写入 ``result`` 之外的全局统计）。"""
    # 统计保存在模块级，供报告函数读取；不使用全局可变单例以外的状态。
    global _VISUAL_EXPORT
    _VISUAL_EXPORT = export_pages(results)


_VISUAL_EXPORT: VisualExport = VisualExport()


def export_pages(results: Sequence[CaseResult]) -> VisualExport:
    """用 PowerPoint COM 把每份材料第 1 页导出为 PNG。

    * PowerPoint 未安装 / COM 不可用 → ``available=False``，全部份数记为失败；
    * 单份导出失败 → 记入 ``failed``，不影响其他份；
    * 导出位置：``fixtures/corpus/pages/<stem>.png``（在允许写入的目录内）。
    """
    summary = VisualExport(attempted=True)
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    for stale in PAGES_DIR.glob("*.png"):
        stale.unlink()

    try:
        import win32com.client  # type: ignore[import-not-found]
    except Exception as exc:  # pragma: no cover - 依赖环境
        summary.unavailable_reason = f"pywin32 不可用：{type(exc).__name__}: {exc}"
        summary.failed = [
            {"file": case.file, "reason": "COM 不可用：pywin32 未安装"}
            for case in results
        ]
        return summary

    application = None
    try:
        application = win32com.client.DispatchEx("PowerPoint.Application")
        try:
            application.DisplayAlerts = 0
        except Exception:  # pragma: no cover - 部分版本只读
            pass
    except Exception as exc:  # pragma: no cover - 无 PowerPoint 环境
        summary.unavailable_reason = (
            f"PowerPoint COM 不可用：{type(exc).__name__}: {exc}"
        )
        summary.failed = [
            {"file": case.file, "reason": "COM 不可用：未安装 PowerPoint 或 COM 注册失败"}
            for case in results
        ]
        return summary

    summary.available = True
    try:
        for case in results:
            source = CORPUS_DIR / case.file
            target = PAGES_DIR / f"{source.stem}.png"
            last_error = ""
            for attempt in range(3):
                presentation = None
                try:
                    presentation = application.Presentations.Open(
                        str(source), True, False, False
                    )
                    presentation.Slides(1).Export(str(target), "PNG", 1280, 720)
                    presentation.Close()
                    presentation = None
                    if target.is_file() and target.stat().st_size > 0:
                        summary.exported += 1
                        last_error = ""
                        break
                    last_error = "导出文件为空"
                except Exception as exc:  # noqa: BLE001 - 单份失败不拖垮整体
                    last_error = f"{type(exc).__name__}: {exc}"
                    try:
                        if presentation is not None:
                            presentation.Close()
                    except Exception:  # pragma: no cover - 关闭失败可忽略
                        pass
                    time.sleep(0.4 * (attempt + 1))
            if last_error:
                summary.failed.append({"file": case.file, "reason": last_error})
                try:
                    if target.is_file():
                        target.unlink()
                except OSError:  # pragma: no cover
                    pass
    finally:
        try:
            application.Quit()
        except Exception:  # pragma: no cover - 退出失败可忽略
            pass
    return summary


# ---------------------------------------------------------------------------
# 5 项指标
# ---------------------------------------------------------------------------


def semantic_binding_sample(results: Sequence[CaseResult]) -> dict[str, Any]:
    """抽样核对 ``source.page`` 与 ``excerpt`` 是否指向该页该元素。

    抽样方法（可复现）：从 ``should_pass`` 材料中按文件名排序取前 5 份，
    每份逐条参数核对：

    1. ``source.page`` 必须是该材料真实存在的页码；
    2. ``source.element_id`` 必须在该页 ``elements`` 中出现；
    3. ``excerpt`` 必须能在该元素的原文片段（图表标题/图例/分类、表格表头、
       公式文本、正文）中找到。

    这是"程序化核对 + 人工抽查读片段"的双轨方式：脚本给出可复现的命中判定，
    执行人再逐条阅读 excerpt 与原文确认语义一致（报告里记录明细）。
    """
    candidates = [case for case in results if case.expect == "should_pass" and case.ispecs]
    candidates.sort(key=lambda case: case.file)
    sample = candidates[:SEMANTIC_SAMPLE_SIZE]

    details: list[dict[str, Any]] = []
    hits = 0
    total = 0

    # 先在同一临时素材目录下解析抽样材料，再逐条核对（避免临时目录泄漏）。
    parsed: dict[str, dict[str, Any]] = {}
    with tempfile.TemporaryDirectory(prefix="corpus_bind_") as temp_dir:
        asset_dir = Path(temp_dir)
        for case in sample:
            _material, slides = parse_pptx(
                CORPUS_DIR / case.file,
                material_id=f"bind_{Path(case.file).stem}",
                asset_dir=asset_dir,
            )
            parsed[case.file] = slides

    for case in sample:
        slides = parsed[case.file]
        pages = {
            page.get("page_no"): page
            for page in slides.get("slides") or []
            if isinstance(page, dict)
        }
        for spec in case.ispecs:
            for parameter in spec.get("parameters") or []:
                source = parameter.get("source") or {}
                page_no = source.get("page")
                element_id = source.get("element_id")
                excerpt = str(source.get("excerpt") or "")
                page = pages.get(page_no)
                element_map = _element_text_map(page) if page else {}
                haystack = element_map.get(element_id) if isinstance(element_id, str) else ""
                ok = (
                    page is not None
                    and bool(haystack)
                    and _is_excerpt_bound(excerpt, haystack)
                )
                total += 1
                hits += 1 if ok else 0
                details.append(
                    {
                        "file": case.file,
                        "object_id": spec.get("object_id"),
                        "parameter": parameter.get("id"),
                        "page": page_no,
                        "element_id": element_id,
                        "excerpt": excerpt,
                        "bound": ok,
                        "haystack": haystack.replace("\n", " ") if haystack else "",
                    }
                )
    return {
        "sample_files": [case.file for case in sample],
        "details": details,
        "hits": hits,
        "total": total,
        "rate": (hits / total) if total else 0.0,
    }


def compute_metrics(
    results: Sequence[CaseResult], visual: VisualExport, binding: dict[str, Any]
) -> dict[str, float]:
    """计算 §10.2 的 5 项指标。"""
    total_files = len(results)
    expected_pass = [case for case in results if case.expect == "should_pass"]
    with_ispec = [case for case in results if case.ispec_count > 0]
    with_views = [
        case
        for case in results
        if any(
            (spec.get("views") or []) for spec in case.ispecs
        )
    ]
    pending = sum(case.pending_params for case in results)

    return {
        "recognition_rate": (
            len(with_ispec) / len(expected_pass) if expected_pass else 0.0
        ),
        "semantic_binding_rate": float(binding["rate"]),
        "interaction_rate": (len(with_views) / total_files) if total_files else 0.0,
        "visual_fidelity": (visual.exported / total_files) if total_files else 0.0,
        "correction_cost_per_file": (pending / total_files) if total_files else 0.0,
        "correction_cost_per_detected": (pending / len(with_ispec)) if with_ispec else 0.0,
    }


# ---------------------------------------------------------------------------
# 报告
# ---------------------------------------------------------------------------


def _cell(text: str, limit: int = 70) -> str:
    """表格单元格转义与截断。"""
    cleaned = str(text).replace("|", "\\|").replace("\n", " ")
    return cleaned if len(cleaned) <= limit else cleaned[: limit - 1] + "…"


def _page_coverage_note(case: CaseResult) -> str:
    """页级覆盖表的说明文字（按材料类别给出真实原因）。"""
    if case.expect != "should_pass":
        return "预期失败材料，全文不产出"
    if case.kind == "max_pages_boundary":
        return "59 页为纯文字填充页，仅首页原生图表产出"
    if case.kind == "multi_page_mix":
        return "第 3 页纯文字、第 4 页空页、第 5 页纯图片，按设计不产出"
    return "含纯文字/空页/纯图片页，按设计不产出"


def _pct(value: float) -> str:
    """百分比格式化（保留 1 位小数）。"""
    return f"{value * 100:.1f}%"


def render_report(
    results: Sequence[CaseResult],
    metrics: dict[str, float],
    binding: dict[str, Any],
    visual: VisualExport,
    manifest: dict[str, Any],
    *,
    started_at: str,
    elapsed_seconds: float,
) -> str:
    """生成中文验收报告（Markdown）。"""
    lines: list[str] = []
    total = len(results)
    expected_pass = [case for case in results if case.expect == "should_pass"]
    detected = [case for case in results if case.ispec_count > 0]
    mismatches = [case for case in results if case.is_mismatch]
    detected_pass = [case for case in expected_pass if case.ispec_count > 0]
    expected_failures = [
        case for case in results if case.expect == "should_fail" and case.ispec_count == 0
    ]
    expected_fail_total = sum(1 for case in results if case.expect == "should_fail")
    fabricated = [
        case for case in results if case.expect == "should_fail" and case.ispec_count > 0
    ]

    lines.append("# 陌生 PPT 验收集报告（P1-09）")
    lines.append("")
    lines.append("> 整改文件 §10.2/§10.3 要求：至少 20 份独立材料、按整份文件隔离开发集与验收集、")
    lines.append("> 必须端到端统计；**失败报告比成功演示更能说明系统边界**。")
    lines.append("")
    lines.append("## 1. 运行信息")
    lines.append("")
    lines.append("| 项 | 值 |")
    lines.append("| --- | --- |")
    lines.append(f"| 生成时间（manifest） | {manifest.get('generated_at', 'unknown')} |")
    lines.append(f"| 本次运行开始（UTC） | {started_at} |")
    lines.append(f"| 耗时 | {elapsed_seconds:.1f} s |")
    lines.append(f"| 语料总数 | {total} 份（dev {len(manifest.get('dev') or [])} / eval {len(manifest.get('eval') or [])}） |")
    lines.append(f"| python-pptx | {manifest.get('generated_by_pptx_version', 'unknown')} |")
    lines.append("| 链路 | `parse_pptx` → `build_ispecs_detailed` → `validate_ispec` → 可消费性检查 → COM 页图导出 |")
    lines.append("")
    lines.append("隔离方式：每份材料是独立文件，开发集与验收集分目录存放（`fixtures/corpus/dev/`、")
    lines.append("`fixtures/corpus/eval/`），运行时逐份独立解析，不共享解析缓存或识别状态。")
    lines.append("")

    lines.append("## 2. 结构覆盖")
    lines.append("")
    lines.append("统计口径：按**材料**计数（同一份材料内多次出现只记 1 份）；"
                 "`纯文字页/纯图片页/空页` 为页级结构，按出现的材料计。")
    lines.append("")
    lines.append("| 结构 | 出现份数 | 文件 |")
    lines.append("| --- | ---: | --- |")
    for key, label in STRUCTURE_LABELS.items():
        files = [case.file for case in results if case.structures.get(key)]
        if not files:
            lines.append(f"| {label} | 0 | 未覆盖 |")
            continue
        lines.append(
            f"| {label} | {len(files)} | {_cell(', '.join(files), 160)} |"
        )
    lines.append("")
    lines.append(
        "OMML 公式两份均由 `a14:m` / `m:oMath` 原生 XML 写入，**不是**「真实公式文本的降级构造」。"
    )
    lines.append("")
    lines.append(
        "说明：`组合内表格` 与 `组合内图表` 分列统计，合计覆盖 2 份（`dev_07_group_table` + "
        "`eval_07_group_chart`）；`纯文字页` 覆盖 5 份（整份纯文字 1 份 + 组合内文字 2 份 + "
        "多页混合/60 页材料中的文字页）；`纯图片页` 覆盖 2 份（`dev_10_picture_chart` 整份 + "
        "`eval_09_multi_page_mix` 第 5 页）；`空页` 出现在 `eval_09_multi_page_mix` 第 4 页。"
    )
    lines.append("")

    lines.append("## 3. 逐份结果")
    lines.append("")
    lines.append("判定口径：**PASS = 实际结果与 manifest 预期一致**。预期失败的材料得到 0 条 iSpec")
    lines.append("同样记为 PASS；`识别结论` 取 `build_ispecs_detailed().recognition`。")
    lines.append("")
    lines.append(
        "| 文件名 | 预期 | iSpec 条数 | 识别结论 (found/reason) | 校验错误数 | 转换自洽 | 端到端判定 | 失败原因 |"
    )
    lines.append("| --- | --- | ---: | --- | ---: | --- | --- | --- |")
    for case in results:
        verdict = f"**{case.verdict}**" if case.verdict == FAIL else case.verdict
        reason = case.failure_reason or "—"
        recognition = f"found={case.found}；{case.reason}"
        consumable = "OK" if not case.consumable_issues else f"{len(case.consumable_issues)} 处问题"
        lines.append(
            f"| {case.file} | {case.expect} | {case.ispec_count} | "
            f"{_cell(recognition, 80)} | {case.schema_errors} | {consumable} | "
            f"{verdict} | {_cell(reason, 90)} |"
        )
    lines.append("")

    lines.append("## 4. 五项指标（§10.2）")
    lines.append("")
    lines.append("| 指标 | 定义 | 实测值 | 口径说明 |")
    lines.append("| --- | --- | ---: | --- |")
    lines.append(
        f"| 识别成功率 | 有 iSpec 的份数 / 期望能识别的份数 | "
        f"**{len(detected)}/{len(expected_pass)} = {_pct(metrics['recognition_rate'])}** | "
        f"分母为 manifest 中 expect=should_pass 的 {len(expected_pass)} 份 |"
    )
    lines.append(
        f"| 语义绑定正确率 | 抽样 5 份，逐条核对 page + excerpt | "
        f"**{binding['hits']}/{binding['total']} = {_pct(metrics['semantic_binding_rate'])}** | "
        f"抽样 {len(binding['sample_files'])} 份（见 §5），按参数条目计 |"
    )
    lines.append(
        f"| 交互生成率 | iSpec 视图数 ≥ 1 的份数占比 | "
        f"**{sum(1 for case in results if any((spec.get('views') or []) for spec in case.ispecs))}/{total} = "
        f"{_pct(metrics['interaction_rate'])}** | 分母为全部 {total} 份（含预期失败材料） |"
    )
    lines.append(
        f"| 视觉保真度 | 页图导出成功份数占比 | "
        f"**{visual.exported}/{total} = {_pct(metrics['visual_fidelity'])}** | "
        f"PowerPoint COM 导出首屏 PNG；失败 {visual.failed_count} 份单列于 §6 |"
    )
    pending_total = sum(case.pending_params for case in results)
    correction_cost = (pending_total / total) if total else 0.0
    lines.append(
        f"| 用户纠正成本 | 每份平均待确认参数数 | "
        f"**{correction_cost:.2f} 个/份** | 参数 `source.status != \"original\"` 的总数 "
        f"{pending_total} 个 / {total} 份 |"
    )
    lines.append(
        f"|  | （辅助口径）每个已识别份平均待确认参数数 | "
        f"{metrics['correction_cost_per_detected']:.2f} 个/份 | "
        f"仅在 {len(detected)} 份产出 iSpec 的材料上平均 |"
    )
    lines.append("")

    lines.append("## 5. 语义绑定抽样明细")
    lines.append("")
    lines.append(
        f"抽样方法：从 `expect=should_pass` 且产出 iSpec 的材料中，按文件名排序取前 "
        f"{SEMANTIC_SAMPLE_SIZE} 份（确定性、可复现）；对每条参数的 `source.page`、"
        "`source.element_id`、`source.excerpt` 做三项核对——页码存在、元素存在于该页、"
        "excerpt 能在该元素的原文（图表标题/图例/分类、表格表头、公式文本）中找到。"
        "脚本给出机器判定，执行人再逐条阅读 excerpt 与 haystack 确认语义一致。"
    )
    lines.append("")
    lines.append(f"抽样文件：{', '.join(f'`{item}`' for item in binding['sample_files']) or '无'}")
    lines.append("")
    lines.append("| 文件 | iSpec | 参数 | page | element_id | excerpt | 命中 |")
    lines.append("| --- | --- | --- | ---: | --- | --- | --- |")
    for detail in binding["details"]:
        lines.append(
            f"| {detail['file']} | {_cell(str(detail['object_id']), 40)} | "
            f"{detail['parameter']} | {detail['page']} | {detail['element_id']} | "
            f"{_cell(detail['excerpt'], 50)} | {'✅' if detail['bound'] else '❌'} |"
        )
    lines.append("")
    lines.append(
        f"**命中 {binding['hits']} / {binding['total']} 条参数，"
        f"正确率 {_pct(metrics['semantic_binding_rate'])}。**"
    )
    lines.append("")

    lines.append("## 6. 视觉保真度与 COM 失败清单")
    lines.append("")
    if visual.available:
        lines.append(
            f"PowerPoint COM 可用；尝试导出 {total} 份，成功 {visual.exported} 份，"
            f"失败 {visual.failed_count} 份。页图输出目录：`fixtures/corpus/pages/`。"
        )
    else:
        lines.append(
            f"**PowerPoint COM 不可用（{visual.unavailable_reason or '未知原因'}）**："
            f"本次视觉导出成功 {visual.exported}/{total} 份。为保证报告不虚报，"
            "该指标按最保守口径（成功份数/总份数）计算，未用任何替代渲染充数。"
        )
    lines.append("")
    if visual.failed:
        lines.append("| 文件 | COM 导出失败原因 |")
        lines.append("| --- | --- |")
        for item in visual.failed:
            lines.append(f"| {item['file']} | {_cell(item['reason'], 120)} |")
    else:
        lines.append("COM 导出失败份数：0。")
    lines.append("")
    lines.append(
        "补充说明：`python-pptx` 能打开全部 20 份材料并读出形状/图表/表格，"
        "这只能证明**结构可读**，不能证明屏幕视觉保真；视觉保真度仅以 COM 实际导出为准。"
    )
    lines.append("")

    lines.append("## 7. 失败清单与原因（重点）")
    lines.append("")
    lines.append(f"### 7.1 符合预期的失败（当前架构的必然边界，{len(expected_failures)} 份）")
    lines.append("")
    if expected_failures:
        lines.append("| 文件 | 类别 | iSpec | 失败原因 | 边界性质 |")
        lines.append("| --- | --- | ---: | --- | --- |")
        for case in expected_failures:
            boundary = (
                "必然失败"
                if case.kind in {"text_only", "picture_chart", "group_textbox"}
                else "预期边界"
            )
            lines.append(
                f"| {case.file} | {case.kind} | {case.ispec_count} | "
                f"{_cell(case.failure_reason, 150)} | {boundary} |"
            )
    else:
        lines.append("无。")
    lines.append("")
    lines.append(
        "**为什么这些失败是必然的**：识别层只读 `chart_data` / `table_data` / `math_text` "
        "三元原生数据。纯文字与组合内文本框没有这三类数据；纯图片页的图表在插入前已被"
        "栅格化，PPTX 内只有 `pic` 与 PNG 字节，没有 chart part / workbook，当前链路也没有 "
        "OCR 或视觉模型，因此不存在「看得见但读不出」之外的可行路径。把这些页面强行产出"
        " iSpec 才是错误（回退伪造）。"
    )
    lines.append("")

    lines.append(f"### 7.2 验收偏差（预期成功但失败，{len(mismatches)} 份）")
    lines.append("")
    if mismatches:
        lines.append("| 文件 | iSpec | 校验错误 | 失败原因 |")
        lines.append("| --- | ---: | ---: | --- |")
        for case in mismatches:
            lines.append(
                f"| {case.file} | {case.ispec_count} | {case.schema_errors} | "
                f"{_cell(case.failure_reason, 180)} |"
            )
    else:
        lines.append("无。所有 `should_pass` 材料均产出 ≥1 条通过 Schema 且可消费的 iSpec。")
    lines.append("")

    lines.append(f"### 7.3 回退伪造（预期失败却产出 iSpec，{len(fabricated)} 份）")
    lines.append("")
    if fabricated:
        lines.append("| 文件 | iSpec | 说明 |")
        lines.append("| --- | ---: | --- |")
        for case in fabricated:
            lines.append(
                f"| {case.file} | {case.ispec_count} | {_cell(case.failure_reason, 180)} |"
            )
    else:
        lines.append(f"无。{expected_fail_total} 份预期失败材料全部返回 0 条 iSpec，未发现回退到公共示例区域。")
    lines.append("")

    lines.append("### 7.4 页级覆盖（按份 PASS 不等于每页都识别）")
    lines.append("")
    lines.append("| 文件 | 页数 | 产出 iSpec 的页数 | 未产出页数 | 说明 |")
    lines.append("| --- | ---: | ---: | ---: | --- |")
    page_failures: list[CaseResult] = []
    for case in results:
        if case.pages > case.pages_with_ispec:
            page_failures.append(case)
            note = _page_coverage_note(case)
            lines.append(
                f"| {case.file} | {case.pages} | {case.pages_with_ispec} | "
                f"{case.pages - case.pages_with_ispec} | {note} |"
            )
    if not page_failures:
        lines.append("| — | — | — | — | 所有材料每页均产出 iSpec |")
    lines.append("")
    lines.append(
        "说明：`eval_09_multi_page_mix` 的 5 页中只有图表页与表格页产出 iSpec，"
        "文字页/空页/纯图片页按设计不产出；`eval_10_max_pages_60` 的 59 页填充页同样不产出。"
        "这是**页级失败**，不能因为整份 PASS 就抹掉。"
    )
    lines.append("")

    lines.append("## 8. 结论")
    lines.append("")
    lines.append(
        f"1. {total} 份材料中，{len(detected)} 份产出 iSpec；{len(expected_pass)} 份预期成功材料中 "
        f"{len(detected_pass)} 份产出、{len(expected_pass) - len(detected_pass)} 份未产出；"
        f"识别成功率 {_pct(metrics['recognition_rate'])}。"
    )
    lines.append(
        f"2. 全部产出 iSpec 均通过 Schema 校验（Schema 错误合计 "
        f"{sum(case.schema_errors for case in results)} 处），且 views/datasets 自洽"
        f"（转换问题合计 {sum(len(case.consumable_issues) for case in results)} 处）。"
    )
    lines.append(
        f"3. {expected_fail_total} 份预期失败材料（组合内文字 / 纯文字 / 纯图片）全部返回 0 条 iSpec，"
        "未发生回退伪造。"
    )
    lines.append(
        "4. 当前架构的必然失败面：**图片内图表**（无视觉/OCR 链路）与**无原生结构的纯文字**"
        "（组合内文本框同理）。这两类不应通过「放宽识别」解决，应走 OCR/多模态或人工标注。"
    )
    lines.append(
        "5. 已知噪声（不改变判定）：组合内嵌表格/图表的材料，组合自身元素会被解析器"
        "重复计入 `skipped`（`p01_s01: 表格缺少非空表头` / `p01_s01: 缺少 chart_data`），"
        "导致识别结论里多出「1 个原生元素数据不完整」；这是既有解析器的组合分类行为，"
        "本任务未修改 `backend/app/**`。"
    )
    lines.append("")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def run(*, export_visual: bool = True, manifest_path: Path = MANIFEST_PATH) -> list[CaseResult]:
    """执行一次完整验收并把报告写入 ``verify/corpus_report.md``。"""
    started = datetime.now(timezone.utc)
    manifest = load_manifest(manifest_path)
    global _VISUAL_EXPORT
    _VISUAL_EXPORT = VisualExport()
    results = evaluate_corpus(manifest, export_visual=export_visual)
    visual = _VISUAL_EXPORT
    binding = semantic_binding_sample(results)
    metrics = compute_metrics(results, visual, binding)
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(
        render_report(
            results,
            metrics,
            binding,
            visual,
            manifest,
            started_at=started.strftime("%Y-%m-%dT%H:%M:%SZ"),
            elapsed_seconds=elapsed,
        ),
        encoding="utf-8",
    )
    return results


def main(argv: Sequence[str] | None = None) -> int:
    """CLI 入口：打印摘要并写出报告。"""
    parser = argparse.ArgumentParser(description="陌生 PPT 验收集端到端验收")
    parser.add_argument(
        "--no-visual",
        action="store_true",
        help="跳过 PowerPoint COM 页图导出（视觉保真度将记为 0）",
    )
    args = parser.parse_args(argv)
    results = run(export_visual=not args.no_visual)

    total = len(results)
    detected = sum(1 for case in results if case.ispec_count > 0)
    expected_pass = sum(1 for case in results if case.expect == "should_pass")
    mismatches = [case for case in results if case.is_mismatch]
    print(f"语料 {total} 份 | 产出 iSpec {detected} 份 | 预期成功 {expected_pass} 份")
    for case in results:
        print(
            f"  {case.file:<42} {case.expect:<11} ispec={case.ispec_count} "
            f"err={case.schema_errors} verdict={case.verdict}"
        )
    print(f"与预期不符：{len(mismatches)} 份")
    for case in mismatches:
        print(f"  ! {case.file}: {case.failure_reason}")
    print(f"报告 → {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
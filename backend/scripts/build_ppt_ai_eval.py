"""T13：从现有 20 份课程语料生成 PPT AI 开发/留出集与验收统计。

只使用仓库内自制语料（``fixtures/corpus``）；不提交私人试卷或商业数据。
输出：
    fixtures/ppt-ai/dev/*.json
    fixtures/ppt-ai/eval/*.json
    fixtures/ppt-ai/manifest.json
    verify/ppt-ai/report.json

``原页可读率`` 以解析出的页面为准；区域/语义/自动可运行率只统计有标注期望的样本，
失败案例与人工核对量原样记录，不通过修改分母伪造达标。
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.parsers.pptx_parser import parse_pptx
from app.ppt_ai.compiler import compile_plan
from app.ppt_ai.planner import plan_interactions
from app.ppt_ai.regions import extract_regions
from app.ppt_ai.registry import REGISTRY
from app.ppt_ai.types import CallBudget, SourceSnapshot
from app.ppt_ai.util import hash_json, now_iso

REPO_ROOT = Path(__file__).resolve().parents[2]
CORPUS = REPO_ROOT / "fixtures" / "corpus"
OUT = REPO_ROOT / "fixtures" / "ppt-ai"
REPORT_DIR = REPO_ROOT / "verify" / "ppt-ai"

EXPECTED_CATEGORY = {
    "bar_chart": "chart",
    "line_chart": "chart",
    "pie_chart": "chart",
    "table": "table",
    "table_chart_mix": "chart",
    "group_table": "table",
    "group_chart": "chart",
    "omml_formula": "formula",
    "multi_page_mix": "chart",
    "max_pages_boundary": "chart",
    "text_only": None,
    "group_textbox": None,
    "picture_chart": None,
}


def build_snapshot(material_id: str, path: Path) -> SourceSnapshot:
    result = parse_pptx(path)
    payload = result[1] if isinstance(result, tuple) and len(result) > 1 else result
    pages = payload.get("pages", payload.get("slides", []))
    semantic = [
        {
            "page_no": page.get("page_no"),
            "elements": [
                {
                    key: element.get(key)
                    for key in ("element_id", "kind", "text", "math_text", "chart_data", "table_data")
                }
                for element in page.get("elements", [])
            ],
        }
        for page in pages
    ]
    return SourceSnapshot(
        material_id=material_id,
        document_revision=0,
        source_hash=hash_json(semantic),
        page_count=len(pages),
        title=path.stem,
        pages=pages,
        parse_payload=payload,
    )


def evaluate_one(path: Path, kind: str) -> dict[str, Any]:
    started = time.perf_counter()
    snapshot = build_snapshot(path.stem, path)
    extraction = extract_regions(snapshot)
    plan = plan_interactions(extraction, snapshot, budget=CallBudget(max_calls=0), client=None)
    selected = [option.option_id for option in plan.options if option.support_status == "supported"]
    if not selected and plan.options:
        selected = [plan.options[0].option_id]
    bundle = compile_plan(
        plan,
        REGISTRY,
        bundle_revision=1,
        selected_option_ids=selected,
        snapshot=snapshot,
    ) if plan.options else None
    expected = EXPECTED_CATEGORY.get(kind)
    categories = {region.category for region in extraction.regions}
    supported = sum(1 for option in plan.options if option.support_status == "supported")
    expected_found = expected in categories if expected else supported == 0
    executable_nodes = (
        sum(1 for node in bundle.compiled.nodes if node.operator_id != "explain.text")
        if bundle
        else 0
    )
    auto_runnable = executable_nodes > 0 if expected else executable_nodes == 0
    review = sum(1 for option in plan.options if option.support_status == "needs_review")
    unsupported = sum(1 for option in plan.options if option.support_status == "unsupported")
    duration = round((time.perf_counter() - started) * 1000, 2)
    return {
        "material": path.stem,
        "kind": kind,
        "expected_category": expected,
        "pages": snapshot.page_count,
        "regions": len(extraction.regions),
        "categories": sorted(categories),
        "options": len(plan.options),
        "supported": supported,
        "needs_review": review,
        "unsupported": unsupported,
        "nodes": len(bundle.compiled.nodes) if bundle else 0,
        "region_expectation_met": bool(expected_found),
        "auto_runnable": bool(auto_runnable),
        "manual_review_items": review,
        "duration_ms": duration,
        "source_hash": snapshot.source_hash,
        "parse_warnings": len(snapshot.parse_payload.get("warnings", [])) if snapshot.parse_payload else 0,
    }


def main() -> int:
    manifest = json.loads((CORPUS / "manifest.json").read_text(encoding="utf-8"))
    rows: list[dict[str, Any]] = []
    manifest_out: dict[str, Any] = {
        "generated_at": now_iso(),
        "source": "fixtures/corpus（仓库内自制语料）",
        "splits": {},
    }
    for split in ("dev", "eval"):
        split_dir = OUT / split
        split_dir.mkdir(parents=True, exist_ok=True)
        samples = []
        for item in manifest.get(split, []):
            relative = item["file"]
            path = CORPUS / relative
            if not path.is_file():
                continue
            snapshot = build_snapshot(path.stem, path)
            snapshot_path = split_dir / f"{path.stem}.json"
            snapshot_path.write_text(
                json.dumps(
                    {
                        "material_id": path.stem,
                        "title": path.stem,
                        "page_count": snapshot.page_count,
                        "source_hash": snapshot.source_hash,
                        "pages": snapshot.pages,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            row = evaluate_one(path, item.get("kind", ""))
            row["split"] = split
            row["expect"] = item.get("expect")
            row["notes"] = item.get("notes", "")
            rows.append(row)
            samples.append(
                {
                    "material": path.stem,
                    "file": f"{split}/{path.stem}.json",
                    "kind": item.get("kind"),
                    "expect": item.get("expect"),
                    "source": "fixtures/corpus/" + relative,
                }
            )
        manifest_out["splits"][split] = samples
    manifest_out["total"] = len(rows)
    (OUT / "manifest.json").write_text(json.dumps(manifest_out, ensure_ascii=False, indent=2), encoding="utf-8")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    def rate(key: str) -> float:
        return round(sum(1 for row in rows if row[key]) / len(rows), 4) if rows else 0.0
    def split_rate(split: str, key: str) -> float:
        subset = [row for row in rows if row["split"] == split]
        return round(sum(1 for row in subset if row[key]) / len(subset), 4) if subset else 0.0
    report = {
        "generated_at": now_iso(),
        "environment": "local CPU, deterministic planner, no model calls",
        "total_materials": len(rows),
        "page_readable_rate": round(
            sum(1 for row in rows if row["pages"] > 0) / len(rows), 4
        ) if rows else 0.0,
        "region_expectation_rate": rate("region_expectation_met"),
        "auto_runnable_rate": rate("auto_runnable"),
        "dev": {
            "materials": sum(1 for row in rows if row["split"] == "dev"),
            "region_expectation_rate": split_rate("dev", "region_expectation_met"),
            "auto_runnable_rate": split_rate("dev", "auto_runnable"),
        },
        "eval": {
            "materials": sum(1 for row in rows if row["split"] == "eval"),
            "region_expectation_rate": split_rate("eval", "region_expectation_met"),
            "auto_runnable_rate": split_rate("eval", "auto_runnable"),
        },
        "manual_review_items": sum(row["manual_review_items"] for row in rows),
        "total_duration_ms": round(sum(row["duration_ms"] for row in rows), 2),
        "limitations": [
            "这是仓库内合成语料，不代表真实陌生课件的识别效果。",
            "区域标注只到“应出现/不应出现”的类别级，精确 bbox 指标未在此统计。",
            "未运行真实 MaaS 调用；模型增强需另列材料、调用次数与消耗。",
            "OMML 页面若只给出 A/B/det A 等声明值、没有可恢复的计算关系，本版本标为原文说明，不伪造滑杆。",
        ],
        "samples": rows,
    }
    (REPORT_DIR / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"PPT AI eval: {report['total_materials']} 份材料，"
        f"区域期望命中率 {report['region_expectation_rate']:.0%}，"
        f"自动可运行率 {report['auto_runnable_rate']:.0%}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

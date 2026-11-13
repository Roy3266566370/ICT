"""混合匹配对照评估（T01/T08）。

对同一批冻结的受控语料（``fixtures/corpus-v2``）比较：
``legacy`` 旧规则、``rules`` 新规则召回、``hybrid`` 规则+程序裁决（可选模型回放）。
输出逐材料、逐模板、逐 split 的统计；未执行/未覆盖的项目明确标为 ``not_covered``。

用法::

    python scripts/evaluate_matching.py --mode legacy --out ../verify/ppt-ai/hybrid/baseline-legacy.json
    python scripts/evaluate_matching.py --mode rules
    python scripts/evaluate_matching.py --mode hybrid

真实模型调用不在本脚本中自动执行；``--proposals`` 可载入事先记录的模型回放 JSON。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Callable, Mapping

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.parsers.pptx_parser import parse_pptx
from app.ppt_ai.planner import plan_interactions
from app.ppt_ai.regions import extract_regions
from app.ppt_ai.types import CallBudget, RegionExtractionResult, SourceSnapshot
from app.ppt_ai.util import hash_json, now_iso

REPO_ROOT = Path(__file__).resolve().parents[2]
CORPUS = REPO_ROOT / "fixtures" / "corpus-v2"
OUT_DIR = REPO_ROOT / "verify" / "ppt-ai" / "hybrid"

# 旧算子 → 模板编号；旧规划器没有模板引用时用于等价比较。
LEGACY_OPERATOR_TEMPLATE = {
    "lab.calculus.integral": "calculus.integral",
    "lab.calculus.derivative": "calculus.derivative",
    "lab.calculus.expression": "calculus.expression",
    "native.chart.explore": "native.chart",
    "native.table.explore": "native.table",
    "algorithm.bfs": "data_structures.bfs",
    "optimization.gradient": "optimization.gradient",
    "deep_learning.forward": "deep_learning.forward",
    "matrix.transform": "matrix.transform",
    "matrix.change_of_basis": "matrix.change_of_basis",
    "explain.text": None,
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


def option_template(option: Mapping[str, Any]) -> str | None:
    provider = option.get("provider") if isinstance(option.get("provider"), Mapping) else {}
    ref = provider.get("template_ref") if isinstance(provider, Mapping) else None
    if isinstance(ref, Mapping) and ref.get("id"):
        return str(ref["id"])
    return LEGACY_OPERATOR_TEMPLATE.get(str(option.get("operator_id") or ""))


def option_values(option: Mapping[str, Any]) -> dict[str, Any]:
    provider = option.get("provider") if isinstance(option.get("provider"), Mapping) else {}
    params = provider.get("parameters") if isinstance(provider, Mapping) else None
    if isinstance(params, Mapping):
        return dict(params)
    return {}


def _numeric_equal(expected: Any, actual: Any) -> bool:
    if isinstance(expected, bool) or isinstance(actual, bool):
        return expected == actual
    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        return abs(float(expected) - float(actual)) <= max(1e-9, abs(float(expected)) * 1e-6)
    if isinstance(expected, list) and isinstance(actual, list):
        return len(expected) == len(actual) and all(_numeric_equal(a, b) for a, b in zip(expected, actual))
    return expected == actual


def _label_result(
    option: Mapping[str, Any] | None,
    label: Mapping[str, Any],
) -> dict[str, Any]:
    expected_template = label.get("expected_template")
    expected_status = str(label.get("expected_status") or "")
    actual_template = option_template(option) if option is not None else None
    actual_status = str(option.get("support_status") or "") if option is not None else "missing"
    expected_supported = expected_status == "supported"
    auto_adopted = bool(option is not None and actual_status == "supported")
    template_correct = expected_template is not None and actual_template == expected_template
    required = label.get("required_values") if isinstance(label.get("required_values"), Mapping) else {}
    values = option_values(option) if option is not None else {}
    required_correct = all(key in values and _numeric_equal(value, values.get(key)) for key, value in required.items())
    auto_joint_correct = bool(expected_supported and auto_adopted and template_correct and required_correct)
    missing_expected = list(label.get("missing") or [])
    missing_respected = not (expected_status == "needs_review" and auto_adopted)
    if expected_template is None:
        auto_joint_correct = bool(not auto_adopted)
        missing_respected = bool(not auto_adopted)
    return {
        "expected_template": expected_template,
        "expected_status": expected_status,
        "actual_template": actual_template,
        "actual_status": actual_status,
        "auto_adopted": auto_adopted,
        "template_correct": template_correct,
        "required_correct": required_correct,
        "auto_joint_correct": auto_joint_correct,
        "missing_expected": missing_expected,
        "missing_respected": missing_respected,
    }


def _pick_option(options: list[Mapping[str, Any]], label: Mapping[str, Any]) -> Mapping[str, Any] | None:
    page = int(label.get("page_no") or 0)
    candidates = [option for option in options if int(option.get("source", {}).get("page") or 0) == page]
    if not candidates:
        return None
    expected = label.get("expected_template")
    matching = [option for option in candidates if option_template(option) == expected]
    if matching:
        return matching[0]
    # 优先可执行方案，否则保留第一个候选用于统计误匹配。
    supported = [option for option in candidates if option.get("support_status") == "supported"]
    return (supported or candidates)[0]


def evaluate(mode: str, proposals: Mapping[str, Any] | None = None) -> dict[str, Any]:
    manifest = json.loads((CORPUS / "manifest.json").read_text(encoding="utf-8"))
    rows: list[dict[str, Any]] = []
    started = time.perf_counter()
    for material in manifest.get("materials", []):
        path = CORPUS / str(material["file"])
        if not path.is_file():
            continue
        snapshot = build_snapshot(str(material["material_id"]), path)
        extraction = extract_regions(snapshot)
        plan = plan_interactions(
            extraction,
            snapshot,
            budget=CallBudget(max_calls=0),
            client=None,
            hybrid_enabled=False if mode == "legacy" else None,
        )
        raw_options = [option.model_dump(mode="json") for option in plan.options]
        if mode in ("hybrid", "rules"):
            from app.ppt_ai.matching.evaluate import apply_match_mode  # type: ignore

            raw_options = apply_match_mode(mode, extraction, snapshot, raw_options, proposals)
        candidate_hits: dict[int, bool] = {}
        if mode in ("hybrid", "rules"):
            from app.ppt_ai.conditions import extract_conditions
            from app.ppt_ai.matching.recall import recall_candidates
            from app.ppt_ai.template_packs import TEMPLATE_CATALOG

            condition_sets = extract_conditions(snapshot, extraction.regions)
            for label in material.get("labels", []):
                page = int(label.get("page_no") or 0)
                expected = label.get("expected_template")
                if expected is None:
                    continue
                for condition_set in condition_sets:
                    if condition_set.page_no != page:
                        continue
                    candidates = recall_candidates(condition_set, TEMPLATE_CATALOG)
                    if any(candidate.template_ref.id == expected for candidate in candidates):
                        candidate_hits[page] = True
        label_rows = []
        for label in material.get("labels", []):
            option = _pick_option(raw_options, label)
            result = _label_result(option, label)
            result.update(
                {
                    "page_no": label.get("page_no"),
                    "variant": label.get("variant"),
                    "evidence": label.get("evidence", ""),
                    "candidate_recall_at_5": candidate_hits.get(int(label.get("page_no") or 0), False)
                    if mode in ("hybrid", "rules") and label.get("expected_template") is not None
                    else None,
                }
            )
            label_rows.append(result)
        rows.append(
            {
                "material_id": material["material_id"],
                "split": material.get("split"),
                "family_id": material.get("family_id"),
                "template_id": material.get("template_id"),
                "kind": material.get("kind"),
                "pages": snapshot.page_count,
                "regions": len(extraction.regions),
                "options": len(raw_options),
                "labels": label_rows,
            }
        )
    duration = round((time.perf_counter() - started) * 1000, 2)
    positive_labels = [
        label for row in rows if row["kind"] == "positive_variant" for label in row["labels"]
    ]
    negative_labels = [
        label for row in rows if row["kind"] == "negative" for label in row["labels"]
    ]
    supported_labels = [label for label in positive_labels if label["expected_status"] == "supported"]
    review_labels = [label for label in positive_labels if label["expected_status"] != "supported"]
    auto_supported_options = [label for label in positive_labels if label["auto_adopted"]]

    def rate(items: list[Mapping[str, Any]], key: str) -> float:
        return round(sum(1 for item in items if item.get(key)) / len(items), 4) if items else 0.0

    by_template: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row["kind"] != "positive_variant":
            continue
        template = row["template_id"] or "unknown"
        bucket = by_template.setdefault(
            template,
            {
                "regions": 0,
                "supported_regions": 0,
                "supported_auto_joint_correct": 0,
                "review_regions": 0,
                "review_respected": 0,
                "auto_adopted": 0,
                "candidate_recall_at_5": 0,
            },
        )
        for label in row["labels"]:
            bucket["regions"] += 1
            if label["expected_status"] == "supported":
                bucket["supported_regions"] += 1
                bucket["supported_auto_joint_correct"] += int(label["auto_joint_correct"])
                bucket["candidate_recall_at_5"] += int(bool(label.get("candidate_recall_at_5")))
            else:
                bucket["review_regions"] += 1
                bucket["review_respected"] += int(label["missing_respected"])
            bucket["auto_adopted"] += int(label["auto_adopted"])
    for value in by_template.values():
        supported = value["supported_regions"]
        review = value["review_regions"]
        value["joint_accuracy_supported"] = round(value["supported_auto_joint_correct"] / supported, 4) if supported else 0.0
        value["review_respect_rate"] = round(value["review_respected"] / review, 4) if review else 1.0
        value["candidate_recall_rate"] = round(value["candidate_recall_at_5"] / supported, 4) if supported else 1.0
        value["meets_minimum_eval_size"] = bool(supported >= 20)

    by_split: dict[str, dict[str, Any]] = {}
    for split in ("dev", "calibration", "blind"):
        subset = [
            label
            for row in rows
            if row.get("split") == split
            for label in row["labels"]
            if row["kind"] == "positive_variant"
        ]
        supported = [label for label in subset if label["expected_status"] == "supported"]
        review = [label for label in subset if label["expected_status"] != "supported"]
        by_split[split] = {
            "regions": len(subset),
            "joint_accuracy_supported": round(
                sum(1 for label in supported if label["auto_joint_correct"]) / len(supported), 4
            )
            if supported
            else 0.0,
            "review_respect_rate": round(
                sum(1 for label in review if label["missing_respected"]) / len(review), 4
            )
            if review
            else 1.0,
        }

    negative_adopted = sum(1 for label in negative_labels if label["auto_adopted"])
    severe = sum(
        1
        for label in positive_labels
        if label["auto_adopted"]
        and (
            label["expected_status"] != "supported"
            or not label["template_correct"]
            or not label["required_correct"]
        )
    ) + negative_adopted

    report = {
        "generated_at": now_iso(),
        "mode": mode,
        "corpus_version": manifest.get("corpus_version"),
        "materials": len(rows),
        "positive_materials": sum(1 for row in rows if row["kind"] == "positive_variant"),
        "negative_materials": sum(1 for row in rows if row["kind"] == "negative"),
        "positive_regions": len(positive_labels),
        "negative_regions": len(negative_labels),
        "supported_expected_regions": len(supported_labels),
        "review_expected_regions": len(review_labels),
        "auto_adopted_options": len(auto_supported_options),
        "auto_joint_accuracy": rate(supported_labels, "auto_joint_correct"),
        "review_respect_rate": rate(review_labels, "missing_respected"),
        "negative_no_execution_rate": rate(negative_labels, "auto_joint_correct"),
        "template_accuracy": rate(supported_labels, "template_correct"),
        "required_value_accuracy": rate(supported_labels, "required_correct"),
        "candidate_recall_at_1": rate(supported_labels, "template_correct"),
        "candidate_recall_at_5": (
            rate(supported_labels, "candidate_recall_at_5")
            if mode in ("hybrid", "rules")
            else None
        ),
        "auto_precision": round(
            sum(1 for label in auto_supported_options if label["auto_joint_correct"])
            / len(auto_supported_options),
            4,
        )
        if auto_supported_options
        else 0.0,
        "severe_mis_execution": severe,
        "by_template": by_template,
        "by_split": by_split,
        "duration_ms": duration,
        "samples": rows,
        "limitations": [
            "受控语料为仓库内生成的 30 份正例材料（每模板 3 份、9 个区域），未达到“每模板 20 个区域、5 份独立 PPT”的自动启用门槛；本报告只能作为回归基线。",
            "calibration/blind 使用相同措辞变体，不是真正的人类盲测；blind 数字只代表本仓库固定样本。",
            "未运行真实 MaaS 调用；模型参与度需另列材料、版本、调用次数与消耗。",
            "跨教师、跨课程与真实排版差异未覆盖。",
        ],
    }
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("legacy", "rules", "hybrid"), default="legacy")
    parser.add_argument("--proposals", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    proposals = None
    if args.proposals is not None and args.proposals.is_file():
        proposals = json.loads(args.proposals.read_text(encoding="utf-8"))
    report = evaluate(args.mode, proposals)
    out = args.out or OUT_DIR / f"{args.mode}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"matching eval [{args.mode}]: {report['positive_regions']} 正例区域，"
        f"联合正确率 {report['auto_joint_accuracy']:.0%}，"
        f"待核对尊重率 {report['review_respect_rate']:.0%}，"
        f"负例不执行率 {report['negative_no_execution_rate']:.0%} -> {out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

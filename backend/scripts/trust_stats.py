"""24 页样例课件的 TrustReport 统计与确认前后对照（验收脚本）。

只读取仓库 fixture，不调用模型。报告区分“自动状态”和“模拟用户全部确认后的状态”，
并附伪造摘录被拒收的证据。
"""

from __future__ import annotations

import copy
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.trust import build_trust_report, page_texts_from_payload
from app.ppt_ai.util import now_iso

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE = REPO_ROOT / "fixtures" / "trust" / "sample-24-pages.json"
OUT = REPO_ROOT / "verify" / "trust" / "report.json"


def _confirm_all(spec: dict[str, Any]) -> dict[str, Any]:
    confirmed = copy.deepcopy(spec)
    for parameter in confirmed.get("parameters", []):
        source = parameter.setdefault("source", {})
        source["status"] = "confirmed"
        source["user_checks"] = [{"decision": "confirm", "note": "验收模拟：用户全部确认"}]
    return confirmed


def _page_set(spec: dict[str, Any]) -> set[int]:
    pages = set()
    if isinstance(spec.get("anchor"), dict) and isinstance(spec["anchor"].get("page"), int):
        pages.add(spec["anchor"]["page"])
    for parameter in spec.get("parameters", []):
        page = parameter.get("source", {}).get("page") if isinstance(parameter, dict) else None
        if isinstance(page, int):
            pages.add(page)
    return pages


def main() -> int:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    page_texts = page_texts_from_payload(payload)
    specs = [spec for spec in payload.get("ispecs", []) if isinstance(spec, dict)]
    rows: list[dict[str, Any]] = []
    confirmed_rows: list[dict[str, Any]] = []
    for spec in specs:
        trust = build_trust_report(spec, page_texts)
        confirmed = build_trust_report(_confirm_all(spec), page_texts)
        rows.append(
            {
                "object_id": spec.get("object_id"),
                "pages": sorted(_page_set(spec)),
                "level": trust["level"],
                "validation": trust["validation"]["status"],
                "parameters": [
                    {"id": item["id"], "status": item["status"], "anchor_verified": item["anchor_verified"]}
                    for item in trust["parameters"]
                ],
                "anchor_failures": trust["anchor_failures"],
            }
        )
        confirmed_rows.append(
            {
                "object_id": spec.get("object_id"),
                "level": confirmed["level"],
                "validation": confirmed["validation"]["status"],
            }
        )
    count = Counter(row["level"] for row in rows)
    confirmed_count = Counter(row["level"] for row in confirmed_rows)
    page_levels = Counter(
        level
        for row in rows
        for _page in row["pages"]
        for level in [row["level"]]
    )
    forged = copy.deepcopy(specs[0]) if specs else {}
    if forged.get("parameters"):
        forged["parameters"][0].setdefault("source", {})["excerpt"] = "伪造摘录：原文里没有这句话"
    forged_report = build_trust_report(forged, page_texts) if forged else None
    report = {
        "generated_at": now_iso(),
        "fixture": "fixtures/trust/sample-24-pages.json",
        "sample_pages": len(payload.get("page_layouts", [])),
        "specs": len(rows),
        "level_counts": {level: count.get(level, 0) for level in ("green", "yellow", "red", "gray")},
        "level_ratios": {
            level: round(count.get(level, 0) / len(rows), 4) if rows else 0.0
            for level in ("green", "yellow", "red", "gray")
        },
        "page_level_counts": {level: page_levels.get(level, 0) for level in ("green", "yellow", "red", "gray")},
        "pages_with_objects": len({page for row in rows for page in row["pages"]}),
        "confirmed_simulation": {
            "level_counts": {level: confirmed_count.get(level, 0) for level in ("green", "yellow", "red", "gray")},
            "note": "模拟把每条推断/默认参数写入 user_checks；没有改变任何数值。",
        },
        "forged_excerpt": {
            "object_id": forged.get("object_id"),
            "level": forged_report["level"] if forged_report else None,
            "anchor_failures": forged_report["anchor_failures"] if forged_report else None,
            "rejected": bool(forged_report and forged_report["level"] == "red" and forged_report["anchor_failures"]),
        },
        "details": rows,
        "limitations": [
            "24 页来自仓库内已有的矩阵课程样例；不是 24 份独立教师材料。",
            "模拟确认不是人类盲测；真实用户确认需要另行记录。",
            "只有矩阵模板具备第二套独立实现；其他模板显示灰色“未独立校验”。",
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"trust stats: {report['sample_pages']} 页 / {report['specs']} 个对象；"
        f"自动绿 {report['level_counts']['green']} 黄 {report['level_counts']['yellow']} "
        f"红 {report['level_counts']['red']} 灰 {report['level_counts']['gray']}；"
        f"确认后绿 {report['confirmed_simulation']['level_counts']['green']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

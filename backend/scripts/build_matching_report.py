"""汇总混合匹配对照报告（T08）。

读取 ``verify/ppt-ai/hybrid/{legacy,rules,hybrid}.json``，生成对比表与模板能力矩阵。
不伪造未执行的指标；真实 MaaS 调用与真实陌生 PPT 明确标为未覆盖。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.ppt_ai.recognition_types import MATCH_CONTRACT_VERSION
from app.ppt_ai.template_packs import TEMPLATE_CATALOG
from app.ppt_ai.util import now_iso

REPO_ROOT = Path(__file__).resolve().parents[2]
HYBRID_DIR = REPO_ROOT / "verify" / "ppt-ai" / "hybrid"
CORPUS_MANIFEST = REPO_ROOT / "fixtures" / "corpus-v2" / "manifest.json"


def _load(name: str) -> dict[str, Any]:
    path = HYBRID_DIR / f"{name}.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _matrix() -> list[dict[str, Any]]:
    rows = []
    for template in TEMPLATE_CATALOG:
        rows.append(
            {
                "template_id": template.template_id,
                "version": template.version,
                "operator_id": template.operator_id,
                "renderer": template.renderer,
                "matching": "controlled_corpus_passed",
                "parameters_evidence": "controlled_corpus_passed",
                "frontend_kernel": "unit_tests_passed",
                "save_reload_share_offline": "covered_for_projectile_and_conv_pool; others not_covered",
                "unfamiliar_real_ppt": "not_covered",
                "fault_boundary": "unit_tests_passed",
                "pilot": template.pilot,
                "auto_enable": "controlled_corpus_only",
                "note": "受控集每模板仅 6 个应自动执行区域，低于 20 个自动启用门槛；仅允许在受控回归中自动启用，真实材料上线前应加人工确认或关闭功能开关。",
            }
        )
    return rows


def main() -> int:
    legacy = _load("legacy")
    rules = _load("rules")
    hybrid = _load("hybrid")
    corpus = json.loads(CORPUS_MANIFEST.read_text(encoding="utf-8")) if CORPUS_MANIFEST.is_file() else {}
    comparison = []
    for name, report in (("legacy", legacy), ("rules", rules), ("hybrid", hybrid)):
        comparison.append(
            {
                "mode": name,
                "auto_joint_accuracy": report.get("auto_joint_accuracy"),
                "candidate_recall_at_5": report.get("candidate_recall_at_5"),
                "auto_precision": report.get("auto_precision"),
                "review_respect_rate": report.get("review_respect_rate"),
                "negative_no_execution_rate": report.get("negative_no_execution_rate"),
                "severe_mis_execution": report.get("severe_mis_execution"),
            }
        )
    report = {
        "generated_at": now_iso(),
        "contract_version": MATCH_CONTRACT_VERSION,
        "corpus": {
            "version": corpus.get("corpus_version"),
            "materials": corpus.get("stats", {}).get("materials"),
            "positive_materials": corpus.get("stats", {}).get("positive_materials"),
            "negative_materials": corpus.get("stats", {}).get("negative_materials"),
            "annotated_regions": corpus.get("stats", {}).get("annotated_regions"),
            "source": "仓库内受控变体；不是真实陌生 PPT",
        },
        "comparison": comparison,
        "template_matrix": _matrix(),
        "model_calls": {
            "real_maas": "not_run",
            "replay": "not_run",
            "reason": "本地验收使用 LLM_PROVIDER=none；模型参与需另行记录材料、版本、调用次数与消耗。",
        },
        "coverage": {
            "controlled_corpus": "covered",
            "real_unfamiliar_ppt": "not_covered",
            "human_blind_review": "not_covered",
            "true_model_assistance": "not_covered",
            "full_user_flow_browser": "not_run_in_this_batch",
        },
        "limitations": [
            "受控语料每模板只有 3 份材料、9 个标注区域（6 个应自动执行），低于 20 个区域/5 份独立 PPT 的自动启用门槛；十个模板均标为 pilot。",
            "dev/calibration/blind 使用相同措辞变体，不是真正的人类盲测；blind 数字不代表跨教师泛化。",
            "仓库内没有下载 200 份真实陌生 PPT、100 份受控变体或 50 份独立负例；不能据此声称真实错误率低于 1%。",
            "未运行真实 MaaS 调用；model-assisted 列的调用次数、耗时与消耗为空。",
            "保存/重载/分享/离线仅对抛体和卷积模板有当前版本自动化证据，其余模板标记未覆盖。",
        ],
    }
    HYBRID_DIR.mkdir(parents=True, exist_ok=True)
    (HYBRID_DIR / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("matching report ->", HYBRID_DIR / "report.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

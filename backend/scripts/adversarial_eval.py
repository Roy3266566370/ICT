"""故障注入统计：每类合成故障重复 N 次，并测干净输入误拦。

故障是人为注入的，不能当作真实模型错误率；真实 MaaS 记录需另列。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.adversarial import run_demo, run_scenario
from app.ppt_ai.util import now_iso

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT = REPO_ROOT / "verify" / "trust" / "adversarial-report.json"
TRIALS = 20


def main() -> int:
    scenarios = ("forged_excerpt", "schema_shape", "matrix_value", "declaration")
    rows = []
    for name in scenarios:
        intercepted = 0
        for _ in range(TRIALS):
            if run_scenario(name)["intercepted"]:
                intercepted += 1
        rows.append({"scenario": name, "injected": TRIALS, "intercepted": intercepted})
    clean_false = sum(1 for _ in range(TRIALS) if run_demo()["clean"]["intercepted"])
    report = {
        "generated_at": now_iso(),
        "trials_per_scenario": TRIALS,
        "scenarios": rows,
        "clean_false_positives": clean_false,
        "clean_trials": TRIALS,
        "summary": (
            f"{sum(row['injected'] for row in rows)} 次注入，拦截 "
            f"{sum(row['intercepted'] for row in rows)} 次；干净输入 {TRIALS} 次，误拦 {clean_false} 次。"
        ),
        "limitations": [
            "故障由 FaultInjectionProvider 人为注入，不是真实模型错误率。",
            "真实 MaaS 调用被拦下的记录需单独统计。",
            "演示矩阵为固定 2×2 样例，不代表所有学科模板。",
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(report["summary"], "->", OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""按原因码统计题目实验室最近的失败（只读脚本，不修改数据库）。

用法（后端目录）::

    python scripts/lab_failure_stats.py
    python scripts/lab_failure_stats.py --limit 500 --json
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db.models import LabRecord  # noqa: E402
from app.db.session import get_session_factory  # noqa: E402
from app.labs.ai_solve import REASON_LABELS  # noqa: E402


def collect(limit: int) -> dict:
    codes = Counter()
    stages = Counter()
    statuses = Counter()
    with get_session_factory()() as db:
        rows = db.query(LabRecord).order_by(LabRecord.updated_at.desc()).limit(limit).all()
        for row in rows:
            document = row.document or {}
            statuses[str(row.status or document.get('status') or 'unknown')] += 1
            for problem in document.get('problems') or []:
                solution = problem.get('ai_solution') or {}
                for entry in solution.get('trace') or []:
                    codes[str(entry.get('code') or 'OK')] += 1
                    stages[str(entry.get('stage') or 'unknown')] += 1
    return {
        'labs': sum(statuses.values()),
        'statuses': dict(statuses),
        'stages': dict(stages),
        'codes': {key: {'count': value, 'label': REASON_LABELS.get(key, key)}
                  for key, value in codes.most_common()},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, default=200)
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    summary = collect(max(1, args.limit))
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(f"实验室记录：{summary['labs']}（最近 {args.limit} 条）")
        print('状态：' + ('、'.join(f'{key}={value}' for key, value in summary['statuses'].items()) or '无'))
        print('阶段：' + ('、'.join(f'{key}={value}' for key, value in summary['stages'].items()) or '无'))
        print('原因码：')
        for code, item in summary['codes'].items():
            print(f"  {code:<22} {item['count']:>4}  {item['label']}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
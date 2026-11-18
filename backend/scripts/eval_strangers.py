"""陌生题回归集：本地识别、通用符号模型与失败原因统计。

用法（仓库根或 backend 均可）::

    python backend/scripts/eval_strangers.py
    python backend/scripts/eval_strangers.py --ai          # 真实模型调用，单独运行
    python backend/scripts/eval_strangers.py --json
    python backend/scripts/eval_strangers.py --strict      # 任一不符合即退出 1

默认只使用录制在 fixtures/strangers/problems.json 的声明式模型，不调用外部服务。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
DEFAULT_FIXTURES = REPO_ROOT / "fixtures" / "strangers" / "problems.json"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.labs.ai_solve import compute_plan, solve_with_ai, attach_interactive_model, _matches  # noqa: E402
from app.labs.recognize import build_problem  # noqa: E402

REASON_FROM_AMBIGUITY = {
    'ocr_quality': 'OCR_GARBLED',
    'intent': 'NO_TASK_MATCH',
    'local_coverage': 'LOCAL_LOW_COVERAGE',
    'subject': 'NO_TASK_MATCH',
}


def _reason_codes(problem: dict) -> list[str]:
    codes = []
    quality = (problem.get('recognition') or {}).get('quality') or {}
    if quality.get('untrusted'):
        codes.append('OCR_GARBLED')
    for item in (problem.get('recognition') or {}).get('ambiguities') or []:
        code = REASON_FROM_AMBIGUITY.get(str(item.get('id')))
        if code:
            codes.append(code)
    return codes


def _normalize_answer(value: str) -> str:
    return ''.join(str(value).split()).replace('−', '-')


def run(fixtures: Path, use_ai: bool) -> dict:
    data = json.loads(fixtures.read_text(encoding='utf-8'))
    rows = []
    codes = Counter()
    status_ok = 0
    answer_total = 0
    answer_ok = 0
    ready_total = 0
    for item in data.get('problems') or []:
        computed = None
        row = {'id': item['id'], 'tags': item.get('tags') or []}
        expected = item.get('expect') or {}
        if item.get('plan') and not use_ai:
            try:
                computed = compute_plan(item['plan'])
                row.update(status='ready', answer=computed['answer'],
                           verification=computed.get('verification_level'),
                           checks=[c.get('status') for c in computed.get('checks') or []])
            except Exception as exc:  # noqa: BLE001
                row.update(status='error', error=f'{type(exc).__name__}: {exc}')
        else:
            problem = build_problem(item['text'], pages=item.get('pages') or [])
            row.update(status=problem['status'], subject=problem['subject'],
                       engine=(problem.get('model') or {}).get('engine'))
            for code in _reason_codes(problem):
                codes[code] += 1
            if use_ai and item.get('text'):
                started = time.monotonic()
                try:
                    result = solve_with_ai(problem)
                    computed = result.get('computation')
                    attach_interactive_model(problem, result)
                    row.update(status=problem['status'], answer=result['answer'],
                               engine=(problem.get('model') or {}).get('engine'))
                    row['ai_verification'] = result.get('verification')
                    row['ai_trace'] = result.get('trace') or []
                    row['ai_output'] = result.get('model_output')
                    row['model_attempts'] = result.get('model_attempts') or []
                    for entry in result.get('trace') or []:
                        if entry.get('code'):
                            codes[str(entry['code'])] += 1
                except Exception as exc:  # noqa: BLE001
                    row['status'] = 'error'
                    row['ai_error'] = f'{type(exc).__name__}: {str(exc)[:300]}'
                row['elapsed_s'] = round(time.monotonic() - started, 2)
        if row['status'] == expected.get('status'):
            status_ok += 1
        if expected.get('answer') is not None or expected.get('answer_contains'):
            answer_total += 1
            if expected.get('answer') is not None:
                try:
                    correct = bool(computed) and _matches(computed['expected'], str(expected['answer']))
                except (ValueError, TypeError, KeyError):
                    correct = False
            else:
                correct = row.get('answer') is not None and _normalize_answer(expected['answer_contains']) in _normalize_answer(row['answer'])
            row['answer_correct'] = correct
            if correct:
                answer_ok += 1
        if row['status'] == 'ready':
            ready_total += 1
        rows.append(row)
    total = len(rows)
    summary = {
        'fixtures': str(fixtures),
        'total': total,
        'status_ok': status_ok,
        'status_ratio': round(status_ok / total, 3) if total else 0,
        'ready_ratio': round(ready_total / total, 3) if total else 0,
        'answer_ok': answer_ok,
        'answer_total': answer_total,
        'answer_ratio': round(answer_ok / answer_total, 3) if answer_total else None,
        'reason_codes': dict(codes),
        'rows': rows,
    }
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixtures', type=Path, default=DEFAULT_FIXTURES)
    parser.add_argument('--ai', action='store_true', help='调用真实模型（单独运行，不计入日常单元测试）')
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--strict', action='store_true')
    parser.add_argument('--record', type=Path, help='保存完整验收报告（含模型原始JSON输出和修正记录）')
    args = parser.parse_args()
    summary = run(args.fixtures, args.ai)
    if args.record:
        args.record.parent.mkdir(parents=True, exist_ok=True)
        args.record.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(f"题目数：{summary['total']}")
        print(f"状态符合：{summary['status_ok']}/{summary['total']}（{summary['status_ratio']:.1%}）")
        print(f"就绪比例：{summary['ready_ratio']:.1%}")
        if summary['answer_total']:
            print(f"通用题答案正确：{summary['answer_ok']}/{summary['answer_total']}（{summary['answer_ratio']:.1%}）")
        print('原因码统计：' + ('、'.join(f'{key}={value}' for key, value in sorted(summary['reason_codes'].items())) or '无'))
        for row in summary['rows']:
            if row['status'] == 'error' or row.get('ai_error'):
                print(f"  ! {row['id']} {row.get('error') or row.get('ai_error')}")
    failed = summary['status_ok'] != summary['total'] or (
        summary['answer_total'] and summary['answer_ok'] != summary['answer_total'])
    return 1 if args.strict and failed else 0


if __name__ == '__main__':
    raise SystemExit(main())

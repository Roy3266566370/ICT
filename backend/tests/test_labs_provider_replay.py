"""Replay real provider JSON captured by --ai --record, never call the network."""
import json
from pathlib import Path

import pytest

from app.labs import ai_solve
from app.labs.recognize import build_problem
from test_labs_model_contract import ReplayClient


ROOT = Path(__file__).resolve().parents[2]
RECORDINGS = [ROOT / 'fixtures/strangers' / name for name in (
    'provider-recording-2026-11-17.json', 'provider-schema-recording-2026-11-17.json',
    'provider-final-recording-2026-11-17.json')]
ROWS = [{**row, 'recording': path.name} for path in RECORDINGS
        for row in json.loads(path.read_text(encoding='utf-8'))['rows']]
CASES = {row['id']: row for row in json.loads((ROOT / 'fixtures/strangers/provider-cases.json').read_text(encoding='utf-8'))['problems']}
ANSWERS = {'probability': '3/10', 'arithmetic': '820', 'physics': '11',
           'logarithm': 'x=4', 'compound': '46305/4', 'parameter': 'a=6', 'fruit': 'x=2,y=3'}


@pytest.mark.parametrize('row', ROWS, ids=lambda row: row['recording'] + '-' + row['id'])
def test_recorded_provider_output_solves_the_original_question(row):
    case = CASES[row['id']]
    responses = [row['ai_output']] + [{'model': attempt['model']} for attempt in row['model_attempts'][1:]]
    client = ReplayClient(*responses)
    p = build_problem(case['text'])
    result = ai_solve.solve_with_ai(p, client=client)
    ai_solve.attach_interactive_model(p, result)
    if row['recording'] == 'provider-schema-recording-2026-11-17.json' and row['id'] == 'logarithm':
        # This recorded model detached x>3 from its polynomial roots. Reject it;
        # no repaired response was captured in this historical run.
        assert result['verification'] == 'needs_review'
        assert not result['checkable']
        return
    assert p['status'] == case['expect']['status']
    if row['id'] in ANSWERS:
        assert ai_solve._matches(result['computation']['expected'], ANSWERS[row['id']])
    if row['id'] == 'extrema':
        assert '最小值 -1' in result['answer'] and '最大值 3' in result['answer']
    if row['id'] == 'inequality':
        assert 'Interval.open(4, oo)' in result['answer']
    if row['id'] == 'fruit' and row['recording'] == 'provider-recording-2026-11-17.json':
        # Preserving declared totalCost now avoids the original repair entirely.
        assert len(client.calls) == 1


def test_model_returned_from_real_image_read_replays_correctly():
    row = json.loads((ROOT / 'fixtures/strangers/provider-image-recording-2026-11-17.json').read_text(encoding='utf-8'))
    result = ai_solve.solve_with_ai({'text': row['question']}, client=ReplayClient(row['ai_output']))
    assert result['verification'] == 'kernel'
    assert ai_solve._matches(result['computation']['expected'], 'x=2,y=3')

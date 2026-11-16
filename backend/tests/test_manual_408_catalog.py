"""手动 408 题型目录：每个模板都必须命中对应的本地执行内核。"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.labs.recognize import _attach_solution, build_problem

CATALOG_PATH = Path(__file__).resolve().parents[2] / 'frontend' / 'src' / 'labs' / 'manual408.json'
CATALOG = json.loads(CATALOG_PATH.read_text(encoding='utf-8'))

CASES = [
    (subject['id'], subject['label'], type_item)
    for subject in CATALOG['subjects']
    for group in subject['groups']
    for type_item in group['types']
]


@pytest.mark.parametrize('subject, subject_label, item', CASES, ids=[item['id'] for _, _, item in CASES])
def test_manual_408_template_matches_executable_kernel(subject: str, subject_label: str, item: dict) -> None:
    problem = build_problem(item['template'], subject_hint=subject)
    model = problem['model']
    kind = (model.get('ds_kind') or model.get('co_kind') or model.get('os_kind')
            or model.get('net_kind') or model.get('kind'))
    assert problem['subject'] == subject, (subject_label, item['id'])
    assert kind == item['kind'], (subject_label, item['id'])
    assert problem['status'] == 'ready', (subject_label, item['id'])
    _attach_solution(problem)
    assert str(problem['solution'].get('answer') or '').strip(), (subject_label, item['id'])


def test_manual_408_catalog_ids_are_unique() -> None:
    type_ids = [item['id'] for _, _, item in CASES]
    assert len(type_ids) == len(set(type_ids))
    subject_ids = [subject['id'] for subject in CATALOG['subjects']]
    assert subject_ids == ['algorithm', 'computer_organization', 'operating_system', 'computer_network']

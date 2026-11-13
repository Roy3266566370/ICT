"""Proof-track regressions: certificates, counterexamples and uncertified proofs."""
from __future__ import annotations

import json

import pytest

from app.labs.ai_solve import compute_plan
from app.labs.assistant import check_attempt
from app.labs.proof import solve_proof


def proof_plan(**conditions):
    return compute_plan({'kind': 'kernel', 'task': 'proof', 'conditions': conditions})


def test_ivt_certificate_and_uncertified_same_sign_case():
    verified = proof_plan(proof_kind='ivt_root', expression='x^2-1', lower='0', upper='2')
    assert verified['interactive_solution']['proof_status'] == 'verified'
    assert verified['interactive_solution']['verification_level'] == 'kernel_certificate'
    assert '介值定理' in verified['answer']
    assert verified['checkable'] is False

    same_sign = solve_proof({
        'proof_kind': 'ivt_root', 'expression': 'x^2+1', 'lower': '-1', 'upper': '1',
        'conditions': {'lower': '-1', 'upper': '1'},
    })
    assert same_sign['proof_status'] == 'unverified'
    assert same_sign['solution_complete'] is False
    with pytest.raises(ValueError):
        proof_plan(proof_kind='ivt_root', expression='x^2+1', lower='-1', upper='1')


def test_rolle_and_mvt_certificates():
    rolle = proof_plan(proof_kind='rolle', expression='x^2', lower='-1', upper='1')
    assert rolle['interactive_solution']['proof_status'] == 'verified'
    assert '罗尔定理' in rolle['answer']

    mvt = proof_plan(proof_kind='mvt', expression='x^2', lower='0', upper='2')
    assert mvt['interactive_solution']['proof_status'] == 'verified'
    assert '中值定理' in mvt['answer']
    assert mvt['interactive_solution']['certificate']['slope'] == '2'


def test_monotone_inequality_certificate_and_insufficient_case():
    good = proof_plan(proof_kind='monotone_inequality', expression='x^2', lower='0', upper='1')
    assert good['interactive_solution']['proof_status'] == 'verified'

    bad = solve_proof({
        'proof_kind': 'monotone_inequality', 'expression': 'x-1', 'lower': '0', 'upper': '2',
        'conditions': {'lower': '0', 'upper': '2'},
    })
    assert bad['proof_status'] == 'unverified'


def test_counterexample_disproves_universal_claim():
    result = proof_plan(proof_kind='counterexample', left='x^2', right='x', relation='>=', point='0.5')
    assert result['interactive_solution']['proof_status'] == 'disproved'
    assert '反例成立' in result['answer']
    assert result['checkable'] is False


def test_local_step_equalities_are_not_passed_as_whole_proof():
    valid = solve_proof({
        'proof_kind': 'steps', 'steps': ['x^2-1=(x-1)*(x+1)', '(x-1)*(x+1)=x^2-1'],
        'conditions': {},
    })
    assert valid['proof_status'] == 'local_steps_verified'
    assert valid['verification_level'] == 'local_steps_only'
    assert valid['solution_complete'] is False
    assert all(item['status'] == 'pass' for item in valid['obligations'])

    invalid = solve_proof({'proof_kind': 'steps', 'steps': ['x^2-1=x^2+1'], 'conditions': {}})
    assert invalid['proof_status'] == 'invalid'
    assert invalid['solution_complete'] is False


def test_proof_task_is_never_auto_graded():
    result = proof_plan(proof_kind='ivt_root', expression='x^2-1', lower='0', upper='2')
    problem = {'subject': 'calculus', 'model': result['interactive_model'],
               'solution': result['interactive_solution']}
    feedback = check_attempt(problem, result['expected']['evaluation'], answer='x=1')
    assert feedback['correct'] is False
    assert '证明题不自动判分' in feedback['feedback']


def test_local_text_routes_ivt_and_rolle_proofs():
    from app.labs.recognize import build_problem, _attach_solution
    cases = {
        '证明方程 x^2-1=0 在 [0,2] 上有根。': 'ivt_root',
        '证明 f(x)=x^2 在 [-1,1] 上满足罗尔定理。': 'rolle',
    }
    for text, kind in cases.items():
        problem = build_problem(text)
        _attach_solution(problem)
        assert problem['model']['task'] == 'proof'
        assert problem['model']['proof_kind'] == kind
        assert problem['solution']['proof_status'] == 'verified'


def test_verified_proof_is_json_serializable():
    result = proof_plan(proof_kind='rolle', expression='x^2', lower='-1', upper='1')
    json.dumps(result, ensure_ascii=False, allow_nan=False)

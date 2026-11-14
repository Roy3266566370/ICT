import pytest

from app.labs.manual import build_manual_document, preview_integral, revise_manual_document
from app.labs.solvers import evaluate_problem


def document(conditions):
    return build_manual_document(lab_id='proof', title='', task='proof',
                                 conditions=dict(conditions), now_iso='2026-11-14')['problems'][0]


def solve(conditions):
    problem = document(conditions)
    return problem['manual_input']['proof_details'], problem


def ivt_root(**overrides):
    conditions = {'proof_kind': 'ivt_root', 'expression': 'x^2-1', 'lower': '0', 'upper': '2'}
    conditions.update(overrides)
    return conditions


def ivt_unique(**overrides):
    conditions = {'proof_kind': 'ivt_unique_root', 'expression': 'x^3+x-1', 'lower': '0', 'upper': '1'}
    conditions.update(overrides)
    return conditions


def rolle(**overrides):
    conditions = {'proof_kind': 'rolle', 'expression': 'x^2', 'lower': '-1', 'upper': '1'}
    conditions.update(overrides)
    return conditions


def mvt(**overrides):
    conditions = {'proof_kind': 'mvt', 'expression': 'x^2', 'lower': '0', 'upper': '2'}
    conditions.update(overrides)
    return conditions


def cauchy(**overrides):
    conditions = {'proof_kind': 'cauchy_mvt', 'left': 'x^2', 'right': 'x', 'lower': '1', 'upper': '2'}
    conditions.update(overrides)
    return conditions


def monotone(**overrides):
    conditions = {'proof_kind': 'monotone_inequality', 'expression': 'x^2', 'lower': '0', 'upper': '1'}
    conditions.update(overrides)
    return conditions


def inequality(**overrides):
    conditions = {'proof_kind': 'inequality', 'left': 'x^2', 'right': 'x',
                  'relation': '>=', 'lower': '1', 'upper': '2'}
    conditions.update(overrides)
    return conditions


def counterexample(**overrides):
    conditions = {'proof_kind': 'counterexample', 'left': 'x^2', 'right': 'x',
                  'relation': '>=', 'point': '1/2'}
    conditions.update(overrides)
    return conditions


def steps(**overrides):
    conditions = {'proof_kind': 'steps', 'steps': 'x^2-1=(x-1)*(x+1)\n(x-1)*(x+1)=x^2-1'}
    conditions.update(overrides)
    return conditions


@pytest.mark.parametrize('kind,conditions,label', [
    ('ivt_root', ivt_root(), '零点存在性（介值定理）'),
    ('ivt_unique_root', ivt_unique(), '零点存在且唯一（介值定理+单调性）'),
    ('rolle', rolle(), '罗尔定理'),
    ('mvt', mvt(), '拉格朗日中值定理'),
    ('cauchy_mvt', cauchy(), '柯西中值定理'),
    ('monotone_inequality', monotone(), '函数不等式（单调性，f≥0）'),
    ('inequality', inequality(), '函数不等式（两个函数作差）'),
    ('counterexample', counterexample(), '反例否定全称命题'),
    ('steps', steps(), '综合题步骤核对'),
])
def test_preview_labels_and_conditions(kind, conditions, label):
    preview = preview_integral('proof', conditions)
    assert preview['task'] == 'proof'
    assert preview['label'] == label
    assert preview['conditions']['proof_kind'] == kind
    assert preview['latex']
    assert preview['question']


@pytest.mark.parametrize('conditions,status,level', [
    (ivt_root(), 'verified', 'kernel_certificate'),
    (ivt_unique(), 'verified', 'kernel_certificate'),
    (rolle(), 'verified', 'kernel_certificate'),
    (mvt(), 'verified', 'kernel_certificate'),
    (cauchy(), 'verified', 'kernel_certificate'),
    (monotone(), 'verified', 'kernel_certificate'),
    (inequality(), 'verified', 'kernel_certificate'),
    (counterexample(), 'disproved', 'kernel_certificate'),
    (steps(), 'local_steps_verified', 'local_steps_only'),
])
def test_verified_templates_and_statuses(conditions, status, level):
    details, problem = solve(conditions)
    assert details['proof_status'] == status
    assert details['verification_level'] == level
    assert details['obligations']
    assert problem['manual_input']['result_answer']
    if status in ('verified', 'disproved'):
        assert problem['manual_input']['result_status'] == 'complete'
        assert problem['status'] == 'ready'
    else:
        assert problem['manual_input']['result_status'] == 'unsupported'
        assert problem['status'] == 'unsupported'


def test_unique_root_certificate_contains_monotonicity():
    details, problem = solve(ivt_unique())
    facts = {item['label']: item['text'] for item in details['certificate_facts']}
    assert facts['定理/模板'] == '介值定理 + 严格单调性'
    assert facts['严格递增'] == '是'
    assert '唯一' in problem['solution']['answer']


def test_cauchy_certificate_slope_and_conditions():
    details, problem = solve(cauchy())
    facts = {item['label']: item['text'] for item in details['certificate_facts']}
    assert facts['定理/模板'] == '柯西中值定理'
    assert facts['中值斜率'] == '3'
    statuses = {item['id']: item['status'] for item in details['obligations']}
    assert statuses['g_prime_nonzero'] == 'pass'
    assert statuses['denominator'] == 'pass'


def test_inequality_certificate_uses_difference():
    details, problem = solve(inequality())
    facts = {item['label']: item['text'] for item in details['certificate_facts']}
    assert facts['左端函数/左式'] == 'x^2'
    assert facts['右端函数/右式'] == 'x'
    assert facts['关系符号'] == '>='
    assert problem['solution']['proof_kind'] == 'inequality'


def test_counterexample_disproves_and_same_point_does_not():
    details, problem = solve(counterexample())
    assert problem['solution']['proof_status'] == 'disproved'
    facts = {item['label']: item['text'] for item in details['certificate_facts']}
    assert facts['反例点'] == '1/2'

    details, problem = solve(counterexample(point='2'))
    assert problem['solution']['proof_status'] == 'unverified'
    assert problem['manual_input']['result_status'] == 'unsupported'


def test_steps_preserve_structure_and_are_not_whole_proof():
    details, problem = solve(steps())
    assert 'x^2 - 1=(x - 1)*(x + 1)' in problem['manual_input']['conditions']['steps']
    assert problem['solution']['proof_status'] == 'local_steps_verified'
    assert problem['solution']['solution_complete'] is False
    assert all(item['status'] == 'pass' for item in details['obligations'])


def test_same_sign_and_insufficient_inequality_are_unverified():
    details, problem = solve(ivt_root(expression='x^2+1', lower='-1', upper='1'))
    assert details['proof_status'] == 'unverified'
    details, problem = solve(inequality(relation='<=', lower='0', upper='1'))
    assert details['proof_status'] == 'unverified'
    details, problem = solve(rolle(lower='0', upper='1'))
    assert details['proof_status'] == 'unverified'


def test_evaluation_keeps_proof_kind_and_obligations():
    _, problem = solve(rolle())
    result = evaluate_problem(problem['model'], {})
    assert result['kind'] == 'proof'
    assert result['proof']['proof_kind'] == 'rolle'
    assert result['proof']['obligations']


@pytest.mark.parametrize('conditions,message', [
    (ivt_root(expression=''), '函数 f'),
    (ivt_root(expression='y^2'), '无法解析'),
    (ivt_root(lower='2', upper='0'), '小于'),
    (ivt_root(extra='1'), '不能消费'),
    (cauchy(left=''), '函数 f'),
    (inequality(relation='>'), '关系符号'),
    (counterexample(point='x'), '反例点'),
    (steps(steps='x^2-1'), 'lhs=rhs'),
    (steps(steps=''), '证明步骤'),
    (ivt_root(statement='x' * 601), '600字'),
    ({'proof_kind': 'unknown'}, '证明'),
])
def test_invalid_proof_conditions_are_rejected(conditions, message):
    with pytest.raises(ValueError, match=message):
        preview_integral('proof', conditions)


def test_revision_rebuilds_proof_and_updates_status():
    data = build_manual_document(lab_id='proof', title='', task='proof',
                                 conditions=mvt(), now_iso='2026-11-14')
    revised = revise_manual_document(data, data['problems'][0], {'upper': '3'})
    assert revised['solution']['proof_status'] == 'verified'
    assert revised['manual_input']['conditions']['upper'] == '3'
    assert '3' in revised['solution']['answer']

    data = build_manual_document(lab_id='proof', title='', task='proof',
                                 conditions=counterexample(), now_iso='2026-11-14')
    revised = revise_manual_document(data, data['problems'][0], {'point': '2'})
    assert revised['solution']['proof_status'] == 'unverified'
    assert revised['manual_input']['result_status'] == 'unsupported'


def test_manual_record_labels_and_proof_details():
    problem = document(cauchy())
    labels = {item['id']: item['label'] for item in problem['recognition']['conditions']}
    assert labels['proof_kind'] == '证明类型'
    assert labels['left'] == '函数 f(x)'
    assert labels['right'] == '函数 g(x)'
    details = problem['manual_input']['proof_details']
    assert details['label'] == '柯西中值定理'
    assert details['certificate_facts']
    assert problem['manual_input']['confirmed'] is True


def test_negative_interval_square_root_domain_is_not_certified():
    p = document(mvt(expression='sqrt(x)^2', lower='-1', upper='1'))
    assert p['manual_input']['conditions']['expression'] == '(sqrt(x))^2'
    assert p['manual_input']['result_status'] == 'unsupported'
    assert p['manual_input']['proof_details']['proof_status'] == 'invalid'
    obligations = {item['id']: item['status'] for item in p['manual_input']['proof_details']['obligations']}
    assert obligations['continuous'] == 'fail'


def test_strict_signs_do_not_use_floating_tolerance():
    tiny = document(ivt_root(expression='10^(-13)', lower='-1', upper='1'))
    assert tiny['manual_input']['proof_details']['proof_status'] == 'unverified'
    obligations = {item['id']: item['status'] for item in tiny['manual_input']['proof_details']['obligations']}
    assert obligations['sign_change'] == 'fail'

    negative = document(monotone(expression='-10^(-13)', lower='0', upper='1'))
    assert negative['manual_input']['proof_details']['proof_status'] == 'unverified'
    obligations = {item['id']: item['status'] for item in negative['manual_input']['proof_details']['obligations']}
    assert obligations['endpoint'] == 'fail'


def test_ivt_endpoint_zero_uses_closed_interval_conclusion():
    p = document(ivt_root(expression='x', lower='0', upper='1'))
    answer = p['solution']['answer']
    assert p['manual_input']['proof_details']['proof_status'] == 'verified'
    assert 'c∈[0,1]' in answer
    assert '零点可在端点' in answer
    assert 'c∈(0,1)' not in answer


def test_unique_root_endpoint_zero_uses_closed_interval_conclusion():
    p = document(ivt_unique(expression='x', lower='0', upper='1'))
    answer = p['solution']['answer']
    assert p['manual_input']['proof_details']['proof_status'] == 'verified'
    assert '唯一 c∈[0,1]' in answer
    assert '零点可在端点' in answer
    assert 'c∈(0,1)' not in answer


def test_counterexample_point_must_be_in_real_domain():
    p = document(counterexample(left='sqrt(x)^2', right='x', relation='>=', point='-1'))
    details = p['manual_input']['proof_details']
    assert details['proof_status'] == 'unverified'
    assert p['manual_input']['result_status'] == 'unsupported'
    obligations = {item['id']: item['status'] for item in details['obligations']}
    assert obligations['point'] == 'fail'
    assert '实定义域' in p['solution']['answer']


def test_inequality_checks_original_domain_before_subtracting():
    p = document(inequality(left='1/x', right='1/x', relation='>=', lower='-1', upper='1'))
    details = p['manual_input']['proof_details']
    assert details['proof_status'] == 'invalid'
    assert p['manual_input']['result_status'] == 'unsupported'
    obligations = {item['id']: item['status'] for item in details['obligations']}
    assert obligations['domain'] == 'fail'
    assert '实定义' in p['solution']['answer']


def test_counterexample_at_undefined_point_returns_clear_status():
    p = document(counterexample(left='1/x', right='1', relation='>=', point='0'))
    details = p['manual_input']['proof_details']
    assert details['proof_status'] == 'unverified'
    assert p['manual_input']['result_status'] == 'unsupported'
    obligations = {item['id']: item['status'] for item in details['obligations']}
    assert obligations['point'] == 'fail'
    assert '实定义域' in p['solution']['answer']

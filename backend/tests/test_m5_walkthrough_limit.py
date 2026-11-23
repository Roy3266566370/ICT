"""M5 任务 4：极限与导数逼近（limit_approach）Walkthrough 专项测试。"""
from __future__ import annotations

import pytest

from app.labs.walkthrough import pattern_router, service
from app.labs.walkthrough.limit_approach import (
    LimitApproachSpec,
    build_limit_approach,
    derive_limit_approach,
    verify_limit_approach,
)


@pytest.mark.parametrize(
    'case_name,spec,expected_exact',
    [
        (
            'sin_over_x',
            LimitApproachSpec(kind='limit', expression='sin(x)/x', point='0', direction='both'),
            '1',
        ),
        (
            'one_minus_cos_over_x2',
            LimitApproachSpec(kind='limit', expression='(1 - cos(x))/x^2', point='0', direction='both'),
            '1/2',
        ),
        (
            'derivative_cubic_at_1',
            LimitApproachSpec(kind='derivative', expression='x^3 - 2*x', point='1', direction='both'),
            '1',
        ),
    ],
)
def test_limit_approach_three_variants_and_tamper_detection(case_name, spec, expected_exact):
    derived = derive_limit_approach(spec)
    claims = {key: str(val) for key, val in derived.claims.items()}
    checks = verify_limit_approach(derived, claims)
    assert all(item['status'] == 'verified' for item in checks.values()), case_name

    exact_check = verify_limit_approach(derived, {'exact': expected_exact})
    assert exact_check['exact']['status'] == 'verified', case_name

    # 篡改左极限、主部和最终结论必须被 100% 拦截
    tampered = verify_limit_approach(derived, {'left_limit': '99', 'principal_part': 'x + 99', 'exact': '99'})
    assert tampered['left_limit']['status'] == 'unverified'
    assert tampered['principal_part']['status'] == 'unverified'
    assert tampered['exact']['status'] == 'unverified'

    built = build_limit_approach(
        spec,
        derived,
        checks,
        why='通过缩小步长 δ 观察左右采样逼近与局部主部展开。',
        alternatives=['洛必达法则'],
        trusted=True,
    )
    assert built['pattern'] == 'limit_approach'
    assert built['limit_kind'] == spec.kind
    assert built['verification']['status'] == 'verified'
    assert len(built['steps']) == 4
    assert built['steps'][0]['view']['name'] == 'zoom_curve'
    assert built['steps'][-1].get('final') is True


def test_limit_approach_rejects_divergent_or_jump_limit():
    with pytest.raises(ValueError, match='极限'):
        derive_limit_approach(LimitApproachSpec(kind='limit', expression='1/x', point='0', direction='both'))


def test_limit_approach_router_and_service_dispatch(monkeypatch):
    assert pattern_router.detect_mode({'text': '求极限 lim_{x->0} (1-cos(x))/x^2', 'subject': 'calculus'}) == 'limit_approach'
    assert pattern_router.detect_mode({'text': '用导数定义求 f(x)=x^2 在 x=1 处的导数', 'subject': 'calculus'}) == 'limit_approach'

    monkeypatch.setattr(service, 'configured', lambda: True)

    def fake_complete_json(*, response_model, validator, **kwargs):
        payload = {
            'pattern': 'limit_approach',
            'spec': {'kind': 'limit', 'expression': 'sin(x)/x', 'point': '0', 'direction': 'both'},
            'why': '0/0 未定式可在 x=0 附近局部缩放并对比等价无穷小。',
            'alternatives': ['洛必达法则'],
            'left_limit': '1',
            'right_limit': '1',
            'principal_part': '1 - x^2/6',
            'exact': '1',
        }
        validator(payload)
        return response_model.model_validate(payload), {'attempts': 1}

    monkeypatch.setattr('app.labs.walkthrough.limit_approach.complete_json', fake_complete_json)
    problem = {
        'text': '求极限 lim_{x->0} sin(x)/x',
        'subject': 'calculus',
        'model': {'task': 'limits', 'conditions': {'expression': 'sin(x)/x', 'point': '0'}},
    }
    result = service.generate(problem)
    assert result['pattern'] == 'limit_approach'
    assert result['verification']['status'] == 'verified'
    assert result['input_hash'] == service.input_hash(problem)

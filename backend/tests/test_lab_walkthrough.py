from copy import deepcopy

import pytest

from app.labs.walkthrough.walkthrough_verifier import derive, verify
from app.labs.walkthrough.walkthrough_builder import build
from app.labs.walkthrough.pattern_router import Surface


@pytest.mark.parametrize(('family', 'bounds', 'field', 'orientation', 'exact'), [
    ('sphere', ('-1', '1'), ['z^2'], 1, '4*pi/3'),
    ('hemisphere', ('0', '1'), ['1'], 1, '2*pi'),
    ('cylinder', ('0', '2'), ['x^2+y^2+z'], 1, '8*pi'),
    ('cone', ('0', '2'), ['0', '0', '1'], -1, '4*pi'),
    ('paraboloid', ('0', '1'), ['1'], 1, 'pi*(5*sqrt(5)-1)/6'),
])
def test_rotation_family(family, bounds, field, orientation, exact):
    surface = Surface(family=family, scale='1', lower=bounds[0], upper=bounds[1],
                      field=field, orientation=orientation)
    values = derive(surface)
    assert verify(values, {'exact': exact})['exact']['status'] == 'verified'


def test_tampered_intermediate_stays_unverified_and_answer_is_last():
    surface = Surface(family='sphere', scale='1', lower='-1', upper='1', field=['z^2'])
    values = derive(surface)
    claims = {name: str(value) for name, value in values.claims.items()}
    assert all(check['status'] == 'verified' for check in verify(values, claims).values())
    damaged = deepcopy(claims)
    damaged['density'] = '2*pi*z'
    checks = verify(values, damaged)
    assert checks['density']['status'] == 'unverified'
    document = build(surface, values, checks, why='绕 z 轴旋转对称', alternatives=[], trusted=False)
    assert document['verification']['status'] == 'unverified'
    assert document['conditions_source'] == 'model'
    assert len(document['steps']) == 5
    assert [step.get('final', False) for step in document['steps']] == [False]*4 + [True]


def test_wrong_radius_range_never_builds():
    with pytest.raises(ValueError):
        derive(Surface(family='sphere', scale='1', lower='-1', upper='2', field=['1']))


def test_legacy_surface_result_agrees_with_full_sphere_walkthrough():
    from app.labs.space import solve_space_task

    result = solve_space_task({'task': 'surface_integral', 'conditions': {
        'surface': ['cos(u)*cos(v)', 'sin(u)*cos(v)', 'sin(v)'],
        'uv_bounds': [['0', '2*pi'], ['-pi/2', 'pi/2']], 'kind': 'scalar', 'field': 'z^2',
    }})
    assert result['exact'] == '4*pi/3'


@pytest.mark.parametrize('repair_succeeds', [True, False])
def test_structured_repair_reasks_with_mismatch_feedback(monkeypatch, repair_succeeds):
    import json
    from types import SimpleNamespace
    from app.labs.walkthrough import service

    surface = Surface(family='sphere', scale='1', lower='-1', upper='1', field=['z^2'])
    claims = {key: str(value) for key, value in derive(surface).claims.items()}
    replies = []

    class Transport:
        def post(self, url, *, headers, json_body, timeout):
            replies.append(json_body)
            data = {'pattern': 'slice_accumulate', 'surface': surface.model_dump(),
                    'why': '球面绕 z 轴旋转对称', 'alternatives': [], **claims}
            if len(replies) == 1 or not repair_succeeds:
                data['density'] = '2*pi*z'
            return 200, {'choices': [{'message': {'content': json.dumps(data)}, 'finish_reason': 'stop'}]}

    monkeypatch.setattr(service, 'get_settings', lambda: SimpleNamespace(
        llm_provider='maas', llm_model='fake', llm_api_key='test', llm_base_url='https://model.example/v1', llm_timeout_s=10))
    monkeypatch.setattr(service, 'HttpxTransport', Transport)
    result = service.generate({'text': '求单位球面的曲面积分 ∫∫ z^2 dS', 'subject': 'calculus'})
    assert len(replies) == 2
    feedback = replies[1]['messages'][-1]['content']
    assert 'density' in feedback and '2*pi*z' in feedback
    assert result['verification']['status'] == ('verified' if repair_succeeds else 'unverified')


def test_source_equivalence_rejects_changed_field_and_boundary():
    from app.labs.walkthrough.pattern_router import matches_source

    surface = Surface(family='sphere', scale='1', lower='-1', upper='1', field=['z^2'])
    source = {'kind': 'scalar', 'surface': ['cos(u)*cos(v)', 'sin(u)*cos(v)', 'sin(v)'],
              'uv_bounds': [['0', '2*pi'], ['-pi/2', 'pi/2']], 'field': 'z^2'}
    assert matches_source(surface, source)
    assert not matches_source(surface.model_copy(update={'field': ['1']}), source)
    assert not matches_source(surface.model_copy(update={'lower': '0'}), source)


def test_removable_holes_are_not_verified_and_nonreal_fields_are_rejected():
    surface = Surface(family='sphere', scale='1', lower='-1', upper='1', field=['z^2'])
    checks = verify(derive(surface), {'density': '2*pi*z^3/z', 'primitive': '2*pi*z^4/(3*z)'})
    assert all(check['status'] == 'unverified' for check in checks.values())
    with pytest.raises(ValueError, match='有限实数'):
        derive(surface.model_copy(update={'field': ['0', 'sqrt(-1)*x', '0']}))


def test_inferred_existing_conditions_are_not_marked_as_source():
    from app.labs.walkthrough.pattern_router import confirmed_conditions

    conditions = {'kind': 'scalar', 'surface': ['cos(u)*cos(v)', 'sin(u)*cos(v)', 'sin(v)'],
                  'uv_bounds': [['0', '2*pi'], ['-pi/2', 'pi/2']], 'field': 'z^2'}
    problem = {'model': {'task': 'surface_integral', 'conditions': conditions},
               'recognition': {'conditions': [{'id': key, 'provenance': 'inferred'} for key in conditions]}}
    assert confirmed_conditions(problem) is None
    problem['manual_input'] = {'confirmed': True}
    assert confirmed_conditions(problem) == conditions

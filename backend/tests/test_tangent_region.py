import pytest

from app.labs.tangent_region import compile_tangent_region, solve_tangent_region


def test_original_two_parts_include_triangle_boundaries():
    problem = compile_tangent_region({'expression': 'x^3+y^3-(x+y)^2+3', 'point': [1, 1, 1]})
    solution = solve_tangent_region(problem['model'])
    details = solution['tangent_region_details']
    assert details['plane'] == 'x + y + z - 3'
    assert details['vertices'] == [['0', '0'], ['3', '0'], ['0', '3']]
    assert details['minimum']['value'] == '17/27'
    assert details['minimum']['points'] == [['4/3', '4/3']]
    assert details['maximum']['value'] == '21'
    assert sorted(details['maximum']['points']) == [['0', '3'], ['3', '0']]
    assert solution['solution_complete']
    assert len(solution['steps']) >= 4


def test_changed_polynomial_and_point_find_sloping_edge_minimum():
    p = compile_tangent_region({'expression': 'x^2+y^2-6*x-6*y+10', 'point': [1, 1, 0]})
    d = p['solution']['tangent_region_details']
    assert d['vertices'] == [['0', '0'], ['2', '0'], ['0', '2']]
    assert d['minimum']['value'] == '0'
    assert d['minimum']['points'] == [['1', '1']]
    assert d['maximum']['value'] == '10'


@pytest.mark.parametrize('conditions', [
    {'expression': 'x+y', 'point': [1, 1, 2]},
    {'expression': 'x-y+3', 'point': [1, 1, 3]},
    {'expression': 'x^2+y^2', 'point': [1, 1, 99]},
])
def test_rejects_noncompact_or_off_surface(conditions):
    with pytest.raises(ValueError):
        compile_tangent_region(conditions)

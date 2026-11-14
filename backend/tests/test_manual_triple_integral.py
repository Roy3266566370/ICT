import json

import pytest
import sympy as sp

from app.labs.manual import build_manual_document, preview_integral, revise_manual_document
from app.labs.solvers import evaluate_problem


def box(integrand='1', bounds=('0', '1', '0', '1', '0', '1')):
    a, b, c, d, e, g = bounds
    return {'region_mode': 'box', 'integrand': integrand,
            'x_lower': a, 'x_upper': b, 'y_lower': c, 'y_upper': d,
            'z_lower': e, 'z_upper': g}


def z_simple(integrand='1', x=('0', '1'), y=('0', '1-x'), z=('0', '1-x-y')):
    return {'region_mode': 'z_simple', 'integrand': integrand,
            'x_lower': x[0], 'x_upper': x[1], 'y_lower': y[0], 'y_upper': y[1],
            'z_lower': z[0], 'z_upper': z[1]}


def cylindrical(integrand='1', theta=('0', '2*pi'), radius=('0', '1'), z=('0', '1')):
    return {'region_mode': 'cylindrical', 'integrand': integrand,
            'theta_lower': theta[0], 'theta_upper': theta[1],
            'radius_lower': radius[0], 'radius_upper': radius[1],
            'z_lower': z[0], 'z_upper': z[1]}


def spherical(integrand='1', theta=('0', '2*pi'), phi=('0', 'pi'), rho=('0', '1')):
    return {'region_mode': 'spherical', 'integrand': integrand,
            'theta_lower': theta[0], 'theta_upper': theta[1],
            'phi_lower': phi[0], 'phi_upper': phi[1],
            'rho_lower': rho[0], 'rho_upper': rho[1]}


def document(c):
    return build_manual_document(lab_id='triple', title='', task='triple_integral',
                                 conditions=c, now_iso='2026-11-14')['problems'][0]


@pytest.mark.parametrize('c,exact,mode,inner', [
    (box(), '1', 'box', 'z'),
    (box('x*y*z'), '1/8', 'box', 'z'),
    (box('x+y+z'), '3/2', 'box', 'z'),
    (box('1', ('-1', '1', '-2', '0', '0', '3')), '12', 'box', 'z'),
    (z_simple(), '1/6', 'z_simple', 'z'),
    (z_simple('z'), '1/24', 'z_simple', 'z'),
    (z_simple('1', z=('x*y', '1')), '11/24', 'z_simple', 'z'),
    (cylindrical(), 'pi', 'cylindrical', 'z'),
    (cylindrical('1', z=('0', 'r')), '2*pi/3', 'cylindrical', 'z'),
    (cylindrical('1', z=('0', '1+sin(theta)')), 'pi', 'cylindrical', 'z'),
    (spherical(), '4*pi/3', 'spherical', 'rho'),
    (spherical('1', phi=('0', 'pi/2')), '2*pi/3', 'spherical', 'rho'),
    (spherical('1', rho=('1', '2')), '28*pi/3', 'spherical', 'rho'),
    (spherical('1', phi=('0', 'pi/2'), rho=('0', '2*cos(phi)')), '4*pi/3', 'spherical', 'rho'),
    (spherical('x^2'), '4*pi/15', 'spherical', 'rho'),
])
def test_regions_orders_and_exact_results(c, exact, mode, inner):
    p = document(c)
    solution = p['solution']
    details = p['manual_input']['triple_details']
    assert p['manual_input']['result_status'] == 'complete', solution
    assert sp.simplify(sp.sympify(solution['exact']) - sp.sympify(exact)) == 0
    assert p['manual_input']['conditions'] == c
    assert p['model']['region_kind'] == mode
    assert details['region_mode'] == mode
    assert details['inner_variable'] == inner
    assert details['region_verified'] is True
    assert details['continuous_verified'] is True
    assert details['numeric_value'] == pytest.approx(float(sympify_exact := sp.N(sp.sympify(exact))), rel=1e-6, abs=1e-6)
    assert p['solution']['space']['kind'] in ('box', 'z_simple', 'cylinder', 'sphere')
    result = evaluate_problem(p['model'], {})
    assert result['task'] == 'triple_integral'
    assert result['kind'] == 'space'
    assert result['exact'] == pytest.approx(float(sympify_exact))


def test_box_space_payload_has_twelve_edges_and_survives_json():
    p = document(box())
    space = p['solution']['space']
    assert space['kind'] == 'box'
    assert len(space['edges']) == 12
    json.dumps(p, ensure_ascii=False)


@pytest.mark.parametrize('mode,grid_rows', [('z_simple', 13), ('cylindrical', 13), ('spherical', 11)])
def test_curved_regions_include_surface_grid(mode, grid_rows):
    c = {'z_simple': z_simple('z'), 'cylindrical': cylindrical('x^2+y^2', z=('0', '1-r^2')),
         'spherical': spherical('z')}[mode]
    p = document(c)
    assert p['manual_input']['result_status'] == 'complete', p['solution']
    assert len(p['solution']['space']['grid']) == grid_rows


@pytest.mark.parametrize('patch', [
    {'x_upper': '0'},
    {'x_lower': '1', 'x_upper': '0'},
    {'z_upper': 'x'},
    {'extra_constraint': 'x+y+z<=1'},
    {'z_upper': ''},
])
def test_box_incomplete_or_invalid_bounds_are_not_filled(patch):
    with pytest.raises(ValueError):
        preview_integral('triple_integral', {**box(), **patch})


@pytest.mark.parametrize('c', [
    z_simple('1', y=('0', 'sqrt(x-1/2)')),
    z_simple('1', y=('0', 'sqrt(-1)*x')),
    z_simple('1', z=('1', '1-x-y')),
    cylindrical('1', radius=('-1', '1')),
    cylindrical('1', theta=('0', '3*pi')),
    spherical('1', phi=('0', '4')),
    spherical('1', rho=('-1', '1')),
    spherical('1', theta=('0', 'pi/3'), phi=('0', 'pi/2'), rho=('0', '1/theta')),
])
def test_invalid_regions_are_rejected_without_guessing(c):
    with pytest.raises(ValueError):
        preview_integral('triple_integral', c)


def test_missing_or_unknown_mode_fields_are_rejected():
    with pytest.raises(ValueError):
        preview_integral('triple_integral', {k: v for k, v in box().items() if k != 'z_upper'})
    with pytest.raises(ValueError):
        preview_integral('triple_integral', {**box(), 'region_mode': 'sphere'})
    with pytest.raises(ValueError):
        preview_integral('triple_integral', {**box(), 'polar': 'true'})


def test_unconfirmed_domain_keeps_region_and_does_not_return_answer():
    c = box('1/(x-1/37)^2')
    p = document(c)
    assert p['manual_input']['result_status'] == 'unsupported'
    assert not p['solution']['answer']
    assert p['manual_input']['triple_details']['region_verified'] is True
    assert p['manual_input']['triple_details']['continuous_verified'] is False
    assert p['solution']['space']['kind'] == 'box'


def test_simplification_does_not_hide_negative_sqrt_domain():
    c = box('sqrt(x)^2', ('-2', '-1', '0', '1', '0', '1'))
    p = document(c)
    assert p['manual_input']['result_status'] == 'unsupported'
    assert p['manual_input']['triple_details']['continuous_verified'] is False
    assert not p['solution']['answer']


def test_sqrt_square_integrates_only_where_definition_holds():
    p = document(box('sqrt(x)^2'))
    assert p['manual_input']['result_status'] == 'complete'
    assert sp.simplify(sp.sympify(p['solution']['exact']) - sp.Rational(1, 2)) == 0


def test_solve_reverifies_domain_instead_of_trusting_saved_flags():
    from app.labs.manual_triple_integral import build_problem, solve
    built = build_problem(box('1'))
    built['model']['manual_triple_conditions'] = box('sqrt(x)^2', ('-2', '-1', '0', '1', '0', '1'))
    built['model']['manual_triple_continuous'] = True
    built['model']['manual_triple_failure'] = ''
    result = solve(built['model'])
    assert result['solution_complete'] is False
    assert not result['answer']


def test_unfinished_symbolic_integral_is_saved_without_fake_answer(monkeypatch):
    from app.labs import manual_triple_integral as triple
    monkeypatch.setattr(triple, '_compute', lambda plan: (_ for _ in ()).throw(ValueError('内层积分未得到闭式结果')))
    c = box()
    p = document(c)
    assert p['manual_input']['result_status'] == 'unsupported'
    assert '内层积分' in p['manual_input']['result_note']
    assert not p['solution']['answer']
    assert p['manual_input']['conditions'] == c
    assert p['manual_input']['triple_details']['continuous_verified'] is True


def test_review_rebuilds_all_three_layers_and_preserves_order():
    doc = build_manual_document(lab_id='triple', title='', task='triple_integral',
                                conditions=z_simple('z'), now_iso='2026-11-14')
    p = revise_manual_document(doc, doc['problems'][0], {'x_upper': '1/2'})
    conditions = p['manual_input']['conditions']
    assert conditions['x_upper'] == '1/2'
    assert conditions['y_upper'] == '1-x'
    assert conditions['z_upper'] == '1-x-y'
    assert p['solution']['exact'] == '5/128'
    assert p['states']['step'] == 0


def test_preview_reports_task_and_three_layer_limits():
    c = spherical('1', phi=('0', 'pi/2'), rho=('0', '2*cos(phi)'))
    preview = preview_integral('triple_integral', c)
    assert preview['task'] == 'triple_integral'
    assert preview['label'] == '球坐标三重积分'
    assert preview['conditions'] == c
    assert 'rho' in preview['latex']

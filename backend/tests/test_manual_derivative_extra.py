import pytest
import sympy as sp

from app.labs.manual import build_manual_document, preview_integral


def document(task, **conditions):
    return build_manual_document(lab_id='t', title='', task=task, conditions=conditions,
                                 now_iso='2026-11-18')['problems'][0]


@pytest.mark.parametrize('xexpr,yexpr,t0,order,slope,second', [
    ('t^2', 't^3', '1', '1', '3/2', None),
    ('t^2', 't^3', '1', '2', '3/2', '3/4'),
    ('cos(t)', 'sin(t)', 'pi/4', '2', '-1', '-2*sqrt(2)'),
])
def test_parametric_derivative_matches_chain_rule(xexpr, yexpr, t0, order, slope, second):
    p = document('parametric_derivative', x_expression=xexpr, y_expression=yexpr, point=t0, order=order)
    assert p['manual_input']['result_status'] == 'complete'
    details = p['manual_input']['parametric_details']
    assert sp.simplify(sp.sympify(details['slope_value']) - sp.sympify(slope)) == 0
    if second is not None:
        assert sp.simplify(sp.sympify(details['second_value']) - sp.sympify(second)) == 0
    assert details['verification_level'] == 'numeric'


def test_parametric_derivative_rejects_vertical_or_bad_point():
    with pytest.raises(ValueError):
        preview_integral('parametric_derivative', dict(x_expression='cos(t)', y_expression='sin(t)', point='0', order='1'))
    with pytest.raises(ValueError):
        preview_integral('parametric_derivative', dict(x_expression='t^2', y_expression='t^3', point='x', order='1'))
    with pytest.raises(ValueError):
        preview_integral('parametric_derivative', dict(x_expression='t^2', y_expression='t^3', point='1', order='3'))


@pytest.mark.parametrize('equation,px,py,order,slope,second', [
    ('y-x^2=0', '1', '1', '1', '2', None),
    ('y-x^2=0', '1', '1', '2', '2', '2'),
    ('x^2+y^2=1', '0', '1', '2', '0', '-1'),
    ('exp(y)-x-1=0', '0', '0', '2', '1', '-1'),
])
def test_implicit_derivative_matches_implicit_function_theorem(equation, px, py, order, slope, second):
    p = document('implicit_derivative', implicit_expression=equation, point_x=px, point_y=py, order=order)
    assert p['manual_input']['result_status'] == 'complete'
    details = p['manual_input']['implicit_derivative_details']
    assert sp.simplify(sp.sympify(details['slope']) - sp.sympify(slope)) == 0
    if second is not None:
        assert sp.simplify(sp.sympify(details['second']) - sp.sympify(second)) == 0
    assert details['verification_level'] == 'numeric'


def test_implicit_derivative_rejects_point_off_curve_or_vertical_tangent():
    for conditions in [
        dict(implicit_expression='x^2+y^2=1', point_x='0', point_y='0', order='1'),
        dict(implicit_expression='x^2+y^2=1', point_x='1', point_y='0', order='1'),
        dict(implicit_expression='x^2+y^2=1', point_x='2', point_y='0', order='1'),
    ]:
        with pytest.raises(ValueError):
            preview_integral('implicit_derivative', conditions)


@pytest.mark.parametrize('expression,point,curvature,radius', [
    ('x^2', '1', '2*sqrt(5)/25', '5*sqrt(5)/2'),
    ('sin(x)', '0', '0', None),
    ('x^3', '1', '6/10**(3/2)', '10**(3/2)/6'),
])
def test_curvature_and_radius(expression, point, curvature, radius):
    p = document('curvature', expression=expression, point=point)
    assert p['manual_input']['result_status'] == 'complete'
    details = p['manual_input']['curvature_details']
    assert sp.simplify(sp.sympify(details['curvature']) - sp.sympify(curvature)) == 0
    if radius is None:
        assert details['radius'] is None
    else:
        assert sp.simplify(sp.sympify(details['radius']) - sp.sympify(radius)) == 0


def test_curvature_rejects_nonfinite_point():
    with pytest.raises(ValueError):
        preview_integral('curvature', dict(expression='1/x', point='0'))

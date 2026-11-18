import pytest
import sympy as sp

from app.labs.manual import build_manual_document, preview_integral


def document(task, **conditions):
    return build_manual_document(lab_id='t', title='', task=task, conditions=conditions,
                                 now_iso='2026-11-18')['problems'][0]


@pytest.mark.parametrize('expression,a,b,expected', [
    ('(2/3)*x^(3/2)', '0', '3', '14/3'),
    ('x^2', '0', '1', 'asinh(2)/4+sqrt(5)/2'),
    ('3*x/4', '0', '4', '5'),
])
def test_arc_length_matches_symbolic_integral(expression, a, b, expected):
    p = document('arc_length', expression=expression, lower=a, upper=b)
    assert p['manual_input']['result_status'] == 'complete'
    assert sp.simplify(sp.sympify(p['solution']['exact']) - sp.sympify(expected)) == 0
    assert p['manual_input']['application_details']['verification_level'] == 'numeric'


def test_parametric_arc_length_of_circle_quarter():
    p = document('parametric_arc_length', x_expression='cos(t)', y_expression='sin(t)', lower='0', upper='pi/2')
    assert p['manual_input']['result_status'] == 'complete'
    assert sp.simplify(sp.sympify(p['solution']['exact']) - sp.pi/2) == 0


@pytest.mark.parametrize('expression,a,b,axis,expected', [
    ('sqrt(x)', '0', '1', 'x', 'pi*(5*sqrt(5)-1)/6'),
    ('x', '0', '1', 'y', 'sqrt(2)*pi'),
])
def test_surface_of_revolution_uses_radius_times_ds(expression, a, b, axis, expected):
    p = document('surface_of_revolution', expression=expression, lower=a, upper=b, rotation_axis=axis)
    assert p['manual_input']['result_status'] == 'complete'
    assert sp.simplify(sp.sympify(p['solution']['exact']) - sp.sympify(expected)) == 0
    assert p['manual_input']['application_details']['axis'] == axis


def test_polar_area_of_cardioid():
    p = document('polar_area', expression='1+cos(theta)', lower='0', upper='2*pi')
    assert p['manual_input']['result_status'] == 'complete'
    assert sp.simplify(sp.sympify(p['solution']['exact']) - 3*sp.pi/2) == 0


def test_polar_arc_length_of_exponential_spiral():
    p = document('polar_arc_length', expression='exp(theta)', lower='0', upper='1')
    assert p['manual_input']['result_status'] == 'complete'
    # expression_text 按 UI 约定把欧拉常数写作小写 e，比较时按同一口径解析
    value = sp.sympify(p['solution']['exact'], locals={'e': sp.E})
    assert sp.simplify(value - sp.sqrt(2)*(sp.E-1)) == 0


def test_integral_applications_reject_flaws_and_missing_primitives():
    # 跨瑕点：1/x 的导数在 0 无定义
    with pytest.raises(ValueError):
        document('arc_length', expression='1/x', lower='-1', upper='1')
    # sin(x) 的弧长无初等原函数：明确未完成，不用数值近似冒充
    with pytest.raises(ValueError):
        document('arc_length', expression='sin(x)', lower='0', upper='pi')
    # 绕 y 轴跨轴
    with pytest.raises(ValueError, match='y 轴一侧'):
        preview_integral('surface_of_revolution', dict(expression='x', lower='-1', upper='1', rotation_axis='y'))
    # 区间顺序
    with pytest.raises(ValueError):
        preview_integral('arc_length', dict(expression='x^2', lower='1', upper='0'))
    # 缺旋转轴
    with pytest.raises(ValueError):
        preview_integral('surface_of_revolution', dict(expression='x^2', lower='0', upper='1', rotation_axis=''))

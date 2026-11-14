import pytest

from app.labs.manual import build_manual_document, preview_integral, revise_manual_document
from app.labs.solvers import evaluate_problem


def line_scalar(**overrides):
    conditions = {'integral_kind': 'line_scalar', 'curve_x': 't', 'curve_y': 't', 'curve_z': '0',
                  't_lower': '0', 't_upper': '1', 'integrand': '1'}
    conditions.update(overrides)
    return conditions


def line_vector(**overrides):
    conditions = {'integral_kind': 'line_vector', 'curve_x': 't', 'curve_y': '0', 'curve_z': '0',
                  't_lower': '0', 't_upper': '1', 'field_p': '1', 'field_q': '0',
                  'field_r': '0', 'orientation': 'forward'}
    conditions.update(overrides)
    return conditions


def surface_scalar_graph(**overrides):
    conditions = {'integral_kind': 'surface_scalar_graph', 'surface_z': 'x+y',
                  'x_lower': '0', 'x_upper': '1', 'y_lower': '0', 'y_upper': 'x',
                  'integrand': '1'}
    conditions.update(overrides)
    return conditions


def surface_scalar_param(**overrides):
    conditions = {'integral_kind': 'surface_scalar_param', 'surface_x': 'u', 'surface_y': 'v',
                  'surface_z_uv': '0', 'u_lower': '0', 'u_upper': '1',
                  'v_lower': '0', 'v_upper': '1', 'integrand': '1'}
    conditions.update(overrides)
    return conditions


def surface_flux_graph(**overrides):
    conditions = {'integral_kind': 'surface_flux_graph', 'surface_z': '1',
                  'x_lower': '0', 'x_upper': '1', 'y_lower': '0', 'y_upper': '1',
                  'field_p': '0', 'field_q': '0', 'field_r': 'z', 'orientation': 'up'}
    conditions.update(overrides)
    return conditions


def surface_flux_param(**overrides):
    conditions = {'integral_kind': 'surface_flux_param', 'surface_x': 'u', 'surface_y': 'v',
                  'surface_z_uv': '0', 'u_lower': '0', 'u_upper': '1',
                  'v_lower': '0', 'v_upper': '1', 'field_p': '0', 'field_q': '0',
                  'field_r': '1', 'orientation': 'positive'}
    conditions.update(overrides)
    return conditions


def green(**overrides):
    conditions = {'integral_kind': 'green', 'field_p': '-y', 'field_q': 'x',
                  'x_lower': '0', 'x_upper': '1', 'y_lower': '0', 'y_upper': '1',
                  'orientation': 'positive'}
    conditions.update(overrides)
    return conditions


def gauss(**overrides):
    conditions = {'integral_kind': 'gauss', 'field_p': 'x', 'field_q': 'y', 'field_r': 'z',
                  'x_lower': '0', 'x_upper': '1', 'y_lower': '0', 'y_upper': '1',
                  'z_lower': '0', 'z_upper': '1'}
    conditions.update(overrides)
    return conditions


def stokes(**overrides):
    conditions = {'integral_kind': 'stokes', 'field_p': '-y', 'field_q': 'x', 'field_r': '0',
                  'surface_z': '0', 'x_lower': '0', 'x_upper': '1',
                  'y_lower': '0', 'y_upper': '1', 'orientation': 'up'}
    conditions.update(overrides)
    return conditions


def document(conditions):
    return build_manual_document(lab_id='integral', title='', task='curve_surface_integral',
                                 conditions=dict(conditions), now_iso='2026-11-14')['problems'][0]


def solve(conditions):
    problem = document(conditions)
    assert problem['manual_input']['result_status'] == 'complete', problem['solution']
    return problem['manual_input']['space_integral_details'], problem


@pytest.mark.parametrize('kind,conditions,label', [
    ('line_scalar', line_scalar(), '第一类曲线积分（对弧长）'),
    ('line_vector', line_vector(), '第二类曲线积分（对坐标）'),
    ('surface_scalar_graph', surface_scalar_graph(), '第一类曲面积分（显式曲面）'),
    ('surface_scalar_param', surface_scalar_param(), '第一类曲面积分（参数曲面）'),
    ('surface_flux_graph', surface_flux_graph(), '第二类曲面积分（显式曲面）'),
    ('surface_flux_param', surface_flux_param(), '第二类曲面积分（参数曲面）'),
    ('green', green(), 'Green 公式'),
    ('gauss', gauss(), 'Gauss 公式'),
    ('stokes', stokes(), 'Stokes 公式'),
])
def test_preview_labels_and_conditions(kind, conditions, label):
    preview = preview_integral('curve_surface_integral', conditions)
    assert preview['task'] == 'curve_surface_integral'
    assert preview['label'] == label
    assert preview['conditions']['integral_kind'] == kind
    assert preview['latex']
    assert preview['question']


def test_line_integrals_both_classes_and_orientation():
    details, problem = solve(line_scalar())
    facts = {item['label']: item.get('latex') or item.get('text') for item in details['facts']}
    assert problem['solution']['exact'] == 'sqrt(2)'
    assert facts['积分值'] == r'\sqrt{2}'
    assert details['kind'] == 'line_integral_scalar'

    details, problem = solve(line_vector())
    assert problem['solution']['exact'] == '1'
    assert details['kind'] == 'line_integral_vector'
    assert details['orientation'] == '参数增大方向'

    details, problem = solve(line_vector(orientation='reverse'))
    assert problem['solution']['exact'] == '-1'
    assert details['orientation'] == '与参数增大方向相反'

    two_d, problem = solve(line_scalar(curve_x='t', curve_y='t', curve_z='0', integrand='1'))
    assert problem['solution']['exact'] == 'sqrt(2)'


def test_surface_scalar_graph_and_parametric():
    details, problem = solve(surface_scalar_graph())
    assert problem['solution']['exact'] == 'sqrt(3)/2'
    assert details['kind'] == 'surface_integral_scalar'
    facts = {item['label']: item.get('latex') or item.get('text') for item in details['facts']}
    assert '面积元' in facts

    details, problem = solve(surface_scalar_param())
    assert problem['solution']['exact'] == '1'


def test_surface_flux_graph_up_and_down_and_non_rectangular_region():
    details, problem = solve(surface_flux_graph())
    assert problem['solution']['exact'] == '1'
    assert details['orientation'] == '上侧'

    details, problem = solve(surface_flux_graph(orientation='down'))
    assert problem['solution']['exact'] == '-1'
    assert details['orientation'] == '下侧'

    details, problem = solve(surface_flux_graph(surface_z='x+y', y_upper='x',
                                                 field_p='0', field_q='0', field_r='1'))
    assert problem['solution']['exact'] == '1/2'


def test_surface_flux_parametric_positive_and_negative():
    details, problem = solve(surface_flux_param())
    assert problem['solution']['exact'] == '1'
    assert '正向' in details['orientation']
    details, problem = solve(surface_flux_param(orientation='negative'))
    assert problem['solution']['exact'] == '-1'


def test_green_formula_two_paths_and_orientation():
    details, problem = solve(green())
    assert problem['solution']['exact'] == '2'
    facts = {item['label']: item.get('latex') or item.get('text') for item in details['facts']}
    assert facts['两条路径差'] == '0'
    assert details['orientation'] == '正向（逆时针）'

    details, problem = solve(green(orientation='negative'))
    assert problem['solution']['exact'] == '-2'
    facts = {item['label']: item.get('latex') or item.get('text') for item in details['facts']}
    assert facts['两条路径差'] == '0'


def test_gauss_formula_box_outward_normal():
    details, problem = solve(gauss())
    assert problem['solution']['exact'] == '3'
    facts = {item['label']: item.get('latex') or item.get('text') for item in details['facts']}
    assert facts['散度'] == '3'
    assert facts['两条路径差'] == '0'
    assert details['orientation'] == '外法向'


def test_stokes_formula_up_and_down_orientation():
    details, problem = solve(stokes())
    assert problem['solution']['exact'] == '2'
    facts = {item['label']: item.get('latex') or item.get('text') for item in details['facts']}
    assert facts['两条路径差'] == '0'
    assert '上侧' in details['orientation']

    details, problem = solve(stokes(orientation='down'))
    assert problem['solution']['exact'] == '-2'
    facts = {item['label']: item.get('latex') or item.get('text') for item in details['facts']}
    assert facts['两条路径差'] == '0'


def test_evaluation_keeps_space_task_and_details():
    _, problem = solve(surface_flux_graph())
    assert problem['model']['task'] == 'surface_integral'
    result = evaluate_problem(problem['model'], {})
    assert result['kind'] == 'space'
    assert result['space_integral_details']['kind'] == 'surface_integral_flux'
    assert result['space']['grid']


@pytest.mark.parametrize('conditions,message', [
    (line_scalar(curve_x='0', curve_y='0', curve_z='0'), '退化'),
    (line_scalar(t_lower='1', t_upper='0'), '从小到大'),
    (line_scalar(curve_x=''), '曲线 x'),
    (line_vector(orientation='sideways'), '定向'),
    (surface_scalar_graph(y_lower='1', y_upper='0'), '下界高于上界'),
    (surface_scalar_graph(surface_z='x^2+y^2'), '闭式'),
    (surface_flux_param(surface_x='u', surface_y='0', surface_z_uv='0'), '退化'),
    (gauss(field_r=''), 'R'),
    (green(field_p='z'), r'P\(x,y\)'),
    (stokes(orientation='sideways'), '定向'),
    (surface_scalar_param(u_lower='1', u_upper='0'), '从小到大'),
])
def test_invalid_integral_conditions_are_rejected(conditions, message):
    with pytest.raises(ValueError, match=message):
        preview_integral('curve_surface_integral', conditions)


def test_unknown_or_missing_fields_are_not_ignored():
    with pytest.raises(ValueError):
        preview_integral('curve_surface_integral', dict(line_scalar(), extra='1'))
    with pytest.raises(ValueError):
        preview_integral('curve_surface_integral', {'integral_kind': 'line_scalar'})
    with pytest.raises(ValueError):
        preview_integral('curve_surface_integral', {'integral_kind': 'unknown'})


def test_revision_rebuilds_with_new_orientation_and_field():
    data = build_manual_document(lab_id='integral', title='', task='curve_surface_integral',
                                 conditions=green(), now_iso='2026-11-14')
    revised = revise_manual_document(data, data['problems'][0], {'orientation': 'negative'})
    assert revised['solution']['exact'] == '-2'
    assert revised['manual_input']['conditions']['orientation'] == 'negative'

    data = build_manual_document(lab_id='integral', title='', task='curve_surface_integral',
                                 conditions=line_vector(), now_iso='2026-11-14')
    revised = revise_manual_document(data, data['problems'][0], {'field_p': 'x'})
    assert revised['solution']['exact'] == '1/2'


def test_manual_record_labels_and_formula_tex():
    problem = document(green())
    labels = {item['id']: item['label'] for item in problem['recognition']['conditions']}
    assert labels['integral_kind'] == '积分类型'
    assert labels['field_p'] == 'P(x,y)'
    assert problem['manual_input']['confirmed'] is True
    assert problem['model']['formula_tex']


def test_curve_integral_preserves_original_domain():
    with pytest.raises(ValueError, match='实定义'):
        preview_integral('curve_surface_integral', line_scalar(
            curve_x='sqrt(t)^2', t_lower='-1', t_upper='1'))
    details, problem = solve(line_scalar(curve_x='sqrt(t)^2', curve_y='0', t_lower='0', t_upper='1'))
    assert problem['manual_input']['conditions']['curve_x'] == '(sqrt(t))^2'
    assert problem['solution']['exact'] == '1'
    assert details['kind'] == 'line_integral_scalar'
    with pytest.raises(ValueError, match='实定义'):
        preview_integral('curve_surface_integral', line_scalar(
            integrand='sqrt(x)^2', t_lower='-1', t_upper='1'))


def test_surface_and_green_preserve_original_domain():
    with pytest.raises(ValueError, match='实定义'):
        preview_integral('curve_surface_integral', surface_scalar_graph(
            surface_z='1', x_lower='-1', x_upper='1',
            y_lower='0', y_upper='1', integrand='sqrt(x)^2'))
    with pytest.raises(ValueError, match='实定义'):
        preview_integral('curve_surface_integral', surface_scalar_param(
            surface_x='sqrt(u)^2', u_lower='-1', u_upper='1'))
    with pytest.raises(ValueError, match='实定义'):
        preview_integral('curve_surface_integral', green(
            field_p='sqrt(x)^2', x_lower='-1', x_upper='1'))
    details, problem = solve(surface_scalar_param(
        surface_x='sqrt(u)^2', u_lower='0', u_upper='1'))
    assert problem['solution']['exact'] == '1'


def test_surface_region_rejects_local_bound_inversion():
    with pytest.raises(ValueError, match='下界高于上界'):
        preview_integral('curve_surface_integral', surface_scalar_graph(
            surface_z='1', x_lower='0', x_upper='1',
            y_lower='0', y_upper='(x-1/12)^2-1/400', integrand='1'))


def test_parametric_surface_coverage_is_reported():
    details, problem = solve(surface_scalar_param(
        surface_x='cos(u)', surface_y='sin(u)', surface_z_uv='v',
        u_lower='0', u_upper='4*pi', v_lower='0', v_upper='1'))
    assert problem['solution']['exact'] == '4*pi'
    assert any(item['label'] == '积分口径' and '覆盖' in item.get('text', '')
               for item in details['facts'])
    assert any('覆盖' in note for note in details['notes'])

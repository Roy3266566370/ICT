import pytest

from app.labs.manual import build_manual_document, preview_integral, revise_manual_document
from app.labs.solvers import evaluate_problem


def document(conditions):
    return build_manual_document(lab_id='space', title='', task='space_geometry',
                                 conditions=dict(conditions), now_iso='2026-11-14')['problems'][0]


def solve(conditions):
    problem = document(conditions)
    assert problem['manual_input']['result_status'] == 'complete', problem['solution']
    return problem['manual_input']['space_details'], problem


def test_preview_normalizes_vectors_and_reports_label():
    preview = preview_integral('space_geometry', {
        'geometry_kind': 'vector_operations', 'vector_a': ' 1, 2, 3 ', 'vector_b': '4,5,6'})
    assert preview['task'] == 'space_geometry'
    assert preview['label'] == '向量运算'
    assert preview['conditions'] == {
        'geometry_kind': 'vector_operations', 'vector_a': '1, 2, 3', 'vector_b': '4, 5, 6'}
    assert 'a·b=32' in document({
        'geometry_kind': 'vector_operations', 'vector_a': '1,2,3', 'vector_b': '4,5,6'})['solution']['answer']


def test_vector_operations_include_cross_angle_and_projection():
    details, problem = solve({
        'geometry_kind': 'vector_operations', 'vector_a': '1,0,0', 'vector_b': '0,1,0'})
    labels = {item['label']: item['latex'] for item in details['facts']}
    assert labels['a·b'] == '0'
    assert labels['a×b'] == r'\left(0,0,1\right)'
    assert labels['夹角 θ'] == r'\frac{\pi}{2}'
    assert labels['a 在 b 上的数量投影'] == '0'
    result = evaluate_problem(problem['model'], {})
    assert result['kind'] == 'space'
    assert result['space']['kind'] == 'geometry'
    assert result['space_solution']['geometry_kind'] == 'vector_operations'


def test_vector_products_area_volume_and_coplanarity():
    details, problem = solve({
        'geometry_kind': 'vector_products',
        'vector_a': '1,0,0', 'vector_b': '0,1,0', 'vector_c': '0,0,1'})
    labels = {item['label']: item['latex'] for item in details['facts']}
    assert labels['平行四边形面积 |a×b|'] == '1'
    assert labels['四面体体积'] == r'\frac{1}{6}'
    assert details['relation'] == '三向量不共面'
    coplanar, _ = solve({
        'geometry_kind': 'vector_products',
        'vector_a': '1,0,0', 'vector_b': '0,1,0', 'vector_c': '1,1,0'})
    assert coplanar['relation'] == '三向量共面'


def test_line_equations_handle_zero_direction_components():
    details, _ = solve({
        'geometry_kind': 'line_point_direction', 'line_point': '0,1,2', 'line_direction': '1,0,0'})
    equations = {item['label']: item['latex'] for item in details['equations']}
    assert 'y=1' in equations['对称式'] and 'z=2' in equations['对称式']
    assert 'x=' in equations['参数方程']

    details, _ = solve({
        'geometry_kind': 'line_from_points', 'point_a': '0,0,0', 'point_b': '1,2,3'})
    labels = {item['label']: item['latex'] for item in details['facts']}
    assert labels['方向向量'] == r'\left(1,2,3\right)'


def test_plane_from_point_normal_and_three_points():
    details, _ = solve({
        'geometry_kind': 'plane_point_normal', 'point': '1,2,3', 'normal': '2,3,4'})
    labels = {item['label']: item['latex'] for item in details['facts']}
    assert labels['平面方程'] == '2 x + 3 y + 4 z - 20 = 0'

    details, _ = solve({
        'geometry_kind': 'plane_three_points',
        'point_a': '1,0,0', 'point_b': '0,1,0', 'point_c': '0,0,1'})
    labels = {item['label']: item['latex'] for item in details['facts']}
    assert labels['平面方程'] == 'x + y + z - 1 = 0'


def test_point_plane_and_point_line_distances_with_feet():
    details, _ = solve({
        'geometry_kind': 'point_plane_distance', 'point': '0,0,0', 'plane': '1,0,0,-2'})
    labels = {item['label']: item['latex'] for item in details['facts']}
    assert labels['距离 d'] == '2'
    assert labels['投影点'] == r'\left(2,0,0\right)'

    details, _ = solve({
        'geometry_kind': 'point_line_distance',
        'point': '0,1,0', 'line_point': '0,0,0', 'line_direction': '1,0,0'})
    labels = {item['label']: item['latex'] for item in details['facts']}
    assert labels['距离 d'] == '1'
    assert labels['垂足'] == r'\left(0,0,0\right)'


@pytest.mark.parametrize('point_b,direction_b,relation,distance', [
    ('0,0,0', '0,1,0', '相交', '0'),
    ('0,1,0', '1,0,0', '平行', '1'),
    ('0,1,1', '0,1,0', '异面', '1'),
    ('0,0,0', '1,0,0', '重合', '0'),
])
def test_line_line_relations(point_b, direction_b, relation, distance):
    details, _ = solve({
        'geometry_kind': 'line_line_relation',
        'point_a': '0,0,0', 'direction_a': '1,0,0',
        'point_b': point_b, 'direction_b': direction_b})
    assert details['relation'] == relation
    assert details['distance'] == distance


@pytest.mark.parametrize('direction,plane,relation', [
    ('1,0,0', '0,0,1,-2', '平行'),
    ('1,0,0', '0,0,1,0', '直线在平面内'),
    ('0,0,1', '0,0,1,-2', '相交'),
])
def test_line_plane_relations(direction, plane, relation):
    details, _ = solve({
        'geometry_kind': 'line_plane_relation',
        'line_point': '0,0,0', 'line_direction': direction, 'plane': plane})
    assert details['relation'] == relation


def test_line_plane_parallel_and_projection():
    details, _ = solve({
        'geometry_kind': 'line_plane_relation',
        'line_point': '0,0,1', 'line_direction': '1,0,0', 'plane': '0,0,1,0'})
    assert details['relation'] == '平行'
    assert details['distance'] == '1'

    details, _ = solve({
        'geometry_kind': 'line_plane_projection',
        'line_point': '0,0,1', 'line_direction': '1,0,1', 'plane': '0,0,1,0'})
    labels = {item['label']: item['latex'] for item in details['facts']}
    assert labels['投影直线对称式'] == 'y=0,\\quad z=0'


def test_line_perpendicular_to_plane_projects_to_point():
    details, _ = solve({
        'geometry_kind': 'line_plane_projection',
        'line_point': '0,0,1', 'line_direction': '0,0,1', 'plane': '0,0,1,0'})
    assert details['intersection'] == '(0, 0, 0)'
    assert details['equations'] == []


def test_plane_plane_relation_intersection_line_and_parallel_distance():
    details, _ = solve({
        'geometry_kind': 'plane_plane_relation', 'plane': '1,0,0,0', 'plane2': '0,1,0,0'})
    assert details['relation'] == '相交'
    assert details['angle'] == 'pi/2'
    assert any(item['label'] == '交线对称式' for item in details['equations'])

    details, _ = solve({
        'geometry_kind': 'plane_plane_relation', 'plane': '0,0,1,-1', 'plane2': '0,0,2,-4'})
    assert details['relation'] == '平行'
    assert details['distance'] == '1'


def test_surface_tangent_plane_and_normal():
    details, problem = solve({
        'geometry_kind': 'surface_tangent', 'surface': 'z=x^2+y^2', 'point': '1,1,2'})
    labels = {item['label']: item['latex'] for item in details['facts']}
    assert labels['切平面'] == '2 x + 2 y - z - 2 = 0'
    assert labels['法向量 ∇F(P)'] == r'\left(-2,-2,1\right)'
    assert labels['曲面上的点 P'] == r'\left(1,1,2\right)'
    assert problem['solution']['space']['grid']


@pytest.mark.parametrize('conditions,message', [
    ({'geometry_kind': 'surface_tangent', 'surface': 'z=x^2+y^2', 'point': '1,1,3'}, '不在曲面上'),
    ({'geometry_kind': 'surface_tangent', 'surface': 'z^2=x^2+y^2', 'point': '0,0,0'}, '奇点'),
])
def test_surface_tangent_rejects_off_surface_and_singular_points(conditions, message):
    with pytest.raises(ValueError, match=message):
        preview_integral('space_geometry', conditions)


@pytest.mark.parametrize('expression,classification', [
    ('x^2/4+y^2/9+z^2=1', '椭球面'),
    ('x^2+y^2-z^2=1', '单叶双曲面'),
    ('x^2+y^2-z^2=-1', '双叶双曲面'),
    ('x^2+y^2-z^2=0', '椭圆锥面'),
    ('x^2+y^2-z=0', '椭圆抛物面'),
    ('x^2-y^2-z=0', '双曲抛物面'),
    ('x^2+y^2=1', '椭圆柱面'),
    ('x^2-y^2=1', '双曲柱面'),
    ('x^2+z=0', '抛物柱面'),
    ('x^2-y^2=0', '两张相交平面（退化二次曲面）'),
    ('x^2=1', '两张平行平面（退化二次曲面）'),
    ('x^2+y^2=0', '一条直线（退化二次曲面）'),
])
def test_quadric_surface_classification(expression, classification):
    details, problem = solve({'geometry_kind': 'quadric_surface', 'expression': expression})
    assert details['classification'] == classification
    assert details['standard_form']
    assert problem['model']['expression'] == expression


@pytest.mark.parametrize('expression,message', [
    ('x^2+y^2+z^2+x*y=1', '交叉项'),
    ('x^2+y^2+z^3=1', '次数'),
    ('x+y+z=1', '不是二次曲面'),
    ('x^2+y+z=1', '一次项'),
])
def test_quadric_surface_rejects_unsupported_forms(expression, message):
    with pytest.raises(ValueError, match=message):
        preview_integral('space_geometry', {'geometry_kind': 'quadric_surface', 'expression': expression})


@pytest.mark.parametrize('conditions', [
    {'geometry_kind': 'vector_operations', 'vector_a': '0,0,0', 'vector_b': '1,0,0'},
    {'geometry_kind': 'vector_operations', 'vector_a': '1,0', 'vector_b': '1,0,0'},
    {'geometry_kind': 'vector_operations', 'vector_a': '1,0,0', 'vector_b': '1,0,0', 'extra': '1'},
    {'geometry_kind': 'plane_point_normal', 'point': '0,0,0', 'normal': '0,0,0'},
    {'geometry_kind': 'plane_three_points', 'point_a': '0,0,0', 'point_b': '1,0,0', 'point_c': '2,0,0'},
    {'geometry_kind': 'point_plane_distance', 'point': 'x,0,0', 'plane': '1,0,0,-2'},
    {'geometry_kind': 'line_from_points', 'point_a': '0,0,0', 'point_b': '0,0,0'},
    {'geometry_kind': 'unknown_kind', 'point': '0,0,0'},
    {'geometry_kind': 'quadric_surface'},
])
def test_invalid_space_conditions_are_rejected(conditions):
    with pytest.raises(ValueError):
        preview_integral('space_geometry', conditions)


def test_revision_rebuilds_with_new_point_and_plane():
    conditions = {'geometry_kind': 'point_plane_distance', 'point': '0,0,0', 'plane': '1,0,0,-2'}
    data = build_manual_document(lab_id='space', title='', task='space_geometry',
                                 conditions=conditions, now_iso='2026-11-14')
    revised = revise_manual_document(data, data['problems'][0],
                                     {'point': '1,1,1', 'plane': '0,1,0,-3'})
    assert revised['manual_input']['space_details']['distance'] == '2'
    assert revised['manual_input']['conditions']['point'] == '1, 1, 1'
    assert revised['solution']['exact'] == '2'


def test_manual_document_keeps_user_confirmed_condition_labels():
    problem = document({'geometry_kind': 'line_plane_relation',
                        'line_point': '0,0,0', 'line_direction': '0,0,1', 'plane': '0,0,1,-2'})
    labels = {item['id']: item['label'] for item in problem['recognition']['conditions']}
    assert labels['geometry_kind'] == '空间对象类型'
    assert labels['plane'] == '平面1 (a,b,c,d)'
    assert problem['manual_input']['confirmed'] is True
    assert problem['model']['formula_tex']


@pytest.mark.parametrize('expression', [
    'x^2/4+y^2/9+z^2=1',
    'x^2+y^2-z^2=1',
    'x^2+y^2-z^2=-1',
    'x^2+y^2-z^2=0',
    'x^2+y^2-z=0',
    'x^2-y^2-z=0',
    'x^2+y^2=1',
    'x^2-y^2=1',
    'x^2+z=0',
])
def test_quadric_surfaces_include_sample_grid(expression):
    _, problem = solve({'geometry_kind': 'quadric_surface', 'expression': expression})
    grid = problem['solution']['space']['grid']
    assert grid and all(row for row in grid)
    assert any(len({(point['x'], point['y'], point['z']) for point in row}) > 1 for row in grid)


def test_implicit_surface_tangent_plane():
    details, problem = solve({
        'geometry_kind': 'surface_tangent', 'surface': 'x^2+y^2+z^2=1', 'point': '1,0,0'})
    labels = {item['label']: item['latex'] for item in details['facts']}
    assert labels['切平面'] == 'x - 1 = 0'
    assert labels['法向量 ∇F(P)'] == r'\left(2,0,0\right)'
    assert problem['manual_input']['result_status'] == 'complete'


def test_surface_tangent_rejects_crease_point():
    with pytest.raises(ValueError, match='可微'):
        preview_integral('space_geometry', {
            'geometry_kind': 'surface_tangent', 'surface': 'z=abs(x)', 'point': '0,0,0'})


def test_parallel_plane_distance_is_sign_independent():
    details, _ = solve({
        'geometry_kind': 'plane_plane_relation',
        'plane': '1,0,0,-1', 'plane2': '-1,0,0,2'})
    assert details['relation'] == '平行'
    assert details['distance'] == '1'


def test_paraboloid_standard_form_keeps_constant():
    details, problem = solve({'geometry_kind': 'quadric_surface', 'expression': 'z=x^2+y^2+1'})
    assert details['classification'] == '椭圆抛物面'
    assert 'z = x^2 + y^2 + 1' in problem['solution']['answer']
    details, problem = solve({'geometry_kind': 'quadric_surface', 'expression': 'z=x^2+1'})
    assert details['classification'] == '抛物柱面'
    assert 'z = x^2 + 1' in problem['solution']['answer']


def test_parallel_plane_distance_is_scale_and_sign_invariant():
    details, _ = solve({
        'geometry_kind': 'plane_plane_relation',
        'plane': '2,0,0,-2', 'plane2': '-1,0,0,2'})
    assert details['relation'] == '平行'
    assert details['distance'] == '1'
    details, _ = solve({
        'geometry_kind': 'plane_plane_relation',
        'plane': '1,0,0,-1', 'plane2': '-2,0,0,2'})
    assert details['relation'] == '重合'
    assert details['distance'] == '0'


def test_surface_tangent_requires_point_in_surface_domain():
    with pytest.raises(ValueError, match='实定义'):
        preview_integral('space_geometry', {
            'geometry_kind': 'surface_tangent', 'surface': 'z=sqrt(x)^2', 'point': '-1,0,-1'})
    details, _ = solve({
        'geometry_kind': 'surface_tangent', 'surface': 'z=sqrt(x)^2', 'point': '1,0,1'})
    labels = {item['label']: item['latex'] for item in details['facts']}
    assert labels['切平面'] == 'x - z = 0'

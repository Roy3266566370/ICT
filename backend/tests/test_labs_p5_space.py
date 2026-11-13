"""P5 regressions: triple/line/surface integrals, Green/Gauss/Stokes and geometry."""
from __future__ import annotations

import json
import math

import pytest

from app.labs.ai_solve import compute_plan


def plan(task: str, **conditions):
    return compute_plan({'kind': 'kernel', 'task': task, 'conditions': conditions})


def test_triple_integral_box_cylinder_and_spherical():
    box = plan('triple_integral', integrand='1', region={
        'kind': 'box', 'x': ['0', '1'], 'y': ['0', '1'], 'z': ['0', '1']})
    assert box['answer'] == '1'

    cylinder = plan('triple_integral', integrand='1', region={
        'kind': 'cylindrical', 'theta': ['0', '2*pi'], 'r': ['0', '1'], 'z': ['0', '1']})
    assert cylinder['answer'] == 'pi'

    sphere = plan('triple_integral', integrand='1', region={
        'kind': 'spherical', 'theta': ['0', '2*pi'], 'phi': ['0', 'pi'], 'rho': ['0', '1']})
    assert sphere['answer'] == '4*pi/3'


def test_triple_integral_z_simple_region():
    result = plan('triple_integral', integrand='1', region={
        'kind': 'z_simple', 'x': ['0', '1'], 'y': ['0', 'x'], 'z': ['0', '1']})
    assert result['answer'] == '1/2'


def test_line_integral_scalar_and_vector():
    scalar = plan('line_integral', curve=['t', 't', 't'], t_bounds=['0', '1'], kind='scalar', field='1')
    assert float(__import__('sympy').sympify(scalar['answer'])) == pytest.approx(math.sqrt(3))
    vector = plan('line_integral', curve=['t', 't', 't'], t_bounds=['0', '1'], kind='vector', field=['y', 'z', 'x'])
    assert vector['answer'] == '3/2'


def test_surface_integral_scalar_area_and_flux():
    area = plan('surface_integral', surface=['u', 'v', '0'], uv_bounds=[['0', '1'], ['0', '1']],
                kind='scalar', field='1')
    assert area['answer'] == '1'
    flux = plan('surface_integral', surface=['u', 'v', '0'], uv_bounds=[['0', '1'], ['0', '1']],
                kind='flux', field=['0', '0', '1'])
    assert flux['answer'] == '1'


def test_green_gauss_and_stokes_two_path_verification():
    green = plan('green', field=['-y', 'x'], region={'x': ['0', '1'], 'y': ['0', '1']})
    assert green['answer'] == '2'
    gauss = plan('gauss', field=['x', 'y', 'z'], region={
        'kind': 'box', 'x': ['0', '1'], 'y': ['0', '1'], 'z': ['0', '1']})
    assert gauss['answer'] == '3'
    stokes = plan('stokes', field=['-y', 'x', '0'], surface_z='0', region={'x': ['0', '1'], 'y': ['0', '1']})
    assert stokes['answer'] == '2'


def test_space_geometry_distances_intersection_and_angle():
    point_plane = plan('space_geometry', geometry_kind='point_plane_distance',
                       point=['0', '0', '0'], plane=['1', '0', '0', '-2'])
    assert point_plane['answer'] == '点到平面距离 2'

    point_line = plan('space_geometry', geometry_kind='point_line_distance',
                      point=['0', '1', '0'], line_point=['0', '0', '0'], line_direction=['1', '0', '0'])
    assert point_line['answer'] == '点到直线距离 1'

    hit = plan('space_geometry', geometry_kind='line_plane_intersection',
               line_point=['0', '0', '0'], line_direction=['0', '0', '1'], plane=['0', '0', '1', '-2'])
    assert '交点' in hit['answer']

    angle = plan('space_geometry', geometry_kind='plane_plane_angle',
                 plane=['1', '0', '0', '0'], plane2=['0', '1', '0', '0'])
    assert '夹角' in angle['answer']


def test_invalid_space_dimensions_are_rejected():
    with pytest.raises(ValueError):
        plan('line_integral', curve=['t', 't'], t_bounds=['0', '1'], kind='scalar', field='1')
    with pytest.raises(ValueError):
        plan('gauss', field=['x', 'y'], region={'kind': 'box', 'x': ['0', '1'], 'y': ['0', '1'], 'z': ['0', '1']})
    with pytest.raises(ValueError):
        plan('surface_integral', surface=['u', 'v', '0'], uv_bounds=[['1', '0'], ['0', '1']],
             kind='scalar', field='1')


def test_p5_results_are_json_serializable_and_have_space_data():
    result = plan('green', field=['-y', 'x'], region={'x': ['0', '1'], 'y': ['0', '1']})
    json.dumps(result, ensure_ascii=False, allow_nan=False)
    assert result['interactive_solution']['space']['curves']
    assert not any(check['status'] == 'fail' for check in result['checks'])

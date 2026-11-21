# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.kernel_models import compile_kernel_problem as compile_problem

cases = {
    'surf_tan': ('space_geometry', {
        'geometry_kind': 'surface_tangent',
        'surface': 'x^2 + y^2 - z', 'point': '1,1,2'}),
    'quadric': ('space_geometry', {
        'geometry_kind': 'quadric_surface',
        'expression': 'x^2/4 + y^2/9 - z^2 = 1'}),
    'pt_plane': ('space_geometry', {
        'geometry_kind': 'point_plane_distance',
        'point': '1,2,3', 'plane': '1,2,-2,5'}),
    'pt_line': ('space_geometry', {
        'geometry_kind': 'point_line_distance',
        'point': '1,0,2', 'line_point': '0,0,0', 'line_direction': '1,1,0'}),
    'lp_int': ('space_geometry', {
        'geometry_kind': 'line_plane_intersection',
        'line_point': '1,0,0', 'line_direction': '1,1,1', 'plane': '1,1,1,-3'}),
    'pp_ang': ('space_geometry', {
        'geometry_kind': 'plane_plane_angle',
        'plane': '1,1,1,-1', 'plane2': '1,-1,0,0'}),
    'lp_proj': ('space_geometry', {
        'geometry_kind': 'line_plane_projection',
        'line_point': '1,0,0', 'line_direction': '1,1,1', 'plane': '1,1,1,-3'}),
    'vec_ops': ('space_geometry', {
        'geometry_kind': 'vector_operations',
        'vector_a': '1,2,3', 'vector_b': '4,5,6'}),
    'vec_prod': ('space_geometry', {
        'geometry_kind': 'vector_products',
        'vector_a': '1,0,0', 'vector_b': '0,1,0', 'vector_c': '0,0,1'}),
    'line_pts': ('space_geometry', {
        'geometry_kind': 'line_from_points',
        'point_a': '1,2,3', 'point_b': '4,5,6'}),
    'line_pd': ('space_geometry', {
        'geometry_kind': 'line_point_direction',
        'line_point': '1,0,2', 'line_direction': '3,-1,2'}),
    'plane_3pt': ('space_geometry', {
        'geometry_kind': 'plane_three_points',
        'point_a': '1,0,0', 'point_b': '0,1,0', 'point_c': '0,0,1'}),
    'll_rel': ('space_geometry', {
        'geometry_kind': 'line_line_relation',
        'point_a': '0,0,0', 'direction_a': '1,0,0',
        'point_b': '0,1,0', 'direction_b': '0,1,0'}),
}

for name, (task, cond) in cases.items():
    try:
        m = compile_problem({'task': task, 'conditions': dict(cond)})
        print(name, '=> OK', str(m.get('answer') or m.get('solution') or '')[:70])
    except Exception as e:
        print(name, '=> FAIL', type(e).__name__, str(e)[:100])

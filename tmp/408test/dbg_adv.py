import sys, traceback
sys.path.insert(0, '.')
from app.labs.kernel_models import compile_kernel_problem

cases = [
    ('triple_integral', {'integrand': 'x+y+z', 'region': {'kind': 'box', 'x': ['0', '1'], 'y': ['0', '1'], 'z': ['0', '1']}}),
    ('integral_function', {'expression': 't^2', 'lower_expression': '0', 'upper_expression': 'x', 'point': '2'}),
    ('multivariable', {'expression': 'x^2*y+y^3', 'operation': 'partial', 'variables': 'x,y', 'partial_variable': 'x'}),
    ('multivariable_extrema', {'expression': 'x*y', 'operation': 'constrained', 'variables': ['x', 'y'], 'constraint': 'x+y=1'}),
    ('space_geometry', {'geometry_kind': 'plane_point_normal', 'point': '1,2,3', 'normal': '2,1,-1'}),
]
for task, cond in cases:
    try:
        p = compile_kernel_problem({'task': task, 'conditions': cond})
        sol = p.get('solution') or {}
        print(f"{task}: OK st={p.get('status')} ans={str(sol.get('answer'))[:100]}")
        print('   keys:', sorted(p.keys()))
        print('   model.engine:', (p.get('model') or {}).get('engine'))
    except Exception as e:
        print(f"{task}: FAIL {type(e).__name__}: {e}")

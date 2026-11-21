import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.kernel_models import compile_kernel_problem
from app.labs.solvers import solve_problem

CASES = {
    'sph': ('triple_integral', {'integrand': '1',
        'region': {'kind': 'spherical', 'theta': ['0', '2*pi'], 'phi': ['0', 'pi'], 'rho': ['0', '1']}}),
    'flux': ('surface_integral', {'surface_mode': 'graph', 'surface_z': '1',
        'region': {'x': ['0', '1'], 'y': ['0', '1']}, 'kind': 'flux',
        'field': ['x', 'y', 'z'], 'orientation': 'up'}),
    'ell': ('green', {'field': ['-y', 'x'],
        'region': {'x': ['-2', '2'], 'y': ['-sqrt(1-x^2/4)', 'sqrt(1-x^2/4)']}, 'orientation': 'positive'}),
    'par_d': ('parametric_derivative', {'x_expression': 't^2', 'y_expression': 't^3', 'point': '1', 'order': 1}),
    'arc': ('arc_length', {'expression': 'x^(3/2)', 'lower': '0', 'upper': '4'}),
    'asy': ('asymptote', {'expression': '(2*x+1)/(x-1)'}),
    'cur': ('curvature', {'expression': 'x^2', 'point': '1'}),
    'leib': ('integral_function', {'expression': 't', 'lower_expression': 'x', 'upper_expression': 'x^2'}),
    'pol': ('polar_area', {'expression': '2*cos(theta)', 'lower': '-pi/2', 'upper': 'pi/2'}),
    'hod': ('higher_derivative', {'expression': 'sin(2*x)', 'variable': 'x', 'order': 3}),
    'nor': ('implicit_normal', {'implicit_expression': 'x^2+y^2=4', 'point_x': 'sqrt(2)', 'point_y': 'sqrt(2)'}),
    'parc': ('parametric_arc_length', {'x_expression': 'cos(t)', 'y_expression': 'sin(t)', 'lower': '0', 'upper': '2*pi'}),
}
for name, (task, cond) in CASES.items():
    try:
        p = compile_kernel_problem({'task': task, 'conditions': cond})
        s = solve_problem(p['model'])
        sol = s.get('solution') or s
        print(f"{name}: OK ans={str(sol.get('answer'))[:70]}")
    except Exception as e:
        print(f"{name}: FAIL {type(e).__name__}: {e}")

import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.kernel_models import compile_kernel_problem

CASES = {
    'surface': ('surface_integral', {'surface_mode': 'graph', 'surface_z': 'x+y',
        'region': {'x': ['0', '1'], 'y': ['0', '1']}, 'kind': 'scalar', 'field': 'z'}),
    'green': ('green', {'field': ['x^2-y', 'x+y^2'],
        'region': {'x': ['-1', '1'], 'y': ['-sqrt(1-x^2)', 'sqrt(1-x^2)']}, 'orientation': 'positive'}),
    'gauss': ('gauss', {'field': ['x', 'y', 'z'],
        'region': {'kind': 'box', 'x': ['0', '1'], 'y': ['0', '1'], 'z': ['0', '1']}}),
    'stokes': ('stokes', {'field': ['-y', 'x', 'z'], 'surface_z': '1',
        'region': {'x': ['0', '1'], 'y': ['0', '1']}, 'orientation': 'up'}),
    'directional': ('multivariable', {'expression': 'x^2+y^2', 'operation': 'directional',
        'variables': 'x,y', 'point': '1,1', 'direction': '3,4', 'direction_limit': 'forward'}),
    'unconstrained': ('multivariable_extrema', {'expression': 'x^2+y^2-2*x-4*y',
        'operation': 'unconstrained', 'variables': ['x', 'y']}),
    'triple_cyl': ('triple_integral', {'integrand': 'z',
        'region': {'kind': 'cylindrical', 'theta': ['0', '2*pi'], 'r': ['0', '1'], 'z': ['0', '1']}}),
}
for name, (task, cond) in CASES.items():
    try:
        p = compile_kernel_problem({'task': task, 'conditions': cond})
        from app.labs.solvers import solve_problem
        s = solve_problem(p['model'])
        sol = s.get('solution') or s
        print(f"{name}: OK ans={str(sol.get('answer') or sol.get('answerText'))[:60]}")
    except Exception as e:
        print(f"{name}: FAIL {type(e).__name__}: {e}")

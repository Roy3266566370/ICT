import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.kernel_models import compile_kernel_problem
from app.labs.solvers import solve_problem

CASES = {
    'seq': ('sequence_limit', {'expression': 'n*(sqrt(n^2+1)-n)'}),
    'conv': ('series_convergence', {'term': '(-1)^n/n', 'index_start': '1'}),
    'rev': ('surface_of_revolution', {'expression': 'sqrt(x)', 'lower': '0', 'upper': '1', 'rotation_axis': 'x'}),
    'polarc': ('polar_arc_length', {'expression': '1+cos(theta)', 'lower': '0', 'upper': '2*pi'}),
    'study': ('function_study', {'expression': 'x^3-3*x', 'variable': 'x'}),
    'tay1': ('taylor', {'expression': 'exp(x)', 'point': '1', 'order': 3}),
    'cont': ('continuity', {'expression': 'x*sin(1/x)', 'variable': 'x', 'point': '0',
                            'value_mode': 'limit'}),
    'geo': ('geometric_area', {'expression': 'x', 'lower_expression': 'x^2', 'lower': '0',
                              'upper': '1', 'region_kind': 'between_curves'}),
    'voly': ('rotation_volume', {'expression': 'x^2', 'lower': '0', 'upper': '2',
                                 'region_kind': 'between_axis', 'rotation_axis': 'y'}),
    'int': ('antiderivative', {'expression': 'x^2*exp(x)'}),
    'lim': ('limit', {'expression': '(exp(x)-1-x)/x^2', 'point': '0', 'side': 'both'}),
    'dint': ('double_integral', {'integrand': 'x*y', 'outer_variable': 'x',
                                 'outer_bounds': ['0', '1'], 'inner_bounds': ['0', 'x']}),
}
for name, (task, cond) in CASES.items():
    try:
        p = compile_kernel_problem({'task': task, 'conditions': cond})
        s = solve_problem(p['model'])
        sol = s.get('solution') or s
        print(f"{name}: OK ans={str(sol.get('answer'))[:80]}")
    except Exception as e:
        print(f"{name}: FAIL {type(e).__name__}: {e}")

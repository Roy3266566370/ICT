import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.kernel_models import compile_kernel_problem
from app.labs.solvers import solve_problem

CASES = {
    'conv_a': ('series_convergence', {'term': '(-1)^n/n'}),
    'conv_b': ('series_convergence', {'term': '(-1)**n/n'}),
    'conv_c': ('series_convergence', {'term': '1/n^2'}),
    'tay1': ('taylor', {'expression': 'exp(x)', 'variable': 'x', 'point': '1', 'order': 3}),
    'cont': ('continuity', {'expression': 'x*sin(1/x)', 'variable': 'x', 'point': '0',
                            'value_mode': 'value', 'point_value': '0'}),
    'int': ('antiderivative', {'expression': 'x^2*exp(x)', 'variable': 'x'}),
    'lim': ('limit', {'expression': '(exp(x)-1-x)/x^2', 'variable': 'x', 'point': '0', 'side': 'both'}),
    'polarc': ('polar_arc_length', {'expression': 'exp(theta)', 'lower': '0', 'upper': '1'}),
}
for name, (task, cond) in CASES.items():
    try:
        p = compile_kernel_problem({'task': task, 'conditions': cond})
        s = solve_problem(p['model'])
        sol = s.get('solution') or s
        print(f"{name}: OK ans={str(sol.get('answer'))[:80]}")
    except Exception as e:
        print(f"{name}: FAIL {type(e).__name__}: {str(e)[:100]}")

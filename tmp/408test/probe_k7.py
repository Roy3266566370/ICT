# -*- coding: utf-8 -*-
import sys, json, traceback
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.kernel_models import compile_kernel_problem
from app.labs.recognize import _attach_solution

cases = [
    ('ratio',  'series_convergence', {'term': 'factorial(n)/n**n'}),
    ('root',   'series_convergence', {'term': '(n/(2*n+1))**n'}),
    ('leib',   'series_convergence', {'term': '(-1)**n/(n*log(n))'}),
    ('comp',   'series_convergence', {'term': 'n/(n**2+1)'}),
    ('p_log',  'series_convergence', {'term': '1/(n*log(n))'}),
    ('radius', 'power_series', {'goal': 'radius', 'coefficient': '1/n'}),
    ('psum',   'power_series', {'goal': 'sum', 'coefficient': 'n'}),
    ('pterm',  'power_series', {'goal': 'sum', 'coefficient': '1/(n*(n+1))'}),
    ('expand', 'power_series', {'goal': 'expand', 'expression': '1/(1-x)**2', 'order': 4}),
    ('ode_nh', 'ode', {'equation': "y'' - 3*y' + 2*y = exp(x)"}),
    ('ode_res','ode', {'equation': "y'' + y = sin(x)"}),
    ('ode_eu', 'ode', {'equation': "x**2*y'' + x*y' - y = 0"}),
    ('ode_3rd','ode', {'equation': "y''' - y'' = 0"}),
]
for k, task, cond in cases:
    try:
        p = compile_kernel_problem({'task': task, 'conditions': cond}, allow_unfinished=True)
        _attach_solution(p)
        sol = p.get('solution') or {}
        print(k, '=>', p['model'].get('engine'), '|', p.get('status'), '|', (sol.get('answer') or '')[:110])
        if not sol.get('answer'):
            print('   limits:', sol.get('limitations') or sol.get('summary'))
    except Exception as e:
        print(k, '=> FAIL', type(e).__name__, str(e)[:120])

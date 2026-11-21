import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem
from app.labs.solvers import solve_problem

t = '求函数f(x)=e^x在x=1处的3阶泰勒公式。（8分）'
p = build_problem(t)
m = p['model']
print('model:', {k: m.get(k) for k in ('engine','task','expression','variable','taylor_point','taylor_point_value','order','defaults')})
s = solve_problem(m)
for k, v in s.items():
    if k not in ('steps', 'conditions', 'limitations'):
        print(k, '=', str(v)[:120])

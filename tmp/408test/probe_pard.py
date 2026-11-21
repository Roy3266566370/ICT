import sys, re
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs import advanced_calc_text as adv
t = '设x=t^2,y=t^3，求在t=1处dy/dx的值（）'
print('gate:', bool(re.search(r'd\s*y\s*/\s*d\s*x|参数方程', t)))
print('pair:', adv._parametric_pair(t))
print('point:', re.search(r't\s*=\s*([-+]?\d+(?:\.\d+)?)', t))
print('builder:', adv._parametric_derivative(t, {}, {}))

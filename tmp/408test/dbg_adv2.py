import sys, re
sys.path.insert(0, '.')
from app.labs import advanced_calc_text as adv
from app.labs import parameter_limit as pl

t_triple = '1.计算三重积分∭_Ω (x+y+z)dxdydz，其中Ω为0<=x<=1,0<=y<=1,0<=z<=1。'
t_param = '6.已知lim(x→0)(x-sin(ax))/x^3=1/6，求参数a。'
t_lagr = '10.求f(x,y)=xy在约束x+y=1下的最大值。'

print('--- triple ---')
print('integrand re:', re.search(r'∭\s*[_^]?\s*[A-Za-zΩ_\s]*?\s*(.+?)\s*d\s*[xyz]\s*d\s*[xyz]\s*d\s*[xyz]', t_triple, flags=re.I | re.S))
for var in 'xyz':
    m = re.search(rf'([-+]?\d+(?:\.\d+)?)\s*[<≤]=?\s*{var}\s*[<≤]=?\s*([-+]?\d+(?:\.\d+)?)', t_triple)
    print(f'  {var}:', m.groups() if m else None)
print(' builder:', adv._triple_box(t_triple, {}, {}) is not None)

print('--- param ---')
print(' limit re:', pl._LIMIT_PATTERN.search(t_param))
parsed = pl._parse_limit(t_param)
print(' parsed:', parsed)
if parsed:
    variable, point, expression, target = parsed
    norm = pl._normalize_products(expression)
    print(' norm:', norm, '| param:', pl._parameter(norm, variable, t_param))
print(' build:', pl.build_parameter_limit_from_text(t_param, {}, {}) is not None)

print('--- lagrange ---')
print(' expr re:', re.search(r'f\s*\(\s*x\s*,\s*y\s*\)\s*=\s*([^，,。；;\n]+?)\s*(?:[,，。；;\n]|在|$)', t_lagr))
print(' cond re:', re.search(r'(?:约束条件?|满足条件?|条件)\s*[:：为]?\s*([^，,。；;\n]*=[^，,。；;\n]*)', t_lagr))
print(' builder:', adv._constrained_extrema(t_lagr, {}, {}) is not None)

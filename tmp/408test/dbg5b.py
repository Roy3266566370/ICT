import sys, re, traceback
sys.path.insert(0, r'E:\代码\ICT\backend')
import sympy as sp
from app.labs.expr import parse_expression, safe_float

try:
    f = parse_expression('x^2', ('x',))
    g = parse_expression('x', ('x',))
    print('types:', type(f), type(g))
    x = sp.Symbol('x')
    roots = sp.solve(sp.Eq(f, g), x)
    print('roots:', roots)
    print('floats:', [safe_float(r) for r in roots])
except Exception:
    traceback.print_exc()

raw = '计算二重积分∬_D xy dσ，其中D由y=x，y=0与x=1围成。（10分）'
raw = raw.replace('≤', '<=').replace('≥', '>=')
from app.labs.double_integral import _expression
region = re.search(r'D\s*由\s*([^。；;\n]+)', raw)
print('region:', region.group(1) if region else None)
enclosed = re.search(r'由\s*(.+?)\s*围成', raw)
print('enclosed:', enclosed.group(1) if enclosed else None)
edges = [v.strip() for v in re.split(r'[,，、]|\s*与\s*|\s*和\s*', enclosed.group(1)) if v.strip()]
print('edges:', edges)
try:
    f = _expression('x', ('x',))
    g = _expression('0', ('x',))
    meets = [float(r) for r in sp.solve(sp.Eq(f, g), sp.Symbol('x')) if r.is_real]
    print('meets:', meets)
except Exception:
    traceback.print_exc()

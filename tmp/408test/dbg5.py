import sys, re
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs import advanced_calc_text as adv
from app.labs.calculus_analysis import _parse_limit_text

t_seq = '求数列极限lim(n→∞)n(√(n^2+1)-n)。（8分）'
m = re.search(r'(?:lim|极限)\s*[_({]?\s*n\s*(?:->|→|to|趋于|趋近于)\s*(?:\+?∞|oo)\s*[)}]?\s*(.+)', t_seq, flags=re.I)
print('seq regex:', m.group(1) if m else None)
print('seq builder:', adv._sequence_limit(t_seq, {}, {}))

print('lim body:', _parse_limit_text('求极限lim(x→0)(e^x-1-x)/x^2。（6分）'))

t_geo = '求由抛物线y=x^2与直线y=x所围成图形的面积。（10分）'
print('geo pair:', re.search(r'y\s*=\s*([^，,。；;\n]+?)\s*与\s*(?:直线|抛物线|曲线)?\s*y\s*=\s*([^，,。；;\n]+?)\s*所?围', t_geo))
print('geo bounds:', adv._two_curve_bounds('x^2', 'x'))
print('geo builder:', adv._geometric_area(t_geo, {}, {}))

t_vol = '求由y=x^2，y=0与x=2围成图形绕y轴旋转一周所得旋转体的体积。（10分）'
print('vol expr:', re.search(r'y\s*=\s*([^，,。；;\n=0]+?)\s*(?:[,，。；;\n]|与|的|$)', t_vol))
print('vol builder:', adv._rotation_volume(t_vol, {}, {}))

t_cont = '设f(x)=x·sin(1/x)(x≠0)，f(0)=0，讨论f在x=0处的连续性。（8分）'
print('cont expr:', re.search(r'(?:f|y)\s*(?:\(\s*x\s*\))?\s*=\s*([^，,。；;\n]+?)\s*(?:[,，。；;\n]|的|$)', t_cont))
print('cont builder:', adv._continuity(t_cont, {}, {}))

t_dint = '计算二重积分∬_D xy dσ，其中D由y=x，y=0与x=1围成。（10分）'
from app.labs.double_integral import build_double_integral
p = build_double_integral(t_dint, {}, {})
print('dint model:', (p or {}).get('model'))
print('dint amb:', [a.get('message') for a in (p or {}).get('ambiguities') or []])

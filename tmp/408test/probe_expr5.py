import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem, classify_subject

for name, text in [
 ('seq', '求数列极限lim(n→∞)n(√(n^2+1)-n)。（8分）'),
 ('lim', '求极限lim(x→0)(e^x-1-x)/x^2。（6分）'),
 ('study', '讨论函数y=x^3-3x的单调性、极值、凹凸性与拐点。（12分）'),
 ('rev', '求曲线y=√x在[0,1]上绕x轴旋转所得旋转曲面的面积。（10分）'),
 ('multi', '（12分）设f(x)=x^3-3x。（1）求f的单调区间；（2）求f的极值。'),
]:
    p = build_problem(text)
    m = p['model']
    print(f"== {name}: engine={m.get('engine')} task={m.get('task') or m.get('kind')}")
    for k in ('expression', 'point', 'variable', 'kind', 'analysis_kind', 'lower_bound', 'upper_bound', 'rotation_axis'):
        if k in m:
            print(f'   {k}={m[k]!r}')
print('multi subject:', classify_subject('（12分）设f(x)=x^3-3x。（1）求f的单调区间；（2）求f的极值。'))

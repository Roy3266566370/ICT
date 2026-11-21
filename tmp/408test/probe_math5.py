import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem
from app.labs.solvers import solve_problem

CASES = {
 'seq': '求数列极限lim(n→∞)n(√(n^2+1)-n)。（8分）',
 'conv': '判别级数∑(-1)^n/n的敛散性。（8分）',
 'rev': '求曲线y=√x在[0,1]上绕x轴旋转所得旋转曲面的面积。（10分）',
 'polarc': '求对数螺线r=e^θ在0≤θ≤1上的弧长。（10分）',
 'study': '讨论函数y=x^3-3x的单调性、极值、凹凸性与拐点。（12分）',
 'tay1': '求函数f(x)=e^x在x=1处的3阶泰勒公式。（8分）',
 'cont': '设f(x)=x·sin(1/x)(x≠0)，f(0)=0，讨论f在x=0处的连续性。（8分）',
 'geo': '求由抛物线y=x^2与直线y=x所围成图形的面积。（10分）',
 'voly': '求由y=x^2，y=0与x=2所围图形绕y轴旋转一周所得旋转体的体积。（10分）',
 'int': '计算不定积分∫x^2·e^x dx。（6分）',
 'lim': '求极限lim(x→0)(e^x-1-x)/x^2。（6分）',
 'dint': '计算二重积分∬_D xy dσ，其中D由y=x，y=0与x=1围成。（10分）',
 'multi': '（12分）设f(x)=x^3-3x。（1）求f的单调区间；（2）求f的极值。',
}
for name, text in CASES.items():
    p = build_problem(text)
    m = p['model']
    try:
        s = solve_problem(m)
        ans = str((s.get('solution') or {}).get('answer') or s.get('answer'))[:58]
    except Exception as e:
        ans = f'ERR {e}'
    print(f"{name}: subj={p['subject']} eng={m.get('engine')} task={m.get('task') or m.get('kind')} st={p['status']} ans={ans}")

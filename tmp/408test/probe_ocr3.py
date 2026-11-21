import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem
from app.labs.solvers import solve_problem

NL = chr(10)
CASES = {
 'm3a_surf': '高等数学期末考试题曲面积分' + NL + '1.计算曲面积分口zdS，其中E为' + NL + '平面z=x+y在0≤x≤1，0≤y≤1上的部分（）。' + NL + 'A.1 B.√3 C.2√3 D.3',
 'm3c_gau': '高等数学期末考试题曲面积分' + NL + '3.利用高斯公式计算口_×dydz+y' + NL + 'dz dx+z dx dy，∑为正方体0≤x≤1，0≤y≤1,' + NL + '0≤Z≤1的表面外侧（）。A.1B.2C.3D.4',
 'm3d_stk': '高等数学期末考试题曲线积分' + NL + '4.利用斯托克斯公式计算f_「（-y)dx' + NL + '+x dy+z dz，「为平面z=1上正方形0≤x≤1,' + NL + '0≤y≤1的边界取上侧（）。A.0B.1C.2D.4',
 'm3h_ode': '高等数学期末考试题微分方程' + NL + '8.求微分方程y"-3y\'+2y=0的通解（）。' + NL + 'A.C1e^x+C2e^2x B.(C1+C2x)e^x',
 'm3k_uni': '高等数学期末考试题中值定理' + NL + '11.证明方程x^3+×-1=0在区间[0,1]' + NL + '内有唯一实根' + NL + 'A.正确 B.错误',
}
for name, text in CASES.items():
    p = build_problem(text)
    m = p['model']
    try:
        s = solve_problem(m)
        ans = str((s.get('solution') or {}).get('answer') or s.get('answer'))[:55]
    except Exception as e:
        ans = f'ERR {e}'
    print(f"{name}: subj={p['subject']} eng={m.get('engine')} task={m.get('task') or m.get('kind')} st={p['status']} ans={ans}")

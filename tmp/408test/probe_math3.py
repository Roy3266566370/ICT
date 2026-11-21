import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem
from app.labs.solvers import solve_problem

CASES = {
 'm1_surface': '计算曲面积分∬_Σ z dS，其中Σ为平面z=x+y在0≤x≤1，0≤y≤1上的部分',
 'm2_green': '利用格林公式计算∮_L (x^2-y)dx+(x+y^2)dy，L为圆周x^2+y^2=1取正向',
 'm3_gauss': '利用高斯公式计算∯_Σ x dy dz+y dz dx+z dx dy，Σ为正方体0≤x≤1，0≤y≤1，0≤z≤1的表面外侧',
 'm4_stokes': '利用斯托克斯公式计算∮_Γ (-y)dx+x dy+z dz，Γ为平面z=1上正方形0≤x≤1，0≤y≤1的边界取上侧',
 'm5_sum': '求幂级数∑n*x^n的和函数',
 'm6_dir': '求函数z=x^2+y^2在点(1,1)沿方向(3,4)的方向导数',
 'm7_ext': '求函数f(x,y)=x^2+y^2-2x-4y的极值',
 'm8_ode2': "求微分方程y''-3y'+2y=0的通解",
 'm9_mvt': 'f(x)=x^2在[1,2]上满足拉格朗日中值定理，求ξ',
 'm10_ivt': '证明方程x^3-4x+1=0在区间(0,1)内至少有一个实根',
 'm11_uni': '证明方程x^3+x-1=0在区间[0,1]内有唯一实根',
 'm12_cyl': '计算三重积分∭_Ω z dV，Ω由圆柱面x^2+y^2=1与平面z=0,z=1围成',
}
for name, text in CASES.items():
    p = build_problem(text)
    m = p['model']
    try:
        s = solve_problem(m)
        ans = str((s.get('solution') or {}).get('answer') or s.get('answer'))[:60]
    except Exception as e:
        ans = f'ERR {e}'
    print(f"{name}: eng={m.get('engine')} task={m.get('task') or m.get('kind')} st={p['status']} ans={ans}")

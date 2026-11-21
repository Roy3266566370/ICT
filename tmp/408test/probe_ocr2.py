import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem
from app.labs.solvers import solve_problem

CASES = {
 'mu1_tri': '计算三重积分口_Ω(x+y+z)dxdydz,其中为0≤x≤1,0≤y≤1,0≤≤1（）',
 'mu2_line': '计算曲线积分∫_L x dy + y dx,其中L为y=x~2从(0,0)到(1,1）（）',
 'mu3_pow': '求幂级数≥x^n/n的收敛半径（）',
 'mu5_spa': '求过点（1,2,3)且与平面2x+y-z=1平行的平面方程（）',
 'mu7_rol': '函数f(x)=x~2-4在[-2,2]上满足罗尔\n定理条件,则等于（）',
 'mu11_imp': '设y由方程x~2+y^2=4确定，则在点(V2,√2)处dy/dx=（）',
}
for name, text in CASES.items():
    p = build_problem(text)
    m = p['model']
    s = solve_problem(m)
    sol = s.get('solution') or {}
    ans = str(sol.get('answer'))[:70]
    print(f"{name}: subj={p['subject']} eng={m.get('engine')} task={m.get('task') or m.get('kind') or m.get('modeling_task')} st={p['status']} ans={ans}")

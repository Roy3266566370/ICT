import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem
from app.labs.solvers import solve_problem

CASES = {
 'sph': '计算三重积分∭_Ω dxdydz，Ω为球体x^2+y^2+z^2≤1（）',
 'flux': '计算曲面积分∬_Σ x dy dz+y dz dx+z dx dy，Σ为平面z=1在0≤x≤1，0≤y≤1部分的上侧（）',
 'ell': '利用格林公式计算∮_L (-y)dx+x dy，L为椭圆x^2/4+y^2=1取正向（）',
 'ode_ic': "求微分方程y'-y=0满足y(0)=2的特解（）",
 'par_d': '设x=t^2,y=t^3，求在t=1处dy/dx的值（）',
 'arc': '求曲线y=x^(3/2)在[0,4]上的弧长（）',
 'asy': '求函数y=(2x+1)/(x-1)的渐近线（）',
 'cur': '求曲线y=x^2在点(1,1)处的曲率（）',
 'leib': '设F(x)=∫_x^{x^2} t dt，求F\'(x)（）',
 'pol': '求曲线r=2cosθ所围图形的面积，θ∈[-π/2,π/2]（）',
 'hod': '设y=sin(2x)，求y的三阶导数（）',
 'nor': '求曲线x^2+y^2=4在点(√2,√2)处的法线方程（）',
 'parc': '求参数曲线x=cos t,y=sin t在0≤t≤2π上的弧长（）',
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

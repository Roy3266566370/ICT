import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem
from app.labs.solvers import solve_problem

CASES = {
 'sph': '高等数学期末考试题三重积分\n1.计算三重积分口_Ωdxdydz，Ω为球体\nx^2+y^2+z^2≤1（）。\nA.T B.4T/3 C.2π D.4π',
 'par': '高等数学期末考试题参数求导\n5.设x=t^2，y=t3，求在t=1处\ndy/dx的值（）。\nA.1 B.3/2 C.2 D.3',
 'leib': "高等数学期末考试题变限积分\n9.设F(x)=∫_x^{x~2} t dt,\n求F'(x)（）。\nA. 2x^3-x B.x~2 C.2x~3 D.X~3",
 'pol': '高等数学期末考试题积分应用\n10.求曲线r=2cos0所围图形的面积\nθ∈[-/2,π/2]（）。\nA.T/2 B.T C.2T D.4Tt',
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

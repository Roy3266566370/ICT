import sys
sys.path.insert(0, '.')
from app.labs.recognize import build_problem, _attach_solution, classify_subject
from app.labs.source_recovery import assess_text_quality
from app.labs.ode import build_ode_from_text

TEXTS = {
    'mt1': '1.求极限lim(x→0) sinx/x（）。\nA.0 B.1 C.2 D.不存在',
    'mt2': '2. 求极限lim(x→0)(1-cosx)/x^2（）。\nA.0 B.1/4 C.1/2 D. 1',
    'mt6': '6.计算定积分{_0^1x^2dx（）。\nA.1/4 B.1/3 C.1/2 D. 1',
    'mt8': '8.判别级数E1/n^2的收敛性（）。\nA.发散 B.条件收敛C.绝对收敛D.无法判定',
    'mt9': '9.求微分方程dy/dx=2y的通解（）。\nA. y=Ce^x B. y=Ce^2x C. y=2x+C D.y=x^2+C',
    'mt10': '10.计算二重积分」{D xy do，其中D为\n0≤x≤1，0≤y≤（）。\nA.1/8 B.1/4 C.1/2 D.1',
    'mt12': '12.计算广义积分∫_1^+∞∞1/x^2dx（）。\nA.发散 B.1 C.2 D.1/2',
}

for k, t in TEXTS.items():
    print('='*8, k, '='*8)
    q = assess_text_quality(t, [])
    print(' quality untrusted:', q['untrusted'], '| issues:', q.get('issues'))
    print(' classify:', classify_subject(t))
    if k == 'mt9':
        r = build_ode_from_text(t, {}, {})
        print(' ode build:', (r or {}).get('model', {}).get('engine') if r else None)
    p = build_problem(t)
    m = p.get('model') or {}
    _attach_solution(p)
    sol = p.get('solution') or {}
    print(' eng:', m.get('engine'), '| st:', p.get('status'),
          '| ans:', (sol.get('answer') or '')[:100])
    for a in ((p.get('recognition') or {}).get('ambiguities') or []):
        if a.get('severity') == 'blocking':
            print('   amb:', a.get('id'), str(a.get('question') or '')[:110])

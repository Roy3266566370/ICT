import sys
sys.path.insert(0, '.')
from app.labs.recognize import build_problem, _attach_solution

TEXTS = [
    '计算二重积分∫∫D xy dσ，其中D为0≤x≤1，0≤y≤1。',
    '计算二重积分∬_D xy dxdy，其中D={(x,y)|0≤x≤1，0≤y≤1}。',
    '计算∬D (x+y) dxdy，其中D为0≤x≤1，0≤y≤x。',
    '求函数f(x)=e^x的麦克劳林展开式，展开到4阶。',
]
for t in TEXTS:
    p = build_problem(t)
    m = p.get('model') or {}
    _attach_solution(p)
    sol = p.get('solution') or {}
    print('eng:', m.get('engine'), '| st:', p.get('status'),
          '| ans:', (sol.get('answer') or sol.get('headline') or '')[:120])
    for a in ((p.get('recognition') or {}).get('ambiguities') or []):
        if a.get('severity') == 'blocking':
            print('   amb:', a.get('id'), str(a.get('question') or '')[:110])

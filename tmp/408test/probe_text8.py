# -*- coding: utf-8 -*-
import sys, traceback
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem, _attach_solution

cases = {
    'ratio': '判断级数Σn!/n^n的敛散性。（8分）',
    'root':  '用根值判别法判断级数Σ(n/(2n+1))^n的敛散性。（8分）',
    'leib':  '判断级数Σ(-1)^n/(n lnn)（n=2起）的敛散性，是绝对收敛还是条件收敛？（8分）',
    'comp':  '判断级数Σn/(n^2+1)的敛散性。（6分）',
    'p_log': '判断级数Σ1/(n lnn)（n=2起）的敛散性。（8分）',
    'rad':   '求幂级数Σx^n/n的收敛半径与收敛区间，并判断端点敛散性。（8分）',
    'psum':  '求幂级数Σx^n/(n+1)的和函数。（10分）',
    'pexp':  '将函数f(x)=1/(1-x)^2展开为x的幂级数（到x^4项）。（8分）',
    'ode_nh':'求微分方程y″-3y′+2y=e^x的通解。（10分）',
    'ode_rz':'求微分方程y″+y=sinx的通解。（10分）',
    'ode_eu':'求欧拉方程x^2y″+xy′-y=0的通解。（8分）',
    'ode_3r':'求微分方程y‴-y″=0的通解。（8分）',
    'ode_iv':'求微分方程y″-y=0满足y(0)=1,y′(0)=0的特解。（8分）',
}
for k, t in cases.items():
    try:
        p = build_problem(t)
        _attach_solution(p)
        m, sol = p.get('model') or {}, p.get('solution') or {}
        print(k, '=>', p.get('subject'), m.get('engine'), '|', p.get('status'), '|', (sol.get('answer') or '')[:100])
        if not sol.get('answer'):
            for a in (p.get('recognition') or {}).get('ambiguities', []):
                if a.get('severity') == 'blocking':
                    print('   ambig:', (a.get('question') or '')[:90])
    except Exception as e:
        print(k, '=> FAIL', type(e).__name__, str(e)[:100])

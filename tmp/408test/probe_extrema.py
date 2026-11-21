# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem, _attach_solution

for t in [
    '求函数f(x)=x^3-3x的极值。（8分）',        # caret 写法
    '求函数f(x)=x3-3x的极值。（8分）',         # 平写上标（OCR 常见）
    '求函数f(x)=x³-3x的单调区间。（8分）',      # unicode ³ + 单调（function_study 旧路由）
    '求函数f(x)=x³-3x的极值。（8分）',          # unicode ³ + 极值（新路由）
    '求函数f(x)=x^3-3x的极值，并求单调区间。',   # 复合小问拆分后每问
]:
    p = build_problem(t)
    _attach_solution(p)
    m = p.get('model') or {}
    sol = p.get('solution') or {}
    print('=>', t[:40])
    print('   ', p.get('subject'), '->', m.get('engine'), '|', p.get('status'), '|', (sol.get('answer') or '')[:140])
    for a in (p.get('recognition') or {}).get('ambiguities', []):
        if a.get('severity') == 'blocking':
            print('    ambig:', (a.get('question') or '')[:90])

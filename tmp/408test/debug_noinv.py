# -*- coding: utf-8 -*-
import sys, json
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem, _attach_solution

for text in ['判断矩阵A=[[1,2],[2,4]]是否可逆。（8分）',
             '设A=[[1,2],[3,4]]，求3A。（6分）']:
    p = build_problem(text)
    _attach_solution(p)
    m = p['model']
    print('status:', p.get('status'), '| kind:', m.get('la_kind'), '| op:', m.get('op'))
    print('sol:', json.dumps(p.get('solution'), ensure_ascii=False)[:200])
    print('amb:', json.dumps(p.get('ambiguities') or p['recognition'].get('ambiguities'), ensure_ascii=False)[:250])
    print('---')

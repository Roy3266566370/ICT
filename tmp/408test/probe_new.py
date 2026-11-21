# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem, _attach_solution, _expand_subquestions

cases = {
    'eig_basic': '求矩阵A=[[2,1],[1,2]]的特征值与特征向量。（8分）',
    'eig_2x2':   '求矩阵A=[[4,1],[2,3]]的特征值。（8分）',
    'eig_bar':   '求矩阵|3 1;0 2|的特征值。（8分）',
    'eig_frac':  '求矩阵A=[[1/2,0],[0,2]]的特征值。（6分）',
    'eig_defec': '求矩阵A=[[1,1],[0,1]]的特征值。（8分）',
    'diag':      '判断矩阵A=[[2,1],[1,2]]是否可对角化。（8分）',
    'svd':       '求矩阵A=[[1,0],[0,2]]的奇异值分解。（8分）',
    'extrema':   '求函数f(x)=x³-3x的极值。（8分）',
}
for k, t in cases.items():
    p = build_problem(t)
    _attach_solution(p)
    m = p.get('model') or {}
    sol = p.get('solution') or {}
    print('='*16, k)
    print(' ', p.get('subject'), '->', m.get('engine'), '/', m.get('la_kind') or m.get('target_kind'), '|', p.get('status'))
    print('  ans:', (sol.get('answer') or '')[:160])
    for a in (p.get('recognition') or {}).get('ambiguities', []):
        print('  ambig:', a.get('id'), a.get('severity'), '->', (a.get('question') or '')[:80])

print()
print('--- subquestion split ---')
parts = _expand_subquestions([{'number':'5','text':'已知函数f(x)=x³-3x。\n(1)求f(x)的单调区间；(2)求f(x)的极值。','pages':[]}])
for part in parts:
    print('  num:', part.get('number'), '| text:', repr(part.get('text'))[:120])
parts2 = _expand_subquestions([{'number':'6','text':'（8分）已知f(x)=x²，求f(x)的单调区间并求f(x)的极值。','pages':[]}])
for part in parts2:
    print('  num:', part.get('number'), '| text:', repr(part.get('text'))[:120])

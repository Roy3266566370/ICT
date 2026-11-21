# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem, _attach_solution

texts = {
    'ser_leib': '判断级数Σ(-1)^n/(n ln n)（n=2起）的敛散性，是绝对收敛还是条件收敛？',
    'ser_plg': '判断级数1/(nInn）（n=2起）的敛散性。',
    'pw_sum': '求幂级数x^n/(n+1）的和函数。',
    'pw_exp': '将函数f(x)=1/(1-x)^2展开为x的幂级数（到x^4项）。',
    'ode_eul': '求欧拉方程x^2y"+xy\'-y=0 的通解。',
    'ode_3rd': '求微分方程y口-y"=0的通解。',
    'ode_iv': '求微分方程y"-y=0 满足y(0)=1,y\'(0)=0 的特解。',
    'eigen': '求矩阵A=[[2,1],[1,2]]的特征值与特征向量。',
    'det_bar': '计算行列式|1 2;3 4|。',
    'f_study': '求函数f(x)=x^3-3x的单调区间与极值。',
    'subq': '求函数f(x)=x^3-3x的单调区间，并求其极值。',
    'inv_gen': '利用反函数求导法则求y=arcsinx的导数。',
    'bad_expr': '求积分∫(0,1) x^p dx。',
}
for k, t in texts.items():
    p = build_problem(t, pages=[{'image_key': 'i', 'page': 1, 'file_id': 'f'}])
    _attach_solution(p)
    m, s = p.get('model') or {}, p.get('solution') or {}
    print(k, '=>', p.get('subject'), m.get('engine'), m.get('task') or m.get('kind'), '|', p.get('status'))
    print('   ans:', (s.get('answer') or '')[:90])
    for a in (p.get('recognition') or {}).get('ambiguities', []):
        if a.get('severity') == 'blocking':
            print('   blk:', a.get('id'), (a.get('question') or '')[:75])

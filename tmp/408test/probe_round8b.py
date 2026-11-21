# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem, _attach_solution

texts = {
    'fourier_x2': '将函数f(x)=x^2在[-π,π]上展开为傅里叶级数。',
    'fourier_x': '将函数f(x)=x在(-π,π)上展开为傅里叶级数。',
    'fourier_abs': '将函数f(x)=|x|在[-π,π]上展开为傅里叶级数。',
    'param_d': '设x=t-sint,y=1-cost，求t=π/2处dy/dx的值及切线斜率。',
    'param_d2': '设x=t^2,y=t^3，求d^2y/dx^2在t=1处的值。',
    'param_a': '设x=a(t-sint),y=a(1-cost)，求dy/dx。',
    'param_arc': '求摆线x=t-sint,y=1-cost一拱(0≤t≤2π)的弧长。',
    'polar_card': '求心形线r=1+cosθ所围图形的面积。',
    'polar_rose': '求三叶玫瑰线r=cos3θ一瓣(θ∈[-π/6,π/6])的面积。',
    'imp_paren': '计算反常积分∫(1,+∞) dx/x^2。',
    'imp_dx': '计算反常积分∫(0,1) dx/sqrt(1-x)。',
    'imp_p': '讨论反常积分∫(1,+∞) dx/x^p的敛散性。',
    'inv_d': '设f(x)=x^3+x，求其反函数在y=2处的导数。',
    'inv_gen': '利用反函数求导法则求y=arcsinx的导数。',
    # OCR 变体
    'ocr_brace': '计算反常积分{(1,+∞）dx/x^2。',
    'ocr_theta': '求三叶玫瑰线r=cos3θ一瓣(θE[-T/6,π/6]）的面积',
    'ocr_rose_ok': '求三叶玫瑰线r=cos3θ一瓣(θE[-π/6,π/6]）的面积',
}
for k, t in texts.items():
    p = build_problem(t, pages=[{'image_key': 'i', 'page': 1, 'file_id': 'f'}])
    _attach_solution(p)
    m, s = p.get('model') or {}, p.get('solution') or {}
    print(k, '=>', p.get('subject'), m.get('engine'), m.get('task') or m.get('kind'), '|', p.get('status'))
    print('   ans:', (s.get('answer') or '')[:95])
    for a in (p.get('recognition') or {}).get('ambiguities', []):
        if a.get('severity') == 'blocking':
            print('   blk:', a.get('id'), (a.get('question') or '')[:85])

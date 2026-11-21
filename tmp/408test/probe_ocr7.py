# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem, _attach_solution

texts = {
    'm7a_ocr': '线性代数期末试卷计算题\n1．（6分）计算行列式\n|12;34|的值\n解：',
    'm7c_ocr': '线性代数期末试卷计算题\n3.（8分）求行列式\n[2 1 0;1 2 1;0 1 2|的值。\n解：',
    'm7b_ocr': '线性代数期末试卷计算题\n2.（8分）计算三阶行列式\n|1 2 3;0 1 4;5 6 0|。\n解：',
}
for k, t in texts.items():
    p = build_problem(t)
    _attach_solution(p)
    sol = p.get('solution') or {}
    m = p.get('model') or {}
    print(k, '=>', m.get('la_kind'), '|', p.get('status'), '|', sol.get('answer'))
    if not sol.get('answer'):
        for a in (p.get('recognition') or {}).get('ambiguities', []):
            print('   ambig:', a.get('question')[:90])

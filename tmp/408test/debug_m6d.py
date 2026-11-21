# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import classify_subject, build_problem, _attach_solution

text = '高等数学期末试卷计算题\n4.（(8分）求点P(1,0,2)到直线\nx/1=y/1=z/0的距离。\n解：'
print('classify:', classify_subject(text))
p = build_problem(text)
print('subject:', p.get('subject'), '| engine:', (p.get('model') or {}).get('engine'))
_attach_solution(p)
print('ans:', (p.get('solution') or {}).get('answer'))

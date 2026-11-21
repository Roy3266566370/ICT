# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem, _attach_solution

text = '高等数学期末试卷计算题\n4.（(8分）求点P(1,0,2)到直线\nx/1=y/1=z/0的距离。\n解：'
p = build_problem(text, pages=[{'image_key': 'f1_p1', 'page': 1}])
_attach_solution(p)
print(p.get('status'), '|', (p.get('model') or {}).get('engine'), '|',
      (p.get('solution') or {}).get('answer'))

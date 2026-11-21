# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem, _attach_solution

p = build_problem('高等数学期末试卷计算题 4.（10分）求对数螺线r=e^θ 在0≤日≤1上的弧长 解：')
_attach_solution(p)
print(p['model']['engine'], p['model'].get('task'))
print((p.get('solution') or {}).get('answer'))

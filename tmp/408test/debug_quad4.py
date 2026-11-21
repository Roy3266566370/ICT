# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.goal_actions import classify_goal_action, unsupported_reason
from app.labs.recognize import build_problem

text = '指出二次曲面x^2/4+y^2/9-z^2=1的名称并说明其类型。（8分）'
p = build_problem(text)
print('action:', classify_goal_action(text))
print('boundary:', unsupported_reason(text, subject='calculus', model=p['model']))
print('teaching:', p['model'].get('teaching'))

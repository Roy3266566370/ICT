# -*- coding: utf-8 -*-
import sys, json
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem, model_coverage_issues

text = '指出二次曲面x^2/4+y^2/9-z^2=1的名称并说明其类型。（8分）'
p = build_problem(text)
print('status:', p.get('status'))
print('issues:', model_coverage_issues(text, p['model']))
print('amb:', json.dumps(p.get('ambiguities'), ensure_ascii=False)[:300])

# -*- coding: utf-8 -*-
import sys, json
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem, _attach_solution
from app.labs.advanced_calc_text import _space_geometry

text = '指出二次曲面x^2/4+y^2/9-z^2=1的名称并说明其类型。（8分）'
m = _space_geometry(text, {}, {})
print('builder:', json.dumps((m or {}).get('model', {}), ensure_ascii=False)[:300])
p = build_problem(text)
_attach_solution(p)
print('sol:', json.dumps(p.get('solution'), ensure_ascii=False)[:400])
print('amb:', json.dumps(p.get('ambiguities'), ensure_ascii=False)[:300])

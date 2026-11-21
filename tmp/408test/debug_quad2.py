# -*- coding: utf-8 -*-
import sys, json, traceback
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.advanced_calc_text import _space_geometry
from app.labs.space import solve_space_task

text = '指出二次曲面x^2/4+y^2/9-z^2=1的名称并说明其类型。（8分）'
m = _space_geometry(text, {}, {})['model']
try:
    r = solve_space_task(m)
    print('OK:', json.dumps(r, ensure_ascii=False)[:500])
except Exception:
    traceback.print_exc()

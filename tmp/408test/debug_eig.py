# -*- coding: utf-8 -*-
import sys, traceback
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem
try:
    p = build_problem('求矩阵A=[[2,1],[1,2]]的特征值。（8分）')
    print('ok', p.get('status'))
except Exception:
    traceback.print_exc()

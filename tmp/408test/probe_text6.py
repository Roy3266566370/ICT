# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem, _attach_solution, classify_subject

CASES = {
    'surf_tan': '求曲面z=x^2+y^2在点(1,1,2)处的切平面方程与法线方程。（10分）',
    'quadric':  '指出二次曲面x^2/4+y^2/9-z^2=1的名称并说明其类型。（8分）',
    'pt_plane': '求点P(1,2,3)到平面x+2y-2z+5=0的距离。（6分）',
    'pt_line':  '求点P(1,0,2)到直线x/1=y/1=z/0的距离。（8分）',
    'lp_int':   '求直线x-1=y=z与平面x+y+z=3的交点及夹角。（10分）',
    'pp_ang':   '求两平面x+y+z=1与x-y=0的夹角。（6分）',
    'lp_proj':  '求直线(x-1)/1=y/1=z/1在平面x+y+z=3上的投影方程。（10分）',
    'vec_ops':  '设a=(1,2,3)，b=(4,5,6)，求a·b、a×b及a与b的夹角。（8分）',
    'vec_prod': '设a=(1,0,0)，b=(0,1,0)，c=(0,0,1)，求以a,b,c为棱的平行六面体体积。（6分）',
    'line_pts': '求过点A(1,2,3)与B(4,5,6)的直线方程。（6分）',
    'line_pd':  '求过点(1,0,2)且方向向量为(3,-1,2)的直线方程。（6分）',
    'plane_3pt':'求过点(1,0,0)，(0,1,0)与(0,0,1)的平面方程。（8分）',
    'll_rel':   '判断直线x/1=y/0=z/0与x/0=y/1=z/0的位置关系。（8分）',
}

for name, text in CASES.items():
    try:
        subj = classify_subject(text)[0]
        p = build_problem(text)
        _attach_solution(p)
        m = p['model'] or {}
        ans = (p.get('solution') or {}).get('answer') or ''
        print(f'{name:10s} {subj:12s} {m.get("engine")}·{m.get("task")} :: {ans[:56]}')
    except Exception as e:
        print(f'{name:10s} FAIL {type(e).__name__} {str(e)[:80]}')

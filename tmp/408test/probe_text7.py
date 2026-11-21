# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.recognize import build_problem, _attach_solution, classify_subject

CASES = {
    # 行列式 2 阶
    'det2':    '计算行列式|1 2;3 4|的值。（6分）',
    # 行列式 3 阶
    'det3':    '计算三阶行列式|1 2 3;0 1 4;5 6 0|。（8分）',
    # 行列式展开
    'det_ex':  '求行列式|2 1 0;1 2 1;0 1 2|的值。（8分）',
    # 逆矩阵
    'inv':     '求矩阵A=[[1,2],[3,4]]的逆矩阵。（8分）',
    # 矩阵乘法
    'mul':     '设A=[[1,2],[3,4]]，B=[[5,6],[7,8]]，求A×B。（6分）',
    # 矩阵加法
    'add':     '设A=[[1,2],[3,4]]，B=[[5,6],[7,8]]，求A+B。（6分）',
    # 矩阵减法
    'sub':     '设A=[[1,2],[3,4]]，B=[[5,6],[7,8]]，求A-B。（6分）',
    # 数乘
    'scal':    '设A=[[1,2],[3,4]]，求3A。（6分）',
    # 线性方程组
    'sys':     '用高斯消元法解线性方程组x+y+z=6，x+2y+z=8，x+y+2z=9。（10分）',
    # 方程组 2 元
    'sys2':    '解线性方程组2x+y=5，x-y=1。（8分）',
    # 不可逆矩阵
    'noinv':   '判断矩阵A=[[1,2],[2,4]]是否可逆。（8分）',
    # AB 非方阵
    'mul_rect':'设A=[[1,2,3],[4,5,6]]，B=[[1,0],[0,1],[1,1]]，求AB。（8分）',
    # 特征值（内核暂无）
    'eig':     '求矩阵A=[[2,1],[1,2]]的特征值。（8分）',
}

for name, text in CASES.items():
    try:
        subj = classify_subject(text)[0]
        p = build_problem(text)
        _attach_solution(p)
        m = p['model'] or {}
        ans = (p.get('solution') or {}).get('answer') or ''
        print(f'{name:9s} {subj:14s} {m.get("engine")}·{m.get("task") or m.get("kind")} :: {ans[:52]}')
    except Exception as e:
        print(f'{name:9s} FAIL {type(e).__name__} {str(e)[:80]}')

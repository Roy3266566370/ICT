# -*- coding: utf-8 -*-
block = '''

def test_round7b_series_and_ode_text_routes():
    from app.labs.recognize import build_problem, _attach_solution

    cases = [
        # 起始指标 `（n=2起）` → index_start=2；`lnn` 黏连 → ln(n)
        ('判断级数Σ(-1)^n/(n lnn)（n=2起）的敛散性，是绝对收敛还是条件收敛？（8分）',
         'series_v1', '条件收敛'),
        ('判断级数Σ1/(n lnn)（n=2起）的敛散性。（8分）', 'series_v1', '发散'),
        # 幂级数 expand 目标此前完全没有文本路由
        ('将函数f(x)=1/(1-x)^2展开为x的幂级数（到x^4项）。（8分）', 'power_series_v1', '5*x^4'),
        # 欧拉方程：`欧拉`缺学科关键词 + `x^2y''` 系数紧邻撇号需补乘号
        ('求欧拉方程x^2y″+xy′-y=0的通解。（8分）', 'ode_v1', 'C1/x'),
        # `y‴` 三阶撇号字符归一
        ('求微分方程y‴-y″=0的通解。（8分）', 'ode_v1', 'C3'),
        # `y′(0)=0` 撇号初值此前不匹配 IC 正则 → 静默丢第二个条件
        ('求微分方程y″-y=0满足y(0)=1,y′(0)=0的特解。（8分）', 'ode_v1', 'exp(x)/2'),
    ]
    for text, engine, expected in cases:
        p = build_problem(text)
        _attach_solution(p)
        assert p['model'].get('engine') == engine, (text, p['model'].get('engine'))
        assert expected in (p['solution'].get('answer') or ''), (text, p['solution'].get('answer'))


def test_round7b_ode_double_ic_verified():
    """两个初值条件都要提取并核验，不能只代入一条。"""
    from app.labs.recognize import build_problem, _attach_solution
    p = build_problem('求微分方程y″-y=0满足y(0)=1,y′(0)=0的特解。（8分）')
    _attach_solution(p)
    sol = p['solution']
    assert 'exp(x)/2' in sol.get('answer', '')          # cosh x = (e^x+e^-x)/2
    assert sol.get('initial_conditions_verified') is True
'''
open(r'E:\代码\ICT\backend\tests\test_labs_p5_space.py', 'a', encoding='utf-8').write(block)
print('appended')

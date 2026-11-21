# -*- coding: utf-8 -*-
path = r'E:\代码\ICT\backend\tests\test_labs_p5_space.py'
block = '''

def test_round5_big_questions():
    from app.labs.recognize import build_problem, _attach_solution

    # 数列极限（此前 analysis 极限把表达式错抓成 n 答"发散"）
    p = build_problem('求数列极限lim(n→∞)n(√(n^2+1)-n)。（8分）')
    _attach_solution(p)
    assert p['model']['task'] == 'sequence_limit'
    assert '1/2' in p['solution']['answer']

    # 旋转曲面面积（此前被当成"曲线下面积"算 2/3）
    p = build_problem('求曲线y=√x在[0,1]上绕x轴旋转所得旋转曲面的面积。（10分）')
    _attach_solution(p)
    assert p['model']['task'] == 'surface_of_revolution'
    assert 'sqrt(5)' in p['solution']['answer']

    # 极坐标弧长
    p = build_problem('求对数螺线r=e^θ在0≤θ≤1上的弧长。（10分）')
    _attach_solution(p)
    assert p['model']['task'] == 'polar_arc_length'
    assert 'sqrt(2)' in p['solution']['answer']

    # 连续性（f(0)=0 显式定义）
    p = build_problem('设f(x)=x·sin(1/x)(x≠0)，f(0)=0，讨论f在x=0处的连续性。（8分）')
    _attach_solution(p)
    assert '连续' in p['solution']['answer']


def test_round5_enclosed_regions():
    from app.labs.recognize import build_problem, _attach_solution

    # 两曲线围成面积（交点自动求界，中点比大小定下曲线）
    p = build_problem('求由抛物线y=x^2与直线y=x所围成图形的面积。（10分）')
    _attach_solution(p)
    assert p['model']['task'] == 'geometric_area'
    assert p['solution']['answer'] == '面积 = 1/6'

    # 绕 y 轴旋转体（y=f 与 y=0 单交点 + x=b 合成界）
    p = build_problem('求由y=x^2，y=0与x=2围成图形绕y轴旋转一周所得旋转体的体积。（10分）')
    _attach_solution(p)
    assert p['model']['task'] == 'area_volume'
    assert p['solution']['answer'] == '旋转体积 = 8*pi'

    # 三角形域二重积分（"D由y=x，y=0与x=1围成"边界枚举）
    p = build_problem('计算二重积分∬_D xy dσ，其中D由y=x，y=0与x=1围成。（10分）')
    _attach_solution(p)
    assert p['model']['task'] == 'double_integral'
    assert p['solution']['answer'] == '1/8'


def test_round5_analysis_repairs():
    from app.labs.recognize import build_problem, _attach_solution, classify_subject

    # 分值括号"（6分）"与√归一——此前表达式解析失败静默回退成 x，答出错误极限 0
    p = build_problem('求极限lim(x→0)(e^x-1-x)/x^2。（6分）')
    _attach_solution(p)
    assert p['model']['task'] == 'limit'
    assert p['model']['expression'] != 'x'
    assert '1/2' in p['solution']['answer']

    # y= 无括号形式此前抓不到表达式，function_study 报"无极值"
    p = build_problem('讨论函数y=x^3-3x的单调性、极值、凹凸性与拐点。（12分）')
    _attach_solution(p)
    assert p['model']['task'] == 'function_study'
    assert '极大值' in p['solution']['answer']

    # 非零展开点：taylor_point 浮点 1.0 曾使双侧极限浮点残差≠0 误报导数不存在
    p = build_problem('求函数f(x)=e^x在x=1处的3阶泰勒公式。（8分）')
    _attach_solution(p)
    assert p['model']['task'] == 'taylor'
    assert '(x - 1)^3' in p['solution']['answer']

    # 「单调区间+极值」性态综合大题应归 calculus（function_study 覆盖全部小问）
    assert classify_subject('（12分）设f(x)=x^3-3x。（1）求f的单调区间；（2）求f的极值。')[0] == 'calculus'
'''
with open(path, 'a', encoding='utf-8') as f:
    f.write(block)
print('appended')

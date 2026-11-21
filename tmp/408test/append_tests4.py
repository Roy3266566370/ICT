# -*- coding: utf-8 -*-
path = r'E:\代码\ICT\backend\tests\test_labs_p5_space.py'
block = '''

def test_round4_spherical_flux_ellipse():
    from app.labs.recognize import build_problem, _attach_solution

    # 球面坐标三重积分
    p = build_problem('计算三重积分∭_Ω dxdydz，Ω为球体x^2+y^2+z^2≤1（）')
    _attach_solution(p)
    assert p['model']['task'] == 'triple_integral'
    assert p['model']['typed_conditions']['region']['kind'] == 'spherical'
    assert p['solution']['answer'] == '4*pi/3'

    # 图形面通量积分（非闭合、上侧）
    p = build_problem('计算曲面积分∬_Σ x dy dz+y dz dx+z dx dy，Σ为平面z=1在0≤x≤1，0≤y≤1部分的上侧（）')
    _attach_solution(p)
    assert p['model']['task'] == 'surface_integral'
    assert p['solution']['answer'] == '1'

    # 椭圆域格林公式
    p = build_problem('利用格林公式计算∮_L (-y)dx+x dy，L为椭圆x^2/4+y^2=1取正向（）')
    _attach_solution(p)
    assert p['model']['task'] == 'green'
    assert p['solution']['answer'] == '4*pi'


def test_round4_parametric_arc_curvature():
    from app.labs.recognize import build_problem, _attach_solution

    # 参数方程求导（中文"设"紧邻 x 无 ASCII 词边界）
    p = build_problem('设x=t^2,y=t^3，求在t=1处dy/dx的值（）')
    _attach_solution(p)
    assert p['model']['task'] == 'parametric_derivative'
    assert '3*t/2' in p['solution']['answer']

    # 参数曲线弧长（y= 表达式须在"在"前截断，0≤t≤2π 端点含 2π）
    p = build_problem('求参数曲线x=cos t,y=sin t在0≤t≤2π上的弧长（）')
    _attach_solution(p)
    assert p['model']['task'] == 'parametric_arc_length'
    assert p['solution']['answer'] == '弧长 = 2*pi'

    # 显式弧长
    p = build_problem('求曲线y=x^(3/2)在[0,4]上的弧长（）')
    _attach_solution(p)
    assert p['model']['task'] == 'arc_length'
    assert 'sqrt(10)' in p['solution']['answer']

    # 曲率
    p = build_problem('求曲线y=x^2在点(1,1)处的曲率（）')
    _attach_solution(p)
    assert p['model']['task'] == 'curvature'
    assert 'sqrt(5)' in p['solution']['answer']


def test_round4_asymptote_higher_implicit_normal():
    from app.labs.recognize import build_problem, _attach_solution

    # 有理函数渐近线（此前 function_study 抓错表达式报"无渐近线"）
    p = build_problem('求函数y=(2x+1)/(x-1)的渐近线（）')
    _attach_solution(p)
    assert p['model']['task'] == 'asymptote'
    assert 'x=1' in p['solution']['answer'] and 'y=2' in p['solution']['answer']

    # 高阶导数（y= 左端须剥除，三阶→order=3）
    p = build_problem('设y=sin(2x)，求y的三阶导数（）')
    _attach_solution(p)
    assert p['model']['task'] == 'higher_derivative'
    assert '-8*cos(2*x)' in p['solution']['answer']

    # 隐函数法线：坐标对 (√2,√2) 直接提供 point_y，不触发分支歧义
    p = build_problem('求曲线x^2+y^2=4在点(√2,√2)处的法线方程（）')
    _attach_solution(p)
    assert p['model']['task'] == 'implicit_normal'
    assert p['solution']['answer'] == '法线斜率 1'


def test_round4_polar_leibniz_ode():
    from app.labs.recognize import build_problem, _attach_solution

    # 极坐标面积
    p = build_problem('求曲线r=2cosθ所围图形的面积，θ∈[-π/2,π/2]（）')
    _attach_solution(p)
    assert p['model']['task'] == 'polar_area'
    assert p['solution']['answer'] == '极坐标面积 = pi'

    # 双变限 Leibniz（上界 {x^2} 须按花括号整取，^2 不得并入被积函数）
    p = build_problem("设F(x)=∫_x^{x^2} t dt，求F'(x)（）")
    _attach_solution(p)
    assert p['model']['task'] == 'integral_function'
    assert p['solution']['answer'] == "F'(x)=2*x^3 - x"

    # 一阶 ODE 初值特解
    p = build_problem("求微分方程y'-y=0满足y(0)=2的特解（）")
    _attach_solution(p)
    assert p['model']['task'] == 'ode'
    assert '2*exp(x)' in p['solution']['answer']
'''
with open(path, 'a', encoding='utf-8') as f:
    f.write(block)
print('appended')

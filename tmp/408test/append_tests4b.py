# -*- coding: utf-8 -*-
path = r'E:\代码\ICT\backend\tests\test_labs_p5_space.py'
block = '''

def test_ocr_variants_round4():
    from app.labs.recognize import build_problem, _attach_solution
    NL = chr(10)

    # ∭→口、Ωdxdydz 连写（dxdydz 不得并入被积函数）
    p = build_problem('计算三重积分口_Ωdxdydz，Ω为球体' + NL + 'x^2+y^2+z^2≤1（）')
    _attach_solution(p)
    assert p['model']['task'] == 'triple_integral'
    assert p['model']['conditions']['integrand'] == '1'
    assert p['solution']['answer'] == '4*pi/3'

    # 参数式上标抹平：y=t3 → t^3
    p = build_problem('设x=t^2，y=t3，求在t=1处' + NL + 'dy/dx的值（）')
    _attach_solution(p)
    assert p['model']['task'] == 'parametric_derivative'
    assert '3*t/2' in p['solution']['answer']

    # 花括号界内 ~ 代 ^：∫_x^{x~2}
    p = build_problem("设F(x)=∫_x^{x~2} t dt，求F'(x)（）")
    _attach_solution(p)
    assert p['model']['task'] == 'integral_function'
    assert p['model']['conditions']['upper_expression'] == 'x^2'

    # θ→0（cos0→cos(θ)）、-π/2→-/2（π 丢失按端点位置补回）
    p = build_problem('求曲线r=2cos0所围图形的面积' + NL + 'θ∈[-/2,π/2]（）')
    _attach_solution(p)
    assert p['model']['task'] == 'polar_area'
    assert p['solution']['answer'] == '极坐标面积 = pi'
'''
with open(path, 'a', encoding='utf-8') as f:
    f.write(block)
print('appended')

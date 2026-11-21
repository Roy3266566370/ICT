content = '''

def test_text_route_surface_green_gauss_stokes():
    from app.labs.recognize import build_problem, _attach_solution

    p = build_problem('计算曲面积分∬_Σ z dS，其中Σ为平面z=x+y在0≤x≤1，0≤y≤1上的部分')
    _attach_solution(p)
    assert p['model']['task'] == 'surface_integral'
    assert p['solution']['answer'] == 'sqrt(3)'

    p = build_problem('利用格林公式计算∮_L (x^2-y)dx+(x+y^2)dy，L为圆周x^2+y^2=1取正向')
    _attach_solution(p)
    assert p['model']['task'] == 'green'
    assert p['solution']['answer'] == '2*pi'

    p = build_problem('利用高斯公式计算∯_Σ x dy dz+y dz dx+z dx dy，Σ为正方体0≤x≤1，0≤y≤1，0≤z≤1的表面外侧')
    _attach_solution(p)
    assert p['model']['task'] == 'gauss'
    assert p['solution']['answer'] == '3'

    p = build_problem('利用斯托克斯公式计算∮_Γ (-y)dx+x dy+z dz，Γ为平面z=1上正方形0≤x≤1，0≤y≤1的边界取上侧')
    _attach_solution(p)
    assert p['model']['task'] == 'stokes'
    assert p['solution']['answer'] == '2'


def test_text_route_directional_unconstrained_cylindrical():
    from app.labs.recognize import build_problem, _attach_solution

    p = build_problem('求函数z=x^2+y^2在点(1,1)沿方向(3,4)的方向导数')
    _attach_solution(p)
    assert p['model']['task'] == 'multivariable'
    assert p['model']['conditions']['operation'] == 'directional'
    assert '14/5' in p['solution']['answer']

    p = build_problem('求函数f(x,y)=x^2+y^2-2x-4y的极值')
    _attach_solution(p)
    assert p['model']['task'] == 'multivariable_extrema'
    assert '-5' in p['solution']['answer']

    p = build_problem('计算三重积分∭_Ω z dV，Ω由圆柱面x^2+y^2=1与平面z=0,z=1围成')
    _attach_solution(p)
    assert p['model']['task'] == 'triple_integral'
    assert p['solution']['answer'] == 'pi/2'


def test_proof_open_interval_and_real_root():
    from app.labs.recognize import build_problem

    # 开区间 (0,1) 与“实根”关键词——此前只认 [a,b] 与“有根/零点”
    p = build_problem('证明方程x^3-4x+1=0在区间(0,1)内至少有一个实根')
    assert p['model']['task'] == 'proof'
    assert p['model']['proof_kind'] == 'ivt_root'

    p = build_problem('证明方程x^3+x-1=0在区间[0,1]内有唯一实根')
    assert p['model']['task'] == 'proof'
    assert p['model']['proof_kind'] == 'ivt_unique_root'


def test_subject_classification_calculus_vs_physics_algorithm():
    from app.labs.recognize import classify_subject

    # “高斯公式”是微积分（散度定理），裸“高斯”才是物理（高斯定理/面）。
    assert classify_subject('利用高斯公式计算∯_Σ x dy dz+y dz dx+z dx dy')[0] == 'calculus'
    assert classify_subject('利用高斯定理求均匀带电球面产生的电场强度分布')[0] == 'physics'
    # “边界”含“边”（图的边）曾劫持到 algorithm——calculus 分更高时应归微积分。
    assert classify_subject('利用斯托克斯公式计算∮_Γ (-y)dx+x dy+z dz，Γ为平面z=1上边界取上侧')[0] == 'calculus'
'''
with open(r'E:\代码\ICT\backend\tests\test_labs_p5_space.py', 'a', encoding='utf8') as f:
    f.write(content)
print('appended')

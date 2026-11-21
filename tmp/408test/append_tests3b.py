content = '''

def test_ocr_variants_round3():
    from app.labs.recognize import build_problem, _attach_solution
    NL = chr(10)

    # ∬_Σ→口E、dS 黏连
    p = build_problem('计算曲面积分口zdS，其中E为' + NL + '平面z=x+y在0≤x≤1，0≤y≤1上的部分（）')
    _attach_solution(p)
    assert p['model']['task'] == 'surface_integral'
    assert p['solution']['answer'] == 'sqrt(3)'

    # ∯_Σ x→口_×、Z 大写界、Σ→∑
    p = build_problem('利用高斯公式计算口_×dydz+y' + NL + 'dz dx+z dx dy，∑为正方体0≤x≤1，0≤y≤1,0≤Z≤1的表面外侧（）')
    _attach_solution(p)
    assert p['model']['task'] == 'gauss'
    assert p['solution']['answer'] == '3'

    # ∮_Γ→f_「、全角（
    p = build_problem('利用斯托克斯公式计算f_「（-y)dx' + NL + '+x dy+z dz，「为平面z=1上正方形0≤x≤1,0≤y≤1的边界取上侧（）')
    _attach_solution(p)
    assert p['model']['task'] == 'stokes'
    assert p['solution']['answer'] == '2'

    # y''→y"（OCR 双引号）
    p = build_problem("求微分方程y\\"-3y'+2y=0的通解")
    _attach_solution(p)
    assert p['model']['task'] == 'ode'
    assert 'exp(x)' in p['solution']['answer']

    # x→×（方程内孤立乘号即 x 的 OCR 形）
    p = build_problem('证明方程x^3+×-1=0在区间[0,1]内有唯一实根')
    _attach_solution(p)
    assert p['model']['task'] == 'proof'
    assert p['model']['proof_kind'] == 'ivt_unique_root'
'''
with open(r'E:\代码\ICT\backend\tests\test_labs_p5_space.py', 'a', encoding='utf8') as f:
    f.write(content)
print('appended')

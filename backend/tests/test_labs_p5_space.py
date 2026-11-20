"""P5 regressions: triple/line/surface integrals, Green/Gauss/Stokes and geometry."""
from __future__ import annotations

import json
import math

import pytest

from app.labs.ai_solve import compute_plan


def plan(task: str, **conditions):
    return compute_plan({'kind': 'kernel', 'task': task, 'conditions': conditions})


def test_triple_integral_box_cylinder_and_spherical():
    box = plan('triple_integral', integrand='1', region={
        'kind': 'box', 'x': ['0', '1'], 'y': ['0', '1'], 'z': ['0', '1']})
    assert box['answer'] == '1'

    cylinder = plan('triple_integral', integrand='1', region={
        'kind': 'cylindrical', 'theta': ['0', '2*pi'], 'r': ['0', '1'], 'z': ['0', '1']})
    assert cylinder['answer'] == 'pi'

    sphere = plan('triple_integral', integrand='1', region={
        'kind': 'spherical', 'theta': ['0', '2*pi'], 'phi': ['0', 'pi'], 'rho': ['0', '1']})
    assert sphere['answer'] == '4*pi/3'


def test_triple_integral_z_simple_region():
    result = plan('triple_integral', integrand='1', region={
        'kind': 'z_simple', 'x': ['0', '1'], 'y': ['0', 'x'], 'z': ['0', '1']})
    assert result['answer'] == '1/2'


def test_line_integral_scalar_and_vector():
    scalar = plan('line_integral', curve=['t', 't', 't'], t_bounds=['0', '1'], kind='scalar', field='1')
    assert float(__import__('sympy').sympify(scalar['answer'])) == pytest.approx(math.sqrt(3))
    vector = plan('line_integral', curve=['t', 't', 't'], t_bounds=['0', '1'], kind='vector', field=['y', 'z', 'x'])
    assert vector['answer'] == '3/2'


def test_surface_integral_scalar_area_and_flux():
    area = plan('surface_integral', surface=['u', 'v', '0'], uv_bounds=[['0', '1'], ['0', '1']],
                kind='scalar', field='1')
    assert area['answer'] == '1'
    flux = plan('surface_integral', surface=['u', 'v', '0'], uv_bounds=[['0', '1'], ['0', '1']],
                kind='flux', field=['0', '0', '1'])
    assert flux['answer'] == '1'


def test_green_gauss_and_stokes_two_path_verification():
    green = plan('green', field=['-y', 'x'], region={'x': ['0', '1'], 'y': ['0', '1']})
    assert green['answer'] == '2'
    gauss = plan('gauss', field=['x', 'y', 'z'], region={
        'kind': 'box', 'x': ['0', '1'], 'y': ['0', '1'], 'z': ['0', '1']})
    assert gauss['answer'] == '3'
    stokes = plan('stokes', field=['-y', 'x', '0'], surface_z='0', region={'x': ['0', '1'], 'y': ['0', '1']})
    assert stokes['answer'] == '2'


def test_space_geometry_distances_intersection_and_angle():
    point_plane = plan('space_geometry', geometry_kind='point_plane_distance',
                       point=['0', '0', '0'], plane=['1', '0', '0', '-2'])
    assert point_plane['answer'] == '点到平面距离 2'

    point_line = plan('space_geometry', geometry_kind='point_line_distance',
                      point=['0', '1', '0'], line_point=['0', '0', '0'], line_direction=['1', '0', '0'])
    assert point_line['answer'] == '点到直线距离 1'

    hit = plan('space_geometry', geometry_kind='line_plane_intersection',
               line_point=['0', '0', '0'], line_direction=['0', '0', '1'], plane=['0', '0', '1', '-2'])
    assert '交点' in hit['answer']

    angle = plan('space_geometry', geometry_kind='plane_plane_angle',
                 plane=['1', '0', '0', '0'], plane2=['0', '1', '0', '0'])
    assert '夹角' in angle['answer']


def test_invalid_space_dimensions_are_rejected():
    with pytest.raises(ValueError):
        plan('line_integral', curve=['t'], t_bounds=['0', '1'], kind='scalar', field='1')
    with pytest.raises(ValueError):
        plan('gauss', field=['x', 'y'], region={'kind': 'box', 'x': ['0', '1'], 'y': ['0', '1'], 'z': ['0', '1']})
    with pytest.raises(ValueError):
        plan('surface_integral', surface=['u', 'v', '0'], uv_bounds=[['1', '0'], ['0', '1']],
             kind='scalar', field='1')


def test_p5_results_are_json_serializable_and_have_space_data():
    result = plan('green', field=['-y', 'x'], region={'x': ['0', '1'], 'y': ['0', '1']})
    json.dumps(result, ensure_ascii=False, allow_nan=False)
    assert result['interactive_solution']['space']['curves']
    assert not any(check['status'] == 'fail' for check in result['checks'])

def test_text_route_triple_box_space_plane_and_line_integral():
    """第二轮：进阶题型文本路由——∭ 长方体、点法式平面、无括号 dy 在前曲线积分。"""
    from app.labs.recognize import build_problem, _attach_solution

    p = build_problem('1.计算三重积分∭_Ω (x+y+z)dxdydz，其中Ω为0<=x<=1,0<=y<=1,0<=z<=1。')
    _attach_solution(p)
    assert p['model']['task'] == 'triple_integral'
    assert p['status'] == 'ready'
    assert p['solution']['answer'] == '3/2'

    p = build_problem('5.求过点(1,2,3)且与平面2x+y-z=1平行的平面方程。')
    _attach_solution(p)
    assert p['model']['task'] == 'space_geometry'
    assert p['status'] == 'ready'
    assert '2*x + y - z - 1' in p['solution']['answer']

    p = build_problem('2.计算曲线积分∫_L x dy + y dx，其中L为y=x^2从(0,0)到(1,1)。')
    _attach_solution(p)
    assert p['model']['task'] == 'line_integral'
    assert p['status'] == 'ready'
    assert p['solution']['answer'] == '1'


def test_text_route_multivariable_and_constrained_extrema():
    from app.labs.recognize import build_problem, _attach_solution

    p = build_problem('8.设z=x^2y+y^3，求偏导数∂z/∂x。')
    _attach_solution(p)
    assert p['model']['task'] == 'multivariable'
    assert p['status'] == 'ready'
    assert '2*x*y' in p['solution']['answer']

    p = build_problem('10.求f(x,y)=xy在约束x+y=1下的最大值。')
    _attach_solution(p)
    assert p['model']['task'] == 'multivariable_extrema'
    assert p['status'] == 'ready'
    assert '1/4' in p['solution']['answer']


def test_text_route_integral_function():
    from app.labs.recognize import build_problem, _attach_solution
    p = build_problem("11.设F(x)=∫_0^x t^2 dt，求F'(2)。")
    _attach_solution(p)
    assert p['model']['task'] == 'integral_function'
    assert p['status'] == 'ready'
    assert '4' in p['solution']['answer']


def test_ocr_variants_round2():
    from app.labs.recognize import build_problem, _attach_solution

    # ∭→口 字形 + z 界标签丢失按位置补位
    p = build_problem('1.计算三重积分口_Ω(x+y+z)dxdydz,其中为0≤x≤1,0≤y≤1,0≤≤1（）')
    _attach_solution(p)
    assert p['model']['task'] == 'triple_integral'
    assert p['solution']['answer'] == '3/2'

    # 全角括号 + ~→^ 幂号
    p = build_problem('2.计算曲线积分∫_L x dy + y dx,其中L为y=x~2从(0,0)到(1,1）（）')
    _attach_solution(p)
    assert p['model']['task'] == 'line_integral'
    assert p['solution']['answer'] == '1'

    # ∑→≥(归一为>=)的幂级数
    p = build_problem('3.求幂级数≥x^n/n的收敛半径（）')
    _attach_solution(p)
    assert p['model']['task'] == 'power_series'
    assert '1' in p['solution']['answer']

    # 全角左括号点坐标
    p = build_problem('5.求过点（1,2,3)且与平面2x+y-z=1平行的平面方程（）')
    _attach_solution(p)
    assert p['model']['task'] == 'space_geometry'
    assert '2*x + y - z - 1' in p['solution']['answer']

    # ~→^ 且「罗尔\n定理」断行
    p = build_problem('7.函数f(x)=x~2-4在[-2,2]上满足罗尔' + chr(10) + '定理条件,则ξ等于（）')
    _attach_solution(p)
    assert p['model']['task'] == 'proof'

    # ~→^ + √→V 点坐标
    p = build_problem('11.设y由方程x~2+y^2=4确定,则在点(V2,√2)处dy/dx=（）')
    _attach_solution(p)
    assert p['model']['task'] == 'implicit_derivative'
    assert '-1' in p['solution']['answer']


def test_ocr_line_integral_segment_not_swallowed_by_options():
    from app.labs.recognize import build_problem, _attach_solution
    # 真实OCR全文：标题行+题号+选项行——微分式段必须取「曲线积分」之后而非最后换行之后。
    text = ('高等数学期末考试题曲线积分' + chr(10)
            + '2.计算曲线积分∫_L x dy + y dx,' + chr(10)
            + '其中L为y=x~2从(0,0)到(1,1）（）。' + chr(10)
            + 'A.1/2 B.1 C.3/2 D.2')
    p = build_problem(text)
    _attach_solution(p)
    assert p['model']['task'] == 'line_integral'
    assert p['solution']['answer'] == '1'


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
    assert p['model']['typed_conditions']['operation'] == 'directional'
    assert '14/5' in p['solution']['answer']

    # 二元无约束极值保持 optimization 契约——gradient_descent 给出同一精确答案。
    p = build_problem('求函数f(x,y)=x^2+y^2-2x-4y的极值')
    _attach_solution(p)
    assert p['subject'] == 'optimization'
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
    p = build_problem("求微分方程y\"-3y'+2y=0的通解")
    _attach_solution(p)
    assert p['model']['task'] == 'ode'
    assert 'exp(x)' in p['solution']['answer']

    # x→×（方程内孤立乘号即 x 的 OCR 形）
    p = build_problem('证明方程x^3+×-1=0在区间[0,1]内有唯一实根')
    _attach_solution(p)
    assert p['model']['task'] == 'proof'
    assert p['model']['proof_kind'] == 'ivt_unique_root'


def test_round4_spherical_flux_ellipse():
    from app.labs.recognize import build_problem, _attach_solution

    # 球面坐标三重积分
    p = build_problem('计算三重积分∭_Ω dxdydz，Ω为球体x^2+y^2+z^2≤1（）')
    _attach_solution(p)
    assert p['model']['task'] == 'triple_integral'
    assert p['model']['conditions']['region']['kind'] == 'spherical'
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
    assert p['model']['upper_expression'] == 'x**2'

    # θ→0（cos0→cos(θ)）、-π/2→-/2（π 丢失按端点位置补回）
    p = build_problem('求曲线r=2cos0所围图形的面积' + NL + 'θ∈[-/2,π/2]（）')
    _attach_solution(p)
    assert p['model']['task'] == 'polar_area'
    assert p['solution']['answer'] == '极坐标面积 = pi'


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


def test_round5_ocr_theta_as_ri():
    from app.labs.recognize import build_problem, _attach_solution
    # OCR 把 θ 读成「日」：0≤日≤1
    p = build_problem('求对数螺线r=e^θ在0≤日≤1上的弧长。（10分）')
    _attach_solution(p)
    assert p['model']['task'] == 'polar_arc_length'
    assert 'sqrt(2)' in p['solution']['answer']


def test_round6_space_geometry():
    from app.labs.recognize import build_problem, _attach_solution

    cases = [
        # 曲面切平面与法线
        ('求曲面z=x^2+y^2在点(1,1,2)处的切平面方程与法线方程。（10分）',
         '切平面 2*x + 2*y - z - 2 = 0'),
        # 二次曲面识别（指出/说明概念措辞但内核直接分类）
        ('指出二次曲面x^2/4+y^2/9-z^2=1的名称并说明其类型。（8分）', '单叶双曲面'),
        # 点到平面距离
        ('求点P(1,2,3)到平面x+2y-2z+5=0的距离。（6分）', '点到平面距离 4/3'),
        # 点到直线距离（对称式直线解析）
        ('求点P(1,0,2)到直线x/1=y/1=z/0的距离。（8分）', '3*sqrt(2)/2'),
        # 直线与平面交点（隐式分母1的连等式）
        ('求直线x-1=y=z与平面x+y+z=3的交点及夹角。（10分）', '交点 (5/3, 2/3, 2/3)'),
        # 两平面夹角（第二平面无前缀）
        ('求两平面x+y+z=1与x-y=0的夹角。（6分）', '夹角 pi/2'),
        # 直线在平面上的投影
        ('求直线(x-1)/1=y/1=z/1在平面x+y+z=3上的投影方程。（10分）', '投影'),
    ]
    for text, expected in cases:
        p = build_problem(text)
        _attach_solution(p)
        assert p['model']['engine'] == 'space_v1', (text, p['model'].get('engine'))
        assert p['model']['task'] == 'space_geometry'
        assert expected in p['solution']['answer'], (text, p['solution'].get('answer'))


def test_round6_space_geometry_vectors():
    from app.labs.recognize import build_problem, _attach_solution

    cases = [
        # 向量运算
        ('设a=(1,2,3)，b=(4,5,6)，求a·b、a×b及a与b的夹角。（8分）', 'a·b=32'),
        # 向量积与体积
        ('设a=(1,0,0)，b=(0,1,0)，c=(0,0,1)，求以a,b,c为棱的平行六面体体积。（6分）', '体积 1/6'),
        # 两点确定直线
        ('求过点A(1,2,3)与B(4,5,6)的直线方程。（6分）', '方向向量 (3, 3, 3)'),
        # 点向式直线
        ('求过点(1,0,2)且方向向量为(3,-1,2)的直线方程。（6分）', '方向向量 (3, -1, 2)'),
        # 三点确定平面
        ('求过点(1,0,0)，(0,1,0)与(0,0,1)的平面方程。（8分）', 'x + y + z - 1 = 0'),
        # 两直线位置关系
        ('判断直线x/1=y/0=z/0与x/0=y/1=z/0的位置关系。（8分）', '相交'),
    ]
    for text, expected in cases:
        p = build_problem(text)
        _attach_solution(p)
        assert p['model']['engine'] == 'space_v1', (text, p['model'].get('engine'))
        assert expected in p['solution']['answer'], (text, p['solution'].get('answer'))


def test_round6_ocr_doubled_open_paren():
    # OCR 把 "（8分）" 读成 "（(8分）"：双左括号只多开一个，按重叠容错。
    from app.labs.source_recovery import assess_text_quality, transcription_issues
    assert transcription_issues('求点P(1,0,2)到直线x/1=y/1=z/0的距离。（(8分）') == []
    # 合法嵌套 ((x+y)) 不受影响；真缺右括号仍报缺。
    assert transcription_issues('f(x)=((x+y))*z') == []
    assert '公式圆括号不完整' in transcription_issues('f(x)=(x+y*z')
    quality = assess_text_quality(
        '求点P(1,0,2)到直线x/1=y/1=z/0的距离。（(8分）', [{'image_key': 'p1'}])
    assert quality['untrusted'] is False


def test_round7_linalg_kinds():
    from app.labs.recognize import build_problem, _attach_solution

    cases = [
        # `|a b;c d|` 行列式竖线记法此前不解析矩阵 → 落 determinant 但 matrix_a 缺失
        ('计算行列式|1 2;3 4|的值。（6分）', 'determinant', 'det(A) = -2'),
        ('计算三阶行列式|1 2 3;0 1 4;5 6 0|。（8分）', 'determinant', 'det(A) = 1'),
        ('求行列式|2 1 0;1 2 1;0 1 2|的值。（8分）', 'determinant', 'det(A) = 4'),
        # 奇异矩阵行列式：det=0 是合法答案，之前直接抛"矩阵奇异"
        ('判断矩阵A=[[1,2],[2,4]]是否可逆。（8分）', 'determinant', 'det(A) = 0'),
        # 数乘：无"数乘/倍"字样的 `3A` 此前误判为乘法缺 B
        ('设A=[[1,2],[3,4]]，求3A。（6分）', 'matmul', 'kA = [3, 6; 9, 12]'),
        # 非方阵乘法
        ('设A=[[1,2,3],[4,5,6]]，B=[[1,0],[0,1],[1,1]]，求AB。（8分）', 'matmul', 'A·B = [4, 5; 10, 11]'),
    ]
    for text, kind, expected in cases:
        p = build_problem(text)
        _attach_solution(p)
        assert p['model'].get('la_kind') == kind, (text, p['model'].get('la_kind'))
        assert expected in (p['solution'].get('answer') or ''), (text, p['solution'].get('answer'))


def test_round7_linalg_eigen_exact_solution():
    from app.labs.recognize import build_problem, _attach_solution
    p = build_problem('求矩阵A=[[2,1],[1,2]]的特征值。（8分）')
    _attach_solution(p)
    assert p['model'].get('la_kind') == 'eigen'
    assert p['status'] == 'ready'
    assert {item['value'] for item in p['solution']['eigenvalues']} == {'1', '3'}
    assert all(check['status'] == 'pass' for check in p['solution']['checks'])
    assert 'det(A)' not in p['solution']['answer']


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

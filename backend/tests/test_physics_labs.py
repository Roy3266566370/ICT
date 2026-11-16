"""大学物理第一批：模板识别、确定性求解与核对。"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from app.labs.physics import evaluate_physics
from app.labs.recognize import _attach_solution, build_problem, classify_subject

CATALOG_PATH = Path(__file__).resolve().parents[2] / 'frontend' / 'src' / 'labs' / 'manualPhysics.json'
CATALOG = json.loads(CATALOG_PATH.read_text(encoding='utf-8'))
CASES = [
    (type_item['id'], type_item['mode'], type_item['template'])
    for group in CATALOG['groups']
    for type_item in group['types']
]


def _problem(text: str):
    problem = build_problem(text)
    _attach_solution(problem)
    return problem


@pytest.mark.parametrize('type_id, mode, text', CASES, ids=[item[0] for item in CASES])
def test_physics_manual_template_hits_kernel(type_id: str, mode: str, text: str) -> None:
    problem = _problem(text)
    assert problem['subject'] == 'physics', type_id
    assert problem['status'] == 'ready', type_id
    assert problem['model'].get('physics_mode') == mode, type_id
    assert problem['solution'].get('answer'), type_id
    result = evaluate_physics(problem['model'], problem['model'].get('defaults') or {})
    assert result['status'] == 'ok'
    assert result['checks']


def test_physics_templates_classify_without_subject_hint() -> None:
    for _, _, text in CASES:
        assert classify_subject(text)[0] == 'physics', text


def test_uniform_acceleration_numbers() -> None:
    result = evaluate_physics({
        'physics_mode': 'uniform_accel', 'physics_kind': 'kinematics',
        'defaults': {'v0': 2, 'a': 3, 't': 4, 'g': 9.8},
    }, {})
    assert result['answer_value'] == pytest.approx(14.0)
    assert result['scene']['x'] == pytest.approx(32.0)


def test_projectiles_energy_and_momentum_numbers() -> None:
    projectile = evaluate_physics({
        'physics_mode': 'projectile_h', 'physics_kind': 'kinematics',
        'defaults': {'v0': 10, 'h': 20, 'g': 9.8},
    }, {})
    assert projectile['answer_value'] == pytest.approx(10 * math.sqrt(40 / 9.8))
    incline = evaluate_physics({
        'physics_mode': 'incline', 'physics_kind': 'newton',
        'defaults': {'m': 2, 'angle': 30, 'mu': 0.2, 'g': 9.8},
    }, {})
    assert incline['scene']['acceleration'] == pytest.approx(9.8 * (0.5 - 0.2 * math.cos(math.pi / 6)))
    atwood = evaluate_physics({
        'physics_mode': 'atwood', 'physics_kind': 'newton',
        'defaults': {'m1': 1, 'm2': 3, 'g': 9.8},
    }, {})
    assert atwood['scene']['a'] == pytest.approx(4.9)
    assert atwood['scene']['T'] == pytest.approx(14.7)
    circular = evaluate_physics({
        'physics_mode': 'circular', 'physics_kind': 'newton',
        'defaults': {'m': 0.5, 'v': 4, 'r': 2, 'g': 9.8},
    }, {})
    assert circular['scene']['a'] == pytest.approx(8)
    assert circular['scene']['F'] == pytest.approx(4)


def test_work_and_collision_checks() -> None:
    work = evaluate_physics({
        'physics_mode': 'work_energy', 'physics_kind': 'work_energy',
        'defaults': {'m': 2, 'F': 10, 's': 5, 'v0': 0, 'g': 9.8},
    }, {})
    assert work['scene']['W'] == pytest.approx(50)
    assert work['scene']['v'] == pytest.approx(math.sqrt(50))
    elastic = evaluate_physics({
        'physics_mode': 'elastic', 'physics_kind': 'momentum',
        'defaults': {'m1': 2, 'v1': 3, 'm2': 1, 'v2': 0, 'g': 9.8},
    }, {})
    assert elastic['scene']['v1p'] == pytest.approx(1)
    assert elastic['scene']['v2p'] == pytest.approx(4)
    inelastic = evaluate_physics({
        'physics_mode': 'inelastic', 'physics_kind': 'momentum',
        'defaults': {'m1': 2, 'v1': 3, 'm2': 1, 'v2': 0, 'g': 9.8},
    }, {})
    assert inelastic['scene']['vp'] == pytest.approx(2)
    assert inelastic['scene']['loss'] == pytest.approx(3)


def test_oscillation_period_and_energy() -> None:
    spring = evaluate_physics({
        'physics_mode': 'spring_osc', 'physics_kind': 'oscillation',
        'defaults': {'m': 0.5, 'k': 50, 'A': 0.1, 'g': 9.8},
    }, {})
    assert spring['scene']['T'] == pytest.approx(2 * math.pi * math.sqrt(0.5 / 50))
    assert spring['scene']['energy'] == pytest.approx(0.25)
    pendulum = evaluate_physics({
        'physics_mode': 'pendulum', 'physics_kind': 'oscillation',
        'defaults': {'L': 1, 'theta0': 5, 'g': 9.8, 'm': 1},
    }, {})
    assert pendulum['scene']['T'] == pytest.approx(2 * math.pi * math.sqrt(1 / 9.8))
    shm = evaluate_physics({
        'physics_mode': 'shm', 'physics_kind': 'oscillation',
        'defaults': {'A': 0.2, 'T': 2, 'phi': 0, 't': 0.5, 'm': 1, 'g': 9.8},
    }, {})
    assert shm['scene']['x'] == pytest.approx(0, abs=1e-12)
    assert shm['scene']['v'] == pytest.approx(-0.2 * math.pi)


def test_physics_missing_conditions_block() -> None:
    problem = _problem('物体沿斜面下滑，求加速度。')
    assert problem['subject'] == 'physics'
    assert problem['status'] == 'needs_review'
    assert problem['solution']['answer'] == ''
    assert problem['recognition']['ambiguities']


def test_physics_attempt_accepts_any_key_result() -> None:
    from app.labs.assistant import check_attempt
    problem = _problem('质量 m=1 kg 的小球从高度 h=5 m 处由静止滑下光滑轨道，g=9.8 m/s^2，求到达底端的速度。')
    assert problem['solution']['answer_values']
    assert check_attempt(problem, {}, answer='9.8995')['correct']
    assert check_attempt(problem, {}, answer='49')['correct']
    assert not check_attempt(problem, {}, answer='123')['correct']


def test_common_high_school_units_are_normalized() -> None:
    projectile = _problem('小球以 v0=36 km/h 水平抛出，初始高度 h=20 m，g=9.8 m/s^2，求射程。')
    assert projectile['subject'] == 'physics'
    assert projectile['model']['defaults']['v0'] == pytest.approx(10.0)
    incline = _problem('物块质量 m=200 g，沿倾角 θ=30° 的斜面下滑，动摩擦因数 μ=0.2，g=9.8 m/s^2，求加速度。')
    assert incline['model']['defaults']['m'] == pytest.approx(0.2)


def test_second_batch_key_numbers() -> None:
    from app.labs.physics import evaluate_physics
    rotation = _problem('质量 m=2 kg、半径 r=0.5 m 的匀质圆盘绕中心轴转动，转动惯量系数 c=0.5；力矩 τ=4 N·m，初始角速度 ω0=0，经过 t=3 s，求角动量。')
    assert rotation['model']['defaults']['m'] == 2
    assert evaluate_physics(rotation['model'], rotation['model']['defaults'])['scene']['I'] == pytest.approx(0.25)

    wave = _problem('一列简谐横波振幅 A=0.05 m，波长 λ=2 m，频率 f=5 Hz，初相 φ=0，x1=0.2 m，x2=0.7 m，求波速和相位差。')
    wave_result = evaluate_physics(wave['model'], wave['model']['defaults'])
    assert wave_result['scene']['v'] == pytest.approx(10)
    assert wave_result['scene']['phase'] == pytest.approx(math.pi / 2)

    coulomb = _problem('点电荷 q1=2e-6 C 位于 x=0，q2=-1e-6 C 位于 x=0.3 m，求库仑力；P 点 x=0.1 m 处的电场和电势。')
    coulomb_result = evaluate_physics(coulomb['model'], coulomb['model']['defaults'])
    assert coulomb_result['scene']['F'] == pytest.approx(8.99e9 * 2e-12 / 0.09, rel=1e-3)

    gauss = _problem('半径 R=0.1 m 的均匀带电球壳总电荷 Q=1e-6 C，求距球心 r=0.05 m 处的电场强度和电势。')
    gauss_result = evaluate_physics(gauss['model'], gauss['model']['defaults'])
    assert gauss_result['scene']['inside'] is True
    assert gauss_result['scene']['E'] == 0

    capacitor = _problem('电容 C1=2 μF、C2=3 μF 串联接在 U=12 V 电源上，求等效电容、电荷和电压。')
    capacitor_result = evaluate_physics(capacitor['model'], capacitor['model']['defaults'])
    assert capacitor_result['scene']['Ceq'] == pytest.approx(1.2)
    assert capacitor_result['scene']['Q'] == pytest.approx(14.4)

    rc = _problem('RC 充电电路：R=1000 Ω，C=100 μF，电源 E=12 V，求时间常数和 t=0.2 s 时的电荷与电流。')
    rc_result = evaluate_physics(rc['model'], rc['model']['defaults'])
    assert rc_result['scene']['tau'] == pytest.approx(0.1)
    assert rc_result['scene']['q'] == pytest.approx(1200 * (1 - math.exp(-2)), rel=1e-3)


def test_second_batch_induction_thermo_and_attempt() -> None:
    from app.labs.assistant import check_attempt
    from app.labs.physics import evaluate_physics
    faraday = _problem('面积 A=0.2 m² 的线圈处在磁场中，磁感应强度在 Δt=0.5 s 内从 B1=0.1 T 均匀增加到 B2=0.5 T，线圈 N=100 匝，电阻 R=10 Ω，求感应电动势和电流。')
    faraday_result = evaluate_physics(faraday['model'], faraday['model']['defaults'])
    assert faraday_result['scene']['emf'] == pytest.approx(16)
    assert faraday_result['scene']['I'] == pytest.approx(1.6)

    rail = _problem('导体棒长 L=0.5 m 在 B=0.4 T 的匀强磁场中以 v=2 m/s 垂直切割磁感线，回路电阻 R=0.5 Ω，求感应电动势和机械功率。')
    rail_result = evaluate_physics(rail['model'], rail['model']['defaults'])
    assert rail_result['scene']['emf'] == pytest.approx(0.4)
    assert rail_result['scene']['P'] == pytest.approx(0.32)

    thermo = _problem('1 mol 理想气体在 T1=300 K 下等温膨胀，初体积 V1=0.02 m^3，末体积 V2=0.04 m^3，求做功和内能变化。')
    thermo_result = evaluate_physics(thermo['model'], thermo['model']['defaults'])
    assert thermo_result['scene']['dU'] == pytest.approx(0, abs=1e-9)
    assert thermo_result['scene']['W'] == pytest.approx(8.314 * 300 * math.log(2), rel=1e-6)

    carnot = _problem('卡诺热机高温热源 Th=600 K，低温热源 Tc=300 K，每循环吸热 Qh=1000 J，求效率、做功和放热。')
    carnot_result = evaluate_physics(carnot['model'], carnot['model']['defaults'])
    assert carnot_result['scene']['eta'] == pytest.approx(0.5)
    assert check_attempt(carnot, {}, answer='50')['correct']


def test_third_batch_wave_optics_numbers() -> None:
    double = _problem('双缝干涉实验中，双缝间距 d=0.2 mm，双缝到屏的距离 D=1.0 m，入射光波长 λ=600 nm，求相邻明条纹间距。')
    double_result = evaluate_physics(double['model'], double['model']['defaults'])
    assert double_result['scene']['spacing'] == pytest.approx(0.003)
    soap = _problem('肥皂薄膜的折射率 n=1.33，厚度 d=225 nm，用波长 λ=600 nm 的光垂直照射，判断反射光是加强还是减弱。')
    soap_result = evaluate_physics(soap['model'], soap['model']['defaults'])
    assert soap_result['scene']['dark'] is True
    coating = _problem('在折射率 n_g=1.5 的玻璃表面镀一层折射率 n=1.38 的增透膜，要使波长 λ=550 nm 的光反射最小，求增透膜的最小厚度。')
    coating_result = evaluate_physics(coating['model'], coating['model']['defaults'])
    assert coating_result['scene']['d'] == pytest.approx(550e-9 / (4 * 1.38))
    slit = _problem('单缝衍射实验中，单缝宽度 a=0.10 mm，入射光波长 λ=600 nm，透镜焦距 f=1.0 m，求中央明纹宽度和第一级暗纹位置。')
    slit_result = evaluate_physics(slit['model'], slit['model']['defaults'])
    assert slit_result['scene']['width'] == pytest.approx(0.012)
    grating = _problem('光栅每毫米有 500 条刻痕，用波长 λ=600 nm 的光垂直照射，求第一级明纹的衍射角和该光栅能观察到的最高级次。')
    grating_result = evaluate_physics(grating['model'], grating['model']['defaults'])
    assert grating_result['scene']['theta'] == pytest.approx(math.degrees(math.asin(0.3)))
    assert grating_result['scene']['maxOrder'] == 3
    polarization = _problem('强度为 I0=10 W/m^2 的自然光通过两个偏振化方向夹角 θ=60° 的偏振片，求通过每个偏振片后的光强。')
    polarization_result = evaluate_physics(polarization['model'], polarization['model']['defaults'])
    assert polarization_result['scene']['I1'] == pytest.approx(5.0)
    assert polarization_result['scene']['I2'] == pytest.approx(1.25)
    assert polarization_result['scene']['brewster'] == pytest.approx(math.degrees(math.atan(1.5)))


def test_third_batch_geometric_optics_numbers() -> None:
    refractive = _problem('光从空气射入折射率 n=1.5 的玻璃中，入射角 θ1=45°，求折射角；并求光从玻璃射向空气时的临界角。')
    refracted = evaluate_physics(refractive['model'], refractive['model']['defaults'])
    assert refracted['scene']['angle2'] == pytest.approx(math.degrees(math.asin(math.sin(math.pi / 4) / 1.5)))
    assert refracted['scene']['critical'] == pytest.approx(math.degrees(math.asin(1 / 1.5)))
    total = _problem('光从折射率 n1=1.5 的玻璃射向空气，入射角 θ1=50°，判断是否发生全反射，并求临界角。')
    total_result = evaluate_physics(total['model'], total['model']['defaults'])
    assert total_result['scene']['tir'] is True
    convex = _problem('凸透镜焦距 f=10 cm，物体放在距透镜 u=30 cm 处，求像距和放大率，并说明像的虚实。')
    convex_result = evaluate_physics(convex['model'], convex['model']['defaults'])
    assert convex_result['scene']['v'] == pytest.approx(0.15)
    assert convex_result['scene']['m'] == pytest.approx(-0.5)
    assert convex_result['scene']['real'] is True
    concave = _problem('凹透镜焦距 f=15 cm，物体放在距透镜 u=20 cm 处，求像距和放大率，并说明像的虚实。')
    concave_result = evaluate_physics(concave['model'], concave['model']['defaults'])
    assert concave_result['scene']['v'] == pytest.approx(0.2 * -0.15 / 0.35)
    assert concave_result['scene']['real'] is False


def test_third_batch_modern_physics_numbers() -> None:
    photoelectric = _problem('用波长 λ=400 nm 的光照射逸出功 W=2.2 eV 的金属，求光电子的最大初动能、遏止电压和截止波长。')
    photo_result = evaluate_physics(photoelectric['model'], photoelectric['model']['defaults'])
    assert photo_result['scene']['Ek'] == pytest.approx(0.8996, abs=1e-3)
    assert photo_result['scene']['Ua'] == pytest.approx(0.8996, abs=1e-3)
    assert photo_result['scene']['lam0'] == pytest.approx(5.636e-7, rel=1e-3)
    electron = _problem('电子经电压 U=100 V 加速后，求电子的德布罗意波长。')
    electron_result = evaluate_physics(electron['model'], electron['model']['defaults'])
    assert electron_result['scene']['lam'] == pytest.approx(1.226e-10, rel=1e-2)
    macro = _problem('质量 m=0.01 kg 的小球以速度 v=10 m/s 运动，求小球的德布罗意波长。')
    macro_result = evaluate_physics(macro['model'], macro['model']['defaults'])
    assert macro_result['scene']['lam'] == pytest.approx(6.626e-33, rel=1e-2)
    transition = _problem('氢原子中的电子从 n=3 能级跃迁到 n=2 能级，求释放光子的能量和波长。')
    transition_result = evaluate_physics(transition['model'], transition['model']['defaults'])
    assert transition_result['scene']['deltaE'] == pytest.approx(1.8889, abs=1e-3)
    assert transition_result['scene']['lam'] == pytest.approx(6.564e-7, rel=1e-3)
    spectrum = _problem('一群处于 n=4 激发态的氢原子向低能级跃迁，最多能发出多少种谱线？其中最短波长是多少？')
    spectrum_result = evaluate_physics(spectrum['model'], spectrum['model']['defaults'])
    assert spectrum_result['scene']['lines'] == 6
    assert spectrum_result['scene']['shortest'] == pytest.approx(9.724e-8, rel=1e-2)
    decay = _problem('某放射性同位素的半衰期 T=5 天，原有 N0=1.0×10^20 个原子核，经过 t=15 天，求剩余原子核数和剩余比例。')
    decay_result = evaluate_physics(decay['model'], decay['model']['defaults'])
    assert decay_result['scene']['N'] == pytest.approx(1.25e19, rel=1e-9)
    assert decay_result['scene']['fraction'] == pytest.approx(0.125)


def test_third_batch_missing_conditions_block() -> None:
    problem = _problem('用波长为 500 nm 的光照射金属，求遏止电压。')
    assert problem['subject'] == 'physics'
    assert problem['status'] == 'needs_review'
    assert problem['solution']['answer'] == ''
    assert problem['recognition']['ambiguities']


def test_third_batch_attempt_accepts_key_results() -> None:
    from app.labs.assistant import check_attempt
    photoelectric = _problem('用波长 λ=400 nm 的光照射逸出功 W=2.2 eV 的金属，求光电子的最大初动能、遏止电压和截止波长。')
    assert check_attempt(photoelectric, {}, answer='0.8996')['correct']
    double = _problem('双缝干涉实验中，双缝间距 d=0.2 mm，双缝到屏的距离 D=1.0 m，入射光波长 λ=600 nm，求相邻明条纹间距。')
    assert check_attempt(double, {}, answer='0.003')['correct']
    assert not check_attempt(double, {}, answer='123')['correct']

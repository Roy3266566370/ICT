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


def test_physics_review_overrides_recompute_and_flags_hidden() -> None:
    from app.labs.recognize import rebuild_problem
    problem = _problem('一物体做匀变速直线运动，初速度 v0=2 m/s，加速度 a=3 m/s^2，经过 t=4 s，求末速度和位移。')
    rebuilt = rebuild_problem(problem, files=[], condition_values={'phy_a': 5})
    _attach_solution(rebuilt)
    assert rebuilt['solution']['answer_value'] == pytest.approx(22.0)
    assert next(c for c in rebuilt['recognition']['conditions'] if c['id'] == 'phy_a')['provenance'] == 'student_confirmed'
    cap = _problem('电容 C1=2 μF、C2=3 μF 串联接在 U=12 V 电源上，求等效电容、每个电容器的电荷和电压。')
    flags = {c['id']: c['editable'] for c in cap['recognition']['conditions']}
    assert flags['phy_series'] is False and flags['phy_C1'] is True


def test_free_fall_colloquial_phrasing_and_velocity_answer() -> None:
    """真题常用"自由落下"而非"自由下落"；问速度时 answer_value 应取 v 而非 t。"""
    problem = _problem('一个物体从高度h=10m处自由落下，忽略空气阻力，取g=9.8m/s²，求落地时的速度大小。')
    assert problem['model']['physics_mode'] == 'free_fall'
    assert problem['solution']['answer_value'] == pytest.approx(14.0)
    timed = _problem('一个物体从高度h=10m处自由落下，忽略空气阻力，取g=9.8m/s²，求落地时间。')
    assert timed['solution']['answer_value'] == pytest.approx(math.sqrt(20 / 9.8))


def test_lorentz_scientific_notation_and_reversed_speed_label() -> None:
    """"1.6×10^-19C"科学计数、"电荷量"标签与"以N的速度"反序写法均可解析。"""
    problem = _problem(
        '一电荷量为1.6×10^-19C、质量为9.1×10^-31kg的带电粒子，'
        '以1.0×10^7m/s的速度垂直射入磁感应强度为1.0×10^-3T的匀强磁场中，求轨道半径。')
    assert problem['model']['physics_mode'] == 'lorentz'
    defaults = problem['model']['defaults']
    assert defaults['m'] == pytest.approx(9.1e-31) and defaults['q'] == pytest.approx(1.6e-19)
    assert defaults['B'] == pytest.approx(1e-3) and defaults['v'] == pytest.approx(1e7)
    assert problem['solution']['answer_value'] == pytest.approx(9.1e-31 * 1e7 / (1.6e-19 * 1e-3), rel=1e-6)


def test_double_slit_screen_gap_label() -> None:
    """"缝屏间距"是缝到屏距离的常见表述。"""
    problem = _problem('在杨氏双缝干涉实验中，入射光波长为500nm，双缝间距为0.2mm，'
                       '缝屏间距为1.0m，求屏上相邻明条纹的间距。')
    assert problem['model']['physics_mode'] == 'double_slit'
    assert problem['model']['defaults']['D'] == pytest.approx(1.0)
    assert problem['solution']['answer_value'] == pytest.approx(2.5e-3)


def test_glued_option_letters_and_ev_unit_not_garbage() -> None:
    """"1.88eVB."这类黏连选项与 eV 单位不应触发大小写混杂误判。"""
    from app.labs.source_recovery import assess_text_quality
    text = ('已知金属铯的逸出功为1.88eV，现用波长为300nm的紫外光照射铯表面。'
            '求逸出光电子的最大初动能。\nA.1.88eVB.2.26eVC.4.14eVD.0.38eV')
    quality = assess_text_quality(text, [{'image_key': 'x'}])
    assert '存在较多无意义的大小写混杂片段' not in quality['issues']
    assert quality['untrusted'] is False


def test_incline_smooth_surface_sets_zero_friction() -> None:
    """"光滑斜面"应使 mu=0 而不再缺参阻塞。"""
    problem = _problem('质量为2.0kg的物体沿倾角30°的光滑斜面由静止下滑，取g=9.8m/s²，求加速度。')
    assert problem['model']['physics_mode'] == 'incline'
    assert problem['model']['defaults']['mu'] == 0.0
    assert problem['status'] == 'ready'
    assert problem['solution']['answer_value'] == pytest.approx(9.8 * 0.5)


def test_ampere_length_phrasing_and_perpendicular_angle() -> None:
    """"长0.5m的直导线"提供 L，"与磁场垂直"映射为 90°。"""
    problem = _problem('一根长0.5m的直导线通有电流10A，置于磁感应强度为0.2T的匀强磁场中，'
                       '导线与磁场方向垂直，求导线所受安培力。')
    assert problem['model']['physics_mode'] == 'ampere'
    defaults = problem['model']['defaults']
    assert defaults['L'] == pytest.approx(0.5) and defaults['angle'] == pytest.approx(90.0)
    assert problem['status'] == 'ready'
    assert problem['solution']['answer_value'] == pytest.approx(0.2 * 10 * 0.5)


def test_carnot_celsius_converted_to_kelvin() -> None:
    """727°C/27°C 必须换算为开尔文，否则落入 η=96% 陷阱；"吸收热量"应提供 Qh。"""
    problem = _problem('一卡诺热机工作在高温热源727°C和低温热源27°C之间，'
                       '每循环从高温热源吸收热量2000J，求效率。')
    assert problem['model']['physics_mode'] == 'carnot'
    defaults = problem['model']['defaults']
    assert defaults['Th'] == pytest.approx(1000.15) and defaults['Tc'] == pytest.approx(300.15)
    assert defaults['Qh'] == pytest.approx(2000.0)
    assert problem['status'] == 'ready'
    assert problem['solution']['answer_value'] == pytest.approx(1 - 300.15 / 1000.15, rel=1e-6)


def test_capacitor_series_microfarad() -> None:
    """μF 标注电容串联：Ceq=C1*C2/(C1+C2)。"""
    problem = _problem('两个电容器C1=2μF和C2=4μF串联后接在电压U=12V的电源两端，求等效电容。')
    assert problem['model']['physics_mode'] == 'capacitor'
    assert problem['solution']['answer_value'] == pytest.approx(8.0 / 6.0)


def test_mode_detection_survives_ocr_line_breaks() -> None:
    """OCR 把"安\n培力"断行时，学科分类与题型检测仍应命中。"""
    text = ('一根长0.5m的直导线通有电流10A，置于磁感应强度为0.2T的匀强磁场中，'
            '导线与磁场方向垂直。求导线所受安\n培力的大小。')
    assert classify_subject(text)[0] == 'physics'
    problem = _problem(text)
    assert problem['model']['physics_mode'] == 'ampere'
    assert problem['status'] == 'ready'
    assert problem['solution']['answer_value'] == pytest.approx(1.0)


def test_uf_microfarad_tokens_not_garbage() -> None:
    """OCR 常把 μF 识别成 uF——不应触发大小写混杂误判。"""
    from app.labs.source_recovery import assess_text_quality
    text = ('两个电容器C1=2uF和C2=4uF串联后接在电压U=12V的电源两端。'
            '求串联后的等效电容。\nA.6uF B.3uF C.1.33uF D.0.75uF')
    quality = assess_text_quality(text, [{'image_key': 'x'}])
    assert '存在较多无意义的大小写混杂片段' not in quality['issues']
    assert quality['untrusted'] is False


def test_coulomb_force_only_question_needs_no_point() -> None:
    """只求库仑力不应强制要求 P 点位置（xP 只用于场强/电势叠加问）。"""
    problem = _problem('两点电荷q1=2×10^-6C、q2=-3×10^-6C相距d=0.3m，求它们之间的库仑力大小。')
    assert problem['model']['physics_mode'] == 'coulomb'
    assert problem['status'] == 'ready'
    assert problem['solution']['answer_value'] == pytest.approx(8.99e9 * 6e-12 / 0.09, rel=1e-6)
    field_q = _problem('两点电荷q1=2×10^-6C、q2=3×10^-6C相距d=0.3m，求中点电场强度。')
    assert field_q['status'] == 'needs_review'


def test_gauss_charged_sphere_classifies_physics() -> None:
    """"均匀带电球面""求电场强度"应识别为物理 gauss。"""
    problem = _problem('半径R=0.2m的均匀带电球面总电荷Q=1×10^-8C，求距球心r=0.4m处的电场强度。')
    assert problem['subject'] == 'physics'
    assert problem['model']['physics_mode'] == 'gauss'
    assert problem['solution']['answer_value'] == pytest.approx(8.99e9 * 1e-8 / 0.16, rel=1e-6)


def test_thermo_general_state_change_ratio_no_moles() -> None:
    """"T1,V1→T2,V2"一般状态变化：PV/T 守恒，比值题 n 相消。"""
    problem = _problem('一定量理想气体从状态T1=300K、V1=2L变化到T2=600K、V2=4L，求p2/p1。')
    assert problem['model']['physics_mode'] == 'thermo_process'
    assert problem['model']['defaults']['process'] == 4.0
    assert problem['status'] == 'ready'
    assert problem['solution']['answer_value'] == pytest.approx(1.0)


def test_thin_film_with_index() -> None:
    problem = _problem('空气中折射率n=1.33的肥皂膜厚度d=500nm，波长λ=600nm的光垂直入射，求干涉情况。')
    assert problem['model']['physics_mode'] == 'thin_film'
    assert problem['status'] == 'ready'


def test_single_slit_angular_only_no_screen_distance() -> None:
    """问半角宽度不需要屏距；"宽度a="提供缝宽。"""
    problem = _problem('波长λ=500nm的光垂直入射到宽度a=0.1mm的单缝上，求中央明纹的半角宽度。')
    assert problem['model']['physics_mode'] == 'single_slit'
    assert problem['status'] == 'ready'
    assert problem['solution']['answer_value'] == pytest.approx(
        math.degrees(math.asin(500e-9 / 1e-4)), rel=1e-6)


def test_grating_order_parsed_from_text() -> None:
    """"第2级主极大"应把 k 解析为 2，而不是默认 1。"""
    problem = _problem('波长λ=600nm的光正入射到光栅常数d=2×10^-6m的光栅上，求第2级主极大的衍射角。')
    assert problem['model']['defaults']['k'] == 2.0
    assert problem['solution']['answer_value'] == pytest.approx(math.degrees(math.asin(0.6)), rel=1e-6)


def test_rc_answer_value_tracks_asked_quantity() -> None:
    """问电容电压时 answer_value 应取 Uc，不是 τ。"""
    problem = _problem('RC串联电路中电阻R=1000Ω、电容C=10μF、电源电压E=9V，求充电t=0.01s时电容上的电压。')
    assert problem['model']['physics_mode'] == 'rc'
    tau = 1000 * 10 * 1e-6
    assert problem['solution']['answer_value'] == pytest.approx(9 * (1 - math.exp(-0.01 / tau)), rel=1e-6)


def test_atwood_answer_value_is_magnitude() -> None:
    """问"加速度大小"时 answer_value 应取绝对值。"""
    problem = _problem('阿特伍德机两物体质量m1=3kg、m2=1kg，取g=10m/s²，求系统加速度大小。')
    assert problem['model']['physics_mode'] == 'atwood'
    assert problem['solution']['answer_value'] == pytest.approx(5.0)


def test_decay_fraction_question_needs_no_n0() -> None:
    """求剩余百分比时 N0 相消，按 1 归一，不应缺参阻塞。"""
    problem = _problem('某放射性元素半衰期T=5天，经过t=15天后，求剩余质量占初始质量的百分比。')
    assert problem['model']['physics_mode'] == 'decay'
    assert problem['status'] == 'ready'
    assert problem['solution']['answer_value'] == pytest.approx(0.125)


def test_answer_blank_after_identifier_not_isolated() -> None:
    """"求…电流I3（）。"里的（ ）是答题空——判据看括号后是否仍在表达式内。"""
    from app.labs.source_recovery import assess_text_quality
    benign = assess_text_quality('双回路电路中E1=6V，求通过R3的电流I3（）。', [{'image_key': 'x'}])
    assert '存在孤立括号' not in benign['issues']
    garbage = assess_text_quality('由图可得 E=()·p + ()2 其中各项…', [{'image_key': 'x'}])
    assert '存在孤立括号' in garbage['issues']


def test_faraday_delta_triangle_variant() -> None:
    """OCR 把 Δ 读成空三角 △ 时"所用时间△t=0.1s"仍应解析。"""
    problem = _problem('穿过线圈面积A=0.01m²的磁感应强度由B1=0.2T均匀增加到B2=0.8T，'
                       '所用时间△t=0.1s，求感应电动势大小。')
    assert problem['model']['physics_mode'] == 'faraday'
    assert problem['status'] == 'ready'
    assert problem['solution']['answer_value'] == pytest.approx(0.06)


def test_wavelength_ru_glyph_variant() -> None:
    """OCR 把 λ 读成 "入"（"波长入=600nm"）仍应解析。"""
    problem = _problem('波长入=600nm的光正入射到光栅常数d=2×10^-6m的光栅上，求第2级主极大的衍射角。')
    assert problem['model']['physics_mode'] == 'grating'
    assert problem['model']['defaults']['lam'] == pytest.approx(600e-9)


def test_pendulum_theta0_garbled_glyph() -> None:
    """"初始摆角00=5°"（θ0 被读成 00）仍应解析。"""
    problem = _problem('摆长L=1.0m的单摆以初始摆角00=5°摆动，取g=9.8m/s²，求周期。')
    assert problem['model']['physics_mode'] == 'pendulum'
    assert problem['model']['defaults']['theta0'] == pytest.approx(5.0)
    assert problem['status'] == 'ready'


def test_kirchhoff_double_loop_phrasing() -> None:
    """"双回路电路"表述应识别 kirchhoff。"""
    problem = _problem('双回路电路中E1=6V、E2=3V，R1=1Ω、R2=2Ω、R3=3Ω，求通过R3的电流I3。')
    assert problem['model']['physics_mode'] == 'kirchhoff'
    assert problem['status'] == 'ready'
    assert problem['solution']['answer_value'] == pytest.approx(15 / 11, rel=1e-3)


def test_wave_travel_ru_glyph_variant() -> None:
    """批二行波同样要兼容 λ→入 字形（"波长入=2m"）。"""
    problem = _problem('一列简谐行波振幅A=0.02m，波长入=2m，频率f=5Hz，求波速。')
    assert problem['model']['physics_mode'] == 'wave_travel'
    assert problem['model']['defaults']['lam'] == pytest.approx(2.0)
    assert problem['solution']['answer_value'] == pytest.approx(10.0)


def test_wave_travel_missing_lam_reviewable_not_crash() -> None:
    """缺 λ 时 x2 回退不得 KeyError——应转成可复核的缺参状态。"""
    problem = _problem('一列简谐行波振幅A=0.02m，频率f=5Hz，求波速。')
    assert problem['model']['physics_mode'] == 'wave_travel'
    assert problem['status'] == 'needs_review'


def test_standing_wave_fundamental_only_needs_l_and_v() -> None:
    """"两端固定求基频"只需 L、v（λ1=2L），answer_value 取基频。"""
    problem = _problem('长L=1m的弦两端固定，波速v=100m/s，求基频。')
    assert problem['model']['physics_mode'] == 'standing_wave'
    assert problem['status'] == 'ready'
    assert problem['solution']['answer_value'] == pytest.approx(50.0)


def test_rigid_rotation_direct_inertia_case_sensitive_m_label() -> None:
    """"kg·m2"的小写 m 不得抢占力矩 M 标签（re.I 副作用）。"""
    problem = _problem('转动惯量J=2kg·m2的刚体在力矩M=6N·m作用下由静止开始转动，求角加速度。')
    assert problem['model']['physics_mode'] == 'rigid_rotation'
    assert problem['status'] == 'ready'
    assert problem['model']['defaults']['torque'] == pytest.approx(6.0)
    assert problem['solution']['answer_value'] == pytest.approx(3.0)


def test_rigid_rotation_alpha_only_needs_no_time() -> None:
    """只求角加速度时 t 不是必填。"""
    problem = _problem('质量m=4kg、半径r=0.5m的圆盘受力矩τ=10N·m，求角加速度。')
    assert problem['model']['physics_mode'] == 'rigid_rotation'
    assert problem['status'] == 'ready'


def test_brewster_only_needs_no_theta() -> None:
    """只问布儒斯特角不需要偏振片夹角。"""
    problem = _problem('求光从空气射向折射率n=1.5的玻璃时的布儒斯特角。')
    assert problem['model']['physics_mode'] == 'polarization'
    assert problem['status'] == 'ready'
    assert problem['solution']['answer_value'] == pytest.approx(math.degrees(math.atan(1.5)), rel=1e-3)


def test_impulse_force_phrasing_and_answer_value() -> None:
    """"求平均冲力"应识别 impulse 且 answer_value 取平均力。"""
    problem = _problem('质量m=0.5kg的物体速度由v1=2m/s变为v2=6m/s，作用时间t=0.2s，求平均冲力。')
    assert problem['model']['physics_mode'] == 'impulse'
    assert problem['status'] == 'ready'
    assert problem['solution']['answer_value'] == pytest.approx(10.0)


def test_relative_two_vessels_phrasing() -> None:
    """"甲船相对乙船的速度"应识别 relative 一维相对运动。"""
    problem = _problem('甲船以vA=5m/s向东行驶，乙船以vB=3m/s向东行驶，求甲船相对乙船的速度。')
    assert problem['model']['physics_mode'] == 'relative'
    assert problem['solution']['answer_value'] == pytest.approx(2.0)


def test_energy_level_group_lines_answer_value() -> None:
    """"一群 n=4 氢原子最多几种谱线"——answer_value 取谱线数 6。"""
    problem = _problem('一群处于n=4激发态的氢原子向低能级跃迁，最多能发出几种不同频率的光。')
    assert problem['model']['physics_mode'] == 'energy_level'
    assert problem['status'] == 'ready'
    assert problem['solution']['answer_value'] == pytest.approx(6.0)


def test_rc_discharge_branch() -> None:
    """RC 放电分支：Uc=E·exp(-t/τ)。"""
    problem = _problem('RC放电电路中电阻R=1000Ω、电容C=10μF、电源电压E=9V，求放电t=0.01s时电容上的电压。')
    assert problem['model']['physics_mode'] == 'rc'
    assert problem['solution']['answer_value'] == pytest.approx(9 * math.exp(-1.0), rel=1e-6)


def test_concave_lens_virtual_image() -> None:
    """凹透镜 f<0 成虚像：v = uf/(u−f) 为负。"""
    problem = _problem('凹透镜焦距f=-10cm，物距u=20cm处放一物体，求像距。')
    assert problem['model']['physics_mode'] == 'lens'
    assert problem['solution']['answer_value'] == pytest.approx(-1/15, rel=1e-3)

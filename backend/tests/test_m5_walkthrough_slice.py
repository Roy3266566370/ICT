"""M5 任务 3：旋转体体积与二重积分切片 Walkthrough 专项测试。"""
from __future__ import annotations

import json
import pytest

from app.labs.walkthrough import pattern_router, service
from app.labs.walkthrough.double_slice import DoubleSliceSpec, build_double, derive_double, verify_double
from app.labs.walkthrough.volume_slice import VolumeSpec, build_volume, derive_volume, verify_volume


@pytest.mark.parametrize(
    'case_name,spec,expected_exact',
    [
        (
            'parabola_disk',
            VolumeSpec(axis='x', outer_radius='x^2', inner_radius='0', lower='0', upper='2'),
            '32*pi/5',
        ),
        (
            'washer_ring',
            VolumeSpec(axis='x', outer_radius='sqrt(x)', inner_radius='x', lower='0', upper='1'),
            'pi/6',
        ),
        (
            'trig_sine_solid',
            VolumeSpec(axis='x', outer_radius='sin(x)', inner_radius='0', lower='0', upper='pi'),
            'pi^2/2',
        ),
    ],
)
def test_volume_slice_three_variants_and_tamper_detection(case_name, spec, expected_exact):
    derived = derive_volume(spec)
    claims = {key: str(val) for key, val in derived.claims.items()}
    checks = verify_volume(derived, claims)
    assert all(item['status'] == 'verified' for item in checks.values()), case_name

    # 验证与已知解析精确值一致
    exact_check = verify_volume(derived, {'exact': expected_exact})
    assert exact_check['exact']['status'] == 'verified', case_name

    # 篡改截面积和最终体积必须被 100% 拦截
    tampered = verify_volume(derived, {'cross_section_area': 'pi*x + 123', 'exact': '999'})
    assert tampered['cross_section_area']['status'] == 'unverified'
    assert tampered['exact']['status'] == 'unverified'

    built = build_volume(spec, derived, checks, why='按旋转轴切片累加圆盘体积', alternatives=['柱壳法'], trusted=True)
    assert built['slice_kind'] == 'volume'
    assert built['geometry']['family'] == 'volume_solid'
    assert built['verification']['status'] == 'verified'
    assert len(built['steps']) == 4
    assert built['steps'][-1].get('final') is True


def test_volume_slice_rejects_invalid_radii():
    with pytest.raises(ValueError, match='外半径'):
        derive_volume(VolumeSpec(axis='x', outer_radius='x', inner_radius='x + 1', lower='0', upper='1'))


@pytest.mark.parametrize(
    'case_name,spec,expected_exact',
    [
        (
            'rectangle_x_outer',
            DoubleSliceSpec(order='x_outer', outer_lower='0', outer_upper='2', inner_lower='0', inner_upper='1', integrand='x + 2*y'),
            '4',
        ),
        (
            'triangle_x_outer',
            DoubleSliceSpec(order='x_outer', outer_lower='0', outer_upper='1', inner_lower='0', inner_upper='x', integrand='x*y'),
            '1/8',
        ),
        (
            'parabola_y_outer',
            DoubleSliceSpec(order='y_outer', outer_lower='0', outer_upper='1', inner_lower='y^2', inner_upper='y', integrand='x + y'),
            '3/20',
        ),
    ],
)
def test_double_slice_three_variants_and_tamper_detection(case_name, spec, expected_exact):
    derived = derive_double(spec)
    claims = {key: str(val) for key, val in derived.claims.items()}
    checks = verify_double(derived, claims)
    assert all(item['status'] == 'verified' for item in checks.values()), case_name

    exact_check = verify_double(derived, {'exact': expected_exact})
    assert exact_check['exact']['status'] == 'verified', case_name

    # 篡改内层积分和最终值必须被 100% 拦截
    tampered = verify_double(derived, {'inner_integral': '42', 'exact': '42'})
    assert tampered['inner_integral']['status'] == 'unverified'
    assert tampered['exact']['status'] == 'unverified'

    built = build_double(spec, derived, checks, why='先固定外层变量沿条带求内层积分', alternatives=['交换积分次序'], trusted=True)
    assert built['slice_kind'] == 'double'
    assert built['geometry']['family'] == 'double_region'
    assert built['geometry']['region']['order'] == spec.order
    assert built['verification']['status'] == 'verified'
    assert len(built['steps']) == 4
    assert built['steps'][0]['view']['name'] == 'region_strips'


def test_double_slice_rejects_inverted_bounds():
    with pytest.raises(ValueError, match='内层上限'):
        derive_double(
            DoubleSliceSpec(order='x_outer', outer_lower='0', outer_upper='1', inner_lower='1', inner_upper='0', integrand='1')
        )


def test_polymorphic_router_detection_and_dispatch(monkeypatch):
    # 1. 路由判定准确区分三类题型，不混淆曲面积分与二重积分
    assert pattern_router.detect_mode({'text': '计算曲面积分 ∬_Σ z dS，其中 Σ 为半球面', 'subject': 'calculus'}) == 'surface_slice'
    assert pattern_router.detect_mode({'text': '求由 y=x^2 与 x=2 围成区域绕 x 轴旋转体体积', 'subject': 'calculus'}) == 'volume_slice'
    assert pattern_router.detect_mode({'text': '计算二重积分 ∬_D x*y dx dy，其中 D 由 y=0, y=x, x=1 围成', 'subject': 'calculus'}) == 'double_slice'
    assert pattern_router.detect_mode({'text': '求导数', 'subject': 'linear_algebra'}) is None

    # 2. 路由分发到 double_slice 并执行 SymPy 验算与 input_hash 写入
    monkeypatch.setattr(service, 'configured', lambda: True)

    def fake_complete_json(*, response_model, validator, **kwargs):
        payload = {
            'pattern': 'slice_accumulate',
            'spec': {
                'order': 'x_outer',
                'outer_lower': '0',
                'outer_upper': '1',
                'inner_lower': '0',
                'inner_upper': 'x',
                'integrand': 'x*y',
            },
            'why': '区域为 X-型三角形，先对 y 积分最简洁。',
            'alternatives': ['改为 Y-型水平条带'],
            'strip_length': 'x',
            'inner_integral': 'x^3/2',
            'primitive': 'x^4/8',
            'exact': '1/8',
        }
        validator(payload)
        return response_model.model_validate(payload), {'attempts': 1}

    monkeypatch.setattr('app.labs.walkthrough.double_slice.complete_json', fake_complete_json)
    problem = {
        'text': '计算二重积分 ∬_D x*y dx dy，其中 D 为三角形 0<=x<=1, 0<=y<=x',
        'subject': 'calculus',
        'model': {'task': 'double_integral', 'conditions': {'order': 'x_outer'}},
    }
    result = service.generate(problem)
    assert result['slice_kind'] == 'double'
    assert result['verification']['status'] == 'verified'
    assert result['input_hash'] == service.input_hash(problem)
    assert json.loads(json.dumps(result))['geometry']['region']['outer_var'] == 'x'

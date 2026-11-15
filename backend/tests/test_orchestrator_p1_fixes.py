"""2026-11-15 复查报告 5 项残留问题的回归测试。

P1-1 确定性兜底不得改写原题边界：两条曲线之间的面积要么忠实求解（二重积分内核），
要么明确拒绝，绝不能按“曲线与 x 轴之间的面积”回答；
P1-2 同类小问必须逐个拆出并各自绑定曲线与区间；
P1-3 新计划与重规划都不得改变求解义务（有向积分不能替代几何面积）；
P1-4 零点完整性不能由计划常量或调用方自行声明；
P2-5 由浏览器端到端验证（frontend LabWorkbenchPage 采纳新文档的行为）。
"""
import pytest

from app.labs import orchestrator as o
from app.labs.capabilities import check_sign_segments

TEXT = '在0≤x≤2内，求曲线y=x²−x与x轴之间的面积，以及该区域绕x轴旋转所得旋转体的体积。'


# ---------------------------------------------------------------------------
# P1-1 兜底规则不得改题意
# ---------------------------------------------------------------------------

def test_two_curve_area_is_solved_faithfully():
    text = '在0≤x≤1内，求曲线y=x²与直线y=1之间的面积。'
    r = o.solve_composite(text, use_ai=False)
    assert r['plan_check']['ok'], r['plan_check']['errors']
    assert r['status'] == '完成'
    caps = [s['capability'] for s in r['plan']['steps']]
    assert 'double_integral' in caps
    answer = r['answers'][0]
    assert answer['answer'] == '2/3'
    # 目标保留原题边界表述，不得改写成“与 x 轴之间”
    assert 'x 轴' not in answer['goal']
    assert '直线 y=1' in answer['goal']


def test_crossing_two_curve_area_is_never_rewritten():
    # x² 与 y=1 在 x=1 处相交于区间内部：无法证明唯一上下边界 → 必须拒绝，不得改写
    text = '在0≤x≤2内，求曲线y=x²与直线y=1之间的面积。'
    r = o.solve_composite(text, use_ai=False)
    assert r['status'] == 'needs_review'
    assert r['answers'] == []


# ---------------------------------------------------------------------------
# P1-2 同类小问不遗漏
# ---------------------------------------------------------------------------

def test_understanding_binds_each_question_to_its_own_curve():
    text = '在0≤x≤1内，求曲线y=x²与x轴之间的面积，再求曲线y=x与x轴之间的面积。'
    u = o.build_understanding(text, use_ai=False)
    assert [q['id'] for q in u['asked']] == ['Q1', 'Q2']
    assert u['mapping']['Q1']['curve'] != u['mapping']['Q2']['curve']
    assert u['mapping']['Q1']['interval'] == u['mapping']['Q2']['interval']
    plan = o.deterministic_plan(text, u)
    assert plan is not None
    check = o.validate_plan(plan, u)
    assert check['ok'], check['errors']
    area_steps = [s for s in plan['steps'] if s['capability'] == 'geometric_area']
    assert {s['subquestion'] for s in area_steps} == {'Q1', 'Q2'}
    assert {s['inputs']['expression']['ref'] for s in area_steps} == \
        {u['mapping']['Q1']['curve'], u['mapping']['Q2']['curve']}


def test_two_similar_area_questions_are_both_answered():
    text = '在0≤x≤1内，求曲线y=x²与x轴之间的面积，再求曲线y=x与x轴之间的面积。'
    r = o.solve_composite(text, use_ai=False)
    assert r['plan_check']['ok'], r['plan_check']['errors']
    assert r['status'] == '完成'
    values = sorted(a['value'] for a in r['answers'])
    assert values == [pytest.approx(1 / 3), pytest.approx(1 / 2)]


# ---------------------------------------------------------------------------
# P1-3 重规划不得改变求解目标
# ---------------------------------------------------------------------------

def test_validator_rejects_signed_integral_for_area_subquestion():
    u = o.build_understanding(TEXT, use_ai=False)
    plan = {'steps': [
        {'id': 'S1', 'goal': '面积', 'capability': 'integral', 'subquestion': 'Q1',
         'inputs': {'expression': {'source': 'problem', 'ref': 'G1', 'value': 'x^2-x'},
                    'variable': {'source': 'plan', 'value': 'x'},
                    'lower': {'source': 'problem', 'ref': 'G2', 'value': 0},
                    'upper': {'source': 'problem', 'ref': 'G2', 'value': 2}}},
        {'id': 'S2', 'goal': '汇总', 'capability': 'assemble_report',
         'inputs': {'steps': {'source': 'plan', 'value': ['S1']}}}]}
    check = o.validate_plan(plan, u)
    assert not check['ok']
    assert any('求解义务' in e for e in check['errors'])


def test_replan_cannot_replace_area_with_signed_integral():
    u = o.build_understanding(TEXT, use_ai=False)
    plan = {'steps': [
        {'id': 'S1', 'goal': '面积', 'capability': 'geometric_area', 'subquestion': 'Q1',
         'inputs': {'expression': {'source': 'plan', 'value': 'x^^2'},
                    'lower': {'source': 'plan', 'value': 0},
                    'upper': {'source': 'plan', 'value': 2},
                    'region_kind': {'source': 'plan', 'value': 'between_axis'}}},
        {'id': 'S2', 'goal': '汇总', 'capability': 'assemble_report',
         'inputs': {'steps': {'source': 'plan', 'value': ['S1']}}}]}
    calls = {'n': 0}

    def replan(step, error):
        calls['n'] += 1
        return {'id': step['id'], 'goal': step['goal'], 'capability': 'integral',
                'inputs': {'expression': {'source': 'problem', 'ref': 'G1', 'value': 'x^2-x'},
                           'variable': {'source': 'plan', 'value': 'x'},
                           'lower': {'source': 'problem', 'ref': 'G2', 'value': 0},
                           'upper': {'source': 'problem', 'ref': 'G2', 'value': 2}}}

    execution = o.execute_plan(TEXT, plan, u, replan=replan)
    assert calls['n'] == 1  # 只尝试一次替代
    assert execution['results']['S1']['state'] != o.STATE_DONE
    rejected = execution['solve']['adjustments'][0]['rejected']
    assert any('求解义务' in r for r in rejected)
    # 有向积分 2/3 不能作为几何面积答案输出（正确几何面积应为 1）
    assert not execution['results']['S1']['outputs'].get('answer')


# ---------------------------------------------------------------------------
# P1-4 零点完整性不可伪造
# ---------------------------------------------------------------------------

def test_sign_segments_rejects_forged_empty_zeros():
    result = check_sign_segments('x^2-x', 'x', 0, 2, [], True)
    assert not result['complete']
    # 分段改用内核独立核验后的零点，不再产生“整段符号为 0”的错误结论
    assert [s['sign'] for s in result['segments']] == [-1, 1]


def test_sign_segments_still_accepts_verified_zeros():
    result = check_sign_segments('x^2-x', 'x', 0, 2, [0, 1], True)
    assert result['complete']
    assert [s['sign'] for s in result['segments']] == [-1, 1]


def test_plan_constant_zeros_cannot_declare_completeness():
    u = o.build_understanding(TEXT, use_ai=False)
    plan = {'steps': [{'id': 'S1', 'goal': '分段', 'capability': 'sign_segments',
                       'inputs': {'expression': {'source': 'plan', 'value': 'x^2-x'},
                                  'variable': {'source': 'plan', 'value': 'x'},
                                  'lower': {'source': 'plan', 'value': 0},
                                  'upper': {'source': 'plan', 'value': 2},
                                  'zeros': {'source': 'plan', 'value': []},
                                  'zeros_complete': {'source': 'plan', 'value': True}}}]}
    check = o.validate_plan(plan, u)
    assert not check['ok']
    assert any('zeros' in e and '计划常量' in e for e in check['errors'])

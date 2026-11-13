"""Real exam routing must preserve the task instead of inventing an objective."""
from app.labs.recognize import build_problem, classify_subject, build_lab_document, rebuild_problem
from app.labs.extract import text_source


def test_exam_task_classification():
    cases = [
        ('曲线 3*x^3=y^5+2*y^3 在 x=1 对应点处的法线斜率为多少？', 'calculus'),
        ('求函数 f(x,y)=x*exp(cos(y))+x^2/2 的极值。', 'optimization'),
        ('已知平面区域 D={(x,y)|0<=y<=1/(x*sqrt(1+x^2)), x>=1}，求面积和绕x轴旋转所成旋转体的体积。', 'calculus'),
        ('关键字序列 28,22,20,19,8,12,15,5 是大根堆，删除两次堆顶。', 'algorithm'),
        ('曲线y=-x²+x²+2x与x轴所围成的图形的面\n积为A=', 'calculus'),
    ]
    for text, expected in cases:
        assert classify_subject(text)[0] == expected


def test_unknown_stays_unsupported_without_teaching_answer():
    problem = build_problem('请分析这首诗的意境。')
    assert problem['subject'] == 'unknown'
    assert problem['status'] == 'unsupported'
    assert not problem['model'].get('teaching')
    assert not problem['model'].get('expression')
    assert any(a['severity'] == 'blocking' for a in problem['recognition']['ambiguities'])
    source = text_source('请分析这首诗的意境。', lab_id='unknown')
    doc = build_lab_document(lab_id='unknown', title='未知题型', source=source,
                             files=source['files'], now_iso='2026-11-09T00:00:00Z')
    assert doc['problems'][0]['solution']['answer'] == ''
    assert doc['status'] == 'unsupported'


def test_uncertain_formula_requires_explicit_confirmation_after_review():
    problem = build_problem('计算定积分 ∫_0^2 x^2 dx。', pages=[{
        'file_id': 'f1', 'page': 1, 'image_key': 'f1_p1', 'method': 'image_ocr',
        'requires_formula_confirmation': True,
    }])
    assert problem['status'] == 'needs_review'
    assert any(a['id'] == 'source_formula_confirmation' for a in problem['recognition']['ambiguities'])
    still_blocked = rebuild_problem(problem, files=[], text='计算定积分 ∫_0^2 x^3 dx。')
    assert still_blocked['status'] == 'needs_review'
    confirmed = rebuild_problem(problem, files=[], text='计算定积分 ∫_0^2 x^3 dx。',
                                ambiguity_answers={'source_formula_confirmation':'confirmed'})
    assert confirmed['status'] == 'ready'
    assert confirmed['solution']['answer_value'] == 4
    assert 'x^3' in confirmed['title']

import pytest

from app.labs.manual import build_manual_document, preview_integral


def document(task, **conditions):
    return build_manual_document(lab_id='t', title='', task=task, conditions=conditions,
                                 now_iso='2026-11-18')['problems'][0]


@pytest.mark.parametrize('expression,expected', [
    ('(x^2+1)/(x-1)', ['x=1', '+(1)']),
    ('1/(x^2-1)', ['x=-1', 'x=1', 'y=0']),
    ('(2*x+1)/(x-3)', ['x=3', 'y=2']),
])
def test_asymptote_enumerates_vertical_horizontal_oblique(expression, expected):
    p = document('asymptote', expression=expression)
    answer = p['solution']['answer']
    assert p['status'] == 'ready'
    for piece in expected:
        assert piece in answer
    assert p['solution']['verification']['level'] == 'numeric'


def test_asymptote_removable_point_is_not_asymptote():
    answer = document('asymptote', expression='(x^2-1)/(x-1)')['solution']['answer']
    assert 'x=1' in answer and '可去间断点' in answer
    assert '渐近线：x=1' not in answer


def test_asymptote_rejects_non_rational_function():
    with pytest.raises(ValueError):
        preview_integral('asymptote', dict(expression='sin(x)/x'))


@pytest.mark.parametrize('expression,fragment', [
    ('(1+1/n)^n', 'lim a_n = E'),
    ('n/(n+1)', 'lim a_n = 1'),
    ('(2*n^2+1)/(n^2-3)', 'lim a_n = 2'),
    ('(-1)^n', '极限不存在'),
    ('n^2', '发散到 +∞'),
])
def test_sequence_limit_classifies_convergence(expression, fragment):
    answer = document('sequence_limit', expression=expression)['solution']['answer']
    assert fragment.lower() in answer.lower()


def test_sequence_limit_rejects_function_variable():
    with pytest.raises(ValueError):
        preview_integral('sequence_limit', dict(expression='sin(x)/x'))
import math
import pytest
from app.labs.manual import build_manual_document, preview_integral


def conditions(a='0',b='pi',lo='0',hi='sin(x)',f='1',swap=True):
    return dict(integrand=f,outer_variable='x',outer_lower=a,outer_upper=b,inner_lower=lo,inner_upper=hi,**({'swap_order':'true'} if swap else {}))


@pytest.mark.parametrize('c,expected',[
    (conditions(),2),
    (conditions(b='1',hi='exp(x)'),math.e-1),
    (conditions(a='1',b='2',hi='log(x)'),2*math.log(2)-1),
    (conditions(b='1',hi='x^3'),1/4),
    (conditions(a='pi',b='2*pi',lo='sin(x)',hi='0'),2),
])
def test_certified_transcendental_and_higher_boundaries(c,expected):
    doc=build_manual_document(lab_id='general-boundary',title='',task='double_integral',conditions=c,now_iso='2026-11-14')
    p=doc['problems'][0]
    assert p['manual_input']['result_status']=='complete',p['solution']
    assert p['solution']['answer_value']==pytest.approx(expected)
    parts=p['model']['swapped'];parts=parts if isinstance(parts,list) else [parts]
    assert all(part['region_verified'] for part in parts)
    assert sum(part['answer_value'] for part in parts)==pytest.approx(expected)


def test_periodic_boundaries_need_full_interval_sign_check():
    for b in ('2*pi','4*pi','20*pi'):
        with pytest.raises(ValueError):preview_integral('double_integral',conditions(b=b))


def test_hidden_original_transcendental_domain_gap_is_rejected():
    with pytest.raises(ValueError):preview_integral('double_integral',conditions(b='1',hi='exp(log(x))'))

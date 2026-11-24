import pytest
from app.ispec.native_math import build_native_math_specs
from app.ispec.user_config import apply_user_interactions, validate_interaction
from app.ispec.validator import validate_ispec


def test_ocr_column_labels_recover_a_matrix_with_source_anchor():
    element={'element_id':'p03_s07','kind':'picture','bbox':{'x':10,'y':20,'w':100,'h':80},
             'text':'2= =(1, 2)\nC1 = (2, 1)','recognition_method':'local_ocr'}
    page={'page_no':3,'width':1000,'height':750,'title':'Columns','elements':[element]}
    specs=build_native_math_specs(page,'mat_unfamiliar')
    assert len(specs)==1
    assert [p['default'] for p in specs[0]['parameters'][:4]]==[2,1,1,2]
    assert specs[0]['views'][0]['spec_ref']=='grid_transform'
    assert specs[0]['parameters'][0]['source']['status']=='inferred'
    bound=apply_user_interactions(specs,{'pages':[page]},{'overrides':{}})
    assert bound[0]['anchor']['element_id']=='p03_s07'


def test_manual_image_formula_is_computable_and_explicitly_confirmed():
    element={'element_id':'p02_s04','kind':'picture','name':'formula screenshot',
             'bbox':{'x':20,'y':30,'w':100,'h':40}}
    page={'page_no':2,'width':1000,'height':750,'elements':[element]}
    metadata={'overrides':{'p02_s04':{'interaction':{'kind':'formula','formula':'y = x^2', 'defaults':{'x':3}}}}}
    specs=apply_user_interactions([],{'pages':[page]},metadata)
    assert len(specs)==1 and not validate_ispec(specs[0])
    assert specs[0]['expressions'][-1]['expr']=='x ** 2'
    assert specs[0]['anchor']['bbox']==element['bbox']
    assert specs[0]['parameters'][0]['source']['status']=='confirmed'


def test_configuration_rejects_scripts_and_incomplete_matrices():
    with pytest.raises(ValueError):
        validate_interaction({'kind':'formula','formula':"y = __import__('os').system('x')"})
    with pytest.raises(ValueError):
        validate_interaction({'kind':'matrix','matrix':[[1,2]]})

from copy import deepcopy
from app.ispec.persistence import save_values,load_values


def test_rebuild_retains_only_unchanged_objects(tmp_path,monkeypatch):
    monkeypatch.setenv('ISPEC_VALUES_DIR',str(tmp_path))
    from app.ispec.persistence import migrate_unchanged_values
    original={'object_id':'matrix__r1','kind':'geometric','parameters':[{'id':'a','default':2}],
      'expressions':[{'id':'det','expr':'a*2'}]}
    unchanged={**deepcopy(original),'object_id':'matrix__r2'}
    changed={**deepcopy(original),'object_id':'other__r2','expressions':[{'id':'det','expr':'a*3'}]}
    old_other={**deepcopy(original),'object_id':'other__r1'}
    save_values('mat_rebuild','matrix__r1',{'a':4})
    save_values('mat_rebuild','other__r1',{'a':7})
    migrate_unchanged_values('mat_rebuild',[original,old_other],[unchanged,changed])
    saved=load_values('mat_rebuild')
    assert saved['matrix__r2']['values']=={'a':4}
    assert 'other__r2' not in saved
    assert saved['matrix__r1']['values']=={'a':4}

"""Common manual-document adapter for specialized double-integral workflows."""
import copy


def module_for(c):
    if 'application' in c:
        from . import double_applications
        return double_applications
    if c.get('region_mode') in ('affine','change_variables'):
        from . import double_affine
        return double_affine
    if c.get('region_mode') in ('polar_improper','strip_improper'):
        from . import double_improper_regions
        return double_improper_regions
    return None


def build_problem(c):
    from .exam_math import _condition
    from .manual_double_integral import labels
    module=module_for(c);p=module.preview(c);solution=module.solve(c)
    fields=[_condition(k,labels(c).get(k,k),v,{}) for k,v in c.items()]
    for field in fields:
        if field['id'] in ('region_mode','outer_variable','application'):field['editable']=False
    model=dict(engine='double_integral_v1',subject='calculus',task='double_integral',kind='integral',variables=['x','y'],
        expression=c['integrand'],integrand=c['integrand'],region_kind=c.get('region_mode','strip'),formula_tex=p['latex'],defaults={},params=[],teaching=False,
        manual_double_conditions=dict(c),double_extension_solution=solution)
    return dict(problem_id='prb_manual_double_extension',number=None,title=p['label'],text=p['question'],subject='calculus',subject_label='二重积分',confidence=1.0,status='ready',source={},source_pages=[],
        recognition=dict(method='declarative_kernel',raw_text='',conditions=fields,ambiguities=[],formulas=[],recognized_subject='calculus',ai_used=False),model=model,solution={},states={})


def solve(model):
    return copy.deepcopy(model['double_extension_solution'])

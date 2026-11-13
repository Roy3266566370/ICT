"""用户确认的结构化积分输入，不经过题干识别或模型理解。"""
from __future__ import annotations

import copy
from typing import Any

import sympy as sp
from sympy.calculus.util import continuous_domain

from .expr import expression_text, parse_expression, safe_float, to_latex
from .kernel_models import FIELD_LABELS, TASKS, _validate


def preview_integral(task: str, conditions: dict[str, Any]) -> dict[str, Any]:
    if task not in ('integral', 'antiderivative'):
        raise ValueError('手动输入目前支持定积分与不定积分')
    c = copy.deepcopy(conditions)
    _validate(task, c)
    variable = c['variable']
    expression = parse_expression(c['expression'], (variable,), preserve_structure=True)
    simplified = parse_expression(c['expression'], (variable,))
    c['expression'] = c['expression'].strip()
    if task == 'integral':
        for key in ('lower', 'upper'):
            raw = c[key]
            if isinstance(raw, bool) or not isinstance(raw, (str, int, float)) or len(str(raw)) > 100:
                raise ValueError(f'{FIELD_LABELS[key]}必须是有限实数，可使用分数或 pi')
            endpoint = parse_expression(str(raw))
            if endpoint.free_symbols or endpoint.is_real is not True or safe_float(endpoint) is None:
                raise ValueError(f'{FIELD_LABELS[key]}必须是有限实数，可使用分数或 pi')
            c[key] = expression_text(endpoint)
        latex = (rf'\int_{{{to_latex(parse_expression(c["lower"]))}}}'
                 rf'^{{{to_latex(parse_expression(c["upper"]))}}}'
                 rf'{to_latex(expression)}\,\mathrm{{d}}{variable}')
        question = f'计算定积分 ∫_{{{c["lower"]}}}^{{{c["upper"]}}} ({c["expression"]}) d{variable}'
    else:
        latex = rf'\int {to_latex(expression)}\,\mathrm{{d}}{variable}'
        question = f'计算不定积分 ∫ ({c["expression"]}) d{variable}'
    interval = (sp.Interval(*sorted([parse_expression(c['lower']), parse_expression(c['upper'])], key=float))
                if task == 'integral' else sp.S.Reals)
    try:
        original_domain = continuous_domain(expression, sp.Symbol(variable, real=True), interval)
        simplified_domain = continuous_domain(simplified, sp.Symbol(variable, real=True), interval)
        if original_domain != simplified_domain:
            raise ValueError('化简会改变原式实定义域，请调整区间或改写为可核对的表达式')
        if task == 'integral' and sp.sympify((interval - original_domain).measure).is_zero is not True:
            raise ValueError('原式实定义域不覆盖积分区间，存在无定义的实区间')
    except (NotImplementedError, TypeError) as exc:
        raise ValueError('当前未能验证原式实定义域，请改写公式或调整区间') from exc
    return {'task': task, 'label': TASKS[task]['label'], 'conditions': c, 'latex': latex, 'question': question}


def build_manual_document(*, lab_id: str, title: str, task: str,
                          conditions: dict[str, Any], now_iso: str) -> dict[str, Any]:
    from .extract import text_source
    from .recognize import _default_state
    from .kernel_models import compile_kernel_problem

    preview = preview_integral(task, conditions)
    c = preview['conditions']
    problem = compile_kernel_problem({'task': task, 'conditions': c})
    result_latex = (to_latex(parse_expression(problem['solution']['exact']))
                    if task == 'integral' else problem['solution']['exact'])
    problem['manual_input'] = {'task': task, 'conditions': c, 'confirmed': True,
                               'latex': preview['latex'], 'result_latex': result_latex}
    problem['text'] = preview['question']
    problem['title'] = preview['question']
    problem['model']['formula_tex'] = preview['latex']
    problem['model']['expression'] = c['expression']
    problem['model']['preserve_expression_structure'] = True
    for formula in problem['recognition']['formulas']:
        if r'\int' in formula.get('tex', ''):
            formula['tex'] = preview['latex']
    for item in problem['recognition']['conditions']:
        if item['id'] in c:
            item.update(value=c[item['id']], provenance='user_confirmed', label=FIELD_LABELS.get(item['id'], item['label']), note=None)
        else:
            item.update(provenance='inferred', editable=False, note='演示参数，不是补入的原题条件。')
    problem['states'] = _default_state(problem)
    problem['states']['mode'] = 'solution'
    problem['states']['scenarios'][0]['summary'] = '用户填写并确认的原题条件'
    source = text_source(preview['question'], lab_id=lab_id)
    source['method'] = 'manual_input'
    source['files'][0]['name'] = '手动输入的题目'
    problem['source'] = {'page_from': 1, 'page_to': 1, 'file_names': ['手动输入的题目'],
                         'label': '用户确认的题目', 'excerpt': preview['question']}
    problem['source_pages'] = [{'file_id': 'f1', 'page': 1, 'image_key': None, 'method': 'typed_text'}]
    return {
        'schema_version': 'lab.1', 'lab_id': lab_id, 'title': title.strip() or preview['question'][:120],
        'created_at': now_iso, 'updated_at': now_iso, 'revision': 1,
        'source': {**source, 'citation': '手动输入 · 已确认题目'},
        'problems': [problem], 'selected_problem_id': problem['problem_id'],
        'status': problem['status'], 'subject': 'calculus', 'problem_count': 1,
        'capabilities': {'ai_configured': False, 'ai_solver_configured': False,
                         'ai_note': '按用户确认的条件直接调用本地内核计算。'},
    }


def revise_manual_document(document: dict[str, Any], problem: dict[str, Any],
                           condition_values: dict[str, Any]) -> dict[str, Any]:
    conditions = {**problem['manual_input']['conditions'], **condition_values}
    rebuilt_doc = build_manual_document(lab_id=document['lab_id'], title=document['title'],
        task=problem['manual_input']['task'], conditions=conditions, now_iso=document['updated_at'])
    rebuilt = rebuilt_doc['problems'][0]
    rebuilt['problem_id'] = problem['problem_id']
    baseline = rebuilt['states']['scenarios'][0]
    rebuilt['states'] = {**copy.deepcopy(problem['states']), 'params': rebuilt['model']['defaults'],
                         'step': 0, 'evaluated': None, 'active_scenario_id': 'baseline',
                         'scenarios': [baseline]}
    rebuilt['states']['scenarios'].extend(copy.deepcopy([
        {**item, 'summary': '原题修正前保存的参数；按当前公式重放前请重新核对。'}
        for item in problem['states'].get('scenarios', []) if item.get('id') != 'baseline']))
    document['source'] = rebuilt_doc['source']
    return rebuilt

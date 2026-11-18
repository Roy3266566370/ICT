"""Shared executable model contract and conservative provider-shape adaptation."""
from __future__ import annotations

from copy import deepcopy
import json
import re
from typing import Any, Mapping


def _object(properties, required):
    return {'type': 'object', 'properties': properties, 'required': required,
            'additionalProperties': False}


TEXT = {'type': 'string', 'minLength': 1, 'maxLength': 800}
BOUND = {'type': 'string', 'minLength': 1, 'maxLength': 120}
NAME = {'type': 'string', 'pattern': '^[A-Za-z][A-Za-z0-9_]*$', 'maxLength': 24}


def _step_schema(op):
    fields = {'id': {'type': 'string', 'pattern': '^s[1-9][0-9]?$'}, 'op': {'const': op},
              'label': TEXT, 'title': TEXT}
    required = ['id', 'op']
    if op not in ('solve', 'inequality'):
        fields['expr'] = TEXT
        required.append('expr')
    if op in ('limit', 'diff', 'integrate', 'series', 'sum', 'extremum', 'inequality'):
        fields['var'] = NAME
        required.append('var')
    if op in ('limit', 'series', 'diff'):
        fields['point'] = BOUND
        if op in ('limit', 'series'):
            required.append('point')
    if op == 'limit':
        fields['side'] = {'enum': ['both', 'left', 'right']}
    if op in ('diff', 'series'):
        fields['order'] = {'type': 'integer', 'minimum': 1, 'maximum': 12}
    if op in ('integrate', 'sum', 'extremum'):
        fields.update(lower=BOUND, upper=BOUND)
        if op in ('sum', 'extremum'):
            required += ['lower', 'upper']
    if op == 'solve':
        fields.update(equations={'type': 'array', 'items': TEXT, 'minItems': 1, 'maxItems': 6},
                      **{'for': {'type': 'array', 'items': NAME, 'minItems': 1, 'maxItems': 6}})
        required += ['equations', 'for']
    if op == 'inequality':
        fields.update(left=TEXT, right=TEXT, relation={'enum': ['>', '>=', '<', '<=', '=']})
        required += ['left', 'right', 'relation']
    return _object(fields, required)


GENERIC_SCHEMA = _object({
    'kind': {'const': 'generic'}, 'subject': TEXT,
    'symbols': {'type': 'array', 'maxItems': 6, 'items': _object({
        'name': NAME, 'label': TEXT, 'role': {'enum': ['independent', 'unknown', 'parameter']},
        'domain': {'enum': ['real', 'positive', 'nonnegative', 'integer', 'positive_integer']},
    }, ['name', 'role'])},
    'constants': {'type': 'array', 'maxItems': 12, 'items': _object({
        'name': NAME, 'label': TEXT, 'value': {'type': ['string', 'number']}, 'source': TEXT,
        'tunable': {'type': 'boolean'}, 'min': {'type': 'number'}, 'max': {'type': 'number'},
    }, ['name', 'value'])},
    'steps': {'type': 'array', 'minItems': 1, 'maxItems': 6, 'items': {'oneOf': [
        _step_schema(op) for op in ('evaluate', 'simplify', 'solve', 'limit', 'diff', 'integrate',
                                   'series', 'sum', 'extremum', 'inequality')]}},
    'target': _object({'step': {'type': 'string', 'pattern': '^s[1-9][0-9]?$'}, 'label': TEXT}, ['step']),
    'plot': _object({'expr': TEXT, 'var': NAME, 'range': {
        'type': 'array', 'items': {'type': 'number'}, 'minItems': 2, 'maxItems': 2}}, ['expr', 'var', 'range']),
}, ['kind', 'symbols', 'constants', 'steps', 'target'])

MODEL_EXAMPLES = [
    {'kind': 'generic', 'symbols': [], 'constants': [
        {'name': 'P', 'value': 10000}, {'name': 'r', 'value': '1/20'}, {'name': 'n', 'value': 3}],
     'steps': [{'id': 's1', 'op': 'evaluate', 'expr': 'P*(1+r)^n'}], 'target': {'step': 's1'}},
    {'kind': 'generic', 'symbols': [{'name': 'x', 'role': 'unknown'}, {'name': 'y', 'role': 'unknown'}],
     'constants': [{'name': 'c1', 'label': '苹果单价', 'value': 8}, {'name': 'c2', 'label': '梨单价', 'value': 12}],
     'steps': [{'id': 's1', 'op': 'solve', 'equations': ['x+y=5', 'c1*x+c2*y=52'], 'for': ['x', 'y']}],
     'target': {'step': 's1'}},
    {'kind': 'generic', 'symbols': [{'name': 'x', 'role': 'independent'}], 'constants': [],
     'steps': [{'id': 's1', 'op': 'extremum', 'expr': 'x^3-3*x+1', 'var': 'x', 'lower': '-2', 'upper': '2'}],
     'target': {'step': 's1'}},
    {'kind': 'kernel', 'task': 'parameter_limit', 'conditions': {
        'expression': 'a*sin(x)/x', 'variable': 'x', 'point': 0, 'parameter': 'a', 'target_value': 6}},
]

MODEL_INSTRUCTIONS = (
    '严格遵守generic_schema和model_examples（示例只说明格式，不能作为题目数据）。'
    'symbols/constants必须是对象数组，名称用英文且互不重复；中文写label。'
    'constants.value必须是有限数值或不含任何变量的数值表达式；依赖其他常数的派生量写成运算步骤。'
    'model.steps是可执行运算，必须提供id、op及该op的全部必需字段；'
    '讲解只放在返回顶层steps，不得代替model.steps。expr不带赋值等号；'
    'solve使用equations和for；target是{step,label}对象。'
    '对数、根式等方程必须保留原始方程及定义域，不要变形后丢失取值限制；'
    '独立inequality步骤不会自动筛选solve的解，不能只在target.label或讲解中排除增根。'
    'kernel任务的全部输入必须放在model.conditions对象内，不能放在model顶层。'
    '必须同时输出完整题干question；图片题以原图转写为准，不得只输出模型和步骤。'
    '有可计算模型时answer可为空，由内核求解。不要编造任何缺失条件。'
    '切平面与区域最值题：先在给定点计算f_x、f_y的数值并保留正负号，再写z-z0=f_x(x-x0)+f_y(y-y0)；'
    '投影区域D的每条边界必须由该平面与坐标平面的交线推出，不得直接写常数；输出前把已知点代回平面核对。'
    'answer只写最终结论，必须与steps最后一步一致；多小问按(1)(2)逐问作答，不得保留草稿或中间数字。'
)


def contract_payload():
    response_schema = {'type': 'object', 'properties': {
        'question': {'type': 'string', 'minLength': 1, 'maxLength': 12000},
        'model': {'anyOf': [GENERIC_SCHEMA, _object({
            'kind': {'const': 'kernel'}, 'task': TEXT,
            'conditions': {'type': 'object'}, 'subject': TEXT}, ['kind', 'task', 'conditions']),
            {'type': 'object', 'properties': {'kind': {'enum': [
                'evaluate', 'equations', 'double_integral', 'existing', 'none']}}, 'required': ['kind']}]},
        'answer': {'type': 'string'}, 'steps': {'type': 'array', 'items': {'type': 'object'}},
    }, 'required': ['model', 'question']}
    return {'generic_schema': GENERIC_SCHEMA, 'model_examples': MODEL_EXAMPLES,
            'response_schema': response_schema,
            'model_instructions': MODEL_INSTRUCTIONS}


def normalize_plan(plan: Mapping[str, Any]) -> dict:
    """Adapt unambiguous representations, preserving the strict kernel boundary."""
    if not isinstance(plan, Mapping):
        raise ValueError('模型必须是JSON对象')
    if len(json.dumps(plan, ensure_ascii=False, allow_nan=False)) > 15000:
        raise ValueError('模型结构超过大小上限')
    plan = deepcopy(dict(plan))
    if plan.get('kind') == 'kernel':
        from .kernel_models import TASKS
        spec = TASKS.get(plan.get('task'))
        if spec:
            conditions = plan.setdefault('conditions', {})
            if isinstance(conditions, dict):
                for key in (set(spec['required']) | set(spec['optional'])) - {'kind', 'task', 'subject', 'conditions'}:
                    if key in plan:
                        if key in conditions and conditions[key] != plan[key]:
                            raise ValueError(f'顶层与conditions中的{key}冲突')
                        conditions[key] = plan.pop(key)
                # Kernels take "x,y"; providers often send ["x","y"]. Both are
                # unambiguous, so adapt instead of failing the whole model.
                # constrained_extrema/optimization keep the declared list shape.
                raw = conditions.get('variables')
                if (plan.get('task') not in ('constrained_extrema', 'optimization')
                        and isinstance(raw, (list, tuple)) and raw
                        and all(isinstance(item, str) for item in raw)):
                    conditions['variables'] = ','.join(item.strip() for item in raw)
        return plan
    if plan.get('kind') != 'generic':
        return plan
    for field in ('symbols', 'constants'):
        raw = plan.get(field, [])
        if isinstance(raw, dict):
            raw = [dict(value, name=name) if isinstance(value, dict) else
                   {'name': name, **({'value': value} if field == 'constants' else
                                    {'role': value} if value in ('unknown', 'parameter', 'independent') else {'label': str(value)})}
                   for name, value in raw.items()]
        if isinstance(raw, list):
            plan[field] = [{'name': item, 'role': 'unknown'} if isinstance(item, str) and field == 'symbols'
                           else item for item in raw]
    symbols, constants = plan.get('symbols'), plan.get('constants')
    if not isinstance(symbols, list) or not isinstance(constants, list):
        return plan
    # A fixed parameter listed twice is a constant. Unknowns remain a validation error.
    fixed = {item.get('name') for item in constants if isinstance(item, dict)}
    plan['symbols'] = [item for item in symbols if not (isinstance(item, dict)
                        and item.get('name') in fixed and item.get('role') == 'parameter')]
    from .generic_model import _RESERVED
    used = {str(item.get('name')) for item in plan['symbols'] + constants if isinstance(item, dict)}
    aliases = {}
    for index, item in enumerate(constants):
        if not isinstance(item, dict):
            continue
        name = item.get('name')
        if isinstance(name, str) and name and not name.isascii() and name.isidentifier():
            replacement = f'c{index + 1}'
            while replacement in used or replacement in _RESERVED:
                replacement += '_'
            used.add(replacement)
            aliases[name] = replacement
            item.update(name=replacement, label=item.get('label') or name)

    def rename(value):
        if not isinstance(value, str) or not aliases:
            return value
        return re.sub(r'\b(?:' + '|'.join(re.escape(k) for k in sorted(aliases, key=len, reverse=True)) + r')\b',
                      lambda match: aliases[match.group()], value)

    steps = plan.get('steps')
    if plan.get('equations') and (not steps or isinstance(steps, list) and all(
            isinstance(step, dict) and not step.get('op') for step in steps)):
        steps = [{'id': 's1', 'op': 'solve', 'equations': plan['equations'],
                  'for': [item['name'] for item in plan['symbols'] if isinstance(item, dict) and item.get('name')]}]
        plan['steps'] = steps
    if isinstance(steps, list):
        for step in steps:
            if not isinstance(step, dict):
                continue
            for key in ('expr', 'equation', 'left', 'right', 'var', 'variable', 'point', 'lower', 'upper'):
                if key in step:
                    value = step[key]
                    step[key] = rename(str(value) if type(value) in (int, float) else value)
            if isinstance(step.get('equations'), list):
                step['equations'] = [rename(value) for value in step['equations']]
            if step.get('op') in ('evaluate', 'simplify') and isinstance(step.get('expr'), str):
                expr = step['expr']
                if expr.count('=') == 1:
                    lhs, rhs = expr.split('=')
                    if lhs.strip().isidentifier() and rhs.strip():
                        step['expr'] = rhs.strip()
        target = plan.get('target')
        if isinstance(target, str) and steps:
            ids = [s.get('id', f's{i+1}') for i, s in enumerate(steps) if isinstance(s, dict)]
            if ids:
                selectors = set()
                last_step = steps[-1] if isinstance(steps[-1], dict) else {}
                if last_step.get('op') == 'solve':
                    requested = last_step.get('for')
                    if isinstance(requested, str):
                        requested = [part.strip() for part in requested.split(',')]
                    if requested is None:
                        requested = [last_step['variable']] if last_step.get('variable') else [
                            item.get('name') for item in plan['symbols'] if isinstance(item, dict)
                            and item.get('role', 'unknown') == 'unknown']
                    if isinstance(requested, list):
                        selectors.update(name for name in requested if isinstance(name, str))
                if last_step.get('op') == 'extremum':
                    selectors.update(('min', 'max'))
                if target in ids or re.fullmatch(r's[0-9]+', target):
                    plan['target'] = {'step': target}
                elif target in selectors:
                    plan['target'] = {'step': ids[-1], 'label': rename(target)}
                else:
                    raise ValueError('target 无法明确映射到步骤或结果分量')
    if isinstance(plan.get('plot'), dict):
        for key in ('expr', 'var'):
            if key in plan['plot']:
                plan['plot'][key] = rename(plan['plot'][key])
    return plan

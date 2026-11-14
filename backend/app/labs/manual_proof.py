"""User-confirmed proof and comprehensive-problem inputs."""
from __future__ import annotations

from typing import Any, Mapping

import sympy as sp

from .expr import expression_text, parse_expression, safe_float, to_latex
from .proof import build_proof_problem, solve_proof

X = sp.Symbol('x', real=True)

KINDS = ('ivt_root', 'ivt_unique_root', 'rolle', 'mvt', 'cauchy_mvt',
         'monotone_inequality', 'inequality', 'counterexample', 'steps')
KIND_LABELS = {
    'ivt_root': '零点存在性（介值定理）',
    'ivt_unique_root': '零点存在且唯一（介值定理+单调性）',
    'rolle': '罗尔定理',
    'mvt': '拉格朗日中值定理',
    'cauchy_mvt': '柯西中值定理',
    'monotone_inequality': '函数不等式（单调性，f≥0）',
    'inequality': '函数不等式（两个函数作差）',
    'counterexample': '反例否定全称命题',
    'steps': '综合题步骤核对',
}
REQUIRED = {
    'ivt_root': ('expression', 'lower', 'upper'),
    'ivt_unique_root': ('expression', 'lower', 'upper'),
    'rolle': ('expression', 'lower', 'upper'),
    'mvt': ('expression', 'lower', 'upper'),
    'cauchy_mvt': ('left', 'right', 'lower', 'upper'),
    'monotone_inequality': ('expression', 'lower', 'upper'),
    'inequality': ('left', 'right', 'relation', 'lower', 'upper'),
    'counterexample': ('left', 'right', 'relation', 'point'),
    'steps': ('steps',),
}
OPTIONAL = {
    'ivt_root': ('statement',), 'ivt_unique_root': ('statement',), 'rolle': ('statement',),
    'mvt': ('statement',), 'cauchy_mvt': ('statement',), 'monotone_inequality': ('statement',),
    'inequality': ('statement',), 'counterexample': ('statement',), 'steps': ('statement',),
}


def label_for(kind: str, key: str) -> str:
    mapping = {
        'proof_kind': '证明类型',
        'expression': '函数 f(x)',
        'left': '左式 f 或左端函数',
        'right': '右式 g 或右端函数',
        'relation': '关系符号',
        'lower': '区间下限',
        'upper': '区间上限',
        'point': '反例点 x0',
        'steps': '证明步骤（每行一个等式）',
        'statement': '命题陈述（可选）',
    }
    if kind == 'cauchy_mvt':
        return {'left': '函数 f(x)', 'right': '函数 g(x)'}.get(key, mapping[key])
    return mapping[key]


def labels(c: Mapping[str, Any]) -> dict[str, str]:
    kind = str(c.get('proof_kind') or '')
    return {key: label_for(kind, key) for key in c}


CERTIFICATE_LABELS = {
    'theorem': '定理/模板', 'conclusion': '结论', 'expression': '函数表达式',
    'interval': '区间', 'derivative': '导数', 'slope': '中值斜率',
    'witnesses': '可选零点', 'strictly_increasing': '严格递增',
    'strictly_decreasing': '严格递减', 'increasing': '单调递增', 'decreasing': '单调递减',
    'left': '左端函数/左式', 'right': '右端函数/右式', 'relation': '关系符号',
    'difference': '作差函数', 'point': '反例点', 'left_value': '左式值',
    'right_value': '右式值',
}


def certificate_facts(certificate: Mapping[str, Any]) -> list[dict[str, str]]:
    facts = []
    for key, value in certificate.items():
        if key in ('steps',):
            continue
        label = CERTIFICATE_LABELS.get(key, key)
        if isinstance(value, list):
            text = '、'.join(str(item) for item in value)
        elif isinstance(value, dict):
            continue
        elif isinstance(value, bool):
            text = '是' if value else '否'
        else:
            text = str(value)
        facts.append({'label': label, 'text': text})
    return facts


def _text_expr(raw: Any, label: str) -> str:
    if not isinstance(raw, str) or not raw.strip() or len(raw) > 600:
        raise ValueError(f'{label}必须是600字以内的表达式')
    try:
        value = parse_expression(raw.strip(), ('x',), preserve_structure=True)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f'{label}无法解析：{exc}') from exc
    return expression_text(value)


def _text_constant(raw: Any, label: str) -> str:
    if isinstance(raw, bool) or raw is None or not str(raw).strip():
        raise ValueError(f'{label}必须是有限实常数')
    try:
        value = parse_expression(str(raw).strip(), ('c0',))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f'{label}无法解析：{exc}') from exc
    if value.free_symbols or value.is_real is False or safe_float(value) is None:
        raise ValueError(f'{label}必须是有限实常数')
    return expression_text(value.xreplace(
        {node: sp.Rational(str(node)) for node in value.atoms(sp.Float)}))


def _step_expr(raw: str, label: str) -> str:
    try:
        value = parse_expression(raw, ('x',), preserve_structure=True)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f'{label}无法解析：{exc}') from exc
    return expression_text(value)


def _statement(raw: Any) -> str:
    if raw is None:
        return ''
    if not isinstance(raw, str) or len(raw) > 600:
        raise ValueError('命题陈述必须是600字以内的文字')
    return raw.strip()


def _steps(raw: Any) -> list[str]:
    if isinstance(raw, str):
        lines = [line.strip() for line in raw.splitlines() if line.strip()]
    elif isinstance(raw, list):
        lines = [str(line).strip() for line in raw if str(line).strip()]
    else:
        raise ValueError('证明步骤必须是文本或字符串数组')
    if not 1 <= len(lines) <= 20:
        raise ValueError('证明步骤需要1至20行')
    normalized = []
    for index, line in enumerate(lines, start=1):
        if line.count('=') != 1:
            raise ValueError(f'第 {index} 步必须是 lhs=rhs 形式')
        left, right = line.split('=')
        if not left.strip() or not right.strip():
            raise ValueError(f'第 {index} 步等式两边不能为空')
        normalized.append(f'{_step_expr(left.strip(), f"第 {index} 步左式")}='
                          f'{_step_expr(right.strip(), f"第 {index} 步右式")}')
    return normalized


def _interval(conditions: Mapping[str, Any]) -> tuple[str, str]:
    lower = _text_constant(conditions['lower'], '区间下限')
    upper = _text_constant(conditions['upper'], '区间上限')
    if not bool(parse_expression(lower) < parse_expression(upper)):
        raise ValueError('区间下限必须小于上限')
    return lower, upper


def _relation(kind: str, raw: Any) -> str:
    value = str(raw or ('>=' if kind == 'inequality' else '>='))
    allowed = ('>=', '<=') if kind == 'inequality' else ('>=', '<=', '>', '<', '=')
    if value not in allowed:
        raise ValueError('关系符号不符合该证明类型')
    return value


def parse_inputs(conditions: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(conditions, Mapping):
        raise ValueError('证明条件格式不正确')
    kind = str(conditions.get('proof_kind') or '')
    if kind not in REQUIRED:
        raise ValueError('请选择具体的证明或综合题类型')
    expected = {'proof_kind', *REQUIRED[kind], *OPTIONAL[kind]}
    missing = [label_for(kind, key) for key in ('proof_kind', *REQUIRED[kind])
               if key not in conditions or conditions[key] == '']
    if missing:
        raise ValueError('需要补充条件：' + '、'.join(missing))
    extra = set(conditions) - expected
    if extra:
        raise ValueError('存在该类型不能消费的条件：' + ', '.join(sorted(extra)))
    normalized: dict[str, Any] = {'proof_kind': kind}
    if kind == 'steps':
        normalized['steps'] = _steps(conditions['steps'])
    else:
        if kind == 'counterexample':
            normalized['left'] = _text_expr(conditions['left'], '左式')
            normalized['right'] = _text_expr(conditions['right'], '右式')
            normalized['relation'] = _relation(kind, conditions.get('relation'))
            normalized['point'] = _text_constant(conditions['point'], '反例点')
        elif kind in ('cauchy_mvt', 'inequality'):
            normalized['left'] = _text_expr(conditions['left'], label_for(kind, 'left'))
            normalized['right'] = _text_expr(conditions['right'], label_for(kind, 'right'))
            if kind == 'inequality':
                normalized['relation'] = _relation(kind, conditions.get('relation'))
        else:
            normalized['expression'] = _text_expr(conditions['expression'], '函数 f(x)')
        if 'lower' in REQUIRED[kind]:
            normalized['lower'], normalized['upper'] = _interval(conditions)
    statement = _statement(conditions.get('statement'))
    if statement:
        normalized['statement'] = statement
    solve_proof({**normalized, 'conditions': normalized})
    return normalized


def _preview_latex(kind: str, c: Mapping[str, Any]) -> str:
    def fx() -> str:
        return to_latex(parse_expression(c['expression'], ('x',), preserve_structure=True))

    interval = (rf'\left[{to_latex(parse_expression(c["lower"]))},'
                rf'{to_latex(parse_expression(c["upper"]))}\right]'
                if 'lower' in c and 'upper' in c else '')
    if kind == 'ivt_root':
        return rf'f(x)={fx()},\quad x\in {interval},\quad 证明存在 c 使 f(c)=0'
    if kind == 'ivt_unique_root':
        return rf'f(x)={fx()},\quad x\in {interval},\quad 证明 f(x)=0 有唯一实根'
    if kind == 'rolle':
        return rf'f(x)={fx()},\quad x\in {interval},\quad 证明存在 \xi 使 f\'(\xi)=0'
    if kind == 'mvt':
        return rf'f(x)={fx()},\quad x\in {interval},\quad f\'(\xi)=\frac{{f(b)-f(a)}}{{b-a}}'
    if kind == 'cauchy_mvt':
        return (rf'f(x)={to_latex(parse_expression(c["left"], ("x",), preserve_structure=True))},\quad '
                rf'g(x)={to_latex(parse_expression(c["right"], ("x",), preserve_structure=True))},\quad x\in {interval}')
    if kind == 'monotone_inequality':
        return rf'证明 f(x)={fx()}\ge 0,\quad x\in {interval}'
    if kind == 'inequality':
        relation = {'>=': r'\ge', '<=': r'\le'}[c['relation']]
        return (rf'证明 {to_latex(parse_expression(c["left"], ("x",), preserve_structure=True))} {relation} '
                rf'{to_latex(parse_expression(c["right"], ("x",), preserve_structure=True))},\quad x\in {interval}')
    if kind == 'counterexample':
        return (rf'全称命题：{to_latex(parse_expression(c["left"], ("x",), preserve_structure=True))} '
                rf'{c["relation"]} {to_latex(parse_expression(c["right"], ("x",), preserve_structure=True))},\quad '
                rf'取 x_0={to_latex(parse_expression(c["point"]))} 作为反例')
    if kind == 'steps':
        return rf'综合题步骤核对：{len(c["steps"])} 个等式步骤'
    raise ValueError('暂不支持该证明类型')


def _question(kind: str, c: Mapping[str, Any]) -> str:
    if kind == 'ivt_root':
        return f'证明方程 f(x)={c["expression"]}=0 在 [{c["lower"]},{c["upper"]}] 上存在实根。'
    if kind == 'ivt_unique_root':
        return f'证明方程 f(x)={c["expression"]}=0 在 [{c["lower"]},{c["upper"]}] 上存在且仅有一个实根。'
    if kind == 'rolle':
        return f'验证并证明 f(x)={c["expression"]} 在 [{c["lower"]},{c["upper"]}] 上满足罗尔定理，并说明存在 f\'(ξ)=0。'
    if kind == 'mvt':
        return f'验证并证明 f(x)={c["expression"]} 在 [{c["lower"]},{c["upper"]}] 上满足拉格朗日中值定理。'
    if kind == 'cauchy_mvt':
        return f'验证并证明 f(x)={c["left"]}、g(x)={c["right"]} 在 [{c["lower"]},{c["upper"]}] 上满足柯西中值定理。'
    if kind == 'monotone_inequality':
        return f'用单调性证明不等式 f(x)={c["expression"]}≥0，x∈[{c["lower"]},{c["upper"]}]。'
    if kind == 'inequality':
        return f'用单调性证明不等式 {c["left"]} {c["relation"]} {c["right"]}，x∈[{c["lower"]},{c["upper"]}]。'
    if kind == 'counterexample':
        return (f'判断全称命题 {c["left"]} {c["relation"]} {c["right"]} 是否成立；'
                f'取 x0={c["point"]} 核对是否为反例。')
    if kind == 'steps':
        return '核对综合题的局部等式步骤；不把局部步骤通过当作整体证明完成。'
    raise ValueError('暂不支持该证明类型')


def _record_conditions(conditions: Mapping[str, Any]) -> dict[str, Any]:
    record = dict(conditions)
    if isinstance(record.get('steps'), list):
        record['steps'] = '\n'.join(record['steps'])
    return record


def preview(conditions: dict[str, Any]) -> dict[str, Any]:
    normalized = parse_inputs(conditions)
    kind = normalized['proof_kind']
    return {
        'task': 'proof',
        'label': KIND_LABELS[kind],
        'conditions': _record_conditions(normalized),
        'latex': _preview_latex(kind, normalized),
        'question': _question(kind, normalized),
    }


def build_problem(c: dict[str, Any]) -> dict[str, Any]:
    from .exam_math import _condition

    normalized = parse_inputs(c)
    kind = normalized['proof_kind']
    problem = build_proof_problem({**normalized, 'conditions': normalized})
    preview_data = preview(normalized)
    problem['model']['modeling_task'] = 'proof'
    problem['model']['manual_proof_conditions'] = normalized
    problem['model']['formula_tex'] = preview_data['latex']
    record = _record_conditions(normalized)
    condition_fields = [
        _condition(key, label_for(kind, key), value, {})
        for key, value in record.items()
    ]
    for field in condition_fields:
        if field['id'] == 'proof_kind':
            field['editable'] = False
    problem['recognition']['conditions'] = condition_fields
    problem['conditions'] = condition_fields
    formula = {'id': 'proof', 'tex': preview_data['latex'],
               'plain': preview_data['label'], 'role': preview_data['label']}
    problem['recognition']['formulas'] = [formula]
    problem['formulas'] = [formula]
    problem['text'] = preview_data['question']
    problem['title'] = preview_data['label']
    return problem


__all__ = ['KIND_LABELS', 'KINDS', 'build_problem', 'label_for', 'labels', 'parse_inputs', 'preview']

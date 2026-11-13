"""Equality-constrained extrema via Lagrange multipliers (two variables, one constraint)."""
from __future__ import annotations

import math
from typing import Any, Mapping

import sympy as sp

from .expr import expression_text, parse_expression, safe_float, to_latex

X, Y = sp.symbols('x y', real=True)
LAMBDA = sp.Symbol('lambda', real=True)


def _parse(raw: Any, label: str) -> sp.Expr:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError(f'缺少{label}')
    value = parse_expression(raw, ('x', 'y'))
    if sp.count_ops(value) > 80:
        raise ValueError(f'{label}超出当前计算预算')
    return value


def _split_constraint(raw: str) -> tuple[str, str]:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError('缺少等式约束')
    text = raw.strip()
    if any(symbol in text for symbol in ('<=', '>=', '≤', '≥', '<', '>')):
        raise ValueError('当前只支持等式约束 g(x,y)=0，不能把不等式当作等式处理')
    if text.count('=') > 1:
        raise ValueError('约束等式中只能有一个等号')
    if '=' in text:
        left, right = text.split('=')
        return left.strip(), right.strip()
    return text, '0'


def build_constrained_problem(conditions: Mapping[str, Any]) -> dict:
    """Build a minimal optimization problem for a single equality constraint."""
    from .exam_math import _condition
    objective_raw = str(conditions.get('expression') or '').strip()
    variables = list(conditions.get('variables') or ['x', 'y'])
    if variables != ['x', 'y']:
        raise ValueError('等式约束极值当前只支持 x、y 两个变量')
    objective = _parse(objective_raw, '目标函数')
    left, right = _split_constraint(str(conditions.get('constraint') or ''))
    constraint = _parse(f'({left})-({right})', '约束表达式')
    model = {
        'engine': 'constrained_extrema_v1', 'subject': 'optimization',
        'task': 'constrained_extrema', 'kind': 'constrained_extrema',
        'expression': expression_text(objective), 'variables': ['x', 'y'],
        'constraint': f'{left} = {right}', 'constraint_expression': expression_text(constraint),
        'defaults': {}, 'params': [], 'teaching': False,
        'formula_tex': rf'\nabla f=\lambda\nabla g,\quad {to_latex(constraint)}=0',
    }
    conditions_list = [
        _condition('expression', '目标函数', expression_text(objective), {}, kind='expr'),
        _condition('constraint', '等式约束', model['constraint'], {}, kind='expr'),
    ]
    formulas = [
        {'id': 'objective', 'tex': to_latex(objective), 'plain': model['expression'], 'role': '目标函数'},
        {'id': 'constraint', 'tex': f'{to_latex(constraint)}=0', 'plain': model['constraint'], 'role': '等式约束'},
    ]
    return {
        'problem_id': 'prb_constrained', 'number': None, 'title': '等式约束极值', 'text': '',
        'subject': 'optimization', 'subject_label': '最优化', 'confidence': 1.0, 'status': 'ready',
        'source': {'page_from': 1, 'page_to': 1, 'file_names': [], 'label': '声明式条件', 'excerpt': ''},
        'source_pages': [],
        'recognition': {
            'method': 'declarative_kernel', 'raw_text': '', 'conditions': conditions_list,
            'ambiguities': [], 'formulas': formulas, 'recognized_subject': 'optimization', 'ai_used': False,
        },
        'model': model,
        'solution': {},
        'states': {},
        'conditions': conditions_list,
        'ambiguities': [],
        'formulas': formulas,
        'recognized': True,
    }


def _classify_constrained(objective: sp.Expr, constraint: sp.Expr, point: Mapping[sp.Symbol, sp.Expr]) -> tuple[str, str]:
    gx, gy = sp.diff(constraint, X), sp.diff(constraint, Y)
    if sp.simplify(gx.subs(point)) == 0 and sp.simplify(gy.subs(point)) == 0:
        return 'undetermined', '约束梯度为零，拉格朗日乘数法退化'
    lagrangian = objective - LAMBDA * constraint
    bordered = sp.Matrix([
        [0, gx, gy],
        [gx, sp.diff(lagrangian, X, 2), sp.diff(lagrangian, X, Y)],
        [gy, sp.diff(lagrangian, X, Y), sp.diff(lagrangian, Y, 2)],
    ]).subs(point)
    determinant = sp.simplify(bordered.det())
    if determinant.is_negative:
        return 'minimum', f'加边 Hessian 行列式 {determinant} < 0'
    if determinant.is_positive:
        return 'maximum', f'加边 Hessian 行列式 {determinant} > 0'
    return 'undetermined', f'加边 Hessian 行列式 {determinant} = 0，二阶条件不足'


def solve_constrained_extrema(model: Mapping[str, Any]) -> dict:
    objective = _parse(model.get('expression'), '目标函数')
    constraint = _parse(model.get('constraint_expression'), '约束表达式')
    gx, gy = sp.diff(constraint, X), sp.diff(constraint, Y)
    if sp.simplify(gx) == 0 and sp.simplify(gy) == 0:
        raise ValueError('约束梯度恒为零，不能使用拉格朗日乘数法')
    equations = [sp.diff(objective, X) - LAMBDA * gx, sp.diff(objective, Y) - LAMBDA * gy, constraint]
    complete = True
    try:
        solutions = sp.solve(equations, [X, Y, LAMBDA], dict=True)
    except Exception:  # noqa: BLE001
        solutions = []
        complete = False
    if not isinstance(solutions, list):
        solutions = []
        complete = False
    candidates: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for item in solutions[:32]:
        if not isinstance(item, Mapping) or any(symbol not in item for symbol in (X, Y, LAMBDA)):
            complete = False
            continue
        if any(item[symbol].free_symbols or item[symbol].is_real is not True for symbol in (X, Y)):
            complete = False
            continue
        x_value, y_value = sp.simplify(item[X]), sp.simplify(item[Y])
        if safe_float(x_value) is None or safe_float(y_value) is None:
            complete = False
            continue
        residuals = [sp.simplify(equation.subs(item)) for equation in equations]
        if any(residual != 0 for residual in residuals):
            complete = False
            continue
        key = (str(x_value), str(y_value))
        if key in seen:
            continue
        seen.add(key)
        point = {X: x_value, Y: y_value, LAMBDA: sp.simplify(item[LAMBDA])}
        classification, evidence = _classify_constrained(objective, constraint, point)
        if classification == 'undetermined':
            complete = False
        candidates.append({
            'point': [str(x_value), str(y_value)],
            'point_values': [safe_float(x_value), safe_float(y_value)],
            'value': str(sp.simplify(objective.subs({X: x_value, Y: y_value}))),
            'lambda': str(sp.simplify(item[LAMBDA])),
            'classification': classification,
            'evidence': evidence,
        })
    # A finite solve returning zero solutions can still miss parameter branches;
    # sympy solve is treated as complete only if it returned a list of real candidates.
    if solutions == []:
        complete = False
    if len(solutions) > 32:
        complete = False
    labels = {'minimum': '极小值', 'maximum': '极大值', 'undetermined': '未定'}
    descriptions = [
        f"{labels.get(item['classification'], item['classification'])}点 ({', '.join(item['point'])})，"
        f"f={item['value']}，λ={item['lambda']}"
        for item in candidates
    ]
    if not complete:
        descriptions.append('拉格朗日方程组尚未证明完整或存在退化点，不能据此排除其他约束极值')
    answer = '；'.join(descriptions) if complete else ''
    return {
        'summary': '拉格朗日乘数法：解 ∇f=λ∇g 与 g=0，再用加边 Hessian 判别约束极小/极大。',
        'answer': answer,
        'answer_value': None,
        'exact': answer,
        'approx': None,
        'steps': [
            {'id': 'lagrange', 'title': '写出拉格朗日函数', 'latex': rf'L={to_latex(objective)}-\lambda({to_latex(constraint)})',
             'detail': '约束为等式 g(x,y)=0；λ 是拉格朗日乘数。'},
            {'id': 'system', 'title': '解乘数方程组', 'latex': r'\nabla f=\lambda\nabla g,\quad g=0',
             'detail': f'实驻点候选：{len(candidates)} 个。'},
            {'id': 'classify', 'title': '加边 Hessian 分类', 'latex': r'\det\begin{pmatrix}0&\nabla g^T\\\nabla g&L_{HH}\end{pmatrix}',
             'detail': '行列式为负判极小，为正判极大；为零时二阶条件不足。'},
        ],
        'conditions': ['约束为单个等式 g(x,y)=0；变量为 x、y。'],
        'limitations': [
            '当前只处理二元单个等式约束；不等式约束、多约束与边界分层尚未纳入。',
            '约束流形无界时，局部驻点分类不能直接外推为全局最值。',
        ],
        'constraint': model.get('constraint'),
        'constraint_expression': model.get('constraint_expression'),
        'candidates': candidates,
        'solution_status': 'complete' if complete else 'incomplete',
        'solution_complete': complete,
        'incomplete_reason': None if complete else '拉格朗日方程组或加边 Hessian 尚未完成',
        'global_note': '拉格朗日乘数法只给出约束流形上的驻点；全局性需另行比较。',
    }


def evaluate_constrained_extrema(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict:
    solution = solve_constrained_extrema(model)
    candidates = solution.get('candidates') or []
    return {
        'subject': 'optimization', 'kind': 'constrained_extrema', 'task': 'constrained_extrema',
        'variables': ['x', 'y'],
        'headline': f'约束极值：{model.get("constraint", "")}',
        'metrics': [
            {'id': 'candidates', 'label': '约束驻点', 'value': str(len(candidates)), 'accent': True},
            {'id': 'minimum', 'label': '极小点', 'value': str(sum(1 for item in candidates if item['classification'] == 'minimum'))},
            {'id': 'maximum', 'label': '极大点', 'value': str(sum(1 for item in candidates if item['classification'] == 'maximum'))},
        ],
        'checks': [
            {'id': 'lagrange', 'label': '乘数方程组', 'status': 'pass' if solution.get('solution_complete') else 'fail',
             'detail': '全部候选均代回 ∇f=λ∇g 与约束方程。' if solution.get('solution_complete') else solution.get('incomplete_reason', '')},
            {'id': 'classification', 'label': '加边 Hessian 分类', 'status': 'pass' if solution.get('solution_complete') else 'warn',
             'detail': '非退化候选已按加边 Hessian 分类。' if solution.get('solution_complete') else '存在未定或退化点。'},
        ],
        'notes': [solution.get('global_note', '')],
        'series': [], 'grid': None, 'domain': {},
        'trajectory': [], 'current': None, 'loss': None, 'grad_norm': None,
        'stop_reason': '约束驻点枚举', 'converged': bool(solution.get('solution_complete')), 'diverged': False,
        'exactPoint': None, 'exactValue': None,
        'globalNote': solution.get('global_note', ''), 'bounds': {},
        'exact': solution.get('exact'),
        'constraint': model.get('constraint'),
        'constraint_tex': model.get('formula_tex'),
        'candidates': candidates,
        'checks_detail': solution,
        'trace': [
            {'index': index, 'label': item['point'], 'detail': item['evidence'], 'values': item}
            for index, item in enumerate(candidates)
        ] or [{'index': 0, 'label': '约束驻点', 'detail': solution.get('answer') or solution.get('incomplete_reason') or '待核对', 'values': {}}],
    }


__all__ = ['build_constrained_problem', 'evaluate_constrained_extrema', 'solve_constrained_extrema']

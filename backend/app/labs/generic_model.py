"""通用符号模型：AI 只声明变量、关系与运算步骤，由白名单 sympy 内核逐步执行。

模型不使用 AI 生成的代码。表达式复用 :mod:`app.labs.expr` 的受限解析器，
每一步都记录输入输出，求解结果再用代回或数值对照独立核验。
"""
from __future__ import annotations

import math
import re
from typing import Any, Mapping

import sympy as sp

from .expr import FUNCTIONS, parse_expression, safe_float, to_latex

ENGINE = 'generic_v1'
MAX_SYMBOLS = 6
MAX_STEPS = 6
MAX_SOLUTIONS = 16
MAX_TEXT = 800
MAX_OPS = 120

_STEP_ID = re.compile(r'^s[1-9][0-9]?$')
_NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_]*$')
_RESERVED = set(FUNCTIONS) | {'pi', 'e', 'oo', 'nan', 'zoo', 'inf', 'infinity'}
_SYMBOL_ROLES = {'independent', 'unknown', 'parameter'}
_DOMAINS = {'real', 'positive', 'nonnegative', 'integer', 'positive_integer'}
_POINT_WORDS = {'oo': sp.oo, '+oo': sp.oo, 'inf': sp.oo, '+inf': sp.oo, 'infinity': sp.oo,
                '-oo': -sp.oo, '-inf': -sp.oo, '-infinity': -sp.oo}

OPS = {
    'evaluate': '代入数值求值',
    'simplify': '化简',
    'solve': '解方程或方程组',
    'limit': '极限',
    'diff': '求导',
    'integrate': '积分',
    'series': '级数展开',
    'sum': '求和',
    'extremum': '区间最值',
    'inequality': '解不等式',
}

_STEP_FIELDS = {'id', 'op', 'expr', 'equation', 'equations', 'for', 'variable', 'var', 'point',
                'side', 'order', 'lower', 'upper', 'relation', 'left', 'right', 'label', 'title'}


class GenericModelError(ValueError):
    pass


def _text(value: Any, name: str, *, limit: int = MAX_TEXT) -> str:
    if not isinstance(value, str) or not value.strip():
        raise GenericModelError(f'步骤缺少{name}')
    if len(value) > limit:
        raise GenericModelError(f'步骤{name}过长')
    return value.strip()


def _parse(raw: str, names: list[str], *, label: str = '表达式') -> sp.Expr:
    try:
        value = parse_expression(raw, names or ['dummy'])
    except Exception as exc:  # noqa: BLE001 - 统一成建模错误
        raise GenericModelError(f'{label}无法解析：{exc}') from exc
    if sp.count_ops(value, visual=False) > MAX_OPS:
        raise GenericModelError(f'{label}超出通用符号模型的计算预算')
    return value


def _number_value(raw: Any, name: str) -> sp.Expr:
    if isinstance(raw, bool) or raw is None:
        raise GenericModelError(f'常数 {name} 必须是数值')
    if isinstance(raw, (int, float)):
        if not math.isfinite(float(raw)):
            raise GenericModelError(f'常数 {name} 必须是有限数值')
        return sp.nsimplify(raw)
    value = _parse(_text(raw, f'常数 {name} 的取值', limit=120), ['dummy'], label=f'常数 {name}')
    if value.free_symbols or safe_float(value) is None:
        raise GenericModelError(f'常数 {name} 必须是不含变量的有限数值')
    return sp.simplify(value)


def _finite(raw: Any, name: str) -> float:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(float(raw)):
        raise GenericModelError(f'{name}必须是有限数值')
    return float(raw)


def _point(raw: str, names: list[str], label: str = 'point') -> sp.Expr:
    text = _text(raw, label, limit=120)
    if text.replace(' ', '') in _POINT_WORDS:
        return _POINT_WORDS[text.replace(' ', '')]
    value = _parse(text, names or ['dummy'], label=label)
    if value.free_symbols:
        raise GenericModelError(f'{label}必须是数值或无穷远')
    return value


def _bound(raw: str, names: list[str], label: str = 'bound') -> sp.Expr:
    text = _text(raw, label, limit=120)
    if text.replace(' ', '') in _POINT_WORDS:
        return _POINT_WORDS[text.replace(' ', '')]
    return _parse(text, names or ['dummy'], label=label)


def compile_generic(plan: Mapping[str, Any]) -> dict[str, Any]:
    """Validate an AI-declared generic plan and build the interactive model."""
    if not isinstance(plan, Mapping):
        raise GenericModelError('通用模型必须是对象')
    raw_symbols = plan.get('symbols') or []
    if not isinstance(raw_symbols, list):
        raise GenericModelError('symbols 必须是符号对象数组')
    if len(raw_symbols) > MAX_SYMBOLS:
        raise GenericModelError('符号最多 6 个')
    symbols: list[dict[str, Any]] = []
    names: list[str] = []
    for index, item in enumerate(raw_symbols):
        if not isinstance(item, Mapping):
            raise GenericModelError('符号定义必须是对象')
        name = str(item.get('name') or '').strip()
        if not _NAME.fullmatch(name) or name in _RESERVED or len(name) > 24:
            raise GenericModelError(f'符号名不合法：{name or index + 1}')
        if name in names:
            raise GenericModelError(f'符号重复：{name}')
        role = str(item.get('role') or 'unknown')
        domain = str(item.get('domain') or 'real')
        if role not in _SYMBOL_ROLES:
            raise GenericModelError(f'符号 {name} 的角色不受支持')
        if domain not in _DOMAINS:
            raise GenericModelError(f'符号 {name} 的取值范围不受支持')
        names.append(name)
        symbols.append({'name': name, 'role': role, 'domain': domain,
                        'label': str(item.get('label') or name)[:60]})
    if not symbols and any(isinstance(step, Mapping) and step.get('op') not in ('evaluate', 'simplify')
                           for step in plan.get('steps') or []):
        raise GenericModelError('该模型至少需要一个符号')

    raw_constants = plan.get('constants') or []
    if not isinstance(raw_constants, list):
        raise GenericModelError('constants 必须是常数对象数组')
    if len(raw_constants) > 12:
        raise GenericModelError('常数最多 12 个')
    constants: list[dict[str, Any]] = []
    defaults: dict[str, Any] = {}
    params: list[dict[str, Any]] = []
    for item in raw_constants:
        if not isinstance(item, Mapping):
            raise GenericModelError('常数定义必须是对象')
        name = str(item.get('name') or '').strip()
        if not _NAME.fullmatch(name) or name in _RESERVED or len(name) > 24:
            raise GenericModelError(f'常数名不合法：{name}')
        if name in names:
            raise GenericModelError(f'名称重复：{name}')
        value = _number_value(item.get('value'), name)
        value_float = safe_float(value)
        if value_float is None:
            raise GenericModelError(f'常数 {name} 必须是有限实数')
        tunable = bool(item.get('tunable'))
        minimum = _finite(item.get('min'), f'常数 {name} 的下限') if item.get('min') is not None else value_float - max(1.0, abs(value_float) * 4)
        maximum = _finite(item.get('max'), f'常数 {name} 的上限') if item.get('max') is not None else value_float + max(1.0, abs(value_float) * 4)
        if minimum > maximum:
            raise GenericModelError(f'常数 {name} 的滑杆范围不合法')
        if value_float < minimum - 1e-9 or value_float > maximum + 1e-9:
            raise GenericModelError(f'常数 {name} 的取值不在滑杆范围内')
        names.append(name)
        label = str(item.get('label') or name)[:60]
        constants.append({'name': name, 'label': label, 'value': value_float, 'source': str(item.get('source') or '')[:200],
                          'tunable': tunable, 'min': minimum, 'max': maximum})
        defaults[name] = value_float
        if tunable:
            span = maximum - minimum
            step = span / 100 if span > 0 else 0.1
            params.append({'id': name, 'label': label, 'min': minimum, 'max': maximum,
                           'step': step, 'value': value_float, 'note': str(item.get('source') or '')[:120]})

    raw_steps = plan.get('steps')
    if not isinstance(raw_steps, list) or not 1 <= len(raw_steps) <= MAX_STEPS:
        raise GenericModelError('通用模型的运算步骤应为 1 至 6 步')
    steps: list[dict[str, Any]] = []
    step_ids: list[str] = []
    for index, item in enumerate(raw_steps):
        if not isinstance(item, Mapping):
            raise GenericModelError('运算步骤必须是对象')
        step_id = str(item.get('id') or f's{index + 1}').strip()
        if not _STEP_ID.fullmatch(step_id) or step_id in step_ids:
            raise GenericModelError(f'步骤编号不合法或重复：{step_id}')
        op = str(item.get('op') or '').strip()
        if op not in OPS:
            raise GenericModelError(f'步骤 {step_id} 的运算 {op or "（空）"} 不受支持')
        step: dict[str, Any] = {'id': step_id, 'op': op}
        available = names + step_ids
        if op in ('evaluate', 'simplify', 'limit', 'diff', 'integrate', 'series', 'sum', 'extremum'):
            step['expr'] = _text(item.get('expr'), f'步骤 {step_id} 的表达式')
            _parse(step['expr'], available + [], label=f'步骤 {step_id} 的表达式')
        if op in ('limit', 'diff', 'integrate', 'series', 'sum', 'extremum'):
            step['var'] = _text(item.get('var') or item.get('variable'), f'步骤 {step_id} 的变量', limit=24)
            if step['var'] not in names:
                raise GenericModelError(f'步骤 {step_id} 的变量未在符号中声明')
        if op in ('limit', 'series'):
            step['point'] = _text(item.get('point') or '0', f'步骤 {step_id} 的趋近点', limit=120)
            _point(step['point'], available, label=f'步骤 {step_id} 的趋近点')
        if op == 'limit':
            side = str(item.get('side') or 'both')
            if side not in ('both', 'left', 'right'):
                raise GenericModelError('极限方向只能是 both、left 或 right')
            step['side'] = side
        if op in ('diff', 'series'):
            order = item.get('order', 1 if op == 'diff' else 6)
            if isinstance(order, bool) or not isinstance(order, int) or not 1 <= order <= 12:
                raise GenericModelError(f'步骤 {step_id} 的阶数应为 1 至 12 的整数')
            step['order'] = order
        if op in ('integrate', 'sum', 'extremum'):
            if item.get('lower') is not None:
                step['lower'] = _text(item.get('lower'), f'步骤 {step_id} 的下限', limit=120)
                _bound(step['lower'], available, label=f'步骤 {step_id} 的下限')
            if item.get('upper') is not None:
                step['upper'] = _text(item.get('upper'), f'步骤 {step_id} 的上限', limit=120)
                _bound(step['upper'], available, label=f'步骤 {step_id} 的上限')
        if op == 'diff' and item.get('point') is not None:
            step['point'] = _text(item.get('point'), f'步骤 {step_id} 的求值点', limit=120)
            _parse(step['point'], available, label=f'步骤 {step_id} 的求值点')
        if op == 'solve':
            equations = item.get('equations')
            equation = item.get('equation')
            if equations is not None:
                if not isinstance(equations, list) or not 1 <= len(equations) <= 6:
                    raise GenericModelError(f'步骤 {step_id} 的方程应为 1 至 6 个')
                raw_equations = [_text(value, f'步骤 {step_id} 的方程') for value in equations]
            else:
                raw_equations = [_text(equation, f'步骤 {step_id} 的方程')]
            for value in raw_equations:
                if value.count('=') != 1:
                    raise GenericModelError('方程必须写成左式=右式')
                left, right = value.split('=')
                _parse(f'({left})-({right})', available, label=f'步骤 {step_id} 的方程')
            step['equations'] = raw_equations
            requested = item.get('for')
            if isinstance(requested, str):
                requested = [part.strip() for part in requested.split(',') if part.strip()]
            if requested is None:
                requested = item.get('variable')
                requested = [requested] if isinstance(requested, str) else []
            if not isinstance(requested, list) or any(str(name) not in names for name in requested):
                raise GenericModelError(f'步骤 {step_id} 的求解变量未在符号中声明')
            step['for'] = [str(name) for name in requested if str(name) not in defaults]
        if op == 'inequality':
            if item.get('expr') is not None and item.get('left') is None:
                raw = _text(item.get('expr'), f'步骤 {step_id} 的不等式')
                match = re.match(r'^(.+?)(<=|>=|==|<|>)(.+)$', raw)
                if not match:
                    raise GenericModelError('不等式必须包含 >、>=、<、<= 之一')
                step['left'] = match.group(1).strip()
                step['right'] = match.group(3).strip()
                step['relation'] = match.group(2)
            else:
                step['left'] = _text(item.get('left'), f'步骤 {step_id} 的不等式左式')
                step['right'] = _text(item.get('right'), f'步骤 {step_id} 的不等式右式')
                step['relation'] = str(item.get('relation') or '>')
            if step['relation'] not in ('>', '>=', '<', '<=', '=', '=='):
                raise GenericModelError('不等式关系只能是 >、>=、<、<=、=')
            _parse(step['left'], available, label=f'步骤 {step_id} 的不等式左式')
            _parse(step['right'], available, label=f'步骤 {step_id} 的不等式右式')
            step['var'] = _text(item.get('var') or item.get('variable'), f'步骤 {step_id} 的变量', limit=24)
            if step['var'] not in names:
                raise GenericModelError(f'步骤 {step_id} 的变量未在符号中声明')
        step_ids.append(step_id)
        steps.append(step)

    target = plan.get('target') or {}
    if not isinstance(target, Mapping):
        raise GenericModelError('target 必须是对象')
    target_step = str(target.get('step') or step_ids[-1])
    if target_step not in step_ids:
        raise GenericModelError('target 指向了不存在的步骤')
    target_label = str(target.get('label') or '').strip()[:60]

    plot: dict[str, Any] | None = None
    raw_plot = plan.get('plot')
    if isinstance(raw_plot, Mapping):
        plot_expr = _text(raw_plot.get('expr'), '曲线表达式')
        plot_var = _text(raw_plot.get('var') or (symbols[0]['name'] if symbols else ''), '曲线变量', limit=24)
        if not plot_var:
            raise GenericModelError('曲线变量未声明')
        bounds = raw_plot.get('range')
        if not isinstance(bounds, list) or len(bounds) != 2:
            raise GenericModelError('曲线范围必须是 [下限, 上限]')
        low = _finite(bounds[0], '曲线范围下限')
        high = _finite(bounds[1], '曲线范围上限')
        if low >= high:
            raise GenericModelError('曲线范围下限必须小于上限')
        _parse(plot_expr, names + step_ids, label='曲线表达式')
        if plot_var not in names:
            raise GenericModelError('曲线变量未在符号中声明')
        plot = {'expr': plot_expr, 'var': plot_var, 'range': [low, high]}

    subject = str(plan.get('subject') or 'general')
    from .recognize import SUBJECT_LABELS
    if subject not in SUBJECT_LABELS or subject == 'unknown':
        subject = 'general'
    labels = {**SUBJECT_LABELS, 'general': '通用'}
    try:
        formula = _parse(plot['expr'], names + step_ids, label='曲线表达式') if plot else (
            _parse(steps[0].get('expr') or '0', names + step_ids) if steps[0]['op'] not in ('solve', 'inequality') else None)
    except Exception:  # noqa: BLE001 - 公式展示可降级
        formula = None
    return {
        'kind': 'generic', 'engine': ENGINE, 'subject': subject,
        'subject_label': labels[subject], 'teaching': False,
        'symbols': symbols, 'constants': constants, 'steps': steps,
        'target': {'step': target_step, 'label': target_label},
        'plot': plot, 'defaults': defaults, 'params': params,
        'formula_tex': to_latex(formula) if formula is not None else '',
        'modeling_task': 'generic', 'protocol': 'generic.symbolic.v1',
    }


def _value_text(value: Any, limit: int = 300) -> str:
    text = str(value)
    return text if len(text) <= limit else text[:limit - 1] + '…'


def _step_symbols(model: Mapping[str, Any]) -> dict[str, sp.Symbol]:
    names = [item['name'] for item in model.get('symbols') or []]
    names += [item['name'] for item in model.get('constants') or []]
    names += [item['id'] for item in model.get('steps') or []]
    return {name: sp.Symbol(name, real=True) for name in names}


def _substitute_refs(expr: sp.Expr, symbols: dict[str, sp.Symbol], results: dict[str, dict[str, Any]]) -> sp.Expr:
    replacements = {}
    for step_id, result in results.items():
        if step_id not in symbols:
            continue
        symbol = symbols[step_id]
        if symbol not in expr.free_symbols:
            continue
        if result['kind'] == 'scalar':
            replacements[symbol] = result['value']
        elif result['kind'] == 'solutions' and len(result['solutions']) == 1 and len(result['solutions'][0]) == 1:
            replacements[symbol] = next(iter(result['solutions'][0].values()))
        else:
            raise GenericModelError(f'步骤 {step_id} 的结果不是单个表达式，不能代入后续运算')
    return expr.xreplace(replacements) if replacements else expr


def _parse_step_expr(model: Mapping[str, Any], raw: str, symbols: dict[str, sp.Symbol]) -> sp.Expr:
    names = list(symbols)
    value = parse_expression(raw, names or ['dummy'])
    return value


def _subs_constants(expr: sp.Expr, model: Mapping[str, Any], params: Mapping[str, Any]) -> sp.Expr:
    replacements = {}
    for item in model.get('constants') or []:
        name = item['name']
        value = params.get(name, item.get('value'))
        try:
            numeric = sp.nsimplify(value)
        except Exception:  # noqa: BLE001
            numeric = sp.nsimplify(item.get('value'))
        replacements[sp.Symbol(name, real=True)] = numeric
    return expr.xreplace(replacements)


def _numeric(expr: sp.Expr) -> float | None:
    try:
        return safe_float(sp.N(expr, 15))
    except Exception:  # noqa: BLE001
        return None


def _domain_ok(value: sp.Expr, domain: str) -> bool:
    if domain == 'positive':
        return value.is_positive is True
    if domain == 'nonnegative':
        return value.is_nonnegative is True
    if domain == 'integer':
        return value.is_integer is True
    if domain == 'positive_integer':
        return value.is_integer is True and value.is_positive is True
    return value.is_real is not False


def _residual_zero(equation: sp.Expr, solution: Mapping[sp.Symbol, sp.Expr]) -> bool:
    try:
        residual = sp.simplify(equation.subs(solution))
    except Exception:  # noqa: BLE001
        return False
    if residual == 0:
        return True
    numeric = _numeric(residual)
    return numeric is not None and abs(numeric) <= 1e-9


def _solve_equations(equations: list[sp.Expr], variables: list[sp.Symbol], model, params) -> tuple[list[dict[str, sp.Symbol]], bool]:
    constant_names = {item['name'] for item in model.get('constants') or []}
    try:
        raw = sp.solve(equations, variables, dict=True)
    except Exception:  # noqa: BLE001 - 退化到数值解
        raw = []
    numeric_only = False
    symbolic_solutions: list[dict[sp.Symbol, sp.Expr]] = []
    for item in raw or []:
        candidate = item if isinstance(item, dict) else (
            dict(zip(variables, item)) if isinstance(item, (tuple, list)) else {variables[0]: item})
        if not all(variable in candidate for variable in variables):
            continue
        solution = {variable: candidate[variable] for variable in variables}
        free = set().union(*(value.free_symbols for value in solution.values())) - set(variables)
        if any(str(symbol) not in constant_names for symbol in free):
            continue
        if any(value.has(*variables) for value in solution.values()):
            continue
        if any(not _residual_zero(equation, solution) for equation in equations):
            continue
        numeric_solution = {variable: _subs_constants(value, model, params) for variable, value in solution.items()}
        if any(not _domain_ok(value, next(
                (item2['domain'] for item2 in model.get('symbols') or [] if item2['name'] == str(variable)), 'real'))
               for variable, value in numeric_solution.items()):
            continue
        if solution not in symbolic_solutions:
            symbolic_solutions.append(solution)
        if len(symbolic_solutions) >= MAX_SOLUTIONS:
            break
    if symbolic_solutions:
        return [{str(variable): value for variable, value in solution.items()} for solution in symbolic_solutions], False
    numeric_equations = [_subs_constants(equation, model, params) for equation in equations]
    if len(numeric_equations) == 1 and len(variables) == 1:
        expression = numeric_equations[0]
        variable = variables[0]
        guesses = [0, 1, -1, 2, -2, 10, -10, 0.5, -0.5]
        found = []
        for guess in guesses:
            try:
                root = sp.nsolve(expression, variable, guess)
            except Exception:  # noqa: BLE001
                continue
            value = _numeric(root)
            if value is None:
                continue
            if not any(abs(value - other) <= 1e-7 * max(1, abs(other)) for other in found):
                found.append(value)
        solutions: list[dict[str, sp.Symbol]] = []
        for value in found:
            solution = {variable: sp.Float(value, 14)}
            if any(not _domain_ok(solution[variable], next(
                    (item2['domain'] for item2 in model.get('symbols') or [] if item2['name'] == str(variable)), 'real'))
                   for variable in variables):
                continue
            if any(not _residual_zero(equation, solution) for equation in numeric_equations):
                continue
            solutions.append(solution)
        numeric_only = bool(solutions)
        return [{str(variable): value for variable, value in solution.items()} for solution in solutions], numeric_only
    return [], numeric_only


def _numeric_limit_check(expr: sp.Expr, variable: sp.Symbol, point: sp.Expr, result: sp.Expr, side: str) -> tuple[bool | None, str]:
    if result.free_symbols:
        return None, '结果依赖未代入的参数，符号极限已保留'
    numeric_point = _numeric(point)
    if numeric_point is None:
        return None, '无穷远极限不做数值对照'
    target = _numeric(result)
    if target is None:
        return None, '极限不是有限实数，数值对照不适用'
    probes = []
    for h in (1e-3, 1e-4, 1e-5):
        for sign, label in ((1, 'right'), (-1, 'left')):
            if side != 'both' and side != label:
                continue
            try:
                value = _numeric(expr.subs(variable, sp.Float(numeric_point + sign * h)))
            except Exception:  # noqa: BLE001
                value = None
            if value is not None:
                probes.append(value)
    if not probes:
        return None, '趋近点附近无法取样，保留符号极限'
    tolerance = 2e-3 * max(1.0, abs(target))
    return all(abs(value - target) <= tolerance for value in probes), (
        f'趋近点两侧取样 {len(probes)} 个，与极限值相差不超过 {tolerance:.2g}' if all(
            abs(value - target) <= tolerance for value in probes) else '趋近点附近取样与极限值不一致')


def _numeric_integral_check(expr: sp.Expr, variable: sp.Symbol, lower: sp.Expr, upper: sp.Expr, result: sp.Expr) -> tuple[bool | None, str]:
    if result.free_symbols:
        return None, '结果依赖未代入的参数，符号积分已保留'
    a, b = _numeric(lower), _numeric(upper)
    if a is None or b is None:
        return None, '积分限不是有限数值，数值对照不适用'
    try:
        numeric = sp.Integral(expr, (variable, lower, upper)).evalf(12)
        value = safe_float(numeric)
    except Exception:  # noqa: BLE001
        value = None
    target = _numeric(result)
    if value is None or target is None:
        return None, '数值积分对照不可用'
    return abs(value - target) <= 1e-5 * max(1.0, abs(target)), f'独立数值积分对照：{value:.10g}'


def _numeric_diff_check(expr: sp.Expr, variable: sp.Symbol, point: sp.Expr, result: sp.Expr) -> tuple[bool | None, str]:
    if result.free_symbols:
        return None, '结果依赖未代入的参数，符号导数已保留'
    x0 = _numeric(point)
    target = _numeric(result)
    if x0 is None or target is None:
        return None, '求值点或导数不是有限数值，数值对照不适用'
    h = 1e-5 * max(1.0, abs(x0))
    try:
        left = _numeric(expr.subs(variable, sp.Float(x0 - h)))
        right = _numeric(expr.subs(variable, sp.Float(x0 + h)))
    except Exception:  # noqa: BLE001
        left = right = None
    if left is None or right is None:
        return None, '差分取样不可用'
    value = (right - left) / (2 * h)
    return abs(value - target) <= 1e-3 * max(1.0, abs(target)), f'中心差分对照：{value:.10g}'


def _format_expr(expr: sp.Expr) -> str:
    return _value_text(str(sp.simplify(expr)), 500)


def _format_solution_text(solutions: list[dict[str, sp.Expr]]) -> str:
    if not solutions:
        return '无符合条件的实数解'
    return '；'.join('，'.join(f'{name}={sp.simplify(value)}' for name, value in solution.items())
                    for solution in solutions)


def _solve_step_solution(step: Mapping[str, Any], symbols: dict[str, sp.Symbol], variables: list[str],
                         results: dict[str, dict[str, Any]], model, params) -> dict[str, Any]:
    equations = []
    for raw in step.get('equations') or []:
        left, right = raw.split('=')
        left_expr = _substitute_refs(_parse_step_expr(model, left, symbols), symbols, results)
        right_expr = _substitute_refs(_parse_step_expr(model, right, symbols), symbols, results)
        equations.append(sp.simplify(left_expr - right_expr))
    target_names = step.get('for') or [item['name'] for item in model.get('symbols') or [] if item['role'] == 'unknown']
    if not target_names:
        target_names = variables
    solve_symbols = [symbols[name] for name in target_names if name in symbols]
    if not solve_symbols:
        raise GenericModelError('方程没有指定求解变量')
    solutions, numeric_only = _solve_equations(equations, solve_symbols, model, params)
    return {'kind': 'solutions', 'solutions': solutions, 'variables': target_names,
            'numeric_only': numeric_only, 'equations': equations,
            'text': _format_solution_text(solutions) if solutions else '无符合条件的实数解'}


def _execute_step(step: Mapping[str, Any], symbols: dict[str, sp.Symbol], results: dict[str, dict[str, Any]],
                  model, params) -> dict[str, Any]:
    op = step['op']
    names = list(symbols)

    def expr_of(raw: str) -> sp.Expr:
        return _substitute_refs(_parse_step_expr(model, raw, symbols), symbols, results)

    def point_of(raw: str) -> sp.Expr:
        return _substitute_refs(_point(raw, names), symbols, results)

    def bound_of(raw: str) -> sp.Expr:
        compact = raw.replace(' ', '')
        if compact in _POINT_WORDS:
            return _POINT_WORDS[compact]
        return expr_of(raw)

    checks: list[dict[str, Any]] = []
    if op in ('evaluate', 'simplify'):
        value = sp.simplify(expr_of(step['expr']))
        return {'kind': 'scalar', 'value': value, 'text': _format_expr(value)}
    if op == 'solve':
        return _solve_step_solution(step, symbols, [item['name'] for item in model.get('symbols') or []], results, model, params)
    if op == 'limit':
        expression = expr_of(step['expr'])
        variable = symbols[step['var']]
        point = point_of(step['point'])
        side = step.get('side') or 'both'
        direction = '+' if side == 'right' else '-' if side == 'left' else '+-'
        try:
            value = sp.limit(expression, variable, point, dir=direction)
        except Exception as exc:  # noqa: BLE001
            raise GenericModelError(f'极限计算失败：{exc}') from exc
        if value in (sp.nan, sp.zoo) or isinstance(value, sp.AccumBounds):
            raise GenericModelError('极限不存在或无法用当前符号方法确定')
        numeric_ok, detail = _numeric_limit_check(_subs_constants(expression, model, params), variable, point, _subs_constants(value, model, params), side)
        checks.append({'id': f'{step["id"]}:limit', 'label': '极限数值对照', 'status': 'pass' if numeric_ok is not False else 'fail', 'detail': detail})
        return {'kind': 'scalar', 'value': value, 'text': _format_expr(value), 'checks': checks}
    if op == 'diff':
        expression = expr_of(step['expr'])
        variable = symbols[step['var']]
        order = int(step.get('order') or 1)
        value = sp.diff(expression, variable, order)
        if step.get('point') is not None:
            point = point_of(step['point'])
            value = sp.simplify(value.subs(variable, point))
            numeric_ok, detail = _numeric_diff_check(_subs_constants(expression, model, params), variable, point,
                                                     _subs_constants(value, model, params))
            checks.append({'id': f'{step["id"]}:diff', 'label': '导数差分对照',
                           'status': 'pass' if numeric_ok is not False else 'fail', 'detail': detail})
        return {'kind': 'scalar', 'value': sp.simplify(value), 'text': _format_expr(value), 'checks': checks}
    if op == 'integrate':
        expression = expr_of(step['expr'])
        variable = symbols[step['var']]
        if step.get('lower') is not None and step.get('upper') is not None:
            lower = bound_of(step['lower'])
            upper = bound_of(step['upper'])
            value = sp.integrate(expression, (variable, lower, upper))
            numeric_ok, detail = _numeric_integral_check(_subs_constants(expression, model, params), variable,
                                                         lower, upper, _subs_constants(value, model, params))
            checks.append({'id': f'{step["id"]}:integral', 'label': '数值积分对照',
                           'status': 'pass' if numeric_ok is not False else 'fail', 'detail': detail})
        else:
            value = sp.integrate(expression, variable)
        return {'kind': 'scalar', 'value': sp.simplify(value), 'text': _format_expr(value), 'checks': checks}
    if op == 'series':
        expression = expr_of(step['expr'])
        variable = symbols[step['var']]
        point = point_of(step['point'])
        order = int(step.get('order') or 6)
        try:
            value = sp.series(expression, variable, point, order).removeO()
        except Exception as exc:  # noqa: BLE001
            raise GenericModelError(f'级数展开失败：{exc}') from exc
        return {'kind': 'scalar', 'value': sp.simplify(value), 'text': _format_expr(value)}
    if op == 'sum':
        expression = expr_of(step['expr'])
        variable = symbols[step['var']]
        lower = bound_of(step['lower']) if step.get('lower') is not None else sp.Integer(1)
        upper = bound_of(step['upper']) if step.get('upper') is not None else sp.oo
        try:
            value = sp.summation(expression, (variable, lower, upper))
        except Exception as exc:  # noqa: BLE001
            raise GenericModelError(f'求和失败：{exc}') from exc
        return {'kind': 'scalar', 'value': sp.simplify(value), 'text': _format_expr(value)}
    if op == 'extremum':
        expression = expr_of(step['expr'])
        variable = symbols[step['var']]
        lower = bound_of(step['lower']) if step.get('lower') is not None else None
        upper = bound_of(step['upper']) if step.get('upper') is not None else None
        if lower is None or upper is None or _numeric(lower) is None or _numeric(upper) is None or lower >= upper:
            raise GenericModelError('区间最值需要递增的有限闭区间上下限')
        candidates = []
        numeric_expression = _subs_constants(expression, model, params)
        derivative = sp.diff(numeric_expression, variable)
        try:
            interval = sp.Interval(lower, upper)
            from sympy.calculus.util import continuous_domain
            if continuous_domain(numeric_expression, variable, interval) != interval:
                raise GenericModelError('函数在闭区间上不连续，不能用端点与驻点判定最值')
            interior = sp.Interval.open(lower, upper)
            if continuous_domain(derivative, variable, interior) != interior:
                raise GenericModelError('区间内存在不可导点，需要单独核对最值候选点')
            roots = sp.S.EmptySet if derivative == 0 else sp.solveset(derivative, variable, domain=interval)
            if roots != sp.S.EmptySet and not isinstance(roots, sp.FiniteSet):
                raise GenericModelError('未能确定区间内的完整驻点集合')
        except GenericModelError:
            raise
        except Exception as exc:  # noqa: BLE001 - incomplete stationary points cannot certify extrema
            raise GenericModelError('无法完整核验区间连续性和驻点') from exc
        for point in roots:
            candidates.append(('critical', point, sp.simplify(expression.subs(variable, point))))
        for label, point in (('lower', lower), ('upper', upper)):
            if point is not None and not point.free_symbols:
                candidates.append((label, point, sp.simplify(expression.subs(variable, point))))
        if not candidates:
            raise GenericModelError('区间最值没有找到可核验的候选点')
        ranked = [(item, _numeric(_subs_constants(item[2], model, params))) for item in candidates]
        if any(value is None for _, value in ranked):
            raise GenericModelError('最值候选结果无法核验为有限实数')
        best = min(ranked, key=lambda item: item[1])[0]
        worst = max(ranked, key=lambda item: item[1])[0]
        value = {'min': best[2], 'max': worst[2], 'min_point': best[1], 'max_point': worst[1]}
        return {'kind': 'extremum', 'value': value, 'text': f'最小值 {_format_expr(value["min"])}；最大值 {_format_expr(value["max"])}'}
    if op == 'inequality':
        variable = symbols[step['var']]
        left = expr_of(step['left'])
        right = expr_of(step['right'])
        relation = step['relation']
        try:
            if relation in ('=', '=='):
                solutions = sp.solve(sp.Eq(left, right), variable, dict=True)
                text = '；'.join(str(s.get(variable)) for s in solutions) or '无解'
                return {'kind': 'inequality', 'value': sp.FiniteSet(*[s.get(variable) for s in solutions]), 'text': f'{variable} = {text}'}
            from sympy.solvers.inequalities import solve_univariate_inequality
            value = solve_univariate_inequality(sp.Rel(left, right, relation), variable, relational=False)
        except Exception as exc:  # noqa: BLE001
            raise GenericModelError(f'不等式求解失败：{exc}') from exc
        return {'kind': 'inequality', 'value': value, 'text': f'{variable} ∈ {value}'}
    raise GenericModelError(f'不支持的步骤运算：{op}')


def _target_result(model: Mapping[str, Any], results: dict[str, dict[str, Any]], params: Mapping[str, Any]) -> tuple[str, list[str], list[str]]:
    target = model.get('target') or {}
    step_id = str(target.get('step') or next(reversed(results)))
    result = results[step_id]
    label = str(target.get('label') or '')
    def numeric_text(expression: sp.Expr) -> str:
        substituted = _subs_constants(expression, model, params)
        return _format_expr(substituted) if not substituted.free_symbols else _format_expr(expression)
    def shown(expression: sp.Expr) -> str:
        symbolic = _format_expr(expression)
        numeric = numeric_text(expression)
        return numeric if numeric == symbolic else f'{numeric}（{symbolic}）'
    if result['kind'] == 'scalar':
        return shown(result['value']), [numeric_text(result['value'])], []
    if result['kind'] == 'solutions':
        variables = result['variables']
        picked = label if label in variables else (variables[0] if len(variables) == 1 else '')
        if picked:
            symbolic_values = [solution.get(picked, sp.S.NaN) for solution in result['solutions']]
            answer = '；'.join(f'{picked}={shown(value)}' for value in symbolic_values) if symbolic_values else '无符合条件的实数解'
            return answer, [numeric_text(value) for value in symbolic_values], [picked]
        rows = []
        numeric_rows = []
        for solution in result['solutions']:
            row = [shown(solution[var]) for var in variables]
            rows.append(row)
            numeric_rows.append([numeric_text(solution[var]) for var in variables])
        answer = '；'.join('，'.join(f'{var}={value}' for var, value in zip(variables, row)) for row in rows) or '无符合条件的实数解'
        return answer, [value for row in numeric_rows for value in row], variables
    if result['kind'] == 'extremum':
        value = result['value']
        if label not in ('min', 'max'):
            return (f'最小值 {shown(value["min"])}；最大值 {shown(value["max"])}',
                    [numeric_text(value['min']), numeric_text(value['max'])], [])
        selected = label
        expression = value[selected]
        return shown(expression), [numeric_text(expression)], []
    if result['kind'] == 'inequality':
        value = result['value']
        text = result['text']
        return text, [], []
    raise GenericModelError('目标步骤的结果无法读取')


def _recognition(model: Mapping[str, Any]) -> dict[str, Any]:
    conditions = []
    for item in model.get('symbols') or []:
        conditions.append({'id': f'sym_{item["name"]}', 'label': item['name'],
                           'value': f'符号（{item["role"]}，{item["domain"]}）', 'provenance': 'inferred',
                           'source': {'excerpt': ''}})
    for item in model.get('constants') or []:
        conditions.append({'id': item['name'], 'label': item['name'], 'value': item['value'],
                           'provenance': 'inferred', 'source': {'excerpt': item.get('source') or ''}})
    formulas = [{'id': 'generic_model', 'tex': model.get('formula_tex') or '', 'plain': '',
                 'role': '通用符号模型 · 内核执行'}]
    return {'method': 'generic_symbolic', 'raw_text': '', 'conditions': conditions, 'ambiguities': [],
            'formulas': formulas, 'recognized_subject': model.get('subject') or 'general', 'ai_used': True}


def _resolve_plot(model: Mapping[str, Any], results: dict[str, dict[str, Any]], symbols: dict[str, sp.Symbol]) -> dict[str, Any] | None:
    source = model.get('plot')
    if not source:
        return None
    expression = parse_expression(source['expr'], list(symbols) or ['dummy'])
    expression = _substitute_refs(expression, symbols, results)
    for result in results.values():
        if result['kind'] == 'solutions' and len(result['solutions']) == 1:
            for name, value in result['solutions'][0].items():
                if name == source['var']:
                    continue
                symbol = symbols.get(name)
                if symbol is not None and symbol in expression.free_symbols:
                    expression = expression.subs(symbol, value)
    return {'expr': str(expression).replace('**', '^'), 'var': source['var'],
            'range': list(source['range']), 'resolved': True}


def _answer_contract(model: Mapping[str, Any], results: dict[str, dict[str, Any]]) -> dict[str, Any]:
    target = model.get('target') or {}
    step_id = str(target.get('step') or next(reversed(results)))
    result = results[step_id]
    label = str(target.get('label') or '')
    if result['kind'] == 'scalar':
        contract = {'answer_kind': 'value', 'answer_formula': str(result['value']).replace('**', '^')}
        if label:
            contract['answer_variables'] = [label]
        return contract
    if result['kind'] == 'solutions':
        variables = result['variables']
        picked = label if label in variables else (variables[0] if len(variables) == 1 else '')
        if picked:
            return {'answer_kind': 'values', 'answer_variables': [picked],
                    'answer_formula': [str(solution.get(picked, sp.S.NaN)).replace('**', '^')
                                       for solution in result['solutions']]}
        return {'answer_kind': 'system', 'answer_variables': variables,
                'answer_formula': [[str(solution[var]).replace('**', '^') for var in variables]
                                   for solution in result['solutions']]}
    if result['kind'] == 'extremum':
        if label not in ('min', 'max'):
            return {'answer_kind': 'system', 'answer_variables': ['最小值', '最大值'],
                    'answer_formula': [[str(result['value'][key]).replace('**', '^') for key in ('min', 'max')]]}
        selected = label
        return {'answer_kind': 'value', 'answer_formula': str(result['value'][selected]).replace('**', '^')}
    return {'answer_kind': 'text'}


def evaluate_generic(model: Mapping[str, Any], params: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Execute every declared step and independently check the final result."""
    params = dict(params or {})
    symbols = _step_symbols(model)
    results: dict[str, dict[str, Any]] = {}
    steps: list[dict[str, Any]] = []
    checks: list[dict[str, Any]] = []
    for step in model.get('steps') or []:
        try:
            result = _execute_step(step, symbols, results, model, params)
        except GenericModelError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise GenericModelError(f'步骤 {step["id"]} 执行失败：{exc}') from exc
        results[step['id']] = result
        checks.extend(result.get('checks') or [])
        detail = result.get('text') or ''
        steps.append({'id': step['id'], 'title': f'{step["id"]} · {OPS[step["op"]]}',
                      'detail': detail[:1800],
                      'latex': to_latex(result['value']) if result['kind'] in ('scalar', 'extremum') else ''})
    target_result = results[model['target']['step']]
    if target_result['kind'] == 'solutions':
        for step in model['steps']:
            if step['op'] != 'inequality' or step['var'] not in target_result['variables']:
                continue
            allowed = results[step['id']]['value']
            for candidate in target_result['solutions']:
                value = _subs_constants(candidate[step['var']], model, params)
                if allowed.contains(value) is not sp.S.true:
                    raise GenericModelError('方程候选解不满足声明的不等式条件；请保留原始方程及定义域，不得只在标签中筛除增根')
            checks.append({'id': step['id'] + '_domain', 'label': '方程解的范围核验',
                           'status': 'pass', 'detail': '全部候选解满足声明的不等式条件'})
    answer, values, variables = _target_result(model, results, params)
    failed = [item for item in checks if item.get('status') == 'fail']
    if failed:
        raise GenericModelError('独立核验未通过：' + '；'.join(str(item.get('detail')) for item in failed[:2]))
    if not checks:
        checks.append({'id': 'symbolic', 'label': '符号计算', 'status': 'pass',
                       'detail': '所有步骤由受限 sympy 内核执行；未发现可做的独立数值对照。'})
    numeric_only = any(result.get('numeric_only') for result in results.values())
    expected_values = []
    expected_variables = list(dict.fromkeys(variables))
    for value in values:
        try:
            expression = _safe_expr(value, variables or ['dummy'])
            expected_values.append(str(sp.simplify(expression)))
        except Exception:  # noqa: BLE001
            expected_values.append(value)
    def _finite_value(value: str) -> bool:
        if value in ('无符合条件的实数解',):
            return True
        try:
            return safe_float(parse_expression(value, expected_variables or ['dummy'])) is not None
        except Exception:  # noqa: BLE001
            return False
    checkable = bool(expected_values) and all(_finite_value(value) for value in expected_values)
    if answer == '无符合条件的实数解':
        checkable = True
    plot: dict[str, Any] | None = None
    interactive_model = dict(model)
    interactive_model.update(_answer_contract(model, results))
    if model.get('plot'):
        plot = _resolve_plot(model, results, symbols)
        interactive_model['plot'] = plot
        if plot:
            try:
                interactive_model['formula_tex'] = to_latex(parse_expression(plot['expr'], list(symbols)))
            except Exception:  # noqa: BLE001 - 展示层可保留原公式
                pass
    solution = {
        'answer': answer, 'exact': answer, 'steps': steps,
        'checks': checks, 'verification_level': 'kernel_numeric' if numeric_only else 'kernel',
        'step_results': [{'id': step['id'], 'text': result.get('text') or ''} for step, result in zip(model.get('steps') or [], results.values())],
        'target': {'step': (model.get('target') or {}).get('step'), 'label': (model.get('target') or {}).get('label')},
        'plot': plot,
        'summary': '通用符号模型按声明步骤执行；结果已用代回或数值对照核验。',
    }
    expected: dict[str, Any]
    if len(expected_variables) > 1 and expected_values and len(expected_values) % len(expected_variables) == 0:
        rows = [expected_values[index:index + len(expected_variables)]
                for index in range(0, len(expected_values), len(expected_variables))]
        expected = {'kind': 'system', 'variables': expected_variables, 'rows': rows}
    else:
        expected = {'kind': 'values', 'values': expected_values, 'variables': expected_variables}
    return {'answer': answer, 'exact': answer, 'steps': steps, 'checks': checks,
            'headline': answer, 'metrics': [{'id': 'answer', 'label': '当前答案', 'value': answer},
                                            {'id': 'steps', 'label': '运算步骤', 'value': str(len(steps))}],
            'trace': [{'index': index, 'label': step['title'], 'detail': step['detail'], 'values': {}}
                      for index, step in enumerate(steps)],
            'interactive_solution': solution, 'interactive_model': interactive_model,
            'interactive_recognition': _recognition(interactive_model), 'expected': expected,
            'verification_level': solution['verification_level'], 'checkable': checkable}


def _safe_expr(value: str, variables: list[str]) -> sp.Expr:
    return parse_expression(value, variables)


__all__ = ['ENGINE', 'GenericModelError', 'OPS', 'compile_generic', 'evaluate_generic']

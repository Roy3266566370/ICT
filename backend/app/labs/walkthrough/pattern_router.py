"""The first rollout accepts full rings around the z axis."""
import re
from typing import Literal

import sympy as sp
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from typing import Annotated

from ..ai_solve import _expr

Expression = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Family = Literal['sphere', 'hemisphere', 'cylinder', 'cone', 'paraboloid']
Z = sp.Symbol('z', real=True)


class Surface(BaseModel):
    model_config = ConfigDict(extra='forbid')
    family: Family
    scale: Expression
    lower: Expression
    upper: Expression
    field: list[Expression] = Field(min_length=1, max_length=3)
    orientation: Literal[1, -1] = 1


def surface_eligible(problem):
    model = problem.get('model') or {}
    if problem.get('subject') not in {None, 'calculus', 'unknown', 'general'}:
        return False
    if model.get('task') == 'surface_integral':
        conditions = model.get('conditions') or {}
        if conditions.get('surface_mode') == 'graph':
            return False
        surface = conditions.get('surface') or []
        return isinstance(surface, list) and len(surface) == 3 and all(
            isinstance(coord, str) and re.search(r'\b(?:sin|cos)\s*\(', coord) for coord in surface[:2])
    text = problem.get('text') or ''
    return bool(re.search(r'曲面积分|surface integral|通量|[∬∯].*(?:dS|dσ|dy\s*d[zZ]|dz\s*d[xX]|dx\s*d[yY])',
                          text, re.I | re.S))


def detect_mode(problem) -> Literal['surface_slice', 'volume_slice', 'double_slice', 'limit_approach'] | None:
    if problem.get('subject') not in {None, 'calculus', 'unknown', 'general'}:
        return None
    model = problem.get('model') or {}
    task = model.get('task')
    if task == 'surface_integral':
        return 'surface_slice' if surface_eligible(problem) else None
    if task == 'integral_applications':
        conditions = model.get('conditions') or {}
        if conditions.get('kind') in (None, 'volume', 'washer', 'disk'):
            return 'volume_slice'
        return None
    if task == 'double_integral':
        return 'double_slice'
    if task in ('limits', 'derivatives'):
        return 'limit_approach'
    text = problem.get('text') or ''
    if re.search(r'二重积分|double\s+integral', text, re.I) and not re.search(r'曲面积分|通量|dS|dσ', text, re.I):
        return 'double_slice'
    if surface_eligible(problem):
        return 'surface_slice'
    if re.search(r'旋转体.*体积|绕\s*[xyz]\s*轴.*体积|圆盘法|垫圈法|volume\s+of\s+revolution', text, re.I | re.S):
        return 'volume_slice'
    if re.search(r'∬', text) and not re.search(r'曲面积分|通量|dS|dσ', text, re.I):
        return 'double_slice'
    if re.search(r'极限|\\lim\b|\blim\s*_|\blimit\b|导数定义|割线斜率|在\s*x\s*=\s*[-+]?\d.*导数', text, re.I):
        return 'limit_approach'
    return None


def eligible(problem):
    return detect_mode(problem) is not None


def radius_squared(family, scale):
    if family in ('sphere', 'hemisphere'):
        return scale**2 - Z**2
    if family == 'cylinder':
        return scale**2
    if family == 'cone':
        return (scale * Z)**2
    return Z / scale


def source_conditions(problem):
    model = problem.get('model') or {}
    if model.get('task') in ('surface_integral', 'integral_applications', 'double_integral', 'limits', 'derivatives'):
        return model.get('conditions')
    return None


def confirmed_conditions(problem):
    conditions = source_conditions(problem)
    if (not conditions or (problem.get('model') or {}).get('teaching')
            or (problem.get('ai_solution') or {}).get('source_review_required')):
        return None
    recognition = problem.get('recognition') or {}
    if any(item.get('severity') == 'blocking' and not item.get('resolved')
           for item in recognition.get('ambiguities', [])):
        return None
    if (problem.get('manual_input') or {}).get('confirmed'):
        return conditions
    by_id = {item['id']: item['provenance'] for item in recognition.get('conditions', [])
             if 'id' in item and 'provenance' in item}
    inputs = ['surface', 'uv_bounds', 'kind', 'field']
    if conditions.get('kind') == 'flux':
        inputs.append('orientation')
    if all(by_id.get(key) in ('original', 'user_confirmed') for key in inputs):
        return conditions
    return None


def matches_source(surface, conditions):
    """Prove equivalence for canonical parameterized full rings already in the old kernel."""
    if conditions.get('surface_mode') == 'graph':
        return False
    u, v = sp.symbols('u v', real=True)
    bounds = [[_expr(value, ['z']) for value in pair] for pair in conditions['uv_bounds']]
    coordinates = [_expr(value, ['u', 'v']) for value in conditions['surface']]
    for angle, height, a, b, swap in [(u, v, *bounds, 1), (v, u, *bounds[::-1], -1)]:
        x, y, z = coordinates
        if a[1] - a[0] != 2*sp.pi or z.has(angle):
            continue
        radius = sp.trigsimp(x*sp.cos(angle) + y*sp.sin(angle))
        if radius.has(angle) or sp.trigsimp(x - radius*sp.cos(angle)) != 0 or sp.trigsimp(y - radius*sp.sin(angle)) != 0:
            continue
        scale, lower, upper = (_expr(getattr(surface, key), ['z']) for key in ('scale', 'lower', 'upper'))
        if sp.trigsimp(radius**2 - radius_squared(surface.family, scale).subs(Z, z)) != 0:
            continue
        derivative = sp.diff(z, height)
        for direction in (1, -1):
            interval = sp.Interval(*b)
            signed = direction * derivative
            if sp.calculus.util.function_range(signed, height, interval).inf.is_nonnegative is not True:
                continue
            ends = [z.subs(height, end) for end in b[::direction]]
            if any(sp.simplify(value - want) != 0 for value, want in zip(ends, (lower, upper))):
                continue
            source_field = conditions['field']
            if conditions.get('kind') == 'scalar' and not isinstance(source_field, list):
                source_field = [source_field]
            if not isinstance(source_field, list) or len(source_field) != len(surface.field):
                return False
            variables = ['x', 'y', 'z']
            if any(sp.simplify(_expr(old, variables) - _expr(new, variables)) != 0
                   for old, new in zip(source_field, surface.field)):
                return False
            if len(source_field) == 1:
                return True
            normal_sign = swap * direction * (-1 if conditions.get('orientation') == 'negative' else 1)
            return surface.orientation == normal_sign
    return False

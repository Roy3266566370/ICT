"""Assemble the hand-authored teaching sequence with exercise-specific math."""
import copy
import json
from pathlib import Path

import sympy as sp

STEPS = json.loads(Path(__file__).with_name('steps.json').read_text(encoding='utf-8'))


def build(surface, derived, checks, *, why, alternatives, trusted, source='model'):
    lower, upper = float(derived.lower), float(derived.upper)
    latex = sp.latex
    radius2, metric, density, primitive, exact = (derived.claims[key] for key in (
        'radius_squared', 'metric', 'density', 'primitive', 'exact'))
    field_tex = latex(derived.field[0]) if len(derived.field) == 1 else latex(tuple(derived.field))
    steps = copy.deepcopy(STEPS)
    formulas = [
        [{'tex': 'r(z)^2=' + latex(radius2), 'check': 'radius_squared'}],
        [{'tex': r'dS=' + latex(metric) + r'\,d\theta\,dz', 'check': 'metric'}],
        [{'tex': ('f=' if len(derived.field) == 1 else r'\mathbf F=') + field_tex},
         {'tex': 'g(z)=' + latex(density), 'check': 'density'},
         {'tex': r'\Delta I\approx g(z_{\mathrm{mid}})\,\Delta z'}],
        [{'tex': 'G(z)=' + latex(primitive), 'check': 'primitive'},
         {'tex': r'I(h)=\int_{' + latex(derived.lower) + r'}^{h}g(z)\,dz'}],
        [{'tex': 'I=G(' + latex(derived.upper) + ')-G(' + latex(derived.lower) + ')=' + latex(exact),
          'check': 'exact'}],
    ]
    for step, items in zip(steps, formulas):
        step['formulas'] = items
    if surface.family in ('sphere', 'hemisphere'):
        steps[1]['checkpoint'] = {
            'type': 'predict', 'prompt': '取同样小的高度差时，球面环带的面积怎样变化？',
            'options': ['越接近极点，面积越小', '与截面高度无关', '在赤道处最小'], 'answer': 1,
        }
    if len(derived.field) == 3:
        steps[2]['explain'] = '沿整圈积分向量场与定向面积元的点积。' + steps[2]['explain']
        direction = '朝外' if surface.orientation == 1 else '朝内'
        formulas[2].insert(1, {'tex': r'dI=\mathbf F\cdot d\mathbf S\quad(\text{' + direction + '})'})
    return {
        'version': 1, 'pattern': 'slice_accumulate',
        'strategy': {'why': why, 'alternatives': alternatives},
        'source': source, 'conditions_source': 'problem' if trusted else 'model',
        'geometry': {
            'family': surface.family, 'scale': float(derived.scale), 'lower': lower, 'upper': upper,
            'radius_squared': str(radius2), 'density': str(density), 'density_tex': latex(density),
            'field_tex': field_tex, 'primitive': str(primitive), 'exact_tex': latex(exact),
            'orientation': surface.orientation,
            **({'field': [str(value) for value in derived.field]} if len(derived.field) == 3 else {}),
        },
        'params': [
            {'id': 'h', 'label': '截面高度', 'min': lower, 'max': upper,
             'default': lower + (upper-lower)*0.6, 'source': 'teaching'},
            {'id': 'n', 'label': '环带数', 'min': 4, 'max': 96, 'default': 12, 'source': 'teaching'},
        ],
        'steps': steps,
        'verification': {
            'engine': 'sympy', 'checks': list(checks.values()),
            'status': 'verified' if all(item['status'] == 'verified' for item in checks.values()) else 'unverified',
        },
    }

"""Persistent scene definitions layered on top of iSpec.

A scene does not replace the recognised spec: it describes how the host should
organise one experiment (question, key controls, stages).  Definitions are
derived only from generic parameter semantics, never from a material id or a
page number, so other decks keep their existing behaviour.
"""
from __future__ import annotations

from copy import deepcopy

STEP_PARAMETERS = {
    'steps_rotate_angle_deg',
    'steps_stretch_factor_x',
    'steps_stretch_factor_y',
}
SCENE_VERSION = '1.0'


def _step_source(spec: dict) -> dict:
    parameters = [item for item in spec.get('parameters', []) if isinstance(item, dict)]
    for parameter in parameters:
        if parameter.get('id') in STEP_PARAMETERS:
            return deepcopy(parameter.get('source') or {})
    for parameter in parameters:
        if parameter.get('source'):
            return deepcopy(parameter.get('source'))
    return {'page': 1, 'status': 'inferred', 'excerpt': ''}


def _enum_parameter(identifier: str, label: str, options: list[str], default: str, source: dict) -> dict:
    return {'id': identifier, 'label': label, 'type': 'enum', 'unit': '',
            'default': default, 'options': options, 'source': deepcopy(source)}


def ensure_scene_definition(spec: dict) -> dict:
    """Attach the dual-path scene definition to a step spec, idempotently."""
    parameters = spec.get('parameters')
    if not isinstance(parameters, list):
        return spec
    ids = {parameter.get('id') for parameter in parameters if isinstance(parameter, dict)}
    if not STEP_PARAMETERS.issubset(ids):
        # Other recognised interactions still get a generic experiment
        # container, but no synthetic dual-path controls or stages.
        views = spec.get('views') if isinstance(spec.get('views'), list) else []
        has_figure = any(isinstance(view, dict) and view.get('type') == 'figure' for view in views)
        has_chart = any(isinstance(view, dict) and view.get('type') == 'vega' for view in views)
        if not has_figure and not has_chart and not spec.get('expressions'):
            return spec
        if isinstance(spec.get('scene'), dict) and spec['scene'].get('scene_type'):
            return spec
        source = _step_source(spec)
        controls = [parameter['id'] for parameter in parameters
                    if isinstance(parameter, dict) and parameter.get('type') in (None, 'number', 'integer', 'enum')][:6]
        spec['scene'] = {
            'scene_type': 'figure_lab' if has_figure else 'chart_lab' if has_chart else 'calculation_lab',
            'version': SCENE_VERSION,
            'title': spec.get('title') or '交互实验',
            'condition_note': spec.get('notes') or '当前结果按实验条件实时计算；原页条件只进入原稿对照。',
            'controls': controls,
            'stages': [{'id': 'input', 'label': '输入'}, {'id': 'middle', 'label': '中间态'}, {'id': 'final', 'label': '最终'}],
            'supports_overlay': False,
            'source_status': source.get('status', 'inferred'),
            'source_excerpt': (source.get('excerpt') or '')[:160],
        }
        return spec
    source = _step_source(spec)
    if 'steps_order' not in ids:
        parameters.append(_enum_parameter('steps_order', '执行顺序',
                                          ['A', 'B'], 'A', source))
    if 'steps_shape' not in ids:
        parameters.append(_enum_parameter('steps_shape', '起始对象',
                                          ['rectangle', 'basis'], 'rectangle', source))
    if isinstance(spec.get('scene'), dict) and spec['scene'].get('scene_type'):
        return spec
    spec['scene'] = {
        'scene_type': 'dual_path_order',
        'version': SCENE_VERSION,
        'title': spec.get('title') or '旋转与拉伸：交换顺序',
        'condition_note': '角度与倍率来自原页文字；矩形/基向量与输入向量为补充实验条件。',
        'controls': ['steps_rotate_angle_deg', 'steps_stretch_factor_x',
                     'steps_stretch_factor_y', 'steps_order', 'steps_shape'],
        'stages': [
            {'id': 'input', 'label': '输入'},
            {'id': 'middle', 'label': '中间态'},
            {'id': 'final', 'label': '最终'},
        ],
        'supports_overlay': True,
        'source_status': source.get('status', 'inferred'),
        'source_excerpt': (source.get('excerpt') or '')[:160],
    }
    return spec


def strip_scene_parameters(spec: dict) -> dict:
    """Used by callers that need the original mathematical parameter set."""
    result = deepcopy(spec)
    result['parameters'] = [parameter for parameter in result.get('parameters', [])
                            if parameter.get('id') not in ('steps_order', 'steps_shape')]
    return result

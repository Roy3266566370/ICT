"""User-configured interactions attached to scene nodes.

The free editor stores a small, validated configuration on each node instead
of triggering a whole-deck recognition job.  This module turns that config into
an iSpec whose anchor always follows the node's current geometry.
"""
from __future__ import annotations

import math
import re
from copy import deepcopy

from .native_math import _expression, _normalize, _parameter, _source, _spec

FIGURE_TEMPLATES = {
    'grid_transform',
    'circle_ellipse',
    'vectors',
    'eigen_probe',
    'inverse_map',
    'det_area',
    'basis_change',
}
COMMON_KEYS = {'kind', 'title', 'status', 'reason', 'source'}
ALLOWED_KEYS = {
    'formula': COMMON_KEYS | {'formula', 'defaults', 'ranges', 'allowed'},
    'matrix': COMMON_KEYS | {'matrix', 'vector'},
    'figure': COMMON_KEYS | {'matrix', 'vector', 'template'},
    'chart': COMMON_KEYS | {'categories', 'series'},
}
FORMULA_LINE = re.compile(r'^\s*([A-Za-z][A-Za-z0-9_]{0,23})\s*=\s*(.+?)\s*[;；。]?\s*$')


def _finite(value, limit=1e6) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and abs(value) <= limit


def _matrix(config) -> list[list[float]] | None:
    matrix = config.get('matrix')
    if not isinstance(matrix, list) or len(matrix) != 2:
        return None
    if any(not isinstance(row, list) or len(row) != 2 or not all(_finite(v) for v in row) for row in matrix):
        return None
    return [[float(v) for v in row] for row in matrix]


def _vector(config) -> list[float]:
    vector = config.get('vector', [1, 0])
    if not isinstance(vector, list) or len(vector) != 2 or not all(_finite(v) for v in vector):
        raise ValueError('请填写二维输入向量')
    return [float(v) for v in vector]


def formula_variables(formula: str) -> tuple[str, str, list[str]] | None:
    """Return ``(output, normalized_rhs, variables)`` for a scalar formula."""
    match = FORMULA_LINE.match(formula or '')
    if not match:
        return None
    output, rhs = match.groups()
    parsed = _expression(rhs)
    if parsed is None:
        return None
    expression, names = parsed
    variables = [name for name in names if name != 'pi']
    if not variables or output in variables or len(variables) > 12:
        return None
    return output, expression, variables


def validate_node_interaction(config: dict) -> None:
    if not isinstance(config, dict):
        raise ValueError('交互配置必须是对象')
    kind = config.get('kind')
    if kind not in ALLOWED_KEYS:
        raise ValueError('请选择支持的交互类型')
    unknown = set(config) - ALLOWED_KEYS[kind]
    if unknown:
        raise ValueError('交互配置包含未知字段：' + '、'.join(sorted(unknown)))
    title = config.get('title')
    if title is not None and (not isinstance(title, str) or len(title) > 120):
        raise ValueError('交互标题过长')
    status = config.get('status', 'active')
    if status not in ('active', 'paused'):
        raise ValueError('交互状态不合法')
    if config.get('reason') is not None and (not isinstance(config.get('reason'), str) or len(config['reason']) > 500):
        raise ValueError('交互说明过长')
    if kind == 'formula':
        formula = config.get('formula', '')
        parsed = formula_variables(formula) if isinstance(formula, str) else None
        if parsed is None:
            raise ValueError('公式须形如 y = x^2 + 2*x，支持有限算术与白名单函数')
        _, _, variables = parsed
        defaults = config.get('defaults', {})
        if not isinstance(defaults, dict) or any(name not in variables or not _finite(value) for name, value in defaults.items()):
            raise ValueError('公式变量初值须为已知变量的有限数值')
        allowed = config.get('allowed', variables)
        if not isinstance(allowed, list) or not allowed or any(name not in variables for name in allowed):
            raise ValueError('至少保留一个可调变量，且必须来自公式')
        ranges = config.get('ranges', {})
        if not isinstance(ranges, dict):
            raise ValueError('变量范围格式不合法')
        for name, extent in ranges.items():
            if name not in variables or not isinstance(extent, dict):
                raise ValueError('变量范围格式不合法')
            if set(extent) - {'min', 'max', 'step'}:
                raise ValueError('变量范围包含未知字段')
            for key, value in extent.items():
                if not _finite(value) or (key == 'step' and value <= 0):
                    raise ValueError('变量范围须为有限数值，步长必须大于 0')
    elif kind in ('matrix', 'figure'):
        if _matrix(config) is None:
            raise ValueError('请填写完整的2×2矩阵')
        _vector(config)
        if kind == 'figure' and config.get('template') not in FIGURE_TEMPLATES:
            raise ValueError('请选择支持的图形模板')
    else:
        categories, series = config.get('categories', []), config.get('series', [])
        if not isinstance(categories, list) or not 1 <= len(categories) <= 100:
            raise ValueError('请填写图表的分类')
        if not isinstance(series, list) or not 1 <= len(series) <= 12:
            raise ValueError('请填写图表的数值系列')
        for item in series:
            values = item.get('values', []) if isinstance(item, dict) else []
            if len(values) != len(categories) or any(not _finite(v) for v in values):
                raise ValueError('图表分类数和数值数必须一致')


def _bbox(node: dict) -> dict:
    return {'x': float(node['x']) * 12700, 'y': float(node['y']) * 12700,
            'w': float(node['width']) * 12700, 'h': float(node['height']) * 12700}


def _element_id(node: dict) -> str:
    return node.get('source_element_id') or f"node_{node['id']}"


def _excerpt(node: dict) -> str:
    text = (node.get('text') or node.get('name') or '用户在自由编辑中配置的交互').strip()
    return text[:160]


def _base_source(node: dict, page_no: int, excerpt: str | None = None) -> dict:
    source = _source(page_no, {'element_id': _element_id(node)}, excerpt or _excerpt(node), 'confirmed')
    source['bbox'] = _bbox(node)
    return source


def _anchor(spec: dict, node: dict, page_no: int) -> dict:
    spec['anchor'] = {'page': page_no, 'element_id': _element_id(node), 'bbox': _bbox(node),
                      'node_id': node['id']}
    spec['node_id'] = node['id']
    spec['generated_by'] = 'user'
    return spec


def _formula_spec(node: dict, config: dict, page_no: int) -> dict | None:
    parsed = formula_variables(config.get('formula', ''))
    if parsed is None:
        return None
    output, expression, variables = parsed
    defaults = config.get('defaults', {})
    ranges = config.get('ranges', {})
    allowed = set(config.get('allowed', variables))
    if allowed != set(variables):
        # Fixed variables are folded into the expression; only confirmed
        # adjustable variables become iSpec parameters.
        def replace(match):
            name = match.group(0)
            return f'({float(defaults.get(name, 0))})' if name in variables and name not in allowed else name
        expression = re.sub(r'\b[A-Za-z][A-Za-z0-9_]*\b', replace, expression)
    source = _base_source(node, page_no, config.get('formula'))
    parameters = []
    for name in variables:
        if name not in allowed:
            continue
        extent = ranges.get(name, {})
        parameter = _parameter(name, float(defaults.get(name, 0)), deepcopy(source), f'变量 {name}')
        for key in ('min', 'max', 'step'):
            if key in extent:
                parameter[key] = float(extent[key])
        parameters.append(parameter)
    if not parameters:
        return None
    spec = _spec(f"node_spec_{node['id']}", config.get('title') or config.get('formula', '')[:80],
                 'parametric', parameters,
                 [{'id': output, 'expr': expression, 'label': output}],
                 [{'type': 'text', 'template': config.get('formula', ''), 'title': '当前公式'},
                  {'type': 'text', 'template': f'{output} = {{{{{output}}}}}', 'title': '当前计算结果'},
                  {'type': 'table', 'columns': [p['id'] for p in parameters] + [output]}],
                 '公式与变量由用户在自由编辑中确认；使用受限表达式，不执行脚本。')
    return _anchor(spec, node, page_no)


def _matrix_parameters(matrix, vector, source, names=('a', 'b', 'c', 'd')):
    parameters = [_parameter(key, value, deepcopy(source), f'矩阵 {key}')
                  for key, value in zip(names, [v for row in matrix for v in row])]
    parameters += [_parameter('x1', vector[0], deepcopy(source), '输入向量 x'),
                   _parameter('y1', vector[1], deepcopy(source), '输入向量 y')]
    return parameters


def _matrix_spec(node: dict, config: dict, page_no: int) -> dict | None:
    kind = config['kind']
    matrix = _matrix(config)
    if matrix is None:
        return None
    vector = _vector(config)
    source = _base_source(node, page_no)
    title = config.get('title') or '矩阵与向量'
    template = config.get('template') if kind == 'figure' else 'grid_transform'
    if template == 'det_area':
        parameters = []
        cells = [('单位方格', [[1.0, 0.0], [0.0, 1.0]]), ('当前矩阵', matrix)]
        for index, (label, values) in enumerate(cells):
            for row in range(2):
                for col in range(2):
                    parameters.append(_parameter(f'cells_{index}_matrix_{row}_{col}', values[row][col],
                                                 deepcopy(source), f'{label} · 元素 {row+1}{col+1}'))
            parameters.append({'id': f'cells_{index}_label', 'label': f'格 {index+1} 标题',
                               'type': 'string', 'default': label, 'source': deepcopy(source)})
        spec = _spec(f"node_spec_{node['id']}", title, 'geometric', parameters,
                     [{'id': 'area_0', 'expr': 'cells_0_matrix_0_0*cells_0_matrix_1_1-cells_0_matrix_0_1*cells_0_matrix_1_0'},
                      {'id': 'area_1', 'expr': 'cells_1_matrix_0_0*cells_1_matrix_1_1-cells_1_matrix_0_1*cells_1_matrix_1_0'}],
                     [{'type': 'figure', 'spec_ref': 'det_area', 'title': '单位方格与当前矩阵的面积'},
                      {'type': 'text', 'title': '当前面积', 'template': '单位面积 = {{area_0}}　当前面积 = {{area_1}}'}],
                     '由用户在自由编辑中绑定矩阵；两格分别显示单位方格与当前矩阵。')
        return _anchor(spec, node, page_no)
    if template == 'basis_change':
        point = (vector[0], vector[1])
        parameters = [_parameter('point_x', point[0], deepcopy(source), '固定点 x'),
                      _parameter('point_y', point[1], deepcopy(source), '固定点 y'),
                      _parameter('b2x', matrix[0][0], deepcopy(source), '斜基 b₂·x'),
                      _parameter('b2y', matrix[1][0], deepcopy(source), '斜基 b₂·y')]
        spec = _spec(f"node_spec_{node['id']}", title, 'geometric', parameters,
                     [{'id': 'coord_a', 'expr': '(point_x*b2y-b2x*point_y)/b2y'},
                      {'id': 'coord_b', 'expr': 'point_y/b2y'}],
                     [{'type': 'figure', 'spec_ref': 'basis_change', 'title': '拖动 P 或 b₂ 看坐标怎样变'},
                      {'type': 'text', 'title': '当前坐标', 'template': 'A 坐标 = ({{point_x}}, {{point_y}})\nB 坐标 = ({{coord_a}}, {{coord_b}})'}],
                     '由用户绑定同一个点的两组坐标；b₁ 取水平方向。')
        return _anchor(spec, node, page_no)
    if template == 'eigen_probe':
        parameters = _matrix_parameters(matrix, vector, source)
        parameters += [_parameter('vx', vector[0], deepcopy(source), '探针向量 x'),
                       _parameter('vy', vector[1], deepcopy(source), '探针向量 y')]
        spec = _spec(f"node_spec_{node['id']}", title, 'geometric', parameters,
                     [{'id': 'u', 'expr': 'a*vx+b*vy'}, {'id': 'v', 'expr': 'c*vx+d*vy'},
                      {'id': 'det', 'expr': 'a*d-b*c'}],
                     [{'type': 'figure', 'spec_ref': 'eigen_probe', 'title': '拖动探针向量，看它是否留在原方向'},
                      {'type': 'text', 'title': '当前计算结果', 'template': 'A·v = ({{u}}, {{v}})　det(A) = {{det}}'}],
                     '由用户绑定矩阵与探针向量；拖动端点观察 A·v 是否与 v 共线。')
        return _anchor(spec, node, page_no)
    if template == 'inverse_map':
        parameters = _matrix_parameters(matrix, vector, source)
        parameters += [_parameter('target_x', vector[0], deepcopy(source), '目标点 b · x'),
                       _parameter('target_y', vector[1], deepcopy(source), '目标点 b · y')]
        spec = _spec(f"node_spec_{node['id']}", title, 'geometric', parameters,
                     [{'id': 'det', 'expr': 'a*d-b*c'}],
                     [{'type': 'figure', 'spec_ref': 'inverse_map', 'title': '拖动目标点，看原像是否唯一'},
                      {'type': 'text', 'title': '当前结果', 'template': 'det(A) = {{det}}'}],
                     '由用户绑定矩阵与目标点；奇异矩阵会显示无解或整条原像。')
        return _anchor(spec, node, page_no)
    parameters = _matrix_parameters(matrix, vector, source)
    spec = _spec(f"node_spec_{node['id']}", title, 'geometric', parameters,
                 [{'id': 'u1', 'expr': 'a*x1+b*y1'}, {'id': 'v1', 'expr': 'c*x1+d*y1'},
                  {'id': 'det', 'expr': 'a*d-b*c'}],
                 [{'type': 'figure', 'spec_ref': template if template in ('vectors', 'circle_ellipse', 'grid_transform') else 'grid_transform',
                   'title': '拖动圆点直接改矩阵列'},
                  {'type': 'text', 'title': '当前计算结果', 'template': 'A·x = ({{u1}}, {{v1}})\ndet(A) = {{det}}'}],
                 '由用户在自由编辑中绑定矩阵与输入向量；拖动圆点可直接修改矩阵列。')
    return _anchor(spec, node, page_no)


def _chart_spec(node: dict, config: dict, page_no: int) -> dict | None:
    from .builder import _chart_ispec
    element = {'element_id': _element_id(node),
               'chart_data': {'title': config.get('title') or node.get('name') or '自定义图表',
                              'chart_type': str((node.get('chart') or {}).get('chart_type') or 'COLUMN_CLUSTERED'),
                              'categories': config.get('categories', []),
                              'series': config.get('series', [])}}
    spec, _ = _chart_ispec(element=element, page=page_no, material_id=f"node_{node['id']}")
    if spec is None:
        return None
    for parameter in spec.get('parameters', []):
        parameter['source']['status'] = 'confirmed'
        parameter['source']['bbox'] = _bbox(node)
        parameter['source']['element_id'] = _element_id(node)
    spec['notes'] = '图表数据由用户在自由编辑中确认。'
    return _anchor(spec, node, page_no)


def _normalized(text: str) -> str:
    return re.sub(r'\s+', '', text or '')


def _content_mismatch(node: dict, config: dict) -> str | None:
    """Explain why a saved interaction no longer matches the node's content."""
    kind = config['kind']
    if kind == 'formula':
        formula = _normalized(str(config.get('formula') or ''))
        if formula and formula not in _normalized(str(node.get('text') or '')):
            return '节点文字中的公式已修改，旧计算关系已暂停。请重新提取当前内容，或撤销修改。'
    elif kind == 'chart':
        chart = node.get('chart') or {}
        expected = {'categories': config.get('categories', []),
                    'series': config.get('series', [])}
        current = {'categories': chart.get('categories', []),
                   'series': chart.get('series', [])}
        if current != expected:
            return '图表数据已修改，旧交互结果已暂停。请重新提取当前内容，或撤销修改。'
    return None


def build_node_spec(node: dict, page_no: int) -> dict | None:
    config = node.get('interaction')
    if not isinstance(config, dict) or node.get('deleted') or node.get('hidden'):
        return None
    try:
        validate_node_interaction(config)
    except ValueError:
        return None
    kind = config['kind']
    if kind == 'formula':
        spec = _formula_spec(node, config, page_no)
    elif kind in ('matrix', 'figure'):
        spec = _matrix_spec(node, config, page_no)
    else:
        spec = _chart_spec(node, config, page_no)
    if spec is None:
        return None
    mismatch = _content_mismatch(node, config)
    if mismatch or config.get('status') == 'paused':
        spec['availability'] = 'needs_review'
        spec['availability_reason'] = mismatch or config.get('reason') or '交互配置已暂停，请核对后恢复。'
    return spec


def node_interaction_specs(document: dict) -> dict[int, list[dict]]:
    """Build user-configured specs for every visible node that carries one."""
    result: dict[int, list[dict]] = {}
    for page in document.get('pages', []):
        specs = []
        for node in page.get('nodes', []):
            spec = build_node_spec(node, page['page_no'])
            if spec is not None:
                specs.append(spec)
        if specs:
            result[page['page_no']] = specs
    return result


def refresh_paused_user_interaction(node: dict, page_no: int) -> dict | None:
    """Re-derive a user interaction from the node's current visible text."""
    config = node.get('interaction')
    if not isinstance(config, dict) or config.get('kind') != 'formula':
        return None
    candidates = []
    for line in str(node.get('text') or '').splitlines():
        if '=' not in line:
            continue
        parsed = formula_variables(line)
        if parsed:
            candidates.append((line.strip(), parsed))
    if not candidates:
        return None
    formula, (_, _, variables) = candidates[0]
    updated = deepcopy(config)
    updated.update(kind='formula', formula=formula, status='active', title=formula[:60])
    updated.pop('reason', None)
    defaults = {name: float(config.get('defaults', {}).get(name, 0)) for name in variables}
    updated['defaults'] = {name: defaults[name] for name in variables}
    allowed = [name for name in updated.get('allowed', variables) if name in variables]
    updated['allowed'] = allowed or variables
    ranges = {name: value for name, value in (config.get('ranges') or {}).items() if name in variables}
    updated['ranges'] = ranges
    validate_node_interaction(updated)
    return updated

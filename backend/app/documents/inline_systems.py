"""Scene contracts and bounded text authoring for inline teaching systems."""
from __future__ import annotations
from copy import deepcopy
import math
import re

from ..living.diagram import validate_diagram


def validate_scene_diagram(raw):
    if not isinstance(raw, dict) or raw.get('version') != 1:
        raise ValueError('流程图版本不合法')
    allowed = {'version', 'nodes', 'edges', 'order', 'confidence', 'warnings', 'original_positions', 'cache_key'}
    if set(raw)-allowed: raise ValueError('流程图包含未知字段')
    normalized = validate_diagram(raw)
    ids = set()
    for node in raw['nodes']:
        if (set(node)-{'id', 'label', 'x', 'y', 'shape'} or not isinstance(node.get('id'), str)
                or not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', node['id'])
                or not isinstance(node.get('label'), str) or not 1 <= len(node['label']) <= 60
                or node.get('shape') not in ('rect', 'rounded', 'diamond', 'oval', 'text')):
            raise ValueError('流程节点不合法')
        for key in ('x', 'y'):
            value = node.get(key)
            if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
                raise ValueError('流程节点位置须为0到1的有限数值')
        ids.add(node['id'])
    for edge in raw.get('edges', []):
        if (not isinstance(edge, dict) or set(edge)-{'from', 'to', 'label'}
                or edge.get('from') not in ids or edge.get('to') not in ids or edge['from'] == edge['to']
                or not isinstance(edge.get('label', ''), str) or len(edge.get('label', '')) > 60):
            raise ValueError('流程边引用不合法')
    order = raw.get('order')
    if not isinstance(order, list) or len(order) != len(ids) or any(not isinstance(i, str) for i in order) or set(order) != ids:
        raise ValueError('流程步骤必须恰好覆盖全部节点')
    if len(set(order)) != len(order): raise ValueError('流程步骤重复')
    return normalized


def validate_scene_demo(value):
    if value is None: return None
    if not isinstance(value, dict): raise ValueError('演示程序配置不合法')
    from ..ppt_ai.page_lab import validate_lab
    allowed = {'version', 'page_no', 'title', 'summary', 'explain', 'params', 'program', 'content_hash',
               'generator', 'created_at', 'timeline', 'public_params', 'context_hash'}
    if set(value)-allowed: raise ValueError('演示程序包含未知字段')
    checked = validate_lab(value)
    return {**deepcopy(value), **checked}


def diagram_from_text(text):
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 6000:
        raise ValueError('请输入6000字以内的流程描述')
    nodes, edges, named, direction = [], [], {}, 'LR'
    def endpoint(token):
        token = token.strip()
        if not token: raise ValueError('流程箭头两侧不能为空')
        match = re.fullmatch(r'([A-Za-z][A-Za-z0-9_-]{0,39})\s*(?:\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\})?', token)
        if match:
            identifier = match[1]
            label = next((v for v in match.groups()[1:] if v is not None), identifier)
            shape = 'rounded' if match[3] is not None else 'diamond' if match[4] is not None else 'rect'
        else:
            if any(char in token for char in '[]{}<>') or len(token) > 60:
                raise ValueError('节点文字或括号格式不合法')
            identifier = named.get(token, f'n{len(nodes)+1}')
            named[token] = identifier
            label, shape = token, 'rect'
        if len(label) > 60: raise ValueError('节点文字最多60字')
        existing = next((node for node in nodes if node['id'] == identifier), None)
        if existing:
            if label != identifier and existing['label'] not in (identifier, label):
                raise ValueError('同一节点重复定义了不同文字')
            if label != identifier: existing.update(label=label, shape=shape)
        else:
            nodes.append({'id': identifier, 'label': label, 'shape': shape, 'x': .5, 'y': .5})
        return identifier
    for line in re.split(r'[\n;；]+', text):
        line = line.strip()
        if not line: continue
        if line in ('flowchart LR', 'graph LR', 'flowchart TB', 'graph TB', 'flowchart TD', 'graph TD'):
            direction = line.split()[-1]; continue
        parts = re.split(r'\s*(?:-->|→|->)\s*', line)
        if len(parts) < 2: raise ValueError('用 → 或 --> 连接节点，可换行添加分支')
        ids = [endpoint(part) for part in parts]
        for source, target in zip(ids, ids[1:]):
            if source == target: raise ValueError('不支持节点连接自身')
            if not any(e['from'] == source and e['to'] == target for e in edges):
                edges.append({'from': source, 'to': target, 'label': ''})
        if len(nodes) > 40 or len(edges) > 60: raise ValueError('流程图最多40个节点与60条边')
    if len(nodes) < 2: raise ValueError('流程图至少需要两个节点')
    depth = {node['id']: 0 for node in nodes}
    for _ in range(len(nodes)):
        changed = False
        for edge in edges:
            target = min(len(nodes)-1, depth[edge['from']]+1)
            if depth[edge['to']] < target:
                depth[edge['to']] = target; changed = True
        if not changed: break
    layers = {}
    for node in nodes: layers.setdefault(depth[node['id']], []).append(node)
    maximum = max(depth.values())
    for level, group in layers.items():
        for index, node in enumerate(group):
            x = .12+.76*level/max(1, maximum)
            y = .5 if len(group) == 1 else .15+.7*index/(len(group)-1)
            node.update(x=round(y if direction in ('TB', 'TD') else x, 4),
                        y=round(x if direction in ('TB', 'TD') else y, 4))
    return validate_scene_diagram({'version': 1, 'nodes': nodes, 'edges': edges,
        'order': [node['id'] for node in nodes], 'confidence': 1, 'warnings': []})

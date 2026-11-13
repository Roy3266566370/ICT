"""Re-recognize a page from the current web-edited scene nodes.

The original upload pipeline only knows the source PPTX.  After free editing
the visible content can differ, so this module rebuilds the lightweight page
model (text boxes, pictures, charts, tables) from scene nodes and runs the same
native/concept recognizers over it.  Results always come from the current
document revision, never from a stale upload snapshot.
"""
from __future__ import annotations

import re
from copy import deepcopy

from ..ispec.builder import _chart_ispec, _table_ispec
from ..ispec.native_math import build_native_math_specs
from ..ispec.validator import validate_ispec
from ..ispec.user_config import _concept_anchor, _concept_specs, _spatial_specs

EMU_PER_POINT = 12700


def _element_id(node: dict) -> str:
    return node.get('source_element_id') or f"node_{node['id']}"


def _element(node: dict) -> dict:
    kind = {'text': 'text', 'image': 'picture', 'shape': 'shape',
            'chart': 'chart', 'table': 'table'}.get(node.get('type'), 'shape')
    text = str(node.get('text') or '')
    if node.get('type') == 'table' and node.get('table'):
        text = '\n'.join(' | '.join(str(cell) for cell in row) for row in node['table'])
    element = {
        'element_id': _element_id(node),
        'kind': kind,
        'name': node.get('name') or kind,
        'text': text,
        'math_text': text if '=' in text else None,
        'bbox': {'x': float(node['x']) * EMU_PER_POINT, 'y': float(node['y']) * EMU_PER_POINT,
                 'w': float(node['width']) * EMU_PER_POINT, 'h': float(node['height']) * EMU_PER_POINT},
        'recognition_method': 'web_document',
    }
    if node.get('type') == 'chart' and isinstance(node.get('chart'), dict):
        element['chart_data'] = deepcopy(node['chart'])
    if node.get('type') == 'table' and node.get('table'):
        rows = [[str(cell) for cell in row] for row in node['table']]
        element['table_data'] = {'headers': rows[0] if rows else [], 'rows': rows[1:] if rows else []}
    return element


def scene_page(page: dict) -> dict:
    nodes = [node for node in page.get('nodes', []) if not node.get('deleted') and not node.get('hidden')]
    texts = [node for node in nodes if node.get('type') == 'text' and str(node.get('text') or '').strip()
             and not (isinstance(node.get('interaction'), dict) and node['interaction'].get('kind') == 'formula')
             and not ('=' in str(node.get('text')) and not re.search(r'[\u4e00-\u9fff]', str(node.get('text'))))]
    # Use the largest title-like text instead of the first small eyebrow label.
    title_node = max(texts, key=lambda node: (float((node.get('style') or {}).get('font_size') or 0),
                                               len(str(node.get('text') or ''))), default=None)
    return {
        'page_no': page['page_no'],
        'width': float(page['width']) * EMU_PER_POINT,
        'height': float(page['height']) * EMU_PER_POINT,
        'title': (str(title_node.get('text') or '').strip()[:80] if title_node
                  else f"第 {page['page_no']} 页"),
        'elements': [_element(node) for node in nodes],
    }


def _anchor_spec(spec: dict, element: dict) -> dict:
    spec['anchor'] = {'page': spec.get('parameters', [{}])[0].get('source', {}).get('page', 1),
                      'element_id': element.get('element_id'), 'bbox': deepcopy(element.get('bbox'))}
    spec['generated_by'] = 'auto'
    return spec


def build_scene_specs(page: dict, material_id: str, nodes: list[dict] | None = None,
                      concepts: bool = True) -> list[dict]:
    """Build specs from a scene page (all visible nodes by default)."""
    parsed = scene_page({**page, 'nodes': nodes} if nodes is not None else page)
    by_id = {element['element_id']: element for element in parsed['elements']}
    page_area = float(parsed['width']) * float(parsed['height'])
    visual_element, visual_bbox = _concept_anchor(parsed, parsed['elements'])
    generated: list[dict] = []
    for spec in build_native_math_specs(parsed, f'{material_id}_scene'):
        source_element = next((by_id.get(parameter.get('source', {}).get('element_id'))
                               for parameter in spec.get('parameters', [])
                               if by_id.get(parameter.get('source', {}).get('element_id'))), None)
        if source_element:
            _anchor_spec(spec, source_element)
            bbox = source_element.get('bbox') or {}
            tiny = bbox.get('w', 0) * bbox.get('h', 0) < page_area * .02
            if tiny and visual_element is not None and visual_element.get('kind') in ('picture', 'shape'):
                # A matrix written in a small side label still belongs to the
                # figure the reader is looking at; keep the original upload
                # behaviour instead of anchoring to that label.
                spec['anchor'] = {'page': parsed['page_no'], 'element_id': visual_element['element_id'],
                                  'bbox': deepcopy(visual_bbox)}
        generated.append(spec)
    for element in parsed['elements']:
        if element['kind'] == 'chart':
            spec, _ = _chart_ispec(element=element, page=parsed['page_no'], material_id=f'{material_id}_scene')
            if spec:
                for parameter in spec.get('parameters', []):
                    parameter['source']['bbox'] = element['bbox']
                generated.append(_anchor_spec(spec, element))
        elif element['kind'] == 'table':
            spec = _table_ispec(element=element, page=parsed['page_no'],
                                material_id=f'{material_id}_scene', page_title=parsed['title'])
            if spec:
                for parameter in spec.get('parameters', []):
                    parameter['source']['bbox'] = element['bbox']
                generated.append(_anchor_spec(spec, element))
    if concepts:
        # Concept templates need the whole page's visual context.  A single
        # edited node cannot reliably choose a figure anchor, so automatic
        # content-change refresh only re-derives native formulas/charts/tables;
        # concept pages wait for an explicit page re-recognition.
        generated.extend(_spatial_specs(parsed))
        generated.extend(_concept_specs(parsed))
    # Attach the stable scene-node id so the client can follow moves without
    # relying on element ids from the original PPTX.
    scene_nodes = nodes if nodes is not None else page.get('nodes', [])
    by_element: dict[str, dict] = {}
    for node in scene_nodes:
        if node.get('deleted') or node.get('hidden'):
            continue
        by_element[_element_id(node)] = node
        by_element[node['id']] = node
    for spec in generated:
        element_id = spec.get('anchor', {}).get('element_id')
        node = by_element.get(element_id)
        if node is None:
            for parameter in spec.get('parameters', []):
                node = by_element.get(parameter.get('source', {}).get('element_id'))
                if node is not None:
                    break
        if node is not None:
            spec['node_id'] = node['id']
            spec.setdefault('anchor', {})['node_id'] = node['id']
        # The evidence is the current web-edited text, not an untouched PPTX
        # paragraph: keep the provenance honest and ask for confirmation.
        spec['generated_by'] = 'auto'
        for parameter in spec.get('parameters', []):
            source = parameter.get('source', {})
            if source.get('status') == 'original':
                source['status'] = 'inferred'
                source['excerpt'] = (source.get('excerpt') or '')[:160]
        note = '根据当前网页编辑内容重新提取，请核对后再用于展示。'
        spec['notes'] = (spec.get('notes') + '；' if spec.get('notes') else '') + note
    return [spec for spec in generated if not validate_ispec(spec)]


def build_node_scene_specs(page: dict, node: dict, material_id: str) -> list[dict]:
    """Re-derive only the specs whose evidence lives on one edited node."""
    specs = build_scene_specs(page, material_id, [node], concepts=False)
    return [spec for spec in specs
            if spec.get('node_id') == node['id']
            or any(parameter.get('source', {}).get('element_id') == _element_id(node)
                   for parameter in spec.get('parameters', []))]

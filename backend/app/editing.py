"""Edit native PPT elements in an isolated working copy; originals remain intact."""
from __future__ import annotations

import json
import math
import os
import re
import threading
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

from pptx import Presentation
from pptx.chart.data import ChartData

from .settings import UPLOAD_DIR
from .parsers.pptx_parser import _walk_shapes

EDIT_LOCK = threading.Lock()

#: OMML 命名空间：``a14:m`` 包装 + ``m:oMath`` / ``m:oMathPara`` 本体。
_A14_M = '{http://schemas.microsoft.com/office/drawing/2010/main}m'
_MATH = '{http://schemas.openxmlformats.org/officeDocument/2006/math}'
_MC = '{http://schemas.openxmlformats.org/markup-compatibility/2006}AlternateContent'


def metadata_path(material_id: str) -> Path:
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,96}', material_id):
        raise ValueError('Invalid material identifier')
    return UPLOAD_DIR / material_id / 'editor.json'


def read_metadata(material_id: str) -> dict:
    path = metadata_path(material_id)
    if not path.exists():
        return {'revision': 0, 'overrides': {}}
    return json.loads(path.read_text(encoding='utf-8'))


def write_metadata(material_id: str, metadata: dict) -> None:
    target = metadata_path(material_id)
    temporary = target.with_name(f'editor.{uuid4().hex}.tmp')
    temporary.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(temporary, target)


def working_path(material_id: str) -> Path:
    original = metadata_path(material_id).parent / 'original.pptx'
    working = original.with_name('edited.pptx')
    return working if working.exists() else original


def find_shape(deck, page: int, element_id: str):
    if not 1 <= page <= len(deck.slides):
        raise ValueError('该页面不存在')
    for shape, _, identifier, _, _ in _walk_shapes(deck.slides[page-1].shapes, page_no=page,
                                                  parent_transform=(1., 1., 0., 0.)):
        if identifier == element_id:
            return shape
    raise ValueError('该元素不属于所选页面')


def _drop_inline_math(paragraph) -> None:
    """Remove OMML formulas before the paragraph text is rewritten.

    A native equation lives in the paragraph as ``a14:m`` (or bare ``m:oMath``),
    not as a run, so replacing run text alone would leave the old formula visible
    next to the new text. Edits are whole-frame replacements, therefore any math
    inside a rewritten paragraph no longer applies.
    """

    body = paragraph._p
    targets = []
    for node in body.iter(_A14_M):
        target = node.getparent() if node.getparent() is not None and node.getparent().tag == _MC else node
        targets.append(target)
    for node in list(body):
        if node.tag in (_MATH + 'oMathPara', _MATH + 'oMath'):
            targets.append(node)
    for node in targets:
        parent = node.getparent()
        if parent is not None:
            parent.remove(node)


def replace_text(frame, text: str) -> None:
    """Preserve existing paragraph and run formatting when replacing their text."""
    if not isinstance(text, str) or len(text) > 20000:
        raise ValueError('文字长度须不超过20000字')
    lines = text.split('\n')
    paragraphs = list(frame.paragraphs)
    template = deepcopy(paragraphs[0]._p) if paragraphs else None
    for index, line in enumerate(lines):
        if index < len(paragraphs):
            paragraph = paragraphs[index]
        else:
            paragraph = frame.add_paragraph()
            if template is not None:
                first_properties = template.find('{http://schemas.openxmlformats.org/drawingml/2006/main}pPr')
                if first_properties is not None:
                    paragraph._p.insert(0, deepcopy(first_properties))
        _drop_inline_math(paragraph)
        runs = list(paragraph.runs)
        if runs:
            runs[0].text = line
            for run in runs[1:]:
                run.text = ''
        else:
            paragraph.text = line
    for paragraph in paragraphs[len(lines):]:
        frame._txBody.remove(paragraph._p)


def apply_native_edits(source: Path, target: Path, changes: list[dict]) -> None:
    deck = Presentation(source)
    if len(changes) > 100:
        raise ValueError('一次最多修改100个元素')
    for change in changes:
        shape = find_shape(deck, change['page'], change['element_id'])
        kind = change['kind']
        if kind in ('recognition', 'interaction'):
            continue  # The source image is preserved; its confirmed semantics live in editor.json.
        if kind == 'text':
            if not shape.has_text_frame:
                raise ValueError('图片不能当作原生文字直接修改，请使用公式识别与交互配置')
            replace_text(shape.text_frame, change.get('text', ''))
        elif kind == 'table':
            if not shape.has_table:
                raise ValueError('该元素不是原生表格')
            rows = change.get('rows') or []
            if len(rows) != len(shape.table.rows) or any(len(row) != len(shape.table.columns) for row in rows):
                raise ValueError('编辑表格须保持原有行列数')
            for i, row in enumerate(rows):
                for j, value in enumerate(row):
                    replace_text(shape.table.cell(i, j).text_frame, str(value))
        elif kind == 'chart':
            if not shape.has_chart:
                raise ValueError('该元素不是原生图表')
            categories = change.get('categories') or []
            series = change.get('series') or []
            if not 1 <= len(categories) <= 500 or not 1 <= len(series) <= 20:
                raise ValueError('图表须有1至500行分类、1至20个系列')
            data = ChartData()
            data.categories = [str(value)[:160] for value in categories]
            for item in series:
                values = item.get('values', [])
                if len(values) != len(categories) or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v)>1e12 for v in values):
                    raise ValueError('图表数值须有限且与分类数量一致')
                data.add_series(str(item.get('name', ''))[:160], values)
            shape.chart.replace_data(data)
        else:
            raise ValueError('不支持的编辑类型')
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f'edited.{uuid4().hex}.pptx')
    try:
        deck.save(temporary)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)

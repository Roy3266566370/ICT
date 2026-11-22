"""Pix2Text adapter contracts; model inference is stubbed to avoid downloads."""
import hashlib
import io
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from app.ispec import image_text


def png(color='white'):
    out = io.BytesIO()
    Image.new('RGB', (200, 160), color).save(out, format='PNG')
    return out.getvalue()


def block(text, kind='text', y=10, score=.98):
    return {'type': kind, 'text': text, 'score': np.float32(score),
            'position': np.array([[10, y], [180, y], [180, y+20], [10, y+20]]) + 20}


@pytest.fixture(autouse=True)
def isolated_ocr(monkeypatch, tmp_path):
    from app.living.vision import LivingVisionClient
    monkeypatch.setattr(LivingVisionClient, 'available', False)
    monkeypatch.setattr(image_text, 'DATA_DIR', tmp_path)
    if hasattr(image_text, 'pix2text_engine'):
        image_text.pix2text_engine.cache_clear()
    yield
    if hasattr(image_text, 'pix2text_engine'):
        image_text.pix2text_engine.cache_clear()


def install_fake(monkeypatch, results):
    calls = []
    def from_config(**kwargs):
        calls.append(('init', kwargs))
        def recognize(image, **options):
            assert image.mode == 'RGB'
            assert options == {'return_text': False}
            calls.append(('recognize', image.size))
            if isinstance(results, Exception):
                raise results
            return results
        return SimpleNamespace(recognize=recognize)
    monkeypatch.setitem(sys.modules, 'pix2text', SimpleNamespace(
        Pix2Text=SimpleNamespace(from_config=from_config)))
    return calls


def test_formulas_matrix_boxes_and_content_cache(monkeypatch, tmp_path):
    latex = r'\begin{bmatrix} 2 & 1 \\ 1 & 2 \end{bmatrix}'
    calls = install_fake(monkeypatch, [block('矩阵 A'), block(latex, 'isolated', 50),
                                     block('噪声', score=.2)])
    blob = png()
    result = image_text.recognize_image(blob)
    assert result['matrix'] == [[2., 1.], [1., 2.]]
    assert result['math_text'] == latex
    assert latex in result['text']
    assert result['method'] == 'local_ocr'
    assert result['rows'][1]['type'] == 'formula'
    assert result['rows'][0]['box'] == [[10, 10], [180, 10], [180, 30], [10, 30]]
    target = tmp_path/'ocr'/f'p2t_{hashlib.sha256(blob).hexdigest()}.json'
    assert json.loads(target.read_text(encoding='utf-8')) == result
    assert image_text.recognize_image(blob) == result
    assert len(calls) == 2


@pytest.mark.parametrize('kind', ['formula', 'embedding', 'isolated'])
@pytest.mark.parametrize('latex', [r'y = \frac{x}{2} + a', r'\mathbf{y}=2 \mathbf{x}+\mathbf{a}'])
def test_formula_types_reuse_native_math(monkeypatch, kind, latex):
    from app.ispec.native_math import build_native_math_specs
    install_fake(monkeypatch, [block(latex, kind)])
    result = image_text.recognize_image(png())
    assert result['rows'][0]['type'] == 'formula'
    specs = build_native_math_specs({'page_no': 1, 'elements': [
        {'element_id': 'formula', 'text': result['text'], 'math_text': result['math_text'],
         'recognition_method': 'local_ocr'}]}, 'test')
    assert {p['id'] for p in specs[0]['parameters']} == {'x', 'a'}


@pytest.mark.parametrize('latex, expected', [
    (r'\left[ \begin{array} {c c} {} & {} \\ {2} & {1} \\ {} & {} \\ {1} & {2} \\ \end{array} \right]', [[2., 1.], [1., 2.]]),
    (r'\begin{array}{cc}{} & {1} \\ {1} & {2}\end{array}', None),
    (r'\begin{pmatrix}-2 & .5 & 3 \\ +1 & 2 & 4\end{pmatrix}', [[-2., .5, 3.], [1., 2., 4.]]),
    (r'\begin{bmatrix}x & 1 \\ 1 & 2\end{bmatrix}', None),
    (r'\begin{bmatrix}2 & 1 \\ 2\end{bmatrix}', None),
    (r'\begin{bmatrix}1e999 & 1 \\ 1 & 2\end{bmatrix}', None),
    (r'\begin{matrix}1 & 2\end{matrix} + \begin{matrix}3 & 4\end{matrix}', None),
])
def test_only_unambiguous_rectangular_numeric_matrices(monkeypatch, latex, expected):
    install_fake(monkeypatch, [block(latex, 'formula')])
    assert image_text.recognize_image(png())['matrix'] == expected


@pytest.mark.parametrize('unavailable', ['missing', 'broken'])
def test_rapidocr_fallback_retains_matrix_detection(monkeypatch, unavailable):
    if unavailable == 'missing':
        monkeypatch.setitem(sys.modules, 'pix2text', None)
    else:
        install_fake(monkeypatch, RuntimeError('model unavailable'))
    rows = []
    for x, y, text in [(10, 10, '2'), (100, 10, '1'), (10, 100, '1'), (100, 100, '2')]:
        rows.append(([[x, y], [x+10, y], [x+10, y+10], [x, y+10]], text, .99))
    monkeypatch.setattr(image_text, 'engine', lambda: lambda image: (rows, None))
    result = image_text.recognize_image(png())
    assert result['matrix'] == [[2., 1.], [1., 2.]]
    assert result['reason'] is None


def test_model_initializes_once_for_different_images(monkeypatch):
    calls = install_fake(monkeypatch, [block('标签')])
    image_text.recognize_image(png())
    image_text.recognize_image(png('red'))
    assert [kind for kind, _ in calls] == ['init', 'recognize', 'recognize']


def test_installing_pix2text_upgrades_a_cached_rapidocr_result(monkeypatch):
    monkeypatch.setitem(sys.modules, 'pix2text', None)
    monkeypatch.setattr(image_text, 'engine', lambda: lambda image: ([], None))
    blob = png()
    assert image_text.recognize_image(blob)['backend'] == 'rapidocr'
    calls = install_fake(monkeypatch, [block('new formula', 'formula')])
    result = image_text.recognize_image(blob)
    assert result['backend'] == 'pix2text'
    assert result['math_text'] == 'new formula'
    assert len(calls) == 2


def test_concurrent_identical_crops_recognize_once(monkeypatch):
    calls = install_fake(monkeypatch, [block('label')])
    blob = png()
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(image_text.recognize_image, [blob]*4))
    assert all(result == results[0] for result in results)
    assert [kind for kind, _ in calls] == ['init', 'recognize']


def test_transparent_large_crop_keeps_existing_ocr_coordinate_scale(monkeypatch):
    calls = install_fake(monkeypatch, [block('label')])
    out = io.BytesIO()
    Image.new('RGBA', (3200, 1600), (0, 0, 0, 0)).save(out, format='PNG')
    result = image_text.recognize_image(out.getvalue())
    assert calls[-1] == ('recognize', (1640, 840))
    assert result['rows'][0]['box'][0] == [10, 10]


def test_enrichment_preserves_latex_and_native_matrix_parameters(monkeypatch, tmp_path):
    from app.ispec import chart_extract, user_config
    from app.ispec.native_math import build_native_math_specs
    latex = r'\begin{bmatrix}2 & 1 \\ 1 & 2\end{bmatrix}'
    install_fake(monkeypatch, [block(latex, 'formula')])
    source = tmp_path/'source.pptx'
    source.touch()
    monkeypatch.setattr(user_config, 'working_path', lambda _: source)
    monkeypatch.setattr(user_config, 'Presentation', lambda _: SimpleNamespace(
        slides=[SimpleNamespace(shapes=[])]))
    monkeypatch.setattr(user_config, '_walk_shapes', lambda *a, **kw: [
        (SimpleNamespace(image=SimpleNamespace(blob=png())), None, 'pic', None, None)])
    monkeypatch.setattr(chart_extract, 'extract_chart_from_image', lambda *a, **kw: (None, False))
    parsed = {'pages': [{'page_no': 1, 'width': 1000, 'height': 1000, 'elements': [
        {'element_id': 'pic', 'bbox': {'x': 10, 'y': 10, 'w': 200, 'h': 160}}]}]}
    enriched, _, _ = user_config.enrich_recognition(parsed, 'test', {})
    element = enriched['pages'][0]['elements'][0]
    assert element['math_text'] == latex
    assert element['image_recognition']['math_text'] == latex
    specs = build_native_math_specs(enriched['pages'][0], 'test')
    assert {p['id']: p['default'] for p in specs[0]['parameters']} == {
        'a': 2., 'b': 1., 'c': 1., 'd': 2.}

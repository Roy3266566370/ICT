"""Real embedded PPT images exercise OCR, geometry, and refusal together."""
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile

import pytest

SAMPLES = [
    ('image5.png', [[[2, 1], [1, 2]]]),
    ('image14.png', [[[1, 2], [0, 1]], [[2, 0], [1, 1]], [[3, 2], [1, 2]]]),
    ('image34.png', [[[2, 0], [0, 3]]]),
    ('image35.png', [[[2.5, -.5], [-.5, 2.5]]]),
]


def image(name):
    with ZipFile(Path(__file__).resolve().parents[2] / '用空间视角理解矩阵运算.pptx') as archive:
        return archive.read('ppt/media/' + name)


def config(values):
    return {'matrices': [{'values': v, 'cells': [
        {'row': r, 'col': c, 'bbox': [.05, .05, .9, .9]}
        for r in range(len(v)) for c in range(len(v[0]))]} for v in values]}


@pytest.mark.parametrize('name,values', SAMPLES)
def test_real_matrix_values_and_tight_pixel_boxes(name, values):
    from app.documents.matrix_ocr import calibrate_matrix_ocr, ocr_matrix_image
    from PIL import Image
    import io
    data = image(name)
    original = config(values)
    result = calibrate_matrix_ocr(data, original)
    assert result is not None
    assert original == config(values)
    assert [m['values'] for m in result['matrices']] == values
    inferred = ocr_matrix_image(data)
    assert inferred is not None
    assert [m['values'] for m in inferred['matrices']] == values
    width, height = Image.open(io.BytesIO(data)).size
    for matrix in result['matrices']:
        assert len(matrix['cells']) == len(matrix['values']) * len(matrix['values'][0])
        for cell in matrix['cells']:
            x, y, w, h = cell['bbox']
            assert 0 <= x < x+w <= 1 and 0 <= y < y+h <= 1
            assert w*width < 120 and h*height < 55
    if name == 'image5.png':
        assert result['matrices'][0]['cells'][0]['bbox'] == pytest.approx([76/288,78/252,33/288,38/252])
    if name == 'image35.png':
        assert result['matrices'][0]['cells'][1]['bbox'] == pytest.approx([234/396,62/222,107/396,47/222])


def test_wrong_reordered_missing_and_duplicate_cells_refused():
    from app.documents.matrix_ocr import calibrate_matrix_ocr
    data = image('image14.png'); good = config(SAMPLES[1][1])
    changes = []
    wrong = deepcopy(good); wrong['matrices'][0]['values'][0][0] = 9; changes.append(wrong)
    reordered = deepcopy(good); reordered['matrices'].reverse(); changes.append(reordered)
    missing = deepcopy(good); missing['matrices'].pop(); changes.append(missing)
    missing_cell = deepcopy(good); missing_cell['matrices'][0]['cells'].pop(); changes.append(missing_cell)
    duplicate = deepcopy(good); duplicate['matrices'][0]['cells'][1] = duplicate['matrices'][0]['cells'][0]; changes.append(duplicate)
    for bad in changes:
        assert calibrate_matrix_ocr(data, bad) is None

@pytest.mark.parametrize('values', [
    [[1,2,3], [4,5,6]],
    [[1,2,3,4,5,6] for _ in range(6)],
])
def test_rectangular_and_six_by_six_layout(values):
    from app.documents.matrix_ocr import calibrate_matrix_ocr
    from PIL import Image, ImageDraw, ImageFont
    import io
    cols, rows = len(values[0]), len(values)
    im = Image.new('RGB', (cols*100+60, rows*70+40), 'white')
    draw = ImageDraw.Draw(im); font = ImageFont.truetype('arial.ttf', 32)
    for r,row in enumerate(values):
        for c,value in enumerate(row):
            draw.text((50+c*100,30+r*70), str(value), font=font, fill='black')
    for x,sign in [(15,1),(im.width-15,-1)]:
        draw.line([(x+sign*10,15),(x,15),(x,im.height-15),(x+sign*10,im.height-15)], fill='black', width=3)
    data = io.BytesIO(); im.save(data,format='PNG')
    result = calibrate_matrix_ocr(data.getvalue(), config([values]))
    assert result is not None
    assert result['matrices'][0]['values'] == values

def test_addition_metadata_and_invalid_config():
    from app.documents.matrix_ocr import calibrate_matrix_ocr, ocr_matrix_image
    data = image('image14.png')
    actual = ocr_matrix_image(data)
    assert actual['operation'] == 'add'
    assert actual['operands'] == [0, 1] and actual['result'] == 2
    recovered = calibrate_matrix_ocr(data, config(SAMPLES[1][1]))
    assert recovered['operation'] == 'add' and recovered['result'] == 2
    good = config(SAMPLES[1][1]); good.update(operation='add', operands=[0, 1], result=2)
    assert calibrate_matrix_ocr(data, good) is not None
    for field,value in [('operands',[1,2]), ('result',0), ('operation','multiply')]:
        bad = deepcopy(good); bad[field] = value
        assert calibrate_matrix_ocr(data, bad) is None
    bad = config(SAMPLES[1][1]); bad['matrices'][0]['cells'][0]['row'] = False
    assert calibrate_matrix_ocr(data, bad) is None
    assert calibrate_matrix_ocr(b'not an image', good) is None
    assert calibrate_matrix_ocr(data, {}) is None

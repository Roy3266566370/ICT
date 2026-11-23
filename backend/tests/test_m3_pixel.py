import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
import pytest

from app.documents import auto_vectors


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / 'frontend/e2e/fixtures'
PIXEL_FIXTURES = ROOT / 'verify/m3-2026-11-23'


def row(bounds, text):
    x0, y0, x1, y1 = bounds
    return {'box': [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], 'text': text, 'score': 0.98}


def draw_arrow(draw, tail, tip, color):
    angle = math.atan2(tip[1] - tail[1], tip[0] - tail[0])
    direction = (math.cos(angle), math.sin(angle))
    base = tuple(tip[i] - 12 * direction[i] for i in range(2))
    side = (-5 * direction[1], 5 * direction[0])
    draw.line((tail, base), fill=color, width=4)
    draw.polygon([tip, tuple(base[i] + side[i] for i in range(2)),
                  tuple(base[i] - side[i] for i in range(2))], fill=color)


@pytest.mark.parametrize(('filename', 'ocr', 'origin_x', 'origin_y', 'dashes'), [
    ('basis-alternate.png', [row((80, 83, 315, 113), 'Standardbasis (2,1)'),
                             row((516, 84, 735, 113), 'Obliquebasis(1,1)')], (191, 627), 343, 1),
    ('basis-compressed.jpg', [row((78, 86, 256, 107), '标准基：坐标（2，1）'),
                              row((423, 86, 579, 108), '斜基：坐标（1，1）')], (167, 501), 270, 2),
])
def test_two_coordinate_systems_preserve_axes_arrows_guides_and_coordinate_text(filename, ocr, origin_x, origin_y, dashes):
    image = Image.open(FIXTURES / filename).convert('RGB')
    systems, objects = auto_vectors.detect_figure(image, ocr)
    assert len(systems) == 2
    for system, x in zip(systems, origin_x):
        assert math.dist(system['origin_px'], (x, origin_y)) < 4
        assert system['unit_px'] > 20
        assert sum(o['system_id'] == system['id'] and o['type'] == 'axis' for o in objects) == 2
        assert sum(o['system_id'] == system['id'] and o['type'] == 'vector' for o in objects) == 3
    assert sum(o['type'] == 'dashed' for o in objects) == dashes
    assert [o['text'] for o in objects if o['type'] == 'text'] == ['(2, 1)', '(1, 1)']
    assert len(objects) == 12 + dashes


def test_single_system_groups_three_directed_arrows_and_preserves_unselected_ink():
    image = Image.open(PIXEL_FIXTURES / 'single-projection.png').convert('RGB')
    systems, objects = auto_vectors.detect_figure(image, [row((92, 20, 257, 47), 'Projection (3, 2)')])
    assert len(systems) == 1
    assert math.dist(systems[0]['origin_px'], (132, 238)) < 3
    assert abs(systems[0]['unit_px'] - 37) < 2
    expected_tips = [(243, 238), (132, 164), (243, 164)]
    vectors = [obj for obj in objects if obj['type'] == 'vector']
    assert len(vectors) == 3
    for tip in expected_tips:
        assert min(math.dist(v['points'][1], tip) for v in vectors) < 3
    guide = next(obj for obj in objects if obj['type'] == 'dashed')
    assert all(abs(p[0] - 243) < 3 for p in guide['points'])
    horizontal = next(obj for obj in vectors if math.dist(obj['points'][1], expected_tips[0]) < 3)
    cleaned = auto_vectors.clean_figure(image, [horizontal])
    assert cleaned.getpixel((190, 238)) == image.getpixel((190, 249))
    assert cleaned.getpixel((238, 235)) == image.getpixel((190, 249))
    assert cleaned.getpixel((132, 183)) == image.getpixel((132, 183))
    assert cleaned.getpixel((421, 45)) == image.getpixel((421, 45))


def test_axis_like_lines_without_vector_relationships_leave_raster_intact():
    image = Image.open(PIXEL_FIXTURES / 'axis-like-negative.png').convert('RGB')
    ocr = [row((92, 20, 257, 45), 'Projection (3, 2)')]
    assert auto_vectors.detect_figure(image, ocr) == ([], [])
    assert auto_vectors.clean_figure(image, []).tobytes() == image.tobytes()


def test_isolated_colored_arrow_is_detected_without_confusing_closed_triangle_marker():
    image = Image.new('RGB', (390, 200), 'white')
    draw = ImageDraw.Draw(image)
    draw_arrow(draw, (45, 97), (178, 97), '#156e96')
    draw.polygon([(268, 50), (245, 109), (292, 109)], outline='#ab6530', width=4)
    draw.text((247, 128), 'Triangle', fill='#ab6530', font=ImageFont.load_default(size=22))
    systems, objects = auto_vectors.detect_figure(image, [])
    assert systems == []
    assert len(objects) == 1
    assert objects[0]['type'] == 'vector' and math.dist(objects[0]['points'][1], (178, 97)) < 3
    verified = set()
    cleaned = auto_vectors.clean_figure(image, objects, verified_ids=verified)
    assert verified == {objects[0]['id']}
    assert cleaned.getpixel((100, 97)) == (255, 255, 255)
    assert cleaned.crop((220, 0, 390, 200)).tobytes() == image.crop((220, 0, 390, 200)).tobytes()


def test_orthogonal_arrows_without_axis_ink_do_not_create_duplicate_axes():
    image = Image.new('RGB', (300, 240), 'white')
    draw = ImageDraw.Draw(image)
    draw_arrow(draw, (95, 177), (210, 177), '#156e96')
    draw_arrow(draw, (95, 177), (95, 72), '#ab6530')
    _, objects = auto_vectors.detect_figure(image, [])
    assert [obj['type'] for obj in objects] == ['vector', 'vector']


def test_compressed_guide_cleanup_preserves_unselected_blue_label():
    image = Image.open(FIXTURES / 'basis-compressed.jpg').convert('RGB')
    _, objects = auto_vectors.detect_figure(image, [])
    guide = max((obj for obj in objects if obj['type'] == 'dashed'), key=lambda obj: obj['points'][0][0])
    verified = set()
    cleaned = auto_vectors.clean_figure(image, [guide], verified_ids=verified)
    bounds = (560, 249, 585, 267)
    original = np.asarray(image.crop(bounds), dtype=np.int16)
    blue = original[:, :, 2] - original[:, :, 0] > 20
    assert np.count_nonzero(blue) > 30 and verified == {guide['id']}
    assert np.array_equal(np.asarray(cleaned.crop(bounds))[blue], original[blue])


def test_cleanup_leaves_stroke_untouched_if_backdrop_cannot_be_inferred():
    image = Image.new('RGB', (200, 80), 'white')
    draw = ImageDraw.Draw(image)
    for x in range(0, 200, 6):
        draw.rectangle((x, 0, x + 2, 79), fill='#222222')
    draw_arrow(draw, (30, 40), (165, 40), '#156e96')
    obj = {'id': 'arrow', 'type': 'vector', 'points': [[30, 40], [165, 40]],
           'style': {'stroke': '#156e96', 'width': 4}}
    verified = set()
    assert auto_vectors.clean_figure(image, [obj], verified_ids=verified).tobytes() == image.tobytes()
    assert verified == set()

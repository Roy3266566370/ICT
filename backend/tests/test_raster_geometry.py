import io
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
import posixpath

import cv2
import numpy as np
import pytest
from PIL import Image

from app.documents import raster_geometry


def png(array):
    output = io.BytesIO()
    Image.fromarray(array).save(output, format='PNG')
    return output.getvalue()


@pytest.mark.parametrize('axes, angle', [((70, 70), 0), ((100, 40), 0), ((100, 40), -40)])
def test_recovers_filled_geometry(axes, angle):
    image = np.full((300, 300, 4), 0, dtype=np.uint8)
    cv2.ellipse(image, (150, 150), axes, angle, 0, 360, (190, 95, 40, 255), -1)
    result = raster_geometry.ellipse_geometry(png(image))
    assert result is not None
    assert result['center'] == pytest.approx([150, 150], abs=1)
    assert result['axes'] == pytest.approx(axes, abs=2)
    if axes[0] != axes[1]:
        assert result['angle'] == pytest.approx(-angle, abs=1)
    assert result['confidence'] > .85
    assert result['color'] == '#BE5F28'


@pytest.mark.parametrize('kind', ['rectangle', 'noise', 'empty'])
def test_rejects_non_ellipses(kind):
    image = np.full((300, 300, 3), 255, dtype=np.uint8)
    if kind == 'rectangle':
        cv2.rectangle(image, (50, 70), (250, 230), (180, 90, 30), -1)
    elif kind == 'noise':
        image = np.random.default_rng(71).integers(0, 256, image.shape, dtype=np.uint8)
    assert raster_geometry.ellipse_geometry(png(image)) is None


@pytest.mark.parametrize('media_index, ratio, angle', [(79, 1, None), (83, 1.618 / .618, 0), (87, 1.618 / .618, 40)])
def test_source_ppt_geometry(repo_root, media_index, ratio, angle):
    source = repo_root / '用空间视角理解矩阵运算.pptx'
    with ZipFile(source) as archive:
        slide = ET.fromstring(archive.read('ppt/slides/slide14.xml'))
        pictures = slide.findall('.//{http://schemas.openxmlformats.org/presentationml/2006/main}pic')
        picture = next(p for p in pictures if p.find('.//{http://schemas.openxmlformats.org/presentationml/2006/main}cNvPr').get('id') == str(media_index))
        rid = picture.find('.//{http://schemas.openxmlformats.org/drawingml/2006/main}blip').get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
        relationships = ET.fromstring(archive.read('ppt/slides/_rels/slide14.xml.rels'))
        target = next(r.get('Target') for r in relationships if r.get('Id') == rid)
        data = archive.read(posixpath.normpath('ppt/slides/' + target))
    result = raster_geometry.ellipse_geometry(data)
    assert result is not None
    assert result['axes'][0] / result['axes'][1] == pytest.approx(ratio, rel=.08)
    assert result['color'] == ('#14273B' if media_index == 79 else '#C46231')
    if angle is not None:
        assert result['angle'] == pytest.approx(angle, abs=4)

@pytest.mark.parametrize('vertices', [((40, 60), (200, 60), (200, 140), (40, 140)), ((40, 140), (80, 60), (220, 60), (180, 140))])
def test_filled_polygons_recovers_quadrilaterals(vertices):
    image = np.zeros((240, 280, 4), dtype=np.uint8)
    cv2.fillPoly(image, [np.array(vertices)], (196, 98, 49, 30))
    results = raster_geometry.filled_polygons(png(image))
    assert len(results) == 1
    assert len(results[0]['points']) == 4
    assert results[0]['color'] == '#C46231'
    assert results[0]['area'] == pytest.approx(abs(cv2.contourArea(np.array(vertices))), rel=.04)


@pytest.mark.parametrize('kind', ['ellipse', 'outline', 'noise'])
def test_filled_polygons_rejects_other_shapes(kind):
    image = np.full((300, 300, 3), 255, dtype=np.uint8)
    if kind == 'ellipse':
        cv2.ellipse(image, (150, 150), (90, 50), 0, 0, 360, (190, 95, 40), -1)
    elif kind == 'outline':
        cv2.rectangle(image, (50, 70), (250, 230), (180, 90, 30), 4)
    else:
        image = np.random.default_rng(72).integers(0, 256, image.shape, dtype=np.uint8)
    assert raster_geometry.filled_polygons(png(image)) == []


@pytest.mark.parametrize('page, shape_id, count', [(5, 411, 2), (18, 169, 1), (18, 172, 1), (18, 175, 1)])
def test_source_ppt_filled_polygons(repo_root, page, shape_id, count):
    with ZipFile(repo_root / '用空间视角理解矩阵运算.pptx') as archive:
        slide = ET.fromstring(archive.read(f'ppt/slides/slide{page}.xml'))
        pictures = slide.findall('.//{http://schemas.openxmlformats.org/presentationml/2006/main}pic')
        picture = next(p for p in pictures if p.find('.//{http://schemas.openxmlformats.org/presentationml/2006/main}cNvPr').get('id') == str(shape_id))
        rid = picture.find('.//{http://schemas.openxmlformats.org/drawingml/2006/main}blip').get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
        rels = ET.fromstring(archive.read(f'ppt/slides/_rels/slide{page}.xml.rels'))
        target = next(r.get('Target') for r in rels if r.get('Id') == rid)
        results = raster_geometry.filled_polygons(archive.read(posixpath.normpath('ppt/slides/' + target)))
    assert len(results) == count
    if page == 5:
        left = min(results, key=lambda r: min(p[0] for p in r['points']))
        points = np.array(left['points'])
        assert np.ptp(points[:, 0]) / np.ptp(points[:, 1]) == pytest.approx(1.75, abs=.08)

@pytest.mark.parametrize('angle', [35, 125, 215, 305])
def test_ellipse_marker_preserves_direction_in_all_quadrants(angle):
    image = np.zeros((320, 320, 4), dtype=np.uint8)
    cv2.ellipse(image, (160, 160), (100, 45), -angle, 0, 360, (196, 98, 49, 26), -1)
    expected = np.array([160 + 100 * np.cos(np.deg2rad(angle)), 160 - 100 * np.sin(np.deg2rad(angle))])
    cv2.circle(image, tuple(np.rint(expected).astype(int)), 9, (196, 98, 49, 255), -1)
    result = raster_geometry.ellipse_geometry(png(image))
    assert result is not None
    assert result.get('marker') == pytest.approx(expected, abs=2)


def test_circle_marker_with_different_color():
    image = np.zeros((300, 300, 4), dtype=np.uint8)
    cv2.circle(image, (150, 150), 80, (20, 39, 59, 13), -1)
    cv2.circle(image, (70, 150), 8, (196, 98, 49, 255), -1)
    result = raster_geometry.ellipse_geometry(png(image))
    assert result.get('marker') == pytest.approx([70, 150], abs=1)


@pytest.mark.parametrize('shape_id', [79, 83, 87])
def test_real_ellipse_has_boundary_marker(repo_root, shape_id):
    with ZipFile(repo_root / '用空间视角理解矩阵运算.pptx') as archive:
        slide = ET.fromstring(archive.read('ppt/slides/slide14.xml'))
        pictures = slide.findall('.//{http://schemas.openxmlformats.org/presentationml/2006/main}pic')
        picture = next(p for p in pictures if p.find('.//{http://schemas.openxmlformats.org/presentationml/2006/main}cNvPr').get('id') == str(shape_id))
        rid = picture.find('.//{http://schemas.openxmlformats.org/drawingml/2006/main}blip').get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
        relationships = ET.fromstring(archive.read('ppt/slides/_rels/slide14.xml.rels'))
        target = next(r.get('Target') for r in relationships if r.get('Id') == rid)
        data = archive.read(posixpath.normpath('ppt/slides/' + target))
    result = raster_geometry.ellipse_geometry(data)
    assert result.get('marker') is not None
    marker, center = np.array(result['marker']), np.array(result['center'])
    assert marker[0] > center[0]
    if shape_id == 87:
        assert marker[1] < center[1] - 100
    else:
        assert marker[1] == pytest.approx(center[1], abs=3)



def test_ambiguous_markers_do_not_choose_direction():
    image = np.zeros((300, 300, 4), dtype=np.uint8)
    cv2.ellipse(image, (150, 150), (100, 45), 0, 0, 360, (196, 98, 49, 26), -1)
    for center in [(50, 150), (250, 150)]:
        cv2.circle(image, center, 9, (196, 98, 49, 255), -1)
    assert raster_geometry.ellipse_geometry(png(image))['marker'] is None


def test_unmarked_circle_does_not_invent_marker():
    image = np.zeros((300, 300, 4), dtype=np.uint8)
    cv2.circle(image, (150, 150), 80, (20, 39, 59, 255), -1)
    assert raster_geometry.ellipse_geometry(png(image))['marker'] is None

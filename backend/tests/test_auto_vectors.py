from PIL import Image, ImageDraw
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Pt

from app.documents.auto_vectors import native_vector, pixel_arrow_candidates, replace_picture_arrows


def test_native_line_preserves_reversed_endpoints_and_arrow():
    ppt = Presentation()
    slide = ppt.slides.add_slide(ppt.slide_layouts[6])
    shape = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Pt(130), Pt(80), Pt(30), Pt(80))
    shape.line.color.rgb = RGBColor.from_string("167ABC")
    shape.line.width = Pt(3)
    marker = OxmlElement("a:tailEnd")
    marker.set("type", "triangle")
    shape._element.spPr.ln.append(marker)

    result = native_vector(shape, {"style": {}})
    assert result["type"] == "vector"
    assert result["width"] == 100 and result["rotation"] == 180
    assert result["style"]["arrow_end"] and not result["style"]["arrow_start"]
    assert result["style"]["stroke"] == "#167ABC"


def test_picture_only_replaces_verified_arrow():
    image = Image.new("RGB", (260, 140), "white")
    drawing = ImageDraw.Draw(image)
    drawing.line((35, 65, 190, 65), fill="#167abc", width=4)
    drawing.polygon([(190, 57), (206, 65), (190, 73)], fill="#167abc")
    drawing.rectangle((225, 90, 243, 111), fill="#cc3333")
    node = {"id": "n_1", "x": 10, "y": 20, "width": 260, "height": 140, "z": 1, "style": {}}
    candidates = pixel_arrow_candidates(image)
    assert candidates
    cleaned, vectors = replace_picture_arrows(image, candidates, node)
    assert len(vectors) == 1
    assert vectors[0]["style"]["arrow_end"] is True
    assert vectors[0]["width"] > 155
    assert cleaned.startswith("data:image/png;base64,")
    assert replace_picture_arrows(image, [{**candidates[0], "start": [0, 0], "end": [1, 0]}], node) is None

def test_basis_diagram_recovers_all_six_arrows_without_b2_ghost():
    from base64 import b64decode
    from io import BytesIO
    from pathlib import Path

    from app.documents.auto_vectors import _picture

    fixture = Path(__file__).resolve().parents[2] / "frontend/e2e/fixtures/auto-vector-arrows.pptx"
    deck = Presentation(fixture)
    image = _picture(deck.slides[1].shapes[-1])
    node = {"id": "basis", "x": 0, "y": 0, "width": image.width, "height": image.height, "z": 1, "style": {}}
    cleaned, vectors = replace_picture_arrows(image, pixel_arrow_candidates(image), node)
    assert len(vectors) == 6
    result = Image.open(BytesIO(b64decode(cleaned.split(",", 1)[1])))
    # The former b2 shaft, head, and fringe must be clean before the new line moves.
    for point in ((526, 244), (549, 253), (551, 254)):
        # Do not sample the blue b1 or the nearby black resultant.
        if point == (526, 244):
            assert min(image.getpixel(point)) < 235
        assert min(result.getpixel(point)) > 230
    assert result.crop((15, 105, 110, 150)).tobytes() == image.crop((15, 105, 110, 150)).tobytes()


def test_general_basis_overlay_links_three_vector_composition_and_collects_group_shapes():
    from app.documents.auto_vectors import _collect_shapes, _general_basis_overlay, _vector

    base = {"id": "v", "x": 0, "y": 0, "width": 100, "height": 16, "z": 1, "style": {}}
    v1 = _vector({**base, "id": "b1"}, (100.0, 200.0), (180.0, 200.0), {"stroke": "#167abc"})
    v2 = _vector({**base, "id": "b2"}, (100.0, 200.0), (160.0, 140.0), {"stroke": "#d97706"})
    vr = _vector({**base, "id": "res"}, (100.0, 200.0), (240.0, 140.0), {"stroke": "#1e293b"})
    basis = _general_basis_overlay([v1, v2, vr], {"x": 20, "y": 30})
    assert basis is not None
    assert basis["firstId"] == "b1"
    assert basis["secondId"] == "b2"
    assert basis["resultId"] == "res"

    ppt = Presentation()
    slide = ppt.slides.add_slide(ppt.slide_layouts[6])
    group = slide.shapes.add_group_shape()
    child = group.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Pt(20), Pt(20), Pt(120), Pt(20))
    collected = _collect_shapes(slide.shapes)
    assert child.shape_id in collected
    assert collected[child.shape_id] == child


def test_alternate_basis_removes_original_b2_and_dash_without_erasing_axes():
    from base64 import b64decode
    from io import BytesIO
    from pathlib import Path

    import numpy as np

    fixture = Path(__file__).resolve().parents[2] / "frontend/e2e/fixtures/basis-alternate.png"
    image = Image.open(fixture).convert("RGB")
    node = {"id": "alternate", "x": 0, "y": 0, "width": image.width, "height": image.height, "z": 1, "style": {}}
    cleaned, vectors = replace_picture_arrows(image, pixel_arrow_candidates(image), node)
    assert len(vectors) == 6
    assert sum("basis" in vector for vector in vectors) == 1
    before = np.asarray(image)
    after = np.asarray(Image.open(BytesIO(b64decode(cleaned.split(",", 1)[1]))))
    # These regions cover the full original shaft, head and guide, excluding labels.
    for bounds, color in [((630, 252, 710, 345), (171, 101, 48)), ((700, 255, 775, 344), (176, 120, 50))]:
        left, top, right, bottom = bounds
        mask = np.all(before[top:bottom, left:right] == color, axis=2)
        assert np.count_nonzero(mask) > 100
        assert np.all(after[top:bottom, left:right][mask] == (249, 250, 251))
    assert np.array_equal(after[365:400, 620:635], before[365:400, 620:635])


def test_compressed_basis_keeps_top_text_and_recovers_right_resultant():
    from base64 import b64decode
    from io import BytesIO
    from pathlib import Path

    fixture = Path(__file__).resolve().parents[2] / "frontend/e2e/fixtures/basis-compressed.jpg"
    image = Image.open(fixture).convert("RGB")
    node = {"id": "compressed", "x": 0, "y": 0, "width": image.width, "height": image.height, "z": 1, "style": {}}
    cleaned, vectors = replace_picture_arrows(image, pixel_arrow_candidates(image), node)
    assert len(vectors) == 6
    basis = next(vector["basis"] for vector in vectors if "basis" in vector)
    by_id = {vector["id"]: vector for vector in vectors}
    assert by_id[basis["secondId"]]["x"] > image.width * .7
    total = by_id[basis["resultId"]]
    assert total["x"] > image.width * .7
    assert -30 < total["rotation"] < -20
    assert 110 < total["width"] < 120
    backdrop = Image.open(BytesIO(b64decode(cleaned.split(",", 1)[1])))
    top = (0, 0, image.width, 63)
    assert backdrop.crop(top).tobytes() == image.crop(top).tobytes()

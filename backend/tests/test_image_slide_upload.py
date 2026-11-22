from PIL import Image
from pptx import Presentation
import pytest

from app.api.routes_materials import _convert_image_upload


@pytest.mark.parametrize(("extension", "format"), [(".jpg", "JPEG"), (".png", "PNG")])
def test_single_image_is_fitted_on_one_slide(tmp_path, extension, format):
    source = tmp_path / f"source{extension}"
    target = tmp_path / "original.pptx"
    Image.new("RGB", (400, 300), "white").save(source, format=format)
    original = source.read_bytes()
    _convert_image_upload(source, target, "换基图")
    deck = Presentation(target)
    assert deck.core_properties.title == "换基图"
    assert len(deck.slides) == 1
    picture, = deck.slides[0].shapes
    assert picture.height == deck.slide_height and picture.width / picture.height == pytest.approx(4 / 3)
    assert picture.left == (deck.slide_width - picture.width) // 2
    assert source.read_bytes() == original

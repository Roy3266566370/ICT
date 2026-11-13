"""OCR confidence does not guarantee that mathematical notation was recovered."""

import io
import pytest

import pymupdf
from PIL import Image

from app.labs import extract


def test_short_chinese_double_integral_question_uses_formula_ocr(tmp_path,monkeypatch):
    raw = '已知平面有界区域D={(x,y)|y²≤x,x²≤y}，计算二重积分 {f(x-y+1)dxdy。'
    monkeypatch.setattr(extract,'_ocr',lambda image:(raw,0.99))
    monkeypatch.setattr(extract,'_math_ocr',lambda image:r'\iint_D (x-y+1)^2 dxdy')
    pages,_ = extract._image_pages(_png(),'f1',tmp_path)
    assert pages[0]['math_text']
    assert '(x-y+1)^2' in pages[0]['text']
    assert pages[0]['requires_formula_confirmation']


def test_living_pdf_reads_beyond_lab_limit_without_replacing_native_text(tmp_path, monkeypatch):
    document = pymupdf.open()
    for i in range(21):
        page = document.new_page()
        page.insert_text((30, 30), f"Attention {i + 1}")
        page.insert_image(pymupdf.Rect(30, 50, 210, 95), stream=_png())
    data = document.tobytes()
    document.close()
    monkeypatch.setattr(extract, "_ocr", lambda image: pytest.fail("原生讲义不应调用整页 OCR"))
    result = extract.extract_files([("f1", "lecture.pdf", "courseware", data)],
                                   lab_id="living", root=tmp_path, max_pages=100, preserve_layout=True)
    assert len(result["pages"]) == 21
    assert result["pages"][-1]["text"] == "Attention 21"
    with pytest.raises(extract.ExtractError, match="超过"):
        extract._pdf_pages(data, "f1", tmp_path, 20, preserve_layout=True)


def _png() -> bytes:
    stream = io.BytesIO()
    Image.new("RGB", (180, 45), "white").save(stream, format="PNG")
    return stream.getvalue()


def test_mixed_pdf_recovers_visual_content_even_with_long_text_layer(tmp_path, monkeypatch):
    document = pymupdf.open()
    page = document.new_page()
    native = "Find the area of the region defined by the following formula."
    page.insert_text((30, 30), native)
    page.insert_image(pymupdf.Rect(30, 50, 210, 95), stream=_png())
    data = document.tobytes()
    document.close()
    recovered = "Find the area of the region. y=1/(x sqrt(1+x²)), x>=1"
    monkeypatch.setattr(extract, "_ocr", lambda image: (recovered, 0.98))
    monkeypatch.setattr(extract, "_math_ocr", lambda image: None)

    pages, method = extract._pdf_pages(data, "f1", tmp_path, 1)

    assert recovered in pages[0]["text"]
    assert native in pages[0]["native_text"]
    assert pages[0]["ocr_text"] == recovered
    assert "ocr" in method
    assert pages[0]["requires_formula_confirmation"] is True
    assert pages[0]["extraction_issues"][0]["id"] == "source_formula_confirmation"


def test_high_confidence_math_screenshot_requires_source_confirmation(tmp_path, monkeypatch):
    raw = "曲线 y=-x²+x²+2x 与 x 轴围成图形的面积"
    monkeypatch.setattr(extract, "_ocr", lambda image: (raw, 0.99))

    pages, _ = extract._image_pages(_png(), "f1", tmp_path)

    assert pages[0]["text"] == raw
    assert pages[0]["ocr_text"] == raw
    assert pages[0]["requires_formula_confirmation"] is True
    issue = pages[0]["extraction_issues"][0]
    assert issue["severity"] == "blocking"
    assert "公式" in issue["message"]


def test_formula_image_is_detected_without_math_cues_in_native_text(tmp_path, monkeypatch):
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((30, 30), "Please read what is printed below and give your response.")
    page.insert_image(pymupdf.Rect(30, 50, 210, 95), stream=_png())
    data = document.tobytes()
    document.close()
    recovered = "Please read what is printed below. y=x^3+2x"
    monkeypatch.setattr(extract, "_ocr", lambda image: (recovered, 0.99))
    monkeypatch.setattr(extract, "_math_ocr", lambda image: None)

    pages, _ = extract._pdf_pages(data, "f1", tmp_path, 1)

    assert pages[0]["text"] == recovered
    assert pages[0]["requires_formula_confirmation"] is True


def test_latex_candidate_keeps_raw_ocr_and_requires_confirmation(tmp_path, monkeypatch):
    monkeypatch.setattr(extract, "_ocr", lambda image: ("dx", 0.95))
    monkeypatch.setattr(extract, "_math_ocr", lambda image: r"\int_0^1 x^{3} dx")

    pages, _ = extract._image_pages(_png(), "f1", tmp_path)

    assert pages[0]["ocr_text"] == "dx"
    assert pages[0]["math_text"] == r"\int_0^1 x^{3} dx"
    assert pages[0]["requires_formula_confirmation"] is True


def test_ordinary_prose_screenshot_does_not_require_formula_confirmation(tmp_path, monkeypatch):
    monkeypatch.setattr(extract, "_ocr", lambda image: ("请说明广度优先搜索算法的运行步骤及时间复杂度。", 0.99))

    pages, _ = extract._image_pages(_png(), "f1", tmp_path)

    assert pages[0].get("requires_formula_confirmation", False) is False
    assert not pages[0].get("extraction_issues")


def test_native_pdf_text_stays_authoritative_without_images(tmp_path, monkeypatch):
    document = pymupdf.open()
    page = document.new_page()
    text = "Compute the integral of x^2 on the interval [0, 1]."
    page.insert_text((30, 30), text)
    data = document.tobytes()
    document.close()
    monkeypatch.setattr(extract, "_ocr", lambda image: (_ for _ in ()).throw(AssertionError("unexpected OCR")))

    pages, method = extract._pdf_pages(data, "f1", tmp_path, 1)

    assert pages[0]["text"] == text
    assert method == "pdf_text"
    assert not pages[0].get("requires_formula_confirmation")

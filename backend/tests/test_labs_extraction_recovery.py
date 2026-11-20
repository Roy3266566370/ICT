"""OCR confidence does not guarantee that mathematical notation was recovered."""

import copy
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


@pytest.mark.parametrize('confidence, untrusted', [(0.0, True), (0.71, True), (0.72, False), (0.99, False)])
@pytest.mark.parametrize('with_math', [False, True])
def test_quality_uses_confidence_even_when_math_candidate_exists(tmp_path, monkeypatch, confidence, untrusted, with_math):
    raw = 'y=x^2'
    monkeypatch.setattr(extract, '_ocr', lambda image: (raw, confidence))
    monkeypatch.setattr(extract, '_math_ocr', lambda image: r'y=x^{2}' if with_math else None)
    pages, _ = extract._image_pages(_png(), 'f1', tmp_path)
    page = pages[0]
    quality = page['ocr_quality']
    assert quality['untrusted'] is untrusted
    assert quality['requires_review'] and quality['needs_visual_verification']
    assert page['requires_formula_confirmation'] and page['requires_source_review']
    assert page['ocr_text'] == raw
    assert quality['candidates'][0]['ocr_confidence'] == confidence
    assert any(e['code'] == 'ocr_low_confidence' for e in quality['evidence']) is untrusted
    assert any(e['id'] == 'source_ocr_quality' for e in page['extraction_issues']) is untrusted


@pytest.mark.parametrize('confidence', [None, 'unknown', float('nan'), float('inf'), -1, 95, True])
def test_unavailable_confidence_is_not_fabricated_as_low_confidence(confidence):
    from app.labs.source_recovery import assess_text_quality
    quality = assess_text_quality('y=x^2', [{'image_key': 'f1_p1', 'ocr_text': 'y=x^2', 'ocr_confidence': confidence}])
    assert not quality['untrusted']
    assert quality['requires_review']
    assert quality['evidence'][0]['code'] == 'ocr_confidence_unavailable'


@pytest.mark.parametrize('ordinary, latex', [
    ('y=x²−1', r'y=x^{2}-1'),
    (r'y=\frac{x^{2}}{2}', r'y=\dfrac{x^2}{2}'),
    (r'y=\left(x+1\right)^{2}', r'y=(x+1)^2'),
    ('∫_0^1 x² dx', r'\int_{0}^{1} x^{2}\,\mathrm{d}x'),
    ('ｙ＝ｘ²', r'y=x^{2}'),
])
def test_equivalent_notation_does_not_create_candidate_conflict(ordinary, latex):
    from app.labs.source_recovery import assess_text_quality
    page = {'image_key': 'f1_p1', 'ocr_text': ordinary, 'math_text': latex, 'ocr_confidence': 0.99}
    before = copy.deepcopy(page)
    quality = assess_text_quality(ordinary, [page])
    assert quality['candidates'][0]['comparison']['status'] == 'equivalent'
    assert not quality['untrusted']
    assert quality['requires_review']
    assert page == before


@pytest.mark.parametrize('ordinary, latex, expected', [
    ('设曲线 y=x²，求围成的面积。', r'y=x^{2}', 'equivalent'),
    ('设 y=x²，且 x=1，求面积。', r'y=x^{2}', 'compatible_subset'),
    ('计算积分并说明方法。', r'\int_0^1 x^2 dx', 'not_comparable'),
    ('dx', r'\int_0^1 x^2 dx', 'not_comparable'),
    ('Find the area of the region under the curve.', r'y=x^{2}', 'not_comparable'),
    ('y=x²', None, 'missing_candidate'),
    ('', r'y=x^{2}', 'missing_candidate'),
])
def test_prose_and_missing_candidates_are_not_formula_disagreement(ordinary, latex, expected):
    from app.labs.source_recovery import compare_formula_candidates
    assert compare_formula_candidates(ordinary, latex)['status'] == expected


@pytest.mark.parametrize('ordinary, latex', [
    ('y=x^2', r'y=x^{3}'),
    ('设曲线 y=x^2，求面积。', r'y=x^{3}'),
    ('y=x+1', r'y=x-1'),
    ('∫_0^1 x² dx', r'\int_0^2 x^2 dx'),
    ('y=x^{12}', r'y=x^12'),
    ('y=x+1 2', r'y=x+12'),
])
@pytest.mark.parametrize('kind', ['image', 'pdf'])
def test_formula_disagreement_retains_raw_candidates_and_blocks_merge(tmp_path, monkeypatch, ordinary, latex, kind):
    monkeypatch.setattr(extract, '_ocr', lambda image: (ordinary, 0.99))
    monkeypatch.setattr(extract, '_math_ocr', lambda image: latex)
    monkeypatch.setattr(extract, '_should_try_math_ocr', lambda text: True)
    if kind == 'image':
        pages, _ = extract._image_pages(_png(), 'f1', tmp_path)
    else:
        document = pymupdf.open()
        document.new_page().insert_image(pymupdf.Rect(30, 30, 210, 75), stream=_png())
        data = document.tobytes()
        document.close()
        pages, _ = extract._pdf_pages(data, 'f1', tmp_path, 1)
    page = pages[0]
    quality = page['ocr_quality']
    assert page['text'] == ordinary
    assert page['ocr_text'] == ordinary and page['math_text'] == latex
    assert quality['untrusted'] and quality['requires_review']
    assert quality['candidates'][0]['comparison']['status'] == 'disagreement'
    evidence = next(e for e in quality['evidence'] if e['code'] == 'candidate_disagreement')
    assert evidence['file_id'] == 'f1' and evidence['image_key'] == 'f1_p1'
    assert evidence['comparison']['pairs'][0]['math']['text'] == latex


@pytest.mark.parametrize('raw, code', [
    ('计算 y=x~2 的值。', 'ambiguous_exponent'),
    (r'计算 y=x^{~2} 的值。', 'ambiguous_exponent'),
    ('矩阵 A=[12;34]，求行列式。', 'matrix_layout_ambiguity'),
    ('矩阵 A=[1 2;34]，求行列式。', 'matrix_layout_ambiguity'),
    ('矩阵 A=(123\n456\n789)', 'matrix_layout_ambiguity'),
    ('矩阵 A=\n123\n456\n789', 'matrix_layout_ambiguity'),
    ('矩阵 A=\n1 2 3\n456\n7 8 9', 'matrix_layout_ambiguity'),
    ('矩阵 A=[[123],[456],[789]]', 'matrix_layout_ambiguity'),
    (r'A=\begin{pmatrix}12\\34\end{pmatrix}', 'matrix_layout_ambiguity'),
])
def test_ambiguous_notation_is_flagged_without_guessing(tmp_path, monkeypatch, raw, code):
    monkeypatch.setattr(extract, '_ocr', lambda image: (raw, 0.99))
    monkeypatch.setattr(extract, '_math_ocr', lambda image: None)
    pages, _ = extract._image_pages(_png(), 'f1', tmp_path)
    assert pages[0]['text'] == raw
    quality = pages[0]['ocr_quality']
    assert quality['untrusted'] and quality['requires_review']
    assert any(e['code'] == code for e in quality['evidence'])


@pytest.mark.parametrize('raw', ['矩阵 A=[1 2;3 4]', r'A=\begin{pmatrix}1&2\\3&4\end{pmatrix}'])
def test_explicit_matrix_cell_separators_are_not_guessed_as_missing(raw):
    from app.labs.source_recovery import assess_text_quality
    quality = assess_text_quality(raw, [{'image_key': 'f1_p1', 'ocr_text': raw, 'ocr_confidence': 0.99}])
    assert not quality['untrusted']
    assert quality['needs_visual_verification']


def test_low_confidence_prose_also_requires_source_review(tmp_path, monkeypatch):
    monkeypatch.setattr(extract, '_ocr', lambda image: ('说明算法的步骤。', 0.3))
    monkeypatch.setattr(extract, '_math_ocr', lambda image: None)
    pages, _ = extract._image_pages(_png(), 'f1', tmp_path)
    assert pages[0]['requires_source_review']
    assert not pages[0]['requires_formula_confirmation']
    assert pages[0]['ocr_quality']['untrusted']


def test_ambiguous_math_candidate_cannot_silently_overwrite_ordinary_ocr(tmp_path, monkeypatch):
    monkeypatch.setattr(extract, '_ocr', lambda image: ('dx', 0.99))
    raw_math = r'\int_0^1 x^{~2} dx'
    monkeypatch.setattr(extract, '_math_ocr', lambda image: raw_math)
    pages, _ = extract._image_pages(_png(), 'f1', tmp_path)
    assert pages[0]['text'] == 'dx'
    assert pages[0]['math_text'] == raw_math
    assert pages[0]['ocr_quality']['untrusted']


def test_formula_repair_is_a_reviewable_proposal_not_original_text(tmp_path, monkeypatch):
    raw_math = r'\int_{x\to0} x^2=0'
    monkeypatch.setattr(extract, '_ocr', lambda image: ('求极限 lim', 0.99))
    monkeypatch.setattr(extract, '_math_ocr', lambda image: raw_math)
    pages, _ = extract._image_pages(_png(), 'f1', tmp_path)
    page = pages[0]
    assert page['math_text'] == raw_math
    assert page['math_repaired_text'].startswith(r'\lim')
    assert page['requires_formula_confirmation']
    proposal = next(e for e in page['ocr_quality']['evidence'] if e['code'] == 'formula_repair_proposal')
    assert proposal['original'] == raw_math and proposal['requires_review']


def test_ocr_average_excludes_invalid_engine_scores(monkeypatch):
    box = [[0, 0], [20, 0], [20, 20], [0, 20]]
    rows = [[box, 'x^2', 0.2], [box, 'dx', float('nan')], [box, '=', 100]]
    monkeypatch.setattr(extract, '_ocr_engine', lambda: lambda image: (rows, 0))
    text, confidence = extract._ocr(Image.new('RGB', (180, 45), 'white'))
    assert text == 'x^2 dx ='
    assert confidence == 0.2


def test_quality_metadata_alone_preserves_the_review_gate():
    from app.labs.source_recovery import assess_text_quality
    original = assess_text_quality('y=x^2', [dict(image_key='f1_p1', ocr_text='y=x^2',
                                                math_text='y=x^3', ocr_confidence=0.2)])
    page = dict(image_key='f1_p1', ocr_quality=copy.deepcopy(original))
    rebuilt = assess_text_quality('y=x^2', [page])
    assert rebuilt['untrusted'] and rebuilt['requires_review']
    assert all(e in rebuilt['evidence'] for e in original['evidence'])
    assert all(c in rebuilt['candidates'] for c in original['candidates'])
    assert page['ocr_quality'] == original


def test_no_ocr_candidates_remains_untrusted(tmp_path, monkeypatch):
    monkeypatch.setattr(extract, '_ocr', lambda image: ('', None))
    monkeypatch.setattr(extract, '_math_ocr', lambda image: None)
    pages, _ = extract._image_pages(_png(), 'f1', tmp_path)
    quality = pages[0]['ocr_quality']
    assert quality['untrusted'] and pages[0]['requires_source_review']
    assert quality['candidates'][0]['comparison']['status'] == 'missing_candidate'
    assert not any(e['code'] == 'candidate_disagreement' for e in quality['evidence'])


def test_scanned_pdf_low_confidence_agreement_still_blocks(tmp_path, monkeypatch):
    document = pymupdf.open()
    document.new_page().insert_image(pymupdf.Rect(30, 30, 210, 75), stream=_png())
    data = document.tobytes()
    document.close()
    monkeypatch.setattr(extract, '_ocr', lambda image: ('y=x^2', 0.3))
    monkeypatch.setattr(extract, '_math_ocr', lambda image: r'y=x^{2}')
    pages, _ = extract._pdf_pages(data, 'f1', tmp_path, 1)
    quality = pages[0]['ocr_quality']
    assert quality['untrusted'] and quality['requires_review']
    assert quality['candidates'][0]['comparison']['status'] == 'equivalent'
    assert quality['candidates'][0]['ocr_confidence'] == 0.3

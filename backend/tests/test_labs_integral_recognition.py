"""OCR-to-solver regressions for textbook indefinite integrals and functions."""
import io
import math

import pytest
import sympy as sp
from PIL import Image

from app.labs import extract
from app.labs.expr import parse_expression
from app.labs.recognize import build_problem, rebuild_problem
from app.labs.solvers import solve_problem


@pytest.mark.parametrize('notation', [
    r'\int x\arctan x\,d x',
    r'\textstyle\int\!x\operatorname{arctan}x\,d x',
    r'\int x{\bf a r c t a n}x\,d x',
    r'\int\!\!\!\mathrm{xarctan}{x}\,d{x}',
])
def test_formula_display_retains_inverse_function_and_stores_executable_expression(notation):
    displayed = extract._latex_display(notation)
    p = build_problem(displayed)
    assert p['model']['kind'] == 'antiderivative'
    assert p['model']['expression'] == 'x*atan(x)'
    assert not p['model']['teaching']
    solution = solve_problem(p['model'])
    x = sp.Symbol('x', real=True)
    primitive = parse_expression(p['model']['antiderivative_expression'])
    assert sp.simplify(sp.diff(primitive, x)-x*sp.atan(x)) == 0
    assert '+C' in solution['answer']
    assert 'lower' not in p['model']['defaults']


def test_small_formula_crop_removes_chinese_label_but_keeps_integral_margin():
    image = Image.new('RGB', (405,126), 'white')
    # Approximate actual OCR regions of the user's screenshot: integral at x~155
    # is omitted by the text OCR, so cropping exactly at math text x=179 loses it.
    regions = [
        [[[27,34],[147,34],[147,81],[27,81]], '例2求', 0.99],
        [[[179,42],[385,39],[385,74],[180,76]], 'xarctanxdx', 0.99],
    ]
    cropped = extract._crop_formula_region(image, regions)
    assert cropped.width < image.width
    assert cropped.width >= 405-155  # preserve the omitted integral symbol
    assert cropped.height >= 80


def test_formula_crop_preserves_multiple_lines_and_labeled_formula_content():
    image = Image.new('RGB', (400,180), 'white')
    regions = [
        [[[20,10],[100,10],[100,45],[20,45]], '求∫', 0.99],
        [[[125,10],[380,10],[380,45],[125,45]], 'xarctanxdx', 0.99],
        [[[125,105],[380,105],[380,140],[125,140]], 'x0=1', 0.99],
    ]
    assert extract._crop_formula_region(image, regions).size == image.size


def test_long_single_formula_gets_math_ocr_but_prose_page_does_not():
    assert extract._should_try_math_ocr('例12 求不定积分 (x^2+3*x+1)*arctan(x)/(1+x^2) dx')
    assert not extract._should_try_math_ocr('这是一份完整的中文讲义，需要先阅读上下文后理解定积分的概念。'*8)


def test_formula_crop_keeps_separate_coefficient_and_wide_integral_gap():
    image = Image.new('RGB',(500,130),'white')
    image.putpixel((170,60),(0,0,0))  # separately recognized coefficient 2
    image.putpixel((145,25),(0,0,0))  # integral missed by the general OCR
    regions = [
        [[[20,35],[130,35],[130,80],[20,80]], '例2求', .99],
        [[[165,45],[180,45],[180,75],[165,75]], '2', .99],
        [[[205,45],[470,45],[470,75],[205,75]], 'sinxdx', .99],
    ]
    result = extract._crop_formula_region(image, regions)
    assert sum(pixel == (0,0,0) for pixel in result.getdata()) == 2


def test_unknown_latex_function_is_preserved_for_review_not_deleted():
    displayed=extract._latex_display(r'\int \mystery{x}\,dx')
    assert r'\mystery' in displayed
    assert build_problem(displayed)['status']=='needs_review'


@pytest.mark.parametrize('function,expected', [('arccot(1)', math.pi/4),('arcsec(2)',math.pi/3),('arccsc(2)',math.pi/6)])
def test_inverse_functions_are_not_reciprocal_trigonometric_functions(function, expected):
    assert float(parse_expression(function)) == pytest.approx(expected)


def test_actual_ocr_candidate_can_be_confirmed_without_transcribing_the_integrand(tmp_path, monkeypatch):
    monkeypatch.setattr(extract, '_ocr', lambda image: ('例2求\nxarctanxdx',0.99))
    monkeypatch.setattr(extract, '_math_ocr', lambda image: r'\textstyle\int\!x\operatorname{arctan}x\,d x')
    output = io.BytesIO()
    Image.new('RGB',(405,126),'white').save(output,format='PNG')
    pages,_ = extract._image_pages(output.getvalue(),'f1',tmp_path)
    p = build_problem(pages[0]['text'],pages=pages,files=[{'file_id':'f1','kind':'image','role':'problem'}])
    assert p['model']['expression'] == 'x*atan(x)'
    assert p['status'] == 'needs_review'
    reviewed = rebuild_problem(p,files=[],ambiguity_answers={'source_formula_confirmation':'confirmed'})
    assert reviewed['status'] == 'ready'
    assert reviewed['model']['kind'] == 'antiderivative'

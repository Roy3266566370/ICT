# -*- coding: utf-8 -*-
block = """

def test_round5_ocr_theta_as_ri():
    from app.labs.recognize import build_problem, _attach_solution
    # OCR 把 θ 读成「日」：0≤日≤1
    p = build_problem('求对数螺线r=e^θ在0≤日≤1上的弧长。（10分）')
    _attach_solution(p)
    assert p['model']['task'] == 'polar_arc_length'
    assert 'sqrt(2)' in p['solution']['answer']
"""
open(r'E:\代码\ICT\backend\tests\test_labs_p5_space.py', 'a', encoding='utf-8').write(block)
print('ok')

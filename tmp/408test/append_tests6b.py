# -*- coding: utf-8 -*-
block = '''

def test_round6_ocr_doubled_open_paren():
    # OCR 把 "（8分）" 读成 "（(8分）"：双左括号只多开一个，按重叠容错。
    from app.labs.source_recovery import assess_text_quality, transcription_issues
    assert transcription_issues('求点P(1,0,2)到直线x/1=y/1=z/0的距离。（(8分）') == []
    # 合法嵌套 ((x+y)) 不受影响；真缺右括号仍报缺。
    assert transcription_issues('f(x)=((x+y))*z') == []
    assert '公式圆括号不完整' in transcription_issues('f(x)=(x+y*z')
    quality = assess_text_quality(
        '求点P(1,0,2)到直线x/1=y/1=z/0的距离。（(8分）', [{'image_key': 'p1'}])
    assert quality['untrusted'] is False
'''
open(r'E:\代码\ICT\backend\tests\test_labs_p5_space.py', 'a', encoding='utf-8').write(block)
print('appended')

# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.source_recovery import assess_text_quality, transcription_issues

text = '高等数学期末试卷计算题\n4.（(8分）求点P(1,0,2)到直线\nx/1=y/1=z/0的距离。\n解：'
print('issues:', transcription_issues(text))
print('quality:', assess_text_quality(text, [{'image_key': 'f1_p1'}]))

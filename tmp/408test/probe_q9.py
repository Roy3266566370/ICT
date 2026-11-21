# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r'E:\代码\ICT\backend')
from app.labs.source_recovery import assess_text_quality, transcription_issues
t = '9．（8分）求三叶玫瑰线r=cos3θ一瓣\n(θE[-T/6,π/6]）的面积\n解：'
q = assess_text_quality(t, pages=[{'image_key': 'i', 'page': 1, 'file_id': 'f'}])
print('untrusted:', q['untrusted'], '| issues:', q['issues'])
print('evidence:', [(e.get('code'), e.get('blocking')) for e in q.get('evidence') or []])
print('transcription:', transcription_issues(t))

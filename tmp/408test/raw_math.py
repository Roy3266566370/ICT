import json, glob

for name in sys.argv[1:]:
    f = f'result_{name}.json'
    doc = json.load(open(f, encoding='utf-8'))
    data = doc.get('data') or doc
    for p in data.get('problems') or []:
        print('='*10, name, '='*10)
        print(repr(p.get('text')))
import sys

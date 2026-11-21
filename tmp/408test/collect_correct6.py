# -*- coding: utf-8 -*-
"""把第六轮正确题图归档到 correct\\round6_math_space 并更新 manifest。"""
import glob, json, os, shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.join(ROOT, 'correct', 'round6_math_space')
os.makedirs(DEST, exist_ok=True)

rows = []
for f in sorted(glob.glob(os.path.join(ROOT, 'result_m6*.json'))):
    png = os.path.basename(f)[len('result_'):-len('.json')]
    src = os.path.join(ROOT, png)
    d = json.load(open(f, encoding='utf-8'))['data']['problems'][0]
    m = d.get('model') or {}
    if m.get('engine') != 'space_v1':
        print('skip (not space_v1):', png, m.get('engine'))
        continue
    shutil.copy2(src, os.path.join(DEST, png))
    cond = m.get('conditions') or {}
    ans = ((d.get('solution') or {}).get('answer') or '')[:80].replace('\n', ' ')
    rows.append((png, d.get('status'), cond.get('geometry_kind') or '', ans))

mf = os.path.join(ROOT, 'correct', 'manifest.md')
with open(mf, 'a', encoding='utf-8') as w:
    for r in rows:
        w.write('| round6_math_space | ' + ' | '.join(str(x) for x in r) + ' |\n')
print(f'{len(rows)} images -> {DEST}')

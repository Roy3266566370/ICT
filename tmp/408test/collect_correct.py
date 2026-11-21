# -*- coding: utf-8 -*-
"""归档最终运算正确的题图：按 result_*.json 最新状态复制 PNG 到 correct\<轮次>\，并写 manifest。"""
import glob, json, os, shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.join(ROOT, 'correct')

ROUND = [
    (r'^result_mt', 'round1_math'),
    (r'^result_mu', 'round2_math'),
    (r'^result_m3', 'round3_math'),
    (r'^result_m4', 'round4_math'),
    (r'^result_m5', 'round5_math_big'),
    (r'^result_ph', 'physics'),
    (r'^result_os', 'os'),
    (r'^result_cn', 'network'),
    (r'^result_q', 'ds408'),
]
import re

def rnd(name):
    for pat, label in ROUND:
        if re.match(pat, name):
            return label
    return 'misc'

rows = []
seen = {}
for f in sorted(glob.glob(os.path.join(ROOT, 'result_*.json'))):
    base = os.path.basename(f)
    png = base[len('result_'):-len('.json')]
    png_path = os.path.join(ROOT, png)
    if not os.path.exists(png_path):
        continue
    try:
        d = json.load(open(f, encoding='utf-8'))
        p = d['data']['problems'][0]
    except Exception:
        continue
    m = p.get('model') or {}
    sol = p.get('solution') or {}
    eng = m.get('engine')
    if not eng:
        continue
    # 后写的覆盖先写的：按 mtime 取最新结果
    mtime = os.path.getmtime(f)
    if png in seen and seen[png][0] > mtime:
        continue
    seen[png] = (mtime, f, p.get('status'), eng, m.get('task'),
                 (sol.get('answer') or m.get('answer') or '')[:80])

for png, (mtime, f, status, eng, task, ans) in sorted(seen.items()):
    folder = rnd('result_' + png)
    out_dir = os.path.join(DEST, folder)
    os.makedirs(out_dir, exist_ok=True)
    shutil.copy2(os.path.join(ROOT, png), os.path.join(out_dir, png))
    rows.append((folder, png, status, eng, task or '', ans.replace('\n', ' ')))

with open(os.path.join(DEST, 'manifest.md'), 'w', encoding='utf-8') as w:
    w.write('# 已验证运算正确的题图归档\n\n')
    w.write('| 轮次 | 图片 | 状态 | engine | task | 答案 |\n')
    w.write('| --- | --- | --- | --- | --- | --- |\n')
    for r in rows:
        w.write('| ' + ' | '.join(str(x) for x in r) + ' |\n')

print(f'{len(rows)} images -> {DEST}')
from collections import Counter
print(Counter(r[0] for r in rows))

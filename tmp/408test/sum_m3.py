import json
import glob

for f in sorted(glob.glob('result_m3*.json')):
    d = json.load(open(f, encoding='utf8'))
    data = d.get('data') or d
    for p in data.get('problems') or []:
        m = p.get('model') or {}
        sol = p.get('solution') or {}
        ans = str(sol.get('answer'))[:55]
        print(f"{f[7:20]}: st={p['status']} eng={m.get('engine')} task={m.get('task') or m.get('kind')} ans={ans}")
        for a in (p.get('ambiguities') or []):
            print('   amb:', a.get('kind'), str(a.get('message'))[:60])

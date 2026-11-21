import json, glob, sys

prefix = sys.argv[1] if len(sys.argv) > 1 else 'mu'
for f in sorted(glob.glob(f'result_{prefix}*.json')):
    doc = json.load(open(f, encoding='utf-8'))
    data = doc.get('data') or doc
    for p in data.get('problems') or []:
        m = p.get('model') or {}
        s = p.get('solution') or {}
        rec = p.get('recognition') or {}
        print(f"{f[7:-5]}: st={p.get('status')} eng={m.get('engine')} kind={m.get('kind') or m.get('task')} "
              f"val={s.get('answer_value')}")
        print('   ', (s.get('answer') or s.get('headline') or '')[:150])
        for a in (rec.get('ambiguities') or [])[:3]:
            if a.get('severity') == 'blocking':
                print('    amb:', a.get('id'), str(a.get('question') or '')[:120])

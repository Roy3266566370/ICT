"""Real MaaS + Chromium acceptance runner; no model mocks or output injection."""
import argparse
import json
import subprocess
import time
import sys
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'verify' / 'natural-labs-2026-11-16'
sys.path.insert(0, str(ROOT / 'backend'))
from scripts.dev_server import server_session

CLI = Path.home() / 'AppData/Roaming/npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
SESSION = 'ict-natural-matrix'
CASES = {
    'continuity': dict(task='continuity', full='判断函数 f(x)=sin(x)/x 在 x=0 处的连续性，其中 f(0)=1。', missing='判断函数 f(x)=sin(x)/x 在 x=0 处的连续性，该点补定义的函数值待补充。', fill={'point_value': '1'}, edit={'point_value': '2'}),
    'multivariable': dict(task='multivariable', full='求函数 f(x,y)=x^2+y^2 在点(1,2)沿向量(3,4)方向的方向导数。', missing='求函数 f(x,y)=x^2+y^2 在点(1,2)沿给定方向的方向导数，方向向量待补充。', fill={'direction': '3,4'}, edit={'point': '2,2'}),
    'extrema': dict(task='multivariable_extrema', full='求二元函数 f(x,y)=x^2+y^2 的无约束局部极值，变量为x,y。', missing='求二元函数 f(x,y) 的无约束局部极值，变量为x,y，函数表达式待补充。', fill={'expression': 'x^2+y^2'}, edit={'expression': '-x^2-y^2'}),
    'series': dict(task='series_convergence', full='判断数项级数从n=1到无穷的求和 1/n^2 的敛散性。', missing='判断从n=1到无穷的数项级数敛散性，通项待补充。', fill={'term': '1/n^2'}, edit={'term': '1/n'}),
    'ode': dict(task='ode', full="求常微分方程 y'=y 满足 y(0)=1 的特解，自变量为x，未知函数为y。", missing="求常微分方程 y'=y 的特解，自变量为x，未知函数为y，初值条件待补充。", fill={'initial_conditions': 'y(0)=1'}, edit={'initial_conditions': 'y(0)=2'}),
    'space': dict(task='space_geometry', full='求点(0,0,0)到平面 x-2=0 的距离。', missing='求点(0,0,0)到一个平面的距离，平面方程待补充。', fill={'plane': '[1,0,0,-2]'}, edit={'plane': '[1,0,0,-3]'})}


def cli(*args):
    r = subprocess.run([str(CLI), '--session', SESSION, *map(str, args), '--json'], capture_output=True, encoding='utf-8', timeout=45)
    try:
        j = json.loads(r.stdout)
    except ValueError:
        raise RuntimeError((r.stdout + r.stderr)[-1800:])
    if not j.get('success'):
        raise RuntimeError(str(j.get('error')))
    return j.get('data') or {}


def js(code):
    return cli('eval', code).get('result')


def find(role, name, action='click', value=None):
    args = ['find', 'role', role, action]
    if value is not None:
        args.append(value)
    return cli(*args, '--name', name, '--exact')


def doc():
    return js("location.pathname.startsWith('/labs/lab_') ? fetch(location.pathname.replace('/labs/','/api/v1/labs/')).then(r=>r.json()).then(r=>r.data) : null")


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def capture(prefix, d):
    save(OUT / (prefix + '.json'), d)
    time.sleep(.3)
    cli('screenshot', str(OUT / (prefix + '.png')))
    p = d['problems'][0]
    return dict(lab_id=d['lab_id'], status=p['status'], verification=p.get('ai_solution', {}).get('verification'), task=p.get('ai_solution', {}).get('agent_understanding', {}).get('model', {}).get('task'), answer=p.get('solution', {}).get('answer'), artifact=prefix + '.json')


def create(family, scenario):
    case = CASES[family]
    prefix = family + '-' + scenario + '-' + str(int(time.time()))
    print('START ' + prefix, flush=True)
    cli('open', 'http://localhost:5173/labs')
    for _ in range(30):
        if js("[...document.querySelectorAll('[role=tab]')].some(e=>e.textContent==='粘贴文字')"):break
        time.sleep(.3)
    for _ in range(30):
        if js("fetch('/api/v1/sessions/current').then(r=>r.status===200)"):break
        time.sleep(.5)
    find('tab', '粘贴文字')
    find('textbox', '题目原文', 'fill', case[scenario])
    find('button', '建立实验室')
    started = time.monotonic()
    forced = clicked = False
    while time.monotonic() - started < 300:
        d = doc()
        if not d and js("!!document.querySelector('[role=alert]')"):
            raise RuntimeError(str(js("document.querySelector('[role=alert]').textContent")))
        if d and d['problems'][0].get('ai_solution'):
            result = capture(prefix, d)
            result.update(input=case[scenario], scenario=scenario, family=family, elapsed=round(time.monotonic()-started, 2), ai_trigger='explicit_api_diagnostic' if forced else 'ui')
            result['pass'] = result['task'] == case['task'] and (result['verification'] == 'kernel' if scenario == 'full' else result['verification'] == 'needs_review' and bool(d['problems'][0]['recognition'].get('conditions')))
            if scenario == 'missing':
                result['pass'] = result['pass'] and all(any(a.get('field') == field and a.get('severity') == 'blocking' for a in d['problems'][0]['recognition']['ambiguities']) for field in case['fill']) and not d['problems'][0]['solution']['answer']
            save(OUT / (prefix + '-result.json'), result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
            return result
        if d and not clicked:
            enabled = js("[...document.querySelectorAll('button')].some(e=>e.textContent==='重新准备实验'&&!e.disabled)")
            if enabled:
                find('button', '重新准备实验')
                clicked = True
            elif time.monotonic()-started > 25 and not js("document.body.textContent.includes('正在准备可视化实验')"):
                js("(async()=>{const s=await fetch('/api/v1/sessions/current').then(r=>r.json());const d=await fetch(location.pathname.replace('/labs/','/api/v1/labs/')).then(r=>r.json()).then(r=>r.data);window.__diagnostic=fetch('/api/v1/labs/'+d.lab_id+'/ai-solve',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.data.csrf_token},body:JSON.stringify({problem_id:d.problems[0].problem_id,expected_revision:d.revision,mode:'auto',force:true})}).then(r=>r.json()).then(r=>{window.__diagnosticResult=r;location.reload()});return 'started';})()")
                forced = clicked = True
        time.sleep(2)
    raise RuntimeError('real AI deadline exceeded')


def review(family, scenario, lab_id):
    prefix = family + '-' + scenario + '-' + str(int(time.time()))
    case = CASES[family]
    cli('open', 'http://localhost:5173/labs/' + lab_id)
    time.sleep(1)
    d = doc()
    p = d['problems'][0]
    before = p.get('solution', {}).get('answer')
    previous_revision = d['revision']
    js("[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent.startsWith('条件'))?.click()")
    time.sleep(.3)
    find('button', '核对与修正')
    fields = case['fill' if scenario == 'fill' else 'edit']
    for key, value in fields.items():
        condition = next((c for c in p['recognition']['conditions'] if c['id'] == key), None)
        if not condition:
            raise RuntimeError('review field absent: ' + key)
        find('textbox', condition['label'], 'fill', value)
    find('button', '确认并重新求解')
    for _ in range(35):
        time.sleep(1)
        d = doc()
        if d['revision'] > previous_revision:
            time.sleep(.3)
            break
    else:
        raise RuntimeError('review request did not finish: ' + str(js("document.body.textContent.slice(-1500)")))
    result = capture(prefix, d)
    result.update(family=family, scenario=scenario, changed=fields, before=before)
    result['pass'] = result['task'] == case['task'] and result['verification'] == 'kernel' and (scenario == 'fill' or result['answer'] != before)
    save(OUT / (prefix + '-result.json'), result)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return result


def audit(family, lab_id):
    import hashlib
    prefix = family + '-audit-' + str(int(time.time()))
    cli('open', 'http://localhost:5173/labs/' + lab_id)
    for _ in range(30):
        if js("!!document.querySelector('input[type=range]')"):
            break
        time.sleep(.3)
    d = doc()
    p = d['problems'][0]
    control = p['model']['params'][0]
    key = control['id']
    value = p['states']['params'].get(key, p['model']['defaults'][key])
    delta = control.get('step') or .1
    changed_value = value + delta if value + delta <= (control.get('max') or 100000) else value - delta
    svg = "[...document.querySelectorAll('svg[role=img]')].map(e=>e.outerHTML).join('')"
    before = js(svg)
    find('spinbutton', control['label'] + ' 数值', 'fill', str(changed_value))
    time.sleep(.2)
    after = js(svg)
    find('button', '保存')
    for _ in range(30):
        time.sleep(.3)
        saved = doc()
        if saved['problems'][0]['states']['params'].get(key) == changed_value:
            break
    cli('reload')
    time.sleep(.5)
    restored = doc()
    result = capture(prefix, restored)
    result.update(family=family, scenario='audit', control=key, original=value, changed=changed_value,
                  svg_before_sha256=hashlib.sha256(before.encode()).hexdigest(),
                  svg_after_sha256=hashlib.sha256(after.encode()).hexdigest(),
                  svg_changed=before != after,
                  restored=restored['problems'][0]['states']['params'].get(key) == changed_value,
                  source_answer_unchanged=restored['problems'][0]['solution']['answer'] == p['solution']['answer'])
    result['pass'] = bool(before and after and result['svg_changed'] and result['restored'] and result['source_answer_unchanged'])
    if family in ('multivariable', 'extrema'):
        result['slice_label_correct'] = '多元函数观察切片' in after and '黎曼和' not in after
        result['pass'] = result['pass'] and result['slice_label_correct']
    save(OUT / (prefix + '-result.json'), result)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('family', choices=list(CASES) + ['all'])
    parser.add_argument('--scenario', choices=['full', 'missing', 'fill', 'edit', 'audit'], default='full')
    parser.add_argument('--lab')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--fresh', action='store_true', help='Start/stop an owned backend on 8000 (default); occupied port fails')
    mode.add_argument('--existing', action='store_true', help='Borrow a verified backend; requires --launch-id')
    parser.add_argument('--launch-id')
    parser.add_argument('--check-only', action='store_true', help='Verify backend and Vite proxy identity without browser/AI requests')
    args = parser.parse_args()
    failed = False
    with server_session(port=8000, existing=args.existing, launch_id=args.launch_id) as server:
        # Verify the actual frontend proxy as well, not just a different backend
        # on the expected port. /api/__dev__/identity passes through Vite's /api proxy.
        server.check('http://localhost:5173')
        print(json.dumps({'server_identity': server.identity}), flush=True)
        if args.check_only:
            return 0
        OUT.mkdir(parents=True, exist_ok=True)
        save(OUT / ('run-identity-' + server.identity['launch_id'] + '.json'), server.identity)
        try:
            for family in CASES if args.family == 'all' else [args.family]:
                # Fail closed outside the per-case error handler: never continue
                # submitting paid requests after the process/source has changed.
                server.check('http://localhost:5173')
                try:
                    if args.scenario in ('full', 'missing'):
                        result = create(family, args.scenario)
                    else:
                        lab_id=args.lab
                        if not lab_id:
                            source_scenario='missing' if args.scenario=='fill' else 'edit' if args.scenario=='audit' else 'full'
                            candidates=[json.loads(p.read_text(encoding='utf-8')) for p in sorted(OUT.glob(family+'-'+source_scenario+'-*-result.json'))]
                            candidates=[r for r in candidates if r.get('pass')]
                            if not candidates:raise RuntimeError('no passing source case for review')
                            lab_id=candidates[-1]['lab_id']
                        if args.scenario == 'audit':
                            result = audit(family, lab_id)
                        else:
                            result = review(family, args.scenario, lab_id)
                    failed = failed or not result.get('pass')
                except Exception as e:
                    failed = True
                    print(json.dumps(dict(family=family, scenario=args.scenario, error=str(e)), ensure_ascii=False), flush=True)
                    save(OUT / (family + '-' + args.scenario + '-error-' + str(int(time.time())) + '.json'), {'error': str(e)})
                server.check('http://localhost:5173')
        finally:
            try:
                cli('close')
            except Exception as exc:
                print('Browser cleanup failed: ' + str(exc), file=sys.stderr)
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())

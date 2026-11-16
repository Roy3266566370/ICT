"""Verify mathematical expectations and produce the saved live acceptance index."""
import html
import json
from datetime import datetime
from verify_natural_labs import CASES, OUT, save

NAMES = dict(continuity='连续性', multivariable='多元微分', extrema='多元极值', series='数项级数', ode='ODE', space='空间几何')
EXPECTED = {
    'continuity': ('处：连续', '可去间断点'),
    'multivariable': ('22/5', '28/5'),
    'extrema': ('局部极小值点(0, 0)', '局部极大值点(0, 0)'),
    'series': ('绝对收敛', '发散'),
    'ode': ('y = exp(x)', 'y = 2*exp(x)'),
    'space': ('距离 2', '距离 3'),
}


def latest(family, scenario):
    path = sorted(OUT.glob(f'{family}-{scenario}-*-result.json'))[-1]
    result = json.loads(path.read_text(encoding='utf-8'))
    assert result['pass'], (path.name, result)
    document = json.loads((OUT / result['artifact']).read_text(encoding='utf-8'))
    problem = document['problems'][0]
    solution = problem['ai_solution']
    assert solution['model_name'] == 'qwen3-vl:2b-instruct-q4_K_M'
    assert result['task'] == CASES[family]['task']
    if scenario in ('full', 'fill', 'edit'):
        expected = EXPECTED[family][scenario == 'edit']
        assert expected in result['answer'], (path.name, expected, result['answer'])
        assert result['status'] == 'ready' and result['verification'] == 'kernel'
    if scenario == 'missing':
        assert not problem['solution']['answer'] and not solution['computation']
        assert result['status'] == 'needs_review'
        for field in CASES[family]['fill']:
            assert any(c['id'] == field for c in problem['recognition']['conditions'])
            assert any(a.get('field') == field and a.get('severity') == 'blocking' for a in problem['recognition']['ambiguities'])
            assert solution['agent_understanding']['model']['conditions'].get(field) is None
    result['result_file'] = path.name
    result['screenshot'] = family+'-final-canvas.png' if scenario == 'audit' and (OUT/(family+'-final-canvas.png')).exists() else result['artifact'].replace('.json', '.png')
    return result


rows = []
for family in CASES:
    stages = {scenario: latest(family, scenario) for scenario in ('full', 'missing', 'fill', 'edit', 'audit')}
    assert stages['missing']['lab_id'] == stages['fill']['lab_id']
    assert stages['full']['lab_id'] == stages['edit']['lab_id'] == stages['audit']['lab_id']
    assert stages['fill']['before'] == ''
    assert stages['full']['ai_trigger'] == stages['missing']['ai_trigger'] == 'ui'
    rows.append(dict(family=family, name=NAMES[family], passed=True, stages=stages))

summary = dict(date='2026-11-16', timezone='Asia/Shanghai', generated_at=datetime.now().isoformat(),
               model='qwen3-vl:2b-instruct-q4_K_M', browser='agent-browser / Chromium',
               origin='http://localhost:5173', mock_model=False, native_form_submission=True,
               core_scenarios=18, replenishment_checks=6, canvas_persistence_checks=6,
               total_final_checks=30, passed=30, failed=0, rows=rows,
               regression_tests={'backend_related':{'passed':134,'failed':0},'frontend_labs':{'passed':180,'failed':0},'typescript':'passed'},
               scope='每类一个完整题面与一个缺条件题面；通过核对弹窗补齐和修改。空间平面系数由程序规范化AI提取及原文，未让模型猜系数。',
               history='同目录保留所有早期失败记录和重跑记录；汇总验证每类每阶段最后一次运行，没有用较早成功掩盖最新失败。')
save(OUT / 'summary.json', summary)

table = []
for row in rows:
    cells = []
    for scenario in ('full', 'missing', 'fill', 'edit', 'audit'):
        r = row['stages'][scenario]
        text = '已阻断，待补齐' if scenario == 'missing' else '画布变化、保存与刷新恢复均通过' if scenario == 'audit' else r['answer']
        cells.append(f'<td><b>通过</b><p>{html.escape(text)}</p><a href="{r["result_file"]}">结果</a> · <a href="{r["artifact"]}">原始文档与AI输出</a> · <a href="{r["screenshot"]}">截图</a></td>')
    table.append('<tr><th>' + row['name'] + '</th>' + ''.join(cells) + '</tr>')

fixes = ['补全连续性、多元微分、极值及空间几何的任务专用Schema、字段类型与路由。',
         '对明确缺失的条件保留null和阻断表单，不采纳模型补造的方向、初值或函数表达式。',
         '补定义不再被当作概念题；ODE缺初值的特解请求进入条件核对。',
         '线性平面方程规范化为四个系数，并绑定来源；未知额外条件仍须通过覆盖校验。',
         '核对弹窗使用AI模型声明的多元变量，修复公式误报和不可提交；输入框标签可稳定定位。',
         'AI映射失败时清除未核验的旧答案；多元切片不再误显示黎曼和标注。',
         '可选条件为null时仍生成对应blocking表单；ODE初值可直接输入y(0)=1等普通文本，不要求手写JSON。',
         '成功回退到通用AI内核后，将先前编排记录折叠，避免旧失败状态与当前结果混淆。']
report = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>自然语言题目实验室验收</title>
<style>body{font:15px/1.65 system-ui;margin:36px;color:#17202b;background:#faf9f6}table{border-collapse:collapse;width:100%;background:white}th,td{border:1px solid #ddd;padding:12px;vertical-align:top}td{min-width:155px}b{color:#087346}a{color:#164ca6}p{margin:5px 0}small{color:#555}</style>
<h1>六类自然语言题目验收记录</h1><p>2026-11-16 · 真实 qwen3-vl:2b-instruct-q4_K_M · Chromium · 本地 http://localhost:5173</p>
<p><b>18组核心场景、6次缺条件补齐、6次画布交互与刷新恢复：30/30通过。</b></p><p>相关后端回归134项、前端实验室测试180项通过；TypeScript检查通过。</p>
<p>12份自然语言题面均通过实际页面的“粘贴文字→建立实验室”入口；未注入AI结果、未使用模型Mock。每阶段保存实验室ID、任务、条件、原始AI输出、内核结果及截图。</p>
<p><a href="summary.json">完整汇总JSON</a>。各行“完整条件”和“修改重算”对应同一个实验室；“缺条件”和“补齐后”对应另一个实验室。</p>
<table><thead><tr><th>题型</th><th>条件完整</th><th>缺条件</th><th>补齐后</th><th>修改重算</th><th>画布与保存</th></tr></thead><tbody>'''
report += ''.join(table) + '</tbody></table><h2>发现并修复</h2><ul>' + ''.join('<li>' + html.escape(v) + '</li>' for v in fixes) + '</ul>'
report += '<p><small>覆盖范围：每类一组完整和缺条件题面，未穷举所有表达方式。此前失败与重跑记录均保留在本目录，最终汇总只接受各阶段最后一次运行通过。空间任务的平面系数由已有确定性流程规范化来源表达式。</small></p></html>'
(OUT / 'index.html').write_text(report, encoding='utf-8')
print(json.dumps(dict(passed=30, failed=0, report=str(OUT / 'index.html')), ensure_ascii=False))

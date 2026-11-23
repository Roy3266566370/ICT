"""M6 任务 3：实验室长尾 program_sandbox 视图与 SymPy 探针验算专项测试。"""
from __future__ import annotations

import pytest

from app.labs.walkthrough import pattern_router, service
from app.labs.walkthrough.program_sandbox import (
    ProbeSpec,
    ProgramFormulaRef,
    ProgramParamSpec,
    ProgramProposal,
    ProgramStepSpec,
    validate_and_build_program,
)


def _sample_proposal(*, title: str, program: str, params: list[ProgramParamSpec], probes: list[ProbeSpec]) -> ProgramProposal:
    return ProgramProposal(
        pattern='program_sandbox',
        title=title,
        why='通过参数调节与画布拖动手柄直观观察变化规律。',
        alternatives=['解析手算推导'],
        params=params,
        steps=[
            ProgramStepSpec(
                id='s1',
                title='观察初始形态',
                explain='先观察默认参数下的几何/曲线结构。',
                preset={params[0].id: params[0].default},
                formulas=[ProgramFormulaRef(tex='x(t), y(t)', check=probes[0].id)],
            ),
            ProgramStepSpec(
                id='s2',
                title='拖动参数验证临界点',
                explain='拖动参数并对照 SymPy 核验探针。',
                preset={params[0].id: params[0].max},
                formulas=[ProgramFormulaRef(tex='\\text{probe}_2', check=probes[1].id)],
            ),
        ],
        program=program,
        verification_probes=probes,
    )


@pytest.mark.parametrize(
    'case_name,title,params,program,probes',
    [
        (
            'lissajous_parametric',
            '参数方程李萨如轨迹',
            [ProgramParamSpec(id='k', label='频率比 k', min=1, max=4, step=1, default=2)],
            (
                "function render(input){var pts=[],i;"
                "for(i=0;i<=80;i++){var t=i/80*2*Math.PI;pts.push([360+180*Math.sin(input.k*t),210-140*Math.sin(t)]);}"
                "return {version:'ppt-ai.view.1',width:720,height:420,interactions:[],"
                "nodes:[{id:'curve',type:'polyline',points:pts,style:{stroke:'#2563eb',strokeWidth:2.5}},"
                "{id:'f',type:'formula',x:80,y:40,tex:'x=\\\\sin(kt),\\\\;y=\\\\sin(t)',style:{fill:'#0f172a',fontSize:15}}]};}"
            ),
            [
                ProbeSpec(id='p1', label='t=pi/2 时 y 值', expression='sin(t)', variables={'t': 'pi/2'}, expected='1'),
                ProbeSpec(id='p2', label='k=2, t=pi/4 时 x 值', expression='sin(2*t)', variables={'t': 'pi/4'}, expected='1'),
            ],
        ),
        (
            'eigen_transform',
            '2x2 矩阵特征向量变换',
            [ProgramParamSpec(id='ang', label='输入向量角度', min=0, max=6.28, step=0.1, default=0.5)],
            (
                "function render(input){var vx=Math.cos(input.ang),vy=Math.sin(input.ang);"
                "var ax=2*vx+vy,ay=vy;"
                "return {version:'ppt-ai.view.1',width:720,height:420,"
                "interactions:[{type:'drag-handle',id:'h_ang',label:'调节角度',x:360+vx*90,y:210-vy*90,xParam:'ang',"
                "bounds:{xMin:180,xMax:540,yMin:60,yMax:360},valueRange:{x:[0,6.28]}}],"
                "nodes:[{id:'v',type:'arrow',x1:360,y1:210,x2:360+vx*90,y2:210-vy*90,label:'v',style:{stroke:'#0284c7',strokeWidth:3}},"
                "{id:'av',type:'arrow',x1:360,y1:210,x2:360+ax*60,y2:210-ay*60,label:'Av',style:{stroke:'#c4622d',strokeWidth:3}}]};}"
            ),
            [
                ProbeSpec(id='det_check', label='矩阵行列式', expression='2*1 - 1*0', expected='2'),
                ProbeSpec(id='tr_check', label='矩阵迹', expression='2 + 1', expected='3'),
            ],
        ),
        (
            'damped_oscillation',
            '二阶阻尼振动相图',
            [ProgramParamSpec(id='zeta', label='阻尼比 ζ', min=0.05, max=1.5, step=0.05, default=0.2)],
            (
                "function render(input){var pts=[],i;"
                "for(i=0;i<=90;i++){var t=i*0.12;var x=Math.exp(-input.zeta*t)*Math.cos(t);"
                "pts.push([80+i*6,210-x*140]);}"
                "return {version:'ppt-ai.view.1',width:720,height:420,interactions:[],"
                "nodes:[{id:'wave',type:'polyline',points:pts,style:{stroke:'#7c3aed',strokeWidth:2.4}}]};}"
            ),
            [
                ProbeSpec(id='init_amp', label='t=0 初始位移', expression='exp(-z*t)*cos(t)', variables={'z': '0.2', 't': '0'}, expected='1'),
                ProbeSpec(id='decay_check', label='z=1, t=1 衰减因子', expression='exp(-z*t)', variables={'z': '1', 't': '1'}, expected='exp(-1)'),
            ],
        ),
    ],
)
def test_program_sandbox_three_long_tail_variants(case_name, title, params, program, probes):
    proposal = _sample_proposal(title=title, program=program, params=params, probes=probes)
    built = validate_and_build_program(proposal, probe_node=True)
    assert built['pattern'] == 'program_sandbox', case_name
    assert built['verification']['status'] == 'verified', case_name
    assert len(built['steps']) == 2
    assert built['steps'][0]['view']['name'] == 'program_view'


def test_program_sandbox_blocks_malicious_code_nan_and_tampered_probes():
    params = [ProgramParamSpec(id='a', label='a', min=0, max=2, step=0.1, default=1)]
    good_probes = [
        ProbeSpec(id='p1', label='c1', expression='1+1', expected='2'),
        ProbeSpec(id='p2', label='c2', expression='2*3', expected='6'),
    ]

    # 1. 静态黑名单拦截 window / eval
    bad_script = _sample_proposal(
        title='恶意脚本',
        params=params,
        program="function render(input){window.location='x';return {version:'ppt-ai.view.1',nodes:[],interactions:[]};}",
        probes=good_probes,
    )
    with pytest.raises(ValueError, match='静态安全校验'):
        validate_and_build_program(bad_script, probe_node=True)

    # 2. Node 试运行拦截 NaN
    nan_script = _sample_proposal(
        title='NaN 脚本',
        params=params,
        program="function render(input){return {version:'ppt-ai.view.1',interactions:[],nodes:[{id:'p',type:'point',x:0/0,y:10}]};}",
        probes=good_probes,
    )
    with pytest.raises(ValueError, match='试运行未通过'):
        validate_and_build_program(nan_script, probe_node=True)

    # 3. SymPy 探针篡改标记 unverified
    tampered = _sample_proposal(
        title='篡改探针',
        params=params,
        program="function render(input){return {version:'ppt-ai.view.1',interactions:[],nodes:[{id:'p',type:'point',x:100+input.a*20,y:100}]};}",
        probes=[
            ProbeSpec(id='p1', label='错误断言', expression='1+1', expected='999'),
            ProbeSpec(id='p2', label='正确断言', expression='2*3', expected='6'),
        ],
    )
    built = validate_and_build_program(tampered, probe_node=True)
    assert built['verification']['status'] == 'unverified'
    by_id = {c['id']: c for c in built['verification']['checks']}
    assert by_id['p1']['status'] == 'unverified'
    assert by_id['p2']['status'] == 'verified'


def test_program_sandbox_router_and_dispatch(monkeypatch):
    assert pattern_router.detect_mode({'text': '绘制二阶阻尼振动的相图并观察阻尼比影响', 'subject': 'physics'}) == 'program_sandbox'
    assert pattern_router.detect_mode({'text': '求 2x2 矩阵的特征值与特征向量并可视化线性变换', 'subject': 'linear_algebra'}) == 'program_sandbox'
    # 高频固定原语仍然保持高优先级不被长尾抢占
    assert pattern_router.detect_mode({'text': '求极限 lim_{x->0} sin(x)/x', 'subject': 'calculus'}) == 'limit_approach'

    monkeypatch.setattr(service, 'configured', lambda: True)

    def fake_complete_json(*, response_model, validator, **kwargs):
        payload = {
            'pattern': 'program_sandbox',
            'title': '矩阵特征向量演示',
            'why': '观察向量经线性变换后的伸缩与方向保持。',
            'alternatives': ['求解特征多项式'],
            'params': [{'id': 'k', 'label': '系数 k', 'min': 0.5, 'max': 3.0, 'step': 0.1, 'default': 1.0, 'unit': ''}],
            'steps': [
                {'id': 's1', 'title': '初始向量', 'explain': '观察输入向量。', 'preset': {'k': 1.0}, 'formulas': [{'tex': 'Av=\\lambda v', 'check': 'p1'}]},
                {'id': 's2', 'title': '伸缩验证', 'explain': '改变 k 观察比例不变。', 'preset': {'k': 2.0}, 'formulas': [{'tex': '\\lambda=2', 'check': 'p2'}]},
            ],
            'program': "function render(input){return {version:'ppt-ai.view.1',width:720,height:420,interactions:[],nodes:[{id:'v',type:'arrow',x1:100,y1:210,x2:100+input.k*80,y2:210,label:'v',style:{stroke:'#2563eb',strokeWidth:3}}]};}",
            'verification_probes': [
                {'id': 'p1', 'label': '特征值校验', 'expression': '2*1', 'expected': '2'},
                {'id': 'p2', 'label': '行列式校验', 'expression': '2*3 - 0', 'expected': '6'},
            ],
        }
        validator(payload)
        return response_model.model_validate(payload), {'attempts': 1}

    monkeypatch.setattr('app.labs.walkthrough.program_sandbox.complete_json', fake_complete_json)
    problem = {'text': '可视化 2x2 矩阵的特征向量与线性变换', 'subject': 'linear_algebra'}
    result = service.generate(problem)
    assert result['pattern'] == 'program_sandbox'
    assert result['verification']['status'] == 'verified'
    assert result['input_hash'] == service.input_hash(problem)

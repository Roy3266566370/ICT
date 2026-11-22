import test from 'node:test';
import assert from 'node:assert/strict';
import { evalOutput, makeCtx } from '../canvas/engine.ts';
import { compileLabToCanvas } from './labToCanvas.ts';
import { MANUAL_408_SUBJECTS } from './manual408.ts';
import type { LabProblem } from './types.ts';

function problem(patch: Record<string, unknown>): LabProblem {
  return {
    problem_id: 'p1',
    number: null,
    title: '测试真题',
    text: '这是原题文字，不能被覆盖。',
    subject: 'calculus',
    subject_label: '高数',
    confidence: 1,
    status: 'ready',
    source: { page_from: 1, page_to: 1, file_names: [], label: '真题来源', excerpt: '' },
    source_pages: [],
    recognition: { conditions: [], ambiguities: [] },
    model: { engine: 'test', subject: 'calculus', defaults: {}, params: [] },
    solution: { summary: '摘要', answer: '原题答案', steps: [] },
    states: { params: {}, step: 0, mode: 'solution', notes: '', observations: [], events: [], scenarios: [], active_scenario_id: '', attempts: [], evaluated: null },
    ...patch,
  } as unknown as LabProblem;
}

function assertWires(doc: NonNullable<ReturnType<typeof compileLabToCanvas>>['doc']): void {
  const ids = new Set(doc.nodes.map((node) => node.id));
  for (const wire of doc.wires) {
    assert.ok(ids.has(wire.from), `连线源 ${wire.from} 不存在`);
    assert.ok(ids.has(wire.to), `连线目标 ${wire.to} 不存在`);
  }
  assert.equal(doc.version, 1);
}

test('导数题编译为函数源、滑杆、导数与图像积木，并继承当前探索参数', () => {
  const compiled = compileLabToCanvas(problem({
    model: { engine: 'derivative_v1', subject: 'calculus', kind: 'derivative', expression: 'x^2', derivative_point: '1', defaults: { x0: 1, h: 0.5 }, params: [] },
  }), { params: { point: 2.5, h: 0.25 } });
  assert.ok(compiled);
  const types = compiled.doc.nodes.map((node) => node.type);
  for (const type of ['functionSource', 'slider', 'derivative', 'functionPlot', 'spark', 'textNote']) {
    assert.ok(types.includes(type as never), `缺少 ${type}`);
  }
  assert.match(compiled.doc.nodes[0]!.text ?? '', /原题答案/);
  assert.equal(compiled.doc.nodes.find((node) => node.type === 'slider')?.params.v, 2.5);
  const derivative = compiled.doc.nodes.find((node) => node.type === 'derivative');
  assert.equal(derivative?.params.x, 2.5);
  assert.equal(derivative?.params.h, 0.25);
  assertWires(compiled.doc);
});

test('定积分题同时搭出原函数积分与泰勒近似积分双路', () => {
  const compiled = compileLabToCanvas(problem({
    model: { engine: 'riemann_v1', subject: 'calculus', kind: 'integral', expression: 'x^2', defaults: { lower: 0, upper: 1, n: 12 }, params: [] },
  }), { params: { lower: -2, upper: 3, n: 40 } });
  assert.ok(compiled);
  const integrals = compiled.doc.nodes.filter((node) => node.type === 'integral');
  assert.equal(integrals.length, 2);
  for (const integral of integrals) {
    assert.equal(integral.params.lower, -2);
    assert.equal(integral.params.upper, 3);
    assert.equal(integral.params.n, 40);
  }
  assert.ok(compiled.doc.nodes.some((node) => node.type === 'taylor'));
  assertWires(compiled.doc);
});

test('极限题只生成一个 limitProbe，同时接函数源与滑杆', () => {
  const compiled = compileLabToCanvas(problem({
    model: { engine: 'analysis_v1', subject: 'calculus', kind: 'limit', expression: 'sin(x)/x', limit_point_value: 0, defaults: {}, params: [] },
  }));
  assert.ok(compiled);
  const probes = compiled.doc.nodes.filter((node) => node.type === 'limitProbe');
  assert.equal(probes.length, 1);
  const probe = probes[0]!;
  const wires = compiled.doc.wires.filter((wire) => wire.to === probe.id);
  assert.equal(wires.length, 2);
  assert.ok(wires.some((wire) => wire.toPort === 'x'));
  assertWires(compiled.doc);
});

test('含参极限在砂盒里标出参数解和核对提示', () => {
  const compiled = compileLabToCanvas(problem({
    model: {
      engine: 'analysis_v1', subject: 'calculus', kind: 'limit', task: 'limit',
      expression: '((6*x^2+1)^sin(x)-1)/x^3', limit_point_value: 0,
      modeling_task: 'parameter_limit', parameter: 'a', parameter_value: '6', target_value: '6',
      defaults: {}, params: [],
    },
  }));
  assert.ok(compiled);
  const note = compiled.doc.nodes.find((node) => node.type === 'textNote' && /参数解/.test(node.text ?? ''));
  assert.ok(note);
  assert.match(note.text ?? '', /a=6/);
  assert.match(note.text ?? '', /极限 6/);
  assertWires(compiled.doc);
});

test('抛体题编译为 projectile + 轨迹仪 + 能量表', () => {
  const compiled = compileLabToCanvas(problem({
    text: '以初速度 20 m/s、抛射角 30° 抛出一个物体，求飞行时间与射程。',
    subject: 'physics',
    model: {
      engine: 'physics_v1', subject: 'physics', physics_kind: 'kinematics', physics_mode: 'projectile_o',
      defaults: { g: 9.8, v0: 20, angle: 30 }, params: [],
    },
  }), { params: { v0: 25, angle: 45 } });
  assert.ok(compiled);
  const source = compiled.doc.nodes.find((node) => node.type === 'projectile');
  assert.ok(source);
  assert.equal(source.params.v0, 25);
  assert.equal(source.params.angle, 45);
  assert.ok(compiled.doc.nodes.some((node) => node.type === 'trailView'));
  assert.ok(compiled.doc.nodes.some((node) => node.type === 'energyMeter'));
  assertWires(compiled.doc);
});

test('平抛或带初始高度的题不硬映射成斜抛节点', () => {
  const compiled = compileLabToCanvas(problem({
    text: '小球以 v0=10 m/s 水平抛出，初始高度 h=20 m，g=9.8 m/s²。',
    subject: 'physics',
    model: {
      engine: 'physics_v1', subject: 'physics', physics_kind: 'kinematics', physics_mode: 'projectile_h',
      defaults: { v0: 10, h0: 20, g: 9.8 }, params: [],
    },
  }));
  assert.equal(compiled, null);
});

test('单摆题编译为 pendulum 实验', () => {
  const compiled = compileLabToCanvas(problem({
    text: '单摆摆长 1.5 m，初始角 25°，求周期。',
    subject: 'physics',
    model: {
      engine: 'physics_v1', subject: 'physics', physics_kind: 'oscillation', physics_mode: 'pendulum',
      defaults: { g: 9.8, L: 1.5, m: 1 }, params: [],
    },
  }));
  assert.ok(compiled);
  const source = compiled.doc.nodes.find((node) => node.type === 'pendulum');
  assert.ok(source);
  assert.equal(source.params.L, 1.5);
  assertWires(compiled.doc);
});

test('一维梯度下降题编译为函数源、滑杆与图像', () => {
  const compiled = compileLabToCanvas(problem({
    subject: 'optimization',
    model: {
      engine: 'gradient_descent_v1', subject: 'optimization', expression: '(x-3)^2',
      variables: ['x'], defaults: { x0: 0, learning_rate: 0.1 }, domain: { x_min: -1, x_max: 5 }, params: [],
    },
  }), { params: { x0: 2 } });
  assert.ok(compiled);
  assert.ok(compiled.doc.nodes.some((node) => node.type === 'functionSource'));
  const slider = compiled.doc.nodes.find((node) => node.type === 'slider');
  assert.equal(slider?.params.v, 2);
  assert.ok(compiled.doc.nodes.some((node) => node.type === 'functionPlot'));
  assertWires(compiled.doc);
});

test('2×2 矩阵题编译为矩阵源与几何视图', () => {
  const compiled = compileLabToCanvas(problem({
    subject: 'linear_algebra',
    model: { engine: 'linalg_v1', subject: 'linear_algebra', la_kind: 'determinant', matrix_a: [[2, 1], [1, 2]], defaults: {}, params: [] },
  }));
  assert.ok(compiled);
  const types = compiled.doc.nodes.map((node) => node.type);
  for (const type of ['matrixSource', 'transformView', 'detGauge', 'eigRead', 'squareView', 'quiz']) {
    assert.ok(types.includes(type as never), `缺少 ${type}`);
  }
  assertWires(compiled.doc);
});

test('OS 页面置换接入原题条件支路并保留冻结答案', () => {
  const compiled = compileLabToCanvas(problem({
    subject: 'operating_system',
    model: {
      engine: 'os_page_v1', subject: 'operating_system', os_kind: 'page_replace',
      reference: ['A', '0', '1', '2', '0', '3', '0', '4', '2', '3'],
      initial_frames: ['A'],
      defaults: { algorithm: 'lru', frames: 3 }, params: [],
    },
  }), { params: { algorithm: 'opt', frames: 4 } });
  assert.ok(compiled);
  const source = compiled.doc.nodes.find(item => item.payload === 'pageReplaceOriginal/references');
  const original = compiled.doc.nodes.find(item => item.payload === 'pageReplaceOriginal/original');
  assert.equal(source?.text, 'A,0,1,2,0,3,0,4,2,3');
  assert.ok(original);
  assert.equal(original.text, 'A');
  assert.equal(original.params.algorithm, 2);
  assert.equal(original.params.capacity, 4);
  const result = evalOutput(makeCtx(compiled.doc, new Map()), original.id);
  assert.ok(result?.kind === 'lab408Data');
  assert.deepEqual(result.result.frames[0]?.rows?.[0], ['OPT · 4 块', 'A · — · — · —', '命中', '—', 0]);
  assert.ok(compiled.doc.nodes.some(({ text }) => text?.includes('原题答案') && text.includes('LRU · 3 块')));
  assert.ok(!compiled.doc.nodes.some((item) => item.type === 'lab408Workbench'));
  assertWires(compiled.doc);
});

test('OS 页面置换支持原题的非对照容量，拒绝丢失条件的转入', () => {
  const model = {
    engine: 'os_page_v1', subject: 'operating_system', os_kind: 'page_replace',
    reference: ['1', '2', '3'], defaults: { algorithm: 'fifo', frames: 7 }, params: [],
  };
  const supported = compileLabToCanvas(problem({ subject: 'operating_system', model }));
  assert.equal(supported?.doc.nodes.find(item => item.payload === 'pageReplaceOriginal/original')?.params.capacity, 7);
  for (const changed of [
    { ...model, reference: ['1', '2,3'] },
    { ...model, defaults: { algorithm: 'fifo' } },
    { ...model, defaults: { algorithm: 'fifo', frames: 2.5 } },
  ]) {
    const compiled = compileLabToCanvas(problem({ subject: 'operating_system', model: changed }));
    assert.ok(compiled?.doc.nodes.some(item => item.type === 'lab408Workbench'));
    assert.ok(!compiled.doc.nodes.some(item => item.type === 'lab408Stage'));
  }
  const guessed = compileLabToCanvas(problem({ subject: 'operating_system', model, recognition: {
    conditions: [{ id: 'frames', provenance: 'supplement' }], ambiguities: [],
  } }));
  assert.ok(guessed?.doc.nodes.some(item => item.type === 'lab408Workbench'));
});

test('OS CPU 调度继承完整的进程顺序、原题算法以及时间片', () => {
  const model = {
    engine: 'os_sched_v1', subject: 'operating_system', os_kind: 'cpu_schedule',
    processes: [{ id: 'JobB', arrival: 0, burst: 3 }, { id: 'JobA', arrival: 0, burst: 2 }],
    defaults: { algorithm: 'rr', quantum: 4 }, params: [],
  };
  const compiled = compileLabToCanvas(problem({ subject: 'operating_system', model }));
  assert.ok(compiled);
  assert.equal(compiled.doc.nodes.find(item => item.payload === 'cpuScheduleLab/processes')?.text, 'JobB 0 3\nJobA 0 2');
  const rr = compiled.doc.nodes.find(item => item.payload === 'cpuScheduleLab/rr');
  assert.ok(rr);
  assert.equal(rr.params.quantum, 4);
  assert.ok(compiled.doc.panel?.view_node_ids.includes(rr.id));
  const result = evalOutput(makeCtx(compiled.doc, new Map()), rr.id);
  assert.ok(result?.kind === 'lab408Data');
  assert.equal(result.result.frames[0]?.rows?.[0]?.[0], 'JobB');
  for (const changed of [
    { ...model, defaults: { algorithm: 'rr' } },
    { ...model, defaults: { algorithm: 'hrrn', quantum: 4 } },
    { ...model, processes: [{ id: 'JobB', arrival: 0.5, burst: 3 }] },
  ]) {
    const fallback = compileLabToCanvas(problem({ subject: 'operating_system', model: changed }));
    assert.ok(fallback?.doc.nodes.some(item => item.type === 'lab408Workbench'));
  }
});

test('OS 银行家原题继承资源名与请求，检查维度并避免填入示例请求', () => {
  const model = {
    engine: 'os_banker_v1', subject: 'operating_system', os_kind: 'banker', names: ['JobA', 'JobB'], resources: ['R1'],
    available: [1], allocation: [[1], [1]], max: [[2], [3]], request: { process: 'JobB', vector: [1] },
    defaults: { request_mode: 'apply' }, params: [],
  };
  const compiled = compileLabToCanvas(problem({ subject: 'operating_system', model }));
  assert.ok(compiled);
  assert.match(compiled.doc.nodes.find(item => item.payload === 'bankerLab/resources')?.text ?? '', /Resources: R1/);
  assert.equal(compiled.doc.nodes.find(item => item.payload === 'bankerLab/request')?.text, 'JobB: 1');
  const decision = compiled.doc.nodes.find(item => item.payload === 'bankerLab/decision');
  assert.ok(decision);
  const result = evalOutput(makeCtx(compiled.doc, new Map()), decision.id);
  assert.ok(result?.kind === 'lab408Data');
  assert.equal(result.result.data.status, 'rolledBack');
  assert.deepEqual(result.result.data.available, [1]);
  assert.deepEqual(result.result.data.need, [[1], [2]]);
  const plain = compileLabToCanvas(problem({ subject: 'operating_system', model: { ...model, request: null, defaults: { request_mode: 'ignore' } } }));
  assert.equal(plain?.doc.nodes.find(item => item.payload === 'bankerLab/request')?.text, '');
  const ignored = compileLabToCanvas(problem({ subject: 'operating_system', model }), { params: { request_mode: 'ignore' } });
  const ignoredRequest = ignored?.doc.nodes.find(item => item.payload === 'bankerLab/request');
  assert.equal(ignoredRequest?.text, 'JobB: 1');
  assert.equal(ignoredRequest.params.requestEnabled, 0);
  const malformed = compileLabToCanvas(problem({ subject: 'operating_system', model: { ...model, request: { process: 'JobB', vector: [1, 2] } } }));
  assert.ok(malformed?.doc.nodes.some(item => item.type === 'lab408Workbench'));
  const conflicting = compileLabToCanvas(problem({ subject: 'operating_system', model: { ...model, need: [[1], [1]] } }));
  assert.ok(conflicting?.doc.nodes.some(item => item.type === 'lab408Workbench'));
});

test('408 题编译为预填原文的全题型工作台', () => {
  const compiled = compileLabToCanvas(problem({
    subject: 'operating_system',
    model: { engine: 'os_sched_v1', subject: 'operating_system', os_kind: 'cpu_schedule', defaults: {}, params: [] },
  }));
  assert.ok(compiled);
  const workbench = compiled.doc.nodes.find((node) => node.type === 'lab408Workbench');
  assert.ok(workbench);
  assert.equal(workbench.text, '这是原题文字，不能被覆盖。');
  assert.equal(workbench.params.subjectIndex, MANUAL_408_SUBJECTS.findIndex((subject) => subject.id === 'operating_system'));
  assertWires(compiled.doc);
});

test('需要核对或无法逐项映射的题型明确拒绝', () => {
  assert.equal(compileLabToCanvas(problem({ status: 'needs_review' })), null);
  assert.equal(compileLabToCanvas(problem({
    model: { engine: 'ode_v1', subject: 'calculus', kind: 'ode', expression: 'x', defaults: {}, params: [] },
  })), null);
  assert.equal(compileLabToCanvas(problem({
    subject: 'physics',
    model: { engine: 'physics_v1', subject: 'physics', defaults: {}, params: [] },
  })), null);
});

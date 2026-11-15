import test from 'node:test';
import assert from 'node:assert/strict';
import { compileExpression, formatNumber } from './expr.ts';
import { computeLab, currentMetrics } from './compute.ts';
import { parseChineseNumber, parseLabCommand } from './commands.ts';
import { commitHistory, createHistory, redoHistory, undoHistory } from './history.ts';
import type { LabModel, LabProblem, LabSolution } from './types.ts';

function problem(model: Partial<LabModel>, solution: Partial<LabSolution> = {}, subject: LabProblem['subject'] = 'optimization'): LabProblem {
  return {
    problem_id: 'prb_1',
    number: '1',
    title: '测试题',
    text: '测试题',
    subject,
    subject_label: subject,
    confidence: 0.9,
    status: 'ready',
    source: { page_from: 1, page_to: 1, file_names: ['f1'], label: '文本', excerpt: '测试题' },
    source_pages: [],
    recognition: {
      method: 'typed_text',
      raw_text: '测试题',
      conditions: [],
      ambiguities: [],
      formulas: [],
      recognized_subject: subject,
    },
    model: {
      engine: 'test',
      subject,
      defaults: {},
      params: [],
      ...model,
    },
    solution: {
      summary: '',
      answer: '',
      steps: [],
      ...solution,
    },
    states: {
      params: {},
      step: 0,
      mode: 'explore',
      notes: '',
      observations: [],
      events: [],
      scenarios: [],
      active_scenario_id: 'baseline',
      attempts: [],
      evaluated: null,
    },
  };
}

test('受限表达式支持幂、隐式乘法与函数', () => {
  const expr = compileExpression('2x + sin(x)^2', ['x']);
  assert.equal(expr.eval({ x: 1 }), 2 + Math.sin(1) ** 2);
  assert.equal(compileExpression('(x-3)^2', ['x']).eval({ x: 1 }), 4);
  assert.equal(compileExpression('2**x', ['x']).eval({ x: 3 }), 8);
  assert.equal(compileExpression('1/x', ['x']).evalOrNull({ x: 0 }), null);
  assert.throws(() => compileExpression('unknown + 1', ['x']));
});

test('未知题型保留待核对状态，不计算默认教学积分', () => {
  const result = computeLab(problem({ engine: 'unsupported_v1' }, {}, 'unknown'), {});
  assert.equal(result.subject, 'unknown');
  assert.equal(result.metrics.length, 0);
  assert.match(result.headline, /核对/);
});

test('梯度下降轨迹与后端一致', () => {
  const model: Partial<LabModel> = {
    engine: 'gradient_descent_v1',
    expression: '(x-3)^2',
    variables: ['x'],
    grad_exprs: ['2*x - 6'],
    defaults: { x0: 0, learning_rate: 0.1, iterations: 5 },
    domain: { x_min: -1, x_max: 5 },
  };
  const p = problem(model, { answer: 'x*=3，f*=0', answer_point: [3], answer_value: 0, global_note: '凸二次函数' });
  const result = computeLab(p, { ...model.defaults });
  assert.equal(result.subject, 'optimization');
  if (result.subject !== 'optimization') return;
  assert.deepEqual(result.trajectory[0]?.point, [0]);
  assert.ok(Math.abs(result.trajectory[1]!.point[0]! - 0.6) < 1e-12);
  assert.ok(Math.abs(result.trajectory[2]!.point[0]! - 1.08) < 1e-12);
  assert.equal(result.trajectory.length, 6);
  const metrics = currentMetrics(result, 2);
  assert.ok(metrics.some((item) => item.label === '当前位置' && item.value.includes('1.08')));
});

test('黎曼和随分割数增加而接近解析积分', () => {
  const model: Partial<LabModel> = {
    engine: 'riemann_v1',
    kind: 'integral',
    variable: 'x',
    expression: 'x^2',
    defaults: { lower: 0, upper: 2, n: 8 },
  };
  const p = problem(model, { answer: '8/3', answer_value: 8 / 3 }, 'calculus');
  const result = computeLab(p, { ...model.defaults });
  if (result.subject !== 'calculus') return;
  assert.equal(result.kind, 'integral');
  assert.ok(Math.abs((result.approx ?? 0) - 2.65625) < 1e-9);
  assert.ok(Math.abs((result.exact ?? 0) - 8 / 3) < 1e-9);
  const errors = result.trace.map((frame) => Number(frame.values.error));
  assert.ok(errors[0]! > errors[errors.length - 1]!);
});

test('发散原题区间不把黎曼和或数值积分当作解析值', () => {
  const model: Partial<LabModel> = {
    engine: 'riemann_v1',
    kind: 'integral',
    variable: 'x',
    expression: '1/x^2',
    defaults: { lower: -1, upper: 1, n: 8 },
  };
  const p = problem(model, {
    answer: '发散（积分不存在）',
    answer_value: null,
    convergence: 'divergent',
  }, 'calculus');
  const result = computeLab(p, { ...model.defaults });
  if (result.subject !== 'calculus') return;
  assert.equal(result.exact, null);
  assert.match(result.answerText ?? '', /发散|无效/);
  assert.equal(result.checks.find((item) => item.id === 'finite')?.status, 'fail');
});

test('改点后的中心差商不再标为精确斜率', () => {
  const model: Partial<LabModel> = {
    engine: 'tangent_v1',
    kind: 'derivative',
    variable: 'x',
    expression: 'x^2',
    defaults: { point: 2, h: 0.1 },
  };
  const original = computeLab(problem(model, { answer: '4', answer_value: 4 }, 'calculus'), { ...model.defaults });
  if (original.subject !== 'calculus') return;
  assert.equal(original.metrics.find((item) => item.id === 'slope')?.label, '精确斜率');

  const moved = computeLab(problem(model, { answer: '4', answer_value: 4 }, 'calculus'), { ...model.defaults, point: 3 });
  if (moved.subject !== 'calculus') return;
  assert.equal(moved.exact, null);
  assert.equal(moved.metrics.find((item) => item.id === 'slope')?.label, '数值差商参照');
  assert.match(moved.headline, /数值差商/);
});

test('BFS 执行记录与邻居排序', () => {
  const model: Partial<LabModel> = {
    engine: 'bfs_v1',
    nodes: ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id, label: id })),
    edges: [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'B', to: 'D' },
      { from: 'C', to: 'D' },
      { from: 'D', to: 'E' },
    ],
    directed: false,
    start: 'A',
    defaults: { start: 'A' },
  };
  const p = problem(model, { answer: 'A → B → C → D → E', answer_order: ['A', 'B', 'C', 'D', 'E'] }, 'algorithm');
  const result = computeLab(p, { start: 'A' });
  if (result.subject !== 'algorithm') return;
  assert.deepEqual(result.order, ['A', 'B', 'C', 'D', 'E']);
  assert.equal(result.frames[0]?.queue[0], 'A');
  assert.equal(result.frames[result.frames.length - 1]?.action, 'done');
  assert.equal(result.checks.find((item) => item.id === 'coverage')?.status, 'pass');
});

test('DFS 执行记录与回溯（不被当成 BFS）', () => {
  const model: Partial<LabModel> = {
    engine: 'dfs_v1',
    nodes: ['A', 'B', 'C', 'D'].map((id) => ({ id, label: id })),
    edges: [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'B', to: 'D' },
    ],
    directed: true,
    start: 'A',
    defaults: { start: 'A' },
  };
  const p = problem(model, { answer: 'A → B → D → C', answer_order: ['A', 'B', 'D', 'C'] }, 'algorithm');
  const result = computeLab(p, { start: 'A' });
  if (result.subject !== 'algorithm') return;
  assert.equal(result.algorithm, 'dfs');
  // 按编号优先的 DFS：A→B→D→C；若被当成 BFS 会得到 A→B→C→D。
  assert.deepEqual(result.order, ['A', 'B', 'D', 'C']);
  assert.equal(result.frames[0]?.stack?.[0], 'A');
  assert.equal(result.frames[1]?.action, 'visit');
  assert.ok(result.frames.some((frame) => frame.action === 'backtrack'));
  assert.equal(result.checks.find((item) => item.id === 'coverage')?.status, 'pass');
});

test('中文天干节点按教材序遍历（DFS）', () => {
  const model: Partial<LabModel> = {
    engine: 'dfs_v1',
    nodes: ['甲', '乙', '丙', '丁'].map((id) => ({ id, label: id })),
    edges: [
      { from: '甲', to: '乙' },
      { from: '甲', to: '丙' },
      { from: '乙', to: '丁' },
    ],
    directed: true,
    start: '甲',
    defaults: { start: '甲' },
  };
  const p = problem(model, { answer: '甲 → 乙 → 丁 → 丙', answer_order: ['甲', '乙', '丁', '丙'] }, 'algorithm');
  const result = computeLab(p, { start: '甲' });
  if (result.subject !== 'algorithm') return;
  // 若按 Unicode 码点排序会得到 丙<乙<丁 的反教材顺序；这里应为 甲乙丁丙。
  assert.deepEqual(result.order, ['甲', '乙', '丁', '丙']);
});

test('数据结构题型回放嵌入轨迹（ds_* 引擎，后端 snake_case 归一）', () => {
  const frames = [
    { index: 1, label: '初始化', detail: '空栈。', values: { '栈（底→顶）': '空栈' }, pseudocodeLine: 1 },
    { index: 2, label: '入栈 1', detail: '1 进栈。', values: { '栈（底→顶）': '底 → 1' }, pseudocodeLine: 2 },
  ];
  const model: Partial<LabModel> = {
    engine: 'ds_stack_v1',
    defaults: {},
    // 真实后端 ds_result 使用 snake_case（ds_kind）；前端必须归一为 dsKind，
    // 否则画布分流失效误走 BFS 分支（TypeError: reading 'join'）。
    ds_result: {
      subject: 'algorithm',
      algorithm: 'data_structure',
      ds_kind: 'stack_ops',
      headline: '最终栈（底→顶）：1',
      answer: '最终栈（底→顶）：1',
      metrics: [],
      checks: [],
      notes: [],
      pseudocode: ['读入一个操作', '入栈：写入栈顶，栈顶指针 +1'],
      frames,
      trace: frames,
    },
  } as Partial<LabModel>;
  const p = problem(model, { answer: '最终栈（底→顶）：1' }, 'algorithm');
  const result = computeLab(p, {});
  if (result.subject !== 'algorithm') return;
  assert.equal((result as { dsKind?: string }).dsKind, 'stack_ops');
  assert.equal(result.frames.length, 2);
  assert.equal(String(result.frames[1]?.values['栈（底→顶）']), '底 → 1');
  const metrics = currentMetrics(result, 1);
  assert.equal(metrics[0]?.label, '当前动作');
  assert.ok(metrics.slice(1).every((m) => typeof m.value === 'string'));
});

test('小型网络前向、反向传播与损失下降', () => {
  const model: Partial<LabModel> = {
    engine: 'mlp_v1',
    layers: [
      { size: 2, activation: 'input' },
      { size: 3, activation: 'tanh' },
      { size: 1, activation: 'linear' },
    ],
    weights: [
      [
        [0.5, -0.2],
        [0.3, 0.8],
        [-0.4, 0.1],
      ],
      [[1.2, -0.7, 0.4]],
    ],
    biases: [[0, 0, 0], [0]],
    input: [0.6, -0.2],
    target: [1],
    activation: 'tanh',
    weight_source: 'original',
    defaults: { input_1: 0.6, input_2: -0.2, learning_rate: 0.1, epochs: 5 },
  };
  const p = problem(model, { answer: '训练 5 轮后 MSE=0' }, 'deep_learning');
  const result = computeLab(p, { ...model.defaults });
  if (result.subject !== 'deep_learning') return;
  assert.equal(result.frames.length, 6);
  assert.equal(result.lossHistory.length, 6);
  assert.ok(result.lossHistory[result.lossHistory.length - 1]! < result.lossHistory[0]!);
  assert.equal(result.checks.find((item) => item.id === 'gradient')?.status, 'pass');
  assert.equal(result.frames[5]?.weights.length, 2);
});

test('自然语言命令只映射到已登记动作', () => {
  assert.equal(parseChineseNumber('三'), 3);
  assert.equal(parseChineseNumber('十二'), 12);
  const rate = parseLabCommand('把学习率调到 0.05', 'optimization');
  assert.equal(rate.kind, 'set-param');
  if (rate.kind === 'set-param') {
    assert.equal(rate.key, 'learning_rate');
    assert.equal(rate.value, 0.05);
  }
  const step = parseLabCommand('停在第三次迭代', 'optimization');
  assert.equal(step.kind, 'step');
  const mode = parseLabCommand('切换到完整讲解', 'calculus');
  assert.equal(mode.kind, 'mode');
  const n = parseLabCommand('停在 n=32', 'calculus');
  assert.equal(n.kind, 'set-param');
  if (n.kind === 'set-param') {
    assert.equal(n.key, 'n');
    assert.equal(n.value, 32);
  }
  const unknown = parseLabCommand('请证明这个定理', 'calculus');
  assert.equal(unknown.kind, 'unknown');
});

test('参数历史合并连续拖动并支持撤销重做', () => {
  const initial = { x0: 0, learning_rate: 0.1 };
  let history = createHistory(initial);
  history = commitHistory(history, { ...initial, learning_rate: 0.2 }, 'learning_rate', 1000);
  history = commitHistory(history, { ...initial, learning_rate: 0.3 }, 'learning_rate', 1100);
  assert.equal(history.past.length, 1);
  history = undoHistory(history);
  assert.deepEqual(history.present, initial);
  history = redoHistory(history);
  assert.equal(history.present.learning_rate, 0.3);
  assert.equal(formatNumber(0.30000000000000004), '0.3');
});

test('不定积分显示原函数族 F(x)+C，且 C 只改变平移', () => {
  const model: Partial<LabModel> = {
    engine: 'antiderivative_v1',
    kind: 'antiderivative',
    expression: 'x^2',
    variable: 'x',
    antiderivative_expression: 'x^3/3',
    plot_domain: [-3, 3],
    defaults: { c: 0 },
    params: [
      { id: 'c', label: '积分常数 C', kind: 'number', min: -16, max: 16, step: 0.5, options: [] },
    ],
  };
  const p = problem(model, { answer: 'F(x)=x^3/3+C', exact: '\\frac{x^{3}}{3}+C' }, 'calculus');
  const base = computeLab(p, { c: 0 });
  const moved = computeLab(p, { c: 2 });
  assert.equal(base.kind, 'antiderivative');
  assert.equal(moved.kind, 'antiderivative');
  if (base.kind !== 'antiderivative' || moved.kind !== 'antiderivative') return;

  assert.equal(base.series.length, moved.series.length);
  const basePoint = base.series[100]!;
  const movedPoint = moved.series[100]!;
  assert.ok(Math.abs((movedPoint.y ?? 0) - (basePoint.y ?? 0) - 2) < 1e-9);
  assert.equal(base.rects.length, 0);
  assert.match(base.headline, /\+C/);
  assert.ok(base.trace.length >= 5);
  assert.ok(base.trace.some((item) => item.values?.c === 0));
  assert.equal(base.checks.find((item) => item.id === 'derivative')?.status, 'pass');
  const metrics = currentMetrics(base, 1);
  assert.ok(metrics.some((item) => item.id === 'constant'));
});

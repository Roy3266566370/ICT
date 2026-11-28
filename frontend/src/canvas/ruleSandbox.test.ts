import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { RuleSandboxError, runRuleInSandbox, sanitizePipelineResult, RULE_WORKER_SOURCE } from './ruleSandbox.ts';

function resultOf(frames: number, rows = 1, nodes = 1): unknown {
  return {
    data: { ok: true },
    frames: Array.from({ length: frames }, (_, index) => ({
      title: `第 ${index} 帧`,
      summary: '测试帧',
      columns: ['x', 'y'],
      rows: Array.from({ length: rows }, (_, row) => [row, row * 2]),
      graph: {
        nodes: Array.from({ length: nodes }, (_, node) => ({ id: `n${node}`, label: `N${node}`, x: node, y: node, active: node === 0 })),
        edges: Array.from({ length: Math.max(0, nodes - 1) }, (_, node) => ({ from: `n${node}`, to: `n${node + 1}` })),
      },
    })),
  };
}

test('规则输出会截断超大帧、行与节点，并清洗非有限数值', () => {
  const result = sanitizePipelineResult({
    ...resultOf(260, 260, 140),
    frames: [{
      title: '非有限值',
      summary: '测试',
      rows: [[Number.NaN, Number.POSITIVE_INFINITY, true]],
      series: [{ label: 's', values: [1, Number.NaN, 3] }],
    }],
  });
  assert.equal(result.frames.length, 1);
  assert.deepEqual(result.frames[0]!.rows, [['—', '—', '是']]);
  assert.deepEqual(result.frames[0]!.series?.[0]?.values, [1, 0, 3]);
  const capped = sanitizePipelineResult(resultOf(260, 260, 140));
  assert.equal(capped.frames.length, 200);
  assert.equal(capped.frames[0]!.rows?.length, 200);
  assert.equal(capped.frames[0]!.graph?.nodes.length, 120);
});

test('拓扑图保留数字节点编号、边端点和权重', () => {
  const { frames: [frame] } = sanitizePipelineResult({ frames: [{
    title: '跳过边 0-1',
    graph: {
      nodes: [{ id: 0, label: 0, x: 20, y: 50 }, { id: '1', x: 80, y: 50 }, { id: Infinity }],
      edges: [{ from: 0, to: 1, label: 4, active: true }],
    },
  }] });
  assert.deepEqual(frame!.graph, {
    nodes: [
      { id: '0', label: '0', x: 20, y: 50, active: false },
      { id: '1', label: '1', x: 80, y: 50, active: false },
    ],
    edges: [{ from: '0', to: '1', label: '4', active: true }],
  });
});

test('沙箱拒绝浏览器、网络与异步能力，并给出明确错误', async () => {
  await assert.rejects(runRuleInSandbox('function run(){ return fetch("/") }', { text: '', params: {}, upstream: [] }), (error) => {
    return error instanceof RuleSandboxError && error.code === 'runtime' && /禁用/.test(error.message);
  });
  await assert.rejects(runRuleInSandbox('async function run(){ return {} }', { text: '', params: {}, upstream: [] }), (error) => {
    return error instanceof RuleSandboxError && error.code === 'runtime';
  });
  assert.match(RULE_WORKER_SOURCE, /沙箱禁止访问/);
});

test('Worker 超时会终止并返回 计算超时', async () => {
  let terminated = false;
  await assert.rejects(runRuleInSandbox('function run(){ return { frames: [] } }', { text: '', params: {}, upstream: [] }, {
    timeoutMs: 25,
    workerFactory: () => ({
      onmessage: null,
      onerror: null,
      postMessage() { /* never reply */ },
      terminate() { terminated = true; },
    }),
  }), (error) => error instanceof RuleSandboxError && error.code === 'timeout' && /计算超时/.test(error.message));
  assert.equal(terminated, true);
});

test('Worker 成功结果经过校验后返回，运行时错误拒绝', async () => {
  const success = await runRuleInSandbox('function run(){ return { data: {}, frames: [] } }', { text: '', params: {}, upstream: [] }, {
    timeoutMs: 100,
    workerFactory: () => {
      const worker = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        onerror: null as ((event: ErrorEvent) => void) | null,
        postMessage(message: unknown) {
          const token = (message as { nonce: string }).nonce;
          queueMicrotask(() => worker.onmessage?.({ data: { type: 'result', nonce: token, output: resultOf(2), elapsedMs: 1.2 } } as MessageEvent));
        },
        terminate() {},
      };
      return worker;
    },
  });
  assert.equal(success.result.frames.length, 2);
  assert.equal(success.elapsedMs, 1.2);
  await assert.rejects(runRuleInSandbox('function run(){ return { frames: [] } }', { text: '', params: {}, upstream: [] }, {
    timeoutMs: 100,
    workerFactory: () => {
      const worker = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        onerror: null as ((event: ErrorEvent) => void) | null,
        postMessage(message: unknown) {
          const token = (message as { nonce: string }).nonce;
          queueMicrotask(() => worker.onmessage?.({ data: { type: 'error', nonce: token, message: '测试运行错误' } } as MessageEvent));
        },
        terminate() {},
      };
      return worker;
    },
  }), (error) => error instanceof RuleSandboxError && error.code === 'runtime' && /测试运行错误/.test(error.message));
});

test('Worker 顶层移除网络与构造器入口，原型链也拿不到 fetch', () => {
  const messages: Array<Record<string, unknown>> = [];
  const sandbox: Record<string, unknown> = {
    performance: { now: () => 2 },
    fetch: () => { throw new Error('fetch must be removed'); },
    XMLHttpRequest: class {},
    WebSocket: class {},
    postMessage(message: unknown) { messages.push(message as Record<string, unknown>); },
  };
  sandbox.self = sandbox;
  runInNewContext(RULE_WORKER_SOURCE, sandbox);
  const workerSelf = sandbox.self as Record<string, unknown>;
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'postMessage', 'setTimeout', 'Function', 'Date', 'performance', 'crypto']) {
    assert.equal(workerSelf[name], undefined, `${name} 应从 Worker 全局移除`);
  }
  const onmessage = workerSelf.onmessage as (event: { data: unknown }) => void;
  assert.equal(typeof onmessage, 'function');

  onmessage({ data: {
    type: 'run',
    code: 'function run(){ return { frames: [{ title: "ok", summary: "s" }] }; }',
    input: { text: '', params: {}, upstream: [] },
    nonce: 'normal',
  } });
  assert.equal(messages[0]?.type, 'result');
  assert.deepEqual((messages[0]?.output as { frames: Array<{ title: string }> }).frames[0]?.title, 'ok');

  onmessage({ data: {
    type: 'run',
    code: 'function run(){ return { frames: [{ title: String(({}).constructor.constructor("return self.fetch")()) }] }; }',
    input: { text: '', params: {}, upstream: [] },
    nonce: 'prototype',
  } });
  assert.equal(messages[1]?.type, 'result');
  assert.equal((messages[1]?.output as { frames: Array<{ title: string }> }).frames[0]?.title, 'undefined');
});

test('清洗图元、颜色及最大网格，忽略越界高亮', () => {
  const [frame] = sanitizePipelineResult({ frames: [{
    shapes: { viewBox: [10, 9999], items: Array.from({ length: 170 }, () => ({
      kind: 'circle', cx: 20, cy: NaN, r: 5, fill: 'url(https://example.invalid)', stroke: '#abc',
    })) },
    grid: { cells: Array.from({ length: 35 }, () => Array(36).fill(Infinity)), activeCell: [0, 32], palette: 'bad' },
  }] }).frames;
  assert.deepEqual(frame?.shapes?.viewBox, [100, 800]);
  assert.equal(frame?.shapes?.items.length, 160);
  assert.equal(frame?.shapes?.items[0]?.fill, undefined);
  assert.equal(frame?.shapes?.items[0]?.stroke, '#abc');
  assert.equal(frame?.grid?.cells.length, 32);
  assert.deepEqual(frame?.grid?.cells[0], Array(32).fill(0));
  assert.equal(frame?.grid?.palette, 'heat');
  assert.equal(frame?.grid?.activeCell, undefined);
});

test('Worker 的 rand 可复现且能同时读取上游数据', async () => {
  const code = 'function run({ upstream, rand }) { return { data: { v: upstream[0].v, r: rand() }, frames: [{}] }; }';
  const run = (seed: number) => runRuleInSandbox(code, { text: '', params: { seed }, upstream: [{ kind: 'scalar', v: 9 }] }, {
    workerFactory(source) {
      const worker = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        onerror: null,
        postMessage(data: unknown) {
          const sandbox = { self: { postMessage: (reply: unknown) => worker.onmessage?.({ data: reply } as MessageEvent) } };
          runInNewContext(source, sandbox);
          (sandbox.self as unknown as { onmessage: (event: { data: unknown }) => void }).onmessage({ data });
        },
        terminate() {},
      };
      return worker;
    },
  });
  const { result } = await run(12);
  assert.equal(result.data.v, 9);
  assert.deepEqual((await run(12)).result.data, result.data);
  assert.notEqual((await run(13)).result.data.r, result.data.r);
});

test('稀疏热图保留原坐标，空单元以零填充', () => {
  const cells: number[][] = [];
  cells[1] = [];
  cells[1][2] = 7;
  const [frame] = sanitizePipelineResult({ frames: [{ grid: { cells, activeCell: [1, 2] } }] }).frames;
  assert.deepEqual(frame?.grid?.cells, [[], [0, 0, 7]]);
  assert.deepEqual(frame?.grid?.activeCell, [1, 2]);
});

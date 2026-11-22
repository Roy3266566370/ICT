import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { buildSandboxDocument, SANDBOX_PROTOCOL } from './host.ts';

function sandbox() {
  const workers: { terminated: boolean; onmessage?: (e: unknown) => void; terminate: () => void }[] = [];
  const timers = new Map<number, { callback: () => void; ms: number }>();
  const messages: { type: string }[] = [];
  let listener: (e: unknown) => void = () => {};
  const parent = { postMessage: (message: { type: string }) => messages.push(message) };
  class Worker {
    terminated = false;
    onmessage?: (e: unknown) => void;
    constructor() { workers.push(this); }
    postMessage() {}
    terminate() { this.terminated = true; }
  }
  const script = buildSandboxDocument().match(/<script>([\s\S]*?)<\/script>/)![1]!;
  let timerId = 0;
  vm.runInNewContext(script, { Worker, Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, window: {
    parent, addEventListener: (_type: string, callback: typeof listener) => { listener = callback; },
    setTimeout: (callback: () => void, ms: number) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
  } });
  return { workers, timers, messages, stop: () => listener({source:parent,data:{type:'stop',protocol:SANDBOX_PROTOCOL}}), run: (nonce: string) => listener({ source: parent,
    data: { type: 'init', protocol: SANDBOX_PROTOCOL, nonce, artifactId: 'model', revision: 'v1', program: 'function render(){}', input: {}, timeoutMs: 3000 } }) };
}

test('参数变化会终止上一次 Worker，防止拖动滑块不断积累任务', () => {
  const s = sandbox(); s.run('first'); s.run('second');
  assert.equal(s.workers.length, 2);
  assert.equal(s.workers[0]!.terminated, true);
  assert.equal(s.workers[1]!.terminated, false);
});

test('运行超时实际终止 Worker 并报告错误', () => {
  const s = sandbox(); s.run('first');
  const timeout = [...s.timers.values()].find((timer) => timer.ms === 3000);
  assert.ok(timeout, '必须设置运行超时'); timeout.callback();
  assert.equal(s.workers[0]!.terminated, true);
  assert.equal(s.messages.at(-1)!.type, 'sandbox-failure');
});


test('parent stop cancels a running Worker and execution timeout without a failure', () => {
  const s=sandbox();s.run('first');s.stop();
  assert.equal(s.workers[0]!.terminated,true);
  assert.equal([...s.timers.values()].some(timer=>timer.ms===3000),false);
  assert.equal(s.messages.length,0);
  s.run('after-stop');
  assert.equal(s.workers[1]!.terminated,false);
});

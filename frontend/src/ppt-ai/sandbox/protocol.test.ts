import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROTOCOL_VERSION,
  isSandboxResult,
  newNonce,
  parseSandboxMessage,
  validateViewAst,
} from './protocol.ts';

const valid = {
  version: 'ppt-ai.view.1',
  width: 720,
  height: 420,
  interactions: [],
  nodes: [
    { id: 'axes', type: 'axes', x_min: 0, x_max: 1, y_min: 0, y_max: 1, ticks: [] },
    { id: 'curve', type: 'curve', series: [[10, 10], [20, 20]], x_min: 0, x_max: 1, y_min: 0, y_max: 1 },
    { id: 'label', type: 'text', x: 10, y: 10, text: 'f(x)' },
  ],
};

test('合法 ViewAST 通过白名单', () => {
  assert.deepEqual(validateViewAst(valid), []);
});

test('重复 id、禁止字段与未登记绑定被拒收', () => {
  assert.ok(validateViewAst({ ...valid, nodes: [...valid.nodes, { id: 'label', type: 'text', x: 1, y: 1, text: 'x' }] }).length);
  assert.ok(validateViewAst({ ...valid, nodes: [{ id: 'x', type: 'text', x: 1, y: 1, text: 'x', onclick: 'alert(1)' }] }).length);
  assert.ok(validateViewAst({ ...valid, nodes: [{ id: 'x', type: 'text', x: 1, y: 1, text: 'x', binding: 'cpt_missing' }] }, ['cpt_ok']).length);
});

test('非有限数值与超大 AST 被拒收', () => {
  assert.ok(validateViewAst({ ...valid, nodes: [{ id: 'x', type: 'text', x: Number.NaN, y: 1, text: 'x' }] }).length);
  const nodes = Array.from({ length: 2001 }, (_, index) => ({ id: `n${index}`, type: 'point', x: 1, y: 1 }));
  assert.ok(validateViewAst({ ...valid, nodes }).length);
});

test('消息必须匹配 nonce、artifact、revision 与来源窗口', () => {
  const win = {} as Window;
  const message = {
    type: 'sandbox-result',
    protocol: PROTOCOL_VERSION,
    nonce: 'abc',
    artifactId: 'art_1',
    revision: 'h1',
    ast: valid,
    elapsedMs: 1,
  };
  const expected = { nonce: 'abc', artifactId: 'art_1', revision: 'h1', source: win, contentWindow: win };
  const parsed = parseSandboxMessage(message, expected);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(isSandboxResult(parsed.message), true);
  assert.equal(parseSandboxMessage({ ...message, nonce: 'other' }, expected).ok, false);
  assert.equal(parseSandboxMessage(message, { ...expected, revision: 'old' }).ok, false);
  assert.equal(parseSandboxMessage(message, { ...expected, source: {} as Window }).ok, false);
});

test('nonce 每次不同', () => {
  assert.notEqual(newNonce(), newNonce());
});

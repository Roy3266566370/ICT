import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, evalOutput, inputValues } from './engine.ts';
import { compileFunction } from './calculus.ts';
import type { CanvasDoc } from './types.ts';

function docOf(nodes: CanvasDoc['nodes'], wires: CanvasDoc['wires'] = []): CanvasDoc {
  return { version: 1, title: 'blocks', nodes, wires, strokes: [], zoom: 1 };
}

test('办公积木链：增长 → 情景分叉 → 折现，输出 series 与 NPV', () => {
  const doc = docOf([
    { id: 'growth', type: 'bizGrowthSource', x: 0, y: 0, params: { initial: 100, rate: 0.1, months: 12, seasonality: 0 } },
    { id: 'fork', type: 'bizScenarioFork', x: 0, y: 200, params: { spread: 0.2, drift: 0 } },
    { id: 'discount', type: 'bizDiscountOp', x: 0, y: 400, params: { rate: 0, investment: 0 } },
    { id: 'waterfall', type: 'bizWaterfallView', x: 0, y: 600, params: {} },
  ], [
    { id: 'w1', from: 'growth', to: 'fork' },
    { id: 'w2', from: 'fork', to: 'discount' },
    { id: 'w3', from: 'discount', to: 'waterfall' },
  ]);
  const ctx = makeCtx(doc, new Map());
  const fork = evalOutput(ctx, 'fork');
  assert.equal(fork?.kind, 'series');
  assert.equal(fork?.secondary?.length, 2);
  const discount = evalOutput(ctx, 'discount');
  assert.equal(discount?.kind, 'series');
  const npv = evalOutput(ctx, 'discount', 'npv');
  assert.equal(npv?.kind, 'scalar');
  assert.ok(npv.v > 0);
  const input = inputValues(ctx, doc.nodes[3]!);
  assert.equal(input.in?.kind, 'series');
});

test('跨学科 series 复用：概率采样可直接接办公瀑布视图', () => {
  const doc = docOf([
    { id: 'prob', type: 'probDistSource', x: 0, y: 0, params: { distribution: 1, samples: 200, bins: 12, seed: 3 } },
    { id: 'wf', type: 'bizWaterfallView', x: 0, y: 200, params: {} },
  ], [{ id: 'w', from: 'prob', to: 'wf' }]);
  const ctx = makeCtx(doc, new Map());
  const series = evalOutput(ctx, 'prob');
  assert.equal(series?.kind, 'series');
  assert.ok(series.values.length > 0);
  assert.equal(inputValues(ctx, doc.nodes[1]!).in?.kind, 'series');
});

test('函数运算积木可由两个函数源驱动并输出复合函数', () => {
  const doc = docOf([
    { id: 'f', type: 'functionSource', x: 0, y: 0, params: { a: 1 }, text: 'x^2' },
    { id: 'g', type: 'functionSource', x: 0, y: 200, params: {}, text: 'sin(x)' },
    { id: 'combine', type: 'funcCombineOp', x: 0, y: 400, params: { op: 4 } },
  ], [
    { id: 'wf', from: 'f', to: 'combine', toPort: 'f' },
    { id: 'wg', from: 'g', to: 'combine', toPort: 'g' },
  ]);
  const ctx = makeCtx(doc, new Map());
  const combined = evalOutput(ctx, 'combine');
  assert.equal(combined?.kind, 'function');
  assert.ok(Math.abs((compileFunction(combined)(Math.PI / 2) ?? 0) - 1) < 1e-8);
});

test('408、物理与深度学习新增积木通过 engine 输出对应端口', () => {
  const doc = docOf([
    { id: 'arr', type: 'arraySource', x: 0, y: 0, params: { mode: 1, length: 6 } },
    { id: 'sort', type: 'sortCompareView', x: 0, y: 200, params: {} },
    { id: 'field', type: 'emFieldSource', x: 0, y: 400, params: { uniform: 1, mode: 0, uStrength: 2, ux: 1, uy: 0 } },
    { id: 'fieldView', type: 'emFieldView', x: 0, y: 600, params: {} },
    { id: 'loss', type: 'lossProbeOp', x: 0, y: 800, params: { target: 0, gamma: 2, metric: 1 } },
    { id: 'lora', type: 'loraAdapterOp', x: 0, y: 1000, params: { rank: 1 } },
    { id: 'quant', type: 'quantProbeOp', x: 0, y: 1200, params: { precision: 3 } },
  ], [
    { id: 'w1', from: 'arr', to: 'sort' },
    { id: 'w2', from: 'field', to: 'fieldView' },
  ]);
  const ctx = makeCtx(doc, new Map());
  const array = evalOutput(ctx, 'arr');
  assert.equal(array?.kind, 'algoData');
  assert.deepEqual(array.values, [1, 2, 3, 4, 5, 6]);
  assert.equal(inputValues(ctx, doc.nodes[1]!).in?.kind, 'algoData');
  assert.equal(evalOutput(ctx, 'field')?.kind, 'field2d');
  assert.equal(inputValues(ctx, doc.nodes[3]!).in?.kind, 'field2d');
  const losses = evalOutput(ctx, 'loss');
  assert.equal(losses?.kind, 'tensor2d');
  assert.equal(losses.data[0]?.length, 3);
  const lossScalar = evalOutput(ctx, 'loss', 'loss');
  assert.equal(lossScalar?.kind, 'scalar');
  assert.ok((lossScalar.v ?? 0) > 0);
  assert.equal(evalOutput(ctx, 'lora')?.kind, 'tensor2d');
  const quantized = evalOutput(ctx, 'quant');
  assert.equal(quantized?.kind, 'tensor2d');
  assert.ok(quantized.data.flat().every(Number.isFinite));
});

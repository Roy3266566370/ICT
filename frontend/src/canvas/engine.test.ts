import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, evalOutput } from './engine.ts';
import { rot2 } from './math.ts';
import type { CanvasDoc } from './types.ts';

/** slider → [pi → rotor → po] composite → 外层读 po 端口 */
function compositeDoc(sliderV: number): { doc: CanvasDoc; compId: string; poId: string } {
  const compId = 'comp1';
  const poId = 'po1';
  const doc: CanvasDoc = {
    version: 1,
    title: 't',
    zoom: 1,
    nodes: [
      { id: 's1', type: 'slider', x: 0, y: 0, params: { v: sliderV } },
      {
        id: compId, type: 'composite', x: 0, y: 0, params: {},
        sub: {
          nodes: [
            { id: 'pi1', type: 'portIn', x: 0, y: 0, params: {} },
            { id: 'r1', type: 'rotor', x: 10, y: 10, params: { theta: 0 } },
            { id: 'po1', type: 'portOut', x: 20, y: 20, params: {} },
          ],
          wires: [
            { id: 'w1', from: 'pi1', fromPort: 'out', to: 'r1', toPort: 'in' },
            { id: 'w2', from: 'r1', fromPort: 'out', to: 'po1', toPort: 'in' },
          ],
          ports: [
            { id: 'pi1', dir: 'in', label: 'in', kind: 'scalar' },
            { id: 'po1', dir: 'out', label: 'out', kind: 'matrix2' },
          ],
        },
      },
    ],
    wires: [{ id: 'w0', from: 's1', to: compId, toPort: 'pi1' }],
    strokes: [],
  };
  return { doc, compId, poId };
}

test('composite: 外层标量注入 portIn，内部求值后由 portOut 端口语义输出', () => {
  const { doc, compId, poId } = compositeDoc(0.25);
  const ctx = makeCtx(doc, new Map());
  const out = evalOutput(ctx, compId, poId);
  assert.ok(out && out.kind === 'matrix2');
  const expect = rot2(0.25);
  assert.deepEqual(
    { a: out.a, b: out.b, c: out.c, d: out.d },
    { a: expect.a, b: expect.b, c: expect.c, d: expect.d },
  );
});

test('composite: 未接输入时 portIn 落空 → 内部回退自身参数', () => {
  const { doc, compId, poId } = compositeDoc(0);
  doc.wires = []; // 断开外层输入
  const ctx = makeCtx(doc, new Map());
  const out = evalOutput(ctx, compId, poId);
  assert.ok(out && out.kind === 'matrix2');
  // rotor 缺输入时用 params.theta = 0 → 单位阵（近似比较避开 -0）
  assert.ok(Math.abs(out.a - 1) < 1e-9 && Math.abs(out.d - 1) < 1e-9);
  assert.ok(Math.abs(out.b) < 1e-9 && Math.abs(out.c) < 1e-9);
});

test('composite: 嵌套积木求值（积木里的积木）', () => {
  const { doc, compId } = compositeDoc(0.5);
  // 把 comp1 再封装一层：外层 slider2 → comp2[pi2] → comp1 → comp2[po2] → 读 po2
  const doc2: CanvasDoc = {
    ...doc,
    nodes: [
      { id: 's2', type: 'slider', x: 0, y: 0, params: { v: 0.5 } },
      {
        id: 'comp2', type: 'composite', x: 0, y: 0, params: {},
        sub: {
          nodes: [
            { id: 'pi2', type: 'portIn', x: 0, y: 0, params: {} },
            doc.nodes[1]!, // comp1
            { id: 'po2', type: 'portOut', x: 30, y: 30, params: {} },
          ],
          wires: [
            { id: 'w3', from: 'pi2', to: compId, toPort: 'pi1' },
            { id: 'w4', from: compId, fromPort: 'po1', to: 'po2', toPort: 'in' },
          ],
          ports: [
            { id: 'pi2', dir: 'in', label: 'in', kind: 'scalar' },
            { id: 'po2', dir: 'out', label: 'out', kind: 'matrix2' },
          ],
        },
      },
    ],
    wires: [{ id: 'w5', from: 's2', to: 'comp2', toPort: 'pi2' }],
  };
  const ctx = makeCtx(doc2, new Map());
  const out = evalOutput(ctx, 'comp2', 'po2');
  assert.ok(out && out.kind === 'matrix2');
  const expect = rot2(0.5);
  assert.deepEqual(out.a, expect.a);
  assert.deepEqual(out.d, expect.d);
});

test('composite: 内部环不会死循环', () => {
  const { doc, compId, poId } = compositeDoc(0.25);
  // 人为造内环：r1.out → r1.in 之外再加一条 po 输出回 r1？portOut 无 out，直接让 r1 自环
  doc.nodes[1]!.sub!.wires.push({ id: 'wx', from: 'r1', to: 'r1', toPort: 'in' });
  const ctx = makeCtx(doc, new Map());
  // r1 的 in 取到 r1 自己 → 环 → null → pi 注入也还在（环被截断，po 读 r1 得 null?）
  // evalOutput 应正常返回（不挂起），值允许为 null
  const out = evalOutput(ctx, compId, poId);
  assert.ok(out === null || out.kind === 'matrix2');
});

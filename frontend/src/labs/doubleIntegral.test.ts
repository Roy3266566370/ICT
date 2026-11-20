import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import type { LabModel } from './types.ts';

const model = {engine:'double_integral_v1', subject:'calculus', task:'double_integral',kind:'integral',
  integrand:'(x-y+1)**2',outer_variable:'x',inner_variable:'y',outer_bounds:['0','1'],inner_bounds:['x**2','sqrt(x)'],
  exact:'71/210',answer_value:71/210,defaults:{slice:0.5,n:20},params:[]};

async function evaluate(patch = {}, params = {}) {
  assert.ok(existsSync(new URL('./doubleIntegral.ts', import.meta.url)), 'double integral evaluator is missing');
  const { evaluateDoubleIntegral } = await import('./doubleIntegral.ts');
  return evaluateDoubleIntegral({...model,...patch} as unknown as LabModel, params);
}

test('sample region and slice use original parabola boundaries', async () => {
  const r = await evaluate({}, {slice:0.25,n:80});
  assert.equal(r.task, 'double_integral');
  assert.equal(r.slice?.lower, 1/16);
  assert.equal(r.slice?.upper, 1/2);
  assert.equal(r.exact, 71/210);
  assert.ok(Math.abs((r.approx ?? 0)-71/210)<0.001);
  assert.equal(r.region?.length, 121);
  assert.equal(r.trace.length, 41);
});

test('partition refinement changes approximation and leaves exact result unchanged', async () => {
  const coarse = await evaluate({}, {n:4});
  const fine = await evaluate({}, {n:80});
  assert.ok(fine.error! < coarse.error!);
  assert.equal(fine.exact,coarse.exact);
});

test('horizontal slices preserve x and y in nonsymmetric integrands', async () => {
  const r = await evaluate({integrand:'x',outer_variable:'y',inner_variable:'x',inner_bounds:['0','y'],
    exact:'1/6',answer_value:1/6}, {slice:0.5,n:80});
  assert.equal(r.outer_variable,'y');
  assert.ok(Math.abs(r.approx!-1/6)<0.0001);
});

test('incomplete or inverted regions never draw invented rectangles', async () => {
  await assert.rejects(evaluate({outer_bounds:undefined}), /核对/);
  await assert.rejects(evaluate({inner_bounds:['1','0']}), /边界/);
});

test('piecewise regions integrate each piece and expose all regions', async () => {
  const r = await evaluate({
    region_kind:'pieces',
    pieces:[
      {index:1,outer_bounds:['0','1'],inner_bounds:['0','x'],exact:'1/2',answer_value:1/2},
      {index:2,outer_bounds:['1','2'],inner_bounds:['0','2-x'],exact:'5/6',answer_value:5/6},
    ],
    integrand:'x+y',exact:'4/3',answer_value:4/3,
  }, {slice:0.5,n:40});
  assert.equal(r.region_kind,'pieces');
  assert.equal(r.pieces?.length,2);
  assert.equal(r.pieces?.[0]?.region?.length,81);
  assert.ok(Math.abs((r.approx ?? 0)-4/3)<0.01);
});

test('polar regions carry outer/inner radius curves and Jacobian', async () => {
  const r = await evaluate({
    region_kind:'polar',outer_variable:'theta',inner_variable:'r',
    polar:{theta_bounds:['0','2*pi'],r_bounds:['0','1'],jacobian:'r',transformed_integrand:'r',inner_integral:'1/2',exact:'pi',answer_value:Math.PI},
    integrand:'1',exact:'pi',answer_value:Math.PI,
  }, {theta:Math.PI/2,n:60});
  assert.equal(r.region_kind,'polar');
  assert.equal(r.polar?.outer_points?.length,121);
  assert.equal(r.polar?.jacobian,'r');
  assert.ok(Math.abs((r.approx ?? 0)-Math.PI)<0.02);
});

test('swapped order is surfaced without replacing the original region', async () => {
  const r = await evaluate({
    swapped:{outer_variable:'y',inner_variable:'x',outer_bounds:['0','1'],inner_bounds:['y','sqrt(y)'],
      formula_tex:String.raw`\int_{0}^{1}\int_{y}^{\sqrt{y}}x+y\,dx\,dy`,exact:'3/20',answer_value:0.15},
  }, {slice:0.25,n:40});
  assert.equal(r.swapped ? 1 : 0, 1);
  assert.ok(r.notes.some(note => note.includes('换序')));
});

test('legacy swap formulas are not described as verified geometry',async()=>{
 const r=await evaluate({swapped:{outer_variable:'y',inner_variable:'x',outer_bounds:['0','2'],inner_bounds:['y-1','1'],formula_tex:'old',exact:'2',answer_value:2}});
 assert.ok(r.notes.some(note=>note.includes('重新核验')));
 assert.ok(!r.notes.some(note=>note.includes('结果 2')));
});

test('分片沙盒：拖边界改变近似值，分割线拖动保持相接', async () => {
  const { evaluatePiecesSandbox } = await import('./doubleIntegral.ts');
  const m = {...model, region_kind:'pieces', integrand:'1',
    pieces:[
      {index:1,outer_bounds:['0','1'],inner_bounds:['0','x'],exact:'1/2',answer_value:0.5},
      {index:2,outer_bounds:['1','2'],inner_bounds:['0','2-x'],exact:'1/2',answer_value:0.5},
    ]} as unknown as LabModel;
  const base = evaluatePiecesSandbox(m, [['0','x'],['0','2-x']], [[0,1],[1,2]], {n:60});
  assert.ok(Math.abs(base.approx - 1) < 0.01);
  // 拖低上边界 → 面积近似变小
  const dragged = evaluatePiecesSandbox(m, [['0','x/2'],['0','2-x']], [[0,1],[1,2]], {n:60});
  assert.ok(dragged.approx < base.approx - 0.2);
  // 分割线从 1 拖到 1.4：两片外边界一起移动仍相接；
  // 新面积 = ∫₀^1.4 x dx + ∫_1.4^2 (2-x) dx = 0.98 + 0.18 = 1.16
  const shifted = evaluatePiecesSandbox(m, [['0','x'],['0','2-x']], [[0,1.4],[1.4,2]], {n:60});
  assert.equal(shifted.pieces[0]!.outer[1], 1.4);
  assert.equal(shifted.pieces[1]!.outer[0], 1.4);
  assert.ok(Math.abs(shifted.approx - 1.16) < 0.02);
  // 片内上下边界交叉 → 明确报错
  assert.throws(() => evaluatePiecesSandbox(m, [['x','0'],['0','2-x']], [[0,1],[1,2]]), /交叉/);
});

test('极坐标沙盒：圆域近似面积，拖 θ 射线改变区域', async () => {
  const { evaluatePolarSandbox } = await import('./doubleIntegral.ts');
  const m = {...model, region_kind:'polar', integrand:'1',
    polar:{theta_bounds:['0','2*pi'],r_bounds:['0','1'],jacobian:'r',transformed_integrand:'r',inner_integral:'1/2',exact:'pi',answer_value:Math.PI},
  } as unknown as LabModel;
  const full = evaluatePolarSandbox(m, {theta:[0, 2*Math.PI], r:['0','1']}, {n:60});
  assert.ok(Math.abs(full.approx - Math.PI) < 0.02);
  // θ 上半圆 → 面积约 π/2
  const half = evaluatePolarSandbox(m, {theta:[0, Math.PI], r:['0','1']}, {n:60});
  assert.ok(Math.abs(half.approx - Math.PI / 2) < 0.02);
  assert.equal(half.outerPoints.length, 121);
  // r=2cosθ 圆（半径1）：θ∈[-π/2,π/2] 面积=π
  const circle = evaluatePolarSandbox(m, {theta:[-Math.PI/2, Math.PI/2], r:['0','2*cos(theta)']}, {n:60});
  assert.ok(Math.abs(circle.approx - Math.PI) < 0.03);
  // 内外边界交叉 → 明确报错
  assert.throws(() => evaluatePolarSandbox(m, {theta:[0, 1], r:['1','0']}), /交叉/);
});

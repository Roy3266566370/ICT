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

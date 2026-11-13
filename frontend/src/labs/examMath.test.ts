import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import type { LabModel } from './types.ts';

async function evaluate(model: Record<string, unknown>, params = {}) {
  assert.ok(existsSync(new URL('./examMath.ts', import.meta.url)), 'exam math frontend evaluator is missing');
  const module = await import('./examMath.ts');
  return module.evaluateExamMath(model as unknown as LabModel, params);
}

test('geometry reports the full improper area and volume supplied by the symbolic kernel', async () => {
  const result = await evaluate({ subject:'calculus', task:'area_volume', expression:'1/(x*sqrt(x**2+1))',
    defaults:{lower:1,upper:9,n:16}, improper_upper:true, requested_quantities:['area','volume'],
    reference_quantities:[{id:'area',label:'面积',value:Math.asinh(1),exact:'log(1+sqrt(2))'},
      {id:'volume',label:'旋转体积',value:Math.PI*(1-Math.PI/4),exact:'pi*(1-pi/4)'}] });
  assert.equal(result?.metrics.length, 2);
  assert.ok(result?.metrics.some(metric => metric.id === 'volume'));
  assert.equal(result?.exact, Math.asinh(1));
  assert.ok(result?.notes.some(note => note.includes('∞') && note.includes('截断')));
});

test('geometry rectangles follow the curve while area sums absolute contributions', async () => {
  const result = await evaluate({ subject:'calculus',task:'geometric_area',expression:'-x**3+x**2+2*x',
    defaults:{lower:-1,upper:2,n:80},requested_quantities:['area'],
    reference_quantities:[{id:'area',label:'面积',value:37/12,exact:'37/12'}] });
  assert.ok(result?.rects.some(rect => rect.height < 0));
  assert.ok(result?.rects.some(rect => rect.height > 0));
  assert.ok(Math.abs((result?.approx ?? 0)-37/12)<0.002);
});

test('volume-only approximation sums disks instead of area', async () => {
  const result = await evaluate({task:'area_volume',expression:'x*x',defaults:{lower:1,upper:3,n:80},
    reference_quantities:[{id:'volume',label:'旋转体积',value:242*Math.PI/5,exact:'242*pi/5'}]});
  assert.ok(Math.abs((result?.approx ?? 0)-242*Math.PI/5)<0.1);
});

test('implicit normal plots the confirmed curve branch and the normal slope', async () => {
  const result = await evaluate({ subject:'calculus',task:'implicit_normal',expression:'3*x**3-y**5-2*y**3',
    implicit_expression:'3*x**3-y**5-2*y**3',point_x:'1',point_y:'1',normal_slope:'-11/9',
    partial_x:'9*x**2',partial_y:'-5*y**4-6*y**2',defaults:{point:1,h:0.05} });
  assert.equal(result?.point?.slope,-11/9);
  assert.ok(result?.series.some(point => Math.abs(point.x-1)<1e-8 && point.y === 1));
  assert.ok(result?.metrics.some(metric => metric.id === 'normal_slope'));
});

test('vertical normal is not drawn as a horizontal tangent', async () => {
  const result = await evaluate({subject:'calculus',task:'implicit_normal',implicit_expression:'x**2+y**2-1',
    point_x:'0',point_y:'1',normal_slope:null,vertical_normal:true,partial_x:'2*x',partial_y:'2*y',defaults:{point:0} });
  assert.equal(result?.point, undefined);
  assert.ok(result?.headline.includes('x=0'));
});

test('unconfirmed geometry and curve branches refuse to render invented results', async () => {
  await assert.rejects(evaluate({task:'geometric_area',expression:'x',defaults:{}}), /核对/);
  await assert.rejects(evaluate({task:'implicit_normal',implicit_expression:'x*x+y*y-1',defaults:{}}), /核对/);
});

test('inequality region preview hides empty negative fibers', async () => {
  const result = await evaluate({task:'area_volume',expression:'x',region_kind:'vertical_inequality',
    effective_intervals:[['0','1']],defaults:{lower:-1,upper:1,n:80},
    reference_quantities:[{id:'area',label:'面积',value:0.5,exact:'1/2'},
      {id:'volume',label:'旋转体积',value:Math.PI/3,exact:'pi/3'}]});
  assert.ok(result?.series.filter(p=>p.x<0).every(p=>p.y === null));
  assert.ok(result?.rects.filter(r=>r.mid<0).every(r=>r.height === 0));
  assert.ok(Math.abs((result?.approx ?? 0)-0.5)<1e-8);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateOde} from './ode.ts';
import type {LabProblem} from './types.ts';

test('微分方程缺少核验结果时不能默认通过',()=>{
  const p={model:{defaults:{}},solution:{solution_complete:false,solution_status:'unsupported'}} as unknown as LabProblem;
  const r=evaluateOde(p);
  assert.equal(r.checks.find(c=>c.id==='residual')?.status,'fail');
  assert.equal(r.series.length,0);
});

test('特解曲线遵守已核验观察区间，不把无初值显示为初值通过',()=>{
  const p={model:{defaults:{x_min:-3,x_max:3},independent_variable:'x'},solution:{plot_expression:'1/(1-x)',plot_window:{x_min:-2,x_max:0.5},residual_verified:true,initial_conditions_verified:true,initial_conditions:[],solution_complete:true,solution_status:'complete'}} as unknown as LabProblem;
  const r=evaluateOde(p);
  assert.equal(r.domain.x_max,0.5);
  assert.ok(r.series.every(point=>point.x<1));
  assert.equal(r.checks.find(c=>c.id==='initial')?.status,'warn');
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { computeLab } from './compute.ts';
import type { LabModel, LabProblem, LabSolution } from './types.ts';

// Native backend models generated from test_labs_kernel_models.py; expectations below are independent.
const cases=JSON.parse(readFileSync(new URL('./fixtures/kernelModels.json',import.meta.url),'utf8')) as {task:string;model:LabModel;solution:LabSolution}[];
for (const {task,model,solution} of cases) {
  test(`AI条件生成的${task}模型可由现有前端画布求值`,()=>{
    const problem={subject:model.subject,model,solution} as LabProblem;
    const r=computeLab(problem,model.defaults);
    assert.equal(r.subject,model.subject);
    assert.ok(r.trace.length>0);
    assert.ok(r.metrics.length>0);
    assert.ok(!r.checks.some(c=>c.status==='fail'));
    if(r.subject==='calculus') {
      if(task==='integral') assert.ok(Math.abs(r.exact!-8/3)<1e-7);
      if(task==='derivative') assert.equal(r.point?.slope,12);
      if(task==='double_integral') assert.ok(Math.abs(r.exact!-0.5)<1e-8);
    }
    if(r.subject==='linear_algebra') {
      if(task==='determinant') assert.equal(r.det,-3);
      if(task==='linear_system') assert.deepEqual(r.solution,[2,3]);
    }
    if(r.subject==='deep_learning') assert.ok(Math.abs(r.lossHistory.at(-1)!-2.56)<1e-7);
  });
}

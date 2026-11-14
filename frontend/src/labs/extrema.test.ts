import {test} from 'node:test';
import assert from 'node:assert/strict';
import {manualConditions,manualInputError,manualInputKey,type ManualIntegralDraft} from './manualInput.ts';
import {computeLab,currentFrame} from './compute.ts';
import type {LabProblem} from './types.ts';

test('极值任务只发送已确认目标与完整约束；条件变化使确认失效',()=>{
 const draft={task:'multivariable_extrema',expression:'x*y',variable:'x',lower:'-2',upper:'2',extremaOperation:'constrained',extremaConstraint:'x+y=2'} as ManualIntegralDraft;
 assert.deepEqual(manualConditions(draft),{expression:'x*y',variables:'x,y',operation:'constrained',constraint:'x+y=2'});
 assert.equal(manualInputError(draft),null);
 assert.notEqual(manualInputKey(draft),manualInputKey({...draft,extremaConstraint:'x+y=4'}));
 assert.match(manualInputError({...draft,extremaConstraint:''})!,/约束/);
 assert.match(manualInputError({...draft,extremaConstraint:'x+y<=2'})!,/等式/);
 assert.deepEqual(manualConditions({...draft,extremaOperation:'unconstrained'}),{expression:'x*y',variables:'x,y',operation:'unconstrained'});
});

test('极值结果读取已核验候选，不启动梯度下降或单变量曲线',()=>{
 const p={subject:'calculus',model:{task:'multivariable_extrema',defaults:{}},solution:{answer:'',summary:'存在退化驻点',solution_complete:false,steps:[],limitations:[]}} as unknown as LabProblem;
 const r=computeLab(p,{});
 assert.equal(r.subject,'calculus');assert.equal(r.kind,'multivariable_extrema');
 assert.equal(currentFrame(r,0).detail,'存在退化驻点');
 if(r.subject==='calculus')assert.deepEqual(r.series,[]);
});

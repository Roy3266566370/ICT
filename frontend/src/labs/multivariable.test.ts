import {test} from 'node:test';
import assert from 'node:assert/strict';
import {computeLab,currentFrame} from './compute.ts';
import type {LabProblem} from './types.ts';

test('多元微分复用内核结果，不回退到单变量积分或优化示例',()=>{
 const p={subject:'calculus',model:{subject:'calculus',task:'multivariable',defaults:{}},solution:{answer:'22/5',answer_value:4.4,summary:'方向导数',solution_complete:true,steps:[{id:'normalize',title:'单位方向',detail:'3/5,4/5'}],limitations:[]}} as unknown as LabProblem;
 const r=computeLab(p,{});
 assert.equal(r.subject,'calculus');assert.equal(r.kind,'multivariable');
 assert.equal(r.trace[0].label,'单位方向');
 if(r.subject==='calculus')assert.deepEqual(r.series,[]);
});


test('未完成任务没有执行步骤时，时间轴保留未完成状态而不崩溃',()=>{
 const p={subject:'calculus',model:{subject:'calculus',task:'multivariable',defaults:{}},solution:{answer:'',summary:'可微性尚未确认',solution_complete:false,steps:[],limitations:[]}} as unknown as LabProblem;
 const r=computeLab(p,{});
 assert.equal(currentFrame(r,0).label,'暂无执行步骤');
 assert.equal(currentFrame(r,0).detail,'可微性尚未确认');
 assert.equal(r.trace.length,0);
});

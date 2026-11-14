import {test} from 'node:test';
import assert from 'node:assert/strict';
import {manualConditions,manualInputError,manualInputKey,type ManualIntegralDraft} from './manualInput.ts';
import {computeLab,currentMetrics} from './compute.ts';
import type {LabProblem} from './types.ts';

test('高级二重积分模式和反常积分保留完整条件并使旧确认失效',()=>{
 const base={task:'double_integral',expression:'1',variable:'x',lower:'0',upper:'1',doubleOuter:'x',innerLower:'0',innerUpper:'x'} as ManualIntegralDraft;
 const pieces={...base,doubleMode:'pieces',piecesText:'0;1;0;x\n1;2;0;2-x'} as ManualIntegralDraft;
 assert.deepEqual(manualConditions(pieces),{integrand:'1',region_mode:'pieces',outer_variable:'x',pieces_text:pieces.piecesText});
 assert.equal(manualInputError(pieces),null);
 assert.match(manualInputError({...pieces,piecesText:'0;1;0'})!,/四个/);
 const polar={...base,doubleMode:'polar',upper:'2*pi',innerUpper:'1'} as ManualIntegralDraft;
 assert.deepEqual(manualConditions(polar),{integrand:'1',region_mode:'polar',theta_lower:'0',theta_upper:'2*pi',radius_lower:'0',radius_upper:'1'});
 assert.equal(manualInputError({...polar,innerUpper:'2*cos(theta)'}),null);
 assert.notEqual(manualInputKey(base),manualInputKey({...base,swapOrder:true}));
 const improper={...base,task:'integral',integralMode:'improper',expression:'exp(-x)',upper:'oo'} as ManualIntegralDraft;
 assert.equal(manualConditions(improper).integral_mode,'improper');
 assert.equal(manualInputError(improper),null);
 assert.notEqual(manualInputKey(improper),manualInputKey({...improper,integralMode:'proper'}));
 const doubleImproper={...base,doubleMode:'improper',upper:'oo',innerUpper:'oo'} as ManualIntegralDraft;
 assert.equal(manualConditions(doubleImproper).region_mode,'improper');
 assert.equal(manualInputError(doubleImproper),null);
 assert.match(manualInputError({...doubleImproper,innerUpper:'x'})!,/常数/);
});

test('反常积分展示已核验结果，不计算有限默认区间的黎曼和',()=>{
 const p={subject:'calculus',manual_input:{task:'integral',conditions:{integral_mode:'improper'}},model:{kind:'integral',defaults:{}},solution:{answer:'1',answer_value:1,summary:'收敛',solution_complete:true,steps:[],limitations:[]}} as unknown as LabProblem;
 const r=computeLab(p,{});
 if(r.subject==='calculus'){assert.equal(r.exact,1);assert.deepEqual(r.rects,[]);assert.equal(r.approx,null);}
});

test('二重积分完整发送次序及四个积分限，不补0或夹带单变量字段',()=>{
 const draft={task:'double_integral',expression:'x+y',variable:'t',lower:'0',upper:'1',doubleOuter:'x',innerLower:'x^2',innerUpper:'sqrt(x)'} as ManualIntegralDraft;
 assert.deepEqual(manualConditions(draft),{integrand:'x+y',outer_variable:'x',outer_lower:'0',outer_upper:'1',inner_lower:'x^2',inner_upper:'sqrt(x)'});
 assert.equal(manualInputError(draft),null);
 assert.match(manualInputError({...draft,innerLower:''})!,/下界/);
 assert.match(manualInputError({...draft,lower:'y'})!,/常数/);
 assert.match(manualInputError({...draft,innerUpper:'y'})!,/只能/);
 assert.notEqual(manualInputKey(draft),manualInputKey({...draft,doubleOuter:'y'}));
 assert.notEqual(manualInputKey(draft),manualInputKey({...draft,innerLower:'0'}));
});

test('内核未完成二重积分时保留原因，不回退单变量或崩溃',()=>{
 const p={subject:'calculus',manual_input:{task:'double_integral',result_status:'unsupported'},model:{task:'double_integral',defaults:{}},solution:{answer:'',summary:'连续实定义未确认',solution_complete:false,steps:[],limitations:[]}} as unknown as LabProblem;
 const r=computeLab(p,{});
 assert.equal(r.headline,'连续实定义未确认');
 assert.deepEqual(currentMetrics(r,0),[]);
 if(r.subject==='calculus'){assert.deepEqual(r.series,[]);assert.equal(r.exact,null);}
});

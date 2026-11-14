import test from 'node:test';
import assert from 'node:assert/strict';
import {manualConditions,manualInputError,manualInputKey,type ManualIntegralDraft} from './manualInput.ts';
import {computeLab} from './compute.ts';
import type {LabProblem} from './types.ts';

const base:ManualIntegralDraft={task:'double_integral',expression:'x+y',variable:'x',lower:'0',upper:'1',innerLower:'0',innerUpper:'1',doubleOuter:'x'};

test('新参数模式不发送隐藏次序，完整字段变化使原确认失效',()=>{
 const affine={...base,doubleMode:'affine',xMap:'u+v',yMap:'u-v',innerUpper:'u'} as ManualIntegralDraft;
 assert.deepEqual(manualConditions(affine),{integrand:'x+y',region_mode:'affine',x_map:'u+v',y_map:'u-v',outer_lower:'0',outer_upper:'1',inner_lower:'0',inner_upper:'u'});
 assert.equal(manualInputError(affine),null);
 assert.notEqual(manualInputKey(affine),manualInputKey({...affine,yMap:'v-u'}));
 assert.match(manualInputError({...affine,xMap:'x+v'})!,/u、v/);
 const polar={...base,doubleMode:'polar_improper',upper:'2*pi',innerUpper:'∞'} as ManualIntegralDraft;
 assert.equal(manualInputError(polar),null);
 assert.equal(manualConditions(polar).radius_upper,'∞');
 assert.match(manualInputError({...polar,innerUpper:'theta'})!,/常数/);
});

test('联合概率和转动惯量不省略事件或旋转轴，换任务后不夹带隐藏条件',()=>{
 const probability={...base,doubleApplication:'probability',eventOuterLower:'0',eventOuterUpper:'1/2',eventInnerLower:'0',eventInnerUpper:'x'} as ManualIntegralDraft;
 assert.equal(manualInputError(probability),null);
 assert.equal(manualConditions(probability).event_outer_upper,'1/2');
 assert.match(manualInputError({...probability,eventInnerUpper:''})!,/事件/);
 const mass={...probability,doubleApplication:'mass'} as ManualIntegralDraft;
 assert.ok(!('event_outer_upper' in manualConditions(mass)));
 assert.notEqual(manualInputKey(mass),manualInputKey(probability));
 assert.match(manualInputError({...base,doubleApplication:'inertia'})!,/轴/);
});

test('扩展结果使用已验证的多值结果，不触发默认单片区域计算',()=>{
 const p={subject:'calculus',manual_input:{task:'double_integral',conditions:{region_mode:'affine'},double_extension:{kind:'affine'}},model:{task:'double_integral',defaults:{}},solution:{answer:'3',answer_value:3,summary:'仿射代换',steps:[],limitations:[]}} as unknown as LabProblem;
 const r=computeLab(p,{});
 if(r.subject==='calculus'){assert.equal(r.exact,3);assert.deepEqual(r.rects,[]);assert.equal(r.approx,null);}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {manualConditions,manualInputError,manualInputKey,type ManualIntegralDraft} from './manualInput.ts';
import {computeLab} from './compute.ts';
import type {LabProblem} from './types.ts';

const base={task:'triple_integral',expression:'x*y*z',variable:'x',tripleMode:'box',lower:'0',upper:'1',innerLower:'0',innerUpper:'1',tripleInnerLower:'0',tripleInnerUpper:'1'} as ManualIntegralDraft;

test('三重积分四种区域模式完整发送三层积分限',()=>{
 assert.deepEqual(manualConditions(base),{integrand:'x*y*z',region_mode:'box',x_lower:'0',x_upper:'1',y_lower:'0',y_upper:'1',z_lower:'0',z_upper:'1'});
 const zsimple={...base,tripleMode:'z_simple',innerUpper:'1-x',tripleInnerUpper:'1-x-y'} as ManualIntegralDraft;
 assert.deepEqual(manualConditions(zsimple),{integrand:'x*y*z',region_mode:'z_simple',x_lower:'0',x_upper:'1',y_lower:'0',y_upper:'1-x',z_lower:'0',z_upper:'1-x-y'});
 const cylindrical={...base,tripleMode:'cylindrical',upper:'2*pi',innerLower:'0',innerUpper:'1',tripleInnerUpper:'1-r^2'} as ManualIntegralDraft;
 assert.deepEqual(manualConditions(cylindrical),{integrand:'x*y*z',region_mode:'cylindrical',theta_lower:'0',theta_upper:'2*pi',radius_lower:'0',radius_upper:'1',z_lower:'0',z_upper:'1-r^2'});
 const spherical={...base,tripleMode:'spherical',upper:'2*pi',innerUpper:'pi',tripleInnerUpper:'2*cos(phi)'} as ManualIntegralDraft;
 assert.deepEqual(manualConditions(spherical),{integrand:'x*y*z',region_mode:'spherical',theta_lower:'0',theta_upper:'2*pi',phi_lower:'0',phi_upper:'pi',rho_lower:'0',rho_upper:'2*cos(phi)'});
});

test('三重积分变量依赖和缺失积分限在预览前被拦截',()=>{
 assert.equal(manualInputError(base),null);
 assert.match(manualInputError({...base,tripleInnerLower:''})!,/不自动补0/);
 assert.match(manualInputError({...base,innerLower:'x'})!,/常数/);
 assert.match(manualInputError({...base,expression:'x*w'})!,/被积函数/);
 const zsimple={...base,tripleMode:'z_simple',innerUpper:'1-x',tripleInnerUpper:'1-x-y'} as ManualIntegralDraft;
 assert.equal(manualInputError(zsimple),null);
 assert.match(manualInputError({...zsimple,tripleInnerUpper:'1-z'})!,/只能/);
 const cylindrical={...base,tripleMode:'cylindrical',upper:'2*pi',innerUpper:'1',tripleInnerUpper:'1-r^2'} as ManualIntegralDraft;
 assert.equal(manualInputError(cylindrical),null);
 assert.match(manualInputError({...cylindrical,innerUpper:'r'})!,/只能/);
 const spherical={...base,tripleMode:'spherical',upper:'2*pi',innerUpper:'pi',tripleInnerUpper:'2*cos(phi)'} as ManualIntegralDraft;
 assert.equal(manualInputError(spherical),null);
 assert.match(manualInputError({...spherical,innerUpper:'theta'})!,/常数/);
 assert.notEqual(manualInputKey(base),manualInputKey({...base,tripleMode:'cylindrical'}));
 assert.notEqual(manualInputKey(base),manualInputKey({...base,tripleInnerUpper:'2'}));
});

test('三重积分内核未完成时保留区域与原因，不回退单变量或二重积分',()=>{
 const p={subject:'calculus',manual_input:{task:'triple_integral',result_status:'unsupported'},
   model:{task:'triple_integral',defaults:{}},
   solution:{answer:'',summary:'连续实定义未确认',solution_complete:false,steps:[],limitations:[],space:{kind:'box',edges:[]}}} as unknown as LabProblem;
 const r=computeLab(p,{});
 assert.equal(r.headline,'连续实定义未确认');
 assert.equal(r.answerText,'');
 if(r.subject==='calculus'){assert.equal(r.kind,'space');assert.equal(r.exact,null);assert.deepEqual(r.space,{kind:'box',edges:[]});}
});

test('三重积分完成时展示精确值与空间区域，并保留计算步骤',()=>{
 const p={subject:'calculus',manual_input:{task:'triple_integral',result_status:'complete'},
   model:{task:'triple_integral',defaults:{}},
   solution:{answer:'1/8',answer_value:0.125,summary:'逐层积分',solution_complete:true,limitations:[],
     steps:[{id:'inner',title:'内层积分',detail:'z层',latex:'1/8'}],space:{kind:'box',edges:[]}}} as unknown as LabProblem;
 const r=computeLab(p,{});
 assert.equal(r.headline,'1/8');
 if(r.subject==='calculus'){assert.equal(r.kind,'space');assert.equal(r.exact,0.125);assert.equal(r.trace.length,1);assert.equal(r.checks[0]?.status,'pass');}
});

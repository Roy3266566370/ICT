import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLab } from './compute.ts';
import type { LabProblem, CalculusResult } from './types.ts';

const fixture = (task: string): LabProblem => ({subject:'calculus', model:{task,modeling_task:task,engine:'sympy',variables:['x','y'],expression:'x^2+y^2',defaults:{view_radius:3,probe_x:0,probe_y:0},params:[{id:'view_radius',label:'观察半径',kind:'number'}]},solution:{answer:'原题符号结论',summary:'原题符号结论',steps:[],solution_complete:true}} as unknown as LabProblem);

test('多元极值滑杆改变切片和数值，不改写已核验答案', () => {
 const p=fixture('multivariable_extrema');
 const a=computeLab(p,{probe_x:0,probe_y:0,view_radius:3}) as CalculusResult;
 const b=computeLab(p,{probe_x:1,probe_y:2,view_radius:2}) as CalculusResult;
 assert.notDeepEqual(a.series,b.series);
 assert.deepEqual(b.domain,{x_min:-1,x_max:3});
 assert.equal(b.metrics.at(-1)?.value,'5');
 assert.equal(b.answerText,p.solution.answer);
});

test('连续性滑杆改变单点补定义的观察结论', () => {
 const p=fixture('limit');
 p.model.modeling_task='continuity';p.model.variable='x';p.model.expression='sin(x)/x';p.model.limit_point_value=0;
 p.solution.continuity={classification:'removable',label:'可去间断点',value:{text:'未定义'},left:{text:'1'},right:{text:'1'}};
 const a=computeLab(p,{point_value:1,view_radius:1}) as CalculusResult;
 const b=computeLab(p,{point_value:2,view_radius:2}) as CalculusResult;
 assert.match(a.metrics.at(-1)?.value ?? '',/相等/);
 assert.match(b.metrics.at(-1)?.value ?? '',/不相等/);
 assert.notDeepEqual(a.domain,b.domain);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manualInputError, manualConditions, manualInputKey } from './manualInput.ts';

const draft = { task: 'integral' as const, expression: 'sin(x)', variable: 'x', lower: '0', upper: 'pi' };

test('手动积分必须填写全部条件，不把缺失上下限补成示例值', () => {
  assert.equal(manualInputError(draft), null);
  assert.match(manualInputError({ ...draft, lower: '' })!, /下限/);
  assert.match(manualInputError({ ...draft, expression: 'sin(' })!, /公式/);
  assert.match(manualInputError({ ...draft, upper: 'x' })!, /上限/);
});

test('不定积分不发送隐藏的上下限，变量和条件变化使确认失效', () => {
  const indefinite = { ...draft, task: 'antiderivative' as const };
  assert.deepEqual(manualConditions(indefinite), { expression: 'sin(x)', variable: 'x' });
  assert.notEqual(manualInputKey(draft), manualInputKey({ ...draft, upper: '2' }));
  assert.notEqual(manualInputKey(draft), manualInputKey(indefinite));
  assert.equal(manualInputError({ ...draft, expression: 't^2', variable: 't' }), null);
});

test('手动求导保留求导点，不携带积分上下限，修改点后须重新确认', () => {
  const derivative = { ...draft, task: 'derivative' as const, point: '2' };
  assert.deepEqual(manualConditions(derivative), { expression: 'sin(x)', variable: 'x', point: '2' });
  assert.equal(manualInputError(derivative), null);
  assert.match(manualInputError({ ...derivative, point: '' })!, /求导点/);
  assert.match(manualInputError({ ...derivative, point: 'NaN' })!, /求导点/);
  assert.notEqual(manualInputKey(derivative), manualInputKey({ ...derivative, point: '3' }));
});

test('精确点和极限方向参与确认，不携带积分区间', () => {
  const derivative = { ...draft, task: 'derivative' as const, point: 'pi/2' };
  assert.equal(manualInputError(derivative), null);
  assert.equal(manualInputError({ ...derivative, point: '1/3' }), null);
  const limit = { ...derivative, task: 'limit' as const, side: 'left' as const };
  assert.deepEqual(manualConditions(limit), { expression: 'sin(x)', variable: 'x', point: 'pi/2', side: 'left' });
  assert.notEqual(manualInputKey(limit), manualInputKey({ ...limit, side: 'right' }));
  assert.equal(manualInputError({ ...limit, point: 'oo' }), null);
  assert.match(manualInputError({ ...limit, point: 'x' })!, /常数/);
});

test('导函数与高阶导数不补求值点，阶数和可选点改变后须重新确认', () => {
  const higher = { ...draft, task: 'higher_derivative' as const, order: '2', point: '' };
  assert.deepEqual(manualConditions(higher), { expression: 'sin(x)', variable: 'x', order: '2' });
  assert.equal(manualInputError(higher), null);
  assert.match(manualInputError({ ...higher, order: '11' })!, /阶数/);
  assert.match(manualInputError({ ...higher, order: '' })!, /阶数/);
  assert.notEqual(manualInputKey(higher), manualInputKey({ ...higher, order: '1' }));
  assert.notEqual(manualInputKey(higher), manualInputKey({ ...higher, point: 'pi/2' }));
});

test('连续性保留单点定义；不同定义使确认失效', () => {
  const c = { ...draft, task: 'continuity' as const, point: '0', expression: 'sin(x)/x', valueMode: 'value' as const, pointValue: '1' };
  assert.deepEqual(manualConditions(c), { expression: 'sin(x)/x', variable: 'x', point: '0', value_mode: 'value', point_value: '1' });
  assert.equal(manualInputError(c), null);
  assert.match(manualInputError({ ...c, pointValue: '' })!, /单点函数值/);
  assert.notEqual(manualInputKey(c), manualInputKey({ ...c, pointValue: '2' }));
  assert.notEqual(manualInputKey(c), manualInputKey({ ...c, valueMode: 'undefined' }));
  assert.equal('point_value' in manualConditions({ ...c, valueMode: 'expression' }), false);
});

test('切线法线只发送曲线与点，多分支纵坐标改变后重新确认', () => {
  const d = { ...draft, task: 'implicit_normal' as const, expression: 'x^2+y^2=1', point: '0', pointY: '1' };
  assert.equal(manualInputError(d), null);
  assert.deepEqual(manualConditions(d), { implicit_expression: 'x^2+y^2=1', point_x: '0', point_y: '1' });
  assert.notEqual(manualInputKey(d),manualInputKey({ ...d, pointY: '-1' }));
  assert.equal('point_y' in manualConditions({ ...d, pointY: '' }),false);
  assert.match(manualInputError({ ...d, expression: 'y=x=' })!,/曲线/);
});

test('函数区间研究完整发送上下限和端点开闭，改变开闭须重新确认', () => {
  const d={ ...draft, task:'function_study' as const, expression:'x^2', lower:'0', upper:'pi', intervalType:'right_open' as const };
  assert.deepEqual(manualConditions(d),{expression:'x^2',variable:'x',lower:'0',upper:'pi',interval_type:'right_open'});
  assert.equal(manualInputError(d),null);
  assert.match(manualInputError({...d,lower:''})!,/下限/);
  assert.notEqual(manualInputKey(d),manualInputKey({...d,intervalType:'closed'}));
});

test('泰勒展开完整保留精确点与阶数，修改后重新确认', () => {
  const d={...draft,task:'taylor' as const,expression:'sin(x)',point:'pi',order:'3'};
  assert.deepEqual(manualConditions(d),{expression:'sin(x)',variable:'x',point:'pi',order:'3'});
  assert.equal(manualInputError(d),null);
  assert.match(manualInputError({...d,point:''})!,/常数/);
  assert.match(manualInputError({...d,order:'11'})!,/阶数/);
  assert.notEqual(manualInputKey(d),manualInputKey({...d,point:'pi/2'}));
  assert.notEqual(manualInputKey(d),manualInputKey({...d,order:'2'}));
});

test('积分应用保留区域定义与旋转轴，不夹带隐藏变量或上下边界',()=>{
  const d={...draft,task:'geometric_area' as const,expression:'x',lower:'-1',upper:'1',regionKind:'between_axis' as const};
  assert.deepEqual(manualConditions(d),{expression:'x',lower:'-1',upper:'1',region_kind:'between_axis'});
  assert.equal(manualInputError(d),null);
  assert.match(manualInputError({...d,regionKind:''})!,/区域/);
  const v={...d,task:'rotation_volume' as const,rotationAxis:'x' as const};
  assert.equal(manualConditions(v).rotation_axis,'x');
  assert.match(manualInputError({...v,rotationAxis:'y'})!,/不会替换/);
  assert.match(manualInputError({...v,rotationAxis:''})!,/请选择/);
  assert.notEqual(manualInputKey(d),manualInputKey({...d,regionKind:'vertical_inequality'}));
});

test('微分方程完整保留方程、自变量和逐行条件，允许不填初值',()=>{
  const d={...draft,task:'ode' as const,expression:"y''+y=0",variable:'x',initialConditions:"y(0)=0\ny'(0)=1"};
  assert.deepEqual(manualConditions(d),{equation:"y''+y=0",independent_variable:'x',initial_conditions:"y(0)=0\ny'(0)=1"});
  assert.equal(manualInputError(d),null);
  assert.equal(manualInputError({...d,initialConditions:''}),null);
  assert.equal(manualConditions({...d,initialConditions:''}).initial_conditions,'');
  assert.notEqual(manualInputKey(d),manualInputKey({...d,initialConditions:'y(0)=1'}));
  assert.match(manualInputError({...d,expression:"y'"})!,/等号/);
});

test('多元微分完整保留维度、点与方向约定，不给未填点补0',()=>{
  const d={...draft,task:'multivariable' as const,expression:'x^2+y^2',multiVariables:'x,y' as const,multiOperation:'gradient' as const,multiPoint:''};
  assert.deepEqual(manualConditions(d),{expression:'x^2+y^2',variables:'x,y',operation:'gradient'});
  const direction={...d,multiOperation:'directional' as const,multiPoint:'1,2',multiDirection:'3,4',directionLimit:'forward' as const};
  assert.equal(manualInputError(direction),null);
  assert.equal(manualConditions(direction).direction_limit,'forward');
  assert.match(manualInputError({...direction,multiPoint:''})!,/完整/);
  assert.notEqual(manualInputKey(direction),manualInputKey({...direction,directionLimit:'two_sided'}));
  assert.notEqual(manualInputKey(direction),manualInputKey({...direction,multiDirection:'-3,-4'}));
});

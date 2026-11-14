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

test('数项级数只发送通项与起始指标，不补默认起点',()=>{
  const d={...draft,task:'series_convergence' as const,expression:'(-1)^n/sqrt(n)',indexStart:'1'};
  assert.deepEqual(manualConditions(d),{term:'(-1)^n/sqrt(n)',index_start:'1'});
  assert.equal(manualInputError(d),null);
  assert.match(manualInputError({...d,indexStart:''})!,/起始指标/);
  assert.match(manualInputError({...d,indexStart:'1.5'})!,/起始指标/);
  assert.match(manualInputError({...d,indexStart:'101'})!,/起始指标/);
  assert.match(manualInputError({...d,expression:'1/x'})!,/指标 n/);
  assert.notEqual(manualInputKey(d),manualInputKey({...d,indexStart:'2'}));
});

test('幂级数完整保留目标、系数、中心与起始指标',()=>{
  const d={...draft,task:'power_series' as const,expression:'1/n',powerGoal:'radius' as const,powerCenter:'0',indexStart:'1'};
  assert.deepEqual(manualConditions(d),{goal:'radius',coefficient:'1/n',center:'0',index_start:'1'});
  assert.equal(manualInputError(d),null);
  assert.match(manualInputError({...d,powerCenter:''})!,/展开中心/);
  assert.match(manualInputError({...d,powerCenter:'x'})!,/展开中心/);
  assert.match(manualInputError({...d,indexStart:''})!,/起始指标/);
  assert.notEqual(manualInputKey(d),manualInputKey({...d,powerGoal:'sum'}));
  assert.notEqual(manualInputKey(d),manualInputKey({...d,powerCenter:'1'}));
  assert.equal(manualConditions({...d,powerGoal:'sum'}).goal,'sum');
});

test('傅里叶级数完整保留区间与阶数，不默认区间',()=>{
  const d={...draft,task:'fourier_series' as const,expression:'x',lower:'-pi',upper:'pi',order:'3'};
  assert.deepEqual(manualConditions(d),{expression:'x',lower:'-pi',upper:'pi',order:'3'});
  assert.equal(manualInputError(d),null);
  assert.match(manualInputError({...d,lower:''})!,/区间下限/);
  assert.match(manualInputError({...d,upper:'x'})!,/区间上限/);
  assert.match(manualInputError({...d,order:'13'})!,/1至12/);
  assert.match(manualInputError({...d,expression:'n*x'})!,/变量 x/);
  assert.notEqual(manualInputKey(d),manualInputKey({...d,upper:'2*pi'}));
  assert.notEqual(manualInputKey(d),manualInputKey({...d,order:'5'}));
});

test('空间几何按类型发送完整点、向量与平面系数',()=>{
  const v={...draft,task:'space_geometry' as const,spaceKind:'vector_operations' as const,spaceA:'1,2,3',spaceB:'4,5,6'};
  assert.deepEqual(manualConditions(v),{geometry_kind:'vector_operations',vector_a:'1,2,3',vector_b:'4,5,6'});
  assert.equal(manualInputError(v),null);
  assert.match(manualInputError({...v,spaceA:'1,2'})!,/3个分量/);
  assert.match(manualInputError({...v,spaceA:'x,2,3'})!,/有限实常数/);
  assert.notEqual(manualInputKey(v),manualInputKey({...v,spaceB:'4,5,7'}));
  assert.notEqual(manualInputKey(v),manualInputKey({...v,spaceKind:'vector_products'}));
});

test('空间几何平面必须四个系数且方向不能全部为零',()=>{
  const d={...draft,task:'space_geometry' as const,spaceKind:'plane_point_normal' as const,spaceA:'1,2,3',spaceB:'2,3,4'};
  assert.deepEqual(manualConditions(d),{geometry_kind:'plane_point_normal',point:'1,2,3',normal:'2,3,4'});
  assert.equal(manualInputError(d),null);
  assert.match(manualInputError({...d,spaceB:'2,3'})!,/3个分量/);
  const p={...draft,task:'space_geometry' as const,spaceKind:'point_plane_distance' as const,spaceA:'0,0,0',spaceB:'1,0,0,-2'};
  assert.deepEqual(manualConditions(p),{geometry_kind:'point_plane_distance',point:'0,0,0',plane:'1,0,0,-2'});
  assert.match(manualInputError({...p,spaceB:'1,0,-2'})!,/4个分量/);
  const line={...draft,task:'space_geometry' as const,spaceKind:'line_line_relation' as const,spaceA:'0,0,0',spaceB:'1,0,0',spaceC:'0,0,0',spaceD:'0,1,0'};
  assert.deepEqual(manualConditions(line),{geometry_kind:'line_line_relation',point_a:'0,0,0',direction_a:'1,0,0',point_b:'0,0,0',direction_b:'0,1,0'});
  assert.equal(manualInputError(line),null);
});

test('空间曲面类型复用方程输入，非曲面类型不携带方程',()=>{
  const surface={...draft,task:'space_geometry' as const,spaceKind:'surface_tangent' as const,expression:'z=x^2+y^2',spaceA:'1,1,2'};
  assert.deepEqual(manualConditions(surface),{geometry_kind:'surface_tangent',point:'1,1,2',surface:'z=x^2+y^2'});
  assert.equal(manualInputError(surface),null);
  assert.match(manualInputError({...surface,expression:'z=x^2+y^2=0'})!,/等号/);
  assert.match(manualInputError({...surface,expression:'z=t^2'})!,/x、y、z/);
  const quadric={...draft,task:'space_geometry' as const,spaceKind:'quadric_surface' as const,expression:'x^2/4+y^2/9+z^2=1'};
  assert.deepEqual(manualConditions(quadric),{geometry_kind:'quadric_surface',expression:'x^2/4+y^2/9+z^2=1'});
  assert.equal(manualInputError(quadric),null);
  assert.match(manualInputError({...quadric,expression:''})!,/二次曲面方程/);
  const line={...draft,task:'space_geometry' as const,spaceKind:'line_from_points' as const,expression:'should-not-send',spaceA:'0,0,0',spaceB:'1,2,3'};
  assert.equal('expression' in manualConditions(line),false);
});

test('第一类曲线积分发送参数曲线、区间与弧长被积函数',()=>{
  const d={...draft,task:'curve_surface_integral' as const,integralKind:'line_scalar' as const,curveX:'t',curveY:'t',curveZ:'0',lower:'0',upper:'1',expression:'1'};
  assert.deepEqual(manualConditions(d),{integral_kind:'line_scalar',curve_x:'t',curve_y:'t',curve_z:'0',t_lower:'0',t_upper:'1',integrand:'1'});
  assert.equal(manualInputError(d),null);
  assert.match(manualInputError({...d,curveZ:''})!,/曲线 z/);
  assert.match(manualInputError({...d,lower:'x'})!,/t 下限/);
  assert.match(manualInputError({...d,expression:''})!,/被积函数/);
  assert.notEqual(manualInputKey(d),manualInputKey({...d,upper:'2'}));
});

test('第二类曲线积分保留场分量与定向，默认参数增大方向',()=>{
  const d={...draft,task:'curve_surface_integral' as const,integralKind:'line_vector' as const,curveX:'t',curveY:'0',curveZ:'0',lower:'0',upper:'1',fieldP:'1',fieldQ:'0',fieldR:'0'};
  assert.deepEqual(manualConditions(d),{integral_kind:'line_vector',curve_x:'t',curve_y:'0',curve_z:'0',t_lower:'0',t_upper:'1',field_p:'1',field_q:'0',field_r:'0',orientation:'forward'});
  assert.equal(manualInputError(d),null);
  assert.notEqual(manualInputKey(d),manualInputKey({...d,integralOrientation:'reverse'}));
  assert.match(manualInputError({...d,integralOrientation:'sideways'})!,/定向/);
  assert.match(manualInputError({...d,fieldP:''})!,/P/);
});

test('第一类曲面积分区分显式曲面与参数曲面',()=>{
  const graph={...draft,task:'curve_surface_integral' as const,integralKind:'surface_scalar_graph' as const,surfaceZ:'x+y',lower:'0',upper:'1',innerLower:'0',innerUpper:'x',expression:'1'};
  assert.deepEqual(manualConditions(graph),{integral_kind:'surface_scalar_graph',surface_z:'x+y',x_lower:'0',x_upper:'1',y_lower:'0',y_upper:'x',integrand:'1'});
  assert.equal(manualInputError(graph),null);
  assert.match(manualInputError({...graph,innerUpper:'t'})!,/y 上界/);
  const param={...draft,task:'curve_surface_integral' as const,integralKind:'surface_scalar_param' as const,surfaceX:'u',surfaceY:'v',surfaceZuv:'0',lower:'0',upper:'1',innerLower:'0',innerUpper:'1',expression:'1'};
  assert.deepEqual(manualConditions(param),{integral_kind:'surface_scalar_param',surface_x:'u',surface_y:'v',surface_z_uv:'0',u_lower:'0',u_upper:'1',v_lower:'0',v_upper:'1',integrand:'1'});
  assert.equal(manualInputError(param),null);
  assert.match(manualInputError({...param,surfaceZuv:'x'})!,/u、v/);
});

test('第二类曲面积分保留通量定向并区分显式与参数曲面',()=>{
  const graph={...draft,task:'curve_surface_integral' as const,integralKind:'surface_flux_graph' as const,surfaceZ:'1',lower:'0',upper:'1',innerLower:'0',innerUpper:'1',fieldP:'0',fieldQ:'0',fieldR:'z'};
  assert.deepEqual(manualConditions(graph),{integral_kind:'surface_flux_graph',surface_z:'1',x_lower:'0',x_upper:'1',y_lower:'0',y_upper:'1',field_p:'0',field_q:'0',field_r:'z',orientation:'up'});
  assert.equal(manualInputError(graph),null);
  assert.notEqual(manualInputKey(graph),manualInputKey({...graph,integralOrientation:'down'}));
  const param={...draft,task:'curve_surface_integral' as const,integralKind:'surface_flux_param' as const,surfaceX:'u',surfaceY:'v',surfaceZuv:'0',lower:'0',upper:'1',innerLower:'0',innerUpper:'1',fieldP:'0',fieldQ:'0',fieldR:'1'};
  assert.equal(manualConditions(param).orientation,'positive');
  assert.equal(manualInputError(param),null);
});

test('Green/Gauss/Stokes 公式发送完整区域与定向',()=>{
  const green={...draft,task:'curve_surface_integral' as const,integralKind:'green' as const,fieldP:'-y',fieldQ:'x',lower:'0',upper:'1',innerLower:'0',innerUpper:'1'};
  assert.deepEqual(manualConditions(green),{integral_kind:'green',field_p:'-y',field_q:'x',x_lower:'0',x_upper:'1',y_lower:'0',y_upper:'1',orientation:'positive'});
  assert.equal(manualInputError(green),null);
  assert.match(manualInputError({...green,fieldP:'z'})!,/x、y/);
  assert.notEqual(manualInputKey(green),manualInputKey({...green,integralOrientation:'negative'}));
  const gauss={...draft,task:'curve_surface_integral' as const,integralKind:'gauss' as const,fieldP:'x',fieldQ:'y',fieldR:'z',lower:'0',upper:'1',innerLower:'0',innerUpper:'1',tripleInnerLower:'0',tripleInnerUpper:'1'};
  assert.equal(manualConditions(gauss).integral_kind,'gauss');
  assert.equal(manualInputError(gauss),null);
  assert.match(manualInputError({...gauss,tripleInnerUpper:''})!,/z 上限/);
  const stokes={...draft,task:'curve_surface_integral' as const,integralKind:'stokes' as const,fieldP:'-y',fieldQ:'x',fieldR:'0',surfaceZ:'0',lower:'0',upper:'1',innerLower:'0',innerUpper:'1'};
  assert.equal(manualConditions(stokes).orientation,'up');
  assert.equal(manualInputError(stokes),null);
});

test('零点存在性证明发送函数、区间与可选陈述',()=>{
  const d={...draft,task:'proof' as const,proofKind:'ivt_root' as const,expression:'x^2-1',lower:'0',upper:'2',proofStatement:'证明方程有根'};
  assert.deepEqual(manualConditions(d),{proof_kind:'ivt_root',expression:'x^2-1',lower:'0',upper:'2',statement:'证明方程有根'});
  assert.equal(manualInputError(d),null);
  assert.match(manualInputError({...d,expression:''})!,/函数 f/);
  assert.match(manualInputError({...d,lower:''})!,/区间下限/);
  assert.match(manualInputError({...d,expression:'y^2'})!,/变量 x/);
  assert.notEqual(manualInputKey(d),manualInputKey({...d,upper:'3'}));
  assert.equal('statement' in manualConditions({...d,proofStatement:''}),false);
});

test('唯一根与柯西中值定理发送两端函数',()=>{
  const unique={...draft,task:'proof' as const,proofKind:'ivt_unique_root' as const,expression:'x^3+x-1',lower:'0',upper:'1'};
  assert.deepEqual(manualConditions(unique),{proof_kind:'ivt_unique_root',expression:'x^3+x-1',lower:'0',upper:'1'});
  assert.equal(manualInputError(unique),null);
  const cauchy={...draft,task:'proof' as const,proofKind:'cauchy_mvt' as const,proofLeft:'x^2',proofRight:'x',lower:'1',upper:'2'};
  assert.deepEqual(manualConditions(cauchy),{proof_kind:'cauchy_mvt',left:'x^2',right:'x',lower:'1',upper:'2'});
  assert.equal(manualInputError(cauchy),null);
  assert.match(manualInputError({...cauchy,proofRight:''})!,/右端函数/);
});

test('函数不等式与反例保留关系符号和点',()=>{
  const inequality={...draft,task:'proof' as const,proofKind:'inequality' as const,proofLeft:'x^2',proofRight:'x',proofRelation:'>=',lower:'1',upper:'2'};
  assert.deepEqual(manualConditions(inequality),{proof_kind:'inequality',left:'x^2',right:'x',relation:'>=',lower:'1',upper:'2'});
  assert.equal(manualInputError(inequality),null);
  assert.match(manualInputError({...inequality,proofRelation:'>'})!,/关系符号/);
  const counter={...draft,task:'proof' as const,proofKind:'counterexample' as const,proofLeft:'x^2',proofRight:'x',proofRelation:'>=',point:'1/2'};
  assert.deepEqual(manualConditions(counter),{proof_kind:'counterexample',left:'x^2',right:'x',relation:'>=',point:'1/2'});
  assert.equal(manualInputError(counter),null);
  assert.match(manualInputError({...counter,point:'x'})!,/反例点/);
  assert.notEqual(manualInputKey(counter),manualInputKey({...counter,point:'2'}));
});

test('综合题步骤逐行核对等式，不携带无关表达式',()=>{
  const d={...draft,task:'proof' as const,proofKind:'steps' as const,expression:'should-not-send',proofSteps:'x^2-1=(x-1)*(x+1)\n(x-1)*(x+1)=x^2-1'};
  assert.deepEqual(manualConditions(d),{proof_kind:'steps',steps:'x^2-1=(x-1)*(x+1)\n(x-1)*(x+1)=x^2-1'});
  assert.equal(manualInputError(d),null);
  assert.match(manualInputError({...d,proofSteps:'x^2-1'})!,/lhs=rhs/);
  assert.match(manualInputError({...d,proofSteps:''})!,/1至20/);
  assert.match(manualInputError({...d,proofSteps:'x^2-1=y^2'})!,/变量 x/);
});

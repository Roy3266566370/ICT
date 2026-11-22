import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPhysicsPipeline,
  evaluatePhysicsStage,
  findPhysicsStage,
  physicsPipelinePorts,
  physicsPipelines,
} from './physicsPipeline.ts';
import {
  inclineCriticalAngleDeg,
  projectileDragAt,
  projectileDragFlight,
  projectileIdealAt,
  projectileIdealFlight,
} from './physicsPipelineMech.ts';
import {
  calculateCarnotCycle,
  calculatePhotoelectric,
  calculateRefraction,
  calculateThinLensImage,
  normalizedMultiSlitIntensity,
  photoelectricCurrentAtVoltage,
  wavelengthToRgbHex,
} from './physicsPipelineOptics.ts';
import { evalOutput, makeCtx } from './engine.ts';
import type { CanvasDoc, CanvasNode, PortValue } from './types.ts';
import type { ScienceResult } from './sciencePipelineTypes.ts';

const ELEMENTARY_CHARGE = 1.602176634e-19;
const PROTON_MASS = 1.67262192369e-27;
const GAS_CONSTANT = 8.31446261815324;

type PhysicsOutput = Extract<PortValue, { kind: 'physicsData' }>;

function approx(actual: number, expected: number, tolerance = 1e-8, label = ''): void {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label} 期望 ${expected}±${tolerance}，实际 ${actual}`,
  );
}

function runStage(
  kind: string,
  stageId: string,
  text?: string,
  params: Record<string, number> = {},
): ScienceResult {
  const stage = physicsPipelines[kind]?.stages.find((candidate) => candidate.id === stageId);
  assert.ok(stage, `${kind} 缺少环节 ${stageId}`);
  const defaults = Object.fromEntries((stage.controls ?? []).map((control) => [control.key, control.value]));
  return stage.run({ text: text ?? stage.text ?? '', params: { ...defaults, ...params }, upstream: [] });
}

function evaluateDocument(doc: CanvasDoc): Map<string, PhysicsOutput> {
  const ctx = makeCtx(doc, new Map());
  const outputs = new Map<string, PhysicsOutput>();
  for (const node of doc.nodes.filter((candidate) => candidate.type === 'physicsStage')) {
    const output = evalOutput(ctx, node.id);
    assert.ok(output?.kind === 'physicsData', `${node.payload} 未输出 physicsData`);
    assert.equal(output.error, undefined, `${node.payload} 求值失败`);
    const stageId = node.payload?.split('/')[1];
    assert.ok(stageId);
    outputs.set(stageId, output);
  }
  return outputs;
}

function evaluateStage(kind: string, stageId: string): PhysicsOutput {
  const doc = buildPhysicsPipeline(kind, kind, '数值回归');
  const node = doc.nodes.find((candidate) => candidate.payload === `${kind}/${stageId}`);
  assert.ok(node, `${kind} 缺少节点 ${stageId}`);
  const output = evalOutput(makeCtx(doc, new Map()), node.id);
  assert.ok(output?.kind === 'physicsData');
  assert.equal(output.error, undefined, output.error);
  return output;
}

function metric(result: ScienceResult, label: string, frameIndex = 0): string {
  const value = result.frames[frameIndex]?.metrics?.find((candidate) => candidate.label === label)?.value;
  assert.ok(value !== undefined, `缺少指标 ${label}`);
  return value;
}

function numericRow(result: ScienceResult, rowIndex: number, columnIndex: number, frameIndex = 0): number {
  const value = result.frames[frameIndex]?.rows?.[rowIndex]?.[columnIndex];
  assert.equal(typeof value, 'number', `明细 [${rowIndex}, ${columnIndex}] 应为数值`);
  return value as number;
}

function numericSeries(result: ScienceResult, label: string): number[] {
  const values = result.frames[0]?.series?.find((candidate) => candidate.label === label)?.values;
  assert.ok(values && values.length > 0, `缺少数据序列 ${label}`);
  return values;
}

function assertFiniteFrames(result: ScienceResult): void {
  assert.ok(result.frames.length > 0);
  for (const frame of result.frames) {
    assert.ok(frame.scene.ariaLabel.length > 0);
    for (const path of frame.scene.paths ?? []) {
      assert.ok(path.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
    }
    for (const item of frame.metrics ?? []) {
      assert.ok(!/NaN|Infinity/.test(item.value), `${frame.title} 出现非法读数 ${item.value}`);
    }
    for (const series of frame.series ?? []) {
      assert.ok(series.values.every(Number.isFinite), `${series.label} 出现非有限值`);
    }
  }
}

test('12 条物理管线均可构建、连线并输出有限物理数据帧', () => {
  assert.equal(Object.keys(physicsPipelines).length, 12);
  for (const [kind, definition] of Object.entries(physicsPipelines)) {
    assert.ok(definition.stages.length >= 4 && definition.stages.length <= 5, `${kind} 环节数异常`);
    const doc = buildPhysicsPipeline(kind, kind, '守恒量回归');
    assert.equal(doc.nodes.filter((node) => node.type === 'physicsStage').length, definition.stages.length);
    const expectedWires = definition.stages.reduce((sum, stage) => sum + (stage.inputs?.length ?? 0), 0);
    assert.equal(doc.wires.length, expectedWires, `${kind} 连线数不符`);
    const outputs = evaluateDocument(doc);
    assert.equal(outputs.size, definition.stages.length);
    for (const node of doc.nodes.filter((candidate) => candidate.type === 'physicsStage')) {
      const definitionAtNode = findPhysicsStage(node);
      assert.ok(definitionAtNode, `${node.payload} 无法解析`);
      const output = outputs.get(definitionAtNode.stage.id);
      assert.ok(output, `${node.payload} 缺少输出`);
      assertFiniteFrames(output.result);
      assert.deepEqual(physicsPipelinePorts(node, 'out'), [{ id: 'out', label: '实验数据', kind: 'physicsData' }]);
      assert.equal(physicsPipelinePorts(node, 'in').length, definitionAtNode.stage.inputs?.length ?? 0);
    }
  }
});

test('物理注册器拒绝未知模块、错误类型和未知管线', () => {
  const unknown: CanvasNode = { id: 'unknown', type: 'physicsStage', x: 0, y: 0, payload: 'missing/source', params: {} };
  const wrongType: CanvasNode = { ...unknown, type: 'textNote' };
  assert.equal(findPhysicsStage(unknown), undefined);
  assert.equal(findPhysicsStage(wrongType), undefined);
  assert.deepEqual(physicsPipelinePorts(unknown, 'in'), []);
  assert.deepEqual(physicsPipelinePorts(wrongType, 'out'), []);
  assert.equal(evaluatePhysicsStage(unknown, () => null), null);
  assert.equal(evaluatePhysicsStage(wrongType, () => null), null);
  assert.throws(() => buildPhysicsPipeline('missing', '无效', ''), /未知学科管线/);
});

test('理想抛体满足解析轨迹、射程与顶点公式，零阻力闭式解严格退化', () => {
  const atOne = projectileIdealAt(20, 30, 10, 1);
  approx(atOne.x, 10 * Math.sqrt(3), 1e-12, 'x(1)');
  approx(atOne.y, 5, 1e-12, 'y(1)');
  approx(atOne.vx, 10 * Math.sqrt(3), 1e-12, 'vx');
  approx(atOne.vy, 0, 1e-12, 'vy');
  const flight = projectileIdealFlight(20, 30, 10);
  approx(flight.time, 2, 1e-12, '飞行时间');
  approx(flight.range, 20 * Math.sqrt(3), 1e-12, '射程');
  approx(flight.height, 5, 1e-12, '顶点高度');
  const zeroDrag = projectileDragAt(20, 30, 10, 1, 0, 0.8);
  assert.deepEqual(zeroDrag, projectileIdealAt(20, 30, 10, 0.8));
  assert.deepEqual(projectileDragFlight(20, 30, 10, 1, 0), flight);
});

test('线性阻力缩短射程并降低顶点，飞行末时刻落回地面且顶点竖直速度为零', () => {
  const ideal = projectileIdealFlight(22, 45, 9.8);
  const drag = projectileDragFlight(22, 45, 9.8, 1, 0.8);
  assert.ok(drag.range < ideal.range);
  assert.ok(drag.height < ideal.height);
  const landing = projectileDragAt(22, 45, 9.8, 1, 0.8, drag.time);
  approx(landing.y, 0, 1e-8, '落点高度');
  approx(landing.x, drag.range, 1e-8, '落点横坐标');
  const apexTime = (1 / 0.8) * Math.log(1 + 22 * Math.sin(Math.PI / 4) / (9.8 / 0.8));
  approx(projectileDragAt(22, 45, 9.8, 1, 0.8, apexTime).vy, 0, 1e-10, '顶点 vy');
  const comparison = evaluateStage('projectile-drag', 'compare').result;
  assert.ok(comparison.frames.length === 61);
  assert.ok(Number(metric(comparison, '阻力射程').split(' ')[0]) < Number(metric(comparison, '理想射程').split(' ')[0]));
});

test('斜面临界角满足 tan(alpha)=mu，自锁与加速下滑的受力和能量账目分别正确', () => {
  approx(inclineCriticalAngleDeg(0.5), Math.atan(0.5) * 180 / Math.PI, 1e-12);
  approx(inclineCriticalAngleDeg(-1), 0, 1e-12, '负摩擦系数按零处理');
  const locked = runStage('incline-friction', 'forces', undefined, { alpha: 20, mu: 0.6 });
  assert.equal(metric(locked, '状态'), '静摩擦平衡');
  approx(Number.parseFloat(metric(locked, '摩擦力 f')), 9.8 * Math.sin(20 * Math.PI / 180), 0.005);
  const sliding = runStage('incline-friction', 'forces', undefined, { alpha: 40, mu: 0.2 });
  assert.equal(metric(sliding, '状态'), '加速下滑');
  approx(Number.parseFloat(metric(sliding, '摩擦力 f')), 0.2 * 9.8 * Math.cos(40 * Math.PI / 180), 0.005);
  const energy = runStage('incline-friction', 'energy', undefined, { alpha: 40, mu: 0.2 });
  assert.equal(metric(energy, '能量校验 W_g−KE−Q', energy.frames.length - 1), '0.000000');
});

test('碰撞管线在任意恢复系数下保持动量，弹性和完全非弹性能量结果符合闭式解', () => {
  const elastic = runStage('collision-momentum', 'conserve', undefined, { e: 1 });
  assert.equal(metric(elastic, '动量是否守恒'), '守恒');
  approx(Number.parseFloat(metric(elastic, '动能损失')), 0, 1e-12, '弹性碰撞动能损失');
  assert.equal(elastic.frames[0]?.rows?.[3]?.[2], '1.00');
  assert.equal(elastic.frames[0]?.rows?.[1]?.[2], '-2.33');
  assert.equal(elastic.frames[0]?.rows?.[2]?.[2], '1.67');

  const inelastic = runStage('collision-momentum', 'conserve', undefined, { e: 0 });
  assert.equal(inelastic.frames[0]?.rows?.[3]?.[2], '1.00');
  assert.equal(inelastic.frames[0]?.rows?.[1]?.[2], '0.33');
  assert.equal(inelastic.frames[0]?.rows?.[2]?.[2], '0.33');
  assert.equal(metric(inelastic, '碰后动能'), '0.17 J');
  assert.equal(metric(inelastic, '动能损失'), '5.33 J');

  const separated = runStage('collision-momentum', 'conserve', undefined, { v1: 0, v2: 1 });
  assert.equal(metric(separated, '动量是否守恒'), '无碰撞');
  assert.equal(metric(separated, '动能损失'), '0.00 J');
  const sweep = runStage('collision-momentum', 'sweep');
  assert.equal(metric(sweep, '动能保留率', 60), '100.0%');
});

test('大摆角周期大于小角周期，驻波在四分之一周期归零并在整周期附近达到双倍振幅', () => {
  const source = runStage('oscillation-wave', 'source', undefined, { theta0: 100 });
  assert.ok(Number.parseFloat(metric(source, '周期比 T/T₀')) > 1);
  approx(Number.parseFloat(metric(source, '波速 v = fλ')), 2, 1e-12);
  const standing = runStage('oscillation-wave', 'wave', undefined, { mode: 1, amp: 0.8, freq: 1, lambda: 2 });
  assert.equal(metric(standing, '模式'), '驻波');
  assert.equal(metric(standing, '当前最大位移', 0), '1.60 m');
  assert.equal(metric(standing, '当前最大位移', 15), '0.00 m');
  assert.equal(metric(standing, '当前最大位移', 30), '1.60 m');
  assert.ok((standing.frames[0]?.scene.points?.length ?? 0) > 0);
  assertFiniteFrames(runStage('oscillation-wave', 'resonance'));
});

test('带电粒子满足速度筛选、圆周半径、周期与磁场不做功', () => {
  const selector = runStage('charged-particle', 'particle-selector');
  assert.equal(metric(selector, '选择状态'), '通过：v = E/B');
  approx(numericRow(selector, 1, 1), 200_000, 1e-8, 'E/B');
  const orbit = runStage('charged-particle', 'particle-orbit');
  const radius = PROTON_MASS * 200_000 / (ELEMENTARY_CHARGE * 0.02);
  approx(Math.max(...numericSeries(orbit, '轨道 x (m)')), radius, 1e-8, '轨道半径');
  approx(numericRow(orbit, 4, 1), 2 * Math.PI * PROTON_MASS / (ELEMENTARY_CHARGE * 0.02), 1e-12, '圆周周期');
  const velocitiesX = numericSeries(orbit, '速度 x (m/s)');
  const velocitiesY = numericSeries(orbit, '速度 y (m/s)');
  velocitiesX.forEach((vx, index) => approx(Math.hypot(vx, velocitiesY[index]!), 200_000, 1e-6, '磁场保持速率'));
  assert.equal(metric(runStage('charged-particle', 'particle-lorentz'), '磁场做功'), '0 J');
});

test('RC 充放电在 t=tau 处满足指数公式，电源功、储能与焦耳热逐帧守恒', () => {
  const charging = runStage('rc-circuit', 'rc-transient');
  const times = numericSeries(charging, '时间 (s)');
  const voltages = numericSeries(charging, '电容电压 (V)');
  const currents = numericSeries(charging, '电流 (A)');
  approx(times[20]!, 1, 1e-12, 't=tau');
  approx(voltages[20]!, 5 * (1 - Math.exp(-1)), 1e-12, '充电电压');
  approx(currents[20]!, 0.005 * Math.exp(-1), 1e-12, '充电电流');
  for (const residual of numericSeries(charging, '能量守恒残差 (J)')) approx(residual, 0, 1e-12, '充电能量残差');

  const discharging = runStage('rc-circuit', 'rc-transient', undefined, { mode: 0, initialVoltage: 5 });
  approx(numericSeries(discharging, '电容电压 (V)')[20]!, 5 * Math.exp(-1), 1e-12, '放电电压');
  approx(numericSeries(discharging, '电流 (A)')[20]!, -0.005 * Math.exp(-1), 1e-12, '放电电流');
  for (const residual of numericSeries(discharging, '能量守恒残差 (J)')) approx(residual, 0, 1e-12, '放电能量残差');
});

test('动生电动势满足 BLv、指数阻尼和机械能到焦耳热的完整转化', () => {
  const result = runStage('motional-emf', 'motional-current');
  const speeds = numericSeries(result, '速度 (m/s)');
  const emfs = numericSeries(result, '感应电动势 (V)');
  const currents = numericSeries(result, '感应电流 (A)');
  const forces = numericSeries(result, '安培阻力 (N)');
  approx(speeds[20]!, 4 * Math.exp(-1), 1e-12, 't=tau 速度');
  approx(emfs[20]!, 0.5 * 0.4 * speeds[20]!, 1e-12, 'BLv');
  approx(currents[20]!, emfs[20]! / 2, 1e-12, '感应电流');
  approx(forces[20]!, 0.5 ** 2 * 0.4 ** 2 * speeds[20]! / 2, 1e-12, '安培阻力');
  approx(numericSeries(result, '位移 (m)').at(-1)!, 20 * (1 - Math.exp(-5)), 1e-10, '极限位移');
  for (const residual of numericSeries(result, '能量守恒残差 (J)')) approx(residual, 0, 1e-12, '动生电动势能量残差');
});

test('双缝与光栅中央主极大归一化为 1，干涉零点与可见光颜色映射正确', () => {
  assert.match(wavelengthToRgbHex(400), /^#[0-9a-f]{6}$/);
  assert.notEqual(wavelengthToRgbHex(400), wavelengthToRgbHex(650));
  assert.equal(normalizedMultiSlitIntensity(0, 550, 25, 5, 2), 1);
  assert.equal(normalizedMultiSlitIntensity(0, 550, 25, 5, 8), 1);
  const doubleZeroAngle = Math.asin(550e-9 / (2 * 25e-6));
  approx(normalizedMultiSlitIntensity(doubleZeroAngle, 550, 25, 0.000001, 2), 0, 1e-12, '双缝暗纹');
  const gratingZeroAngle = Math.asin(550e-9 / (4 * 25e-6));
  approx(normalizedMultiSlitIntensity(gratingZeroAngle, 550, 25, 0.000001, 4), 0, 1e-12, '光栅零点');
  const fringes = runStage('double-slit', 'fringe-analysis');
  approx(Number.parseFloat(metric(fringes, '条纹间距 Δx')), 550e-9 * 1.2 / 25e-6 * 1000, 0.0005, '条纹间距');
});

test('折射在临界角两侧正确切换，薄透镜覆盖实像、虚像与焦平面', () => {
  const critical = Math.asin(1 / 1.5) * 180 / Math.PI;
  const atCritical = calculateRefraction(1.5, 1, critical);
  assert.equal(atCritical.totalInternalReflection, false);
  approx(atCritical.transmittedAngleRad ?? 0, Math.PI / 2, 1e-12);
  const reflected = calculateRefraction(1.5, 1, 50);
  assert.equal(reflected.totalInternalReflection, true);
  assert.equal(reflected.transmittedAngleRad, null);
  approx(reflected.criticalAngleRad ?? 0, Math.asin(1 / 1.5), 1e-12);
  assert.equal(calculateRefraction(1, 1.5, 50).criticalAngleRad, null);

  const real = calculateThinLensImage(100, 300, 30);
  approx(real.imageDistanceMm ?? 0, 150, 1e-12);
  approx(real.magnification ?? 0, -0.5, 1e-12);
  approx(real.imageHeightMm ?? 0, -15, 1e-12);
  assert.equal(real.state, 'real');
  const virtual = calculateThinLensImage(100, 50, 30);
  approx(virtual.imageDistanceMm ?? 0, -100, 1e-12);
  approx(virtual.magnification ?? 0, 2, 1e-12);
  assert.equal(virtual.state, 'virtual');
  assert.deepEqual(calculateThinLensImage(100, 100, 30), {
    imageDistanceMm: null, magnification: null, imageHeightMm: null, state: 'at-infinity',
  });
});

test('卡诺循环满足理想气体状态方程、热量收支和效率公式，并拒绝无效热源', () => {
  const cycle = calculateCarnotCycle({ hotTemperatureK: 600, coldTemperatureK: 300, initialVolumeL: 10, isothermalExpansionRatio: 2, amountMol: 1 });
  approx(cycle.efficiency, 0.5, 1e-12);
  approx(cycle.heatInputJ, GAS_CONSTANT * 600 * Math.log(2), 1e-8);
  approx(cycle.heatRejectedJ, GAS_CONSTANT * 300 * Math.log(2), 1e-8);
  approx(cycle.netWorkJ, cycle.heatInputJ * cycle.efficiency, 1e-8);
  assert.deepEqual(cycle.states.map((state) => state.temperatureK), [600, 600, 300, 300]);
  for (const state of cycle.states) approx(state.pressureKPa * state.volumeL, GAS_CONSTANT * state.temperatureK, 1e-8, `状态 ${state.label}`);
  assert.equal(cycle.points.at(-1)?.segment, 'D→A');
  assert.throws(() => calculateCarnotCycle({ hotTemperatureK: 300, coldTemperatureK: 300 }), /严格高于/);
});

test('光电效应区分频率和光强，遏止电压分段及截止边界不产生伪电流', () => {
  const base = calculatePhotoelectric({ wavelengthNm: 400, workFunctionEv: 2.2, opticalPowerMw: 2, quantumEfficiencyPercent: 20, appliedVoltageV: 1 });
  assert.equal(base.emitted, true);
  approx(base.maximumKineticEnergyEv, base.photonEnergyEv - 2.2, 1e-12);
  approx(base.stoppingVoltageV ?? 0, base.maximumKineticEnergyEv, 1e-12);
  const brighter = calculatePhotoelectric({ wavelengthNm: 400, workFunctionEv: 2.2, opticalPowerMw: 4, quantumEfficiencyPercent: 20, appliedVoltageV: 1 });
  approx(brighter.saturationCurrentA, 2 * base.saturationCurrentA, 1e-15);
  approx(brighter.stoppingVoltageV ?? 0, base.stoppingVoltageV ?? 0, 1e-12);
  const below = calculatePhotoelectric({ wavelengthNm: 700, workFunctionEv: 2.2, opticalPowerMw: 100, appliedVoltageV: 5 });
  assert.equal(below.emitted, false);
  assert.equal(below.maximumKineticEnergyEv, 0);
  assert.equal(below.stoppingVoltageV, null);
  assert.equal(below.saturationCurrentA, 0);
  assert.equal(photoelectricCurrentAtVoltage(-1, 1, 2), 0);
  assert.equal(photoelectricCurrentAtVoltage(-0.5, 1, 2), 1);
  assert.equal(photoelectricCurrentAtVoltage(0, 1, 2), 2);
  assert.equal(photoelectricCurrentAtVoltage(1, null, 2), 0);
  assert.equal(photoelectricCurrentAtVoltage(1, 0, 2), 0);
});

test('断开上游连线后下游物理环节给出明确等待状态而不伪造数值', () => {
  const doc = buildPhysicsPipeline('rc-circuit', 'RC', '');
  const target = doc.nodes.find((node) => node.payload === 'rc-circuit/rc-balance');
  assert.ok(target);
  const disconnected = { ...doc, wires: doc.wires.filter((wire) => wire.to !== target.id) };
  const output = evalOutput(makeCtx(disconnected, new Map()), target.id);
  assert.ok(output?.kind === 'physicsData');
  assert.match(output.error ?? '', /等待有效输入/);
  assert.deepEqual(output.result.frames, []);
});
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCalculusPipeline,
  calculusPipelinePorts,
  calculusPipelines,
  evaluateCalculusStage,
  findCalculusStage,
} from './calculusPipeline.ts';
import { evalOutput, makeCtx } from './engine.ts';
import type { CanvasDoc, CanvasNode, PortValue } from './types.ts';
import type { ScienceResult } from './sciencePipelineTypes.ts';

type CalculusOutput = Extract<PortValue, { kind: 'calculusData' }>;
type NumericPoint = { x: number; y: number };
type MeanValuePoint = { x: number; value: number; slope: number; error: number };
type ConvergenceRow = {
  n: number; left: number; midpoint: number; trapezoid: number; simpson: number; reference: number;
  leftError: number; midpointError: number; trapezoidError: number; simpsonError: number;
};

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
  const stage = calculusPipelines[kind]?.stages.find((candidate) => candidate.id === stageId);
  assert.ok(stage, `${kind} 缺少环节 ${stageId}`);
  const defaults = Object.fromEntries((stage.controls ?? []).map((control) => [control.key, control.value]));
  return stage.run({ text: text ?? stage.text ?? '', params: { ...defaults, ...params }, upstream: [] });
}

function evaluateDocument(doc: CanvasDoc): Map<string, CalculusOutput> {
  const ctx = makeCtx(doc, new Map());
  const outputs = new Map<string, CalculusOutput>();
  for (const node of doc.nodes.filter((candidate) => candidate.type === 'calculusStage')) {
    const output = evalOutput(ctx, node.id);
    assert.ok(output?.kind === 'calculusData', `${node.payload} 未输出 calculusData`);
    assert.equal(output.error, undefined, `${node.payload} 求值失败`);
    const stageId = node.payload?.split('/')[1];
    assert.ok(stageId);
    outputs.set(stageId, output);
  }
  return outputs;
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

test('14 条高数管线均可构建、连线并输出有限数值帧', () => {
  assert.equal(Object.keys(calculusPipelines).length, 14);
  for (const [kind, definition] of Object.entries(calculusPipelines)) {
    assert.ok(definition.stages.length >= 4, `${kind} 环节数不足`);
    const doc = buildCalculusPipeline(kind, kind, '数值回归');
    assert.equal(doc.nodes.filter((node) => node.type === 'calculusStage').length, definition.stages.length);
    const expectedWires = definition.stages.reduce((sum, stage) => sum + (stage.inputs?.length ?? 0), 0);
    assert.equal(doc.wires.length, expectedWires, `${kind} 连线数不符`);
    const outputs = evaluateDocument(doc);
    assert.equal(outputs.size, definition.stages.length);
    for (const node of doc.nodes.filter((candidate) => candidate.type === 'calculusStage')) {
      const definitionAtNode = findCalculusStage(node);
      assert.ok(definitionAtNode, `${node.payload} 无法解析`);
      const output = outputs.get(definitionAtNode.stage.id);
      assert.ok(output, `${node.payload} 缺少输出`);
      assertFiniteFrames(output.result);
      assert.deepEqual(calculusPipelinePorts(node, 'out'), [{ id: 'out', label: '实验数据', kind: 'calculusData' }]);
      assert.equal(calculusPipelinePorts(node, 'in').length, definitionAtNode.stage.inputs?.length ?? 0);
    }
  }
});

test('高数注册器拒绝未知模块和错误类型，断线或非法表达式会返回明确错误', () => {
  const unknown: CanvasNode = { id: 'unknown', type: 'calculusStage', x: 0, y: 0, payload: 'missing/source', params: {} };
  const wrongType: CanvasNode = { ...unknown, type: 'textNote' };
  assert.equal(findCalculusStage(unknown), undefined);
  assert.equal(findCalculusStage(wrongType), undefined);
  assert.deepEqual(calculusPipelinePorts(unknown, 'in'), []);
  assert.deepEqual(calculusPipelinePorts(wrongType, 'out'), []);
  assert.equal(evaluateCalculusStage(unknown, () => null), null);
  assert.equal(evaluateCalculusStage(wrongType, () => null), null);
  assert.throws(() => buildCalculusPipeline('missing', '无效', ''), /未知学科管线/);

  const doc = buildCalculusPipeline('mean-value', '中值定理', '');
  const source = doc.nodes.find((node) => node.payload === 'mean-value/function-source');
  const tangent = doc.nodes.find((node) => node.payload === 'mean-value/tangent-search');
  assert.ok(source && tangent);
  const invalidDoc: CanvasDoc = {
    ...doc,
    nodes: doc.nodes.map((node) => node.id === source.id ? { ...node, text: 'x+' } : node),
  };
  const ctx = makeCtx(invalidDoc, new Map());
  const invalidSource = evalOutput(ctx, source.id);
  assert.ok(invalidSource?.kind === 'calculusData');
  assert.match(invalidSource.error ?? '', /函数表达式无效/);
  const invalidDownstream = evalOutput(ctx, tangent.id);
  assert.ok(invalidDownstream?.kind === 'calculusData');
  assert.match(invalidDownstream.error ?? '', /等待有效输入/);

  const disconnected = { ...doc, wires: doc.wires.filter((wire) => wire.to !== tangent.id) };
  const waiting = evalOutput(makeCtx(disconnected, new Map()), tangent.id);
  assert.ok(waiting?.kind === 'calculusData');
  assert.match(waiting.error ?? '', /等待有效输入/);
});

test('极限链验证 sin(x)/x 的可去间断、左右跳跃和 epsilon-delta 候选带', () => {
  const limit = runStage('limit-epsilon', 'two-sided-limit', 'sin(x)/x');
  const limitData = limit.data as unknown as { limitCandidate: number };
  approx(limitData.limitCandidate, 1, 1e-5, 'sin(x)/x 极限');
  const removable = runStage('limit-epsilon', 'continuity-check', 'sin(x)/x');
  assert.match(String(removable.data.classification), /可去间断/);
  const jump = runStage('limit-epsilon', 'continuity-check', 'abs(x)/x');
  assert.match(String(jump.data.classification), /跳跃间断/);
  const continuous = runStage('limit-epsilon', 'continuity-check', 'x^2');
  assert.match(String(continuous.data.classification), /连续性/);
  const band = runStage('limit-epsilon', 'epsilon-band', 'sin(x)/x', { epsilon: 0.1 });
  const bandData = band.data as unknown as { epsilonDelta: { level: number; delta: number } };
  approx(bandData.epsilonDelta.level, 1, 1e-5, '极限水平带');
  assert.ok(bandData.epsilonDelta.delta > 0 && bandData.epsilonDelta.delta < 1);
});

test('导数三联给出精确一二阶导、驻点分类与割线到切线的收敛', () => {
  const second = runStage('derivative-triptych', 'second-derivative', 'x^3-3*x', { x0: 0.5, lower: -2, upper: 2 });
  const secondData = second.data as unknown as { firstAt: number; secondAt: number };
  approx(secondData.firstAt, -2.25, 1e-12, "f'(0.5)");
  approx(secondData.secondAt, 3, 1e-12, "f''(0.5)");
  const critical = runStage('derivative-triptych', 'critical-points', 'x^3-3*x', { lower: -2, upper: 2 });
  const criticalData = critical.data as unknown as {
    criticalPoints: { x: number; second: number; type: string }[];
    inflectionPoints: number[];
  };
  assert.equal(criticalData.criticalPoints.length, 2);
  approx(criticalData.criticalPoints[0]?.x ?? 0, -1, 1e-7, '极大点');
  approx(criticalData.criticalPoints[1]?.x ?? 0, 1, 1e-7, '极小点');
  assert.match(criticalData.criticalPoints[0]?.type ?? '', /极大值/);
  assert.match(criticalData.criticalPoints[1]?.type ?? '', /极小值/);
  assert.ok(criticalData.inflectionPoints.some((x) => Math.abs(x) < 1e-7));
  const secant = runStage('derivative-triptych', 'first-derivative', 'x^3-3*x', { x0: 0.5, h: 0.5 });
  const last = secant.frames.length - 1;
  const finalH = numericRow(secant, 0, 0, last);
  approx(numericRow(secant, 0, 3, last), -2.25 + 1.5 * finalH + finalH ** 2, 1e-10, '三次函数前向割线闭式误差');
  approx(numericRow(secant, 0, 4, last), -2.25, 1e-12, '自动微分导数');
});

test('拉格朗日中值定理找到 x^2 在 [-1,2] 的唯一平行切点 xi=0.5', () => {
  const secant = runStage('mean-value', 'secant-line', 'x^2', { lower: -1, upper: 2 });
  approx(Number(secant.data.secantSlope), 1, 1e-12, '端点割线斜率');
  const tangent = runStage('mean-value', 'tangent-search', 'x^2', { lower: -1, upper: 2 });
  const data = tangent.data as unknown as { meanValuePoints: MeanValuePoint[]; secantSlope: number };
  assert.equal(data.meanValuePoints.length, 1);
  const point = data.meanValuePoints[0]!;
  approx(point.x, 0.5, 1e-8, '中值切点');
  approx(point.slope, data.secantSlope, 1e-8, '切线与割线平行');
  assert.ok(point.error < 1e-8);
  const comparison = runStage('mean-value', 'slope-comparison', 'x^2', { lower: -1, upper: 2 });
  assert.equal(metric(comparison, '切点数'), '1');
  assert.throws(() => runStage('mean-value', 'secant-line', 'x^2', { lower: 1, upper: 1 }), /端点必须不同/);
});

test('FTC 链复算 sin 在 [0,pi] 的面积为 2，并用差分验证 F\'(x)=f(x)', () => {
  const area = runStage('ftc-sweep', 'accumulated-area', 'sin(x)', { base: 0, upper: Math.PI });
  const samples = (area.data as unknown as { antiderivativeSamples: { x: number; integral: number }[] }).antiderivativeSamples;
  approx(samples.at(-1)?.integral ?? 0, 2, 1e-8, '累计面积（Simpson 离散误差界）');
  const summary = runStage('ftc-sweep', 'ftc-summary', 'sin(x)', { base: 0, upper: Math.PI });
  const data = summary.data as unknown as { referenceIntegral: number; midpointSlope: number; midpointValue: number };
  approx(data.referenceIntegral, 2, 1e-8, 'FTC 数值积分（Simpson 离散误差界）');
  approx(data.midpointValue, 1, 1e-12, '中点函数值');
  approx(data.midpointSlope, 1, 1e-6, '中点原函数斜率');
  const checks = runStage('ftc-sweep', 'ftc-slope-check', 'sin(x)', { base: 0, upper: Math.PI });
  const rows = (checks.data as unknown as { ftcChecks: { f: number; approximateSlope: number }[] }).ftcChecks;
  for (const row of rows.filter((_, index) => index % 10 === 0)) approx(row.approximateSlope, row.f, 1e-5, 'FTC 斜率复算');
});

test('数值积分竞赛呈现实测一阶、二阶与 Simpson 四阶收敛', () => {
  const convergence = runStage('integration-race', 'convergence-order', 'exp(x)', { lower: 0, upper: 1 });
  const rows = (convergence.data as unknown as { convergence: ConvergenceRow[] }).convergence;
  assert.deepEqual(rows.map((row) => row.n), [2, 4, 8, 16, 32, 64]);
  const coarse = rows[0]!;
  const fine = rows[1]!;
  const order = (before: number, after: number) => Math.log2(before / after);
  approx(order(coarse.leftError, fine.leftError), 1, 0.2, '左和收敛阶');
  approx(order(coarse.midpointError, fine.midpointError), 2, 0.2, '中点收敛阶');
  approx(order(coarse.trapezoidError, fine.trapezoidError), 2, 0.2, '梯形收敛阶');
  approx(order(coarse.simpsonError, fine.simpsonError), 4, 0.45, 'Simpson 收敛阶');
  assert.ok(fine.simpsonError < fine.leftError && fine.simpsonError < fine.trapezoidError);
  const polynomial = runStage('integration-race', 'integration-summary', 'x^2', { lower: 0, upper: 1 });
  const polynomialRows = (polynomial.data as unknown as { convergence: ConvergenceRow[] }).convergence;
  for (const row of polynomialRows) {
    approx(row.simpson, 1 / 3, 1e-12, 'Simpson 对二次函数精确');
    approx(row.reference, 1 / 3, 1e-12, '二次函数积分参考');
  }
});

test('Taylor 五阶系数逐项复算 exp(x)，部分和与截断误差一致', () => {
  const polynomial = runStage('taylor-error', 'taylor-polynomial', 'exp(x)', { center: 0, x: 1, degree: 5 });
  const coefficients = (polynomial.data as unknown as { coefficients: number[] }).coefficients;
  const expected = [1, 1, 1 / 2, 1 / 6, 1 / 24, 1 / 120];
  coefficients.forEach((coefficient, index) => approx(coefficient, expected[index]!, 1e-12, `Taylor 系数 ${index}`));
  const summary = runStage('taylor-error', 'taylor-coefficients', 'exp(x)', { center: 0, x: 1, degree: 5 });
  approx(Number(summary.data.exactAtX), Math.E, 1e-12);
  const last = summary.frames.length - 1;
  approx(numericRow(summary, 5, 3, last), 2.7166666666666663, 1e-12, '五阶部分和');
  approx(Math.abs(Number(summary.data.exactAtX) - numericRow(summary, 5, 3, last)), Math.E - 2.7166666666666663, 1e-12, '截断误差');
  const remainder = runStage('taylor-error', 'taylor-remainder', 'exp(x)', { center: 0, x: 1, degree: 5 });
  assert.ok(Number.parseFloat(metric(remainder, '求值点误差', last)) < 0.002);
});

test('Fourier 方波仅含奇次谐波并保留 Gibbs 过冲，三角波不伪造过冲', () => {
  const spectrumResult = runStage('fourier-gibbs', 'frequency-spectrum', undefined, { waveform: 0, harmonics: 9 });
  const spectrum = (spectrumResult.data as unknown as { spectrum: { harmonic: number; amplitude: number }[] }).spectrum;
  assert.deepEqual(spectrum.map((item) => item.harmonic), [1, 3, 5, 7, 9]);
  approx(spectrum[0]?.amplitude ?? 0, 4 / Math.PI, 1e-12, '方波基波振幅');
  const gibbs = runStage('fourier-gibbs', 'gibbs-error', undefined, { waveform: 0, harmonics: 9 });
  assert.ok(Number.parseFloat(metric(gibbs, 'Gibbs 过冲', 60)) > 0.05);
  const triangle = runStage('fourier-gibbs', 'gibbs-error', undefined, { waveform: 1, harmonics: 9 });
  assert.equal(metric(triangle, 'Gibbs 过冲', 60), '0');
  const sawtooth = runStage('fourier-gibbs', 'frequency-spectrum', undefined, { waveform: 2, harmonics: 6 });
  const sawSpectrum = (sawtooth.data as unknown as { spectrum: { harmonic: number }[] }).spectrum;
  assert.deepEqual(sawSpectrum.map((item) => item.harmonic), [1, 2, 3, 4, 5, 6]);
});

test('ODE 对照中 RK4 比同步长 Euler 更接近细步参考并复算指数解', () => {
  const source = runStage('ode-methods', 'ode-source', 'y', { x0: 0, y0: 1, step: 0.5, steps: 4 });
  approx(Number(source.data.initialSlope), 1, 1e-12);
  const solutions = runStage('ode-methods', 'euler-rk4', 'y', { x0: 0, y0: 1, step: 0.5, steps: 4 });
  const data = solutions.data as unknown as { euler: NumericPoint[]; rk4: NumericPoint[]; reference: NumericPoint[] };
  approx(data.euler.at(-1)?.y ?? 0, 1.5 ** 4, 1e-12, 'Euler 闭式轨迹');
  approx(data.reference.at(-1)?.y ?? 0, Math.exp(2), 2e-4, '细步 RK4 参考');
  const eulerError = Math.abs(data.euler.at(-1)!.y - data.reference.at(-1)!.y);
  const rk4Error = Math.abs(data.rk4.at(-1)!.y - data.reference.at(-1)!.y);
  assert.ok(rk4Error < eulerError / 20, `RK4 误差 ${rk4Error} 应显著小于 Euler ${eulerError}`);
  const errors = runStage('ode-methods', 'ode-error', 'y', { x0: 0, y0: 1, step: 0.5, steps: 4 });
  const errorData = errors.data as unknown as { eulerErrors: number[]; rk4Errors: number[] };
  approx(errorData.eulerErrors.at(-1)!, eulerError, 1e-12);
  approx(errorData.rk4Errors.at(-1)!, rk4Error, 1e-12);
  assert.throws(() => runStage('ode-methods', 'ode-source', 'x+'), /微分方程表达式无效/);
});

test('梯度、方向导数和方向扫描满足点积与最大最小值关系', () => {
  const text = 'x^2+x*y+y^2';
  const params = { x0: 1, y0: 0.5, theta: 30 };
  const gradient = runStage('gradient-direction', 'gradient', text, params);
  approx(gradient.data.parameters.gradientFx ?? 0, 2.5, 1e-8, 'fx');
  approx(gradient.data.parameters.gradientFy ?? 0, 2, 1e-8, 'fy');
  approx(gradient.data.parameters.gradientNorm ?? 0, Math.hypot(2.5, 2), 1e-8, '梯度模');
  const direction = runStage('gradient-direction', 'direction', text, params);
  approx(direction.data.parameters.directionDerivative ?? 0, 2.5 * Math.cos(Math.PI / 6) + 2 * Math.sin(Math.PI / 6), 1e-8, '方向导数');
  const scan = runStage('gradient-direction', 'scan', text, params);
  const norm = Math.hypot(2.5, 2);
  const sampledBound = norm * Math.cos(2.5 * Math.PI / 180);
  const maximum = scan.data.parameters.maxDirectionDerivative ?? 0;
  const minimum = scan.data.parameters.minDirectionDerivative ?? 0;
  assert.ok(maximum <= norm + 1e-8 && maximum >= sampledBound - 1e-8, `5° 扫描最大值 ${maximum} 应位于 [${sampledBound}, ${norm}]`);
  assert.ok(minimum >= -norm - 1e-8 && minimum <= -sampledBound + 1e-8, `5° 扫描最小值 ${minimum} 应位于 [${-norm}, ${-sampledBound}]`);
});

test('拉格朗日乘数链收敛到单位圆正象限驻点并独立复算 KKT 残差', () => {
  const text = 'x*y;x^2+y^2-1';
  const params = { x0: 0.8, y0: 0.6, lambda0: 0.5 };
  const solved = runStage('lagrange-multiplier', 'newton', text, params);
  approx(solved.data.parameters.solutionX ?? 0, 1 / Math.sqrt(2), 1e-7, 'x*');
  approx(solved.data.parameters.solutionY ?? 0, 1 / Math.sqrt(2), 1e-7, 'y*');
  approx(solved.data.parameters.lagrangeLambda ?? 0, 0.5, 1e-7, 'lambda*');
  assert.ok((solved.data.parameters.lagrangeResidual ?? 1) < 1e-8);
  const stationary = runStage('lagrange-multiplier', 'stationary', text, params);
  approx(stationary.data.parameters.objectiveValue ?? 0, 0.5, 1e-7, '目标函数值');
  const verified = runStage('lagrange-multiplier', 'verify', text, params);
  assert.ok((verified.data.parameters.kktResidual ?? 1) < 1e-7);
  assert.throws(() => runStage('lagrange-multiplier', 'functions', 'x*y'), /分号分隔/);
});

test('极坐标雅可比积分真实响应半径上限，Green 环量与旋度面积分一致', () => {
  const text = 'x^2+y^2;-y;x';
  const params = { theta0: 0, theta1: 2 * Math.PI, radius: 2, n: 32 };
  const polar = runStage('double-green', 'polar', text, params);
  approx(polar.data.parameters.doubleIntegral ?? 0, 8 * Math.PI, 0.02, '圆盘二重积分（中点和误差界）');
  const refinedError = Math.abs((polar.data.parameters.refinedDoubleIntegral ?? 0) - 8 * Math.PI);
  const coarseError = Math.abs((polar.data.parameters.doubleIntegral ?? 0) - 8 * Math.PI);
  assert.ok(refinedError < coarseError, `细化误差 ${refinedError} 应小于粗网格误差 ${coarseError}`);
  const green = runStage('double-green', 'green', text, { ...params, circulation: 8 * Math.PI });
  approx(green.data.parameters.doubleIntegral ?? 0, 8 * Math.PI, 0.02, 'Green 中的面积分');
  approx(green.data.parameters.curlIntegral ?? 0, 8 * Math.PI, 0.02, '旋度面积分');
  approx(green.data.parameters.greenResidual ?? 1, 0, 0.02, 'Green 残差');
  const smaller = runStage('double-green', 'polar', text, { ...params, radius: 1 });
  approx(smaller.data.parameters.doubleIntegral ?? 0, Math.PI / 2, 0.002, '半径减半后积分');
  approx(
    (polar.data.parameters.doubleIntegral ?? 0) / (smaller.data.parameters.doubleIntegral ?? 1),
    16,
    0.01,
    '积分随 R^4 缩放',
  );
  assert.throws(() => runStage('double-green', 'polar', text, { ...params, theta0: 1, theta1: 0 }), /极角区间/);
});

test('基变换坐标满足 B[v]B=v，奇异基与复特征方向均被明确拒绝', () => {
  const text = '1,1;0,1 | 2,1';
  const coordinates = runStage('basis-change', 'coordinates', text);
  approx(coordinates.data.parameters.basisU ?? 0, 1, 1e-12, 'B 坐标第一分量');
  approx(coordinates.data.parameters.basisV ?? 0, 1, 1e-12, 'B 坐标第二分量');
  const reconstructed = runStage('basis-change', 'reconstruct', text, { steps: 8 });
  approx(reconstructed.data.parameters.reconstructedX ?? 0, 2, 1e-12);
  approx(reconstructed.data.parameters.reconstructedY ?? 0, 1, 1e-12);
  approx(reconstructed.data.parameters.reconstructionError ?? 1, 0, 1e-12);
  assert.equal(reconstructed.frames.length, 9);
  assert.throws(() => runStage('basis-change', 'basis', '1,2;2,4 | 1,1'), /不能构成基/);

  const spectrum = runStage('eigen-transform', 'spectrum', '2,1;1,2 | 1,0');
  approx(spectrum.data.parameters.lambda1 ?? 0, 3, 1e-12);
  approx(spectrum.data.parameters.lambda2 ?? 0, 1, 1e-12);
  const directions = runStage('eigen-transform', 'directions', '2,1;1,2 | 1,0');
  assert.equal(directions.data.parameters.eigenDirectionCount, 2);
  assert.ok((directions.data.parameters.eigenResidual1 ?? 1) < 1e-10);
  const transformed = runStage('eigen-transform', 'transform', '2,1;1,2 | 1,0', { steps: 2 });
  approx(transformed.data.parameters.transformedX ?? 0, 5, 1e-12);
  approx(transformed.data.parameters.transformedY ?? 0, 4, 1e-12);
  assert.throws(() => runStage('eigen-transform', 'directions', '0,-1;1,0 | 1,0'), /无实特征向量/);
});

test('SVD 完整重构误差接近零，rank 1 误差等于 sigma2，rank 2 恢复原矩阵', () => {
  const text = '4,0;3,-2';
  const rankOne = runStage('svd-steps', 'low-rank', text, { rank: 1 });
  const sigma2 = rankOne.data.parameters.sigma2 ?? -1;
  assert.ok(sigma2 > 0);
  approx(rankOne.data.parameters.reconstructionError ?? 1, 0, 1e-8, 'UΣVᵀ 重构');
  approx(rankOne.data.parameters.lowRankError ?? 0, sigma2, 1e-8, 'rank 1 理论误差');
  const rankTwo = runStage('svd-steps', 'low-rank', text, { rank: 2 });
  approx(rankTwo.data.parameters.lowRankError ?? 1, 0, 1e-8, 'rank 2 重构');
  assert.equal(rankTwo.frames.length, 3);
  const rankOneMatrix = runStage('svd-steps', 'matrix', '1,2;2,4', { rank: 1 });
  approx(rankOneMatrix.data.parameters.sigma2 ?? 1, 0, 1e-12, '秩一矩阵 sigma2');
  approx(rankOneMatrix.data.parameters.lowRankError ?? 1, 0, 1e-8, '秩一矩阵近似');
  const zero = runStage('svd-steps', 'matrix', '0,0;0,0', { rank: 1 });
  approx(zero.data.parameters.sigma1 ?? 1, 0, 1e-12);
  approx(zero.data.parameters.reconstructionError ?? 1, 0, 1e-12);
});
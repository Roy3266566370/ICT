import assert from 'node:assert/strict';
import test from 'node:test';
import surfaceParams from './surfaceParams.json' with {type: 'json'};
import {
  CURVE_HEIGHT_OFFSET,
  CURVE_SAMPLE_COUNT,
  OBSERVATION_PATH_PERIOD_SECONDS,
  REFERENCE_S,
  SURFACE_PHASE_PERIOD_SECONDS,
  SURFACE_X_RANGE,
  SURFACE_Y_RANGE,
  evaluateSurface,
  movingObservationS,
  surfaceNormal,
  phaseAt,
  pointOnSurfacePath,
  projectToScreen,
  sampleSurfaceGrid,
} from './surfaceMath.ts';

/** 契约要求的三个采样相位：0、π/3、2π。 */
const SAMPLE_PHASES: readonly number[] = [0, Math.PI / 3, Math.PI * 2];

test('常量与 surfaceParams.json 逐项一致，避免两处数值漂移', () => {
  assert.equal(SURFACE_PHASE_PERIOD_SECONDS, 24);
  assert.equal(SURFACE_PHASE_PERIOD_SECONDS, surfaceParams.surfacePhasePeriodSeconds);
  assert.equal(OBSERVATION_PATH_PERIOD_SECONDS, 18);
  assert.equal(OBSERVATION_PATH_PERIOD_SECONDS, surfaceParams.observationPathPeriodSeconds);
  assert.equal(CURVE_HEIGHT_OFFSET, 0.018);
  assert.equal(CURVE_HEIGHT_OFFSET, surfaceParams.curveHeightOffset);
  assert.equal(CURVE_SAMPLE_COUNT, 129);
  assert.equal(CURVE_SAMPLE_COUNT, surfaceParams.curveSampleCount);
  assert.deepEqual([...REFERENCE_S], [0.12, 0.88]);
  assert.deepEqual([...REFERENCE_S], [
    surfaceParams.observationMindS,
    surfaceParams.observationMaxS,
  ]);
  assert.deepEqual([...SURFACE_X_RANGE], [-3, 3]);
  assert.deepEqual([...SURFACE_Y_RANGE], [-1.7, 1.7]);
});

test('相位按 24 秒一轮线性增长', () => {
  assert.equal(phaseAt(0), 0);
  assert.ok(Math.abs(phaseAt(24) - Math.PI * 2) <= 1e-12);
  assert.ok(Math.abs(phaseAt(6) - Math.PI / 2) <= 1e-12);
  assert.ok(Math.abs(phaseAt(12) - Math.PI) <= 1e-12);
  assert.ok(Math.abs(phaseAt(18) - Math.PI * 1.5) <= 1e-12);
});

test('相位 0 波包尚未出现，曲面等于二次基准', () => {
  assert.equal(evaluateSurface(0, 0, 0), 0);
  assert.ok(Math.abs(evaluateSurface(1, 0, 0) - 0.23) <= 1e-12);
  assert.ok(Math.abs(evaluateSurface(0, 1, 0) - -0.11) <= 1e-12);
  assert.ok(Math.abs(evaluateSurface(-1, 0, 0) - 0.23) <= 1e-12);
});

test('行波脉冲在中段出现，其余时间近乎静止', () => {
  const pulse = evaluateSurface(0, 0, phaseAt(3)) - evaluateSurface(0, 0, phaseAt(15));
  assert.ok(Math.abs(pulse) > 0.01, `中线波包差值 ${pulse}`);
  assert.ok(Math.abs(evaluateSurface(0, 0, phaseAt(15))) <= 1e-12, '静止段应回到二次曲面');
});

test('解析法线是单位向量，原点法线朝上', () => {
  const origin = surfaceNormal(0, 0, 0);
  assert.deepEqual(origin, {x: -0, y: 0, z: 1});
  const titled = surfaceNormal(1, 0.5, phaseAt(3));
  assert.ok(Math.abs(Math.hypot(titled.x, titled.y, titled.z) - 1) <= 1e-12);
  assert.ok(titled.z > 0);
});

test('129 个轨迹点在 3 个相位上均满足 z − f(x,y,φ) = 0.018（误差 ≤ 1e-6）', () => {
  for (const phase of SAMPLE_PHASES) {
    for (let index = 0; index < CURVE_SAMPLE_COUNT; index += 1) {
      const s = index / (CURVE_SAMPLE_COUNT - 1);
      const point = pointOnSurfacePath(s, phase);
      const gap = point.z - evaluateSurface(point.x, point.y, phase) - CURVE_HEIGHT_OFFSET;
      assert.ok(
        Math.abs(gap) <= 1e-6,
        `相位 ${phase}、第 ${index} 个采样点的差值 ${gap} 超出 1e-6`,
      );
    }
  }
});

test('轨迹 x/y 严格按 s 参数化，且 s 被夹到 [0,1]', () => {
  const phase = Math.PI / 5;
  for (const s of [0, 0.25, 0.5, 0.75, 1]) {
    const point = pointOnSurfacePath(s, phase);
    assert.ok(Math.abs(point.x - (-2.6 + 5.2 * s)) <= 1e-12, `s=${s} 时 x 偏移`);
    assert.ok(Math.abs(point.y - 0.3 * Math.sin(Math.PI * s)) <= 1e-12, `s=${s} 时 y 偏移`);
  }
  assert.deepEqual(pointOnSurfacePath(-1, phase), pointOnSurfacePath(0, phase));
  assert.deepEqual(pointOnSurfacePath(2, phase), pointOnSurfacePath(1, phase));
});

test('轨迹在 s=0.5 附近连续：相邻步长距离 > 0 且 < 1e-2', () => {
  const phase = Math.PI / 3;
  const below = pointOnSurfacePath(0.499, phase);
  const center = pointOnSurfacePath(0.5, phase);
  const above = pointOnSurfacePath(0.501, phase);
  const distanceBelow = Math.hypot(below.x - center.x, below.y - center.y, below.z - center.z);
  const distanceAbove = Math.hypot(above.x - center.x, above.y - center.y, above.z - center.z);
  assert.ok(distanceBelow > 0 && distanceBelow < 1e-2, `下侧距离 ${distanceBelow}`);
  assert.ok(distanceAbove > 0 && distanceAbove < 1e-2, `上侧距离 ${distanceAbove}`);
  assert.ok(Math.abs(distanceAbove - distanceBelow) < 1e-2, '两侧步长应基本对称');
});

test('采样点全部为有限数，NaN/Infinity 输入返回 NaN 而不抛异常', () => {
  for (const phase of SAMPLE_PHASES) {
    for (let index = 0; index < CURVE_SAMPLE_COUNT; index += 1) {
      const point = pointOnSurfacePath(index / (CURVE_SAMPLE_COUNT - 1), phase);
      assert.ok(Number.isFinite(point.x), `相位 ${phase}、第 ${index} 点的 x 非有限`);
      assert.ok(Number.isFinite(point.y), `相位 ${phase}、第 ${index} 点的 y 非有限`);
      assert.ok(Number.isFinite(point.z), `相位 ${phase}、第 ${index} 点的 z 非有限`);
      const projected = projectToScreen(point);
      assert.ok(Number.isFinite(projected.x) && Number.isFinite(projected.y));
    }
  }
  assert.ok(Number.isNaN(phaseAt(Number.NaN)));
  assert.ok(Number.isNaN(evaluateSurface(Number.NaN, 0, 0)));
  assert.ok(Number.isNaN(evaluateSurface(0, Number.POSITIVE_INFINITY, 0)));
  assert.ok(Number.isNaN(movingObservationS(Number.NaN)));
  const invalidPoint = pointOnSurfacePath(Number.NaN, 0);
  assert.ok(Number.isNaN(invalidPoint.x));
  assert.ok(Number.isNaN(invalidPoint.y));
  assert.ok(Number.isNaN(invalidPoint.z));
});

test('活动观察点在 t=0/9/18/27 取到 0.15/0.85/0.15/0.85', () => {
  assert.ok(Math.abs(movingObservationS(0) - 0.15) <= 1e-12, `t=0 → ${movingObservationS(0)}`);
  assert.ok(Math.abs(movingObservationS(9) - 0.85) <= 1e-12, `t=9 → ${movingObservationS(9)}`);
  assert.ok(Math.abs(movingObservationS(18) - 0.15) <= 1e-12, `t=18 → ${movingObservationS(18)}`);
  assert.ok(Math.abs(movingObservationS(27) - 0.85) <= 1e-12, `t=27 → ${movingObservationS(27)}`);
});

test('活动观察点始终落在 [0.15, 0.85] 且能取到两端', () => {
  let minS = Number.POSITIVE_INFINITY;
  let maxS = Number.NEGATIVE_INFINITY;
  for (let step = 0; step <= 3600; step += 1) {
    const activeTime = step * 0.01;
    const s = movingObservationS(activeTime);
    assert.ok(s >= 0.15 - 1e-12 && s <= 0.85 + 1e-12, `t=${activeTime} 时 s=${s} 越界`);
    minS = Math.min(minS, s);
    maxS = Math.max(maxS, s);
  }
  assert.ok(minS >= 0.15 - 1e-12 && minS <= 0.15001, `最小值 ${minS} 未贴近 0.15`);
  assert.ok(maxS <= 0.85 + 1e-12 && maxS >= 0.84999, `最大值 ${maxS} 未贴近 0.85`);
});

test('18 秒后观察点位置复原；activeTime 不增长时结果严格不变（暂停不累计）', () => {
  assert.ok(Math.abs(movingObservationS(18) - movingObservationS(0)) <= 1e-9);
  assert.ok(Math.abs(movingObservationS(18 + 4.25) - movingObservationS(4.25)) <= 1e-9);
  assert.equal(movingObservationS(7.5), movingObservationS(7.5));
  assert.equal(phaseAt(7.5), phaseAt(7.5));
  const first = pointOnSurfacePath(0.4, phaseAt(7.5));
  const second = pointOnSurfacePath(0.4, phaseAt(7.5));
  assert.deepEqual(first, second);
});

test('活动观察点在折返端点附近平滑减速（相邻差值单调递减且 < 1e-2）', () => {
  const stepToPeak = Math.abs(movingObservationS(8.925) - movingObservationS(8.85));
  const stepBeyondPeak = Math.abs(movingObservationS(9) - movingObservationS(8.925));
  assert.ok(stepToPeak > 0 && stepToPeak < 1e-2, `接近端点步长 ${stepToPeak}`);
  assert.ok(stepBeyondPeak > 0 && stepBeyondPeak < 1e-2, `越过端点步长 ${stepBeyondPeak}`);
  assert.ok(stepBeyondPeak < stepToPeak, '越靠近端点，单步变化应更小');
});

test('曲面 24s 与观察点 18s 组合在 72 秒后等价复原', () => {
  assert.ok(Math.abs(phaseAt(72) - phaseAt(0) - 6 * Math.PI) <= 1e-9);
  assert.ok(Math.abs(movingObservationS(72) - movingObservationS(0)) <= 1e-9);
  for (const anchor of [
    {x: 0, y: 0},
    {x: 1.5, y: -1.2},
    {x: -2.6, y: 0.3},
  ]) {
    const atStart = evaluateSurface(anchor.x, anchor.y, phaseAt(0));
    const afterCycle = evaluateSurface(anchor.x, anchor.y, phaseAt(72));
    assert.ok(Math.abs(afterCycle - atStart) <= 1e-9, `锚点 ${anchor.x},${anchor.y} 未复原`);
  }
  const pathStart = pointOnSurfacePath(0.5, phaseAt(0)).z;
  const pathAfterCycle = pointOnSurfacePath(0.5, phaseAt(72)).z;
  assert.ok(Math.abs(pathAfterCycle - pathStart) <= 1e-9, '轨迹高度未复原');
});

test('行波脉冲经过曲面中心时高度发生变化', () => {
  const zAtZero = evaluateSurface(0, 0, 0);
  const zAtPulse = evaluateSurface(0, 0, phaseAt(3));
  assert.ok(Math.abs(zAtPulse - zAtZero) > 0.01, '曲面中心高度未随波包变化');
});

test('网格分段数按质量档位取值', () => {
  assert.deepEqual(sampleSurfaceGrid('standard'), {columns: 64, rows: 48});
  assert.deepEqual(sampleSurfaceGrid('low'), {columns: 40, rows: 30});
});

test('等距投影把世界原点映射到屏幕中心，且方向符合等距约定', () => {
  assert.deepEqual(projectToScreen({x: 0, y: 0, z: 0}), {x: 0, y: 0});
  assert.ok(Math.abs(projectToScreen({x: 0, y: 0, z: 2.15}).y - 2.15 / 4.6) <= 1e-12);
  assert.ok(projectToScreen({x: 0, y: 0, z: 1}).y > projectToScreen({x: 0, y: 0, z: 0}).y);
  assert.ok(projectToScreen({x: 1, y: 0, z: 0}).x > 0);
  assert.ok(projectToScreen({x: 0, y: 1, z: 0}).x < 0);
});

test('曲面网格与轨迹的所有采样点投影后都落在 [-1,1] 内', () => {
  const grid = sampleSurfaceGrid('standard');
  const [xMin, xMax] = SURFACE_X_RANGE;
  const [yMin, yMax] = SURFACE_Y_RANGE;
  for (let column = 0; column <= grid.columns; column += 1) {
    for (let row = 0; row <= grid.rows; row += 1) {
      const x = xMin + ((xMax - xMin) * column) / grid.columns;
      const y = yMin + ((yMax - yMin) * row) / grid.rows;
      const projected = projectToScreen({x, y, z: evaluateSurface(x, y, 0)});
      assert.ok(projected.x >= -1 && projected.x <= 1, `网格点 x 投影越界：${projected.x}`);
      assert.ok(projected.y >= -1 && projected.y <= 1, `网格点 y 投影越界：${projected.y}`);
    }
  }
  for (let index = 0; index < CURVE_SAMPLE_COUNT; index += 1) {
    const point = pointOnSurfacePath(index / (CURVE_SAMPLE_COUNT - 1), Math.PI / 2);
    const projected = projectToScreen(point);
    assert.ok(projected.x >= -1 && projected.x <= 1, `轨迹点 x 投影越界：${projected.x}`);
    assert.ok(projected.y >= -1 && projected.y <= 1, `轨迹点 y 投影越界：${projected.y}`);
  }
});
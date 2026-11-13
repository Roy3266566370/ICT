import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FORM_FOCUS_RESUME_DELAY_MS,
  POINTER_TILT_LIMIT_DEG,
  STUTTER_LOW_P95_MS,
  STUTTER_STATIC_P95_MS,
  STUTTER_WINDOW_SECONDS,
  canAnimate,
  dampingFactor,
  nextQualityOnStutter,
  normalizePointer,
  shouldDecayPointer,
  shouldLoad3D,
} from './motionPolicy.ts';
import type {MotionGateState} from './motionPolicy.ts';

/** 全部条件都满足的基线状态。 */
function baseState(): MotionGateState {
  return {
    ready: true,
    pageVisible: true,
    inView: true,
    dynamicAllowed: true,
    reducedMotion: false,
    userPaused: false,
    formFocused: false,
    submitting: false,
    contextLost: false,
  };
}

/** 9 个条件各自的阻断取值：前 4 个置 false，后 5 个置 true。 */
const BLOCKING_OVERRIDES: ReadonlyArray<[keyof MotionGateState, boolean]> = [
  ['ready', false],
  ['pageVisible', false],
  ['inView', false],
  ['dynamicAllowed', false],
  ['reducedMotion', true],
  ['userPaused', true],
  ['formFocused', true],
  ['submitting', true],
  ['contextLost', true],
];

test('时间与视差常量取契约规定的数值', () => {
  assert.equal(FORM_FOCUS_RESUME_DELAY_MS, 700);
  assert.equal(POINTER_TILT_LIMIT_DEG.zAxis, 2.5);
  assert.equal(POINTER_TILT_LIMIT_DEG.xAxis, 1.5);
  assert.equal(STUTTER_WINDOW_SECONDS, 5);
  assert.equal(STUTTER_LOW_P95_MS, 50);
  assert.equal(STUTTER_STATIC_P95_MS, 80);
});

test('canAnimate：9 个条件全部为真时才允许播放', () => {
  assert.equal(canAnimate(baseState()), true);
});

test('canAnimate：9 个条件逐一阻断都返回 false', () => {
  for (const [field, value] of BLOCKING_OVERRIDES) {
    const state = baseState();
    state[field] = value;
    assert.equal(canAnimate(state), false, `${field}=${value} 时应停止播放`);
  }
});

test('canAnimate：减少动效、手动暂停、表单聚焦与提交中同时存在时返回 false', () => {
  const state = baseState();
  state.reducedMotion = true;
  state.userPaused = true;
  state.formFocused = true;
  state.submitting = true;
  assert.equal(canAnimate(state), false);
});

test('canAnimate：手动暂停不会被失焦、重新可见或重新入视口解除', () => {
  const state = baseState();
  state.userPaused = true;
  assert.equal(canAnimate(state), false);

  state.formFocused = false;
  state.pageVisible = true;
  assert.equal(canAnimate(state), false);

  state.inView = true;
  state.ready = true;
  state.contextLost = false;
  assert.equal(canAnimate(state), false);
});

test("canAnimate：系统未要求减少动效但用户手动暂停时仍为 false", () => {
  const state = baseState();
  state.reducedMotion = false;
  state.userPaused = true;
  assert.equal(canAnimate(state), false);
});

test('shouldLoad3D：ready=false 时仍可为 true（无加载/就绪死锁）', () => {
  const state = baseState();
  state.ready = false;
  assert.equal(shouldLoad3D(state), true);
});

test('shouldLoad3D：用户手动暂停不阻止首次加载', () => {
  const state = baseState();
  state.userPaused = true;
  assert.equal(shouldLoad3D(state), true);
});

test('shouldLoad3D：7 个阻断条件逐一取反都返回 false', () => {
  const overrides: ReadonlyArray<[keyof MotionGateState, boolean]> = [
    ['dynamicAllowed', false],
    ['reducedMotion', true],
    ['pageVisible', false],
    ['inView', false],
    ['formFocused', true],
    ['submitting', true],
    ['contextLost', true],
  ];
  for (const [field, value] of overrides) {
    const state = baseState();
    state[field] = value;
    assert.equal(shouldLoad3D(state), false, `${field}=${value} 时不应加载三维模块`);
  }
});

test('shouldLoad3D：基线状态返回 true', () => {
  assert.equal(shouldLoad3D(baseState()), true);
});

test('nextQualityOnStutter：卡顿窗口不足 5 秒时不判定', () => {
  assert.equal(nextQualityOnStutter('standard', 40, 4.999), null);
  assert.equal(nextQualityOnStutter('standard', 90, 0), null);
  assert.equal(nextQualityOnStutter('standard', 90, Number.NaN), null);
});

test('nextQualityOnStutter：5 秒窗口边界正好开始判定', () => {
  assert.equal(nextQualityOnStutter('standard', 40, 5), null);
  assert.equal(nextQualityOnStutter('standard', 60, 5), 'low');
});

test('nextQualityOnStutter：50ms 与 80ms 边界的严格大于语义', () => {
  assert.equal(nextQualityOnStutter('standard', 50, 5), null);
  assert.equal(nextQualityOnStutter('standard', 50.001, 5), 'low');
  assert.equal(nextQualityOnStutter('standard', 60, 5), 'low');
  assert.equal(nextQualityOnStutter('standard', 80, 5), 'low');
  assert.equal(nextQualityOnStutter('standard', 80.001, 5), 'static');
  assert.equal(nextQualityOnStutter('standard', 120, 12), 'static');
});

test('nextQualityOnStutter：已达 static 后恒为 null，不可回升', () => {
  assert.equal(nextQualityOnStutter('static', 999, 60), null);
  assert.equal(nextQualityOnStutter('static', 10, 60), null);
  assert.equal(nextQualityOnStutter('static', 0, 60), null);
});

test('nextQualityOnStutter：low 档仍可继续降到 static', () => {
  assert.equal(nextQualityOnStutter('low', 55, 30), 'low');
  assert.equal(nextQualityOnStutter('low', 90, 30), 'static');
});

test('dampingFactor：非正输入返回 0', () => {
  assert.equal(dampingFactor(0), 0);
  assert.equal(dampingFactor(-0.5), 0);
  assert.equal(dampingFactor(Number.NaN), 0);
});

test('dampingFactor：单步 dt 截断到 0.05 秒后再计算', () => {
  assert.ok(Math.abs(dampingFactor(0.05) - 0.3296799539643607) <= 1e-12);
  assert.equal(dampingFactor(0.1), dampingFactor(0.05));
  assert.equal(dampingFactor(1), dampingFactor(0.05));
  assert.equal(dampingFactor(0.05), dampingFactor(0.05));
  assert.ok(dampingFactor(0.05) < 0.34);
});

test('dampingFactor：未截断区间按 1 − exp(−8·dt) 计算', () => {
  assert.ok(Math.abs(dampingFactor(0.01) - (1 - Math.exp(-0.08))) <= 1e-12);
  assert.ok(Math.abs(dampingFactor(0.02) - (1 - Math.exp(-0.16))) <= 1e-12);
  assert.ok(Math.abs(dampingFactor(0.01) - 0.07688365361336424) <= 1e-12);
});

test('normalizePointer：四角与中心映射到 [-1,1] 的具体坐标', () => {
  assert.deepEqual(normalizePointer(0, 0, 200, 100), {x: -1, y: 1});
  assert.deepEqual(normalizePointer(200, 0, 200, 100), {x: 1, y: 1});
  assert.deepEqual(normalizePointer(0, 100, 200, 100), {x: -1, y: -1});
  assert.deepEqual(normalizePointer(200, 100, 200, 100), {x: 1, y: -1});
  assert.deepEqual(normalizePointer(100, 50, 200, 100), {x: 0, y: 0});
});

test('normalizePointer：越界像素被夹到 [-1,1]', () => {
  assert.deepEqual(normalizePointer(400, -100, 200, 100), {x: 1, y: 1});
  assert.deepEqual(normalizePointer(-400, 300, 200, 100), {x: -1, y: -1});
  assert.deepEqual(normalizePointer(250, 75, 200, 100), {x: 1, y: -0.5});
});

test('normalizePointer：退化尺寸返回 null', () => {
  assert.equal(normalizePointer(10, 20, 0, 100), null);
  assert.equal(normalizePointer(10, 20, 200, 0), null);
  assert.equal(normalizePointer(10, 20, -200, 100), null);
  assert.equal(normalizePointer(10, 20, 200, -100), null);
  assert.equal(normalizePointer(10, 20, Number.NaN, 100), null);
  assert.equal(normalizePointer(10, 20, 200, Number.NaN), null);
});

test("shouldDecayPointer：只对精确悬停的 'mouse' 启用视差", () => {
  assert.equal(shouldDecayPointer('mouse'), true);
  assert.equal(shouldDecayPointer('pen'), false);
  assert.equal(shouldDecayPointer('touch'), false);
  assert.equal(shouldDecayPointer(''), false);
});
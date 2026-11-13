/**
 * 登录页三维场景的播放条件、加载条件与质量降级判定（契约 `C-MOTION@1`）。
 *
 * 约束：
 * - 不依赖 `three`、React、`window`/`document`/`IntersectionObserver`；
 *   页面可见性、视口状态、上下文丢失等均由组件采集后经 `MotionGateState` 传入；
 * - 页面与组件只通过本模块判定，不在 JSX 里另拼条件，避免出现两套真源。
 */

export interface MotionGateState {
  ready: boolean;
  pageVisible: boolean;
  inView: boolean;
  dynamicAllowed: boolean;
  reducedMotion: boolean;
  userPaused: boolean;
  formFocused: boolean;
  submitting: boolean;
  contextLost: boolean;
}

/** 已归一化到 `[-1,1]` 的指针坐标（`y` 轴向上）。 */
export interface MotionPoint {
  x: number;
  y: number;
}

export type QualityTier = 'standard' | 'low' | 'static';

/** 焦点离开表单后的恢复等待时间（毫秒）。 */
export const FORM_FOCUS_RESUME_DELAY_MS = 700;
/** 鼠标视差上限：绕 Z 轴 ±2.5°，绕 X 轴 ±1.5°。 */
export const POINTER_TILT_LIMIT_DEG = {zAxis: 2.5, xAxis: 1.5} as const;

/** 卡顿统计的最短窗口（秒）；不足该窗口不下调档位。 */
export const STUTTER_WINDOW_SECONDS = 5;
/** 超过该 p95 帧耗时（毫秒）降到 `'low'`。 */
export const STUTTER_LOW_P95_MS = 50;
/** 超过该 p95 帧耗时（毫秒）直接退到静态。 */
export const STUTTER_STATIC_P95_MS = 80;

/** 视差阻尼速率：`1 - exp(-8·dt)`。 */
const DAMPING_RATE = 8;
/** 单步 `dt` 上限（秒）：避免从后台恢复时画面跳变。 */
const MAX_DAMPING_DT_SECONDS = 0.05;

/** 把数值夹到 `[-1,1]`。 */
function clampToUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/** 9 个条件全部满足才允许连续渲染。 */
export function canAnimate(state: MotionGateState): boolean {
  return (
    state.ready &&
    state.pageVisible &&
    state.inView &&
    state.dynamicAllowed &&
    !state.reducedMotion &&
    !state.userPaused &&
    !state.formFocused &&
    !state.submitting &&
    !state.contextLost
  );
}

/**
 * 是否应加载三维模块。
 *
 * 与 `canAnimate` 分离且**不检查 `ready`**：首次加载时场景尚未就绪，
 * 若把 `ready` 纳入条件会出现「未就绪不能加载、未加载不能就绪」的死锁。
 * 用户手动暂停也不阻止首次加载（只影响连续播放）。
 */
export function shouldLoad3D(state: MotionGateState): boolean {
  return (
    state.dynamicAllowed &&
    !state.reducedMotion &&
    state.pageVisible &&
    state.inView &&
    !state.formFocused &&
    !state.submitting &&
    !state.contextLost
  );
}

/**
 * 依据卡顿统计给出下一档质量；`null` 表示保持当前档位。
 *
 * - 窗口不足 5 秒不判定（样本太少）；
 * - p95 > 80ms → `'static'`；p95 > 50ms → `'low'`；否则保持；
 * - 已处于 `'static'` 时恒为 `null`：降级单向、不可回升。
 */
export function nextQualityOnStutter(
  current: QualityTier,
  p95Ms: number,
  windowSeconds: number,
): QualityTier | null {
  if (current === 'static') return null;
  // 用取反比较同时挡住 NaN 与非正窗口。
  if (!(windowSeconds >= STUTTER_WINDOW_SECONDS)) return null;
  if (p95Ms > STUTTER_STATIC_P95_MS) return 'static';
  if (p95Ms > STUTTER_LOW_P95_MS) return 'low';
  return null;
}

/**
 * 基于时间的阻尼系数 `1 - exp(-8·dt)`。
 * `dt <= 0`（含 `NaN`）返回 0；`dt >= 0.05` 按 0.05 截断后再计算。
 */
export function dampingFactor(dtSeconds: number): number {
  if (!(dtSeconds > 0)) return 0;
  const clampedDt = Math.min(dtSeconds, MAX_DAMPING_DT_SECONDS);
  return 1 - Math.exp(-DAMPING_RATE * clampedDt);
}

/**
 * 把像素坐标归一化到 `[-1,1]`（`y` 轴向上）。
 * 容器宽或高为非正数（含 `NaN`）时返回 `null`，由调用方跳过视差。
 */
export function normalizePointer(
  px: number,
  py: number,
  width: number,
  height: number,
): MotionPoint | null {
  if (!(width > 0) || !(height > 0)) return null;
  return {
    x: clampToUnit((px / width) * 2 - 1),
    y: clampToUnit(1 - (py / height) * 2),
  };
}

/** 只对精确悬停指针（鼠标）启用视差；触屏与手写笔不启用。 */
export function shouldDecayPointer(pointerType: string): boolean {
  return pointerType === 'mouse';
}
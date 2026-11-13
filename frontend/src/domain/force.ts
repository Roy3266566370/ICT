/**
 * force.ts —— `force_2d` 的前端确定性派生实现（C-FC@1，plan §2.2.4）
 *
 * 角度约定（§2.3.6）：全部使用度（deg），0° 指向 x 轴正方向，逆时针为正。
 * 因此「10N 向东 + 10N 向北」的合力方向为 45°。
 *
 * 契约未提供参数通道的展示配置（P1 说明，勿误解为缺陷）：
 *  - magnitude_rounded / direction_rounded 按 display_precision 截断，
 *    magnitude_exact 按 compute_precision 截断，两者都只是展示格式化；
 *    内部 magnitude / direction_deg 始终是全精度 double，计算不截断。
 *  - 模板侧的「显示几位小数」开关是纯视图配置，不改写对象参数、不推进 revision。
 */
import type {
  Force2dResult,
  ForceComponent,
  ForceInput,
  KnowledgeObject,
  Parameter,
} from '@/api/types';
import { isForceInputList } from '@/api/types';
import { domainFail, domainOk, type DomainOutcome } from './matrix';
import { EPSILON, fixed, round } from './format';

/** 单力大小允许范围（N），§2.2.4 规则 5 */
export const FORCE_MIN = 0;
export const FORCE_MAX = 1000;
/** 力数量允许范围，§2.2.4 规则 5 / R7-AC6 */
export const FORCE_COUNT_MIN = 2;
export const FORCE_COUNT_MAX = 4;
/** 默认展示精度 / 计算精度说明位数 */
export const DEFAULT_DISPLAY_PRECISION = 2;
export const DEFAULT_COMPUTE_PRECISION = 6;

const CANCEL_NOTE = '合力为零，方向未定义';

const DECIMAL_PATTERN = /^[+-]?\d+(\.\d+)?$/;

/** 解析十进制字符串为有限数；非法格式返回 null。 */
function parseMagnitude(raw: string): number | null {
  const trimmed = raw.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** 度数转弧度。 */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * 按分量合成若干共点力。
 * 合力 < 1e-9 时 `cancel=true`、`direction_deg=null`，绝不输出 0° 或 NaN（R7-AC3）。
 */
export function computeForceResult(
  forces: readonly ForceInput[],
  displayPrecision = DEFAULT_DISPLAY_PRECISION,
  computePrecision = DEFAULT_COMPUTE_PRECISION,
): DomainOutcome<Force2dResult> {
  if (forces.length < FORCE_COUNT_MIN || forces.length > FORCE_COUNT_MAX) {
    return domainFail(
      `共点力数量为 ${forces.length}，需在 ${FORCE_COUNT_MIN} 至 ${FORCE_COUNT_MAX} 之间`,
    );
  }

  const components: ForceComponent[] = [];
  let fx = 0;
  let fy = 0;

  for (let index = 0; index < forces.length; index += 1) {
    const force = forces[index];
    if (force === undefined) continue;
    const magnitude = parseMagnitude(force.magnitude);
    if (magnitude === null) {
      return domainFail(`第 ${index + 1} 个力的大小 " ${force.magnitude} " 不是合法的十进制数`);
    }
    if (magnitude < FORCE_MIN - EPSILON || magnitude > FORCE_MAX + EPSILON) {
      return domainFail(
        `第 ${index + 1} 个力的大小 ${magnitude}N 超出允许范围 ${FORCE_MIN} ~ ${FORCE_MAX}N（力的大小越界）`,
      );
    }
    const angle = force.angle_deg;
    if (!Number.isFinite(angle)) {
      return domainFail(`第 ${index + 1} 个力的角度不是有限数`);
    }
    if (angle < 0 || angle >= 360) {
      return domainFail(`第 ${index + 1} 个力的角度 ${angle} 超出允许范围 [0, 360)（角度越界）`);
    }

    const fxComponent = round(magnitude * Math.cos(toRadians(angle)));
    const fyComponent = round(magnitude * Math.sin(toRadians(angle)));
    fx = round(fx + fxComponent);
    fy = round(fy + fyComponent);
    components.push({ magnitude: force.magnitude.trim(), angle_deg: angle, fx: fxComponent, fy: fyComponent });
  }

  const magnitude = Math.hypot(fx, fy);
  const cancel = magnitude < EPSILON;
  const directionDeg = cancel ? null : round(((Math.atan2(fy, fx) * 180) / Math.PI + 360) % 360);

  return domainOk({
    forces: components,
    fx,
    fy,
    magnitude,
    magnitude_rounded: fixed(magnitude, displayPrecision),
    magnitude_exact: fixed(magnitude, computePrecision),
    direction_deg: directionDeg,
    direction_rounded: directionDeg === null ? null : fixed(directionDeg, displayPrecision),
    direction_defined: !cancel,
    cancel,
    note: cancel
      ? CANCEL_NOTE
      : `合力按 ${computePrecision} 位精度计算，界面显示 ${displayPrecision} 位舍入值（两者含义不同）`,
    tolerance: EPSILON,
  });
}

/** 从 `KnowledgeObject` 派生 `force_2d` 结果；取第一个 `type="force_list"` 参数。 */
export function deriveForce2d(object: KnowledgeObject): DomainOutcome<Force2dResult> {
  const parameter: Parameter | null =
    object.parameters.find((item) => item.type === 'force_list') ?? null;
  if (parameter === null) {
    return domainFail('缺少力的参数（type="force_list"）');
  }
  if (!isForceInputList(parameter.value)) {
    return domainFail(
      `参数 ${parameter.name}（${parameter.id}）不是合法的力列表：需要 2 至 4 个 { magnitude: 十进制字符串, angle_deg: 度数 }`,
    );
  }

  const rawDisplay = object.config['display_precision'];
  const rawCompute = object.config['compute_precision'];
  const displayPrecision =
    typeof rawDisplay === 'number' && Number.isFinite(rawDisplay) && rawDisplay >= 0
      ? Math.min(8, Math.floor(rawDisplay))
      : DEFAULT_DISPLAY_PRECISION;
  const computePrecision =
    typeof rawCompute === 'number' && Number.isFinite(rawCompute) && rawCompute >= 0
      ? Math.min(12, Math.floor(rawCompute))
      : DEFAULT_COMPUTE_PRECISION;

  return computeForceResult(parameter.value, displayPrecision, computePrecision);
}

/** 模板初始两力（重置基线）：10N 向东、10N 向北。 */
export const FORCE_TEMPLATE_DEFAULTS: readonly ForceInput[] = [
  { magnitude: '10', angle_deg: 0 },
  { magnitude: '10', angle_deg: 90 },
] as const;
/* -------------------------------------------------------------------------- */
/* C-UI@1 P1 澄清的冻结签名（§2.2.11，T6 直接 import）                        */
/* -------------------------------------------------------------------------- */

/** 非法输入时的安全降级结果。 */
function emptyForceResult(): Force2dResult {
  return {
    forces: [],
    fx: 0,
    fy: 0,
    magnitude: 0,
    magnitude_rounded: fixed(0, DEFAULT_DISPLAY_PRECISION),
    magnitude_exact: fixed(0, DEFAULT_COMPUTE_PRECISION),
    direction_deg: null,
    direction_rounded: null,
    direction_defined: false,
    cancel: true,
    note: '输入不合法，无法计算合力',
    tolerance: EPSILON,
  };
}

/** `force_2d` 派生（签名冻结于 §2.2.11 P1 澄清）。 */
export function calcForce2d(object: KnowledgeObject): {
  result: Force2dResult;
  error: string | null;
} {
  const outcome = deriveForce2d(object);
  if (outcome.ok) return { result: outcome.result, error: null };
  return { result: emptyForceResult(), error: outcome.error };
}

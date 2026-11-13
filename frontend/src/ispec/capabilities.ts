/**
 * capabilities.ts —— 五类交互原语的能力注册表（P3-13 / rebuild-spec §5.4）。
 *
 * 这张表是"扩展只需加 iSpec"的产品化表达：
 *  - 运行时只认五类原语与四种视图，**不认具体知识点**；
 *  - 新增知识点 = 新增一份 iSpec，其 `kind` 落到下表某一类；
 *  - 界面只读展示"本材料支持的原语类型"，让能力边界可见、可解释。
 *
 * 本模块是纯数据 + 纯函数，不依赖 React / DOM，可在 SSR 自检中复用。
 */
import type { ISpec, PrimitiveKind } from './types';

/** 一类原语的能力描述。 */
export interface Capability {
  kind: PrimitiveKind;
  label: string;
  /** 该类原语可驱动的视图（模板名，`figure(...)` 内为 spec_ref）。 */
  views: string[];
}

/** 五类原语能力表（顺序即界面展示顺序）。 */
export const CAPABILITIES: Record<PrimitiveKind, Capability> = {
  parametric: {
    kind: 'parametric',
    label: '参数驱动',
    views: ['figure', 'text', 'table', 'vega'],
  },
  filter: {
    kind: 'filter',
    label: '数据筛选',
    views: ['vega', 'table', 'text'],
  },
  step: {
    kind: 'step',
    label: '步骤推进',
    views: ['figure(step_diagram)', 'text', 'table'],
  },
  geometric: {
    kind: 'geometric',
    label: '几何操作',
    views: [
      'figure(vectors|circle_ellipse|grid_transform|det_area|eigen_probe|basis_change|singular_compare|rank_map|inverse_map)',
      'text',
    ],
  },
  branch: {
    kind: 'branch',
    label: '分支选择',
    views: ['text(title 含选项名)', 'table(title 含选项名)', 'vega(title 含选项名)', 'figure(title 含选项名)'],
  },
};

/** 展示顺序：固定为 §5.4 的五类原语顺序。 */
export const CAPABILITY_ORDER: readonly PrimitiveKind[] = [
  'parametric',
  'filter',
  'step',
  'geometric',
  'branch',
];

export function capabilityFor(kind: PrimitiveKind): Capability {
  return CAPABILITIES[kind];
}

/** 一份 iSpec 覆盖的能力。 */
export function capabilitiesForSpec(spec: ISpec): Capability {
  return CAPABILITIES[spec.kind];
}

/** 材料内出现过的原语类型（去重、按固定顺序）。 */
export function capabilityKindsOf(specs: ISpec[]): PrimitiveKind[] {
  const present = new Set<PrimitiveKind>(specs.map((spec) => spec.kind));
  return CAPABILITY_ORDER.filter((kind) => present.has(kind));
}

/** 材料支持的原语能力列表（供详情面板只读展示）。 */
export function capabilitiesOf(specs: ISpec[]): Capability[] {
  return capabilityKindsOf(specs).map((kind) => CAPABILITIES[kind]);
}
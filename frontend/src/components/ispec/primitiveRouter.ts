/**
 * primitiveRouter.ts —— 五类交互原语的分流规则（P3-13 / rebuild-spec §5.4）。
 *
 * 目标：**同一个 `ISpecView`** 能渲染五类原语，新增知识点只填 iSpec。
 * 本模块只做"视图选择 + 步骤/分支语义"的纯计算，不产生 React 组件：
 *
 * | kind | 语义 | 本模块负责 |
 * |---|---|---|
 * | `parametric` | 参数驱动 | 全部视图可见（现有行为） |
 * | `filter` | 数据筛选 | 全部视图可见（现有行为） |
 * | `step` | 步骤推进 | `stage` 逐项显现，视图顺序即步骤顺序 |
 * | `geometric` | 几何操作 | 全部视图可见，figure 内手柄可拖动并回写参数 |
 * | `branch` | 分支选择 | 按 enum 参数当前选项筛选 `views` 子集 |
 *
 * `branch` 的约定（schema 冻结，**不新增 `when` 字段**）：
 *  - 视图 `title` 含选项名 → 该视图只在该选项下显示；
 *  - 视图无 `title` → 公共视图，所有分支都显示；
 *  - 若没有任何视图匹配当前选项，退回显示全部视图（避免空白页）。
 * 该约定同时写在 `components/ispec/README.md`。
 */
import type { ISpec, PrimitiveKind, SpecParameter, SpecView } from '../../ispec/types';

/** 原语中文名（宿主与能力注册表共用）。 */
export const PRIMITIVE_LABELS: Readonly<Record<PrimitiveKind, string>> = {
  parametric: '参数驱动',
  filter: '数据筛选',
  step: '步骤推进',
  geometric: '几何操作',
  branch: '分支选择',
};

/** 一个视图在分流后的状态。 */
export interface RoutedView {
  view: SpecView;
  /** 在 `spec.views` 里的原始下标（用于 key 与调试）。 */
  index: number;
  /** `step` 原语下的步骤序号（0-based）；其他原语为 -1。 */
  stepIndex: number;
  /** 当前是否应出现在 DOM 中。 */
  visible: boolean;
}

/** 分流结果（`ISpecView` 唯一消费的数据结构）。 */
export interface PrimitiveRoute {
  kind: PrimitiveKind;
  label: string;
  views: RoutedView[];
  /** 当前可见视图数。 */
  visibleCount: number;
  /** `step` 原语的总步数（= 视图数）；其他原语为 0。 */
  stepCount: number;
  /** `branch` 原语使用的分支参数；其他原语为 null。 */
  branchParameter: SpecParameter | null;
  /** 当前分支值；非 branch 或参数尚未取到时为 null。 */
  branchValue: string | null;
  /** figure 视图是否允许拖动手柄。 */
  draggable: boolean;
}

function clampStage(stage: number): 0 | 1 | 2 {
  if (stage <= 0) return 0;
  if (stage >= 2) return 2;
  return 1;
}

/** 找到第一个 enum 参数（branch 的分支开关）；没有则返回 null。 */
export function findBranchParameter(spec: ISpec): SpecParameter | null {
  return (
    spec.parameters.find(
      (parameter) => parameter.type === 'enum' && (parameter.options ?? []).length > 0,
    ) ?? null
  );
}

function branchMatches(view: SpecView, branchValue: string): boolean {
  const title = view.title;
  if (title === undefined || title.trim() === '') return true;
  return title.includes(branchValue);
}

/**
 * 按原语把 `spec.views` 分成"要渲染的视图 + 步骤/分支语义"。
 *
 * @param spec 已通过结构校验的 iSpec
 * @param values 当前参数值（branch 用它取选项）
 * @param stage 宿主播放进度（0/1/2；非 step 原语忽略）
 */
export function routeSpecViews(
  spec: ISpec,
  values: Record<string, number | boolean | string>,
  stage: number,
): PrimitiveRoute {
  const current = clampStage(stage);
  const branchParameter = spec.kind === 'branch' ? findBranchParameter(spec) : null;
  const rawBranchValue =
    branchParameter === null ? null : values[branchParameter.id];
  const branchValue =
    typeof rawBranchValue === 'string'
      ? rawBranchValue
      : branchParameter !== null && typeof branchParameter.default === 'string'
        ? branchParameter.default
        : null;

  const base: RoutedView[] = spec.views.map((view, index) => ({
    view,
    index,
    stepIndex: -1,
    visible: true,
  }));

  if (spec.kind === 'step') {
    const visibleCount = Math.min(spec.views.length, current + 1);
    const views = base.map((item) => ({
      ...item,
      stepIndex: item.index,
      visible: item.index < visibleCount,
    }));
    return {
      kind: spec.kind,
      label: PRIMITIVE_LABELS[spec.kind],
      views,
      visibleCount: views.filter((item) => item.visible).length,
      stepCount: spec.views.length,
      branchParameter: null,
      branchValue: null,
      draggable: false,
    };
  }

  if (spec.kind === 'branch' && branchValue !== null) {
    const matched = base.filter((item) => branchMatches(item.view, branchValue));
    // 没有任何视图匹配时退回全部视图，保证分支配置错误也不会白屏。
    const views =
      matched.length > 0
        ? base.map((item) => ({ ...item, visible: branchMatches(item.view, branchValue) }))
        : base;
    return {
      kind: spec.kind,
      label: PRIMITIVE_LABELS[spec.kind],
      views,
      visibleCount: views.filter((item) => item.visible).length,
      stepCount: 0,
      branchParameter,
      branchValue,
      draggable: false,
    };
  }

  return {
    kind: spec.kind,
    label: PRIMITIVE_LABELS[spec.kind],
    views: base,
    visibleCount: base.length,
    stepCount: 0,
    branchParameter,
    branchValue,
    draggable: spec.kind === 'geometric',
  };
}
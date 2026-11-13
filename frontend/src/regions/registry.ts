/**
 * `frontend/src/regions/registry.ts` —— **空注册表**（rebuild-spec §8 / P3-12）。
 *
 * v0.2 的五个手写区域组件（matrixEigen / matrixColumns / matrixOrder / svdSteps /
 * detArea）已整体移入 `src/legacy/regions/`，保留为**参考实现**，不再参与主链路。
 * 主链路唯一运行时是 `components/ispec/ISpecView` + `ispec/primitiveRouter`。
 *
 * 为什么保留本文件：`PageCanvas` / `WorkbenchPage` 仍按冻结契约
 * （`regions/types.ts`）读取历史材料，并用 `resolveRegionComponent` 判断"该图示
 * 是否还能动态渲染"。注册表为空意味着历史区域只会得到 `supported: false`，
 * 宿主据此保持原页阅读，不白屏、不盖白块。
 *
 * 新增能力请写 iSpec（`contracts/spec/ispec.schema.json`），**不要**在这里重新注册组件。
 */
import { createElement, type ReactElement } from 'react';
import type { RegionComponent, RegionStatus } from './types';

export interface UnsupportedRegionViewProps {
  scriptId: string;
  message?: string;
}

/** 历史区域组件注册表：归档后恒为空（主链路只走 iSpec）。 */
export const regionRegistry: Record<string, RegionComponent> = {};

/** 白名单：spec §4 声明的五个 script（保留给历史材料识别与详情展示）。 */
export const REGION_SCRIPT_IDS = [
  'matrix_eigen_2d',
  'matrix_columns_2d',
  'matrix_order_2d',
  'svd_steps_2d',
  'det_area_2d',
] as const;

export type RegionScriptId = (typeof REGION_SCRIPT_IDS)[number];

export function isRegionScriptId(value: string): value is RegionScriptId {
  return (REGION_SCRIPT_IDS as readonly string[]).includes(value);
}

export type RegionResolution =
  | { supported: true; component: RegionComponent; message: null }
  | { supported: false; code: 'UNSUPPORTED_REGION'; message: string };

/**
 * 解析历史区域组件。
 *
 * 归档后所有脚本都返回 `supported: false`：即使旧产物里还有 `confirmed` 区域，
 * 也不会重新启动 v0.2 内核；宿主必须改读 iSpec（`components/reader/specData.ts`）。
 */
export function resolveRegionComponent(
  scriptId: string,
  status?: RegionStatus,
): RegionResolution {
  if (status === 'static_only') {
    return {
      supported: false,
      code: 'UNSUPPORTED_REGION',
      message: '该区域与原页版式不可分离，保持原页静态阅读。',
    };
  }
  if (status === 'unsupported') {
    return {
      supported: false,
      code: 'UNSUPPORTED_REGION',
      message: '该区域已识别，但首版暂不支持交互，保留原页阅读。',
    };
  }
  const component = regionRegistry[scriptId];
  if (component === undefined) {
    return {
      supported: false,
      code: 'UNSUPPORTED_REGION',
      message: isRegionScriptId(scriptId)
        ? '该图示的 v0.2 内核已归档为参考实现；主链路请改用 iSpec 运行时。'
        : '该图示暂不支持交互（保留原页阅读）。',
    };
  }
  return { supported: true, component, message: null };
}

/**
 * 不支持时的展示：文字 + 图标符号双编码（不只靠颜色），不暴露堆栈与内部标识。
 */
export function UnsupportedRegionView(props: UnsupportedRegionViewProps): ReactElement {
  const { scriptId, message } = props;
  const text =
    message ??
    (isRegionScriptId(scriptId)
      ? '该图示的 v0.2 内核已归档为参考实现；主链路请改用 iSpec 运行时。'
      : '该图示暂不支持交互（保留原页阅读）。');
  return createElement(
    'p',
    { className: 'reader-inline-note', role: 'status', 'aria-live': 'polite' },
    createElement('span', { className: 'reader-inline-note__icon', 'aria-hidden': 'true' }, '⊙'),
    createElement('span', null, text),
  );
}
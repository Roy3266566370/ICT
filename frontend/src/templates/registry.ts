/**
 * registry.ts —— C-REG@1 的前端部分：模板自动发现 + 白名单校验
 *
 * 设计目标（§2.1.4）：T5/T6 只需新增 `src/templates/{name}/index.tsx` 并默认导出
 * `ComponentType<TemplateProps>`，**不需要修改本文件**。
 *
 * 白名单之外或尚未落地的模板返回 `UNSUPPORTED_TEMPLATE` 展示分支（R12-AC3），
 * 由 `UnsupportedTemplateView` 渲染，宿主只需 `if (!res.supported) return <.../>`。
 */
import { createElement, type ComponentType, type ReactElement } from 'react';
import type { TemplateDescriptor, TemplateId, TemplateProps } from '@/api/types';
import { TEMPLATE_IDS, isTemplateId } from '@/api/types';

/** 模板组件模块形状（默认导出组件）。 */
export type TemplateModule = { default: ComponentType<TemplateProps> };
export type TemplateLoader = () => Promise<TemplateModule>;

/** 模板 id → 目录名（目录结构见 §2.1.2） */
const TEMPLATE_DIRS: Record<TemplateId, string> = {
  matrix_2d: 'matrix',
  force_2d: 'force',
  bfs_flow: 'bfs',
  budget_compare: 'budget',
};

interface TemplateMeta {
  name: string;
  scenario_slug: string;
  kernel_version: string;
  validation_profile: string;
}

/** 模板元信息（与 mockClient 的 TEMPLATE_META 同值；仅用于本地展示与降级描述） */
const TEMPLATE_META: Record<TemplateId, TemplateMeta> = {
  matrix_2d: {
    name: '空间与矩阵',
    scenario_slug: 'matrix',
    kernel_version: 'linear_v1',
    validation_profile: 'matrix_2d_v1_full',
  },
  force_2d: {
    name: '力与向量',
    scenario_slug: 'force',
    kernel_version: 'force_v1',
    validation_profile: 'force_2d_v1_full',
  },
  bfs_flow: {
    name: '计算机过程',
    scenario_slug: 'bfs',
    kernel_version: 'bfs_v1',
    validation_profile: 'bfs_flow_v1_full',
  },
  budget_compare: {
    name: '办公推演',
    scenario_slug: 'budget',
    kernel_version: 'budget_v1',
    validation_profile: 'budget_compare_v1_full',
  },
};

/** `import.meta.glob` 的原始结果：key 为相对本文件的路径，如 `./matrix/index.tsx` */
const discoveredModules = import.meta.glob('./*/index.tsx') as unknown as Record<
  string,
  TemplateLoader
>;

/**
 * 以 **模板 id** 为 key 的加载映射（`templateLoaders['matrix_2d']`）。
 * T4 的宿主按 id 直接取 loader；未落地的模板不会出现在这里。
 */
export const templateLoaders: Record<string, TemplateLoader> = {};
for (const templateId of TEMPLATE_IDS) {
  const loader = discoveredModules[`./${TEMPLATE_DIRS[templateId]}/index.tsx`];
  if (loader !== undefined) templateLoaders[templateId] = loader;
}

export interface TemplateDefinition {
  template_id: TemplateId;
  name: string;
  scenario_slug: string;
  kernel_version: string;
  validation_profile: string;
  /** 组件加载器；模板目录尚未落地时为 null */
  loader: TemplateLoader | null;
}

/** 白名单模板注册表：`Record<string, TemplateDefinition>`，key 为 template_id。 */
export const templateRegistry: Record<string, TemplateDefinition> = {};
for (const templateId of TEMPLATE_IDS) {
  const meta = TEMPLATE_META[templateId];
  templateRegistry[templateId] = {
    template_id: templateId,
    name: meta.name,
    scenario_slug: meta.scenario_slug,
    kernel_version: meta.kernel_version,
    validation_profile: meta.validation_profile,
    loader: templateLoaders[templateId] ?? null,
  };
}

export type TemplateResolution =
  | { supported: true; definition: TemplateDefinition; message: null }
  | { supported: false; code: 'UNSUPPORTED_TEMPLATE'; message: string };

/** 是否在白名单内（类型守卫）。 */
export function isSupportedTemplate(templateId: string): templateId is TemplateId {
  return isTemplateId(templateId);
}

/**
 * 解析模板：未知 id 返回 `UNSUPPORTED_TEMPLATE` 展示分支（R12-AC3）。
 * 注意：白名单内但组件目录尚未落地（如 T5/T6 未完成）时 `supported: true`，
 * 由宿主根据 `definition.loader === null` 显示"模板暂不可用"，不阻断编译。
 */
export function resolveTemplate(templateId: string): TemplateResolution {
  if (!isSupportedTemplate(templateId)) {
    return {
      supported: false,
      code: 'UNSUPPORTED_TEMPLATE',
      message: `不支持该模板（template_id = ${templateId || '空'}）。已回退到原材料阅读。`,
    };
  }
  const definition = templateRegistry[templateId];
  if (definition === undefined) {
    // 理论上不可达：白名单与注册表由同一数组生成
    return {
      supported: false,
      code: 'UNSUPPORTED_TEMPLATE',
      message: `模板 ${templateId} 未注册。已回退到原材料阅读。`,
    };
  }
  return { supported: true, definition, message: null };
}

/** 由 TemplateDescriptor 取对应的本地元信息（用于示例大厅展示兜底）。 */
export function descriptorFallback(templateId: string): TemplateDescriptor | null {
  if (!isSupportedTemplate(templateId)) return null;
  const meta = TEMPLATE_META[templateId];
  return {
    template_id: templateId,
    name: meta.name,
    scenario_slug: meta.scenario_slug,
    kernel_version: meta.kernel_version,
    validation_profile: meta.validation_profile,
    example_id: `example_${templateId}`,
    limits: {},
    schema_path: `/api/v1/templates/${templateId}/schema`,
  };
}

export interface UnsupportedTemplateViewProps {
  templateId: string;
}

/**
 * 不支持的模板展示分支：文字 + 图标符号双编码（不只靠颜色），并满足 R12-AC5
 * （不暴露堆栈、不展示提示词）。
 */
export function UnsupportedTemplateView(
  props: UnsupportedTemplateViewProps,
): ReactElement {
  const { templateId } = props;
  return createElement(
    'div',
    { className: 'unsupported-template', role: 'status', 'aria-live': 'polite' },
    createElement('span', { className: 'unsupported-template__icon', 'aria-hidden': 'true' }, '⊘'),
    createElement(
      'div',
      { className: 'unsupported-template__body' },
      createElement('strong', null, '暂不支持该模板'),
      createElement(
        'p',
        null,
        `template_id = ${templateId || '空'}（错误码 UNSUPPORTED_TEMPLATE）。`,
      ),
      createElement('p', null, '已回退到原材料阅读，你可以继续查看页码、标题与正文段落。'),
    ),
  );
}
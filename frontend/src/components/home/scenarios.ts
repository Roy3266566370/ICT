import type { TemplateId } from '@/api/types';

/**
 * 旧模板的中文标签与示例回退信息。
 *
 * 示例大厅已改为数学 / 计算机 / 办公三块独立实验，不再读取本文件；
 * 这里保留给个人空间的材料模板标签使用，并与 `fixtures/examples/*.json` 的口径保持一致。
 *
 * 数据口径说明（重要，避免虚构指标）：
 * - `parameterCount` / `viewCount` 与 `fixtures/examples/*.json` 中示例对象的
 *   `parameters.length` / `views.length` 逐值对齐（T1 产物），改夹具时要同步改这里。
 * - `sourcePageCount`：手工示例的 `SourceRef.page` 全为 `null`（R2-AC6 / T1 契约），
 *   因此来源页数恒为 0，界面上必须显式标注"手工示例无原文页码"，不得伪装成解析结果。
 */
export interface ScenarioSummary {
  /** 与 `TemplateId` 对齐，同时作为回退的 example_id */
  templateId: TemplateId;
  /** 回退用的示例 id；运行时优先取 `TemplateDescriptor.example_id` */
  exampleId: string;
  name: string;
  /** 一句话定位，用于卡片上方的小标签 */
  kicker: string;
  /** 具体描述：必须含一条可验证的数值事实 */
  description: string;
  parameterCount: number;
  viewCount: number;
  sourcePageCount: number;
  /** 卡片右下角的补充说明，如单位口径 */
  footnote: string;
  /** 微型 SVG 预览的配色主题 */
  accent: 'indigo' | 'coral' | 'mint' | 'amber';
}

export const SCENARIOS: readonly ScenarioSummary[] = [
  {
    templateId: 'matrix_2d',
    exampleId: 'example_matrix_2d',
    name: '空间与矩阵',
    kicker: '把矩阵看成空间的变形',
    description:
      '拖动 A 的四个数，网格、单位方格与向量一起动：Ax=(2,1)、det、秩与两步解法当场对上。',
    parameterCount: 3,
    viewCount: 4,
    sourcePageCount: 0,
    footnote: '矩阵元素与向量分量范围 −3 至 3',
    accent: 'indigo',
  },
  {
    templateId: 'force_2d',
    exampleId: 'example_force_2d',
    name: '力与向量',
    kicker: '两个力，合成为一个',
    description:
      '10N 向东与 10N 向北，合力 14.14N、方向 45°；等大反向时方向显示「未定义」而不是 0°。',
    parameterCount: 1,
    viewCount: 3,
    sourcePageCount: 0,
    footnote: '支持 2 至 4 个共点力',
    accent: 'coral',
  },
  {
    templateId: 'bfs_flow',
    exampleId: 'example_bfs_flow',
    name: '计算机过程',
    kicker: '看见队列怎么走',
    description:
      'A→B、A→C、B→D、C→D 的访问序列是 A,B,C,D；D 的第二次入队会在轨迹里写明被跳过的原因。',
    parameterCount: 1,
    viewCount: 5,
    sourcePageCount: 0,
    footnote: '节点 ≤ 20、边 ≤ 40',
    accent: 'mint',
  },
  {
    templateId: 'budget_compare',
    exampleId: 'example_budget_compare',
    name: '办公推演',
    kicker: '两套报价，一条交叉线',
    description:
      '方案A 3000+80n、方案B 6000+50n：n=80 是 9400 元与 10000 元，n=100 两者相等。',
    parameterCount: 8,
    viewCount: 3,
    sourcePageCount: 0,
    footnote: '金额全程十进制字符串，不做浮点运算',
    accent: 'amber',
  },
] as const;

/** 按 template_id 定位场景描述；未命中时返回 null，调用方自行降级。 */
export function findScenarioByTemplate(templateId: string): ScenarioSummary | null {
  return SCENARIOS.find((scenario) => scenario.templateId === templateId) ?? null;
}
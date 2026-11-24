import type { WorkshopPluginConfig, WorkshopPluginPreset } from '../document/types.ts';
import { buildTemplateDoc } from './templateCatalog.ts';
import type { CanvasDoc, CanvasPanelParam } from './types.ts';

export const WORKSHOP_MAX_PRESETS = 8;
export const WORKSHOP_MAX_PRESET_PARAMS = 24;

export type WorkshopEmbedOptions = Pick<WorkshopPluginConfig,
  'display_mode' | 'transparent_bg' | 'hide_border' | 'theme' | 'visible_params' | 'presets'> & {
    authoring: boolean;
    requestedPreset?: WorkshopPluginPreset;
  };

export const WORKSHOP_PRESET_PREVIEW_EVENT = 'xiangsheng:workshop-preset-preview';
export const WORKSHOP_PRESET_SNAPSHOT_EVENT = 'xiangsheng:workshop-preset-snapshot';

interface WorkshopParamRef extends CanvasPanelParam {
  key: string;
  displayLabel: string;
  value: number;
}

export function workshopParamRefs(doc: CanvasDoc): WorkshopParamRef[] {
  const nodes = new Map(doc.nodes.map(node => [node.id, node]));
  const byNode = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  const rows = (doc.panel?.exposed_params ?? []).filter(({ node_id, param_key }) => {
    if (!nodes.has(node_id)) return false;
    const seen = byNode.get(node_id) ?? new Set<string>();
    if (seen.has(param_key)) return false;
    seen.add(param_key);
    byNode.set(node_id, seen);
    counts.set(param_key, (counts.get(param_key) ?? 0) + 1);
    return true;
  });
  const reserved = new Set(rows.map(row => row.param_key));
  return rows.map(row => {
    const node = nodes.get(row.node_id)!;
    const unique = counts.get(row.param_key) === 1;
    let key = row.param_key;
    if (!unique || key.length > 64) {
      const pair = JSON.stringify([row.node_id, row.param_key]);
      let hash = 2166136261;
      for (let i = 0; i < pair.length; i++) hash = Math.imul(hash ^ pair.charCodeAt(i), 16777619);
      const prefix = '@' + (hash >>> 0).toString(36);
      key = prefix;
      for (let suffix = 1; reserved.has(key); suffix++) key = prefix + '-' + suffix;
      reserved.add(key);
    }
    const value = Object.hasOwn(node.params, row.param_key) ? node.params[row.param_key] : undefined;
    const label = row.label || row.param_key;
    return { ...row, key, displayLabel: unique ? label : label + '（节点 ' + node.id + '）',
      value: typeof value === 'number' && Number.isFinite(value) ? value : row.min ?? 0 };
  });
}

export function extractSourceParams(doc: CanvasDoc): Record<string, number> {
  return Object.fromEntries(workshopParamRefs(doc).slice(0, WORKSHOP_MAX_PRESET_PARAMS).map(({ key, value }) => [key, value]));
}

export function applyPresetToDoc(doc: CanvasDoc, preset: WorkshopPluginPreset, allowedKeys?: readonly string[]): CanvasDoc {
  const patches = new Map<string, Record<string, number>>();
  for (const { key, node_id, param_key, value } of workshopParamRefs(doc)) {
    if ((allowedKeys && !allowedKeys.includes(key)) || !Object.hasOwn(preset.params, key)) continue;
    const next = preset.params[key];
    if (typeof next !== 'number' || !Number.isFinite(next) || next === value) continue;
    const patch = patches.get(node_id) ?? Object.create(null) as Record<string, number>;
    patch[param_key] = next;
    patches.set(node_id, patch);
  }
  return patches.size ? {
    ...doc, nodes: doc.nodes.map(node => patches.has(node.id) ? { ...node, params: { ...node.params, ...patches.get(node.id) } } : node),
  } : doc;
}

const curated: Record<string, readonly WorkshopPluginPreset[]> = {
  'biz-breakeven': [
    { id: 'baseline', label: '基准定价', params: {} },
    { id: 'discount', label: '8 折促销', params: { price: 79.2 } },
    { id: 'higher-cost', label: '成本上涨 15%', params: { fixedCost: 230000 } },
  ],
  'biz-funnel': [
    { id: 'baseline', label: '基准增长', params: {} },
    { id: 'reach', label: '曝光增加 20%', params: { impressions: 240000 } },
    { id: 'retention', label: '留存提升 5 个百分点', params: { retention: .70 } },
  ],
  'biz-cpm': [
    { id: 'baseline', label: '按期交付', params: {} },
    { id: 'frontend-delay', label: '前端延期 4 天', params: { delayT2: 4 } },
    { id: 'backend-delay', label: '后端延期 3 天', params: { delayT3: 3 } },
  ],
  'biz-abtest': [
    { id: 'small', label: '小样本 3 天', params: {}, cursor: 2 / 29 },
    { id: 'converged', label: '显著收敛 14 天', params: {}, cursor: 13 / 29 },
  ],
  'taylor-error': [
    { id: 'baseline', label: '五阶近似', params: {} },
    { id: 'linear', label: '一阶近似', params: { degree: 1 } },
    { id: 'centered', label: '移动展开中心', params: { center: 1 } },
  ],
  'projectile-drag': [
    { id: 'baseline', label: '基准抛体', params: {} },
    { id: 'ideal', label: '理想无阻力', params: { k: 0 } },
  ],
};

export function defaultPresetsForTemplate(kind: string): WorkshopPluginPreset[] {
  if (!Object.hasOwn(curated, kind)) return [];
  const base = extractSourceParams(buildTemplateDoc(kind));
  return curated[kind]!.map(preset => ({
    ...preset,
    params: { ...base, ...Object.fromEntries(Object.entries(preset.params).filter(([key]) => Object.hasOwn(base, key))) },
  }));
}

/** ``pageLabSim`` 节点载荷的解析与 AI 交互锚点检测。
 *
 * Phase 2 后 AI 交互落成标准画布块：``pageLabSim`` 节点的 ``payload``
 * JSON 里带着模型载荷与来源锚块（``anchor_id``）——既让节点可编辑
 * 可调参，也让编辑器能找回"这段文字挂的是哪个 AI 模型"。
 */

import type { PageLabParam } from '@/api/pptAI';

export interface PageLabSimData {
  kind: 'page_lab';
  title: string;
  summary: string;
  explain: string[];
  params: PageLabParam[];
  program: string;
  anchor_id?: string;
  input_hash?: string;
  instruction?: string;
}

/** 解析 ``pageLabSim`` 节点的 payload JSON；格式不符返回 null。 */
export function parsePageLabSim(payload: string | undefined): PageLabSimData | null {
  if (!payload) return null;
  try {
    const raw = JSON.parse(payload) as Record<string, unknown>;
    if (!raw || raw.kind !== 'page_lab' || typeof raw.program !== 'string' || !Array.isArray(raw.params)) {
      return null;
    }
    return {
      kind: 'page_lab',
      title: String(raw.title ?? 'AI 交互实验'),
      summary: String(raw.summary ?? ''),
      explain: Array.isArray(raw.explain) ? raw.explain.map((item) => String(item)) : [],
      params: raw.params as PageLabParam[],
      program: raw.program,
      anchor_id: typeof raw.anchor_id === 'string' && raw.anchor_id ? raw.anchor_id : undefined,
      input_hash: typeof raw.input_hash === 'string' && raw.input_hash ? raw.input_hash : undefined,
      instruction: typeof raw.instruction === 'string' ? raw.instruction : undefined,
    };
  } catch {
    return null;
  }
}

const ATTENTION_RANGES: Record<string, { label: string; min: number; max: number; step: number }> = {
  query: { label: 'Query 第一维', min: -4, max: 4, step: 0.1 },
  temperature: { label: '温度 T', min: 0.1, max: 3, step: 0.1 },
  causal: { label: '因果掩码', min: 0, max: 1, step: 1 },
};

/** 依据当前参数值推导不截断的安全滑杆范围。 */
export function inferParamRange(current: number): { min: number; max: number; step: number } {
  if (!Number.isFinite(current)) return { min: 0, max: 1, step: 0.01 };
  if (current >= 0 && current <= 1) return { min: 0, max: 1, step: 0.01 };
  if (current > 1) {
    const max = Math.ceil(current * 2);
    const step = max >= 50 ? 1 : max >= 10 ? 0.1 : 0.05;
    return { min: 0, max, step };
  }
  const bound = Math.ceil(Math.abs(current) * 2);
  const step = bound >= 25 ? 1 : bound >= 5 ? 0.1 : 0.05;
  return { min: -bound, max: bound, step };
}

/** 从节点元数据（pageLabSim/attentionSim）或当前数值提取外露参数默认描述。 */
export function simParamMeta(
  node: { type: string; params?: Record<string, number>; payload?: string },
  paramKey: string,
): { label?: string; min: number; max: number; step: number } {
  if (node.type === 'pageLabSim') {
    const found = parsePageLabSim(node.payload)?.params.find((p) => p.id === paramKey);
    if (found && Number.isFinite(found.min) && Number.isFinite(found.max) && found.min < found.max) {
      return {
        label: found.label || undefined,
        min: found.min,
        max: found.max,
        step: found.step > 0 ? found.step : 0.01,
      };
    }
  }
  if (node.type === 'attentionSim' && ATTENTION_RANGES[paramKey]) {
    return ATTENTION_RANGES[paramKey]!;
  }
  return inferParamRange(node.params?.[paramKey] ?? 0);
}

/** 仪器面板滑杆实际使用的区间：优先显式 min/max/step，缺失时按当前值动态兜底而不截断到 [0,1]。 */
export function panelParamRange(
  entry: { min?: number; max?: number; step?: number },
  current: number,
): { min: number; max: number; step: number } {
  const fallback = inferParamRange(current);
  let min: number;
  let max: number;
  if (typeof entry.min === 'number' && typeof entry.max === 'number' && entry.min < entry.max) {
    min = entry.min;
    max = entry.max;
  } else if (typeof entry.min === 'number') {
    min = entry.min;
    max = Math.max(entry.min + 1, current > entry.min ? Math.ceil(current * 2) : entry.min + 10);
  } else if (typeof entry.max === 'number') {
    max = entry.max;
    min = Math.min(entry.max - 1, current < entry.max ? Math.floor(current * 2) : entry.max - 10);
  } else {
    min = fallback.min;
    max = fallback.max;
  }
  const rawStep = typeof entry.step === 'number' && entry.step > 0
    ? entry.step
    : Number(((max - min) / 100).toPrecision(2)) || 0.01;
  return { min, max, step: rawStep };
}

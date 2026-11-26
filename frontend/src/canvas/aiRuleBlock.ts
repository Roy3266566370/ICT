/** AI 智能计算方块的载荷契约：解析、清洗与默认示例。 */

import type { CanvasDoc, RuleControlSpec, RulePreset } from './types.ts';

export type AiRulePreferredView = 'auto' | 'shapes' | 'grid' | 'chart' | 'graph' | 'timeline' | 'table';
export type RuleSampleProfile = 'limit' | 'differential' | 'quadrature' | 'integralApplications' | 'diskDensity';

export interface AiRuleBlockPayload {
  version: 1;
  prompt: string;
  title: string;
  summary: string;
  textLabel?: string;
  defaultText?: string;
  controls: RuleControlSpec[];
  presets?: RulePreset[];
  auxiliaryKind?: 'scalar' | 'function2d';
  sampleProfile?: RuleSampleProfile;
  presetSource?: 'text' | { param: string; auxiliaryParam?: string };
  preferredView: AiRulePreferredView;
  code: string;
  verificationNote?: string;
}

const VIEWS: readonly AiRulePreferredView[] = ['auto', 'shapes', 'grid', 'chart', 'graph', 'timeline', 'table'];
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeOptions(value: unknown): { value: number; label: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<number>();
  const options = value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const number = finite(raw.value);
    const label = text(raw.label, 32);
    if (number === undefined || !label || seen.has(number)) return [];
    seen.add(number);
    return [{ value: number, label }];
  }).slice(0, 10);
  return options.length ? options : undefined;
}

function normalizeControl(value: unknown): RuleControlSpec | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const key = text(raw.key, 40);
  const label = text(raw.label, 40);
  if (!KEY_RE.test(key) || !label) return null;
  const options = normalizeOptions(raw.options);
  let min = finite(raw.min);
  let max = finite(raw.max);
  if (min !== undefined && max !== undefined && !(min < max)) {
    min = undefined;
    max = undefined;
  }
  const step = finite(raw.step);
  let current = finite(raw.value) ?? (options?.[0]?.value ?? min ?? 0);
  if (options?.length) {
    if (!options.some((option) => option.value === current)) current = options[0]!.value;
  } else {
    current = Math.max(min ?? -1e6, Math.min(max ?? 1e6, current));
  }
  return {
    key,
    label,
    value: current,
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(step !== undefined && step > 0 ? { step } : {}),
    ...(options ? { options } : {}),
  };
}

function normalizePreset(value: unknown, allowedKeys: Set<string>): RulePreset | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const label = text(raw.label, 24);
  if (!label) return null;
  const params: Record<string, number> = {};
  if (raw.params && typeof raw.params === 'object') {
    for (const [key, number] of Object.entries(raw.params as Record<string, unknown>)) {
      const parsed = finite(number);
      if (parsed !== undefined && allowedKeys.has(key)) params[key] = parsed;
    }
  }
  const presetText = text(raw.text, 4000);
  if (!Object.keys(params).length && !presetText) return null;
  return { label, ...(presetText ? { text: presetText } : {}), params };
}

export function normalizeAiRulePayload(value: unknown): AiRuleBlockPayload {
  if (!value || typeof value !== 'object') throw new Error('AI 规则载荷必须是 JSON 对象');
  const raw = value as Record<string, unknown>;
  const code = typeof raw.code === 'string' ? raw.code : '';
  if (!/function\s+run\s*\(/.test(code)) throw new Error('规则代码必须包含 function run({ text, params, upstream })');
  if (code.length > 24000) throw new Error('规则代码超过 24000 字');
  const prompt = text(raw.prompt, 2000);
  const title = text(raw.title, 60) || text(prompt, 40) || 'AI 计算方块';
  const summary = text(raw.summary, 300);
  const controls = Array.isArray(raw.controls)
    ? raw.controls.map(normalizeControl).filter((item): item is RuleControlSpec => item !== null).slice(0, 8)
    : [];
  const allowed = new Set(controls.map((control) => control.key));
  const source = raw.presetSource && typeof raw.presetSource === 'object'
    ? raw.presetSource as { param?: unknown; auxiliaryParam?: unknown } : undefined;
  const sourceParam = typeof source?.param === 'string' && allowed.has(source.param) ? source.param : undefined;
  const auxiliaryParam = sourceParam && raw.auxiliaryKind === 'scalar' && typeof source?.auxiliaryParam === 'string'
    && source.auxiliaryParam !== sourceParam && KEY_RE.test(source.auxiliaryParam) ? source.auxiliaryParam : undefined;
  if (auxiliaryParam) allowed.add(auxiliaryParam);
  const presets = Array.isArray(raw.presets)
    ? raw.presets.map((item) => normalizePreset(item, allowed)).filter((item): item is RulePreset => item !== null).slice(0, 4)
    : [];
  const preferredView = VIEWS.includes(raw.preferredView as AiRulePreferredView)
    ? raw.preferredView as AiRulePreferredView
    : 'auto';
  return {
    version: 1,
    prompt,
    title,
    summary,
    ...(text(raw.textLabel, 80) ? { textLabel: text(raw.textLabel, 80) } : {}),
    ...(text(raw.defaultText, 4000) ? { defaultText: text(raw.defaultText, 4000) } : {}),
    controls,
    ...(presets.length ? { presets } : {}),
    ...(raw.auxiliaryKind === 'scalar' || raw.auxiliaryKind === 'function2d' ? { auxiliaryKind: raw.auxiliaryKind } : {}),
    ...(raw.sampleProfile === 'limit' || raw.sampleProfile === 'differential'
      || raw.sampleProfile === 'quadrature' || raw.sampleProfile === 'integralApplications' || raw.sampleProfile === 'diskDensity'
      ? { sampleProfile: raw.sampleProfile } : {}),
    ...(raw.presetSource === 'text' ? { presetSource: 'text' as const }
      : sourceParam ? { presetSource: { param: sourceParam, ...(auxiliaryParam ? { auxiliaryParam } : {}) } } : {}),
    preferredView,
    code,
    ...(text(raw.verificationNote, 300) ? { verificationNote: text(raw.verificationNote, 300) } : {}),
  };
}

/** Apply a preset and update its connected source in the same undoable edit. */
export function applyRulePreset(doc: CanvasDoc, nodeId: string, preset: RulePreset,
  sourceSetting?: AiRuleBlockPayload['presetSource']): CanvasDoc {
  const sourceId = sourceSetting
    ? doc.wires.find((wire) => wire.to === nodeId && (wire.toPort ?? 'in') === 'in')?.from : undefined;
  const auxiliaryParam = typeof sourceSetting === 'object' ? sourceSetting.auxiliaryParam : undefined;
  const auxiliaryId = auxiliaryParam
    ? doc.wires.find(wire => wire.to === nodeId && wire.toPort === 'aux')?.from : undefined;
  return { ...doc, nodes: doc.nodes.map((node) => {
    if (node.id === nodeId) return { ...node, params: { ...node.params, ...preset.params } };
    if (node.id === auxiliaryId && node.id !== sourceId && auxiliaryParam) {
      const value = preset.params[auxiliaryParam];
      return node.type === 'slider' && value !== undefined ? { ...node, params: { ...node.params, v: value } } : node;
    }
    if (node.id !== sourceId || !sourceSetting) return node;
    if (sourceSetting === 'text') {
      return preset.text && (node.type === 'functionSource' || node.type === 'func2dSource' || node.type === 'vectorFieldSource'
        || node.type === 'graphSource' || node.type === 'arraySource' || node.type === 'memAddrSource' || node.type === 'pageRefSource'
        || node.type === 'bizTableSource')
        ? { ...node, text: preset.text } : node;
    }
    const value = preset.params[sourceSetting.param];
    return node.type === 'slider' && value !== undefined
      ? { ...node, params: { ...node.params, v: value } } : node;
  }) };
}

export function parseAiRulePayload(raw: string | undefined): AiRuleBlockPayload | null {
  if (!raw) return null;
  try {
    return normalizeAiRulePayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function serializeAiRulePayload(payload: AiRuleBlockPayload): string {
  return JSON.stringify(payload);
}

export function defaultAiRuleParams(payload: AiRuleBlockPayload): Record<string, number> {
  return Object.fromEntries(payload.controls.map((control) => [control.key, control.value]));
}

const DEFAULT_CODE = `function run({ params }) {
  const a = Number(params.a);
  const b = Number(params.b);
  const c = Number(params.c);
  const frames = [];
  const start = -3;
  const end = 3;
  for (let step = 1; step <= 24; step += 1) {
    const x = start + (end - start) * step / 24;
    const xs = [];
    const ys = [];
    for (let index = 0; index <= step; index += 1) {
      const xx = start + (end - start) * index / 24;
      xs.push(Number(xx.toFixed(3)));
      ys.push(Number((a * xx * xx + b * xx + c).toFixed(4)));
    }
    const y = a * x * x + b * x + c;
    frames.push({
      title: '扫描 x = ' + x.toFixed(2),
      summary: 'f(x) = ' + y.toFixed(3) + '，a=' + a + ', b=' + b + ', c=' + c,
      columns: ['x', 'f(x)'],
      rows: [[Number(x.toFixed(3)), Number(y.toFixed(3))]],
      series: [{ label: 'f(x)', values: ys }]
    });
  }
  return { data: { a: a, b: b, c: c }, frames: frames };
}`;

export function defaultAiRulePayload(): AiRuleBlockPayload {
  return {
    version: 1,
    prompt: '扫描二次函数并逐帧画出抛物线，允许调节 a、b、c',
    title: '二次函数扫描',
    summary: '拖动 a、b、c，观察抛物线如何移动和变形。',
    controls: [
      { key: 'a', label: '二次项 a', value: 1, min: -3, max: 3, step: 0.1 },
      { key: 'b', label: '一次项 b', value: 0, min: -5, max: 5, step: 0.1 },
      { key: 'c', label: '常数项 c', value: 0, min: -5, max: 5, step: 0.1 },
    ],
    presets: [
      { label: '开口向上', params: { a: 1, b: 0, c: 0 } },
      { label: '开口向下', params: { a: -1, b: 0, c: 2 } },
      { label: '向左右平移', params: { a: 1, b: -2, c: -1 } },
    ],
    preferredView: 'chart',
    code: DEFAULT_CODE,
    verificationNote: 'a=1、b=0、c=0 时，x=2 得到 f(x)=4。',
  };
}

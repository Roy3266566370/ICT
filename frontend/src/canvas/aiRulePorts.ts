import type { NodeBodyProps } from './nodes.tsx';
import type { PipelineResult } from './lab408PipelineTypes.ts';
import type { PortValue, ValueKind } from './types.ts';
import { compileFunction, compileFunction2d, derivativeAt, gradient2d, type RealFunction } from './calculus.ts';
import type { AiRuleBlockPayload, AiRuleOutputPort, RuleSampleProfile } from './aiRuleBlock.ts';
import { sampleCalculusLesson } from './calculusSandboxSamples.ts';
import { sampleDiskDensity } from './calculusDisk.ts';
import { sampleVectorField } from './calculusField.ts';

export interface RuleUpstreamContext {
  nodeTitle: string;
  portLabel: string;
  kind?: ValueKind;
  hint: string;
  value: Record<string, unknown> | null;
}

function boundedResultData(data: Record<string, unknown>): Record<string, unknown> {
  try {
    const json = JSON.stringify(data);
    if (json.length <= 24_000) return JSON.parse(json) as Record<string, unknown>;
  } catch {
    // Keep the remaining frame metadata available for non-serializable data.
  }
  return {};
}

function meanValueSample(f: RealFunction, xs: number[], ys: (number | null)[], dy: (number | null)[]) {
  const lower = xs.indexOf(-2), upper = xs.indexOf(2);
  const start = ys[lower], end = ys[upper];
  if (!finiteNumber(start) || !finiteNumber(end)) return null;
  const slope = (end - start) / 4;
  if (!Number.isFinite(slope)) return null;
  const tolerance = 1e-8 * Math.max(1, Math.abs(slope));
  const span = { start, end, slope };
  if (dy.slice(lower, upper + 1).some((d) => d === null)) return span;

  for (let i = lower + 1; i < upper; i++) {
    if (Math.abs(dy[i]! - slope) <= tolerance) return { ...span, point: [xs[i]!, ys[i]!] };
  }
  for (let i = lower + 1; i <= upper; i++) {
    let left = xs[i - 1]!, right = xs[i]!;
    const leftSign = Math.sign(dy[i - 1]! - slope);
    if (leftSign * Math.sign(dy[i]! - slope) >= 0) continue;
    for (let k = 0; k < 28; k++) {
      const x = (left + right) / 2;
      let difference: number;
      try { difference = derivativeAt(f, x) - slope; } catch { break; }
      if (Math.abs(difference) <= tolerance) return { ...span, point: [x, f(x)!] };
      if (Math.sign(difference) === leftSign) left = x;
      else right = x;
    }
  }
  return span;
}

function sampleFunction(value: Extract<PortValue, { kind: 'function' }>) {
  const f = compileFunction(value);
  const xs = Array.from({ length: 101 }, (_, i) => (i - 50) / 20);
  const ys = xs.map(f);
  const series = xs.map((x, i) => {
    if (ys[i] === null) return null;
    for (let order = 7; order >= 1; order--) {
      try { return f.series!(x, order); } catch { /* The next lower order may exist. */ }
    }
    return null;
  });
  const dy = series.map((terms) => terms?.[1] ?? null);
  const d2y = series.map((terms) => {
    const derivative = 2 * (terms?.[2] ?? NaN);
    return Number.isFinite(derivative) ? derivative : null;
  });
  return { xs, ys, dy, d2y, series, meanValue: meanValueSample(f, xs, ys, dy) };
}

function sampleTerrain(value: Extract<PortValue, { kind: 'function2d' }>) {
  const f = compileFunction2d(value);
  const xs = Array.from({ length: 31 }, (_, i) => (i - 15) / 5);
  const ys = [...xs];
  const values = ys.map((y) => xs.map((x) => f(x, y)));
  const slopes = ys.map((y, row) => xs.map((x, column) => {
    if (values[row]?.[column] === null) return null;
    try { return gradient2d(f, x, y); } catch { return null; }
  }));
  return { xs, ys, values, dx: slopes.map((row) => row.map((g) => finiteNumber(g?.fx) ? g.fx : null)),
    dy: slopes.map((row) => row.map((g) => finiteNumber(g?.fy) ? g.fy : null)) };
}

const sampledFunctions = new Map<string, Record<string, unknown>>();

function sampledUpstream(value: Extract<PortValue, { kind: 'function' | 'function2d' }>, profile?: Exclude<RuleSampleProfile, 'diskDensity'>, scalar?: number) {
  const key = JSON.stringify([value, profile, scalar]);
  const cached = sampledFunctions.get(key);
  if (cached) return cached;
  const base = { ...value, expression: value.expression.slice(0, 400) };
  let result: Record<string, unknown> = base;
  try {
    const samples = value.kind === 'function2d' ? sampleTerrain(value)
      : profile ? sampleCalculusLesson(compileFunction(value), profile, scalar) : sampleFunction(value);
    result = { ...base, samples };
  } catch {
    // Preserve the input metadata if the expression cannot be sampled.
  }
  if (sampledFunctions.size >= 12) sampledFunctions.delete(sampledFunctions.keys().next().value!);
  sampledFunctions.set(key, result);
  return result;
}

export function serializeUpstreamValue(value: PortValue | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  switch (value.kind) {
    case 'series':
      return { kind: value.kind, title: value.title.slice(0, 100), labels: value.labels.slice(0, 200).map((label) => label.slice(0, 80)), values: value.values.slice(0, 200) };
    case 'tensor2d':
      return { kind: value.kind, data: value.data.slice(0, 32).map((row) => row.slice(0, 32)) };
    case 'dataset2d':
      return { kind: value.kind, points: value.points.slice(0, 200), featureMap: value.featureMap };
    case 'field2d':
      return { kind: value.kind, mode: value.mode, sources: value.sources.slice(0, 120) };
    case 'algoData':
      return { kind: value.kind, mode: value.mode, values: value.values?.slice(0, 200),
        edges: value.edges?.slice(0, 200), addresses: value.addresses?.slice(0, 200) };
    case 'function':
    case 'function2d':
      return sampledUpstream(value);
    case 'deepData':
      return { kind: value.kind, pipeline: value.pipeline, stage: value.stage, params: value.params, frame: value.frame, stateKeys: Object.keys(value.state) };
    case 'customFrames':
    case 'lab408Data':
    case 'physicsData':
    case 'calculusData':
    case 'businessData': {
      const last = value.result.frames.at(-1);
      return {
        kind: value.kind,
        data: boundedResultData(value.result.data),
        frameCount: value.result.frames.length,
        lastFrameSummary: last?.summary?.slice(0, 240),
        lastSeries: last?.series?.slice(0, 4).map(({ label, values }) => ({ label: label.slice(0, 80), values: values.slice(-200) })),
      };
    }
    case 'scalar':
      return Number.isFinite(value.v) ? { ...value } : null;
    case 'vectorFunction2d':
      return { ...value, samples: sampleVectorField(value) };
    case 'matrix2':
    case 'body':
      return { ...value };
  }
}

export function upstreamHint(value: Record<string, unknown> | null, kind?: ValueKind): string {
  if (!value) return kind ? `kind=${kind}（当前暂无输出）` : '当前暂无输出';
  const fields = Object.entries(value).filter(([key, item]) => key !== 'kind' && item !== undefined).map(([key, item]) => {
    if (Array.isArray(item)) {
      const first = item[0];
      const detail = Array.isArray(first) ? `×${first.length}`
        : first && typeof first === 'object' ? `，元素字段 ${Object.keys(first).slice(0, 8).join('/')}` : '';
      return `${key}（${item.length} 项${detail}）`;
    }
    if (item && typeof item === 'object') return `${key}{${Object.keys(item).slice(0, 12).join(', ')}}`;
    return `${key}:${typeof item}`;
  });
  return `kind=${String(value.kind)}，字段 ${fields.join('、')}`.slice(0, 450);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toSeriesPort(raw: unknown, fallbackTitle: string): Extract<PortValue, { kind: 'series' }> | null {
  if (Array.isArray(raw)) {
    const nums = raw.filter(finiteNumber).slice(0, 400);
    if (!nums.length) return null;
    return { kind: 'series', title: fallbackTitle, labels: nums.map((_, i) => String(i + 1)), values: nums };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const vals = Array.isArray(obj.values) ? obj.values.filter(finiteNumber).slice(0, 400) : [];
    if (!vals.length) return null;
    const title = typeof obj.title === 'string' && obj.title.trim()
      ? obj.title.trim().slice(0, 80)
      : typeof obj.label === 'string' && obj.label.trim() ? obj.label.trim().slice(0, 80) : fallbackTitle;
    const labels = Array.isArray(obj.labels) && obj.labels.length === vals.length
      ? obj.labels.map((item) => String(item).slice(0, 40))
      : vals.map((_, i) => String(i + 1));
    return { kind: 'series', title, labels, values: vals };
  }
  return null;
}

export function ruleAuxiliaryOutputs(
  result: PipelineResult,
  title: string,
  declaredOutputs?: readonly AiRuleOutputPort[],
  controls: AiRuleBlockPayload['controls'] = [],
  elapsedMs?: number,
): Record<string, PortValue> {
  const frame = result.frames.at(-1);
  const line = frame?.series?.[0];
  const value = [result.data.value, Object.values(result.data).find(finiteNumber), line?.values.at(-1),
    frame?.rows?.flat().find(finiteNumber)].find(finiteNumber);
  const outputs: Record<string, PortValue> = {};
  if (value !== undefined) outputs.value = { kind: 'scalar', v: value };
  if (line?.values.length) outputs.series = {
    kind: 'series', title, labels: line.values.map((_, index) => String(index + 1)), values: line.values,
  };

  // 解析沙箱返回的 data.outputs，支持自定义多输出端口分流消费
  const rawOutputs = result.data.outputs && typeof result.data.outputs === 'object' && !Array.isArray(result.data.outputs)
    ? result.data.outputs as Record<string, unknown>
    : null;

  if (declaredOutputs?.length) {
    for (const port of declaredOutputs) {
      if (port.id === 'out') continue;
      const candidate = rawOutputs && Object.hasOwn(rawOutputs, port.id) ? rawOutputs[port.id] : result.data[port.id];
      if (port.kind === 'scalar') {
        if (finiteNumber(candidate)) {
          outputs[port.id] = { kind: 'scalar', v: candidate };
        } else if (candidate && typeof candidate === 'object' && finiteNumber((candidate as Record<string, unknown>).v)) {
          outputs[port.id] = { kind: 'scalar', v: (candidate as Record<string, unknown>).v as number };
        }
      } else if (port.kind === 'series') {
        const seriesVal = toSeriesPort(candidate, port.label || title)
          ?? (() => {
            const matchedLine = frame?.series?.find((s) => s.label === port.label || s.label === port.id);
            return matchedLine?.values.length ? toSeriesPort(matchedLine.values, matchedLine.label || port.label) : null;
          })();
        if (seriesVal) outputs[port.id] = seriesVal;
      } else if (port.kind === 'customFrames') {
        outputs[port.id] = { kind: 'customFrames', title: port.label || title, controls, result, elapsedMs };
      }
    }
  } else if (rawOutputs) {
    for (const [portId, candidate] of Object.entries(rawOutputs)) {
      if (portId === 'out' || Object.hasOwn(outputs, portId)) continue;
      if (finiteNumber(candidate)) {
        outputs[portId] = { kind: 'scalar', v: candidate };
      } else {
        const seriesVal = toSeriesPort(candidate, portId);
        if (seriesVal) outputs[portId] = seriesVal;
      }
    }
  }

  return outputs;
}

export function ruleUpstream(values: NodeBodyProps['values'], profile?: RuleSampleProfile): Record<string, unknown>[] {
  const scalar = values.aux?.kind === 'scalar' && Number.isFinite(values.aux.v) ? values.aux.v : undefined;
  const source = values.in;
  const input = source?.kind === 'vectorFunction2d' && scalar !== undefined ? { ...source, samples: sampleVectorField(source, scalar) }
    : profile === 'diskDensity' && source?.kind === 'function2d' ? { ...source, samples: sampleDiskDensity(source) }
      : profile && profile !== 'diskDensity' && source?.kind === 'function'
        ? sampledUpstream(source, profile, scalar) : serializeUpstreamValue(source);
  const auxiliary = serializeUpstreamValue(values.aux);
  return [input, auxiliary && { ...auxiliary, port: 'aux' }].filter((value) => value !== null);
}

/** 构造沙箱多路输入：兼容数组 upstream，同时提供按端口 id 索引的 inputs 对象 */
export function ruleNamedInputs(
  values: NodeBodyProps['values'],
  payload?: Pick<AiRuleBlockPayload, 'inputs' | 'sampleProfile'>,
): { upstream: Record<string, unknown>[]; inputs: Record<string, unknown> } {
  const inputs: Record<string, unknown> = {};
  const upstream: Record<string, unknown>[] = [];
  const profile = payload?.sampleProfile;

  if (payload?.inputs?.length) {
    for (const port of payload.inputs) {
      const serialized = serializeUpstreamValue(values[port.id]);
      if (serialized) {
        inputs[port.id] = serialized;
        upstream.push({ ...serialized, port: port.id });
      }
    }
    // 若同时存在其他未声明但已接线的端口，也补齐到 inputs
    for (const [portId, value] of Object.entries(values)) {
      if (Object.hasOwn(inputs, portId)) continue;
      const serialized = serializeUpstreamValue(value);
      if (serialized) {
        inputs[portId] = serialized;
        upstream.push({ ...serialized, port: portId });
      }
    }
    return { upstream, inputs };
  }

  const legacyUpstream = ruleUpstream(values, profile);
  const scalar = values.aux?.kind === 'scalar' && Number.isFinite(values.aux.v) ? values.aux.v : undefined;
  for (const [portId, value] of Object.entries(values)) {
    let serialized: Record<string, unknown> | null;
    if (portId === 'in') {
      serialized = value?.kind === 'vectorFunction2d' && scalar !== undefined ? { ...value, samples: sampleVectorField(value, scalar) }
        : profile === 'diskDensity' && value?.kind === 'function2d' ? { ...value, samples: sampleDiskDensity(value) }
          : profile && profile !== 'diskDensity' && value?.kind === 'function'
            ? sampledUpstream(value, profile, scalar) : serializeUpstreamValue(value);
    } else {
      serialized = serializeUpstreamValue(value);
    }
    if (serialized) inputs[portId] = serialized;
  }
  return { upstream: legacyUpstream, inputs };
}

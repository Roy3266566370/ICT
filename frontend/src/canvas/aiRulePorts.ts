import type { NodeBodyProps } from './nodes.tsx';
import type { PipelineResult } from './lab408PipelineTypes.ts';
import type { PortValue, ValueKind } from './types.ts';

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
      return { ...value, expression: value.expression.slice(0, 400) };
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

export function ruleAuxiliaryOutputs(result: PipelineResult, title: string): Record<string, PortValue> {
  const frame = result.frames.at(-1);
  const line = frame?.series?.[0];
  const value = [result.data.value, Object.values(result.data).find(finiteNumber), line?.values.at(-1),
    frame?.rows?.flat().find(finiteNumber)].find(finiteNumber);
  const outputs: Record<string, PortValue> = {};
  if (value !== undefined) outputs.value = { kind: 'scalar', v: value };
  if (line?.values.length) outputs.series = {
    kind: 'series', title, labels: line.values.map((_, index) => String(index + 1)), values: line.values,
  };
  return outputs;
}

export function ruleUpstream(values: NodeBodyProps['values']): Record<string, unknown>[] {
  const input = serializeUpstreamValue(values.in);
  return input ? [input] : [];
}

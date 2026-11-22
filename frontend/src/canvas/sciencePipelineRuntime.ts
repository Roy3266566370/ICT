import { applyAutoLayout } from './layout.ts';
import { nextId } from './math.ts';
import type {
  ScienceData,
  ScienceEvaluation,
  SciencePipelineMap,
  ScienceResult,
  ScienceStage,
} from './sciencePipelineTypes.ts';
import type { CanvasDoc, CanvasNode, PortSpec, PortValue, Wire } from './types.ts';

type SciencePortKind = 'physicsData' | 'calculusData';

const portId = (index: number) => index ? `in${index + 1}` : 'in';

function emptyScienceResult(): ScienceResult {
  return { data: { parameters: {}, text: '' }, frames: [] };
}

export function findScienceStage(
  node: Pick<CanvasNode, 'payload'>,
  pipelines: SciencePipelineMap,
): { pipeline: string; stage: ScienceStage } | undefined {
  if (!node.payload) return undefined;
  const [pipeline, stageId] = node.payload.split('/');
  if (!pipeline || !stageId) return undefined;
  const stage = pipelines[pipeline]?.stages.find(({ id }) => id === stageId);
  return stage ? { pipeline, stage } : undefined;
}

export function sciencePipelinePorts(
  node: Pick<CanvasNode, 'payload'>,
  pipelines: SciencePipelineMap,
  kind: SciencePortKind,
  dir: 'in' | 'out',
): readonly PortSpec[] {
  const definition = findScienceStage(node, pipelines);
  if (!definition) return [];
  if (dir === 'out') return [{ id: 'out', label: '实验数据', kind }];
  return (definition.stage.inputs ?? []).map((id, index) => ({
    id: portId(index),
    kind,
    label: pipelines[definition.pipeline]?.stages.find((stage) => stage.id === id)?.title ?? id,
  }));
}

export function mergeScienceInputs(
  stage: ScienceStage,
  text: string,
  params: Record<string, number>,
  upstream: (ScienceData | null)[],
): { text: string; params: Record<string, number> } {
  const mergedParams: Record<string, number> = {};
  for (const data of upstream) {
    if (data) Object.assign(mergedParams, data.parameters);
  }
  Object.assign(mergedParams, params);

  let mergedText = text;
  if (stage.textLabel === undefined) {
    for (let index = upstream.length - 1; index >= 0; index -= 1) {
      const upstreamText = upstream[index]?.text;
      if (upstreamText) {
        mergedText = upstreamText;
        break;
      }
    }
  }
  return { text: mergedText, params: mergedParams };
}

function sanitizedScienceParams(
  stage: ScienceStage,
  params: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries((stage.controls ?? []).map((control) => {
    const value = params[control.key] ?? control.value;
    const validated = !Number.isFinite(value) ? control.value : control.options
      ? (control.options.some((option) => option.value === value) ? value : control.value)
      : Math.max(control.min ?? -Infinity, Math.min(control.max ?? Infinity, value));
    return [control.key, validated];
  }));
}

export function evaluateScienceStage(
  node: Pick<CanvasNode, 'payload' | 'params' | 'text'>,
  input: (id: string) => PortValue | null,
  pipelines: SciencePipelineMap,
): ScienceEvaluation | null {
  const definition = findScienceStage(node, pipelines);
  if (!definition) return null;
  const { pipeline, stage } = definition;
  const header = { pipeline, stage: stage.id };
  const upstream = (stage.inputs ?? []).map((expected, index) => {
    const value = input(portId(index));
    return value && (value.kind === 'physicsData' || value.kind === 'calculusData')
      && value.pipeline === pipeline && value.stage === expected && !value.error
      ? value.result.data
      : null;
  });

  if (upstream.some((data) => data === null)) {
    const missing = (stage.inputs ?? [])
      .filter((_, index) => upstream[index] === null)
      .map((id) => pipelines[pipeline]?.stages.find((candidate) => candidate.id === id)?.title ?? id);
    return {
      ...header,
      result: emptyScienceResult(),
      error: `等待有效输入：${missing.join('、')}`,
    };
  }

  try {
    const params = sanitizedScienceParams(stage, node.params);
    const merged = mergeScienceInputs(stage, node.text ?? stage.text ?? '', params, upstream);
    return { ...header, result: stage.run({ ...merged, upstream }) };
  } catch (error) {
    return {
      ...header,
      result: emptyScienceResult(),
      error: error instanceof Error ? error.message : '当前输入无法计算。',
    };
  }
}

export function buildSciencePipeline(
  kind: string,
  title: string,
  note: string,
  nodeType: 'physicsStage' | 'calculusStage',
  pipelines: SciencePipelineMap,
): CanvasDoc {
  const definition = pipelines[kind];
  if (!definition) throw new Error(`未知学科管线：${kind}`);

  const ids = new Map<string, string>();
  const wires: Wire[] = [];
  const nodes = definition.stages.map((stage, index): CanvasNode => {
    const id = nextId('n');
    ids.set(stage.id, id);
    return {
      id,
      type: nodeType,
      x: 0,
      y: index * 120,
      payload: `${kind}/${stage.id}`,
      ...(stage.text !== undefined ? { text: stage.text } : {}),
      params: Object.fromEntries((stage.controls ?? []).map(({ key, value }) => [key, value])),
    };
  });

  const used = new Set<string>();
  for (const stage of definition.stages) {
    (stage.inputs ?? []).forEach((source, index) => {
      const from = ids.get(source);
      if (!from) throw new Error(`学科管线缺少模块：${source}`);
      used.add(source);
      wires.push({
        id: nextId('w'),
        from,
        fromPort: 'out',
        to: ids.get(stage.id)!,
        toPort: portId(index),
      });
    });
  }

  nodes.push({ id: nextId('n'), type: 'textNote', x: 35, y: 360, params: {}, text: note });
  const viewNodeIds = definition.stages
    .filter(({ id }) => !used.has(id))
    .map(({ id }) => ids.get(id)!);
  const exposedParams = definition.stages
    .filter((stage) => !(stage.inputs ?? []).length)
    .flatMap((stage) => (stage.controls ?? []).map((control) => ({
      node_id: ids.get(stage.id)!,
      param_key: control.key,
      label: control.label,
      ...(control.min !== undefined ? { min: control.min } : {}),
      ...(control.max !== undefined ? { max: control.max } : {}),
      ...(control.step !== undefined ? { step: control.step } : {}),
    })));

  return {
    version: 1,
    title,
    zoom: 0.69,
    nodes: applyAutoLayout(nodes, wires),
    wires,
    strokes: [],
    panel: { title, view_node_ids: viewNodeIds, exposed_params: exposedParams },
  };
}
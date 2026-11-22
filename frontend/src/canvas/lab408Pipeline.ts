import { coPipelines } from './lab408PipelineCo.ts';
import { dsPipelines } from './lab408PipelineDs.ts';
import { netPipelines } from './lab408PipelineNet.ts';
import { osPipelines } from './lab408PipelineOs.ts';
import { applyAutoLayout } from './layout.ts';
import { nextId } from './math.ts';
import type { PipelineStage } from './lab408PipelineTypes.ts';
import type { CanvasDoc, CanvasNode, PortSpec, PortValue, Wire } from './types.ts';

const pipelines = new Map(Object.entries({ ...dsPipelines, ...coPipelines, ...osPipelines, ...netPipelines }));

export function find408Stage(node: Pick<CanvasNode, 'type' | 'payload'>): { pipeline: string; stage: PipelineStage } | undefined {
  if (node.type !== 'lab408Stage' || !node.payload) return undefined;
  const [pipeline, stageId] = node.payload.split('/');
  const stage = pipelines.get(pipeline!)?.stages.find(({ id }) => id === stageId);
  return stage ? { pipeline: pipeline!, stage } : undefined;
}

const portId = (index: number) => index ? `in${index + 1}` : 'in';

export function pipelinePorts(node: CanvasNode, dir: 'in' | 'out'): readonly PortSpec[] {
  const definition = find408Stage(node);
  if (!definition) return [];
  if (dir === 'out') return [{ id: 'out', label: '实验数据', kind: 'lab408Data' }];
  return (definition.stage.inputs ?? []).map((id, index) => ({
    id: portId(index), kind: 'lab408Data',
    label: pipelines.get(definition.pipeline)?.stages.find((stage) => stage.id === id)?.title ?? id,
  }));
}

export function evaluate408Stage(
  node: CanvasNode, input: (id: string) => PortValue | null,
): Extract<PortValue, { kind: 'lab408Data' }> | null {
  const definition = find408Stage(node);
  if (!definition) return null;
  const { pipeline, stage } = definition;
  const header = { kind: 'lab408Data' as const, pipeline, stage: stage.id };
  const upstream = (stage.inputs ?? []).map((expected, index) => {
    const value = input(portId(index));
    return value?.kind === 'lab408Data' && value.pipeline === pipeline && value.stage === expected && !value.error
      ? value.result.data : null;
  });
  if (upstream.some((data) => data === null)) {
    const missing = pipelinePorts(node, 'in').filter((_, index) => upstream[index] === null).map(({ label }) => label);
    return { ...header, result: { data: {}, frames: [] }, error: `等待有效输入：${missing.join('、')}` };
  }
  try {
    const params = Object.fromEntries((stage.controls ?? []).map((control) => {
      const value = node.params[control.key] ?? control.value;
      const validated = !Number.isFinite(value) ? control.value : control.options
        ? (control.options.some((option) => option.value === value) ? value : control.value)
        : Math.max(control.min ?? -Infinity, Math.min(control.max ?? Infinity, value));
      return [control.key, validated];
    }));
    return { ...header, result: stage.run({ text: node.text ?? stage.text ?? '', params, upstream }) };
  } catch (error) {
    return { ...header, result: { data: {}, frames: [] }, error: error instanceof Error ? error.message : '当前输入无法计算。' };
  }
}

export function build408Pipeline(kind: string, title: string, note: string): CanvasDoc {
  const definition = pipelines.get(kind);
  if (!definition) throw new Error(`未知 408 管线：${kind}`);
  const ids = new Map<string, string>();
  const wires: Wire[] = [];
  const nodes = definition.stages.map((stage, index): CanvasNode => {
    const id = nextId('n');
    ids.set(stage.id, id);
    return {
      id, type: 'lab408Stage', x: 0, y: index * 120,
      payload: `${kind}/${stage.id}`,
      ...(stage.text !== undefined ? { text: stage.text } : {}),
      params: Object.fromEntries((stage.controls ?? []).map(({ key, value }) => [key, value])),
    };
  });
  const used = new Set<string>();
  for (const stage of definition.stages) {
    (stage.inputs ?? []).forEach((source, index) => {
      const from = ids.get(source);
      if (!from) throw new Error(`408 管线缺少模块：${source}`);
      used.add(source);
      wires.push({ id: nextId('w'), from, fromPort: 'out', to: ids.get(stage.id)!, toPort: portId(index) });
    });
  }
  nodes.push({ id: nextId('n'), type: 'textNote', x: 35, y: 360, params: {}, text: note });
  return {
    version: 1, title, zoom: 0.69, nodes: applyAutoLayout(nodes, wires), wires, strokes: [],
    panel: { title, view_node_ids: definition.stages.filter(({ id }) => !used.has(id)).map(({ id }) => ids.get(id)!), exposed_params: [] },
  };
}

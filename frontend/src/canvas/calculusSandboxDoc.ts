import { defaultAiRuleParams, serializeAiRulePayload, type AiRuleBlockPayload } from './aiRuleBlock.ts';
import type { CanvasDoc, CanvasNode, CanvasPanelParam, NodeType, RuleControlSpec } from './types.ts';

export const node = (id: string, type: NodeType, x: number, y: number, params: CanvasNode['params'] = {}, text?: string): CanvasNode =>
  ({ id, type, x, y, params, ...(text === undefined ? {} : { text }) });

export function slider(id: string, title: string, y: number, v: number, min: number, max: number, step: number): CanvasNode {
  return node(id, 'slider', 40, y, { v, min, max, step }, title);
}

export const control = (key: string, label: string, value: number, min: number, max: number, step: number): RuleControlSpec =>
  ({ key, label, value, min, max, step });

export function rule(id: string, x: number, y: number, config: Omit<AiRuleBlockPayload, 'version' | 'prompt'>): CanvasNode {
  const payload = { version: 1 as const, prompt: config.summary, ...config };
  return { ...node(id, 'aiRuleBlock', x, y, defaultAiRuleParams(payload)), payload: serializeAiRulePayload(payload) };
}

export function board(title: string, nodes: CanvasNode[], links: [string, string, string?][], view_node_ids: string[],
  exposed_params: CanvasPanelParam[]): CanvasDoc {
  return {
    version: 1, title, nodes,
    wires: links.map(([from, to, toPort]) => ({ id: from + '-' + to + '-' + (toPort ?? 'in'), from, to, ...(toPort ? { toPort } : {}) })),
    strokes: [], zoom: 0.85,
    panel: { title, view_node_ids, exposed_params },
  };
}

export function sliderParam(source: CanvasNode): CanvasPanelParam {
  const { min, max, step } = source.params;
  return { node_id: source.id, param_key: 'v', label: source.text, min, max, step };
}

import { find408Stage, pipelinePorts } from './lab408Pipeline.ts';
import type { NodeDef } from './nodes.tsx';
import type { CanvasNode, NodeType, PortSpec, ValueKind } from './types.ts';

export interface WireRecommendation {
  type: NodeType;
  title: string;
  badge: NodeDef['badge'];
  inPortId: string;
  inPortLabel: string;
  category: 'view' | 'transform' | 'learn' | 'experiment';
  score: number;
}

type PortNode = Pick<CanvasNode, 'type' | 'payload'>;

export function compatiblePorts(
  source: PortNode, outPortId: string, outKind: ValueKind | undefined,
  target: PortNode, input: PortSpec,
): boolean {
  const upstream = find408Stage(source);
  const downstream = find408Stage(target);
  if (upstream && downstream) {
    const targetPorts = pipelinePorts(target, 'in');
    const index = targetPorts.findIndex((port) => port.id === input.id);
    return outPortId === 'out' && upstream.pipeline === downstream.pipeline
      && upstream.stage.id === downstream.stage.inputs?.[index];
  }
  if (!outKind) return true;
  return input.kind ? input.kind === outKind : (input.accepts?.includes(outKind) ?? true);
}

const categories: Partial<Record<NodeDef['badge'], WireRecommendation['category']>> = {
  视图: 'view', 变换: 'transform', 学习: 'learn',
};
const categoryScores = { view: 40, transform: 35, learn: 20, experiment: 10 };
const internal = new Set<NodeType>(['portIn', 'portOut', 'composite']);

export function recommendNodesForPort(
  source: CanvasNode, outPortId: string, outKind: ValueKind | undefined,
  defs: Partial<Record<NodeType, NodeDef>>,
): WireRecommendation[] {
  const results: WireRecommendation[] = [];
  for (const [type, def] of Object.entries(defs) as [NodeType, NodeDef][]) {
    if (internal.has(type)) continue;
    const category = categories[def.badge] ?? 'experiment';
    const ports = (def.inputs ?? []).filter((input) => compatiblePorts(source, outPortId, outKind, { type }, input));
    const input = ports.find((port) => outKind !== undefined && port.kind === outKind)
      ?? ports.find((port) => outKind !== undefined && port.accepts?.includes(outKind))
      ?? ports.find((port) => !port.kind && !port.accepts) ?? ports[0];
    if (!input) continue;
    const matchScore = outKind && input.kind === outKind ? 100
      : outKind && input.accepts?.includes(outKind) ? 75
      : !input.kind && !input.accepts ? 50 : 0;
    const score = matchScore + categoryScores[category];
    results.push({ type, title: def.title, badge: def.badge, inPortId: input.id, inPortLabel: input.label, category, score });
  }
  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-CN'));
}

export function filterWireRecommendations(items: WireRecommendation[], query: string): WireRecommendation[] {
  const keywords = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!keywords.length) return items.slice(0, 8);
  return items.filter(({ title, badge, inPortLabel, type, category }) => {
    const terms = `${title} ${badge} ${inPortLabel} ${type} ${category}`.toLowerCase();
    return keywords.every((keyword) => terms.includes(keyword));
  });
}

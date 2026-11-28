import { inferCockpitWeight, type CockpitWeight } from './cockpitLayout.ts';
import type { NodeBodyProps, NodeDef } from './nodes.tsx';
import type { CanvasNode, Wire } from './types.ts';
import type { WorkshopEmbedOptions } from './pluginPresets.ts';

export type InstrumentLayoutMode = 'hero-with-minis' | 'peer-with-minis' | 'tabs-only';

export interface InstrumentViewItem {
  id: string;
  type: CanvasNode['type'];
  badge: NodeDef['badge'];
  weight: CockpitWeight;
}

interface InstrumentStagePlan {
  mode: InstrumentLayoutMode;
  primaryId: string;
  miniIds: string[];
  showTabs: boolean;
  allowCompare: boolean;
}

export function instrumentViewItem(
  node: CanvasNode,
  props: Parameters<typeof inferCockpitWeight>[1],
  def: Pick<NodeDef, 'badge' | 'cockpitWeight'>,
): InstrumentViewItem {
  return { id: node.id, type: node.type, badge: def.badge, weight: inferCockpitWeight(node, props, def) };
}

export function isInstrumentObserver(item: Pick<InstrumentViewItem, 'badge' | 'type'>) {
  return item.badge === '视图' || item.type === 'spark';
}

export function visibleInstrumentOutputs(
  nodeId: string, wires: readonly Wire[], observerIds: Iterable<string>,
): NonNullable<NodeBodyProps['wiredOutputs']> {
  const observers = new Set(observerIds);
  return new Set(wires.filter(wire => wire.from === nodeId && observers.has(wire.to))
    .map(wire => wire.fromPort ?? 'out'));
}

export function planInstrumentStage(
  views: readonly InstrumentViewItem[],
  { activeId, hasProcess, slideInstrument, displayMode }: {
    activeId?: string;
    hasProcess?: boolean;
    slideInstrument?: boolean;
    displayMode?: WorkshopEmbedOptions['display_mode'];
  } = {},
): InstrumentStagePlan {
  const guarded = slideInstrument || displayMode === 'compact' || displayMode === 'stage_only';
  const primaryId = views.find(view => view.id === activeId)?.id ?? views[0]?.id ?? '';
  const tabs: InstrumentStagePlan = {
    mode: 'tabs-only', primaryId, miniIds: [], showTabs: views.length > 1,
    allowCompare: !guarded && views.length > 1,
  };
  if (hasProcess || guarded || views.length <= 1 || views.length > 4
    || views.some(view => view.type === 'aiRuleBlock' || view.type === 'composite')) return tabs;

  const heroes = views.filter(view => view.weight === 'hero');
  if (heroes.length === 1) {
    const hero = heroes[0]!.id;
    return { mode: 'hero-with-minis', primaryId: hero, miniIds: views.filter(view => view.id !== hero).map(view => view.id),
      showTabs: false, allowCompare: false };
  }
  if (views.every(isInstrumentObserver)) {
    return { ...tabs, mode: 'peer-with-minis', miniIds: views.filter(view => view.id !== primaryId).map(view => view.id) };
  }
  return tabs;
}

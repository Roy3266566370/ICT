import { parseAiRulePayload } from './aiRuleBlock.ts';
import type { NodeBodyProps, NodeDef } from './nodes.tsx';
import type { CanvasNode, CockpitLayoutMode } from './types.ts';

export type CockpitWeight = 'hero' | 'standard' | 'compact';

const heroTypes = new Set<CanvasNode['type']>([
  'boundaryView', 'universalStageView', 'emFieldView', 'transformView', 'studyTrajectory',
  'functionPlot', 'gradientContour', 'odeSlopeField',
]);
const compactTypes = new Set<CanvasNode['type']>([
  'detGauge', 'eigRead', 'energyMeter', 'spark', 'studyTokenView', 'studyCurveView', 'studyStatsView', 'studyBars',
]);

export function inferCockpitWeight(
  node: CanvasNode,
  props: Partial<Pick<NodeBodyProps, 'values' | 'wiredOutputs'>>,
  def?: Pick<NodeDef, 'badge' | 'cockpitWeight'>,
): CockpitWeight {
  if (def?.cockpitWeight) return def.cockpitWeight;
  if (node.type === 'mlpTrainer') {
    return props.wiredOutputs?.has('boundary') && props.wiredOutputs.has('loss') ? 'compact' : 'hero';
  }
  if (node.type === 'aiRuleBlock') {
    const rule = parseAiRulePayload(node.payload);
    const view = rule?.preferredView;
    const legacyCanvas = view === 'auto' && JSON.parse(node.payload!).preferredView === 'canvas';
    return view === 'shapes' || legacyCanvas ? 'hero' : 'standard';
  }
  if (compactTypes.has(node.type)) return 'compact';
  if (def?.badge === '实验' || heroTypes.has(node.type)) return 'hero';
  const input = props.values?.in;
  if (node.type === 'matrixHeatmapView' && input?.kind === 'tensor2d' && input.data.length <= 2) return 'compact';
  return 'standard';
}

export interface CockpitView {
  id: string;
  weight: CockpitWeight;
  type?: CanvasNode['type'];
  chart?: boolean;
}

interface LayoutPlan {
  mode: 'single' | 'hero-stack' | 'pair' | 'bento-3' | 'quad' | 'grid';
  variant?: 'columns' | 'wide-bottom' | 'left-hero' | 'wide-top';
  slots: string[];
  hero?: string;
  stack?: string[];
}

export function planCockpitLayout(views: readonly CockpitView[], preference: CockpitLayoutMode = 'auto'): LayoutPlan {
  const slots = views.map(({ id }) => id);
  const count = views.length;
  if (count <= 1) return { mode: 'single', slots };
  if (preference === 'grid') return { mode: 'grid', slots };

  const heroes = views.filter(({ weight }) => weight === 'hero');
  const useBentoThree = preference === 'bento-3' && count === 3;
  if (preference === 'hero-stack' || (!useBentoThree && count <= 4 && heroes.length === 1)) {
    const hero = (heroes[0] ?? views[0]!).id;
    return { mode: 'hero-stack', hero, stack: slots.filter(id => id !== hero), slots };
  }
  if (count === 2) return { mode: 'pair', slots };
  if (count === 3) {
    if (heroes.length === 1) {
      const hero = heroes[0]!.id;
      return { mode: 'bento-3', variant: 'left-hero', slots: [hero, ...slots.filter(id => id !== hero)] };
    }
    const last = views[2]!;
    return { mode: 'bento-3', variant: last.weight === 'compact' || last.chart ? 'wide-bottom' : 'columns', slots };
  }
  if (count === 4) {
    const compact = views.filter(({ weight }) => weight === 'compact');
    const strip = compact.length === 1 ? compact[0] : views.find(({ type }) => type === 'studyTokenView');
    return strip
      ? { mode: 'quad', variant: 'wide-top', slots: [strip.id, ...slots.filter(id => id !== strip.id)] }
      : { mode: 'quad', slots };
  }
  return { mode: 'grid', slots };
}

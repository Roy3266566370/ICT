import type { FigureScene, FigureView, ISpec, SpecParameter } from '@/ispec/types';

export interface EmuBox { x: number; y: number; w: number; h: number }

export interface LiveCluster {
  key: string;
  specId: string;
  elementId: string;
  bbox: EmuBox;
  paramIds: string[];
}

export interface LiveFigureRegion {
  key: string;
  specId: string;
  elementId: string;
  bbox: EmuBox;
  view: FigureView;
  draggable: boolean;
  /** 与图同一元素的参数：放在图下方的参数条里。 */
  paramIds: string[];
}

export interface LiveResultDef { id: string; label: string; unit?: string }

/** 读图重建的原位图形：按原稿样子重画，直接拖原图里的向量端点。 */
export interface RecognizedRegion {
  key: string;
  specId: string;
  elementId: string;
  bbox: EmuBox;
  scene: FigureScene;
}

export interface LivePlan {
  specId: string;
  clusters: LiveCluster[];
  figure: LiveFigureRegion | null;
  recognized: RecognizedRegion[];
  results: LiveResultDef[];
  /** 没有任何可原位化的区域时，继续使用原来的整块热区。 */
  fallback: boolean;
}

/** step_diagram 依赖分步动画，不适合原位常驻。 */
const FIGURE_EXCLUDED: ReadonlyArray<FigureView['spec_ref']> = ['step_diagram'];
const MAX_RESULTS = 3;

export function isNumericParameter(parameter: Pick<SpecParameter, 'type'>): boolean {
  return parameter.type === undefined || parameter.type === 'number' || parameter.type === 'integer';
}

function validBox(box: EmuBox | null | undefined): box is EmuBox {
  return !!box && [box.x, box.y, box.w, box.h].every(Number.isFinite) && box.w > 0 && box.h > 0;
}

/** 场景必须校验通过且四元绑定齐全，才允许替换原图；否则退回原稿+旧热区。 */
function sceneUsable(spec: ISpec, scene: FigureScene, pageNo: number): boolean {
  if (scene.page !== pageNo || scene.confidence === 'low') return false;
  if (!validBox(scene.bbox_emu)) return false;
  if ((scene.checks ?? []).some(check => check.pass === false)) return false;
  const bind = scene.bind;
  if (!bind) return false;
  const ids = new Set(spec.parameters.map(p => p.id));
  return [bind.a, bind.b, bind.c, bind.d].every(id => ids.has(id));
}

export function planLive(spec: ISpec, pageNo: number): LivePlan {
  const empty: LivePlan = { specId: spec.object_id, clusters: [], figure: null, recognized: [], results: [], fallback: true };
  if (spec.availability === 'needs_review') return empty;
  const numeric = spec.parameters.filter(isNumericParameter);
  if (!numeric.length) return empty;

  const rawScenes = spec.scene?.['figure_scenes'];
  const recognized: RecognizedRegion[] = (Array.isArray(rawScenes) ? rawScenes as FigureScene[] : [])
    .filter(scene => sceneUsable(spec, scene, pageNo))
    .map(scene => ({
      key: `${spec.object_id}:fig:${scene.element_id}`, specId: spec.object_id,
      elementId: scene.element_id, bbox: scene.bbox_emu, scene,
    }));
  /** 已绑进读图场景的参数（含图注标签），不再生成参数簇。 */
  const boundIds = new Set(recognized.flatMap(region => {
    const bind = region.scene.bind;
    return bind ? [bind.a, bind.b, bind.c, bind.d, ...(bind.label ? [bind.label] : [])] : [];
  }));
  const sceneElements = new Set(recognized.map(region => region.elementId));

  const anchor = spec.anchor && spec.anchor.page === pageNo && validBox(spec.anchor.bbox) ? spec.anchor : null;
  const figureView = spec.views.find((view): view is FigureView =>
    view.type === 'figure' && !FIGURE_EXCLUDED.includes(view.spec_ref));

  let figure: LiveFigureRegion | null = null;
  if (anchor && figureView && !sceneElements.has(anchor.element_id)) {
    figure = {
      key: `${spec.object_id}:figure`, specId: spec.object_id, elementId: anchor.element_id, bbox: anchor.bbox,
      view: figureView, draggable: spec.kind === 'geometric',
      paramIds: numeric.filter(p => p.source.page === pageNo && p.source.element_id === anchor.element_id).map(p => p.id),
    };
  }

  const byElement = new Map<string, { bbox: EmuBox; ids: string[] }>();
  for (const parameter of numeric) {
    if (boundIds.has(parameter.id)) continue;
    const { page, element_id: elementId, bbox } = parameter.source;
    if (page !== pageNo || !elementId || !validBox(bbox)) continue;
    if (figure && elementId === figure.elementId) continue;
    const group = byElement.get(elementId) ?? { bbox, ids: [] };
    group.ids.push(parameter.id);
    byElement.set(elementId, group);
  }
  const clusters = [...byElement].map(([elementId, group]) => ({
    key: `${spec.object_id}:${elementId}`, specId: spec.object_id, elementId, bbox: group.bbox, paramIds: group.ids,
  }));

  const results = (spec.expressions ?? []).filter(expr => !!expr.label).slice(0, MAX_RESULTS)
    .map(expr => ({ id: expr.id, label: expr.label!, ...(expr.unit ? { unit: expr.unit } : {}) }));
  return { specId: spec.object_id, clusters, figure, recognized, results,
    fallback: !figure && !clusters.length && !recognized.length };
}

export function baselineValue(parameter: SpecParameter): number | boolean | string {
  return parameter.source_default ?? parameter.default;
}

export function isOffBaseline(parameter: SpecParameter, value: number | boolean | string | undefined): boolean {
  const base = baselineValue(parameter);
  if (typeof base === 'number' && typeof value === 'number') return Math.abs(value - base) > 1e-9;
  return value !== undefined && value !== base;
}

/** 拖动换算：每 `PX_PER_STEP` 像素移动一个 step；Shift 为粗调。 */
export const PX_PER_STEP = 6;
export function dragValue(start: number, dx: number, step: number | undefined, coarse: boolean): number {
  const unit = step && step > 0 ? step : 0.1;
  return start + (dx / PX_PER_STEP) * unit * (coarse ? 10 : 1);
}

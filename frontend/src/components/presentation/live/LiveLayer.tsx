import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FigureSpecView } from '@/components/ispec/views/FigureSpecView';
import { evaluateSpec } from '@/ispec/evaluate';
import { formatNumberSmart } from '@/ispec/format';
import { initialValues, type ISpec, type SpecEvaluation } from '@/ispec/types';
import { useRingBackground } from './bgSample';
import { LiveNumber } from './LiveNumber';
import { baselineValue, isOffBaseline, type EmuBox, type LiveCluster, type LiveFigureRegion, type LivePlan } from './liveRegions';
import { RecognizedFigure } from './RecognizedFigure';
import styles from './Live.module.css';

const MANY_PARAMS = 6;
const COMPACT_AREA = 0.05;
const COMPACT_WIDTH = 0.4;
type Cells = Record<string, number | boolean | string>;
export type DeckCells = Record<string, Cells>;

interface Props {
  specs: ISpec[];
  plans: LivePlan[];
  values: DeckCells;
  deferred: DeckCells;
  pageSize: { width: number; height: number };
  pageImageUrl?: string;
  place: (bbox: EmuBox, elementId: string) => CSSProperties;
  disabled: boolean;
  reducedMotion: boolean;
  flashKey: string | null;
  onChange: (spec: ISpec, id: string, value: number) => void;
  onExpand?: (specId: string) => void;
}

function baselineCells(spec: ISpec): Cells {
  return Object.fromEntries(spec.parameters.map(parameter => [parameter.id, baselineValue(parameter)]));
}

function ResultChips({ spec, plan, evaluation, base }: { spec: ISpec; plan: LivePlan; evaluation: SpecEvaluation; base: SpecEvaluation }) {
  if (!plan.results.length) return null;
  return <div className={styles.chips} aria-live="polite">
    {plan.results.map(result => {
      const now = evaluation.derived[result.id], was = base.derived[result.id];
      if (typeof now !== 'number') return null;
      const changed = typeof was === 'number' && Math.abs(now - was) > 1e-9;
      return <span key={result.id} className={styles.chip} data-changed={changed} data-result={`${spec.object_id}:${result.id}`}>
        {result.label} <b>{formatNumberSmart(now)}{result.unit ?? ''}</b>
        {changed && <em>原稿 {formatNumberSmart(was as number)}</em>}
      </span>;
    })}
  </div>;
}

const Cluster = memo(function Cluster({ cluster, spec, plan, cells, evaluation, base, shared, showResults }: {
  showResults: boolean; cluster: LiveCluster; spec: ISpec; plan: LivePlan; cells: Cells; evaluation: SpecEvaluation; base: SpecEvaluation;
  shared: Pick<Props, 'place' | 'disabled' | 'onChange' | 'onExpand' | 'flashKey' | 'pageSize' | 'pageImageUrl'>;
}) {
  const params = cluster.paramIds.map(id => spec.parameters.find(p => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
  const fraction = useMemo(() => ({
    x: cluster.bbox.x / shared.pageSize.width, y: cluster.bbox.y / shared.pageSize.height,
    w: cluster.bbox.w / shared.pageSize.width, h: cluster.bbox.h / shared.pageSize.height,
  }), [cluster.bbox, shared.pageSize.width, shared.pageSize.height]);
  const background = useRingBackground(shared.pageImageUrl, fraction);
  const placed = shared.place(cluster.bbox, cluster.elementId);
  const dirty = params.some(parameter => isOffBaseline(parameter, cells[parameter.id]));
  const many = params.length > MANY_PARAMS;
  const [open, setOpen] = useState(false);
  const grid = (cols: number, caption: 'id' | 'label' = 'id') => <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
    {params.map(parameter => <LiveNumber key={parameter.id} parameter={parameter} value={cells[parameter.id]} caption={caption}
      disabled={shared.disabled} onCommit={(id, value) => shared.onChange(spec, id, value)}/>)}
  </div>;
  const columns = params.length <= 4 ? Math.min(2, params.length) : Math.min(4, Math.ceil(Math.sqrt(params.length)));
  /** 来源元素是一大块文字时，不整块盖住，只在其右上角放一张紧凑卡片（标题等文字多靠左）。 */
  const compact = fraction.w * fraction.h > COMPACT_AREA || fraction.w > COMPACT_WIDTH;
  return <div className={styles.cluster} data-live-region={cluster.key} data-live-kind="params"
    data-live-title={spec.title ?? '参数'} data-live-params={params.map(p => p.id).join('、')}
    data-dirty={dirty} data-flash={shared.flashKey === cluster.key} data-card={background === null || compact} data-compact={compact}
    style={compact ? { left: `calc(${placed.left} + ${placed.width})`, top: placed.top, transform: 'translateX(-100%)', maxWidth: columns * 60 + 8 }
      : { ...placed, minHeight: placed.height, height: 'auto', ['--live-bg' as string]: background ?? undefined }}>
    {many ? <button type="button" className={styles.manyButton} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {open ? '收起参数' : `调节 ${params.length} 个参数`}</button>
      : grid(columns)}
    {many && open && <div className={styles.popover} data-no-pan>{grid(4, 'label')}</div>}
    {showResults && <ResultChips spec={spec} plan={plan} evaluation={evaluation} base={base}/>}
    {shared.onExpand && <button type="button" className={styles.expand} onClick={() => shared.onExpand?.(spec.object_id)}
      aria-label={`展开实验页：${spec.title ?? '交互'}`} title="展开为完整实验页">↗</button>}
  </div>;
});

const Figure = memo(function Figure({ figure, spec, plan, cells, evaluation, base, shared, reducedMotion }: {
  figure: LiveFigureRegion; spec: ISpec; plan: LivePlan; cells: Cells; evaluation: SpecEvaluation; base: SpecEvaluation;
  shared: Pick<Props, 'place' | 'disabled' | 'onChange' | 'onExpand' | 'flashKey' | 'pageSize' | 'pageImageUrl'>; reducedMotion: boolean;
}) {
  const [stage, setStage] = useState<0 | 1 | 2>(2);
  const [size, setSize] = useState({ w: 0, h: 0, natural: 0 });
  const host = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const isStep = figure.view.spec_ref === 'step_diagram';
  const active = true;
  const NATURAL_W = 640;

  const fraction = useMemo(() => ({
    x: figure.bbox.x / shared.pageSize.width, y: figure.bbox.y / shared.pageSize.height,
    w: figure.bbox.w / shared.pageSize.width, h: figure.bbox.h / shared.pageSize.height,
  }), [figure.bbox, shared.pageSize.width, shared.pageSize.height]);
  const surfaceBg = useRingBackground(shared.pageImageUrl, fraction, true);

  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const measure = () => setSize(current => ({ ...current, w: node.clientWidth, h: node.clientHeight,
      natural: inner.current?.offsetHeight ?? current.natural }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (inner.current) setSize(current => ({ ...current, natural: inner.current!.offsetHeight }));
  }, [cells, stage]);

  const scale = size.natural > 0 && size.w > 0 ? Math.min(size.w / NATURAL_W, size.h / size.natural) : 0;
  const params = figure.paramIds.map(id => spec.parameters.find(p => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
  const dirty = spec.parameters.some(p => isOffBaseline(p, cells[p.id]));
  const resetFigure = () => {
    for (const p of spec.parameters) {
      const baseVal = baselineValue(p);
      if (typeof baseVal === 'number') shared.onChange(spec, p.id, baseVal);
    }
  };
  const placed = shared.place(figure.bbox, figure.elementId);
  return <div ref={host} className={styles.figureHost} data-active={active} data-reduced={reducedMotion}
    data-live-region={figure.key} data-live-kind="figure" data-live-title={spec.title ?? '图形'}
    data-live-params={spec.parameters.map(p => p.id).join('、')} data-flash={shared.flashKey === figure.key} data-no-pan
    style={{ ...placed, ['--live-fig-bg' as string]: surfaceBg ?? undefined }}>
    {isStep && <div className={styles.stepBar} role="group" aria-label="步骤切换">
      {(['输入', '中间态', '最终'] as const).map((label, idx) => (
        <button key={label} type="button" aria-pressed={stage === idx}
          onClick={() => setStage(idx as 0 | 1 | 2)}>{label}</button>
      ))}
    </div>}
    <div className={styles.figureCornerActions}>
      {dirty && <button type="button" onClick={resetFigure} title="恢复原稿数值">重置</button>}
      {shared.onExpand && <button type="button" onClick={() => shared.onExpand?.(spec.object_id)} aria-label={`展开实验页：${spec.title ?? '交互'}`}
        title="展开为完整实验页">↗</button>}
    </div>
    {scale > 0 && <div ref={inner} className={styles.figureInner}
      style={{ width: NATURAL_W, transform: `translate(${(size.w - NATURAL_W * scale) / 2}px, ${(size.h - size.natural * scale) / 2}px) scale(${scale})` }}>
      <FigureSpecView view={figure.view} spec={spec} evaluation={evaluation} stage={isStep ? stage : 2} reducedMotion={reducedMotion}
        draggable={figure.draggable && !shared.disabled}
        onParamChange={(id, value) => shared.onChange(spec, id, value)}/>
    </div>}
    {scale === 0 && <div ref={inner} className={styles.figureInner} style={{ width: NATURAL_W, visibility: 'hidden' }}>
      <FigureSpecView view={figure.view} spec={spec} evaluation={evaluation} stage={isStep ? stage : 2} reducedMotion={reducedMotion}/>
    </div>}
    {(params.length > 0 || (!plan.clusters.length && plan.results.length > 0)) &&
      <div className={styles.figureBar} data-no-pan>
        {params.map(parameter => <LiveNumber key={parameter.id} parameter={parameter} value={cells[parameter.id]}
          disabled={shared.disabled} onCommit={(id, value) => shared.onChange(spec, id, value)}/>)}
        {!plan.clusters.length && <ResultChips spec={spec} plan={plan} evaluation={evaluation} base={base}/>}
      </div>}
  </div>;
});

/** 原位交互层：在原页的元素位置直接放置可操作的参数、结果与图形。 */
export const LiveLayer = memo(function LiveLayer(props: Props) {
  const {
    specs,
    plans,
    values,
    deferred,
    pageSize,
    pageImageUrl,
    place,
    disabled,
    reducedMotion,
    flashKey,
    onChange,
    onExpand,
  } = props;
  const shared = useMemo(
    () => ({ pageSize, pageImageUrl, place, disabled, flashKey, onChange, onExpand }),
    [pageSize, pageImageUrl, place, disabled, flashKey, onChange, onExpand],
  );
  const byId = useMemo(() => new Map(specs.map(spec => [spec.object_id, spec])), [specs]);
  const baselines = useMemo(() => new Map(specs.map(spec => {
    const cells = baselineCells(spec);
    return [spec.object_id, evaluateSpec(spec, cells)] as const;
  })), [specs]);
  const evaluations = useMemo(() => new Map(specs.map(spec =>
    [spec.object_id, evaluateSpec(spec, deferred[spec.object_id] ?? initialValues(spec))] as const)), [specs, deferred]);
  return <div className={styles.layer} data-disabled={disabled}>
    {plans.map(plan => {
      const spec = byId.get(plan.specId);
      const evaluation = evaluations.get(plan.specId);
      const base = baselines.get(plan.specId);
      if (!spec || !evaluation || !base || plan.fallback) return null;
      const cells = values[plan.specId] ?? initialValues(spec);
      return <div key={plan.specId} className={styles.specGroup}>
        {plan.recognized.map(region => <RecognizedFigure key={region.key} region={region} spec={spec} cells={cells}
          shared={shared} reducedMotion={reducedMotion}/>)}
        {plan.figure && <Figure figure={plan.figure} spec={spec} plan={plan} cells={cells} evaluation={evaluation} base={base}
          shared={shared} reducedMotion={reducedMotion}/>}
        {plan.clusters.map((cluster, i) => <Cluster key={cluster.key} showResults={i === 0} cluster={cluster} spec={spec} plan={plan} cells={cells}
          evaluation={evaluation} base={base} shared={shared}/>)}
      </div>;
    })}
  </div>;
});

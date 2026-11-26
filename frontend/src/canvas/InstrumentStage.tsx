import { useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { PresentationSyncContext } from '@/components/presentation/usePresentationSync';
import { panelParamRange } from '@/living/sim';
import { dfOptimRun, dfTerrain, DF_ACTIVATIONS } from './deepFirst.ts';
import { kernelData } from './deepCore.ts';
import { findCalculusStage } from './calculusPipeline.ts';
import { findPhysicsStage } from './physicsPipeline.ts';
import { findBusinessStage } from './businessPipeline.ts';
import { BusinessParameterEditor, BusinessUnitEditor } from './BusinessParameterEditor.tsx';
import { readBusinessUnits } from './businessUnits.ts';
import { isBusinessPipelineKind } from './businessTemplates.ts';
import { find408Stage } from './lab408Pipeline.ts';
import { Lab408PipelineNode, PipelineFrameDetails } from './Lab408PipelineNode.tsx';
import { SciencePipelineScene } from './SciencePipelineScene.tsx';
import { FunctionSourceControls } from './CalculusNodes.tsx';
import { MatrixSvg, RealImagePanel, CsvDatasetPanel } from './NodeInspector.tsx';
import { NODE_DEFS, type NodeBodyProps } from './nodes.tsx';
import { parseAiRulePayload } from './aiRuleBlock.ts';
import { findWorkshopTemplate, workshopCategory, workshopFormula } from './templateCatalog.ts';
import type { WorkshopPluginPreset } from '../document/types.ts';
import type { WorkshopEmbedOptions } from './pluginPresets.ts';
import type { CanvasDoc, CanvasNode, CanvasPanelParam, PortValue } from './types.ts';
import type { ScienceFrame, ScienceScene } from './sciencePipelineTypes.ts';
import styles from './instrumentStage.module.css';

interface StageProps {
  doc: CanvasDoc;
  templateKind?: string;
  readOnly?: boolean;
  interactivePanel?: boolean;
  slideInstrument?: boolean;
  onCompose?: () => void;
  getBodyProps: (node: CanvasNode) => NodeBodyProps;
  nodeTitle: (node: CanvasNode) => string;
  cursors: Record<string, number>;
  setCursor: (key: string, position: number) => void;
  pipelineScope: string;
  presentationKey?: string;
  workshopEmbed?: WorkshopEmbedOptions;
  audienceParams?: CanvasPanelParam[];
  onPreset?: (preset: WorkshopPluginPreset) => void;
}

const processStages: Record<string, readonly [string, string?]> = {
  'derivative-triptych': ['first-derivative', 'second-derivative'],
  'taylor-error': ['taylor-polynomial', 'taylor-remainder'],
  'ftc-sweep': ['accumulated-area', 'ftc-slope-check'],
  'integration-race': ['method-race', 'convergence-order'],
  pipelineLab: ['timing', 'hazards'],
  cacheSimLab: ['cache', 'split'],
  btreeLab: ['insert', 'metrics'],
  hashTableLab: ['probe', 'compare'],
  cpuDatapathLab: ['datapath', 'cycles'],
  aluBoothLab: ['steps', 'verify'],
  diskScheduleLab: ['trace', 'compare'],
  pvSyncLab: ['sim', 'audit'],
  csmaCdLab: ['timeline', 'verdict'],
  routingLab: ['converge', 'compare'],
  'biz-breakeven': ['main', 'analysis'],
  'biz-funnel': ['main', 'analysis'],
  'biz-cpm': ['main', 'analysis'],
  'biz-abtest': ['main', 'analysis'],
};

const format = (value: number | undefined) => value === undefined ? '—' : Number(value.toPrecision(5)).toString();
const fill = (fraction: number) => ({ '--fill': Math.max(0, Math.min(1, fraction)) * 100 + '%' }) as CSSProperties;
const tensor = (value: PortValue | null | undefined) => value?.kind === 'tensor2d' ? value.data : undefined;
const scalar = (value: PortValue | null | undefined) => value?.kind === 'scalar' ? value.v : undefined;
const pipeline = (value: PortValue | null | undefined) =>
  value?.kind === 'calculusData' || value?.kind === 'physicsData' || value?.kind === 'lab408Data' || value?.kind === 'businessData' ? value : undefined;
const science = (value: PortValue | null | undefined) =>
  value?.kind === 'calculusData' || value?.kind === 'physicsData' ? value : undefined;

function Body({ props }: { props: NodeBodyProps }) {
  const View = NODE_DEFS[props.node.type].Body;
  return <View {...props} />;
}

function SeriesChart({ series, position }: {
  series: { label: string; values: number[]; color?: string }[];
  position?: number;
}) {
  const values = series.flatMap((line) => line.values).filter(Number.isFinite);
  if (!values.length) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const count = Math.max(2, ...series.map((line) => line.values.length));
  const x = (index: number) => 20 + index / (count - 1) * 208;
  const y = (value: number) => 96 - (value - low) / (high - low || 1) * 76;
  return <svg viewBox="0 0 240 110" role="img" aria-label={series.map(({ label }) => label).join('、')}>
    <path d="M20 18V96H228M20 57H228" fill="none" stroke="#ddd8ca" />
    {series.map(({ label, values: points, color }) => <polyline key={label} fill="none" stroke={color ?? '#1c2ecb'} strokeWidth="2"
      points={points.map((value, i) => x(i) + ',' + y(value)).join(' ')} />)}
    {position !== undefined && <line x1={x(Math.min(position, count - 1))} x2={x(Math.min(position, count - 1))} y1="16" y2="96" stroke="#de421f" strokeDasharray="4 3" />}
  </svg>;
}

type Reading = { label: string; value: string; emphasis?: boolean };

function Readouts({ rows }: { rows: readonly Reading[] }) {
  return <dl className={styles.readouts}>{rows.map(({ label, value }, i) => <div key={i}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function Gauges({ rows }: { rows: readonly Reading[] }) {
  const lead = rows.findIndex(({ emphasis }) => emphasis);
  return <dl className={styles.gauges} aria-label="实时读数" data-stage-readouts>
    {rows.map(({ label, value }, i) => <div key={i} data-lead={i === lead || undefined}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl>;
}

function ConclusionContent({ content }: { content: ReactNode }) {
  if (typeof content !== 'string') return <span>{content}</span>;
  const parts = content.split(/\s*[·|；;]\s*/).map((item) => item.trim()).filter(Boolean);
  if (parts.length >= 2 && parts.length <= 6 && parts.every((item) => item.length <= 36)) {
    return <div className={styles.metricChips}>
      {parts.map((part, index) => <span key={index} className={styles.metricChip}>{part}</span>)}
    </div>;
  }
  return <span>{content}</span>;
}

function Timeline({ last, position, onPosition, duration, label, display, presentationKey, processKey, pauseSignal, tickOffset = 0 }: {
  last: number; position: number; onPosition: (value: number) => void;
  duration: number; label: string; display?: string;
  tickOffset?: number;
  pauseSignal?: number;
  presentationKey?: string; processKey?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const [remotePlaying, setRemotePlaying] = useState(false);
  const sync = useContext(PresentationSyncContext);
  const id = useId();
  const timeline = useRef<HTMLDivElement>(null);
  const current = useRef({ position, onPosition, playing });
  current.current = { position, onPosition, playing };
  const playback = (next: boolean) => {
    setPlaying(next);
    setRemotePlaying(false);
    if (presentationKey && processKey) sync?.send({kind: 'timeline-playback', node: presentationKey, key: processKey, playing: next});
  };
  const toggle = () => {
    if (!last) return;
    const next = !playing && !remotePlaying;
    if (next && position >= last) onPosition(0);
    playback(next);
  };
  const toggleLatest = useRef(toggle);
  toggleLatest.current = toggle;
  const playbackLatest = useRef(playback);
  playbackLatest.current = playback;
  const previousPause = useRef(pauseSignal);
  useEffect(() => {
    if (pauseSignal === previousPause.current) return;
    previousPause.current = pauseSignal;
    playbackLatest.current(false);
  }, [pauseSignal]);
  useEffect(() => {
    if (!sync || !presentationKey || !processKey) return;
    const unsubscribe = sync.subscribe(message => {
      if (message.kind === 'timeline-playback' && message.node === presentationKey && message.key === processKey) {
        setPlaying(false);
        setRemotePlaying(message.playing);
      }
      if (message.kind === 'workshop-request' && message.node === presentationKey && current.current.playing) {
        sync.send({kind: 'timeline-playback', node: presentationKey, key: processKey, playing: true});
      }
    });
    return () => {
      unsubscribe();
      if (current.current.playing) sync.send({kind: 'timeline-playback', node: presentationKey, key: processKey, playing: false});
    };
  }, [sync, presentationKey, processKey]);
  useEffect(() => {
    if (!playing || !last) return;
    let raf = 0;
    let start: number | undefined;
    const from = current.current.position;
    const tick = (now: number) => {
      start ??= now;
      const next = Math.min(last, from + (now - start) * last / duration);
      current.current.onPosition(next);
      if (next < last) raf = requestAnimationFrame(tick);
      else playback(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, last, duration, sync, presentationKey, processKey]);

  useEffect(() => {
    const keyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.defaultPrevented || timeline.current?.closest('[hidden],[inert]')
        || (e.target as Element | null)?.closest?.('button,input,textarea,select,summary,a,[role="slider"],[contenteditable]')) return;
      if (!last) return;
      e.preventDefault();
      toggleLatest.current();
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [last]);

  const go = (value: number) => {
    if (playing || remotePlaying) playback(false);
    onPosition(Math.max(0, Math.min(last, value)));
  };
  if (last <= 0) return null;
  const running = playing || remotePlaying;
  return <div ref={timeline} className={styles.timeline} role="group" aria-label="连续时间轴">
    <div className={styles.transport}>
      <button type="button" onClick={() => go(Math.ceil(position) - 1)} aria-label="上一帧" title="上一帧" disabled={position <= 0}>◀</button>
      <button type="button" className={styles.play} onClick={toggle} aria-label={running ? '暂停' : '播放'} title="播放 / 暂停（空格）" disabled={!last}>{running ? 'Ⅱ' : '▶'}</button>
      <button type="button" onClick={() => go(Math.floor(position) + 1)} aria-label="下一帧" title="下一帧" disabled={position >= last}>▶</button>
      <button type="button" onClick={() => go(0)} aria-label="回到开头" title="回到开头" disabled={!last}>↺</button>
    </div>
    <div className={styles.scrubber}>
      <input className={styles.range} aria-label="时间轴位置" type="range" min={0} max={last || 1} step="any"
        list={id} value={position} aria-valuetext={display} style={fill(last ? position / last : 0)}
        disabled={!last} onChange={(e) => go(e.currentTarget.valueAsNumber)}
        onKeyDown={(e) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
          e.preventDefault();
          go(Math.round(position) + (e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1));
        }} />
      <datalist id={id}>{[0, .25, .5, .75, 1].map((fraction) => <option key={fraction} value={last * fraction} />)}</datalist>
      <div className={styles.ticks} aria-hidden="true">{[0, .25, .5, .75, 1].map((fraction) => <span key={fraction}>{Math.round(last * fraction) + tickOffset}</span>)}</div>
    </div>
    <output className={styles.timelineRead}>{last ? (display ?? label + ' ' + (Math.floor(position) + 1) + ' / ' + (last + 1)) : '参数联动'}</output>
  </div>;
}

interface Process {
  key: string;
  last: number;
  label: string;
  display?: string;
  main: ReactNode;
  detail: ReactNode;
  history: ReactNode;
  rows: Reading[];
  conclusion: ReactNode;
  detailTitle: string;
  historyTitle: string;
}

const processColors = ['#1c2ecb', '#de421f', '#0f7b5f', '#9a5b08'];
const terrainLabels = ['二次碗', '鞍点', '狭长山谷'];

function optimizerProcess({ props, position, setStart }: {
  props: NodeBodyProps; position: number; setStart?: (x: number, y: number) => void;
}): Pick<Process, 'main' | 'history' | 'rows' | 'detail'> | undefined {
  const { values } = props;
  const terrain = scalar(values['地形']), x = scalar(values['起点 x']), y = scalar(values['起点 y']);
  const lr = scalar(values['学习率']), steps = scalar(values['步数']);
  if ([terrain, x, y, lr, steps].some((value) => value === undefined)) return undefined;
  const runs = dfOptimRun({ terrain: terrain!, x: x!, y: y!, lr: lr!, steps: steps! });
  const extent = 1.1 * Math.max(2, ...runs.flatMap((run) => run.path.slice(0, Math.floor(position) + 2).flatMap((point) => [Math.abs(point.x), Math.abs(point.y)])));
  const project = (xVal: number, yVal: number): [number, number] => [200 + xVal / extent * 160, 120 - yVal / extent * 88];
  const scene: ScienceScene = { ariaLabel: '四种优化器轨迹与损失等高线', grid: true, paths: [], points: [], labels: [], ellipses: [] };
  const contourColor = '#989ac2';
  const yCurvature = 2 * dfTerrain(terrain!, 0, 1).loss;
  for (const level of [.2, .4, .6, .8, 1]) {
    if (yCurvature > 0) {
      scene.ellipses!.push({ cx: 200, cy: 120, rx: 160 * level, ry: 88 * level / Math.sqrt(yCurvature), stroke: contourColor });
    } else {
      const limit = extent * Math.sqrt(1 - level ** 2);
      for (const sign of [-1, 1]) {
        const samples = Array.from({ length: 33 }, (_, i) => {
          const t = limit * (i / 16 - 1);
          return [t, sign * Math.hypot(t, extent * level)] as const;
        });
        scene.paths!.push(
          { points: samples.map(([t, radius]) => project(t, radius)), stroke: contourColor, strokeWidth: 1 },
          { points: samples.map(([t, radius]) => project(radius, t)), stroke: contourColor, strokeWidth: 1 },
        );
      }
    }
  }
  if (yCurvature < 0) {
    scene.paths!.push(...[-1, 1].map((sign) => ({
      points: [project(-extent, -extent * sign), project(extent, extent * sign)],
      stroke: contourColor, strokeWidth: 1, dashed: true,
    })));
  }
  const axes = '#535d70';
  scene.paths!.push(
    { points: [[40, 120], [360, 120]], stroke: axes, strokeWidth: 1 },
    { points: [[200, 32], [200, 208]], stroke: axes, strokeWidth: 1 },
  );
  for (const fraction of [-1, -.5, 0, .5, 1]) {
    const [tx, ty] = project(fraction * extent, fraction * extent);
    scene.paths!.push({ points: [[tx, 117], [tx, 123]], stroke: axes, strokeWidth: 1 });
    scene.labels!.push({ x: tx, y: 135, text: format(fraction * extent), anchor: 'middle', size: 8 });
    if (fraction !== 0) {
      scene.paths!.push({ points: [[197, ty], [203, ty]], stroke: axes, strokeWidth: 1 });
      scene.labels!.push({ x: 193, y: ty + 3, text: format(fraction * extent), anchor: 'end', size: 8 });
    }
  }
  scene.labels!.push({ x: 370, y: 123, text: 'x', size: 10 }, { x: 207, y: 30, text: 'y', size: 10 });
  const rows = [];
  const updates = [];
  const series = [];
  for (const [index, run] of runs.entries()) {
    const path = run.path.slice(0, Math.floor(position) + 1);
    const point = path.at(-1)!;
    const future = run.path[path.length] ?? point;
    const mix = position % 1;
    const [px, py] = project(point.x + (future.x - point.x) * mix, point.y + (future.y - point.y) * mix);
    const color = processColors[index];
    scene.paths!.push({ points: [...path.map(({ x, y }) => project(x, y)), [px, py]], stroke: color });
    scene.points!.push({ x: px, y: py, color });
    scene.labels!.push({ x: 39 + index * 87, y: 18, text: run.kind, color });
    const { loss, grad } = dfTerrain(terrain!, point.x, point.y);
    const previous = path.at(-2) ?? point;
    updates.push({ kind: run.kind, color, gradient: Math.hypot(...grad), distance: Math.hypot(point.x - previous.x, point.y - previous.y) });
    rows.push({ label: run.kind + ' 损失', value: format(loss) });
    series.push({ label: run.kind, color, values: run.path.map((item) => dfTerrain(terrain!, item.x, item.y).loss) });
  }
  const [px, py] = project(x!, y!);
  return {
    main: <SciencePipelineScene scene={scene} probe={setStart && {
      point: { x: px, y: py }, text: '起点 (' + format(x) + ', ' + format(y) + ')',
      onMove: (sx, sy) => setStart(Math.max(-5, Math.min(5, (sx - 200) / 160 * extent)), Math.max(-5, Math.min(5, (120 - sy) / 88 * extent))),
    }} />,
    detail: <table className={styles.optimizerReadouts}>
      <thead><tr><th scope="col">优化器</th><th scope="col">‖∇L‖₂</th><th scope="col">上一步位移</th></tr></thead>
      <tbody>{updates.map(({ kind, color, gradient, distance }) => <tr key={kind}>
        <th scope="row" style={{ color }}>{kind}</th><td>{format(gradient)}</td><td>{format(distance)}</td>
      </tr>)}</tbody>
    </table>,
    history: <SeriesChart series={series} position={position} />,
    rows,
  };
}

function deepProcess({ ancestors, getBodyProps, cursors, setCursor, scope }: {
  ancestors: CanvasNode[]; getBodyProps: StageProps['getBodyProps'];
  cursors: StageProps['cursors']; setCursor: StageProps['setCursor']; scope: string;
}): Process | undefined {
  const gradient = ancestors.find((item) => item.type === 'studyGradient');
  const conv = ancestors.find((item) => item.type === 'conv2dOp');
  const optimizer = ancestors.find((item) => item.type === 'studyOptim');

  if (gradient) {
    const props = getBodyProps(gradient);
    const data = tensor(props.self);
    if (!data?.length) return undefined;
    const key = scope + ':' + gradient.id;
    const position = Math.min(cursors[key] ?? 0, data.length - 1);
    const row = data[Math.floor(position)]!;
    const next = data[Math.min(data.length - 1, Math.floor(position) + 1)]!;
    const values = data.map((r) => r[3]!);
    const maximum = Math.max(1e-9, ...values.map(Math.abs));
    const layer = Math.floor(position) + 1;
    return {
      key, last: data.length - 1, label: '层', display: '第 ' + layer + ' / ' + data.length + ' 层',
      main: <SciencePipelineScene scene={{
        ariaLabel: '十层累计梯度', grid: true, axes: true,
        rects: values.map((value, i) => ({
          x: 42 + i * 34, width: 22, y: 119 - Math.max(0, value) / maximum * 75,
          height: Math.max(1, Math.abs(value) / maximum * 75), stroke: '#1c2ecb',
          fill: i < layer ? '#1c2ecb' : '#e8e9f8', opacity: i < layer ? 1 : i === layer ? (position % 1) * .6 + .2 : .2,
        })),
        labels: values.map((_, i) => ({ x: 53 + i * 34, y: 224, anchor: 'middle', text: String(i + 1), size: 10 })),
      }} />,
      detailTitle: '局部导数', detail: <SeriesChart series={[{ label: '各层局部导数', values: data.map((item) => item[2]!) }]} position={position} />,
      historyTitle: '累计梯度', history: <SeriesChart series={[{ label: '各层累计梯度', values }]} position={position} />,
      rows: ['输入', '激活输出', '局部导数', '累计梯度'].map((label, i) => ({ label, value: format(row[i]) })),
      conclusion: <>推进到第 <b>{layer}</b> 层，累计梯度为 <b>{format(row[3]! + (next[3]! - row[3]!) * (position % 1))}</b>。</>,
    };
  }

  if (conv) {
    const props = getBodyProps(conv);
    const input = tensor(props.values.in);
    const kernel = kernelData(conv.params);
    const stride = Math.round(conv.params.stride ?? 1) === 2 ? 2 : 1;
    const pad = conv.params.padding ? 1 : 0;
    if (!input?.length || !input[0]?.length) return undefined;
    const width = Math.floor((input[0].length + 2 * pad - 3) / stride) + 1;
    const height = Math.floor((input.length + 2 * pad - 3) / stride) + 1;
    if (width <= 0 || height <= 0) return undefined;
    const key = scope + ':' + conv.id;
    const position = Math.min(cursors[key] ?? 0, width * height - 1);
    const frame = Math.floor(position);
    const r = Math.floor(frame / width), c = frame % width;
    const window = kernel.map((row, u) => row.map((_, v) => input[r * stride - pad + u]?.[c * stride - pad + v] ?? 0));
    const products = window.map((row, u) => row.map((value, v) => value * kernel[u]![v]!));
    const sum = products.flat().reduce((total, value) => total + value, 0);
    const output = tensor(props.self);
    const rawOutput = output?.length === height && output[0]?.length === width ? output : undefined;
    const history = rawOutput?.flat();
    return {
      key, last: width * height - 1, label: '窗口', display: '窗口 ' + (frame + 1) + ' / ' + (width * height),
      main: <div className={styles.convStage}>
        <div><MatrixSvg data={input} highlightBox={{ r0: r * stride - pad, c0: c * stride - pad, size: 3 }} /><small>输入特征 · 滑动窗口</small></div>
        <div>{rawOutput ? <MatrixSvg data={rawOutput} signed highlightCell={{ r, c }} onSelectCell={(row, col) => setCursor(key, row * width + col)} />
          : <MatrixSvg data={products} signed />}<small>{rawOutput ? '当前卷积层输出 · 点击定位' : '窗口逐元素乘积'}</small></div>
      </div>,
      detailTitle: '窗口逐项乘积', detail: <MatrixSvg data={products} signed />,
      historyTitle: '卷积响应', history: history
        ? <SeriesChart series={[{ label: '各窗口卷积响应', values: history }]} position={position} />
        : <MatrixSvg data={kernel} signed />,
      rows: [{ label: '行、列', value: '[' + r + ', ' + c + ']' }, { label: '乘加和', value: format(sum) }, { label: '步长 / 填充', value: stride + ' / ' + pad }],
      conclusion: <>窗口 <b>[{r}, {c}]</b> 与卷积核逐项相乘再求和，得到 <b>{format(sum)}</b>。</>,
    };
  }

  if (optimizer) {
    const props = getBodyProps(optimizer);
    const key = scope + ':' + optimizer.id;
    const last = Math.max(0, Math.min(200, Math.round(scalar(props.values['步数']) ?? 0)));
    const position = Math.min(cursors[key] ?? 0, last);
    const xWire = ancestors.find((item) => item.type === 'slider' && item.text === '起点 x');
    const yWire = ancestors.find((item) => item.type === 'slider' && item.text === '起点 y');
    const xChange = xWire && getBodyProps(xWire).onParams;
    const yChange = yWire && getBodyProps(yWire).onParams;
    const view = optimizerProcess({ props, position, setStart: xChange && yChange ? (x, y) => {
      xChange({ v: Math.round(x * 20) / 20 });
      yChange({ v: Math.round(y * 20) / 20 });
    } : undefined });
    if (!view) return undefined;
    return {
      key, last, label: '步', display: '第 ' + Math.floor(position) + ' / ' + last + ' 步', ...view,
      detailTitle: '当前梯度与步长',
      historyTitle: '损失随迭代变化',
      conclusion: <>第 <b>{Math.floor(position)}</b> 次更新后，{view.rows.map(({ label, value }, i) => <span key={label}>{i ? '，' : ''}{label} <b>{value}</b></span>)}。</>,
    };
  }
  return undefined;
}

function blendScene(frame: ScienceFrame, next: ScienceFrame | undefined, mix: number, continuousShapes = false): ScienceScene {
  const scene = frame.scene;
  if (!next || !mix || !scene.paths || scene.paths.length !== next.scene.paths?.length) return scene;
  const lerp = (a: number, b: number) => a + (b - a) * mix;
  const nextRects = next.scene.rects;
  return { ...scene, paths: scene.paths.map((path, i) => {
    const points = next.scene.paths?.[i]?.points;
    if ((path.closed && !continuousShapes) || !points || points.length !== path.points.length) return path;
    return { ...path, points: path.points.map(([x, y], j) => [lerp(x, points[j]![0]), lerp(y, points[j]![1])]) };
  }), points: scene.points?.map((point, i) => {
    const nextPoint = next.scene.points?.[i];
    return nextPoint ? { ...point, x: lerp(point.x, nextPoint.x), y: lerp(point.y, nextPoint.y) } : point;
  }), rects: continuousShapes && nextRects && scene.rects?.length === nextRects.length ? scene.rects.map((rect, i) => {
    const to = nextRects[i]!;
    return { ...rect, x: lerp(rect.x, to.x), y: lerp(rect.y, to.y),
      width: lerp(rect.width, to.width), height: lerp(rect.height, to.height) };
  }) : scene.rects };
}

function stageProcess({ props, detailProps, pinnedProps, source, position, seek }: {
  props: NodeBodyProps; detailProps?: NodeBodyProps; pinnedProps?: NodeBodyProps; source?: NodeBodyProps;
  position: number; seek: (value: number) => void;
}): Omit<Process, 'key' | 'last' | 'label'> | undefined {
  const data = pipeline(props.self);
  const frames = data?.result.frames;
  if (!data || !frames?.length) return undefined;
  const index = Math.min(frames.length - 1, Math.floor(position));
  const frame = frames[index]!;
  const detailData = pipeline(detailProps?.self);
  const detailFrame = detailData?.result.frames[Math.min(detailData.result.frames.length - 1, index)];

  if (data.kind === 'businessData') {
    const analysis = detailData?.kind === 'businessData' ? detailData.result.frames : [];
    const pinned = pinnedProps?.self;
    const history = pinned?.kind === 'businessData' && pinned.stage !== data.stage ? pinned.result.frames : [];
    const render = (series: ScienceFrame[]) => {
      const i = Math.min(series.length - 1, Math.floor(position));
      const current = series[i];
      return current && <SciencePipelineScene scene={blendScene(current, series[i + 1], position % 1, true)} showPathLabels={false} />;
    };
    const current = data.result.frames[index]!;
    const metric = current.metrics?.find(({ emphasis }) => emphasis);
    return {
      main: render(data.result.frames),
      detail: render(analysis),
      detailTitle: (detailProps && findBusinessStage(detailProps.node)?.stage.title) ?? '拆解与敏感性',
      history: render(history),
      historyTitle: (pinnedProps && findBusinessStage(pinnedProps.node)?.stage.title) ?? '时间轴推演',
      rows: current.metrics ?? [],
      conclusion: <>{metric && <b>{metric.label} {metric.value}。 </b>}{current.summary ?? current.title}</>,
      display: current.title,
    };
  }

  if (data.kind === 'lab408Data' && data.stage === 'traversalTree' && frame.graph) {
    const [work, visited] = detailFrame?.rows ?? [];
    const active = frame.graph.nodes.find((node) => node.active);
    return {
      main: <PipelineFrameDetails frame={frame} showTitle={false} />,
      detailTitle: work?.[0] === '队首 → 队尾' ? '工作队列' : '工作栈',
      detail: <Readouts rows={[{ label: String(work?.[0] ?? '工作容器'), value: String(work?.[1] ?? '—') }]} />,
      historyTitle: '已访问序列',
      history: <p className={styles.visitSequence}>{String(visited?.[1] ?? '—')}</p>,
      rows: [{ label: '当前步', value: (index + 1) + ' / ' + frames.length },
        { label: '当前节点', value: active?.label ?? '—' }],
      conclusion: frame.summary ?? frame.title,
    };
  }

  if (data.kind === 'lab408Data' && data.stage === 'cache' && data.pipeline === 'cacheSimLab') {
    const stats = pipeline(pinnedProps?.self);
    const totals = stats?.stage === 'amat' ? stats.result.frames[index] : undefined;
    const reads = totals?.columns?.map((label, i) => ({ label, value: String(totals.rows?.[0]?.[i] ?? '—') })) ?? [];
    const first = Math.max(0, index - 2);
    return {
      main: <PipelineFrameDetails frame={frame} />,
      detailTitle: detailFrame?.title ?? '物理地址切分',
      detail: detailFrame && <PipelineFrameDetails frame={detailFrame} showTitle={false} compact />,
      historyTitle: '最近访存',
      history: <ol className={styles.accessHistory} start={first + 1}>
        {frames.slice(first, index + 1).map((access, i) =>
          <li key={first + i} aria-current={first + i === index ? 'step' : undefined}>
            <strong>{access.title}</strong>{access.summary && <span>{access.summary}</span>}
          </li>)}
      </ol>,
      rows: reads.length ? reads : [{ label: '当前访存', value: (index + 1) + ' / ' + frames.length }],
      conclusion: frame.summary ?? frame.title,
    };
  }

  const scienceData = science(data);
  const scienceFrame = scienceData?.result.frames[index];
  const detailScene = science(detailData)?.result.frames[Math.min((detailData?.result.frames.length ?? 0) - 1, index)]?.scene;
  const fallbackRows = frame.columns?.slice(0, 6).map((label, i) => ({
    label, value: String(frame.rows?.[0]?.[i] ?? '—'),
  })) ?? [];
  const preferred = scienceFrame?.metrics?.find(({ emphasis }) => emphasis) ?? scienceFrame?.metrics?.[0];
  const convergence = data.pipeline === 'derivative-triptych' ? scienceFrame?.metrics?.find(({ label }) => label === '斜率差')
    : data.pipeline === 'integration-race' ? undefined : preferred;
  const series = convergence ? scienceData!.result.frames.map((item) =>
    Number(item.metrics?.find(({ label }) => label === convergence.label)?.value)) : [];
  const canChart = series.length > 1 && series.every(Number.isFinite);
  const scene = scienceFrame && blendScene(scienceFrame, scienceData?.result.frames[index + 1], position % 1);
  const earlier = scienceData?.result.frames.slice(0, index).reverse().find((item) =>
    item.metrics?.[0]?.value !== scienceFrame?.metrics?.[0]?.value);
  const ghost = earlier?.scene.paths?.filter((path, i) => i > 0 && path.stroke !== '#0d9488');
  const probePoint = scene?.points?.[0];
  const params = scienceData?.result.data.parameters;
  const sourceParams = source?.node.params;
  const kind = data.pipeline;
  const probeKey = kind === 'taylor-error' ? 'x' : kind === 'derivative-triptych' ? 'x0' : undefined;
  const plotDomain = kind === 'taylor-error' && params?.center !== undefined ? [params.center - 2, params.center + 2]
    : kind === 'ftc-sweep' && params?.base !== undefined && params.upper !== undefined ? [Math.min(params.base, params.upper), Math.max(params.base, params.upper)]
    : params?.lower !== undefined && params.upper !== undefined ? [Math.min(params.lower, params.upper), Math.max(params.lower, params.upper)] : undefined;
  let probe: Parameters<typeof SciencePipelineScene>[0]['probe'];
  if (probePoint && sourceParams && probeKey && plotDomain && source?.onParams) {
    const [lo, hi] = plotDomain as [number, number];
    const control = findCalculusStage(source.node)?.stage.controls?.find(({ key }) => key === probeKey);
    const label = probeKey === 'x0' ? 'x₀' : 'x';
    probe = {
      point: probePoint, text: label + ' = ' + format(sourceParams[probeKey]),
      onMove: (x) => {
        const value = lo + (hi - lo) * (x - 35) / 345;
        const min = control?.min ?? lo, max = control?.max ?? hi;
        const step = control?.step ?? .01;
        const next = Number(Math.max(min, Math.min(max, min + Math.round((value - min) / step) * step)).toFixed(8));
        if (next !== sourceParams[probeKey]) source.onParams?.({ [probeKey]: next });
      },
    };
  }
  if (probePoint && kind === 'ftc-sweep' && params?.base !== undefined && params.upper !== undefined && scienceData) {
    const points = scienceData.result.frames.map((item) => item.scene.points?.[0]);
    probe = {
      point: probePoint, text: '上限 x = ' + (scienceFrame?.metrics?.[0]?.value ?? '—'),
      onMove: (x) => {
        let best = index;
        points.forEach((point, i) => {
          if (point && Math.abs(x - point.x) < Math.abs(x - (points[best]?.x ?? Infinity))) best = i;
        });
        seek(best);
      },
    };
  }
  if (probePoint && kind === 'integration-race' && source?.onParams && params?.lower !== undefined && params.upper !== undefined) {
    const curve = scene?.paths?.[0]?.points;
    const right = curve?.at(-1);
    const left = curve?.[0];
    if (right && left && right[0] > left[0]) {
      const min = Math.min(params.lower, params.upper);
      const max = Math.max(params.lower, params.upper);
      probe = { point: { x: 35 + (params.upper - min) / (max - min) * 345, y: 205 }, text: 'b = ' + format(params.upper),
        onMove: (x) => {
          const b = Math.max(-4, Math.min(4, Math.round((min + (x - 35) / 345 * (max - min)) * 100) / 100));
          if (b !== source.node.params.lower) source.onParams?.({ upper: b });
        },
      };
    }
  }
  let conclusion: ReactNode = preferred ? <>当前{preferred.label}为 <b>{preferred.value}</b>。{frame.summary}</> : frame.summary ?? frame.title;
  if (kind === 'derivative-triptych' && params?.x0 !== undefined && scienceData) {
    const slope = scienceData.result.data.derivativeAtX0;
    const exact = typeof slope === 'number' && Number.isFinite(slope) ? slope : undefined;
    const difference = scienceFrame?.metrics?.find(({ label }) => label === '斜率差')?.value;
    const second = science(detailData)?.result.data.secondAt;
    const curvature = typeof second === 'number' && Number.isFinite(second) && Math.abs(second) > 1e-8 ? (second > 0 ? '向上弯曲' : '向下弯曲') : undefined;
    conclusion = <>在 <b>x₀ = {format(params.x0)}</b> 处，{exact === undefined ? '切线斜率未定义' : exact > 1e-8 ? '原函数在局部上升' : exact < -1e-8 ? '原函数在局部下降' : '切线水平'}，{curvature && <>{curvature}。</>}{!curvature && '当前二阶导数接近零或未定义。'}{difference && <>割线与切线斜率相差 <b>{difference}</b>。</>}</>;
  }
  const degree = kind === 'taylor-error' ? Number(scienceFrame?.metrics?.[0]?.value) : NaN;
  const coefficients = scienceData?.result.data.coefficients;
  const coefficient = Number.isInteger(degree) && Array.isArray(coefficients) ? coefficients[degree] as number | undefined : undefined;
  const term = Number.isFinite(coefficient) && params?.center !== undefined && plotDomain
    ? Array.from({ length: 65 }, (_, i) => coefficient! * (plotDomain[0]! + i / 64 * (plotDomain[1]! - plotDomain[0]!) - params.center!) ** degree)
    : undefined;
  const local = term ? <SeriesChart series={[{ label: '当前 Taylor 新增项', values: term }]} />
    : scene && probePoint ? <SciencePipelineScene scene={scene} crop={probePoint} />
    : detailScene ? <SciencePipelineScene scene={detailScene} />
      : detailFrame ? <PipelineFrameDetails frame={detailFrame} /> : <Readouts rows={fallbackRows} />;
  return {
    main: scene ? <>
      <SciencePipelineScene scene={scene} ghost={ghost} probe={probe} xDomain={plotDomain}
        showPathLabels={false} />
      <div className={styles.sceneStatus}><span>{frame.title}</span>{preferred && <b>{preferred.label} · {preferred.value}</b>}</div>
    </> : <PipelineFrameDetails frame={frame} />,
    detail: local, detailTitle: term ? '当前新增项 · k = ' + degree : scene && probePoint ? '探针局部放大' : detailFrame?.title ?? '当前过程',
    history: canChart ? <SeriesChart series={[{ label: convergence!.label, values: series }]} position={position} />
      : detailScene ? <SciencePipelineScene scene={detailScene} />
        : <Readouts rows={earlier?.metrics ?? fallbackRows} />,
    historyTitle: canChart ? convergence!.label + '随进程变化' : detailScene ? detailFrame!.title : '对照读数',
    rows: scienceFrame?.metrics ?? fallbackRows,
    conclusion,
    display: kind === 'taylor-error' && scienceFrame?.metrics?.[0] ? 'N = ' + scienceFrame.metrics[0].value
      : kind === 'derivative-triptych' && scienceFrame?.metrics?.[0] ? 'h = ' + scienceFrame.metrics[0].value
        : kind === 'integration-race' && scienceFrame?.metrics?.[0] ? 'n = ' + scienceFrame.metrics[0].value : undefined,
  };
}

function Observation({ storageKey }: { storageKey: string }) {
  const [value, setValue] = useState(() => {
    try { return localStorage.getItem(storageKey) ?? ''; } catch { return ''; }
  });
  return <label className={styles.observation}>我的实验观察
    <textarea value={value} rows={4} placeholder="记录当前参数、读数和你的解释…" onChange={(e) => {
      const text = e.currentTarget.value;
      setValue(text);
      try { localStorage.setItem(storageKey, text); } catch { /* The note remains available for this session. */ }
    }} />
  </label>;
}

export function InstrumentStage({ doc, templateKind, readOnly, interactivePanel, slideInstrument, onCompose, getBodyProps, nodeTitle,
  cursors, setCursor, pipelineScope, presentationKey, workshopEmbed, audienceParams, onPreset }: StageProps) {
  const [activeId, setActiveId] = useState<string>();
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareId, setCompareId] = useState<string>();
  const [showPin, setShowPin] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<string>();
  const [presetCursor, setPresetCursor] = useState<{ fraction: number; sequence: number }>();
  const appliedSequence = useRef(0);
  const previousPreview = useRef<WorkshopPluginPreset>();
  const drawerId = useId();
  const [slideChart, setSlideChart] = useState<'main' | 'detail' | 'history'>('main');
  const nodes = useMemo(() => new Map(doc.nodes.map((node) => [node.id, node])), [doc.nodes]);
  const pinned = doc.panel?.view_node_ids ?? [];
  const views = pinned.length > 0 ? pinned.flatMap((id) => nodes.get(id) ?? [])
    : doc.nodes.filter((node) => node.type !== 'textNote' && node.type !== 'latexNote');
  const view = views.find(({ id }) => id === activeId) ?? views[0];
  const props = view && getBodyProps(view);
  const customValue = view?.type === 'aiRuleBlock' ? props?.self
    : view?.type === 'universalStageView' ? props?.values.in : undefined;
  const customInput = customValue?.kind === 'customFrames' ? customValue : undefined;
  const target = pipeline(props?.self);
  const branch = new Set<string>();
  const queue = view ? [view.id] : [];
  while (queue.length) {
    const id = queue.pop()!;
    if (branch.has(id)) continue;
    branch.add(id);
    for (const wire of doc.wires) if (wire.to === id) queue.push(wire.from);
  }
  const ancestors = doc.nodes.filter(({ id }) => branch.has(id));
  const stageInput = view?.type === 'universalStageView' ? doc.wires.find((wire) => wire.to === view.id && (wire.toPort ?? 'in') === 'in') : undefined;
  const directSource = stageInput ? nodes.get(stageInput.from) : undefined;
  const customBlock = view?.type === 'aiRuleBlock' ? view
    : directSource?.type === 'aiRuleBlock' ? directSource : ancestors.find((node) => node.type === 'aiRuleBlock');
  const customBlockProps = customBlock ? getBodyProps(customBlock) : undefined;
  const customPayload = customBlock ? parseAiRulePayload(customBlock.payload) : null;
  const customFrames = customInput?.result.frames ?? [];
  const customKey = 'custom:' + (view?.id ?? doc.title);
  const customLast = Math.max(0, customFrames.length - 1);
  const customPosition = Math.floor(Math.max(0, Math.min(customLast, cursors[customKey] ?? 0)));
  const customProcess = customInput ? {
    key: customKey,
    last: customLast,
    label: '帧',
    main: customInput.error
      ? <p role="status">{customInput.error}</p>
      : customFrames[customPosition]
        ? <PipelineFrameDetails frame={customFrames[customPosition]!} showTitle={false} showSummary={false} />
        : <p role="status">通用舞台还没有可用帧。</p>,
    conclusion: customInput.error ?? customFrames[customPosition]?.summary ?? customPayload?.summary ?? 'AI 规则方块已运行。',
    rows: [] as Reading[],
    display: `${customPosition + 1}/${customLast + 1}`,
    detail: undefined,
    detailTitle: '上游输入',
    history: undefined,
    historyTitle: '并列视图',
  } : undefined;
  const metadata = findWorkshopTemplate(target?.pipeline ?? templateKind, doc.panel?.title ?? doc.title);
  const kind = target?.pipeline ?? metadata?.kind ?? templateKind;
  const definition = (node: CanvasNode) => findCalculusStage(node) ?? findPhysicsStage(node) ?? find408Stage(node) ?? findBusinessStage(node);
  const sources = ancestors.filter((node) => {
    const stage = definition(node)?.stage;
    return stage && !(stage.inputs?.length);
  });
  const source = sources.find((node) => {
    const stage = definition(node)?.stage;
    return stage?.textLabel || stage?.controls?.length;
  });
  const sourceProps = source && getBodyProps(source);
  const sourceDef = source && definition(source)?.stage;
  const [first, second] = processStages[kind ?? ''] ?? [];
  const stageNode = (id: string | undefined) => id ? ancestors.find((node) =>
    definition(node)?.stage.id === id && definition(node)?.pipeline === target?.pipeline) : undefined;
  const primary = (!showPin && stageNode(first)) || view;
  const primaryProps = primary && (primary === view ? props : getBodyProps(primary));
  const traversal = target?.stage === 'traversalTree' ? stageNode('traversal') : undefined;
  const other = traversal ? doc.nodes.find((node) =>
    find408Stage(node)?.stage.id === 'traversalWork'
    && doc.wires.some((wire) => wire.from === traversal.id && wire.to === node.id)) : stageNode(second);
  const timelineKey = pipelineScope + ':' + (target?.pipeline ?? view?.id);
  const rawLast = Math.max(0, (primaryProps?.timeline?.last ?? 0));
  const primaryOutput = pipeline(primaryProps?.self);
  const position = Math.max(0, Math.min(rawLast, cursors[timelineKey] ?? 0));
  const stageOutput = primaryProps && primaryOutput && stageProcess({
    props: primaryProps, detailProps: other && getBodyProps(other), pinnedProps: props, source: sourceProps, position,
    seek: (value) => setCursor(timelineKey, value),
  });
  const deep = !showPin && view && view.type !== 'aiRuleBlock' && !target && !customInput && deepProcess({ ancestors, getBodyProps, cursors, setCursor, scope: pipelineScope });
  const process = deep || (stageOutput && { ...stageOutput, key: timelineKey, last: rawLast, label: '帧' }) || customProcess;
  const current = process ? Math.max(0, Math.min(process.last, cursors[process.key] ?? 0)) : 0;
  const choosePreset = (preset: WorkshopPluginPreset) => {
    if (!onPreset) return;
    onPreset(preset);
    setActivePreset(preset.id);
    if (preset.cursor !== undefined && Number.isFinite(preset.cursor)) {
      const fraction = Math.max(0, Math.min(1, preset.cursor));
      setPresetCursor(previous => ({ fraction, sequence: (previous?.sequence ?? 0) + 1 }));
    }
  };
  const latestChoosePreset = useRef(choosePreset);
  latestChoosePreset.current = choosePreset;
  useEffect(() => {
    const requested = workshopEmbed?.requestedPreset;
    if (requested && requested !== previousPreview.current) latestChoosePreset.current(requested);
    previousPreview.current = requested;
  }, [workshopEmbed?.requestedPreset]);
  const cursorTarget = process?.key;
  const cursorLast = process?.last ?? 0;
  useEffect(() => {
    if (!cursorTarget || !cursorLast || !presetCursor || appliedSequence.current === presetCursor.sequence) return;
    appliedSequence.current = presetCursor.sequence;
    setCursor(cursorTarget, presetCursor.fraction * cursorLast);
  }, [cursorTarget, cursorLast, presetCursor, setCursor]);

  const exposed = audienceParams ?? doc.panel?.exposed_params.filter((param) => nodes.has(param.node_id)) ?? [];
  const businessKind = kind && isBusinessPipelineKind(kind) ? kind : undefined;
  const units = businessKind ? readBusinessUnits(businessKind, source?.text) : {};
  const textSource = customPayload ? undefined : sources.find((node) => node.type !== 'businessStage' && node.text !== undefined);
  const formula = customPayload ? undefined : ((metadata && 'formula' in metadata ? metadata.formula : undefined) ?? workshopFormula(metadata?.kind ?? kind));
  const notes = doc.nodes.filter((node) => node.type === 'textNote' && node.text?.trim());
  const canShowPin = Boolean(view && (stageNode(first) && stageNode(first) !== view || deep));
  const controls = !audienceParams && sourceDef && 'presets' in sourceDef ? sourceDef.presets : undefined;
  const deepPresets = kind === 'dlActivation' ? DF_ACTIVATIONS.map((label, value) => ({ label, field: '激活函数', value }))
    : kind === 'dlOptimizer' ? terrainLabels.map((label, value) => ({ label, field: '地形', value })) : [];
  const storageKey = 'xiangsheng.workshop.observation.' + (templateKind ?? (pipelineScope || doc.nodes[0]?.id || 'blank'));
  const canEditParameters = !readOnly || interactivePanel;
  const functionSource = !audienceParams && ancestors.find((node) => node.type === 'functionSource');
  const functionProps = functionSource ? getBodyProps(functionSource) : undefined;
  const hasFunctionControls = Boolean(functionProps?.onText || functionProps?.onParams);
  const canAuthor = !readOnly && (!workshopEmbed || workshopEmbed.authoring);
  const displayMode = workshopEmbed?.display_mode;
  const namedPresets = workshopEmbed?.presets ?? [];
  const main = process ? process.main : props ? <Body key={props.node.id} props={props} /> : null;
  const slideProcess = slideInstrument && target?.kind === 'businessData' && process?.detail && process.history ? process : undefined;
  const selectedChart = displayMode !== 'stage_only' && slideProcess && slideChart !== 'main' ? slideProcess[slideChart] : main;
  const otherViews = views.filter((item) => item.id !== view?.id);
  const canCompare = !slideInstrument && displayMode !== 'compact' && displayMode !== 'stage_only' && otherViews.length > 0;
  const compareView = canCompare && compareOpen
    ? (otherViews.find((item) => item.id === compareId) ?? otherViews[0])
    : undefined;
  const compareProps = compareView ? getBodyProps(compareView) : undefined;
  const compareCustomValue = compareView?.type === 'aiRuleBlock' ? compareProps?.self
    : compareView?.type === 'universalStageView' ? compareProps?.values.in : undefined;
  const compareCustom = compareCustomValue?.kind === 'customFrames' ? compareCustomValue : undefined;
  const compareFrame = compareCustom?.result.frames?.[0];
  const compareChart = compareView && compareProps
    ? (compareCustom
      ? (compareCustom.error
        ? <p role="status">{compareCustom.error}</p>
        : compareFrame
          ? <PipelineFrameDetails frame={compareFrame} showTitle={false} showSummary={false} />
          : <p role="status">暂无可展示帧。</p>)
      : <Body key={compareProps.node.id} props={compareProps} />)
    : null;
  const miniCards: Array<{ key: string; kicker: string; title: string; body: ReactNode }> = [];
  if (process?.detail) miniCards.push({ key: 'detail', kicker: '局部', title: process.detailTitle, body: process.detail });
  if (process?.history) miniCards.push({ key: 'history', kicker: '历程', title: process.historyTitle, body: process.history });
  const category = workshopCategory(templateKind, metadata?.kind, kind);
  const plateMeta = [category ?? (customPayload ? 'AI 规则仪器' : '交互仪器'),
    process && process.last > 0 ? (process.last + 1) + ' ' + process.label + '连续过程' : '参数联动'].join(' · ');
  const stageTitle = customInput?.title || (primary ? nodeTitle(primary) : '主观察舞台');
  const hasMinis = miniCards.length > 0;
  const StageEl = slideInstrument ? 'div' : 'main';
  return <div className={styles.workspace} data-instrument-stage data-slide-instrument={slideInstrument || undefined}
    data-display-mode={displayMode} data-transparent-bg={workshopEmbed?.transparent_bg || undefined}
    data-hide-border={workshopEmbed?.hide_border || undefined} data-instrument-theme={workshopEmbed?.theme ?? 'auto'}
    data-restricted-parameters={audienceParams !== undefined || undefined}
    data-no-public-parameters={audienceParams?.length === 0 || undefined}
    data-business-instrument={target?.kind === 'businessData' || undefined}
    data-has-minis={hasMinis || undefined}>
    <StageEl className={styles.stage}>
      <div className={styles.scroll}>
        {main ? <>
          <section className={styles.mainCard} data-stage-card data-compare={Boolean(compareView) || undefined}>
            {namedPresets.length > 0 && <div className={styles.workshopPresets} role="group" aria-label="情景预设">
              {namedPresets.map(preset => <button key={preset.id} type="button" disabled={!onPreset}
                aria-pressed={activePreset === preset.id} onClick={() => choosePreset(preset)}>{preset.label}</button>)}
            </div>}
            <header>
              <div className={styles.plate}>
                <span className={styles.plateMeta}>{plateMeta}</span>
                <h2>{stageTitle}</h2>
              </div>
              {formula && !slideInstrument && <p className={styles.plateFormula} data-stage-enrichment>{formula}</p>}
              <div className={styles.headerActions}>
                {slideProcess ? <select aria-label="沙盘图表" value={slideChart}
                  onChange={(e) => setSlideChart(e.currentTarget.value as typeof slideChart)}>
                  <option value="main">主视图</option>
                  <option value="detail">{slideProcess.detailTitle}</option>
                  <option value="history">{slideProcess.historyTitle}</option>
                </select> : canShowPin && <button type="button" aria-pressed={showPin} onClick={() => setShowPin((show) => !show)}>{showPin ? '过程视图' : '钉选结果'}</button>}
                {canCompare && <button type="button" className={styles.compareBtn} aria-pressed={compareOpen}
                  onClick={() => setCompareOpen((open) => !open)}>
                  {compareOpen ? '单图聚焦' : '双图对照'}
                </button>}
              </div>
              {views.length > 1 && <div className={styles.viewTabs} role="tablist" aria-label="观察视角">
                {views.map((item) => {
                  const selected = item.id === view?.id;
                  return <button key={item.id} type="button" role="tab" aria-selected={selected}
                    aria-pressed={selected}
                    onClick={() => { setActiveId(item.id); setShowPin(false); }}>
                    {nodeTitle(item)}
                  </button>;
                })}
              </div>}
            </header>
            {compareView && compareChart ? <div className={styles.splitStage}>
              <div className={styles.comparePane}>
                <div className={styles.compareBar}>
                  <span className={styles.compareTag}>主视角</span>
                  <strong>{stageTitle}</strong>
                </div>
                <div className={styles.chart} data-stage-chart data-fallback-chart={!process || undefined}>
                  {primaryOutput?.error ? <p role="status">{primaryOutput.error}</p> : selectedChart}
                </div>
              </div>
              <div className={styles.comparePane}>
                <div className={styles.compareBar}>
                  <span className={styles.compareTag}>对照视角</span>
                  <select aria-label="对照视角" value={compareView.id} onChange={(e) => setCompareId(e.currentTarget.value)}>
                    {otherViews.map((item) => <option key={item.id} value={item.id}>{nodeTitle(item)}</option>)}
                  </select>
                </div>
                <div className={styles.chart} data-stage-chart data-fallback-chart={!compareCustom || undefined}>
                  {compareChart}
                </div>
              </div>
            </div> : <div className={styles.chart} data-stage-chart data-fallback-chart={!process || undefined}>
              {primaryOutput?.error ? <p role="status">{primaryOutput.error}</p> : selectedChart}
            </div>}
            {!!process?.rows.length && <Gauges rows={process.rows} />}
          </section>
          <div className={styles.conclusion}>
            <strong>当前结论</strong>
            <ConclusionContent content={primaryOutput?.error ? '请检查输入和数据流。'
              : process ? process.conclusion
                : <>正在观察 <b>{view ? nodeTitle(view) : doc.title}</b>。{metadata?.observation}</>} />
          </div>
          {hasMinis && <div className={styles.minis} data-process-minis data-cols={miniCards.length}>
            {miniCards.map((card) => (
              <section key={card.key} className={styles.miniCard}>
                <h3><span>{card.kicker}</span>{card.title}</h3>
                <div>{card.body}</div>
              </section>
            ))}
          </div>}
        </> : <section className={styles.empty}>
          <h2>添加主舞台视图</h2>
          {onCompose && <button type="button" onClick={onCompose}>打开积木编排态</button>}
        </section>}
      </div>
      <Timeline key={process?.key} last={process?.last ?? 0} position={current} label={process?.label ?? '帧'}
        display={process?.display} duration={Math.max(2400, Math.min(9000, (process?.last ?? 0) * 85))}
        tickOffset={target?.kind === 'businessData' && kind !== 'biz-cpm' ? 1 : 0}
        pauseSignal={presetCursor?.sequence}
        presentationKey={presentationKey} processKey={process?.key}
        onPosition={(value) => { if (process) setCursor(process.key, value); }} />
    </StageEl>

    {displayMode === 'stage_only' && (exposed.length > 0 || hasFunctionControls) && <button className={styles.drawerToggle}
      type="button" aria-controls={drawerId} aria-expanded={drawerOpen} onClick={() => setDrawerOpen(open => !open)}>
      {drawerOpen ? '关闭调参' : '⚙ 调参'}
    </button>}
    <aside id={drawerId} className={styles.pod} aria-label="精密控制舱" data-drawer-open={drawerOpen || undefined}
      hidden={displayMode === 'stage_only' && !drawerOpen}>
      <section>
        <h2>精密控制舱</h2>
        {functionProps && <FunctionSourceControls key={functionProps.node.id} {...functionProps}
          exposedKeys={exposed.filter((param) => param.node_id === functionProps.node.id).map((param) => param.param_key)} />}
        {((formula && slideInstrument) || textSource) && <div className={styles.formula} data-stage-enrichment>
          {formula && slideInstrument && <p>{formula}</p>}
          {textSource && <code>{textSource.text}</code>}
        </div>}
        {!audienceParams && (source && sourceProps && sourceDef && target?.kind === 'lab408Data' ? <div data-stage-enrichment>
          <Lab408PipelineNode key={source.id} {...sourceProps} controlsOnly />
        </div>
          : source && sourceProps && sourceDef?.textLabel && <label className={styles.observation} data-stage-enrichment>{sourceDef.textLabel}
            <textarea value={source.text ?? sourceDef.text ?? ''} rows={2} spellCheck={false} readOnly={!sourceProps.onText}
              onChange={(e) => sourceProps.onText?.(e.currentTarget.value)} />
          </label>)}
        {!audienceParams && traversal && <div data-stage-enrichment><Lab408PipelineNode key={traversal.id} {...getBodyProps(traversal)} controlsOnly /></div>}
        {customPayload && customBlockProps ? <section data-stage-enrichment>
          <h3>{customPayload.title}</h3>
          {customPayload.summary ? <p>{customPayload.summary}</p> : null}
          {customPayload.textLabel && customBlockProps.onText ? <label className={styles.observation}>{customPayload.textLabel}
            <textarea rows={2} value={customBlock?.text ?? customPayload.defaultText ?? ''} spellCheck={false}
              onChange={(event) => customBlockProps.onText?.(event.currentTarget.value)} />
          </label> : null}
          {customPayload.presets?.length ? <div className={styles.presets} role="group" aria-label="AI 规则情景预设">
            {customPayload.presets.map((preset) => <button key={preset.label} type="button"
              disabled={customPayload.presetSource ? !customBlockProps.onRulePreset : !customBlockProps.onParams}
              onClick={() => {
                if (customBlockProps.onRulePreset) customBlockProps.onRulePreset(preset);
                else {
                  customBlockProps.onParams?.(preset.params);
                  if (preset.text !== undefined) customBlockProps.onText?.(preset.text);
                }
                if (process) setCursor(process.key, 0);
              }}>{preset.label}</button>)}
          </div> : null}
          {customPayload.controls.map((control) => {
            if (exposed.some((param) => param.node_id === customBlock?.id && param.param_key === control.key)) return null;
            if (customBlockProps.values.in?.kind === 'scalar' && typeof customPayload.presetSource === 'object'
              && customPayload.presetSource.param === control.key) return null;
            const value = customBlock?.params[control.key] ?? control.value;
            return <label key={control.key} className={styles.parameter}>
              <span>{control.label}</span><output>{format(value)}</output>
              {control.options ? <select value={value} disabled={!customBlockProps.onParams}
                onChange={(event) => customBlockProps.onParams?.({ [control.key]: Number(event.currentTarget.value) })}>
                {control.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select> : <input className={styles.range} type="range" aria-label={control.label}
                min={control.min ?? 0} max={control.max ?? 1} step={control.step ?? 0.01} value={value}
                disabled={!customBlockProps.onParams}
                onChange={(event) => customBlockProps.onParams?.({ [control.key]: event.currentTarget.valueAsNumber })} />}
            </label>;
          })}
        </section> : null}
        {controls?.length ? <div className={styles.presets} aria-label="场景预设" data-stage-enrichment>{controls.map((preset) =>
          <button type="button" key={preset.label} disabled={readOnly} onClick={() => {
            sourceProps?.onParams?.(preset.params);
            if (preset.text !== undefined) sourceProps?.onText?.(preset.text);
            if (process) setCursor(process.key, 0);
          }}>{preset.label}</button>)}</div> : null}
        {deepPresets.length > 0 && <div className={styles.presets} aria-label="模型切换" data-stage-enrichment>{deepPresets.map(({ label, field, value }) => {
          const parameter = exposed.find((item) => item.label?.startsWith(field));
          const node = parameter && nodes.get(parameter.node_id);
          return <button key={label} type="button" disabled={readOnly || !node} aria-pressed={node && parameter ? node.params[parameter.param_key] === value : false}
            onClick={() => { if (node && parameter) getBodyProps(node).onParams?.({ [parameter.param_key]: value }); }}>{label}</button>;
        })}</div>}
      </section>
      {!!exposed.length && <section><h3>外露参数</h3>
        {exposed.map((param) => {
          const node = nodes.get(param.node_id)!;
          const { param_key: key } = param;
          const output = node === source ? sourceProps?.self : undefined;
          const value = (output?.kind === 'businessData' ? output.result.data.parameters[key] : undefined)
            ?? node.params[key] ?? param.min ?? 0;
          const { min, max, step } = panelParamRange(param, value);
          const options = definition(node)?.stage.controls?.find((control) => control.key === key)?.options;
          const change = (n: number) => getBodyProps(node).onParams?.({ [key]: n });
          if (businessKind && node.type === 'businessStage' && !options) {
            return <BusinessParameterEditor key={node.id + ':' + key}
              kind={businessKind} paramKey={key} label={param.label || key}
              value={value} min={min} max={max} step={step} units={units}
              onChange={canEditParameters ? change : undefined} />;
          }
          return <label key={node.id + ':' + key} className={styles.parameter}>
            <span>{param.label || key}</span><output>{format(value)}</output>
            {options ? <select value={value} disabled={!canEditParameters} onChange={(e) => change(Number(e.currentTarget.value))}>
              {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select> : <input type="range" className={styles.range} aria-label={param.label || key} min={min} max={max} step={step}
              value={value} style={fill((value - min) / (max - min))} disabled={!canEditParameters} onChange={(e) => change(e.currentTarget.valueAsNumber)} />}
            {!options && <span className={styles.rangeEnds} aria-hidden="true"><span>{format(min)}</span><span>{format(max)}</span></span>}
          </label>;
        })}
        {businessKind && source?.type === 'businessStage' && canAuthor && <BusinessUnitEditor key={source.id}
          kind={businessKind} units={units} onChange={sourceProps?.onText} sourceText={source.text}
          onParams={sourceProps?.onParams} authoring={canAuthor} />}
      </section>}
      {!readOnly && !audienceParams && ancestors.some((node) => node.type === 'pixelGridSource' || node.type === 'dataset2dSource') && <details className={styles.inputDetails} data-stage-enrichment>
        <summary>编辑实验输入</summary>
        {ancestors.flatMap((node) => {
          const properties = getBodyProps(node);
          if (node.type === 'pixelGridSource') return [<div key={node.id}><RealImagePanel node={node} onPayload={properties.onPayload} /><Body props={properties} /></div>];
          if (node.type === 'dataset2dSource') return [<div key={node.id}><CsvDatasetPanel node={node} onPayload={properties.onPayload} /><Body props={properties} /></div>];
          return [];
        })}
      </details>}
      {!readOnly && <section data-stage-secondary><Observation key={storageKey} storageKey={storageKey} /></section>}
      {(customPayload?.verificationNote || metadata?.steps || notes.length > 0) && <details className={styles.inputDetails} data-stage-secondary>
        <summary>实验步骤与核对</summary>
        <div className={styles.guideNotes}>
          {customPayload?.verificationNote ? <p>核对：{customPayload.verificationNote}</p> : null}
          {!customPayload && metadata ? <><p>{metadata.steps}</p><p>{metadata.observation}</p></> : null}
          {!customPayload && !metadata && notes.map((note) => <p key={note.id}>{note.text}</p>)}
        </div>
      </details>}
      {onCompose && <div className={styles.composeFooter} data-stage-secondary>
        <button type="button" onClick={onCompose}>切换到积木编排态修改连线 →</button>
      </div>}
    </aside>
  </div>;
}

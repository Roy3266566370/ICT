import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Timeline } from './Lab408SimNodes.tsx';
import type { PipelineControl } from './lab408PipelineTypes.ts';
import type { CanvasNode } from './types.ts';
import type {
  ScienceDiagramKind,
  ScienceEvaluation,
  ScienceFrame,
  ScienceScene,
  ScienceStage,
} from './sciencePipelineTypes.ts';
import styles from './sciencePipeline.module.css';

const INK = 'var(--ink-700)';
const MUTED = 'var(--ink-400)';
const INDIGO = 'var(--color-indigo)';
const CORAL = 'var(--color-coral)';
const SOFT = 'var(--color-indigo-soft)';

function allFinite(...values: number[]): boolean {
  return values.every(Number.isFinite);
}

function validNumber(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function PrimitiveLabel({ x, y, text, color }: {
  x: number;
  y: number;
  text?: string;
  color?: string;
}): JSX.Element | null {
  if (!text || !allFinite(x, y)) return null;
  return <text x={x} y={y} fill={color ?? INK} fontSize="11" className={styles.sceneLabel}>{text}</text>;
}

interface SceneProbe {
  point: { x: number; y: number };
  text: string;
  onMove: (x: number, y: number) => void;
}

export function SciencePipelineScene({ scene, probe, ghost, crop, xDomain, showPathLabels = true }: {
  scene: ScienceScene; probe?: SceneProbe; ghost?: ScienceScene['paths']; crop?: { x: number; y: number };
  xDomain?: readonly number[]; showPathLabels?: boolean;
}): JSX.Element {
  const instanceId = useId().replace(/:/g, '');
  const gridId = 'science-grid-' + instanceId;
  const plotId = 'science-plot-' + instanceId;
  const drag = useRef<SceneProbe['onMove']>();
  const cropX = crop ? Math.max(0, Math.min(260, crop.x - 70)) : 0;
  const cropY = crop ? Math.max(0, Math.min(160, crop.y - 40)) : 0;
  const diagramWidth = crop ? 140 : 400;
  const diagramHeight = crop ? 80 : 240;
  const labelX = probe ? Math.max(6, Math.min(280, probe.point.x > 244 ? probe.point.x - 124 : probe.point.x + 16)) : 0;
  const labelY = probe ? Math.max(26, Math.min(202, probe.point.y > 46 ? probe.point.y - 34 : probe.point.y + 14)) : 0;
  const pointAt = (svg: SVGSVGElement, x: number, y: number) => {
    const matrix = svg.getScreenCTM();
    return matrix ? new DOMPoint(x, y).matrixTransform(matrix.inverse()) : null;
  };
  return (
    <svg className={styles.scene} viewBox={[cropX, cropY, diagramWidth, diagramHeight].join(' ')}
      role="img" aria-label={scene.ariaLabel} data-scene-probe={probe ? '' : undefined}
      aria-description={probe ? '左右拖动图中探针，或使用控制舱调整对应参数' : undefined}
      onPointerDown={probe && ((e) => {
        if (e.button !== 0) return;
        const point = pointAt(e.currentTarget, e.clientX, e.clientY);
        if (!point) return;
        drag.current = probe.onMove;
        e.currentTarget.setPointerCapture(e.pointerId);
        if ((e.target as Element).closest('[data-probe-handle]')) return;
        drag.current(point.x, point.y);
      })}
      onPointerMove={probe && ((e) => {
        if (!drag.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const point = pointAt(e.currentTarget, e.clientX, e.clientY);
        if (point) drag.current(point.x, point.y);
      })}
      onLostPointerCapture={() => { drag.current = undefined; }}>
      <defs>
        <pattern id={gridId} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" className={styles.gridLine} />
        </pattern>
        <clipPath id={plotId}><rect width="400" height="240" /></clipPath>
      </defs>
      {scene.grid ? <rect width="400" height="240" fill={`url(#${gridId})`} /> : null}
      {scene.axes ? <g className={styles.axisLine}>
        <path d="M28 12V212H388" />
        <path d="M24 20L28 12L32 20M380 208L388 212L380 216" />
      </g> : null}
      <g clipPath={'url(#' + plotId + ')'}>
      {ghost?.map((path, index) => <polyline key={index} points={path.points.map(([x, y]) => x + ',' + y).join(' ')}
        fill="none" stroke={path.stroke ?? INDIGO} strokeWidth="1.5" strokeDasharray="4 4" opacity=".42" />)}
      {scene.rects?.map((rect, index) => {
        if (!allFinite(rect.x, rect.y, rect.width, rect.height)) return null;
        return <g key={`rect-${index}`}>
          <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height}
            fill={rect.fill ?? 'none'} stroke={rect.stroke ?? INDIGO}
            opacity={validNumber(rect.opacity, 1)} />
          <PrimitiveLabel x={rect.x + rect.width / 2} y={rect.y + rect.height / 2}
            text={rect.label} color={rect.stroke} />
        </g>;
      })}
      {scene.ellipses?.map((ellipse, index) => {
        if (!allFinite(ellipse.cx, ellipse.cy, ellipse.rx, ellipse.ry)) return null;
        return <g key={`ellipse-${index}`}>
          <ellipse cx={ellipse.cx} cy={ellipse.cy} rx={ellipse.rx} ry={ellipse.ry}
            fill={ellipse.fill ?? 'none'} stroke={ellipse.stroke ?? INDIGO}
            strokeDasharray={ellipse.dashed ? '5 4' : undefined} />
          <PrimitiveLabel x={ellipse.cx} y={ellipse.cy} text={ellipse.label} color={ellipse.stroke} />
        </g>;
      })}
      {scene.paths?.map((path, index) => {
        if (!path.points.length || !path.points.every(([x, y]) => allFinite(x, y))) return null;
        const last = path.points[path.points.length - 1];
        const data = path.points.map(([x, y], pointIndex) =>
          `${pointIndex === 0 ? 'M' : 'L'}${x} ${y}`).join(' ') + (path.closed ? ' Z' : '');
        return <g key={`path-${index}`}>
          <path d={data} fill={path.fill ?? 'none'} stroke={path.stroke ?? INDIGO}
            strokeWidth={validNumber(path.strokeWidth, 2)} strokeDasharray={path.dashed ? '6 4' : undefined}
            strokeLinecap="round" strokeLinejoin="round" />
          {last && showPathLabels ? <PrimitiveLabel x={last[0] + 5} y={last[1] - 5} text={path.label} color={path.stroke} /> : null}
        </g>;
      })}
      {scene.vectors?.map((vector, index) => {
        if (!allFinite(vector.x, vector.y, vector.dx, vector.dy)) return null;
        const endX = vector.x + vector.dx;
        const endY = vector.y + vector.dy;
        if (!allFinite(endX, endY)) return null;
        const length = Math.hypot(vector.dx, vector.dy);
        const color = vector.color ?? CORAL;
        const head = Math.min(10, length * 0.35);
        const unitX = length > 0 ? vector.dx / length : 0;
        const unitY = length > 0 ? vector.dy / length : 0;
        const arrow = length > 0
          ? `M${endX - unitX * head - unitY * head * 0.5} ${endY - unitY * head + unitX * head * 0.5}L${endX} ${endY}L${endX - unitX * head + unitY * head * 0.5} ${endY - unitY * head - unitX * head * 0.5}`
          : '';
        return <g key={`vector-${index}`} stroke={color} fill="none" strokeWidth="2" strokeLinecap="round">
          <line x1={vector.x} y1={vector.y} x2={endX} y2={endY} />
          {arrow ? <path d={arrow} /> : <circle cx={vector.x} cy={vector.y} r="2" fill={color} />}
          <PrimitiveLabel x={endX + 5} y={endY - 5} text={vector.label} color={color} />
        </g>;
      })}
      {scene.points?.map((point, index) => {
        if (!allFinite(point.x, point.y)) return null;
        const color = point.color ?? CORAL;
        return <g key={`point-${index}`}>
          <circle cx={point.x} cy={point.y} r={validNumber(point.radius, 4)}
            fill={point.hollow ? 'var(--paper-0)' : color} stroke={color} strokeWidth="2" />
          <PrimitiveLabel x={point.x + 7} y={point.y - 7} text={point.label} color={color} />
        </g>;
      })}
      {scene.labels?.map((label, index) => allFinite(label.x, label.y) ? <text key={`label-${index}`}
        x={label.x} y={label.y} fill={label.color ?? INK} fontSize={validNumber(label.size, 12)}
        textAnchor={label.anchor ?? 'start'} className={styles.sceneLabel}>{label.text}</text> : null)}
      </g>
      {xDomain?.length === 2 && [0, .25, .5, .75, 1].map((t) => <text key={t} x={35 + 345 * t} y="226" textAnchor="middle"
        fontSize="8" fill={MUTED} className={styles.probeLabel}>{Number((xDomain[0]! + (xDomain[1]! - xDomain[0]!) * t).toPrecision(3))}</text>)}
      {probe && <g data-probe-handle>
        <line x1={probe.point.x} y1="27" x2={probe.point.x} y2="212" stroke="#ea580c" strokeWidth="1" strokeDasharray="4 4" opacity=".65" />
        <line x1={probe.point.x} y1={probe.point.y} x2={labelX + 54} y2={labelY + 11} stroke="#ea580c" strokeWidth="1.2" />
        <circle cx={probe.point.x} cy={probe.point.y} r="5" fill="#ea580c" stroke="#fff" strokeWidth="1.5" />
        <rect x={labelX} y={labelY} width="110" height="22" rx="5" fill="#fff7ed" stroke="#fed7aa" />
        <text x={labelX + 55} y={labelY + 14.5} textAnchor="middle" fontSize="9.5" fill="#9a3412" className={styles.probeLabel}>{probe.text}</text>
      </g>}
    </svg>
  );
}

export function ScienceMiniDiagram({ diagram }: { diagram: ScienceDiagramKind }): JSX.Element {
  let content: ReactNode;
  switch (diagram) {
    case 'motion':
      content = <><path d="M12 45H138M18 50V7" stroke={MUTED} /><path d="M20 43Q70 -8 130 40" stroke={INDIGO} strokeWidth="2.5" />
        <circle cx="20" cy="43" r="4" fill={CORAL} /><circle cx="78" cy="17" r="4" fill={CORAL} /><path d="M111 25L130 40L107 38" stroke={INDIGO} /></>;
      break;
    case 'force':
      content = <><rect x="55" y="18" width="38" height="25" rx="3" fill={SOFT} stroke={INDIGO} />
        <path d="M74 17V3M69 8L74 3L79 8M54 31H23M30 25L23 31L30 37M94 31H126M119 25L126 31L119 37" stroke={CORAL} strokeWidth="2" /></>;
      break;
    case 'energy':
      content = <><path d="M17 47H134" stroke={MUTED} /><rect x="29" y="25" width="17" height="22" fill={INDIGO} opacity=".45" />
        <rect x="57" y="12" width="17" height="35" fill={INDIGO} opacity=".7" /><rect x="85" y="20" width="17" height="27" fill={CORAL} opacity=".65" />
        <path d="M111 13L124 25L111 37" stroke={CORAL} strokeWidth="2" /></>;
      break;
    case 'collision':
      content = <><rect x="27" y="21" width="29" height="20" rx="3" fill={INDIGO} opacity=".65" /><rect x="96" y="21" width="29" height="20" rx="3" fill={CORAL} opacity=".65" />
        <path d="M9 31H23M18 26L23 31L18 36M143 31H130M135 26L130 31L135 36" stroke={INK} strokeWidth="2" />
        <path d="M76 13L80 24L91 19L84 30L94 36L81 35L80 48L74 37L63 43L69 32L58 26L71 27Z" fill={SOFT} stroke={CORAL} /></>;
      break;
    case 'oscillation':
      content = <><path d="M10 29H140" stroke={MUTED} strokeDasharray="4 3" /><path d="M12 29C25 -3 38 -3 51 29S77 61 90 29S116 -3 136 29" stroke={INDIGO} strokeWidth="2.5" />
        <circle cx="51" cy="29" r="4" fill={CORAL} /></>;
      break;
    case 'field':
      content = <><circle cx="25" cy="28" r="10" fill={SOFT} stroke={INDIGO} /><circle cx="124" cy="28" r="10" fill={SOFT} stroke={CORAL} />
        <path d="M43 16H105M99 11L105 16L99 21M43 29H105M99 24L105 29L99 34M43 42H105M99 37L105 42L99 47" stroke={INDIGO} strokeWidth="1.7" /></>;
      break;
    case 'circuit':
      content = <><path d="M27 12H61L66 7L73 17L80 7L87 17L92 12H121V44H86M62 44H27V12" stroke={INDIGO} strokeWidth="2" />
        <path d="M65 35V51M83 35V51" stroke={CORAL} strokeWidth="3" /><circle cx="27" cy="28" r="4" fill={CORAL} /></>;
      break;
    case 'induction':
      content = <><path d="M18 14H130M18 44H130M79 10V48" stroke={INDIGO} strokeWidth="2.5" /><path d="M83 29H116M109 23L116 29L109 35" stroke={CORAL} strokeWidth="2" />
        <path d="M34 22V34M29 28H39M51 22V34M46 28H56" stroke={MUTED} /></>;
      break;
    case 'optics':
      content = <><ellipse cx="77" cy="28" rx="8" ry="23" fill={SOFT} stroke={INDIGO} />
        <path d="M10 10L77 25L140 9M10 28H140M10 46L77 31L140 47" stroke={CORAL} strokeWidth="1.7" /><path d="M77 3V53" stroke={MUTED} strokeDasharray="3 3" /></>;
      break;
    case 'thermal':
      content = <><path d="M24 48V8M18 48H139" stroke={MUTED} /><path d="M42 39C45 12 90 8 111 20C132 34 104 45 76 43C59 43 47 43 42 39Z" fill={SOFT} stroke={INDIGO} strokeWidth="2" />
        <path d="M106 14L113 20L105 23M48 33L42 39L50 41" stroke={CORAL} strokeWidth="2" /></>;
      break;
    case 'quantum':
      content = <><path d="M28 45H77M28 30H77M28 12H77" stroke={INDIGO} strokeWidth="2.5" /><path d="M53 43V15M48 21L53 15L58 21" stroke={CORAL} strokeWidth="2" />
        <path d="M91 38C98 25 105 51 112 38S126 25 136 38" stroke={CORAL} strokeWidth="2" /></>;
      break;
    case 'function':
      content = <><path d="M16 47H139M24 51V5" stroke={MUTED} /><path d="M25 42C45 46 49 9 70 12S92 48 132 18" stroke={INDIGO} strokeWidth="2.5" />
        <circle cx="70" cy="12" r="4" fill={CORAL} /></>;
      break;
    case 'limit':
      content = <><path d="M15 47H139M22 51V5" stroke={MUTED} /><path d="M23 43C52 40 56 19 72 20M82 20C100 20 107 12 134 10" stroke={INDIGO} strokeWidth="2.5" />
        <path d="M20 15H138M20 25H138" stroke={CORAL} strokeDasharray="4 3" /><circle cx="77" cy="20" r="5" fill="var(--paper-0)" stroke={CORAL} strokeWidth="2" /></>;
      break;
    case 'derivative':
      content = <><path d="M14 47H139M22 51V5" stroke={MUTED} /><path d="M24 43Q72 -7 132 31" stroke={INDIGO} strokeWidth="2.5" />
        <path d="M41 37L105 5" stroke={CORAL} strokeWidth="2" /><circle cx="75" cy="20" r="4" fill={CORAL} /></>;
      break;
    case 'integral':
      content = <><path d="M15 47H139M23 51V5" stroke={MUTED} /><path d="M25 43C52 44 61 9 87 13S112 33 134 19L134 47H25Z" fill={SOFT} />
        <path d="M25 43C52 44 61 9 87 13S112 33 134 19" stroke={INDIGO} strokeWidth="2.5" /><path d="M55 36V47M87 13V47M113 27V47" stroke={CORAL} /></>;
      break;
    case 'series':
      content = <><path d="M17 47H137" stroke={MUTED} /><rect x="26" y="10" width="13" height="37" fill={INDIGO} opacity=".8" /><rect x="48" y="20" width="13" height="27" fill={INDIGO} opacity=".65" />
        <rect x="70" y="28" width="13" height="19" fill={INDIGO} opacity=".5" /><rect x="92" y="34" width="13" height="13" fill={INDIGO} opacity=".35" />
        <path d="M26 12L55 20L77 27L99 31L126 34" stroke={CORAL} strokeWidth="2" /></>;
      break;
    case 'ode':
      content = <><path d="M15 47H139M23 51V5" stroke={MUTED} /><path d="M25 43C52 42 70 35 88 25S117 12 135 11" stroke={INDIGO} strokeWidth="2.5" />
        <path d="M25 43L49 39L72 33L94 23L115 16L135 13" stroke={CORAL} strokeDasharray="4 3" /><circle cx="94" cy="23" r="3" fill={CORAL} /></>;
      break;
    case 'contour':
      content = <><ellipse cx="70" cy="29" rx="48" ry="21" fill="none" stroke={INDIGO} /><ellipse cx="70" cy="29" rx="32" ry="13" fill="none" stroke={INDIGO} opacity=".7" />
        <ellipse cx="70" cy="29" rx="15" ry="6" fill={SOFT} stroke={INDIGO} /><path d="M71 29L119 8M112 8H119V15" stroke={CORAL} strokeWidth="2" /></>;
      break;
    case 'matrix':
      content = <><path d="M19 12H65V48H19ZM19 30H65M42 12V48" stroke={MUTED} fill="none" /><path d="M81 42L103 9L137 20L115 52Z" fill={SOFT} stroke={INDIGO} strokeWidth="2" />
        <path d="M67 29H80M75 24L80 29L75 34" stroke={CORAL} strokeWidth="2" /></>;
      break;
    case 'svd':
      content = <><circle cx="29" cy="28" r="18" fill={SOFT} stroke={INDIGO} /><ellipse cx="78" cy="28" rx="24" ry="11" fill={SOFT} stroke={INDIGO} />
        <ellipse cx="126" cy="28" rx="11" ry="24" transform="rotate(35 126 28)" fill={SOFT} stroke={CORAL} /><path d="M50 28H55M52 24L56 28L52 32M103 28H108M105 24L109 28L105 32" stroke={INK} /></>;
      break;
    case 'summary':
      content = <><rect x="27" y="5" width="94" height="47" rx="5" fill={SOFT} stroke={INDIGO} /><path d="M39 17L44 22L53 12M61 17H106M39 36L44 41L53 31M61 36H96" stroke={CORAL} strokeWidth="2" /></>;
      break;
    case 'source':
    default:
      content = <><rect x="48" y="9" width="52" height="38" rx="5" fill={SOFT} stroke={INDIGO} /><path d="M8 28H41M34 22L41 28L34 34M107 28H140M133 22L140 28L133 34" stroke={CORAL} strokeWidth="2" />
        <path d="M60 20H88M60 29H88M60 38H78" stroke={INDIGO} strokeWidth="2" /></>;
  }
  return <svg className={styles.mini} viewBox="0 0 148 56" aria-hidden="true" fill="none" strokeLinecap="round" strokeLinejoin="round">{content}</svg>;
}

function NumericControl({ spec, value, onChange }: {
  spec: PipelineControl;
  value: number;
  onChange?: (value: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <input type="number" value={draft} min={spec.min} max={spec.max} step={spec.step ?? 'any'}
    readOnly={!onChange} onBlur={() => setDraft(String(value))} onChange={(event) => {
      const input = event.currentTarget;
      setDraft(input.value);
      if (Number.isFinite(input.valueAsNumber) && input.validity.valid) onChange?.(input.valueAsNumber);
    }} />;
}

function ScienceFrameDetails({ frame }: { frame: ScienceFrame }): JSX.Element {
  return <section className={styles.frame}>
    <h4>{frame.title}</h4>
    {frame.summary ? <p className={styles.summary}>{frame.summary}</p> : null}
    <SciencePipelineScene scene={frame.scene} />
    {frame.metrics?.length ? <dl className={styles.metrics}>{frame.metrics.map((metric, index) =>
      <div key={`${metric.label}-${index}`} className={metric.emphasis ? styles.metricEmphasis : undefined}>
        <dt>{metric.label}</dt><dd>{metric.value}</dd>
      </div>)}
    </dl> : null}
    {frame.rows?.length ? <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={`${frame.title}明细`}>
      <table>
        {frame.columns?.length ? <thead><tr>{frame.columns.map((column, index) => <th key={index} scope="col">{column}</th>)}</tr></thead> : null}
        <tbody>{frame.rows.map((row, rowIndex) => <tr key={rowIndex} data-highlight={frame.highlightRows?.includes(rowIndex) || undefined}>
          {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
        </tr>)}</tbody>
      </table>
    </div> : null}
  </section>;
}

export interface ScienceStagePanelProps {
  node: CanvasNode;
  stage: ScienceStage;
  output: ScienceEvaluation | null;
  onParams?: (patch: Record<string, number>) => void;
  onText?: (text: string) => void;
  timeline?: { step: number; last: number; onStep: (step: number) => void };
  subject: 'physics' | 'calculus' | 'business';
}

export function ScienceStagePanel(props: ScienceStagePanelProps): JSX.Element {
  const { node, stage, output, onParams, onText, timeline, subject } = props;
  const [localStep, setLocalStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frames = output?.result.frames ?? [];
  const requestedStep = timeline?.step ?? localStep;
  const finiteStep = Number.isFinite(requestedStep) ? Math.round(requestedStep) : 0;
  const index = frames.length > 0 ? Math.max(0, Math.min(frames.length - 1, finiteStep)) : 0;
  const setStep = timeline?.onStep ?? setLocalStep;
  const frame = frames[index];
  const text = node.text ?? stage.text ?? '';
  return <div className={styles.detail} data-science-stage={stage.id} data-science-subject={subject}>
    {stage.textLabel ? <label className={styles.control}>{stage.textLabel}
      <textarea value={text} readOnly={!onText} rows={text.includes('\n') ? 5 : 2} maxLength={8000}
        onChange={(event) => { setPlaying(false); onText?.(event.currentTarget.value); }} />
    </label> : null}
    {stage.presets?.length ? <div className={styles.presets} aria-label="场景预设">{stage.presets.map((preset, index) =>
      <button type="button" key={`${preset.label}-${index}`} disabled={!onParams && !(onText && preset.text !== undefined)}
        onClick={() => {
          setPlaying(false);
          onParams?.(preset.params);
          if (preset.text !== undefined) onText?.(preset.text);
        }}>{preset.label}</button>)}
    </div> : null}
    {stage.controls?.length ? <div className={styles.controls}>{stage.controls.map((control) => {
      const value = node.params[control.key] ?? control.value;
      return <label key={control.key} className={styles.control}>{control.label}
        {control.options ? <select value={value} disabled={!onParams} onChange={(event) => {
          setPlaying(false);
          onParams?.({ [control.key]: Number(event.currentTarget.value) });
        }}>{control.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          : <NumericControl spec={control} value={value} onChange={onParams && ((next) => {
            setPlaying(false);
            onParams({ [control.key]: next });
          })} />}
      </label>;
    })}</div> : null}
    {output?.error ? <p className={styles.error} role="status">{output.error}</p> : null}
    {frames.length > 0 ? <Timeline total={frames.length} index={index} playing={playing}
      onIndex={setStep} onPlaying={setPlaying} /> : null}
    {frame ? <ScienceFrameDetails frame={frame} /> : !output?.error ?
      <p className={styles.waiting} role="status">等待有效输入或计算帧。</p> : null}
  </div>;
}

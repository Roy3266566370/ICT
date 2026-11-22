import { useEffect, useState, type ReactNode } from 'react';
import type { NodeBodyProps } from './nodes.tsx';
import { CheckOriginalButton, Timeline } from './Lab408SimNodes';
import { find408Stage } from './lab408Pipeline.ts';
import type { DiagramKind, PipelineControl, PipelineFrame } from './lab408PipelineTypes.ts';
import styles from './lab408Pipeline.module.css';

const colors = ['#3159ae', '#a54724', '#087b6d', '#7750a0', '#815d20'];

export function Lab408Diagram({ diagram }: { diagram: DiagramKind }): JSX.Element {
  let content: ReactNode;
  switch (diagram) {
    case 'bits':
      content = [0, 1, 2].map((i) => <rect key={i} x={14 + i * 40} y={20} width="36" height="17" rx="3" fill={colors[i]} opacity=".7" />);
      break;
    case 'grid':
      content = Array.from({ length: 12 }, (_, i) => <rect key={i} x={27 + (i % 4) * 24} y={8 + Math.floor(i / 4) * 14}
        width="19" height="11" rx="2" fill={colors[i % 4]} opacity={i === 6 ? '.95' : '.25'} />);
      break;
    case 'pipeline':
      content = Array.from({ length: 5 }, (_, i) => <rect key={i} x={12 + i * 25} y={7 + i * 8}
        width="22" height="10" rx="2" fill={colors[i]} opacity=".75" />);
      break;
    case 'chart':
      content = <><path d="M16 8v39h117" stroke="#9ba9bc" /><path d="M19 43l16-14 13-11 4 13 16-10 15-12 5 17 17-8 23-10"
        stroke={colors[2]} strokeWidth="2.7" strokeLinejoin="round" /></>;
      break;
    case 'tree':
    case 'graph':
    case 'network': {
      const points = diagram === 'tree' ? [[74, 8], [43, 25], [105, 25], [28, 46], [57, 46], [121, 46]]
        : [[27, 30], [50, 9], [83, 18], [82, 45], [123, 28]];
      const edges = diagram === 'tree' ? [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5]] : [[0, 1], [0, 3], [1, 2], [2, 3], [2, 4], [3, 4]];
      content = <><g stroke="#99a6bd" strokeWidth="1.5">{edges.map(([a, b]) =>
        <line key={`${a}-${b}`} x1={points[a!]![0]} y1={points[a!]![1]} x2={points[b!]![0]} y2={points[b!]![1]} />)}</g>
        {points.map(([x, y], i) => <circle key={x} cx={x} cy={y} r="5.5" fill={colors[i % 3]} opacity=".75" />)}</>;
      break;
    }
    case 'switch':
      content = <><path d="M17 28h27m60 0h27M44 28l54-15" stroke={colors[1]} strokeWidth="3" strokeLinecap="round" />
        <circle cx="44" cy="28" r="5" fill={colors[1]} /><circle cx="104" cy="28" r="5" fill="#8493ac" /></>;
      break;
    case 'summary':
      content = <>{[22, 37, 29, 43].map((h, i) => <rect key={i} x={32 + i * 22} y={47 - h} width="16" height={h}
        rx="2" fill={colors[i]} opacity=".65" />)}<path d="M22 48h105" stroke="#9ba9bc" /></>;
      break;
    default:
      content = <>{[0, 1, 2, 3, 4].map((i) => <rect key={i} x={25 + i * 20} y="20" width="17" height="16" rx="3"
        fill={colors[i % 3]} opacity={i === 2 ? '.85' : '.3'} />)}
        {diagram === 'queue' || diagram === 'source' ? <path d="M4 28h16m-5-5 5 5-5 5m111-5h15m-5-5 5 5-5 5"
          stroke="#6d7d97" strokeWidth="1.5" /> : null}</>;
  }
  return <svg viewBox="0 0 148 56" aria-hidden="true" fill="none" strokeLinecap="round">{content}</svg>;
}

function FrameGraph({ graph }: { graph: NonNullable<PipelineFrame['graph']> }): JSX.Element {
  const positions = new Map(graph.nodes.map((node) => [node.id, { x: 24 + node.x * 3.52, y: 24 + node.y * 1.92 }]));
  return (
    <svg className={styles.graph} viewBox="0 0 400 240" role="img" aria-label="当前帧结构图">
      {graph.edges.map((edge, index) => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return null;
        return <g key={index}>
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={edge.active ? colors[1] : '#aebbd0'} strokeWidth={edge.active ? 3 : 1.6} />
          {edge.label && <text x={(from.x + to.x) / 2 + 4} y={(from.y + to.y) / 2 - 4}
            className={styles.edgeLabel}>{edge.label}</text>}
        </g>;
      })}
      {graph.nodes.map((node) => {
        const pos = positions.get(node.id)!;
        return <g key={node.id} transform={`translate(${pos.x}, ${pos.y})`}>
          <circle r="13" fill={node.active ? '#f9d7b9' : '#edf4ff'} stroke={node.active ? colors[1] : colors[0]} />
          <text textAnchor="middle" dominantBaseline="central">{node.label}</text>
        </g>;
      })}
    </svg>
  );
}

function FrameChart({ series }: { series: NonNullable<PipelineFrame['series']> }): JSX.Element {
  const values = series.flatMap(({ values: points }) => points.filter(Number.isFinite));
  const low = Math.min(0, ...values);
  const high = Math.max(1, ...values);
  const length = Math.max(2, ...series.map((line) => line.values.length));
  const y = (v: number) => 140 - 124 * (v - low) / (high - low);
  return (
    <figure className={styles.chart}>
      <svg viewBox="0 0 400 160" role="img" aria-label="当前帧数据曲线">
        <path d="M44 12v128h337" fill="none" stroke="#aebbd0" />
        <text x="37" y="18" textAnchor="end">{Number(high.toPrecision(3))}</text>
        <text x="37" y="142" textAnchor="end">{Number(low.toPrecision(3))}</text>
        {series.map(({ label, values: points }, index) => {
          const color = colors[index % colors.length];
          const coords = points.map((v, i) => ({ x: 45 + 333 * i / (length - 1), y: y(v) }));
          return <g key={label}>
            <polyline points={coords.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth="2" />
            {coords.length === 1 && <circle cx={coords[0]!.x} cy={coords[0]!.y} r="3" fill={color} />}
          </g>;
        })}
      </svg>
      <figcaption>{series.map(({ label }, i) =>
        <span key={label} style={{ color: colors[i % colors.length] }}>● {label}</span>)}</figcaption>
    </figure>
  );
}

function FrameGantt({ timeline }: { timeline: NonNullable<PipelineFrame['timeline']> }): JSX.Element {
  const end = Math.max(1, ...timeline.flatMap((lane) => lane.segments.map(({ end }) => end)));
  const labels = [...new Set(timeline.flatMap((lane) => lane.segments.map(({ label }) => label)))];
  return (
    <div className={styles.gantt} aria-label="甘特图">
      {timeline.map(({ label, segments }) => <div key={label}>
        <strong>{label}</strong>
        <div className={styles.track}>
          {segments.map((span) => <span key={`${span.start}-${span.end}`}
            title={`${span.label} · ${span.start}–${span.end}`}
            style={{ left: `${span.start * 100 / end}%`, width: `${(span.end - span.start) * 100 / end}%`,
              background: colors[labels.indexOf(span.label) % colors.length] }}>
            {span.label}
          </span>)}
        </div>
      </div>)}
    </div>
  );
}

function FrameDetails({ frame }: { frame: PipelineFrame }): JSX.Element {
  const state = frame.title.startsWith('Hit') ? 'hit' : frame.title.startsWith('Miss') ? 'miss' : undefined;
  return (
    <div className={styles.frame} data-cache-state={state}>
      <h4>{frame.title}</h4>
      {frame.summary && <p>{frame.summary}</p>}
      {frame.graph && <FrameGraph graph={frame.graph} />}
      {frame.series?.length ? <FrameChart series={frame.series} /> : null}
      {frame.timeline?.length ? <FrameGantt timeline={frame.timeline} /> : null}
      {frame.rows?.length ? (
        <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={`${frame.title}明细`}>
          <table>
            {frame.columns && <thead><tr>{frame.columns.map((column, i) => <th key={i} scope="col">{column}</th>)}</tr></thead>}
            <tbody>{frame.rows.map((row, i) => <tr key={i} data-highlight={frame.highlightRows?.includes(i) || undefined}>
              {row.map((cell, j) => <td key={j}>{cell}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

const subjects = {
  dsTraversal: 'algorithm', avl: 'algorithm', kmpSort: 'algorithm', graphAlgo: 'algorithm',
  cacheSimLab: 'computer_organization', pipelineLab: 'computer_organization', ieee754Lab: 'computer_organization',
  cpuScheduleLab: 'operating_system', pageReplace: 'operating_system', pageReplaceOriginal: 'operating_system', bankerLab: 'operating_system',
  tcpCongestionLab: 'computer_network', slidingWindowLab: 'computer_network', ipSubnet: 'computer_network',
} as const;

function OriginalQuestion({ pipeline }: { pipeline: keyof typeof subjects }): JSX.Element {
  const [raw, setRaw] = useState('');
  return <details className={styles.original}>
    <summary>核对题目原文</summary>
    <label>粘贴完整题干
      <textarea rows={4} value={raw} onChange={(event) => setRaw(event.target.value)} />
    </label>
    <CheckOriginalButton key={raw} subject={subjects[pipeline]} text={raw} />
    <a href="/labs">从截图或文件导入题目 →</a>
  </details>;
}

function NumericControl({ spec, value, onChange }: {
  spec: PipelineControl; value: number; onChange?: (value: number) => void;
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

export function Lab408PipelineNode({ node, self, onParams, onText, timeline }: NodeBodyProps): JSX.Element {
  const [localStep, setLocalStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [importError, setImportError] = useState('');
  const definition = find408Stage(node);
  if (!definition) return <p role="status">这个 408 模块的配置无法读取。</p>;
  const { stage, pipeline } = definition;
  const output = self?.kind === 'lab408Data' ? self : null;
  const frames = output?.result.frames ?? [];
  const index = Math.min(Math.max(0, frames.length - 1), timeline?.step ?? localStep);
  const setStep = timeline?.onStep ?? setLocalStep;
  const text = node.text ?? stage.text ?? '';
  const frame = frames[index];
  return (
    <div className={styles.detail} data-408-stage={stage.id}>
      {stage.textLabel && <label className={styles.control}>{stage.textLabel}
        <textarea value={text} readOnly={!onText} rows={text.includes('\n') ? 5 : 2} maxLength={8000}
          onChange={(event) => { setPlaying(false); onText?.(event.target.value); }} />
      </label>}
      {!stage.inputs?.length && stage.textLabel && onText ? <label className={styles.file}>导入纯文本数据（TXT / CSV）
        <input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file) return;
          setImportError('');
          if (file.size > 32000) { setImportError('文件过大，请保留当前模块需要的输入。'); return; }
          void file.text().then((value) => {
            if (value.length > 8000) throw new Error();
            setPlaying(false);
            onText(value.replace(/^\uFEFF/, ''));
          }).catch(() => setImportError('无法读取输入，文本长度上限为 8000 字符。'));
        }} />
      </label> : null}
      {importError && <p className={styles.error} role="status">{importError}</p>}
      {stage.controls?.length ? <div className={styles.controls}>{stage.controls.map((control) => (
        <label key={control.key} className={styles.control}>{control.label}
          {control.options ? <select value={node.params[control.key] ?? control.value} disabled={!onParams}
            onChange={(event) => { setPlaying(false); onParams?.({ [control.key]: Number(event.target.value) }); }}>
            {control.options.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select> : <NumericControl spec={control} value={node.params[control.key] ?? control.value}
            onChange={onParams && ((value) => { setPlaying(false); onParams({ [control.key]: value }); })} />}
        </label>
      ))}</div> : null}
      {stage.actions?.length && onText ? <div className={styles.actions}>{stage.actions.map(({ label, append }) =>
        <button type="button" key={label} onClick={() => {
          setPlaying(false);
          onText(text.trim() ? text.trimEnd() + (/^[\s,;，；]/.test(append) ? append : ' ' + append)
            : append.trim().replace(/^[,;，；]+\s*/, ''));
          setStep(timeline ? timeline.last + 1 : frames.length);
        }}>{label}</button>)}</div> : null}
      {output?.error ? <p className={styles.error} role="status">{output.error}</p> : null}
      {frame ? <>
        <Timeline total={frames.length} index={index} playing={playing} onIndex={setStep} onPlaying={setPlaying} />
        <FrameDetails frame={frame} />
      </> : null}
      {onText && !stage.inputs?.length && Object.hasOwn(subjects, pipeline) && <OriginalQuestion pipeline={pipeline as keyof typeof subjects} />}
    </div>
  );
}

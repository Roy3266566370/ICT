import { useEffect, useId, useRef, useState } from 'react';
import { DF_CANDIDATES } from './deepFirst';
import { seeded } from './deepAdvanced';
import type { NodeBodyProps, NodeDef } from './nodes';
import { isStudyStage, studyStages, type StudyStage } from './studyStages';
import styles from './deepCore.module.css';

const curveColors = ['#13766d', '#b54f29', '#6c55aa', '#2864a4'];
const curveNumber = (value: number) => Number(value.toPrecision(4)).toString();

function StudyCurve({ node, values }: NodeBodyProps) {
  const fillId = useId();
  const [sample, setSample] = useState<number | null>(null);
  const value = values.in;
  const series = value?.kind === 'series' ? value : null;
  const title = node.text || series?.title || studyStages.studyCurveView.title;
  const lines = series ? [{ name: series.title, values: series.values }, ...(series.secondary ?? [])]
    : value?.kind === 'tensor2d' ? value.data.map((row, i) => ({ name: `序列 ${i + 1}`, values: row })) : [];
  const data = lines.flatMap(line => line.values);
  if (!data.length) return <p role="status">暂无曲线数据</p>;

  const count = lines.reduce((length, line) => Math.max(length, line.values.length), 0);
  const label = (i: number) => series?.labels[i] ?? String(i + 1);
  const [min, max] = data.reduce(([lo, hi], n) => [Math.min(lo, n), Math.max(hi, n)], [Infinity, -Infinity]);
  const magnitude = Math.max(Math.abs(min!), Math.abs(max!), Number.MIN_VALUE);
  const low = min! / magnitude, high = max! / magnitude;
  const left = 55, right = 350, top = 9, bottom = 62, width = right - left;
  const x = (i: number) => count === 1 ? right : left + i / (count - 1) * width;
  const y = (n: number) => (high === low ? (top + bottom) / 2 : bottom - (n / magnitude - low) / (high - low) * (bottom - top));
  const index = Math.min(sample ?? count - 1, count - 1);
  const points = lines.map(line => line.values.map((n, i) => `${x(i)},${y(n)}`).join(' '));
  const observations = lines.map(line => {
    const position = sample === null ? line.values.length - 1 : index;
    return { position, value: line.values[position] };
  });
  const readout = observations.map(({ value }) => value === undefined ? '—' : curveNumber(value));
  return <figure className={styles.studyCurve}>
    <svg viewBox="0 0 360 85" width="100%" role="slider" tabIndex={0}
      aria-label={title} aria-valuemin={1} aria-valuemax={count} aria-valuenow={index + 1}
      aria-valuetext={`${label(index)} · ${readout.join(' / ')}`}
      onKeyDown={(event) => {
        const navigation: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1,
          ArrowDown: index - 1, ArrowUp: index + 1, Home: 0, End: count - 1 };
        const next = navigation[event.key];
        if (next === undefined) return;
        event.preventDefault();
        setSample(Math.max(0, Math.min(count - 1, next)));
      }}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const offset = ((event.clientX - rect.left) / rect.width * 360 - left) / width;
        setSample(Math.max(0, Math.min(count - 1, Math.round(offset * (count - 1)))));
      }}
      onPointerLeave={() => setSample(null)} onBlur={() => setSample(null)}>
      <defs><linearGradient id={fillId} x2="0" y2="1">
        <stop offset="0%" stopColor={curveColors[0]} stopOpacity=".24" />
        <stop offset="100%" stopColor={curveColors[0]} stopOpacity=".02" />
      </linearGradient></defs>
      <path d={`M${left} ${top}H${right}M${left} ${bottom}H${right}`} stroke="#cbd6d5" />
      <text x={left - 5} y={top + 3} textAnchor="end">{curveNumber(max!)}</text>
      <text x={left - 5} y={bottom + 3} textAnchor="end">{curveNumber(min!)}</text>
      {lines.length === 1 && count > 1 &&
        <polygon points={`${left},${bottom} ${points[0]} ${right},${bottom}`} fill={`url(#${fillId})`} />}
      <path d={`M${x(index)} ${top}V${bottom}`} stroke="#819291" strokeDasharray="2 3" />
      {lines.map((line, i) => {
        const color = curveColors[i % curveColors.length];
        const { position, value: point } = observations[i]!;
        return <g key={i}>
          <polyline points={points[i]} fill="none" stroke={color} strokeWidth="1.8" />
          {point !== undefined && <circle cx={x(position)} cy={y(point)} r="2.8" fill={color} />}
        </g>;
      })}
      {count > 1 && <text x={left} y="78">{label(0)}</text>}
      <text x={right} y="78" textAnchor="end">{label(count - 1)}</text>
    </svg>
    <figcaption>
      <span>{sample === null ? '末值' : label(index)}{series?.unit ? ` · ${series.unit}` : ''}</span>
      {lines.map((line, i) => <span key={i} style={{ color: curveColors[i % curveColors.length] }}>
        {lines.length > 1 && `${line.name} `}<b>{readout[i]}</b>
      </span>)}
    </figcaption>
  </figure>;
}

function OptimizerPlayback({ values, onLive }: NodeBodyProps) {
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<number | null>(null);
  const live = useRef(onLive);
  live.current = onLive;
  const limit = values['步数']?.kind === 'scalar' ? Math.max(0, Math.min(200, Math.round(values['步数'].v))) : null;
  const inputs = studyStages.studyOptim.inputs.map(({ id }) => {
    const value = values[id];
    return value?.kind === 'scalar' ? value.v : null;
  });
  const linked = inputs.every((value) => value !== null);
  const signature = JSON.stringify(inputs);
  useEffect(() => { setRunning(false); setStep(null); }, [signature]);
  useEffect(() => {
    if (!running || limit === null) return;
    const timer = window.setInterval(() => setStep((previous) => Math.min(limit, (previous ?? 0) + 1)), 45);
    return () => window.clearInterval(timer);
  }, [running, limit]);
  useEffect(() => { if (step !== null && step >= (limit ?? 0)) setRunning(false); }, [step, limit]);
  useEffect(() => { live.current?.({ step: { kind: 'scalar', v: step ?? -1 } }); }, [step, signature]);
  if (!linked) return <p role="status">请连接地形、起点、学习率和步数。</p>;
  return <div>
    <output>第 {step ?? limit} / {limit} 步</output>
    <div>
      <button type="button" disabled={!limit} onClick={() => {
        if (running) { setRunning(false); return; }
        if (step === null || step >= (limit ?? 0)) setStep(0);
        setRunning(true);
      }}>{running ? '暂停赛跑' : '播放赛跑'}</button>
      <button type="button" onClick={() => { setRunning(false); setStep(null); }}>显示完整轨迹</button>
    </div>
  </div>;
}

function StudyStageBody(props: NodeBodyProps) {
  const { node, values, self, onParams, inCard } = props;
  if (!isStudyStage(node.type)) return null;
  const stage = studyStages[node.type];
  if (node.type === 'studyOptim') return <OptimizerPlayback {...props} />;
  if (node.type === 'studyCurveView') return <StudyCurve {...props} />;
  if (node.type === 'studyTokenView') {
    const probabilities = values.in?.kind === 'tensor2d' ? values.in.data : [];
    if (!probabilities.length || probabilities[0]?.length !== DF_CANDIDATES.length)
      return <p role="status">请连接采样概率</p>;
    const random = seeded(20261120);
    return <ol className={props.displayContext === 'cockpit' ? styles.tokenFlow : undefined}
      aria-label="按当前步数生成的词元">{probabilities.map((row, i) => {
      const sample = random();
      let cumulative = 0;
      const token = row.findIndex((p) => { cumulative += p; return sample < cumulative; });
      return <li key={i}>{DF_CANDIDATES[token < 0 ? row.length - 1 : token]}</li>;
    })}</ol>;
  }
  if (node.type === 'studyStatsView') {
    return <table><thead><tr><th>分支 / 层</th><th>输出方差</th><th>输入梯度 L2</th></tr></thead>
      <tbody>{stage.inputs.map(({ id }) => {
        const value = values[id];
        const stats = value?.kind === 'tensor2d' ? value.data[0] : undefined;
        return <tr key={id}><th scope="row">{id}</th><td>{stats?.[0]?.toPrecision(4) ?? '—'}</td>
          <td>{stats?.[1]?.toPrecision(4) ?? '—'}</td></tr>;
      })}</tbody></table>;
  }
  if (node.type === 'studyCloudPlot' || node.type === 'studyVectorPlot') {
    const coordinates = values.in?.kind === 'tensor2d' && values.in.data[0]?.length === 2 ? values.in.data : [];
    const vectors = values.vectors?.kind === 'tensor2d' && values.vectors.data[0]?.length === 2 ? values.vectors.data : [];
    if (!coordinates.length || (node.type === 'studyVectorPlot' && vectors.length !== coordinates.length)) {
      return <p role="status">请连接匹配的二维坐标和向量</p>;
    }
    const extent = Math.max(1, ...coordinates.flat().map(Math.abs));
    const amplitude = Math.max(1, ...vectors.flat().map(Math.abs));
    const markerId = `arrow-${node.id}`;
    return <svg viewBox="0 0 300 210" width="100%" role="img" aria-label={stage.title}>
      <defs><marker id={markerId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#bd552d" /></marker></defs>
      <path d="M0 105h300M150 0v210" stroke="#93a0ac" />
      {coordinates.map(([x, y], i) => {
        const px = 150 + (x ?? 0) / extent * 112, py = 105 - (y ?? 0) / extent * 78;
        const vector = vectors[i];
        return <g key={i}><circle cx={px} cy={py} r="3" fill="#247398" />
          {vector && <line x1={px} y1={py} x2={px + vector[0]! / amplitude * 23}
            y2={py - vector[1]! / amplitude * 23} stroke="#bd552d" markerEnd={`url(#${markerId})`} />}</g>;
      })}
    </svg>;
  }
  if (node.type === 'studyBars') {
    const data = values.in?.kind === 'tensor2d' ? values.in.data : null;
    if (!data) return <p role="status">请连接数值输入</p>;
    const bars = data.length === 1 ? data[0]! : data.map((row) => row.at(-1)!);
    const maximum = Math.max(1e-9, ...bars.map(Math.abs));
    return <svg viewBox="0 0 300 160" width="100%" role="img" aria-label={node.text || stage.title}>
      <path d="M0 75h300" stroke="#93a0ac" />
      {bars.map((v, i) => <g key={i}><rect x={i * 300 / bars.length + 3} y={75 - Math.max(0, v) / maximum * 62}
        width={300 / bars.length - 6} height={Math.abs(v) / maximum * 62} fill={v >= 0 ? '#247398' : '#bd552d'}>
        <title>{i + 1}: {v.toPrecision(4)}</title></rect>
        <text textAnchor="middle" x={(i + .5) * 300 / bars.length} y="153" fontSize="11">{i + 1}</text></g>)}
    </svg>;
  }
  if (node.type === 'studyTrajectory') {
    const colors = ['#c95734', '#267da8', '#8755b8', '#178766'];
    const series = stage.inputs.map(({ id }) => {
      const value = values[id];
      return { id, points: value?.kind === 'tensor2d' ? value.data : [] };
    });
    const extent = Math.max(1, ...series.flatMap((line) => line.points.flat().map(Math.abs)));
    return <div>
      <svg viewBox="0 0 300 180" width="100%" role="img" aria-label="四种优化器的二维轨迹">
        <path d="M0 90H300M150 0V180" stroke="#84949d" />
        {series.map(({ id, points }, i) => <polyline key={id} fill="none" stroke={colors[i]} strokeWidth="2"
          points={points.map(([x, y]) => `${150 + (x ?? 0) / extent * 135},${90 - (y ?? 0) / extent * 75}`).join(' ')} />)}
      </svg>
      {series.map(({ id }, i) => <small key={id} style={{ color: colors[i], marginRight: 8 }}>{id}</small>)}
      {!series.some(({ points }) => points.length) && <p role="status">请连接有效优化轨迹</p>}
    </div>;
  }
  const unconnected = stage.inputs.filter((port) => !values[port.id] && node.params[port.id] === undefined);
  return <div>
    {stage.inputs.map((port) => {
      const value = values[port.id];
      if (!value && node.params[port.id] !== undefined && port.kind === 'scalar' && !inCard) {
        return <label key={port.id}>{port.label} <input type="number" step="any" value={node.params[port.id]}
          onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) onParams?.({ [port.id]: event.target.valueAsNumber }); }} /></label>;
      }
      return <div key={port.id}>{port.label} · {value?.kind === 'tensor2d'
        ? `${value.data.length}×${value.data[0]?.length}`
        : value?.kind === 'scalar' ? value.v.toPrecision(3)
          : value?.kind === 'dataset2d' ? `${value.points.length} 点`
            : node.params[port.id] ?? '未连接或上游无输出'}</div>;
    })}
    {unconnected.length > 0 ? <small role="status">等待：{unconnected.map((item) => item.label).join('、')}</small>
      : self?.kind === 'tensor2d' ? <small>输出 {self.data.length}×{self.data[0]?.length}</small>
        : stage.outputs.some((port) => port.id === 'out') && <small role="status">输入尺寸或取值不兼容</small>}
  </div>;
}

export const studyNodeDefs = Object.fromEntries(Object.entries(studyStages).map(([type, spec]) => {
  const isView = spec.outputs.length === 0;
  const cockpitWeight = type === 'studyTrajectory' ? 'hero'
    : type === 'studyCloudPlot' || type === 'studyVectorPlot' ? 'standard' : 'compact';
  return [type, {
    ...spec, badge: isView ? '视图' : '变换', width: 200, Body: StudyStageBody,
    ...(isView ? { cockpitWeight } : {}),
  } satisfies NodeDef];
})) as Partial<Record<StudyStage, NodeDef>>;

import { useEffect, useRef, useState } from 'react';
import { DF_CANDIDATES } from './deepFirst';
import { seeded } from './deepAdvanced';
import type { NodeBodyProps, NodeDef } from './nodes';
import { isStudyStage, studyStages, type StudyStage } from './studyStages';

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
  const { node, values, self, onParams } = props;
  if (!isStudyStage(node.type)) return null;
  const stage = studyStages[node.type];
  if (node.type === 'studyOptim') return <OptimizerPlayback {...props} />;
  if (node.type === 'studyTokenView') {
    const probabilities = values.in?.kind === 'tensor2d' ? values.in.data : [];
    if (!probabilities.length || probabilities[0]?.length !== DF_CANDIDATES.length)
      return <p role="status">请连接采样概率</p>;
    const random = seeded(20261120);
    return <ol aria-label="按当前步数生成的词元">{probabilities.map((row, i) => {
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
      if (!value && node.params[port.id] !== undefined && port.kind === 'scalar') {
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

export const studyNodeDefs = Object.fromEntries(Object.entries(studyStages).map(([type, spec]) => [
  type, { ...spec, badge: '变换', width: 200, Body: StudyStageBody } satisfies NodeDef,
])) as Partial<Record<StudyStage, NodeDef>>;

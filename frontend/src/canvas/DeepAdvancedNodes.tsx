import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeBodyProps, NodeDef } from './nodes.tsx';
import type { CanvasNode, NodeType, PortSpec } from './types.ts';
import { advancedSnapshot, bounded, type Matrix, type AdvancedSnapshot } from './deepAdvanced.ts';
import styles from './deepAdvanced.module.css';

type Control = [key: string, label: string, initial: number, min: number, max: number, step: number];
const controls: Partial<Record<NodeType, Control[]>> = {
  svmLab: [['control', 'C · 平均 hinge 惩罚', 2, 0.01, 20, 0.1], ['steps', '初始优化步数', 100, 0, 800, 10], ['quadratic', '特征：0 线性 / 1 二次', 0, 0, 1, 1]],
  resnetLab: [['control', 'W 增益', 0.65, 0.05, 2, 0.05], ['depth', '层数', 6, 1, 12, 1], ['norm', '残差归一化：0 无 / 1 BN / 2 LN', 2, 0, 2, 1]],
  sequenceMemory: [['recurrent', 'RNN 循环权重 w', 0.7, -1.5, 1.5, 0.05], ['control', 'LSTM 遗忘门 bias', 2, -5, 5, 0.1]],
  multiheadLab: [['mode', '位置：0 Sinusoid / 1 RoPE', 1, 0, 1, 1], ['control', '整体位置偏移', 0, -20, 20, 1], ['head', 'attention 输出头', 0, 0, 1, 1]],
  autoencoderLab: [['control', 'InfoNCE 温度 τ', 0.5, 0.05, 5, 0.05], ['angle', 'AE 子空间旋转角', 0, -3.14, 3.14, 0.05], ['ax', 'Anchor x', 0.4, -3, 3, 0.1], ['ay', 'Anchor y', 0.3, -3, 3, 0.1]],
  diffusionLab: [['control', '扩散时间 t', 0.4, 0, 4, 0.02], ['swiss', '先验：0 双峰 / 1 Swiss roll', 0, 0, 1, 1], ['seed', '随机 seed', 7, 0, 10000, 1], ['reverse', '显示一次反向步：0 否 / 1 是', 0, 0, 1, 1]],
  qLearningLab: [['mode', '算法：0 Q-learning / 1 REINFORCE', 0, 0, 1, 1], ['control', '探索率 ε（仅 Q）', 0.2, 0, 1, 0.05], ['alpha', '学习率 α', 0.15, 0.001, 1, 0.01], ['gamma', '折扣 γ', 0.95, 0, 1, 0.01], ['episodes', '初始回合数', 30, 0, 200, 5], ['seed', '随机 seed', 7, 0, 10000, 1]],
};
export function deepAdvancedDefaults(type: NodeType): Record<string, number> | null { const c = controls[type]; return c ? Object.fromEntries(c.map(([key, , value]) => [key, value])) : null; }
const fmt = (x: number) => Number.isFinite(x) ? Math.abs(x) > 1000 || (x !== 0 && Math.abs(x) < 0.001) ? x.toExponential(2) : x.toFixed(3) : '非有限';
const colors = ['#5368bb', '#d37535', '#258266', '#98638b'];
function Heatmap({ label, data }: { label: string; data: Matrix }) {
  const [selected, setSelected] = useState<[number, number]>([0, 0]); const max = Math.max(1e-8, ...data.flat().map(Math.abs)), cols = Math.max(1, ...data.map(r => r.length));
  return <figure className={styles.figure}><figcaption>{label}</figcaption><div className={styles.heatmap} style={{ gridTemplateColumns: `repeat(${cols},1fr)` }}>{data.flatMap((row, i) => Array.from({ length: cols }, (_, j) => <button type="button" key={`${i}-${j}`} aria-label={`${label} 行${i} 列${j}: ${fmt(row[j] ?? 0)}`} title={`[${i},${j}] ${fmt(row[j] ?? 0)}`} style={{ background: `${(row[j] ?? 0) >= 0 ? '#5368bb' : '#d37535'}${Math.round(35 + Math.abs(row[j] ?? 0) / max * 210).toString(16).padStart(2, '0')}` }} onClick={() => setSelected([i, j])}>{cols <= 4 ? fmt(row[j] ?? 0) : ''}</button>))}</div><small>蓝正 / 橙负 · 范围 ±{fmt(max)} · [{selected.join(',')}] = {fmt(data[selected[0]]?.[selected[1]] ?? 0)}</small></figure>;
}
function Curve({ label, data }: { label: string; data: number[] }) {
  const min = Math.min(0, ...data), max = Math.max(1e-8, ...data), range = max - min;
  return <figure className={styles.figure}><figcaption>{label} · 末值 {fmt(data.at(-1) ?? 0)}</figcaption><svg viewBox="0 0 340 86" role="img" aria-label={label}><text x="1" y="12">{fmt(max)}</text><text x="1" y="75">{fmt(min)}</text><line x1="65" x2="330" y1="72" y2="72" stroke="#b8bac5" /><polyline fill="none" stroke="#5368bb" strokeWidth="2" points={data.map((v, i) => `${65 + i / Math.max(1, data.length - 1) * 265},${72 - (v - min) / range * 60}`).join(' ')} />{data.length < 15 && data.map((v, i) => <circle key={i} cx={65 + i / Math.max(1, data.length - 1) * 265} cy={72 - (v - min) / range * 60} r="3" fill="#d37535"><title>{i}: {fmt(v)}</title></circle>)}</svg><small>横轴：{label.includes('Episode') ? '回合 1' : '索引 0'} → {data.length - 1}</small></figure>;
}
function Plane({ snapshot, onPoint, svmLegend }: { snapshot: AdvancedSnapshot; onPoint?: (x: number, y: number) => void; svmLegend?: boolean }) {
  const extent = Math.max(2.2, ...snapshot.points?.flatMap(p => [Math.abs(p[0]!), Math.abs(p[1]!)]) ?? [2.2]); const px = (x: number) => 170 + x / extent * 150, py = (y: number) => 170 - y / extent * 150;
  return <figure className={`${styles.figure} ${styles.mainFigure}`}><figcaption>二维平面 x / y · ±{fmt(extent)} {onPoint && '（点击移动 anchor）'}</figcaption><svg className={styles.plane} viewBox="0 0 340 340" role="img" aria-label="数据点与真实向量场" onClick={onPoint ? e => { const rect = e.currentTarget.getBoundingClientRect(); onPoint((e.clientX - rect.left - rect.width / 2) / rect.width * 340 / 150 * extent, -(e.clientY - rect.top - rect.height / 2) / rect.height * 340 / 150 * extent); } : undefined}>
    <line x1="20" x2="320" y1="170" y2="170" stroke="#bbb" /><line x1="170" x2="170" y1="20" y2="320" stroke="#bbb" />
    {snapshot.vectors?.map((v, i) => { const [x = 0, y = 0, dx = 0, dy = 0] = v; const magnitude = Math.hypot(dx, dy), factor = Math.min(0.09, 0.3 / Math.max(magnitude, 1e-8)); const x1 = px(x), y1 = py(y), x2 = px(x + dx * factor), y2 = py(y + dy * factor); const angle = Math.atan2(y2 - y1, x2 - x1); return <g key={i} stroke="#258266" opacity="0.65"><title>({fmt(x)},{fmt(y)}) → ({fmt(dx)},{fmt(dy)})；仅箭长截断</title><line x1={x1} y1={y1} x2={x2} y2={y2} /><path d={`M${x2 - 4 * Math.cos(angle - 0.5)},${y2 - 4 * Math.sin(angle - 0.5)} L${x2},${y2} L${x2 - 4 * Math.cos(angle + 0.5)},${y2 - 4 * Math.sin(angle + 0.5)}`} fill="none" /></g>; })}
    {snapshot.points?.map((p, i) => <g key={i}><circle cx={px(p[0]!)} cy={py(p[1]!)} r={p[2] === 1 && onPoint ? 6 : 3.5}
      fill={colors[svmLegend ? Number(!p[2]) : Math.round(p[2] ?? 0) % colors.length]}><title>{i}: ({fmt(p[0]!)},{fmt(p[1]!)}) {p[3] !== undefined ? `f=${fmt(p[3])}` : ''}</title></circle>{snapshot.support?.[i] && <circle cx={px(p[0]!)} cy={py(p[1]!)} r="6" fill="none" stroke="#333" />}</g>)}
  </svg>{svmLegend && <ul className={styles.legend}>
    <li><i style={{ background: colors[0] }} />正类</li>
    <li><i style={{ background: colors[1] }} />负类</li>
    <li><i />支持候选（margin ≤ 1.05）</li>
  </ul>}</figure>;
}
function CliffGrid({ model, pg }: { model: NonNullable<AdvancedSnapshot['grid']>; pg: boolean }) {
  const [cell, setCell] = useState(30); const scale = Math.max(1, ...model.values.flat().map(Math.abs));
  return <figure className={`${styles.figure} ${styles.mainFigure}`}><figcaption>6×6 悬崖世界 · 点击查看{pg ? '策略概率' : 'Q(s,a)'}</figcaption><div className={styles.world}>{model.policy.map((q, s) => { const cliff = s > 30 && s < 35; return <button type="button" key={s} data-cliff={cliff || undefined} onClick={() => setCell(s)} aria-label={`状态${s}`} style={{ background: cliff ? '#78535e' : `rgba(83,104,187,${0.08 + 0.55 * Math.abs(model.values[Math.floor(s / 6)]![s % 6]!) / scale})`, outline: s === cell ? '2px solid #d37535' : undefined }}>{s === 30 ? 'S ' : s === 35 ? 'G ' : cliff ? '悬崖' : ''}{!cliff && s !== 35 && ['↑', '→', '↓', '←'][q.indexOf(Math.max(...q))]}</button>; })}</div><small>状态 {cell} · ↑→↓←：{model.policy[cell]!.map(fmt).join(' / ')}<br />最近回合：{model.steps.at(-1) ?? 0} 步；return {model.returns.at(-1) ?? 0}。并列箭头仅显示第一个，探索时随机打破并列。</small></figure>;
}
function Experiment({ node, values, onParams, onLive, inCard, displayContext, wiredOutputs }: NodeBodyProps) {
  const [frame, setFrame] = useState(0), [running, setRunning] = useState(false); const live = useRef(onLive); live.current = onLive;
  // Serialized inputs make recomputation independent of parent object identity / live output rerenders.
  const serialized = JSON.stringify({ node, values });
  const resetKey = JSON.stringify({ type: node.type, params: node.params, values });
  useEffect(() => { setFrame(0); setRunning(false); }, [resetKey]);
  const snapshot = useMemo(() => { const parsed = JSON.parse(serialized) as { node: CanvasNode; values: NodeBodyProps['values'] }; return advancedSnapshot(parsed.node, port => parsed.values[port] ?? null, frame); }, [serialized, frame]);
  const svm = node.type === 'svmLab';
  const cliff = node.type === 'qLearningLab';
  const cap = svm ? Math.ceil((800 - Math.round(bounded(node.params.steps, 100, 0, 800))) / 10)
    : 200 - Math.round(bounded(node.params.episodes, 30, 0, 200));
  useEffect(() => { if (!running) return; const id = window.setInterval(() => setFrame(f => Math.min(Math.max(0, cap), f + 1)), 220); return () => window.clearInterval(id); }, [running, cap]);
  useEffect(() => { if (frame >= cap) setRunning(false); }, [frame, cap]);
  useEffect(() => { if (snapshot) live.current?.(snapshot.outputs); }, [snapshot]);
  if (!snapshot) return <p role="status">请连接有效的实验输入。</p>;
  const trainable = svm || cliff;
  const inStage = displayContext === 'cockpit' || (displayContext === 'instrument' && Boolean(inCard));
  const detached = (port: string) => inStage && wiredOutputs?.has(port);
  const matrices = svm && detached('field') ? [] : snapshot.matrices;
  const curves = snapshot.curves.filter((_, i) => !(svm && detached('history'))
    && !(cliff && detached(i === 0 ? 'returns' : 'steps')));
  const hasDetachedViews = matrices.length < snapshot.matrices.length || curves.length < snapshot.curves.length;
  const stepLabel = svm ? '+10 步' : '+1 回合';
  const kpis = inStage && snapshot.kpis ? snapshot.kpis : Object.entries(snapshot.outputs)
    .flatMap(([label, value]) => value.kind === 'scalar' ? [{ label, value: fmt(value.v), tone: 'neutral' }] : []);
  const readouts = <div className={styles.readouts}>{kpis.map(({ label, value, tone }) =>
    <span key={label} data-tone={tone}>{label} <b>{value}</b></span>)}</div>;
  const actions = trainable && <div className={styles.actions}>
    <button type="button" disabled={frame >= cap && !running} onClick={() => setRunning(v => !v)}>{running ? '暂停' : '运行'}</button>
    <button type="button" disabled={frame >= cap} onClick={() => setFrame(f => Math.min(cap, f + 1))}>
      {inStage ? stepLabel : svm ? '单步 +10 优化步' : '单步 +1 回合'}
    </button>
    <button type="button" onClick={() => { setRunning(false); setFrame(0); }}>重置</button>
    <small>{inStage ? `+${frame * (svm ? 10 : 1)} ${svm ? '步' : '回合'}` : `runtime +${frame * (svm ? 10 : 1)}（不写文档）`}</small>
  </div>;
  return <div className={`${styles.body} ${inStage ? styles.cockpitBody : ''} ${hasDetachedViews ? styles.cockpitHero : ''}`} data-stage-context={inStage ? displayContext : undefined} onPointerDown={e => e.stopPropagation()}>
    {!inCard && <div className={styles.controls}>{controls[node.type]?.map(([key, label, fallback, min, max, step]) => { const input = values[key]; const connected = input?.kind === 'scalar'; const value = bounded(input?.kind === 'scalar' ? input.v : node.params[key], fallback, min, max); return <label key={key}><span>{label}{connected ? ' · 外接 scalar' : ''}<b>{fmt(value)}</b></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} disabled={connected} onChange={e => onParams?.({ [key]: Number(e.target.value) })} /></label>; })}</div>}
    {inStage ? <div className={styles.toolbar}>{actions}{readouts}</div>
      : <>{actions}<p className={styles.note}>{snapshot.note}</p>{readouts}</>}
    {snapshot.grid && <CliffGrid model={snapshot.grid} pg={values.mode?.kind === 'scalar' ? !!values.mode.v : !!node.params.mode} />}
    {snapshot.points && <Plane snapshot={snapshot} svmLegend={inStage && svm} onPoint={node.type === 'autoencoderLab' ? (x, y) => onParams?.({ ax: bounded(x, 0.4, -3, 3), ay: bounded(y, 0.3, -3, 3) }) : undefined} />}
    {(matrices.length > 0 || curves.length > 0) && <div className={styles.charts}>
      {matrices.map(m => <Heatmap key={m.label} {...m} />)}{curves.map(c => <Curve key={c.label} {...c} />)}
    </div>}
    {inStage && <details className={styles.noteFold}><summary>ⓘ 算法与数值说明</summary><p>{snapshot.note}</p></details>}
    {!inCard && <details><summary>端口 / 数值边界</summary>in：未连线使用固定教学输入；张量最多16行、隐藏宽度8（序列8）；点云最多120。非法数值替换/过滤、输入限幅。control 覆盖首个主参数；out 等端口广播真实矩阵/点云，loss 是本实验标量（序列=context；Q=最近 return；扩散=平均负 log density）。训练使用固定 seed 重放至当前步，非计时噪声。</details>}
  </div>;
}
export function DeepAdvancedBody(props: NodeBodyProps) { return <Experiment key={props.node.id} {...props} />; }
const port = (id: string, label: string, kind: PortSpec['kind']): PortSpec => ({ id, label, kind });
const definitions: [NodeType, string, PortSpec['kind'] | null, PortSpec[]][] = [
  ['svmLab', 'SVM · 软间隔与二次映射', 'dataset2d', [port('out', 'w / b', 'tensor2d'), port('data', '支持候选', 'dataset2d'), port('loss', 'Objective', 'scalar'), port('field', '决策分数', 'tensor2d'), port('history', '训练目标历史', 'series')]],
  ['resnetLab', 'ResNet · 梯度与 BN / LN', 'tensor2d', [port('out', '残差激活', 'tensor2d'), port('gradient', '输入梯度', 'tensor2d'), port('loss', 'MSE/2', 'scalar')]],
  ['sequenceMemory', 'RNN / LSTM · 门控记忆', 'tensor2d', [port('out', 'hR / hL / c', 'tensor2d'), port('attention', '直接权重', 'tensor2d'), port('loss', 'Context', 'scalar')]],
  ['multiheadLab', 'Multi-head · 位置编码', 'tensor2d', [port('out', '两头拼接', 'tensor2d'), port('attention', '所选头', 'tensor2d'), port('relative', '位置内积', 'tensor2d')]],
  ['autoencoderLab', 'Autoencoder / InfoNCE', 'tensor2d', [port('out', '二维潜空间', 'tensor2d'), port('reconstruction', '重建', 'tensor2d'), port('loss', 'MSE', 'scalar'), port('contrastive', 'InfoNCE', 'scalar'), port('gradient', 'Anchor / 候选梯度', 'tensor2d')]],
  ['diffusionLab', 'Diffusion · 解析 score', 'dataset2d', [port('out', '时刻点云', 'dataset2d'), port('score', 'x,y,score x/y 前16点', 'tensor2d'), port('loss', '负 log density', 'scalar')]],
  ['qLearningLab', 'Q-learning / REINFORCE', null, [port('out', '6×6 max Q / max π', 'tensor2d'), port('policy', '6×6 贪心动作', 'tensor2d'), port('loss', 'Episode return', 'scalar'), port('returns', '回合回报历史', 'series'), port('steps', '回合步数历史', 'series')]],
];
export const DEEP_ADVANCED_DEFS: Partial<Record<NodeType, NodeDef>> = Object.fromEntries(definitions.map(([type, title, kind, outputs]) => [type, { title, badge: '实验', cockpitWeight: 'hero', width: 410, Body: DeepAdvancedBody, inputs: [...(kind ? [port('in', kind === 'tensor2d' ? '教学输入' : '数据点云', kind)] : []),
    ...(type === 'qLearningLab' ? [port('environment', '奖励矩阵', 'tensor2d'), port('mode', '更新规则', 'scalar'),
      port('gamma', '折扣', 'scalar'), port('alpha', '学习率', 'scalar')] : []), port('control', controls[type]?.find(c => c[0] === 'control')?.[1] ?? '主参数', 'scalar')], outputs }]));

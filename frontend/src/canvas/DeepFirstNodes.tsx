import { useEffect, useRef, useState } from 'react';
import type { NodeBodyProps, NodeDef } from './nodes.tsx';
import type { NodeType, PortValue } from './types.ts';
import { DF_ACTIVATIONS, DF_TOKENS, DF_CANDIDATES, dfParams, dfActivation, dfGradientChain, dfOptimRun, dfTerrain, dfAttention, dfAttentionStats, dfCacheCounts, dfCacheLogits, dfCacheSequence, dfSampleDistribution, deepFirstOutput } from './deepFirst.ts';
import styles from './deepFirst.module.css';
export { deepFirstDefaults } from './deepFirst.ts';

const colors = ['#d45c45', '#357fb1', '#a46eaf', '#238775'];
const f = (v: number) => Math.abs(v) > 0 && Math.abs(v) < 0.001 ? v.toExponential(2) : v.toFixed(3);
function Range({ label, value, min, max, step = 1, change, disabled = false }: { label: string; value: number; min: number; max: number; step?: number; change: (v: number) => void; disabled?: boolean }) {
  return <label className={styles.control}>{label}<input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={e => change(Number(e.target.value))} /><output>{f(value)}</output></label>;
}
function Choice({ label, value, options, change }: { label: string; value: number; options: readonly string[]; change: (v: number) => void }) {
  return <label className={styles.control}>{label}<select value={value} onChange={e => change(Number(e.target.value))}>{options.map((s, i) => <option value={i} key={s}>{s}</option>)}</select></label>;
}
function effective(props: NodeBodyProps) {
  const key = props.node.type === 'activationProbe' ? 'x' : props.node.type === 'attentionAB' ? 'dk' : 'steps';
  const input = props.values.in;
  return dfParams({ ...props.node, params: { ...props.node.params, ...(input?.kind === 'scalar' && Number.isFinite(input.v) ? { [key]: input.v } : {}) } });
}
function useLive(props: NodeBodyProps, params: Record<string, number>, ports: string[]) {
  const ref = useRef(props.onLive); ref.current = props.onLive;
  const values: Record<string, PortValue> = {};
  ports.forEach(port => { const value = deepFirstOutput({ ...props.node, params }, () => null, port); if (value) values[port] = value; });
  const serialized = JSON.stringify(values);
  useEffect(() => { ref.current?.(JSON.parse(serialized) as Record<string, PortValue>); }, [serialized]);
}
function usePlayback(initial: number, max: number, resetKey: string, halted = false) {
  const [frame, setFrame] = useState(initial), [running, setRunning] = useState(false);
  useEffect(() => { setFrame(initial); setRunning(false); }, [initial, resetKey]);
  useEffect(() => {
    if (!running || halted || frame >= max) { if (running) setRunning(false); return; }
    const id = window.setTimeout(() => setFrame(n => Math.min(max, n + 1)), 180);
    return () => window.clearTimeout(id);
  }, [running, frame, max, halted]);
  return { frame, running, setFrame, setRunning };
}
function Playback({ runtime, max, disabled = false }: { runtime: ReturnType<typeof usePlayback>; max: number; disabled?: boolean }) {
  return <div className={styles.buttons}>
    <button type="button" disabled={disabled} onClick={() => { if (runtime.frame >= max) runtime.setFrame(0); runtime.setRunning(!runtime.running); }}>{runtime.running ? '暂停' : '播放'}</button>
    <button type="button" disabled={disabled || runtime.frame >= max} onClick={() => { runtime.setRunning(false); runtime.setFrame(n => n + 1); }}>单步</button>
    <button type="button" onClick={() => { runtime.setRunning(false); runtime.setFrame(0); }}>重置</button>
    <span>本地帧 {runtime.frame} / {max}</span>
  </div>;
}
export function ActivationProbeBody(props: NodeBodyProps) {
  const p = effective(props), change = (key: string, v: number) => props.onParams?.({ [key]: v });
  const chain = dfGradientChain(p.activation!, p.x!, !!p.mode);
  useLive(props, p, ['out', 'layers']);
  const samples = Array.from({ length: 121 }, (_, i) => { const x = -6 + i / 10; return { x, ...dfActivation(p.activation!, x) }; });
  return <div className={styles.root}>
    <Choice label="激活函数" value={p.activation!} options={DF_ACTIVATIONS} change={v => change('activation', v)} />
    <Range label="输入 x / 固定预激活 z" value={p.x!} min={-8} max={8} step={0.05} disabled={props.values.in?.kind === 'scalar'} change={v => change('x', v)} />
    <Choice label="梯度实验模式" value={p.mode!} options={['固定预激活：同一导数连乘', '逐层前传：hₗ = f(hₗ₋₁)']} change={v => change('mode', v)} />
    <svg viewBox="0 0 360 170" role="img" aria-label="激活函数及导数曲线，横轴 -6 至 6，纵轴 -2 至 6">
      <path d="M0 127.5H360 M180 0V170" className={styles.axis} />
      {(['value', 'derivative'] as const).map((key, j) => <polyline key={key} fill="none" stroke={colors[j]} strokeWidth="2" points={samples.map(s => `${(s.x + 6) * 30},${127.5 - s[key] * 21.25}`).join(' ')} />)}
    </svg>
    <p><span style={{ color: colors[0] }}>函数 f</span> / <span style={{ color: colors[1] }}>导数 f′</span> · GELU 使用标准 tanh 近似并对该近似精确求导；ReLU 在 0 处约定导数为 0。</p>
    <div className={styles.bars}>{chain.map((r, i) => <div key={i} title={`z=${f(r.z)}, f′=${f(r.derivative)}, 梯度=${f(r.gradient)}`}><div style={{ height: `${Math.min(100, Math.abs(r.gradient) * 100)}%`, background: Math.abs(r.gradient) < 1e-4 ? colors[0] : colors[3] }} /><span>{i + 1}</span></div>)}</div>
    <p>柱高 = |累计梯度|（线性 0–1，超出截顶）。10 层：<b>{f(chain[9]!.gradient)}</b></p>
    <details><summary>逐层数值</summary><table><thead><tr><th>层</th><th>z</th><th>f′</th><th>累计梯度</th></tr></thead><tbody>{chain.map((r, i) => <tr key={i}><td>{i + 1}</td><td>{f(r.z)}</td><td>{f(r.derivative)}</td><td>{f(r.gradient)}</td></tr>)}</tbody></table></details>
    <p>权重全部为 1，偏置为 0。固定模式仅比较局部导数乘积，并非同一个网络的前传；逐层模式是从输入到第 L 层的链式导数。端口 out = 第 10 层梯度。</p>
  </div>;
}
export function OptimizerArenaBody(props: NodeBodyProps) {
  const p = effective(props), wired = props.values.in?.kind === 'scalar';
  const runtime = usePlayback(p.steps!, 200, `${p.terrain}:${p.x}:${p.y}:${p.lr}`);
  const steps = wired ? p.steps! : runtime.frame, runs = dfOptimRun(p, steps);
  const halted = runs.some(r => r.state.stopped);
  useEffect(() => { if (halted) runtime.setRunning(false); }, [halted, runtime.setRunning]);
  useLive(props, { ...p, steps }, ['sgd', 'momentum', 'rmsprop', 'out']);
  const change = (key: string, value: number) => props.onParams?.({ [key]: value });
  return <div className={styles.root}>
    <Choice label="损失地形" value={p.terrain!} options={['碗：(x²+y²)/2', '鞍点：(x²−y²)/2（无下界）', '狭长山谷：(x²+40y²)/2']} change={v => change('terrain', v)} />
    <Range label="学习率 lr" value={p.lr!} min={0.001} max={1} step={0.001} change={v => change('lr', v)} />
    <Range label="持久化观察步数" value={p.steps!} min={0} max={200} disabled={wired} change={v => change('steps', v)} />
    <div className={styles.columns}><Range label="统一起点 x" value={p.x!} min={-4} max={4} step={0.1} change={v => change('x', v)} /><Range label="统一起点 y" value={p.y!} min={-4} max={4} step={0.1} change={v => change('y', v)} /></div>
    <svg viewBox="0 0 320 240" role="img" aria-label="损失等高色带及优化器轨迹，可点击地形更改起点，也可使用起点滑杆" onClick={e => { const b = e.currentTarget.getBoundingClientRect(); props.onParams?.({ x: (e.clientX - b.left) / b.width * 8 - 4, y: 4 - (e.clientY - b.top) / b.height * 8 }); }}>
      {Array.from({ length: 40 * 30 }, (_, i) => { const x = i % 40, y = Math.floor(i / 40), loss = dfTerrain(p.terrain!, (x + 0.5) / 5 - 4, 4 - (y + 0.5) * 8 / 30).loss; return <rect key={i} x={x * 8} y={y * 8} width="8" height="8" fill={`hsl(${205 + Math.sign(loss) * 20} 35% ${94 - (Math.floor(Math.log1p(Math.abs(loss)) * 5) % 14) * 2}%)`} />; })}
      <path d="M160 0V240 M0 120H320" className={styles.axis} />
      {runs.map((r, i) => <polyline key={r.kind} fill="none" stroke={colors[i]} strokeWidth="2" points={r.path.map(s => `${(s.x + 4) * 40},${(4 - s.y) * 30}`).join(' ')} />)}
      <circle cx={(p.x! + 4) * 40} cy={(4 - p.y!) * 30} r="4" fill="#182535" />
    </svg>
    <Playback runtime={runtime} max={200} disabled={wired || halted} />
    <table><thead><tr><th>优化器</th><th>步</th><th>Loss</th><th>状态</th></tr></thead><tbody>{runs.map((r, i) => <tr key={r.kind}><td style={{ color: colors[i] }}>{r.kind}</td><td>{r.state.step}</td><td>{f(r.loss)}</td><td>{r.state.stopped ? '发散停止' : Math.abs(r.state.x) > 4 || Math.abs(r.state.y) > 4 ? '已出视野' : '运行域内'}</td></tr>)}</tbody></table>
    <p role="status">{halted ? '检测到非有限值或 |坐标| > 10⁴，赛跑已暂停，保留最后有限状态。请降低学习率并重置。' : '视野 x,y ∈ [−4,4]；出视野不等于收敛。鞍点无下界，精确原点梯度为零。'}</p>
    <p>Momentum：v=0.9v+g；RMSProp：二阶衰减 0.9；Adam：β₁=0.9、β₂=0.999，双矩偏差修正；ε=10⁻⁸。所有方法同起点、零初始矩。输出为各自 Loss（out=Adam）；动画仅更新本地/live。</p>
  </div>;
}
export function AttentionABBody(props: NodeBodyProps) {
  const p = effective(props), a = dfAttention(p.dk!), query = p.query!, key = p.key!;
  useLive(props, p, ['out', 'weights']);
  const select = (q: number, k: number) => props.onParams?.({ query: q, key: k });
  return <div className={styles.root}>
    <Range label="键维度 dₖ" value={p.dk!} min={2} max={64} disabled={props.values.in?.kind === 'scalar'} change={dk => props.onParams?.({ dk })} />
    <Choice label="Query 词元" value={query} options={DF_TOKENS} change={v => select(v, key)} />
    <Choice label="Key 词元" value={key} options={DF_TOKENS} change={v => select(query, v)} />
    <div className={styles.columns}>{([['未缩放', a.unscaled], ['除以 √dₖ', a.scaled]] as const).map(([name, matrix]) => { const row = matrix[query]!, stats = dfAttentionStats(row); return <section key={name}>
      <h4>{name}</h4>
      <div className={styles.heatmap}>{matrix.flatMap((r, i) => r.map((w, j) => <button key={`${i}:${j}`} type="button" aria-label={`${name} Query ${DF_TOKENS[i]} Key ${DF_TOKENS[j]} 权重 ${f(w)}`} aria-pressed={query === i && key === j} onClick={() => select(i, j)} style={{ background: `rgba(41,130,155,${0.08 + w * 0.92})` }}>{w.toFixed(2)}</button>))}</div>
      <svg viewBox="0 0 240 110" role="img" aria-label={`${name} 所选 Query 到各 Key 的注意力弧线`}>
        {row.map((w, j) => <path key={j} d={j === query ? `M${20 + j * 40} 87c-18 -30 18 -30 0 0` : `M${20 + query * 40} 87Q${20 + (query + j) * 20} ${10 + Math.abs(query - j) * 2} ${20 + j * 40} 87`} fill="none" stroke={j === key ? colors[0] : colors[1]} strokeWidth={1 + 7 * w} opacity={0.25 + 0.75 * w} />)}
        {DF_TOKENS.map((t, j) => <text key={t} x={20 + j * 40} y="105" textAnchor="middle" fontSize="9">{t}</text>)}
      </svg>
      <div className={styles.tokenButtons}>{DF_TOKENS.map((t, j) => <button type="button" key={t} aria-pressed={key === j} onClick={() => select(query, j)}>{t}</button>)}</div>
      <p>选中权重 {f(row[key]!)}<br />熵 H={f(stats.entropy)} nats<br />‖∂softmax/∂logits‖F={f(stats.norm)}</p>
    </section>; })}</div>
    <p>固定种子 20261120，Q/K 独立来自 N(0,1)（总体单位方差，非有限样本强制归一化），A/B 使用完全相同的 Q/K。热图行为 Query、列为 Key；选中格与弧线联动。</p>
    <p>J=diag(p)−ppᵀ。大 logits 常使分布更尖锐、梯度变小，但不保证每行饱和或梯度总归零。上面范数相对各自 logits；缩放路径相对原始点积还需乘 1/√dₖ。out 输出缩放行的熵。</p>
  </div>;
}
export function KVCacheBody(props: NodeBodyProps) {
  const p = effective(props), wired = props.values.in?.kind === 'scalar';
  const runtime = usePlayback(p.steps! - 1, 7, `${p.temperature}:${p.topk}:${p.topp}`);
  const step = wired ? p.steps! : runtime.frame + 1, counts = dfCacheCounts(step);
  const dist = dfSampleDistribution(dfCacheLogits(step), p.temperature!, p.topk!, p.topp!);
  const sequence = dfCacheSequence(step, p.temperature!, p.topk!, p.topp!);
  useLive(props, { ...p, steps: step }, ['out', 'probabilities']);
  return <div className={styles.root}>
    <p><b>确定性机制示意，不是真实 LLM</b>：8 个自回归步骤，10 词玩具候选全集，合成 logits 随步骤变化；不代表模型语言能力。</p>
    <Range label="生成步骤" value={p.steps!} min={1} max={8} disabled={wired} change={steps => props.onParams?.({ steps })} />
    <Playback runtime={runtime} max={7} disabled={wired} />
    <p aria-live="polite">固定随机种子采样：{sequence.join(' → ')}（合成 logits 不依赖历史词义）</p>
    <div className={styles.columns}>{[false, true].map(cache => <section key={String(cache)}><h4>{cache ? '有 KV Cache' : '无 KV Cache'}</h4><div className={styles.cache}>{Array.from({ length: step }, (_, i) => <span key={i} className={cache && i < step - 1 ? styles.cached : styles.compute}>t{i + 1}<small>{cache && i < step - 1 ? 'K/V 锁存' : 'K/V 投影'}</small></span>)}</div></section>)}</div>
    <table><thead><tr><th>累计乘加 MAC（d=8）</th><th>无缓存</th><th>有缓存</th></tr></thead><tbody><tr><td>K/V 投影</td><td>{counts.kvWithout}</td><td>{counts.kvWith}</td></tr><tr><td>QK + AV</td><td>{counts.attentionWithout}</td><td>{counts.attentionWith}</td></tr><tr><td>二者合计</td><td>{counts.totalWithout}</td><td>{counts.totalWith}</td></tr></tbody></table>
    <p>单层、每步仅计算最新 Query：K/V 无缓存每步 2nd²、有缓存 2d²；两边注意力每步均 2nd，累计仍为 O(n²)。不计 Q 投影、softmax、FFN，合计不是完整 LLM FLOPs；缓存不会消除注意力计算。out = 合计节省 MAC。</p>
    <Range label="Temperature" value={p.temperature!} min={0.05} max={3} step={0.05} change={temperature => props.onParams?.({ temperature })} />
    <Range label="Top-k" value={p.topk!} min={1} max={10} change={topk => props.onParams?.({ topk })} />
    <Range label="Top-p" value={p.topp!} min={0.01} max={1} step={0.01} change={topp => props.onParams?.({ topp })} />
    <p>顺序：温度 softmax → Top-k 后重归一化 → Top-p 最小累计前缀 → 再归一化。蓝条为最终概率。</p>
    <table><thead><tr><th>候选</th><th>温度后</th><th>截断后</th></tr></thead><tbody>{dist.base.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).map(({ v, i }) => <tr key={i}><td>{DF_CANDIDATES[i]}</td><td>{(100 * v).toFixed(1)}%</td><td><meter min="0" max="1" value={dist.probabilities[i]} /> {(100 * dist.probabilities[i]!).toFixed(1)}%</td></tr>)}</tbody></table>
  </div>;
}
export const DEEP_FIRST_DEFS: Partial<Record<NodeType, NodeDef>> = {
  activationProbe: { title: '激活函数 · 十层梯度探针', badge: '实验', width: 430, inputs: [{ id: 'in', label: 'x / z', kind: 'scalar' }], outputs: [{ id: 'out', label: '10层梯度', kind: 'scalar' }, { id: 'layers', label: '层快照', kind: 'tensor2d' }], Body: ActivationProbeBody },
  optimizerArena: { title: '优化器 · 地形赛跑', badge: '实验', width: 470, inputs: [{ id: 'in', label: '步数', kind: 'scalar' }], outputs: [{ id: 'sgd', label: 'SGD loss', kind: 'scalar' }, { id: 'momentum', label: 'Momentum loss', kind: 'scalar' }, { id: 'rmsprop', label: 'RMSProp loss', kind: 'scalar' }, { id: 'out', label: 'Adam loss', kind: 'scalar' }], Body: OptimizerArenaBody },
  attentionAB: { title: 'Attention · 缩放 A/B', badge: '实验', width: 560, inputs: [{ id: 'in', label: 'dₖ', kind: 'scalar' }], outputs: [{ id: 'out', label: '缩放熵', kind: 'scalar' }, { id: 'weights', label: '注意力矩阵', kind: 'tensor2d' }], Body: AttentionABBody },
  kvCache: { title: 'KV Cache · 采样策略', badge: '实验', width: 490, inputs: [{ id: 'in', label: '步骤 1–8', kind: 'scalar' }], outputs: [{ id: 'out', label: '节省 MAC', kind: 'scalar' }, { id: 'probabilities', label: '采样概率', kind: 'tensor2d' }], Body: KVCacheBody },
};

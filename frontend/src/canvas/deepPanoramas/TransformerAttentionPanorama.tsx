import { useMemo } from 'react';
import { DeepPanoramaShell } from '../DeepPanoramaShell';
import { entropy, finite, round, transformerPanorama, type Matrix } from '../deepPanoramaEngine';
import type { DeepPanoramaControl, DeepPanoramaRenderState, DeepScenarioPreset, DeepStageRenderState } from '../deepPanoramaTypes';
import type { NodeBodyProps } from '../nodes';

export const TRANSFORMER_PRESETS: readonly DeepScenarioPreset[] = [
  { id: 'arc-overview', label: '注意力弧线总览', patch: { dk: 16, offset: 0, encoding: 1, scaleMode: 1 }, note: '点击词元，观察它向上下文伸出的注意力弧线' },
  { id: 'rope-rotation', label: 'RoPE 相对旋转', patch: { dk: 16, offset: 3, encoding: 1, scaleMode: 1 }, note: '位置不是序号标签，而是成对维度的旋转角' },
  { id: 'scale-ab', label: '缩放梯度对照', patch: { dk: 36, offset: 0, encoding: 1, scaleMode: 0 }, note: '大维度下未缩放 softmax 饱和，梯度范数塌缩' },
  { id: 'multihead-rnn', label: '多头与 RNN 对照', patch: { dk: 16, offset: 0, encoding: 0, scaleMode: 1 }, note: '局部头、长程头与递归衰减并排比较' },
];

const CONTROLS: readonly DeepPanoramaControl[] = [
  { key: 'dk', label: '维度 dₖ', min: 2, max: 64, step: 1, format: (v) => `${Math.round(v)}` },
  { key: 'offset', label: '相对位置偏移', min: -8, max: 8, step: 1, format: (v) => `${Math.round(v)}` },
  { key: 'encoding', label: '位置编码', options: [{ value: 0, label: '正弦绝对' }, { value: 1, label: 'RoPE 相对' }] },
  { key: 'scaleMode', label: '缩放路径', options: [{ value: 0, label: '未缩放' }, { value: 1, label: '÷√dₖ' }] },
];
const STAGES = ['词元与位置', 'Q/K/V 投影', '点积与缩放', 'Softmax 注意力', '多头长程对照'] as const;

function tokenX(index: number): number { return 74 + index * 122; }

function ArcDiagram({ matrix, tokens, query, frame, onQuery }: { matrix: Matrix; tokens: string[]; query: number; frame: number; onQuery: (index: number) => void }) {
  const row = matrix[query] ?? [];
  const dash = (frame * 7) % 28;
  return (
    <svg viewBox="0 0 760 390" style={{ width: '100%', height: '100%' }} role="img" aria-label="可点击词元与注意力弧线">
      <rect width="760" height="390" rx="14" fill="#fcfbf5" />
      <text x="40" y="42" fontSize="15" fontWeight="650" fill="#17231f">「{tokens[query]}」正在读取谁？</text>
      <line x1="48" x2="710" y1="276" y2="276" stroke="rgba(23,35,31,.28)" />
      {tokens.map((token, i) => (
        <g key={token} onClick={() => onQuery(i)} style={{ cursor: 'pointer' }}>
          <rect x={tokenX(i) - 42} y="248" width="84" height="54" rx="12" fill={i === query ? '#e5eafc' : '#f2f0e7'} stroke={i === query ? '#1b42cf' : 'rgba(23,35,31,.18)'} strokeWidth={i === query ? 2 : 1} />
          <text x={tokenX(i)} y="281" fontSize="17" textAnchor="middle" fill="#17231f">{token}</text>
          <text x={tokenX(i)} y="321" fontSize="9" textAnchor="middle" fill="#6b746d">position {i}</text>
        </g>
      ))}
      {row.map((weight, j) => {
        if (j === query) return null;
        const x1 = tokenX(query);
        const x2 = tokenX(j);
        const lift = 70 + Math.abs(x1 - x2) * 0.34;
        const strong = weight > 0.26;
        return <g key={j}>
          <path d={`M${x1} 247 C ${x1} ${247 - lift}, ${x2} ${247 - lift}, ${x2} 247`} fill="none" stroke={strong ? '#d94824' : '#1b42cf'} strokeWidth={1 + weight * 8} strokeOpacity={0.18 + weight * 0.75} strokeLinecap="round" strokeDasharray="10 7" strokeDashoffset={-dash} />
          <text x={(x1 + x2) / 2} y={247 - lift + 12} fontSize="9" textAnchor="middle" fill={strong ? '#d94824' : '#1b42cf'}>{weight.toFixed(2)}</text>
        </g>;
      })}
      <text x="44" y="365" fontSize="11" fill="#6b746d">粗弧线和虚线流速表示 softmax 权重；点击任意词元切换查询视角。</text>
    </svg>
  );
}

function PositionalDiagram({ rope, offset, mode, frame }: { rope: Matrix; offset: number; mode: number; frame: number }) {
  const wave = Array.from({ length: 120 }, (_, i) => {
    const x = 52 + i * 5.2;
    const y = mode ? 225 - Math.sin((i / 119 * 6 + offset) * 0.55) * 62 : 225 - Math.sin((i / 119 * 6 + offset) * 2.2) * 54;
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const angle = frame * 0.12 + offset * 0.35;
  return (
    <svg viewBox="0 0 760 390" style={{ width: '100%', height: '100%' }} role="img" aria-label="正弦位置编码与 RoPE 旋转向量">
      <rect width="760" height="390" rx="14" fill="#fcfbf5" />
      <text x="42" y="43" fontSize="15" fontWeight="650" fill="#17231f">{mode ? 'RoPE：相对距离变成旋转角差' : '正弦编码：不同频率记录绝对位置'}</text>
      <g transform="translate(78 72)">
        {rope.map((row, i) => row.map((value, j) => <rect key={`${i}-${j}`} x={j * 38} y={i * 27} width="35" height="24" rx="4" fill={value >= 0 ? `rgba(27,66,207,${0.08 + value * 0.55})` : `rgba(217,72,36,${0.08 - value * 0.55})`} />))}
        <text x="0" y="190" fontSize="10" fill="#6b746d">cos((i−j)θ)：只由相对距离决定</text>
      </g>
      <path d={wave} fill="none" stroke="#1b42cf" strokeWidth="2.4" />
      <circle cx="650" cy="130" r="70" fill="none" stroke="rgba(23,35,31,.18)" />
      {[0, 1, 2].map((i) => {
        const a = angle + i * 0.75;
        return <g key={i}>
          <line x1="650" y1="130" x2={650 + Math.cos(a) * 58} y2={130 + Math.sin(a) * 58} stroke={['#1b42cf', '#b87818', '#16835b'][i]} strokeWidth="3" />
          <circle cx={650 + Math.cos(a) * 58} cy={130 + Math.sin(a) * 58} r="4" fill={['#1b42cf', '#b87818', '#16835b'][i]} />
        </g>;
      })}
      <text x="604" y="233" fontSize="10" fill="#6b746d">维度对旋转</text>
    </svg>
  );
}

function ProjectionDiagram() {
  const cards = [
    ['Q 查询', '我在寻找什么？', '#1b42cf'],
    ['K 键', '我能提供什么？', '#b87818'],
    ['V 值', '被选中后传递什么？', '#16835b'],
  ];
  return (
    <svg viewBox="0 0 760 390" style={{ width: '100%', height: '100%' }} role="img" aria-label="Q K V 三路投影">
      <rect width="760" height="390" rx="14" fill="#fcfbf5" />
      <text x="42" y="43" fontSize="15" fontWeight="650" fill="#17231f">同一个词元，被投影成三种角色</text>
      {cards.map(([title, note, color], i) => (
        <g key={title} transform={`translate(${70 + i * 220} 82)`}>
          <rect width="174" height="176" rx="14" fill="#f2f0e7" stroke={color} strokeOpacity=".35" />
          <text x="18" y="34" fontSize="16" fontWeight="650" fill={color}>{title}</text>
          <text x="18" y="57" fontSize="10" fill="#6b746d">{note}</text>
          {Array.from({ length: 5 }, (_, row) => Array.from({ length: 4 }, (_, col) => <rect key={`${row}-${col}`} x={18 + col * 34} y={76 + row * 17} width="28" height="12" rx="3" fill={color} opacity={0.1 + ((row * 4 + col + i * 3) % 7) / 10} />))}
        </g>
      ))}
      <path d="M190 80 C 260 18, 440 18, 510 80" fill="none" stroke="rgba(23,35,31,.24)" strokeDasharray="5 5" />
      <text x="252" y="24" fontSize="10" fill="#6b746d">X · W_Q ｜ X · W_K ｜ X · W_V</text>
      <text x="84" y="335" fontSize="11" fill="#6b746d">点积只发生在 Q 与 K 之间；V 不参与匹配，只负责把被选择的信息送出去。</text>
    </svg>
  );
}

function Heatmap({ matrix, x, y, cell, title, tone = 'blue' }: { matrix: Matrix; x: number; y: number; cell: number; title: string; tone?: 'blue' | 'red' }) {
  const color = tone === 'blue' ? '27,66,207' : '217,72,36';
  return (
    <g transform={`translate(${x} ${y})`}>
      <text x="0" y="-10" fontSize="11" fontWeight="650" fill="#17231f">{title}</text>
      {matrix.map((row, i) => row.map((value, j) => <rect key={`${i}-${j}`} x={j * cell} y={i * cell} width={cell - 2} height={cell - 2} rx="4" fill={`rgba(${color},${0.06 + value * 0.86})`} />))}
    </g>
  );
}

function ScaleDiagram({ scaled, unscaled }: { scaled: Matrix; unscaled: Matrix }) {
  const hScaled = scaled.map(entropy);
  const hUnscaled = unscaled.map(entropy);
  return (
    <svg viewBox="0 0 760 390" style={{ width: '100%', height: '100%' }} role="img" aria-label="缩放与未缩放注意力矩阵对照">
      <rect width="760" height="390" rx="14" fill="#fcfbf5" />
      <Heatmap matrix={unscaled} x={72} y={72} cell={36} title="未缩放：softmax(q·k)" tone="red" />
      <Heatmap matrix={scaled} x={438} y={72} cell={36} title="缩放：softmax(q·k/√dₖ)" tone="blue" />
      <text x="93" y="318" fontSize="12" fill="#d94824">平均熵 {(hUnscaled.reduce((a, b) => a + b, 0) / hUnscaled.length).toFixed(2)}</text>
      <text x="458" y="318" fontSize="12" fill="#1b42cf">平均熵 {(hScaled.reduce((a, b) => a + b, 0) / hScaled.length).toFixed(2)}</text>
      <path d="M333 169 H 410" stroke="#17231f" strokeOpacity=".35" strokeWidth="2" />
      <path d="M400 160 L 415 169 L 400 178" fill="none" stroke="#17231f" strokeOpacity=".35" strokeWidth="2" />
      <text x="320" y="146" fontSize="10" fill="#6b746d">除以 √dₖ 后</text>
      <text x="78" y="356" fontSize="11" fill="#6b746d">未缩放矩阵更像one-hot：概率越饱和，softmax Jacobian 越小，回传梯度越薄。</text>
    </svg>
  );
}

function MultiHeadDiagram({ local, long }: { local: Matrix; long: Matrix }) {
  const decay = Array.from({ length: 80 }, (_, i) => `${i ? 'L' : 'M'}${500 + i * 2.7} ${302 - 110 * 0.82 ** i}`).join(' ');
  return (
    <svg viewBox="0 0 760 390" style={{ width: '100%', height: '100%' }} role="img" aria-label="局部头、长程头与 RNN 距离衰减对照">
      <rect width="760" height="390" rx="14" fill="#fcfbf5" />
      <Heatmap matrix={local} x={56} y={68} cell={28} title="头 A：局部语法" />
      <Heatmap matrix={long} x={270} y={68} cell={28} title="头 B：长程指代" tone="red" />
      <text x="514" y="58" fontSize="11" fontWeight="650" fill="#17231f">RNN 递归权重衰减</text>
      <line x1="500" x2="716" y1="302" y2="302" stroke="rgba(23,35,31,.22)" />
      <line x1="500" x2="500" y1="302" y2="176" stroke="rgba(23,35,31,.22)" />
      <path d={decay} fill="none" stroke="#b87818" strokeWidth="3" />
      <text x="511" y="332" fontSize="10" fill="#6b746d">距离步数</text>
      <path d="M335 112 C 392 42, 485 43, 539 112" fill="none" stroke="#d94824" strokeWidth="4" strokeOpacity=".5" />
      <text x="398" y="39" fontSize="10" fill="#d94824">注意力可跨距离直连</text>
      <text x="58" y="352" fontSize="11" fill="#6b746d">Transformer 的关键不是“看得更远”这么简单，而是距离不直接写入递归乘积；远近由内容匹配决定。</text>
    </svg>
  );
}

function MainVisual(state: DeepPanoramaRenderState) {
  const dk = Math.round(finite(state.params.dk, 16, 2, 64));
  const offset = Math.round(finite(state.params.offset, 0, -8, 8));
  const encoding = Math.round(finite(state.params.encoding, 1, 0, 1));
  const query = Math.round(finite(state.params.query, 4, 0, 5));
  const data = useMemo(() => transformerPanorama(dk, offset, encoding), [dk, offset, encoding]);
  const matrix = Math.round(finite(state.params.scaleMode, 1, 0, 1)) ? data.scaled : data.unscaled;
  if (state.stage === 0) {
    return state.frame % 16 < 9
      ? <ArcDiagram matrix={matrix} tokens={data.tokens} query={query} frame={state.frame} onQuery={(index) => state.setParam('query', index)} />
      : <PositionalDiagram rope={data.rope} offset={offset} mode={encoding} frame={state.frame} />;
  }
  if (state.stage === 1) return <ProjectionDiagram />;
  if (state.stage === 2) return <ScaleDiagram scaled={data.scaled} unscaled={data.unscaled} />;
  if (state.stage === 4) return <MultiHeadDiagram local={data.headLocal} long={data.headLong} />;
  return <ArcDiagram matrix={matrix} tokens={data.tokens} query={query} frame={state.frame} onQuery={(index) => state.setParam('query', index)} />;
}

export function TransformerAttentionPanorama({ node, onParams }: NodeBodyProps) {
  const base = { dk: 16, offset: 0, encoding: 1, scaleMode: 1, query: 4 };
  const params = { ...base, ...node.params };
  return (
    <DeepPanoramaShell
      title="Transformer 注意力全景"
      subtitle="位置编码 × 点积缩放 × 多头长程依赖"
      stages={STAGES}
      presets={TRANSFORMER_PRESETS}
      params={params}
      totalSteps={90}
      controls={CONTROLS}
      onParams={onParams}
      resetPatch={base}
      stageForFrame={(frame) => frame < 16 ? 0 : frame < 32 ? 1 : frame < 52 ? 2 : frame < 74 ? 3 : 4}
      caption={(state) => <span><strong>{STAGES[state.stage]}</strong> · 点击词元切换查询；锁定阶段后播放仍驱动弧线流动</span>}
      renderFormula={(state) => {
        const dk = Math.round(finite(state.params.dk, 16, 2, 64));
        const data = transformerPanorama(dk, finite(state.params.offset, 0), Math.round(finite(state.params.encoding, 1, 0, 1)));
        const query = Math.round(finite(state.params.query, 4, 0, 5));
        const key = 2;
        const rawScore = data.raw[query]?.[key] ?? 0;
        const attention = data.scaled[query]?.[key] ?? 0;
        return <span>Attention(Q,K,V)=softmax(<code>QKᵀ/√{dk}</code>)V　q₍{data.tokens[query]}₌·k₍毛线球₎ = <code>{rawScore.toFixed(2)}</code> → 权重 <code>{attention.toFixed(3)}</code></span>;
      }}
      renderKpis={(state) => {
        const dk = Math.round(finite(state.params.dk, 16, 2, 64));
        const data = transformerPanorama(dk, finite(state.params.offset, 0), Math.round(finite(state.params.encoding, 1, 0, 1)));
        const query = Math.round(finite(state.params.query, 4, 0, 5));
        const row = data.scaled[query] ?? [];
        const unscaled = data.unscaled[query] ?? [];
        return [
          { label: '当前查询', value: data.tokens[query] ?? '-', tone: 'blue' },
          { label: '注意力熵', value: entropy(row).toFixed(2), tone: 'green' },
          { label: '未缩放熵', value: entropy(unscaled).toFixed(2), tone: entropy(unscaled) < 0.4 ? 'red' : 'ochre' },
          { label: 'RoPE cos(Δθ)', value: (data.rope[query]?.[2] ?? 0).toFixed(2) },
        ];
      }}
    >
      {(state) => <MainVisual {...state} />}
    </DeepPanoramaShell>
  );
}


export function TransformerSourceStage(state: DeepStageRenderState) {
  return <MainVisual {...state} stage={0} />;
}
export function TransformerProjectionStage(state: DeepStageRenderState) {
  return <MainVisual {...state} stage={2} />;
}
export function TransformerArcStage(state: DeepStageRenderState) {
  return <MainVisual {...state} stage={3} />;
}
export function TransformerMultiheadStage(state: DeepStageRenderState) {
  return <MainVisual {...state} stage={4} />;
}

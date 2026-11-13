import { Fragment, useEffect, useMemo, useState } from 'react';
import Formula from './Formula';
import { Segmented, Stat } from './controls';
import {
  MODEL_CARDS,
  STAGES,
  VOCAB,
  formatCell,
  formatPercent,
  gelu,
  normalizeInput,
  runTransformer,
  vectorStats,
  type AttentionHeadTrace,
  type Token,
  type TransformerTrace,
} from './transformerMath';
import styles from './transformer.module.css';

/* -------------------------------------------------------------------------- */
/* 基础可视化                                                                  */
/* -------------------------------------------------------------------------- */

function MatrixTable({
  data,
  rowLabels,
  colLabels,
  compact = false,
  title,
}: {
  data: number[][];
  rowLabels?: readonly string[];
  colLabels?: readonly string[];
  compact?: boolean;
  title: string;
}): JSX.Element {
  const cols = data[0]?.length ?? 0;
  const max = Math.max(1e-6, ...data.flat().map((value) => Math.abs(value)));
  return (
    <div className={styles.matrixBlock} aria-label={title}>
      <div
        className={styles.matrix}
        data-compact={compact || undefined}
        style={{ gridTemplateColumns: `44px repeat(${cols}, minmax(${compact ? 26 : 32}px, 1fr))` }}
      >
        <span className={styles.matrixCorner} aria-hidden="true" />
        {Array.from({ length: cols }, (_, col) => (
          <span key={`c-${col}`} className={styles.matrixColLabel}>
            {colLabels?.[col] ?? `d${col + 1}`}
          </span>
        ))}
        {data.map((row, rowIndex) => (
          <Fragment key={`r-${rowIndex}`}>
            <span className={styles.matrixRowLabel}>{rowLabels?.[rowIndex] ?? rowIndex + 1}</span>
            {Array.from({ length: cols }, (_, col) => {
              const value = row[col] ?? 0;
              const ratio = Math.min(1, Math.abs(value) / max);
              const background =
                value >= 0
                  ? `rgba(79, 70, 229, ${0.04 + ratio * 0.56})`
                  : `rgba(255, 122, 89, ${0.05 + ratio * 0.55})`;
              const color = ratio > 0.58 ? '#ffffff' : 'var(--ink-700)';
              return (
                <span
                  key={`c-${rowIndex}-${col}`}
                  className={styles.matrixCell}
                  style={{ background, color }}
                  title={`${rowLabels?.[rowIndex] ?? rowIndex + 1} · ${colLabels?.[col] ?? `d${col + 1}`} = ${value.toFixed(4)}`}
                >
                  {formatCell(value)}
                </span>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function AttentionHeatmap({
  head,
  tokens,
  queryRow,
}: {
  head: AttentionHeadTrace;
  tokens: readonly Token[];
  queryRow: number;
}): JSX.Element {
  const cols = tokens.length;
  const max = Math.max(1e-6, ...head.weights.flat().filter(Number.isFinite));
  return (
    <div className={styles.heatmapBlock}>
      <div
        className={styles.heatmap}
        style={{ gridTemplateColumns: `50px repeat(${cols}, minmax(30px, 1fr))` }}
        role="img"
        aria-label="因果注意力权重矩阵，行为查询位置，列为键位置"
      >
        <span className={styles.matrixCorner} aria-hidden="true" />
        {tokens.map((token, col) => (
          <span key={`h-${col}`} className={styles.heatColLabel}>{token.char}</span>
        ))}
        {head.weights.map((row, i) => (
          <Fragment key={`hr-${i}`}>
            <span className={styles.heatRowLabel} data-active={i === queryRow || undefined}>
              {tokens[i]?.char ?? i + 1}
            </span>
            {Array.from({ length: cols }, (_, j) => {
              if (j > i) {
                return (
                  <span key={`hc-${i}-${j}`} className={styles.heatCell} data-masked="true" title="因果遮罩：未来位置不可见">
                    ·
                  </span>
                );
              }
              const weight = row[j] ?? 0;
              const ratio = Math.min(1, weight / max);
              const color = ratio > 0.52 ? '#ffffff' : 'var(--ink-700)';
              return (
                <span
                  key={`hc-${i}-${j}`}
                  className={styles.heatCell}
                  data-active={i === queryRow || undefined}
                  style={{ background: `rgba(79, 70, 229, ${0.05 + ratio * 0.8})`, color }}
                  title={`${tokens[i]?.char ?? i} → ${tokens[j]?.char ?? j}：${weight.toFixed(4)}`}
                >
                  {weight.toFixed(2)}
                </span>
              );
            })}
          </Fragment>
        ))}
      </div>
      <p className={styles.heatLegend}>
        行为查询位置，列为键位置；颜色越深权重越大，<span>·</span> 为因果遮罩。
      </p>
    </div>
  );
}

function OutputBars({ trace }: { trace: TransformerTrace }): JSX.Element {
  const maxProb = Math.max(1e-6, ...trace.top.map((item) => item.prob));
  return (
    <div className={styles.outputBars}>
      {trace.top.map((item, index) => (
        <div key={item.token} className={styles.outputRow} data-top={index === 0 || undefined}>
          <span className={styles.outputToken}>{item.token}</span>
          <span className={styles.outputTrack}>
            <span style={{ width: `${(item.prob / maxProb) * 100}%` }} />
          </span>
          <span className={styles.outputValue}>{formatPercent(item.prob)}</span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 流程图                                                                      */
/* -------------------------------------------------------------------------- */

const NODE_W = 118;
const NODE_H = 72;
const NODE_Y = 74;
const VIEW_W = 1180;
const VIEW_H = 238;

function ArchitectureDiagram({
  activeIndex,
  onSelect,
}: {
  activeIndex: number;
  onSelect: (index: number) => void;
}): JSX.Element {
  const gap = (VIEW_W - 60 - STAGES.length * NODE_W) / (STAGES.length - 1);
  const centerX = (index: number): number => 30 + index * (NODE_W + gap) + NODE_W / 2;
  const nodeX = (index: number): number => 30 + index * (NODE_W + gap);

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className={styles.flowSvg} role="group" aria-label="Transformer 数据流：分词、嵌入、QKV、注意力、归一化、前馈、归一化、输出">
      <defs>
        <marker id="tf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(176, 200, 235, 0.65)"/>
        </marker>
        <marker id="tf-residual" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255, 143, 116, 0.8)"/>
        </marker>
        <linearGradient id="tf-active" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6c5ff0"/>
          <stop offset="100%" stopColor="#4f46e5"/>
        </linearGradient>
      </defs>

      <text x={30} y={22} className={styles.flowCaption}>Decoder-only · 1 个 Transformer 块 · d_model = 8 · heads = 2</text>

      {STAGES.map((stage, index) => {
        const active = index === activeIndex;
        const done = index < activeIndex;
        return (
          <g
            key={stage.id}
            className={styles.node}
            data-active={active || undefined}
            data-done={done || undefined}
            role="button"
            tabIndex={0}
            aria-label={`第 ${index + 1} 步：${stage.label}`}
            onClick={() => onSelect(index)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(index);
              }
            }}
          >
            <rect
              x={nodeX(index)}
              y={NODE_Y}
              width={NODE_W}
              height={NODE_H}
              rx={12}
              className={styles.nodeRect}
            />
            <text x={nodeX(index) + 12} y={NODE_Y + 19} className={styles.nodeIndex}>{stage.index}</text>
            <text x={nodeX(index) + NODE_W / 2} y={NODE_Y + 40} textAnchor="middle" className={styles.nodeLabel}>{stage.label}</text>
            <text x={nodeX(index) + NODE_W / 2} y={NODE_Y + 57} textAnchor="middle" className={styles.nodeSub}>{stage.sub}</text>
            {index < STAGES.length - 1 ? (
              <line
                x1={nodeX(index) + NODE_W + 4}
                y1={NODE_Y + NODE_H / 2}
                x2={nodeX(index + 1) - 4}
                y2={NODE_Y + NODE_H / 2}
                className={styles.flowArrow}
                markerEnd="url(#tf-arrow)"
              />
            ) : null}
          </g>
        );
      })}

      {/* 残差旁路：嵌入 → 第一次 LN；第一次 LN → 第二次 LN */}
      <path
        d={`M ${centerX(1)} ${NODE_Y + NODE_H} C ${centerX(1)} 198, ${centerX(4)} 198, ${centerX(4)} ${NODE_Y + NODE_H + 3}`}
        className={styles.residualArc}
        markerEnd="url(#tf-residual)"
      />
      <text x={(centerX(1) + centerX(4)) / 2} y={207} textAnchor="middle" className={styles.residualLabel}>
        残差 X⁰
      </text>
      <path
        d={`M ${centerX(4)} ${NODE_Y + NODE_H} C ${centerX(4)} 222, ${centerX(6)} 222, ${centerX(6)} ${NODE_Y + NODE_H + 3}`}
        className={styles.residualArc}
        markerEnd="url(#tf-residual)"
      />
      <text x={(centerX(4) + centerX(6)) / 2} y={230} textAnchor="middle" className={styles.residualLabel}>
        残差 X¹
      </text>
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* 主组件                                                                      */
/* -------------------------------------------------------------------------- */

const EXAMPLES = ['我喜欢学习', '注意力机制', '曲面积分', '万象'] as const;

export function TransformerLab(): JSX.Element {
  const [input, setInput] = useState('我喜欢学习');
  const [stageIndex, setStageIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [head, setHead] = useState(0);
  const [queryRow, setQueryRow] = useState(0);

  const trace = useMemo(() => runTransformer(input), [input]);
  const stage = STAGES[Math.min(stageIndex, STAGES.length - 1)] ?? STAGES[0]!;
  const tokenCount = trace.tokens.length;
  const activeHead = trace.heads[head] ?? trace.heads[0]!;
  const lastIndex = Math.max(0, tokenCount - 1);
  const query = Math.min(queryRow, lastIndex);
  const { truncated } = normalizeInput(input);

  useEffect(() => {
    setQueryRow(Math.max(0, trace.tokens.length - 1));
  }, [trace.tokens.length]);

  useEffect(() => {
    if (!playing) return undefined;
    if (stageIndex >= STAGES.length - 1) {
      setPlaying(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setStageIndex((current) => Math.min(STAGES.length - 1, current + 1)), 1500);
    return () => window.clearTimeout(timer);
  }, [playing, stageIndex]);

  const gotoStage = (index: number): void => {
    setPlaying(false);
    setStageIndex(Math.max(0, Math.min(STAGES.length - 1, index)));
  };

  const togglePlay = (): void => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (stageIndex >= STAGES.length - 1) setStageIndex(0);
    setPlaying(true);
  };

  const onChangeInput = (value: string): void => {
    setInput(value);
    setStageIndex(0);
    setPlaying(false);
  };

  const x1StatsBefore = vectorStats(trace.x1Pre[lastIndex] ?? []);
  const x1StatsAfter = vectorStats(trace.x1[lastIndex] ?? []);
  const x2StatsBefore = vectorStats(trace.x2Pre[lastIndex] ?? []);
  const x2StatsAfter = vectorStats(trace.x2[lastIndex] ?? []);
  const ffnPreLast = trace.ffnPre[lastIndex] ?? [];
  const ffnAfterLast = trace.ffnActivated[lastIndex] ?? [];

  const renderStageBody = (): JSX.Element => {
    switch (stage.id) {
      case 'token':
        return (
          <div className={styles.tokenStage}>
            <div className={styles.tokenFlow}>
              <span className={styles.tokenFlowLabel}>输入</span>
              <div className={styles.tokenChips}>
                {trace.tokens.map((token, index) => (
                  <span key={`${token.codePoint}-${index}`} className={styles.tokenChip}>
                    <strong>{token.char}</strong>
                    <small>U+{token.codePoint.toString(16).toUpperCase()}</small>
                  </span>
                ))}
              </div>
              <span className={styles.tokenFlowLabel}>T = {tokenCount}</span>
            </div>
            <p className={styles.detailNote}>
              这里按字符切分，每个字符保留码点；真实模型会用 BPE / SentencePiece 等子词词表。
              输入最多 8 个字符，空格会被忽略{truncated ? '，当前内容已截断到 8 个字符' : ''}。
            </p>
          </div>
        );
      case 'embed':
        return (
          <div className={styles.stageStack}>
            <MatrixTable
              data={trace.x0}
              rowLabels={trace.tokens.map((token) => token.char)}
              colLabels={Array.from({ length: 8 }, (_, index) => `d${index + 1}`)}
              title="X0 词嵌入加位置编码"
            />
            <div className={styles.embedBreakdown}>
              <div>
                <span>token 嵌入 E</span>
                <strong>{formatCell(trace.tokenEmbedding[lastIndex]?.[0] ?? 0)} …</strong>
              </div>
              <span className={styles.embedPlus}>+</span>
              <div>
                <span>位置编码 P</span>
                <strong>{formatCell(trace.position[lastIndex]?.[0] ?? 0)} …</strong>
              </div>
              <span className={styles.embedPlus}>=</span>
              <div>
                <span>X⁰ 最后一行</span>
                <strong>{formatCell(trace.x0[lastIndex]?.[0] ?? 0)} …</strong>
              </div>
            </div>
            <p className={styles.detailNote}>
              嵌入由字符码确定性生成，位置编码使用正弦/余弦公式；两者逐维相加，所以 X⁰ 的维度仍是 8。
            </p>
          </div>
        );
      case 'qkv':
        return (
          <div className={styles.stageStack}>
            <div className={styles.stageToolbar}>
              <Segmented
                label="注意力头"
                value={head === 0 ? 'h0' : 'h1'}
                options={[
                  { value: 'h0', label: '头 1 · d1–d4' },
                  { value: 'h1', label: '头 2 · d5–d8' },
                ]}
                onChange={(value) => setHead(value === 'h0' ? 0 : 1)}
              />
              <span className={styles.stageToolbarNote}>每个头各占 4 维</span>
            </div>
            <div className={styles.qkvGrid}>
              <div>
                <h4>Q · 查询</h4>
                <MatrixTable data={activeHead.q} rowLabels={trace.tokens.map((token) => token.char)} compact title="Q 矩阵" />
              </div>
              <div>
                <h4>K · 键</h4>
                <MatrixTable data={activeHead.k} rowLabels={trace.tokens.map((token) => token.char)} compact title="K 矩阵" />
              </div>
              <div>
                <h4>V · 值</h4>
                <MatrixTable data={activeHead.v} rowLabels={trace.tokens.map((token) => token.char)} compact title="V 矩阵" />
              </div>
            </div>
            <p className={styles.detailNote}>
              三个矩阵都由 X⁰ 乘不同权重得到；接下来 Q 与 K 做点积决定“看哪里”，V 提供被加权的内容。
            </p>
          </div>
        );
      case 'attention':
        return (
          <div className={styles.stageStack}>
            <div className={styles.stageToolbar}>
              <Segmented
                label="注意力头"
                value={head === 0 ? 'h0' : 'h1'}
                options={[
                  { value: 'h0', label: '头 1' },
                  { value: 'h1', label: '头 2' },
                ]}
                onChange={(value) => setHead(value === 'h0' ? 0 : 1)}
              />
              <label className={styles.querySelect}>
                查询位置
                <select
                  value={query}
                  onChange={(event) => setQueryRow(Number(event.target.value))}
                  aria-label="选择注意力查询位置"
                >
                  {trace.tokens.map((token, index) => (
                    <option key={`${token.codePoint}-${index}`} value={index}>
                      {index + 1} · {token.char}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <AttentionHeatmap head={activeHead} tokens={trace.tokens} queryRow={query} />
            <WorkedAttention head={activeHead} tokens={trace.tokens} query={query} />
          </div>
        );
      case 'norm1':
        return (
          <div className={styles.stageStack}>
            <MatrixTable
              data={trace.x1}
              rowLabels={trace.tokens.map((token) => token.char)}
              colLabels={Array.from({ length: 8 }, (_, index) => `d${index + 1}`)}
              title="X1 第一次残差归一化结果"
            />
            <div className={styles.statsGrid}>
              <Stat label="LN 前 μ" value={formatCell(x1StatsBefore.mean)} note="最后一行" compact />
              <Stat label="LN 前 σ" value={formatCell(x1StatsBefore.std)} note="标准差" compact />
              <Stat label="LN 后 μ" value={formatCell(x1StatsAfter.mean)} note="应接近 0" compact />
              <Stat label="LN 后 σ" value={formatCell(x1StatsAfter.std)} note="应接近 1" compact />
            </div>
            <p className={styles.detailNote}>
              LayerNorm 对每个位置自己的 8 维向量做归一化，不跨 token 混合；残差 X⁰ + MHA 的结果先加回，再归一化。
            </p>
          </div>
        );
      case 'ffn':
        return (
          <div className={styles.stageStack}>
            <MatrixTable
              data={trace.ffnActivated}
              rowLabels={trace.tokens.map((token) => token.char)}
              colLabels={Array.from({ length: 16 }, (_, index) => `h${index + 1}`)}
              compact
              title="前馈网络隐层（GELU 后）"
            />
            <div className={styles.geluPanel}>
              <div>
                <span>隐层维度</span>
                <strong>8 → 16 → 8</strong>
              </div>
              <div>
                <span>最后一行 GELU 前范围</span>
                <strong>{formatCell(Math.min(...ffnPreLast))} … {formatCell(Math.max(...ffnPreLast))}</strong>
              </div>
              <div>
                <span>GELU 示例</span>
                <strong>
                  x = {formatCell(ffnPreLast[0] ?? 0)} → {formatCell(gelu(ffnPreLast[0] ?? 0))}
                </strong>
              </div>
              <div>
                <span>隐层均值</span>
                <strong>{formatCell(ffnAfterLast.reduce((sum, value) => sum + value, 0) / (ffnAfterLast.length || 1))}</strong>
              </div>
            </div>
            <p className={styles.detailNote}>
              GELU 保留正值的近似线性，对负值做平滑压缩；它是逐位置运算，所以上表 16 列只作用于各自 token。
            </p>
          </div>
        );
      case 'norm2':
        return (
          <div className={styles.stageStack}>
            <MatrixTable
              data={trace.x2}
              rowLabels={trace.tokens.map((token) => token.char)}
              colLabels={Array.from({ length: 8 }, (_, index) => `d${index + 1}`)}
              title="X2 第二次残差归一化结果"
            />
            <div className={styles.statsGrid}>
              <Stat label="LN 前 μ" value={formatCell(x2StatsBefore.mean)} note="最后一行" compact />
              <Stat label="LN 前 σ" value={formatCell(x2StatsBefore.std)} note="标准差" compact />
              <Stat label="LN 后 μ" value={formatCell(x2StatsAfter.mean)} note="应接近 0" compact />
              <Stat label="LN 后 σ" value={formatCell(x2StatsAfter.std)} note="应接近 1" compact />
            </div>
            <p className={styles.detailNote}>
              第二个残差把前馈输出加回 X¹。真实模型会在这一段后继续堆叠下一层；这里只展示 1 层的完整过程。
            </p>
          </div>
        );
      case 'output':
        return (
          <div className={styles.outputStage}>
            <div className={styles.outputTop}>
              <div>
                <span className={styles.outputLabel}>下一个 token 概率最高</span>
                <strong className={styles.outputTokenBig}>{trace.top[0]?.token ?? '—'}</strong>
                <span className={styles.outputProbBig}>{formatPercent(trace.top[0]?.prob ?? 0)}</span>
              </div>
              <div className={styles.logitsBox}>
                <span>logits 范围</span>
                <strong>{formatCell(Math.min(...trace.logits))} … {formatCell(Math.max(...trace.logits))}</strong>
                <span>softmax 后总和</span>
                <strong>{trace.probs.reduce((sum, value) => sum + value, 0).toFixed(3)}</strong>
              </div>
            </div>
            <OutputBars trace={trace} />
            <p className={styles.detailNote}>
              输出头只看最后一个位置 X²[T]；词表固定为 {VOCAB.join(' ')}。当前权重是固定教学权重，
              数值是真实矩阵运算结果，但语义不具参考性。
            </p>
          </div>
        );
      default:
        return <div/>;
    }
  };

  return (
    <article className={styles.lab} aria-labelledby="transformer-lab-title">
      <header className={styles.labHeader}>
        <div className={styles.headerText}>
          <p className={styles.kicker}>计算机 · Transformer</p>
          <h2 id="transformer-lab-title">输入一句话，逐层看见 Attention 与 FFN</h2>
          <p className={styles.lead}>
            从字符到下一个 token，每一步都给出真实张量：Q/K/V 投影、因果注意力权重、残差归一化、
            前馈网络与输出 softmax。点击流程图任意方块，或播放整条数据流。
          </p>
        </div>
        <div className={styles.headerBadge}>
          <span>Decoder-only · 1 层</span>
          <strong>d_model = 8 · h = 2</strong>
        </div>
      </header>

      <section className={styles.inputBar} aria-label="模型输入">
        <label className={styles.inputLabel} htmlFor="transformer-input">
          <span>输入一句话</span>
          <input
            id="transformer-input"
            type="text"
            value={input}
            maxLength={24}
            placeholder="例如：我喜欢学习"
            onChange={(event) => onChangeInput(event.target.value)}
          />
          <span className={styles.inputCount}>{trace.tokens.length}/8</span>
        </label>
        <div className={styles.exampleRow}>
          <span>试试</span>
          {EXAMPLES.map((example) => (
            <button key={example} type="button" onClick={() => onChangeInput(example)}>
              {example}
            </button>
          ))}
        </div>
        <p className={styles.inputHint}>
          最多 8 个字符，空格忽略。固定教学权重（LCG seed = 7）；所有数值来自真实矩阵运算，仅用于演示过程。
        </p>
      </section>

      <section className={styles.flowPanel} aria-label="Transformer 流程图">
        <div className={styles.flowTop}>
          <div>
            <span className={styles.flowEyebrow}>数据流</span>
            <strong>点击方块查看该步的张量与公式</strong>
            <span className={styles.flowScrollHint}>画布可左右滑动查看完整流程</span>
          </div>
          <div className={styles.transport}>
            <button type="button" onClick={() => gotoStage(stageIndex - 1)} disabled={stageIndex === 0}>
              上一步
            </button>
            <button type="button" className={styles.playButton} onClick={togglePlay}>
              {playing ? '暂停' : stageIndex >= STAGES.length - 1 ? '重播' : '播放'}
            </button>
            <button type="button" onClick={() => gotoStage(stageIndex + 1)} disabled={stageIndex >= STAGES.length - 1}>
              下一步
            </button>
            <span className={styles.stageCounter}>{stageIndex + 1} / {STAGES.length}</span>
          </div>
        </div>
        <ArchitectureDiagram activeIndex={stageIndex} onSelect={gotoStage} />
        <div className={styles.progress} aria-hidden="true">
          <span style={{ width: `${((stageIndex + 1) / STAGES.length) * 100}%` }} />
        </div>
        <div className={styles.shapeRibbon} aria-label="当前张量形状">
          <span className={styles.shapeRibbonLabel}>张量形状</span>
          <span data-active={stage.id === 'token' || undefined}><em>tokens</em><b>{tokenCount}</b></span>
          <span data-active={stage.id === 'embed' || stage.id === 'qkv' || stage.id === 'norm1' || stage.id === 'norm2' || undefined}><em>X</em><b>{tokenCount} × 8</b></span>
          <span data-active={stage.id === 'attention' || undefined}><em>S / A</em><b>{tokenCount} × {tokenCount}</b></span>
          <span data-active={stage.id === 'ffn' || undefined}><em>FFN</em><b>{tokenCount} × 16</b></span>
          <span data-active={stage.id === 'output' || undefined}><em>probs</em><b>8</b></span>
        </div>
      </section>

      <div className={styles.bodyGrid}>
        <section className={styles.detailPanel} aria-live="polite">
          <header className={styles.detailHead}>
            <span className={styles.stageIndex}>{stage.index}</span>
            <div className={styles.detailHeadText}>
              <div className={styles.detailTitleRow}>
                <h3>{stage.label}</h3>
                <span className={styles.shapeChip}>{stage.shape}</span>
              </div>
              <p>{stage.explanation}</p>
            </div>
          </header>
          <Formula block tex={stage.formula} className={styles.stageFormula} />
          {renderStageBody()}
          <div className={styles.detailConfig} aria-label="教学模型配置">
            <span>教学模型配置</span>
            {MODEL_CARDS.map((card) => (
              <span key={card.label}>
                <em>{card.label}</em>
                <b>{card.value}</b>
              </span>
            ))}
            <span className={styles.detailConfigNote}>单层 · 双头 · 字符级 · 固定权重</span>
          </div>
        </section>

        <aside className={styles.rail}>
          <section className={styles.predictionCard} aria-label="下一个 token 预测">
            <div className={styles.predictionHead}>
              <span>输出分布</span>
              <em>softmax · τ = 1</em>
            </div>
            <div className={styles.predictionToken}>
              <strong>{trace.top[0]?.token ?? '—'}</strong>
              <span>{formatPercent(trace.top[0]?.prob ?? 0)}</span>
            </div>
            <div className={styles.miniProbs}>
              {trace.top.slice(0, 4).map((item) => (
                <div key={`mini-${item.token}`}>
                  <span>{item.token}</span>
                  <i><b style={{ width: `${item.prob * 100}%` }} /></i>
                  <em>{formatPercent(item.prob, 1)}</em>
                </div>
              ))}
            </div>
            <p>
              位置 T 的输出只用于预测下一个 token；改变输入，整张流程图与所有矩阵都会重新计算。
            </p>
          </section>

          <section className={styles.guideCard} aria-label="使用提示">
            <h3>如何读这块画布</h3>
            <ol>
              <li>改输入，先看分词与嵌入如何变化。</li>
              <li>点流程图任一方块，查看该步的张量、形状与公式。</li>
              <li>在注意力步切换头与查询位置，对照热力图和单步数值。</li>
              <li>按“播放”让数据流从 01 走到 08，再回到任意步骤细看。</li>
            </ol>
          </section>
        </aside>
      </div>

      <section className={styles.formulas} aria-labelledby="transformer-formulas-title">
        <div className={styles.formulasHead}>
          <div>
            <p className={styles.kicker}>公式与推导</p>
            <h3 id="transformer-formulas-title">每一步为什么这样算</h3>
          </div>
          <span>位置编码 · 缩放点积 · 因果遮罩 · 多头 · 残差 · LayerNorm · GELU</span>
        </div>
        <div className={styles.formulaGrid}>
          <article className={styles.formulaCard}>
            <h4>1. 词嵌入 + 位置编码</h4>
            <Formula block tex={String.raw`X^{0}=E[t]+P(pos)`} />
            <Formula block tex={String.raw`P(pos,2i)=\sin\!\left(\frac{pos}{10000^{2i/d}}\right),\quad P(pos,2i+1)=\cos\!\left(\frac{pos}{10000^{2i/d}}\right)`} />
            <p>
              嵌入回答“是谁”，位置编码回答“在哪里”。不同频率的正弦/余弦让每个位置拥有可区分的模式；
              两者逐维相加得到 <Formula tex={String.raw`X^0`}/>，维度保持 8。
            </p>
          </article>
          <article className={styles.formulaCard}>
            <h4>2. 缩放点积注意力 + 因果遮罩</h4>
            <Formula block tex={String.raw`\mathrm{Attn}(Q,K,V)=\mathrm{softmax}\!\left(\frac{QK^{\top}}{\sqrt{d_k}}+M\right)V`} />
            <Formula block tex={String.raw`M_{ij}=\begin{cases}0,&j\le i\\-\infty,&j>i\end{cases}`} />
            <p>
              若 q、k 各维独立且方差为 1，点积的方差是 <Formula tex={String.raw`d_k`}/>；除以
              <Formula tex={String.raw`\sqrt{d_k}`}/> 把方差拉回 1。遮罩把未来位置置为 −∞，
              保证位置 i 只看 <Formula tex={String.raw`j\le i`}/>。
            </p>
          </article>
          <article className={styles.formulaCard}>
            <h4>3. 多头拼接</h4>
            <Formula block tex={String.raw`\mathrm{head}_h=\mathrm{Attn}(QW_h^Q,KW_h^K,VW_h^V),\quad \mathrm{MHA}=\mathrm{Concat}(\mathrm{head}_1,\mathrm{head}_2)W_O`} />
            <p>
              每个头在 4 维子空间里学习不同的关注模式；拼接后回到 8 维，再由
              <Formula tex={String.raw`W_O`}/> 混合。演示中两个头的权重分别初始化，因此热力图不同。
            </p>
          </article>
          <article className={styles.formulaCard}>
            <h4>4. 残差 + LayerNorm</h4>
            <Formula block tex={String.raw`\mathrm{LN}(x)=\gamma\odot\frac{x-\mu}{\sqrt{\sigma^2+\epsilon}}+\beta,\quad X^{1}=\mathrm{LN}(X^{0}+\mathrm{MHA})`} />
            <p>
              均值和方差在单个 token 的 8 维上计算，<Formula tex={String.raw`\gamma=1,\beta=0,\epsilon=10^{-5}`}/>。
              归一化后每行均值≈0、标准差≈1，右侧统计卡会给出当前实际值。
            </p>
          </article>
          <article className={styles.formulaCard}>
            <h4>5. 前馈网络与 GELU</h4>
            <Formula block tex={String.raw`F=\mathrm{GELU}(XW_1+b_1)W_2+b_2`} />
            <Formula block tex={String.raw`\mathrm{GELU}(x)\approx0.5x\left(1+\tanh\left(\sqrt{\tfrac{2}{\pi}}\,(x+0.044715x^3)\right)\right)`} />
            <p>
              先升维到 16 捕捉逐 token 的非线性特征，再压回 8。GELU 比 ReLU 平滑，
              负值不会被直接截成 0，而是被平滑压缩。
            </p>
          </article>
          <article className={styles.formulaCard}>
            <h4>6. 输出与训练目标</h4>
            <Formula block tex={String.raw`p=\mathrm{softmax}(x_T W_U+b_U),\qquad \mathcal{L}=-\log p_{y^\ast}`} />
            <p>
              推理时取概率最高的 token；训练时用交叉熵
              <Formula tex={String.raw`-\log p_{y^\ast}`}/> 反向传播，更新包括
              <Formula tex={String.raw`W_Q,W_K,W_V,W_O,W_1,W_2,W_U`}/> 在内的全部权重。本演示只做前向计算。
            </p>
          </article>
        </div>
      </section>
    </article>
  );
}

function WorkedAttention({
  head,
  tokens,
  query,
}: {
  head: AttentionHeadTrace;
  tokens: readonly Token[];
  query: number;
}): JSX.Element {
  const scores = head.scores[query] ?? [];
  const weights = head.weights[query] ?? [];
  const finiteScores = scores.filter(Number.isFinite);
  const maxScore = finiteScores.length ? Math.max(...finiteScores) : 0;
  return (
    <div className={styles.workedPanel}>
      <div className={styles.workedHead}>
        <h4>单步数值 · 查询「{tokens[query]?.char ?? query + 1}」</h4>
        <span>权重和 {weights.reduce((sum, value) => sum + value, 0).toFixed(3)}</span>
      </div>
      <div className={styles.workedTable} role="table" aria-label="注意力单步数值">
        <div role="row" className={styles.workedRow} data-head="true">
          <span>键位置</span>
          <span>Q·K / √dₖ</span>
          <span>exp(·)</span>
          <span>权重 a</span>
        </div>
        {tokens.map((token, index) => {
          const score = scores[index] ?? -Infinity;
          const masked = !Number.isFinite(score);
          return (
            <div key={`${token.codePoint}-${index}`} role="row" className={styles.workedRow} data-masked={masked || undefined}>
              <span>{index + 1} · {token.char}</span>
              <span>{masked ? '−∞' : score.toFixed(3)}</span>
              <span>{masked ? '0' : Math.exp(score - maxScore).toFixed(3)}</span>
              <span>{masked ? '0' : (weights[index] ?? 0).toFixed(3)}</span>
            </div>
          );
        })}
      </div>
      <p className={styles.workedNote}>
        softmax 先在可见位置中取最大分数做平移，再指数归一化；被遮罩的位置直接为 0。
        接下来用这些权重对 V 的行做加权求和，得到该查询位置的输出。
      </p>
    </div>
  );
}

export default TransformerLab;

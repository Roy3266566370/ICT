import { useMemo } from 'react';
import { DeepPanoramaShell } from '../DeepPanoramaShell';
import { clamp, demoLoraMatrix, finite, round, type Matrix } from '../deepPanoramaEngine';
import type { DeepPanoramaControl, DeepPanoramaRenderState, DeepScenarioPreset, DeepStageRenderState } from '../deepPanoramaTypes';
import { DF_CANDIDATES, dfCacheCounts, dfCacheLogits, dfCacheSequence, dfSampleDistribution } from '../deepFirst';
import { loraApprox, quantizeMatrix } from '../deepModernBlocks';
import type { NodeBodyProps } from '../nodes';

export const LLM_PRESETS: readonly DeepScenarioPreset[] = [
  { id: 'cache-pipeline', label: 'KV-cache 流水线', patch: { mode: 0, temperature: 1, topk: 10, topp: 1 }, note: '逐 token 对比重复计算与缓存复用' },
  { id: 'sampling-funnel', label: '温度采样漏斗', patch: { mode: 1, temperature: 1.45, topk: 6, topp: 0.86 }, note: '温度、top-k、top-p 依次收窄候选池' },
  { id: 'lora-rank', label: 'LoRA 低秩旁路', patch: { mode: 2, rank: 1, quant: 0 }, note: '冻结 W，只训练 BA；调 rank 看误差与参数压缩' },
  { id: 'quant-int8', label: 'INT8 量化', patch: { mode: 2, rank: 2, quant: 2 }, note: '用每格离散化误差换取 4× 存储压缩' },
];

const CONTROLS: readonly DeepPanoramaControl[] = [
  { key: 'temperature', label: '温度 T', min: 0.2, max: 2.4, step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'topk', label: 'top-k', min: 1, max: 10, step: 1, format: (v) => `k=${Math.round(v)}` },
  { key: 'topp', label: 'top-p', min: 0.2, max: 1, step: 0.02, format: (v) => v.toFixed(2) },
  { key: 'rank', label: 'LoRA rank r', min: 1, max: 6, step: 1, format: (v) => `r=${Math.round(v)}` },
  { key: 'quant', label: '量化精度', options: [{ value: 0, label: 'FP32' }, { value: 1, label: 'FP16' }, { value: 2, label: 'INT8' }, { value: 3, label: 'INT4' }] },
];
const STAGES = ['提示词进入', 'KV 缓存复用', '采样漏斗', 'LoRA 与量化'] as const;

function countsText(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${Math.round(value)}`;
}

function PipelineDiagram({ frame, cache }: { frame: number; cache: boolean }) {
  const step = clamp(Math.floor(frame / 16) + 1, 1, 4);
  const tokens = ['给出', '一个', '深度学习', '比喻'].concat(dfCacheSequence(4, 1, 10, 1));
  const counts = dfCacheCounts(step, 8);
  const lanes = cache ? [true] : [false, true];
  return (
    <svg viewBox="0 0 760 390" style={{ width: '100%', height: '100%' }} role="img" aria-label="逐 token 生成流水线与 KV cache 对照">
      <rect width="760" height="390" rx="14" fill="#fcfbf5" />
      <text x="42" y="42" fontSize="15" fontWeight="650" fill="#17231f">第 {step} 个 token：K/V 是重算，还是直接读取？</text>
      {lanes.map((withCache, lane) => {
        const y = 82 + lane * 132;
        const total = withCache ? counts.totalWith : counts.totalWithout;
        return <g key={String(withCache)} transform={`translate(0 ${y})`}>
          <text x="42" y="-12" fontSize="12" fontWeight="650" fill={withCache ? '#1b42cf' : '#d94824'}>{withCache ? '启用 KV-cache' : '无 cache：每个前缀重算'}</text>
          {tokens.slice(0, 8).map((token, i) => {
            const done = i < step + 3;
            const current = i === step + 3;
            const cached = withCache && done && !current;
            return <g key={token + i} transform={`translate(${44 + i * 82} 0)`}>
              <rect width="70" height="54" rx="10" fill={cached ? '#e5eafc' : current ? '#fff1e8' : '#f2f0e7'} stroke={cached ? '#1b42cf' : current ? '#d94824' : 'rgba(23,35,31,.16)'} strokeWidth={current ? 2 : 1} />
              <text x="35" y="24" fontSize="11" textAnchor="middle" fill="#17231f">{token}</text>
              <text x="35" y="42" fontSize="9" textAnchor="middle" fill={cached ? '#1b42cf' : '#6b746d'}>{cached ? 'K/V 已缓存' : current ? '正在生成' : done ? '重算 K/V' : '等待'}</text>
              {i < 7 ? <path d="M70 27 H79" stroke="rgba(23,35,31,.28)" /> : null}
            </g>;
          })}
          <rect x="48" y="72" width="250" height="40" rx="9" fill="rgba(242,240,231,.82)" />
          <text x="61" y="96" fontSize="11" fill="#17231f">MACs：<tspan fontWeight="700" fill={withCache ? '#1b42cf' : '#d94824'}>{countsText(total)}</tspan> · 注意力 {countsText(counts.attentionWith)}</text>
        </g>;
      })}
      <text x="44" y="366" fontSize="11" fill="#6b746d">KV-cache 不减少注意力点积本身，却避免每步重复跑完整前缀投影；序列越长，节省越明显。</text>
    </svg>
  );
}

function SamplingDiagram({ step, temperature, topk, topp }: { step: number; temperature: number; topk: number; topp: number }) {
  const logits = dfCacheLogits(step);
  const sample = dfSampleDistribution(logits, temperature, topk, topp);
  const order = sample.base.map((p, index) => ({ p, index })).sort((a, b) => b.p - a.p);
  return (
    <svg viewBox="0 0 760 390" style={{ width: '100%', height: '100%' }} role="img" aria-label="温度 top-k top-p 采样漏斗">
      <rect width="760" height="390" rx="14" fill="#fcfbf5" />
      <text x="42" y="42" fontSize="15" fontWeight="650" fill="#17231f">第 {step} 步候选词概率漏斗</text>
      <g transform="translate(52 76)">
        {order.map(({ p, index }, rank) => {
          const kept = sample.kept.includes(index);
          const normalized = sample.probabilities[index] ?? 0;
          return <g key={index} transform={`translate(0 ${rank * 27})`}>
            <text x="0" y="13" fontSize="10" fill="#17231f">{DF_CANDIDATES[index]}</text>
            <rect x="70" y="2" width={p * 330} height="15" rx="5" fill="rgba(184,120,24,.36)" />
            <rect x="420" y="2" width={normalized * 260} height="15" rx="5" fill={kept ? '#1b42cf' : 'rgba(23,35,31,.12)'} opacity={kept ? 0.86 : 0.45} />
            <text x={435 + normalized * 260} y="13" fontSize="9" fill={kept ? '#1b42cf' : '#6b746d'}>{(normalized * 100).toFixed(1)}%</text>
          </g>;
        })}
      </g>
      <g transform="translate(585 62)">
        <path d="M45 0 L90 20 L90 168 L45 194 L0 168 L0 20 Z" fill="rgba(27,66,207,.07)" stroke="#1b42cf" strokeOpacity=".35" />
        <text x="45" y="45" fontSize="10" textAnchor="middle" fill="#6b746d">T={temperature.toFixed(2)}</text>
        <text x="45" y="84" fontSize="10" textAnchor="middle" fill="#6b746d">k={Math.round(topk)}</text>
        <text x="45" y="123" fontSize="10" textAnchor="middle" fill="#6b746d">p≤{topp.toFixed(2)}</text>
        <text x="45" y="164" fontSize="12" fontWeight="700" textAnchor="middle" fill="#1b42cf">{sample.kept.length} 个候选</text>
      </g>
      <text x="52" y="363" fontSize="11" fill="#6b746d">左侧是温度后的原始 softmax；右侧是 top-k/top-p 截断并重新归一化的可采样概率。</text>
    </svg>
  );
}

function miniMatrix(matrix: Matrix, x: number, y: number, title: string, maxAbs = 2, cell = 26) {
  return <g transform={`translate(${x} ${y})`}>
    <text x="0" y="-8" fontSize="10" fontWeight="650" fill="#17231f">{title}</text>
    {matrix.map((row, r) => row.map((value, c) => <rect key={`${r}-${c}`} x={c * cell} y={r * cell} width={cell - 2} height={cell - 2} rx="4" fill={value >= 0 ? `rgba(27,66,207,${0.08 + clamp(Math.abs(value) / maxAbs, 0, 1) * 0.65})` : `rgba(217,72,36,${0.08 + clamp(Math.abs(value) / maxAbs, 0, 1) * 0.65})`} />))}
  </g>;
}

function LoraDiagram({ rank, quantMode }: { rank: number; quantMode: number }) {
  const base: Matrix = demoLoraMatrix();
  const lora = loraApprox(base, rank);
  const quant = quantizeMatrix(base, quantMode);
  return (
    <svg viewBox="0 0 760 390" style={{ width: '100%', height: '100%' }} role="img" aria-label="LoRA 低秩分解与权重量化误差">
      <rect width="760" height="390" rx="14" fill="#fcfbf5" />
      <text x="42" y="42" fontSize="15" fontWeight="650" fill="#17231f">冻结 W，小旁路 BA 学修正；量化再压缩存储</text>
      {miniMatrix(base, 52, 92, '冻结矩阵 W', 2, 20)}
      <text x="188" y="155" fontSize="24" fill="#6b746d">≈</text>
      {miniMatrix(lora.approx, 230, 92, `低秩近似 BA（r=${lora.rank}）`, 2, 20)}
      <g transform="translate(410 92)">
        <rect width="130" height="112" rx="12" fill="#e5eafc" stroke="#1b42cf" strokeOpacity=".22" />
        <text x="16" y="28" fontSize="11" fill="#6b746d">参数量</text>
        <text x="16" y="53" fontSize="19" fontWeight="700" fill="#1b42cf">{lora.adapterParams}/{lora.originalParams}</text>
        <text x="16" y="79" fontSize="10" fill="#6b746d">压缩到 {(lora.compression * 100).toFixed(0)}%</text>
      </g>
      {miniMatrix(quant.quantized, 52, 245, `${['FP32', 'FP16', 'INT8', 'INT4'][Math.round(quantMode)] ?? 'FP32'} 量化后`, 1.6, 18)}
      <g transform="translate(410 245)">
        <rect width="275" height="92" rx="12" fill="rgba(242,240,231,.8)" stroke="rgba(23,35,31,.12)" />
        <text x="16" y="26" fontSize="11" fill="#6b746d">LoRA Frobenius 相对误差</text>
        <text x="16" y="51" fontSize="18" fontWeight="700" fill={lora.error > 0.2 ? '#d94824' : '#16835b'}>{(lora.error * 100).toFixed(1)}%</text>
        <text x="16" y="75" fontSize="11" fill="#6b746d">量化最大误差 {quant.maxError.toFixed(3)} · 存储 {quant.compression.toFixed(1)}×</text>
      </g>
    </svg>
  );
}

function MainVisual(state: DeepPanoramaRenderState) {
  const step = clamp(Math.floor(state.frame / 16) + 1, 1, 4);
  if (state.stage === 2) return <SamplingDiagram step={step} temperature={finite(state.params.temperature, 1)} topk={finite(state.params.topk, 10)} topp={finite(state.params.topp, 1)} />;
  if (state.stage === 3) return <LoraDiagram rank={finite(state.params.rank, 2)} quantMode={finite(state.params.quant, 0)} />;
  return <PipelineDiagram frame={state.frame} cache={state.stage >= 1} />;
}

export function LlmInferenceLoraPanorama({ node, onParams }: NodeBodyProps) {
  const base = { mode: 0, temperature: 1, topk: 10, topp: 1, rank: 2, quant: 0 };
  const params = { ...base, ...node.params };
  return (
    <DeepPanoramaShell
      title="LLM 推理、KV-cache 与 LoRA"
      subtitle="逐 token 流水线 × 采样漏斗 × 低秩量化"
      stages={STAGES}
      presets={LLM_PRESETS}
      params={params}
      totalSteps={64}
      controls={CONTROLS}
      onParams={onParams}
      resetPatch={base}
      stageForFrame={(frame) => frame < 14 ? 0 : frame < 30 ? 1 : frame < 48 ? 2 : 3}
      caption={(state) => <span><strong>{STAGES[state.stage]}</strong> · 播放轴驱动 4 个生成步；采样与部署参数实时联动</span>}
      renderFormula={(state) => {
        const step = clamp(Math.floor(state.frame / 16) + 1, 1, 4);
        const counts = dfCacheCounts(step, 8);
        const saving = 1 - counts.totalWith / Math.max(1, counts.totalWithout);
        return <span>pᵢ = softmax(zᵢ/T) 经 top-k/top-p 重归一　MACs <code>{countsText(counts.totalWithout)}→{countsText(counts.totalWith)}</code>（省 <code>{(saving * 100).toFixed(0)}%</code>）　W′ = W + BA</span>;
      }}
      renderKpis={(state) => {
        const step = clamp(Math.floor(state.frame / 16) + 1, 1, 4);
        const counts = dfCacheCounts(step, 8);
        const sample = dfSampleDistribution(dfCacheLogits(step), finite(state.params.temperature, 1), finite(state.params.topk, 10), finite(state.params.topp, 1));
        const baseMatrix: Matrix = demoLoraMatrix();
        const lora = loraApprox(baseMatrix, finite(state.params.rank, 2));
        return [
          { label: 'KV 计算节省', value: `${((1 - counts.totalWith / counts.totalWithout) * 100).toFixed(0)}%`, tone: 'blue' },
          { label: '候选保留', value: `${sample.kept.length}/10`, tone: 'green' },
          { label: 'LoRA 参数占比', value: `${(lora.compression * 100).toFixed(0)}%`, tone: 'ochre' },
          { label: '当前 token 步', value: `${step}/4` },
        ];
      }}
    >
      {(state) => <MainVisual {...state} />}
    </DeepPanoramaShell>
  );
}


export function LlmSourceStage(state: DeepStageRenderState) {
  return <MainVisual {...state} stage={0} />;
}
export function LlmCacheStage(state: DeepStageRenderState) {
  return <MainVisual {...state} stage={1} />;
}
export function LlmSamplingStage(state: DeepStageRenderState) {
  return <MainVisual {...state} stage={2} />;
}
export function LlmLoraStage(state: DeepStageRenderState) {
  return <MainVisual {...state} stage={3} />;
}

import { useCallback, useMemo } from 'react';
import { DeepPanoramaShell, PanoramaCanvas } from '../DeepPanoramaShell';
import { clamp, diffusionCenters, diffusionScore, diffusionTrajectoryCached, finite, type Matrix } from '../deepPanoramaEngine';
import type { DeepPanoramaControl, DeepPanoramaRenderState, DeepScenarioPreset } from '../deepPanoramaTypes';
import type { NodeBodyProps } from '../nodes';

export const DIFFUSION_PRESETS: readonly DeepScenarioPreset[] = [
  { id: 'bimodal-forward', label: '双模态加噪', patch: { scenario: 0, beta: 3, steps: 28 }, note: '两团数据逐渐被各向同性噪声淹没' },
  { id: 'swiss-reverse', label: '瑞士卷逆扩散', patch: { scenario: 2, beta: 3, steps: 34 }, note: '粒子沿解析 score 场逆时间流回卷曲流形' },
  { id: 'score-field', label: 'Score 矢量场', patch: { scenario: 2, beta: 2.2, steps: 30 }, note: '观察 ∇log p_t(x) 如何随噪声尺度变形' },
  { id: 'latent-nce', label: '潜空间对比', patch: { scenario: 2, beta: 3, steps: 28, anchorX: 0.6, anchorY: 0.2 }, note: '扩散生成与 InfoNCE 表示学习共用几何直觉' },
];

const CONTROLS: readonly DeepPanoramaControl[] = [
  { key: 'beta', label: '噪声速率 β', min: 1, max: 5, step: 0.1, format: (v) => v.toFixed(1) },
  { key: 'steps', label: '反向步数', min: 8, max: 42, step: 1, format: (v) => `${Math.round(v)} 步` },
  { key: 'anchorX', label: 'anchor x', min: -1.6, max: 1.6, step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'anchorY', label: 'anchor y', min: -1.6, max: 1.6, step: 0.05, format: (v) => v.toFixed(2) },
];
const STAGES = ['数据流形', '前向加噪', 'Score 反向流动', '潜空间 InfoNCE'] as const;
const SCALE = 2.8;

function project(point: readonly number[], width: number, height: number): [number, number] {
  return [width / 2 + point[0]! / SCALE * width * 0.46, height / 2 - point[1]! / SCALE * height * 0.46];
}

function DiffusionCanvas({ trajectory, frame, stage, beta }: { trajectory: ReturnType<typeof diffusionTrajectoryCached>; frame: number; stage: number; beta: number }) {
  const steps = trajectory.frames.length - 1;
  const phase = clamp(frame, 0, steps * 2);
  const forward = phase <= steps;
  const index = Math.round(forward ? steps - phase : phase - steps);
  const points = trajectory.frames[clamp(index, 0, steps)] ?? [];
  const t = forward ? 4 * phase / Math.max(1, steps) : 4 * (1 - index / Math.max(1, steps));
  const previous = trajectory.frames[clamp(forward ? index + 3 : index - 3, 0, steps)] ?? points;
  const draw = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fcfbf5';
    ctx.fillRect(0, 0, width, height);
    const low = document.createElement('canvas');
    const lw = 112;
    const lh = 76;
    low.width = lw;
    low.height = lh;
    const lowCtx = low.getContext('2d');
    if (lowCtx) {
      const image = lowCtx.createImageData(lw, lh);
      const centers = trajectory.mixture.centers;
      for (let yy = 0; yy < lh; yy += 1) {
        for (let xx = 0; xx < lw; xx += 1) {
          const x = (xx / (lw - 1) - 0.5) * SCALE * 2;
          const y = -(yy / (lh - 1) - 0.5) * SCALE * 2;
          const score = diffusionScore([x, y], t, centers, trajectory.mixture.variance, beta);
          const density = clamp((score.logDensity + 7) / 7, 0, 1);
          const i = (yy * lw + xx) * 4;
          image.data[i] = 226 - density * 56;
          image.data[i + 1] = 229 - density * 68;
          image.data[i + 2] = 239 - density * 36;
          image.data[i + 3] = 210;
        }
      }
      lowCtx.putImageData(image, 0, 0);
    }
    ctx.drawImage(low, 16, 14, width - 32, height - 34);
    ctx.strokeStyle = 'rgba(23,35,31,.16)';
    ctx.strokeRect(16, 14, width - 32, height - 34);
    if (stage >= 2) {
      for (let gy = 0; gy < 5; gy += 1) {
        for (let gx = 0; gx < 7; gx += 1) {
          const x = -2.1 + gx * 0.7;
          const y = -1.65 + gy * 0.82;
          const vector = diffusionScore([x, y], t, trajectory.mixture.centers, trajectory.mixture.variance, beta).score;
          const [x1, y1] = project([x, y], width - 32, height - 34);
          const len = clamp(Math.hypot(vector[0], vector[1]) * 7, 3, 16);
          const angle = Math.atan2(-vector[1], vector[0]);
          ctx.save();
          ctx.translate(16 + x1, 14 + y1);
          ctx.rotate(angle);
          ctx.strokeStyle = 'rgba(217,72,36,.52)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(-len / 2, 0);
          ctx.lineTo(len / 2, 0);
          ctx.lineTo(len / 2 - 4, -3);
          ctx.moveTo(len / 2, 0);
          ctx.lineTo(len / 2 - 4, 3);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
    points.forEach((point, i) => {
      const [x, y] = project(point, width - 32, height - 34);
      const [px, py] = project(previous[i] ?? point, width - 32, height - 34);
      if (i % 4 === 0) {
        ctx.strokeStyle = 'rgba(27,66,207,.14)';
        ctx.beginPath();
        ctx.moveTo(16 + px, 14 + py);
        ctx.lineTo(16 + x, 14 + y);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(16 + x, 14 + y, i % 9 === 0 ? 2.8 : 1.8, 0, Math.PI * 2);
      ctx.fillStyle = i % 9 === 0 ? '#d94824' : '#1b42cf';
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(23,35,31,.72)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(`${forward ? '前向加噪' : '反向去噪'} · t=${t.toFixed(2)} · particles=${points.length}`, 28, height - 16);
  }, [trajectory, points, previous, t, forward, stage, beta, steps]);
  return <PanoramaCanvas draw={draw} label="扩散粒子轨迹、概率密度与 score 矢量场" />;
}

function LatentPanel({ anchorX, anchorY, centers }: { anchorX: number; anchorY: number; centers: Matrix }) {
  const positives = centers.filter((_, i) => i % 12 === 0).slice(0, 4);
  const anchor: [number, number] = [anchorX, anchorY];
  const distance = Math.hypot(anchor[0] - (positives[0]?.[0] ?? 0), anchor[1] - (positives[0]?.[1] ?? 0));
  const similarity = Math.exp(-distance);
  const px = (point: readonly number[]) => project(point, 300, 220);
  return (
    <svg viewBox="0 0 300 260" style={{ width: '100%', height: '100%' }} role="img" aria-label="潜空间 anchor 与正负样本对比">
      <rect width="300" height="260" rx="12" fill="rgba(242,240,231,.72)" />
      <text x="18" y="28" fontSize="12" fontWeight="650" fill="#17231f">InfoNCE 潜空间</text>
      {positives.map((point, i) => {
        const [x, y] = px(point);
        return <g key={i}>
          <line x1={px(anchor)[0]} y1={px(anchor)[1]} x2={x} y2={y} stroke={i === 0 ? '#16835b' : '#d94824'} strokeOpacity=".28" strokeDasharray="4 4" />
          <circle cx={x} cy={y} r="7" fill={i === 0 ? '#16835b' : '#d94824'} opacity=".82" />
          <text x={x + 9} y={y + 4} fontSize="8" fill="#6b746d">{i === 0 ? '正样本' : '负样本'}</text>
        </g>;
      })}
      <circle cx={px(anchor)[0]} cy={px(anchor)[1]} r="9" fill="#b87818" stroke="#fff" strokeWidth="2" />
      <text x="18" y="238" fontSize="10" fill="#6b746d">anchor 相似度 e^-d = {similarity.toFixed(2)}；右侧参数舱可拖动 anchor</text>
    </svg>
  );
}

function SchedulePanel({ alphaBar, logDensity, index }: { alphaBar: number[]; logDensity: number[]; index: number }) {
  const line = (series: number[], invert = false) => series.map((value, i) => {
    const x = 18 + i / Math.max(1, series.length - 1) * 264;
    const normalized = invert ? clamp((value + 5) / 7, 0, 1) : clamp(value, 0, 1);
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${92 - normalized * 70}`;
  }).join(' ');
  return (
    <svg viewBox="0 0 300 116" style={{ width: '100%', height: '100%' }} role="img" aria-label="alpha-bar 与平均对数密度曲线">
      <rect width="300" height="116" rx="12" fill="rgba(242,240,231,.72)" />
      <path d={line(alphaBar)} fill="none" stroke="#b87818" strokeWidth="2" />
      <path d={line(logDensity, true)} fill="none" stroke="#1b42cf" strokeWidth="2" />
      <line x1={18 + index / Math.max(1, alphaBar.length - 1) * 264} x2={18 + index / Math.max(1, alphaBar.length - 1) * 264} y1="18" y2="96" stroke="#d94824" strokeDasharray="3 3" />
      <text x="18" y="15" fontSize="9" fill="#b87818">ᾱ(t)</text>
      <text x="72" y="15" fontSize="9" fill="#1b42cf">mean log p(x)</text>
    </svg>
  );
}

function MainVisual(state: DeepPanoramaRenderState) {
  const scenario = Math.round(finite(state.params.scenario, 2, 0, 3));
  const beta = finite(state.params.beta, 3, 1, 5);
  const steps = Math.round(finite(state.params.steps, 30, 8, 42));
  const trajectory = useMemo(() => diffusionTrajectoryCached({ scenario, steps, beta }), [scenario, steps, beta]);
  const phase = clamp(state.frame, 0, steps * 2);
  const forward = phase <= steps;
  const index = Math.round(forward ? steps - phase : phase - steps);
  const showLatent = state.stage === 3;
  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: showLatent ? 'minmax(0,1.45fr) 300px' : 'minmax(0,1fr)', gridTemplateRows: showLatent ? 'minmax(0,1fr)' : 'minmax(0,1fr) 116px', gap: 10, padding: 12 }}>
      <div style={{ minWidth: 0, minHeight: 0, border: '1px solid rgba(23,35,31,.12)', borderRadius: 10, overflow: 'hidden' }}>
        <DiffusionCanvas trajectory={trajectory} frame={state.frame} stage={state.stage} beta={beta} />
      </div>
      {showLatent
        ? <LatentPanel anchorX={finite(state.params.anchorX, 0.6)} anchorY={finite(state.params.anchorY, 0.2)} centers={trajectory.mixture.centers} />
        : <SchedulePanel alphaBar={trajectory.alphaBar} logDensity={trajectory.logDensity} index={clamp(index, 0, steps)} />}
    </div>
  );
}

export function DiffusionLatentPanorama({ node, onParams }: NodeBodyProps) {
  const base = { scenario: 2, beta: 3, steps: 30, anchorX: 0.6, anchorY: 0.2 };
  const params = { ...base, ...node.params };
  return (
    <DeepPanoramaShell
      title="扩散轨迹与潜空间"
      subtitle="前向加噪 × Score 反向流动 × InfoNCE"
      stages={STAGES}
      presets={DIFFUSION_PRESETS}
      params={params}
      totalSteps={(p) => Math.round(finite(p.steps, 30, 8, 42)) * 2 + 1}
      controls={CONTROLS}
      onParams={onParams}
      resetPatch={base}
      stageForFrame={(frame, p) => {
        const steps = Math.round(finite(p.steps, 30, 8, 42));
        return frame < steps * 0.35 ? 0 : frame < steps ? 1 : frame < steps * 1.86 ? 2 : 3;
      }}
      caption={(state) => {
        const steps = Math.round(finite(state.params.steps, 30, 8, 42));
        const forward = state.frame <= steps;
        return <span><strong>{forward ? '闭式加噪' : 'probability-flow 反向积分'}</strong> · 粒子拖尾显示最近几步轨迹，红色箭头是解析 score</span>;
      }}
      renderFormula={(state) => {
        const steps = Math.round(finite(state.params.steps, 30, 8, 42));
        const beta = finite(state.params.beta, 3, 1, 5);
        const t = state.frame <= steps ? 4 * state.frame / steps : 4 * (1 - (state.frame - steps) / steps);
        const alpha = Math.exp(-beta * clamp(t, 0, 4));
        return <span>xₜ = √ᾱx₀ + √(<code>1−ᾱ</code>)ε　ᾱ=e^(−{beta.toFixed(1)}t)=<code>{alpha.toFixed(3)}</code>　dx/dt = 1.5[x+∇log pₜ(x)]</span>;
      }}
      renderKpis={(state) => {
        const scenario = Math.round(finite(state.params.scenario, 2, 0, 3));
        const beta = finite(state.params.beta, 3, 1, 5);
        const steps = Math.round(finite(state.params.steps, 30, 8, 42));
        const trajectory = diffusionTrajectoryCached({ scenario, steps, beta });
        const index = Math.round(state.frame <= steps ? steps - state.frame : state.frame - steps);
        const density = trajectory.logDensity[clamp(index, 0, steps)] ?? 0;
        const alpha = trajectory.alphaBar[clamp(index, 0, steps)] ?? 0;
        return [
          { label: 'ᾱ(t)', value: alpha.toFixed(3), tone: 'ochre' },
          { label: 'mean log p', value: density.toFixed(2), tone: density > -1 ? 'green' : 'blue' },
          { label: '粒子数', value: '180', tone: 'blue' },
          { label: '流形中心', value: `${diffusionCenters(scenario).length}` },
        ];
      }}
    >
      {(state) => <MainVisual {...state} />}
    </DeepPanoramaShell>
  );
}

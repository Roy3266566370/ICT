import { useMemo } from 'react';
import { DeepPanoramaShell } from '../DeepPanoramaShell';
import { clamp, finite, rlTransition, round, trainRlPanoramaCached } from '../deepPanoramaEngine';
import type { DeepPanoramaControl, DeepPanoramaRenderState, DeepScenarioPreset } from '../deepPanoramaTypes';
import type { NodeBodyProps } from '../nodes';

export const RL_PRESETS: readonly DeepScenarioPreset[] = [
  { id: 'qlearning-cliff', label: 'Q-learning 悬崖', patch: { reinforce: 0, alpha: 0.18, gamma: 0.95, epsilon: 0.22 }, note: 'ε-greedy 在悬崖边学会权衡近路与风险' },
  { id: 'explore-high', label: '高探索慢收敛', patch: { reinforce: 0, alpha: 0.14, gamma: 0.95, epsilon: 0.55 }, note: '探索率升高后路径更乱，但不容易陷入早停' },
  { id: 'gamma-myopic', label: '短视折扣对照', patch: { reinforce: 0, alpha: 0.18, gamma: 0.55, epsilon: 0.22 }, note: 'γ 降低会削弱远处目标对当前 Q 值的牵引' },
  { id: 'reinforce-policy', label: 'REINFORCE 策略', patch: { reinforce: 1, alpha: 0.08, gamma: 0.95, epsilon: 0 }, note: '直接按回合回报拉升已发生动作的概率' },
];
const CONTROLS: readonly DeepPanoramaControl[] = [
  { key: 'alpha', label: '学习率 α', min: 0.01, max: 0.5, step: 0.01, format: (v) => v.toFixed(2) },
  { key: 'gamma', label: '折扣 γ', min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
  { key: 'epsilon', label: '探索率 ε', min: 0, max: 0.8, step: 0.01, format: (v) => v.toFixed(2) },
  { key: 'reinforce', label: '算法', options: [{ value: 0, label: 'Q-learning' }, { value: 1, label: 'REINFORCE' }] },
];
const STAGES = ['环境奖励', '随机探索', 'Q 值指南针', '回报与贝尔曼方程'] as const;
const ACTIONS = ['↑', '→', '↓', '←'];
const center = (state: number) => [72 + (state % 6) * 84, 52 + Math.floor(state / 6) * 54] as const;

function rewardOfCell(state: number): number {
  if (state === 35) return 20;
  if (state > 30 && state < 35) return -100;
  return -1;
}

function GridWorld({ snapshot, frame, selected, onSelect }: { snapshot: ReturnType<typeof trainRlPanoramaCached>; frame: number; selected: number; onSelect: (state: number) => void }) {
  const path = snapshot.lastPath.length ? snapshot.lastPath : [30];
  const pathIndex = Math.floor(frame * 3) % path.length;
  const agent = path[pathIndex] ?? 30;
  const maxAbs = Math.max(1, ...snapshot.values.flat().map(Math.abs));
  return (
    <svg viewBox="0 0 610 390" style={{ width: '100%', height: '100%' }} role="img" aria-label="6×6 悬崖迷宫、策略指南针与智能体路径">
      <rect width="610" height="390" rx="14" fill="#fcfbf5" />
      {Array.from({ length: 36 }, (_, state) => {
        const row = Math.floor(state / 6);
        const col = state % 6;
        const x = 30 + col * 84;
        const y = 25 + row * 54;
        const value = snapshot.values[row]?.[col] ?? 0;
        const cliff = state > 30 && state < 35;
        const goal = state === 35;
        const fill = cliff ? 'rgba(217,72,36,.28)' : goal ? 'rgba(22,131,91,.28)' : value >= 0 ? `rgba(27,66,207,${0.04 + clamp(value / maxAbs, 0, 1) * 0.34})` : `rgba(217,72,36,${0.04 + clamp(-value / maxAbs, 0, 1) * 0.2})`;
        return <g key={state} onClick={() => onSelect(state)} style={{ cursor: 'pointer' }}>
          <rect x={x} y={y} width="78" height="48" rx="8" fill={fill} stroke={selected === state ? '#1b42cf' : 'rgba(23,35,31,.15)'} strokeWidth={selected === state ? 2.5 : 1} />
          <text x={x + 8} y={y + 16} fontSize="8" fill="#6b746d">r={rewardOfCell(state)}</text>
          {!cliff && !goal ? <g transform={`translate(${x + 39} ${y + 28})`}>
            {snapshot.policy[state]!.map((q, action) => {
              const angle = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][action]!;
              const best = q === Math.max(...snapshot.policy[state]!);
              const length = 8 + clamp((q + maxAbs / 2) / maxAbs, 0, 1) * 12;
              return <line key={action} x1="0" y1="0" x2={Math.cos(angle) * length} y2={Math.sin(angle) * length} stroke={best ? '#1b42cf' : 'rgba(23,35,31,.28)'} strokeWidth={best ? 3 : 1.2} strokeLinecap="round" />;
            })}
          </g> : null}
          {cliff ? <text x={x + 39} y={y + 32} fontSize="15" textAnchor="middle" fill="#d94824">崖</text> : null}
          {goal ? <text x={x + 39} y={y + 32} fontSize="15" textAnchor="middle" fill="#16835b">★</text> : null}
        </g>;
      })}
      <path d={path.map((state, i) => `${i ? 'L' : 'M'}${center(state)[0]} ${center(state)[1]}`).join(' ')} fill="none" stroke="#b87818" strokeWidth="3" strokeOpacity=".55" strokeLinejoin="round" />
      <circle cx={center(agent)[0]} cy={center(agent)[1]} r="12" fill="#d94824" stroke="#fff" strokeWidth="3" />
      <text x={center(agent)[0]} y={center(agent)[1] + 4} fontSize="11" textAnchor="middle" fill="#fff">A</text>
      <text x="30" y="374" fontSize="11" fill="#6b746d">点击任意格子查看贝尔曼更新；箭头长度/蓝线表示当前最优动作。</text>
    </svg>
  );
}

function CurvePanel({ snapshot }: { snapshot: ReturnType<typeof trainRlPanoramaCached> }) {
  const chart = (series: number[], color: string, yOffset: number, label: string) => {
    const min = Math.min(...series, 0);
    const max = Math.max(...series, 1);
    const points = series.map((value, i) => `${18 + i / Math.max(1, series.length - 1) * 250},${yOffset + 74 - (value - min) / Math.max(1e-6, max - min) * 62}`).join(' ');
    return <g><text x="18" y={yOffset - 6} fontSize="9" fill="#6b746d">{label}</text><polyline points={points} fill="none" stroke={color} strokeWidth="2" /></g>;
  };
  return (
    <svg viewBox="0 0 285 390" style={{ width: '100%', height: '100%' }} role="img" aria-label="训练回报与回合长度曲线">
      <rect width="285" height="390" rx="14" fill="rgba(242,240,231,.64)" />
      {chart(snapshot.returns, '#1b42cf', 42, 'Episode return')}
      {chart(snapshot.steps, '#d94824', 172, 'Steps per episode')}
      <g transform="translate(18 300)">
        <rect width="248" height="66" rx="10" fill="#fcfbf5" stroke="rgba(23,35,31,.12)" />
        <text x="12" y="22" fontSize="10" fill="#6b746d">最新回合</text>
        <text x="12" y="45" fontSize="16" fontWeight="700" fill="#1b42cf">R={snapshot.returns[snapshot.returns.length - 1] ?? 0} · {snapshot.steps[snapshot.steps.length - 1] ?? 0} 步</text>
      </g>
    </svg>
  );
}

function MainVisual(state: DeepPanoramaRenderState) {
  const episodes = clamp(Math.floor(state.frame) + 1, 1, 160);
  const alpha = finite(state.params.alpha, 0.18);
  const gamma = finite(state.params.gamma, 0.95);
  const epsilon = finite(state.params.epsilon, 0.22);
  const reinforce = finite(state.params.reinforce, 0, 0, 1);
  const snapshot = useMemo(() => trainRlPanoramaCached({ episodes, alpha, gamma, epsilon, reinforce }), [episodes, alpha, gamma, epsilon, reinforce]);
  const selected = Math.round(finite(state.params.selectedState, 30, 0, 35));
  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: 'minmax(0,1.8fr) 285px', gap: 10, padding: 12 }}>
      <div style={{ minWidth: 0, border: '1px solid rgba(23,35,31,.12)', borderRadius: 10, overflow: 'hidden' }}>
        <GridWorld snapshot={snapshot} frame={state.frame} selected={selected} onSelect={(next) => state.setParam('selectedState', next)} />
      </div>
      <CurvePanel snapshot={snapshot} />
    </div>
  );
}

export function RlAgentPanorama({ node, onParams }: NodeBodyProps) {
  const base = { alpha: 0.18, gamma: 0.95, epsilon: 0.22, reinforce: 0, selectedState: 30 };
  const params = { ...base, ...node.params };
  return (
    <DeepPanoramaShell
      title="强化学习智能体进化"
      subtitle="悬崖迷宫 × Q 值指南针 × 回报曲线"
      stages={STAGES}
      presets={RL_PRESETS}
      params={params}
      totalSteps={160}
      controls={CONTROLS}
      onParams={onParams}
      resetPatch={base}
      stageForFrame={(frame) => frame < 18 ? 0 : frame < 55 ? 1 : frame < 115 ? 2 : 3}
      caption={(state) => <span><strong>第 {Math.floor(state.frame) + 1} 回合</strong> · 橙色轨迹是最近一次 rollout，红色 A 是智能体</span>}
      renderFormula={(state) => {
        const episodes = clamp(Math.floor(state.frame) + 1, 1, 160);
        const alpha = finite(state.params.alpha, 0.18);
        const gamma = finite(state.params.gamma, 0.95);
        const epsilon = finite(state.params.epsilon, 0.22);
        const reinforce = finite(state.params.reinforce, 0, 0, 1);
        const snapshot = trainRlPanoramaCached({ episodes, alpha, gamma, epsilon, reinforce });
        const stateIndex = Math.round(finite(state.params.selectedState, 30, 0, 35));
        const row = snapshot.table[stateIndex]!;
        const action = row.indexOf(Math.max(...row));
        const transition = rlTransition(stateIndex, action);
        const nextMax = Math.max(...snapshot.table[transition.next]!);
        return <span>Q(s,a) ← Q + α[r+γmaxQ(s′)]　<code>{round(row[action]!, 2)} + {alpha.toFixed(2)}[{transition.reward}+{gamma.toFixed(2)}×{round(nextMax, 2)}]</code>　最优 {ACTIONS[action]}</span>;
      }}
      renderKpis={(state) => {
        const episodes = clamp(Math.floor(state.frame) + 1, 1, 160);
        const snapshot = trainRlPanoramaCached({ episodes, alpha: finite(state.params.alpha, 0.18), gamma: finite(state.params.gamma, 0.95), epsilon: finite(state.params.epsilon, 0.22), reinforce: finite(state.params.reinforce, 0, 0, 1) });
        const latestReturn = snapshot.returns[snapshot.returns.length - 1] ?? 0;
        const latestSteps = snapshot.steps[snapshot.steps.length - 1] ?? 0;
        const bestRow = snapshot.policy[30]!;
        return [
          { label: 'Episode', value: `${episodes}/160`, tone: 'blue' },
          { label: '最新回报', value: `${latestReturn}`, tone: latestReturn >= 0 ? 'green' : 'red' },
          { label: '最新步数', value: `${latestSteps}`, tone: 'ochre' },
          { label: '起点最优', value: ACTIONS[bestRow.indexOf(Math.max(...bestRow))] ?? '→' },
        ];
      }}
    >
      {(state) => <MainVisual {...state} />}
    </DeepPanoramaShell>
  );
}

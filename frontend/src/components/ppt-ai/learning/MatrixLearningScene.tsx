import type { ReactNode } from 'react';
import type { ChangeOfBasisScene, EigenScene, InverseScene } from '@/ppt-ai/learning/sceneAdapter';
import styles from './LearningPanel.module.css';

interface Props {
  scene: EigenScene | ChangeOfBasisScene | InverseScene;
}

function fmt(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value - Math.round(value)) < 1e-10) return String(Math.round(value));
  return String(Math.round(value * 10 ** digits) / 10 ** digits);
}

function MatrixText({ matrix, label }: { matrix: number[][]; label: string }) {
  return (
    <span className={styles.matrixValue} aria-label={`${label} 矩阵`}>
      <b>{label}</b>
      <span>[{matrix.map((row) => `[${row.map((value) => fmt(value)).join(', ')}]`).join(', ')}]</span>
    </span>
  );
}

function VectorArrow({ to, color, label }: { to: [number, number]; color: string; label: string }) {
  return (
    <g>
      <line x1={0} y1={0} x2={to[0]} y2={to[1]} stroke={color} strokeWidth={2.4} markerEnd={`url(#arrow-${color.replace('#', '')})`} />
      <text x={to[0] * 1.06} y={to[1] * 1.06} fill={color} fontSize={12} fontWeight={700}>{label}</text>
    </g>
  );
}

function Axes({ size, range, children }: { size: number; range: number; children: ReactNode }) {
  const unit = size / (range * 2);
  return (
    <svg viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} className={styles.matrixSvg} role="img">
      <defs>
        {['#1d4ed8', '#ff7a59', '#0f766e', '#7c3aed'].map((color) => (
          <marker key={color} id={`arrow-${color.replace('#', '')}`} markerWidth="8" markerHeight="8"
            refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L7,3 z" fill={color}/>
          </marker>
        ))}
      </defs>
      <g transform={`scale(${unit}, ${-unit})`}>
        {Array.from({ length: 11 }, (_value, index) => index - 5).map((tick) => (
          <g key={tick}>
            <line x1={tick} y1={-5.4} x2={tick} y2={5.4} stroke="#e2e8f0" strokeWidth={0.015}/>
            <line x1={-5.4} y1={tick} x2={5.4} y2={tick} stroke="#e2e8f0" strokeWidth={0.015}/>
          </g>
        ))}
        <line x1={-5.6} y1={0} x2={5.6} y2={0} stroke="#94a3b8" strokeWidth={0.03}/>
        <line x1={0} y1={-5.6} x2={0} y2={5.6} stroke="#94a3b8" strokeWidth={0.03}/>
        {children}
      </g>
    </svg>
  );
}

export function MatrixLearningScene({ scene }: Props) {
  if (scene.kind === 'eigen') {
    const magnitude = Math.max(1, ...scene.vector.map(Math.abs), ...scene.product.map(Math.abs));
    const range = Math.max(2, Math.ceil(magnitude * 1.25));
    return (
      <div className={styles.scene}>
        <Axes size={360} range={range}>
          <VectorArrow to={[scene.vector[0] ?? 0, scene.vector[1] ?? 0]} color="#1d4ed8" label="v"/>
          <VectorArrow to={[scene.product[0] ?? 0, scene.product[1] ?? 0]} color="#ff7a59" label="Av"/>
        </Axes>
        <div className={styles.sceneText}>
          <MatrixText matrix={scene.matrix} label="A"/>
          <span>v = ({fmt(scene.vector[0] ?? 0)}, {fmt(scene.vector[1] ?? 0)})</span>
          <span>Av = ({fmt(scene.product[0] ?? 0)}, {fmt(scene.product[1] ?? 0)})</span>
          <strong data-tone={
            scene.zeroVector ? 'warn' : scene.isEigenvector ? 'pass' : 'neutral'
          }>{scene.message}</strong>
          {scene.ratio !== null ? <span>倍率：{fmt(scene.ratio)}</span> : null}
        </div>
      </div>
    );
  }
  if (scene.kind === 'change_of_basis') {
    const magnitude = Math.max(1, ...scene.worldX.map(Math.abs), ...scene.worldAx.map(Math.abs), ...scene.basis.flat().map(Math.abs));
    const range = Math.max(2, Math.ceil(magnitude * 1.25));
    return (
      <div className={styles.scene}>
        <Axes size={360} range={range}>
          <VectorArrow to={[scene.basis[0]![0]!, scene.basis[1]![0]!]} color="#0f766e" label="e₁′"/>
          <VectorArrow to={[scene.basis[0]![1]!, scene.basis[1]![1]!]} color="#7c3aed" label="e₂′"/>
          <VectorArrow to={[scene.worldX[0]!, scene.worldX[1]!]} color="#1d4ed8" label="x"/>
          <VectorArrow to={[scene.worldAx[0]!, scene.worldAx[1]!]} color="#ff7a59" label="Ax"/>
        </Axes>
        <div className={styles.sceneText}>
          <MatrixText matrix={scene.matrix} label="A"/>
          <MatrixText matrix={scene.basis} label="P"/>
          {scene.transformed ? <MatrixText matrix={scene.transformed} label="B=P⁻¹AP"/> : null}
          <span>迹：{fmt(scene.invariants.trace)} · 行列式：{fmt(scene.invariants.det)}</span>
          {scene.angle !== null ? <span>基旋转角：{fmt(scene.angle)}°</span> : null}
          <strong data-tone={scene.invertible ? 'pass' : 'warn'}>
            {scene.invertible
              ? '同一个线性变换在不同坐标下表示不同，但迹与行列式保持不变。'
              : 'P 不可逆；不显示逆矩阵或伪造结果。'}
          </strong>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.scene}>
      <div className={styles.sceneText}>
        <MatrixText matrix={scene.matrix} label="A"/>
        <span>det(A) = {fmt(scene.det, 8)}</span>
        <strong data-tone={scene.invertible ? 'pass' : 'warn'}>
          {scene.invertible ? '矩阵可逆：已知 y 时存在唯一输入 v。' : '矩阵奇异：可能无解或有无穷多解。'}
        </strong>
        {scene.vector ? <span>当前 v = ({fmt(scene.vector[0] ?? 0)}, {fmt(scene.vector[1] ?? 0)})，Av = ({
          scene.product ? `${fmt(scene.product[0] ?? 0)}, ${fmt(scene.product[1] ?? 0)}` : '—'
        })</span> : null}
        <small>在「问一个问题」中给出目标向量 y，或在完整参数中核对当前输入。</small>
      </div>
    </div>
  );
}

export default MatrixLearningScene;

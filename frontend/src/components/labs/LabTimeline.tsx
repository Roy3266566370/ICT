import { useId, type ReactNode } from 'react';
import type { LabResult, LabSubject } from '@/labs/types';
import { currentFrame } from '@/labs/compute';
import styles from './labs.module.css';

interface Props {
  result: LabResult;
  step: number;
  playing: boolean;
  speed: number;
  reducedMotion: boolean;
  onStep: (step: number) => void;
  onTogglePlay: () => void;
  onSpeed: (speed: number) => void;
  onReset: () => void;
  /** 在时间轴下方显示当前步骤说明。 */
  detail?: string;
}

const SPEEDS = [0.5, 1, 2, 4];

export function LabTimeline({
  result,
  step,
  playing,
  speed,
  reducedMotion,
  onStep,
  onTogglePlay,
  onSpeed,
  onReset,
  detail,
}: Props): ReactNode {
  const id = useId();
  const total = Math.max(1, result.trace.length - 1);
  const current = Math.max(0, Math.min(step, total));
  const frame = currentFrame(result, current);
  const percent = (current / total) * 100;
  return (
    <section className={styles.timeline} aria-label="执行轨迹控制">
      <div className={styles.timelineTop}>
        <div className={styles.timelineButtons}>
          <button type="button" className={styles.ghostButton} onClick={onReset} aria-label="回到轨迹开头">
            ↺
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => onStep(Math.max(0, current - 1))} disabled={current <= 0} aria-label="上一步">
            ‹
          </button>
          <button
            type="button"
            className={styles.playButton}
            onClick={onTogglePlay}
            aria-pressed={playing}
            aria-label={playing ? '暂停' : '播放执行轨迹'}
          >
            <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
            {playing ? '暂停' : '播放'}
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => onStep(Math.min(total, current + 1))} disabled={current >= total} aria-label="下一步">
            ›
          </button>
        </div>
        <div className={styles.timelineLabel}>
          <span>{traceTitle(result.subject)}</span>
          <strong>
            第 {current} / {total} 步
          </strong>
          <small>{frame.label}</small>
        </div>
        <label className={styles.speedControl}>
          <span>速度</span>
          <select value={speed} onChange={(event) => onSpeed(Number(event.target.value))} aria-label="播放速度">
            {SPEEDS.map((item) => (
              <option key={item} value={item}>
                {item}×
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.timelineTrack}>
        <div className={styles.timelineTrackFill} style={{ width: `${percent}%` }} />
        {result.trace.map((item, index) => (
          <button
            key={`${item.label}-${index}`}
            type="button"
            className={styles.tick}
            style={{ left: `${(index / total) * 100}%` }}
            aria-label={`跳到 ${item.label}`}
            aria-current={index === current ? 'step' : undefined}
            onClick={() => onStep(index)}
          />
        ))}
        <input
          id={id}
          type="range"
          min={0}
          max={total}
          step={1}
          value={current}
          aria-label="执行轨迹时间轴"
          onChange={(event) => onStep(Number(event.target.value))}
        />
      </div>
      <div className={styles.timelineMeta}>
        <span>{detail ?? frame.detail ?? '时间轴只回放真实执行记录。'}</span>
        {reducedMotion ? <span>已按系统设置减少动效</span> : <span>空格播放 · ←/→ 单步</span>}
      </div>
    </section>
  );
}

function traceTitle(subject: LabSubject): string {
  if (subject === 'optimization') return '迭代轨迹';
  if (subject === 'algorithm') return '执行轨迹';
  if (subject === 'deep_learning') return '训练轨迹';
  return '计算轨迹';
}

export default LabTimeline;

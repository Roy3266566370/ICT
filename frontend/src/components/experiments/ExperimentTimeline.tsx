import styles from './ExperimentStage.module.css';

interface Props {
  stages: Array<{ id: string; label: string }>;
  progress: number;
  playing: boolean;
  onProgress: (value: number) => void;
  onToggle: () => void;
  onStep: (direction: -1 | 1) => void;
  reducedMotion?: boolean;
}

export function ExperimentTimeline({ stages, progress, playing, onProgress, onToggle, onStep }: Props) {
  const activeIndex = progress < 1 / 3 ? 0 : progress < 2 / 3 ? 1 : 2;
  return <div className={styles.timeline} data-no-pan aria-label="实验过程">
    <div className={styles.timelineButtons}>
      <button type="button" onClick={() => onStep(-1)} disabled={progress <= 0} aria-label="上一步">‹ 上一步</button>
      <button type="button" className={styles.playButton} onClick={onToggle} aria-pressed={playing}>{playing ? '暂停' : '播放过程'}</button>
      <button type="button" onClick={() => onStep(1)} disabled={progress >= 1} aria-label="下一步">下一步 ›</button>
    </div>
    <label className={styles.timelineSlider}><span>时间轴</span>
      <input type="range" min={0} max={100} step={1} value={Math.round(progress * 100)}
        aria-label="实验时间轴" onChange={event => onProgress(Number(event.target.value) / 100)}/>
    </label>
    <div className={styles.stageChips} role="group" aria-label="阶段">
      {stages.map((stage, index) => <button key={stage.id} type="button" aria-pressed={activeIndex === index}
        onClick={() => onProgress(index === 0 ? 0 : index === 1 ? 0.5 : 1)}>
        <i>{index + 1}</i>{stage.label}
      </button>)}
    </div>
  </div>;
}

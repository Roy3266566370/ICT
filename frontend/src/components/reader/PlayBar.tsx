import styles from './PlayBar.module.css';

/** 与 `components/reader/useRegionRuntime` 对齐的步骤语义：0 原像 / 1 变换中 / 2 完成。 */
export type PlayStage = 0 | 1 | 2;

const STAGE_LABELS: Record<PlayStage, string> = {
  0: '原像',
  1: '变换中',
  2: '完成',
};

export interface PlayBarProps {
  stage: PlayStage;
  playing: boolean;
  /** 参数是否偏离原始值（决定"重置参数"是否可用）。 */
  changed: boolean;
  /** 减少动画偏好（进度语义不依赖补间，仅保留以对齐宿主调用）。 */
  reducedMotion?: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStep: () => void;
  onReset: () => void;
  onRestore: () => void;
  /** 由宿主控制是否可操作（默认 true）。 */
  active?: boolean;
}

/**
 * 底部播放条（rebuild-spec §6/§9）：播放 / 暂停 / 单步 / 进度 0-2 / 重置 / 恢复原稿。
 *
 * 播放只表达模板声明的步骤语义（原像 → 变换中 → 完成），不做任意系数插值，
 * 避免把插值伪装成"原文描述的运算过程"（spec §9）。
 */
export function PlayBar({
  stage,
  playing,
  changed,
  onPlay,
  onPause,
  onStep,
  onReset,
  onRestore,
  active = true,
}: PlayBarProps) {
  return (
    <div className={styles.bar} role="group" aria-label="过程播放">
      <button
        type="button"
        className={styles.primary}
        onClick={onPlay}
        disabled={!active || playing}
        aria-label="从原像开始播放"
      >
        {playing ? '播放中…' : '播放'}
      </button>
      <button type="button" className={styles.button} onClick={onPause} disabled={!active || !playing}>
        暂停
      </button>
      <button type="button" className={styles.button} onClick={onStep} disabled={!active}>
        单步
      </button>

      <span className={styles.separator} aria-hidden="true" />

      <span className={styles.progress} aria-live="polite">
        步骤 {stage}/2 · {STAGE_LABELS[stage]}
      </span>

      <span className={styles.separator} aria-hidden="true" />

      <button
        type="button"
        className={styles.button}
        data-changed={changed ? 'true' : 'false'}
        onClick={onReset}
        disabled={!active || (!changed && stage === 2)}
      >
        重置参数
      </button>
      <button type="button" className={styles.button} onClick={onRestore} disabled={!active}>
        恢复原稿
      </button>
    </div>
  );
}

export default PlayBar;
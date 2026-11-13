import { clampZoom } from './zoom';
import styles from './ZoomControl.module.css';

export type ZoomValue = number | 'fit';

interface Props {
  value: ZoomValue;
  fitValue: number;
  onChange: (value: ZoomValue) => void;
  min?: number;
  max?: number;
  step?: number;
  tone?: 'light' | 'dark';
  label?: string;
  className?: string;
}

export function ZoomControl({
  value,
  fitValue,
  onChange,
  min = 0.25,
  max = 4,
  step = 0.1,
  tone = 'light',
  label = '画布缩放',
  className = '',
}: Props) {
  const effective = value === 'fit' ? fitValue : value;
  const percent = Math.round(effective * 100);
  const minPercent = Math.round(min * 100);
  const maxPercent = Math.round(max * 100);

  return <div className={`${styles.root} ${className}`} data-tone={tone} role="group" aria-label={label}>
    <button type="button" aria-label="缩小画布" title="缩小；也可按住 Ctrl/⌘ 滚动滚轮"
      disabled={effective <= min + 0.0001} onClick={() => onChange(clampZoom(effective - step, min, max))}>−</button>
    <input type="range" aria-label="自由缩放百分比" title="拖动调整缩放；也可按住 Ctrl/⌘ 滚动滚轮"
      min={minPercent} max={maxPercent} step={1} value={Math.min(maxPercent, Math.max(minPercent, percent))}
      onChange={event => onChange(clampZoom(Number(event.target.value) / 100, min, max))}/>
    <output className={styles.value} aria-live="polite">{percent}%</output>
    <button type="button" aria-label="放大画布" title="放大；也可按住 Ctrl/⌘ 滚动滚轮"
      disabled={effective >= max - 0.0001} onClick={() => onChange(clampZoom(effective + step, min, max))}>＋</button>
    <button type="button" className={styles.fit} aria-pressed={value === 'fit'} title={`适应窗口（约 ${Math.round(fitValue * 100)}%）`}
      onClick={() => onChange('fit')}>适应</button>
  </div>;
}

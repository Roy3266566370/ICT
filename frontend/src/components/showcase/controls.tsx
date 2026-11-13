import { useId, type ReactNode } from 'react';
import styles from './controls.module.css';

interface LabSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  hint?: string;
  disabled?: boolean;
}

export function LabSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => String(v),
  hint,
  disabled = false,
}: LabSliderProps): JSX.Element {
  const id = useId();
  return (
    <div className={styles.slider}>
      <div className={styles.sliderHead}>
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format(value)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint ? <p className={styles.sliderHint}>{hint}</p> : null}
    </div>
  );
}

interface Option<T extends string> {
  value: T;
  label: string;
  detail?: string;
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>): JSX.Element {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.segment}
          aria-pressed={value === option.value}
          title={option.detail}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface StatProps {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: 'default' | 'accent' | 'good' | 'bad';
  compact?: boolean;
}

export function Stat({ label, value, note, tone = 'default', compact = false }: StatProps): JSX.Element {
  return (
    <div className={styles.stat} data-tone={tone} data-compact={compact || undefined}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
      {note ? <span className={styles.statNote}>{note}</span> : null}
    </div>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}

export function LabToggle({ label, checked, onChange, hint }: ToggleProps): JSX.Element {
  const id = useId();
  return (
    <div className={styles.toggle}>
      <label htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      {hint ? <p>{hint}</p> : null}
    </div>
  );
}

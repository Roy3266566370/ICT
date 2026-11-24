import { useEffect, useState, type ReactNode } from 'react';
import styles from './blocks.module.css';

export const BLOCK_COLORS = ['#4f46e5', '#b15236', '#0d9488', '#0284c7', '#a16207', '#7c3aed'] as const;

function safe(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export interface ChartSeries {
  name: string;
  values: number[];
  color?: string;
  dashed?: boolean;
  fill?: boolean;
}

export function Notice({ children }: { children: ReactNode }): JSX.Element {
  return <p className={styles.notice} role="status">{children}</p>;
}

export function Legend({ series }: { series: ChartSeries[] }): JSX.Element {
  return <div className={styles.legend}>{series.map((line, index) => (
    <span key={line.name}><i style={{ background: line.color ?? BLOCK_COLORS[index % BLOCK_COLORS.length] }} />{line.name}</span>
  ))}</div>;
}

export function LineChart({
  labels,
  series,
  ariaLabel,
  compact = false,
  includeZero = true,
  title,
}: {
  labels: string[];
  series: ChartSeries[];
  ariaLabel: string;
  compact?: boolean;
  includeZero?: boolean;
  title?: string;
}): JSX.Element {
  const values = series.flatMap((line) => line.values).filter(Number.isFinite);
  if (!values.length) return <Notice>当前序列没有有限数值。</Notice>;
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (includeZero) { low = Math.min(0, low); high = Math.max(0, high); }
  if (!(high > low)) { high = low + 1; low -= 1; }
  const pad = (high - low) * 0.1;
  low -= pad;
  high += pad;
  const count = Math.max(2, ...series.map((line) => line.values.length), labels.length);
  const left = 30;
  const width = 280;
  const top = 12;
  const height = compact ? 76 : 104;
  const bottom = top + height;
  const baseY = bottom;
  const px = (index: number): number => left + (index / (count - 1)) * width;
  const py = (value: number): number => bottom - ((safe(value) - low) / (high - low || 1)) * height;
  const ticks = Array.from({ length: 4 }, (_, index) => low + (high - low) * index / 3);
  const labelEvery = Math.max(1, Math.ceil(count / (compact ? 3 : 6)));
  return <>
    <svg className={styles.chart} viewBox={`0 0 320 ${bottom + 20}`} role="img" aria-label={ariaLabel}>
      {title ? <text x={left} y={9}>{title}</text> : null}
      {ticks.map((tick, index) => <g key={index}>
        <line x1={left} x2={left + width} y1={py(tick)} y2={py(tick)} stroke="#e8e2d5" strokeWidth="0.8" />
        <text x={left - 4} y={py(tick) + 2.5} textAnchor="end">{formatTick(tick)}</text>
      </g>)}
      {low < 0 && high > 0 ? <line x1={left} x2={left + width} y1={py(0)} y2={py(0)} stroke="#aaa496" strokeWidth="0.9" /> : null}
      {series.map((line, seriesIndex) => {
        const color = line.color ?? BLOCK_COLORS[seriesIndex % BLOCK_COLORS.length];
        let drawing = false;
        const path = line.values.map((value, index) => {
          if (!Number.isFinite(value)) { drawing = false; return ''; }
          const command = drawing ? 'L' : 'M';
          drawing = true;
          return `${command}${px(index).toFixed(1)},${py(value).toFixed(1)}`;
        }).join(' ');
        return <g key={line.name}>
          {line.fill ? <path d={`${path} L${px(line.values.length - 1)},${baseY} L${left},${baseY} Z`} fill={color} opacity="0.08" /> : null}
          <path d={path} fill="none" stroke={color} strokeWidth={compact ? 1.6 : 1.9} strokeDasharray={line.dashed ? '5 3' : undefined} strokeLinejoin="round" strokeLinecap="round" />
        </g>;
      })}
      {labels.filter((_, index) => index % labelEvery === 0).map((label, index) => {
        const sourceIndex = index * labelEvery;
        return <text key={`${label}-${sourceIndex}`} x={px(sourceIndex)} y={bottom + 13} textAnchor="middle">{String(label).slice(0, 8)}</text>;
      })}
    </svg>
    {!compact && series.length > 1 ? <Legend series={series} /> : null}
  </>;
}

function formatTick(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e6 || (abs > 0 && abs < 1e-3)) return value.toExponential(1);
  return abs >= 100 ? value.toFixed(0) : Number(value.toPrecision(3)).toString();
}

export function BarChart({
  labels,
  values,
  ariaLabel,
  color = '#4f46e5',
  compact = false,
}: {
  labels: string[];
  values: number[];
  ariaLabel: string;
  color?: string;
  compact?: boolean;
}): JSX.Element {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return <Notice>当前序列没有有限数值。</Notice>;
  const high = Math.max(0, ...finiteValues);
  const low = Math.min(0, ...finiteValues);
  const span = high - low || 1;
  const left = 26;
  const width = 286;
  const top = 10;
  const height = compact ? 64 : 86;
  const count = Math.max(1, values.length);
  const slot = width / count;
  const py = (value: number) => top + height - ((value - low) / span) * height;
  const base = py(0);
  return <svg className={styles.chart} viewBox={`0 0 320 ${top + height + 22}`} role="img" aria-label={ariaLabel}>
    <line x1={left} x2={left + width} y1={base} y2={base} stroke="#aaa496" strokeWidth="0.9" />
    {values.map((value, index) => {
      const x = left + index * slot + slot * 0.18;
      const barWidth = Math.max(1, slot * 0.64);
      const y = py(safe(value));
      return <rect key={index} x={x} y={Math.min(y, base)} width={barWidth} height={Math.max(0.6, Math.abs(base - y))}
        rx="2" fill={value < 0 ? '#b15236' : color} opacity={0.82} />;
    })}
    {labels.filter((_, index) => index % Math.max(1, Math.ceil(count / (compact ? 4 : 7))) === 0).map((label, index) => {
      const source = index * Math.max(1, Math.ceil(count / (compact ? 4 : 7)));
      return <text key={`${label}-${source}`} x={left + source * slot + slot / 2} y={top + height + 15} textAnchor="middle">{String(label).slice(0, 8)}</text>;
    })}
  </svg>;
}

export function KpiRow({ items }: { items: { label: string; value: string; tone?: 'good' | 'warn' }[] }): JSX.Element {
  return <div className={styles.kpis}>{items.slice(0, 3).map((item) => (
    <div key={item.label} className={styles.kpi} data-tone={item.tone}>
      <span>{item.label}</span><b title={item.value}>{item.value}</b>
    </div>
  ))}</div>;
}

export function RangeControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange?: (value: number) => void;
  format?: (value: number) => string;
  disabled?: boolean;
}): JSX.Element {
  return <label className={styles.controlRow}>
    <span>{label}</span>
    <input type="range" aria-label={label} min={min} max={max} step={step} value={Number.isFinite(value) ? value : min}
      disabled={disabled || !onChange} onChange={(event) => onChange?.(event.currentTarget.valueAsNumber)} />
    <output>{format ? format(value) : formatTick(value)}</output>
  </label>;
}

export function SelectControl({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  options: readonly string[];
  onChange?: (value: number) => void;
  disabled?: boolean;
}): JSX.Element {
  return <label className={styles.controlRow}>
    <span>{label}</span>
    <select aria-label={label} value={Math.round(value)} disabled={disabled || !onChange}
      onChange={(event) => onChange?.(Number(event.currentTarget.value))}>
      {options.map((option, index) => <option key={option} value={index}>{option}</option>)}
    </select>
    <output>{options[Math.round(value)] ?? '—'}</output>
  </label>;
}

export function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  wide = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange?: (value: number) => void;
  wide?: boolean;
}): JSX.Element {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label className={`${styles.field}${wide ? ' ' + styles.wide : ''}`}>
    <span>{label}</span>
    <input type="number" aria-label={label} value={draft} min={min} max={max} step={step}
      onChange={(event) => {
        setDraft(event.currentTarget.value);
        const next = event.currentTarget.valueAsNumber;
        if (Number.isFinite(next) && next >= min && next <= max) onChange?.(next);
      }}
      onBlur={(event) => {
        const next = Number.isFinite(event.currentTarget.valueAsNumber)
          ? Math.max(min, Math.min(max, event.currentTarget.valueAsNumber)) : value;
        setDraft(String(next));
        if (next !== value) onChange?.(next);
      }} />
  </label>;
}

export function TextAreaField({
  label,
  value,
  onChange,
  rows = 5,
  placeholder,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  rows?: number;
  placeholder?: string;
}): JSX.Element {
  return <label className={`${styles.field} ${styles.wide}`}>
    <span>{label}</span>
    <textarea className={styles.textarea} aria-label={label} rows={rows} value={value} placeholder={placeholder}
      spellCheck={false} readOnly={!onChange} onChange={(event) => onChange?.(event.currentTarget.value)} />
  </label>;
}

export function MatrixBox({ name, data }: { name: string; data: number[][] }): JSX.Element {
  const rows = data.length;
  const cols = data[0]?.length ?? 1;
  const maxAbs = Math.max(1e-6, ...data.flat().map(Math.abs));
  const cell = 20;
  return <div className={styles.matrixBox}>
    <svg width={cols * cell + 2} height={rows * cell + 2} viewBox={`0 0 ${cols * cell + 2} ${rows * cell + 2}`} role="img" aria-label={name + ' 矩阵'}>
      {data.flatMap((row, r) => row.map((value, c) => (
        <rect key={`${r}-${c}`} x={c * cell + 1} y={r * cell + 1} width={cell - 2} height={cell - 2} rx="2"
          fill={value >= 0 ? `rgba(79,70,229,${0.08 + Math.abs(value) / maxAbs * 0.55})` : `rgba(177,82,54,${0.08 + Math.abs(value) / maxAbs * 0.55})`} />
      )))}
      {data.flatMap((row, r) => row.map((value, c) => (
        <text key={`t-${r}-${c}`} x={c * cell + cell / 2 + 1} y={r * cell + cell / 2 + 4} textAnchor="middle">{formatTick(value)}</text>
      )))}
    </svg>
    <span>{name}</span>
  </div>;
}

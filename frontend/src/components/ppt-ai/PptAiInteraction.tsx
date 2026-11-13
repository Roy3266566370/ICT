import { useEffect, useMemo, useState } from 'react';
import type { CompiledNode, PlanParameter } from '@/ppt-ai/types';
import {
  evaluateNode,
  formatValue,
  parameterValue,
  type CanonicalValue,
  type CanonicalValues,
  type PptAiEvaluation,
} from '@/ppt-ai/runtime/evaluate';
import styles from './PptAiInteraction.module.css';

interface Props {
  node: CompiledNode;
  values: CanonicalValues;
  derivedValues?: CanonicalValues;
  overrides?: CanonicalValues;
  onChange?: (conceptId: string, value: CanonicalValue) => void;
  readOnly?: boolean;
  compact?: boolean;
}

function Graph({ evaluation }: { evaluation: PptAiEvaluation }) {
  const geometry = useMemo(() => {
    const points = evaluation.series.filter((point) => point.y !== null) as { x: number; y: number }[];
    const overlay = evaluation.overlaySeries.filter((point) => point.y !== null) as { x: number; y: number }[];
    const markers = evaluation.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (!points.length && !overlay.length && !markers.length) return null;
    const allY = [...points, ...overlay, ...markers].map((point) => point.y);
    const allX = [...points, ...overlay, ...markers].map((point) => point.x);
    const domain = evaluation.domain ?? {
      x_min: Math.min(...allX),
      x_max: Math.max(...allX),
    };
    let yMin = Math.min(0, ...allY);
    let yMax = Math.max(...allY);
    if (yMax - yMin < 1e-9) { yMax += 1; yMin -= 1; }
    const pad = (yMax - yMin) * 0.1;
    yMin -= pad; yMax += pad;
    const W = 720; const H = 360; const P = 44;
    const mapX = (x: number) => P + (x - domain.x_min) / Math.max(1e-9, domain.x_max - domain.x_min) * (W - 2 * P);
    const mapY = (y: number) => H - P - (y - yMin) / Math.max(1e-9, yMax - yMin) * (H - 2 * P);
    const pathOf = (items: { x: number; y: number }[]) => items
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${mapX(point.x).toFixed(2)},${mapY(point.y).toFixed(2)}`)
      .join(' ');
    return {
      W, H, P, domain, yMin, yMax, mapX, mapY,
      path: pathOf(points),
      overlayPath: pathOf(overlay),
      markers,
    };
  }, [evaluation]);
  if (!geometry) return <p className={styles.emptyGraph}>当前参数下没有可绘制的有限点。</p>;
  return (
    <svg className={styles.graph} viewBox={`0 0 ${geometry.W} ${geometry.H}`} role="img" aria-label="函数曲线与实验区域">
      <rect x="0" y="0" width={geometry.W} height={geometry.H} fill="#f8fafc" rx="12" />
      {[0, 1, 2, 3, 4].map((index) => {
        const y = geometry.P + (geometry.H - geometry.P * 2) * index / 4;
        return <line key={`h${index}`} x1={geometry.P} x2={geometry.W - geometry.P} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />;
      })}
      {evaluation.rects.map((rect, index) => {
        const left = geometry.mapX(rect.x0);
        const right = geometry.mapX(rect.x1);
        const top = geometry.mapY(Math.max(0, rect.height));
        const base = geometry.mapY(0);
        return <rect key={index} x={left} y={Math.min(top, base)} width={Math.max(0.5, right - left)}
          height={Math.max(0.5, Math.abs(base - top))} fill="#dbeafe" stroke="#93c5fd" strokeWidth="0.6" opacity="0.72" />;
      })}
      {evaluation.tangent && (
        <line x1={geometry.mapX(geometry.domain.x_min)} y1={geometry.mapY(evaluation.tangent.m * geometry.domain.x_min + evaluation.tangent.b)}
          x2={geometry.mapX(geometry.domain.x_max)} y2={geometry.mapY(evaluation.tangent.m * geometry.domain.x_max + evaluation.tangent.b)}
          stroke="#f97316" strokeWidth="2" strokeDasharray="7 5" />
      )}
      {geometry.overlayPath ? (
        <path d={geometry.overlayPath} fill="none" stroke="#f97316" strokeWidth="2" strokeDasharray="7 5" strokeLinecap="round" />
      ) : null}
      {geometry.path ? <path d={geometry.path} fill="none" stroke="#1d4ed8" strokeWidth="2.4" strokeLinecap="round" /> : null}
      {geometry.markers.map((point, index) => (
        <circle key={`point-${index}`} cx={geometry.mapX(point.x)} cy={geometry.mapY(point.y)} r="3.5"
          fill="#fff7ed" stroke="#ea580c" strokeWidth="1.6">
          {point.label ? <title>{point.label}</title> : null}
        </circle>
      ))}
      <text x={geometry.P} y={26} fill="#0f172a" fontSize="15" fontWeight="700">{evaluation.text || '函数曲线'}</text>
      {evaluation.overlayLabel ? (
        <text x={geometry.W - geometry.P} y={26} fill="#c2410c" fontSize="11" textAnchor="end">{evaluation.overlayLabel}</text>
      ) : null}
      <text x={geometry.P} y={geometry.H - 12} fill="#64748b" fontSize="11">
        {geometry.domain.x_min.toFixed(3)} — {geometry.domain.x_max.toFixed(3)}
      </text>
    </svg>
  );
}

function Chart({ evaluation }: { evaluation: PptAiEvaluation }) {
  const chart = evaluation.chart;
  if (!chart || !chart.categories.length) return null;
  const values = chart.series.flatMap((series) => series.values).filter((value) => Number.isFinite(value));
  const max = Math.max(1, ...values);
  return (
    <div className={styles.chart} role="img" aria-label="原生图表">
      {chart.categories.map((category, index) => (
        <div key={category} className={styles.chartColumn}>
          <div className={styles.chartBars}>
            {chart.series.map((series, seriesIndex) => (
              <span key={series.name || seriesIndex} title={`${series.name}: ${series.values[index] ?? '—'}`}
                data-series={seriesIndex}
                style={{ height: `${Math.max(2, Math.round((series.values[index] ?? 0) / max * 100))}%` }} />
            ))}
          </div>
          <b>{category}</b>
        </div>
      ))}
    </div>
  );
}

function Table({ evaluation }: { evaluation: PptAiEvaluation }) {
  if (!evaluation.table) return null;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr>{evaluation.table.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>
          {evaluation.table.rows.slice(0, 120).map((row, index) => (
            <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{formatValue(cell)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseNumberList(raw: string): number[] | null {
  const parts = raw.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
  if (!parts.length) return null;
  const values = parts.map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  return values;
}

function parseNumberMatrix(raw: string): number[][] | null {
  const rows = raw.split(/[;；\n]+/).map((row) => row.trim()).filter(Boolean);
  if (!rows.length) return null;
  const matrix: number[][] = [];
  for (const row of rows) {
    const values = row.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean).map(Number);
    if (!values.length || values.some((value) => !Number.isFinite(value))) return null;
    matrix.push(values);
  }
  if (matrix.some((row) => row.length !== matrix[0]!.length)) return null;
  return matrix;
}

function ArrayControl({ parameter, value, onChange, disabled }: {
  parameter: PlanParameter;
  value: number[] | number[][];
  onChange?: (value: number[] | number[][]) => void;
  disabled: boolean;
}) {
  const isMatrix = parameter.type === 'number_matrix' || parameter.type === 'matrix2';
  const display = isMatrix
    ? (value as number[][]).map((row) => row.join(', ')).join('; ')
    : (value as number[]).join(', ');
  const [text, setText] = useState(display);
  const [invalid, setInvalid] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(display);
  }, [display, editing]);
  const commit = (raw: string): void => {
    const parsed = isMatrix ? parseNumberMatrix(raw) : parseNumberList(raw);
    if (parsed === null) {
      setInvalid(isMatrix ? '请输入分号分行、逗号分列的数字矩阵' : '请输入逗号分隔的有限数值');
      return;
    }
    setInvalid('');
    onChange?.(parsed);
  };
  return (
    <label className={styles.control} data-invalid={invalid ? 'true' : 'false'}>
      <span>{parameter.label}<em>{isMatrix ? '矩阵' : '数组'}{parameter.shape.length ? ` ${parameter.shape.join('×')}` : ''}</em></span>
      <textarea
        className={styles.arrayInput}
        rows={isMatrix ? 3 : 2}
        value={editing ? text : display}
        disabled={disabled}
        spellCheck={false}
        aria-label={`${parameter.label}${isMatrix ? '矩阵' : '数组'}`}
        aria-invalid={invalid ? true : undefined}
        onFocus={() => setEditing(true)}
        onChange={(event) => {
          setText(event.target.value);
          if (invalid) setInvalid('');
        }}
        onBlur={() => {
          setEditing(false);
          commit(text);
        }}
      />
      {invalid ? <span className={styles.fieldError} role="alert">{invalid}</span> : null}
    </label>
  );
}

function ParamControl({ parameter, value, onChange }: {
  parameter: PlanParameter;
  value: CanonicalValue;
  onChange?: (value: CanonicalValue) => void;
}) {
  const disabled = !onChange;
  if (parameter.type === 'boolean') {
    return (
      <label className={styles.control}>
        <span>{parameter.label}</span>
        <input type="checkbox" checked={Boolean(value)} disabled={disabled}
          onChange={(event) => onChange?.(event.target.checked)} />
      </label>
    );
  }
  if (parameter.type === 'enum') {
    return (
      <label className={styles.control}>
        <span>{parameter.label}</span>
        <select value={String(value)} disabled={disabled} onChange={(event) => onChange?.(event.target.value)}>
          {parameter.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    );
  }
  if (parameter.type === 'string') {
    return (
      <label className={styles.control}>
        <span>{parameter.label}</span>
        <input type="text" value={String(value)} disabled={disabled || parameter.id === 'expression'}
          onChange={(event) => onChange?.(event.target.value)} />
      </label>
    );
  }
  if (parameter.type === 'number_list' || parameter.type === 'number_matrix' || parameter.type === 'matrix2' || parameter.type === 'vector2') {
    const arrayValue = Array.isArray(value) ? value : (parameter.default as number[] | number[][]);
    return <ArrayControl parameter={parameter} value={arrayValue as number[] | number[][]}
      onChange={onChange as ((next: number[] | number[][]) => void) | undefined} disabled={disabled} />;
  }
  const min = parameter.min;
  const max = parameter.max;
  const numeric = typeof value === 'number' ? value : 0;
  const [text, setText] = useState(String(numeric));
  const [invalid, setInvalid] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(String(numeric));
  }, [numeric, editing]);

  const unitText = parameter.unit || '';
  const bounded = min !== null && max !== null && max > min;
  if (bounded) {
    const low = Math.min(min, numeric);
    const high = Math.max(max, numeric);
    const baseStep =
      parameter.type === 'integer'
        ? 1
        : parameter.step && parameter.step > 0
          ? parameter.step
          : 0.1;
    const aligned = (value: number) => Math.abs((value - low) / baseStep - Math.round((value - low) / baseStep)) < 1e-6;
    const oneDecimal = Math.abs(numeric * 10 - Math.round(numeric * 10)) < 1e-9;
    const step = parameter.type === 'integer'
      ? 1
      : aligned(numeric)
        ? baseStep
        : oneDecimal
          ? 0.1
          : 0.001;
    const commit = (raw: string): void => {
      const parsed = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(parsed)) {
        setInvalid('请输入有限数值');
        return;
      }
      if (parsed < min || parsed > max) {
        setInvalid(`需在 ${min} — ${max} 之间`);
        return;
      }
      setInvalid('');
      onChange?.(parameter.type === 'integer' ? Math.round(parsed) : parsed);
    };
    return (
      <div className={styles.control} data-invalid={invalid ? 'true' : 'false'}>
        <label>
          <span>{parameter.label}<em>{formatValue(numeric)}{unitText}</em></span>
          <input
            type="range"
            min={low}
            max={high}
            step={step}
            value={numeric}
            disabled={disabled}
            aria-label={`${parameter.label}滑块`}
            onChange={(event) => {
              const next = Number(event.target.value);
              setText(String(next));
              onChange?.(parameter.type === 'integer' ? Math.round(next) : next);
            }}
          />
        </label>
        <span className={styles.precise}>
          <input
            type="number"
            value={editing ? text : String(numeric)}
            min={min}
            max={max}
            step={parameter.type === 'integer' ? 1 : step}
            disabled={disabled}
            aria-label={`${parameter.label}精确数值`}
            aria-invalid={invalid ? true : undefined}
            onFocus={() => setEditing(true)}
            onChange={(event) => {
              setText(event.target.value);
              if (invalid) setInvalid('');
            }}
            onBlur={() => {
              setEditing(false);
              commit(text);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
          />
          {unitText ? <small>{unitText}</small> : null}
        </span>
        {invalid ? <span className={styles.fieldError} role="alert">{invalid}</span> : null}
        {low !== min || high !== max ? (
          <span className={styles.rangeNote}>显示范围已包含源值；允许范围 {min} — {max}</span>
        ) : null}
      </div>
    );
  }
  return (
    <label className={styles.control}>
      <span>{parameter.label}</span>
      <input type="number" value={numeric} disabled={disabled} step={parameter.step ?? 'any'}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (event.target.value !== '' && Number.isFinite(parsed)) onChange?.(parsed);
        }} />
    </label>
  );
}

export function PptAiInteraction({ node, values, derivedValues, overrides, onChange, readOnly, compact }: Props) {
  const evaluation = useMemo(
    () => evaluateNode(node, values, derivedValues ?? {}, overrides ?? {}),
    [node, values, derivedValues, overrides],
  );
  const hasGraph = evaluation.series.some((point) => point.y !== null)
    || evaluation.overlaySeries.some((point) => point.y !== null)
    || evaluation.rects.length > 0
    || evaluation.points.length > 0;
  const template = (() => {
    const raw = node.provider.template_ref;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const ref = raw as Record<string, unknown>;
    return typeof ref.id === 'string' ? `${ref.id}@${String(ref.version ?? '')}` : null;
  })();
  return (
    <section className={styles.runtime} data-compact={compact ? 'true' : 'false'}>
      <header className={styles.head}>
        <div>
          <span className={styles.operator}>{template ?? node.operator_id}</span>
          <h3>{node.title}</h3>
        </div>
        <span className={styles.offline}>{node.offline_supported ? '可离线' : '需联网'}</span>
      </header>
      {node.parameters.length > 0 && (
        <div className={styles.controls}>
          {node.parameters.map((parameter) => {
            const linked = parameter.binding?.mode === 'linked';
            const raw = overrides && parameter.concept_id in overrides
              ? overrides[parameter.concept_id]!
              : parameterValue(parameter, values, derivedValues ?? {}) as CanonicalValue;
            return <ParamControl key={parameter.concept_id} parameter={parameter}
              value={raw}
              onChange={readOnly || linked ? undefined : (value) => onChange?.(parameter.concept_id, value)} />;
          })}
        </div>
      )}
      {evaluation.error ? <p className={styles.error} role="alert">{evaluation.error}</p> : null}
      {evaluation.metrics.length > 0 && (
        <div className={styles.metrics}>
          {evaluation.metrics.slice(0, 8).map((metric) => (
            <div key={metric.id}><span>{metric.label}</span><b>{metric.value}</b></div>
          ))}
        </div>
      )}
      {hasGraph ? <Graph evaluation={evaluation} /> : null}
      {evaluation.chart ? <Chart evaluation={evaluation} /> : null}
      {evaluation.table ? <Table evaluation={evaluation} /> : null}
      {evaluation.text && !hasGraph && !evaluation.chart && !evaluation.table ? (
        <p className={styles.text}>{evaluation.text}</p>
      ) : null}
      {evaluation.checks.length > 0 && (
        <ul className={styles.checks}>
          {evaluation.checks.map((check) => (
            <li key={check.id} data-status={check.status}>
              <b>{check.label}</b><span>{check.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {!compact && evaluation.trace.length > 0 && (
        <details className={styles.trace}>
          <summary>执行轨迹（{evaluation.trace.length} 步）</summary>
          <ol>
            {evaluation.trace.slice(0, 40).map((frame, index) => (
              <li key={index}>{String(frame.label ?? frame.detail ?? `步骤 ${index + 1}`)}</li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

export default PptAiInteraction;

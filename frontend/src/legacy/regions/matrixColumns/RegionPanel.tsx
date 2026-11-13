/**
 * matrixColumns/RegionPanel.tsx —— S9 参数抽屉（默认收起）。
 *
 * 6 个可调参数：矩阵 4 个元素 + 输入向量两个组合系数。
 * 每个参数同时有 `<input type="range">` 与 `<input type="number">`，共用同一个提交出口；
 * 越界 / 非法输入不写入，只显示原因（spec §8、任务 R3-2）。
 *
 * 说明：宿主 `ParamDrawer` 也能改同一批数值；两者都通过 `region.onChange` 提交，
 * 因此参数仍然只有一份权威来源，不会分叉。
 */
import { useEffect, useId, useState, type ChangeEvent, type ReactElement } from 'react';
import type { Mat2, Vec2 } from './scene';
import { PARAM_MAX, PARAM_MIN, PARAM_STEP, fmt } from './scene';
import styles from './matrixColumns.module.css';

export type ColumnsParamKey = keyof Mat2;

interface FieldProps {
  label: string;
  value: number;
  error?: string;
  onChange: (raw: string) => void;
}

/** 单参数控件：数字框保留 `-`、`1.` 等编辑中间态，失焦回落到受控值。 */
function Field(props: FieldProps): ReactElement {
  const { label, value, error, onChange } = props;
  const inputId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    setDraft(null);
  }, [value]);

  const handleSlider = (event: ChangeEvent<HTMLInputElement>): void => {
    setDraft(null);
    onChange(event.target.value);
  };

  const handleNumber = (event: ChangeEvent<HTMLInputElement>): void => {
    const text = event.target.value;
    setDraft(text);
    onChange(text);
  };

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={inputId}>
        {label}
      </label>
      <input
        className={styles.range}
        type="range"
        min={PARAM_MIN}
        max={PARAM_MAX}
        step={PARAM_STEP}
        value={value}
        aria-label={`${label} 滑块`}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={handleSlider}
      />
      <input
        id={inputId}
        className={styles.number}
        type="number"
        inputMode="decimal"
        min={PARAM_MIN}
        max={PARAM_MAX}
        step={PARAM_STEP}
        value={draft ?? String(fmt(value))}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={handleNumber}
        onBlur={() => setDraft(null)}
      />
      {error === undefined ? null : (
        <p className={styles.error} id={errorId} role="alert">
          <span aria-hidden="true">⚠</span> {error}
        </p>
      )}
    </div>
  );
}

export interface ColumnsPanelProps {
  matrix: Mat2;
  vector: Vec2;
  rank: number;
  errors: Record<string, string>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onMatrixParam: (key: ColumnsParamKey, raw: string) => void;
  onVectorParam: (axis: 0 | 1, raw: string) => void;
}

export function RegionPanel(props: ColumnsPanelProps): ReactElement {
  const {
    matrix,
    vector,
    rank,
    errors,
    collapsed,
    onToggleCollapsed,
    onMatrixParam,
    onVectorParam,
  } = props;

  if (collapsed) {
    return (
      <button
        type="button"
        className={styles.panelToggle}
        onClick={onToggleCollapsed}
        aria-expanded={false}
      >
        参数
      </button>
    );
  }

  return (
    <section className={styles.panel} aria-label="区域参数">
      <header className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>矩阵 A（两列 = 基的像）</h3>
        <button type="button" className={styles.panelClose} onClick={onToggleCollapsed} aria-expanded>
          收起
        </button>
      </header>

      <Field label="a11" value={matrix.a11} error={errors['a11']} onChange={(raw) => onMatrixParam('a11', raw)} />
      <Field label="a12" value={matrix.a12} error={errors['a12']} onChange={(raw) => onMatrixParam('a12', raw)} />
      <Field label="a21" value={matrix.a21} error={errors['a21']} onChange={(raw) => onMatrixParam('a21', raw)} />
      <Field label="a22" value={matrix.a22} error={errors['a22']} onChange={(raw) => onMatrixParam('a22', raw)} />

      <p className={styles.stat}>输入向量系数（组合各列）</p>
      <Field label="v₁" value={vector[0]} error={errors['v1']} onChange={(raw) => onVectorParam(0, raw)} />
      <Field label="v₂" value={vector[1]} error={errors['v2']} onChange={(raw) => onVectorParam(1, raw)} />

      <p className={styles.stat}>
        rank = <code>{rank}</code>
      </p>
      <p className={styles.hint}>拖动 col₁ / col₂ 的箭头尖端，可直接反推矩阵的两列。</p>
    </section>
  );
}
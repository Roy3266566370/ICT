/**
 * matrixEigen/RegionPanel.tsx —— S6 参数面板（滑块 + 数字双输入）。
 *
 * 硬约束（rebuild-spec §8 + 任务要求）：
 *  - 每个参数**同时**有 `<input type="range">` 与 `<input type="number">`，共用同一个提交出口；
 *  - 越界 / 非法输入**不写入**参数，而是显示原因（不静默吞掉）；
 *  - 6 个可调参数：`a11/a12/a21/a22` + 当前选中向量的两个分量；其余向量通过拖动端点修改。
 */
import { useEffect, useId, useState, type ChangeEvent, type ReactElement } from 'react';
import type { Mat2, Vec2 } from './scene';
import { PARAM_MAX, PARAM_MIN, PARAM_STEP, fmt, fmtVec } from './scene';
import styles from './matrixEigen.module.css';

/** 参数键：矩阵四个元素与向量分量（由父组件拼装）。 */
export type MatrixParamKey = keyof Mat2;

export interface RegionPanelProps {
  matrix: Mat2;
  vectors: Vec2[];
  /** 当前用数字输入编辑的向量下标（0..2）。 */
  selected: number;
  onSelect: (index: number) => void;
  onMatrixParam: (key: MatrixParamKey, raw: string) => void;
  onVectorParam: (index: number, axis: 0 | 1, raw: string) => void;
  /** 每个控件的越界 / 非法原因（key = `a11` / `v0x` …）。 */
  errors: Record<string, string>;
  det: number;
  trace: number;
  eigenvalues: [number, number] | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

interface FieldProps {
  label: string;
  value: number;
  error?: string;
  onChange: (raw: string) => void;
}

/**
 * 单个数值控件：滑块与数字输入共享 `onChange`。
 * 数字框保留编辑中间态（`-`、`1.`），失焦时回落到受控值。
 */
function Field(props: FieldProps): ReactElement {
  const { label, value, error, onChange } = props;
  const inputId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState<string | null>(null);

  // 外部（拖动端点 / 重置）改值时丢弃本地草稿，避免显示过期数字
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
    if (!/^-?\d*(\.\d*)?$/.test(text.trim())) {
      onChange(text);
      return;
    }
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

export function RegionPanel(props: RegionPanelProps): ReactElement {
  const {
    matrix,
    vectors,
    selected,
    onSelect,
    onMatrixParam,
    onVectorParam,
    errors,
    det,
    trace,
    eigenvalues,
    collapsed,
    onToggleCollapsed,
  } = props;

  if (collapsed) {
    return (
      <button type="button" className={styles.panelToggle} onClick={onToggleCollapsed} aria-expanded={false}>
        参数
      </button>
    );
  }

  const vector = vectors[selected] ?? [0, 0];

  return (
    <section className={styles.panel} aria-label="区域参数">
      <header className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>矩阵 A（作用于本页图示）</h3>
        <button type="button" className={styles.panelClose} onClick={onToggleCollapsed} aria-expanded>
          收起
        </button>
      </header>

      <Field label="a11" value={matrix.a11} error={errors['a11']} onChange={(raw) => onMatrixParam('a11', raw)} />
      <Field label="a12" value={matrix.a12} error={errors['a12']} onChange={(raw) => onMatrixParam('a12', raw)} />
      <Field label="a21" value={matrix.a21} error={errors['a21']} onChange={(raw) => onMatrixParam('a21', raw)} />
      <Field label="a22" value={matrix.a22} error={errors['a22']} onChange={(raw) => onMatrixParam('a22', raw)} />

      <div className={styles.vectorSection}>
        <span className={styles.sectionLabel}>输入向量</span>
        <div className={styles.vectorTabs} role="group" aria-label="选择要编辑的向量">
          {vectors.map((item, index) => (
            <button
              key={`tab-${index}`}
              type="button"
              className={index === selected ? styles.tabActive : styles.tab}
              aria-pressed={index === selected}
              onClick={() => onSelect(index)}
              title={fmtVec(item)}
            >
              v{index + 1}
            </button>
          ))}
        </div>
      </div>

      <Field
        label="x"
        value={vector[0]}
        error={errors[`v${selected}x`]}
        onChange={(raw) => onVectorParam(selected, 0, raw)}
      />
      <Field
        label="y"
        value={vector[1]}
        error={errors[`v${selected}y`]}
        onChange={(raw) => onVectorParam(selected, 1, raw)}
      />

      <p className={styles.stat}>
        det A = <code>{fmt(det)}</code>　tr A = <code>{fmt(trace)}</code>
        <br />
        {eigenvalues === null ? (
          <>特征值为复数（旋转型）</>
        ) : (
          <>特征值 <code>{fmt(eigenvalues[0])}</code> / <code>{fmt(eigenvalues[1])}</code></>
        )}
      </p>
      <p className={styles.hint}>其余向量可拖动端点修改，拖动同样走参数更新入口。</p>
    </section>
  );
}
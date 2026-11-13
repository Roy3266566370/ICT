/**
 * ParamControl.tsx —— 参数控件（C-UI@1，R6-AC4 / R6-AC5）
 *
 * 硬约束（验收第 3 条）：
 *  - **同时**渲染 `<input type="range">` 与 `<input type="number">`；
 *  - 两者共用**同一个** `onChange` 出口；
 *  - 展示 `name` / `unit` / `range` 文案；
 *  - `:focus-visible` 高亮；
 *  - 越界时显示原因（由上层传入 `error`），不静默吞掉。
 *
 * 数值语义：原值是 `number` 就回传 `number`；原值是十进制字符串（金额类 decimal）
 * 就回传保留十进制语义的字符串。非数值参数（matrix2 / vector2 / force_list / graph）
 * 由各自的专用控件编辑，这里只读展示摘要，避免出现"看起来能拖但改不了结构"的假控件。
 */
import { useId, useState, type ChangeEvent, type ReactElement } from 'react';
import type { ParamControlProps } from '@/api/types';
import { displayUnit, formatRange, fixed } from '@/domain/format';
import styles from './ParamControl.module.css';

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
const DEFAULT_STEP = 0.1;

function toNumeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && DECIMAL_PATTERN.test(value.trim())) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 非数值参数的可读摘要（不尝试编辑，避免伪造能力）。 */
function summarize(value: unknown): string {
  if (value === null || value === undefined) return '未设置';
  if (Array.isArray(value)) {
    const text = JSON.stringify(value);
    return text.length > 72 ? `${text.slice(0, 69)}…` : text;
  }
  if (typeof value === 'object') return '结构化取值（由专用控件编辑）';
  return String(value);
}

export function ParamControl(props: ParamControlProps): ReactElement {
  const { parameter, value, onChange, error, disabled } = props;
  const rangeInputId = useId();
  const numberInputId = useId();
  const errorId = useId();

  const numericValue = toNumeric(value);
  const [draft, setDraft] = useState<string | null>(null);

  // 值以字符串（decimal 金额）表达时，回传字符串以保持十进制语义
  const emitString = typeof value === 'string';
  const unit = displayUnit(parameter.unit);
  const rangeText = formatRange(parameter.range);
  const min = parameter.range.min;
  const max = parameter.range.max;
  const step = parameter.range.step ?? DEFAULT_STEP;
  const showSlider = min !== null && max !== null;

  const emit = (next: number): void => {
    if (!Number.isFinite(next)) return;
    onChange(emitString ? String(next) : next);
  };

  const handleSlider = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = Number(event.target.value);
    setDraft(null);
    emit(next);
  };

  const handleNumber = (event: ChangeEvent<HTMLInputElement>): void => {
    const text = event.target.value;
    setDraft(text);
    // 允许 "-"、""、"1." 等编辑中间态不提交，避免来回跳数
    if (!DECIMAL_PATTERN.test(text.trim())) return;
    const parsed = Number(text);
    if (Number.isFinite(parsed)) emit(parsed);
  };

  const commitBlur = (): void => setDraft(null);

  const displayValue =
    draft ?? (numericValue === null ? '' : String(normalizeDisplay(numericValue)));
  const describedBy = error === null ? undefined : errorId;

  return (
    <div className={styles.root} data-parameter-id={parameter.id}>
      <div className={styles.header}>
        <label className={styles.name} htmlFor={numberInputId}>
          {parameter.name}
          {unit === '' ? null : <span className={styles.unit}>（{unit}）</span>}
        </label>
        {rangeText === '' ? null : <span className={styles.meta}>{rangeText}</span>}
      </div>

      {numericValue === null ? (
        <p className={styles.readonly}>
          当前取值：<code>{summarize(value)}</code>
          <br />
          该参数由专用控件编辑（滑块与数字输入不适用）。
        </p>
      ) : (
        <div className={styles.row}>
          {showSlider ? (
            <input
              id={rangeInputId}
              className={styles.range}
              type="range"
              min={min}
              max={max}
              step={step}
              value={numericValue}
              disabled={disabled || !parameter.editable}
              aria-label={`${parameter.name} 滑块`}
              aria-describedby={describedBy}
              aria-invalid={error === null ? undefined : true}
              onChange={handleSlider}
            />
          ) : (
            <span className={styles.noRange}>该参数没有区间限制，请直接输入</span>
          )}
          <input
            id={numberInputId}
            className={styles.number}
            type="number"
            inputMode="decimal"
            min={min ?? undefined}
            max={max ?? undefined}
            step={step}
            value={displayValue}
            disabled={disabled || !parameter.editable}
            aria-describedby={describedBy}
            aria-invalid={error === null ? undefined : true}
            onChange={handleNumber}
            onBlur={commitBlur}
          />
        </div>
      )}

      {error === null ? null : (
        <p className={styles.error} id={errorId} role="alert">
          <span aria-hidden="true">⚠</span> {error}
        </p>
      )}

      {!parameter.editable ? <p className={styles.lockNote}>该参数为只读，不能修改。</p> : null}
    </div>
  );
}

/** 去掉浮点尾差后转字符串，避免输入框出现 `0.30000000000000004`。 */
function normalizeDisplay(value: number): number | string {
  const rounded = Number(fixed(value, 6));
  return Number.isNaN(rounded) ? value : rounded;
}
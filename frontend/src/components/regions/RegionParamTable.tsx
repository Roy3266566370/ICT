/**
 * 区域参数编辑表（准备页"识别结果可修正"的核心控件）。
 *
 * 设计要点：
 *  - 每个参数都带 **来源页 + provenance**，用户能判断"这是原文提取还是系统推断"；
 *  - 数值 / 单位 / 映射都可改：改错了能改回来（"恢复原值"按钮）；
 *  - 值以文本进出，解析由页面层按原类型完成（表格不猜测参数类型，避免静默改类型）。
 */
import type { ReactElement } from 'react';
import type { Provenance } from '@/api/types';
import styles from './RegionParamTable.module.css';

export interface RegionParamRow {
  /** 参数键（original_params 的键） */
  key: string;
  /** 界面显示名；为空时显示 key */
  name: string;
  /** 当前值（已合并用户修改） */
  value: unknown;
  /** 原始值（用于"恢复原值"与"偏离"判定） */
  originalValue: unknown;
  /** 单位；无量纲为 "1" */
  unit: string;
  /** 范围/取值提示 */
  rangeText: string;
  /** 该参数来自哪一页（无页码为 null） */
  sourcePage: number | null;
  /** 参数级来源状态（未知为 null） */
  provenance: Provenance | null;
  /** 是否可编辑（识别为不可分离/系统推断但禁止改时给 false） */
  editable: boolean;
  /** 编辑校验错误（中文，直接展示） */
  error: string | null;
  /** 是否已偏离原值 */
  changed: boolean;
}

export interface RegionParamTableProps {
  rows: RegionParamRow[];
  disabled: boolean;
  onEditValue: (key: string, text: string) => void;
  onEditUnit: (key: string, unit: string) => void;
  onResetParam: (key: string) => void;
}

const PROVENANCE_TEXT: Record<Provenance, string> = {
  original: '原文提取',
  inferred: '系统推断',
  user_confirmed: '用户确认',
  manual_demo: '示例预置',
};

const PROVENANCE_ORDER: readonly Provenance[] = ['user_confirmed', 'original', 'inferred', 'manual_demo'];

export function provenanceText(value: Provenance | null): string {
  if (value === null) return '未标注';
  return PROVENANCE_TEXT[value] ?? '未标注';
}

/** 取"最可信"的来源状态（与 C-KO@1 的展示优先级一致）。 */
export function pickProvenance(values: Provenance[]): Provenance | null {
  for (const candidate of PROVENANCE_ORDER) {
    if (values.includes(candidate)) return candidate;
  }
  return null;
}

/** 值 → 输入框文本（数字/布尔/字符串直出，结构值走 JSON）。 */
export function valueToText(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function RegionParamTable(props: RegionParamTableProps): ReactElement {
  const { rows, disabled, onEditValue, onEditUnit, onResetParam } = props;

  if (rows.length === 0) {
    return (
      <p className={styles.empty} role="status">
        该区域没有可编辑参数（识别结果只包含位置与说明）。可继续确认，或标为仅静态阅读。
      </p>
    );
  }

  return (
    <table className={styles.table}>
      <caption className={styles.caption}>
        识别到的参数：可直接改数值或单位；来源页与来源状态表示这些值是怎么来的。
      </caption>
      <thead>
        <tr>
          <th scope="col">参数</th>
          <th scope="col">当前值</th>
          <th scope="col">单位</th>
          <th scope="col">来源页</th>
          <th scope="col">来源状态</th>
          <th scope="col">操作</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const text = valueToText(row.value);
          // 结构类参数（如 S18 的 cells 数组）用多行框，避免长 JSON 把表格撑破
          const multiline = text.length > 48;
          return (
          <tr key={row.key} data-changed={row.changed ? 'true' : undefined}>
            <th scope="row" className={styles.paramCell}>
              <span className={styles.paramName}>{row.name.length > 0 ? row.name : row.key}</span>
              <code className={styles.paramKey}>{row.key}</code>
              {row.changed && <span className={styles.changedTag}>已修改</span>}
              <span className={styles.rangeText}>{row.rangeText}</span>
            </th>
            <td className={styles.valueCell}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>值</span>
                {multiline ? (
                  <textarea
                    className={styles.textarea}
                    rows={3}
                    value={text}
                    disabled={disabled || !row.editable}
                    aria-invalid={row.error !== null}
                    aria-label={`${row.name.length > 0 ? row.name : row.key} 的值`}
                    onChange={(event) => onEditValue(row.key, event.target.value)}
                  />
                ) : (
                  <input
                    className={styles.input}
                    type="text"
                    inputMode="decimal"
                    value={text}
                    disabled={disabled || !row.editable}
                    aria-invalid={row.error !== null}
                    aria-label={`${row.name.length > 0 ? row.name : row.key} 的值`}
                    onChange={(event) => onEditValue(row.key, event.target.value)}
                  />
                )}
              </label>
              {row.error !== null && (
                <span className={styles.error} role="alert">
                  {row.error}
                </span>
              )}
            </td>
            <td className={styles.unitCell}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>单位</span>
                <input
                  className={styles.input}
                  type="text"
                  value={row.unit}
                  disabled={disabled || !row.editable}
                  aria-label={`${row.name.length > 0 ? row.name : row.key} 的单位`}
                  onChange={(event) => onEditUnit(row.key, event.target.value)}
                />
              </label>
            </td>
            <td className={styles.metaCell}>
              {row.sourcePage === null ? <span className={styles.muted}>未知</span> : `第 ${row.sourcePage} 页`}
            </td>
            <td className={styles.metaCell}>
              <span className={styles.provenance} data-provenance={row.provenance ?? 'unknown'}>
                {provenanceText(row.provenance)}
              </span>
            </td>
            <td className={styles.actionCell}>
              <button
                type="button"
                className={styles.resetButton}
                disabled={disabled || !row.changed}
                onClick={() => onResetParam(row.key)}
              >
                恢复原值
              </button>
            </td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default RegionParamTable;
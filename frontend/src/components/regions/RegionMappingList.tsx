/**
 * 原位文字映射（linked_texts）编辑器。
 *
 * 为什么要让用户改：识别可能把"面积 6"这类数值绑到错误的元素上；
 * 允许改模板即可在不改代码的情况下纠正映射（占位符见下方提示）。
 */
import type { ReactElement } from 'react';
import styles from './RegionMappingList.module.css';

export interface RegionMappingRow {
  /** 原页元素 id */
  elementId: string;
  /** 结果值 / 只在原参数下成立的说明 */
  kind: 'result' | 'hint';
  /** 占位符模板 */
  template: string;
  /** 本轮是否被用户改过 */
  edited: boolean;
}

export interface RegionMappingListProps {
  rows: RegionMappingRow[];
  disabled: boolean;
  onEditTemplate: (elementId: string, template: string) => void;
  onResetTemplate: (elementId: string) => void;
}

export function RegionMappingList(props: RegionMappingListProps): ReactElement {
  const { rows, disabled, onEditTemplate, onResetTemplate } = props;

  if (rows.length === 0) {
    return (
      <p className={styles.empty}>
        该区域没有绑定原页文字：参数变化只影响图形本身。若原页确有需要跟随的数值，可在工作台"详情"里继续核对。
      </p>
    );
  }

  return (
    <div className={styles.wrapper}>
      <p className={styles.hint}>
        映射模板用占位符表示要跟随参数的文字，例如 <code>{'{area_stretch}'}</code>、<code>{'{stretch_x}'}</code>；
        "只在原参数下成立的说明"在参数偏离后会加"原页为……"限定，不会冒充当结论。
      </p>
      <ul className={styles.list}>
        {rows.map((row) => (
          <li key={row.elementId} className={styles.item} data-kind={row.kind}>
            <div className={styles.itemHead}>
              <code className={styles.elementId}>{row.elementId}</code>
              <span className={styles.kind} data-kind={row.kind}>
                {row.kind === 'hint' ? '只在原参数下成立' : '当前参数结果'}
              </span>
              {row.edited && <span className={styles.editedTag}>已修改</span>}
              <button
                type="button"
                className={styles.resetButton}
                disabled={disabled || !row.edited}
                onClick={() => onResetTemplate(row.elementId)}
              >
                恢复原文
              </button>
            </div>
            <input
              className={styles.input}
              type="text"
              value={row.template}
              disabled={disabled}
              aria-label={`${row.elementId} 的文字映射模板`}
              onChange={(event) => onEditTemplate(row.elementId, event.target.value)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default RegionMappingList;
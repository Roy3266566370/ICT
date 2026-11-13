/**
 * TableSpecView.tsx —— table 视图。
 *
 * 数据来源（优先顺序，与数据通道补丁一致）：
 *  1. `view.dataset` → `spec.datasets[].id`：渲染**原始数据表**（列名取 columns，
 *     行是数据集里的原始单元格）；
 *  2. 没有 `dataset` 时才退化为「参数 / 派生量」单行快照；
 *  3. 声明了 dataset 但找不到：显示「该表格缺少数据（dataset 未提供：id）」，
 *     不用参数表冒充原始数据。
 *
 * 约定：等宽字体 + `tabular-nums`；超过 50 行截断并明确说明。
 */
import type { ReactElement } from 'react';
import type { ISpec, SpecEvaluation, TableView } from '../../../ispec/types';
import { resolveSpecDataset, filterSpecRows, visibleSpecColumns } from '../../../ispec/dataset';
import { formatSpecValue, type SpecCell } from '../../../ispec/format';
import styles from './TableSpecView.module.css';

const MAX_DATASET_ROWS = 50;

export interface TableSpecViewProps {
  view: TableView;
  spec: ISpec;
  evaluation: SpecEvaluation;
  /** 参数是否偏离默认值（用于"当前值"标记） */
  changed: boolean;
}

export function TableSpecView(props: TableSpecViewProps): ReactElement {
  const { view, spec, evaluation, changed } = props;

  if (view.dataset !== undefined) {
    const resolved = resolveSpecDataset(spec, view.dataset, '表格');
    if (resolved.missing) {
      return (
        <figure className={styles.root} data-table-view data-table-missing="true">
          {view.title === undefined ? null : (
            <figcaption className={styles.title}>{view.title}</figcaption>
          )}
          <p className={styles.missing} role="status">
            {resolved.note}
          </p>
        </figure>
      );
    }

    // view.columns 是显示层声明；若它全部存在于数据集中就按它排序，否则用数据集列
    const declaredColumns = view.columns.every((column) => resolved.columns.includes(column))
      ? view.columns
      : resolved.columns;
    const columns = visibleSpecColumns(spec, evaluation, declaredColumns);
    const filteredRows = filterSpecRows(spec, evaluation, resolved.rows);
    const visibleRows = filteredRows.slice(0, MAX_DATASET_ROWS);
    const truncated = filteredRows.length > visibleRows.length;

    return (
      <figure
        className={styles.root}
        data-table-view
        data-dataset-id={resolved.id ?? undefined}
        data-row-count={filteredRows.length}
      >
        {view.title === undefined ? null : (
          <figcaption className={styles.title}>{view.title}</figcaption>
        )}
        <div className={styles.scroller}>
          <table className={styles.table}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column} scope="col" className={styles.headCell} data-column={column}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`} data-row-index={rowIndex}>
                  {columns.map((column) => {
                    const value = row[column];
                    return (
                      <td
                        key={column}
                        className={styles.cell}
                        data-column={column}
                        data-missing={value === undefined ? 'true' : undefined}
                      >
                        {formatSpecValue(value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {truncated ? (
          <p className={styles.truncated} data-row-truncated>
            共 {filteredRows.length} 行，仅显示前 {visibleRows.length} 行。
          </p>
        ) : null}
        {changed ? (
          <span className={styles.badge} data-current-badge>
            当前值
          </span>
        ) : null}
      </figure>
    );
  }

  const scope: Record<string, SpecCell> = { ...evaluation.values, ...evaluation.derived };

  return (
    <figure className={styles.root} data-table-view data-changed={changed ? 'true' : 'false'}>
      {view.title === undefined ? null : <figcaption className={styles.title}>{view.title}</figcaption>}

      <div className={styles.scroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              {view.columns.map((column) => (
                <th key={column} scope="col" className={styles.headCell} data-column={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {view.columns.map((column) => {
                const value = scope[column];
                return (
                  <td
                    key={column}
                    className={styles.cell}
                    data-column={column}
                    data-missing={value === undefined ? 'true' : undefined}
                    title={value === undefined ? `未找到取值：${column}` : String(value)}
                  >
                    {formatSpecValue(value)}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {changed ? (
        <span className={styles.badge} data-current-badge>
          当前值
        </span>
      ) : null}
    </figure>
  );
}

export default TableSpecView;

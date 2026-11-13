/**
 * SourcePanel.tsx —— 来源面板（C-UI@1）
 *
 * 规则（§2.2.11 约束 3 / R4-AC3）：
 *  - `page != null` 的项才可点击；点击只做「跳页 + 高亮页」；
 *  - `element_id` 或 `bbox` 为 null 时 **不渲染元素框**，显式标注"页级来源"；
 *  - 来源字段一律来自服务端/对象数据，前端不推断、不补全。
 */
import type { ReactElement } from 'react';
import type { SourcePanelProps } from '@/api/types';
import { ProvenanceBadge } from './StatusBadge';
import styles from './SourcePanel.module.css';

export function SourcePanel(props: SourcePanelProps): ReactElement {
  const { sources, activeSourceId, onSelect } = props;

  if (sources.length === 0) {
    return (
      <p className={styles.empty} role="status">
        该对象没有声明来源。
      </p>
    );
  }

  return (
    <ul className={styles.list} aria-label="来源列表">
      {sources.map((source) => {
        const clickable = source.page !== null;
        const hasElementBox = source.element_id !== null && source.bbox !== null;
        const active = source.id === activeSourceId;
        return (
          <li key={source.id} className={styles.item}>
            <button
              type="button"
              className={`${styles.trigger} ${active ? styles.active : ''}`}
              onClick={() => onSelect(source.id)}
              disabled={!clickable}
              aria-current={active ? 'true' : undefined}
              title={clickable ? '定位到该页' : '该来源没有页码，只能阅读摘录'}
            >
              <span className={styles.label}>{source.label}</span>
              <span className={styles.meta}>
                <ProvenanceBadge provenance={source.provenance} />
                {source.page === null ? (
                  <span className={styles.pageMissing}>无页码</span>
                ) : (
                  <span className={styles.page}>第 {source.page} 页</span>
                )}
                {hasElementBox ? (
                  <span className={styles.element}>元素框</span>
                ) : (
                  <span className={styles.pageLevel}>页级来源（无元素框）</span>
                )}
              </span>
            </button>
            {source.excerpt === null ? null : (
              <p className={styles.excerpt}>「{source.excerpt}」</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
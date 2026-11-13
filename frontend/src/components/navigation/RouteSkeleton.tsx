import type { ReactElement } from 'react';
import styles from './RouteSkeleton.module.css';

export type RouteSkeletonVariant = 'page' | 'reader';

interface Props {
  variant?: RouteSkeletonVariant;
}

/**
 * 路由懒加载占位：尺寸贴近真实布局，避免"纯文字"闪动。
 * 根节点保留 `route-fallback` 类，性能脚本用它统计 fallback 时长。
 */
export function RouteSkeleton({ variant = 'page' }: Props): ReactElement {
  if (variant === 'reader') {
    return (
      <div className={`route-fallback ${styles.reader}`} role="status" aria-busy="true">
        <span className={styles.srOnly}>正在加载阅读器…</span>
        <div className={styles.readerTop}>
          <span className={styles.bar} style={{ width: 132 }} />
          <span className={styles.bar} style={{ width: 46 }} />
          <span className={styles.grow} />
          <span className={styles.bar} style={{ width: 88 }} />
          <span className={styles.bar} style={{ width: 96 }} />
        </div>
        <div className={styles.readerBody}>
          <div className={styles.readerRail}>
            {Array.from({ length: 6 }, (_, index) => (
              <span key={index} className={styles.railThumb} />
            ))}
          </div>
          <div className={styles.readerMain}>
            <div className={styles.readerHeading}>
              <span className={styles.bar} style={{ width: 92 }} />
              <span className={styles.bar} style={{ width: 280, height: 22 }} />
            </div>
            <span className={styles.slidePlaceholder} />
            <span className={styles.strip} />
          </div>
        </div>
        <div className={styles.readerFooter} />
      </div>
    );
  }

  return (
    <div className={`route-fallback ${styles.page}`} role="status" aria-busy="true">
      <span className={styles.srOnly}>正在加载页面…</span>
      <div className={styles.pageNav}>
        <span className={styles.bar} style={{ width: 116, height: 24 }} />
        <span className={styles.grow} />
        <span className={styles.bar} style={{ width: 64 }} />
        <span className={styles.bar} style={{ width: 64 }} />
        <span className={styles.bar} style={{ width: 64 }} />
      </div>
      <div className={styles.pageBody}>
        <span className={styles.bar} style={{ width: '38%', height: 34 }} />
        <span className={styles.bar} style={{ width: '62%', height: 16 }} />
        <div className={styles.cardRow}>
          {Array.from({ length: 3 }, (_, index) => (
            <span key={index} className={styles.card} />
          ))}
        </div>
        <div className={styles.cardRow}>
          <span className={`${styles.card} ${styles.cardWide}`} />
          <span className={styles.card} />
        </div>
      </div>
    </div>
  );
}

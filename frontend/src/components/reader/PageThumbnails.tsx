/**
 * PageThumbnails.tsx —— 24 页缩略图（rebuild-spec §6）。
 *
 * 桌面（≥1024px）左侧竖排；窄屏折叠为顶部下拉，避免把页面压成一张小图。
 * 每页标明"可交互 / 仅阅读"，让用户先看到熟悉的页面，再决定是否点开图示。
 */
import type { ReactElement } from 'react';
import { NARROW_ASIDE_QUERY, useMediaQuery } from '@/components/workbench/useMediaQuery';
import { pageThumbUrl } from '@/components/presentation/pageUrls';
import { pageImageFor } from './regionData';
import styles from './PageThumbnails.module.css';

export interface PageThumbnailItem {
  page: number;
  title: string;
  /** 该页是否有已确认的可交互区域。 */
  interactive: boolean;
}

export interface PageThumbnailsProps {
  items: PageThumbnailItem[];
  currentPage: number;
  onSelect: (page: number) => void;
}

export function PageThumbnails(props: PageThumbnailsProps): ReactElement {
  const { items, currentPage, onSelect } = props;
  const compact = useMediaQuery(NARROW_ASIDE_QUERY);

  if (compact) {
    return (
      <div className={styles.compact}>
        <label className={styles.compactLabel} htmlFor="reader-page-select">
          页面
        </label>
        <select
          id="reader-page-select"
          className={styles.select}
          value={String(currentPage)}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            if (Number.isFinite(next)) onSelect(next);
          }}
        >
          {items.map((item) => (
            <option key={item.page} value={String(item.page)}>
              第 {item.page} 页 · {item.interactive ? '可交互' : '仅阅读'} · {item.title}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <nav className={styles.rail} aria-label="页面缩略图">
      <p className={styles.railTitle}>
        页面 <span className={styles.railCount}>{items.length}</span>
      </p>
      <ol className={styles.list}>
        {items.map((item) => (
          <li key={item.page}>
            <button
              type="button"
              className={styles.item}
              data-current={item.page === currentPage ? 'true' : undefined}
              data-interactive={item.interactive ? 'true' : undefined}
              aria-current={item.page === currentPage ? 'page' : undefined}
              aria-label={`第 ${item.page} 页：${item.title}（${item.interactive ? '可交互' : '仅阅读'}）`}
              onClick={() => onSelect(item.page)}
            >
              <span className={styles.thumbWrap}>
                <img
                  className={styles.thumb}
                  src={pageThumbUrl(pageImageFor(item.page, null, null), 320)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                />
                <span className={styles.pageNo}>{item.page}</span>
              </span>
              <span className={styles.meta}>
                <span className={styles.title}>{item.title}</span>
                <span className={styles.state} data-interactive={item.interactive ? 'true' : undefined}>
                  <span className={styles.dot} aria-hidden="true" />
                  {item.interactive ? '可交互' : '仅阅读'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
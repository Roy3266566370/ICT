import { memo, useEffect, useRef, useState, type ComponentProps } from 'react';
import type { ScenePage } from '@/document/types';
import { ScenePageView } from '@/components/editor/ScenePageView';
import { pageThumbUrl } from './pageUrls';
import styles from './DeckPlayer.module.css';

type PageMaster = ComponentProps<typeof ScenePageView>['master'];

export interface ThumbnailRailItem {
  pageNo: number;
  label: string;
  imageUrl: string | null;
  bytes: number | null;
  aspectRatio: string;
  /** 仅在“自由编辑”已产出可读场景时提供；对象引用随 sceneDocument 稳定。 */
  scene: ScenePage | null;
  master?: PageMaster;
}

interface RailProps {
  pages: ThumbnailRailItem[];
  currentPageNo: number;
  interactivePages: ReadonlySet<number>;
  collapsed: boolean;
  onCollapse: () => void;
  onSelect: (pageNo: number) => void;
}

export function SceneThumbnail({ page, master }: { page: ScenePage; master?: PageMaster }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(160);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0]!.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={host} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <ScenePageView page={page} scale={width / page.width} master={master} />
    </div>
  );
}

/** 只在接近视口时才请求缩略图；不依赖浏览器 lazy 的距离启发式。 */
function LazyThumb({ src, aspectRatio }: { src: string; aspectRatio: string }) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible) return;
    const node = host.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);
  return (
    <span ref={host} className={styles.thumbImage} style={{ aspectRatio }}>
      {visible ? (
        <img src={src} alt="" decoding="async" draggable={false} {...{ fetchpriority: 'low' }} />
      ) : null}
    </span>
  );
}

interface ItemProps {
  pageNo: number;
  ordinal: number;
  label: string;
  imageUrl: string | null;
  bytes: number | null;
  aspectRatio: string;
  scene: ScenePage | null;
  master?: PageMaster;
  isCurrent: boolean;
  interactive: boolean;
  onSelect: (pageNo: number) => void;
}

const ThumbnailItem = memo(function ThumbnailItem(props: ItemProps) {
  const { pageNo, ordinal, label, imageUrl, bytes, aspectRatio, scene, master, isCurrent,
    interactive, onSelect } = props;
  return (
    <button type="button" onClick={() => onSelect(pageNo)} aria-current={isCurrent ? 'page' : undefined}
      aria-label={`第 ${ordinal} 页：${label}`} className={styles.thumbnail}>
      <span className={styles.thumbPreview}>
      {scene ? (
        <span className={styles.thumbImage} style={{ aspectRatio }}>
          <SceneThumbnail page={scene} master={master} />
        </span>
      ) : imageUrl ? (
        <LazyThumb src={pageThumbUrl(imageUrl, 320, bytes)} aspectRatio={aspectRatio} />
      ) : (
        <span className={styles.thumbImage} style={{ aspectRatio }}><span>{label || `页面生成中`}</span></span>
      )}
      {interactive && <span className={styles.interactiveBadge}>✦ 互动</span>}
      </span>
      <span className={styles.thumbCaption}>
        <b>{ordinal}</b>
        <span>{label || `第 ${ordinal} 页`}</span>
      </span>
    </button>
  );
});

export const ThumbnailRail = memo(function ThumbnailRail(props: RailProps) {
  const { pages, currentPageNo, interactivePages, collapsed, onCollapse, onSelect } = props;
  const [onlyInteractive, setOnlyInteractive] = useState(false);
  const activeFilter = onlyInteractive && interactivePages.size > 0;
  const selected = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!collapsed) selected.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({block: 'nearest', inline: 'nearest'});
  }, [collapsed, activeFilter, currentPageNo]);
  return (
    <nav className={styles.thumbnails} data-collapsed={collapsed} aria-label="幻灯片缩略图">
      <div className={styles.railTitle}>
        {interactivePages.size ? <div className={styles.railFilters} role="group" aria-label="筛选缩略图">
          <button type="button" aria-pressed={!activeFilter} onClick={() => setOnlyInteractive(false)}>全部 <span>{pages.length}</span></button>
          <button type="button" aria-pressed={activeFilter} onClick={() => setOnlyInteractive(true)}>交互 <span>{interactivePages.size}</span></button>
        </div> : <span>幻灯片 · {pages.length}</span>}
        <button type="button" className={styles.railCollapse} aria-label="收起页导航" onClick={onCollapse}>◂</button>
      </div>
      <div ref={selected} className={styles.railList}>
      {pages.map((item, index) => {
        if (activeFilter && !interactivePages.has(item.pageNo)) return null;
        return (
          <ThumbnailItem
            key={item.pageNo}
            pageNo={item.pageNo}
            ordinal={index + 1}
            label={item.label}
            imageUrl={item.imageUrl}
            bytes={item.bytes}
            aspectRatio={item.aspectRatio}
            scene={item.scene}
            master={item.master}
            isCurrent={item.pageNo === currentPageNo}
            interactive={interactivePages.has(item.pageNo)}
            onSelect={onSelect}
          />
        );
      })}
      </div>
    </nav>
  );
});

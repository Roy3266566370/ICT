import { memo, useEffect, useRef, useState } from 'react';
import type { ScenePage } from '@/document/types';
import { ScenePageView } from '@/components/editor/ScenePageView';
import { pageThumbUrl } from './pageUrls';
import styles from './DeckPlayer.module.css';

export interface ThumbnailRailItem {
  pageNo: number;
  label: string;
  imageUrl: string | null;
  bytes: number | null;
  aspectRatio: string;
  /** 仅在“自由编辑”已产出可读场景时提供；对象引用随 sceneDocument 稳定。 */
  scene: ScenePage | null;
}

export interface ThumbnailRailBadge {
  label: string;
  title: string;
}

interface RailProps {
  pages: ThumbnailRailItem[];
  currentPageNo: number;
  affectedPages: ReadonlySet<number>;
  badges: ReadonlyMap<number, ThumbnailRailBadge>;
  interactivePages: ReadonlySet<number>;
  collapsed: boolean;
  onSelect: (pageNo: number) => void;
}

function SceneThumbnail({ page }: { page: ScenePage }) {
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
      <ScenePageView page={page} scale={width / page.width} />
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
        <img src={src} alt="" decoding="async" fetchPriority="low" draggable={false} />
      ) : null}
    </span>
  );
}

interface ItemProps {
  pageNo: number;
  label: string;
  imageUrl: string | null;
  bytes: number | null;
  aspectRatio: string;
  scene: ScenePage | null;
  isCurrent: boolean;
  affected: boolean;
  badgeLabel?: string;
  badgeTitle?: string;
  interactive: boolean;
  onSelect: (pageNo: number) => void;
}

const ThumbnailItem = memo(function ThumbnailItem(props: ItemProps) {
  const { pageNo, label, imageUrl, bytes, aspectRatio, scene, isCurrent, affected,
    badgeLabel, badgeTitle, interactive, onSelect } = props;
  return (
    <button type="button" onClick={() => onSelect(pageNo)} aria-current={isCurrent ? 'page' : undefined}
      aria-label={`第 ${pageNo} 页：${label}`} className={styles.thumbnail} data-affected={affected}>
      {scene ? (
        <span className={styles.thumbImage} style={{ aspectRatio }}>
          <SceneThumbnail page={scene} />
        </span>
      ) : imageUrl ? (
        <LazyThumb src={pageThumbUrl(imageUrl, 320, bytes)} aspectRatio={aspectRatio} />
      ) : (
        <span className={styles.thumbImage} style={{ aspectRatio }}><span>{label || `页面生成中`}</span></span>
      )}
      <span className={styles.thumbCaption}>
        <b>{pageNo}</b>
        <span>{label || `第 ${pageNo} 页`}</span>
        {badgeLabel ? <em className={styles.impactBadge} title={badgeTitle}>{badgeLabel}</em> : null}
        {interactive ? <i title="有交互内容" /> : null}
      </span>
    </button>
  );
});

export const ThumbnailRail = memo(function ThumbnailRail(props: RailProps) {
  const { pages, currentPageNo, affectedPages, badges, interactivePages, collapsed, onSelect } = props;
  return (
    <nav className={styles.thumbnails} data-collapsed={collapsed} aria-label="幻灯片缩略图">
      <div className={styles.railTitle}>幻灯片 <span>{pages.length}</span></div>
      {pages.map((item) => {
        const badge = badges.get(item.pageNo);
        return (
          <ThumbnailItem
            key={item.pageNo}
            pageNo={item.pageNo}
            label={item.label}
            imageUrl={item.imageUrl}
            bytes={item.bytes}
            aspectRatio={item.aspectRatio}
            scene={item.scene}
            isCurrent={item.pageNo === currentPageNo}
            affected={affectedPages.has(item.pageNo)}
            badgeLabel={badge?.label}
            badgeTitle={badge?.title}
            interactive={interactivePages.has(item.pageNo)}
            onSelect={onSelect}
          />
        );
      })}
    </nav>
  );
});

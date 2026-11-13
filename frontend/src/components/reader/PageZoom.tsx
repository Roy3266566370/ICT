/**
 * PageZoom.tsx —— 页面缩放（50%–200%）与平移（rebuild-spec §6）。
 *
 * 设计要点：
 *  - 缩放只改外层容器宽度，**不改页面内部坐标**（内部统一用百分比 / viewBox 定位）；
 *  - 100% 表示"适配可用区域"（保证 16:9 完整可见），不是原始像素；
 *  - 放大后可用滚轮 / 滚动条 / 直接按住页面拖动来平移；
 *  - 移动端（<768px）页面保持 16:9，横向可滚动查看（不压扁）。
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactElement, type ReactNode } from 'react';
import styles from './PageZoom.module.css';

export interface PageZoomProps {
  /** 页码变化时保留缩放比例，但重置滚动位置到左上。 */
  page: number;
  reducedMotion: boolean;
  /** 以实际内容宽度渲染页面；调用方据此按比例缩放内部字号/描边。 */
  renderPage: (contentWidth: number) => ReactNode;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;
const VIEW_PADDING = 18;

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
}

function clamp(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

export function PageZoom(props: PageZoomProps): ReactElement {
  const { page, reducedMotion, renderPage } = props;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = viewportRef.current;
    if (node === null) return undefined;

    const measure = (): void => {
      setSize({ width: node.clientWidth, height: node.clientHeight });
    };
    measure();

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // 切换页时滚回左上，避免停留在上一页的滚动位置。
  useEffect(() => {
    const node = viewportRef.current;
    if (node !== null) {
      node.scrollLeft = 0;
      node.scrollTop = 0;
    }
  }, [page]);

  const availableWidth = Math.max(160, size.width - VIEW_PADDING * 2);
  const availableHeight = Math.max(120, size.height - VIEW_PADDING * 2);
  const fitWidth = Math.min(availableWidth, (availableHeight * 16) / 9);
  const contentWidth = Math.max(160, Math.round(fitWidth * zoom));
  const canPan = contentWidth > availableWidth + 1;

  const changeZoom = useCallback((next: number) => {
    setZoom(clamp(Math.round(next * 10) / 10));
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!canPan || event.button !== 0) return;
    const viewport = viewportRef.current;
    if (viewport === null) return;
    // 只从页面空白/图片区域开始拖动；控件（按钮、可拖端点）保持各自交互。
    const target = event.target as HTMLElement | null;
    if (target !== null && target.closest('button, input, a, [data-no-pan]') !== null) return;

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (drag === null || viewport === null || drag.pointerId !== event.pointerId) return;
    viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
    viewport.scrollTop = drag.scrollTop - (event.clientY - drag.startY);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className={styles.root}>
      <div
        ref={viewportRef}
        className={styles.viewport}
        data-pan={canPan ? 'true' : 'false'}
        data-dragging={dragRef.current !== null ? 'true' : undefined}
        data-reduced-motion={reducedMotion ? 'true' : 'false'}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className={styles.panArea} data-pan={canPan ? 'true' : 'false'}>
          <div className={styles.frame} style={{ width: `${contentWidth}px` }}>
            {renderPage(contentWidth)}
          </div>
        </div>
      </div>

      <div className={styles.controls} role="group" aria-label="页面缩放">
        <button
          type="button"
          className={styles.zoomButton}
          onClick={() => changeZoom(zoom - ZOOM_STEP)}
          disabled={zoom <= ZOOM_MIN}
          aria-label="缩小页面"
        >
          −
        </button>
        <button
          type="button"
          className={styles.zoomValue}
          onClick={() => changeZoom(1)}
          aria-label={`当前缩放 ${Math.round(zoom * 100)}%，点击恢复 100%`}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className={styles.zoomButton}
          onClick={() => changeZoom(zoom + ZOOM_STEP)}
          disabled={zoom >= ZOOM_MAX}
          aria-label="放大页面"
        >
          +
        </button>
      </div>

      {canPan ? (
        <p className={styles.panHint} role="note">
          放大后可直接拖动页面查看
        </p>
      ) : null}
    </div>
  );
}
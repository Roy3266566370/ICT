import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, TouchEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useReducedMotion } from '@/hooks/useMotionPreference';
import {
  applyCommand,
  clampPosition,
  describePosition,
  gotoSlide,
  keyToCommand,
  parseDeckLocation,
  resolveSlideRef,
  swipeDirection,
  wheelDirection,
  withSlideQuery,
} from './deckState';
import type { DeckCommand, DeckPosition } from './deckState';
import { SlideContext } from './slideContext';
import { useDeckLayout } from './useDeckLayout';
import styles from './Deck.module.css';

export type DeckTone = 'paper' | 'tint';

export interface DeckSlideDef {
  id: string;
  title: string;
  tone: DeckTone;
  /** 本页逐步出现的内容步数。 */
  builds: number;
  render: () => ReactNode;
}

export interface DeckHandle {
  /** 跳到指定页面（id 或 1 起始页码）。纵向布局下滚动到该页。 */
  goTo: (ref: string) => void;
}

export interface DeckStageProps {
  slides: readonly DeckSlideDef[];
  /** 为 true 时（例如上传弹窗打开）不响应翻页快捷键。 */
  paused?: boolean;
  onPresentChange?: (present: boolean) => void;
}

const DESIGN_W = 1280;
const DESIGN_H = 720;
const INTERACTIVE = 'input, textarea, select, [contenteditable="true"]';
const ACTIVATABLE = 'button, a[href], summary';
const NO_FLIP = '[data-deck-interactive]';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export const DeckStage = forwardRef<DeckHandle, DeckStageProps>(function DeckStage({ slides, paused = false, onPresentChange }, ref): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const layout = useDeckLayout();
  const isDeck = layout === 'deck';

  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);
  const lastWheel = useRef(0);
  const touchStart = useRef<{ x: number; y: number; ok: boolean } | null>(null);

  const infos = useMemo(() => slides.map((slide) => ({ id: slide.id, builds: reduced ? 0 : slide.builds })), [slides, reduced]);
  const infosRef = useRef(infos);
  infosRef.current = infos;

  const [position, setPosition] = useState<DeckPosition>(() => {
    const index = parseDeckLocation(location.search, location.hash, infos);
    return index === null ? { slide: 0, step: 0 } : gotoSlide(index, infos);
  });
  const positionRef = useRef(position);
  positionRef.current = position;
  const [visited, setVisited] = useState<ReadonlySet<number>>(() => new Set([position.slide]));
  const [scale, setScale] = useState(1);
  const [present, setPresent] = useState(false);
  const presentRef = useRef(false);
  presentRef.current = present;
  const [announce, setAnnounce] = useState('');

  const current = clampPosition(position, infos);
  const active = slides[current.slide];
  const total = slides.length;

  const commit = useCallback((next: DeckPosition): void => {
    setPosition(next);
    setVisited((previous) => (previous.has(next.slide) ? previous : new Set(previous).add(next.slide)));
  }, []);

  const run = useCallback((command: DeckCommand): void => {
    commit(applyCommand(positionRef.current, command, infosRef.current));
  }, [commit]);

  const scrollToSlide = useCallback((index: number): void => {
    sectionRefs.current[index]?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }, [reduced]);

  const goToIndex = useCallback((index: number): void => {
    if (isDeck) commit(gotoSlide(index, infosRef.current));
    else scrollToSlide(index);
  }, [commit, isDeck, scrollToSlide]);

  useImperativeHandle(ref, () => ({
    goTo: (target: string): void => {
      const index = resolveSlideRef(target, infosRef.current);
      if (index !== null) goToIndex(index);
    },
  }), [goToIndex]);

  /** 地址 → 页码：覆盖首次进入与站内 `#guide` 这类锚点。 */
  useEffect(() => {
    const index = parseDeckLocation(location.search, location.hash, infosRef.current);
    if (index === null) return;
    if (isDeck) {
      if (index !== positionRef.current.slide) commit(gotoSlide(index, infosRef.current));
    } else {
      window.requestAnimationFrame(() => scrollToSlide(index));
    }
    // 只在地址变化时响应
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, location.hash, isDeck]);

  /** 页码 → 地址：用 replace，不污染浏览器历史；保留 #upload。 */
  useEffect(() => {
    if (!isDeck) return;
    const search = withSlideQuery(location.search, current.slide);
    const keepHash = location.hash === '#upload' ? location.hash : '';
    if (search === location.search && keepHash === location.hash) return;
    navigate({ pathname: location.pathname, search, hash: keepHash }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.slide, isDeck]);

  /** 缩放：把 1280×720 的设计画布按可用区域等比放大缩小。 */
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node || !isDeck || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (): void => {
      const { width, height } = node.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      setScale(Math.min(1.7, Math.max(0.6, Math.min(width / DESIGN_W, height / DESIGN_H))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [isDeck]);

  /** 翻页播报与焦点：只在焦点会丢失时才移动，避免打断点击控制按钮的用户。 */
  const firstRender = useRef(true);
  useEffect(() => {
    if (!isDeck || !active) return;
    setAnnounce(describePosition(current.slide, total, active.title));
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const focused = document.activeElement;
    const inControls = focused instanceof HTMLElement && focused.closest('[data-deck-controls]') !== null;
    if (!inControls) sectionRefs.current[current.slide]?.focus({ preventScroll: true });
  }, [current.slide, isDeck, active, total]);

  const exitPresent = useCallback((): void => {
    setPresent(false);
    if (typeof document !== 'undefined' && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);

  const enterPresent = useCallback((): void => {
    setPresent(true);
    const node = rootRef.current;
    if (node && typeof node.requestFullscreen === 'function') void node.requestFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    onPresentChange?.(present);
  }, [present, onPresentChange]);

  useEffect(() => {
    if (!isDeck && presentRef.current) exitPresent();
  }, [isDeck, exitPresent]);

  useEffect(() => {
    const onChange = (): void => {
      if (!document.fullscreenElement && presentRef.current) setPresent(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => () => {
    if (typeof document !== 'undefined' && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);

  /** 键盘。 */
  useEffect(() => {
    if (!isDeck || paused) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape') {
        if (presentRef.current) {
          event.preventDefault();
          exitPresent();
        }
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement) {
        const outside = target !== document.body && target !== document.documentElement && !rootRef.current?.contains(target);
        if (outside || target.closest(INTERACTIVE) !== null) return;
        if ((event.key === ' ' || event.key === 'Spacebar') && target.closest(ACTIVATABLE) !== null) return;
      }
      const command = keyToCommand(event.key, event.shiftKey);
      if (command === null) return;
      event.preventDefault();
      run(command);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDeck, paused, run, exitPresent]);

  /** 滚轮：只在演示模式启用，避免劫持普通浏览时的页面滚动。 */
  useEffect(() => {
    const node = viewportRef.current;
    if (!node || !isDeck || !present || paused) return undefined;
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey || (event.target instanceof Element && event.target.closest(NO_FLIP) !== null)) return;
      event.preventDefault();
      const direction = wheelDirection(event.deltaY, lastWheel.current, event.timeStamp);
      if (direction === null) return;
      lastWheel.current = event.timeStamp;
      run(direction);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [isDeck, present, paused, run]);

  const onTouchStart = (event: TouchEvent): void => {
    const touch = event.touches[0];
    if (!touch) return;
    touchStart.current = { x: touch.clientX, y: touch.clientY, ok: !(event.target instanceof Element && event.target.closest(NO_FLIP) !== null) };
  };
  const onTouchEnd = (event: TouchEvent): void => {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !start.ok || !touch || paused) return;
    const direction = swipeDirection(touch.clientX - start.x, touch.clientY - start.y);
    if (direction !== null) run(direction);
  };

  const viewportStyle = { '--s': isDeck ? scale : 1 } as CSSProperties;
  const buildsLeft = active ? Math.max(0, infos[current.slide]?.builds ?? 0) : 0;
  const atEnd = current.slide >= total - 1 && current.step >= buildsLeft;
  const atStart = current.slide <= 0 && current.step <= 0;

  return <div ref={rootRef} className={styles.root} data-layout={layout} data-present={present ? 'true' : 'false'} data-tone={isDeck ? active?.tone ?? 'paper' : 'paper'}>
    <div ref={viewportRef} className={styles.viewport} style={viewportStyle} onTouchStart={isDeck ? onTouchStart : undefined} onTouchEnd={isDeck ? onTouchEnd : undefined}>
      {slides.map((slide, index) => {
        const offset = index - current.slide;
        const mounted = !isDeck || Math.abs(offset) <= 1 || visited.has(index);
        const pos = !isDeck ? 'stack' : offset === 0 ? 'active' : offset < 0 ? 'before' : 'after';
        const step = !isDeck || reduced ? Number.POSITIVE_INFINITY : offset < 0 ? Number.POSITIVE_INFINITY : offset === 0 ? current.step : 0;
        const hidden = isDeck && offset !== 0;
        const inertProps = hidden ? ({ inert: '' } as Record<string, string>) : {};
        return <section
          key={slide.id}
          id={`slide-${slide.id}`}
          ref={(node) => { sectionRefs.current[index] = node; }}
          className={styles.slide}
          data-tone={slide.tone}
          data-pos={pos}
          data-slide={slide.id}
          aria-roledescription="slide"
          aria-label={describePosition(index, total, slide.title)}
          aria-hidden={hidden ? true : undefined}
          tabIndex={-1}
          {...inertProps}
        >
          <SlideContext.Provider value={{ step, active: !isDeck || offset === 0, layout }}>
            <div className={styles.frame}>{mounted ? slide.render() : null}</div>
          </SlideContext.Provider>
        </section>;
      })}
    </div>

    {isDeck ? <nav className={styles.controls} data-deck-controls aria-label="翻页控制">
      <div className={styles.controlsMain}>
        <button type="button" className={styles.arrow} onClick={() => run('prev')} disabled={atStart} aria-label="上一步">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14 6-6 6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <span className={styles.counter} aria-hidden="true"><b>{pad(current.slide + 1)}</b> / {pad(total)}</span>
        <span className={styles.slideName} aria-hidden="true">{active?.title}</span>
        <button type="button" className={styles.arrow} onClick={() => run('next')} disabled={atEnd} aria-label="下一步">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m10 6 6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <ol className={styles.dots} aria-label="页面">
        {slides.map((slide, index) => <li key={slide.id}>
          <button type="button" className={styles.dot} data-current={index === current.slide ? 'true' : 'false'} onClick={() => goToIndex(index)} aria-label={`跳到第 ${index + 1} 页：${slide.title}`} aria-current={index === current.slide ? 'step' : undefined} title={slide.title} />
        </li>)}
      </ol>
      <div className={styles.controlsEnd}>
        <span className={styles.hint}>{present ? '← → 翻页 · 滚轮翻页 · Esc 退出' : '← → 翻页 · 空格逐步显示'}</span>
        <button type="button" className={styles.presentButton} onClick={present ? exitPresent : enterPresent}>{present ? '退出演示' : '开始演示'}</button>
      </div>
      <div className={styles.progress} aria-hidden="true"><span style={{ transform: `scaleX(${total <= 1 ? 1 : (current.slide + (buildsLeft > 0 ? current.step / (buildsLeft + 1) : 0)) / (total - 1)})` }} /></div>
    </nav> : null}
    <p className="visually-hidden" role="status" aria-live="polite">{announce}</p>
  </div>;
});

export default DeckStage;

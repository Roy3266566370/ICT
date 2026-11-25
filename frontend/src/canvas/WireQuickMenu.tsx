import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { filterWireRecommendations, type WireRecommendation } from './wireRecommend.ts';
import styles from './canvas.module.css';

interface WireQuickMenuProps {
  clientX: number;
  clientY: number;
  items: WireRecommendation[];
  onChoose: (item: WireRecommendation) => void;
  onCreate?: () => void;
  onClose: () => void;
}

export function WireQuickMenu({ clientX, clientY, items, onChoose, onCreate, onClose }: WireQuickMenuProps): JSX.Element {
  const [query, setQuery] = useState('');
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const matches = filterWireRecommendations(items, query);

  useLayoutEffect(() => {
    const element = menu.current!;
    const position = () => {
      const margin = 8;
      element.style.left = `${Math.max(margin, Math.min(clientX, document.documentElement.clientWidth - element.offsetWidth - margin))}px`;
      element.style.top = `${Math.max(margin, Math.min(clientY, document.documentElement.clientHeight - element.offsetHeight - margin))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(element);
    window.addEventListener('resize', position);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
    };
  }, [clientX, clientY]);

  useLayoutEffect(() => {
    search.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) close.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.stopPropagation();
      close.current();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, []);

  return createPortal(
    <div ref={menu} className={styles.wireQuickMenu} role="dialog" aria-label="推荐下游积木" data-board-tools>
      <input ref={search} type="search" aria-label="搜索兼容积木" placeholder="搜索兼容积木" value={query}
        onChange={(event) => setQuery(event.currentTarget.value)} />
      {onCreate && <button type="button" className={styles.wireQuickAi} onClick={onCreate}>✨ 用 AI 造一个接此数据的积木</button>}
      <ul className={styles.wireQuickList}>
        {matches.map((item) => <li key={item.type}>
          <button type="button" onClick={() => onChoose(item)}>
            <span><strong>{item.title}</strong><small>{item.inPortLabel}</small></span>
            <span className={styles.wireQuickBadge}>{item.badge}</span>
          </button>
        </li>)}
        {!matches.length && <li className={styles.wireQuickEmpty}>没有匹配的积木</li>}
      </ul>
    </div>,
    document.body,
  );
}

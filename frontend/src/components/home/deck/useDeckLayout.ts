import { useEffect, useState } from 'react';

export type DeckLayout = 'deck' | 'stack';

/** 宽屏横屏且高度足够才使用翻页 deck；手机、窄窗口、竖屏与矮窗口退回纵向滚动。 */
export const DECK_LAYOUT_QUERY = '(min-width: 900px) and (min-height: 600px) and (min-aspect-ratio: 5/4)';

function read(): DeckLayout {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'stack';
  return window.matchMedia(DECK_LAYOUT_QUERY).matches ? 'deck' : 'stack';
}

export function useDeckLayout(): DeckLayout {
  const [layout, setLayout] = useState<DeckLayout>(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(DECK_LAYOUT_QUERY);
    const onChange = (): void => setLayout(media.matches ? 'deck' : 'stack');
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return layout;
}

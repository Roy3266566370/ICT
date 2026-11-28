import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AnnotateTool } from './PresentationAnnotator';
import { SceneThumbnail, type ThumbnailRailItem } from './ThumbnailRail';
import { pageThumbUrl } from './pageUrls';
import styles from './PresentationMenu.module.css';

export type PresentationScreen = 'black' | 'white' | null;

interface Props {
  point: {x: number; y: number};
  pages: ThumbnailRailItem[];
  index: number;
  tool: AnnotateTool;
  color: string;
  zoomed: boolean;
  screen: PresentationScreen;
  onClose: () => void;
  onGo: (index: number) => void;
  onZoom: () => void;
  onTool: (tool: AnnotateTool) => void;
  onColor: (color: string) => void;
  onClear: () => void;
  onScreen: (screen: PresentationScreen) => void;
  onPresenter?: () => void;
  onEnd: () => void;
}

const pointerOptions: ReadonlyArray<[AnnotateTool, string]> = [
  ['off', '箭头'], ['laser', '激光笔'], ['pen', '笔'], ['highlighter', '荧光笔'], ['eraser', '橡皮擦'],
];
const inkColors = [['#dc2626', '红色'], ['#2563eb', '蓝色'], ['#15803d', '绿色'], ['#111827', '黑色'], ['#ffffff', '白色']] as const;

function canOpenBeside(anchor: HTMLButtonElement) {
  const panel = anchor.closest('[role="menu"]')?.getBoundingClientRect();
  return panel && Math.max(panel.left, window.innerWidth - panel.right) >= panel.width + 7;
}

function MenuPanel({label, point, anchor, focus, onBack, className = '', children}: {
  label: string; point: Props['point']; anchor?: HTMLButtonElement; focus: boolean;
  onBack?: () => void; className?: string; children: ReactNode;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const position = () => {
      const row = anchor?.getBoundingClientRect();
      const parentMenu = anchor?.closest<HTMLElement>('[role="menu"]');
      const parent = parentMenu?.getBoundingClientRect();
      const maxLeft = window.innerWidth - element.offsetWidth - 8;
      const right = (parent?.right ?? point.x) - 1;
      const left = (parent?.left ?? point.x) - element.offsetWidth + 1;
      const overlaps = Boolean(parent && right > maxLeft && left < 8);
      element.toggleAttribute('data-overlap', overlaps);
      const openLeft = left >= 8 && (parentMenu?.dataset.side === 'left' || right > maxLeft);
      if (parent) element.dataset.side = openLeft ? 'left' : 'right';
      const x = !parent ? point.x : openLeft ? left : right;
      element.style.left = `${Math.max(8, Math.min(x, maxLeft))}px`;
      element.style.top = `${Math.max(8, Math.min(row?.top ?? point.y, window.innerHeight - element.offsetHeight - 8))}px`;
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [point, anchor]);

  useLayoutEffect(() => {
    const element = menu.current;
    if (!focus || !element) return;
    const current = element.querySelector<HTMLButtonElement>('button[aria-current="page"], button[aria-checked="true"]');
    (current ?? element.querySelector<HTMLButtonElement>('button:not(:disabled):not([data-return])'))?.focus();
  }, [focus]);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' && onBack) {
      event.preventDefault();
      onBack();
      return;
    }
    if (event.key === 'ArrowRight' && (event.target as HTMLButtonElement).getAttribute('aria-haspopup') === 'menu') {
      event.preventDefault();
      (event.target as HTMLButtonElement).click();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      .filter(item => item.offsetHeight > 0);
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const backwards = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (backwards ? -1 : 1) + items.length) % items.length;
    items[next]?.focus();
  };
  return <div ref={menu} className={`${styles.menu} ${className}`} role="menu"
    aria-label={label} onClick={event => event.stopPropagation()} onKeyDown={moveFocus}>
    {children}
  </div>;
}

export function PresentationMenu({point, pages, index, tool, color, zoomed, screen, onClose, onGo, onZoom, onTool, onColor, onClear, onScreen, onPresenter, onEnd}: Props) {
  const [submenu, setSubmenu] = useState<{kind: 'pointer' | 'screen'; anchor: HTMLButtonElement; focus: boolean}>();
  const [palette, setPalette] = useState<{anchor: HTMLButtonElement; focus: boolean}>();
  const [overview, setOverview] = useState(false);
  const run = (action: () => void) => () => { onClose(); action(); };
  const openSubmenu = (kind: 'pointer' | 'screen', anchor: HTMLButtonElement, focus: boolean) => {
    if (!focus && !canOpenBeside(anchor)) return;
    setPalette(undefined);
    setSubmenu({kind, anchor, focus});
  };
  const backToMain = () => {
    submenu?.anchor.focus();
    setPalette(undefined);
    setSubmenu(undefined);
  };
  const backToPointer = () => {
    palette?.anchor.focus();
    setPalette(undefined);
  };
  return <div data-no-pan className={styles.backdrop} onClick={event => { event.stopPropagation(); onClose(); }}>
    {!overview && <MenuPanel label="放映菜单" point={point} focus>
        <button type="button" role="menuitem" disabled={index === pages.length - 1} onClick={run(() => onGo(index + 1))}>下一张</button>
        <button type="button" role="menuitem" disabled={index === 0} onClick={run(() => onGo(index - 1))}>上一张</button>
        <button type="button" role="menuitem" onClick={() => { setSubmenu(undefined); setPalette(undefined); setOverview(true); }}>查看所有幻灯片</button>
        <button type="button" role="menuitem" onClick={run(onZoom)}>{zoomed ? '恢复适应窗口' : '放大幻灯片'}</button>
        <div role="separator" className={styles.separator}/>
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={submenu?.kind === 'screen'}
          onMouseEnter={event => openSubmenu('screen', event.currentTarget, false)}
          onClick={event => openSubmenu('screen', event.currentTarget, true)}>屏幕 <span aria-hidden="true">›</span></button>
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={submenu?.kind === 'pointer'}
          onMouseEnter={event => openSubmenu('pointer', event.currentTarget, false)}
          onClick={event => openSubmenu('pointer', event.currentTarget, true)}>指针选项 <span aria-hidden="true">›</span></button>
        {onPresenter && <button type="button" role="menuitem" onClick={run(onPresenter)}>显示演讲者视图</button>}
        <div role="separator" className={styles.separator}/>
        <button type="button" role="menuitem" onClick={run(onEnd)}>结束放映</button>
    </MenuPanel>}
    {overview && <MenuPanel label="查看所有幻灯片" point={point} focus className={styles.slideMenu} onBack={() => setOverview(false)}>
        <button type="button" role="menuitem" onClick={() => setOverview(false)}>‹ 返回放映菜单</button>
        <div className={styles.slides}>
        {pages.map((page, ordinal) => <button type="button" key={page.pageNo} role="menuitem"
          aria-current={ordinal === index ? 'page' : undefined} onClick={run(() => onGo(ordinal))}>
          <span className={styles.thumbnail} style={{aspectRatio: page.aspectRatio}}>
            {page.scene ? <SceneThumbnail page={page.scene} master={page.master}/> : page.imageUrl
              ? <img src={pageThumbUrl(page.imageUrl, 320, page.bytes)} alt="" loading="lazy"/> : null}
          </span>
          <span>第 {ordinal + 1} 页{page.label ? ` · ${page.label}` : ''}</span>
        </button>)}
        </div>
    </MenuPanel>}
    {submenu?.kind === 'pointer' && <MenuPanel label="指针选项" point={point} anchor={submenu.anchor} focus={submenu.focus} onBack={backToMain}>
        <button type="button" role="menuitem" data-return onClick={backToMain}>‹ 返回放映菜单</button>
        {pointerOptions.map(([value, name]) => <button key={value} type="button" role="menuitemradio"
          aria-checked={tool === value} onClick={run(() => onTool(value))}>{name}</button>)}
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={!!palette}
          onMouseEnter={event => {
            if (canOpenBeside(event.currentTarget)) setPalette({anchor: event.currentTarget, focus: false});
          }}
          onClick={event => setPalette({anchor: event.currentTarget, focus: true})}>墨迹颜色 <span aria-hidden="true">›</span></button>
        <div role="separator" className={styles.separator}/>
        <button type="button" role="menuitem" onClick={run(onClear)}>擦除幻灯片上的所有墨迹</button>
    </MenuPanel>}
    {palette && <MenuPanel label="墨迹颜色" point={point} anchor={palette.anchor} focus={palette.focus} onBack={backToPointer}>
      <button type="button" role="menuitem" data-return onClick={backToPointer}>‹ 返回指针选项</button>
      {inkColors.map(([value, name]) => <button type="button" key={value} role="menuitemradio"
        aria-checked={color === value} onClick={run(() => onColor(value))}>
        <span className={styles.swatch} style={{backgroundColor: value}} aria-hidden="true"/>{name}
      </button>)}
    </MenuPanel>}
    {submenu?.kind === 'screen' && <MenuPanel label="屏幕" point={point} anchor={submenu.anchor} focus={submenu.focus} onBack={backToMain}>
        <button type="button" role="menuitem" data-return onClick={backToMain}>‹ 返回放映菜单</button>
        <button type="button" role="menuitemradio" aria-checked={screen === 'black'} onClick={run(() => onScreen('black'))}>黑屏</button>
        <button type="button" role="menuitemradio" aria-checked={screen === 'white'} onClick={run(() => onScreen('white'))}>白屏</button>
        <button type="button" role="menuitemradio" aria-checked={screen === null} onClick={run(() => onScreen(null))}>显示幻灯片</button>
    </MenuPanel>}
  </div>;
}

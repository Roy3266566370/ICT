/**
 * deckState.ts —— 首页 deck 的页码 / 构建步骤纯逻辑。
 *
 * 零 import：可被 `node --test` 直接加载。
 * 一个位置由「第几页 + 本页已显示到第几步」组成；步骤 0 表示本页只显示静态内容。
 */

export interface DeckSlideInfo {
  readonly id: string;
  /** 本页逐步出现的内容步数；0 表示没有构建动画。 */
  readonly builds: number;
}

export interface DeckPosition {
  readonly slide: number;
  readonly step: number;
}

export type DeckCommand = 'next' | 'prev' | 'first' | 'last';

/** 路由查询参数名：`?s=3` 或 `?s=demo`。 */
export const DECK_QUERY_KEY = 's';

/** 旧版首页锚点到页面 id 的映射，保证 `#guide` 等历史链接继续可用。 */
export const DECK_HASH_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  guide: 'workflow',
  explore: 'demo',
});

function lastIndex(slides: readonly DeckSlideInfo[]): number {
  return Math.max(0, slides.length - 1);
}

function buildsOf(slides: readonly DeckSlideInfo[], index: number): number {
  return Math.max(0, slides[index]?.builds ?? 0);
}

/** 把任意位置钳制到合法范围（页码与步骤都不越界）。 */
export function clampPosition(position: DeckPosition, slides: readonly DeckSlideInfo[]): DeckPosition {
  const slide = Math.min(lastIndex(slides), Math.max(0, Math.trunc(Number.isFinite(position.slide) ? position.slide : 0)));
  const step = Math.min(buildsOf(slides, slide), Math.max(0, Math.trunc(Number.isFinite(position.step) ? position.step : 0)));
  return { slide, step };
}

/** 前进一步：先显示本页剩余内容，出完再进入下一页；最后一页末尾保持不动。 */
export function nextPosition(position: DeckPosition, slides: readonly DeckSlideInfo[]): DeckPosition {
  const current = clampPosition(position, slides);
  if (current.step < buildsOf(slides, current.slide)) return { slide: current.slide, step: current.step + 1 };
  if (current.slide < lastIndex(slides)) return { slide: current.slide + 1, step: 0 };
  return current;
}

/** 后退一步：先收起本页已显示内容；回到上一页时该页保持完整显示。 */
export function prevPosition(position: DeckPosition, slides: readonly DeckSlideInfo[]): DeckPosition {
  const current = clampPosition(position, slides);
  if (current.step > 0) return { slide: current.slide, step: current.step - 1 };
  if (current.slide > 0) return { slide: current.slide - 1, step: buildsOf(slides, current.slide - 1) };
  return current;
}

/** 直接跳页：内容从头开始构建。 */
export function gotoSlide(index: number, slides: readonly DeckSlideInfo[]): DeckPosition {
  return clampPosition({ slide: index, step: 0 }, slides);
}

export function applyCommand(position: DeckPosition, command: DeckCommand, slides: readonly DeckSlideInfo[]): DeckPosition {
  switch (command) {
    case 'next': return nextPosition(position, slides);
    case 'prev': return prevPosition(position, slides);
    case 'first': return gotoSlide(0, slides);
    case 'last': return clampPosition({ slide: lastIndex(slides), step: buildsOf(slides, lastIndex(slides)) }, slides);
    default: return clampPosition(position, slides);
  }
}

/** 键盘按键到命令的映射；不处理的按键返回 null，交给浏览器默认行为。 */
export function keyToCommand(key: string, shiftKey = false): DeckCommand | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
      return 'next';
    case ' ':
    case 'Spacebar':
      return shiftKey ? 'prev' : 'next';
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return 'prev';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}

/** 解析页面引用：1 起始的数字或页面 id；无法识别返回 null。 */
export function resolveSlideRef(ref: string | null | undefined, slides: readonly DeckSlideInfo[]): number | null {
  if (ref === null || ref === undefined) return null;
  const text = ref.trim();
  if (text === '') return null;
  if (/^\d{1,3}$/.test(text)) {
    const index = Number(text) - 1;
    return index >= 0 && index < slides.length ? index : null;
  }
  const id = DECK_HASH_ALIASES[text] ?? text;
  const found = slides.findIndex((slide) => slide.id === id);
  return found >= 0 ? found : null;
}

/** 从地址解析初始页：优先 `?s=`，其次 `#guide` 这类历史锚点；`#upload` 不影响页码。 */
export function parseDeckLocation(search: string, hash: string, slides: readonly DeckSlideInfo[]): number | null {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(DECK_QUERY_KEY);
  const fromQuery = resolveSlideRef(query, slides);
  if (fromQuery !== null) return fromQuery;
  const anchor = hash.startsWith('#') ? hash.slice(1) : hash;
  return resolveSlideRef(anchor, slides);
}

/** 把页码写回查询串，保留其它参数；第一页不写参数，保持首页地址干净。 */
export function withSlideQuery(search: string, index: number): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (index <= 0) params.delete(DECK_QUERY_KEY);
  else params.set(DECK_QUERY_KEY, String(index + 1));
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/** 滚轮翻页的节流判定：返回方向或 null（忽略）。 */
export function wheelDirection(deltaY: number, lastTimestamp: number, now: number, threshold = 24, lockMs = 700): 'next' | 'prev' | null {
  if (Math.abs(deltaY) < threshold) return null;
  if (now - lastTimestamp < lockMs) return null;
  return deltaY > 0 ? 'next' : 'prev';
}

/** 触摸滑动判定：以横向位移为主且超过阈值才翻页，向左滑为下一页。 */
export function swipeDirection(dx: number, dy: number, threshold = 56): 'next' | 'prev' | null {
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.2) return null;
  return dx < 0 ? 'next' : 'prev';
}

/** 位置的字符串表示，仅用于「第 n 页，共 N 页」播报。 */
export function describePosition(index: number, total: number, title: string): string {
  return `第 ${index + 1} 页，共 ${total} 页：${title}`;
}

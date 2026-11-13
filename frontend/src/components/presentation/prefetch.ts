/** 相邻页预取计划（纯函数，供 DeckPlayer 与 node --test 共用）。 */

export interface PrefetchPlan {
  immediate: string[];
  idle: string[];
}

export interface NetworkHint {
  saveData?: boolean;
  effectiveType?: string;
}

/** 省流量或 2G 网络不做空闲预取。 */
export function prefetchAllowed(network?: NetworkHint | null): boolean {
  if (!network) return true;
  if (network.saveData) return false;
  return network.effectiveType !== 'slow-2g' && network.effectiveType !== '2g';
}

function pushUnique(list: string[], url: string | null | undefined): void {
  if (typeof url !== 'string' || url === '' || list.includes(url)) return;
  list.push(url);
}

/**
 * 当前页前后各一页立即预取；下一页的第二页也立即预取，形成两页前向缓冲
 * （已读过的上一页通常仍在浏览器缓存里）。省流量时只保留 ±1。
 */
export function planPrefetch(
  urls: readonly (string | null | undefined)[],
  index: number,
  allowIdle = true,
): PrefetchPlan {
  const immediate: string[] = [];
  pushUnique(immediate, urls[index + 1]);
  pushUnique(immediate, urls[index - 1]);
  if (allowIdle) pushUnique(immediate, urls[index + 2]);
  const idle: string[] = [];
  if (allowIdle) pushUnique(idle, urls[index - 2]);
  return { immediate, idle };
}

/** 过滤掉已经预取过的 URL，并保持首次出现顺序。 */
export function newPrefetchUrls(urls: readonly string[], seen: ReadonlySet<string>): string[] {
  const fresh: string[] = [];
  for (const url of urls) {
    if (url !== '' && !seen.has(url) && !fresh.includes(url)) fresh.push(url);
  }
  return fresh;
}

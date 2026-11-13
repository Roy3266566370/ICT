/** 页图 URL 构造（纯函数，供 DeckPlayer 与 node --test 共用）。 */

interface PageEnv {
  VITE_API_BASE?: string;
}

function apiBase(): string {
  const env = (import.meta as ImportMeta & { env?: PageEnv }).env;
  return (env?.VITE_API_BASE ?? '').trim().replace(/\/+$/, '');
}

export function pageUrl(raw: string | null): string {
  if (!raw) return '';
  if (raw.startsWith('/api/')) return `${apiBase()}${raw}`;
  if (raw.startsWith('fixtures/')) return `/${raw}`;
  return raw;
}

function isRenderPageUrl(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  return /\/api\/.*\/renders\/[^/]+$/.test(path);
}

function withQuery(url: string, params: URLSearchParams): string {
  const [base, hash] = url.split('#', 2);
  const separator = (base ?? '').includes('?') ? '&' : '?';
  return `${base}${separator}${params.toString()}${hash === undefined ? '' : `#${hash}`}`;
}

/** 阅读器主画面宽度：1600px WebP 在 1440 视口下保持清晰，字节约为原 PNG 的一半。 */
export const DISPLAY_WIDTH = 1600;

/** 主画面 URL：渲染页图走 WebP，其余地址原样返回。 */
export function pageDisplayUrl(raw: string | null, v?: string | number | null): string {
  return pageThumbUrl(raw, DISPLAY_WIDTH, v);
}

/**
 * 页图缩略图 URL：只给受鉴权的 `/renders/` 地址追加 `w`/`v`，
 * 其他地址（分享页、fixtures、离线导出）原样返回。
 */
export function pageThumbUrl(
  raw: string | null,
  w = 320,
  v?: string | number | null,
): string {
  const url = pageUrl(raw);
  if (!url || !isRenderPageUrl(url)) return url;
  const params = new URLSearchParams({ w: String(w) });
  if (v !== undefined && v !== null && String(v) !== '') params.set('v', String(v));
  return withQuery(url, params);
}

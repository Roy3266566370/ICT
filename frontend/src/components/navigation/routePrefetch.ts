/** 路由级加载函数表与预取（悬停/聚焦/空闲）。 */
import { prefetchAllowed, type NetworkHint } from '@/components/presentation/prefetch';

export const routeLoaders = {
  home: () => import('@/pages/HomePage'),
  canvas: () => import('@/pages/CanvasPage'),
  plaza: () => import('@/pages/PlazaPage'),
  creator: () => import('@/pages/CreatorPage'),
  space: () => import('@/pages/SpacePage'),
  settings: () => import('@/pages/SettingsProfilePage'),
  workbench: () => import('@/pages/MaterialDeckPage'),
  share: () => import('@/pages/SharePage'),
  living: () => import('@/pages/LivingPagesPage'),
  workshop: () => import('@/pages/WorkshopPage'),
  workShare: () => import('@/pages/WorkSharePage'),
  login: () => import('@/pages/LoginPage'),
  register: () => import('@/pages/RegisterPage'),
} as const;

export type RouteKey = keyof typeof routeLoaders;

export function routeKeyForPath(path: string): RouteKey | null {
  const clean = (path.split(/[?#]/, 1)[0] ?? '').replace(/\/+$/, '') || '/';
  if (clean === '/') return 'home';
  if (clean === '/canvas') return 'canvas';
  if (clean === '/space' || clean === '/settings/profile') return 'space';
  if (clean === '/plaza') return 'plaza';
  if (clean.startsWith('/u/')) return 'creator';
  if (clean === '/living') return 'living';
  if (clean === '/workshop') return 'workshop';
  if (clean.startsWith('/work-shares/')) return 'workShare';
  if (/^\/materials\/[^/]+\/(work|edit|prepare)$/.test(clean)) return 'workbench';
  if (clean.startsWith('/p/')) return 'share';
  if (clean === '/login') return 'login';
  if (clean === '/register') return 'register';
  return null;
}

export function prefetchRoute(key: RouteKey): void {
  void routeLoaders[key]().catch(() => undefined);
}

export function prefetchRouteForPath(path: string): void {
  const key = routeKeyForPath(path);
  if (key !== null) prefetchRoute(key);
}

export function routePrefetchHandlers(path: string): {
  onMouseEnter: () => void;
  onFocus: () => void;
  onTouchStart: () => void;
} {
  const run = (): void => prefetchRouteForPath(path);
  return { onMouseEnter: run, onFocus: run, onTouchStart: run };
}

function networkHint(): NetworkHint | undefined {
  return (navigator as Navigator & { connection?: NetworkHint }).connection;
}

export function prefetchRouteWhenIdle(key: RouteKey): (() => void) | undefined {
  if (!prefetchAllowed(networkHint())) return;
  const run = (): void => prefetchRoute(key);
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run, { timeout: 3000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(run, 1200);
  return () => window.clearTimeout(handle);
}

/** 首屏稳定后预取最常用的入口。 */
export function prefetchCommonRoutes(): void {
  const schedule = (): void => { prefetchRouteWhenIdle('workshop'); };
  // 过早加载路由样式会影响首屏布局测量。
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
}

export function viewTransitionsAllowed(): boolean {
  if (typeof document === 'undefined') return false;
  const view = document as Document & { startViewTransition?: unknown };
  if (typeof view.startViewTransition !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

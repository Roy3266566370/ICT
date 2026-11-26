/** 路由级加载函数表与预取（悬停/聚焦/空闲）。 */
import { prefetchAllowed, type NetworkHint } from '@/components/presentation/prefetch';

export const routeLoaders = {
  home: () => import('@/pages/HomePage'),
  canvas: () => import('@/pages/CanvasPage'),
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
  if (clean === '/space') return 'space';
  if (clean === '/settings/profile') return 'settings';
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

/** 首屏稳定后预取最常用的入口；省流量或 2G 时不做。 */
export function prefetchCommonRoutes(): void {
  if (!prefetchAllowed(networkHint())) return;
  const run = (): void => {
    // 预取定象坊大厅，提升进入速度。
    prefetchRoute('workshop');
  };
  const schedule = (): void => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 3000 });
      return;
    }
    window.setTimeout(run, 1200);
  };
  // 必须等 load 之后：过早执行路由 chunk 会让首屏布局测量晚于样式注入，造成 CLS。
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
}

export function viewTransitionsAllowed(): boolean {
  if (typeof document === 'undefined') return false;
  const view = document as Document & { startViewTransition?: unknown };
  if (typeof view.startViewTransition !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

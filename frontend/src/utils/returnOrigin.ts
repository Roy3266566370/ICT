/**
 * returnOrigin.ts —— 智能记忆返回导航工具
 *
 * 自动记录用户进入画布（/canvas）前最后访问的站内页面（含查询参数与滚动恢复意图），
 * 持久化至 sessionStorage，确保在画布内刷新页面、新建空白画布或保存切换 ?work= URL 后
 * 依然能准确记住“从哪里来，回哪里去”。
 */

export interface ReturnOrigin {
  from: string;
  fromLabel: string;
  restoreScroll?: boolean;
}

const STORAGE_KEY = 'wanxiang.canvas.returnOrigin.v1';

const DEFAULT_ORIGIN: ReturnOrigin = {
  from: '/workshop',
  fromLabel: '← 定象坊目录',
};

/** 不应作为返回目标的中间/认证/画布自身路径 */
function isIgnoredPath(pathname: string): boolean {
  return pathname === '/canvas'
    || pathname.startsWith('/canvas/')
    || pathname === '/login'
    || pathname === '/register';
}

/** 根据站内路径自动推断简洁明了的中文返回标签 */
export function inferReturnLabel(pathWithSearch: string): string {
  const pathname = pathWithSearch.split('?')[0] || '/';
  if (pathname === '/') return '← 返回首页';
  if (pathname === '/workshop' || pathname.startsWith('/workshop/')) return '← 返回定象坊目录';
  if (pathname === '/space' || pathname.startsWith('/space/')) return '← 返回个人空间';
  if (pathname === '/living' || pathname.startsWith('/living/')) return '← 返回通文册';
  if (pathname.startsWith('/work-shares/')) return '← 返回作品分享';
  if (pathname.startsWith('/materials/')) return '← 返回课件工作台';
  if (pathname.startsWith('/settings/')) return '← 返回设置';
  if (pathname.startsWith('/p/')) return '← 返回分享页';
  return '← 返回上一页';
}

/** 校验并规范化站内路径（拒绝外链或协议相对路径） */
function sanitizePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  return trimmed.slice(0, 500);
}

/** 读取持久化在 sessionStorage 中的返回来源 */
export function readStoredReturnOrigin(): ReturnOrigin | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReturnOrigin> | null;
    const from = sanitizePath(parsed?.from);
    if (!from || isIgnoredPath(from.split('?')[0] || '/')) return null;
    const fromLabel = typeof parsed?.fromLabel === 'string' && parsed.fromLabel.trim()
      ? parsed.fromLabel.trim().slice(0, 40)
      : inferReturnLabel(from);
    return {
      from,
      fromLabel,
      ...(parsed?.restoreScroll ? { restoreScroll: true } : {}),
    };
  } catch {
    return null;
  }
}

/** 写入返回来源到 sessionStorage */
export function writeStoredReturnOrigin(origin: ReturnOrigin): void {
  if (typeof sessionStorage === 'undefined') return;
  const from = sanitizePath(origin.from);
  if (!from || isIgnoredPath(from.split('?')[0] || '/')) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      from,
      fromLabel: origin.fromLabel.trim().slice(0, 40) || inferReturnLabel(from),
      ...(origin.restoreScroll ? { restoreScroll: true } : {}),
    }));
  } catch {
    /* 隐私模式或存储受限时静默降级 */
  }
}

/**
 * 在全局路由壳（RootLayout）中调用：
 * 每当用户停留在非画布、非登录页面时，自动记住该页面作为下次进入画布的返回目标。
 */
export function recordVisitedOrigin(pathname: string, search = ''): void {
  if (isIgnoredPath(pathname)) return;
  const fullPath = `${pathname}${search}`;
  const restoreScroll = pathname === '/workshop' || pathname === '/space' || pathname === '/living';
  writeStoredReturnOrigin({
    from: fullPath,
    fromLabel: inferReturnLabel(fullPath),
    ...(restoreScroll ? { restoreScroll: true } : {}),
  });
}

/**
 * 解析画布左上角返回按钮的最终去向：
 * 优先级：显式传入的 navigationState.from > sessionStorage 持久化的最近来源 > 默认定象坊目录。
 * 捕获到显式来源时同步写回 sessionStorage，确保画布内刷新或替换 URL 不丢记忆。
 */
export function resolveCanvasReturnOrigin(navigationState: unknown): ReturnOrigin {
  const nav = navigationState && typeof navigationState === 'object'
    ? navigationState as { from?: unknown; fromLabel?: unknown; restoreScroll?: unknown }
    : null;
  const explicitFrom = sanitizePath(nav?.from);
  if (explicitFrom && !isIgnoredPath(explicitFrom.split('?')[0] || '/')) {
    const resolved: ReturnOrigin = {
      from: explicitFrom,
      fromLabel: typeof nav?.fromLabel === 'string' && nav.fromLabel.trim()
        ? nav.fromLabel.trim().slice(0, 40)
        : inferReturnLabel(explicitFrom),
      ...(nav?.restoreScroll === true ? { restoreScroll: true } : {}),
    };
    writeStoredReturnOrigin(resolved);
    return resolved;
  }
  return readStoredReturnOrigin() ?? DEFAULT_ORIGIN;
}

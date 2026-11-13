import { useEffect, useState } from 'react';

/**
 * 媒体查询订阅（T4 工作台布局断点使用）。
 *
 * 为什么不由 CSS 单独完成：
 * - 工作台右栏在 <1024px 折叠为抽屉，抽屉需要 `aria-hidden` 与按钮显隐，
 *   这类无障碍语义必须由 JS 依据真实断点决定，纯 CSS 无法正确表达。
 * - 左栏在 <768px 变为顶部下拉（渲染 `<select>`），同样需要断点结果驱动。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    const handleChange = (event: MediaQueryListEvent): void => {
      setMatches(event.matches);
    };

    // 现代浏览器用 addEventListener；旧版 WebKit 只有 addListener。
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleChange);
      return () => {
        mql.removeEventListener('change', handleChange);
      };
    }
    mql.addListener(handleChange);
    return () => {
      mql.removeListener(handleChange);
    };
  }, [query]);

  return matches;
}

/** < 1024px：右栏折叠为抽屉（R10 可用性要求）。 */
export const NARROW_ASIDE_QUERY = '(max-width: 1023px)';

/** < 768px：左栏改为顶部下拉，中央内容优先。 */
export const NARROW_NAV_QUERY = '(max-width: 767px)';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * `prefers-reduced-motion` 的 JS 侧镜像（R14-AC5）。
 * 直接复用 T2 在 `@/App` 暴露的实现，避免两份真相（与 T2 签名对齐）。
 */
export { useReducedMotion } from '@/App';
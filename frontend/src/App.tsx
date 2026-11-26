/**
 * App.tsx —— 应用外壳：错误边界 + QueryClient + 动效偏好上下文 + 路由
 *
 * 边界说明（§2.1.2）：本文件**不渲染任何顶栏/导航**。全局导航由 T3 的
 * `components/home/SiteNav.tsx` 独占，避免出现两层导航。
 *
 * 这里同时是 `prefers-reduced-motion` 的 JS 侧唯一出口：CSS 侧由 tokens.css 把
 * 四个动效时长置 0，JS 侧由 `useReducedMotion()` 暴露给模板（R14-AC5）。
 */
import {
  Component,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from 'react';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes';
import { RouteSkeleton } from './components/navigation/RouteSkeleton';
import { isApiError } from './api/client';
import { isPrivateQueryKey } from './state/accountScope';
import { useAccountSessionStore } from './state/accountSession';
import { AccountSessionBootstrap } from './hooks/useAccountBootstrap';

export {useReducedMotion,readReducedMotion,REDUCED_MOTION_QUERY,MotionPreferenceProvider} from './hooks/useMotionPreference';
import {MotionPreferenceProvider} from './hooks/useMotionPreference';

interface AppErrorBoundaryState {
  hasError: boolean;
}

/**
 * 渲染错误边界。只展示可操作的中文文案，**不**展示堆栈或内部提示词（R12-AC5）。
 */
class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 仅写入开发者控制台；面向用户的界面不包含任何内部细节
    console.error('[万象] 界面渲染失败', error.message, info.componentStack ?? '');
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="app-fallback" role="alert">
          <strong>界面出现异常</strong>
          <p>可以刷新页面重试；如果问题持续存在，请回到首页重新选择材料。</p>
          <a className="app-fallback__link" href="/">
            返回首页
          </a>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * 私有查询 401 的唯一收口（R4-AC8 / §2.2 C-SESSION@1 `App.tsx` 变更点）。
 *
 * 只对「私有 queryKey **且** 错误码为 AUTH_REQUIRED」生效：其它错误（含访客会话的
 * SESSION_EXPIRED、版本冲突、校验失败）一律原样交给页面，绝不在这里吞掉。
 * 这里不清理缓存——`AccountSessionBootstrap` 的 scope 监听会在状态变为 guest 后清理。
 */
const queryCache = new QueryCache({
  onError: (error, query) => {
    if (isPrivateQueryKey(query.queryKey) && isApiError(error, 'AUTH_REQUIRED')) {
      useAccountSessionStore.getState().markGuest();
    }
  },
});

/** 全局 QueryClient：失败只重试 1 次，避免 Mock 环境下放大错误。 */
const queryClient = new QueryClient({
  queryCache,
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

export default function App(): ReactElement {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/* 账号恢复必须在 Provider 内、路由之前：所有页面共享同一份账号状态 */}
        <AccountSessionBootstrap />
        <MotionPreferenceProvider>
          <RouterProvider
            router={router}
            future={{ v7_startTransition: true }}
            fallbackElement={<RouteSkeleton variant="page" />}
          />
        </MotionPreferenceProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

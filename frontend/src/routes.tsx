/**
 * routes.tsx —— 路由表（懒加载 + 骨架占位）
 *
 * 路由约定（§3.1 T3/T4）：
 *  - `/`             首页（T3）
 *  - `/examples`     场景示例大厅（T3）
 *  - `/space`        个人空间（T3）
 *  - `/materials/:materialId/prepare`  准备页（T4）
 *  - `/materials/:materialId/work?view=source|interactive|runs`  工作台（T4）
 *
 * 加载函数集中在 `components/navigation/routePrefetch.ts`，
 * 导航悬停/聚焦时复用它预取，避免重复打包与重复下载。
 */
import { lazy, Suspense, type ReactElement } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation, type RouteObject } from 'react-router-dom';
import { RouteSkeleton } from './components/navigation/RouteSkeleton';
import { routeLoaders } from './components/navigation/routePrefetch';

const HomePage = lazy(routeLoaders.home);
const CanvasPage = lazy(routeLoaders.canvas);
const ExamplesPage = lazy(routeLoaders.examples);
const ExampleDemoPage = lazy(routeLoaders.exampleDemo);
const SpacePage = lazy(routeLoaders.space);
const SettingsProfilePage = lazy(routeLoaders.settings);
const SharePage = lazy(routeLoaders.share);
const LabPage = lazy(routeLoaders.labs);
const LabWorkbenchPage = lazy(routeLoaders.labWorkbench);
const LabSharePage = lazy(routeLoaders.labShare);
const LivingPagesPage = lazy(routeLoaders.living);
const LivingPageEditor = lazy(routeLoaders.livingEditor);
const LivingPageShare = lazy(routeLoaders.livingShare);
const WorkshopPage = lazy(routeLoaders.workshop);
const WorkSharePage = lazy(routeLoaders.workShare);
const LoginPage = lazy(routeLoaders.login);
const RegisterPage = lazy(routeLoaders.register);
const TrustDemoPage = lazy(routeLoaders.trustDemo);

/** 路由级加载占位：阅读器与通用页两种骨架，尺寸贴近真实布局。 */
function PageFallback(): ReactElement {
  const location = useLocation();
  const reader = /\/materials\/[^/]+\/(work|edit)$/.test(location.pathname) ||
    /\/labs\/[^/]+$/.test(location.pathname);
  return <RouteSkeleton variant={reader ? 'reader' : 'page'} />;
}

/** 应用骨架：只提供跳转链接与 Outlet，全局导航由 T3 的 SiteNav 负责。 */
function RootLayout(): ReactElement {
  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <Suspense fallback={<PageFallback />}>
        <div id="main-content" className="page-shell">
          <Outlet />
        </div>
      </Suspense>
    </>
  );
}

function NotFoundPage(): ReactElement {
  return (
    <div className="page-container not-found" role="alert">
      <h1>页面不存在</h1>
      <p>这个地址没有对应的页面。可以回到首页重新开始。</p>
      <a className="not-found__link" href="./">
        返回首页
      </a>
    </div>
  );
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'canvas', element: <CanvasPage /> },
      { path: 'examples', element: <ExamplesPage /> },
      { path: 'examples/:materialId', element: <ExampleDemoPage /> },
      { path: 'space', element: <SpacePage /> },
      { path: 'settings/profile', element: <SettingsProfilePage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'trust-demo', element: <TrustDemoPage /> },
      { path: 'labs', element: <LabPage /> },
      { path: 'labs/:labId', element: <LabWorkbenchPage /> },
      { path: 'lab-share/:shareId', element: <LabSharePage /> },
      { path: 'living', element: <LivingPagesPage /> },
      { path: 'living/:pageId', element: <LivingPageEditor /> },
      { path: 'page-shares/:shareId', element: <LivingPageShare /> },
      { path: 'workshop', element: <WorkshopPage /> },
      { path: 'work-shares/:shareId', element: <WorkSharePage /> },
      { path: 'materials/:materialId/prepare', element: <Navigate to="/living" replace /> },
      { path: 'materials/:materialId/work', element: <Navigate to="/living" replace /> },
      { path: 'materials/:materialId/edit', element: <Navigate to="/living" replace /> },
      { path: 'materials/:materialId/ai', element: <Navigate to="/living" replace /> },
      { path: 'p/:shareId', element: <SharePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);

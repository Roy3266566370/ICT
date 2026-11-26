/**
 * routes.tsx —— 路由表（懒加载 + 骨架占位）
 */
import { lazy, Suspense, type ReactElement } from 'react';
import { createBrowserRouter, Link, Navigate, Outlet, ScrollRestoration, useLocation, useParams, type RouteObject } from 'react-router-dom';
import { SiteNav } from './components/home/SiteNav';
import { RouteSkeleton } from './components/navigation/RouteSkeleton';
import { routeLoaders } from './components/navigation/routePrefetch';

const HomePage = lazy(routeLoaders.home);
const CanvasPage = lazy(routeLoaders.canvas);
const SpacePage = lazy(routeLoaders.space);
const SettingsProfilePage = lazy(routeLoaders.settings);
const SharePage = lazy(routeLoaders.share);
const MaterialDeckPage = lazy(routeLoaders.workbench);
const LivingPagesPage = lazy(routeLoaders.living);
const WorkshopPage = lazy(routeLoaders.workshop);
const WorkSharePage = lazy(routeLoaders.workShare);
const LoginPage = lazy(routeLoaders.login);
const RegisterPage = lazy(routeLoaders.register);

/** 路由级加载占位：阅读器与通用页两种骨架，尺寸贴近真实布局。 */
function PageFallback(): ReactElement {
  const location = useLocation();
  const reader = /\/materials\/[^/]+\/(work|edit)$/.test(location.pathname);
  return <RouteSkeleton variant={reader ? 'reader' : 'page'} />;
}

function RouteErrorPage(): ReactElement {
  return (
    <div className="page-container not-found" role="alert">
      <h1>页面加载异常</h1>
      <p>资源可能刚更新或网络波动，刷新页面即可恢复。</p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 12 }}>
        <button type="button" onClick={() => window.location.reload()}>
          刷新页面
        </button>
        <a className="not-found__link" href="/living">
          返回通文册
        </a>
      </div>
    </div>
  );
}

/** 应用骨架：只提供跳转链接与 Outlet，全局导航由 SiteNav 负责。 */
function RootLayout(): ReactElement {
  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div id="main-content" className="page-shell">
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </div>
      <ScrollRestoration />
    </>
  );
}

function NotFoundPage(): ReactElement {
  return (
    <>
      <SiteNav current={null} />
      <main className="page-container not-found" aria-labelledby="not-found-title">
        <h1 id="not-found-title">页面不存在</h1>
        <p>这个地址没有对应的页面。可以回到首页重新开始。</p>
        <Link className="not-found__link" to="/">返回首页</Link>
      </main>
    </>
  );
}

function LegacyEditRedirect(): ReactElement {
  const {materialId = ''} = useParams();
  const search = new URLSearchParams(useLocation().search);
  search.set('mode', 'edit');
  return <Navigate to={`/materials/${encodeURIComponent(materialId)}/work?${search}`} replace />;
}

function LegacyPrepareRedirect(): ReactElement {
  const {materialId = ''} = useParams();
  return <Navigate to={`/materials/${encodeURIComponent(materialId)}/work`} replace />;
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'canvas', element: <CanvasPage /> },
      { path: 'examples', element: <Navigate to="/workshop" replace /> },
      { path: 'examples/*', element: <Navigate to="/workshop" replace /> },
      { path: 'space', element: <SpacePage /> },
      { path: 'settings/profile', element: <SettingsProfilePage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'labs', element: <Navigate to="/workshop" replace /> },
      { path: 'labs/*', element: <Navigate to="/workshop" replace /> },
      { path: 'lab-share/*', element: <Navigate to="/workshop" replace /> },
      { path: 'living', element: <LivingPagesPage /> },
      { path: 'workshop', element: <WorkshopPage /> },
      { path: 'work-shares/:shareId', element: <WorkSharePage /> },
      { path: 'materials/:materialId/prepare', element: <LegacyPrepareRedirect /> },
      { path: 'materials/:materialId/work', element: <MaterialDeckPage /> },
      { path: 'materials/:materialId/edit', element: <LegacyEditRedirect /> },
      { path: 'p/:shareId', element: <SharePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);

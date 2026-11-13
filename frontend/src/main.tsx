/**
 * main.tsx —— 应用入口
 *
 * 只做三件事：加载全局样式与 KaTeX 样式、挂载 React 根、渲染 App。
 * 业务初始化（会话、QueryClient、动效偏好）全部在 App.tsx 内完成。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './styles/global.css';
import App from './App';

const container = document.getElementById('root');
if (container === null) {
  // 缺根节点说明 index.html 被替换过，直接给出可定位的错误而不是空白页
  throw new Error('找不到 #root 挂载点，请检查 index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
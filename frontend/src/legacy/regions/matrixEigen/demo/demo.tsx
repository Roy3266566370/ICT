/**
 * matrixEigen/demo/demo.tsx —— S6 / S9 最小演示页（用于 `chrome --headless --screenshot`）。
 *
 * 启动（`frontend/` 下）：
 *   npx vite --port 5199 --strictPort
 *   chrome --headless=new --hide-scrollbars --window-size=1000,1260 \
 *     --virtual-time-budget=4000 --screenshot=src/regions/matrixEigen/demo/s06_s09_live.png \
 *     http://127.0.0.1:5199/src/regions/matrixEigen/demo/index.html
 *
 * 说明：本文件只做演示宿主（受控参数 + 16:9 容器），渲染逻辑全部来自真实 region 组件。
 */
import { useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { PageRegion } from '@/regions/types';
import MatrixEigenRegion from '../index';
import MatrixColumnsRegion from '../../matrixColumns';
import './demo.css';

const S6_REGION: PageRegion = {
  region_id: 'rgn_s06_vectors',
  material_id: 'mat_matrix_courseware',
  page: 6,
  bbox: { x: 0.58, y: 1.27, w: 6.67, h: 4.69 },
  coordinate_system: { view_box: [1920, 1350], origin: [640, 770], unit: 150, y_axis: 'up' },
  script_id: 'matrix_eigen_2d',
  status: 'confirmed',
  original_params: { a11: 2, a12: 1, a21: 1, a22: 2, vectors: [[1, 0], [1, 1], [1, -1]] },
  linked_texts: [
    { element_id: 'p06_e03', bbox: { x: 7.67, y: 2.9, w: 1.75, h: 0.26 }, template: '({x0}, {y0}) → ({x1}, {y1})', kind: 'result' },
    { element_id: 'p06_e04', bbox: { x: 7.67, y: 3.94, w: 1.75, h: 0.26 }, template: '({x0}, {y0}) → ({x1}, {y1})', kind: 'result' },
    { element_id: 'p06_e05', bbox: { x: 7.67, y: 4.98, w: 1.75, h: 0.26 }, template: '({x0}, {y0}) → ({x1}, {y1})', kind: 'result' },
  ],
  assets: { page_image: 'pages/s06.png', erased_image: 'pages/s06_erased.png' },
  notes: 'demo',
};

const S9_REGION: PageRegion = {
  region_id: 'rgn_s09_columns',
  material_id: 'mat_matrix_courseware',
  page: 9,
  bbox: { x: 0.58, y: 1.27, w: 6.67, h: 4.69 },
  coordinate_system: { view_box: [1920, 1350], origin: [640, 770], unit: 150, y_axis: 'up' },
  script_id: 'matrix_columns_2d',
  status: 'confirmed',
  original_params: { a11: 2, a12: 1, a21: 1, a22: 2, v1: 1, v2: 1 },
  linked_texts: [],
  assets: { page_image: 'pages/s09.png', erased_image: 'pages/s09_erased.png' },
  notes: 'demo',
};

function S6Demo(): ReactElement {
  const [params, setParams] = useState<Record<string, unknown>>({ ...S6_REGION.original_params });
  return (
    <section className="demo-block">
      <h2 className="demo-title">S6 · 矩阵作用在三条向量上（默认参数，完成态）</h2>
      <div className="stage">
        <MatrixEigenRegion
          region={S6_REGION}
          params={params}
          onChange={(patch) => setParams((previous) => ({ ...previous, ...patch }))}
          stage={2}
          reducedMotion={false}
          onLinkedTexts={() => undefined}
        />
      </div>
    </section>
  );
}

function S9Demo(): ReactElement {
  const [params, setParams] = useState<Record<string, unknown>>({ ...S9_REGION.original_params });
  return (
    <section className="demo-block">
      <h2 className="demo-title">S9 · 矩阵各列与基向量（v₁·col₁ + v₂·col₂）</h2>
      <div className="stage">
        <MatrixColumnsRegion
          region={S9_REGION}
          params={params}
          onChange={(patch) => setParams((previous) => ({ ...previous, ...patch }))}
          stage={2}
          reducedMotion={false}
          onLinkedTexts={() => undefined}
        />
      </div>
    </section>
  );
}

function Demo(): ReactElement {
  // `?only=s6|s9` 便于对单个区域做像素统计（橙色像素验收）
  const only =
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('only');
  return (
    <main className="demo-root">
      <h1 className="demo-heading">
        {only === null
          ? '万象 · 原位动态图示演示（S6 / S9）'
          : `万象 · ${only === 's6' ? 'S6' : 'S9'} 像素验收`}
      </h1>
      {only === 's9' ? null : <S6Demo />}
      {only === 's6' ? null : <S9Demo />}
    </main>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(<Demo />);
}
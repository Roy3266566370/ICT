/**
 * S18 激活态最小演示页（自检/截图用，不参与生产构建）。
 *
 * 访问（dev server）：/src/regions/detArea/selftest/index.html
 *
 * 还原宿主行为（spec §5）：
 *  - 底图用 `s18_erased.png`（四格原图已擦除）；
 *  - 动态层按 region.bbox 的百分比定位，内部坐标只由 viewBox 决定；
 *  - 默认 stage=2（完成态，即原页四格标注的 1/6/1/0）。
 */
import { createRoot } from 'react-dom/client';
import { useState, type ReactElement } from 'react';
import DetArea2D from '../DetArea2D';
import { DEFAULT_PARAMS } from '../model';
import type { PageRegion } from '@/regions/types';
import './demo.css';

const PAGE_WIDTH_INCHES = 13.3333;
const PAGE_HEIGHT_INCHES = 7.5;

const DEMO_REGION: PageRegion = {
  region_id: 'rgn_s18_det_area',
  material_id: 'mat_matrix_courseware',
  page: 18,
  bbox: { x: 0.79, y: 1.38, w: 6.42, h: 4.62 },
  coordinate_system: { view_box: [924, 666], origin: [0, 0], unit: 1, y_axis: 'up' },
  script_id: 'det_area_2d',
  status: 'confirmed',
  original_params: { ...DEFAULT_PARAMS },
  linked_texts: [],
  assets: { page_image: 'pages/s18.png', erased_image: 'pages/s18_erased.png' },
  notes: 'S18 演示区域',
};

function bboxStyle(): { left: string; top: string; width: string; height: string } {
  return {
    left: `${(DEMO_REGION.bbox.x / PAGE_WIDTH_INCHES) * 100}%`,
    top: `${(DEMO_REGION.bbox.y / PAGE_HEIGHT_INCHES) * 100}%`,
    width: `${(DEMO_REGION.bbox.w / PAGE_WIDTH_INCHES) * 100}%`,
    height: `${(DEMO_REGION.bbox.h / PAGE_HEIGHT_INCHES) * 100}%`,
  };
}

function Demo(): ReactElement {
  const [params, setParams] = useState<Record<string, unknown>>({ ...DEFAULT_PARAMS });
  const [stage, setStage] = useState<0 | 1 | 2>(2);
  const [reducedMotion, setReducedMotion] = useState(false);

  return (
    <div className="demo">
      <header className="demo-head">
        <div>
          <h1>S18 · 行列式与面积（激活态）</h1>
          <p>
            底图 = <code>s18_erased.png</code>；动态层按 bbox 百分比定位，四格分别演示 单位 / 拉伸 / 剪切 / 压缩。
          </p>
        </div>
        <div className="demo-controls">
          <label>
            步骤
            <select value={stage} onChange={(event) => setStage(Number(event.target.value) as 0 | 1 | 2)}>
              <option value={0}>0 原像</option>
              <option value={1}>1 变化中</option>
              <option value={2}>2 完成</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={reducedMotion}
              onChange={(event) => setReducedMotion(event.target.checked)}
            />
            减少动效
          </label>
          <button type="button" onClick={() => setParams({ ...DEFAULT_PARAMS })}>
            恢复原稿
          </button>
        </div>
      </header>

      <div className="page">
        <img className="page-image" src="/fixtures/pages/s18_erased.png" alt="S18 擦除后的原页" />
        <div className="dynamic" style={bboxStyle()}>
          <DetArea2D
            region={DEMO_REGION}
            params={params}
            onChange={(patch) => setParams((previous) => ({ ...previous, ...patch }))}
            stage={stage}
            reducedMotion={reducedMotion}
            onLinkedTexts={() => undefined}
          />
        </div>
      </div>

      <pre className="demo-params">{JSON.stringify(params, null, 2)}</pre>
    </div>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(<Demo />);
}
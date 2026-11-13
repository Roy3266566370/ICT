/**
 * S9 自检：用 react-dom/server 渲染 `matrix_columns_2d` 真实 region + 默认参数并断言教学图层。
 *
 * 运行方式（仓库根）：
 *   cd frontend
 *   npx esbuild src/regions/matrixColumns/selftest/renderCheck.tsx --bundle --platform=node \
 *     --format=cjs --jsx=automatic --loader:.css=empty --outfile=.tmp/matrix-columns-check.cjs
 *   node .tmp/matrix-columns-check.cjs
 */
import { renderToStaticMarkup } from 'react-dom/server';
import MatrixColumnsRegion from '../index';
import {
  DEFAULT_MATRIX,
  DEFAULT_VECTOR,
  buildColumnsModel,
  buildLinkedTexts,
  degenerationNotice,
} from '../scene';
import type { PageRegion } from '@/regions/types';

const DEMO_REGION: PageRegion = {
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
  notes: 'selftest demo region（仅用于渲染断言，不写回后端）',
};

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
}

function render(params: Record<string, unknown>, stage: 0 | 1 | 2, reducedMotion = false): string {
  return renderToStaticMarkup(
    <MatrixColumnsRegion
      region={DEMO_REGION}
      params={params}
      onChange={() => undefined}
      stage={stage}
      reducedMotion={reducedMotion}
      onLinkedTexts={() => undefined}
    />,
  );
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/* --------------------------- 默认参数 / 完成态 --------------------------- */

const html = render(DEMO_REGION.original_params, 2);

record('渲染包含 SVG 动态层', html.includes('viewBox="0 0 1920 1350"'), 'svg');
record('基向量 e₁/e₂ 两条', count(html, 'data-role="basis-line"') === 2, `basis=${count(html, 'data-role="basis-line"')}`);
record('矩阵两列（可拖）', count(html, 'data-role="column-line"') === 2, `columns=${count(html, 'data-role="column-line"')}`);
record('列端点手柄', count(html, 'data-role="column-handle"') === 2, `handles=${count(html, 'data-role="column-handle"')}`);
record('输入向量 v', count(html, 'data-role="input-line"') === 1, 'input');
record('组合第一段 v₁·col₁', count(html, 'data-role="compose-first"') === 1, 'compose-first');
record('组合第二段 v₂·col₂', count(html, 'data-role="compose-second"') === 1, 'compose-second');
record('合向量 A·v', count(html, 'data-role="compose-sum"') === 1, 'compose-sum');
record('列标注 col₁/col₂', html.includes('col₁ (2, 1)') && html.includes('col₂ (1, 2)'), 'column labels');
record('组合公式注记', html.includes('A·v = v₁·col₁ + v₂·col₂'), 'formula');
record('非退化时无退化文案', !html.includes('rank=1') && !html.includes('该列被映成零'), 'no notice');
record('原点与刻度', html.includes('data-layer="tick-marks"') && html.includes('marker-end="url(#mc-arw-axis)"'), 'axis/ticks');

/* --------------------------- stage --------------------------- */

const stage0 = render(DEMO_REGION.original_params, 0);
record('stage 0 无组合过程', count(stage0, 'data-role="compose-first"') === 0 && count(stage0, 'data-role="compose-sum"') === 0, 'stage0');
record('stage 0 只显示原像（基 + v），两列在 stage 1 起出现', count(stage0, 'data-role="column-line"') === 0 && count(stage0, 'data-role="basis-line"') === 2 && count(stage0, 'data-role="input-line"') === 1, `columns=${count(stage0, 'data-role="column-line"')}, basis=${count(stage0, 'data-role="basis-line"')}`);

const stage1 = render(DEMO_REGION.original_params, 1);
record('stage 1 只显示第一段', count(stage1, 'data-role="compose-first"') === 1 && count(stage1, 'data-role="compose-sum"') === 0, 'stage1');
record('stage 1 显示两列与手柄', count(stage1, 'data-role="column-line"') === 2 && count(stage1, 'data-role="column-handle"') === 2, `columns=${count(stage1, 'data-role="column-line"')}`);

const reduced = render(DEMO_REGION.original_params, 0, true);
record('reducedMotion 直接到完成态', count(reduced, 'data-role="compose-sum"') === 1, 'reduced');

/* --------------------------- 退化文案 --------------------------- */

const collinear = buildColumnsModel({ a11: 1, a12: 2, a21: 1, a22: 2 }, DEFAULT_VECTOR);
record('两列共线 → rank=1 文案', degenerationNotice(collinear) === '两列共线，平面被压成一条线（rank=1）', degenerationNotice(collinear) ?? 'null');
const collinearHtml = render({ a11: 1, a12: 2, a21: 1, a22: 2, v1: 1, v2: 1 }, 2);
record('共线文案出现在 SVG/面板', collinearHtml.includes('两列共线，平面被压成一条线（rank=1）'), 'rendered');

const zeroColumn = buildColumnsModel({ a11: 2, a12: 0, a21: 1, a22: 0 }, DEFAULT_VECTOR);
record('零列 → “该列被映成零”', (degenerationNotice(zeroColumn) ?? '').includes('该列被映成零'), degenerationNotice(zeroColumn) ?? 'null');
const zeroHtml = render({ a11: 2, a12: 0, a21: 1, a22: 0, v1: 1, v2: 1 }, 2);
record('零列文案出现在 SVG/面板', zeroHtml.includes('该列被映成零'), 'rendered');

record('退化时 rank=0（两列都为零）', buildColumnsModel({ a11: 0, a12: 0, a21: 0, a22: 0 }, DEFAULT_VECTOR).rank === 0, 'rank0');

/* --------------------------- 拖动反推矩阵列 --------------------------- */

const dragged = buildColumnsModel({ a11: 1.5, a12: -1, a21: 2, a22: 0.5 }, [1, 1]);
record('col₁ = (a11, a21)', dragged.col1[0] === 1.5 && dragged.col1[1] === 2, JSON.stringify(dragged.col1));
record('col₂ = (a12, a22)', dragged.col2[0] === -1 && dragged.col2[1] === 0.5, JSON.stringify(dragged.col2));
record(
  'A·v = v₁·col₁ + v₂·col₂',
  dragged.image[0] === 0.5 && dragged.image[1] === 2.5,
  JSON.stringify(dragged.image),
);

/* --------------------------- 文字同步 --------------------------- */

const linked = buildLinkedTexts([], buildColumnsModel(DEFAULT_MATRIX, DEFAULT_VECTOR), {
  matrix: DEFAULT_MATRIX,
  vector: DEFAULT_VECTOR,
});
record('空 linked_texts 时不产生文本', linked.length === 0, `len=${linked.length}`);

const regionLinked = [
  { element_id: 's09_e1', bbox: { x: 0, y: 0, w: 0, h: 0 }, template: '({x0}, {y0}) → ({x1}, {y1})', kind: 'result' as const },
  { element_id: 's09_e2', bbox: { x: 0, y: 0, w: 0, h: 0 }, template: '({x0}, {y0}) → ({x1}, {y1})', kind: 'result' as const },
  { element_id: 's09_v', bbox: { x: 0, y: 0, w: 0, h: 0 }, template: '({x0}, {y0}) → ({x1}, {y1})', kind: 'result' as const },
];
const originalLinked = buildLinkedTexts(regionLinked, buildColumnsModel(DEFAULT_MATRIX, DEFAULT_VECTOR), {
  matrix: DEFAULT_MATRIX,
  vector: DEFAULT_VECTOR,
});
record(
  '三行文字：e₁→col₁ / e₂→col₂ / v→A·v',
  originalLinked[0]?.text === '(1, 0) → (2, 1)' &&
    originalLinked[1]?.text === '(0, 1) → (1, 2)' &&
    originalLinked[2]?.text === '(1, 1) → (3, 3)',
  originalLinked.map((item) => item.text).join(' | '),
);
record('原值下 changed=false', originalLinked.every((item) => !item.changed), 'changed');

const changedLinked = buildLinkedTexts(regionLinked, buildColumnsModel({ a11: 3, a12: 1, a21: 1, a22: 2 }, [1, 2]), {
  matrix: DEFAULT_MATRIX,
  vector: DEFAULT_VECTOR,
});
record('参数偏离后 changed=true', changedLinked.every((item) => item.changed), JSON.stringify(changedLinked.map((item) => item.changed)));

/* --------------------------- 极值参数：自适应缩放 --------------------------- */

const extremeHtml = render({ a11: 3, a12: 3, a21: 3, a22: 3, v1: 1, v2: 1 }, 2);
record('极值参数触发自动缩放提示', extremeHtml.includes('已自动缩放'), 'fit-note');
const extremeTexts = [
  ...extremeHtml.matchAll(/<text[^>]*?\sx="(-?[\d.]+)"[^>]*?\sy="(-?[\d.]+)"/g),
];
const extremeOut = extremeTexts.filter(
  (match) =>
    Number(match[1]) < 0 ||
    Number(match[1]) > 1920 ||
    Number(match[2]) < 0 ||
    Number(match[2]) > 1350,
);
record(
  '极值参数标注不出界',
  extremeTexts.length > 0 && extremeOut.length === 0,
  `texts=${extremeTexts.length}, out=${extremeOut.length}`,
);
/* --------------------------- 输出 --------------------------- */

let failed = 0;
for (const check of checks) {
  if (!check.ok) failed += 1;
  console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}  [${check.detail}]`);
}
console.log(`\nS9 renderCheck: ${checks.length - failed}/${checks.length} PASS`);
if (failed > 0) {
  // 本工程 tsconfig 只引入 vite/client 类型，这里用 globalThis 取 process，避免依赖 @types/node
  const nodeProcess = (globalThis as { process?: { exitCode?: number } }).process;
  if (nodeProcess !== undefined) nodeProcess.exitCode = 1;
}
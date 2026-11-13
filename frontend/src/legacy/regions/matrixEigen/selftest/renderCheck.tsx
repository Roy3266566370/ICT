/**
 * S6 自检：用 react-dom/server 渲染 `matrix_eigen_2d` 真实 region + 默认参数并断言教学图层。
 *
 * 运行方式（仓库根）：
 *   cd frontend
 *   npx esbuild src/regions/matrixEigen/selftest/renderCheck.tsx --bundle --platform=node \
 *     --format=cjs --jsx=automatic --loader:.css=empty --outfile=.tmp/matrix-eigen-check.cjs
 *   node .tmp/matrix-eigen-check.cjs
 *
 * 断言口径（与 §7.1 合并规则一致）：默认参数下 `(1, -1)` 是特征值 1 的特征向量，
 * 原像与像完全重合，**只画一条线**，因此"三条原向量"= 2 条虚线 + 1 条合并线。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import MatrixEigenRegion from '../index';
import {
  DEFAULT_MATRIX,
  DEFAULT_VECTORS,
  buildLinkedTexts,
  readMatrix,
  readVectors,
  type Vec2,
} from '../scene';
import type { PageRegion } from '@/regions/types';

const DEMO_REGION: PageRegion = {
  region_id: 'rgn_s06_vectors',
  material_id: 'mat_matrix_courseware',
  page: 6,
  bbox: { x: 0.58, y: 1.27, w: 6.67, h: 4.69 },
  coordinate_system: { view_box: [1920, 1350], origin: [640, 770], unit: 150, y_axis: 'up' },
  script_id: 'matrix_eigen_2d',
  status: 'confirmed',
  original_params: {
    a11: 2,
    a12: 1,
    a21: 1,
    a22: 2,
    vectors: [
      [1, 0],
      [1, 1],
      [1, -1],
    ],
  },
  linked_texts: [
    { element_id: 'p06_e03', bbox: { x: 7.67, y: 2.9, w: 1.75, h: 0.26 }, template: '({x0}, {y0}) → ({x1}, {y1})', kind: 'result' },
    { element_id: 'p06_e04', bbox: { x: 7.67, y: 3.94, w: 1.75, h: 0.26 }, template: '({x0}, {y0}) → ({x1}, {y1})', kind: 'result' },
    { element_id: 'p06_e05', bbox: { x: 7.67, y: 4.98, w: 1.75, h: 0.26 }, template: '({x0}, {y0}) → ({x1}, {y1})', kind: 'result' },
  ],
  assets: { page_image: 'pages/s06.png', erased_image: 'pages/s06_erased.png' },
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
    <MatrixEigenRegion
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
const ghostLines = count(html, 'data-role="ghost-line"');
const imageLines = count(html, 'data-role="image-line"');
const mergedLines = count(html, 'data-ghost-merged="true"');

record('渲染包含 SVG 动态层', html.includes('<svg') && html.includes('viewBox="0 0 1920 1350"'), `svg=${html.includes('<svg')}`);
record(
  '三条原向量（2 条虚线 + 1 条合并线）',
  ghostLines + mergedLines === 3,
  `ghost=${ghostLines}, merged=${mergedLines}`,
);
record('三条像向量实线', imageLines === 3, `image=${imageLines}`);
record(
  '特征向量合并规则（(1,-1) 只画一条）',
  mergedLines === 1 && ghostLines === 2,
  `merged=${mergedLines}, ghost=${ghostLines}`,
);
record('合并标注含“不动”与 ×1', html.includes('不动') && html.includes('×1'), html.includes('不动') ? 'ok' : 'missing 不动');
record('倍数标注 ×3', html.includes('×3'), html.includes('×3') ? 'ok' : 'missing ×3');
record('单位圆虚线', /r="150"[^>]*stroke-dasharray="[^"]+"/.test(html), 'unit circle');
record('原点实心点', html.includes('r="5"'), 'origin dot');
record('刻度数字', html.includes('data-layer="tick-marks"') && /<text[^>]*>3<\/text>/.test(html), 'ticks');
record('坐标轴', count(html, 'marker-end="url(#me-arw-axis)"') === 2, 'axis');

const ellipseMatch = /d="(M[\d.,LZ]+)"/.exec(html);
record(
  '椭圆 path 非空',
  ellipseMatch !== null && (ellipseMatch[1]?.length ?? 0) > 200,
  `pathLen=${ellipseMatch?.[1]?.length ?? 0}`,
);

/* --------------------------- 标注不出界 --------------------------- */

const texts = [...html.matchAll(/<text[^>]*\sx="(-?[\d.]+)"[^>]*\sy="(-?[\d.]+)"/g)];
const outOfBounds = texts.filter((match) => {
  const x = Number(match[1]);
  const y = Number(match[2]);
  return !(x >= 0 && x <= 1920 && y >= 0 && y <= 1350);
});
record('所有标注都在 viewBox 内', texts.length > 0 && outOfBounds.length === 0, `texts=${texts.length}, out=${outOfBounds.length}`);

/* --------------------------- stage / reducedMotion --------------------------- */

const stage0 = render(DEMO_REGION.original_params, 0);
record('stage 0 只显示原像', count(stage0, 'data-role="image-line"') === 0 && count(stage0, 'data-role="ghost-line"') === 3, `image=${count(stage0, 'data-role="image-line"')}`);

const stage1 = render(DEMO_REGION.original_params, 1);
record('stage 1 显示变化中', count(stage1, 'data-role="image-line"') === 3, `image=${count(stage1, 'data-role="image-line"')}`);

const reduced = render(DEMO_REGION.original_params, 0, true);
record('reducedMotion 直接到完成态', count(reduced, 'data-role="image-line"') === 3, `image=${count(reduced, 'data-role="image-line"')}`);

/* --------------------------- 文字同步 --------------------------- */

const linked = buildLinkedTexts(
  DEMO_REGION.linked_texts,
  DEMO_REGION.original_params['vectors'] as Vec2[],
  DEFAULT_MATRIX,
  { matrix: DEFAULT_MATRIX, vectors: DEFAULT_VECTORS },
);
record('原值下 changed=false', linked.every((item) => !item.changed), JSON.stringify(linked.map((item) => item.changed)));
record(
  '三行文字格式正确',
  linked[0]?.text === '(1, 0) → (2, 1)' && linked[1]?.text === '(1, 1) → (3, 3)' && linked[2]?.text === '(1, -1) → (1, -1)',
  linked.map((item) => item.text).join(' | '),
);

const changedMatrix = { a11: 3, a12: 1, a21: 1, a22: 2 };
const changedLinked = buildLinkedTexts(
  DEMO_REGION.linked_texts,
  DEMO_REGION.original_params['vectors'] as Vec2[],
  changedMatrix,
  { matrix: DEFAULT_MATRIX, vectors: DEFAULT_VECTORS },
);
record('参数偏离后 changed=true', changedLinked.every((item) => item.changed), JSON.stringify(changedLinked.map((item) => item.changed)));
record('参数偏离后文字更新', changedLinked[0]?.text === '(1, 0) → (3, 1)', changedLinked[0]?.text ?? '');

/* --------------------------- 极值参数：自适应缩放 --------------------------- */

const extremeHtml = render({ a11: 3, a12: 3, a21: 3, a22: 3, vectors: [[1, 0], [1, 1], [1, -1]] }, 2);
record('极值参数触发自动缩放提示', extremeHtml.includes('已自动缩放'), 'fit-note');
/** 取最长的 `d`（椭圆 path），避开 defs 里 marker 的短 path。 */
const extremePath =
  [...extremeHtml.matchAll(/d="(M[^"]+)"/g)]
    .map((match) => match[1] ?? '')
    .find((path) => path.length > 500) ?? null;
const extremeCoords =
  extremePath === null
    ? []
    : [...extremePath.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [
        Number(m[1]),
        Number(m[2]),
      ]);
const extremeOut = extremeCoords.filter((pair) => {
  const x = pair[0] ?? 0;
  const y = pair[1] ?? 0;
  return x < 0 || x > 1920 || y < 0 || y > 1350;
});
record('极值参数椭圆仍在 viewBox 内', extremeCoords.length > 0 && extremeOut.length === 0, `pts=${extremeCoords.length}, out=${extremeOut.length}`);

/* --------------------------- 参数读取 --------------------------- */

record('读取默认矩阵', JSON.stringify(readMatrix(DEMO_REGION.original_params, DEFAULT_MATRIX)) === JSON.stringify(DEFAULT_MATRIX), 'matrix');
record('读取默认向量', JSON.stringify(readVectors(DEMO_REGION.original_params, DEFAULT_VECTORS)) === JSON.stringify(DEFAULT_VECTORS), 'vectors');

/* --------------------------- 输出 --------------------------- */

let failed = 0;
for (const check of checks) {
  if (!check.ok) failed += 1;
  console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}  [${check.detail}]`);
}
console.log(`\nS6 renderCheck: ${checks.length - failed}/${checks.length} PASS`);
if (failed > 0) {
  // 本工程 tsconfig 只引入 vite/client 类型，这里用 globalThis 取 process，避免依赖 @types/node
  const nodeProcess = (globalThis as { process?: { exitCode?: number } }).process;
  if (nodeProcess !== undefined) nodeProcess.exitCode = 1;
}
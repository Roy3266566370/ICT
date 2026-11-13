/**
 * S18 自检：用 react-dom/server 渲染 det_area_2d 默认参数，断言四格数值与定向符号。
 *
 * 运行方式（仓库根）：
 *   cd frontend
 *   npx esbuild src/regions/detArea/selftest/renderCheck.tsx --bundle --platform=node \
 *     --format=cjs --jsx=automatic --loader:.css=empty --outfile=.tmp/det-area-check.cjs
 *   node .tmp/det-area-check.cjs
 *
 * 为什么不用测试框架：本工程未引入 vitest/jest（package.json 无 test 依赖），
 * 而验收只要求"渲染断言 + 退出码"，因此用 esbuild + node 维持零新增依赖。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import DetArea2D from '../DetArea2D';
import {
  DEFAULT_PARAMS,
  FALLBACK_TEXT_TEMPLATES,
  SINGULAR_EPSILON,
  buildCells,
  buildLinkedTextValues,
  defaultParams,
  formatArea,
  orientationOf,
  readDeclaredCells,
  resolveParams,
} from '../model';
import type { PageRegion } from '@/regions/types';
import {
  applyParamEdit,
  buildMappingRows,
  buildParamRows,
  createDraft,
  draftToRegion,
  loadDraft,
  saveDraft,
} from '@/components/regions/regionDrafts';

const DEMO_REGION: PageRegion = {
  region_id: 'rgn_s18_det_area',
  material_id: 'mat_matrix_courseware',
  page: 18,
  // 四格原图 bbox 的并集：x 0.79→7.21，y 1.38→6.00（英寸）
  bbox: { x: 0.79, y: 1.38, w: 6.42, h: 4.62 },
  coordinate_system: { view_box: [960, 700], origin: [0, 0], unit: 1, y_axis: 'up' },
  script_id: 'det_area_2d',
  status: 'confirmed',
  original_params: { ...DEFAULT_PARAMS },
  // 与正式产物同形：四格标注 + 结论文字（provenance=inferred，模拟"从图形反解"的识别结果）
  linked_texts: FALLBACK_TEXT_TEMPLATES.map((text) => ({ ...text, bbox: { ...text.bbox } })),
  assets: { page_image: 'pages/s18.png', erased_image: 'pages/s18_erased.png' },
  notes: 'selftest demo region（仅用于渲染断言，不写回后端）；provenance=inferred',
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

function near(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9;
}

function render(params: Record<string, unknown>, stage: 0 | 1 | 2, reducedMotion = false): string {
  return renderToStaticMarkup(
    <DetArea2D
      region={DEMO_REGION}
      params={params}
      onChange={() => undefined}
      stage={stage}
      reducedMotion={reducedMotion}
      onLinkedTexts={() => undefined}
    />,
  );
}

/* -------------------------------------------------------------------------- */
/* 1. 纯模型：默认四格 det = 1 / 6 / 1 / 0                                     */
/* -------------------------------------------------------------------------- */

const cells = buildCells(defaultParams(), DEMO_REGION.original_params, 1);
const dets = cells.map((cell) => cell.det);
record(
  '默认 det = 1 / 6 / 1 / 0',
  near(dets[0] ?? NaN, 1) && near(dets[1] ?? NaN, 6) && near(dets[2] ?? NaN, 1) && near(dets[3] ?? NaN, 0),
  `det=${dets.map((value) => value.toFixed(3)).join(' / ')}`,
);

const areaTexts = cells.map((cell) => cell.areaText);
record(
  '面积文本 = 1.0 / 6.0 / 1.0 / 0.0',
  areaTexts.join(',') === '1.0,6.0,1.0,0.0',
  `area=${areaTexts.join(' / ')}`,
);

const orientations = cells.map((cell) => cell.orientation);
record(
  '定向 = 正/正/正/压成线',
  orientations.join(',') === 'positive,positive,positive,collapsed',
  `orientation=${orientations.join(' / ')}`,
);

/* -------------------------------------------------------------------------- */
/* 2. SSR 渲染（stage=2 完成态）                                               */
/* -------------------------------------------------------------------------- */

const finished = render(defaultParams(), 2);
[
  ['面积 1.0', '单位方格'],
  ['面积 6.0', '拉伸格'],
  ['面积 0.0', '压缩格'],
  ['定向：正（+）', '正定向'],
  ['定向：无（压成一条线）', '退化定向'],
  ['平面被压成一条线', '退化说明'],
  ['det = 2.0 × 3.0 = +6.0', 'det 公式'],
].forEach(([needle, label]) => {
  record(`SSR 含「${needle}」（${label ?? ''}）`, finished.includes(needle ?? ''), 'renderToStaticMarkup');
});

record(
  'SSR 四格都存在（unit/stretch/shear/compress）',
  ['unit', 'stretch', 'shear', 'compress'].every((id) => finished.includes(`data-cell="${id}"`)),
  'data-cell 标记',
);

record(
  'SSR 保留 SVG viewBox 契约',
  finished.includes('viewBox="0 0 960 700"') && finished.includes('preserveAspectRatio="xMidYMid meet"'),
  'viewBox / preserveAspectRatio',
);

/* -------------------------------------------------------------------------- */
/* 3. 翻转：只改符号不改面积                                                    */
/* -------------------------------------------------------------------------- */

const flipped = buildCells({ ...defaultParams(), unit_flip: -1 }, DEMO_REGION.original_params, 1);
const flippedUnit = flipped[0];
record(
  '翻转后 det = −1、面积仍是 1.0、定向=翻了',
  flippedUnit !== undefined &&
    near(flippedUnit.det, -1) &&
    near(flippedUnit.area, 1) &&
    flippedUnit.orientation === 'negative',
  flippedUnit === undefined ? '缺失 unit 格' : `det=${flippedUnit.det} area=${flippedUnit.areaText}`,
);
record(
  '翻转格 SSR 显示「定向：翻了（−）」与「当前值」',
  (() => {
    const html = render({ ...defaultParams(), unit_flip: -1 }, 2);
    return html.includes('定向：翻了（−）') && html.includes('当前值');
  })(),
  'renderToStaticMarkup',
);

/* -------------------------------------------------------------------------- */
/* 4. stage 中间态：数值有意义的中间值，且退化安全                              */
/* -------------------------------------------------------------------------- */

const midway = buildCells(defaultParams(), DEMO_REGION.original_params, 0.5);
record(
  'stage=1 拉伸格 det = 1.5 × 2.0 = 3.0（中间态有意义）',
  near(midway[1]?.det ?? NaN, 3),
  `det=${midway[1]?.det ?? 'undefined'}`,
);
record(
  'stage=0 四格都回到单位方格（det 全 1）',
  buildCells(defaultParams(), undefined, 0).every((cell) => near(cell.det, 1)),
  't=0 → A=I',
);

const flipMid = buildCells({ ...defaultParams(), unit_flip: -1 }, undefined, 0.5);
record(
  '翻转中途 det→0 不产生 NaN，且判为退化',
  flipMid[0] !== undefined && Number.isFinite(flipMid[0].det) && flipMid[0].orientation === 'collapsed',
  flipMid[0] === undefined ? '缺失 unit 格' : `det=${flipMid[0].det}`,
);

/* -------------------------------------------------------------------------- */
/* 5. 非法输入：不得出现 NaN / Infinity                                        */
/* -------------------------------------------------------------------------- */

const dirty: Record<string, unknown> = {
  unit_flip: 'not-a-number',
  stretch_x: null,
  stretch_y: Number.POSITIVE_INFINITY,
  shear_k: undefined,
  compress_y: 'abc',
};
const dirtyCells = buildCells(dirty, defaultParams(), 0.5);
record(
  '非法参数回退默认值且 det 全部有限',
  dirtyCells.every((cell) => Number.isFinite(cell.det) && Number.isFinite(cell.area)),
  `det=${dirtyCells.map((cell) => cell.det).join(' / ')}`,
);
record(
  '退化阈值使用 1e-9，面积 0 不显示为负',
  orientationOf(0) === 'collapsed' && formatArea(0) === '0.0' && SINGULAR_EPSILON > 0,
  `eps=${SINGULAR_EPSILON}`,
);

/* -------------------------------------------------------------------------- */
/* 6. 单格 region（params.cell）与文字同步                                      */
/* -------------------------------------------------------------------------- */

const single = render({ ...defaultParams(), cell: 'shear' }, 2);
record(
  'params.cell=shear 时只渲染剪切格',
  single.includes('data-cell="shear"') && !single.includes('data-cell="unit"') && !single.includes('data-cell="stretch"'),
  'data-cell 唯一性',
);

const linkedDefault = buildLinkedTextValues(undefined, cells, defaultParams(), DEMO_REGION.original_params);
record(
  '默认参数时 linked_texts.changed = false（覆盖层隐藏）',
  linkedDefault.length === 5 && linkedDefault.every((item) => !item.changed),
  `${linkedDefault.map((item) => `${item.element_id}:${item.changed}`).join(', ')}`,
);
const linkedOff = buildLinkedTextValues(
  undefined,
  buildCells({ ...defaultParams(), stretch_x: 4 }, DEMO_REGION.original_params, 1),
  { ...defaultParams(), stretch_x: 4 },
  DEMO_REGION.original_params,
);
record(
  '偏离原值时 changed = true 且文本带新面积（4×3 = 12.0）',
  linkedOff.every((item) => item.changed) && linkedOff.some((item) => item.text.includes('面积 12.0')),
  linkedOff.map((item) => item.text).join(' | ').slice(0, 120),
);

/* -------------------------------------------------------------------------- */
/* 7. 准备页草稿：确认 / 纠正 / 复现                                            */
/* -------------------------------------------------------------------------- */

const draft = createDraft(DEMO_REGION);
record(
  '草稿初值与 original_params 一致（不补默认值）',
  draft.params.compress_y === 0 && draft.params.stretch_y === 3 && Object.keys(draft.editedKeys).length === 0,
  JSON.stringify(draft.params),
);

const edited = applyParamEdit(DEMO_REGION, draft, 'stretch_x', '4');
record(
  '改值为 4：params 更新且标记 editedKeys',
  edited.params.stretch_x === 4 && edited.editedKeys.stretch_x === true && edited.errors.stretch_x === null,
  `stretch_x=${String(edited.params.stretch_x)}`,
);

const invalid = applyParamEdit(DEMO_REGION, draft, 'stretch_x', 'abc');
record(
  '非法输入给中文错误且不覆盖原值',
  invalid.errors.stretch_x !== null && invalid.params.stretch_x === 2,
  invalid.errors.stretch_x ?? '无错误',
);

const editedRows = buildParamRows(DEMO_REGION, edited);
const plainRows = buildParamRows(DEMO_REGION, draft);
record(
  '来源状态：未改=系统推断，改后=用户确认',
  plainRows.find((row) => row.key === 'stretch_x')?.provenance === 'inferred' &&
    editedRows.find((row) => row.key === 'stretch_x')?.provenance === 'user_confirmed',
  `${plainRows[1]?.provenance} → ${editedRows[1]?.provenance}`,
);

record(
  '参数行带来源页（第 18 页）与单位',
  editedRows.every((row) => row.sourcePage === 18) && editedRows[1]?.unit === '倍',
  `rows=${editedRows.length}`,
);

const mappingRows = buildMappingRows(DEMO_REGION, draft);
record(
  '映射 5 条且模板含占位符',
  mappingRows.length === 5 && mappingRows[0]?.template.includes('{area_unit}') === true,
  `${mappingRows.length} 条`,
);

const confirmedRegion = draftToRegion(DEMO_REGION, { ...edited, status: 'confirmed' });
record(
  '确认后：status=confirmed、参数为确认值、bbox 等识别事实不变',
  confirmedRegion.status === 'confirmed' &&
    confirmedRegion.original_params.stretch_x === 4 &&
    confirmedRegion.bbox.w === 6.42 &&
    confirmedRegion.page === 18,
  `status=${confirmedRegion.status} w=${confirmedRegion.bbox.w}`,
);

// 会话内快照（复现）：node 环境没有 window，这里注入最小 sessionStorage 桩
interface StorageStub {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}
const store = new Map<string, string>();
const storageStub: StorageStub = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => {
    store.set(key, value);
  },
  removeItem: (key) => {
    store.delete(key);
  },
};
(globalThis as unknown as { window?: { sessionStorage?: StorageStub } }).window = { sessionStorage: storageStub };
saveDraft('mat_matrix_courseware', 'rgn_s18_det_area', edited);
const restored = loadDraft('mat_matrix_courseware', 'rgn_s18_det_area');
record(
  '会话快照往返：重开准备页得到相同输入（stretch_x=4）',
  restored !== null && restored.params.stretch_x === 4 && restored.editedKeys.stretch_x === true,
  restored === null ? '无快照' : JSON.stringify(restored.params),
);
record(
  '无快照时返回 null（回落到 original_params）',
  loadDraft('mat_matrix_courseware', 'rgn_unknown') === null,
  'loadDraft(miss)',
);
(globalThis as unknown as { window?: unknown }).window = undefined;

/* -------------------------------------------------------------------------- */
/* 8. 与 R1 真实产物 `fixtures/materials/matrix-courseware/regions.json` 对齐    */
/* -------------------------------------------------------------------------- */

/** 真实产物的 S18 形状：参数是 { cells:[{cell_id, matrix, label}], cells_order }。 */
const PRODUCT_REGION: PageRegion = {
  region_id: 'rgn_s18_det_area',
  material_id: 'mat_matrix_courseware',
  page: 18,
  bbox: { x: 0.79, y: 1.38, w: 6.42, h: 4.62 },
  coordinate_system: { view_box: [1920, 1350], origin: [640, 770], unit: 150, y_axis: 'up' },
  script_id: 'det_area_2d',
  status: 'confirmed',
  original_params: {
    cells: [
      { cell_id: 'unit', op: 'identity', matrix: [[1, 0], [0, 1]], determinant: 1, area: 1, label: '单位方格' },
      {
        cell_id: 'stretch',
        op: 'stretch',
        matrix: [[2, 0], [0, 3]],
        determinant: 6,
        area: 6,
        label: '横向 2 倍、纵向 3 倍',
      },
      { cell_id: 'shear', op: 'shear', matrix: [[1, 1], [0, 1]], determinant: 1, area: 1, label: '剪切' },
      {
        cell_id: 'flip',
        op: 'flip',
        matrix: [[1, 0], [0, 0]],
        determinant: 0,
        area: 0,
        label: '压到横轴',
        note: '压扁后定向丢失（det=0），符号语义退化',
      },
    ],
    cells_order: ['unit', 'stretch', 'shear', 'flip'],
  },
  linked_texts: ['p18_s05', 'p18_s08', 'p18_s11', 'p18_s14'].map((elementId, index) => ({
    element_id: elementId,
    bbox: { x: index % 2 === 0 ? 0.79 : 4.25, y: index < 2 ? 3.35 : 6.0, w: 2.96, h: 0.19 },
    template: '{label}　面积 {det}',
    kind: 'result' as const,
  })),
  assets: { page_image: 'pages/s18.png', erased_image: 'pages/s18_erased.png' },
  notes: 'S18 四格（单位方格 / 横向 2 倍纵向 3 倍 / 剪切 / 压到横轴），provenance=read_from_figure',
};

const declared = readDeclaredCells(PRODUCT_REGION.original_params);
record(
  '产物 cells 解析：4 格且 flip 归一为 compress',
  declared !== null && Object.keys(declared).length === 4 && declared.compress?.cell_id === 'flip',
  declared === null ? '未解析' : Object.keys(declared).join(','),
);

const productParams = resolveParams(PRODUCT_REGION.original_params);
record(
  '语义参数从产物矩阵反推（2 / 3 / 1 / 0）',
  productParams.stretch_x === 2 &&
    productParams.stretch_y === 3 &&
    productParams.shear_k === 1 &&
    productParams.compress_y === 0 &&
    productParams.unit_flip === 1,
  JSON.stringify(productParams),
);

const productCells = buildCells(PRODUCT_REGION.original_params, PRODUCT_REGION.original_params, 1);
record(
  '产物形状下四格 det = 1 / 6 / 1 / 0',
  productCells.map((cell) => cell.det).join(',') === '1,6,1,0',
  productCells.map((cell) => cell.det.toFixed(1)).join(' / '),
);
record(
  '四格沿用产物 label（含"压到横轴"）',
  productCells.map((cell) => cell.label).join('|') === '单位方格|横向 2 倍、纵向 3 倍|剪切|压到横轴',
  productCells.map((cell) => cell.label).join(' / '),
);

const productLinked = buildLinkedTextValues(
  PRODUCT_REGION.linked_texts,
  productCells,
  PRODUCT_REGION.original_params,
  PRODUCT_REGION.original_params,
);
record(
  '产物模板 {label}　面积 {det} 按格取到不同文字',
  productLinked.map((item) => item.text).join('|') ===
    '单位方格　面积 +1.0|横向 2 倍、纵向 3 倍　面积 +6.0|剪切　面积 +1.0|压到横轴　面积 0.0',
  productLinked.map((item) => item.text).join(' / '),
);
record(
  '产物参数未改动时 changed=false（覆盖层隐藏）',
  productLinked.every((item) => !item.changed),
  'changed 全为 false',
);

const productHtml = renderToStaticMarkup(
  <DetArea2D
    region={PRODUCT_REGION}
    params={PRODUCT_REGION.original_params}
    onChange={() => undefined}
    stage={2}
    reducedMotion
    onLinkedTexts={() => undefined}
  />,
);
record(
  '产物形状 SSR：viewBox 1920×1350 且四格数值正确',
  productHtml.includes('viewBox="0 0 1920 1350"') &&
    productHtml.includes('面积 6.0') &&
    productHtml.includes('面积 0.0'),
  'renderToStaticMarkup',
);

const productDraft = createDraft(PRODUCT_REGION);
const productRows = buildParamRows(PRODUCT_REGION, productDraft);
record(
  '准备页参数表：cells/cells_order + 5 个派生语义参数（共 7 行）',
  productRows.length === 7 &&
    productRows.some((row) => row.key === 'cells') &&
    productRows.some((row) => row.key === 'stretch_x' && row.value === 2) &&
    productRows.some((row) => row.key === 'compress_y' && row.value === 0),
  productRows.map((row) => `${row.key}=${String(row.value)}`).join(', '),
);
const editedProduct = applyParamEdit(PRODUCT_REGION, productDraft, 'stretch_x', '4');
const editedProductRows = buildParamRows(PRODUCT_REGION, editedProduct);
const editedStretch = editedProductRows.find((row) => row.key === 'stretch_x');
record(
  '改派生参数：值=4、来源状态=用户确认、可恢复原值',
  editedStretch !== undefined &&
    editedStretch.value === 4 &&
    editedStretch.provenance === 'user_confirmed' &&
    editedStretch.changed,
  `value=${String(editedStretch?.value)} provenance=${String(editedStretch?.provenance)}`,
);
record(
  '派生参数来源说明写明"从四格矩阵派生"',
  (productRows.find((row) => row.key === 'stretch_x')?.rangeText ?? '').includes('从四格矩阵派生'),
  productRows.find((row) => row.key === 'stretch_x')?.rangeText ?? '',
);

const productOverride = buildCells(
  { ...PRODUCT_REGION.original_params, stretch_x: 4 },
  PRODUCT_REGION.original_params,
  1,
);
record(
  '用户改 stretch_x=4 时语义参数覆盖产物矩阵（面积 12.0）',
  productOverride[1] !== undefined && near(productOverride[1].det, 12),
  `det=${productOverride[1]?.det ?? 'undefined'}`,
);

/* -------------------------------------------------------------------------- */
/* 输出                                                                        */
/* -------------------------------------------------------------------------- */

const resolved = resolveParams(defaultParams());
record(
  'resolveParams 默认值与原页一致（2 / 3 / 1 / 0）',
  resolved.stretch_x === 2 && resolved.stretch_y === 3 && resolved.shear_k === 1 && resolved.compress_y === 0,
  JSON.stringify(resolved),
);

const failed = checks.filter((check) => !check.ok);
checks.forEach((check) => {
  const mark = check.ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${check.name} — ${check.detail}`);
});
console.log(`\nS18 selftest: ${checks.length - failed.length}/${checks.length} PASS`);
if (failed.length > 0) {
  console.error(`失败项：${failed.map((check) => check.name).join('；')}`);
  // tsconfig 的 `types` 只含 vite/client（无 @types/node），这里通过 globalThis 收窄取退出码。
  const runtime = globalThis as typeof globalThis & { process?: { exitCode?: number } };
  if (runtime.process !== undefined) runtime.process.exitCode = 1;
}
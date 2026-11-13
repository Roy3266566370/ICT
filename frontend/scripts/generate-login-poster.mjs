/**
 * 生成 `/login` 右侧静态海报 `src/assets/login/login-surface-poster.svg`。
 *
 * 用法：`cd frontend && node scripts/generate-login-poster.mjs`
 * 该脚本不注册 npm script 入口（契约 `C-SURFACESCENE@1`）。
 *
 * ============================ 与 surfaceMath.ts 同步检查点 ============================
 * 本文件**故意**复刻 `src/components/auth/surfaceMath.ts` 的公式，以便在 Node
 * 侧不引入 TypeScript/JSON import attributes 的前提下生成同源海报：
 *   1. pulseStateAt(phase)      = 相位周期前 35% 内的高斯行波包络
 *   2. evaluateSurface(x, y, φ) = qX·x² + qY·y² + amp·envelope·G(x−c)·cos(fx·x + fy·y)
 *   3. pointOnSurfacePath(s, φ) = { x = xStart + xSpan·s,
 *                                    y = yAmp·sin(π·s),
 *                                    z = evaluateSurface(x, y, φ) + heightOffset }
 *   4. projectToScreen({x, y, z}) = 固定等距投影（30°），结果夹到 [-1, 1]
 * 数值唯一来源仍是 `surfaceParams.json`（脚本用 `fs.readFileSync` + `JSON.parse` 读取，
 * 与 `surfaceMath.ts` 的 `import ... with { type: 'json' }` 读的是同一份文件）。
 * 若 surfaceMath.ts 的公式或系数含义变化，必须同步修改本文件的上述函数——
 * 这是已登记偏差 D-05（`.webp` → `.svg`）的一部分。
 * =====================================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PARAMS_PATH = path.resolve(HERE, '../src/components/auth/surfaceParams.json');
const OUTPUT_PATH = path.resolve(HERE, '../src/assets/login/login-surface-poster.svg');
/** 契约上限：180 KiB。 */
const MAX_BYTES = 180 * 1024;

/**
 * 海报取行波扫过中段的相位（3s，包络约 0.90），
 * 避免静态画面停在 phase=0 的“纯二次曲面”时刻而看不到脉冲特征。
 */
const POSTER_PHASE = (Math.PI * 2 * 3) / 24;
const POSTER_ACTIVE_S = 0.15;

/** 画布尺寸：与页面 `.sceneSlot` 的 8/5 比例一致。 */
const VIEW_WIDTH = 1200;
const VIEW_HEIGHT = 750;
/** 构图：内容约占 2/3 幅面，整体偏右上，左下留出负空间。 */
const CENTER_X = 0.58;
const CENTER_Y = 0.43;
const HALF_EXTENT = 0.385;

/** 填充与等高线采样：等高线用 96×64，填充带用更粗的 36×24 以控制体积。 */
const GRID_COLUMNS = 96;
const GRID_ROWS = 64;
const FILL_COLUMNS = 36;
const FILL_ROWS = 24;
/** 等高线间距与主等高线倍数，与片元着色器的 1/7、5× 一致。 */
const CONTOUR_STEP = 1 / 7;
const MAJOR_CONTOUR_EVERY = 5;

const LOW_HEX = '#0a3340';
const MID_HEX = '#1d4f88';
const HIGH_HEX = '#8b63ff';
const CONTOUR_HEX = '#9fdcff';
const CORAL_HEX = '#ff7a59';

// ---------------------------------------------------------------- 读取参数

function readParams() {
  let raw;
  try {
    raw = fs.readFileSync(PARAMS_PATH, 'utf8');
  } catch (error) {
    throw new Error(`无法读取 surfaceParams.json：${PARAMS_PATH}（${String(error)}）`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`surfaceParams.json 不是合法 JSON（${String(error)}）`);
  }
  const numericKeys = [
    'surfacePhasePeriodSeconds',
    'quadraticXCoefficient',
    'quadraticYCoefficient',
    'waveAmplitude',
    'waveXFreq',
    'waveYFreq',
    'pathXStart',
    'pathXSpan',
    'pathYAmplitude',
    'curveHeightOffset',
    'curveSampleCount',
    'observationMindS',
    'observationMaxS',
    'pulseActiveFraction',
    'pulseSigma',
  ];
  for (const key of numericKeys) {
    if (typeof parsed[key] !== 'number' || !Number.isFinite(parsed[key])) {
      throw new Error(`surfaceParams.json 缺少有限数值字段 ${key}`);
    }
  }
  for (const key of ['xRange', 'yRange']) {
    const range = parsed[key];
    if (
      range === null ||
      typeof range !== 'object' ||
      typeof range.min !== 'number' ||
      typeof range.max !== 'number'
    ) {
      throw new Error(`surfaceParams.json 缺少 ${key}.min / ${key}.max`);
    }
  }
  return parsed;
}

const params = readParams();

// ---------------------------------------------------------------- 公式复刻（见文件头）

const ISO_COSINE = Math.cos(Math.PI / 6);
const ISO_SINE = Math.sin(Math.PI / 6);
const SCREEN_SCALE_X = 1 / 4.4;
const SCREEN_SCALE_Y = 1 / 4.6;

function clampToUnit(value) {
  return Math.min(1, Math.max(-1, value));
}

function pulseStateAt(phase) {
  const cycle = (((phase / (Math.PI * 2)) % 1) + 1) % 1;
  if (!(cycle < params.pulseActiveFraction)) {
    return {active: 0, center: params.xRange.max + params.pulseSigma, envelope: 0};
  }
  const travel = cycle / params.pulseActiveFraction;
  const center = params.xRange.min + (params.xRange.max - params.xRange.min) * travel;
  return {active: 1, center, envelope: Math.sin(Math.PI * travel)};
}

function evaluateSurface(x, y, phase) {
  const quadratic = params.quadraticXCoefficient * x * x + params.quadraticYCoefficient * y * y;
  const pulse = pulseStateAt(phase);
  if (pulse.active === 0) return quadratic;
  const sigmaSq = params.pulseSigma * params.pulseSigma;
  const gaussian = Math.exp(-((x - pulse.center) ** 2) / (2 * sigmaSq));
  const carrier = Math.cos(params.waveXFreq * x + params.waveYFreq * y);
  return quadratic + params.waveAmplitude * pulse.envelope * gaussian * carrier;
}

function surfacePoint(x, y, phase) {
  return {x, y, z: evaluateSurface(x, y, phase)};
}

function pointOnSurfacePath(s, phase) {
  const clamped = !(s > 0) ? 0 : s >= 1 ? 1 : s;
  const x = params.pathXStart + params.pathXSpan * clamped;
  const y = params.pathYAmplitude * Math.sin(Math.PI * clamped);
  return {x, y, z: evaluateSurface(x, y, phase) + params.curveHeightOffset};
}

function projectToScreen(point) {
  const planarX = (point.x - point.y) * ISO_COSINE;
  const planarY = (point.x + point.y) * ISO_SINE + point.z;
  return {
    x: clampToUnit(planarX * SCREEN_SCALE_X),
    y: clampToUnit(planarY * SCREEN_SCALE_Y),
  };
}

/** 世界点 → 画布像素（屏幕 y 轴向上，SVG y 轴向下）。 */
function toCanvas(point) {
  const projected = projectToScreen(point);
  return {
    x: (CENTER_X + HALF_EXTENT * projected.x) * VIEW_WIDTH,
    y: (CENTER_Y - HALF_EXTENT * projected.y) * VIEW_HEIGHT,
  };
}

/** 保留 1 位小数：1200×750 画布下 0.1px 足够，可显著压缩体积。 */
function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

function canvasPair(point) {
  const projected = toCanvas(point);
  return `${round(projected.x)} ${round(projected.y)}`;
}

// ---------------------------------------------------------------- 路径构造

/** 采样曲面网格：返回 (columns+1) × (rows+1) 个世界点。 */
function sampleSurface(columns, rows, phase) {
  const vertexColumns = columns + 1;
  const vertexRows = rows + 1;
  const xMin = params.xRange.min;
  const yMin = params.yRange.min;
  const xSpan = params.xRange.max - params.xRange.min;
  const ySpan = params.yRange.max - params.yRange.min;
  const points = [];
  for (let row = 0; row < vertexRows; row += 1) {
    const y = yMin + (ySpan * row) / rows;
    const line = [];
    for (let column = 0; column < vertexColumns; column += 1) {
      const x = xMin + (xSpan * column) / columns;
      line.push(surfacePoint(x, y, phase));
    }
    points.push(line);
  }
  return points;
}

/** 曲面填充：逐条横向带状多边形（避免逐格路径导致体积膨胀与重叠变深）。 */
function buildFillPath(grid) {
  const segments = [];
  for (let row = 0; row < grid.length - 1; row += 1) {
    const top = grid[row];
    const bottom = grid[row + 1];
    if (top === undefined || bottom === undefined) continue;
    const commands = [];
    commands.push(`M${canvasPair(top[0])}`);
    for (let index = 1; index < top.length; index += 1) {
      commands.push(`L${canvasPair(top[index])}`);
    }
    for (let index = bottom.length - 1; index >= 0; index -= 1) {
      commands.push(`L${canvasPair(bottom[index])}`);
    }
    commands.push('Z');
    segments.push(commands.join(''));
  }
  return segments.join('');
}

/** 曲面边界轮廓：四条边各走一遍，作为极淡的冷色包边。 */
function buildOutlinePath(grid) {
  const firstRow = grid[0];
  const lastRow = grid[grid.length - 1];
  if (firstRow === undefined || lastRow === undefined) return '';
  const outline = [];
  for (let column = 0; column < firstRow.length; column += 1) {
    const point = firstRow[column];
    if (point !== undefined) outline.push(point);
  }
  for (let row = 1; row < grid.length; row += 1) {
    const line = grid[row];
    if (line === undefined) continue;
    const point = line[line.length - 1];
    if (point !== undefined) outline.push(point);
  }
  for (let column = lastRow.length - 2; column >= 0; column -= 1) {
    const point = lastRow[column];
    if (point !== undefined) outline.push(point);
  }
  for (let row = grid.length - 2; row >= 0; row -= 1) {
    const line = grid[row];
    if (line === undefined) continue;
    const point = line[0];
    if (point !== undefined) outline.push(point);
  }
  return outline
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${canvasPair(point)}`)
    .join('') + 'Z';
}

/** 单个高度的 marching squares 线段集合。 */
function buildContourSegments(grid, level) {
  const segments = [];
  for (let row = 0; row < grid.length - 1; row += 1) {
    const top = grid[row];
    const bottom = grid[row + 1];
    if (top === undefined || bottom === undefined) continue;
    for (let column = 0; column < top.length - 1; column += 1) {
      const corners = [top[column], top[column + 1], bottom[column + 1], bottom[column]];
      if (corners.some((corner) => corner === undefined)) continue;
      const crossings = [];
      for (let edge = 0; edge < 4; edge += 1) {
        const a = corners[edge];
        const b = corners[(edge + 1) % 4];
        if (a === undefined || b === undefined) continue;
        const aboveA = a.z >= level;
        const aboveB = b.z >= level;
        if (aboveA === aboveB) continue;
        const t = (level - a.z) / (b.z - a.z);
        crossings.push({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: level});
      }
      if (crossings.length === 2) {
        segments.push([crossings[0], crossings[1]]);
      } else if (crossings.length === 4) {
        segments.push([crossings[0], crossings[1]], [crossings[2], crossings[3]]);
      }
    }
  }
  return segments;
}

/** 把线段集合拼成一个 path（每个线段独立 M…L…，避免误连）。 */
function segmentsToPath(segments) {
  const commands = [];
  for (const [start, end] of segments) {
    if (start === undefined || end === undefined) continue;
    commands.push(`M${canvasPair(start)}L${canvasPair(end)}`);
  }
  return commands.join('');
}

/** 细 / 主两组等高线：间距 1/7，每 5 条加粗一格。 */
function buildContourPaths(grid) {
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const line of grid) {
    for (const point of line) {
      if (point.z < zMin) zMin = point.z;
      if (point.z > zMax) zMax = point.z;
    }
  }
  const minor = [];
  const major = [];
  const firstLevel = Math.ceil(zMin / CONTOUR_STEP) * CONTOUR_STEP;
  let index = 0;
  for (let level = firstLevel; level <= zMax; level += CONTOUR_STEP) {
    const isMajor = index % MAJOR_CONTOUR_EVERY === 0;
    const target = isMajor ? major : minor;
    target.push(...buildContourSegments(grid, level));
    index += 1;
  }
  return {minor: segmentsToPath(minor), major: segmentsToPath(major)};
}

/** 珊瑚轨迹：129 个采样点，全部来自 pointOnSurfacePath。 */
function buildCurvePath(phase) {
  const sampleCount = params.curveSampleCount;
  const commands = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const s = index / (sampleCount - 1);
    const point = pointOnSurfacePath(s, phase);
    commands.push(`${index === 0 ? 'M' : 'L'}${canvasPair(point)}`);
  }
  return commands.join('');
}

/** 观察点：两个参照柔光 + 活动柔光与衰减光晕环。 */
function buildObservationPoints(phase) {
  const referenceS = [params.observationMindS, params.observationMaxS];
  const parts = [];
  for (const s of referenceS) {
    const projected = toCanvas(pointOnSurfacePath(s, phase));
    parts.push(
      `<circle cx="${round(projected.x)}" cy="${round(projected.y)}" r="11" fill="url(#glow)" opacity="0.72" />`,
      `<circle cx="${round(projected.x)}" cy="${round(projected.y)}" r="2.6" fill="${CORAL_HEX}" />`,
    );
  }
  const active = toCanvas(pointOnSurfacePath(POSTER_ACTIVE_S, phase));
  parts.push(
    `<circle cx="${round(active.x)}" cy="${round(active.y)}" r="34" fill="none" stroke="${CORAL_HEX}" stroke-opacity="0.32" stroke-width="1.2" />`,
    `<circle cx="${round(active.x)}" cy="${round(active.y)}" r="17" fill="url(#glow)" />`,
    `<circle cx="${round(active.x)}" cy="${round(active.y)}" r="3.4" fill="#ffe3d8" />`,
  );
  return parts.join('');
}

// ---------------------------------------------------------------- 组装 SVG

function buildSvg() {
  const surfaceGrid = sampleSurface(GRID_COLUMNS, GRID_ROWS, POSTER_PHASE);
  const fillGrid = sampleSurface(FILL_COLUMNS, FILL_ROWS, POSTER_PHASE);

  const fillPath = buildFillPath(fillGrid);
  const outlinePath = buildOutlinePath(surfaceGrid);
  const contours = buildContourPaths(surfaceGrid);
  const curvePath = buildCurvePath(POSTER_PHASE);
  const pointsMarkup = buildObservationPoints(POSTER_PHASE);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}"`,
    ` width="${VIEW_WIDTH}" height="${VIEW_HEIGHT}" role="presentation" focusable="false"`,
    ' shape-rendering="geometricPrecision">',
    ' <!-- 由 scripts/generate-login-poster.mjs 从 surfaceParams.json 生成；请勿手工编辑。 -->',
    ' <!-- 与实时场景同源：行波相位 3s、活动观察点 s=0.15、固定等距投影、右上构图。 -->',
    ' <defs>',
    '  <linearGradient id="surfaceFill" x1="0.16" y1="0.86" x2="0.8" y2="0.16">',
    `   <stop offset="0" stop-color="${LOW_HEX}" />`,
    `   <stop offset="0.55" stop-color="${MID_HEX}" />`,
    `   <stop offset="1" stop-color="${HIGH_HEX}" />`,
    '  </linearGradient>',
    '  <radialGradient id="glow">',
    '   <stop offset="0" stop-color="#ffffff" stop-opacity="1" />',
    `   <stop offset="0.22" stop-color="${CORAL_HEX}" stop-opacity="0.78" />`,
    `   <stop offset="1" stop-color="${CORAL_HEX}" stop-opacity="0" />`,
    '  </radialGradient>',
    ' </defs>',
    ' <g fill="none" stroke-linecap="round" stroke-linejoin="round">',
    `  <path d="${fillPath}" fill="url(#surfaceFill)" fill-opacity="0.94" fill-rule="nonzero" />`,
    `  <path d="${contours.minor}" stroke="${CONTOUR_HEX}" stroke-opacity="0.16" stroke-width="0.9" vector-effect="non-scaling-stroke" />`,
    `  <path d="${contours.major}" stroke="${CONTOUR_HEX}" stroke-opacity="0.34" stroke-width="1.2" vector-effect="non-scaling-stroke" />`,
    `  <path d="${outlinePath}" stroke="${CONTOUR_HEX}" stroke-opacity="0.22" stroke-width="1" vector-effect="non-scaling-stroke" />`,
    `  <path d="${curvePath}" stroke="${CORAL_HEX}" stroke-opacity="0.16" stroke-width="8.5" vector-effect="non-scaling-stroke" />`,
    `  <path d="${curvePath}" stroke="${CORAL_HEX}" stroke-width="2.6" vector-effect="non-scaling-stroke" />`,
    `  ${pointsMarkup}`,
    ' </g>',
    '</svg>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- 输出

function main() {
  const svg = buildSvg();
  const bytes = Buffer.byteLength(svg, 'utf8');
  if (bytes > MAX_BYTES) {
    throw new Error(`海报体积 ${bytes} B 超过上限 ${MAX_BYTES} B（180 KiB）`);
  }
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, svg, 'utf8');
  const unit = bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${bytes} B`;
  console.log(
    `[login-poster] wrote ${path.relative(process.cwd(), OUTPUT_PATH)} (${bytes} B = ${unit})`,
  );
  console.log(
    `[login-poster] phase=${POSTER_PHASE.toFixed(3)} activeS=${POSTER_ACTIVE_S} grid=${GRID_COLUMNS}x${GRID_ROWS} contourStep=${CONTOUR_STEP.toFixed(3)} curve=${params.curveSampleCount} points=3`,
  );
}

main();

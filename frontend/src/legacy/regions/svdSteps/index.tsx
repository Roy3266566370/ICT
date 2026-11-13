/**
 * svdSteps/index.tsx —— S14「SVD 三步」的原位动态组件（`script_id: svd_steps_2d`）。
 *
 * 施工依据：docs/rebuild-spec.md §4/§5/§7/§7.1/§9。
 *
 * 现场必须看到（§9 S14）：按 `Vᵀ → Σ → U` 三步播放，**保留标记点**——
 * 第一步圆的外观完全不变，只有标记点从 (1, 0) 移开，这就是"光画圆看不出第一步"的答案。
 *
 * 布局同时支持两种宿主切法：
 *  - 每段区域各建一个 region（S14 三段 bbox `(0.75,1.21,3.54,2.23)` 等）→ 单幅模式，按 bbox.x 判定第几幅；
 *  - 一整块宽幅 region → 三联模式，内部并排三幅、共用同一 unit。
 *
 * `stage` 0/1/2 对应三步 Vᵀ / Σ / U：已到达的阶段画实线，未到达的画虚线（"还没发生"）。
 *
 * 依赖边界：本组件只引用同目录的 `./scene`（纯计算 / 布局）。
 */
import { useEffect, useId, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';
import type { RegionRendererProps } from '@/regions/types';
import {
  DEFAULT_MARKER,
  PARAM_MAX,
  PARAM_MIN,
  PARAM_STEP,
  buildGeometries,
  buildLinkedTexts,
  buildStages,
  decompSvd,
  ellipsePath,
  fmt,
  isOffOriginal,
  isWideRegion,
  project,
  readCoordinateSystem,
  readMatrix,
  readPanelIndex,
  resolveLabelCollisions,
  fitViewBox,
  vecText,
  type LabelItem,
  type Mat2,
  type SvdGeometry,
  type SvdStageShape,
  type Vec2,
} from './scene';
import styles from './svdSteps.module.css';

const BG = '#F6F3EC';
const AXIS = '#8B9AB3';
const ORANGE = '#C4622D';
const NAVY = '#16233A';
const GHOST = '#A9B4C7';
const TICK = '#8B97AB';
const CIRCLE_STROKE = '#8494AD';

const FONT = '"Microsoft YaHei", "Segoe UI", system-ui, sans-serif';

function clampParam(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.min(PARAM_MAX, Math.max(PARAM_MIN, value));
  const snapped = Math.round(clamped / PARAM_STEP) * PARAM_STEP;
  return Math.abs(snapped) < 1e-9 ? 0 : Math.round(snapped * 10) / 10;
}

function ParamRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}): ReactElement {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.range}
        type="range"
        min={PARAM_MIN}
        max={PARAM_MAX}
        step={PARAM_STEP}
        value={value}
        aria-label={`矩阵元素 ${label}`}
        onChange={(event) => {
          onChange(clampParam(Number(event.currentTarget.value)));
        }}
      />
      <input
        className={styles.number}
        type="number"
        min={PARAM_MIN}
        max={PARAM_MAX}
        step={PARAM_STEP}
        value={value}
        aria-label={`矩阵元素 ${label}（数值）`}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next)) onChange(clampParam(next));
        }}
      />
    </div>
  );
}

export interface SlotInput {
  slot: 0 | 1 | 2;
  shape: SvdStageShape;
  geometry: SvdGeometry;
  yAxis: 'up' | 'down';
  scale: number;
  marker: Vec2;
  showDetail: boolean;
  /** 三联模式下标题分两行（每幅只有 640 逻辑宽，单行会压到相邻子图）。 */
  stacked: boolean;
}

/** 每幅子图上的文字：标题、细节、标记点坐标（统一做碰撞消解）。 */
export function slotLabels(input: SlotInput): LabelItem[] {
  const { slot, shape, geometry, yAxis, scale, marker } = input;
  const labels: LabelItem[] = [];
  const center = project(geometry, yAxis, [0, 0]);
  if (input.stacked) {
    labels.push({
      id: `slot${slot + 1}-badge`,
      text: shape.badge,
      x: geometry.cx,
      y: center.y - geometry.axisUp - 46 * scale,
      anchor: 'middle',
      fontSize: 24 * scale,
      fill: NAVY,
      weight: 700,
    });
    labels.push({
      id: `slot${slot + 1}-title`,
      text: shape.title,
      x: geometry.cx,
      y: center.y - geometry.axisUp - 8 * scale,
      anchor: 'middle',
      fontSize: 21 * scale,
      fill: NAVY,
      weight: 600,
    });
  } else {
    labels.push({
      id: `slot${slot + 1}-title`,
      text: `${shape.badge}　${shape.title}`,
      x: geometry.cx,
      y: center.y - geometry.axisUp - 56 * scale,
      anchor: 'middle',
      fontSize: 24 * scale,
      fill: NAVY,
      weight: 700,
    });
  }
  if (input.showDetail) {
    labels.push({
      id: `slot${slot + 1}-detail`,
      text: shape.detail,
      x: geometry.cx,
      y: center.y - geometry.axisUp - 24 * scale,
      anchor: 'middle',
      fontSize: 20 * scale,
      fill: TICK,
      weight: 600,
    });
  }
  const markerPoint = project(geometry, yAxis, shape.marker);
  const toRight = shape.marker[0] >= 0;
  labels.push({
    id: `slot${slot + 1}-marker-label`,
    text: vecText(shape.marker),
    x: markerPoint.x + (toRight ? 18 : -18) * scale,
    y: markerPoint.y - 16 * scale,
    anchor: toRight ? 'start' : 'end',
    fontSize: 22 * scale,
    fill: ORANGE,
    weight: 700,
  });
  // 起点说明只在第一幅给出，避免三幅重复
  if (slot === 0) {
    const start = project(geometry, yAxis, marker);
    labels.push({
      id: 'slot1-start',
      text: '起点 (1, 0)',
      x: start.x - 14 * scale,
      y: start.y + 34 * scale,
      anchor: 'end',
      fontSize: 20 * scale,
      fill: TICK,
      weight: 600,
    });
  }
  return labels;
}

export default function SvdStepsRegion({
  region,
  params,
  onChange,
  stage,
  reducedMotion,
  onLinkedTexts,
}: RegionRendererProps): ReactElement {
  const rawId = useId();
  const uid = rawId.replace(/[^A-Za-z0-9_-]/g, '') || 'svd';
  const cs = useMemo(() => readCoordinateSystem(region.coordinate_system), [region.coordinate_system]);
  const original = useMemo(() => readMatrix(region.original_params), [region.original_params]);
  const current = useMemo(() => readMatrix(params, original), [params, original]);
  const decomposition = useMemo(() => decompSvd(current), [current]);
  const stages = useMemo(() => buildStages(decomposition, DEFAULT_MARKER), [decomposition]);
  const mode: 'single' | 'triple' = isWideRegion(region.bbox) ? 'triple' : 'single';
  const panelIndex = useMemo(() => readPanelIndex(params, region.bbox), [params, region.bbox]);
  const changed = useMemo(() => isOffOriginal(current, original), [current, original]);
  const linkedTexts = useMemo(
    () => buildLinkedTexts(region.linked_texts, decomposition, changed),
    [region.linked_texts, decomposition, changed],
  );

  const linkedSignature = JSON.stringify(linkedTexts);
  const onLinkedRef = useRef(onLinkedTexts);
  onLinkedRef.current = onLinkedTexts;
  useEffect(() => {
    onLinkedRef.current(linkedTexts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在文本内容变化时回传
  }, [linkedSignature]);

  // 宽幅区域按 bbox 比例自适应 viewBox（见 scene.fitViewBox）：1920×1350 → 1920×362，
  // 否则宿主按 bbox 百分比定位 + meet 缩放后，三格会被压成正中一小条
  const [width, height] = fitViewBox(cs, region.bbox);
  /**
   * 字号缩放：区域只有 `bbox.w/h` 英寸，而内部坐标宽度固定 1920。
   * 按"1 英寸 ≈ 144 viewBox 像素"换算可见缩放比，以 S6 的 6.67×4.69in → 0.62 为基准；
   * S14 的 bbox 高仅 2.23in，必须放大字号，否则显示只有几像素。
   */
  const designRatio = Math.min(
    (region.bbox.w * 144) / width,
    (region.bbox.h * 144) / height,
  );
  const scale = Math.min(2.8, Math.max(0.75, 0.62 / Math.max(designRatio, 1e-6)));
  const [s1, s2] = decomposition.sigma;
  const maxAbs = Math.max(1, s1, s2) * 1.14;
  const geometries = useMemo(
    () => buildGeometries(mode, { ...cs, view_box: [width, height] }, maxAbs),
    [mode, cs, width, height, maxAbs],
  );

  const slots: Array<0 | 1 | 2> = mode === 'triple' ? [0, 1, 2] : [(panelIndex - 1) as 0 | 1 | 2];

  const areaProduct = s1 * s2;
  // 文本长度受单段区域宽度限制：只保留"两个奇异值 + 乘积 ≈ 面积倍率"这层结论
  const singularText = `σ₁ ${fmt(s1)} · σ₂ ${fmt(s2)} · 乘积 ${fmt(areaProduct)} ≈ 面积倍率`;

  const specs: Array<{ key: keyof Mat2; label: string }> = [
    { key: 'a11', label: 'a11' },
    { key: 'a12', label: 'a12' },
    { key: 'a21', label: 'a21' },
    { key: 'a22', label: 'a22' },
  ];

  return (
    <div className={styles.root} data-reduced-motion={reducedMotion ? 'true' : 'false'} data-mode={mode}>
      <svg
        className={styles.svg}
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="奇异值分解三步：先 Vᵀ 转置坐标系、再 Σ 沿轴伸缩、最后 U 转向输出方向；标记点在三步中连续移动"
      >
        <defs>
          <marker id={`${uid}-axis`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={AXIS} />
          </marker>
        </defs>

        <rect x={0} y={0} width={width} height={height} fill={BG} />

        {slots.map((slot) => {
          const shape = stages[slot];
          const geometry = geometries[mode === 'triple' ? slot : 0];
          if (shape === undefined || geometry === undefined) return null;
          const revealed = slot <= stage;
          const isCurrent = slot === stage;
          const origin = project(geometry, cs.y_axis, [0, 0]);
          const markerPoint = project(geometry, cs.y_axis, shape.marker);
          const startPoint = project(geometry, cs.y_axis, DEFAULT_MARKER);
          const labels = slotLabels({
            slot,
            shape,
            geometry,
            yAxis: cs.y_axis,
            scale,
            marker: DEFAULT_MARKER,
            showDetail: mode === 'single',
            stacked: mode === 'triple',
          });
          const resolved = resolveLabelCollisions(labels, [width, height]);
          return (
            <g key={`slot-${slot + 1}`} data-slot={slot + 1}>
              {/* 坐标轴 + 原点 */}
              <g stroke={AXIS} strokeWidth={1.8} fill="none">
                <line
                  x1={geometry.cx - geometry.axisHalf}
                  y1={geometry.cy}
                  x2={geometry.cx + geometry.axisHalf}
                  y2={geometry.cy}
                  markerEnd={`url(#${uid}-axis)`}
                />
                <line
                  x1={geometry.cx}
                  y1={geometry.cy + geometry.axisDown}
                  x2={geometry.cx}
                  y2={geometry.cy - geometry.axisUp}
                  markerEnd={`url(#${uid}-axis)`}
                />
              </g>
              <circle cx={origin.x} cy={origin.y} r={4} fill={NAVY} />

              {/* 阶段形态：① 单位圆（虚线）/ ②③ 椭圆 */}
              {shape.shape.circle ? (
                <circle
                  cx={origin.x}
                  cy={origin.y}
                  r={geometry.unit}
                  fill="none"
                  stroke={revealed ? CIRCLE_STROKE : GHOST}
                  strokeWidth={2.2}
                  strokeDasharray="9 7"
                  opacity={revealed ? 1 : 0.6}
                />
              ) : (
                <path
                  d={ellipsePath(geometry, cs.y_axis, shape.shape.a, shape.shape.b, shape.shape.angle)}
                  fill={ORANGE}
                  fillOpacity={revealed ? 0.055 : 0.02}
                  stroke={revealed ? ORANGE : GHOST}
                  strokeWidth={3.2}
                  strokeDasharray={revealed ? undefined : '9 8'}
                  opacity={revealed ? 1 : 0.7}
                  className={styles.fade}
                />
              )}

              {/* 标记点：起点（空心）+ 其余阶段的位置（浅色）+ 本幅的标记点（橙色） */}
              <circle cx={startPoint.x} cy={startPoint.y} r={6.5} fill={BG} stroke={GHOST} strokeWidth={2.5} />
              {stages.map((candidate) => {
                if (candidate.index === slot) return null;
                const point = project(geometry, cs.y_axis, candidate.marker);
                return (
                  <circle
                    key={`ghost-${candidate.index}`}
                    cx={point.x}
                    cy={point.y}
                    r={4.5}
                    fill={GHOST}
                    data-role="marker-ghost"
                    data-slot={slot + 1}
                  />
                );
              })}
              {isCurrent ? (
                <circle
                  cx={markerPoint.x}
                  cy={markerPoint.y}
                  r={22}
                  fill="none"
                  stroke={ORANGE}
                  strokeWidth={2}
                  opacity={0.32}
                  className={styles.pulse}
                />
              ) : null}
              <circle
                cx={markerPoint.x}
                cy={markerPoint.y}
                r={11}
                fill={revealed ? ORANGE : GHOST}
                stroke={BG}
                strokeWidth={2.5}
                data-role="marker"
                data-slot={slot + 1}
                data-position={vecText(shape.marker)}
                className={styles.fade}
              />

              {resolved.map((label) => (
                <text
                  key={label.id}
                  x={label.x}
                  y={label.y}
                  textAnchor={label.anchor}
                  fontSize={label.fontSize}
                  fontWeight={label.weight}
                  fill={label.fill}
                  fontFamily={FONT}
                  paintOrder="stroke"
                  stroke={BG}
                  strokeWidth={5}
                  strokeLinejoin="round"
                  data-role={
                    label.id.endsWith('-title')
                      ? 'stage-title'
                      : label.id.endsWith('-marker-label')
                        ? 'marker-label'
                        : undefined
                  }
                  data-slot={slot + 1}
                >
                  {label.text}
                </text>
              ))}
            </g>
          );
        })}

        {/* 奇异值与面积倍率（§9 S14：乘积 ≈ 面积倍率） */}
        <text
          x={width / 2}
          y={height - 34 * scale}
          textAnchor="middle"
          fontSize={24 * scale}
          fontWeight={700}
          fill={changed ? ORANGE : NAVY}
          fontFamily={FONT}
          paintOrder="stroke"
          stroke={BG}
          strokeWidth={5}
          strokeLinejoin="round"
          data-role="singular-values"
        >
          {singularText}
        </text>
        {decomposition.reason !== null ? (
          <text
            x={width / 2}
            y={height - 8 * scale}
            textAnchor="middle"
            fontSize={18 * scale}
            fill={TICK}
            fontFamily={FONT}
            data-role="degenerate-note"
          >
            {decomposition.reason}
          </text>
        ) : null}
      </svg>

      <details className={styles.drawer}>
        <summary className={styles.summary}>参数</summary>
        <div className={styles.panel}>
          <p className={styles.groupTitle}>矩阵 A（页内原值 [[0, 1], [1, 1]]）</p>
          {specs.map((spec) => (
            <ParamRow
              key={spec.key}
              label={spec.label}
              value={current[spec.key]}
              onChange={(next) => {
                onChange({ [spec.key]: next });
              }}
            />
          ))}
          <p className={styles.note}>
            奇异值 σ 与奇异向量按 AᵀA 的解析式实时重算（对称与非对称 2×2 都适用），
            所以改矩阵后 "1.618 与 0.618" 会跟着变。标记点始终从 (1, 0) 出发，
            依次经过 Vᵀ、Σ、U —— 第一步圆没变，只有标记点动了。
          </p>
        </div>
      </details>
    </div>
  );
}
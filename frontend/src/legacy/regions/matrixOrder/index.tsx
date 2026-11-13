/**
 * matrixOrder/index.tsx —— S10「乘法顺序」的原位动态组件（`script_id: matrix_order_2d`）。
 *
 * 施工依据：docs/rebuild-spec.md §4/§5/§7/§7.1/§9。
 *
 * 现场必须看到（§9 S10）：两条路径**并排**，各自显示「输入 → 中间态 → 结果」，
 * 并明确标注「先执行 B，再执行 A」与「先执行 A，再执行 B」，不写 `AB` / `BA` 符号了事。
 *
 * 播放：`stage` 0=只有输入、1=中间态、2=结果；`reducedMotion` 下无过渡、数值即时更新（§10）。
 * 每一步都是**真实的一次矩阵作用**（先 B 再 A / 先 A 再 B），不做系数插值近似（§9 播放语义）。
 *
 * 宿主契约（§5）：SVG `viewBox` 取 `region.coordinate_system.view_box`；
 * 默认导出组件，参数写回一律走 `onChange`，原位文字一律走 `onLinkedTexts`。
 */
import { useEffect, useId, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';
import type { RegionRendererProps } from '@/regions/types';
import {
  PARAM_MAX,
  PARAM_MIN,
  PARAM_STEP,
  buildGeometry,
  buildLinkedTexts,
  computePaths,
  fmt,
  isOffOriginal,
  matText,
  project,
  readCoordinateSystem,
  readParams,
  resolveLabelCollisions,
  resultsAgree,
  vecText,
  type LabelItem,
  type Mat2,
  type PanelGeometry,
  type PathView,
} from './scene';
import styles from './matrixOrder.module.css';

/** 视觉规范（spec §7）：背景 / 轴 / 橙 / 藏青 / 原像虚浅。 */
const BG = '#F6F3EC';
const AXIS = '#8B9AB3';
const ORANGE = '#C4622D';
const NAVY = '#16233A';
const GHOST = '#A9B4C7';
const TICK = '#8B97AB';

const FONT = '"Microsoft YaHei", "Segoe UI", system-ui, sans-serif';

/** 把任意输入夹到合法参数网格（-3..3，步长 0.1），并把 -0 归一为 0。 */
function clampParam(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.min(PARAM_MAX, Math.max(PARAM_MIN, value));
  const snapped = Math.round(clamped / PARAM_STEP) * PARAM_STEP;
  return Math.abs(snapped) < 1e-9 ? 0 : Math.round(snapped * 10) / 10;
}

/** 参数滑块的标签与写回键：A、B 用扁平字段，输入向量用 `x`。 */
interface ParamSpec {
  key: string;
  label: string;
  value: number;
  group: 'A' | 'B' | 'x';
}

function paramSpecs(matrixA: Mat2, matrixB: Mat2, vector: readonly [number, number]): ParamSpec[] {
  return [
    { key: 'a11', label: 'a11', value: matrixA.a11, group: 'A' },
    { key: 'a12', label: 'a12', value: matrixA.a12, group: 'A' },
    { key: 'a21', label: 'a21', value: matrixA.a21, group: 'A' },
    { key: 'a22', label: 'a22', value: matrixA.a22, group: 'A' },
    { key: 'b11', label: 'b11', value: matrixB.a11, group: 'B' },
    { key: 'b12', label: 'b12', value: matrixB.a12, group: 'B' },
    { key: 'b21', label: 'b21', value: matrixB.a21, group: 'B' },
    { key: 'b22', label: 'b22', value: matrixB.a22, group: 'B' },
    { key: 'x0', label: 'x', value: vector[0], group: 'x' },
    { key: 'y0', label: 'y', value: vector[1], group: 'x' },
  ];
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
        aria-label={label}
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
        aria-label={`${label}（数值）`}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next)) onChange(clampParam(next));
        }}
      />
    </div>
  );
}

/** 面板里所有文本先集中成标签，再统一做碰撞消解（§7.1：不得出界、不得互相重叠）。 */
export interface PanelInput {
  path: PathView;
  index: 1 | 2;
  geometry: PanelGeometry;
  stage: 0 | 1 | 2;
  yAxis: 'up' | 'down';
  viewBox: [number, number];
  scale: number;
}

export function panelLabels(input: PanelInput): LabelItem[] {
  const { path, index, geometry, stage, scale } = input;
  const labels: LabelItem[] = [];
  const intermediate = project(geometry, input.yAxis, path.intermediate);
  const result = project(geometry, input.yAxis, path.result);
  const inputPoint = project(geometry, input.yAxis, path.input);

  labels.push({
    id: `p${index}-title`,
    text: `路径 ${index}　${path.orderText}`,
    x: geometry.cx,
    y: 30 * scale + 74,
    anchor: 'middle',
    fontSize: 28 * scale,
    fill: NAVY,
    weight: 700,
  });

  if (path.orderDetail.length > 0) {
    labels.push({
      id: `p${index}-order-detail`,
      text: path.orderDetail,
      x: geometry.cx,
      y: 30 * scale + 110,
      anchor: 'middle',
      fontSize: 20 * scale,
      fill: TICK,
      weight: 600,
    });
  }

  const stageText =
    stage === 0
      ? `第 0 步：只有输入 x = ${vecText(path.input)}`
      : stage === 1
        ? `第 1 步：中间态 ${path.intermediateSymbol} = ${vecText(path.intermediate)}`
        : `第 2 步：结果 ${path.resultExpression} = ${vecText(path.result)}`;
  labels.push({
    id: `p${index}-stage`,
    text: stageText,
    x: geometry.cx,
    y: 30 * scale + 148,
    anchor: 'middle',
    fontSize: 22 * scale,
    fill: stage === 2 ? ORANGE : TICK,
    weight: 600,
  });

  // 输入：贴端点左下（原像标注分区，§7.1）
  labels.push({
    id: `p${index}-input`,
    text: `x = ${vecText(path.input)}`,
    x: inputPoint.x + (path.input[0] >= 0 ? -18 : 18) * scale,
    y: inputPoint.y + 34 * scale,
    anchor: path.input[0] >= 0 ? 'end' : 'start',
    fontSize: 23 * scale,
    fill: TICK,
    weight: 600,
  });

  if (stage >= 1) {
    labels.push({
      id: `p${index}-intermediate`,
      text: `${path.intermediateSymbol} = ${vecText(path.intermediate)}`,
      x: intermediate.x + (path.intermediate[0] >= 0 ? 14 : -14) * scale,
      y: intermediate.y - 18 * scale,
      anchor: path.intermediate[0] >= 0 ? 'start' : 'end',
      fontSize: 23 * scale,
      fill: NAVY,
      weight: 700,
    });
  }
  if (stage >= 2) {
    labels.push({
      id: `p${index}-result`,
      text: `${path.resultExpression} = ${vecText(path.result)}`,
      x: result.x + (path.result[0] >= 0 ? 16 : -16) * scale,
      y: result.y - 22 * scale,
      anchor: path.result[0] >= 0 ? 'start' : 'end',
      fontSize: 25 * scale,
      fill: ORANGE,
      weight: 700,
    });
  }
  return labels;
}

/** 刻度线与刻度数字（数字进同一个碰撞列表，字号 20）。 */
function tickNodes(input: PanelInput, labels: LabelItem[]): ReactElement[] {
  const { geometry, yAxis, scale } = input;
  const nodes: ReactElement[] = [];
  const step = geometry.tickStep;
  const maxX = Math.floor(geometry.axisHalf / geometry.unit / step);
  for (let k = 1; k <= maxX; k += 1) {
    for (const sign of [1, -1] as const) {
      const value = k * step * sign;
      const x = geometry.cx + value * geometry.unit;
      nodes.push(
        <line
          key={`tx-${value}`}
          x1={x}
          y1={geometry.cy - 9}
          x2={x}
          y2={geometry.cy + 9}
          stroke={AXIS}
          strokeWidth={1.8}
          opacity={0.8}
        />,
      );
      labels.push({
        id: `p${input.index}-tickx-${value}`,
        text: fmt(value),
        x,
        y: geometry.cy + 40 * scale,
        anchor: 'middle',
        fontSize: 20 * scale,
        fill: TICK,
        weight: 600,
      });
    }
  }
  const maxUp = Math.floor(geometry.axisUp / geometry.unit / step);
  for (let k = 1; k <= maxUp; k += 1) {
    const y = geometry.cy + (yAxis === 'up' ? -1 : 1) * k * step * geometry.unit;
    nodes.push(
      <line
        key={`ty-up-${k}`}
        x1={geometry.cx - 9}
        y1={y}
        x2={geometry.cx + 9}
        y2={y}
        stroke={AXIS}
        strokeWidth={1.8}
        opacity={0.8}
      />,
    );
    labels.push({
      id: `p${input.index}-ticky-up-${k}`,
      text: fmt(k * step),
      x: geometry.cx - 20 * scale,
      y: y + 7 * scale,
      anchor: 'end',
      fontSize: 20 * scale,
      fill: TICK,
      weight: 600,
    });
  }
  const maxDown = Math.floor(geometry.axisDown / geometry.unit / step);
  for (let k = 1; k <= maxDown; k += 1) {
    const y = geometry.cy + (yAxis === 'up' ? 1 : -1) * k * step * geometry.unit;
    nodes.push(
      <line
        key={`ty-down-${k}`}
        x1={geometry.cx - 9}
        y1={y}
        x2={geometry.cx + 9}
        y2={y}
        stroke={AXIS}
        strokeWidth={1.8}
        opacity={0.8}
      />,
    );
    labels.push({
      id: `p${input.index}-ticky-down-${k}`,
      text: fmt(-k * step),
      x: geometry.cx - 20 * scale,
      y: y + 7 * scale,
      anchor: 'end',
      fontSize: 20 * scale,
      fill: TICK,
      weight: 600,
    });
  }
  return nodes;
}

function labelRole(id: string): string | undefined {
  if (id.endsWith('-input')) return 'input';
  if (id.endsWith('-intermediate')) return 'intermediate';
  if (id.endsWith('-result')) return 'result';
  if (id.endsWith('-title')) return 'title';
  return undefined;
}

function labelPath(id: string): string | undefined {
  const match = /^p(\d)-/.exec(id);
  return match?.[1];
}

export default function MatrixOrderRegion({
  region,
  params,
  onChange,
  stage,
  reducedMotion,
  onLinkedTexts,
}: RegionRendererProps): ReactElement {
  const rawId = useId();
  const uid = rawId.replace(/[^A-Za-z0-9_-]/g, '') || 'mo';
  const cs = useMemo(() => readCoordinateSystem(region.coordinate_system), [region.coordinate_system]);
  const original = useMemo(() => readParams(region.original_params, readParams({})), [region.original_params]);
  const current = useMemo(() => readParams(params, original), [params, original]);
  const paths = useMemo(() => computePaths(current), [current]);
  const [left, right] = useMemo(() => buildGeometry(paths, cs), [paths, cs]);
  const changed = useMemo(() => isOffOriginal(current, original), [current, original]);
  const linkedTexts = useMemo(
    () => buildLinkedTexts(region.linked_texts, paths, changed),
    [region.linked_texts, paths, changed],
  );

  // 回传原位文字：用签名当依赖，宿主每次渲染新建的回调不会造成循环更新。
  const linkedSignature = JSON.stringify(linkedTexts);
  const onLinkedRef = useRef(onLinkedTexts);
  onLinkedRef.current = onLinkedTexts;
  useEffect(() => {
    onLinkedRef.current(linkedTexts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在文本内容变化时回传
  }, [linkedSignature]);

  const [width, height] = cs.view_box;
  /**
   * 字号缩放：`coordinate_system.view_box` 是区域内部坐标，区域在页面上只有
   * `bbox.w/h` 英寸。按"1 英寸 ≈ 144 viewBox 像素"换算可见缩放比，
   * 以 S6 的 6.67×4.69in → 0.62 为基准。
   * 这样同一套字号在 S10（6.96×5.00in）≈ 1.0，在扁高的 S14 区域仍可读。
   */
  const designRatio = Math.min(
    (region.bbox.w * 144) / width,
    (region.bbox.h * 144) / height,
  );
  const scale = Math.min(2.8, Math.max(0.75, 0.62 / Math.max(designRatio, 1e-6)));

  const panels: Array<{ path: PathView; index: 1 | 2; geometry: PanelGeometry }> = [
    { path: paths[0], index: 1, geometry: left },
    { path: paths[1], index: 2, geometry: right },
  ];

  const agree = resultsAgree(paths);
  const statusText = agree
    ? `当前参数下两条路径结果相同（可交换）：${vecText(paths[0].result)}`
    : `两条路径结果不同：${paths[0].resultExpression} = ${vecText(paths[0].result)} ≠ ${paths[1].resultExpression} = ${vecText(paths[1].result)}`;

  const specs = paramSpecs(current.A, current.B, current.x);
  const groups: Array<{ key: 'A' | 'B' | 'x'; title: string; items: ParamSpec[] }> = [
    { key: 'A', title: '矩阵 A（路径 2 先做 / 路径 1 后做）', items: specs.filter((spec) => spec.group === 'A') },
    { key: 'B', title: '矩阵 B（路径 1 先做 / 路径 2 后做）', items: specs.filter((spec) => spec.group === 'B') },
    { key: 'x', title: '输入向量 x', items: specs.filter((spec) => spec.group === 'x') },
  ];

  const patchParam = (spec: ParamSpec, next: number): void => {
    if (spec.group === 'x') {
      const vector: [number, number] = spec.key === 'x0' ? [next, current.x[1]] : [current.x[0], next];
      onChange({ x: vector });
      return;
    }
    onChange({ [spec.key]: next });
  };

  return (
    <div className={styles.root} data-reduced-motion={reducedMotion ? 'true' : 'false'}>
      <svg
        className={styles.svg}
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="乘法顺序对比：两条路径分别先执行 B 与先执行 A，显示各自的中间态与最终结果"
      >
        <defs>
          <marker id={`${uid}-axis`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={AXIS} />
          </marker>
          <marker id={`${uid}-navy`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={NAVY} />
          </marker>
          <marker id={`${uid}-orange`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={ORANGE} />
          </marker>
          <marker id={`${uid}-ghost`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={GHOST} />
          </marker>
        </defs>

        <rect x={0} y={0} width={width} height={height} fill={BG} />

        {panels.map(({ path, index, geometry }) => {
          const panelInput: PanelInput = {
            path,
            index,
            geometry,
            stage,
            yAxis: cs.y_axis,
            viewBox: [width, height],
            scale,
          };
          const collected = panelLabels(panelInput);
          const tickMarks = tickNodes(panelInput, collected);
          const resolved = resolveLabelCollisions(collected, [width, height]);
          const origin = project(geometry, cs.y_axis, [0, 0]);
          const intermediate = project(geometry, cs.y_axis, path.intermediate);
          const result = project(geometry, cs.y_axis, path.result);
          const inputEnd = project(geometry, cs.y_axis, path.input);
          return (
            <g key={path.id}>
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
              {tickMarks}
              <circle cx={origin.x} cy={origin.y} r={5} fill={NAVY} />

              {/* 输入（原像，虚线） */}
              <line
                x1={origin.x}
                y1={origin.y}
                x2={inputEnd.x}
                y2={inputEnd.y}
                stroke={GHOST}
                strokeWidth={3.2}
                strokeDasharray="9 8"
                markerEnd={`url(#${uid}-ghost)`}
              />
              <circle cx={inputEnd.x} cy={inputEnd.y} r={5} fill="#9FABBD" />

              {/* 中间态（第一步之后，实线） */}
              <g className={styles.fade} opacity={stage >= 1 ? 1 : 0}>
                <line
                  x1={origin.x}
                  y1={origin.y}
                  x2={intermediate.x}
                  y2={intermediate.y}
                  stroke={NAVY}
                  strokeWidth={3.2}
                  markerEnd={`url(#${uid}-navy)`}
                />
                <circle cx={intermediate.x} cy={intermediate.y} r={6} fill={NAVY} />
              </g>

              {/* 结果（第二步之后，橙色） */}
              <g className={styles.fade} opacity={stage >= 2 ? 1 : 0}>
                <line
                  x1={origin.x}
                  y1={origin.y}
                  x2={result.x}
                  y2={result.y}
                  stroke={ORANGE}
                  strokeWidth={3.2}
                  markerEnd={`url(#${uid}-orange)`}
                />
                <circle cx={result.x} cy={result.y} r={7} fill={ORANGE} stroke={BG} strokeWidth={2} />
              </g>

              {/* 面板注记：这一条路径用的是哪两个矩阵 */}
              <text
                x={geometry.cx - geometry.axisHalf}
                y={height - 96 * scale}
                fontSize={21 * scale}
                fill={TICK}
                fontWeight={600}
                fontFamily={FONT}
              >
                {`A = ${matText(current.A)}${current.labelA ? `　（${current.labelA}）` : ''}`}
              </text>
              <text
                x={geometry.cx - geometry.axisHalf}
                y={height - 66 * scale}
                fontSize={21 * scale}
                fill={TICK}
                fontWeight={600}
                fontFamily={FONT}
              >
                {`B = ${matText(current.B)}${current.labelB ? `　（${current.labelB}）` : ''}`}
              </text>

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
                  data-role={labelRole(label.id)}
                  data-path={labelPath(label.id)}
                >
                  {label.text}
                </text>
              ))}
            </g>
          );
        })}

        {/* 底部状态：两条路径的最终对照（"顺序对比"主叙事） */}
        <text
          x={width / 2}
          y={height - 26 * scale}
          textAnchor="middle"
          fontSize={24 * scale}
          fontWeight={700}
          fill={agree ? TICK : ORANGE}
          fontFamily={FONT}
          paintOrder="stroke"
          stroke={BG}
          strokeWidth={5}
          strokeLinejoin="round"
          data-role="order-summary"
        >
          {statusText}
        </text>
      </svg>

      <details className={styles.drawer}>
        <summary className={styles.summary}>参数</summary>
        <div className={styles.panel}>
          {groups.map((group) => (
            <div key={group.key}>
              <p className={styles.groupTitle}>{group.title}</p>
              {group.items.map((spec) => (
                <ParamRow
                  key={spec.key}
                  label={spec.label}
                  value={spec.value}
                  onChange={(next) => {
                    patchParam(spec, next);
                  }}
                />
              ))}
            </div>
          ))}
          <p className={styles.note}>
            两条路径都从同一个 x 出发：路径 1 先执行 B（中间态 Bx），路径 2 先执行 A（中间态 Ax）。
            改参数时可看到两条路径的结果分叉。
          </p>
        </div>
      </details>
    </div>
  );
}
/**
 * VegaSpecView.tsx —— vega 视图：原生 SVG 实现 five 个内置模板
 * （line / bar / scatter / heatmap / grid_and_transform）。
 *
 * 为什么用原生 SVG 而不是 vega-lite + vega-embed（验收允许的二选一，理由见交付总结）：
 *  1. **SSR 验收**：本项目的验收要求用 `react-dom/server` 渲染并断言图表视图存在；
 *     vega-embed 依赖 `document` 做文本度量与 canvas 渲染，服务端只会得到一个空容器，
 *     图表在 SSR 里"不存在"，延展性证明失效；
 *  2. **体积**：`vega-lite` 安装包约 5.9 MB、`vega-embed` 约 0.6 MB，且会额外引入
 *     vega / vega-expression / d3 等一长串依赖，对"单知识点只加一份 JSON"的目标过重；
 *  3. **可预期**：模板只有五个且已冻结，手写 SVG 能精确落到规定色板
 *     （#F6F3EC / #8B9AB3 / #C4622D / #16233A），不依赖第三方主题；
 *  4. **数据链路一致**：iSpec v1.0 没有 `data` 字段，数据必须由 `dataset.ts` 从参数
 *     /派生量解析出来，再翻译成 vega spec 只是多一层中间层。
 *
 * 视图契约：只读 `view.spec_ref` / `view.x` / `view.y` 与求值结果，不写死任何知识类型。
 */
import { memo, useMemo, type ReactElement, type ReactNode } from 'react';
import type { ISpec, SpecEvaluation, VegaView } from '../../../ispec/types';
import { resolveChartDataset, type ChartDataset } from '../../../ispec/dataset';
import {
  bandLayout,
  createProjector,
  linearScale,
  niceTicks,
  paddingDomain,
  svgPath,
  truncateLabel,
  type NumericDomain,
  type PlotArea,
  type Vec2,
} from '../../../ispec/chart';
import {
  determinant,
  matrixFromScope,
  missingMatrixFields,
  readNumber,
} from '../../../ispec/geometry';
import { formatNumberSmart, type SpecCell } from '../../../ispec/format';
import styles from './VegaSpecView.module.css';

const CANVAS_W = 640;
const CANVAS_H = 360;
/** 数据集字段名里 category / series / value 是内部标识，不适合当坐标轴标题展示。 */
const INTERNAL_FIELDS = new Set(['category', 'series', 'value', 'x', 'y', 'label', 'name']);
function fieldTitle(field: string | undefined): string | undefined {
  if (field === undefined) return undefined;
  return INTERNAL_FIELDS.has(field.trim().toLowerCase()) ? undefined : field;
}

const PLOT: PlotArea = {
  x: 62,
  y: 40,
  w: CANVAS_W - 62 - 28,
  h: CANVAS_H - 40 - 56,
};
const SERIES_COLORS = ['#c4622d', '#6356b2', '#388078', '#92753b', '#b34a72'];

function SeriesLegend({names}: {names: string[]}) {
  return <g aria-label="图例">{names.map((name, index) => <g key={name} transform={`translate(${PLOT.x + index*125} 14)`}>
    <rect width={9} height={9} y={-8} fill={SERIES_COLORS[index % SERIES_COLORS.length]}/>
    <text x={14} fontSize={11} fill="#6c7384">{name}</text></g>)}</g>;
}

const TEMPLATE_TITLES: Readonly<Record<VegaView['spec_ref'], string>> = {
  line: '折线图',
  bar: '柱状图',
  scatter: '散点图',
  heatmap: '热力图',
  grid_and_transform: '网格与线性变换',
};

export interface VegaSpecViewProps {
  view: VegaView;
  spec: ISpec;
  evaluation: SpecEvaluation;
  reducedMotion: boolean;
}

interface AxisTick {
  pos: number;
  label: string;
}

/* -------------------------------------------------------------------------- */
/* 公共图元                                                                    */
/* -------------------------------------------------------------------------- */

interface ChartFrameProps {
  title: string;
  specRef: VegaView['spec_ref'];
  ariaLabel: string;
  note: string | null;
  reducedMotion: boolean;
  children: ReactNode;
}

function ChartFrame(props: ChartFrameProps): ReactElement {
  const { title, specRef, ariaLabel, note, reducedMotion, children } = props;
  return (
    <figure
      className={styles.root}
      data-vega-view
      data-spec-ref={specRef}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
    >
      <figcaption className={styles.title}>{title}</figcaption>
      <svg
        className={styles.canvas}
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={ariaLabel}
      >
        <rect className={styles.background} x={0} y={0} width={CANVAS_W} height={CANVAS_H} />
        {children}
      </svg>
      {note === null ? null : (
        <p className={styles.note} data-chart-note>
          {note}
        </p>
      )}
    </figure>
  );
}

function AxisLayer(props: {
  xTicks: AxisTick[];
  yTicks: AxisTick[];
  xTitle?: string;
  yTitle?: string;
}): ReactElement {
  const { xTicks, yTicks, xTitle, yTitle } = props;
  const bottom = PLOT.y + PLOT.h;
  return (
    <g>
      {yTicks.map((tick, index) => (
        <g key={`y-${index}`}>
          <line
            className={styles.gridLine}
            x1={PLOT.x}
            y1={tick.pos}
            x2={PLOT.x + PLOT.w}
            y2={tick.pos}
          />
          <text className={styles.tickText} x={PLOT.x - 8} y={tick.pos + 4} textAnchor="end">
            {tick.label}
          </text>
        </g>
      ))}
      {xTicks.map((tick, index) => (
        <text
          key={`x-${index}`}
          className={styles.tickText}
          x={tick.pos}
          y={bottom + 18}
          textAnchor="middle"
        >
          {tick.label}
        </text>
      ))}
      <line className={styles.axis} x1={PLOT.x} y1={PLOT.y} x2={PLOT.x} y2={bottom} />
      <line className={styles.axis} x1={PLOT.x} y1={bottom} x2={PLOT.x + PLOT.w} y2={bottom} />
      {xTitle === undefined ? null : (
        <text className={styles.axisTitle} x={PLOT.x + PLOT.w / 2} y={CANVAS_H - 12} textAnchor="middle">
          {xTitle}
        </text>
      )}
      {yTitle === undefined ? null : (
        <text
          className={styles.axisTitle}
          transform={`translate(16 ${(PLOT.y + PLOT.h / 2).toFixed(2)}) rotate(-90)`}
          textAnchor="middle"
        >
          {yTitle}
        </text>
      )}
    </g>
  );
}

function MissingDataPlot(props: { message: string }): ReactElement {
  return (
    <g data-chart-missing="true">
      <rect
        className={styles.emptyBox}
        x={PLOT.x + 12}
        y={PLOT.y + 12}
        width={PLOT.w - 24}
        height={PLOT.h - 24}
        rx={8}
      />
      <text
        className={styles.emptyText}
        x={PLOT.x + PLOT.w / 2}
        y={PLOT.y + PLOT.h / 2}
        textAnchor="middle"
      >
        {props.message}
      </text>
    </g>
  );
}

function EmptyPlot(props: { message: string }): ReactElement {
  return (
    <g data-chart-empty="true">
      <rect
        className={styles.emptyBox}
        x={PLOT.x + 12}
        y={PLOT.y + 12}
        width={PLOT.w - 24}
        height={PLOT.h - 24}
        rx={8}
      />
      <text
        className={styles.emptyText}
        x={PLOT.x + PLOT.w / 2}
        y={PLOT.y + PLOT.h / 2}
        textAnchor="middle"
      >
        {props.message}
      </text>
    </g>
  );
}

function numericValues(rows: ChartDataset['rows'], field: string): number[] {
  const values: number[] = [];
  for (const row of rows) {
    const value = row[field];
    if (typeof value === 'number') values.push(value);
  }
  return values;
}

/* -------------------------------------------------------------------------- */
/* 模板：bar                                                                   */
/* -------------------------------------------------------------------------- */

function renderBar(dataset: ChartDataset): ReactElement {
  const sourceRows = dataset.rows.filter((row) => row[dataset.xField] !== undefined);
  const series = [...new Set(sourceRows.map(row => String(row['series'] ?? '')))];
  const categories = [...new Set(sourceRows.map(row => row[dataset.xField]))];
  const rows = categories.flatMap(category => sourceRows.filter(row => row[dataset.xField] === category));
  const values = numericValues(rows, dataset.yField);

  if (rows.length === 0) {
    return <EmptyPlot message="没有可绘制的数据行" />;
  }

  // 有分类但没有数值：只画分类轴，绝不用假数据凑柱子
  if (values.length === 0) {
    const band = bandLayout(rows.length, PLOT.x, PLOT.x + PLOT.w);
    const xTicks = rows.map((row, index) => ({
      pos: band.center(index),
      label: truncateLabel(String(row[dataset.xField] ?? '')),
    }));
    return (
      <g data-chart-template="bar" data-chart-empty="true">
        <AxisLayer xTicks={xTicks} yTicks={[{ pos: PLOT.y + PLOT.h, label: '0' }]} xTitle={fieldTitle(dataset.xField)} />
        {rows.map((_, index) => (
          <circle
            key={`empty-${index}`}
            className={styles.emptyMark}
            cx={band.center(index)}
            cy={PLOT.y + PLOT.h}
            r={3}
          />
        ))}
      </g>
    );
  }

  const domain = paddingDomain(Math.min(...values), Math.max(...values), true);
  const y = linearScale(domain, PLOT.y + PLOT.h, PLOT.y);
  const band = bandLayout(rows.length, PLOT.x, PLOT.x + PLOT.w);
  const baseY = y(0);
  const yTicks: AxisTick[] = niceTicks(domain, 5).map((value) => ({
    pos: y(value),
    label: formatNumberSmart(value),
  }));
  const xTicks: AxisTick[] = rows.map((row, index) => ({
    pos: band.center(index),
    label: truncateLabel(String(row[dataset.xField] ?? '')),
  }));

  return (
    <g data-chart-template="bar">
      {series.some(Boolean) && <SeriesLegend names={series}/>}
      <AxisLayer xTicks={xTicks} yTicks={yTicks} xTitle={fieldTitle(dataset.xField)} yTitle={fieldTitle(dataset.yField)} />
      {rows.map((row, index) => {
        const value = row[dataset.yField];
        if (typeof value !== 'number') return null;
        const top = y(value);
        const height = Math.max(1, Math.abs(baseY - top));
        return (
          <g key={`bar-${index}`}>
            <rect
              className={styles.bar}
              style={{fill: SERIES_COLORS[Math.max(0, series.indexOf(String(row['series'] ?? ''))) % SERIES_COLORS.length]}}
              x={band.center(index) - band.bandwidth / 2}
              y={Math.min(top, baseY)}
              width={band.bandwidth}
              height={height}
              rx={2}
            >
              <title>{`${String(row[dataset.xField] ?? '')} · ${String(row['series'] ?? '')}：${formatNumberSmart(value)}`}</title>
            </rect>
            {rows.length <= 10 ? (
              <text
                className={styles.valueLabel}
                x={band.center(index)}
                y={Math.min(top, baseY) - 6}
                textAnchor="middle"
              >
                {formatNumberSmart(value)}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* 模板：line / scatter 共用的 x 轴解析                                          */
/* -------------------------------------------------------------------------- */

interface XAxisResolution {
  numeric: boolean;
  xAt: (index: number) => number;
  ticks: AxisTick[];
}

function resolveXAxis(rows: ChartDataset['rows'], field: string): XAxisResolution {
  const xs = rows.map((row) => row[field]);
  const numeric = xs.every((value) => typeof value === 'number');
  if (numeric) {
    const numbers = xs.map((value) => (typeof value === 'number' ? value : 0));
    const domain = paddingDomain(Math.min(...numbers), Math.max(...numbers), false);
    const scale = linearScale(domain, PLOT.x, PLOT.x + PLOT.w);
    return {
      numeric: true,
      xAt: (index: number) => scale(numbers[index] ?? domain.min),
      ticks: niceTicks(domain, 5).map((value) => ({ pos: scale(value), label: formatNumberSmart(value) })),
    };
  }
  const band = bandLayout(rows.length, PLOT.x, PLOT.x + PLOT.w);
  return {
    numeric: false,
    xAt: (index: number) => band.center(index),
    ticks: rows.map((row, index) => ({
      pos: band.center(index),
      label: truncateLabel(String(row[field] ?? '')),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* 模板：line                                                                  */
/* -------------------------------------------------------------------------- */

function renderLine(dataset: ChartDataset): ReactElement {
  const rows = dataset.rows.filter(
    (row) => row[dataset.xField] !== undefined && typeof row[dataset.yField] === 'number',
  );
  if (rows.length === 0) return <EmptyPlot message="没有可绘制的数据行" />;

  const values = numericValues(rows, dataset.yField);
  const yDomain: NumericDomain = paddingDomain(Math.min(...values), Math.max(...values), false);
  const y = linearScale(yDomain, PLOT.y + PLOT.h, PLOT.y);
  const uniqueRows = [...new Map(rows.map(row => [row[dataset.xField], row])).values()];
  const xAxis = resolveXAxis(uniqueRows, dataset.xField);
  const series = [...new Set(rows.map(row => String(row['series'] ?? '')))];
  const points: Vec2[] = rows.map((row) => {
    const value = row[dataset.yField];
    return [xAxis.xAt(uniqueRows.findIndex(item => item[dataset.xField] === row[dataset.xField])), y(typeof value === 'number' ? value : Number.NaN)];
  });
  const yTicks: AxisTick[] = niceTicks(yDomain, 5).map((value) => ({
    pos: y(value),
    label: formatNumberSmart(value),
  }));

  return (
    <g data-chart-template="line">
      {series.some(Boolean) && <SeriesLegend names={series}/>}
      <AxisLayer xTicks={xAxis.ticks} yTicks={yTicks} xTitle={fieldTitle(dataset.xField)} yTitle={fieldTitle(dataset.yField)} />
      {series.map((name, seriesIndex) => <path key={name} className={styles.linePath}
        style={{stroke: SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}}
        d={svgPath(points.filter((_point, index) => String(rows[index]?.['series'] ?? '') === name))}/>)}
      {points.map((point, index) => (
        <circle key={`dot-${index}`} className={styles.dot} cx={point[0]} cy={point[1]} r={3.2}
          style={{fill: SERIES_COLORS[Math.max(0, series.indexOf(String(rows[index]?.['series'] ?? ''))) % SERIES_COLORS.length]}}>
          <title>{`${String(rows[index]?.[dataset.xField] ?? '')} · ${String(rows[index]?.['series'] ?? '')}：${formatNumberSmart(values[index] ?? Number.NaN)}`}</title>
        </circle>
      ))}
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* 模板：scatter                                                               */
/* -------------------------------------------------------------------------- */

function renderScatter(dataset: ChartDataset): ReactElement {
  const rows = dataset.rows.filter(
    (row) => row[dataset.xField] !== undefined && typeof row[dataset.yField] === 'number',
  );
  if (rows.length === 0) return <EmptyPlot message="没有可绘制的数据行" />;

  const values = numericValues(rows, dataset.yField);
  const yDomain = paddingDomain(Math.min(...values), Math.max(...values), false);
  const y = linearScale(yDomain, PLOT.y + PLOT.h, PLOT.y);
  const xAxis = resolveXAxis(rows, dataset.xField);
  const yTicks: AxisTick[] = niceTicks(yDomain, 5).map((value) => ({
    pos: y(value),
    label: formatNumberSmart(value),
  }));

  return (
    <g data-chart-template="scatter">
      <AxisLayer xTicks={xAxis.ticks} yTicks={yTicks} xTitle={fieldTitle(dataset.xField)} yTitle={fieldTitle(dataset.yField)} />
      {rows.map((row, index) => {
        const value = row[dataset.yField];
        if (typeof value !== 'number') return null;
        return (
          <circle
            key={`point-${index}`}
            className={styles.point}
            cx={xAxis.xAt(index)}
            cy={y(value)}
            r={4.2}
          >
            <title>{`${String(row[dataset.xField] ?? '')}：${formatNumberSmart(value)}`}</title>
          </circle>
        );
      })}
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* 模板：heatmap                                                               */
/* -------------------------------------------------------------------------- */

const HEAT_FILL_OPACITY = (intensity: number): number => 0.08 + 0.76 * Math.min(1, Math.max(0, intensity));

function renderHeatmap(
  scope: Record<string, SpecCell>,
  dataset: ChartDataset,
): ReactElement {
  const hasMatrix = ['a', 'b', 'c', 'd'].every((field) => readNumber(scope, field) !== null);
  if (hasMatrix) {
    const matrix = matrixFromScope(scope);
    const cells: Array<{ field: string; row: number; col: number; value: number }> = [
      { field: 'a', row: 0, col: 0, value: matrix.a },
      { field: 'b', row: 0, col: 1, value: matrix.b },
      { field: 'c', row: 1, col: 0, value: matrix.c },
      { field: 'd', row: 1, col: 1, value: matrix.d },
    ];
    const maxAbs = Math.max(1e-12, ...cells.map((cell) => Math.abs(cell.value)));
    const cellW = Math.min(150, PLOT.w / 3);
    const cellH = Math.min(110, PLOT.h / 3);
    const startX = PLOT.x + (PLOT.w - cellW * 2) / 2;
    const startY = PLOT.y + (PLOT.h - cellH * 2) / 2;
    return (
      <g data-chart-template="heatmap" data-chart-source="matrix">
        {cells.map((cell) => {
          const x = startX + cell.col * cellW;
          const y = startY + cell.row * cellH;
          return (
            <g key={cell.field}>
              <rect
                className={styles.heatCell}
                x={x}
                y={y}
                width={cellW}
                height={cellH}
                fillOpacity={HEAT_FILL_OPACITY(Math.abs(cell.value) / maxAbs)}
              >
                <title>{`${cell.field} = ${formatNumberSmart(cell.value)}`}</title>
              </rect>
              <text className={styles.heatValue} x={x + cellW / 2} y={y + cellH / 2 + 6} textAnchor="middle">
                {formatNumberSmart(cell.value)}
              </text>
              <text className={styles.heatField} x={x + 8} y={y + 18}>
                {cell.field}
              </text>
            </g>
          );
        })}
      </g>
    );
  }

  const rows = dataset.rows.filter(
    (row) => row[dataset.xField] !== undefined && typeof row[dataset.yField] === 'number',
  );
  if (rows.length === 0) return <EmptyPlot message="没有可绘制为热力图的数据" />;

  const values = numericValues(rows, dataset.yField);
  const maxAbs = Math.max(1e-12, ...values.map((value) => Math.abs(value)));
  const band = bandLayout(rows.length, PLOT.x, PLOT.x + PLOT.w);
  const cellW = Math.max(12, band.step * 0.86);
  const top = PLOT.y + PLOT.h * 0.2;
  const cellH = PLOT.h * 0.5;
  return (
    <g data-chart-template="heatmap" data-chart-source="rows">
      {rows.map((row, index) => {
        const value = row[dataset.yField];
        if (typeof value !== 'number') return null;
        return (
          <g key={`heat-${index}`}>
            <rect
              className={styles.heatCell}
              x={band.center(index) - cellW / 2}
              y={top}
              width={cellW}
              height={cellH}
              fillOpacity={HEAT_FILL_OPACITY(Math.abs(value) / maxAbs)}
            >
              <title>{`${String(row[dataset.xField] ?? '')}：${formatNumberSmart(value)}`}</title>
            </rect>
            <text className={styles.heatValue} x={band.center(index)} y={top + cellH / 2} textAnchor="middle">
              {formatNumberSmart(value)}
            </text>
            <text className={styles.tickText} x={band.center(index)} y={top + cellH + 18} textAnchor="middle">
              {truncateLabel(String(row[dataset.xField] ?? ''))}
            </text>
          </g>
        );
      })}
      <text className={styles.axisTitle} x={PLOT.x + PLOT.w / 2} y={PLOT.y + 20} textAnchor="middle">
        {`${fieldTitle(dataset.xField) ?? ''} → ${fieldTitle(dataset.yField) ?? ''}（颜色越深 |值| 越大）`}
      </text>
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* 模板：grid_and_transform                                                    */
/* -------------------------------------------------------------------------- */

function renderGridAndTransform(scope: Record<string, SpecCell>): ReactElement {
  const matrix = matrixFromScope(scope);
  const projector = createProjector(PLOT, { xMin: -3.4, xMax: 3.8, yMin: -2.4, yMax: 3.6 });
  const origin = projector(0, 0);
  const det = determinant(matrix);

  const gridLines: ReactElement[] = [];
  for (let step = -3; step <= 3; step += 1) {
    const horizontalFrom = projector(-3, step);
    const horizontalTo = projector(3, step);
    const verticalFrom = projector(step, -2);
    const verticalTo = projector(step, 3);
    gridLines.push(
      <line
        key={`h-${step}`}
        className={styles.mathGrid}
        x1={horizontalFrom[0]}
        y1={horizontalFrom[1]}
        x2={horizontalTo[0]}
        y2={horizontalTo[1]}
      />,
      <line
        key={`v-${step}`}
        className={styles.mathGrid}
        x1={verticalFrom[0]}
        y1={verticalFrom[1]}
        x2={verticalTo[0]}
        y2={verticalTo[1]}
      />,
    );
  }

  const unitSquare: Vec2[] = [
    projector(0, 0),
    projector(1, 0),
    projector(1, 1),
    projector(0, 1),
  ];
  const imageQuad: Vec2[] = [
    projector(0, 0),
    projector(matrix.a, matrix.c),
    projector(matrix.a + matrix.b, matrix.c + matrix.d),
    projector(matrix.b, matrix.d),
  ];
  const firstColumnEnd = projector(matrix.a, matrix.c);
  const secondColumnEnd = projector(matrix.b, matrix.d);

  return (
    <g data-chart-template="grid_and_transform">
      {gridLines}
      <line
        className={styles.axis}
        x1={projector(-3, 0)[0]}
        y1={projector(-3, 0)[1]}
        x2={projector(3.4, 0)[0]}
        y2={projector(3.4, 0)[1]}
      />
      <line
        className={styles.axis}
        x1={projector(0, -2)[0]}
        y1={projector(0, -2)[1]}
        x2={projector(0, 3)[0]}
        y2={projector(0, 3)[1]}
      />
      <path className={styles.preimage} d={svgPath(unitSquare, true)} />
      <path className={styles.transform} d={svgPath(imageQuad, true)} />
      <line className={styles.vector} x1={origin[0]} y1={origin[1]} x2={firstColumnEnd[0]} y2={firstColumnEnd[1]} />
      <line className={styles.vector} x1={origin[0]} y1={origin[1]} x2={secondColumnEnd[0]} y2={secondColumnEnd[1]} />
      <text className={styles.vectorLabel} x={firstColumnEnd[0] + 6} y={firstColumnEnd[1] - 6}>
        {`A·e₁ = (${formatNumberSmart(matrix.a)}, ${formatNumberSmart(matrix.c)})`}
      </text>
      <text className={styles.vectorLabel} x={secondColumnEnd[0] + 6} y={secondColumnEnd[1] - 6}>
        {`A·e₂ = (${formatNumberSmart(matrix.b)}, ${formatNumberSmart(matrix.d)})`}
      </text>
      <text className={styles.resultText} x={PLOT.x + 8} y={PLOT.y + 18}>
        {`det = ${formatNumberSmart(det)}`}
      </text>
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* 组件                                                                        */
/* -------------------------------------------------------------------------- */

export const VegaSpecView = memo(function VegaSpecView(props: VegaSpecViewProps): ReactElement {
  const { view, spec, evaluation, reducedMotion } = props;
  const dataset = useMemo(
    () => resolveChartDataset(spec, evaluation, view),
    [spec, evaluation, view],
  );
  const scope: Record<string, SpecCell> = { ...evaluation.values, ...evaluation.derived };
  const missing = missingMatrixFields(scope);

  const needsMatrix = view.spec_ref === 'grid_and_transform' || view.spec_ref === 'heatmap';
  const matrixNote =
    needsMatrix && missing.length > 0
      ? `未提供 ${missing.join(' / ')}，按单位矩阵对应分量兜底绘制。`
      : null;
  const usesRows = view.spec_ref !== 'grid_and_transform';
  const note = [usesRows ? dataset.note : null, matrixNote]
    .filter((item): item is string => item !== null && item !== '')
    .join(' ') || null;

  const title = view.title ?? TEMPLATE_TITLES[view.spec_ref];
  const rowCount = dataset.rows.length;
  const missingText = dataset.note ?? '该图表缺少数据（dataset 未提供）';
  const needsData = view.spec_ref !== 'grid_and_transform';
  const ariaLabel =
    view.spec_ref === 'grid_and_transform'
      ? `${title}：det = ${formatNumberSmart(determinant(matrixFromScope(scope)))}`
      : needsData && dataset.missing
        ? `${title}：${missingText}`
        : `${title}：${rowCount > 0 ? `${rowCount} 行数据` : '无数据行，仅显示坐标系'}`;

  let body: ReactElement;
  if (needsData && dataset.missing) {
    // 数据缺失时不画"空坐标系假装有图"，明确说明缺什么
    body = <MissingDataPlot message={missingText} />;
  } else {
    switch (view.spec_ref) {
      case 'bar':
        body = renderBar(dataset);
        break;
      case 'line':
        body = renderLine(dataset);
        break;
      case 'scatter':
        body = renderScatter(dataset);
        break;
      case 'heatmap':
        body = renderHeatmap(scope, dataset);
        break;
      case 'grid_and_transform':
        body = renderGridAndTransform(scope);
        break;
    }
  }

  return (
    <ChartFrame
      title={title}
      specRef={view.spec_ref}
      ariaLabel={ariaLabel}
      note={note}
      reducedMotion={reducedMotion}
    >
      {body}
    </ChartFrame>
  );
});

export default VegaSpecView;

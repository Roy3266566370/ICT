import { memo } from 'react';
import {
  bandLayout,
  linearScale,
  niceTicks,
  paddingDomain,
  svgPath,
  truncateLabel,
  type NumericDomain,
} from '@/ispec/chart';
import { formatNumberSmart } from '@/ispec/format';

const PALETTE = ['#c4622d', '#2563eb', '#0f766e', '#7c3aed', '#b45309', '#be185d'];

interface ChartSeries {
  name: string;
  color?: string;
  values: Array<number | [number, number]>;
}

interface ChartPayload {
  chartType: 'bar' | 'line' | 'area' | 'scatter' | 'pie';
  title?: string;
  xLabel?: string;
  yLabel?: string;
  categories?: string[];
  series: ChartSeries[];
  yDomain?: [number, number];
}

interface Props {
  node: Record<string, unknown>;
  canvasWidth: number;
  canvasHeight: number;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseChart(raw: unknown): ChartPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const chartType = obj.chartType;
  if (
    chartType !== 'bar' &&
    chartType !== 'line' &&
    chartType !== 'area' &&
    chartType !== 'scatter' &&
    chartType !== 'pie'
  ) {
    return null;
  }
  if (!Array.isArray(obj.series) || !obj.series.length) return null;
  const series: ChartSeries[] = [];
  for (const item of obj.series) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    if (!Array.isArray(rec.values) || !rec.values.length) continue;
    series.push({
      name: typeof rec.name === 'string' ? rec.name : `系列${series.length + 1}`,
      color: typeof rec.color === 'string' ? rec.color : undefined,
      values: rec.values as Array<number | [number, number]>,
    });
  }
  if (!series.length) return null;
  const yDomain =
    Array.isArray(obj.yDomain) &&
    obj.yDomain.length === 2 &&
    typeof obj.yDomain[0] === 'number' &&
    typeof obj.yDomain[1] === 'number' &&
    obj.yDomain[0] < obj.yDomain[1]
      ? ([obj.yDomain[0], obj.yDomain[1]] as [number, number])
      : undefined;
  return {
    chartType,
    title: typeof obj.title === 'string' ? obj.title : undefined,
    xLabel: typeof obj.xLabel === 'string' ? obj.xLabel : undefined,
    yLabel: typeof obj.yLabel === 'string' ? obj.yLabel : undefined,
    categories: Array.isArray(obj.categories) ? obj.categories.map((v) => String(v)) : undefined,
    series,
    yDomain,
  };
}

/** 在 ViewAST 主 SVG 内直接渲染声明式统计图表（bar/line/area/scatter/pie），零外部依赖。 */
export const ChartNodeView = memo(function ChartNodeView({ node, canvasWidth, canvasHeight }: Props) {
  const chart = parseChart(node.chart);
  if (!chart) return null;

  const x = num(node.x, 24);
  const y = num(node.y, 24);
  const w = Math.max(180, num(node.w, canvasWidth - 48));
  const h = Math.max(140, num(node.h, canvasHeight - 48));

  const titleOffset = chart.title ? 24 : 0;
  const legendOffset = chart.series.length > 1 || chart.chartType === 'pie' ? 20 : 0;
  const padLeft = 52;
  const padRight = 18;
  const padTop = 16 + titleOffset + legendOffset;
  const padBottom = chart.xLabel ? 44 : 30;
  const plotW = Math.max(80, w - padLeft - padRight);
  const plotH = Math.max(60, h - padTop - padBottom);
  const plotX = x + padLeft;
  const plotY = y + padTop;

  // 饼图分支
  if (chart.chartType === 'pie') {
    const categories = chart.categories ?? [];
    const values = (chart.series[0]!.values as number[]).map((v) => Math.max(0, Number(v) || 0));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const radius = Math.min(plotW * 0.34, plotH * 0.44);
    const cx = plotX + plotW * 0.36;
    const cy = plotY + plotH * 0.5;
    let angle = -Math.PI / 2;
    const slices = values.map((val, idx) => {
      const span = (val / total) * Math.PI * 2;
      const start = angle;
      const end = angle + span;
      angle = end;
      const large = span > Math.PI ? 1 : 0;
      const x1 = cx + radius * Math.cos(start);
      const y1 = cy + radius * Math.sin(start);
      const x2 = cx + radius * Math.cos(end);
      const y2 = cy + radius * Math.sin(end);
      const d =
        span >= Math.PI * 2 - 1e-4
          ? `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.01} ${cy - radius} Z`
          : `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
      return {
        d,
        color: PALETTE[idx % PALETTE.length]!,
        label: truncateLabel(categories[idx] ?? `项${idx + 1}`, 12),
        pct: `${((val / total) * 100).toFixed(1)}%`,
      };
    });
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} rx={8} fill="#ffffff" stroke="#e2e8f0" strokeWidth={1} />
        {chart.title ? (
          <text x={x + w / 2} y={y + 20} textAnchor="middle" fontSize={14} fontWeight={600} fill="#16233a">
            {chart.title}
          </text>
        ) : null}
        {slices.map((s, idx) => (
          <path key={idx} d={s.d} fill={s.color} stroke="#ffffff" strokeWidth={1.5} opacity={0.92} />
        ))}
        {slices.map((s, idx) => {
          const ly = plotY + 14 + idx * 20;
          if (ly > y + h - 12) return null;
          return (
            <g key={idx} transform={`translate(${plotX + plotW * 0.68}, ${ly})`}>
              <rect x={0} y={-9} width={10} height={10} rx={2} fill={s.color} />
              <text x={16} y={0} fontSize={11} fill="#334155">
                {s.label} ({s.pct})
              </text>
            </g>
          );
        })}
      </g>
    );
  }

  // 散点图分支
  if (chart.chartType === 'scatter') {
    const allPts = chart.series.flatMap((s) => s.values as [number, number][]);
    const xs = allPts.map((p) => p[0]);
    const ys = allPts.map((p) => p[1]);
    const xDom: NumericDomain = paddingDomain(Math.min(...xs), Math.max(...xs), false);
    const yDom: NumericDomain = chart.yDomain
      ? { min: chart.yDomain[0], max: chart.yDomain[1] }
      : paddingDomain(Math.min(...ys), Math.max(...ys), false);
    const sx = linearScale(xDom, plotX, plotX + plotW);
    const sy = linearScale(yDom, plotY + plotH, plotY);
    const xTicks = niceTicks(xDom, 5);
    const yTicks = niceTicks(yDom, 5);
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} rx={8} fill="#ffffff" stroke="#e2e8f0" strokeWidth={1} />
        {chart.title ? (
          <text x={x + w / 2} y={y + 20} textAnchor="middle" fontSize={14} fontWeight={600} fill="#16233a">
            {chart.title}
          </text>
        ) : null}
        {yTicks.map((tick) => {
          const ty = sy(tick);
          return (
            <g key={`yt-${tick}`}>
              <line x1={plotX} y1={ty} x2={plotX + plotW} y2={ty} stroke="#e2e8f0" strokeDasharray="3 3" />
              <text x={plotX - 6} y={ty + 4} textAnchor="end" fontSize={10} fill="#64748b">
                {formatNumberSmart(tick)}
              </text>
            </g>
          );
        })}
        {xTicks.map((tick) => {
          const tx = sx(tick);
          return (
            <text key={`xt-${tick}`} x={tx} y={plotY + plotH + 14} textAnchor="middle" fontSize={10} fill="#64748b">
              {formatNumberSmart(tick)}
            </text>
          );
        })}
        <line x1={plotX} y1={plotY} x2={plotX} y2={plotY + plotH} stroke="#94a3b8" strokeWidth={1.2} />
        <line x1={plotX} y1={plotY + plotH} x2={plotX + plotW} y2={plotY + plotH} stroke="#94a3b8" strokeWidth={1.2} />
        {chart.series.map((s, sIdx) => {
          const color = s.color ?? PALETTE[sIdx % PALETTE.length]!;
          return (
            <g key={s.name}>
              {(s.values as [number, number][]).map((pt, i) => (
                <circle key={i} cx={sx(pt[0])} cy={sy(pt[1])} r={4.2} fill={color} opacity={0.86} />
              ))}
            </g>
          );
        })}
        {chart.xLabel ? (
          <text x={plotX + plotW / 2} y={y + h - 8} textAnchor="middle" fontSize={11} fill="#475569">
            {chart.xLabel}
          </text>
        ) : null}
        {chart.yLabel ? (
          <text
            x={x + 14}
            y={plotY + plotH / 2}
            textAnchor="middle"
            fontSize={11}
            fill="#475569"
            transform={`rotate(-90 ${x + 14} ${plotY + plotH / 2})`}
          >
            {chart.yLabel}
          </text>
        ) : null}
      </g>
    );
  }

  // 柱状 / 折线 / 面积图
  const categories = chart.categories ?? [];
  const allVals = chart.series.flatMap((s) => s.values as number[]);
  const rawMin = Math.min(0, ...allVals);
  const rawMax = Math.max(0, ...allVals);
  const yDom: NumericDomain = chart.yDomain
    ? { min: chart.yDomain[0], max: chart.yDomain[1] }
    : paddingDomain(rawMin, rawMax === rawMin ? rawMin + 1 : rawMax, true);
  const sy = linearScale(yDom, plotY + plotH, plotY);
  const zeroY = sy(Math.max(yDom.min, Math.min(yDom.max, 0)));
  const yTicks = niceTicks(yDom, 5);
  const bands = bandLayout(categories.length, plotX, plotX + plotW);

  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill="#ffffff" stroke="#e2e8f0" strokeWidth={1} />
      {chart.title ? (
        <text x={x + w / 2} y={y + 20} textAnchor="middle" fontSize={14} fontWeight={600} fill="#16233a">
          {chart.title}
        </text>
      ) : null}
      {chart.series.length > 1 ? (
        <g transform={`translate(${plotX}, ${y + titleOffset + 14})`}>
          {chart.series.map((s, idx) => (
            <g key={s.name} transform={`translate(${idx * 110}, 0)`}>
              <rect x={0} y={-8} width={10} height={10} rx={2} fill={s.color ?? PALETTE[idx % PALETTE.length]!} />
              <text x={14} y={0} fontSize={11} fill="#334155">
                {truncateLabel(s.name, 10)}
              </text>
            </g>
          ))}
        </g>
      ) : null}
      {yTicks.map((tick) => {
        const ty = sy(tick);
        return (
          <g key={`yt-${tick}`}>
            <line x1={plotX} y1={ty} x2={plotX + plotW} y2={ty} stroke="#e2e8f0" strokeDasharray="3 3" />
            <text x={plotX - 6} y={ty + 4} textAnchor="end" fontSize={10} fill="#64748b">
              {formatNumberSmart(tick)}
            </text>
          </g>
        );
      })}
      <line x1={plotX} y1={plotY} x2={plotX} y2={plotY + plotH} stroke="#94a3b8" strokeWidth={1.2} />
      <line x1={plotX} y1={zeroY} x2={plotX + plotW} y2={zeroY} stroke="#94a3b8" strokeWidth={1.2} />

      {chart.chartType === 'bar'
        ? chart.series.map((s, sIdx) => {
            const color = s.color ?? PALETTE[sIdx % PALETTE.length]!;
            const subW = bands.bandwidth / Math.max(1, chart.series.length);
            return (
              <g key={s.name}>
                {(s.values as number[]).map((val, cIdx) => {
                  const bx = bands.center(cIdx) - bands.bandwidth / 2 + sIdx * subW;
                  const by = sy(val);
                  const top = Math.min(by, zeroY);
                  const barH = Math.max(1, Math.abs(zeroY - by));
                  return (
                    <g key={cIdx}>
                      <rect x={bx + 1} y={top} width={Math.max(2, subW - 2)} height={barH} rx={2} fill={color} opacity={0.88} />
                      {categories.length <= 10 && chart.series.length <= 2 ? (
                        <text
                          x={bx + subW / 2}
                          y={val >= 0 ? top - 4 : top + barH + 11}
                          textAnchor="middle"
                          fontSize={10}
                          fill="#1e293b"
                        >
                          {formatNumberSmart(val)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            );
          })
        : chart.series.map((s, sIdx) => {
            const color = s.color ?? PALETTE[sIdx % PALETTE.length]!;
            const pts: Array<[number, number]> = (s.values as number[]).map((val, cIdx) => [
              bands.center(cIdx),
              sy(val),
            ]);
            const linePath = svgPath(pts);
            const areaPath =
              chart.chartType === 'area' && pts.length >= 2
                ? `${linePath} L ${pts[pts.length - 1]![0]} ${zeroY} L ${pts[0]![0]} ${zeroY} Z`
                : '';
            return (
              <g key={s.name}>
                {areaPath ? <path d={areaPath} fill={color} opacity={0.18} /> : null}
                <path d={linePath} fill="none" stroke={color} strokeWidth={2.4} strokeLinejoin="round" />
                {pts.map(([px, py], i) => (
                  <circle key={i} cx={px} cy={py} r={3.5} fill="#ffffff" stroke={color} strokeWidth={2} />
                ))}
              </g>
            );
          })}

      {categories.map((cat, idx) => {
        const step = categories.length > 12 ? Math.ceil(categories.length / 8) : 1;
        if (idx % step !== 0) return null;
        return (
          <text
            key={idx}
            x={bands.center(idx)}
            y={plotY + plotH + 14}
            textAnchor="middle"
            fontSize={10}
            fill="#475569"
          >
            {truncateLabel(cat, 10)}
          </text>
        );
      })}
      {chart.xLabel ? (
        <text x={plotX + plotW / 2} y={y + h - 6} textAnchor="middle" fontSize={11} fill="#475569">
          {chart.xLabel}
        </text>
      ) : null}
      {chart.yLabel ? (
        <text
          x={x + 14}
          y={plotY + plotH / 2}
          textAnchor="middle"
          fontSize={11}
          fill="#475569"
          transform={`rotate(-90 ${x + 14} ${plotY + plotH / 2})`}
        >
          {chart.yLabel}
        </text>
      ) : null}
    </g>
  );
});

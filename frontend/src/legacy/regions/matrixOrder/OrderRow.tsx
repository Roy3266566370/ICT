/**
 * matrixOrder/OrderRow.tsx —— S10 的一条路径（三格：输入 → 中间态 → 输出）。
 *
 * 视觉要点（rebuild-spec §7）：
 *  - 箭头长度按同一比例尺（两条路径、六个向量共用），因此「长度 1 vs 2」可直接目测；
 *  - 输入用深藏青、中间态/输出用强调橙；未到达的阶段整体降透明度，到达后恢复；
 *  - 数值标注固定在格子左上角，避免与箭头端点/相邻格子重叠（§7.1 的防遮挡要求）；
 *  - 零向量不画箭头（避免暗示方向），改画空心圆 + 「零向量」。
 */
import type { Vec2 } from './math';
import { fmtNumber, fmtVec, vecLength } from './math';
import type { Projection } from './geometry';
import styles from './matrixOrder.module.css';

export type CellTone = 'input' | 'mid' | 'result';

export interface CellModel {
  vector: Vec2;
  /** 格子左上角第一行：向量数值 `(0, 2)` */
  valueText: string;
  /** 第二行：`长度 2` */
  lengthText: string;
  tone: CellTone;
  /** 该阶段是否已执行（未到达时淡显，但仍画出目标形态作预览） */
  reached: boolean;
  /** 是否当前阶段（加粗 + 光晕） */
  active: boolean;
}

export interface OrderRowProps {
  projection: Projection;
  rowY: number;
  columns: readonly number[];
  cells: readonly CellModel[];
  /** 数学单位 → 屏幕长度的比例（六个向量共用） */
  arrowScale: number;
  colorFor: (tone: CellTone) => string;
  /** marker 的 id 前缀；实际使用 `${markerPrefix}-${tone}`，保证箭头颜色与线段一致 */
  markerPrefix: string;
  /** 行内说明（屏幕阅读器），例如「路径 1：先执行 B，再执行 A」 */
  ariaLabel: string;
}

export default function OrderRow(props: OrderRowProps) {
  const { projection, rowY, columns, cells, arrowScale, colorFor, markerPrefix, ariaLabel } = props;

  return (
    <g role="group" aria-label={ariaLabel}>
      {cells.map((cell, index) => {
        const columnX = columns[index] ?? 0;
        const start: [number, number] = [columnX, rowY];
        const end: [number, number] = [
          columnX + cell.vector[0] * arrowScale,
          rowY + cell.vector[1] * arrowScale,
        ];
        const [startX, startY] = projection.point(start[0], start[1]);
        const [endX, endY] = projection.point(end[0], end[1]);
        const length = vecLength(cell.vector);
        const color = colorFor(cell.tone);
        const [labelX, labelY] = projection.point(columnX - 1.06, rowY + 1.0);
        const opacity = cell.reached ? 1 : 0.28;

        return (
          <g
            key={`cell-${index}`}
            className={styles.cell}
            data-tone={cell.tone}
            data-active={cell.active ? 'true' : undefined}
            data-reached={cell.reached ? 'true' : undefined}
            style={{ opacity }}
          >
            {/* 格子底（很淡的圆角矩形，帮助"三格对齐"的视觉分组；不遮原页底色） */}
            <rect
              x={projection.point(columnX - 1.16, rowY + 1.18)[0]}
              y={projection.point(columnX - 1.16, rowY + 1.18)[1]}
              width={projection.unit * 2.32}
              height={projection.unit * 2.36}
              rx={10}
              className={styles.cellPlate}
              data-active={cell.active ? 'true' : undefined}
            />

            {length < 1e-9 ? (
              <circle cx={startX} cy={startY} r={5} className={styles.zeroDot} />
            ) : (
              <>
                <line
                  x1={startX}
                  y1={startY}
                  x2={endX}
                  y2={endY}
                  className={styles.arrow}
                  stroke={color}
                  markerEnd={`url(#${markerPrefix}-${cell.tone})`}
                />
                <circle cx={endX} cy={endY} r={4.2} fill={color} />
              </>
            )}

            <text x={labelX} y={labelY} className={styles.cellValue} style={{ fill: color }}>
              {cell.valueText}
            </text>
            <text x={labelX} y={labelY + 17} className={styles.cellLength} style={{ fill: color }}>
              {cell.lengthText}
            </text>
            {cell.active ? (
              <text x={labelX} y={labelY - 17} className={styles.cellBadge}>
                当前
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

/** 由向量生成两行标注文本，保持两条路径同一格式。 */
export function describeVector(vector: Vec2): { valueText: string; lengthText: string } {
  const length = vecLength(vector);
  return {
    valueText: fmtVec(vector, 3),
    lengthText: length < 1e-9 ? '零向量' : `长度 ${fmtNumber(length, 3)}`,
  };
}
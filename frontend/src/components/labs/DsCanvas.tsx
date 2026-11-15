import type { ReactNode } from 'react';
import type { DsResult, DsResultFrame, DsTreeVisual } from '@/labs/types';
import styles from './LabCanvas.module.css';

const TREE_GAP_X = 58;
const TREE_GAP_Y = 64;
const TREE_PAD = 30;

function parseSequence(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .replace(/[（(][^）)]*[）)]/g, ' ')
    .split(/[,，、\s]+/)
    .map((token) => token.trim())
    .filter((token) => token && !/^[→←↓↑·]+$/.test(token));
}

function TreeView({ visual }: { visual: DsTreeVisual }): ReactNode {
  if (!visual.nodes.length) return null;
  const minX = Math.min(...visual.nodes.map((node) => node.x));
  const maxX = Math.max(...visual.nodes.map((node) => node.x));
  const maxY = Math.max(...visual.nodes.map((node) => node.y));
  const width = Math.max(220, (maxX - minX) * TREE_GAP_X + TREE_PAD * 2);
  const height = maxY * TREE_GAP_Y + TREE_PAD * 2;
  const positions = new Map(
    visual.nodes.map((node) => [
      node.id,
      { x: TREE_PAD + (node.x - minX) * TREE_GAP_X, y: TREE_PAD + node.y * TREE_GAP_Y },
    ]),
  );
  return (
    <div className={styles.dsVisual}>
      <span className={styles.dsVisualLabel}>
        结构视图{visual.highlight ? ` · 高亮 ${visual.highlight}` : ''}
      </span>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.dsVisualSvg} role="img" aria-label="树形结构">
        {visual.edges.map((edge, index) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          return (
            <line
              key={`${edge.from}-${edge.to}-${index}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className={styles.dsTreeEdge}
            />
          );
        })}
        {visual.nodes.map((node) => {
          const position = positions.get(node.id);
          if (!position) return null;
          const active = node.id === visual.highlight;
          return (
            <g key={node.id}>
              <circle
                cx={position.x}
                cy={position.y}
                r={17}
                className={active ? styles.dsTreeNodeActive : styles.dsTreeNode}
              />
              <text x={position.x} y={position.y + 4} textAnchor="middle" className={styles.dsTreeNodeText}>
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function BarsView({ items }: { items: string[] }): ReactNode {
  const values = items.map(Number);
  const peak = Math.max(...values.map((value) => Math.abs(value)), 1);
  const slot = 44;
  const pad = 18;
  const chartHeight = 96;
  const baseY = 112;
  const width = Math.max(260, values.length * slot + pad * 2);
  return (
    <div className={styles.dsVisual}>
      <span className={styles.dsVisualLabel}>本趟序列</span>
      <svg viewBox={`0 0 ${width} 150`} className={styles.dsVisualSvg} role="img" aria-label="排序柱状图">
        <line x1={pad} y1={baseY} x2={width - pad} y2={baseY} className={styles.dsBarAxis} />
        {values.map((value, index) => {
          const barWidth = Math.min(28, slot - 14);
          const x = pad + index * slot + (slot - barWidth) / 2;
          const height = Math.max(4, (Math.abs(value) / peak) * chartHeight);
          return (
            <g key={index}>
              <rect
                x={x}
                y={baseY - height}
                width={barWidth}
                height={height}
                rx={3}
                className={styles.dsBar}
              />
              <text x={x + barWidth / 2} y={baseY + 20} textAnchor="middle" className={styles.dsBarValue}>
                {items[index]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ListView({ rows }: { rows: { label: string; items: string[] }[] }): ReactNode {
  return (
    <div className={styles.dsVisual}>
      <span className={styles.dsVisualLabel}>线性表 / 链表指针</span>
      {rows.map((row) => (
        <div key={row.label} className={styles.dsListRow}>
          <span className={styles.dsListRowLabel}>{row.label}</span>
          <span className={styles.dsListHead}>head</span>
          <span className={styles.dsListArrow}>→</span>
          {row.items.map((item, index) => (
            <span key={`${row.label}-${index}`} className={styles.dsListNodeWrap}>
              <span className={styles.dsListNode}>{item}</span>
              <span className={styles.dsListArrow}>→</span>
            </span>
          ))}
          <span className={styles.dsListNull}>NULL</span>
        </div>
      ))}
    </div>
  );
}

function StructuredView({ result, frame }: { result: DsResult; frame: DsResultFrame }): ReactNode {
  if (frame.visual?.type === 'tree') return <TreeView visual={frame.visual} />;
  if (result.dsKind === 'sort_ops') {
    const items = parseSequence(frame.values?.['结果']);
    if (items.length >= 2 && items.every((item) => Number.isFinite(Number(item)))) return <BarsView items={items} />;
  }
  if (result.dsKind === 'list_ops') {
    const rows = Object.entries(frame.values ?? {})
      .filter(([key]) => key.startsWith('表'))
      .map(([label, value]) => ({ label, items: parseSequence(value) }))
      .filter((row) => row.items.length > 0);
    if (rows.length) return <ListView rows={rows} />;
  }
  return null;
}

/** 数据结构题型通用轨迹画布：结构化画面 + 逐帧关键状态 + 伪代码高亮 + 结论。 */
export function DsCanvas({ result, step }: { result: DsResult; step: number }): ReactNode {
  const index = Math.max(0, Math.min(step, result.frames.length - 1));
  const frame = result.frames[index] ?? result.frames[0]!;
  const stateEntries = Object.entries(frame.values ?? {});
  return (
    <div className={styles.bfsState} data-ds-kind={result.dsKind}>
      <StructuredView result={result} frame={frame} />
      <div className={styles.stateBlock}>
        <span className={styles.stateTitle}>{frame.label}</span>
        <p className={styles.orderText}>{frame.detail}</p>
        <div className={styles.chipRow}>
          {stateEntries.map(([key, value]) => (
            <span key={key} className={styles.visitedChip}>
              {key}：{String(value)}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.stateBlock}>
        <span className={styles.stateTitle}>结论</span>
        <p className={styles.orderText}>{result.answer || result.headline}</p>
      </div>
      <div className={styles.pseudocode} aria-label="伪代码">
        {result.pseudocode.map((line, lineIndex) => (
          <code key={lineIndex} data-active={frame.pseudocodeLine === lineIndex + 1 || undefined}>
            <i>{lineIndex + 1}</i>
            {line}
          </code>
        ))}
      </div>
    </div>
  );
}

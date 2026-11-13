/**
 * GraphEditor.tsx —— bfs_flow 的图编辑器与邻接表（R8-AC1 / R8-AC5 / R8-AC6）
 *
 * 职责：
 *  - 画节点/边（SVG），实时高亮「当前节点」与「正在检查的边」；
 *  - 展示邻接表（邻居按 id 的 Unicode 码点字典序，与内核遍历顺序一致）；
 *  - 加节点 / 加边 / 切换起点 / 删除节点或边，全部经上层 `onGraphChange`（即 onParameterChange）
 *    写回整体 `graph` 参数，模板自身不持有服务端真值。
 *
 * 状态不只靠颜色：当前节点带「当前」文字标签 + 加粗描边；已访问节点带 ✓；
 * 未访问节点为空心灰；不可达节点用虚线描边并标注「不可达」。
 * 规模上限（20 节点 / 40 边）在写入前校验并给出中文原因（R8-AC6），不静默丢弃。
 */
import { useId, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { GraphValue } from '@/api/types';
import { BFS_MAX_EDGES, BFS_MAX_NODES, compareCodePoints } from '@/domain/bfs';
import styles from './bfs.module.css';

/** 画布内部坐标系（横向长图，随容器宽度等比缩放） */
const VIEW_WIDTH = 760;
const VIEW_HEIGHT = 340;
const PAD_X = 78;
const PAD_Y = 50;
const NODE_RADIUS = 22;

export interface GraphEditorProps {
  graph: GraphValue;
  /** 有向图只画 from→to；无向图两个方向都可走 */
  directed: boolean;
  startNodeId: string;
  visited: readonly string[];
  currentId: string | null;
  checking: { from: string; to: string } | null;
  spanningEdges: readonly { from: string; to: string }[];
  level: Record<string, number>;
  editable: boolean;
  onGraphChange: (next: GraphValue) => void;
  onStartChange: (nodeId: string) => void;
}

interface Point {
  x: number;
  y: number;
}

function edgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

/**
 * 按 BFS 层级做列布局：level=0 在左，逐层向右；不可达节点（level<0）统一放最后一列。
 * 同一列内按 id 字典序排列，保证布局稳定（不随播放抖动）。
 */
function computeLayout(
  nodes: readonly { id: string }[],
  level: Record<string, number>,
): Map<string, Point> {
  const reachable: string[] = [];
  const unreachable: string[] = [];
  for (const node of nodes) {
    if (level[node.id] !== undefined) reachable.push(node.id);
    else unreachable.push(node.id);
  }
  reachable.sort(compareCodePoints);
  unreachable.sort(compareCodePoints);

  let maxLevel = 0;
  for (const id of reachable) maxLevel = Math.max(maxLevel, level[id] ?? 0);
  const hasUnreachable = unreachable.length > 0;
  const columnCount = Math.max(1, maxLevel + 1 + (hasUnreachable ? 1 : 0));
  const columns: string[][] = Array.from({ length: columnCount }, () => []);

  for (const id of reachable) {
    const column = Math.min(maxLevel, Math.max(0, level[id] ?? 0));
    columns[column]?.push(id);
  }
  if (hasUnreachable) columns[columnCount - 1] = unreachable;

  const positions = new Map<string, Point>();
  columns.forEach((ids, column) => {
    const x =
      columnCount === 1
        ? VIEW_WIDTH / 2
        : PAD_X + ((VIEW_WIDTH - 2 * PAD_X) * column) / (columnCount - 1);
    ids.forEach((id, row) => {
      const count = ids.length;
      const y = count === 1 ? VIEW_HEIGHT / 2 : PAD_Y + ((VIEW_HEIGHT - 2 * PAD_Y) * row) / (count - 1);
      positions.set(id, { x, y });
    });
  });
  return positions;
}

/** 把一条边缩短到圆的外侧，箭头末端才不会埋进节点里。 */
function edgeGeometry(from: Point, to: Point): { x1: number; y1: number; x2: number; y2: number } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  const ux = dx / length;
  const uy = dy / length;
  return {
    x1: from.x + ux * (NODE_RADIUS + 2),
    y1: from.y + uy * (NODE_RADIUS + 2),
    x2: to.x - ux * (NODE_RADIUS + 9),
    y2: to.y - uy * (NODE_RADIUS + 9),
  };
}

export default function GraphEditor(props: GraphEditorProps) {
  const {
    graph,
    directed,
    startNodeId,
    visited,
    currentId,
    checking,
    spanningEdges,
    level,
    editable,
    onGraphChange,
    onStartChange,
  } = props;

  const rawId = useId();
  const markerPrefix = rawId.replace(/[^A-Za-z0-9_-]/g, '');

  const [newNodeId, setNewNodeId] = useState('');
  const [edgeFrom, setEdgeFrom] = useState('');
  const [edgeTo, setEdgeTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const positions = computeLayout(graph.nodes, level);
  const visitedSet = new Set(visited);
  const spanningSet = new Set(spanningEdges.map((edge) => edgeKey(edge.from, edge.to)));

  const nodeIds = graph.nodes.map((node) => node.id);
  const fromId = nodeIds.includes(edgeFrom) ? edgeFrom : (nodeIds[0] ?? '');
  const toId = nodeIds.includes(edgeTo) ? edgeTo : (nodeIds[1] ?? nodeIds[0] ?? '');

  /** 邻接表：有向图只列 from→to，无向图两个方向都列；邻居按码点字典序。 */
  const adjacency = graph.nodes.map((node) => {
    const neighbors = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.from === node.id) neighbors.add(edge.to);
      if (!directed && edge.to === node.id) neighbors.add(edge.from);
    }
    return { id: node.id, neighbors: [...neighbors].sort(compareCodePoints) };
  });

  const submitGraph = (next: GraphValue, message: string): void => {
    setError(null);
    setNotice(message);
    onGraphChange(next);
  };

  const handleAddNode = (): void => {
    const id = newNodeId.trim();
    if (id === '') {
      setError('节点 id 不能为空。');
      return;
    }
    if (id.length > 8) {
      setError('节点 id 最长 8 个字符，避免画布上的标签互相遮挡。');
      return;
    }
    if (nodeIds.includes(id)) {
      setError(`节点 id ${id} 已存在，节点 id 必须唯一。`);
      return;
    }
    if (graph.nodes.length >= BFS_MAX_NODES) {
      setError(`节点数为 ${graph.nodes.length}，已达上限 ${BFS_MAX_NODES}（节点数超限）。`);
      return;
    }
    setNewNodeId('');
    submitGraph(
      { nodes: [...graph.nodes, { id, label: id }], edges: graph.edges },
      `已添加节点 ${id}；新节点单独成列（不可达），接入边后才可达。`,
    );
  };

  const handleAddEdge = (): void => {
    if (fromId === '' || toId === '') {
      setError('请先添加至少一个节点，再添加边。');
      return;
    }
    if (graph.edges.length >= BFS_MAX_EDGES) {
      setError(`边数为 ${graph.edges.length}，已达上限 ${BFS_MAX_EDGES}（边数超限）。`);
      return;
    }
    const duplicated = graph.edges.some(
      (edge) =>
        (edge.from === fromId && edge.to === toId) ||
        (!directed && edge.from === toId && edge.to === fromId),
    );
    if (duplicated) {
      setError(`边 ${fromId} → ${toId} 已存在，重复的边不会改变遍历结果。`);
      return;
    }
    submitGraph(
      { nodes: graph.nodes, edges: [...graph.edges, { from: fromId, to: toId }] },
      `已添加边 ${fromId} → ${toId}。`,
    );
  };

  const handleRemoveNode = (id: string): void => {
    const next: GraphValue = {
      nodes: graph.nodes.filter((node) => node.id !== id),
      edges: graph.edges.filter((edge) => edge.from !== id && edge.to !== id),
    };
    if (next.nodes.length === 0) {
      setError('至少要保留一个节点。');
      return;
    }
    submitGraph(next, `已删除节点 ${id} 及其相关的全部边。`);
  };

  const handleRemoveEdge = (from: string, to: string): void => {
    let removed = false;
    const edges = graph.edges.filter((edge) => {
      if (removed) return true;
      if (edge.from === from && edge.to === to) {
        removed = true;
        return false;
      }
      return true;
    });
    submitGraph({ nodes: graph.nodes, edges }, `已删除边 ${from} → ${to}。`);
  };

  return (
    <section className={styles.card} aria-label="图编辑器">
      <h3 className={styles.cardTitle}>
        图与邻接表
        <span className={styles.cardTitleMeta}>
          {directed ? '有向图（from → to 单向）' : '无向图（边可双向走）'} ·{' '}
          {graph.nodes.length} 个节点 / {graph.edges.length} 条边
        </span>
      </h3>

      <div className={styles.graphStatus} role="status" aria-live="polite">
        <span className={styles.statusItem}>
          当前节点：
          <strong className={styles.statusStrong}>{currentId ?? '—'}</strong>
        </span>
        <span className={styles.statusItem}>
          正在检查的边：
          <strong className={styles.statusStrong}>
            {checking === null ? '—' : `${checking.from} → ${checking.to}`}
          </strong>
        </span>
        <span className={styles.statusItem}>
          起点：<strong className={styles.statusStrong}>{startNodeId || '—'}</strong>
        </span>
      </div>

      <svg
        className={styles.graphCanvas}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label={`图结构：${graph.nodes.map((node) => node.id).join('、')}；边 ${graph.edges
          .map((edge) => `${edge.from}→${edge.to}`)
          .join('、')}。点击节点可把该节点设为起点。`}
      >
        <defs>
          <marker
            id={`${markerPrefix}-tree`}
            markerUnits="userSpaceOnUse"
            markerWidth={12}
            markerHeight={12}
            refX={10}
            refY={5}
            orient="auto"
            viewBox="0 0 12 12"
          >
            <path d="M0 0 L12 5 L0 10 Z" fill="var(--color-indigo)" />
          </marker>
          <marker
            id={`${markerPrefix}-idle`}
            markerUnits="userSpaceOnUse"
            markerWidth={10}
            markerHeight={10}
            refX={9}
            refY={4}
            orient="auto"
            viewBox="0 0 10 10"
          >
            <path d="M0 0 L10 4 L0 8 Z" fill="var(--color-navy-subtle)" />
          </marker>
          <marker
            id={`${markerPrefix}-check`}
            markerUnits="userSpaceOnUse"
            markerWidth={13}
            markerHeight={13}
            refX={11}
            refY={5}
            orient="auto"
            viewBox="0 0 13 13"
          >
            <path d="M0 0 L13 5 L0 11 Z" fill="var(--color-coral)" />
          </marker>
        </defs>

        {/* 边：先生成树边与普通边，正在检查的边最后画（保证在最上层） */}
        {graph.edges.map((edge, index) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (from === undefined || to === undefined) return null;
          const isChecking = checking !== null && checking.from === edge.from && checking.to === edge.to;
          const isTree = spanningSet.has(edgeKey(edge.from, edge.to));
          const className = isChecking
            ? styles.edgeChecking
            : isTree
              ? styles.edgeTree
              : styles.edgeIdle;
          const markerEnd = isChecking
            ? `url(#${markerPrefix}-check)`
            : isTree
              ? `url(#${markerPrefix}-tree)`
              : `url(#${markerPrefix}-idle)`;

          // 自环：画一段小弧，避免退化成看不见的点
          if (edge.from === edge.to) {
            return (
              <path
                key={`edge-${index}`}
                className={className}
                d={`M ${from.x - 12} ${from.y - NODE_RADIUS} C ${from.x - 46} ${from.y - 76}, ${
                  from.x + 46
                } ${from.y - 76}, ${from.x + 12} ${from.y - NODE_RADIUS}`}
                markerEnd={markerEnd}
                fill="none"
              />
            );
          }

          const geometry = edgeGeometry(from, to);
          if (geometry === null) return null;
          return (
            <g key={`edge-${index}`}>
              <line
                x1={geometry.x1}
                y1={geometry.y1}
                x2={geometry.x2}
                y2={geometry.y2}
                className={className}
                markerEnd={markerEnd}
              />
              {isChecking ? (
                <text
                  x={(geometry.x1 + geometry.x2) / 2}
                  y={(geometry.y1 + geometry.y2) / 2 - 8}
                  textAnchor="middle"
                  className={styles.edgeLabel}
                >
                  检查中
                </text>
              ) : null}
            </g>
          );
        })}

        {/* 节点 */}
        {graph.nodes.map((node) => {
          const point = positions.get(node.id);
          if (point === undefined) return null;
          const isCurrent = node.id === currentId;
          const isVisited = visitedSet.has(node.id);
          const isStart = node.id === startNodeId;
          const reachable = level[node.id] !== undefined;
          const circleClass = isCurrent
            ? styles.nodeCurrent
            : !reachable
              ? styles.nodeUnreached
              : isVisited
                ? styles.nodeVisited
                : styles.nodeIdle;

          const handleKeyDown = (event: ReactKeyboardEvent<SVGGElement>): void => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onStartChange(node.id);
          };

          return (
            <g
              key={node.id}
              transform={`translate(${point.x} ${point.y})`}
              className={styles.nodeGroup}
              role="button"
              tabIndex={0}
              aria-label={`节点 ${node.id}${isStart ? '（起点）' : ''}${isVisited ? '（已访问）' : ''}${
                reachable ? '' : '（不可达）'
              }${isCurrent ? '（当前）' : ''}，按下可设为起点`}
              onClick={() => onStartChange(node.id)}
              onKeyDown={handleKeyDown}
            >
              <circle r={NODE_RADIUS} className={`${styles.nodeCircle} ${circleClass}`} />
              <text textAnchor="middle" dominantBaseline="central" className={styles.nodeText}>
                {node.label === '' ? node.id : node.label}
              </text>
              {isCurrent ? (
                <text y={-NODE_RADIUS - 10} textAnchor="middle" className={styles.nodeBadge}>
                  ▶ 当前
                </text>
              ) : null}
              {isStart ? (
                <text y={NODE_RADIUS + 18} textAnchor="middle" className={styles.nodeSub}>
                  起点
                </text>
              ) : null}
              {isVisited && !isCurrent ? (
                <text x={NODE_RADIUS - 3} y={-NODE_RADIUS + 2} className={styles.nodeCheck}>
                  ✓
                </text>
              ) : null}
              {!reachable ? (
                <text y={NODE_RADIUS + (isStart ? 32 : 18)} textAnchor="middle" className={styles.nodeSub}>
                  不可达
                </text>
              ) : null}
            </g>
          );
        })}

        {graph.nodes.length === 0 ? (
          <text x={VIEW_WIDTH / 2} y={VIEW_HEIGHT / 2} textAnchor="middle" className={styles.nodeSub}>
            还没有节点，请使用下方的「新增节点」。
          </text>
        ) : null}
      </svg>

      <ul className={styles.legend} aria-label="图例">
        <li className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendTree}`} aria-hidden="true" />
          生成树边（实线 + 靛蓝箭头）
        </li>
        <li className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendIdle}`} aria-hidden="true" />
          未进入生成树的边（虚线，含被判重的边）
        </li>
        <li className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendCheck}`} aria-hidden="true" />
          正在检查的边（珊瑚橙）· 当前节点带「▶ 当前」文字
        </li>
      </ul>

      {error !== null ? (
        <p className={styles.inlineError} role="alert">
          <span aria-hidden="true">⚠</span> {error}
        </p>
      ) : null}
      {notice !== null && error === null ? (
        <p className={styles.inlineNotice} role="status">
          {notice}
        </p>
      ) : null}

      {/* ------------------------------ 编辑控件 ------------------------------ */}
      <div className={styles.editorGrid}>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legendTitle}>起点</legend>
          <label className={styles.fieldLabel} htmlFor={`${markerPrefix}-start`}>
            从哪个节点开始遍历
          </label>
          <select
            id={`${markerPrefix}-start`}
            className={styles.select}
            value={nodeIds.includes(startNodeId) ? startNodeId : ''}
            disabled={!editable}
            onChange={(event) => onStartChange(event.target.value)}
          >
            {graph.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.id}
              </option>
            ))}
          </select>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legendTitle}>新增节点</legend>
          <label className={styles.fieldLabel} htmlFor={`${markerPrefix}-new-node`}>
            节点 id（≤ 8 字符，唯一）
          </label>
          <div className={styles.inputRow}>
            <input
              id={`${markerPrefix}-new-node`}
              className={styles.input}
              type="text"
              value={newNodeId}
              maxLength={8}
              placeholder="例如 E"
              disabled={!editable}
              onChange={(event) => setNewNodeId(event.target.value)}
            />
            <button
              type="button"
              className={styles.button}
              onClick={handleAddNode}
              disabled={!editable || graph.nodes.length >= BFS_MAX_NODES}
            >
              添加节点
            </button>
          </div>
          <p className={styles.fieldHint}>
            上限 {BFS_MAX_NODES} 个节点；新节点默认不可达，需要连边后才会被访问。
          </p>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legendTitle}>新增边</legend>
          <div className={styles.inputRow}>
            <label className={styles.fieldLabel} htmlFor={`${markerPrefix}-edge-from`}>
              起点
            </label>
            <select
              id={`${markerPrefix}-edge-from`}
              className={styles.select}
              value={fromId}
              disabled={!editable || nodeIds.length === 0}
              onChange={(event) => setEdgeFrom(event.target.value)}
            >
              {graph.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.id}
                </option>
              ))}
            </select>
            <span aria-hidden="true">→</span>
            <label className={styles.fieldLabel} htmlFor={`${markerPrefix}-edge-to`}>
              终点
            </label>
            <select
              id={`${markerPrefix}-edge-to`}
              className={styles.select}
              value={toId}
              disabled={!editable || nodeIds.length === 0}
              onChange={(event) => setEdgeTo(event.target.value)}
            >
              {graph.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.id}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.button}
              onClick={handleAddEdge}
              disabled={!editable || nodeIds.length === 0 || graph.edges.length >= BFS_MAX_EDGES}
            >
              添加边
            </button>
          </div>
          <p className={styles.fieldHint}>
            上限 {BFS_MAX_EDGES} 条边；`from → to` 只表示单向，允许成环（BFS 不会因此死循环）。
          </p>
        </fieldset>
      </div>

      {/* ------------------------------ 邻接表 ------------------------------ */}
      <div className={styles.adjacencyBlock}>
        <h4 className={styles.subTitle}>邻接表（邻居按 id 码点字典序）</h4>
        <ul className={styles.adjacencyList}>
          {adjacency.map((entry) => (
            <li key={entry.id} className={styles.adjacencyItem}>
              <span className={styles.adjacencyNode}>{entry.id}</span>
              <span aria-hidden="true">→</span>
              <span className={styles.adjacencyNeighbors}>
                {entry.neighbors.length === 0 ? '（无出边）' : entry.neighbors.join(', ')}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.listsGrid}>
        <div>
          <h4 className={styles.subTitle}>节点（点击 × 删除，同时删除相关边）</h4>
          <ul className={styles.chipList}>
            {graph.nodes.map((node) => (
              <li key={node.id} className={styles.chip}>
                <span>{node.id}</span>
                {node.id === startNodeId ? <span className={styles.chipTag}>起点</span> : null}
                <button
                  type="button"
                  className={styles.chipRemove}
                  onClick={() => handleRemoveNode(node.id)}
                  disabled={!editable}
                  aria-label={`删除节点 ${node.id}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className={styles.subTitle}>边（点击 × 删除）</h4>
          <ul className={styles.edgeList}>
            {graph.edges.length === 0 ? <li className={styles.emptyNote}>当前没有边。</li> : null}
            {graph.edges.map((edge, index) => (
              <li key={`${edge.from}->${edge.to}-${index}`} className={styles.edgeItem}>
                <span>
                  {edge.from} → {edge.to}
                </span>
                <button
                  type="button"
                  className={styles.chipRemove}
                  onClick={() => handleRemoveEdge(edge.from, edge.to)}
                  disabled={!editable}
                  aria-label={`删除边 ${edge.from} 到 ${edge.to}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
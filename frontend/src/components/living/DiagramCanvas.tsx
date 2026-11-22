/** P2 流程图交互画布：React Flow 承载 nodes/edges。
 *  节点拖拽（停笔写回 doc）、缩放、双击改字（仅编辑态）、上下游高亮、
 *  单步演示、整理布局、重置。分享页 readOnly 冻结为只读演示。 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type EdgeChangeset,
  type Node,
  type NodeChangeset,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  DIAGRAM_W,
  fromXY,
  layeredLayout,
  reachSets,
  stepOrder,
  toXY,
  type DiagramDoc,
} from '@/living/diagram';
import styles from './DiagramCanvas.module.css';

type FigData = { label: string; shape: string; hl?: string; step?: string };
type FigNode = Node<FigData, 'fig'>;

const FigNodeView = memo(function FigNodeView({ data, selected }: NodeProps<FigNode>): ReactNode {
  return (
    <div
      className={styles.figNode}
      data-shape={data.shape}
      data-hl={data.hl}
      data-step={data.step}
      data-selected={selected ? 'true' : undefined}
      aria-label={`节点 ${data.label}`}
    >
      <Handle type="target" position={Position.Top} className={styles.figHandle} />
      <span className={styles.figLabel}>{data.label || '（未命名）'}</span>
      <Handle type="source" position={Position.Bottom} className={styles.figHandle} />
    </div>
  );
});

const NODE_TYPES = { fig: FigNodeView };

function toFlow(doc: DiagramDoc, hl: Map<string, string>, step: Map<string, string>,edgeStyle?:{color?:string;lineStyle?:'solid'|'dashed'|'dotted';width?:number}) {
  const nodes: FigNode[] = doc.nodes.map((node) => ({
    id: node.id,
    type: 'fig',
    position: toXY(node),
    data: {
      label: node.label,
      shape: node.shape,
      hl: hl.get(node.id),
      step: step.get(node.id),
    },
  }));
  const edges: Edge[] = doc.edges.map((edge, index) => {
    const hot = hl.get(edge.from) === 'self' && hl.get(edge.to) === 'down';
    const cold = hl.get(edge.to) === 'self' && hl.get(edge.from) === 'up';
    return {
      id: `e${index}`,
      source: edge.from,
      target: edge.to,
      label: edge.label || undefined,
      markerEnd: { type: MarkerType.ArrowClosed },
      style:{stroke:hot||cold?'#d37535':edgeStyle?.color,strokeWidth:edgeStyle?.width,
        strokeDasharray:edgeStyle?.lineStyle==='dotted'?'1 5':edgeStyle?.lineStyle==='dashed'?'9 6':undefined},
      className: hot || cold ? styles.figEdgeHot : undefined,
    };
  });
  return { nodes, edges };
}

export default function DiagramCanvas({ doc, readOnly, onDocChange, onStep, height = 420, embedded = false, flow,edgeStyle }: {
  doc: DiagramDoc;
  readOnly?: boolean;
  onDocChange?: (doc: DiagramDoc) => void;
  /** 学生端单步演示进度上报：当前步序（1 起）/总步数/是否走完全程。 */
  onStep?: (step: number, total: number, completed: boolean) => void;
  height?: number;
  embedded?: boolean;
  flow?: {enabled:boolean;speed:number};
  edgeStyle?:{color?:string;lineStyle?:'solid'|'dashed'|'dotted';width?:number};
}): ReactNode {
  const [nodes, setNodes] = useState<FigNode[]>(()=>toFlow(doc,new Map(),new Map(),edgeStyle).nodes);
  const [edges, setEdges] = useState<Edge[]>(()=>toFlow(doc,new Map(),new Map(),edgeStyle).edges);
  const [focus, setFocus] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(-1);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);

  const docRef = useRef<DiagramDoc>(doc);
  const onStepRef = useRef(onStep);
  docRef.current = doc;
  onStepRef.current = onStep;

  // props.doc 变化：若焦点节点仍在则保留高亮与步序，仅在节点被移除时清理
  useEffect(() => {
    setFocus((current) => (current && doc.nodes.some((n) => n.id === current) ? current : null));
    setStepIndex((current) => (current >= doc.nodes.length ? -1 : current));
    setEditing((current) => (current && doc.nodes.some((n) => n.id === current.id) ? current : null));
  }, [doc]);

  const order = useMemo(() => stepOrder(doc), [doc]);
  const hl = useMemo(() => {
    const map = new Map<string, string>();
    if (!focus) return map;
    const { up, down } = reachSets(doc, focus);
    map.set(focus, 'self');
    for (const id of up) map.set(id, 'up');
    for (const id of down) map.set(id, 'down');
    return map;
  }, [doc, focus]);
  const step = useMemo(() => {
    const map = new Map<string, string>();
    if (stepIndex < 0) return map;
    order.forEach((id, index) => {
      if (index < stepIndex) map.set(id, 'done');
      else if (index === stepIndex) map.set(id, 'now');
    });
    return map;
  }, [order, stepIndex]);

  useEffect(() => {
    const flow = toFlow(doc, hl, step,edgeStyle);
    setNodes(current=>flow.nodes.map(node=>{
      const previous=current.find(item=>item.id===node.id);
      // Retain measured sizes when labels/styles change: ResizeObserver does
      // not fire again for an unchanged box, leaving rebuilt nodes invisible.
      return previous?.measured?{...node,measured:previous.measured}:node;
    }));
    setEdges(flow.edges);
  }, [doc, hl, step,edgeStyle]);

  const originalPositions = (value: DiagramDoc) => value.original_positions
    ?? Object.fromEntries(value.nodes.map(({ id, x, y }) => [id, { x, y }]));

  const writePositions = useCallback((list: FigNode[]) => {
    if (!onDocChange) return;
    const moved = new Map(list.map((n) => [n.id, n.position]));
    const next = {
      ...docRef.current,
      original_positions: originalPositions(docRef.current),
      nodes: docRef.current.nodes.map((node) => {
        const pos = moved.get(node.id);
        return pos ? { ...node, ...fromXY(pos.x, pos.y) } : node;
      }),
    };
    onDocChange(next);
  }, [onDocChange]);

  const applyLayout = useCallback(() => {
    const positions = layeredLayout(docRef.current);
    setNodes((current) => current.map((node) => {
      const pos = positions[node.id];
      return pos ? { ...node, position: toXY({ id: node.id, label: '', x: pos.x, y: pos.y, shape: 'rect' }) } : node;
    }));
    if (onDocChange) {
      onDocChange({
        ...docRef.current,
        original_positions: originalPositions(docRef.current),
        nodes: docRef.current.nodes.map((node) =>
          positions[node.id] ? { ...node, ...positions[node.id] } : node),
      });
    }
  }, [onDocChange]);

  const resetLayout = useCallback(() => {
    const currentDoc = docRef.current;
    const positions = originalPositions(currentDoc);
    const nodes = currentDoc.nodes.map((node) => ({ ...node, ...positions[node.id] }));
    setNodes((current) => current.map((node) => {
      const original = nodes.find((item) => item.id === node.id);
      return original ? { ...node, position: toXY(original) } : node;
    }));
    onDocChange?.({ ...currentDoc, nodes });
  }, [onDocChange]);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const label = editing.value.trim().slice(0, 60);
    setEditing(null);
    if (!label) return;
    setNodes((current) => current.map((node) =>
      node.id === editing.id ? { ...node, data: { ...node.data, label } } : node));
    onDocChange?.({
      ...docRef.current,
      nodes: docRef.current.nodes.map((node) =>
        node.id === editing.id ? { ...node, label } : node),
    });
  }, [editing, onDocChange]);

  const stepping = stepIndex >= 0;
  useEffect(() => {
    if (stepping && onStepRef.current) {
      onStepRef.current(stepIndex + 1, order.length, stepIndex >= order.length - 1);
    }
  }, [stepping, stepIndex, order.length]);
  return (
    <div className={styles.diagramCanvas} style={{ height, ...(embedded ? {border:0,background:'transparent',borderRadius:0} : {}), ...(flow?.enabled ? {'--diagram-flow-duration':`${2 / Math.max(0.1,flow.speed)}s`} : {}) }} data-flow={flow?.enabled ? 'true' : undefined} aria-label="流程图画布">
      <div className={styles.diagramToolbar} role="toolbar" aria-label="流程图操作">
        {!stepping ? (
          <button type="button" className={styles.regionMiniBtn}
                  onClick={() => setStepIndex(0)}>单步演示</button>
        ) : (
          <span className={styles.diagramStepBar}>
            <button type="button" className={styles.regionMiniBtn} disabled={stepIndex <= 0}
                    onClick={() => setStepIndex((i) => i - 1)}>上一步</button>
            <span className={styles.diagramStepHint}>第 {stepIndex + 1} / {order.length} 步</span>
            <button type="button" className={styles.regionMiniBtn} disabled={stepIndex >= order.length - 1}
                    onClick={() => setStepIndex((i) => i + 1)}>下一步</button>
            <button type="button" className={styles.regionMiniBtn}
                    onClick={() => setStepIndex(-1)}>退出</button>
          </span>
        )}
        {!readOnly && <button type="button" className={styles.regionMiniBtn} onClick={applyLayout}>整理布局</button>}
        {!readOnly && <button type="button" className={styles.regionMiniBtn} onClick={resetLayout}>重置</button>}
        {!readOnly && onDocChange && doc.nodes.length < 40 ? (
          <button type="button" className={styles.regionMiniBtn} onClick={() => {
            const currentDoc = docRef.current;
            const used = new Set(currentDoc.nodes.map((n) => n.id));
            let idx = currentDoc.nodes.length + 1;
            while (used.has(`n${idx}`)) idx += 1;
            const id = `n${idx}`;
            const nextNode = { id, label: `节点 ${idx}`, x: 0.5, y: 0.5, shape: 'rect' as const };
            onDocChange({
              ...currentDoc,
              nodes: [...currentDoc.nodes, nextNode],
              order: [...currentDoc.order, id],
            });
            setFocus(id);
            setEditing({ id, value: nextNode.label });
          }}>＋ 节点</button>
        ) : null}
        {!readOnly && onDocChange && focus && doc.nodes.length > 1 ? (
          <button type="button" className={styles.regionMiniBtn} onClick={() => {
            const currentDoc = docRef.current;
            const targetId = focus;
            setFocus(null);
            onDocChange({
              ...currentDoc,
              nodes: currentDoc.nodes.filter((n) => n.id !== targetId),
              edges: currentDoc.edges.filter((e) => e.from !== targetId && e.to !== targetId),
              order: currentDoc.order.filter((id) => id !== targetId),
            });
          }}>删节点</button>
        ) : null}
        {doc.warnings.length ? (
          <span className={styles.regionHint} title={doc.warnings.join('；')}>
            {doc.warnings[0]}
          </span>
        ) : null}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly && Boolean(onDocChange)}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        fitView
        minZoom={0.3}
        maxZoom={2.5}
        onConnect={(connection) => {
          if (readOnly || !onDocChange) return;
          const from = connection.source;
          const to = connection.target;
          if (!from || !to || from === to) return;
          const currentDoc = docRef.current;
          if (currentDoc.edges.length >= 60) return;
          if (currentDoc.edges.some((e) => e.from === from && e.to === to)) return;
          onDocChange({
            ...currentDoc,
            edges: [...currentDoc.edges, { from, to, label: '' }],
          });
        }}
        onNodesChange={(changes: NodeChangeset<FigNode>) => {
          setNodes((current) => changes.applyTo(current));
          for (const select of changes.getByType('select')) {
            setFocus(select.selected ? select.id : null);
          }
        }}
        onEdgesChange={(changes: EdgeChangeset<Edge>) =>
          setEdges((current) => changes.applyTo(current))}
        onNodeDragStop={(_event, _node, list) => writePositions(list.length ? list : nodes)}
        onNodeDoubleClick={(_event, node) => {
          if (readOnly) return;
          setEditing({ id: node.id, value: node.data.label });
        }}
      >
        {!embedded && <Background gap={18} size={1} />}
        {!embedded && <Controls showInteractive={false} />}
      </ReactFlow>
      {editing ? (
        <div className={styles.figEditor} role="dialog" aria-label="编辑节点文字">
          <input
            autoFocus
            maxLength={60}
            value={editing.value}
            aria-label="节点文字"
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') setEditing(null);
            }}
          />
          <button type="button" className={styles.regionMiniBtn} onClick={commitEdit}>完成</button>
        </div>
      ) : null}
    </div>
  );
}

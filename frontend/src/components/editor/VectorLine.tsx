import { useId, useRef, useState, type PointerEvent } from 'react';
import { allowsViewerParameter } from '@/document/relations';
import type { NodePatch, SceneNode } from '@/document/types';
import { resizeVector, vectorEndpoints, vectorGeometry } from '@/document/vectorGeometry';
import {DynamicStyleControls} from './DynamicStyleControls';
import './dynamicNodes.css';

export function VectorLine({ node, onCommit, onSelect, onPreview, endOnly, canDragStart, canDragEnd, progress = 1 }: {
  node: SceneNode;
  onCommit?: (patch: NodePatch) => void;
  onSelect?: () => void;
  onPreview?: (patch: ReturnType<typeof vectorGeometry>) => void;
  endOnly?: boolean;
  canDragStart?: boolean;
  canDragEnd?: boolean;
  progress?: number;
}) {
  const marker = useId();
  const active = useRef<{ pointer: number; endpoint: 0 | 1; bounds: DOMRect; sx: number; sy: number; initial: ReturnType<typeof vectorEndpoints> } | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof vectorGeometry>>(null);
  if (progress <= 0) return null;
  const pointFromEvent = (event: PointerEvent<SVGSVGElement>) => {
    const drag = active.current;
    if (!drag || drag.pointer !== event.pointerId) return null;
    const points = [...drag.initial] as typeof drag.initial;
    const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));
    points[drag.endpoint] = [
      clamp(event.clientX - drag.bounds.left, drag.bounds.width) / drag.sx,
      clamp(event.clientY - drag.bounds.top, drag.bounds.height) / drag.sy,
    ];
    return vectorGeometry(points[0], points[1], node.height);
  };
  const shown = draft ? { ...node, ...draft } : node;
  const [start, rawEnd] = vectorEndpoints(shown);
  const end: [number, number] = progress >= 1
    ? rawEnd
    : [start[0] + (rawEnd[0] - start[0]) * progress, start[1] + (rawEnd[1] - start[1]) * progress];
  const color = node.style.stroke ?? '#167abc';
  const lineWidth = node.style.stroke_width ?? 3;
  const dash = node.style.line_style === 'dashed' ? '9 6' : node.style.line_style === 'dotted' ? '1 5' : undefined;
  return <svg aria-label={node.name} data-vector-node={node.id} data-no-pan
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible',
      pointerEvents: 'none', zIndex: Math.floor(node.z) + 10001, opacity: node.opacity }}
    onPointerMove={event => {
      if (active.current?.pointer !== event.pointerId) return;
      const patch = pointFromEvent(event);
      setDraft(patch);
      onPreview?.(patch);
    }}
    onPointerUp={event => {
      if (active.current?.pointer !== event.pointerId) return;
      const patch = pointFromEvent(event);
      active.current = null;
      setDraft(null);
      onPreview?.(null);
      if (patch) onCommit?.(patch);
    }}
    onLostPointerCapture={() => { active.current = null; setDraft(null); onPreview?.(null); }}>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="3" markerHeight="3"
      orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill={color}/></marker></defs>
    <line data-vector-stroke x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]}
      className={node.flow?.enabled?'sceneFlow':undefined}
      style={{animationDuration:`${1/(node.flow?.speed??1)}s`}}
      stroke={color} strokeWidth={lineWidth} strokeDasharray={dash??(node.flow?.enabled?'9 6':undefined)} strokeLinecap="round"
      markerStart={node.style.arrow_start ? `url(#${marker})` : undefined}
      markerEnd={node.style.arrow_end ? `url(#${marker})` : undefined}/>
    {onSelect && <line data-vector-select x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]}
      stroke="transparent" strokeWidth={Math.max(16, lineWidth)}
      style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
      onPointerDown={event => { event.stopPropagation(); onSelect(); }}/>}
    {onCommit && ([0, 1] as const).filter(index => index === 0 ? (canDragStart ?? !endOnly) : (canDragEnd ?? true)).map(index => <circle key={index}
      aria-label={index === 0 ? '拖动起点' : '拖动终点'}
      cx={(index === 0 ? start : end)[0]} cy={(index === 0 ? start : end)[1]}
      r={8} fill="none" stroke={color} strokeWidth={2}
      style={{ pointerEvents: 'all', cursor: 'grab', touchAction: 'none' }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        const svg = event.currentTarget.ownerSVGElement;
        if (!svg || !svg.clientWidth || !svg.clientHeight) return;
        const bounds = svg.getBoundingClientRect();
        event.stopPropagation();
        event.preventDefault();
        active.current = { pointer: event.pointerId, endpoint: index, initial: vectorEndpoints(node),
          bounds, sx: bounds.width / svg.clientWidth, sy: bounds.height / svg.clientHeight };
        svg.setPointerCapture(event.pointerId);
      }}/>)}
  </svg>;
}

export function VectorControls({ node, onPatch, full = false, author = full }: {
  node: SceneNode; onPatch: (patch: NodePatch, key?: string) => void; full?: boolean; author?: boolean;
}) {
  const number = (label: string, value: number, min: number, max: number, apply: (value: number) => void) =>
    <label>{label}<input type="number" aria-label={label} min={min} max={max} step=".1"
      value={Number(value.toFixed(2))} onChange={event => {
        const next = event.currentTarget.valueAsNumber;
        if (Number.isFinite(next) && next >= min && next <= max) apply(next);
      }}/></label>;
  const canLength = allowsViewerParameter(node, 'length', author);
  const canAngle = allowsViewerParameter(node, 'angle', author);
  const canStrokeWidth = full || allowsViewerParameter(node, 'stroke_width', author);
  return <>
    {canLength && number('线长', node.width, .1, 20000, value => {
      const patch = resizeVector(node, value);
      if (patch) onPatch(patch, 'vector.length');
    })}
    {canAngle && number('线条角度', node.rotation, -360, 360, value => {
      const patch = resizeVector(node, node.width, value);
      if (patch) onPatch(patch, 'vector.angle');
    })}
    <DynamicStyleControls node={node} onPatch={onPatch} author={author}/>
    {canStrokeWidth && number('线宽', node.style.stroke_width ?? 3, .1, 100, value => onPatch({ style: { stroke_width: value } }, 'vector.stroke'))}
    {full && <>
      <label><input type="checkbox" checked={node.style.arrow_start ?? false}
        onChange={event => onPatch({ style: { arrow_start: event.target.checked } })}/>起点箭头</label>
      <label><input type="checkbox" checked={node.style.arrow_end ?? false}
        onChange={event => onPatch({ style: { arrow_end: event.target.checked } })}/>终点箭头</label>
      <label>滑块联动<select aria-label="滑块联动" value={node.style.bind_mode ?? 'none'}
        onChange={event => onPatch({ style: { bind_mode: event.target.value as 'none' | 'scale' | 'rotate' } }, 'vector.bind')}>
        <option value="none">不绑定滑块</option>
        <option value="scale">随倍率滑块伸缩</option>
        <option value="rotate">随角度滑块旋转</option>
      </select></label>
      <label>动画步序<select aria-label="动画步序" value={String(node.style.anim_step ?? 0)}
        onChange={event => onPatch({ style: { anim_step: Number(event.target.value) } }, 'vector.step')}>
        <option value="0">始终显示</option>
        {[1, 2, 3, 4, 5, 6].map(step => <option key={step} value={step}>第 {step} 步生长</option>)}
      </select></label>
    </>}
  </>;
}

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { clamp, formatNumber } from '../../../labs/expr';
import type { SliceBand, SliceModel, SurfacePoint } from '../../../labs/walkthrough';
import styles from './primitives.module.css';

interface SurfaceCanvasProps {
  model: SliceModel;
  bands: SliceBand[];
  band: SliceBand;
  h: number;
  onMoveSlice?: (h: number) => void;
  showAreaElement?: boolean;
}

type View = { yaw: number; pitch: number };
type ScreenPoint = { x: number; y: number; depth: number };
type Drag = { id: number; x: number; y: number } & ({ view: View } | { h: number; scale: number });

const FAMILY_LABEL = {
  sphere: '球面', hemisphere: '半球面', cylinder: '柱面', cone: '锥面', paraboloid: '抛物面',
  volume_solid: '旋转体', double_region: '积分区域',
} as const;
const TURN = 2 * Math.PI;
const SECTORS = 36;

function makeProjector(width: number, height: number, extent: number, center: number, view: View) {
  const scale = Math.min(width * 0.31, height * 0.36) / extent;
  const cosY = Math.cos(view.yaw);
  const sinY = Math.sin(view.yaw);
  const cosP = Math.cos(view.pitch);
  const sinP = Math.sin(view.pitch);
  const depth = ({ x, y, z }: SurfacePoint) => (x * sinY + y * cosY) * cosP + z * sinP;
  const point = ({ x, y, z }: SurfacePoint): ScreenPoint => ({
    x: width / 2 + (x * cosY - y * sinY) * scale,
    y: height * 0.52 + (-(z - center) * cosP + (x * sinY + y * cosY) * sinP) * scale,
    depth: depth({ x, y, z: z - center }),
  });
  return { scale, point, depth };
}

function trace(ctx: CanvasRenderingContext2D, points: ScreenPoint[], closed = false) {
  const [first, ...rest] = points;
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (const point of rest) ctx.lineTo(point.x, point.y);
  if (closed) ctx.closePath();
}

function drawVector(
  ctx: CanvasRenderingContext2D,
  project: (point: SurfacePoint) => ScreenPoint,
  origin: SurfacePoint,
  vector: SurfacePoint,
  extent: number,
  color: string,
  label: string,
) {
  const magnitude = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(magnitude) || magnitude < 1e-8) return;
  const length = (extent * 0.37) / magnitude;
  const from = project(origin);
  const to = project({ x: origin.x + vector.x * length, y: origin.y + vector.y * length, z: origin.z + vector.z * length });
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  for (const side of [-1, 1]) {
    const tipAngle = angle + side * Math.PI / 6;
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - 7 * Math.cos(tipAngle), to.y - 7 * Math.sin(tipAngle));
  }
  ctx.stroke();
  ctx.fillText(label, to.x + 5, to.y - 3);
}

export function SurfaceCanvas({ model, bands, band, h, onMoveSlice, showAreaElement }: SurfaceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<(ScreenPoint & { scale: number }) | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [size, setSize] = useState({ width: 640, height: 420 });
  const [view, setView] = useState<View>({ yaw: -0.62, pitch: 0.42 });
  const { family, lower, upper, orientation, scale } = model.geometry;
  const span = upper - lower;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function resize() {
      const rect = canvas!.getBoundingClientRect();
      if (rect.width && rect.height) setSize({ width: rect.width, height: rect.height });
    }
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width, height } = size;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const extent = Math.max(scale, span / 2, ...model.exactPoints.map(({ z }) => model.radius(z)));
    const projector = makeProjector(width, height, extent, lower + span / 2, view);
    const project = projector.point;
    const circle = (z: number) => {
      const radius = model.radius(z);
      return Array.from({ length: SECTORS }, (_, i) => {
        const angle = (i * TURN) / SECTORS;
        return project({ x: radius * Math.cos(angle), y: radius * Math.sin(angle), z });
      });
    };
    const faces = [];
    const subdivisions = Math.max(1, Math.ceil(36 / bands.length));
    for (const row of bands) {
      let previous = circle(row.lower);
      for (let i = 1; i <= subdivisions; i += 1) {
        const next = circle(row.lower + ((row.upper - row.lower) * i) / subdivisions);
        for (let sector = 0; sector < SECTORS; sector += 1) {
          const across = (sector + 1) % SECTORS;
          const points = [previous[sector]!, previous[across]!, next[across]!, next[sector]!];
          const depth = points.reduce((sum, point) => sum + point.depth / 4, 0);
          const light = 0.1 + 0.15 * Math.max(0, Math.sin(((sector + 0.5) * TURN) / SECTORS + view.yaw));
          faces.push({ points, depth, light, selected: row.index === band.index, alternate: row.index % 2 === 0 });
        }
        previous = next;
      }
    }
    faces.sort((a, b) => a.depth - b.depth);
    ctx.lineWidth = 0.65;
    for (const face of faces) {
      trace(ctx, face.points, true);
      ctx.fillStyle = face.selected
        ? `rgba(255, 122, 89, ${face.light * 2.6})`
        : `rgba(110, 157, 228, ${face.light * (face.alternate ? 0.9 : 0.55)})`;
      ctx.strokeStyle = face.selected ? 'rgba(255, 190, 162, 0.32)' : 'rgba(166, 200, 255, 0.15)';
      ctx.fill();
      ctx.stroke();
    }

    const patch = showAreaElement ? faces.filter((face) => face.selected).at(-1) : undefined;
    if (patch) {
      trace(ctx, patch.points, true);
      ctx.fillStyle = 'rgba(255, 214, 102, 0.76)';
      ctx.strokeStyle = '#ffe3a1';
      ctx.lineWidth = 1.1;
      ctx.fill();
      ctx.stroke();
      const corner = patch.points[0]!;
      ctx.font = '12px Consolas, monospace';
      ctx.fillStyle = '#ffe3a1';
      ctx.fillText('dS', corner.x + 4, corner.y - 6);
    }

    const plane = circle(h);
    const innerR = model.innerRadius(h);
    trace(ctx, plane, true);
    ctx.fillStyle = family === 'volume_solid' ? 'rgba(255, 168, 128, 0.28)' : 'rgba(112, 205, 255, 0.11)';
    ctx.strokeStyle = family === 'volume_solid' ? 'rgba(255, 184, 148, 0.92)' : 'rgba(132, 221, 255, 0.76)';
    ctx.lineWidth = family === 'volume_solid' ? 2 : 1.6;
    ctx.fill();
    ctx.stroke();

    if (family === 'volume_solid' && innerR > extent * 1e-4) {
      const innerPlane = Array.from({ length: SECTORS + 1 }, (_, step) => {
        const theta = (step / SECTORS) * TURN;
        return project({ x: innerR * Math.cos(theta), y: innerR * Math.sin(theta), z: h });
      });
      trace(ctx, innerPlane, true);
      ctx.fillStyle = 'rgba(19, 32, 54, 0.72)';
      ctx.strokeStyle = 'rgba(132, 221, 255, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    }

    const axisTop = project({ x: 0, y: 0, z: upper + span * 0.08 });
    const axisBottom = project({ x: 0, y: 0, z: lower - span * 0.08 });
    trace(ctx, [axisBottom, axisTop]);
    ctx.strokeStyle = 'rgba(173, 196, 230, 0.48)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = '12px Consolas, monospace';
    ctx.fillStyle = '#c4d8f5';
    ctx.fillText(model.geometry.axis ?? 'z', axisTop.x + 6, axisTop.y + 4);

    const radius = model.radius(h);
    const theta = Math.PI / 4 - view.yaw;
    const sample = { x: radius * Math.cos(theta), y: radius * Math.sin(theta), z: h };
    const vector = model.fieldAt(sample);
    if (vector && radius > extent * 1e-6) {
      const before = Math.max(lower, h - span * 0.001);
      const after = Math.min(upper, h + span * 0.001);
      const slope = (model.radius(after) - model.radius(before)) / (after - before);
      drawVector(ctx, project, sample, {
        x: orientation * Math.cos(theta), y: orientation * Math.sin(theta), z: -orientation * slope,
      }, extent, '#7fe3ff', orientation === 1 ? 'n' : '−n');
      drawVector(ctx, project, sample, vector, extent, '#ffb347', 'F');
    }

    const handle = plane.reduce((right, point) => point.x > right.x ? point : right, plane[0]!);
    handleRef.current = { ...handle, scale: projector.scale * Math.cos(view.pitch) };
    trace(ctx, [project({ x: 0, y: 0, z: h }), handle]);
    ctx.strokeStyle = 'rgba(180, 225, 255, 0.66)';
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(handle.x, handle.y, 7, 0, TURN);
    ctx.fillStyle = '#ff9d82';
    ctx.fill();
    ctx.strokeStyle = '#172741';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(handle.x, handle.y, 12, 0, TURN);
    ctx.strokeStyle = 'rgba(255, 157, 130, 0.42)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#ffcec0';
    ctx.fillText(`h = ${formatNumber(h, 2)}`, handle.x + 14, handle.y + 4);
  }, [band, bands, h, lower, model, orientation, scale, showAreaElement, size, span, upper, view]);

  function isAtHandle(event: PointerEvent<HTMLCanvasElement>) {
    if (!handleRef.current || !onMoveSlice) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.hypot(event.clientX - rect.left - handleRef.current.x, event.clientY - rect.top - handleRef.current.y) <= 20;
  }

  return (
    <div className={styles.surface}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label={`${FAMILY_LABEL[family]}，高度 ${formatNumber(h, 2)}，当前第 ${band.index + 1} 个环带。方向键旋转。${onMoveSlice ? 'Page Up 或 Page Down 移动截面。' : ''}`}
        onPointerDown={(event) => {
          if (event.button !== 0 || dragRef.current) return;
          const start = { id: event.pointerId, x: event.clientX, y: event.clientY };
          dragRef.current = isAtHandle(event) && handleRef.current
            ? { ...start, h, scale: handleRef.current.scale }
            : { ...start, view };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.style.cursor = 'grabbing';
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) {
            event.currentTarget.style.cursor = isAtHandle(event) ? 'ns-resize' : 'grab';
            return;
          }
          if (drag.id !== event.pointerId) return;
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          if ('h' in drag) onMoveSlice?.(clamp(drag.h - dy / drag.scale, lower, upper));
          else setView({ yaw: drag.view.yaw + dx * 0.01, pitch: clamp(drag.view.pitch + dy * 0.008, 0.08, 1.15) });
        }}
        onLostPointerCapture={(event) => {
          if (event.pointerId !== dragRef.current?.id) return;
          dragRef.current = null;
          event.currentTarget.style.cursor = 'grab';
        }}
        onKeyDown={(event) => {
          const turns: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
          const turn = turns[event.key];
          if (turn) {
            event.preventDefault();
            setView(({ yaw, pitch }) => ({ yaw: yaw + turn[0] * 0.13, pitch: clamp(pitch + turn[1] * 0.08, 0.08, 1.15) }));
          } else if (onMoveSlice && (event.key === 'PageUp' || event.key === 'PageDown')) {
            event.preventDefault();
            onMoveSlice(clamp(h + (event.key === 'PageUp' ? 1 : -1) * span / 100, lower, upper));
          }
        }}
      />
      <p className={styles.canvasHint}>{onMoveSlice ? '拖动橙色圆点移动截面 · ' : ''}拖动画面旋转</p>
    </div>
  );
}

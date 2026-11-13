import { useEffect, useRef, useState } from 'react';
import {
  findField,
  findScalar,
  type FieldKey,
  type IntegralKind,
  type ScalarKey,
  sliceRadius,
} from './surfaceMath';
import styles from './surfaceIntegral.module.css';

interface SurfaceCanvasProps {
  R: number;
  h: number;
  kind: IntegralKind;
  scalarKey: ScalarKey;
  fieldKey: FieldKey;
  orientation: 1 | -1;
  onMoveSlice: (h: number) => void;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Projected {
  x: number;
  y: number;
  depth: number;
}

interface Face {
  points: Projected[];
  depth: number;
  zMin: number;
  zMax: number;
  front: boolean;
  shade: number;
}

interface ViewState {
  yaw: number;
  pitch: number;
}

const LAT = 18;
const LON = 36;

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function makeProjector(width: number, height: number, R: number, view: ViewState) {
  const cx = width * 0.5;
  const cy = height * 0.56;
  const scale = Math.min(width * 0.31, height * 0.365) / R;
  const cosY = Math.cos(view.yaw);
  const sinY = Math.sin(view.yaw);
  const cosP = Math.cos(view.pitch);
  const sinP = Math.sin(view.pitch);
  const project = (point: Vec3): Projected => {
    const x1 = point.x * cosY - point.y * sinY;
    const y1 = point.x * sinY + point.y * cosY;
    return {
      x: cx + x1 * scale,
      y: cy - point.z * cosP * scale + y1 * sinP * scale,
      depth: y1 * cosP + point.z * sinP,
    };
  };
  const normalDepth = (n: Vec3): number => {
    const y1 = n.x * sinY + n.y * cosY;
    return y1 * cosP + n.z * sinP;
  };
  const projectVector = (origin: Vec3, vector: Vec3, length: number): [Projected, Projected] => {
    const unit = normalize(vector);
    const end: Vec3 = {
      x: origin.x + unit.x * length,
      y: origin.y + unit.y * length,
      z: origin.z + unit.z * length,
    };
    return [project(origin), project(end)];
  };
  return { project, normalDepth, projectVector, scale, cx, cy };
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: Projected,
  to: Projected,
  color: string,
  width = 2,
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  const size = 7;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 6), to.y - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 6), to.y - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function rgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function SurfaceCanvas({
  R,
  h,
  kind,
  scalarKey,
  fieldKey,
  orientation,
  onMoveSlice,
}: SurfaceCanvasProps): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 640, height: 430 });
  const [view, setView] = useState<ViewState>({ yaw: -0.62, pitch: 0.42 });
  const dragRef = useRef<
    | { mode: 'rotate'; startX: number; startY: number; yaw: number; pitch: number }
    | { mode: 'slice'; startY: number; startH: number; scale: number }
    | null
  >(null);
  const handleRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize((current) =>
        Math.abs(current.width - rect.width) < 1 && Math.abs(current.height - rect.height) < 1
          ? current
          : { width: Math.max(280, rect.width), height: Math.max(280, rect.height) },
      );
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(size.width * dpr);
    const pixelHeight = Math.round(size.height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const { project, normalDepth, projectVector, cx, cy } = makeProjector(
      size.width,
      size.height,
      R,
      view,
    );
    const scalar = findScalar(scalarKey);
    const field = findField(fieldKey);
    const bandHalf = Math.max(0.035, R * 0.055);

    const faces: Face[] = [];
    for (let latIndex = 0; latIndex < LAT; latIndex += 1) {
      const phi1 = -Math.PI / 2 + (Math.PI * latIndex) / LAT;
      const phi2 = -Math.PI / 2 + (Math.PI * (latIndex + 1)) / LAT;
      for (let lonIndex = 0; lonIndex < LON; lonIndex += 1) {
        const theta1 = (2 * Math.PI * lonIndex) / LON;
        const theta2 = (2 * Math.PI * (lonIndex + 1)) / LON;
        const vertices: Vec3[] = [
          { x: R * Math.cos(phi1) * Math.cos(theta1), y: R * Math.cos(phi1) * Math.sin(theta1), z: R * Math.sin(phi1) },
          { x: R * Math.cos(phi1) * Math.cos(theta2), y: R * Math.cos(phi1) * Math.sin(theta2), z: R * Math.sin(phi1) },
          { x: R * Math.cos(phi2) * Math.cos(theta2), y: R * Math.cos(phi2) * Math.sin(theta2), z: R * Math.sin(phi2) },
          { x: R * Math.cos(phi2) * Math.cos(theta1), y: R * Math.cos(phi2) * Math.sin(theta1), z: R * Math.sin(phi2) },
        ];
        const mid = {
          x: vertices.reduce((sum, v) => sum + v.x, 0) / 4,
          y: vertices.reduce((sum, v) => sum + v.y, 0) / 4,
          z: vertices.reduce((sum, v) => sum + v.z, 0) / 4,
        };
        const normal = normalize(mid);
        const points = vertices.map(project);
        const depth = points.reduce((sum, p) => sum + p.depth, 0) / 4;
        const front = normalDepth(normal) > 0;
        const light = Math.max(0, normal.x * -0.35 + normal.y * 0.25 + normal.z * 0.9);
        const zValues = vertices.map((vertex) => vertex.z);
        faces.push({
          points,
          depth,
          zMin: Math.min(...zValues),
          zMax: Math.max(...zValues),
          front,
          shade: 0.12 + light * 0.22,
        });
      }
    }
    faces.sort((a, b) => a.depth - b.depth);

    // 球面本体
    for (const face of faces) {
      const inBand = face.zMax >= h - bandHalf && face.zMin <= h + bandHalf;
      ctx.beginPath();
      face.points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.closePath();
      if (inBand) {
        ctx.fillStyle = face.front ? 'rgba(255, 122, 89, 0.66)' : 'rgba(255, 122, 89, 0.22)';
        ctx.strokeStyle = face.front ? 'rgba(255, 196, 176, 0.6)' : 'rgba(255, 160, 136, 0.2)';
        ctx.lineWidth = 0.7;
      } else {
        ctx.fillStyle = face.front
          ? rgba('#6e8bd6', face.shade)
          : 'rgba(70, 96, 148, 0.055)';
        ctx.strokeStyle = face.front
          ? 'rgba(154, 190, 255, 0.16)'
          : 'rgba(120, 150, 205, 0.06)';
        ctx.lineWidth = 0.5;
      }
      ctx.fill();
      ctx.stroke();
    }

    // 截面圆盘
    const radius = sliceRadius(R, h);
    const planePoints: Projected[] = [];
    for (let index = 0; index <= 64; index += 1) {
      const theta = (2 * Math.PI * index) / 64;
      planePoints.push(project({ x: radius * Math.cos(theta), y: radius * Math.sin(theta), z: h }));
    }
    ctx.beginPath();
    planePoints.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(112, 205, 255, 0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(132, 221, 255, 0.75)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 半径
    const radiusEnd = project({ x: radius, y: 0, z: h });
    const radiusOrigin = project({ x: 0, y: 0, z: h });
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(180, 225, 255, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(radiusOrigin.x, radiusOrigin.y);
    ctx.lineTo(radiusEnd.x, radiusEnd.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(203, 236, 255, 0.9)';
    ctx.font = '11px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(`r = ${radius.toFixed(2)}`, (radiusOrigin.x + radiusEnd.x) / 2, radiusOrigin.y - 7);

    // 法向与场向量采样点
    const sampleTheta = -0.75;
    const sample = {
      x: radius * Math.cos(sampleTheta),
      y: radius * Math.sin(sampleTheta),
      z: h,
    };
    const normal = normalize({ x: sample.x / (R * R), y: sample.y / (R * R), z: sample.z / (R * R) });
    const outwardNormal = orientation === 1 ? normal : { x: -normal.x, y: -normal.y, z: -normal.z };
    const [fieldX, fieldY, fieldZ] = field.vectorAt(sample.x, sample.y, sample.z);
    const fieldVector: Vec3 = { x: fieldX, y: fieldY, z: fieldZ };
    const fieldMagnitude = Math.hypot(fieldVector.x, fieldVector.y, fieldVector.z);

    const [normalFrom, normalTo] = projectVector(sample, outwardNormal, R * 0.46);
    drawArrow(ctx, normalFrom, normalTo, 'rgba(127, 227, 255, 0.95)', 1.8);
    ctx.fillStyle = 'rgba(160, 236, 255, 0.95)';
    ctx.font = '600 11px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(orientation === 1 ? 'n' : '−n', normalTo.x + 6, normalTo.y - 4);

    if (fieldMagnitude > 1e-6) {
      const [fieldFrom, fieldTo] = projectVector(sample, fieldVector, R * 0.5);
      drawArrow(ctx, fieldFrom, fieldTo, 'rgba(255, 179, 71, 0.95)', 2);
      ctx.fillStyle = 'rgba(255, 205, 140, 0.95)';
      ctx.fillText('F', fieldTo.x + 6, fieldTo.y - 4);
    }

    // 面积微元高亮：取当前环带中一个面片，标出 dS
    if (Math.abs(h) < R * 0.92) {
      const patch = faces
        .filter((face) => face.front && face.zMax >= h - bandHalf * 1.05 && face.zMin <= h + bandHalf * 1.05)
        .sort((a, b) => b.depth - a.depth)[0];
      if (patch) {
        const center = patch.points.reduce(
          (acc, point) => ({ x: acc.x + point.x / patch.points.length, y: acc.y + point.y / patch.points.length }),
          { x: 0, y: 0 },
        );
        ctx.beginPath();
        patch.points.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 214, 102, 0.7)';
        ctx.fill();
        ctx.strokeStyle = '#ffe3a1';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 227, 161, 0.65)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(center.x + 34, center.y - 26);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffe3a1';
        ctx.font = '600 11px "JetBrains Mono", Consolas, monospace';
        ctx.fillText('dS', center.x + 38, center.y - 24);
      }
    }

    // 拖动截面把手：取截面圆在屏幕上最右的点
    let handle = planePoints[0] ?? { x: cx, y: cy, depth: 0 };
    for (const point of planePoints) if (point.x > handle.x) handle = point;
    handleRef.current = { x: handle.x, y: handle.y };
    ctx.beginPath();
    ctx.arc(handle.x, handle.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#ff9d82';
    ctx.fill();
    ctx.strokeStyle = '#1a2740';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(handle.x, handle.y, 12, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 157, 130, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 206, 192, 0.9)';
    ctx.font = '10px "Inter", "Microsoft YaHei", sans-serif';
    ctx.fillText('拖动截面', handle.x + 16, handle.y + 3);

    // 坐标轴
    const zAxisBottom = project({ x: 0, y: 0, z: -R * 1.28 });
    const zAxisTop = project({ x: 0, y: 0, z: R * 1.3 });
    ctx.strokeStyle = 'rgba(173, 196, 230, 0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(zAxisBottom.x, zAxisBottom.y);
    ctx.lineTo(zAxisTop.x, zAxisTop.y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(196, 216, 245, 0.72)';
    ctx.font = '11px "JetBrains Mono", Consolas, monospace';
    ctx.fillText('z', zAxisTop.x + 6, zAxisTop.y + 4);
    ctx.fillText(`h = ${h.toFixed(2)}`, zAxisTop.x + 6, zAxisTop.y + 20);

    // 高度标记线
    const planeRight = project({ x: R * 1.18, y: 0, z: h });
    const planeLeft = project({ x: -R * 1.18, y: 0, z: h });
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = 'rgba(127, 227, 255, 0.22)';
    ctx.beginPath();
    ctx.moveTo(planeLeft.x, planeLeft.y);
    ctx.lineTo(planeRight.x, planeRight.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 结论小标：当前微元贡献
    const value =
      kind === 'scalar'
        ? scalar.valueAt(h, R)
        : orientation * field.normalDot(h, R);
    ctx.fillStyle = 'rgba(8, 18, 33, 0.72)';
    ctx.fillRect(14, 14, 178, 44);
    ctx.strokeStyle = 'rgba(126, 158, 205, 0.3)';
    ctx.strokeRect(14.5, 14.5, 177, 43);
    ctx.fillStyle = 'rgba(190, 212, 240, 0.85)';
    ctx.font = '10px "Inter", "Microsoft YaHei", sans-serif';
    ctx.fillText(kind === 'scalar' ? '环带上的被积函数' : '环带上的 F · n', 24, 32);
    ctx.fillStyle = '#ffd166';
    ctx.font = '600 15px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(value.toFixed(3), 24, 51);

    // 图例
    const legendX = size.width - 132;
    const legendY = 14;
    ctx.fillStyle = 'rgba(7, 17, 30, 0.55)';
    ctx.fillRect(legendX - 10, legendY - 14, 128, 46);
    ctx.strokeStyle = 'rgba(126, 158, 205, 0.25)';
    ctx.strokeRect(legendX - 9.5, legendY - 13.5, 127, 45);
    ctx.strokeStyle = 'rgba(127, 227, 255, 0.9)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(legendX, legendY - 1);
    ctx.lineTo(legendX + 18, legendY - 1);
    ctx.stroke();
    ctx.fillStyle = 'rgba(176, 232, 255, 0.9)';
    ctx.font = '10px "Inter", "Microsoft YaHei", sans-serif';
    ctx.fillText(orientation === 1 ? 'n 外法向' : 'n 内法向', legendX + 24, legendY + 3);
    ctx.strokeStyle = 'rgba(255, 179, 71, 0.95)';
    ctx.beginPath();
    ctx.moveTo(legendX, legendY + 15);
    ctx.lineTo(legendX + 18, legendY + 15);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 205, 140, 0.9)';
    ctx.fillText('F 场向量', legendX + 24, legendY + 19);
  }, [size, view, R, h, kind, scalarKey, fieldKey, orientation]);

  const localPoint = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const point = localPoint(event);
    const handle = handleRef.current;
    const nearHandle =
      handle !== null && Math.hypot(point.x - handle.x, point.y - handle.y) <= 18;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (nearHandle) {
      const scale = Math.min(size.width * 0.31, size.height * 0.365) / R;
      dragRef.current = { mode: 'slice', startY: event.clientY, startH: h, scale };
      event.currentTarget.style.cursor = 'grabbing';
    } else {
      dragRef.current = {
        mode: 'rotate',
        startX: event.clientX,
        startY: event.clientY,
        yaw: view.yaw,
        pitch: view.pitch,
      };
      event.currentTarget.style.cursor = 'grabbing';
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    if (!drag) {
      const point = localPoint(event);
      const handle = handleRef.current;
      const nearHandle =
        handle !== null && Math.hypot(point.x - handle.x, point.y - handle.y) <= 18;
      event.currentTarget.style.cursor = nearHandle ? 'ns-resize' : 'grab';
      return;
    }
    if (drag.mode === 'slice') {
      const next = drag.startH - (event.clientY - drag.startY) / drag.scale;
      onMoveSlice(Math.max(-R * 0.999, Math.min(R * 0.999, next)));
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    setView({
      yaw: drag.yaw + dx * 0.008,
      pitch: Math.max(0.08, Math.min(1.15, drag.pitch + dy * 0.006)),
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.currentTarget.style.cursor = 'grab';
  };

  return (
    <div className={styles.canvasWrap} ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        style={{ width: '100%', height: '100%', touchAction: 'none', cursor: 'grab' }}
        role="img"
        aria-label={`半径 ${R.toFixed(2)} 的球面，截面高度 ${h.toFixed(2)}；可拖动橙色圆点移动截面，拖动空白处旋转视角。`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={(event) => {
          if (dragRef.current === null) event.currentTarget.style.cursor = 'grab';
        }}
      />
      <p className={styles.canvasHint}>
        拖动橙色圆点移动截面 · 拖动画面旋转视角
      </p>
    </div>
  );
}

export default SurfaceCanvas;

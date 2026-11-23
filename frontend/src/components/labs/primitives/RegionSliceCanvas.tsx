import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { clamp, formatNumber } from '../../../labs/expr';
import type { SliceBand, SliceModel } from '../../../labs/walkthrough';
import styles from './primitives.module.css';

interface RegionSliceCanvasProps {
  model: SliceModel;
  bands: SliceBand[];
  band: SliceBand;
  h: number;
  onMoveSlice?: (h: number) => void;
}

/** 二重积分 2D 区域与可拖动条带切片原语（支持 X-型竖直条带与 Y-型水平条带）。 */
export function RegionSliceCanvas({ model, bands, band, h, onMoveSlice }: RegionSliceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 640, height: 380 });
  const region = model.geometry.region;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width && rect.height) setSize({ width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, []);

  const pad = { left: 54, right: 28, top: 28, bottom: 44 };
  const plotW = Math.max(120, size.width - pad.left - pad.right);
  const plotH = Math.max(120, size.height - pad.top - pad.bottom);

  const isXOuter = region?.order !== 'y_outer';
  const outerMin = region?.outer_lower ?? model.geometry.lower;
  const outerMax = region?.outer_upper ?? model.geometry.upper;
  const innerMin = region?.inner_min ?? 0;
  const innerMax = region?.inner_max ?? 1;

  const xMinRaw = isXOuter ? outerMin : innerMin;
  const xMaxRaw = isXOuter ? outerMax : innerMax;
  const yMinRaw = isXOuter ? innerMin : outerMin;
  const yMaxRaw = isXOuter ? innerMax : outerMax;
  const xSpan = Math.max(1e-3, xMaxRaw - xMinRaw);
  const ySpan = Math.max(1e-3, yMaxRaw - yMinRaw);
  const xMin = xMinRaw - xSpan * 0.14;
  const xMax = xMaxRaw + xSpan * 0.14;
  const yMin = yMinRaw - ySpan * 0.14;
  const yMax = yMaxRaw + ySpan * 0.14;

  const toX = (x: number) => pad.left + ((x - xMin) / (xMax - xMin)) * plotW;
  const toY = (y: number) => pad.top + ((yMax - y) / (yMax - yMin)) * plotH;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !region) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 深色数学舞台背景
    ctx.fillStyle = '#0f1b2e';
    ctx.fillRect(0, 0, size.width, size.height);

    // 绘制网格与坐标轴
    ctx.strokeStyle = 'rgba(148, 178, 220, 0.14)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const gx = pad.left + (plotW * i) / 4;
      const gy = pad.top + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(gx, pad.top);
      ctx.lineTo(gx, pad.top + plotH);
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(pad.left + plotW, gy);
      ctx.stroke();
    }

    // 坐标轴 x=0, y=0（若在视野内）
    ctx.strokeStyle = 'rgba(196, 216, 245, 0.5)';
    ctx.lineWidth = 1.2;
    if (xMin <= 0 && xMax >= 0) {
      const x0 = toX(0);
      ctx.beginPath();
      ctx.moveTo(x0, pad.top);
      ctx.lineTo(x0, pad.top + plotH);
      ctx.stroke();
    }
    if (yMin <= 0 && yMax >= 0) {
      const y0 = toY(0);
      ctx.beginPath();
      ctx.moveTo(pad.left, y0);
      ctx.lineTo(pad.left + plotW, y0);
      ctx.stroke();
    }

    // 采样积分区域 D 的上下边界并填充区域
    const samples = 96;
    const upperPts: [number, number][] = [];
    const lowerPts: [number, number][] = [];
    for (let i = 0; i <= samples; i += 1) {
      const t = outerMin + ((outerMax - outerMin) * i) / samples;
      const b = model.regionBounds(t);
      if (!b) continue;
      if (isXOuter) {
        upperPts.push([toX(t), toY(b.upper)]);
        lowerPts.push([toX(t), toY(b.lower)]);
      } else {
        upperPts.push([toX(b.upper), toY(t)]);
        lowerPts.push([toX(b.lower), toY(t)]);
      }
    }

    if (upperPts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(upperPts[0]![0], upperPts[0]![1]);
      for (const [px, py] of upperPts) ctx.lineTo(px, py);
      for (let i = lowerPts.length - 1; i >= 0; i -= 1) ctx.lineTo(lowerPts[i]![0], lowerPts[i]![1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(86, 178, 255, 0.16)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(132, 206, 255, 0.85)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // 绘制离散条带矩形
    for (const item of bands) {
      const b = model.regionBounds(item.midpoint);
      if (!b) continue;
      const isActive = item.index === band.index;
      ctx.fillStyle = isActive ? 'rgba(255, 157, 130, 0.52)' : 'rgba(112, 205, 255, 0.11)';
      ctx.strokeStyle = isActive ? '#ffb499' : 'rgba(132, 206, 255, 0.34)';
      ctx.lineWidth = isActive ? 1.8 : 0.9;
      if (isXOuter) {
        const x1 = toX(item.lower);
        const x2 = toX(item.upper);
        const yTop = toY(b.upper);
        const yBot = toY(b.lower);
        ctx.fillRect(x1, yTop, Math.max(1, x2 - x1), Math.max(1, yBot - yTop));
        ctx.strokeRect(x1, yTop, Math.max(1, x2 - x1), Math.max(1, yBot - yTop));
      } else {
        const yTop = toY(item.upper);
        const yBot = toY(item.lower);
        const x1 = toX(b.lower);
        const x2 = toX(b.upper);
        ctx.fillRect(x1, yTop, Math.max(1, x2 - x1), Math.max(1, yBot - yTop));
        ctx.strokeRect(x1, yTop, Math.max(1, x2 - x1), Math.max(1, yBot - yTop));
      }
    }

    // 绘制当前切片位置线与拖动手柄
    const curBounds = model.regionBounds(h);
    ctx.strokeStyle = '#ff9d82';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    if (isXOuter) {
      const xh = toX(h);
      ctx.moveTo(xh, pad.top);
      ctx.lineTo(xh, pad.top + plotH);
    } else {
      const yh = toY(h);
      ctx.moveTo(pad.left, yh);
      ctx.lineTo(pad.left + plotW, yh);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // 拖动手柄圆点
    const handleX = isXOuter ? toX(h) : toX(curBounds ? (curBounds.lower + curBounds.upper) / 2 : (xMinRaw + xMaxRaw) / 2);
    const handleY = isXOuter ? toY(curBounds ? (curBounds.lower + curBounds.upper) / 2 : (yMinRaw + yMaxRaw) / 2) : toY(h);
    ctx.beginPath();
    ctx.arc(handleX, handleY, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#ff9d82';
    ctx.fill();
    ctx.strokeStyle = '#172741';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 坐标轴与当前条带读数标注
    ctx.font = '12px Consolas, monospace';
    ctx.fillStyle = '#c4d8f5';
    ctx.fillText('x', pad.left + plotW + 10, pad.top + plotH + 4);
    ctx.fillText('y', pad.left - 12, pad.top - 8);
    ctx.fillStyle = '#ffcec0';
    ctx.fillText(
      `${region.outer_var} = ${formatNumber(h, 2)}`,
      Math.min(size.width - 110, handleX + 12),
      Math.max(22, handleY - 10),
    );
    ctx.fillStyle = 'rgba(196, 216, 245, 0.78)';
    ctx.fillText(formatNumber(xMinRaw, 2), toX(xMinRaw) - 10, pad.top + plotH + 20);
    ctx.fillText(formatNumber(xMaxRaw, 2), toX(xMaxRaw) - 10, pad.top + plotH + 20);
    ctx.fillText(formatNumber(yMinRaw, 2), 10, toY(yMinRaw) + 4);
    ctx.fillText(formatNumber(yMaxRaw, 2), 10, toY(yMaxRaw) + 4);
  }, [band, bands, h, isXOuter, model, outerMax, outerMin, plotH, plotW, region, size, xMax, xMin, xMaxRaw, xMinRaw, yMax, yMin, yMaxRaw, yMinRaw]);

  const pointerToH = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (isXOuter) {
      const px = event.clientX - rect.left;
      const x = xMin + ((px - pad.left) / plotW) * (xMax - xMin);
      return clamp(x, outerMin, outerMax);
    }
    const py = event.clientY - rect.top;
    const y = yMax - ((py - pad.top) / plotH) * (yMax - yMin);
    return clamp(y, outerMin, outerMax);
  };

  return (
    <div className={styles.surface}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label={`二维积分区域条带切片，${region?.outer_var ?? 'x'} = ${formatNumber(h, 2)}，第 ${band.index + 1} 条带`}
        style={{ cursor: onMoveSlice ? 'ew-resize' : 'default' }}
        onPointerDown={(event) => {
          if (!onMoveSlice || event.button !== 0) return;
          draggingRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          onMoveSlice(pointerToH(event));
        }}
        onPointerMove={(event) => {
          if (!onMoveSlice || draggingRef.current !== event.pointerId) return;
          onMoveSlice(pointerToH(event));
        }}
        onPointerUp={(event) => {
          if (draggingRef.current === event.pointerId) {
            draggingRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }
        }}
      />
      <div className={styles.hint}>
        {onMoveSlice ? '在区域内直接拖动条带改变切片位置' : '二维积分区域与当前条带切片'}
      </div>
    </div>
  );
}

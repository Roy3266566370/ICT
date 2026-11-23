import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { clamp, formatNumber } from '../../../labs/expr';
import type { LimitApproachModel } from '../../../labs/walkthrough';
import styles from './primitives.module.css';

interface ZoomCurveCanvasProps {
  model: LimitApproachModel;
  delta: number;
  zoom: number;
  showPrincipal?: boolean;
  onChangeDelta?: (next: number) => void;
}

/** 极限与导数局部缩放逼近原语：支持空心间断点、主部虚线、导数割线/切线及画布内拖动步长 δ。 */
export function ZoomCurveCanvas({
  model,
  delta,
  zoom,
  showPrincipal = false,
  onChangeDelta,
}: ZoomCurveCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 640, height: 360 });
  const { approach } = model;

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

  const pad = { left: 54, right: 26, top: 26, bottom: 40 };
  const plotW = Math.max(120, size.width - pad.left - pad.right);
  const plotH = Math.max(120, size.height - pad.top - pad.bottom);

  const halfX = Math.max(delta * 1.6, approach.span / Math.max(1, zoom));
  const xMin = approach.point - halfX;
  const xMax = approach.point + halfX;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 采样曲线点并动态确定 y 轴范围
    const samples = 180;
    const curvePts: Array<{ x: number; y: number | null }> = [];
    const principalPts: Array<{ x: number; y: number | null }> = [];
    const ys: number[] = [];

    const isDeriv = approach.kind === 'derivative';
    const evalY = (x: number) => (isDeriv ? model.curveAt(x) : model.targetAt(x));

    for (let i = 0; i <= samples; i += 1) {
      const x = xMin + ((xMax - xMin) * i) / samples;
      const nearHole = !isDeriv && Math.abs(x - approach.point) < halfX * 0.008;
      const y = nearHole ? null : evalY(x);
      curvePts.push({ x, y });
      if (y !== null && Math.abs(y) < 1e4) ys.push(y);
      if (showPrincipal && !isDeriv) {
        const py = model.principalAt(x);
        principalPts.push({ x, y: py });
        if (py !== null && Math.abs(py) < 1e4) ys.push(py);
      }
    }

    if (isDeriv && approach.f_at_point !== null) ys.push(approach.f_at_point);
    if (!isDeriv) ys.push(approach.exact_value);

    const rawMinY = ys.length ? Math.min(...ys) : -1;
    const rawMaxY = ys.length ? Math.max(...ys) : 1;
    const ySpan = Math.max(0.25, rawMaxY - rawMinY);
    const yMin = rawMinY - ySpan * 0.2;
    const yMax = rawMaxY + ySpan * 0.2;

    const toX = (x: number) => pad.left + ((x - xMin) / (xMax - xMin)) * plotW;
    const toY = (y: number) => pad.top + ((yMax - y) / (yMax - yMin)) * plotH;

    // 背景与网格
    ctx.fillStyle = '#0f1b2e';
    ctx.fillRect(0, 0, size.width, size.height);
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

    // 逼近点垂线 x = x0
    const x0Px = toX(approach.point);
    ctx.strokeStyle = 'rgba(255, 206, 128, 0.35)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x0Px, pad.top);
    ctx.lineTo(x0Px, pad.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    // 若为 limit 模式，画目标极限水平参考线 y = L
    if (!isDeriv) {
      const yLPx = toY(approach.exact_value);
      ctx.strokeStyle = 'rgba(116, 232, 184, 0.45)';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(pad.left, yLPx);
      ctx.lineTo(pad.left + plotW, yLPx);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 绘制主部近似曲线（虚线）
    if (showPrincipal && !isDeriv && principalPts.length > 1) {
      ctx.strokeStyle = 'rgba(255, 206, 128, 0.85)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      let started = false;
      for (const pt of principalPts) {
        if (pt.y === null) {
          started = false;
          continue;
        }
        const px = toX(pt.x);
        const py = toY(pt.y);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 绘制主函数曲线
    ctx.strokeStyle = '#7cd2ff';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    let started = false;
    for (const pt of curvePts) {
      if (pt.y === null) {
        started = false;
        continue;
      }
      const px = toX(pt.x);
      const py = toY(pt.y);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();

    // 导数模式：绘制切线（绿色虚线）与当前割线（珊瑚色实线）
    if (isDeriv && approach.f_at_point !== null) {
      const y0 = approach.f_at_point;
      const slope = approach.exact_value;
      ctx.strokeStyle = 'rgba(116, 232, 184, 0.85)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(toX(xMin), toY(y0 + slope * (xMin - approach.point)));
      ctx.lineTo(toX(xMax), toY(y0 + slope * (xMax - approach.point)));
      ctx.stroke();
      ctx.setLineDash([]);

      const rx = approach.point + delta;
      const ry = model.curveAt(rx);
      if (ry !== null) {
        const secSlope = (ry - y0) / delta;
        ctx.strokeStyle = '#ff9d82';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(toX(xMin), toY(y0 + secSlope * (xMin - approach.point)));
        ctx.lineTo(toX(xMax), toY(y0 + secSlope * (xMax - approach.point)));
        ctx.stroke();
      }
    }

    // 绘制 x0 处的空心圆（limit 间断点）或实心切点（derivative）
    const centerY = isDeriv ? (approach.f_at_point ?? 0) : approach.exact_value;
    ctx.beginPath();
    ctx.arc(x0Px, toY(centerY), 6, 0, Math.PI * 2);
    ctx.fillStyle = isDeriv ? '#74e8b8' : '#0f1b2e';
    ctx.fill();
    ctx.strokeStyle = '#74e8b8';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // 绘制左右采样点 x0 - δ, x0 + δ
    const drawSampleDot = (sx: number, label: string, color: string) => {
      const sy = evalY(sx);
      if (sy === null) return;
      const px = toX(sx);
      const py = toY(sy);
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#172741';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = '11px Consolas, monospace';
      ctx.fillStyle = color;
      ctx.fillText(label, px - 14, py - 10);
    };

    if (approach.direction !== 'right') drawSampleDot(approach.point - delta, 'x₀−δ', '#ffb86c');
    if (approach.direction !== 'left') drawSampleDot(approach.point + delta, 'x₀+δ', '#ff9d82');

    // 坐标刻度标注
    ctx.font = '12px Consolas, monospace';
    ctx.fillStyle = '#c4d8f5';
    ctx.fillText(formatNumber(xMin, 3), pad.left - 8, pad.top + plotH + 20);
    ctx.fillText(`x₀=${formatNumber(approach.point, 2)}`, x0Px - 20, pad.top + plotH + 20);
    ctx.fillText(formatNumber(xMax, 3), pad.left + plotW - 32, pad.top + plotH + 20);
    ctx.fillStyle = '#74e8b8';
    ctx.fillText(
      isDeriv ? `切线斜率=${formatNumber(approach.exact_value, 3)}` : `L=${formatNumber(approach.exact_value, 3)}`,
      pad.left + 8,
      pad.top + 16,
    );
  }, [approach, delta, halfX, model, plotH, plotW, showPrincipal, size, xMax, xMin, zoom]);

  const pointerToDelta = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const x = xMin + ((px - pad.left) / plotW) * (xMax - xMin);
    return clamp(Math.abs(x - approach.point), 0.005, 1.0);
  };

  return (
    <div className={styles.surface}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label={`局部缩放逼近曲线，逼近点 x0=${formatNumber(approach.point, 2)}，当前步长 δ=${formatNumber(delta, 4)}，放大倍率 ${formatNumber(zoom, 1)}`}
        style={{ cursor: onChangeDelta ? 'ew-resize' : 'default' }}
        onPointerDown={(event) => {
          if (!onChangeDelta || event.button !== 0) return;
          draggingRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          onChangeDelta(pointerToDelta(event));
        }}
        onPointerMove={(event) => {
          if (!onChangeDelta || draggingRef.current !== event.pointerId) return;
          onChangeDelta(pointerToDelta(event));
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
        {onChangeDelta ? '在画布上左右拖动采样点可实时收缩步长 δ' : '局部缩放逼近视图'}
      </div>
    </div>
  );
}

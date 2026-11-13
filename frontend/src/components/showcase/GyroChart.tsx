import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ForwardedRef,
} from 'react';

import { radToDeg, type GyroSetup, type SimulationSample } from './gyroMath';
import styles from './gyroscope.module.css';

export interface GyroChartApi {
  draw(
    history: readonly SimulationSample[],
    baseline: readonly SimulationSample[] | null,
    currentTime: number,
    markerTime: number | null,
    setup: GyroSetup,
  ): void;
}

interface GyroChartProps {
  label?: string;
}

function GyroChartInner(
  { label = '倾角随时间变化曲线' }: GyroChartProps,
  ref: ForwardedRef<GyroChartApi>,
): JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({width: 640, height: 190});

  const draw = (
    history: readonly SimulationSample[],
    baseline: readonly SimulationSample[] | null,
    currentTime: number,
    markerTime: number | null,
    setup: GyroSetup,
  ): void => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const {width, height} = sizeRef.current;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const plot = {x: 42, y: 16, w: Math.max(40, width - 58), h: Math.max(40, height - 44)};
    // 基准与当前运行都从 t=0 开始，横轴必须共享原点；否则长基准会把短运行挤出画布。
    const dataEnd = Math.max(
      history[history.length - 1]?.time ?? 0,
      baseline?.[baseline.length - 1]?.time ?? 0,
      currentTime,
      1,
    );
    const xMin = 0;
    const xMax = Math.max(8, dataEnd + 0.4);
    const yMax = 90;
    const xOf = (time: number): number =>
      plot.x + ((time - xMin) / (xMax - xMin)) * plot.w;
    const yOf = (theta: number): number =>
      plot.y + plot.h - (Math.min(yMax, Math.max(0, theta)) / yMax) * plot.h;

    ctx.save();
    ctx.font = '10px "JetBrains Mono", Consolas, monospace';
    ctx.textBaseline = 'middle';

    // 网格与刻度
    for (let index = 0; index <= 6; index += 1) {
      const y = plot.y + (plot.h * index) / 6;
      ctx.strokeStyle = index === 6 ? 'rgba(37, 43, 40, 0.18)' : 'rgba(37, 43, 40, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.w, y);
      ctx.stroke();
      const degrees = 90 - (90 * index) / 6;
      ctx.fillStyle = 'rgba(88, 99, 111, 0.78)';
      ctx.textAlign = 'right';
      ctx.fillText(`${degrees}°`, plot.x - 8, y);
    }
    for (let index = 0; index <= 4; index += 1) {
      const t = xMin + ((xMax - xMin) * index) / 4;
      const x = xOf(t);
      ctx.strokeStyle = 'rgba(37, 43, 40, 0.06)';
      ctx.beginPath();
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.h);
      ctx.stroke();
      ctx.fillStyle = 'rgba(88, 99, 111, 0.72)';
      ctx.textAlign = 'center';
      ctx.fillText(`${t.toFixed(1)}s`, x, plot.y + plot.h + 14);
    }

    ctx.fillStyle = 'rgba(88, 99, 111, 0.72)';
    ctx.textAlign = 'left';
    ctx.fillText('θ / °', plot.x, plot.y - 5);
    ctx.textAlign = 'right';
    ctx.fillText('t', plot.x + plot.w, plot.y - 5);

    // 基准曲线
    if (baseline !== null && baseline.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(182, 90, 60, 0.8)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      let started = false;
      for (const sample of baseline) {
        if (sample.time < xMin) continue;
        const x = xOf(sample.time);
        const y = yOf(radToDeg(sample.theta));
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // 当前曲线
    if (history.length > 1) {
      ctx.save();
      const gradient = ctx.createLinearGradient(plot.x, plot.y, plot.x + plot.w, plot.y);
      gradient.addColorStop(0, 'rgba(31, 93, 84, 0.55)');
      gradient.addColorStop(1, 'rgba(31, 93, 84, 0.95)');
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      for (const sample of history) {
        if (sample.time < xMin) continue;
        const x = xOf(sample.time);
        const y = yOf(radToDeg(sample.theta));
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // 扰动标记
    if (markerTime !== null && markerTime >= xMin && markerTime <= xMax) {
      const x = xOf(markerTime);
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 122, 89, 0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.h);
      ctx.stroke();
      ctx.fillStyle = 'rgba(142, 67, 44, 0.9)';
      ctx.textAlign = x > plot.x + plot.w * 0.75 ? 'right' : 'left';
      ctx.fillText('扰动', x + (x > plot.x + plot.w * 0.75 ? -4 : 4), plot.y + 10);
      ctx.restore();
    }

    // 当前时刻标记
    const currentVisible = currentTime >= xMin && currentTime <= xMax;
    if (currentVisible) {
      const currentSample = findNearest(history, currentTime);
      const x = xOf(currentTime);
      ctx.save();
      ctx.strokeStyle = 'rgba(37, 43, 40, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.h);
      ctx.stroke();
      if (currentSample !== null) {
        const y = yOf(radToDeg(currentSample.theta));
        ctx.fillStyle = '#1e5d54';
        ctx.beginPath();
        ctx.arc(x, y, 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(x, y, 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(37, 43, 40, 0.78)';
        ctx.textAlign = x > plot.x + plot.w - 70 ? 'right' : 'left';
        ctx.fillText(
          `θ ${radToDeg(currentSample.theta).toFixed(1)}°`,
          x + (x > plot.x + plot.w - 70 ? -7 : 7),
          plot.y + plot.h - 10,
        );
      }
      ctx.restore();
    }

    // 起始角与稳态参考线
    const initialY = yOf(radToDeg(setup.tilt));
    if (initialY >= plot.y && initialY <= plot.y + plot.h) {
      ctx.save();
      ctx.strokeStyle = 'rgba(182, 90, 60, 0.28)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(plot.x, initialY);
      ctx.lineTo(plot.x + plot.w, initialY);
      ctx.stroke();
      ctx.fillStyle = 'rgba(142, 67, 44, 0.62)';
      ctx.textAlign = 'right';
      ctx.fillText(`θ₀ ${radToDeg(setup.tilt).toFixed(1)}°`, plot.x + plot.w - 4, initialY - 7);
      ctx.restore();
    }

    ctx.restore();
  };

  useImperativeHandle(ref, () => ({draw}), []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap === null) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const {width, height} = entry.contentRect;
      sizeRef.current = {width: Math.max(260, width), height: Math.max(140, height)};
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.chartCanvasWrap} ref={wrapRef}>
      <canvas className={styles.chartCanvas} ref={canvasRef} role="img" aria-label={label} />
    </div>
  );
}

function findNearest(
  history: readonly SimulationSample[],
  time: number,
): SimulationSample | null {
  if (history.length === 0) return null;
  let closest: SimulationSample | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const sample of history) {
    const next = Math.abs(sample.time - time);
    if (next < distance) {
      closest = sample;
      distance = next;
    }
  }
  return closest;
}

export const GyroChart = forwardRef<GyroChartApi, GyroChartProps>(GyroChartInner);
export default GyroChart;

import { useEffect, useState } from 'react';

export interface PageFraction { x: number; y: number; w: number; h: number }

interface Pixels { data: Uint8ClampedArray; width: number; height: number }

const SAMPLE_WIDTH = 480;
const cache = new Map<string, Promise<Pixels | null>>();

function loadPixels(url: string): Promise<Pixels | null> {
  let task = cache.get(url);
  if (!task) {
    task = new Promise<Pixels | null>(resolve => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        try {
          const width = SAMPLE_WIDTH;
          const height = Math.max(1, Math.round(width * image.naturalHeight / Math.max(1, image.naturalWidth)));
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) return resolve(null);
          context.drawImage(image, 0, 0, width, height);
          resolve({ data: context.getImageData(0, 0, width, height).data, width, height });
        } catch { resolve(null); }
      };
      image.onerror = () => resolve(null);
      image.src = url;
    });
    cache.set(url, task);
  }
  return task;
}

const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 255;

/**
 * 取目标区域外一圈像素的中位色；圈内颜色离散（渐变、照片、复杂底）时返回 null，
 * 由调用方回退为带阴影的小卡片，避免盖出明显的色块边界。
 */
export function ringColor(pixels: Pixels, box: PageFraction): string | null {
  const { data, width, height } = pixels;
  const pad = 3;
  const left = Math.round(box.x * width) - pad, right = Math.round((box.x + box.w) * width) + pad;
  const top = Math.round(box.y * height) - pad, bottom = Math.round((box.y + box.h) * height) + pad;
  const samples: Array<[number, number, number]> = [];
  const take = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    samples.push([data[i]!, data[i + 1]!, data[i + 2]!]);
  };
  const steps = 14;
  for (let i = 0; i <= steps; i += 1) {
    const x = Math.round(left + (right - left) * i / steps), y = Math.round(top + (bottom - top) * i / steps);
    take(x, top); take(x, bottom); take(left, y); take(right, y);
  }
  if (samples.length < 8) return null;
  const channels = [0, 1, 2].map(c => samples.map(sample => sample[c]!));
  const spread = channels.map(values => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.9)]! - sorted[Math.floor(sorted.length * 0.1)]!;
  });
  if (Math.max(...spread) > 24) return null;
  const [r, g, b] = channels.map(values => median([...values]));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * 当外圈采样因紧邻图注文字或卡片边界而离散时，从区域内侧四角附近采样底色（避开中心图形与坐标轴）。
 */
export function insetCornerColor(pixels: Pixels, box: PageFraction): string | null {
  const { data, width, height } = pixels;
  const x0 = Math.max(0, Math.min(width - 1, Math.round(box.x * width)));
  const y0 = Math.max(0, Math.min(height - 1, Math.round(box.y * height)));
  const x1 = Math.max(x0 + 1, Math.min(width - 1, Math.round((box.x + box.w) * width)));
  const y1 = Math.max(y0 + 1, Math.min(height - 1, Math.round((box.y + box.h) * height)));
  const insetX = Math.max(2, Math.round((x1 - x0) * 0.06));
  const insetY = Math.max(2, Math.round((y1 - y0) * 0.06));
  const samples: Array<[number, number, number]> = [];
  const take = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    samples.push([data[i]!, data[i + 1]!, data[i + 2]!]);
  };
  const corners: Array<[number, number]> = [
    [x0 + insetX, y0 + insetY],
    [x1 - insetX, y0 + insetY],
    [x0 + insetX, y1 - insetY],
    [x1 - insetX, y1 - insetY],
  ];
  for (const [cx, cy] of corners) {
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) take(cx + dx, cy + dy);
    }
  }
  if (samples.length < 8) return null;
  const channels = [0, 1, 2].map(c => samples.map(sample => sample[c]!));
  const [r, g, b] = channels.map(values => median([...values]));
  return `rgb(${r}, ${g}, ${b})`;
}

/** 区域外圈底色；加载中、失败或不适合纯色覆盖时为 null。开启 fallbackInset 时回退到区域内侧四角底色。 */
export function useRingBackground(
  url: string | undefined,
  box: PageFraction | null,
  fallbackInset = false,
): string | null {
  const [color, setColor] = useState<string | null>(null);
  const key = box ? `${box.x.toFixed(4)},${box.y.toFixed(4)},${box.w.toFixed(4)},${box.h.toFixed(4)}` : '';
  useEffect(() => {
    let alive = true;
    setColor(null);
    if (!url || !box) return;
    void loadPixels(url).then(pixels => {
      if (!alive || !pixels) return;
      setColor(ringColor(pixels, box) ?? (fallbackInset ? insetCornerColor(pixels, box) : null));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key, fallbackInset]);
  return color;
}

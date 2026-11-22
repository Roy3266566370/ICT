/**
 * imageInput.ts —— 深度学习真实图片与微型 CSV 数据集导入（纯前端确定性处理）
 *
 * - 将用户上传的真实图片（JPG/PNG/WebP）下采样为 12×12 灰度/RGB 通道矩阵（兼容现有
 *   16×16 端口协议与逐像素乘加追踪），并同时保留 32×32 清晰预览矩阵与缩略图 DataURL。
 * - 将用户上传/粘贴的小型 CSV（x,y,label）归一化为 [-1, 1] 并做确定性训练/验证切分，
 *   直接供 svmLab / mlpTrainer / boundaryView 使用。
 */
import type { DatasetPoint } from './types.ts';
import type { Matrix } from './deepCore.ts';

export type ImageChannel = 'gray' | 'r' | 'g' | 'b';

export interface RealImagePayload {
  kind: 'realImage';
  name: string;
  channel: ImageChannel;
  /** 12×12 归一化矩阵 [0,1]，直接流入 tensor2d 端口参与卷积/池化/显微追踪 */
  data: Matrix;
  /** 可选 32×32 清晰矩阵，用于检查器高分辨率边缘/滤波对比 */
  hiRes?: Matrix;
  /** 轻量化缩略图 DataURL（用于模块卡片与原图对照） */
  previewUrl?: string;
}

export interface CsvDatasetPayload {
  kind: 'csvDataset';
  name: string;
  points: DatasetPoint[];
}

export function parseRealImagePayload(payload?: string): RealImagePayload | null {
  if (!payload) return null;
  try {
    const obj = JSON.parse(payload) as Partial<RealImagePayload>;
    if (obj?.kind !== 'realImage' || !Array.isArray(obj.data) || obj.data.length !== 12) return null;
    if (!obj.data.every((r) => Array.isArray(r) && r.length === 12 && r.every(Number.isFinite))) return null;
    const channel: ImageChannel = obj.channel === 'r' || obj.channel === 'g' || obj.channel === 'b' ? obj.channel : 'gray';
    return {
      kind: 'realImage',
      name: typeof obj.name === 'string' && obj.name ? obj.name : '已上传图片',
      channel,
      data: obj.data,
      ...(Array.isArray(obj.hiRes) ? { hiRes: obj.hiRes } : {}),
      ...(typeof obj.previewUrl === 'string' ? { previewUrl: obj.previewUrl } : {}),
    };
  } catch {
    return null;
  }
}

export function parseCsvDatasetPayload(payload?: string): CsvDatasetPayload | null {
  if (!payload) return null;
  try {
    const obj = JSON.parse(payload) as Partial<CsvDatasetPayload>;
    if (obj?.kind !== 'csvDataset' || !Array.isArray(obj.points) || !obj.points.length) return null;
    const points = obj.points.filter(
      (p): p is DatasetPoint =>
        !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.label)
        && (p.split === 'train' || p.split === 'validation'),
    ).slice(0, 120);
    if (!points.length) return null;
    return {
      kind: 'csvDataset',
      name: typeof obj.name === 'string' && obj.name ? obj.name : 'CSV 数据集',
      points,
    };
  } catch {
    return null;
  }
}

/** 从 RGBA 像素数组提取单通道并采样为 size×size 归一化矩阵 [0,1]。 */
export function rgbaToMatrix(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  size: number,
  channel: ImageChannel = 'gray',
): Matrix {
  const safeSize = Math.max(2, Math.min(64, Math.round(size)));
  const out: Matrix = [];
  for (let i = 0; i < safeSize; i++) {
    const row: number[] = [];
    const y0 = Math.floor((i * height) / safeSize);
    const y1 = Math.max(y0 + 1, Math.floor(((i + 1) * height) / safeSize));
    for (let j = 0; j < safeSize; j++) {
      const x0 = Math.floor((j * width) / safeSize);
      const x1 = Math.max(x0 + 1, Math.floor(((j + 1) * width) / safeSize));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * width + x) * 4;
          const r = (rgba[idx] ?? 0) / 255;
          const g = (rgba[idx + 1] ?? 0) / 255;
          const b = (rgba[idx + 2] ?? 0) / 255;
          const v = channel === 'r' ? r : channel === 'g' ? g : channel === 'b' ? b : 0.299 * r + 0.587 * g + 0.114 * b;
          sum += v;
          count++;
        }
      }
      row.push(count > 0 ? Number((sum / count).toFixed(4)) : 0);
    }
    out.push(row);
  }
  return out;
}

/** 任意尺寸矩阵的 3×3 卷积（用于 32×32 真图高清滤波对比预览）。 */
export function convolvePreview(input: Matrix, kernel: Matrix, stride = 1, padding = 0): Matrix {
  if (!input.length || !input[0]?.length || kernel.length !== 3) return [];
  const H = input.length;
  const W = input[0]!.length;
  const s = stride === 2 ? 2 : 1;
  const p = padding ? 1 : 0;
  const oh = Math.floor((H + 2 * p - 3) / s) + 1;
  const ow = Math.floor((W + 2 * p - 3) / s) + 1;
  if (oh < 1 || ow < 1) return [];
  return Array.from({ length: oh }, (_, i) =>
    Array.from({ length: ow }, (_, j) => {
      let sum = 0;
      for (let u = 0; u < 3; u++) {
        for (let v = 0; v < 3; v++) {
          const r = i * s + u - p;
          const c = j * s + v - p;
          sum += (input[r]?.[c] ?? 0) * (kernel[u]?.[v] ?? 0);
        }
      }
      return sum;
    }),
  );
}

/** 浏览器端将图片 File 解码并生成 RealImagePayload。 */
export async function decodeImageFile(file: File, channel: ImageChannel = 'gray'): Promise<RealImagePayload> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('无法解码图片文件'));
      el.src = url;
    });
    const side = 96;
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器不支持 2D Canvas');
    // 居中裁剪为正方形，保留主体构图
    const minSide = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const sx = ((img.naturalWidth || img.width) - minSide) / 2;
    const sy = ((img.naturalHeight || img.height) - minSide) / 2;
    ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, side, side);
    const imageData = ctx.getImageData(0, 0, side, side);
    const data = rgbaToMatrix(imageData.data, side, side, 12, channel);
    const hiRes = rgbaToMatrix(imageData.data, side, side, 32, channel);
    const previewUrl = canvas.toDataURL('image/jpeg', 0.72);
    return {
      kind: 'realImage',
      name: file.name || '真实图片',
      channel,
      data,
      hiRes,
      previewUrl,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 内置真实风格测试样例图（无需用户先找文件即可体验真实图像特征提取）。 */
export function builtinSampleImage(kind: 'digit7' | 'corner' | 'ring'): RealImagePayload {
  const gen = (size: number): Matrix => Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => {
      const y = i / (size - 1);
      const x = j / (size - 1);
      if (kind === 'digit7') {
        const topBar = y >= 0.14 && y <= 0.27 && x >= 0.2 && x <= 0.82;
        const diag = y >= 0.22 && y <= 0.88 && Math.abs(x - (0.78 - (y - 0.22) * 0.68)) <= 0.085;
        return topBar || diag ? 0.95 : 0.06;
      }
      if (kind === 'corner') {
        const roof = y >= 0.18 && y <= 0.52 && Math.abs(x - 0.5) <= (y - 0.15) * 1.05;
        const wall = y > 0.52 && y <= 0.86 && x >= 0.24 && x <= 0.76;
        const door = y > 0.64 && y <= 0.86 && x >= 0.44 && x <= 0.56;
        return door ? 0.15 : roof ? 0.88 : wall ? 0.62 : 0.08;
      }
      const d = Math.hypot(x - 0.5, y - 0.5);
      return Math.abs(d - 0.3) < 0.09 ? 0.92 : d < 0.11 ? 0.7 : 0.05;
    }),
  );
  const names = { digit7: '手写数字 7', corner: '房屋轮廓', ring: '同心圆靶' };
  return {
    kind: 'realImage',
    name: names[kind],
    channel: 'gray',
    data: gen(12),
    hiRes: gen(32),
  };
}

/** 解析小型 CSV（每行 x,y,label，可选表头），自动归一化并按 3:1 划分训练/验证集。 */
export function parseCsvText(raw: string, name = '自定义 CSV'): CsvDatasetPayload {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parsed: { x: number; y: number; label: number }[] = [];
  for (const line of lines) {
    const parts = line.split(/[,\t; ]+/).filter(Boolean);
    if (parts.length < 3) continue;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const label = Number(parts[2]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(label)) {
      parsed.push({ x, y, label: label >= 0.5 ? 1 : 0 });
    }
  }
  if (parsed.length < 4) throw new Error('至少需要 4 行有效数据，格式为：x, y, label（label 为 0 或 1）');
  const sliced = parsed.slice(0, 120);
  const xs = sliced.map((p) => p.x);
  const ys = sliced.map((p) => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xSpan = Math.max(1e-6, xMax - xMin);
  const ySpan = Math.max(1e-6, yMax - yMin);
  const points: DatasetPoint[] = sliced.map((p, idx) => ({
    x: Number((((p.x - xMin) / xSpan) * 2 - 1).toFixed(4)),
    y: Number((((p.y - yMin) / ySpan) * 2 - 1).toFixed(4)),
    label: p.label,
    split: idx % 4 === 0 ? 'validation' : 'train',
  }));
  return { kind: 'csvDataset', name, points };
}

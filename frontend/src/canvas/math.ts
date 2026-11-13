/**
 * math.ts —— 画布对象共用的 2×2 矩阵小工具。
 * 纯函数，与 domain/matrix 的 calc 同口径（det / tr / 特征值 / 判定文案）。
 */

export interface M2 { a: number; b: number; c: number; d: number }

export const det = (m: M2): number => m.a * m.d - m.b * m.c;
export const tr = (m: M2): number => m.a + m.d;

export interface EigenInfo {
  real: boolean;
  l1: number;
  l2: number;
  imag: number; // 复特征值虚部（real=false 时）
  disc: number;
}

export function eigen(m: M2): EigenInfo {
  const t = tr(m), d = det(m), disc = t * t - 4 * d;
  if (disc >= 0) {
    const s = Math.sqrt(disc);
    return { real: true, l1: (t + s) / 2, l2: (t - s) / 2, imag: 0, disc };
  }
  return { real: false, l1: t / 2, l2: t / 2, imag: Math.sqrt(-disc) / 2, disc };
}

export function rankOf(m: M2): number {
  if (Math.abs(det(m)) > 1e-9) return 2;
  return (m.a !== 0 || m.b !== 0 || m.c !== 0 || m.d !== 0) ? 1 : 0;
}

/** 把数值格式化成仪表读数：去尾零、保留 d 位精度 */
export function fmt(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—';
  const s = v.toFixed(digits);
  const trimmed = s.replace(/\.?0+$/, '');
  return trimmed === '' || trimmed === '-0' ? '0' : trimmed;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 从节点参数读出 2×2 矩阵（缺省单位阵） */
export function paramsM(p: Record<string, number>): M2 {
  return { a: p.a ?? 1, b: p.b ?? 0, c: p.c ?? 0, d: p.d ?? 1 };
}

export const IDENT: M2 = { a: 1, b: 0, c: 0, d: 1 };

/** A·B（矩阵乘法，顺序敏感） */
export function mul2(A: M2, B: M2): M2 {
  return {
    a: A.a * B.a + A.b * B.c,
    b: A.a * B.b + A.b * B.d,
    c: A.c * B.a + A.d * B.c,
    d: A.c * B.b + A.d * B.d,
  };
}

/** 旋转矩阵；turns 以"圈"为单位（1 = 一整圈） */
export function rot2(turns: number): M2 {
  const t = turns * 2 * Math.PI;
  const c = Math.cos(t), s = Math.sin(t);
  return { a: c, b: -s, c: s, d: c };
}

let uid = 0;
export function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}_${Date.now().toString(36)}_${uid}`;
}

export type IntegralKind = 'scalar' | 'flux';
export type ScalarKey = 'one' | 'z2' | 'rho2';
export type FieldKey = 'axial' | 'radial' | 'constant';

export interface ScalarOption {
  key: ScalarKey;
  label: string;
  tex: string;
  meaning: string;
  valueAt: (z: number, R: number) => number;
  exact: (R: number) => number;
  exactTex: string;
}

export interface FieldOption {
  key: FieldKey;
  label: string;
  tex: string;
  meaning: string;
  vectorAt: (x: number, y: number, z: number) => readonly [number, number, number];
  normalDot: (z: number, R: number) => number;
  exact: (R: number) => number;
  exactTex: string;
}

export const SCALAR_OPTIONS: readonly ScalarOption[] = [
  {
    key: 'one',
    label: 'f = 1（面积）',
    tex: 'f(x,y,z)=1',
    meaning: '积分值就是球面面积 4πR²。',
    valueAt: () => 1,
    exact: (R) => 4 * Math.PI * R * R,
    exactTex: '4\\pi R^2',
  },
  {
    key: 'z2',
    label: 'f = z²',
    tex: 'f(x,y,z)=z^2',
    meaning: '只与高度有关，环带上每点的 f 相同。',
    valueAt: (z) => z * z,
    exact: (R) => (4 * Math.PI * Math.pow(R, 4)) / 3,
    exactTex: '\\dfrac{4\\pi R^4}{3}',
  },
  {
    key: 'rho2',
    label: 'f = x²+y²',
    tex: 'f(x,y,z)=x^2+y^2',
    meaning: '用 x²+y²=R²−z² 化为只含 z 的函数。',
    valueAt: (z, R) => Math.max(0, R * R - z * z),
    exact: (R) => (8 * Math.PI * Math.pow(R, 4)) / 3,
    exactTex: '\\dfrac{8\\pi R^4}{3}',
  },
];

export const FIELD_OPTIONS: readonly FieldOption[] = [
  {
    key: 'axial',
    label: 'F = (0, 0, z)',
    tex: '\\mathbf F=(0,0,z)',
    meaning: '轴向场；上下半球都向外穿过曲面。',
    vectorAt: (_x, _y, z) => [0, 0, z],
    normalDot: (z, R) => (z * z) / R,
    exact: (R) => (4 * Math.PI * Math.pow(R, 3)) / 3,
    exactTex: '\\dfrac{4\\pi R^3}{3}',
  },
  {
    key: 'radial',
    label: 'F = (x, y, z)',
    tex: '\\mathbf F=(x,y,z)',
    meaning: '径向场；处处沿外法向，F·n = R。',
    vectorAt: (x, y, z) => [x, y, z],
    normalDot: (_z, R) => R,
    exact: (R) => 4 * Math.PI * Math.pow(R, 3),
    exactTex: '4\\pi R^3',
  },
  {
    key: 'constant',
    label: 'F = (0, 0, 1)',
    tex: '\\mathbf F=(0,0,1)',
    meaning: '常场；上半球流出为正、下半球为负，净通量为 0。',
    vectorAt: () => [0, 0, 1],
    normalDot: (z, R) => z / R,
    exact: () => 0,
    exactTex: '0',
  },
];

export function findScalar(key: ScalarKey): ScalarOption {
  return SCALAR_OPTIONS.find((option) => option.key === key) ?? SCALAR_OPTIONS[0]!;
}

export function findField(key: FieldKey): FieldOption {
  return FIELD_OPTIONS.find((option) => option.key === key) ?? FIELD_OPTIONS[0]!;
}

export function sliceRadius(R: number, h: number): number {
  return Math.sqrt(Math.max(0, R * R - h * h));
}

/** 球面在高度 z 处、厚度 dz 的环带面积：2πR·dz（阿基米德“帽盒”定理）。 */
export function bandArea(R: number, dz: number): number {
  return 2 * Math.PI * R * dz;
}

export function bandContribution(
  kind: IntegralKind,
  scalarKey: ScalarKey,
  fieldKey: FieldKey,
  zMid: number,
  R: number,
  dz: number,
  orientation: 1 | -1,
): number {
  const area = bandArea(R, dz);
  if (kind === 'scalar') {
    return findScalar(scalarKey).valueAt(zMid, R) * area;
  }
  return orientation * findField(fieldKey).normalDot(zMid, R) * area;
}

export function exactIntegral(
  kind: IntegralKind,
  scalarKey: ScalarKey,
  fieldKey: FieldKey,
  R: number,
  orientation: 1 | -1,
): number {
  return kind === 'scalar'
    ? findScalar(scalarKey).exact(R)
    : orientation * findField(fieldKey).exact(R);
}

/** 从球底 z=−R 累积到高度 h 的精确积分。 */
export function exactCumulative(
  kind: IntegralKind,
  scalarKey: ScalarKey,
  fieldKey: FieldKey,
  R: number,
  h: number,
  orientation: 1 | -1,
): number {
  const span = h + R;
  if (kind === 'scalar') {
    if (scalarKey === 'one') return 2 * Math.PI * R * span;
    if (scalarKey === 'z2') {
      return (2 * Math.PI * R * (Math.pow(h, 3) + Math.pow(R, 3))) / 3;
    }
    return (
      2 *
      Math.PI *
      R *
      (R * R * span - (Math.pow(h, 3) + Math.pow(R, 3)) / 3)
    );
  }
  if (fieldKey === 'axial') {
    return orientation * (2 * Math.PI * (Math.pow(h, 3) + Math.pow(R, 3))) / 3;
  }
  if (fieldKey === 'radial') {
    return orientation * 2 * Math.PI * R * R * span;
  }
  return orientation * Math.PI * (h * h - R * R);
}

export interface RiemannBand {
  index: number;
  zMid: number;
  dz: number;
  area: number;
  contribution: number;
  cumulative: number;
}

export function riemannBands(
  kind: IntegralKind,
  scalarKey: ScalarKey,
  fieldKey: FieldKey,
  R: number,
  slices: number,
  orientation: 1 | -1,
): RiemannBand[] {
  const dz = (2 * R) / slices;
  const bands: RiemannBand[] = [];
  let cumulative = 0;
  for (let index = 0; index < slices; index += 1) {
    const zMid = -R + (index + 0.5) * dz;
    const contribution = bandContribution(kind, scalarKey, fieldKey, zMid, R, dz, orientation);
    cumulative += contribution;
    bands.push({
      index,
      zMid,
      dz,
      area: bandArea(R, dz),
      contribution,
      cumulative,
    });
  }
  return bands;
}

/** 当前截面以下（按中点积分）的离散累加值。 */
export function cumulativeAt(bands: readonly RiemannBand[], h: number): number {
  let total = 0;
  for (const band of bands) {
    if (band.zMid <= h) total += band.contribution;
  }
  return total;
}

export function formatNumber(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatSigned(value: number, digits = 3): string {
  const text = formatNumber(Math.abs(value), digits);
  return value < 0 ? `−${text}` : text;
}

export function relativeError(approx: number, exact: number): number | null {
  if (Math.abs(exact) < 1e-12) return null;
  return Math.abs(approx - exact) / Math.abs(exact);
}

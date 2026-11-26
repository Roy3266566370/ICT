import { compileExpression } from '../labs/expr.ts';
import { diskGrid, polarRings } from './calculusDisk.ts';
import type { PortValue } from './types.ts';

export type VectorFunctionValue = Extract<PortValue, { kind: 'vectorFunction2d' }>;
export const VECTOR_FIELDS = [
  { label: '势场 (x, y)', text: 'x\ny' },
  { label: '涡流 (−y, x)', text: '-y\nx' },
  { label: '旋转加外流', text: 'x-y\nx+y' },
] as const;

export function vectorFieldParts(text: string | undefined) {
  const [p = '', q = ''] = (text ?? VECTOR_FIELDS[1].text).split('\n');
  return { p, q };
}

function compileVectorField(value: VectorFunctionValue) {
  if (value.p.length > 240 || value.q.length > 240) throw new Error('每个场分量最多 240 字。');
  const p = compileExpression(value.p, ['x', 'y']);
  const q = compileExpression(value.q, ['x', 'y']);
  return (x: number, y: number): [number, number] => {
    const px = p.evalOrNull({ x, y }), qy = q.evalOrNull({ x, y });
    if (px === null || qy === null) throw new Error('圆盘或边界附近有无定义的场采样点，无法核对积分公式。');
    return [px, qy];
  };
}

export function vectorFieldValue(text: string | undefined): VectorFunctionValue {
  const value: VectorFunctionValue = { kind: 'vectorFunction2d', ...vectorFieldParts(text) };
  compileVectorField(value);
  return value;
}

function sampleField(value: VectorFunctionValue, radius: number) {
  try {
    const evaluate = compileVectorField(value);
    const h = 1e-5 * Math.max(1, radius);
    const derivatives = (x: number, y: number) => {
      const a = evaluate(x-h, y), b = evaluate(x+h, y);
      const c = evaluate(x, y-h), d = evaluate(x, y+h);
      const curl = ((b[1]-a[1])-(d[0]-c[0]))/(2*h);
      const divergence = ((b[0]-a[0])+(d[1]-c[1]))/(2*h);
      if (![curl, divergence].every(Number.isFinite)) throw new Error('场导数超出数值范围。');
      return { curl, divergence };
    };
    const grid = diskGrid(radius, 17, (x, y) => ({ vec: evaluate(x, y), ...derivatives(x, y) }));
    const rings = 20, angular = 96, dtheta = 2 * Math.PI / angular;
    const levels = [{ radius: 0, circulation: 0, flux: 0, curlIntegral: 0, divergenceIntegral: 0 }];
    const trace = [{ angle: 0, work: 0 }];
    let curlIntegral = 0, divergenceIntegral = 0, ringIndex = 0;
    for (const ring of polarRings(radius, rings, angular)) {
      for (const { x, y, weight } of ring) {
        const { curl, divergence } = derivatives(x, y);
        curlIntegral += curl * weight;
        divergenceIntegral += divergence * weight;
      }
      const r = radius * (++ringIndex) / rings;
      let circulation = 0, flux = 0;
      for (let j = 0; j < angular; j++) {
        const theta = (j+0.5)*dtheta, cos = Math.cos(theta), sin = Math.sin(theta);
        const [p, q] = evaluate(r*cos, r*sin);
        circulation += (-p*sin+q*cos)*r*dtheta;
        flux += (p*cos+q*sin)*r*dtheta;
        if (ringIndex === rings && (j+1)%4 === 0) trace.push({ angle: (j+1)*dtheta, work: circulation });
      }
      if (![circulation, flux, curlIntegral, divergenceIntegral].every(Number.isFinite)) {
        throw new Error('边界或面积积分超出数值范围。');
      }
      levels.push({ radius: r, circulation, flux, curlIntegral, divergenceIntegral });
    }
    const arrows = grid.flatMap((row, i) => i%2 ? [] : row.flatMap(({ x,y,value }, j) =>
      j%2 || !value ? [] : [{ x,y,p:value.vec[0],q:value.vec[1] }]));
    return {
      radius, trace, arrows, levels, curl: grid.map(row => row.map(cell => cell.value?.curl ?? null)),
      divergence: grid.map(row => row.map(cell => cell.value?.divergence ?? null)),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '向量场采样失败。' };
  }
}

let fieldCache: { key: string; samples: ReturnType<typeof sampleField> } | undefined;

export function sampleVectorField(value: VectorFunctionValue, pathRadius = 1) {
  const radius = Math.max(0.25, Math.min(2.5, pathRadius));
  const key = JSON.stringify([value, radius]);
  if (fieldCache?.key !== key) fieldCache = { key, samples: sampleField(value, radius) };
  return fieldCache.samples;
}

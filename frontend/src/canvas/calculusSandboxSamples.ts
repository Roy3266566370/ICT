import type { RuleSampleProfile } from './aiRuleBlock.ts';
import { approachLimit, derivativeAt, epsilonDeltaBand, integrate, type RealFunction } from './calculus.ts';

function zeroBrackets(f: RealFunction) {
  let left = -1.5, right = -0.25;
  let fl = f(left);
  const fr = f(right);
  const frames: { left: number; right: number; middle: number; value: number | null }[] = [];
  if (fl === null || fr === null) return { frames, root: null, issue: '端点无定义，无法判断异号' };
  if (fl === 0 || fr === 0) return { frames, root: fl === 0 ? left : right };
  if (Math.sign(fl) === Math.sign(fr)) return { frames, root: null };
  const tolerance = Math.min(1e-8, 1e-7 * Math.min(Math.abs(fl), Math.abs(fr)));
  for (let step = 0; step < 28; step++) {
    const middle = (left + right) / 2;
    const value = f(middle);
    frames.push({ left, right, middle, value });
    if (value === null) break;
    if (Math.abs(value) <= tolerance) return { frames, root: middle };
    if (Math.sign(value) === Math.sign(fl)) {
      left = middle;
      fl = value;
    } else right = middle;
  }
  return { frames, root: null };
}

function limitSamples(f: RealFunction, epsilon = 0.12) {
  const eps = Math.max(0.001, Math.min(1, epsilon));
  const xs = Array.from({ length: 101 }, (_, i) => (i - 50) * 0.035);
  const band = epsilonDeltaBand(f, 0, eps);
  const left = approachLimit(f, 0, -1);
  const right = approachLimit(f, 0, 1);
  return {
    xs, ys: xs.map(f), atZero: f(0), eps, delta: band.delta, level: band.level,
    left: left.candidate, right: right.candidate, approaches: left.rows, brackets: zeroBrackets(f),
  };
}

function differentialSamples(f: RealFunction, step = 0.45) {
  const h = Math.max(0.001, Math.min(1, step));
  const innerDerivative = 2;
  const g = (x: number) => innerDerivative * x + x * x;
  let derivative: number | null = null;
  try { derivative = derivativeAt(f, 0); } catch { /* The secant can still be inspected. */ }
  const xs = Array.from({ length: 21 }, (_, i) => h * i / 20);
  return {
    h, derivative, atZero: f(0), atStep: f(h), innerStep: g(h), innerDerivative, composedStep: f(g(h)),
    ys: xs.map(f),
  };
}

function quadratureSamples(f: RealFunction, divisions = 12) {
  const selected = Math.max(2, Math.min(64, 2 * Math.round(divisions / 2)));
  let reference: number | null = null;
  try { reference = integrate(f, 0, 1, selected).reference; } catch { /* Missing or undefined samples have a visible fallback. */ }
  const counts = [2, 4, 8, 16, 32, selected].filter((count, index, all) => count <= selected && all.indexOf(count) === index);
  return {
    selected, reference,
    meshes: counts.map(n => ({ n, values: Array.from({ length: 2 * n + 1 }, (_, i) => f(i / (2 * n))) })),
  };
}

function integralApplicationSamples(f: RealFunction, divisions = 12) {
  const n = Math.max(2, Math.min(32, Math.round(divisions)));
  const radius = (x: number) => {
    const value = f(x);
    return value === null ? null : Math.abs(value);
  };
  let volume: number | null = null;
  let undefinedSample = false;
  try {
    volume = integrate((x) => {
      const r = radius(x);
      if (r !== null) return Math.PI * r * r;
      undefinedSample = true;
      return null;
    }, 0, 1, n).reference;
  } catch { /* The rule shows the undefined reference explicitly. */ }
  return {
    n, volume, undefinedSample, radii: Array.from({ length: n }, (_, i) => radius((i + 0.5) / n)),
    profile: Array.from({ length: 33 }, (_, i) => radius(i / 32)),
  };
}

export function sampleCalculusLesson(f: RealFunction, profile: Exclude<RuleSampleProfile, 'diskDensity'>, scalar?: number) {
  switch (profile) {
    case 'limit': return limitSamples(f, scalar);
    case 'differential': return differentialSamples(f, scalar);
    case 'quadrature': return quadratureSamples(f, scalar);
    case 'integralApplications': return integralApplicationSamples(f, scalar);
  }
}

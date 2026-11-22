type Point = [number, number];

export function basisComposition(origin: Point, first: Point, second: Point, target: Point) {
  const dx = target[0] - origin[0];
  const dy = target[1] - origin[1];
  const cross = first[0] * second[1] - first[1] * second[0];
  if (Math.abs(cross) < Math.hypot(...first) * Math.hypot(...second) * .015) return null;
  if (!cross) return null;
  const a = (dx * second[1] - dy * second[0]) / cross || 0;
  const b = (first[0] * dy - first[1] * dx) / cross || 0;
  return { coefficients: [a, b], corner: [origin[0] + a*first[0], origin[1] + a*first[1]] as Point, target };
}

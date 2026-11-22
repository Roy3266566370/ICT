type Point = [number, number];
interface Geometry { x: number; y: number; width: number; height: number; rotation: number }

export function vectorEndpoints(node: Geometry): [Point, Point] {
  const angle = node.rotation * Math.PI / 180;
  const dx = Math.cos(angle) * node.width / 2;
  const dy = Math.sin(angle) * node.width / 2;
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  return [[cx - dx, cy - dy], [cx + dx, cy + dy]];
}

export function vectorGeometry(start: Point, end: Point, height: number): Omit<Geometry, 'height'> | null {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const width = Math.hypot(dx, dy);
  if (!Number.isFinite(width) || width < .1 || width > 20000) return null;
  return {
    x: (start[0] + end[0] - width) / 2,
    y: (start[1] + end[1] - height) / 2,
    width,
    rotation: Math.atan2(dy, dx) * 180 / Math.PI,
  };
}

export function resizeVector(node: Geometry, width: number, angle = node.rotation) {
  const [start] = vectorEndpoints(node);
  const rad = angle * Math.PI / 180;
  return vectorGeometry(start, [start[0] + Math.cos(rad) * width, start[1] + Math.sin(rad) * width], node.height);
}

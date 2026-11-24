import type { ScenePage } from '@/document/types';
import { rotatedBox } from './canvasGestures';

export function standaloneDemos(page: ScenePage) {
  const frozen = new Set(page.preparation?.frozen_ids);
  const nodes = page.nodes.filter(node => !node.hidden && !node.deleted && !frozen.has(node.id));
  const demos = nodes.filter(node => node.type === 'demo' && node.demo);
  if (!demos.length) return demos;
  const text = nodes.filter(node => node.type === 'text' && node.text.trim()).map(rotatedBox);
  return demos.filter(node => {
    const {x, y, width, height} = rotatedBox(node);
    if (x < -1 || y < -1 || x + width > page.width + 1 || y + height > page.height + 1) return true;
    // Small inline players may intentionally share space with the original layout.
    if (width * height < page.width * page.height * .45) return false;
    return text.some(box => {
      const w = Math.min(x + width, box.x + box.width) - Math.max(x, box.x);
      const h = Math.min(y + height, box.y + box.height) - Math.max(y, box.y);
      return w > 0 && h > 0 && w * h >= box.width * box.height * .25;
    });
  });
}

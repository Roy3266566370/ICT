import type { SceneNode } from '../../document/types.ts';

const interactiveTypes = new Set(['workshop_plugin', 'math_scene', 'diagram']);

export function isInteractiveSlide(nodes: readonly SceneNode[] = []): boolean {
  return nodes.some((node) => {
    if (node.hidden || node.deleted) return false;
    if (node.type === 'vector') {
      return (!node.locked && node.viewer_editable !== false) || (node.style?.anim_step ?? 0) > 0;
    }
    return interactiveTypes.has(node.type);
  });
}

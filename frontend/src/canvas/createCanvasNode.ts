import { defaultManual408Text } from '@/labs/manual408';
import { defaultAiRulePayload, serializeAiRulePayload } from './aiRuleBlock.ts';
import { nextId } from './math.ts';
import { defaultParams } from './nodes.tsx';
import type { CanvasNode, NodeType } from './types.ts';

export function createCanvasNode(type: NodeType, x: number, y: number): CanvasNode {
  return {
    id: nextId('n'), type, x, y, params: defaultParams(type),
    ...(type === 'textNote' ? { text: '' } : {}),
    ...(type === 'functionSource' ? { text: 'a*x^2+b*x+c' } : {}),
    ...(type === 'lab408Workbench' ? { text: defaultManual408Text() } : {}),
    ...(type === 'aiRuleBlock' ? { payload: serializeAiRulePayload(defaultAiRulePayload()) } : {}),
  };
}

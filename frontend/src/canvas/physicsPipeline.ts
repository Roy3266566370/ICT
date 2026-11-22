import { physicsEmPipelines } from './physicsPipelineEm.ts';
import { physicsMechPipelines } from './physicsPipelineMech.ts';
import { physicsOpticsPipelines } from './physicsPipelineOptics.ts';
import type { SciencePipelineMap } from './sciencePipelineTypes.ts';
import {
  buildSciencePipeline,
  evaluateScienceStage,
  findScienceStage,
  sciencePipelinePorts,
} from './sciencePipelineRuntime.ts';
import type { CanvasDoc, CanvasNode, PortSpec, PortValue } from './types.ts';

export const physicsPipelines: SciencePipelineMap = {
  ...physicsMechPipelines,
  ...physicsEmPipelines,
  ...physicsOpticsPipelines,
};

export function findPhysicsStage(
  node: Pick<CanvasNode, 'type' | 'payload'>,
): ReturnType<typeof findScienceStage> {
  if (node.type !== 'physicsStage') return undefined;
  return findScienceStage(node, physicsPipelines);
}

export function physicsPipelinePorts(node: CanvasNode, dir: 'in' | 'out'): readonly PortSpec[] {
  if (!findPhysicsStage(node)) return [];
  return sciencePipelinePorts(node, physicsPipelines, 'physicsData', dir);
}

export function evaluatePhysicsStage(
  node: CanvasNode,
  input: (id: string) => PortValue | null,
): Extract<PortValue, { kind: 'physicsData' }> | null {
  if (!findPhysicsStage(node)) return null;
  const evaluation = evaluateScienceStage(node, input, physicsPipelines);
  return evaluation ? { kind: 'physicsData', ...evaluation } : null;
}

export function buildPhysicsPipeline(kind: string, title: string, note: string): CanvasDoc {
  return buildSciencePipeline(kind, title, note, 'physicsStage', physicsPipelines);
}
import { calculusMultiPipelines } from './calculusPipelineMulti.ts';
import { calculusSinglePipelines } from './calculusPipelineSingle.ts';
import {
  buildSciencePipeline,
  evaluateScienceStage,
  findScienceStage,
  sciencePipelinePorts,
} from './sciencePipelineRuntime.ts';
import type { SciencePipelineMap, ScienceStage } from './sciencePipelineTypes.ts';
import type { CanvasDoc, CanvasNode, PortSpec, PortValue } from './types.ts';

export const calculusPipelines: SciencePipelineMap = {
  ...calculusSinglePipelines,
  ...calculusMultiPipelines,
};

export function findCalculusStage(
  node: Pick<CanvasNode, 'type' | 'payload'>,
): { pipeline: string; stage: ScienceStage } | undefined {
  if (node.type !== 'calculusStage') return undefined;
  return findScienceStage(node, calculusPipelines);
}

export function calculusPipelinePorts(node: CanvasNode, dir: 'in' | 'out'): readonly PortSpec[] {
  if (node.type !== 'calculusStage') return [];
  return sciencePipelinePorts(node, calculusPipelines, 'calculusData', dir);
}

export function evaluateCalculusStage(
  node: CanvasNode,
  input: (id: string) => PortValue | null,
): Extract<PortValue, { kind: 'calculusData' }> | null {
  if (node.type !== 'calculusStage') return null;
  const evaluation = evaluateScienceStage(node, input, calculusPipelines);
  return evaluation ? { kind: 'calculusData', ...evaluation } : null;
}

export function buildCalculusPipeline(kind: string, title: string, note: string): CanvasDoc {
  return buildSciencePipeline(kind, title, note, 'calculusStage', calculusPipelines);
}
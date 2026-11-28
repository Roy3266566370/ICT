import { studyStages } from './studyStages.ts';
import type { PortValue } from './types.ts';

export const DEEP_NODE_TYPES = new Set([
  ...Object.keys(studyStages),
  'activationProbe', 'optimizerArena', 'attentionAB', 'kvCache',
  'dataset2dSource', 'pixelGridSource', 'tokenSeqSource', 'linearOp', 'activationOp',
  'residualJoin', 'normOp', 'conv2dOp', 'attentionOp', 'mlpTrainer',
  'boundaryView', 'matrixHeatmapView', 'gradFlowMeter', 'svmLab', 'resnetLab',
  'sequenceMemory', 'multiheadLab', 'autoencoderLab', 'diffusionLab', 'qLearningLab',
]);

export function validDeepValue(value: PortValue | null): boolean {
  if (!value) return false;
  if (value.kind === 'scalar') return Number.isFinite(value.v);
  if (value.kind === 'series') {
    return Array.isArray(value.values) && value.values.length > 0 && value.values.length <= 2048
      && value.values.every(Number.isFinite)
      && (value.secondary === undefined || (Array.isArray(value.secondary) && value.secondary.every((line) =>
        line && Array.isArray(line.values) && line.values.length <= 2048 && line.values.every(Number.isFinite))));
  }
  if (value.kind === 'tensor2d') {
    if (!Array.isArray(value.data) || !value.data.length || value.data.length > 16) return false;
    const columns = value.data[0]?.length ?? 0;
    return columns > 0 && columns <= 16 && value.data.every((row) => Array.isArray(row)
      && row.length === columns && row.every(Number.isFinite));
  }
  if (value.kind === 'dataset2d') return Array.isArray(value.points) && value.points.length <= 120
    && value.points.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)
      && Number.isFinite(p.label) && (p.split === 'train' || p.split === 'validation'));
  return false;
}

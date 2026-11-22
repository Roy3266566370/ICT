import type { PipelineControl, PipelineFrame } from './lab408PipelineTypes.ts';

export type ScienceDiagramKind = 'source' | 'motion' | 'force' | 'energy' | 'collision' | 'oscillation'
  | 'field' | 'circuit' | 'induction' | 'optics' | 'thermal' | 'quantum'
  | 'function' | 'limit' | 'derivative' | 'integral' | 'series' | 'ode'
  | 'contour' | 'matrix' | 'svd' | 'summary';

export interface SciencePath {
  points: [number, number][];
  stroke?: string;
  strokeWidth?: number;
  dashed?: boolean;
  fill?: string;
  closed?: boolean;
  label?: string;
}

export interface ScienceVector {
  x: number;
  y: number;
  dx: number;
  dy: number;
  color?: string;
  label?: string;
}

export interface SciencePoint {
  x: number;
  y: number;
  radius?: number;
  color?: string;
  label?: string;
  hollow?: boolean;
}

export interface ScienceRect {
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  opacity?: number;
  label?: string;
}

export interface ScienceEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill?: string;
  stroke?: string;
  dashed?: boolean;
  label?: string;
}

export interface ScienceLabel {
  x: number;
  y: number;
  text: string;
  color?: string;
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
}

export interface ScienceScene {
  ariaLabel: string;
  grid?: boolean;
  axes?: boolean;
  paths?: SciencePath[];
  vectors?: ScienceVector[];
  points?: SciencePoint[];
  rects?: ScienceRect[];
  ellipses?: ScienceEllipse[];
  labels?: ScienceLabel[];
}

export interface ScienceMetric {
  label: string;
  value: string;
  emphasis?: boolean;
}

export interface ScienceFrame extends PipelineFrame {
  scene: ScienceScene;
  metrics?: ScienceMetric[];
}

export interface ScienceData extends Record<string, unknown> {
  parameters: Record<string, number>;
  text: string;
}

export interface ScienceResult {
  data: ScienceData;
  frames: ScienceFrame[];
}

export interface SciencePreset {
  label: string;
  params: Record<string, number>;
  text?: string;
}

export interface ScienceStage {
  id: string;
  title: string;
  diagram: ScienceDiagramKind;
  inputs?: string[];
  text?: string;
  textLabel?: string;
  controls?: PipelineControl[];
  presets?: SciencePreset[];
  run: (args: {
    text: string;
    params: Record<string, number>;
    upstream: (ScienceData | null)[];
  }) => ScienceResult;
}

export interface SciencePipelineDefinition {
  stages: ScienceStage[];
}

export type SciencePipelineMap = Readonly<Record<string, SciencePipelineDefinition>>;

export interface ScienceEvaluation {
  pipeline: string;
  stage: string;
  result: ScienceResult;
  error?: string;
}
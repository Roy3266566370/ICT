export type DiagramKind = 'source' | 'tree' | 'queue' | 'array' | 'graph' | 'bits' | 'grid'
  | 'pipeline' | 'chart' | 'switch' | 'network' | 'summary';

export interface PipelineControl {
  key: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: number; label: string }[];
}

export interface PipelineFrame {
  title: string;
  summary?: string;
  columns?: string[];
  rows?: (string | number)[][];
  highlightRows?: number[];
  series?: { label: string; values: number[] }[];
  timeline?: { label: string; segments: { label: string; start: number; end: number }[] }[];
  graph?: {
    nodes: { id: string; label: string; x: number; y: number; active?: boolean }[];
    edges: { from: string; to: string; label?: string; active?: boolean }[];
  };
}

export interface PipelineResult {
  data: Record<string, unknown>;
  frames: PipelineFrame[];
}

export interface PipelineStage {
  id: string;
  title: string;
  diagram: DiagramKind;
  inputs?: string[];
  text?: string;
  textLabel?: string;
  controls?: PipelineControl[];
  actions?: { label: string; append: string }[];
  presets?: { label: string; text?: string; params: Record<string, number> }[];
  run: (args: { text: string; params: Record<string, number>; upstream: (Record<string, unknown> | null)[] }) => PipelineResult;
}

export interface PipelineDefinition {
  stages: PipelineStage[];
}

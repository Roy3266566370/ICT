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

type ShapeStyle = { stroke?: string; strokeWidth?: number; opacity?: number; label?: string };
type FilledShape = ShapeStyle & { fill?: string };

export type FrameShape =
  | (FilledShape & { kind: 'circle'; cx: number; cy: number; r: number })
  | (FilledShape & { kind: 'rect'; x: number; y: number; w: number; h: number; rx?: number })
  | (ShapeStyle & { kind: 'line' | 'arrow'; x1: number; y1: number; x2: number; y2: number; dashed?: boolean })
  | (FilledShape & { kind: 'polygon'; points: [number, number][] })
  | { kind: 'text'; x: number; y: number; text: string; fill?: string; size?: number; anchor?: 'start' | 'middle' | 'end' };

export interface FrameShapes {
  viewBox?: [number, number];
  items: FrameShape[];
}

export interface FrameGrid {
  cells: number[][];
  mask?: boolean[][];
  rowLabels?: string[];
  colLabels?: string[];
  min?: number;
  max?: number;
  palette?: 'heat' | 'diverging' | 'binary' | 'error';
  showValues?: boolean;
  activeCell?: [number, number];
}

export interface PipelineFrame {
  shapes?: FrameShapes;
  grid?: FrameGrid;
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

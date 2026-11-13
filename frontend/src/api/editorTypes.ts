import type { SlideElement, SlidePage } from './types';

export interface ChartData {categories: string[]; series: Array<{name: string; values: number[]}>;}
export interface InteractionConfig {
  kind: 'matrix' | 'formula' | 'chart' | 'none';
  matrix?: number[][];
  vector?: number[];
  formula?: string;
  defaults?: Record<string, number>;
  categories?: string[];
  series?: ChartData['series'];
}
export interface EditableElement extends SlideElement {
  chart_data?: ChartData | null;
  table_data?: {rows: string[][]} | null;
  math_text?: string | null;
  recognition?: {text: string; matrix?: number[][] | null; reason?: string | null} | null;
  override?: ElementEdit | null;
}
export interface EditorModel {revision: number; pages: Array<Omit<SlidePage, 'elements'> & {elements: EditableElement[]}>;}
export interface ElementEdit {
  page: number;
  element_id: string;
  kind: 'text' | 'chart' | 'table' | 'recognition' | 'interaction';
  text?: string;
  rows?: string[][];
  categories?: string[];
  series?: ChartData['series'];
  interaction?: InteractionConfig;
}

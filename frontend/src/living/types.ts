/** 万象活页的前端权威类型（与后端 `page.1` 文档逐字对应）。 */
import type { LabProblem } from '@/labs/types';

export type PageBlockType =
  | 'page' | 'text' | 'figure' | 'formula' | 'section'
  | 'lab' | 'canvas' | 'quiz' | 'checkpoint' | 'embed';

export type SuggestionKind = 'formula' | 'lab' | 'canvas_object' | 'quiz' | 'section';
export type SuggestionStatus = 'pending' | 'accepted' | 'dismissed';
export type AnswersVisible = 'always' | 'after_attempt' | 'never';

export interface PageBlockSource {
  file_id?: string;
  page?: number;
  span?: [number, number];
}

interface BlockBase<T extends PageBlockType, D> {
  id: string;
  type: T;
  data: D;
  source?: PageBlockSource;
  floor?: boolean;
}

export type PageBlock =
  | BlockBase<'page', { alt: string; image_key?: string; collapsed: boolean; width?: number; height?: number }>
  | BlockBase<'text', { md: string; collapsed?: boolean }>
  | BlockBase<'figure', { asset_id: string; caption: string }>
  | BlockBase<'formula', { latex: string }>
  | BlockBase<'section', { heading: string; level: 1 | 2 | 3 }>
  | BlockBase<'lab', { problem: LabProblem; engine_params: Record<string, unknown>; collapsed: boolean }>
  | BlockBase<'canvas', { doc: Record<string, unknown> }>
  | BlockBase<'quiz', { question: string; answer: string; explain: string; min: number; max: number; value: number }>
  | BlockBase<'checkpoint', { prompt: string; expected: string; placeholder: string }>
  | BlockBase<'embed', { url: string; height: number }>;

export interface ActivationSuggestion {
  id: string;
  block_id: string;
  kind: SuggestionKind;
  confidence: number;
  status: SuggestionStatus;
  proposal: Record<string, unknown>;
  reason: string;
}

export interface LivingPageSettings {
  answers_visible: AnswersVisible;
  allow_fork: boolean;
  collect_progress: boolean;
}

export interface LivingPageDoc {
  schema_version: string;
  page_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  revision: number;
  blocks: PageBlock[];
  suggestions: ActivationSuggestion[];
  source: {
    files: { file_id?: string; name?: string; kind?: string; pages?: number }[];
    pages: { file_id?: string; page?: number; image_key?: string | null; method?: string }[];
    method: string;
  };
  provenance: {
    files: { file_id?: string; name?: string; kind?: string; pages?: number }[];
    conversion: {
      pages_total: number;
      blocks_faithful: number;
      suggestions: number;
      accepted: number;
      notes: string[];
    };
  };
  settings: LivingPageSettings;
  share_id?: string;
  published_at?: string;
}

export interface LivingPageSummary {
  page_id: string;
  title: string;
  block_count: number;
  suggestions_pending: number;
  pages_total: number | null;
  created_at: string;
  updated_at: string;
  revision: number;
}

export interface LivingShareResult {
  share_id: string;
  share_url: string;
  published_at: string;
}

export interface LivingInsights {
  shares: number;
  viewers: number;
  blocks: Record<
    string,
    {
      visits: number;
      quiz_guesses: number[];
      checkpoint_attempts: number;
      checkpoint_correct: number;
      last_active: string | null;
    }
  >;
}

export const SUGGESTION_LABELS: Record<SuggestionKind, string> = {
  formula: '公式',
  lab: '解题实验',
  canvas_object: '活对象',
  quiz: '先猜再看',
  section: '小节',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseLivingPageDoc(value: unknown): LivingPageDoc {
  if (!isRecord(value) || typeof value.page_id !== 'string' || !Array.isArray(value.blocks)) {
    throw new Error('活页数据格式不正确');
  }
  const blocks = (value.blocks as unknown[]).filter(
    (item): item is PageBlock =>
      isRecord(item) && typeof item.id === 'string' && typeof item.type === 'string' && isRecord(item.data),
  );
  const suggestions = Array.isArray(value.suggestions)
    ? (value.suggestions as unknown[]).filter(
        (item): item is ActivationSuggestion =>
          isRecord(item) && typeof item.id === 'string' && typeof item.block_id === 'string',
      )
    : [];
  return {
    ...(value as unknown as LivingPageDoc),
    blocks,
    suggestions,
    settings: {
      answers_visible: 'after_attempt',
      allow_fork: true,
      collect_progress: true,
      ...(isRecord(value.settings) ? (value.settings as Partial<LivingPageSettings>) : {}),
    },
    provenance: isRecord(value.provenance)
      ? (value.provenance as LivingPageDoc['provenance'])
      : { files: [], conversion: { pages_total: 0, blocks_faithful: 0, suggestions: 0, accepted: 0, notes: [] } },
    source: isRecord(value.source)
      ? (value.source as LivingPageDoc['source'])
      : { files: [], pages: [], method: '' },
  };
}

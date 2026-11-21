/** 万象活页的 HTTP 客户端（独立于课件材料的 ApiClient）。 */

import { apiBase, requestBinary, requestJson } from './client';
import {
  parseLivingPageDoc,
  type ActivationSuggestion,
  type LivingInsights,
  type LivingPageDoc,
  type LivingPageSettings,
  type LivingPageSummary,
  type LivingShareResult,
  type PageBlock,
  type PageVariables,
} from '@/living/types';

const P = '/api/v1';

export async function getLivingAIStatus(): Promise<{ available: boolean; model: string }> {
  return requestJson(`${P}/living/ai-status`);
}

export interface LivingAIRecommendation {
  block_id: string;
  title: string;
  page?: number;
  file_id?: string;
  reason: string;
  interaction: string;
  observation: string;
  design_goal: string;
}

export interface LivingAIRecommendations {
  recommendations: LivingAIRecommendation[];
  summary: string;
  reviewed_blocks: number;
  existing_models: number;
  truncated_blocks: number;
  revision: number;
  cached: boolean;
}

export async function recommendLivingModels(input: { pageId: string; expectedRevision: number; force?: boolean }): Promise<LivingAIRecommendations> {
  return requestJson(`${P}/pages/${encodeURIComponent(input.pageId)}/ai-recommendations`, {
    method: 'POST', body: JSON.stringify({ expected_revision: input.expectedRevision, force: input.force ?? false }),
  });
}

export async function generateLivingModel(input: {
  pageId: string; blockId: string; expectedRevision: number; instruction: string; force?: boolean;
}): Promise<{ document: LivingPageDoc; suggestion?: ActivationSuggestion | null; block?: PageBlock | null; cached: boolean }> {
  const result = await requestJson<{
    document: LivingPageDoc; suggestion?: ActivationSuggestion | null; block?: PageBlock | null; cached: boolean;
  }>(
    `${P}/pages/${encodeURIComponent(input.pageId)}/ai-models`, {
      method: 'POST', body: JSON.stringify({ block_id: input.blockId, expected_revision: input.expectedRevision,
        instruction: input.instruction, force: input.force ?? false }),
    });
  return { ...result, document: parseLivingPageDoc(result.document) };
}

export async function createLivingPage(input: {
  files: File[];
  title?: string;
}): Promise<LivingPageDoc> {
  const form = new FormData();
  input.files.forEach((file) => form.append('files', file, file.name));
  if (input.title) form.append('title', input.title);
  const data = await requestJson<LivingPageDoc>(`${P}/pages`, { method: 'POST', body: form });
  return parseLivingPageDoc(data);
}

export async function createLivingPageFromText(input: {
  title: string;
  text: string;
}): Promise<LivingPageDoc> {
  const data = await requestJson<LivingPageDoc>(`${P}/pages/text`, {
    method: 'POST',
    body: JSON.stringify({ title: input.title, text: input.text }),
  });
  return parseLivingPageDoc(data);
}

export async function listLivingPages(): Promise<LivingPageSummary[]> {
  const data = await requestJson<{ pages: LivingPageSummary[] }>(`${P}/pages`);
  return data.pages;
}

export async function getLivingPage(pageId: string): Promise<LivingPageDoc> {
  return parseLivingPageDoc(
    await requestJson<LivingPageDoc>(`${P}/pages/${encodeURIComponent(pageId)}`),
  );
}

export async function patchLivingPage(input: {
  pageId: string;
  expectedRevision: number;
  title?: string;
  blocks?: PageBlock[];
  settings?: Partial<LivingPageSettings>;
  variables?: PageVariables;
}): Promise<LivingPageDoc> {
  const data = await requestJson<LivingPageDoc>(`${P}/pages/${encodeURIComponent(input.pageId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      expected_revision: input.expectedRevision,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.blocks !== undefined ? { blocks: input.blocks } : {}),
      ...(input.settings !== undefined ? { settings: input.settings } : {}),
      ...(input.variables !== undefined ? { variables: input.variables } : {}),
    }),
  });
  return parseLivingPageDoc(data);
}

/** checkpoint 判分：走 ``/living/grade``（expr 数学等价 / numeric 纯数值 / exact 宽松文本）。 */
export async function gradeLivingAnswer(input: {
  answer: string;
  expected: string;
  mode: 'exact' | 'expr' | 'numeric';
}): Promise<{ correct: boolean; reason?: string | null }> {
  return requestJson<{ correct: boolean; reason?: string | null }>(`${P}/living/grade`, {
    method: 'POST',
    body: JSON.stringify({ answer: input.answer, expected: input.expected, mode: input.mode }),
  });
}

export async function acceptSuggestion(input: {
  pageId: string;
  suggestionId: string;
}): Promise<{ document: LivingPageDoc; inserted: PageBlock[] }> {
  const data = await requestJson<{ document: LivingPageDoc; inserted: PageBlock[] }>(
    `${P}/pages/${encodeURIComponent(input.pageId)}/suggestions/${encodeURIComponent(input.suggestionId)}/accept`,
    { method: 'POST' },
  );
  return { ...data, document: parseLivingPageDoc(data.document) };
}

export async function dismissSuggestion(input: {
  pageId: string;
  suggestionId: string;
}): Promise<LivingPageDoc> {
  const data = await requestJson<LivingPageDoc>(
    `${P}/pages/${encodeURIComponent(input.pageId)}/suggestions/${encodeURIComponent(input.suggestionId)}/dismiss`,
    { method: 'POST' },
  );
  return parseLivingPageDoc(data);
}

/** 按需公式 OCR：点击时对区域裁剪跑一次本地识别，latex/expression 缓存回文档。 */
export async function recognizeRegionFormula(input: {
  pageId: string;
  regionId: string;
  expectedRevision: number;
}): Promise<LivingPageDoc> {
  const data = await requestJson<LivingPageDoc>(
    `${P}/pages/${encodeURIComponent(input.pageId)}/regions/${encodeURIComponent(input.regionId)}/formula-ocr`,
    { method: 'POST', body: JSON.stringify({ expected_revision: input.expectedRevision }) },
  );
  return parseLivingPageDoc(data);
}

/** 按需流程图转译：视觉模型 → 校验过的 diagram 写回 region.diagram（预算内、缓存命中不重复调用）。 */
export async function recognizeRegionDiagram(input: {
  pageId: string;
  regionId: string;
  expectedRevision: number;
}): Promise<LivingPageDoc> {
  const data = await requestJson<LivingPageDoc>(
    `${P}/pages/${encodeURIComponent(input.pageId)}/regions/${encodeURIComponent(input.regionId)}/diagram`,
    { method: 'POST', body: JSON.stringify({ expected_revision: input.expectedRevision }) },
  );
  return parseLivingPageDoc(data);
}

export async function createLabBlock(input: {
  pageId: string;
  text: string;
}): Promise<PageBlock> {
  const data = await requestJson<{ block: PageBlock }>(
    `${P}/pages/${encodeURIComponent(input.pageId)}/lab-block`,
    { method: 'POST', body: JSON.stringify({ text: input.text }) },
  );
  return data.block;
}

export function downloadLivingPage(pageId: string): Promise<Blob> {
  return requestBinary(`${P}/pages/${encodeURIComponent(pageId)}/offline`);
}

export async function publishLivingPage(pageId: string): Promise<LivingShareResult> {
  return requestJson<LivingShareResult>(`${P}/pages/${encodeURIComponent(pageId)}/publish`, {
    method: 'POST',
  });
}

export async function getSharedLivingPage(shareId: string): Promise<LivingPageDoc> {
  return parseLivingPageDoc(
    await requestJson<LivingPageDoc>(`${P}/page-shares/${encodeURIComponent(shareId)}`),
  );
}

export async function reportLivingProgress(input: {
  shareId: string;
  blockId: string;
  patch: {
    quiz_guess?: number;
    checkpoint_attempts?: { answer: string; correct: boolean }[];
    lab_states?: Record<string, unknown>;
    notes?: string;
  };
}): Promise<void> {
  await requestJson<{ block_id: string; saved: boolean }>(
    `${P}/page-shares/${encodeURIComponent(input.shareId)}/progress`,
    { method: 'POST', body: JSON.stringify({ block_id: input.blockId, patch: input.patch }) },
  );
}

export async function getLivingInsights(pageId: string): Promise<LivingInsights> {
  return requestJson<LivingInsights>(`${P}/pages/${encodeURIComponent(pageId)}/insights`);
}

export async function deleteLivingPage(pageId: string): Promise<void> {
  await requestJson<void>(`${P}/pages/${encodeURIComponent(pageId)}`, { method: 'DELETE' });
}

export function livingAssetUrl(pageId: string, key: string): string {
  return `${apiBase()}${P}/pages/${encodeURIComponent(pageId)}/assets/${encodeURIComponent(key)}`;
}

export function livingShareAssetUrl(shareId: string, key: string): string {
  return `${apiBase()}${P}/page-shares/${encodeURIComponent(shareId)}/assets/${encodeURIComponent(key)}`;
}

export type { ActivationSuggestion };

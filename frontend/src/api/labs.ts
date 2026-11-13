/** 题目交互实验室的 HTTP 客户端（独立于课件材料的 ApiClient）。 */

import { apiBase, requestJson } from './client';
import type { IntegralTask, ManualIntegralPreview } from '@/labs/manualInput';
import {
  parseLabDocument,
  type LabAssistantResponse,
  type LabAttemptResponse,
  type LabCapabilities,
  type LabDocument,
  type LabMode,
  type LabSaveResponse,
  type LabShareResult,
  type LabSummary,
  type LabSubject,
} from '@/labs/types';

const P = '/api/v1';

export async function previewManualLab(input: { task: IntegralTask; conditions: Record<string, string> }): Promise<ManualIntegralPreview> {
  return requestJson(`${P}/labs/manual/preview`, { method: 'POST', body: JSON.stringify(input) });
}

export async function createManualLab(input: { task: IntegralTask; conditions: Record<string, string>; confirmed: true }): Promise<LabDocument> {
  return parseLabDocument(await requestJson<LabDocument>(`${P}/labs/manual`, { method: 'POST', body: JSON.stringify(input) }));
}

export interface LabUploadFile {
  file: File;
  role: 'problem' | 'data' | 'attempt' | 'reference' | 'courseware';
}

export async function getLabCapabilities(): Promise<LabCapabilities> {
  return requestJson<LabCapabilities>(`${P}/labs/capabilities`);
}

export async function listLabs(): Promise<LabSummary[]> {
  const data = await requestJson<{ items: LabSummary[] }>(`${P}/labs`);
  return data.items;
}

export async function createTextLab(input: {
  title: string;
  text: string;
  subject?: LabSubject | null;
}): Promise<LabDocument> {
  const data = await requestJson<LabDocument>(`${P}/labs/text`, {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      text: input.text,
      ...(input.subject ? { subject: input.subject } : {}),
    }),
  });
  return parseLabDocument(data);
}

export async function uploadLab(input: {
  files: LabUploadFile[];
  title?: string;
  subject?: LabSubject | null;
}): Promise<LabDocument> {
  const form = new FormData();
  input.files.forEach((item) => {
    form.append('files', item.file, item.file.name);
    form.append('roles', item.role);
  });
  if (input.title) form.append('title', input.title);
  if (input.subject) form.append('subject', input.subject);
  const data = await requestJson<LabDocument>(`${P}/labs`, {
    method: 'POST',
    body: form,
  });
  return parseLabDocument(data);
}

export async function getLab(labId: string): Promise<LabDocument> {
  return parseLabDocument(await requestJson<LabDocument>(`${P}/labs/${encodeURIComponent(labId)}`));
}

export async function solveLabWithAI(input: { labId: string; problemId: string; revision: number; mode: 'auto' | 'direct'; force?: boolean }): Promise<LabDocument> {
  const result = await requestJson<{ document: LabDocument }>(`${P}/labs/${encodeURIComponent(input.labId)}/ai-solve`, {
    method: 'POST', body: JSON.stringify({ problem_id: input.problemId, expected_revision: input.revision, mode: input.mode, force: input.force ?? false }),
  });
  return parseLabDocument(result.document);
}

export async function saveLabState(input: {
  labId: string;
  revision: number;
  selectedProblemId?: string;
  state: Record<string, unknown>;
}): Promise<LabSaveResponse> {
  const data = await requestJson<LabSaveResponse>(`${P}/labs/${encodeURIComponent(input.labId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      expected_revision: input.revision,
      selected_problem_id: input.selectedProblemId,
      state: input.state,
    }),
  });
  return { ...data, document: parseLabDocument(data.document) };
}

export async function reviewLabProblem(input: {
  labId: string;
  problemId: string;
  text?: string | null;
  subject?: LabSubject | null;
  conditionValues?: Record<string, unknown>;
  ambiguityAnswers?: Record<string, string>;
}): Promise<LabDocument> {
  const data = await requestJson<LabDocument>(
    `${P}/labs/${encodeURIComponent(input.labId)}/review`,
    {
      method: 'POST',
      body: JSON.stringify({
        problem_id: input.problemId,
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.subject ? { subject: input.subject } : {}),
        condition_values: input.conditionValues ?? {},
        ambiguity_answers: input.ambiguityAnswers ?? {},
      }),
    },
  );
  return parseLabDocument(data);
}

export async function askLab(input: {
  labId: string;
  question: string;
  mode: LabMode;
  step: number;
  params: Record<string, unknown>;
  hintLevel?: number | null;
  selected?: { id?: string; label?: string } | null;
  useAi?: boolean;
}): Promise<LabAssistantResponse> {
  return requestJson<LabAssistantResponse>(`${P}/labs/${encodeURIComponent(input.labId)}/assistant`, {
    method: 'POST',
    body: JSON.stringify({
      question: input.question,
      mode: input.mode,
      step: input.step,
      params: input.params,
      ...(input.hintLevel ? { hint_level: input.hintLevel } : {}),
      ...(input.selected ? { selected: input.selected } : {}),
      use_ai: input.useAi === true,
    }),
  });
}

export async function submitLabAttempt(input: {
  labId: string;
  answer: string;
  field: string;
  params: Record<string, unknown>;
  kind?: string;
  problemId?: string;
}): Promise<LabAttemptResponse> {
  const data = await requestJson<LabAttemptResponse>(
    `${P}/labs/${encodeURIComponent(input.labId)}/attempts`,
    {
      method: 'POST',
      body: JSON.stringify({
        answer: input.answer,
        field: input.field,
        params: input.params,
        kind: input.kind ?? 'numeric',
        problem_id: input.problemId,
      }),
    },
  );
  return { ...data, document: parseLabDocument(data.document) };
}

export async function shareLab(labId: string): Promise<LabShareResult> {
  return requestJson<LabShareResult>(`${P}/labs/${encodeURIComponent(labId)}/share`, {
    method: 'POST',
  });
}

export async function revokeLabShares(labId: string): Promise<{ revoked: number; revoked_at: string }> {
  return requestJson<{ revoked: number; revoked_at: string }>(
    `${P}/labs/${encodeURIComponent(labId)}/share`,
    { method: 'DELETE' },
  );
}

export async function getSharedLab(shareId: string): Promise<LabDocument> {
  return parseLabDocument(
    await requestJson<LabDocument>(`${P}/lab-shares/${encodeURIComponent(shareId)}`),
  );
}

export function labPreviewUrl(labId: string, key: string): string {
  return `${apiBase()}${P}/labs/${encodeURIComponent(labId)}/preview/${encodeURIComponent(key)}`;
}

export function labSharePreviewUrl(shareId: string, key: string): string {
  return `${apiBase()}${P}/lab-shares/${encodeURIComponent(shareId)}/preview/${encodeURIComponent(key)}`;
}

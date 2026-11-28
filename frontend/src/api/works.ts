/**
 * works.ts —— 定象坊 API 客户端：作品存取、发布画廊、fork。
 */
import type { ListingOptions } from './plazaTypes';
import { requestJson } from './client';
import type { CanvasDoc } from '@/canvas/types.ts';

const P = '/api/v1';

export interface WorkSummary {
  work_id: string;
  title: string;
  node_count: number;
  revision: number;
  forked_from_share: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShareSummary {
  share_id: string;
  can_delete: boolean;
  title: string;
  node_count: number;
  forks: number;
  published_at: string;
}

export interface WorkShareDoc {
  share_id: string;
  work_id: string;
  title: string;
  published_at: string;
  document: CanvasDoc;
  allow_fork?: boolean;
}

export interface BlueprintDto {
  id: string;
  kind: 'composite' | 'aiRule';
  title: string;
  summary: string;
  blueprint: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const blueprintsApi = {
  list: (limit = 200) =>
    requestJson<{ items: BlueprintDto[] }>(`${P}/workshop/blueprints?limit=${limit}`),
  save: (input: {
    id?: string;
    kind: 'composite' | 'aiRule';
    title: string;
    summary?: string;
    blueprint: Record<string, unknown>;
  }) =>
    requestJson<BlueprintDto>(`${P}/workshop/blueprints`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  remove: (blueprintId: string) =>
    requestJson<void>(`${P}/workshop/blueprints/${encodeURIComponent(blueprintId)}`, {
      method: 'DELETE',
    }),
};

export const worksApi = {
  create: (document: CanvasDoc, title?: string) =>
    requestJson<{ work_id: string; revision: number; document: CanvasDoc }>(`${P}/works`, {
      method: 'POST',
      body: JSON.stringify({ document, title: title ?? document.title }),
    }),
  list: () => requestJson<{ works: WorkSummary[] }>(`${P}/works`),
  get: (workId: string) =>
    requestJson<{ work_id: string; revision: number; document: CanvasDoc; forked_from_share: string | null }>(
      `${P}/works/${encodeURIComponent(workId)}`,
    ),
  save: (workId: string, revision: number, document: CanvasDoc, title?: string) =>
    requestJson<{ work_id: string; revision: number; document: CanvasDoc }>(
      `${P}/works/${encodeURIComponent(workId)}`,
      { method: 'PATCH', body: JSON.stringify({ expected_revision: revision, document, title }) },
    ),
  remove: (workId: string) =>
    requestJson<void>(`${P}/works/${encodeURIComponent(workId)}`, { method: 'DELETE' }),
  publish: (workId: string, plaza?: ListingOptions) =>
    requestJson<{ share_id: string; share_url: string; published_at: string }>(
      `${P}/works/${encodeURIComponent(workId)}/publish`,
      { method: 'POST', ...(plaza ? { body: JSON.stringify(plaza) } : {}) },
    ),
  gallery: () => requestJson<{ items: ShareSummary[] }>(`${P}/work-shares`),
  getShare: (shareId: string) =>
    requestJson<WorkShareDoc>(`${P}/work-shares/${encodeURIComponent(shareId)}`),
  fork: (shareId: string) =>
    requestJson<{ work_id: string; revision: number; forked_from_share: string }>(
      `${P}/work-shares/${encodeURIComponent(shareId)}/fork`,
      { method: 'POST' },
    ),
  unshare: (shareId: string) =>
    requestJson<void>(`${P}/work-shares/${encodeURIComponent(shareId)}`, { method: 'DELETE' }),
};

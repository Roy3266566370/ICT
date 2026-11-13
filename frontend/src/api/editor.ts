import { requestJson } from './client';
import type { EditorModel, ElementEdit } from './editorTypes';
export type * from './editorTypes';

export function getMaterialEditor(materialId: string): Promise<EditorModel> {
  return requestJson(`/api/v1/materials/${encodeURIComponent(materialId)}/editor`);
}
export function saveMaterialEdits(materialId: string, revision: number, changes: ElementEdit[]): Promise<{job_id: string; revision: number}> {
  return requestJson(`/api/v1/materials/${encodeURIComponent(materialId)}/editor`, {
    method: 'PUT', body: JSON.stringify({expected_revision: revision, changes})});
}

import { requestBinary, requestJson } from './client';

export interface ImportedProject {
  material_id: string;
  page_count: number;
  title: string;
}

/** 下载可再次编辑的 .xsproj 工程包。 */
export function downloadProjectPackage(materialId: string): Promise<Blob> {
  return requestBinary(`/api/v1/materials/${encodeURIComponent(materialId)}/project-package`);
}

/** 导入 .xsproj；服务端校验 schema、哈希并重建材料。 */
export function importProjectPackage(file: File): Promise<ImportedProject> {
  const form = new FormData();
  form.append('file', file, file.name);
  return requestJson<ImportedProject>('/api/v1/project-packages/import', {
    method: 'POST',
    body: form,
  });
}

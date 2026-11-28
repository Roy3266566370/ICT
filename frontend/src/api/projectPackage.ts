import { requestJson } from './client';

export interface ImportedProject {
  material_id: string;
  page_count: number;
  title: string;
}

/** 导入 .xsproj 工程包或万象导出的单文件 .html 交互网页；服务端校验并重建材料。 */
export function importProjectPackage(file: File): Promise<ImportedProject> {
  const form = new FormData();
  form.append('file', file, file.name);
  return requestJson<ImportedProject>('/api/v1/project-packages/import', {
    method: 'POST',
    body: form,
  });
}

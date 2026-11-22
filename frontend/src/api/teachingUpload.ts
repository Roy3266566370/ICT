import { api } from './client';
import { selectWorkbenchUploadFile, WORKBENCH_UPLOAD_ACCEPT } from './teachingUploadRules';

export { selectWorkbenchUploadFile, WORKBENCH_UPLOAD_ACCEPT };

/** 首页上传弹窗与万象活页入口共用：统一上传至横向动态 PPT 工作台。 */
export async function uploadTeachingMaterial(files: File[]): Promise<string> {
  const file = selectWorkbenchUploadFile(files);
  const material = await api.uploadMaterial(file);
  return `/materials/${material.material_id}/work?page=1`;
}

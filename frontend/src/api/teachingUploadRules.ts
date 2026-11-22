/** 横向动态 PPT 工作台统一接收的文件扩展名。 */
export const WORKBENCH_UPLOAD_ACCEPT = '.pptx,.pdf,.png,.jpg,.jpeg';
const WORKBENCH_UPLOAD_RE = /\.(pptx|pdf|jpe?g|png)$/i;

/** 校验上传文件列表并决定处理方式：单份 PPTX/PDF/图片全部直达横向 PPT 工作台。 */
export function selectWorkbenchUploadFile<T extends { name: string }>(files: readonly T[]): T {
  if (!files.length) {
    throw new Error('请先选择要上传的 PPTX、PDF 或图片文件。');
  }
  if (files.length > 1) {
    throw new Error('请每次上传 1 份 PPTX、PDF 或图片，直接进入动态 PPT 工作台。');
  }
  const file = files[0]!;
  if (!WORKBENCH_UPLOAD_RE.test(file.name)) {
    throw new Error('当前仅支持 PPTX、PDF、PNG 或 JPG/JPEG 文件，纵版纯文本活页已下线。');
  }
  return file;
}

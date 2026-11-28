export const FONT_FAMILIES = [
  '微软雅黑', '等线', '宋体', '新宋体', '黑体', '楷体', '仿宋', '思源黑体', '思源宋体', 'PingFang SC',
  'Arial', 'Calibri', 'Aptos', 'Segoe UI', 'Helvetica', 'Verdana', 'Tahoma', 'Yu Gothic',
  'Times New Roman', 'Georgia', 'Cambria', 'Garamond',
  'Consolas', 'Courier New', 'Cascadia Mono', 'Menlo',
];

export function fontFamilyLabel(family: string) {
  return family.replace(/^游ゴシック(?= |$)/, 'Yu Gothic');
}

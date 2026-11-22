import assert from 'node:assert/strict';
import test from 'node:test';
import { selectWorkbenchUploadFile } from './teachingUploadRules.ts';

test('单份 PPTX / PDF / 图片均统一进入横向 PPT 工作台', () => {
  for (const name of ['matrix.pptx', 'lecture.pdf', 'slide.png', 'photo.jpg', 'scan.JPEG']) {
    assert.equal(selectWorkbenchUploadFile([{ name }]).name, name);
  }
});

test('多文件或不支持的纯文本后缀给出明确提示，不再分流到纵版活页', () => {
  assert.throws(() => selectWorkbenchUploadFile([]), /请先选择/);
  assert.throws(() => selectWorkbenchUploadFile([{ name: 'a.pptx' }, { name: 'b.pptx' }]), /每次上传 1 份/);
  assert.throws(() => selectWorkbenchUploadFile([{ name: 'notes.txt' }]), /纵版纯文本活页已下线/);
});

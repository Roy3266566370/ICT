import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { clearDraftsForScope } from '../../state/draftScope.ts';

// Bundle the actual preparation-page module, including its TSX dependencies.
// Only CSS is omitted; storage and scope logic run unchanged.
const directory = mkdtempSync(path.join(tmpdir(), 'xiangsheng-region-drafts-'));
const output = path.join(directory, 'regionDrafts.cjs');
const bundled = buildSync({
  entryPoints: [fileURLToPath(new URL('./regionDrafts.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  loader: { '.module.css': 'empty', '.css': 'empty' },
  logLevel: 'silent',
});
writeFileSync(output, bundled.outputFiles[0]!.contents);
const { draftStorageKey, saveDraft, loadDraft, clearDraft } = createRequire(import.meta.url)(output);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
after(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  rmSync(directory, { recursive: true, force: true });
});

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    get length() { return entries.size; },
    key(index: number) { return [...entries.keys()][index] ?? null; },
    getItem(key: string) { return entries.get(key) ?? null; },
    setItem(key: string, value: string) { entries.set(key, value); },
    removeItem(key: string) { entries.delete(key); },
  };
}
let storage = memoryStorage();
beforeEach(() => {
  storage = memoryStorage();
  Object.defineProperty(globalThis, 'window', { value: { sessionStorage: storage }, configurable: true });
});

const material = 'mat_scope_test';
const region = 'rgn_scope_test';
const signature = 'source-v1';
const accountA = 'user:usr_scope_a';
const accountB = 'user:usr_scope_b';
const draft = {
  sourceSignature: signature, status: 'pending', params: { shear_k: 9 },
  editedKeys: { shear_k: true }, units: {}, errors: {}, templates: {}, editedTemplates: {},
};

test('区域草稿键复用统一格式并区分 A、B 和访客', () => {
  assert.equal(draftStorageKey(material, region, accountA), `xiangsheng.region.v1.${accountA}.${material}.${region}`);
  assert.notEqual(draftStorageKey(material, region, accountA), draftStorageKey(material, region, accountB));
  assert.notEqual(draftStorageKey(material, region, accountA), draftStorageKey(material, region, 'guest'));
});

test('同材料同区域只恢复当前账号的草稿，访客不能读取 A', () => {
  saveDraft(material, region, draft, accountA);
  assert.equal(loadDraft(material, region, signature, accountA)?.params.shear_k, 9);
  assert.equal(loadDraft(material, region, signature, accountB), null);
  assert.equal(loadDraft(material, region, signature, 'guest'), null);
});

test('切换清理器识别真实区域草稿键，只清理退出账号', () => {
  saveDraft(material, region, draft, accountA);
  saveDraft(material, region, { ...draft, params: { shear_k: 3 } }, accountB);
  assert.equal(clearDraftsForScope(accountA, [storage]), 1);
  assert.equal(loadDraft(material, region, signature, accountA), null);
  assert.equal(loadDraft(material, region, signature, accountB)?.params.shear_k, 3);
});

test('无 scope 的旧区域草稿对任何账号和访客均不恢复', () => {
  storage.setItem(`xiangsheng:region-draft:${material}:${region}`, JSON.stringify(draft));
  for (const scope of [accountA, accountB, 'guest']) {
    assert.equal(loadDraft(material, region, signature, scope), null);
  }
});

test('把 A 的草稿内容放到 B 的键下也不能恢复', () => {
  saveDraft(material, region, draft, accountA);
  const raw = storage.getItem(draftStorageKey(material, region, accountA));
  assert.ok(raw);
  storage.setItem(draftStorageKey(material, region, accountB), raw);
  assert.equal(loadDraft(material, region, signature, accountB), null);
});

test('来源签名必须匹配，识别结果变化时拒绝旧参数', () => {
  saveDraft(material, region, draft, accountA);
  assert.equal(loadDraft(material, region, 'source-v2', accountA), null);
  assert.equal(loadDraft(material, region, signature, accountA)?.params.shear_k, 9);
});

test('损坏 JSON 或缺少 scope 的内容不恢复', () => {
  const key = draftStorageKey(material, region, accountA);
  storage.setItem(key, '{broken');
  assert.equal(loadDraft(material, region, signature, accountA), null);
  storage.setItem(key, JSON.stringify(draft));
  assert.equal(loadDraft(material, region, signature, accountA), null);
});

test('清理单一区域不会影响其他账号的同一区域', () => {
  saveDraft(material, region, draft, accountA);
  saveDraft(material, region, draft, accountB);
  clearDraft(material, region, accountA);
  assert.equal(loadDraft(material, region, signature, accountA), null);
  assert.equal(loadDraft(material, region, signature, accountB)?.params.shear_k, 9);
});

test('浏览器拒绝访问 sessionStorage 时读写清理均安全返回', () => {
  Object.defineProperty(globalThis, 'window', {
    value: { get sessionStorage() { throw new Error('blocked'); } }, configurable: true,
  });
  assert.doesNotThrow(() => saveDraft(material, region, draft, accountA));
  assert.equal(loadDraft(material, region, signature, accountA), null);
  assert.doesNotThrow(() => clearDraft(material, region, accountA));
});

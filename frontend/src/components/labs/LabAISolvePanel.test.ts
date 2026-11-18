import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const compiled = buildSync({
  entryPoints: [fileURLToPath(new URL('./LabAISolvePanel.tsx', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
  loader: { '.module.css': 'empty', '.css': 'empty' }, logLevel: 'silent',
  define: { 'import.meta.env': '{}' },
});
const loaded = { exports: {} as Record<string, any> };
vm.runInNewContext(compiled.outputFiles[0]!.text, {
  module: loaded, exports: loaded.exports, require: createRequire(import.meta.url),
  process, URL, console,
});
const Panel = loaded.exports.LabAISolvePanel;

test('AI 参考解答展示完整题意、条件、答案和步骤，不显示自动判分入口', () => {
  const html = renderToStaticMarkup(createElement(Panel, {
    configured: true,
    problem: { text: '', ai_solution: {
      verification: 'ai_reference', question: '两问综合题', interpretation: '先求面积再求体积',
      conditions: ['半径为2'], answer: '参考答案为四',
      steps: [{ title: '计算面积', detail: '使用圆面积公式' }],
      missing_conditions: [], limitations: [], computation: null, checkable: false,
    } },
  }));
  for (const text of ['两问综合题', '先求面积再求体积', '半径为2', '参考答案为四', '计算面积', '使用圆面积公式', '未经内核核验']) {
    assert.ok(html.includes(text), text);
  }
  assert.ok(!html.includes('检验我的答案'));
});

test('未配置模型时提供通用服务提示', () => {
  const html = renderToStaticMarkup(createElement(Panel, {
    configured: false, onSolve: async () => {},
    problem: { text: '', model: {}, recognition: { ambiguities: [] } },
  }));
  assert.ok(!html.includes('启动 Ollama'));
  assert.ok(html.includes('模型服务'));
});

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('AssistantPanel 对 408 非 BFS 题型展示对应提问建议与尝试输入提示，并尊重 readOnly', async (t) => {
  const server = await createServer({
    configFile: false,
    cacheDir: 'node_modules/.vite-lab-assistant-tests',
    root: process.cwd(),
    resolve: { alias: { '@': path.resolve('src') } },
    esbuild: { jsx: 'automatic' },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  t.after(async () => {
    await server.close();
  });

  const [{ AssistantPanel }, { computeLab }] = await Promise.all([
    server.ssrLoadModule('/src/components/labs/AssistantPanel.tsx'),
    server.ssrLoadModule('/src/labs/compute.ts'),
  ]);

  const noop = () => {};
  const asyncNoop = async () => ({ answer: '' });
  const asyncAttemptNoop = async () => null;

  const baseProps = {
    step: 0,
    mode: 'explore' as const,
    selected: null,
    aiConfigured: false,
    useAi: false,
    notes: '',
    attempts: [],
    observations: [],
    draftText: '',
    onModeChange: noop,
    onUseAi: noop,
    onAsk: asyncNoop,
    onAttempt: asyncAttemptNoop,
    onNotes: noop,
    onRecordObservation: noop,
    onSelect: noop,
  };

  const makeProblem = (model: Record<string, unknown>, solution: Record<string, unknown>) => ({
    problem_id: 'prb_1',
    number: null,
    title: '408 测试题',
    text: '测试题干',
    subject: 'algorithm' as const,
    status: 'ready' as const,
    recognition: {
      subject: 'algorithm' as const,
      confidence: 1,
      method: 'typed_text',
      conditions: [],
      formulas: [],
      ambiguities: [],
      warnings: [],
      source_pages: [1],
      source_excerpt: '测试',
    },
    model,
    solution,
    states: {
      params: {},
      step: 0,
      branch_name: '默认',
      notes: '',
      attempts: [],
      scenarios: [],
      chat_history: [],
    },
  });

  const dfsProblem = makeProblem(
    {
      engine: 'dfs_v1',
      subject: 'algorithm',
      algorithm: 'dfs',
      nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
      edges: [{ from: 'A', to: 'B' }],
      directed: false,
      start: 'A',
      defaults: {},
      params: [],
    },
    { summary: 'DFS', answer: 'A → B', answer_order: ['A', 'B'], steps: [], limitations: [] },
  );
  const dfsHtml = renderToStaticMarkup(
    createElement(AssistantPanel, {
      ...baseProps,
      problem: dfsProblem,
      result: computeLab(dfsProblem, {}),
      readOnly: false,
    }),
  );
  assert.match(dfsHtml, /写出 DFS 访问顺序/);
  assert.doesNotMatch(dfsHtml, /问当前这一步，或输入操作指令/);
  assert.doesNotMatch(dfsHtml, /写出 BFS 出队顺序/);

  const sortProblem = makeProblem(
    {
      engine: 'ds_sort_v1',
      subject: 'algorithm',
      algorithm: 'data_structure',
      ds_kind: 'sort_ops',
      defaults: {},
      params: [],
    },
    { summary: '排序', answer: '1, 2, 3', answer_order: ['1', '2', '3'], steps: [], limitations: [] },
  );
  const sortResult = {
    subject: 'algorithm' as const,
    algorithm: 'data_structure' as const,
    dsKind: 'sort_ops',
    status: 'ready' as const,
    headline: '排序结果',
    answer: '1, 2, 3',
    metrics: [],
    pseudocode: ['partition'],
    frames: [{ index: 1, label: '第 1 趟', detail: '划分', values: {} }],
    trace: [],
    checks: [],
    notes: [],
    params: {},
  };
  const sortHtml = renderToStaticMarkup(
    createElement(AssistantPanel, {
      ...baseProps,
      problem: sortProblem,
      result: sortResult,
      readOnly: true,
    }),
  );
  assert.match(sortHtml, /写出本趟或最终排序序列/);
  assert.doesNotMatch(sortHtml, /问当前这一步，或输入操作指令/);
  assert.doesNotMatch(sortHtml, /写出 BFS 出队顺序/);
  assert.match(sortHtml, /<input[^>]*disabled=""/);
});

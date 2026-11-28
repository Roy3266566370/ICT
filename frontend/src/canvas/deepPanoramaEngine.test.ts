import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateDoc, workshopPluginConfigForTemplate } from './templateCatalog.ts';
import { DEEP_PANORAMA_TEMPLATES, VISIBLE_DEEP_TEMPLATES } from './deepPanoramaTemplates.ts';
import {
  allFinite,
  cnnInputMatrix,
  conv2dPanorama,
  CNN_KERNELS,
  demoLoraMatrix,
  diffusionTrajectory,
  entropy,
  trainMlpPanorama,
  trainRlPanorama,
  transformerPanorama,
} from './deepPanoramaEngine.ts';
import { paginationRange } from '../components/plaza/plazaPagination.ts';
import { dfCacheCounts, dfCacheLogits, dfSampleDistribution } from './deepFirst.ts';
import { loraApprox, quantizeMatrix } from './deepModernBlocks.ts';

function assertValidPanoramaDoc(kind: string) {
  const doc = buildTemplateDoc(kind);
  assert.ok(doc.nodes.length >= 6, `${kind} 应为多积木流水线沙盘`);
  const stages = doc.nodes.filter((node) => node.type === 'deepStage');
  assert.equal(stages.length, 4);
  assert.ok(stages.every((node) => node.payload?.startsWith(`${kind}/`)));
  assert.ok(doc.wires.length >= 5);
  assert.ok(doc.panel);
  assert.equal(doc.panel!.view_node_ids.length, 3);
  assert.ok(doc.panel!.exposed_params.length >= 2, 'panel 应声明合理的外露参数');
  const nodeIds = new Set(doc.nodes.map((node) => node.id));
  for (const param of doc.panel!.exposed_params) {
    assert.ok(nodeIds.has(param.node_id));
    assert.ok(param.min < param.max, `${param.param_key} min 应小于 max`);
    assert.ok(param.step > 0, `${param.param_key} step 应为正`);
  }
}

test('六个深度学习全景模板都生成合法多积木 CanvasDoc', () => {
  assert.equal(DEEP_PANORAMA_TEMPLATES.length, 6);
  assert.equal(new Set(DEEP_PANORAMA_TEMPLATES.map((template) => template.kind)).size, 6);
  assert.ok(VISIBLE_DEEP_TEMPLATES.every((template) => template.panorama));
  for (const template of DEEP_PANORAMA_TEMPLATES) assertValidPanoramaDoc(template.kind);
});

test('MLP 训练快照损失、准确率、梯度与网格保持有限', () => {
  const snapshot = trainMlpPanorama({ scenario: 0, activation: 1, width: 6, lr: 0.12, l2: 0.0005, dropout: 0.1, steps: 14 });
  assert.equal(snapshot.losses.length, 15);
  assert.ok(allFinite([snapshot.losses, snapshot.validationLosses, snapshot.gradientNorms]));
  assert.ok(snapshot.accuracy >= 0 && snapshot.accuracy <= 1);
  assert.ok(snapshot.validationAccuracy >= 0 && snapshot.validationAccuracy <= 1);
  assert.ok(snapshot.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test('CNN 卷积扫描输出尺寸与数值正确且有限', () => {
  const input = cnnInputMatrix(0);
  const output = conv2dPanorama(input, CNN_KERNELS[0]!, 1, 0);
  assert.equal(output.length, 10);
  assert.equal(output[0]?.length, 10);
  assert.ok(allFinite(output));
  assert.equal(conv2dPanorama(input, CNN_KERNELS[0]!, 2, 0).length, 5);
});

test('Transformer 注意力行归一、熵与 RoPE 相对矩阵有限', () => {
  const attention = transformerPanorama(24, 2, 1);
  for (const matrix of [attention.scaled, attention.unscaled, attention.headLocal, attention.headLong]) {
    assert.ok(allFinite(matrix));
    for (const row of matrix) assert.ok(Math.abs(row.reduce((sum, value) => sum + value, 0) - 1) < 1e-8);
  }
  assert.ok(Number.isFinite(entropy(attention.scaled[4]!)));
  assert.ok(allFinite(attention.rope));
});

test('扩散粒子轨迹、score 与对数密度保持有限', () => {
  const trajectory = diffusionTrajectory({ scenario: 2, steps: 12, beta: 3 });
  assert.equal(trajectory.frames.length, 13);
  assert.ok(allFinite([trajectory.frames, trajectory.logDensity, trajectory.alphaBar]));
  assert.ok(trajectory.frames.every((frame) => frame.length === 180));
});

test('Q-learning/REINFORCE 快照表格、回报、路径与值函数保持有限', () => {
  for (const reinforce of [0, 1]) {
    const snapshot = trainRlPanorama({ episodes: 10, alpha: 0.18, gamma: 0.95, epsilon: 0.22, reinforce });
    assert.equal(snapshot.table.length, 36);
    assert.equal(snapshot.returns.length, 10);
    assert.ok(allFinite([snapshot.table, snapshot.policy, snapshot.returns, snapshot.steps, snapshot.values]));
    assert.ok(snapshot.lastPath.length >= 2);
  }
});

test('LLM KV-cache、采样漏斗、LoRA 与量化矩阵保持有限且语义一致', () => {
  for (const step of [1, 2, 3, 4]) {
    const counts = dfCacheCounts(step, 8);
    assert.ok(Number.isFinite(counts.totalWith) && Number.isFinite(counts.totalWithout));
    assert.ok(counts.totalWith <= counts.totalWithout);
    const sample = dfSampleDistribution(dfCacheLogits(step), 1, 10, 1);
    assert.ok(Math.abs(sample.probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-8);
    assert.ok(sample.kept.length >= 1);
  }
  const base = demoLoraMatrix();
  const lora = loraApprox(base, 2);
  const quant = quantizeMatrix(base, 2);
  assert.ok(allFinite([lora.a, lora.b, lora.approx, quant.values]));
  assert.ok(lora.compression > 0 && lora.compression < 1);
});

test('全景模板嵌入通文册时携带自身 CanvasDoc，离线/旧运行时无需依赖模板目录', () => {
  for (const template of DEEP_PANORAMA_TEMPLATES) {
    const config = workshopPluginConfigForTemplate(template);
    assert.equal(config.display_mode, 'full');
    assert.ok((config.doc?.nodes.length ?? 0) >= 6, template.kind);
    assert.ok(config.doc?.nodes.some((node) => node.type === 'deepStage' && node.payload?.startsWith(`${template.kind}/`)));
  }
});

test('标本柜分页边界：0/9/10 项、页码折叠与非法页钳制逻辑', () => {
  assert.deepEqual(paginationRange(1, 0), []);
  assert.deepEqual(paginationRange(1, 1), [1]);
  assert.deepEqual(paginationRange(1, 7), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(paginationRange(1, 8), [1, 2, '…', 8]);
  assert.deepEqual(paginationRange(4, 9), [1, '…', 3, 4, 5, '…', 9]);
  assert.deepEqual(paginationRange(9, 9), [1, '…', 8, 9]);
  const pageSize = 9;
  for (const count of [0, 9, 10]) {
    const totalPages = Math.max(1, Math.ceil(count / pageSize));
    assert.equal(totalPages, count === 10 ? 2 : 1);
    const unsafePage = 99;
    const safePage = Math.min(Math.max(1, unsafePage), totalPages);
    assert.equal(safePage, totalPages);
  }
});

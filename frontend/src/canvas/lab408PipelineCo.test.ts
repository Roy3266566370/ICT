import assert from 'node:assert/strict';
import test from 'node:test';
import { coPipelines } from './lab408PipelineCo.ts';
import type { PipelineDefinition } from './lab408PipelineTypes.ts';

function run(kind: string, overrides: Record<string, { text?: string; params?: Record<string, number> }> = {}) {
  const results = new Map<string, ReturnType<PipelineDefinition['stages'][number]['run']>>();
  for (const stage of coPipelines[kind]!.stages) {
    results.set(stage.id, stage.run({
      text: overrides[stage.id]?.text ?? stage.text ?? '',
      params: { ...Object.fromEntries((stage.controls ?? []).map((c) => [c.key, c.value])), ...overrides[stage.id]?.params },
      upstream: (stage.inputs ?? []).map((id) => results.get(id)?.data ?? null),
    }));
  }
  return results;
}

test('virtual pages are translated before cache lookup and replacement', () => {
  const result = run('cacheSimLab', { source: { text: '0x1000 0x2000 0x1000' }, translation: { text: '1=8\n2=9' } });
  assert.equal(result.get('translation')?.frames[2]?.title, 'TLB 命中');
  assert.match(JSON.stringify(result.get('split')?.frames[0]), /0x00008000/);
  assert.match(JSON.stringify(result.get('cache')?.frames[2]), /Hit/);
});

test('forwarding removes ALU bubbles but leaves one load-use bubble', () => {
  const forward = run('pipelineLab');
  const noForward = run('pipelineLab', { forwarding: { params: { forwarding: 0 } } });
  assert.equal(forward.get('timing')?.data.bubbles, 1);
  assert.equal(noForward.get('timing')?.data.bubbles, 4);
  assert.match(JSON.stringify(forward.get('hazards')?.frames), /R1/);
});

test('IEEE-754 preserves all 64 raw bits and encodes decimal input', () => {
  const encoded = run('ieee754Lab', { source: { text: '-12.625' } });
  assert.match(JSON.stringify(encoded.get('width')?.frames), /0xc14a0000/);
  const decoded = run('ieee754Lab', { source: { text: '0x0000000000000001' }, width: { params: { bits: 64 } } });
  assert.match(JSON.stringify(decoded.get('value')?.frames), /5e-324/);
});

test('64-bit fixed-point conversion preserves integers beyond the JS safe range', () => {
  const report = run('ieee754Lab', { source: { text: '9007199254740993' }, width: { params: { fixed: 1, bits: 64, fraction: 0 } } });
  assert.deepEqual(report.get('value')?.frames[0]?.rows?.[0], ['9007199254740993', '0', 1]);
});

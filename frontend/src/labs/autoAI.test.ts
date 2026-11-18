import test from 'node:test';
import assert from 'node:assert/strict';
import { needsAutomaticAISolve, needsModelAfterReview } from './autoAI.ts';
import type { LabProblem } from './types.ts';

test('确认条件后本地未建模的题目重新建模，已就绪和手动模型不重写', () => {
  assert.equal(needsModelAfterReview(problem()), true);
  assert.equal(needsModelAfterReview(problem({ status: 'ready' })), false);
  assert.equal(needsModelAfterReview(problem({ manual_input: { confirmed: true } as LabProblem['manual_input'] })), false);
});

function problem(patch: Partial<LabProblem> = {}): LabProblem {
  return { problem_id: 'p1', text: '两种商品的总价与数量关系，求各自数量。', status: 'unsupported', subject: 'unknown',
    model: { engine: 'unsupported_v1', teaching: false }, ...patch } as LabProblem;
}

test('本地未知题自动进入 AI 理解，包括选错学科但仍未建立模型的题目', () => {
  assert.equal(needsAutomaticAISolve(problem()), true);
  assert.equal(needsAutomaticAISolve(problem({ subject: 'calculus' })), true);
  assert.equal(needsAutomaticAISolve(problem({ status: 'needs_review' })), true);
});

test('本地完整可求解题和纯粹待核对条件的题目沿用原流程', () => {
  const model = { engine: 'calculus_v1', teaching: false } as LabProblem['model'];
  assert.equal(needsAutomaticAISolve(problem({ status: 'ready', subject: 'calculus', model })), false);
  assert.equal(needsAutomaticAISolve(problem({ status: 'needs_review', subject: 'calculus', model })), false);
  assert.equal(needsAutomaticAISolve(problem({ status: 'ready', subject: 'calculus', model: { ...model, teaching: true } })), true);
});

test('已有 AI 结果无需重复理解，文本为空时保留核对入口', () => {
  for (const verification of ['kernel', 'ai_reference', 'needs_review'] as const) {
    assert.equal(needsAutomaticAISolve(problem({ ai_solution: { verification } as LabProblem['ai_solution'] })), false);
  }
  assert.equal(needsAutomaticAISolve(problem({ text: '  ' })), false);
});

test('已有图片解答但公式未核对时自动重读原图，完成一次后不循环重试', () => {
  const p = problem({ source_pages: [{ image_key: 'f1_p1' }] as LabProblem['source_pages'],
    recognition: { ambiguities: [{ id: 'source_formula_confirmation', severity: 'blocking', resolved: false }] } as LabProblem['recognition'],
    ai_solution: { verification: 'needs_review', source_review_required: true } as LabProblem['ai_solution'] });
  assert.equal(needsAutomaticAISolve(p), true);
  p.ai_solution!.source_recovery = { version: 'source-recovery.1', attempted: true, status: 'failed', issues: [], page_keys: ['f1_p1'] };
  assert.equal(needsAutomaticAISolve(p), false);
});

test('旧图片题即使没有歧义标记，残缺的公式也会重新读图', () => {
  assert.equal(needsAutomaticAISolve(problem({ text: String.raw`求 $\frac{1}{x$ 的积分。`,
    source_pages: [{ image_key: 'f1_p1' }] as LabProblem['source_pages'],
    ai_solution: { verification: 'kernel' } as LabProblem['ai_solution'],
    recognition: { ambiguities: [] } as LabProblem['recognition'] })), true);
});

test('手动确认的题目即使需要处理异常也不自动交给 AI 改写', () => {
  assert.equal(needsAutomaticAISolve(problem({ manual_input: {
    task:'integral', conditions:{expression:'x',variable:'x',lower:'0',upper:'1'},
    confirmed:true, latex:'', result_latex:'',
  } })), false);
});

test('ready 图片题已有可执行本地模型时不自动覆盖，空 OCR 原图可以自动理解', () => {
  const source_pages = [{ image_key: 'p1' }] as LabProblem['source_pages'];
  const model = { engine: 'analysis_v1', teaching: false } as LabProblem['model'];
  assert.equal(needsAutomaticAISolve(problem({ status: 'ready', source_pages, subject: 'calculus', model })), false);
  assert.equal(needsAutomaticAISolve(problem({ status: 'ready', source_pages })), true);
  assert.equal(needsAutomaticAISolve(problem({ text: '', source_pages })), true);
  assert.equal(needsAutomaticAISolve(problem({ text: '=', source_pages })), true);
});

test('已知学科但建模条件未识别时也让 AI 提取，纯原图确认继续人工核对', () => {
  const p = problem({status:'needs_review',subject:'calculus',model:{engine:'double_integral_v1',teaching:false} as LabProblem['model'],
    recognition:{ambiguities:[{id:'exam_double_integral',severity:'blocking',resolved:false}]} as LabProblem['recognition']});
  assert.equal(needsAutomaticAISolve(p),true);
  p.recognition.ambiguities[0]!.id = 'source_formula_confirmation';
  assert.equal(needsAutomaticAISolve(p),false);
});

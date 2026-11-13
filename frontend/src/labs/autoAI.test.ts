import test from 'node:test';
import assert from 'node:assert/strict';
import { needsAutomaticAISolve } from './autoAI.ts';
import type { LabProblem } from './types.ts';

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

test('手动确认的题目即使需要处理异常也不自动交给 AI 改写', () => {
  assert.equal(needsAutomaticAISolve(problem({ manual_input: {
    task:'integral', conditions:{expression:'x',variable:'x',lower:'0',upper:'1'},
    confirmed:true, latex:'', result_latex:'',
  } })), false);
});

test('已知学科但建模条件未识别时也让 AI 提取，纯原图确认继续人工核对', () => {
  const p = problem({status:'needs_review',subject:'calculus',model:{engine:'double_integral_v1',teaching:false} as LabProblem['model'],
    recognition:{ambiguities:[{id:'exam_double_integral',severity:'blocking',resolved:false}]} as LabProblem['recognition']});
  assert.equal(needsAutomaticAISolve(p),true);
  p.recognition.ambiguities[0]!.id = 'source_formula_confirmation';
  assert.equal(needsAutomaticAISolve(p),false);
});

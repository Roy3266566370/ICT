import type { ISpec, SpecEvaluation } from '@/ispec/types';

export type PredictionKind = 'choice' | 'numeric' | 'sign';

export interface PredictionQuestion {
  id: string;
  signature: string;
  kind: PredictionKind;
  prompt: string;
  options?: string[];
  answer: string;
  numericAnswer?: number;
  tolerance?: number;
  unit?: string;
  explanation: string;
}

function labelFor(spec: ISpec, key: string): string {
  return spec.expressions?.find((expression) => expression.id === key)?.label ?? key;
}

function detChoice(det: number): { answer: string; explanation: string } {
  if (det < -1e-9) {
    return { answer: '翻转', explanation: `det = ${det.toFixed(6)}：方向翻转，面积变为 ${Math.abs(det).toFixed(6)} 倍。` };
  }
  if (Math.abs(det - 1) <= 1e-9) {
    return { answer: '不变', explanation: 'det = 1：面积保持不变，方向不翻转。' };
  }
  if (Math.abs(det) < 1) {
    return { answer: '变小', explanation: `det = ${det.toFixed(6)}：面积缩小为 ${Math.abs(det).toFixed(6)} 倍。` };
  }
  return { answer: '变大', explanation: `det = ${det.toFixed(6)}：面积扩大为 ${Math.abs(det).toFixed(6)} 倍。` };
}

/**
 * 题目与答案由内核算出的 derived 值生成，不调用模型。
 * 参数变化后 signature 改变，调用方必须重新生成并清除旧预测。
 */
export function buildPrediction(
  spec: ISpec,
  evaluation: SpecEvaluation,
  values: Record<string, number | boolean | string>,
): PredictionQuestion | null {
  const signature = JSON.stringify([spec.object_id, values, evaluation.derived]);
  const derived = evaluation.derived ?? {};
  const det = derived.det;
  if (typeof det === 'number' && Number.isFinite(det)) {
    const choice = detChoice(det);
    return {
      id: `${spec.object_id}:det`,
      signature,
      kind: 'choice',
      prompt: '先不看结果：应用当前矩阵后，单位方格的面积会怎样变化？',
      options: ['变大', '变小', '翻转', '不变'],
      answer: choice.answer,
      explanation: choice.explanation,
    };
  }

  const order = derived.order;
  if (Array.isArray(order) && order.length >= 3) {
    const values = order.map(String);
    const options = [...new Set(values)].slice(0, 4);
    const answer = values[2]!;
    return {
      id: `${spec.object_id}:order:third`,
      signature,
      kind: 'choice',
      prompt: '先预测：按当前图与起点执行 BFS，第 3 个出队的节点是哪一个？',
      options,
      answer,
      explanation: `当前 BFS 出队顺序：${values.join(' → ')}。`,
    };
  }
  const fx = derived.fx;
  const fy = derived.fy;
  if (typeof fx === 'number' && typeof fy === 'number' && Number.isFinite(fx) && Number.isFinite(fy)) {
    const magnitude = Math.hypot(fx, fy);
    const answer = magnitude <= 1e-7 ? '平衡' : fx >= 0 && fy >= 0 ? '第一象限' : fx < 0 && fy >= 0 ? '第二象限' : fx < 0 && fy < 0 ? '第三象限' : '第四象限';
    return {
      id: `${spec.object_id}:force:quadrant`,
      signature,
      kind: 'choice',
      prompt: '先预测：当前合力落在哪个象限，或是否平衡？',
      options: ['第一象限', '第二象限', '第三象限', '第四象限', '平衡'],
      answer,
      explanation: `合力 (${fx.toFixed(4)}, ${fy.toFixed(4)})，大小 ${magnitude.toFixed(4)}；${magnitude <= 1e-7 ? '合力约为 0。' : `方向落在${answer}。`}`,
    };
  }
  const totalA = derived.plan_a_total;
  const totalB = derived.plan_b_total;
  if (typeof totalA === 'number' && typeof totalB === 'number' && Number.isFinite(totalA) && Number.isFinite(totalB)) {
    const answer = Math.abs(totalA - totalB) <= 0.01 ? '两者相同' : totalA < totalB ? '方案 A' : '方案 B';
    return {
      id: `${spec.object_id}:budget:winner`,
      signature,
      kind: 'choice',
      prompt: '先预测：参数改动后，方案 A 还优于方案 B 吗？',
      options: ['方案 A', '方案 B', '两者相同'],
      answer,
      explanation: `方案 A = ${totalA.toFixed(2)}，方案 B = ${totalB.toFixed(2)}。`,
    };
  }
  const numericEntry = Object.entries(derived).find(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]),
  );
  if (!numericEntry) return null;
  const [key, actual] = numericEntry;
  const label = labelFor(spec, key);
  const unit = spec.expressions?.find((expression) => expression.id === key)?.unit ?? '';
  const useSign = key.toLowerCase().includes('angle') || key.toLowerCase().includes('direction');
  if (useSign) {
    const answer = Math.abs(actual) <= 1e-9 ? '零' : actual > 0 ? '正' : '负';
    return {
      id: `${spec.object_id}:${key}:sign`,
      signature,
      kind: 'sign',
      prompt: `先预测当前参数下「${label}」的符号。`,
      options: ['正', '负', '零'],
      answer,
      explanation: `内核计算结果：${label} = ${actual.toFixed(6)}${unit ? ` ${unit}` : ''}。`,
      unit,
    };
  }
  return {
    id: `${spec.object_id}:${key}:numeric`,
    signature,
    kind: 'numeric',
    prompt: `先预测当前参数下「${label}」的值。`,
    answer: String(actual),
    numericAnswer: actual,
    tolerance: Math.max(1e-6, Math.abs(actual) * 1e-6),
    explanation: `内核计算结果：${label} = ${actual.toFixed(6)}${unit ? ` ${unit}` : ''}。`,
    unit,
  };
}

export function checkPrediction(question: PredictionQuestion, raw: string): boolean {
  const response = raw.trim();
  if (!response) return false;
  if (question.kind === 'numeric') {
    const value = Number(response);
    return Number.isFinite(value) && question.numericAnswer !== undefined
      && Math.abs(value - question.numericAnswer) <= (question.tolerance ?? 1e-6);
  }
  return response === question.answer;
}

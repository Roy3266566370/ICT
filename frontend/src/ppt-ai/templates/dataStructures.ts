import {
  check,
  empty,
  fmt,
  listValue,
  metric,
  numberValue,
  type TemplateEvaluation,
  type TemplateValues,
} from './types.ts';

interface Operation { name: 'push' | 'pop' | 'enqueue' | 'dequeue'; value: number | null }

function parseOperations(raw: string): Operation[] {
  const result: Operation[] = [];
  for (const part of raw.replace(/；/g, ';').split(';')) {
    const match = /(push|pop|enqueue|dequeue)\s*(-?\d+(?:\.\d+)?)?/i.exec(part.trim());
    if (!match) continue;
    result.push({
      name: match[1]!.toLowerCase() as Operation['name'],
      value: match[2] ? Number(match[2]) : null,
    });
  }
  return result;
}

export function evaluateStackQueue(values: TemplateValues, _provider: Record<string, unknown>): TemplateEvaluation {
  const mode = String(values.mode ?? 'stack');
  const initial = listValue(values.initial) ?? [];
  const capacity = Math.max(1, Math.round(numberValue(values.capacity, 8)));
  const operations = parseOperations(String(values.operations ?? ''));
  const state = [...initial];
  const steps: (string | number)[][] = [];
  const errors: string[] = [];
  for (const [index, operation] of operations.entries()) {
    let note = '';
    if (operation.name === 'push' || operation.name === 'enqueue') {
      if (operation.value === null) {
        note = '缺少入栈/入队数值，已跳过';
        errors.push(note);
      } else if (state.length >= capacity) {
        note = '容量已满，操作被拒绝';
        errors.push(note);
      } else {
        state.push(operation.value);
        note = `加入 ${fmt(operation.value)}`;
      }
    } else if (operation.name === 'pop' || operation.name === 'dequeue') {
      if (!state.length) {
        note = operation.name === 'pop' ? '空栈，pop 被拒绝' : '空队列，dequeue 被拒绝';
        errors.push(note);
      } else {
        const removed = operation.name === 'pop' ? state.pop()! : state.shift()!;
        note = `${operation.name === 'pop' ? '弹出' : '出队'} ${fmt(removed)}`;
      }
    }
    const expected = operation.name === 'push' || operation.name === 'pop' ? 'stack' : 'queue';
    if (expected !== mode) {
      note = (note ? `${note}；` : '') + `操作 ${operation.name} 与结构 ${mode} 不匹配`;
      errors.push(note);
    }
    steps.push([index + 1, operation.name, JSON.stringify(state.map((value) => Number(value.toPrecision(8)))), note]);
  }
  const checks = [
    check('operation_valid', '操作序列', operations.length ? 'pass' : 'fail', `执行 ${operations.length} 个操作。`),
    check('capacity', '容量', errors.some((item) => item.includes('容量')) ? 'warn' : 'pass', `容量上限 ${capacity}。`),
    check('empty_state', '空结构', errors.some((item) => item.includes('空')) ? 'warn' : 'pass', '空栈/空队列会明确报告。'),
  ];
  return {
    subject: 'data_structure',
    kind: 'stack_queue',
    mode,
    final_state: state,
    errors,
    metrics: [
      metric('final_size', '最终长度', String(state.length)),
      metric('errors', '问题', String(errors.length)),
      metric('capacity', '容量', String(capacity)),
    ],
    series: [],
    table: { headers: ['步骤', '操作', '状态', '说明'], rows: steps },
    checks,
    trace: steps.map((row) => ({ label: `${row[1]} → ${row[2]}` })),
  };
}

function sortSteps(values: number[], algorithm: string): { steps: (string | number)[][]; comparisons: number; moves: number; sorted: number[] } {
  const data = [...values];
  const steps: (string | number)[][] = [];
  let comparisons = 0;
  let moves = 0;
  if (algorithm === 'bubble') {
    for (let round = 0; round < data.length; round += 1) {
      let changed = false;
      for (let index = 0; index < data.length - 1 - round; index += 1) {
        comparisons += 1;
        if (data[index]! > data[index + 1]!) {
          [data[index], data[index + 1]] = [data[index + 1]!, data[index]!];
          moves += 1;
          changed = true;
        }
      }
      steps.push([`第 ${round + 1} 轮`, JSON.stringify(data), comparisons, moves]);
      if (!changed) break;
    }
  } else {
    for (let index = 1; index < data.length; index += 1) {
      const current = data[index]!;
      let position = index - 1;
      while (position >= 0) {
        comparisons += 1;
        if (data[position]! > current) {
          data[position + 1] = data[position]!;
          position -= 1;
          moves += 1;
        } else break;
      }
      data[position + 1] = current;
      steps.push([`插入第 ${index + 1} 个`, JSON.stringify(data), comparisons, moves]);
    }
  }
  return { steps, comparisons, moves, sorted: data };
}

export function evaluateSorting(values: TemplateValues, _provider: Record<string, unknown>): TemplateEvaluation {
  const data = listValue(values.values) ?? [];
  const algorithm = String(values.algorithm ?? 'bubble');
  const checks = [];
  if (data.length > 32) {
    checks.push(check('length_limit', '长度上限', 'fail', '最多 32 个元素。'));
    return empty('data_structure', '元素超过 32 个', checks);
  }
  checks.push(check('length_limit', '长度上限', 'pass', `${data.length} 个元素。`));
  checks.push(check('algorithm_registered', '算法', algorithm === 'bubble' || algorithm === 'insertion' ? 'pass' : 'fail', algorithm));
  const result = sortSteps(data, algorithm);
  checks.push(check('sorted', '升序结果', JSON.stringify(result.sorted) === JSON.stringify([...data].sort((a, b) => a - b)) ? 'pass' : 'fail', '按升序排列。'));
  return {
    subject: 'data_structure',
    kind: 'sorting',
    algorithm,
    sorted: result.sorted,
    comparisons: result.comparisons,
    swaps: result.moves,
    metrics: [
      metric('comparisons', '比较次数', String(result.comparisons)),
      metric('swaps', '移动次数', String(result.moves)),
      metric('length', '元素数', String(data.length)),
    ],
    series: [],
    table: { headers: ['阶段', '列表', '累计比较', '累计移动'], rows: result.steps },
    checks,
    trace: result.steps.map((row) => ({ label: `${row[0]}：${row[1]}` })),
  };
}

export type { Operation };

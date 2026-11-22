import { PAGE_REFERENCE } from './lab408.ts';
import { simulatePages } from '../labs/opsys.ts';
import { bankerFrames, cpuScheduleFrames, type CpuGantt, type CpuProcess } from './lab408SimOsNet.ts';
import type { PipelineDefinition, PipelineFrame, PipelineResult, PipelineStage } from './lab408PipelineTypes.ts';

const empty = '—';
const algorithms = ['FCFS', 'SJF', 'SRTF', 'RR'] as const;
const cpuIds = ['fcfs', 'sjf', 'srtf', 'rr'];
const processExample = 'P1:0:5\nP2:1:3\nP3:2:1';
export const osPageAlgorithms = ['fifo', 'lru', 'opt', 'clock'] as const;
export const osPageCapacity = 10;
const pageBranches = [
  { id: 'fifo3', label: 'FIFO · 3 块', algorithm: 'fifo', capacity: 3 },
  { id: 'fifo4', label: 'FIFO · 4 块', algorithm: 'fifo', capacity: 4 },
  { id: 'lru', label: 'LRU · 3 块', algorithm: 'lru', capacity: 3 },
  { id: 'opt', label: 'OPT · 3 块', algorithm: 'opt', capacity: 3 },
];
const bankerExample = 'Available: 3,3,2\nP0 0,1,0 | 7,4,3\nP1 2,0,0 | 1,2,2\nP2 3,0,2 | 6,0,0\nP3 2,1,1 | 0,1,1\nP4 0,0,2 | 4,3,1';

function message(title: string, summary: string): PipelineResult {
  return { data: {}, frames: [{ title, summary }] };
}

function lines(text: string): string[] {
  return text.split(/[\n;；]+/).map(line => line.trim()).filter(Boolean);
}

function integers(text: string, max: number): number[] | null {
  const tokens = text.trim().split(/[\s,，、;；]+/);
  if (!tokens.every(token => /^\d+$/.test(token))) return null;
  const values = tokens.map(Number);
  return values.every(value => Number.isSafeInteger(value) && value <= max) ? values : null;
}

const processSource: PipelineStage = {
  id: 'processes', title: '进程表', diagram: 'source', text: processExample,
  textLabel: '每行输入「进程 到达时间 服务时间」，最多 12 个进程',
  run({ text }) {
    const rows = lines(text);
    if (!rows.length || rows.length > 12) return message('进程表', '请输入 1–12 个进程。');
    const processes: CpuProcess[] = [];
    for (const [index, row] of rows.entries()) {
      const tokens = row.split(/[\s,，:：]+/);
      const id = tokens.length === 2 ? `P${index + 1}` : tokens.shift()!;
      const durations = integers(tokens.join(' '), 48);
      if (durations?.length !== 2 || durations[1]! < 1 || durations[1]! > 16 || !/^[\p{L}][\p{L}\d_-]*$/u.test(id)) {
        return message('进程表', `第 ${index + 1} 行格式有误。到达时间为 0–48，服务时间为 1–16。`);
      }
      if (processes.some(process => process.id === id)) return message('进程表', `进程标识 ${id} 重复。`);
      processes.push({ id, arrival: durations[0]!, burst: durations[1]! });
    }
    return {
      data: { processes },
      frames: [{ title: '调度输入', columns: ['进程', '到达时间', '服务时间'], rows: processes.map(p => [p.id, p.arrival, p.burst]) }],
    };
  },
};

function ganttTrack(label: string, gantt: CpuGantt[], end: number) {
  const segments = [];
  let position = 0;
  for (const segment of gantt) {
    if (segment.start > position) segments.push({ label: '空闲', start: position, end: segment.start });
    segments.push({ label: segment.pid, start: segment.start, end: segment.end });
    position = segment.end;
  }
  if (position < end) segments.push({ label: '空闲', start: position, end });
  return { label, segments };
}

type Schedule = Omit<ReturnType<typeof cpuScheduleFrames>, 'frames' | 'summary'> & { label: string };

const cpuStages: PipelineStage[] = algorithms.map((algorithm, index) => ({
  id: cpuIds[index]!, title: algorithm, diagram: 'queue', inputs: ['processes'],
  controls: algorithm === 'RR' ? [{ key: 'quantum', label: '时间片', value: 2, min: 1, max: 10, step: 1 }] : undefined,
  run({ params, upstream }) {
    const processes = upstream[0]?.processes as CpuProcess[] | undefined;
    if (!processes) return message(algorithm, '等待有效的进程表。');
    const quantum = Math.max(1, Math.min(10, Math.round(params.quantum ?? 2)));
    const label = algorithm === 'RR' ? `RR (q=${quantum})` : algorithm;
    const schedule = cpuScheduleFrames(processes, algorithm, quantum);
    const remaining = new Map(processes.map(p => [p.id, p.burst]));
    const metrics = new Map(schedule.metrics.map(item => [item.pid, item]));
    const frames: PipelineFrame[] = schedule.frames.map(step => {
      const ready = [...step.ready];
      if (algorithm === 'SJF' || algorithm === 'SRTF') ready.sort((a, b) => remaining.get(a)! - remaining.get(b)!);
      if (step.running) remaining.set(step.running, remaining.get(step.running)! - 1);
      const order = [
        ...processes.filter(p => p.id === step.running),
        ...ready.map(id => processes.find(p => p.id === id)!),
        ...processes.filter(p => p.id !== step.running && !ready.includes(p.id)),
      ];
      return {
        title: `${label} · t=${step.tick} → ${step.tick + 1}`,
        summary: `运行 ${step.running ?? '空闲'} · 就绪队列 ${ready.join(' → ') || '空'}`,
        columns: ['进程', '区间内状态', '区间末剩余', '完成时间', '周转', '带权周转', '等待'],
        rows: order.map(process => {
          const metric = metrics.get(process.id)!;
          const complete = metric.finish <= step.tick + 1;
          const state = process.id === step.running ? '运行' : ready.includes(process.id) ? '就绪' : complete ? '完成' : '未到达';
          return [process.id, state, remaining.get(process.id)!, complete ? metric.finish : empty,
            complete ? metric.turnaround : empty, complete ? metric.weighted.toFixed(2) : empty,
            complete ? metric.turnaround - process.burst : empty];
        }),
        highlightRows: step.running ? [0] : [],
        timeline: [ganttTrack(label, step.gantt, step.tick + 1)],
      };
    });
    const { gantt, metrics: finalMetrics, avgTurnaround, avgWeighted } = schedule;
    return { data: { schedule: { label, gantt, metrics: finalMetrics, avgTurnaround, avgWeighted } }, frames };
  },
}));

const cpuCompare: PipelineStage = {
  id: 'compare', title: '调度结果对照', diagram: 'chart', inputs: cpuIds,
  run({ upstream }) {
    const schedules = upstream.map(value => value?.schedule as Schedule | undefined);
    if (!schedules.every(value => value !== undefined)) return message('调度结果对照', '等待各调度算法生成结果。');
    const end = Math.max(...schedules.flatMap(schedule => schedule.metrics.map(metric => metric.finish)));
    const timeline = schedules.map(schedule => ganttTrack(schedule.label, schedule.gantt, end));
    return {
      data: {},
      frames: [
        {
          title: '四种调度算法的甘特图与平均周转',
          columns: ['算法', '平均周转', '平均带权周转'],
          rows: schedules.map(schedule => [schedule.label, schedule.avgTurnaround.toFixed(2), schedule.avgWeighted.toFixed(2)]),
          timeline,
        },
        {
          title: '逐进程周转明细', columns: ['算法', '进程', '完成时间', '周转', '带权周转'],
          rows: schedules.flatMap(schedule => schedule.metrics.map(metric =>
            [schedule.label, metric.pid, metric.finish, metric.turnaround, metric.weighted.toFixed(2)])),
          timeline,
        },
      ],
    };
  },
};

export function isOsPageLabel(value: unknown): value is string {
  return typeof value === 'string' && /^[\p{L}\p{N}_-]+$/u.test(value);
}

function pageLabels(text: string): string[] {
  return text.trim().split(/[\s,，、;；]+/).filter(Boolean);
}

const pageSource: PipelineStage = {
  id: 'references', title: '页面访问序列', diagram: 'source', text: PAGE_REFERENCE.join(' '),
  textLabel: '按访问顺序输入页号，使用空格或逗号分隔',
  run({ text }) {
    const references = pageLabels(text);
    if (!references.length || references.length > 60 || !references.every(isOsPageLabel)) return message('页面访问序列', '请输入 1–60 个页号，可用数字或字母标识。');
    return { data: { references }, frames: [{ title: '页面访问序列', summary: references.join(' → ') }] };
  },
};

function showVector(values: readonly (string | number | null)[]): string {
  return values.map(value => value ?? empty).join(' · ');
}

type PageStep = ReturnType<typeof simulatePages>[number];
const pageColumns = ['算法', '物理块', '结果', '淘汰页', '累计缺页'];

function pageRow(label: string, step: PageStep) {
  return [label, showVector(step.frames), step.hit ? '命中' : '缺页', step.evicted ?? empty, step.faults];
}

function pageTrace(label: string, steps: PageStep[], extra?: (index: number) => string): PipelineResult {
  return {
    data: { steps },
    frames: steps.map((step, index) => ({
      title: `第 ${index + 1} 次访问 · 页 ${step.page}`,
      summary: `访问物理块 ${step.slot + 1} · 累计命中 ${index + 1 - step.faults} 次${extra?.(index) ?? ''}`,
      columns: pageColumns,
      rows: [pageRow(label, step)],
      highlightRows: step.hit ? [] : [0],
    })),
  };
}

const pageStages: PipelineStage[] = pageBranches.map(branch => ({
  id: branch.id, title: branch.label, diagram: 'array', inputs: ['references'],
  run({ upstream }) {
    const references = upstream[0]?.references as string[] | undefined;
    if (!references) return message(branch.label, '等待有效的页面访问序列。');
    return pageTrace(branch.label, simulatePages(references, branch.capacity, branch.algorithm));
  },
}));

const originalPages: PipelineStage = {
  id: 'original', title: '题设页面置换', diagram: 'array', inputs: ['references'], text: '',
  textLabel: '初始驻留页号，按装入顺序填写，可留空',
  controls: [
    { key: 'algorithm', label: '置换算法', value: 0, options: osPageAlgorithms.map((kind, value) => ({ value, label: kind.toUpperCase() })) },
    { key: 'capacity', label: '物理块数', value: 3, min: 1, max: osPageCapacity, step: 1 },
    { key: 'window', label: '工作集窗口 Δ', value: 4, min: 1, max: 60, step: 1 },
  ],
  run({ text, params, upstream }) {
    const references = upstream[0]?.references as string[] | undefined;
    if (!references) return message('题设页面置换', '等待有效的页面访问序列。');
    const algorithm = osPageAlgorithms[params.algorithm ?? 0]!;
    const capacity = Math.round(params.capacity ?? 3);
    const window = Math.round(params.window ?? 4);
    const initial = pageLabels(text);
    if (initial.length > capacity || new Set(initial).size !== initial.length || !initial.every(isOsPageLabel)) {
      return message('题设页面置换', '初始驻留页不能重复，数量不能超过物理块数。');
    }
    const label = `${algorithm.toUpperCase()} · ${capacity} 块`;
    return pageTrace(label, simulatePages(references, capacity, algorithm, initial), index => {
      const workingSet = new Set(references.slice(Math.max(0, index + 1 - window), index + 1));
      return ` · 工作集 W(t, ${window}) [${showVector([...workingSet])}]`;
    });
  },
};

const pageCompare: PipelineStage = {
  id: 'compare', title: '缺页与 Belady 异常', diagram: 'chart', inputs: pageBranches.map(branch => branch.id),
  run({ upstream }) {
    const branches = upstream.map(value => value?.steps as PageStep[] | undefined);
    if (!branches.every(value => value !== undefined)) return message('缺页对照', '等待各算法的置换轨迹。');
    const series = branches.map((steps, index) => ({ label: pageBranches[index]!.label, values: steps.map(step => step.faults) }));
    const frames = branches[0]!.map((step, index) => {
      const excess = branches[1]![index]!.faults - step.faults;
      return {
        title: `第 ${index + 1} 次访问 · 页 ${step.page}`,
        summary: excess > 0 ? `空块起步 · Belady 偏离：FIFO 4 块累计缺页比 3 块多 ${excess} 次。` : '空块起步 · 此时 FIFO 4 块的累计缺页没有超过 3 块。',
        columns: pageColumns,
        rows: branches.map((steps, branch) => pageRow(pageBranches[branch]!.label, steps[index]!)),
        highlightRows: excess > 0 ? [0, 1] : [],
        series: series.map(track => ({ label: track.label, values: track.values.slice(0, index + 1) })),
      };
    });
    return { data: {}, frames };
  },
};

interface Resources {
  names: string[];
  labels: string[];
  available: number[];
  allocation: number[][];
  need: number[][];
}

function parseResources(text: string): Resources | null {
  const names: string[] = [];
  const needNames: string[] = [];
  const allocation: number[][] = [];
  const need: number[][] = [];
  let available: number[] | null = null;
  let labels: string[] = [];
  let section: 'allocation' | 'need' | null = null;
  for (const line of lines(text)) {
    const resourceNames = /^(?:Resources|资源类型)\s*[:：]\s*(.*)$/i.exec(line);
    if (resourceNames) {
      if (labels.length) return null;
      labels = pageLabels(resourceNames[1]!);
      if (!labels.length || !labels.every(isOsPageLabel) || new Set(labels).size !== labels.length) return null;
      continue;
    }
    const availability = /^(?:Available|可用)\s*[:：]\s*(.*)$/i.exec(line);
    if (availability) {
      if (available) return null;
      available = integers(availability[1]!, 999);
      if (!available || available.length > 8) return null;
      continue;
    }
    if (/^(?:Allocation|分配)\s*[:：]?$/i.test(line)) { section = 'allocation'; continue; }
    if (/^(?:Need|需求)\s*[:：]?$/i.test(line)) { section = 'need'; continue; }
    const identifier = /^([\p{L}][\p{L}\d_-]*)[\s:：]+/u.exec(line);
    const values = (identifier ? line.slice(identifier[0].length) : line).split(/[|｜]/);
    const left = integers(values[0]!, 999);
    if (!left || values.length > 2) return null;
    if (values.length === 2) {
      const right = integers(values[1]!, 999);
      if (!right) return null;
      const name = identifier?.[1] ?? `P${allocation.length}`;
      names.push(name);
      needNames.push(name);
      allocation.push(left);
      need.push(right);
    } else if (section === 'allocation') {
      names.push(identifier?.[1] ?? `P${allocation.length}`);
      allocation.push(left);
    } else if (section === 'need') {
      needNames.push(identifier?.[1] ?? names[need.length] ?? `P${need.length}`);
      need.push(left);
    } else if (available && left.length === 2 * available.length) {
      const name = identifier?.[1] ?? `P${allocation.length}`;
      names.push(name);
      needNames.push(name);
      allocation.push(left.slice(0, available.length));
      need.push(left.slice(available.length));
    } else return null;
  }
  if (!available || !names.length || names.length > 12 || new Set(names).size !== names.length || need.length !== allocation.length) return null;
  if (allocation.some(row => row.length !== available.length)) return null;
  const alignedNeed = names.map(name => need[needNames.indexOf(name)]);
  const width = available.length;
  if (labels.length && labels.length !== width) return null;
  if (!alignedNeed.every((row): row is number[] => row?.length === width)) return null;
  return { names, labels, available, allocation, need: alignedNeed };
}

function matrixFrame(title: string, resources: Resources, summary?: string, selected?: number): PipelineFrame {
  return {
    title,
    summary: `Available [${showVector(resources.available)}]${resources.labels.length ? ` · 资源顺序 ${showVector(resources.labels)}` : ''}${summary ? ` · ${summary}` : ''}`,
    columns: ['进程', 'Allocation', 'Need'],
    rows: resources.names.map((name, index) => [name, showVector(resources.allocation[index]!), showVector(resources.need[index]!)]),
    highlightRows: selected === undefined ? [] : [selected],
  };
}

const bankerSource: PipelineStage = {
  id: 'resources', title: '资源表', diagram: 'source', text: bankerExample,
  textLabel: '首行输入 Available，其余各行输入「进程 Allocation | Need」',
  run({ text }) {
    const resources = parseResources(text);
    if (!resources) return message('资源表', '请输入维度一致的 Available、Allocation、Need，每项为 0–999。支持 1–8 类资源、1–12 个进程。');
    return { data: { resources }, frames: [matrixFrame('试分配前的资源状态', resources)] };
  },
};

type RequestStatus = 'noRequest' | 'invalid' | 'exceedsNeed' | 'unavailable' | 'trial';
const requestMessages: Record<RequestStatus, string> = {
  noRequest: '请求为空，检查原始资源状态。',
  invalid: '请求格式错误，填写资源表中已有的进程和同维度的非负整数。',
  exceedsNeed: '请求超过该进程声明的剩余需求 Need，拒绝。',
  unavailable: '请求超过当前可用资源 Available，进程需等待。',
  trial: '扣减 Available 与 Need，增加 Allocation，进入安全性检查。',
};

const bankerRequest: PipelineStage = {
  id: 'request', title: '资源请求与试分配', diagram: 'array', inputs: ['resources'], text: 'P1: 1,0,2',
  textLabel: '输入「进程: 请求向量」，留空可检查原始资源状态',
  controls: [{ key: 'requestEnabled', label: '资源请求', value: 1, options: [{ value: 1, label: '检查并试分配' }, { value: 0, label: '只检查原始状态' }] }],
  run({ text, params, upstream }) {
    const resources = upstream[0]?.resources as Resources | undefined;
    if (!resources) return message('试分配', '等待有效的资源表。');
    const request = /^([^\s:：]+)[\s:：]+(.+)$/.exec(text.trim());
    const selected = resources.names.indexOf(request?.[1] ?? '');
    const vector = integers(request?.[2] ?? '', 999);
    let status: RequestStatus = 'noRequest';
    let candidate = resources;
    const useRequest = (params.requestEnabled ?? 1) === 1;
    if (useRequest && text.trim()) {
      if (selected < 0 || vector?.length !== resources.available.length) status = 'invalid';
      else if (vector.some((value, index) => value > resources.need[selected]![index]!)) status = 'exceedsNeed';
      else if (vector.some((value, index) => value > resources.available[index]!)) status = 'unavailable';
      else {
        status = 'trial';
        candidate = {
          names: resources.names,
          labels: resources.labels,
          available: resources.available.map((value, index) => value - vector[index]!),
          allocation: resources.allocation.map((row, process) => process === selected ? row.map((value, index) => value + vector[index]!) : row),
          need: resources.need.map((row, process) => process === selected ? row.map((value, index) => value - vector[index]!) : row),
        };
      }
    }
    const check = status === 'trial' ? '通过 Need 和 Available 检查。'
      : !useRequest && text.trim() ? '保留输入，检查原始资源状态。' : requestMessages[status];
    const requestSummary = request && vector ? `${request[1]} 请求 [${showVector(vector)}] · ${check}` : check;
    const frames = [matrixFrame('请求校验', resources, requestSummary, selected >= 0 ? selected : undefined)];
    if (status === 'trial') frames.push(matrixFrame('试分配后的资源状态', candidate, requestMessages.trial, selected));
    return { data: { ...candidate, resources: candidate, status }, frames };
  },
};

const bankerSafety: PipelineStage = {
  id: 'safety', title: '安全性检查', diagram: 'queue', inputs: ['request'],
  run({ upstream }) {
    const stage = upstream[0];
    const resources = stage?.resources as Resources | undefined;
    if (!resources) return message('安全性检查', '等待资源请求校验。');
    const status = stage?.status as RequestStatus;
    if (status !== 'trial' && status !== 'noRequest') return message('安全性检查', requestMessages[status]);
    const safety = bankerFrames(resources.available, resources.allocation, resources.need);
    const last = safety.frames.at(-1)!;
    const sequence = last.sequence.map(index => resources.names[index]!);
    return {
      data: { safe: last.safe, sequence },
      frames: safety.frames.map((step, index) => {
        const name = step.trial === null ? null : resources.names[step.trial]!;
        const order = step.sequence.map(process => resources.names[process]);
        const reason = name ? `${name} 的 Need 可满足，模拟完成并回收 Allocation。` : step.note;
        return {
          title: name ? `模拟完成 ${name}` : index === 0 ? '初始化 Work 和 Finish' : '安全性检查停滞',
          summary: `Work [${showVector(step.work)}] · 序列 ${order.join(' → ') || empty} · ${reason}`,
          columns: ['进程', 'Need', 'Finish', '下一步资格'],
          rows: resources.names.map((pid, process) => {
            const demand = resources.need[process]!;
            const shortage = demand.map((value, dimension) => Math.max(0, value - step.work[dimension]!));
            return [pid, showVector(demand), step.finish[process] ? '是' : '否',
              step.finish[process] ? '已回收' : shortage.some(Boolean) ? `还缺 [${showVector(shortage)}]` : '可完成'];
          }),
          highlightRows: step.trial === null ? [] : [step.trial],
        };
      }),
    };
  },
};

const bankerDecision: PipelineStage = {
  id: 'decision', title: '授权或回滚', diagram: 'summary', inputs: ['resources', 'request', 'safety'],
  run({ upstream }) {
    const original = upstream[0]?.resources as Resources | undefined;
    const candidate = upstream[1]?.resources as Resources | undefined;
    const requestStatus = upstream[1]?.status as RequestStatus | undefined;
    if (!original || !candidate || !requestStatus) return message('资源分配决策', '等待有效资源状态。');
    const safe = upstream[2]?.safe === true;
    const sequence = (upstream[2]?.sequence as string[] | undefined) ?? [];
    const status = requestStatus === 'trial' ? safe ? 'granted' : 'rolledBack' : requestStatus;
    const resources = status === 'granted' ? candidate : original;
    const order = sequence.join(' → ');
    const details = {
      granted: `批准请求，保留试分配。安全序列 ${order}。`,
      rolledBack: `试分配后找不到完整的安全序列${order ? `，只能推进 ${order}` : ''}。撤销试分配并恢复原资源表。`,
      noRequest: safe ? `原始状态安全，安全序列 ${order}。` : '原始状态不安全，找不到完整的安全序列。',
      exceedsNeed: requestMessages.exceedsNeed,
      unavailable: requestMessages.unavailable,
      invalid: requestMessages.invalid,
    };
    return { data: { ...resources, status, safe, sequence }, frames: [matrixFrame('最终资源状态', resources, details[status])] };
  },
};

export const osPipelines: Record<string, PipelineDefinition> = {
  cpuScheduleLab: { stages: [processSource, ...cpuStages, cpuCompare] },
  pageReplace: { stages: [pageSource, ...pageStages, pageCompare] },
  pageReplaceOriginal: { stages: [pageSource, originalPages, ...pageStages, pageCompare] },
  bankerLab: { stages: [bankerSource, bankerRequest, bankerSafety, bankerDecision] },
};

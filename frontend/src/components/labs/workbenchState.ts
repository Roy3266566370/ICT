import { draftStorageKey, type DraftScope } from '@/state/draftScope';
import { clamp, formatNumber } from '@/labs/expr';
import { defaultParams, type computeLab } from '@/labs/compute';
import { OS_KIND_LABELS } from '@/labs/opsys';
import { CO_KIND_LABELS } from '@/labs/compOrg';
import { NET_KIND_LABELS } from '@/labs/network';
import { PHYSICS_MODE_LABELS } from '@/labs/physics';
import type { LabDocument, LabProblem, LabScenario, LabState } from '@/labs/types';

interface Draft {
  revision: number;
  dirty: boolean;
  state: LabState;
  /** 写入时的账号 scope；与当前 scope 不符则丢弃（R5-AC3）。 */
  scope: DraftScope;
}

/** 键由 `C-DRAFT-SCOPE@1` 生成：`xiangsheng.lab.v1.<scope>.<labId>.<problemId>`。 */
function storageKey(labId: string, problemId: string, scope: DraftScope): string {
  return draftStorageKey('lab', scope, [labId, problemId]);
}

export function readDraft(labId: string, problemId: string, scope: DraftScope): Draft | null {
  try {
    const raw = window.localStorage.getItem(storageKey(labId, problemId, scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (!parsed || typeof parsed !== 'object' || !parsed.state) return null;
    // 键已含 scope，值里的 scope 是二次校验：旧格式/手工拷贝的数据一律不恢复。
    if (parsed.scope !== scope) return null;
    return parsed as Draft;
  } catch {
    return null;
  }
}

export function writeDraft(labId: string, problemId: string, scope: DraftScope, revision: number, state: LabState, dirty: boolean): void {
  try {
    window.localStorage.setItem(
      storageKey(labId, problemId, scope),
      JSON.stringify({ revision, dirty, state, scope } satisfies Draft),
    );
  } catch {
    /* 隐私模式或存储已满：服务端仍可保存 */
  }
}

export function baselineScenario(problem: LabProblem): LabScenario {
  return {
    id: 'baseline',
    name: '原题条件',
    params: { ...(problem.model.defaults ?? {}) },
    created_at: null,
    kind: 'baseline',
    summary: '题目识别后建立的原条件',
  };
}

export function blankState(problem: LabProblem): LabState {
  const params = defaultParams(problem);
  return {
    params,
    step: 0,
    mode: 'guided',
    notes: '',
    observations: [],
    events: [],
    scenarios: [baselineScenario(problem)],
    active_scenario_id: 'baseline',
    attempts: [],
    evaluated: null,
  };
}

export function stateFromProblem(problem: LabProblem): LabState {
  const raw = problem.states ?? blankState(problem);
  const defaults = defaultParams(problem);
  const params: Record<string, unknown> = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (raw.params && key in raw.params) params[key] = raw.params[key];
  }
  const scenarios = raw.scenarios?.length ? raw.scenarios : [baselineScenario(problem)];
  return {
    params,
    step: Number.isFinite(raw.step) ? Number(raw.step) : 0,
    mode: 'guided',
    notes: raw.notes ?? '',
    observations: raw.observations ?? [],
    events: raw.events ?? [],
    scenarios,
    active_scenario_id: raw.active_scenario_id ?? 'baseline',
    attempts: raw.attempts ?? [],
    evaluated: raw.evaluated ?? null,
    manual: raw.manual && typeof raw.manual === 'object' ? raw.manual : {},
  };
}

export function scenarioName(problem: LabProblem, params: Record<string, unknown>): string {
  const subject = problem.subject;
  if (subject === 'optimization') {
    return `η ${formatNumber(Number(params.learning_rate), 3)} · x₀ ${formatNumber(Number(params.x0 ?? params.y0), 2)}`;
  }
  if (subject === 'calculus') {
    const kind = problem.model.kind ?? 'integral';
    if (kind === 'antiderivative') {
      return `C=${formatNumber(Number(params.c ?? problem.model.defaults.c ?? 0), 2)}`;
    }
    if (kind === 'integral') {
      return `区间 [${formatNumber(Number(params.lower))}, ${formatNumber(Number(params.upper))}] · n=${formatNumber(Number(params.n), 0)}`;
    }
    return `x=${formatNumber(Number(params.point))} · h=${formatNumber(Number(params.h), 3)}`;
  }
  if (subject === 'algorithm') {
    if (String(problem.model.engine ?? '').startsWith('ds_')) return '原题执行';
    return problem.model.engine === 'heap_v1'
      ? `删除 ${String(params.deletion_count ?? '')} 次` : `起点 ${String(params.start ?? problem.model.start ?? '')}`;
  }
  if (subject === 'linear_algebra') {
    if (problem.model.la_kind === 'eigen') return '精确特征值与特征空间';
    if (problem.model.la_kind === 'matmul') {
      const op = problem.model.op;
      if (op === 'scalar') return `数乘 k=${formatNumber(Number(params.scalar ?? problem.model.defaults.scalar ?? 2), 2)}`;
      if (op === 'mul') return String(params.order ?? 'ab') === 'ba' ? 'B·A 乘积' : 'A·B 乘积';
      return op === 'sub' ? 'A−B' : 'A+B';
    }
    return `${String(params.method ?? 'gauss') === 'jordan' ? '若尔当' : '高斯消元'} · ${String(params.pivoting ?? 'partial') === 'none' ? '不选主元' : '部分主元'}`;
  }
  if (subject === 'operating_system') {
    const algorithm = String(params.algorithm ?? problem.model.defaults.algorithm ?? '').toUpperCase();
    if (problem.model.os_kind === 'cpu_schedule' && algorithm === 'RR') {
      return `RR q=${formatNumber(Number(params.quantum ?? problem.model.defaults.quantum ?? 2), 2)}`;
    }
    if (problem.model.os_kind === 'page_replace') {
      if (!(problem.model.reference?.length)) return OS_KIND_LABELS.page_replace ?? '虚拟内存';
      return `${algorithm} · ${formatNumber(Number(params.frames ?? problem.model.defaults.frames ?? 3), 0)} 块 · Δ=${formatNumber(Number(params.window ?? problem.model.defaults.window ?? 4), 0)}`;
    }
    if (problem.model.os_kind === 'disk_schedule' && ['SCAN', 'CSCAN', 'LOOK', 'CLOOK'].includes(algorithm)) {
      return `${algorithm} · ${String(params.direction ?? 'up') === 'down' ? '向小' : '向大'}`;
    }
    if (problem.model.os_kind === 'banker') {
      return String(params.request_mode ?? problem.model.defaults.request_mode ?? 'ignore') === 'apply' ? '处理资源请求' : '当前状态';
    }
    return algorithm || OS_KIND_LABELS[String(problem.model.os_kind)] || '原题条件';
  }
  if (subject === 'computer_organization') {
    return CO_KIND_LABELS[String(problem.model.co_kind ?? '')] ?? '原题条件';
  }
  if (subject === 'computer_network') {
    return NET_KIND_LABELS[String(problem.model.net_kind ?? '')] ?? '原题条件';
  }
  if (subject === 'physics') {
    return PHYSICS_MODE_LABELS[String(problem.model.physics_mode ?? '')] ?? '物理实验';
  }
  return `η ${formatNumber(Number(params.learning_rate), 3)} · ${formatNumber(Number(params.epochs), 0)} 轮`;
}

export function solutionStepIndex(result: ReturnType<typeof computeLab>, stepId: string, current: number): number | null {
  const last = Math.max(0, result.trace.length - 1);
  if (result.subject === 'calculus') {
    if (result.kind === 'antiderivative') {
      if (stepId === 'integrand' || stepId === 'antiderivative') return 0;
      if (stepId === 'verify') return last;
    }
    if (result.kind === 'integral') {
      if (stepId === 'limits' || stepId === 'antiderivative') return 0;
      if (stepId === 'evaluate' || stepId === 'approx') return last;
    }
    if (stepId === 'approx') return last;
    if (stepId === 'value' || stepId === 'derivative' || stepId === 'slope'
      || stepId === 'preimage' || stepId === 'inverse_formula') return 0;
    return null;
  }
  if (result.subject === 'optimization') {
    if (stepId === 'objective') return 0;
    if (stepId === 'update') return Math.min(last, current + 1);
    if (stepId === 'stop') return last;
    return null;
  }
  if (result.subject === 'algorithm') {
    if (result.algorithm === 'heap') {
      const index = Number(stepId.replace(/^heap_/, ''));
      return Number.isInteger(index) ? clamp(index, 0, last) : null;
    }
    if (stepId === 'init') return 0;
    const action = stepId === 'dequeue' ? 'dequeue' : stepId === 'enqueue' ? 'enqueue' : '';
    const index = result.frames.findIndex((frame) => frame.action === action);
    return index >= 0 ? index : null;
  }
  if (result.subject === 'deep_learning') {
    if (stepId === 'forward' || stepId === 'loss') return stepId === 'loss' ? last : 0;
    if (stepId === 'backward' || stepId === 'update') return last;
  }
  if (result.subject === 'linear_algebra') {
    const match = /^la_(\d+)$/.exec(stepId);
    if (match) return clamp(Number(match[1]), 0, last);
    return null;
  }
  if (result.subject === 'operating_system') {
    const match = /^os_(\d+)$/.exec(stepId);
    if (match) return clamp(Number(match[1]), 0, last);
    return null;
  }
  if (result.subject === 'computer_organization') {
    const match = /^co_(\d+)$/.exec(stepId);
    if (match) return clamp(Number(match[1]), 0, last);
    return null;
  }
  if (result.subject === 'computer_network') {
    const match = /^net_(\d+)$/.exec(stepId);
    if (match) return clamp(Number(match[1]), 0, last);
    return null;
  }
  if (result.subject === 'physics') {
    const match = /^phy_(\d+)$/.exec(stepId);
    if (match) return clamp(Number(match[1]), 0, last);
    return null;
  }
  return null;
}

export function uploadedText(lab: LabDocument | null, roles: string[]): string {
  if (!lab) return '';
  const fileIds = new Set(
    lab.source.files.filter((file) => roles.includes(file.role)).map((file) => file.file_id),
  );
  return lab.source.pages
    .filter((page) => fileIds.has(page.file_id))
    .map((page) => page.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

export function saveStatusText(status: string): string {
  if (status === 'saving') return '正在保存';
  if (status === 'saved') return '已保存到服务端';
  if (status === 'error') return '同步失败，本机草稿已保留';
  if (status === 'restored') return '已恢复本机草稿';
  return '有修改，等待保存';
}

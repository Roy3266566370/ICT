import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import { SiteNav } from '@/components/home/SiteNav';
import { errorMessage, isApiError } from '@/api/client';
import {
  askLab,
  getLab,
  labPreviewUrl,
  reviewLabProblem,
  saveLabState,
  shareLab,
  submitLabAttempt,
  solveLabWithAI,
  reviseCompositeLab,
} from '@/api/labs';
import { LabCanvas, type LabSelection } from '@/components/labs/LabCanvas';
import { LabControls } from '@/components/labs/LabControls';
import { LabTimeline } from '@/components/labs/LabTimeline';
import { LabSourcePanel, type SourceTab } from '@/components/labs/LabSourcePanel';
import { ProblemTitle } from '@/components/labs/ProblemText';
import { AssistantPanel } from '@/components/labs/AssistantPanel';
import { ReviewDialog, type ReviewPayload } from '@/components/labs/ReviewDialog';
import { OriginalCompare } from '@/components/labs/OriginalCompare';
import { OutcomePanel } from '@/components/labs/OutcomePanel';
import { CompositeSolvePanel } from '@/components/labs/CompositeSolvePanel';
import { LabAISolvePanel } from '@/components/labs/LabAISolvePanel';
import { ManualIntegralResult } from '@/components/labs/ManualIntegralResult';
import { clamp, formatNumber } from '@/labs/expr';
import { computeLab, currentFrame, defaultParams } from '@/labs/compute';
import { OS_KIND_LABELS } from '@/labs/opsys';
import { parseLabCommand, COMMAND_EXAMPLES } from '@/labs/commands';
import { CO_KIND_LABELS } from '@/labs/compOrg';
import {
  commitHistory,
  createHistory,
  redoHistory,
  sameValue,
  undoHistory,
  type LabHistory,
} from '@/labs/history';
import { useReducedMotion } from '@/hooks/useMotionPreference';
import { useAccountScope } from '@/state/accountSession';
import { draftStorageKey, type DraftScope } from '@/state/draftScope';
import {
  isBlocking,
  MODE_LABELS,
  SUBJECT_LABELS,
  type LabAssistantResponse,
  type LabDocument,
  type LabEvaluated,
  type LabMode,
  type LabProblem,
  type LabScenario,
  type LabState,
  type LabSubject,
} from '@/labs/types';
import styles from './LabWorkbenchPage.module.css';

const ENGINE_LABELS: Record<string, string> = {
  antiderivative_v1: '不定积分 · 原函数族',
  riemann_v1: '定积分 · 黎曼和',
  tangent_v1: '导数 · 切线',
  series_v1: '数项级数 · 部分和',
  power_series_v1: '幂级数 · 收敛域',
  fourier_v1: '傅里叶级数 · 系数',
  gradient_descent_v1: '梯度下降',
  bfs_v1: '广度优先搜索',
  dfs_v1: '深度优先搜索',
  mlp_v1: '小型全连接网络',
  heap_v1: '堆顶删除 · 向下筛选',
  gauss_v1: '高斯消元 · 线性代数',
  matmul_v1: '矩阵运算',
  space_v1: '空间对象 · 曲线、曲面与几何',
  proof_v1: '证明与存在性 · 证书核对',
  unsupported_v1: '待核对的题目',
  sympy: '数学模型',
};

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

function readDraft(labId: string, problemId: string, scope: DraftScope): Draft | null {
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

function writeDraft(labId: string, problemId: string, scope: DraftScope, revision: number, state: LabState, dirty: boolean): void {
  try {
    window.localStorage.setItem(
      storageKey(labId, problemId, scope),
      JSON.stringify({ revision, dirty, state, scope } satisfies Draft),
    );
  } catch {
    /* 隐私模式或存储已满：服务端仍可保存 */
  }
}

function baselineScenario(problem: LabProblem): LabScenario {
  return {
    id: 'baseline',
    name: '原题条件',
    params: { ...(problem.model.defaults ?? {}) },
    created_at: null,
    kind: 'baseline',
    summary: '题目识别后建立的原条件',
  };
}

function blankState(problem: LabProblem): LabState {
  const params = defaultParams(problem);
  return {
    params,
    step: 0,
    mode: 'explore',
    notes: '',
    observations: [],
    events: [],
    scenarios: [baselineScenario(problem)],
    active_scenario_id: 'baseline',
    attempts: [],
    evaluated: null,
  };
}

function stateFromProblem(problem: LabProblem): LabState {
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
    mode: raw.mode ?? 'explore',
    notes: raw.notes ?? '',
    observations: raw.observations ?? [],
    events: raw.events ?? [],
    scenarios,
    active_scenario_id: raw.active_scenario_id ?? 'baseline',
    attempts: raw.attempts ?? [],
    evaluated: raw.evaluated ?? null,
  };
}

function scenarioName(problem: LabProblem, params: Record<string, unknown>): string {
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
      return `${algorithm} · ${formatNumber(Number(params.frames ?? problem.model.defaults.frames ?? 3), 0)} 块`;
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
  return `η ${formatNumber(Number(params.learning_rate), 3)} · ${formatNumber(Number(params.epochs), 0)} 轮`;
}

function solutionStepIndex(result: ReturnType<typeof computeLab>, stepId: string, current: number): number | null {
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
    if (stepId === 'value' || stepId === 'derivative' || stepId === 'slope') return 0;
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
  return null;
}

function uploadedText(lab: LabDocument | null, roles: string[]): string {
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

function saveStatusText(status: string): string {
  if (status === 'saving') return '正在保存';
  if (status === 'saved') return '已保存到服务端';
  if (status === 'error') return '同步失败，本机草稿已保留';
  if (status === 'restored') return '已恢复本机草稿';
  return '有修改，等待保存';
}

function Gate({
  problem,
  onReview,
}: {
  problem: LabProblem;
  onReview: () => void;
}): ReactNode {
  const blocking = problem.recognition.ambiguities.filter(
    (item) => item.severity === 'blocking' && !item.resolved,
  );
  return (
    <div className={styles.gate}>
      <span className={styles.gateIcon} aria-hidden="true">!</span>
      <div>
        <span className={styles.eyebrow}>CHECK FIRST</span>
        <h2>先核对关键条件，再开始求解</h2>
        <p>识别到了题目，但以下条件会影响数值或题意。系统不会在关键条件未确认时直接给出答案。</p>
        <ul>
          {blocking.map((item) => (
            <li key={item.id}>{item.question}</li>
          ))}
        </ul>
        <button type="button" className={styles.gateButton} onClick={onReview}>
          核对条件并求解
        </button>
      </div>
    </div>
  );
}

export function LabWorkbenchPage(): JSX.Element {
  const { labId = '' } = useParams();
  // 账号 scope 的唯一来源（C-SESSION@1）：本机草稿键按它隔离（R5-AC3）。
  const scope = useAccountScope();
  const reducedMotion = useReducedMotion();
  const [lab, setLab] = useState<LabDocument | null>(null);
  const [problemId, setProblemId] = useState('');
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<LabMode>('explore');
  const [notes, setNotes] = useState('');
  const [scenarios, setScenarios] = useState<LabScenario[]>([]);
  const [attempts, setAttempts] = useState<LabState['attempts']>([]);
  const [observations, setObservations] = useState<LabState['observations']>([]);
  const [events, setEvents] = useState<LabState['events']>([]);
  const [evaluated, setEvaluated] = useState<LabEvaluated | null>(null);
  const [, setRevision] = useState(1);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [history, setHistory] = useState<LabHistory<Record<string, unknown>>>(createHistory({}));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [sourceTab, setSourceTab] = useState<SourceTab>('problem');
  const [selected, setSelected] = useState<LabSelection | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPreparedState, setAiPreparedState] = useState<LabState | null>(null);
  const aiBusyRef = useRef(false);
  const activeLabIdRef = useRef(labId);
  activeLabIdRef.current = labId;
  const [compareOpen, setCompareOpen] = useState(false);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const [commandText, setCommandText] = useState('');
  const [commandMessage, setCommandMessage] = useState<string | null>(null);
  const [compareEnabled, setCompareEnabled] = useState(true);
  const [compareScenarioId, setCompareScenarioId] = useState('baseline');

  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const queuedRef = useRef(false);
  const revisionRef = useRef(1);
  const problemIdRef = useRef('');
  const stateRef = useRef<LabState | null>(null);
  const historyRef = useRef<LabHistory<Record<string, unknown>>>(createHistory({}));
  const paramsRef = useRef<Record<string, unknown>>({});
  const saveTimerRef = useRef<number | null>(null);
  const persistRef = useRef<(() => Promise<boolean>) | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [labId, problemId]);

  const problem = useMemo(
    () => lab?.problems.find((item) => item.problem_id === problemId) ?? lab?.problems[0] ?? null,
    [lab, problemId],
  );

  const applyProblemState = useCallback((nextProblem: LabProblem, nextRevision?: number) => {
    const state = stateFromProblem(nextProblem);
    const baseline = baselineScenario(nextProblem);
    const scenariosNext = state.scenarios.length ? state.scenarios : [baseline];
    paramsRef.current = state.params;
    setParams(state.params);
    setStep(state.step);
    setMode(state.mode);
    setNotes(state.notes);
    setScenarios(scenariosNext);
    setAttempts(state.attempts);
    setObservations(state.observations);
    setEvents(state.events);
    setEvaluated(state.evaluated);
    setProblemId(nextProblem.problem_id);
    problemIdRef.current = nextProblem.problem_id;
    const nextHistory = createHistory(state.params);
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    const nextRevisionValue = nextRevision ?? revisionRef.current;
    revisionRef.current = nextRevisionValue;
    setRevision(nextRevisionValue);
    dirtyRef.current = false;
    setSaveStatus('saved');
    setSaveError(null);
    setSelected(null);
    setPlaying(false);
    setSourceTab('problem');
    setCompareScenarioId('baseline');
  }, []);

  // 文档更新（AI 重解、核对修正等）后必须重新采纳：当前选中的分问可能已被替换或删除。
  // 旧分问的参数、撤销历史与选中 id 不能残留，保存也不能再指向已不存在的题目（P2-5）。
  const adoptDocument = useCallback((document: LabDocument): void => {
    setLab(document);
    revisionRef.current = document.revision;
    setRevision(document.revision);
    const nextProblem =
      document.problems.find((item) => item.problem_id === problemIdRef.current) ??
      document.problems.find((item) => item.problem_id === document.selected_problem_id) ??
      document.problems[0];
    if (nextProblem) applyProblemState(nextProblem, document.revision);
  }, [applyProblemState]);

  useEffect(() => {
    if (!labId) return;
    let alive = true;
    setLoading(true);
    void getLab(labId)
      .then((document) => {
        if (!alive) return;
        setLab(document);
        const selectedProblem =
          document.problems.find((item) => item.problem_id === document.selected_problem_id) ??
          document.problems[0];
        if (!selectedProblem) throw new Error('实验室没有题目');
        revisionRef.current = document.revision;
        setRevision(document.revision);
        const draft = readDraft(labId, selectedProblem.problem_id, scope);
        if (draft && draft.revision === document.revision && draft.dirty) {
          const serverState = stateFromProblem(selectedProblem);
          setParams({ ...serverState.params, ...draft.state.params });
          setStep(draft.state.step ?? 0);
          setMode(draft.state.mode ?? 'explore');
          setNotes(draft.state.notes ?? '');
          setScenarios(draft.state.scenarios?.length ? draft.state.scenarios : serverState.scenarios);
          setAttempts(draft.state.attempts ?? serverState.attempts);
          setObservations(draft.state.observations ?? serverState.observations);
          setEvents(draft.state.events ?? serverState.events);
          setEvaluated(serverState.evaluated);
          setProblemId(selectedProblem.problem_id);
          problemIdRef.current = selectedProblem.problem_id;
          const nextHistory = createHistory({ ...serverState.params, ...draft.state.params });
          historyRef.current = nextHistory;
          setHistory(nextHistory);
          dirtyRef.current = true;
          setSaveStatus('restored');
        } else {
          applyProblemState(selectedProblem, document.revision);
        }
        setPageError(null);
      })
      .catch((cause) => {
        if (alive) setPageError(errorMessage(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [applyProblemState, labId, scope]);

  const stateSnapshot = useMemo<LabState | null>(() => {
    if (!problem) return null;
    return {
      params,
      step,
      mode,
      notes,
      observations,
      events,
      scenarios,
      active_scenario_id: compareScenarioId,
      attempts,
      evaluated,
    };
  }, [attempts, compareScenarioId, evaluated, events, mode, notes, observations, params, problem, scenarios, step]);

  useEffect(() => {
    stateRef.current = stateSnapshot;
    paramsRef.current = params;
    setAiPreparedState(stateSnapshot);
  }, [params, stateSnapshot]);

  const touch = useCallback((invalidateEvaluation = false) => {
    dirtyRef.current = true;
    setSaveStatus('dirty');
    if (invalidateEvaluation) setEvaluated(null);
  }, []);

  const logEvent = useCallback((kind: string, text: string) => {
    setEvents((current) => [
      ...current.slice(-199),
      {
        id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        kind,
        text,
        created_at: new Date().toISOString(),
      },
    ]);
  }, []);

  const persistNow = useCallback(async (allowDuringAI = false): Promise<boolean> => {
    if (aiBusyRef.current && !allowDuringAI) return false;
    if (!lab || !problem || !stateRef.current) return false;
    if (!lab.problems.some((item) => item.problem_id === problemIdRef.current)) {
      // 选中的分问已不存在（如整题重解后旧分问被删除）：把保存目标纠正为当前展示的题目（P2-5）。
      problemIdRef.current = problem.problem_id;
    }
    if (savingRef.current) {
      queuedRef.current = true;
      return false;
    }
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    savingRef.current = true;
    setSaveStatus('saving');
    try {
      const response = await saveLabState({
        labId,
        revision: revisionRef.current,
        selectedProblemId: problemIdRef.current,
        state: stateRef.current as unknown as Record<string, unknown>,
      });
      if (activeLabIdRef.current !== labId) return false;
      revisionRef.current = response.revision;
      setRevision(response.revision);
      dirtyRef.current = false;
      setLab(response.document);
      setEvaluated(response.state.evaluated ?? null);
      setAttempts(response.state.attempts ?? attempts);
      setSaveStatus('saved');
      setSaveError(null);
      writeDraft(labId, problemIdRef.current, scope, response.revision, response.state, false);
      return true;
    } catch (cause) {
      if (activeLabIdRef.current !== labId) return false;
      setSaveStatus('error');
      if (isApiError(cause, 'VERSION_CONFLICT')) {
        setSaveError('服务端内容已更新。当前修改仍保留在本机；请重新载入后再保存。');
      } else {
        setSaveError(errorMessage(cause));
      }
      const snapshot = stateRef.current;
      if (snapshot) writeDraft(labId, problemIdRef.current, scope, revisionRef.current, snapshot, true);
      return false;
    } finally {
      savingRef.current = false;
      if (queuedRef.current) {
        queuedRef.current = false;
        window.setTimeout(() => {
          void persistRef.current?.();
        }, 0);
      }
    }
  }, [attempts, lab, labId, problem, scope]);

  useEffect(() => {
    persistRef.current = persistNow;
  }, [persistNow]);

  useEffect(() => {
    // 账号切换后旧账号的未保存状态必须丢弃：既不能再写回服务端，也不能写进新 scope 的草稿键（R5-AC3）。
    dirtyRef.current = false;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, [scope]);

  useEffect(() => {
    if (!dirtyRef.current || !stateSnapshot || !problem) return undefined;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void persistNow();
    }, 900);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [persistNow, problem, stateSnapshot]);

  const computed = useMemo(() => {
    if (!problem) return { result: null, error: null as string | null };
    if (isBlocking(problem.recognition.ambiguities.filter(a => !(a.id === 'source_formula_confirmation' && problem.ai_solution?.agent_understanding && problem.ai_solution.verification === 'kernel')))) return { result: null, error: null as string | null };
    try {
      return { result: computeLab(problem, params), error: null as string | null };
    } catch (cause) {
      return { result: null, error: errorMessage(cause) };
    }
  }, [params, problem]);
  const result = computed.result;

  const timelineIndex = useMemo(() => {
    if (!result) return 0;
    const total = Math.max(0, result.trace.length - 1);
    if (result.subject === 'calculus') {
      const key = result.task === 'double_integral' ? 'slice' : result.kind === 'integral' ? 'n' : result.kind === 'antiderivative' ? 'c' : 'h';
      const currentValue = Number(params[key]);
      const found = result.trace.findIndex((frame) => Math.abs(Number(frame.values?.[key]) - currentValue) < 1e-9);
      if (found >= 0) return found;
    }
    return clamp(step, 0, total);
  }, [params, result, step]);

  useEffect(() => {
    if (timelineIndex !== step) setStep(timelineIndex);
  }, [step, timelineIndex]);

  const compareScenario = scenarios.find((item) => item.id === compareScenarioId) ?? scenarios[0];
  const compareResult = useMemo(() => {
    if (!problem || !compareEnabled || !compareScenario || !result) return null;
    if (sameValue(compareScenario.params, params)) return null;
    try {
      return computeLab(problem, compareScenario.params);
    } catch {
      return null;
    }
  }, [compareEnabled, compareScenario, params, problem, result]);

  const commandExamples = problem
    ? problem.subject === 'calculus' && problem.model.kind === 'derivative'
      ? ['把差商步长调到 0.01', '停在 h=0.01', '完整讲解']
      : problem.subject === 'calculus' && problem.model.kind === 'antiderivative'
        ? ['完整讲解', '播放原函数族', '下一步']
      : COMMAND_EXAMPLES[problem.subject as LabSubject] ?? []
    : [];
  const draftText = uploadedText(lab, ['attempt']);
  const blocking = problem ? isBlocking(problem.recognition.ambiguities.filter(a => !(a.id === 'source_formula_confirmation' && problem.ai_solution?.agent_understanding && problem.ai_solution.verification === 'kernel'))) : false;
  const supplemental = problem?.recognition.conditions.filter(
    (item) => item.provenance === 'supplement' || item.provenance === 'teaching',
  ) ?? [];

  const changeParam = useCallback(
    (key: string, value: number | string) => {
      if (aiBusyRef.current) return;
      if (!problem) return;
      const next = { ...paramsRef.current, [key]: value };
      const committed = commitHistory(historyRef.current, next, key);
      historyRef.current = committed;
      paramsRef.current = next;
      setHistory(committed);
      setParams(next);
      setStep(0);
      setPlaying(false);
      touch(true);
    },
    [problem, touch],
  );

  const goToStep = useCallback(
    (next: number) => {
      if (aiBusyRef.current) return;
      if (!result) return;
      const total = Math.max(0, result.trace.length - 1);
      const clamped = clamp(Math.round(next), 0, total);
      if (result.subject === 'calculus') {
        const frame = result.trace[clamped];
        const key = result.task === 'double_integral' ? 'slice' : result.kind === 'integral' ? 'n' : result.kind === 'antiderivative' ? 'c' : 'h';
        const raw = Number(frame?.values?.[key]);
        if (Number.isFinite(raw)) {
          const next = { ...paramsRef.current, [key]: raw };
          paramsRef.current = next;
          setParams(next);
        }
      }
      setStep(clamped);
      touch();
    },
    [result, touch],
  );

  const selectAssistant = useCallback(
    (selection: LabSelection | null) => {
      setSelected(selection);
      if (!result || !selection || selection.kind !== 'solution-step') return;
      const index = solutionStepIndex(result, selection.id, timelineIndex);
      if (index !== null) goToStep(index);
    },
    [goToStep, result, timelineIndex],
  );

  useEffect(() => {
    if (aiBusyRef.current || !playing || !result) return undefined;
    const total = Math.max(0, result.trace.length - 1);
    if (timelineIndex >= total) {
      setPlaying(false);
      return undefined;
    }
    const timer = window.setTimeout(() => goToStep(timelineIndex + 1), 1050 / speed);
    return () => window.clearTimeout(timer);
  }, [goToStep, playing, result, speed, timelineIndex]);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (aiBusyRef.current) return;
      const target = event.target as Element | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === ' ') {
        event.preventDefault();
        setPlaying((current) => !current);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goToStep(timelineIndex + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goToStep(timelineIndex - 1);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [goToStep, timelineIndex]);

  const saveNow = async (): Promise<boolean> => {
    const saved = await persistNow();
    if (!saved && saveStatus !== 'saving') {
      setCommandMessage('保存未完成；修改仍保留在本机。');
    }
    return saved;
  };

  const saveScenario = useCallback(() => {
    if (!problem || !result) return;
    const snapshot = JSON.parse(JSON.stringify(params)) as Record<string, unknown>;
    const existing = scenarios.find((item) => sameValue(item.params, snapshot));
    if (existing) {
      setCommandMessage(`当前条件与“${existing.name}”相同，无需重复保存。`);
      return;
    }
    const scenario: LabScenario = {
      id: `scn_${Date.now().toString(36)}`,
      name: scenarioName(problem, snapshot),
      params: snapshot,
      created_at: new Date().toISOString(),
      kind: 'exploration',
      summary: result.headline,
    };
    setScenarios((current) => [...current, scenario]);
    setCompareScenarioId(scenario.id);
    setCompareEnabled(true);
    touch();
    logEvent('scenario', `保存情景：${scenario.name}`);
    setCommandMessage(`已保存情景“${scenario.name}”；当前曲线可与原题条件对照。`);
  }, [logEvent, params, problem, result, scenarios, touch]);

  const resetOriginal = useCallback(() => {
    if (!problem) return;
    const defaults = defaultParams(problem);
    const committed = commitHistory(historyRef.current, defaults);
    historyRef.current = committed;
    setHistory(committed);
    paramsRef.current = defaults;
    setParams(defaults);
    setStep(0);
    setPlaying(false);
    setEvaluated(null);
    touch(true);
    logEvent('reset', '恢复原题条件');
    setCommandMessage('已恢复原题识别条件。');
  }, [logEvent, problem, touch]);

  const undo = useCallback(() => {
    const next = undoHistory(historyRef.current);
    historyRef.current = next;
    setHistory(next);
    paramsRef.current = next.present;
    setParams(next.present);
    setStep(0);
    setPlaying(false);
    touch(true);
  }, [touch]);

  const redo = useCallback(() => {
    const next = redoHistory(historyRef.current);
    historyRef.current = next;
    setHistory(next);
    paramsRef.current = next.present;
    setParams(next.present);
    setStep(0);
    setPlaying(false);
    touch(true);
  }, [touch]);

  const switchProblem = useCallback(
    async (nextId: string) => {
      if (aiBusyRef.current) return;
      if (!lab || nextId === problemIdRef.current) return;
      if (dirtyRef.current) await persistNow();
      const target = lab.problems.find((item) => item.problem_id === nextId);
      if (!target) return;
      applyProblemState(target, revisionRef.current);
      dirtyRef.current = true;
      setSaveStatus('dirty');
      logEvent('problem', `切换到题目 ${target.title}`);
    },
    [applyProblemState, lab, logEvent, persistNow],
  );

  const review = async (payload: ReviewPayload): Promise<void> => {
    if (!problem) return;
    setReviewBusy(true);
    try {
      const document = await reviewLabProblem({
        labId,
        problemId: problem.problem_id,
        text: payload.text,
        subject: payload.subject,
        conditionValues: payload.conditionValues,
        ambiguityAnswers: payload.ambiguityAnswers,
      });
      if (!document.problems.length) throw new Error('重新编译后没有可用题目');
      adoptDocument(document);
      setReviewOpen(false);
      setCommandMessage('条件已核对并重新求解；原题与来源仍保留。');
    } catch (cause) {
      setCommandMessage(`修正失败：${errorMessage(cause)}`);
    } finally {
      setReviewBusy(false);
    }
  };

  const ask = async (question: string, hintLevel?: number): Promise<LabAssistantResponse> => {
    if (!problem) throw new Error('题目未载入');
    return askLab({
      labId,
      question,
      mode,
      step: timelineIndex,
      params,
      hintLevel,
      selected: selected ? { id: selected.id, label: selected.label } : null,
      useAi: useAi && (lab?.capabilities?.ai_configured ?? false),
    });
  };

  const attempt = async (answer: string, field: string, attemptKind?: string): Promise<string | null> => {
    if (!problem) return null;
    try {
      const response = await submitLabAttempt({
        labId,
        answer,
        field,
        params,
        kind: attemptKind ?? (problem.subject === 'algorithm' ? 'text' : 'numeric'),
      });
      const nextProblem = response.document.problems.find((item) => item.problem_id === problem.problem_id);
      const state = nextProblem?.states;
      setLab(response.document);
      revisionRef.current = response.document.revision;
      setRevision(response.document.revision);
      if (state) {
        setAttempts(state.attempts ?? []);
        setEvaluated(state.evaluated ?? null);
      }
      dirtyRef.current = false;
      setSaveStatus('saved');
      return response.checked.feedback;
    } catch (cause) {
      return `提交失败：${errorMessage(cause)}`;
    }
  };

  const aiOperation = async (operation: () => Promise<LabDocument>) => {
    if (!lab || !problem) throw new Error('题目尚未加载');
    if (aiBusyRef.current || savingRef.current || reviewBusy) throw new Error('请等待当前保存或核对完成');
    if (saveTimerRef.current !== null) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    aiBusyRef.current = true; setAiBusy(true); setPlaying(false);
    try {
      if (dirtyRef.current) {
        const saved = await persistNow(true);
        if (activeLabIdRef.current !== labId) return;
        if (!saved) throw new Error('请先保存当前学习记录后再继续');
      }
      if (activeLabIdRef.current !== labId) return;
      const document = await operation();
      if (activeLabIdRef.current !== labId) return;
      adoptDocument(document);
      dirtyRef.current = false; setSaveStatus('saved');
    } finally { aiBusyRef.current = false; setAiBusy(false); }
  };

  const solveAI = async (solveMode: 'auto' | 'direct') => {
    if (!problem) return;
    await aiOperation(() => solveLabWithAI({ labId, problemId: problem.problem_id, revision: revisionRef.current, mode: solveMode, force: !!problem.ai_solution }));
  };

  const checkAI = async (answer: string) => {
    if (!problem) throw new Error('题目尚未加载');
    let feedback = { correct: false, feedback: '' };
    await aiOperation(async () => {
      const response = await submitLabAttempt({ labId, problemId: problem.problem_id, answer, field: 'ai_solution', params: {} });
      feedback = response.checked;
      return response.document;
    });
    return feedback;
  };

  const recordObservation = (text?: string): void => {
    if (!problem || !result) return;
    const frame = currentFrame(result, timelineIndex);
    const value = (text?.trim() || frame.detail || frame.label).slice(0, 600);
    setObservations((current) => [
      ...current.slice(-79),
      {
        id: `obs_${Date.now().toString(36)}`,
        text: value,
        created_at: new Date().toISOString(),
      },
    ]);
    touch();
    logEvent('observation', value);
    setCommandMessage('已记录到学习成果。');
  };

  const handleShare = async (): Promise<void> => {
    if (!lab || sharing) return;
    setSharing(true);
    try {
      if (dirtyRef.current) {
        const saved = await persistNow();
        if (!saved) {
          setCommandMessage('当前修改尚未保存，分享快照仍可用，但建议稍后重试。');
        }
      }
      const response = await shareLab(labId);
      setShareUrl(response.share_url);
      setOutcomeOpen(true);
    } catch (cause) {
      setCommandMessage(`分享失败：${errorMessage(cause)}`);
    } finally {
      setSharing(false);
    }
  };

  const setModeAndTouch = (next: LabMode): void => {
    setMode(next);
    touch();
    logEvent('mode', `切换到${MODE_LABELS[next].title}`);
  };

  const setNotesAndTouch = (value: string): void => {
    setNotes(value);
    touch();
  };

  const executeCommand = (): void => {
    if (!problem || !result || !commandText.trim()) return;
    const command = parseLabCommand(commandText, problem.subject);
    setCommandMessage(command.message);
    switch (command.kind) {
      case 'set-param':
        changeParam(command.key, command.value);
        break;
      case 'scale-param': {
        const current = Number(params[command.key]);
        if (Number.isFinite(current)) changeParam(command.key, current * command.factor);
        break;
      }
      case 'step':
        goToStep(command.value);
        break;
      case 'step-forward':
        goToStep(timelineIndex + 1);
        break;
      case 'step-back':
        goToStep(timelineIndex - 1);
        break;
      case 'toggle-play':
        setPlaying((current) => !current);
        break;
      case 'reset-playback':
        goToStep(0);
        break;
      case 'reset-original':
        resetOriginal();
        break;
      case 'save-scenario':
        saveScenario();
        break;
      case 'compare':
        setCompareEnabled(true);
        setCompareScenarioId('baseline');
        break;
      case 'mode':
        setModeAndTouch(command.value);
        break;
      default:
        setCommandMessage(`${command.message} 也可以直接在右侧导师中提问。`);
    }
    setCommandText('');
  };

  if (loading) {
    return (
      <div className={`${styles.page} studio-scope`}>
        <SiteNav current="labs" appearance="studio" />
        <div className={styles.loading} role="status">
          <span className={styles.loadingMark} />
          正在打开题目实验室…
        </div>
      </div>
    );
  }

  if (pageError || !lab || !problem) {
    return (
      <div className={`${styles.page} studio-scope`}>
        <SiteNav current="labs" appearance="studio" />
        <div className={styles.errorPage} role="alert">
          <span className={styles.eyebrow}>LAB UNAVAILABLE</span>
          <h1>这道题暂时打不开</h1>
          <p>{pageError ?? '实验室数据不完整。'}</p>
          <div>
            <Link to="/labs">返回题目实验室</Link>
            <button type="button" onClick={() => window.location.reload()}>
              重新载入
            </button>
          </div>
        </div>
      </div>
    );
  }

  const noticeTeaching = supplemental.length > 0 || problem.model.teaching;
  const subjectLabel = SUBJECT_LABELS[problem.subject as LabSubject] ?? problem.subject_label;

  return (
    <div className={`${styles.page} studio-scope`}>
      <SiteNav current="labs" appearance="studio" />
      <main id="main" className={styles.main}>
        <fieldset disabled={aiBusy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <header className={styles.topbar}>
          <div className={styles.titleBlock}>
            <div className={styles.breadcrumb}>
              <Link to="/labs">题目实验室</Link>
              <span>/</span>
              <span>{lab.source.citation}</span>
            </div>
            <div className={styles.titleRow}>
              <h1>
                <ProblemTitle problem={problem} />
              </h1>
              <span className={styles.subjectPill}>{subjectLabel}</span>
              <span className={styles.statusPill} data-status={problem.status}>
                {aiBusy ? '正在准备实验' : problem.ai_solution ? problem.ai_solution.verification === 'kernel' ? problem.ai_solution.source_review_required ? '实验可操作 · 原图待核对' : '实验已就绪' : '需要补充条件'
                  : problem.status === 'ready' ? problem.manual_input ? '原题已确认 · 内核已计算' : '条件已就绪' : problem.status === 'needs_review' ? '待核对' : '暂不支持'}
              </span>
              {problem.model.teaching ? <span className={styles.teachingPill}>含教学示例</span> : null}
            </div>
            <div className={styles.metaRow}>
              {lab.problems.length > 1 ? (
                <label className={styles.problemSelect}>
                  <span>题目列表</span>
                  <select value={problem.problem_id} onChange={(event) => void switchProblem(event.target.value)}>
                    {lab.problems.map((item, index) => (
                      <option key={item.problem_id} value={item.problem_id}>
                        {index + 1}. {item.title} · {SUBJECT_LABELS[item.subject]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <span className={styles.modeHint}>{MODE_LABELS[mode].title} · {MODE_LABELS[mode].hint}</span>
              <span className={styles.saveState} data-status={saveStatus}>
                <i aria-hidden="true" />
                {saveStatusText(saveStatus)}
              </span>
              {saveError ? <span className={styles.saveError}>{saveError}</span> : null}
            </div>
          </div>
          <div className={styles.topActions}>
            <div className={styles.historyButtons}>
              <button type="button" onClick={undo} disabled={history.past.length === 0} aria-label="撤销上一步参数">
                撤销
              </button>
              <button type="button" onClick={redo} disabled={history.future.length === 0} aria-label="重做">
                重做
              </button>
            </div>
            <button type="button" className={styles.headerButton} onClick={() => void saveNow()}>
              保存
            </button>
            <button type="button" className={styles.headerButton} onClick={() => setOutcomeOpen(true)}>
              学习成果
            </button>
            <button type="button" className={styles.shareButton} onClick={() => void handleShare()} disabled={sharing}>
              {sharing ? '生成中…' : '分享'}
            </button>
          </div>
        </header>

        {lab.orchestration ? <CompositeSolvePanel key={lab.orchestration.problem.version + String(lab.orchestration.stale)}
          result={lab.orchestration} onSolve={(text) => aiOperation(() => reviseCompositeLab({
            labId, text, revision: revisionRef.current,
          }))} /> : null}
        <div className={styles.layout}>
          <LabSourcePanel
            lab={lab}
            problem={problem}
            tab={sourceTab}
            selected={selected}
            currentParams={params}
            previewUrl={(key) => labPreviewUrl(labId, key)}
            onTab={setSourceTab}
            onOpenReview={() => setReviewOpen(true)}
            onOpenCompare={() => setCompareOpen(true)}
            onSelect={setSelected}
          />

          <section className={styles.mainColumn} aria-label="可操作模型">
            <div className={styles.modelCard} style={(problem.model.teaching || (problem.ai_solution && blocking)) ? { display: 'none' } : undefined}>
              <div className={styles.modelHead}>
                <div>
                  <h2>{problem.model.task === 'triple_integral' ? '三重积分 · 区域与坐标变换'
                    : problem.model.task === 'double_integral' ? '二重积分 · 区域与切片'
                    : problem.model.task === 'series_convergence' ? '数项级数 · 部分和观察'
                    : problem.model.task === 'power_series' ? '幂级数 · 收敛域与和函数'
                    : problem.model.task === 'fourier_series' ? '傅里叶级数 · 系数与部分和'
                    : problem.model.task === 'taylor' ? '泰勒展开 · 系数与余项'
                    : problem.model.task === 'area_volume' ? '区域面积与旋转体积'
                    : problem.model.task === 'geometric_area' ? '几何面积 · 分段积分'
                    : problem.model.task === 'implicit_normal' ? '隐函数 · 法线'
                    : ENGINE_LABELS[problem.model.engine] ?? problem.model.engine}</h2>
                  <p>
                    {problem.model.teaching
                      ? '教学示例：题目未提供完整可计算数据，图形与结论已明确标注。'
                      : problem.model.engine === 'space_v1'
                        ? '空间对象由符号计算给出；图形为有限范围采样，用于辅助观察。'
                        : problem.model.engine === 'proof_v1'
                          ? '证明义务与证书由本地内核核验；图形与抽样仅辅助观察，不替代证明。'
                          : '拖动参数或播放切片，观察区域与积分过程。'}
                  </p>
                </div>
                <div className={styles.modelMeta}>
                  <button type="button" onClick={() => setCompareOpen(true)}>原稿对照</button>
                </div>
              </div>

              <ManualIntegralResult problem={problem} params={params} />

              {noticeTeaching ? (
                <div className={styles.noticeBanner}>
                  <span>i</span>
                  <p>
                    当前模型包含明确标注的补充或教学条件；原题文字与来源仍保留。
                    <button type="button" onClick={() => setReviewOpen(true)}>查看并核对</button>
                  </p>
                </div>
              ) : null}

              {blocking ? (
                <Gate problem={problem} onReview={() => setReviewOpen(true)} />
              ) : (
                <>
                  {computed.error ? (
                    <div className={styles.computeError} role="alert">
                      <strong>当前参数无法计算</strong>
                      <p>{computed.error}</p>
                    </div>
                  ) : result ? (
                    <div className={styles.canvasWrap}>
                      <LabCanvas
                        problem={problem}
                        result={result}
                        step={timelineIndex}
                        mode={mode}
                        compare={compareResult}
                        selected={selected}
                        onSelect={setSelected}
                        onStepChange={goToStep}
                      />
                    </div>
                  ) : null}
                  <LabControls
                    model={problem.model}
                    params={params}
                    onChange={changeParam}
                    onResetOriginal={resetOriginal}
                    onSaveScenario={saveScenario}
                    onOpenReview={() => setReviewOpen(true)}
                    onApplyGraph={async (source) => {
                      setReviewBusy(true);
                      try {
                        const edges = source
                          .split('\n')
                          .map((line) => line.trim())
                          .filter(Boolean)
                          .join('；');
                        const document = await reviewLabProblem({
                          labId,
                          problemId: problem.problem_id,
                          conditionValues: { graph_edges: edges },
                        });
                        if (document.problems.length) {
                          adoptDocument(document);
                          setCommandMessage('图数据已更新并重新计算；原图仍在来源中。');
                        }
                      } catch (cause) {
                        setCommandMessage(`图数据更新失败：${errorMessage(cause)}`);
                      } finally {
                        setReviewBusy(false);
                      }
                    }}
                  />
                  {result ? (
                    <>
                      <LabTimeline
                        result={result}
                        step={timelineIndex}
                        playing={playing}
                        speed={speed}
                        reducedMotion={reducedMotion}
                        onStep={goToStep}
                        onTogglePlay={() => setPlaying((current) => !current)}
                        onSpeed={setSpeed}
                        onReset={() => {
                          setPlaying(false);
                          goToStep(0);
                        }}
                        detail={`${currentFrame(result, timelineIndex).label}：${
                          currentFrame(result, timelineIndex).detail ?? ''
                        }`}
                      />
                      <div className={styles.commandBar}>
                        <span className={styles.commandIcon} aria-hidden="true">⌘</span>
                        <input
                          value={commandText}
                          placeholder={`用一句话操作：${commandExamples[0] ?? '把学习率调到 0.05'}`}
                          aria-label="自然语言操作指令"
                          onChange={(event) => setCommandText(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.nativeEvent.isComposing) executeCommand();
                          }}
                        />
                        <button type="button" onClick={executeCommand} disabled={!commandText.trim()}>
                          执行
                        </button>
                        <span className={styles.commandHelp}>
                          {commandExamples.join(' · ')}
                        </span>
                      </div>
                      {commandMessage ? <p className={styles.commandMessage}>{commandMessage}</p> : null}
                      <div className={styles.scenarioStrip}>
                          <div className={styles.scenarioHead}>
                            <span>探索情景</span>
                            <button type="button" onClick={() => setCompareEnabled((current) => !current)}>
                              {compareEnabled ? '隐藏对照' : '显示对照'}
                            </button>
                          </div>
                          <div className={styles.scenarios}>
                            {scenarios.map((scenario) => (
                              <button
                                key={scenario.id}
                                type="button"
                                className={styles.scenarioChip}
                                data-active={compareScenario?.id === scenario.id && compareEnabled}
                                onClick={() => {
                                  setCompareScenarioId(scenario.id);
                                  setCompareEnabled(true);
                                }}
                                title={scenario.summary}
                              >
                                <b>{scenario.name}</b>
                                <small>{scenario.kind === 'baseline' ? '原题' : '探索'}</small>
                              </button>
                            ))}
                            <button type="button" className={styles.addScenario} onClick={saveScenario}>
                              ＋ 保存当前条件
                            </button>
                          </div>
                          {compareEnabled && compareResult ? (
                            <p className={styles.compareHint}>
                              虚线对照：{compareScenario?.name ?? '原题条件'}。当前实线读取的是你正在操作的参数。
                            </p>
                          ) : null}
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </div>
            {!problem.manual_input && !lab.orchestration ? <LabAISolvePanel key={problem.problem_id} problem={problem} configured={lab.capabilities?.ai_solver_configured}
              autoReady={aiPreparedState === stateSnapshot && !aiBusy && saveStatus !== 'saving' && !reviewBusy && !reviewOpen}
              onSolve={solveAI} onCheck={checkAI} /> : null}
          </section>

          {result && !((problem.model.teaching || (problem.ai_solution && blocking))) ? (
            <AssistantPanel
              problem={problem}
              result={result}
              step={timelineIndex}
              mode={mode}
              selected={selected}
              aiConfigured={lab.capabilities?.ai_configured ?? false}
              useAi={useAi}
              notes={notes}
              attempts={attempts}
              observations={observations}
              draftText={draftText}
              onModeChange={setModeAndTouch}
              onUseAi={setUseAi}
              onAsk={ask}
              onAttempt={attempt}
              onNotes={setNotesAndTouch}
              onRecordObservation={recordObservation}
              onSelect={selectAssistant}
            />
          ) : (
            null
          )}
        </div>
        </fieldset>
      </main>

      <ReviewDialog
        open={reviewOpen}
        problem={problem}
        busy={reviewBusy}
        onClose={() => setReviewOpen(false)}
        onSubmit={(payload) => void review(payload)}
        previewUrl={(key) => labPreviewUrl(labId, key)}
      />
      {result ? (
        <OriginalCompare
          open={compareOpen}
          lab={lab}
          problem={problem}
          result={result}
          step={timelineIndex}
          previewUrl={(key) => labPreviewUrl(labId, key)}
          onClose={() => setCompareOpen(false)}
        />
      ) : null}
      <OutcomePanel
        open={outcomeOpen}
        lab={lab}
        problem={problem}
        state={stateSnapshot ?? blankState(problem)}
        saved={saveStatus === 'saved'}
        sharing={sharing}
        shareUrl={shareUrl}
        onClose={() => setOutcomeOpen(false)}
        onShare={() => void handleShare()}
      />
    </div>
  );
}

export default LabWorkbenchPage;

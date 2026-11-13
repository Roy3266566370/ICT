/**
 * index.tsx —— bfs_flow 模板入口（C-REG@1 用 import.meta.glob 自动发现）
 *
 * 职责边界（plan §2.1.2 / §2.2.11 约束 4）：
 *  - 纯展示 + 事件上抛：不直接 fetch、不读全局 store；图编辑经
 *    `TemplateProps.onParameterChange(graph.id, graphValue)` 提交，派生结果优先用宿主 `result`。
 *  - 单步 / 连续播放 / 暂停 / 重置（R8-AC5）只移动**轨迹游标**，不改任何参数，
 *    因此播放不会产生 revision 暴涨，也不会打断其它视图。
 *  - 轨迹来源是 C-BFS@1 的 `trace` 字段（**不是** steps），事件三选一：
 *    dequeue / enqueue / skip；`skip` 必须逐条展示（R8-AC2：D 的第二次入队尝试不能静默）。
 *  - 有环图照常执行完毕并给出文字提示；「允许环」只在 BFS 内成立，不复用到预算模板（R8-AC7）。
 *  - 不可达节点单独列出；`unvisited` 为空时明确写"全部节点可达"，不与"无数据"混同。
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { SourcePanel } from '@/components/ui';
import type {
  BfsFlowResult,
  BfsRejectedEdge,
  BfsStep,
  GraphValue,
  KnowledgeObject,
  Parameter,
  SourceRef,
  TemplateProps,
} from '@/api/types';
import { isGraphValue, readConfigBoolean, readConfigString } from '@/api/types';
import { BFS_MAX_STEPS, calcBfs, deriveBfsFlow } from '@/domain/bfs';
import BfsTrace from './BfsTrace';
import GraphEditor from './GraphEditor';
import QueuePanel from './QueuePanel';
import styles from './bfs.module.css';

/** 连续播放的默认间隔与可调范围（毫秒） */
const SPEED_MIN = 120;
const SPEED_MAX = 1600;
const SPEED_STEP = 20;
const SPEED_DEFAULT = 700;

/* -------------------------------------------------------------------------- */
/* 参数解析                                                                   */
/* -------------------------------------------------------------------------- */

type GraphResolution =
  | { ok: true; parameter: Parameter; graph: GraphValue }
  | { ok: false; error: string };

/** 定位 `type="graph"` 参数：优先 config.graph_parameter_id，其次固定 id `graph`，最后按类型。 */
function resolveGraphParameter(object: KnowledgeObject): GraphResolution {
  const explicitId = readConfigString(object.config, 'graph_parameter_id');
  const candidates: (Parameter | undefined)[] = [
    explicitId === null
      ? undefined
      : object.parameters.find((parameter) => parameter.id === explicitId),
    object.parameters.find((parameter) => parameter.id === 'graph'),
    object.parameters.find((parameter) => parameter.type === 'graph'),
  ];
  const parameter = candidates.find((item): item is Parameter => item !== undefined);
  if (parameter === undefined) {
    return { ok: false, error: '缺少图参数（type="graph"）：无法执行 BFS 视图。' };
  }
  if (!isGraphValue(parameter.value)) {
    return {
      ok: false,
      error: `参数 ${parameter.name}（${parameter.id}）不是合法的图结构：需要 { nodes: [{id,label}], edges: [{from,to}] }。`,
    };
  }
  return {
    ok: true,
    parameter,
    // 深拷贝：本地编辑不直接改动宿主传入的对象
    graph: {
      nodes: parameter.value.nodes.map((node) => ({ ...node })),
      edges: parameter.value.edges.map((edge) => ({ ...edge })),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 结果收窄                                                                   */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isBfsStep(value: unknown): value is BfsStep {
  if (!isRecord(value) || !isFiniteNumber(value['index'])) return false;
  const kind = value['kind'];
  if (kind === 'dequeue') {
    return (
      typeof value['node'] === 'string' &&
      isStringArray(value['queue_after']) &&
      isStringArray(value['visited_after'])
    );
  }
  if (kind === 'enqueue') {
    return (
      typeof value['node'] === 'string' &&
      typeof value['from'] === 'string' &&
      isStringArray(value['queue_after'])
    );
  }
  if (kind === 'skip') {
    const reason = value['reason'];
    return (
      typeof value['node'] === 'string' &&
      typeof value['from'] === 'string' &&
      (reason === 'already_visited' || reason === 'already_queued' || reason === 'not_adjacent')
    );
  }
  return false;
}

function isEdgeList(value: unknown): value is { from: string; to: string }[] {
  return (
    Array.isArray(value) &&
    value.every((item) => isRecord(item) && typeof item['from'] === 'string' && typeof item['to'] === 'string')
  );
}

function isRejectedEdgeList(value: unknown): value is BfsRejectedEdge[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item['from'] === 'string' &&
        typeof item['to'] === 'string' &&
        typeof item['reason'] === 'string',
    )
  );
}

function isParentMap(value: unknown): value is Record<string, string | null> {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => item === null || typeof item === 'string')
  );
}

/**
 * `level` 取形状收窄：schema 为 `additionalProperties: integer, minimum: 0` 且没有 required，
 * 不可达节点**不写键**（不是 0、也不是 -1）；界面用 `level[id] !== undefined` 判断可达性。
 */
function isLevelMap(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every((item) => isFiniteNumber(item) && item >= 0);
}

/** 把宿主传入的 unknown 结果按 C-BFS@1 形状收窄；不合法返回 null 交给兜底路径。 */
function asBfsFlowResult(value: unknown): BfsFlowResult | null {
  if (!isRecord(value)) return null;
  if (!isStringArray(value['order'])) return null;
  if (!isStringArray(value['enqueue_order'])) return null;
  if (!isStringArray(value['visited'])) return null;
  if (!isStringArray(value['unvisited'])) return null;
  if (!isParentMap(value['parent'])) return null;
  if (!isLevelMap(value['level'])) return null;
  if (!isEdgeList(value['edges_of_spanning_tree'])) return null;
  if (!isRejectedEdgeList(value['rejected_edges'])) return null;
  const trace = value['trace'];
  if (!Array.isArray(trace) || !trace.every(isBfsStep)) return null;
  const terminated = value['terminated_reason'];
  if (terminated !== 'completed' && terminated !== 'max_steps_reached') return null;
  if (typeof value['has_cycle'] !== 'boolean') return null;
  return value as unknown as BfsFlowResult;
}

/** 派生失败时的安全降级结果（不伪造访问序列）。 */
function emptyBfsResult(): BfsFlowResult {
  return {
    order: [],
    enqueue_order: [],
    visited: [],
    unvisited: [],
    parent: {},
    level: {},
    edges_of_spanning_tree: [],
    rejected_edges: [],
    trace: [],
    terminated_reason: 'completed',
    has_cycle: false,
  };
}

function resolveBfsResult(
  rawResult: unknown,
  composedObject: KnowledgeObject | null,
  hasLocalOverride: boolean,
  fallbackObject: KnowledgeObject,
): { result: BfsFlowResult; error: string | null } {
  // 没有本地覆盖时优先宿主结果：宿主与模板共用同一 derive*，数值必然一致
  if (!hasLocalOverride) {
    const parsed = asBfsFlowResult(rawResult);
    if (parsed !== null) return { result: parsed, error: null };
  }
  if (composedObject !== null) {
    const outcome = deriveBfsFlow(composedObject);
    if (outcome.ok) return { result: outcome.result, error: null };
    return { result: emptyBfsResult(), error: outcome.error };
  }
  return calcBfs(fallbackObject);
}

/* -------------------------------------------------------------------------- */
/* 轨迹重放                                                                   */
/* -------------------------------------------------------------------------- */

export interface BfsSnapshot {
  /** 当前队列内容（队列快照来自契约的 queue_after） */
  queue: string[];
  /** 已访问（出队）序列 */
  visited: string[];
  /** 正在处理的节点：dequeue 的节点，或 enqueue/skip 的来源节点 */
  currentId: string | null;
  /** 正在检查的边 */
  checking: { from: string; to: string } | null;
  lastStep: BfsStep | null;
}

/**
 * 把轨迹重放到第 `cursor` 步（cursor=0 表示尚未执行任何一步）。
 * 队列与 visited 直接取契约给出的 `queue_after` / `visited_after`，不自行推算，
 * 保证界面与内核输出逐字一致。
 */
export function replayBfs(
  trace: readonly BfsStep[],
  cursor: number,
  startNodeId: string,
): BfsSnapshot {
  let queue: string[] = startNodeId === '' ? [] : [startNodeId];
  let visited: string[] = [];
  let currentId: string | null = null;
  let checking: { from: string; to: string } | null = null;
  let lastStep: BfsStep | null = null;

  const limit = Math.max(0, Math.min(cursor, trace.length));
  for (let index = 0; index < limit; index += 1) {
    const step = trace[index];
    if (step === undefined) break;
    lastStep = step;
    if (step.kind === 'dequeue') {
      currentId = step.node;
      queue = [...step.queue_after];
      visited = [...step.visited_after];
      checking = null;
    } else if (step.kind === 'enqueue') {
      currentId = step.from;
      checking = { from: step.from, to: step.node };
      queue = [...step.queue_after];
    } else {
      currentId = step.from;
      checking = { from: step.from, to: step.node };
    }
  }

  return { queue, visited, currentId, checking, lastStep };
}

/* -------------------------------------------------------------------------- */
/* 视图                                                                       */
/* -------------------------------------------------------------------------- */

export default function BfsTemplate(props: TemplateProps) {
  const {
    object,
    result: rawResult,
    resultError,
    onParameterChange,
    onReset,
    onFocusSource,
    reducedMotion,
  } = props;

  const uid = useId();
  const traceTitleId = `${uid}-trace-title`;
  const sourceTitleId = `${uid}-source-title`;
  const speedId = `${uid}-speed`;

  const [graphDraft, setGraphDraft] = useState<GraphValue | null>(null);
  const [startDraft, setStartDraft] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(SPEED_DEFAULT);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);

  const resolution = useMemo(() => resolveGraphParameter(object), [object]);
  const baseGraph = resolution.ok ? resolution.graph : null;
  const graphValue = graphDraft ?? baseGraph;

  const configStart = readConfigString(object.config, 'start_node_id') ?? '';
  const startNodeId =
    startDraft ??
    (graphValue !== null && graphValue.nodes.some((node) => node.id === configStart)
      ? configStart
      : (graphValue?.nodes[0]?.id ?? ''));

  /** 合成对象：把本地覆盖（图 / 起点）叠加到宿主对象上，再走同一 derive* 纯函数。 */
  const composedObject = useMemo<KnowledgeObject | null>(() => {
    if (!resolution.ok || graphValue === null) return null;
    return {
      ...object,
      config: { ...object.config, start_node_id: startNodeId },
      parameters: object.parameters.map((parameter) =>
        parameter.id === resolution.parameter.id ? { ...parameter, value: graphValue } : parameter,
      ),
    };
  }, [object, resolution, graphValue, startNodeId]);

  const hasLocalOverride = graphDraft !== null || startDraft !== null;
  const outcome = useMemo(
    () => resolveBfsResult(rawResult, composedObject, hasLocalOverride, object),
    [rawResult, composedObject, hasLocalOverride, object],
  );
  const result = outcome.result;
  const errorMessage = resultError ?? outcome.error;

  // 宿主写入成功（或重置）后，本地草稿与宿主值一致即丢弃，避免长期覆盖宿主状态
  const graphSignature = baseGraph === null ? '' : JSON.stringify(baseGraph);
  useEffect(() => {
    setGraphDraft(null);
  }, [graphSignature]);
  useEffect(() => {
    setStartDraft(null);
  }, [configStart]);

  /** 图的形状或起点变化时，游标回到起点并停止播放（不保留过期轨迹）。 */
  const traceSignature = `${startNodeId}|${result.trace.length}|${result.order.join(',')}|${result.unvisited.join(',')}`;
  useEffect(() => {
    setCursor(0);
    setPlaying(false);
  }, [traceSignature]);

  // 连续播放：每次只前进 1 步，到末尾自动暂停
  useEffect(() => {
    if (!playing) return undefined;
    if (cursor >= result.trace.length) {
      setPlaying(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setCursor((previous) => Math.min(previous + 1, result.trace.length));
    }, speedMs);
    return () => window.clearTimeout(timer);
  }, [playing, cursor, result.trace.length, speedMs]);

  if (!resolution.ok || graphValue === null) {
    return (
      <div className={styles.root} data-reduced-motion={reducedMotion ? 'true' : 'false'}>
        <section className={styles.card} role="alert">
          <h2 className={styles.title}>广度优先搜索视图暂时不可用</h2>
          <p className={styles.lead}>{resolution.ok ? '图中没有可用的节点。' : resolution.error}</p>
        </section>
      </div>
    );
  }

  const { parameter: graphParameter } = resolution;
  const directed = readConfigBoolean(object.config, 'directed', true);
  const snapshot = replayBfs(result.trace, cursor, startNodeId);
  const atEnd = cursor >= result.trace.length;
  const canWriteStart = object.parameters.some((parameter) => parameter.id === 'start_node_id');
  const sources: SourceRef[] = object.source_refs;

  /* ---------------------------- 交互 ---------------------------- */

  const handleStep = (): void => {
    setPlaying(false);
    setCursor((previous) => Math.min(previous + 1, result.trace.length));
  };

  const handlePlay = (): void => {
    if (atEnd) {
      // 已到末尾时「连续播放」等价于从头重播，避免按钮点了没反应
      setCursor(0);
    }
    setPlaying(true);
  };

  const handlePause = (): void => setPlaying(false);

  const handleReset = (): void => {
    setPlaying(false);
    setCursor(0);
    setGraphDraft(null);
    setStartDraft(null);
    onReset();
  };

  const handleGraphChange = (next: GraphValue): void => {
    setGraphDraft(next);
    // 图是整体参数：写入后宿主会重算并刷新 revision（结构变更由宿主负责 model_version）
    onParameterChange(graphParameter.id, next);
  };

  const handleStartChange = (id: string): void => {
    setStartDraft(id);
    setCursor(0);
    setPlaying(false);
    // 契约把起点放在 config.start_node_id；仅当对象真的暴露同名参数时才走参数通道，
    // 否则只在当前视图生效（界面上明确标注，不假装已经保存）。
    if (canWriteStart) onParameterChange('start_node_id', id);
  };

  const handleSeek = (index: number): void => {
    setPlaying(false);
    setCursor(Math.max(0, Math.min(index, result.trace.length)));
  };

  const handleFocusSource = (sourceRefId: string): void => {
    setActiveSourceId(sourceRefId);
    onFocusSource(sourceRefId);
  };

  const actionText =
    snapshot.lastStep === null
      ? '尚未开始（点击「单步」或「连续播放」开始执行）'
      : describeStep(snapshot.lastStep);

  /* ------------------------------ 渲染 ------------------------------ */

  return (
    <div className={styles.root} data-reduced-motion={reducedMotion ? 'true' : 'false'}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h2 className={styles.title}>{object.title}</h2>
          <p className={styles.lead}>
            起点先入队、出队时才标记 visited；邻居按节点 id 的 Unicode 码点字典序遍历。
            邻居若已访问或已在队列中，会记为一条 skip 轨迹——这正是 D 只入队一次的原因。
          </p>
        </div>
      </header>

      {errorMessage !== null ? (
        <div className={styles.alert} role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <section className={styles.controls} aria-label="轨迹播放控制">
        <div className={styles.controlButtons}>
          <button type="button" className={styles.button} onClick={handleStep} disabled={atEnd}>
            单步
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={handlePlay}
            disabled={playing || result.trace.length === 0}
          >
            {atEnd ? '从头重播' : '连续播放'}
          </button>
          <button type="button" className={styles.button} onClick={handlePause} disabled={!playing}>
            暂停
          </button>
          <button type="button" className={styles.button} onClick={handleReset}>
            重置
          </button>
        </div>

        <div className={styles.speed}>
          <label className={styles.speedLabel} htmlFor={speedId}>
            播放速度
          </label>
          <input
            id={speedId}
            className={styles.speedRange}
            type="range"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={SPEED_STEP}
            value={speedMs}
            onChange={(event) => setSpeedMs(Number(event.target.value))}
          />
          <span className={styles.speedValue}>每步 {speedMs} ms</span>
        </div>

        <div className={styles.progress} role="status" aria-live="polite">
          <span className={styles.progressBadge}>
            第 {cursor} / {result.trace.length} 步
          </span>
          <span className={styles.progressText}>{actionText}</span>
          {playing ? <span className={styles.progressState}>▶ 播放中</span> : null}
          {!playing && atEnd && result.trace.length > 0 ? (
            <span className={styles.progressState}>■ 已到末尾</span>
          ) : null}
        </div>

        <p className={styles.controlNote}>
          单步 / 播放只移动轨迹游标，不改参数、不产生新 revision；
          {reducedMotion ? '已遵循系统「减少动效」偏好，节点与边的高亮不使用过渡动画。' : '节点与边的高亮带轻微过渡。'}
          {canWriteStart
            ? null
            : ' 起点切换仅在当前视图生效：契约把起点放在 config.start_node_id，而参数通道只能写 parameters[]。'}
        </p>
      </section>

      <div className={styles.mainGrid}>
        <GraphEditor
          graph={graphValue}
          directed={directed}
          startNodeId={startNodeId}
          visited={snapshot.visited}
          currentId={snapshot.currentId}
          checking={snapshot.checking}
          spanningEdges={result.edges_of_spanning_tree}
          level={result.level}
          editable={graphParameter.editable}
          onGraphChange={handleGraphChange}
          onStartChange={handleStartChange}
        />

        <QueuePanel
          queue={snapshot.queue}
          visited={snapshot.visited}
          enqueueOrder={result.enqueue_order}
          order={result.order}
          unvisited={result.unvisited}
          trace={result.trace}
          rejectedEdges={result.rejected_edges}
          hasCycle={result.has_cycle}
          terminatedReason={result.terminated_reason}
          maxSteps={readConfigNumber(object, 'max_steps', BFS_MAX_STEPS)}
        />
      </div>

      <section className={styles.card} aria-labelledby={traceTitleId}>
        <h3 id={traceTitleId} className={styles.cardTitle}>
          逐步轨迹
          <span className={styles.cardTitleMeta}>
            点击任意一行可跳到该步（单步/播放共用同一游标）
          </span>
        </h3>
        <BfsTrace trace={result.trace} startNodeId={startNodeId} cursor={cursor} onSeek={handleSeek} />
      </section>

      <section className={`${styles.card} ${styles.sourceSection}`} aria-labelledby={sourceTitleId}>
        <h3 id={sourceTitleId} className={styles.cardTitle}>
          来源
        </h3>
        {sources.length === 0 ? (
          <p className={styles.sourceNote}>当前对象没有来源记录。</p>
        ) : (
          <SourcePanel
            sources={sources}
            activeSourceId={activeSourceId}
            onSelect={handleFocusSource}
          />
        )}
        <p className={styles.sourceNote}>
          来源只用于定位到原始材料；缺少元素框的页级来源只高亮页码，不绘制元素框。
        </p>
      </section>
    </div>
  );
}

/** 轨迹动作的中文描述（播放控制区的状态条使用）。 */
export function describeStep(step: BfsStep): string {
  if (step.kind === 'dequeue') {
    return `出队 ${step.node}（此刻标记 visited）`;
  }
  if (step.kind === 'enqueue') {
    return `${step.from} 检查邻居 ${step.node}：入队`;
  }
  return `${step.from} 检查邻居 ${step.node}：跳过（${step.reason}）`;
}

function readConfigNumber(object: KnowledgeObject, key: string, fallback: number): number {
  const raw = object.config[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}
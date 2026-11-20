import { useMemo, useState, type KeyboardEvent } from 'react';

type BenchMode = 'integral' | 'gradient' | 'bfs' | 'schedule';
type IntegralMethod = 'left' | 'mid' | 'right';
type ScheduleAlgo = 'fcfs' | 'sjf' | 'srtf' | 'rr';

const PLOT = { left: 52, right: 534, top: 28, bottom: 258 };
const PLOT_WIDTH = PLOT.right - PLOT.left;
const PLOT_HEIGHT = PLOT.bottom - PLOT.top;

function methodName(method: IntegralMethod): string {
  if (method === 'left') return '左端点';
  if (method === 'right') return '右端点';
  return '中点';
}

function Grid({ xSteps, ySteps }: { xSteps: number[]; ySteps: number[] }): JSX.Element {
  return (
    <g className="plot-grid">
      {xSteps.map((x) => (
        <line
          key={`x-${x}`}
          x1={PLOT.left + x * PLOT_WIDTH}
          y1={PLOT.top}
          x2={PLOT.left + x * PLOT_WIDTH}
          y2={PLOT.bottom}
        />
      ))}
      {ySteps.map((y) => (
        <line
          key={`y-${y}`}
          x1={PLOT.left}
          y1={PLOT.bottom - y * PLOT_HEIGHT}
          x2={PLOT.right}
          y2={PLOT.bottom - y * PLOT_HEIGHT}
        />
      ))}
    </g>
  );
}

function gradientRun(lr: number): { points: Array<[number, number]>; norm: number } {
  const points: Array<[number, number]> = [];
  let x = -1.68;
  let y = 1.24;
  points.push([x, y]);
  let norm = Math.sqrt(4 * x * x + 16 * y * y);
  let guard = 0;
  while (norm > 1e-3 && guard < 80) {
    x -= lr * 2 * x;
    y -= lr * 4 * y;
    points.push([x, y]);
    norm = Math.sqrt(4 * x * x + 16 * y * y);
    guard += 1;
  }
  return { points, norm };
}

const BFS_NODES = {
  A: { x: 280, y: 54 },
  B: { x: 150, y: 126 },
  C: { x: 412, y: 126 },
  D: { x: 88, y: 220 },
  E: { x: 236, y: 220 },
  F: { x: 400, y: 220 },
} as const;

const BFS_EDGES: ReadonlyArray<readonly [keyof typeof BFS_NODES, keyof typeof BFS_NODES]> = [
  ['A', 'B'], ['A', 'C'], ['B', 'D'], ['B', 'E'], ['C', 'F'], ['E', 'F'],
];

const BFS_ADJ: Record<keyof typeof BFS_NODES, Array<keyof typeof BFS_NODES>> = {
  A: ['B', 'C'],
  B: ['A', 'D', 'E'],
  C: ['A', 'F'],
  D: ['B'],
  E: ['B', 'F'],
  F: ['C', 'E'],
};

interface BfsSnapshot {
  queue: Array<keyof typeof BFS_NODES>;
  visited: Record<string, boolean>;
  parents: Partial<Record<keyof typeof BFS_NODES, keyof typeof BFS_NODES>>;
  levels: Partial<Record<keyof typeof BFS_NODES, number>>;
  order: Array<keyof typeof BFS_NODES>;
  current: keyof typeof BFS_NODES | null;
}

function buildBfsSnapshots(): BfsSnapshot[] {
  const queue: Array<keyof typeof BFS_NODES> = ['A'];
  const visited: Record<string, boolean> = { A: true };
  const parents: BfsSnapshot['parents'] = {};
  const levels: BfsSnapshot['levels'] = { A: 0 };
  const order: Array<keyof typeof BFS_NODES> = [];
  const snapshots: BfsSnapshot[] = [{
    queue: [...queue], visited: { ...visited }, parents: { ...parents }, levels: { ...levels }, order: [], current: null,
  }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    order.push(current);
    for (const next of BFS_ADJ[current]) {
      if (visited[next]) continue;
      visited[next] = true;
      parents[next] = current;
      levels[next] = (levels[current] ?? 0) + 1;
      queue.push(next);
    }
    snapshots.push({
      queue: [...queue], visited: { ...visited }, parents: { ...parents }, levels: { ...levels }, order: [...order], current,
    });
  }
  return snapshots;
}

const BFS_SNAPSHOTS = buildBfsSnapshots();

interface ScheduleProcess {
  id: 'P1' | 'P2' | 'P3' | 'P4';
  arrival: number;
  burst: number;
}

const SCHEDULE_PROCESSES: readonly ScheduleProcess[] = [
  { id: 'P1', arrival: 0, burst: 7 },
  { id: 'P2', arrival: 2, burst: 4 },
  { id: 'P3', arrival: 4, burst: 1 },
  { id: 'P4', arrival: 5, burst: 4 },
];

interface GanttSegment {
  pid: ScheduleProcess['id'];
  start: number;
  end: number;
}

function runSchedule(algo: ScheduleAlgo, quantum: number): {
  segments: GanttSegment[];
  totalTime: number;
  avgTurnaround: number;
  avgWait: number;
  finishByPid: Record<ScheduleProcess['id'], number>;
} {
  const remaining: Record<ScheduleProcess['id'], number> = {
    P1: 7, P2: 4, P3: 1, P4: 4,
  };
  const finishByPid: Record<ScheduleProcess['id'], number> = {
    P1: 0, P2: 0, P3: 0, P4: 0,
  };
  const segments: GanttSegment[] = [];

  if (algo === 'rr') {
    let t = 0;
    const ready: ScheduleProcess['id'][] = [];
    const enqueued = new Set<ScheduleProcess['id']>();
    const enqueueArrivals = (limit: number): void => {
      for (const proc of SCHEDULE_PROCESSES) {
        if (!enqueued.has(proc.id) && proc.arrival <= limit) {
          enqueued.add(proc.id);
          ready.push(proc.id);
        }
      }
    };
    enqueueArrivals(0);
    while (Object.values(remaining).some((v) => v > 0)) {
      if (ready.length === 0) {
        t += 1;
        enqueueArrivals(t);
        continue;
      }
      const pid = ready.shift()!;
      const runFor = Math.min(quantum, remaining[pid]);
      const start = t;
      t += runFor;
      remaining[pid] -= runFor;
      const last = segments[segments.length - 1];
      if (last && last.pid === pid && last.end === start) {
        last.end = t;
      } else {
        segments.push({ pid, start, end: t });
      }
      enqueueArrivals(t);
      if (remaining[pid] > 0) {
        ready.push(pid);
      } else {
        finishByPid[pid] = t;
      }
    }
  } else {
    let t = 0;
    let done = 0;
    while (done < SCHEDULE_PROCESSES.length) {
      const available = SCHEDULE_PROCESSES.filter((proc) => proc.arrival <= t && remaining[proc.id] > 0);
      if (available.length === 0) {
        t += 1;
        continue;
      }
      available.sort((a, b) => {
        if (algo === 'fcfs') return a.arrival - b.arrival || a.id.localeCompare(b.id);
        const ra = remaining[a.id];
        const rb = remaining[b.id];
        return ra - rb || a.arrival - b.arrival || a.id.localeCompare(b.id);
      });
      const chosen = available[0]!;
      const runFor = algo === 'srtf' ? 1 : remaining[chosen.id];
      const start = t;
      t += runFor;
      remaining[chosen.id] -= runFor;
      const last = segments[segments.length - 1];
      if (last && last.pid === chosen.id && last.end === start) {
        last.end = t;
      } else {
        segments.push({ pid: chosen.id, start, end: t });
      }
      if (remaining[chosen.id] === 0) {
        finishByPid[chosen.id] = t;
        done += 1;
      }
    }
  }

  let sumTat = 0;
  let sumWt = 0;
  for (const proc of SCHEDULE_PROCESSES) {
    const tat = finishByPid[proc.id] - proc.arrival;
    const wt = tat - proc.burst;
    sumTat += tat;
    sumWt += wt;
  }
  return {
    segments,
    totalTime: segments[segments.length - 1]?.end ?? 16,
    avgTurnaround: sumTat / SCHEDULE_PROCESSES.length,
    avgWait: sumWt / SCHEDULE_PROCESSES.length,
    finishByPid,
  };
}

function algoLabel(algo: ScheduleAlgo): string {
  if (algo === 'fcfs') return 'FCFS 先来先服务';
  if (algo === 'sjf') return 'SJF 短作业优先';
  if (algo === 'srtf') return 'SRTF 最短剩余时间';
  return 'RR 时间片轮转';
}

export function HomeBench(): JSX.Element {
  const [mode, setMode] = useState<BenchMode>('integral');
  const [n, setN] = useState(12);
  const [method, setMethod] = useState<IntegralMethod>('mid');
  const [lr, setLr] = useState(0.12);
  const [gradientReplay, setGradientReplay] = useState(0);
  const [bfsStep, setBfsStep] = useState(0);
  const [scheduleAlgo, setScheduleAlgo] = useState<ScheduleAlgo>('srtf');
  const [quantum, setQuantum] = useState(2);

  const gradient = useMemo(() => gradientRun(lr), [lr]);
  const gradientStart = gradient.points[0] ?? [-1.68, 1.24];
  const gradientEnd = gradient.points[gradient.points.length - 1] ?? [0, 0];
  const bfs = BFS_SNAPSHOTS[Math.min(bfsStep, BFS_SNAPSHOTS.length - 1)]!;
  const schedule = useMemo(() => runSchedule(scheduleAlgo, quantum), [scheduleAlgo, quantum]);

  const integral = useMemo(() => {
    const dx = 1 / n;
    let sum = 0;
    const rects: Array<{ x: number; y: number; width: number; height: number; focus: boolean }> = [];
    let focusMark: { x: number; y: number } | null = null;
    const focus = Math.floor(n * 0.62);
    for (let i = 0; i < n; i++) {
      const x0 = i * dx;
      const sample = method === 'left' ? x0 : method === 'right' ? x0 + dx : x0 + dx / 2;
      const value = sample * sample;
      sum += value * dx;
      const px = PLOT.left + x0 * PLOT_WIDTH;
      const py = PLOT.bottom - (value / 1.12) * PLOT_HEIGHT;
      const width = Math.max((PLOT_WIDTH / n) - 0.7, 0.7);
      rects.push({ x: px, y: py, width, height: PLOT.bottom - py, focus: i === focus });
      if (i === focus) {
        focusMark = { x: PLOT.left + sample * PLOT_WIDTH, y: py };
      }
    }
    let curve = '';
    for (let i = 0; i <= 80; i++) {
      const x = i / 80;
      const px = PLOT.left + x * PLOT_WIDTH;
      const py = PLOT.bottom - ((x * x) / 1.12) * PLOT_HEIGHT;
      curve += `${i === 0 ? 'M' : 'L'}${px.toFixed(2)} ${py.toFixed(2)}`;
    }
    return { sum, rects, curve, focusMark, error: Math.abs(sum - 1 / 3) };
  }, [n, method]);

  const pageCopy: Record<BenchMode, { tag: string; title: JSX.Element; stamp: string }> = {
    integral: {
      tag: '样题 01 / 微积分',
      title: <>计算定积分 <b>∫₀¹ x² dx</b>，并用黎曼和观察它如何逼近。</>,
      stamp: '可推演',
    },
    gradient: {
      tag: '样题 02 / 最优化',
      title: <>从点 (−1.6, 1.2) 出发，用梯度下降求 <b>f(x, y) = x² + 2y²</b> 的极小点。</>,
      stamp: gradient.norm <= 1e-3 ? '已收敛' : '未收敛',
    },
    bfs: {
      tag: '样题 03 / 数据结构',
      title: <>从 A 出发，按层遍历这张无向图，并写出队列的出队顺序。</>,
      stamp: '可回放',
    },
    schedule: {
      tag: '样题 04 / 操作系统',
      title: <>对比 <b>FCFS / SJF / SRTF / RR</b> 调度 4 个进程，观察甘特图与等待时间。</>,
      stamp: '可切换',
    },
  };

  function selectMode(nextMode: BenchMode, focus = false): void {
    setMode(nextMode);
    if (focus) {
      window.requestAnimationFrame(() => {
        document.getElementById(`bench-tab-${nextMode}`)?.focus();
      });
    }
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const order: BenchMode[] = ['integral', 'gradient', 'bfs', 'schedule'];
    let next: BenchMode | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = order[(index + 1) % order.length] ?? null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = order[(index - 1 + order.length) % order.length] ?? null;
    if (event.key === 'Home') next = order[0] ?? null;
    if (event.key === 'End') next = order[order.length - 1] ?? null;
    if (next === null) return;
    event.preventDefault();
    selectMode(next, true);
  }

  const integralOutput = `黎曼和 ${integral.sum.toFixed(4)} · 解析值 0.3333 · 误差 ${integral.error.toFixed(4)}`;
  const gradientOutput = `迭代 ${gradient.points.length - 1} 次 · 终点 (${gradientEnd[0].toFixed(3)}, ${gradientEnd[1].toFixed(3)}) · ‖∇f‖ = ${gradient.norm.toFixed(4)}`;
  const bfsDone = bfsStep >= BFS_SNAPSHOTS.length - 1;
  const bfsOutput = bfsDone
    ? '访问顺序 A → B → C → D → E → F · 共 3 层'
    : `已访问 ${bfs.order.length} / 6 · 队列 ${bfs.queue.join(' → ') || '空'}`;
  const scheduleOutput = `${scheduleAlgo.toUpperCase()}${scheduleAlgo === 'rr' ? ` q=${quantum}` : ''} · 平均周转 ${schedule.avgTurnaround.toFixed(2)} · 平均等待 ${schedule.avgWait.toFixed(2)} · ${schedule.segments.length} 段`;
  const output = mode === 'integral' ? integralOutput : mode === 'gradient' ? gradientOutput : mode === 'bfs' ? bfsOutput : scheduleOutput;

  return (
    <div className="bench" id="bench" aria-label="可交互的样题实验台">
      <div className="bench__top">
        <span className="bench__id">BENCH — 017</span>
        <span className="bench__status"><i aria-hidden="true" /> 内核就绪</span>
        <span className="bench__hint">拖动 / 点击 / 回放</span>
      </div>

      <div className="bench__tabs" role="tablist" aria-label="切换样题">
        {(['integral', 'gradient', 'bfs', 'schedule'] as const).map((item, index) => (
          <button
            key={item}
            className={`bench__tab${mode === item ? ' is-active' : ''}`}
            id={`bench-tab-${item}`}
            type="button"
            role="tab"
            aria-selected={mode === item}
            aria-controls="home-bench-panel"
            tabIndex={mode === item ? 0 : -1}
            onClick={() => selectMode(item)}
            onKeyDown={(event) => handleTabKey(event, index)}
          >
            <span className="bench__tab-no">{String(index + 1).padStart(2, '0')}</span>
            {item === 'integral' ? '定积分' : item === 'gradient' ? '梯度下降' : item === 'bfs' ? '广度优先' : '进程调度'}
          </button>
        ))}
      </div>

      <div
        className="bench__body"
        id="home-bench-panel"
        role="tabpanel"
        aria-labelledby={`bench-tab-${mode}`}
      >
        <div className="bench__prompt">
          <span className="bench__tag">{pageCopy[mode].tag}</span>
          <p>{pageCopy[mode].title}</p>
        </div>

        <div className="bench__stage">
          <span className="stage-mark stage-mark--tl" aria-hidden="true" />
          <span className="stage-mark stage-mark--tr" aria-hidden="true" />
          <span className="stage-mark stage-mark--bl" aria-hidden="true" />
          <span className="stage-mark stage-mark--br" aria-hidden="true" />
          {mode === 'integral' ? (
            <svg viewBox="0 0 560 300" role="img" aria-label={`函数 y=x² 的黎曼和，分割数 ${n}，${methodName(method)}，黎曼和约 ${integral.sum.toFixed(4)}`}>
              <Grid xSteps={[0, 0.2, 0.4, 0.6, 0.8, 1]} ySteps={[0, 0.25, 0.5, 0.75, 1]} />
              <path className="plot-axis" d={`M${PLOT.left} ${PLOT.top}V${PLOT.bottom}H${PLOT.right}`} />
              {integral.rects.map((rect, index) => (
                <rect
                  key={index}
                  className={`plot-rect${rect.focus ? ' is-focus' : ''}`}
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                />
              ))}
              {integral.focusMark !== null ? (
                <g>
                  <line x1={integral.focusMark.x} y1={integral.focusMark.y} x2={integral.focusMark.x} y2={PLOT.bottom} stroke="var(--red)" strokeWidth=".8" strokeDasharray="2 3" />
                  <circle className="plot-dot" cx={integral.focusMark.x} cy={integral.focusMark.y} r="2.6" />
                  <text className="plot-label plot-label--red" x={integral.focusMark.x + 6} y={integral.focusMark.y - 6}>f(ξᵢ)</text>
                </g>
              ) : null}
              <path className="plot-curve" d={integral.curve} />
              <text className="plot-annotation" x={PLOT.left + 0.73 * PLOT_WIDTH} y={PLOT.bottom - (0.71 / 1.12) * PLOT_HEIGHT}>y = x²</text>
              <text className="plot-label plot-label--ink" x={PLOT.left + 8} y={PLOT.top + 12}>AREA = Σ f(ξᵢ)Δx</text>
              <text className="plot-label" x={PLOT.left - 34} y={PLOT.bottom - 0.5 * PLOT_HEIGHT + 3}>0.5</text>
              <text className="plot-label" x={PLOT.left - 20} y={PLOT.bottom - PLOT_HEIGHT + 3}>1</text>
              <text className="plot-label" x={PLOT.left - 12} y={PLOT.bottom + 13}>0</text>
              <text className="plot-label" x={PLOT.left + 0.78 * PLOT_WIDTH} y={PLOT.bottom + 15}>x</text>
            </svg>
          ) : null}
          {mode === 'gradient' ? (
            <svg viewBox="0 0 560 300" role="img" aria-label={`梯度下降轨迹，学习率 ${lr.toFixed(2)}，${gradient.norm <= 1e-3 ? '已收敛' : '尚未完全收敛'}`}>
              <Grid xSteps={[0, 0.2, 0.4, 0.6, 0.8, 1]} ySteps={[0, 0.25, 0.5, 0.75, 1]} />
              <path className="plot-axis" d={`M${PLOT.left} ${PLOT.bottom - .5 * PLOT_HEIGHT}H${PLOT.right}M${PLOT.left + .5 * PLOT_WIDTH} ${PLOT.top}V${PLOT.bottom}`} />
              {[0.16, 0.5, 1.05, 1.85, 2.9].map((level) => {
                const rx = Math.sqrt(level) * (PLOT_WIDTH / 4.7);
                const ry = Math.sqrt(level / 2) * (PLOT_HEIGHT / 3.7);
                return <ellipse key={level} className="plot-level" cx={PLOT.left + .5 * PLOT_WIDTH} cy={PLOT.bottom - .5 * PLOT_HEIGHT} rx={rx} ry={ry} />;
              })}
              {(() => {
                const xScale = PLOT_WIDTH / 4.7;
                const yScale = PLOT_HEIGHT / 3.7;
                const toX = (x: number) => PLOT.left + (x + 2.35) * xScale / 1;
                const toY = (y: number) => PLOT.bottom - .5 * PLOT_HEIGHT - y * yScale;
                const path = gradient.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${toX(point[0]).toFixed(2)} ${toY(point[1]).toFixed(2)}`).join('');
                return (
                  <g>
                    <path className="plot-trail" d={path} />
                    <path key={`${lr}-${gradientReplay}`} className="plot-trail-anim" d={path} />
                    {gradient.points.slice(1, -1).map((point, index) => (
                      <circle key={index} cx={toX(point[0])} cy={toY(point[1])} r="2" fill="var(--red)" opacity=".55" />
                    ))}
                    <circle cx={toX(gradientStart[0])} cy={toY(gradientStart[1])} r="4.6" fill="var(--ink)" />
                    <circle cx={toX(gradientEnd[0])} cy={toY(gradientEnd[1])} r="4.4" fill="var(--red)" />
                    <circle cx={toX(gradientEnd[0])} cy={toY(gradientEnd[1])} r="9" fill="none" stroke="var(--red)" strokeWidth=".8" opacity=".45" />
                    <text className="plot-label plot-label--ink" x={toX(-2.22)} y={PLOT.top + 12}>f(x,y) = x² + 2y²</text>
                    <text className="plot-annotation" x={toX(gradientStart[0]) - 12} y={toY(gradientStart[1]) - 10}>起点</text>
                    <text className="plot-label plot-label--red" x={toX(0) + 10} y={toY(0) - 8}>驻点 (0,0)</text>
                    <text className="plot-label" x={toX(0) - 12} y={PLOT.top + 4}>y</text>
                    <text className="plot-label" x={toX(2.15)} y={PLOT.bottom + 2}>x</text>
                    <text className="plot-label" x={PLOT.right - 66} y={PLOT.top + 12}>等高线 · 5 级</text>
                  </g>
                );
              })()}
            </svg>
          ) : null}
          {mode === 'bfs' ? (
            <svg viewBox="0 0 560 300" role="img" aria-label={`广度优先搜索图，从 A 出发，已访问 ${bfs.order.length} 个节点，队列为 ${bfs.queue.join('、') || '空'}`}>
              <Grid xSteps={[0, 0.2, 0.4, 0.6, 0.8, 1]} ySteps={[0, 0.25, 0.5, 0.75, 1]} />
              {BFS_EDGES.map(([from, to]) => {
                const tree = bfs.parents[from] === to || bfs.parents[to] === from;
                const lit = tree && bfs.order.includes(from) && bfs.order.includes(to);
                return (
                  <line
                    key={`${from}-${to}`}
                    className={`plot-edge${lit ? ' is-tree' : ''}`}
                    x1={BFS_NODES[from].x}
                    y1={BFS_NODES[from].y}
                    x2={BFS_NODES[to].x}
                    y2={BFS_NODES[to].y}
                  />
                );
              })}
              {(Object.keys(BFS_NODES) as Array<keyof typeof BFS_NODES>).map((name) => {
                const pos = BFS_NODES[name];
                const processed = bfs.order.includes(name);
                const className = processed
                  ? `plot-node ${name === bfs.current ? 'is-current' : 'is-visited'}`
                  : bfs.visited[name] ? 'plot-node is-frontier' : 'plot-node';
                return (
                  <g key={name}>
                    <circle className={className} cx={pos.x} cy={pos.y} r="16" />
                    <text className={`plot-node-label${processed ? ' is-light' : ''}`} x={pos.x} y={pos.y + 3}>{name}</text>
                    {bfs.levels[name] !== undefined ? (
                      <text className="plot-label" x={pos.x + 21} y={pos.y - 9}>{`L${bfs.levels[name]}`}</text>
                    ) : null}
                  </g>
                );
              })}
              <text className="plot-label plot-label--ink" x={PLOT.left + 8} y={PLOT.top + 12}>BFS · 从 A 出发</text>
              <text className="plot-label" x={PLOT.right - 74} y={PLOT.top + 12}>队列先进先出</text>
              <text className="plot-label" x={PLOT.left + 8} y={PLOT.bottom + 18}>蓝色已访问 · 红色当前 · 虚线在队列中</text>
            </svg>
          ) : null}
          {mode === 'schedule' ? (
            <svg
              viewBox="0 0 560 300"
              role="img"
              aria-label={`进程调度甘特图，算法 ${algoLabel(scheduleAlgo)}，平均周转 ${schedule.avgTurnaround.toFixed(2)}`}
            >
              <Grid xSteps={[0, 0.25, 0.5, 0.75, 1]} ySteps={[0, 0.25, 0.5, 0.75, 1]} />
              <path className="plot-axis" d={`M${PLOT.left} ${PLOT.top + 22}V${PLOT.bottom - 18}H${PLOT.right}`} />
              <text className="plot-label plot-label--ink" x={PLOT.left + 8} y={PLOT.top + 12}>
                {algoLabel(scheduleAlgo)} · 甘特图（t = 0 → {schedule.totalTime}）
              </text>
              {(() => {
                const colors: Record<ScheduleProcess['id'], string> = {
                  P1: 'var(--blue)',
                  P2: '#0f7b5f',
                  P3: 'var(--red)',
                  P4: '#8a5a16',
                };
                const rowY = (idx: number) => PLOT.top + 38 + idx * 44;
                const xAt = (t: number) => PLOT.left + (t / schedule.totalTime) * PLOT_WIDTH;
                return (
                  <g>
                    {SCHEDULE_PROCESSES.map((proc, idx) => {
                      const y = rowY(idx);
                      const arrX = xAt(proc.arrival);
                      const fin = schedule.finishByPid[proc.id];
                      const finX = xAt(fin);
                      return (
                        <g key={proc.id}>
                          <text className="plot-label plot-label--ink" x={PLOT.left - 34} y={y + 16}>
                            {proc.id}
                          </text>
                          <line
                            x1={arrX}
                            y1={y + 12}
                            x2={finX}
                            y2={y + 12}
                            stroke="rgba(16, 29, 49, 0.16)"
                            strokeWidth="2"
                            strokeDasharray="3 3"
                          />
                          <circle cx={arrX} cy={y + 12} r="3" fill="var(--ink)" />
                        </g>
                      );
                    })}
                    {schedule.segments.map((seg, segIdx) => {
                      const rowIdx = SCHEDULE_PROCESSES.findIndex((p) => p.id === seg.pid);
                      const y = rowY(rowIdx);
                      const x = xAt(seg.start);
                      const w = Math.max(4, xAt(seg.end) - x - 1.5);
                      return (
                        <g key={`${seg.pid}-${seg.start}-${segIdx}`}>
                          <rect
                            x={x}
                            y={y}
                            width={w}
                            height="24"
                            rx="3"
                            fill={colors[seg.pid]}
                            opacity="0.88"
                          />
                          {w >= 26 ? (
                            <text
                              x={x + w / 2}
                              y={y + 15}
                              textAnchor="middle"
                              fill="#ffffff"
                              fontSize="9.5"
                              fontFamily="var(--mono)"
                              fontWeight="700"
                            >
                              {seg.pid}
                            </text>
                          ) : null}
                        </g>
                      );
                    })}
                    {[0, 2, 4, 6, 8, 10, 12, 14, 16].map((tick) => (
                      <text
                        key={tick}
                        className="plot-label"
                        x={xAt(tick)}
                        y={PLOT.bottom - 2}
                        textAnchor="middle"
                      >
                        {tick}
                      </text>
                    ))}
                    <text className="plot-label" x={PLOT.left + 8} y={PLOT.bottom + 18}>
                      黑点为到达时刻 · 虚线表示就绪等待与执行跨度
                    </text>
                  </g>
                );
              })()}
            </svg>
          ) : null}
          <span className="bench__stamp" aria-hidden="true">{pageCopy[mode].stamp}</span>
        </div>

        <div className="bench__controls">
          {mode === 'integral' ? (
            <>
              <div className="ctrl">
                <label className="ctrl__label" htmlFor="home-bench-n">分割数 n</label>
                <input
                  id="home-bench-n"
                  type="range"
                  min="4"
                  max="64"
                  step="1"
                  value={n}
                  onChange={(event) => setN(Number(event.target.value))}
                />
                <output className="ctrl__value">{n}</output>
              </div>
              <div className="ctrl">
                <span className="ctrl__label">取点方式</span>
                <div className="seg" role="group" aria-label="黎曼和取点方式">
                  {(['left', 'mid', 'right'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={method === item ? 'is-active' : ''}
                      aria-pressed={method === item}
                      onClick={() => setMethod(item)}
                    >
                      {item === 'left' ? '左端' : item === 'mid' ? '中点' : '右端'}
                    </button>
                  ))}
                </div>
                <span className="ctrl__hint">{methodName(method)} · {n} 个矩形</span>
              </div>
            </>
          ) : null}

          {mode === 'gradient' ? (
            <>
              <div className="ctrl">
                <label className="ctrl__label" htmlFor="home-bench-lr">学习率 η</label>
                <input
                  id="home-bench-lr"
                  type="range"
                  min="0.08"
                  max="0.42"
                  step="0.01"
                  value={lr}
                  onChange={(event) => setLr(Number(event.target.value))}
                />
                <output className="ctrl__value">{lr.toFixed(2)}</output>
              </div>
              <div className="ctrl">
                <span className="ctrl__label">轨迹</span>
                <button className="bench-btn bench-btn--solid" type="button" onClick={() => setGradientReplay((current) => current + 1)}>
                  重播轨迹 ↻
                </button>
                <span className="ctrl__hint">目标：‖∇f‖ &lt; 1e−3</span>
              </div>
            </>
          ) : null}

          {mode === 'bfs' ? (
            <>
              <div className="ctrl" style={{ minHeight: 28 }}>
                <span className="queue__label">QUEUE</span>
                {bfs.queue.length === 0 ? (
                  <span className="queue__item is-empty">空</span>
                ) : bfs.queue.map((name, index) => (
                  <span key={name} className={`queue__item${index === 0 ? ' is-head' : ''}`}>{name}</span>
                ))}
                <span className="queue__meta">当前 L{bfs.current === null ? 0 : (bfs.levels[bfs.current] ?? 0)} · 已出队 {bfs.order.length}/6</span>
              </div>
              <div className="ctrl">
                <button
                  className="bench-btn bench-btn--solid"
                  type="button"
                  disabled={bfsDone}
                  onClick={() => setBfsStep((current) => Math.min(current + 1, BFS_SNAPSHOTS.length - 1))}
                >
                  {bfsDone ? '遍历完成' : '下一步 →'}
                </button>
                <button className="bench-btn" type="button" onClick={() => setBfsStep(0)}>重置</button>
                <span className="ctrl__hint">{bfsStep === 0 ? '等待出队 A' : bfsDone ? '全部节点已访问' : `刚出队 ${bfs.current}`}</span>
              </div>
            </>
          ) : null}

          {mode === 'schedule' ? (
            <>
              <div className="ctrl">
                <span className="ctrl__label">调度算法</span>
                <div className="seg" role="group" aria-label="进程调度算法">
                  {(['fcfs', 'sjf', 'srtf', 'rr'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={scheduleAlgo === item ? 'is-active' : ''}
                      aria-pressed={scheduleAlgo === item}
                      onClick={() => setScheduleAlgo(item)}
                    >
                      {item.toUpperCase()}
                    </button>
                  ))}
                </div>
                <span className="ctrl__hint">{algoLabel(scheduleAlgo)}</span>
              </div>
              <div className="ctrl">
                {scheduleAlgo === 'rr' ? (
                  <>
                    <label className="ctrl__label" htmlFor="home-bench-q">时间片 q</label>
                    <input
                      id="home-bench-q"
                      type="range"
                      min="1"
                      max="4"
                      step="1"
                      value={quantum}
                      onChange={(event) => setQuantum(Number(event.target.value))}
                    />
                    <output className="ctrl__value">{quantum}</output>
                  </>
                ) : (
                  <span className="ctrl__hint">
                    到达/服务：P1(0,7) · P2(2,4) · P3(4,1) · P4(5,4)
                  </span>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="bench__foot">
        <span aria-live="polite">{output}</span>
        <span className="bench__foot-note">全部计算发生在本页</span>
      </div>
    </div>
  );
}

export default HomeBench;

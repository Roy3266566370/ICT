import { MathText } from './ProblemText';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatNumber } from '@/labs/expr';
import { useManualState } from './manualState';
import {
  auditManualBanker,
  auditManualDiskOrder,
  auditManualPageReplace,
  auditManualSchedule,
  DISK_LABELS,
  firstDiskDivergence,
  firstPageDivergence,
  firstScheduleDivergence,
  PAGE_LABELS,
  referenceScheduleGantt,
  SCHED_LABELS,
  type OsBankerResult,
  type OsDiskResult,
  type OsFrame,
  type OsGanttSegment,
  type OsPageResult,
  type OsResult,
  type OsSchedResult,
} from '@/labs/opsys';
import type { LabSelection } from './LabCanvas';
import styles from './OsCanvas.module.css';

interface Props {
  result: OsResult;
  step: number;
  selected?: LabSelection | null;
  onSelect?: (selection: LabSelection | null) => void;
  /** 「我来 ✋」手动轨迹的持久化切片（LabState.manual 的子集）与回写。 */
  manual?: Record<string, unknown>;
  onManualChange?: (key: string, value: unknown) => void;
  /** 分享只读回放：有手动轨迹则展示轨迹与审计，不提供编辑。 */
  readOnly?: boolean;
}

/** 单个画布的手动切片载体：mode 表示处于手动模式，其余字段是各自的选择序列。 */
interface ManualChildProps {
  saved?: { mode?: boolean; [key: string]: unknown };
  onSave?: (value: unknown) => void;
  readOnly?: boolean;
}

const PALETTE = ['#4f46e5', '#ff7a59', '#0f9d7a', '#c2410c', '#2563eb', '#a21caf', '#ca8a04', '#0891b2', '#be123c',
  '#4d7c0f', '#7c3aed', '#475569'];

function read<T>(frame: OsFrame, key: string, fallback: T): T {
  const value = frame.values[key];
  return (value === undefined || value === null ? fallback : value) as T;
}

function Pseudocode({ result, frame }: { result: OsResult; frame: OsFrame }): ReactNode {
  return (
    <div className={styles.pseudocode} aria-label="伪代码">
      {result.pseudocode.map((line, index) => (
        <code key={line} data-active={frame.pseudocodeLine === index + 1 || undefined}>
          <i>{index + 1}</i>
          {line}
        </code>
      ))}
    </div>
  );
}

function CompareBars({ title, values, labels, current, unit, lowerBetter = true }: {
  title: string; values: Record<string, number>; labels: Record<string, string>; current: string; unit: string;
  lowerBetter?: boolean;
}): ReactNode {
  const entries = Object.entries(values);
  const max = Math.max(...entries.map(([, value]) => value), 1e-9);
  const best = lowerBetter ? Math.min(...entries.map(([, value]) => value)) : Math.max(...entries.map(([, value]) => value));
  return (
    <div className={styles.block}>
      <span className={styles.blockTitle}>{title}</span>
      <div className={styles.bars}>
        {entries.map(([key, value]) => (
          <div key={key} className={styles.barRow} data-current={key === current || undefined}>
            <span>{labels[key]?.split(/[（(]/)[0] ?? key}</span>
            <div className={styles.barTrack}>
              <i style={{ width: `${Math.max(3, (value / max) * 100)}%` }} data-best={value === best || undefined} />
            </div>
            <b>{formatNumber(value, 3)}{unit}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 统一的「内核自动推演 / 我来 ✋」模式切换条。 */
function ModeSwitch({ title, manual, onAuto, onManual, manualLabel, hint }: {
  title: string; manual: boolean; onAuto: () => void; onManual: () => void; manualLabel: string; hint?: string;
}): ReactNode {
  return (
    <div className={styles.block}>
      <span className={styles.blockTitle}>{title}</span>
      <div className={styles.queue}>
        <button type="button" className={styles.modeBtn} data-current={!manual || undefined} onClick={onAuto}>
          内核自动推演
        </button>
        <button type="button" className={styles.modeBtn} data-current={manual || undefined} onClick={onManual}>
          {manualLabel}
        </button>
        {manual && hint ? <small>{hint}</small> : null}
      </div>
    </div>
  );
}

/** 手动模式统一的错误与警告列表（只读审计，不替学生改答案）。 */
function AuditIssues({ errors, warnings }: { errors: string[]; warnings: string[] }): ReactNode {
  return (
    <>
      {errors.length ? (
        <ul className={styles.schedIssues} role="alert">
          {errors.map((error, index) => <li key={index}>{error}</li>)}
        </ul>
      ) : null}
      {warnings.length ? (
        <ul className={styles.schedWarnings}>
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* CPU 调度                                                             */
/* ------------------------------------------------------------------ */

interface SchedManual { mode: boolean; step: number; timeline: (string | null)[] }

function SchedCanvas({ result, frame, selected, onSelect, saved, onSave, readOnly }: {
  result: OsSchedResult; frame: OsFrame; selected?: LabSelection | null; onSelect?: Props['onSelect'];
} & ManualChildProps): ReactNode {
  const [ms, setMs] = useManualState<SchedManual>(
    saved as SchedManual | undefined, onSave, { mode: false, step: 1, timeline: [] });
  const ro = readOnly === true;
  const manualMode = ro ? saved?.mode === true : ms.mode;
  const timeline = ms.timeline;
  const manualStep = ms.step;
  const setTimeline = (updater: (current: (string | null)[]) => (string | null)[]): void =>
    setMs((m) => ({ ...m, timeline: updater(m.timeline) }));
  const setManualMode = (mode: boolean): void => setMs((m) => ({ ...m, mode }));
  const processes = result.stats.processes;
  const manual = useMemo(() => auditManualSchedule(processes, timeline, manualStep), [manualStep, processes, timeline]);
  const reference = useMemo(() => referenceScheduleGantt(processes, 'srtf', manualStep), [manualStep, processes]);
  const divergence = manual.complete ? firstScheduleDivergence(timeline, reference, manualStep) : null;
  const manualTime = Number((timeline.length * manualStep).toFixed(6));
  const earliestArrival = processes.length ? Math.min(...processes.map((process) => process.arrival)) : 0;
  const leadingIdle = (step: number): (string | null)[] =>
    Array.from({ length: Math.max(0, Math.ceil(earliestArrival / step - 1e-9)) }, () => null);
  const startManual = (): void =>
    setMs((m) => ({ ...m, mode: true, timeline: m.timeline.length ? m.timeline : leadingIdle(m.step) }));
  const changeStep = (step: number): void => setMs((m) => ({ ...m, step, timeline: leadingIdle(step) }));
  // I-05：在甘特下方的时间格条上按下拖动可连续填充/覆盖；笔刷取最近点选的进程。
  const [brush, setBrush] = useState<string | null>(processes[0]?.id ?? null);
  const paintingRef = useRef(false);
  useEffect(() => {
    const end = (): void => { paintingRef.current = false; };
    window.addEventListener('pointerup', end);
    return () => window.removeEventListener('pointerup', end);
  }, []);
  const paintSlot = (index: number): void => setTimeline((current) => {
    const next = [...current];
    while (next.length <= index) next.push(null);
    next[index] = brush;
    return next;
  });
  const jumpToEarliest = (): void => {
    setTimeline((current) => {
      const target = Math.max(0, Math.ceil(earliestArrival / manualStep - 1e-9));
      if (current.length >= target) return current;
      return [...current, ...Array.from({ length: target - current.length }, () => null)];
    });
  };
  const full = manualMode ? manual.segments : result.stats.gantt;
  const executed = manualMode ? full.length : read<OsGanttSegment[]>(frame, 'gantt', []).length;
  const names = processes.map((row) => row.id);
  const color = (id: string | null): string => (id === null ? '#cbd5e1' : PALETTE[names.indexOf(id) % PALETTE.length]!);
  const start = full[0]?.start ?? 0;
  const makespan = manualMode ? manual.makespan : result.stats.makespan;
  // 手动模式在甘特末端留出 4 个时间单位的可填充余量。
  const displayEnd = manualMode ? Math.max(makespan, start + manualTime + 4) : makespan;
  const slotCount = manualMode ? Math.min(240, Math.ceil((displayEnd - start) / manualStep)) : 0;
  const span = Math.max(1e-9, displayEnd - start);
  const pct = (time: number): number => ((time - start) / span) * 100;
  const rows = read<Record<string, unknown>[]>(frame, 'rows', []);
  const ready = read<string[]>(frame, 'ready', []);
  const running = read<string | null>(frame, 'running', null);
  const stateLabels: Record<string, string> = { pending: '未到达', ready: '就绪', running: '运行', done: '完成' };
  const issueAt = (segment: OsGanttSegment): boolean =>
    manualMode && manual.errors.some((error) => error.time >= segment.start && error.time < segment.end);
  const manualRunning = manual.segments[manual.segments.length - 1]?.id ?? null;
  let lastLabel = -100;
  return (
    <>
      {ro ? null : (
        <ModeSwitch title="调度模式" manual={manualMode} onAuto={() => setManualMode(false)} onManual={startManual}
          manualLabel="我来手动调度 ✋" hint={`每格 ${formatNumber(manualStep)} 个时间单位；点击下方时间格条直接拖动填充。`} />
      )}
      <div className={styles.block}>
        <span className={styles.blockTitle}>
          {manualMode ? `手动甘特图 · 当前 t=${formatNumber(manualTime)}${ro ? '（分享回放）' : ''}` : `甘特图 · t=${formatNumber(Number(read(frame, 'time', start)))}`}
        </span>
        <div className={styles.gantt} role="img" aria-label={manualMode ? '手动 CPU 甘特图' : 'CPU 甘特图'}>
          {full.map((seg, index) => (
            <div
              key={`${seg.start}-${index}`}
              className={styles.ganttSeg}
              data-state={manualMode ? (index === executed - 1 ? 'now' : 'done') : index < executed ? (index === executed - 1 ? 'now' : 'done') : 'future'}
              data-invalid={issueAt(seg) || undefined}
              style={{ left: `${pct(seg.start)}%`, width: `${pct(seg.end) - pct(seg.start)}%`, ['--seg' as string]: color(seg.id) }}
              title={`${seg.id ?? '空闲'}：${formatNumber(seg.start)}–${formatNumber(seg.end)}${issueAt(seg) ? '（非法调度）' : ''}${manualMode && !ro ? ' · 点击从此时刻重新调度' : ''}`}
              onClick={manualMode && !ro ? () => setTimeline((current) => current.slice(0, Math.max(0, Math.round(seg.start / manualStep)))) : undefined}
            >
              <span>{seg.id ?? '空闲'}</span>
            </div>
          ))}
        </div>
        {manualMode ? (
          <div className={styles.slotStrip} role="img"
            aria-label={ro ? '学生填充的时间格' : '拖动填充时间格：按住并拖过即连续填入当前笔刷'}>
            {Array.from({ length: slotCount }, (_, index) => {
              const id = timeline[index] ?? null;
              return (
                <div
                  key={index}
                  className={styles.slotCell}
                  data-filled={id !== null || undefined}
                  style={{
                    left: `${pct(start + index * manualStep)}%`,
                    width: `${pct(start + (index + 1) * manualStep) - pct(start + index * manualStep)}%`,
                    ['--seg' as string]: color(id),
                  }}
                  title={`t=${formatNumber(start + index * manualStep)} 起的一格${id ? `：${id}` : ''}`}
                  onPointerDown={ro ? undefined : (event) => { event.preventDefault(); paintingRef.current = true; paintSlot(index); }}
                  onPointerEnter={ro ? undefined : () => { if (paintingRef.current) paintSlot(index); }}
                />
              );
            })}
          </div>
        ) : null}
        <div className={styles.ganttAxis}>
          {[...full.map((seg) => seg.start), displayEnd].map((time, index) => {
            const left = pct(time);
            const show = left - lastLabel >= 4;
            if (show) lastLabel = left;
            return show ? <span key={`${time}-${index}`} style={{ left: `${left}%` }}>{formatNumber(time)}</span> : null;
          })}
        </div>
      </div>
      {manualMode ? (
        <div className={styles.block}>
          <span className={styles.blockTitle}>
            {ro ? '学生填充的调度与审计' : `手动调度 · 点击进程追加一格并设为笔刷，在时间格条上拖动可连填`}
          </span>
          {ro ? null : (
            <div className={styles.queue}>
              <label className={styles.stepField}>时间粒度
                <select aria-label="手动调度时间粒度" value={manualStep} onChange={(event) => changeStep(Number(event.target.value))}>
                  <option value={0.25}>0.25</option>
                  <option value={0.5}>0.5</option>
                  <option value={1}>1</option>
                </select>
              </label>
              <button type="button" className={styles.queueCell} onClick={jumpToEarliest} disabled={manualTime >= earliestArrival - 1e-9}>
                跳到最早到达
              </button>
              {manual.rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={styles.queueCell}
                  style={{ ['--seg' as string]: color(row.id) }}
                  disabled={row.finish !== null}
                  data-notready={row.arrival > manualTime + 1e-9 || undefined}
                  data-brush={brush === row.id || undefined}
                  title={`到达 ${formatNumber(row.arrival)}，服务 ${formatNumber(row.burst)}，剩余 ${formatNumber(row.remaining)}`}
                  onClick={() => { setBrush(row.id); setTimeline((current) => [...current, row.id]); }}
                >
                  {row.id} <small>{row.finish !== null ? '已完成' : `剩 ${formatNumber(row.remaining)}`}</small>
                </button>
              ))}
              <button type="button" className={styles.queueCell} data-brush={brush === null || undefined}
                onClick={() => { setBrush(null); setTimeline((current) => [...current, null]); }}>空闲</button>
              <button type="button" className={styles.queueCell} disabled={!timeline.length} onClick={() => setTimeline((current) => current.slice(0, -1))}>撤销一格</button>
              <button type="button" className={styles.queueCell} disabled={!timeline.length} onClick={() => setTimeline(() => [])}>清空</button>
            </div>
          )}
          <AuditIssues errors={manual.errors.map((error) => error.reason)} warnings={manual.warnings} />
          {manual.complete && manual.avgWaiting !== null ? (
            <p className={styles.schedSummary}>
              完成：平均等待 {formatNumber(manual.avgWaiting)}，平均周转 {formatNumber(manual.avgTurnaround)}。
              最佳参考（SRTF）平均等待 {formatNumber(result.stats.compare.srtf ?? null)}。
            </p>
          ) : <p className={styles.schedSummary}>尚未完成全部进程；补齐时间片后才能与内核算法比较。</p>}
          {divergence ? (
            <p className={styles.schedHint}>第一次与 SRTF 不同的时刻 t={formatNumber(divergence.time)}：你选择 {divergence.manual ?? '空闲'}，SRTF 选择 {divergence.reference ?? '空闲'}。</p>
          ) : manual.complete ? <p className={styles.schedHint}>你的逐格选择与 SRTF 完全一致。</p> : null}
        </div>
      ) : null}
      <div className={styles.twoCols}>
        <div className={styles.block}>
          <span className={styles.blockTitle}>CPU 与就绪队列</span>
          <div className={styles.queue}>
            <span className={styles.cpu} style={{ ['--seg' as string]: color(manualMode ? manualRunning : running) }}>
              {manualMode ? (manualRunning ?? '空闲') : (running ?? '空闲')}
            </span>
            <em>←</em>
            {manualMode
              ? manual.rows.filter((row) => row.finish === null && row.arrival <= timeline.length * manualStep + 1e-9).map((row) => (
                <span key={row.id} className={styles.queueCell} style={{ ['--seg' as string]: color(row.id) }}>{row.id}</span>
              ))
              : ready.length ? ready.map((id) => (
                <span key={id} className={styles.queueCell} style={{ ['--seg' as string]: color(id) }}>{id}</span>
              )) : <small>队列为空</small>}
          </div>
        </div>
        {manualMode && manual.complete && manual.avgWaiting !== null ? (
          <CompareBars title="平均等待时间对照（含你的手动调度）" values={{ ...result.stats.compare, manual: manual.avgWaiting }}
            labels={{ ...SCHED_LABELS, manual: '你的手动调度' }} current="manual" unit="" />
        ) : Object.keys(result.stats.compare).length ? (
          <CompareBars title="同一组进程 · 平均等待时间对照" values={result.stats.compare} labels={SCHED_LABELS}
            current={result.algorithm} unit="" />
        ) : null}
      </div>
      {manualMode ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>进程</th><th>到达</th><th>服务</th><th>剩余</th><th>状态</th><th>完成</th><th>周转</th><th>等待</th></tr>
            </thead>
            <tbody>
              {manual.rows.map((row) => (
                <tr key={row.id} data-state={row.state}>
                  <td><i style={{ background: color(row.id) }} />{row.id}</td>
                  <td>{formatNumber(row.arrival)}</td>
                  <td>{formatNumber(row.burst)}</td>
                  <td>{formatNumber(row.remaining)}</td>
                  <td><b>{stateLabels[row.state] ?? row.state}</b></td>
                  <td>{row.finish === null ? '—' : formatNumber(row.finish)}</td>
                  <td>{row.turnaround === null ? '—' : formatNumber(row.turnaround)}</td>
                  <td>{row.waiting === null ? '—' : formatNumber(row.waiting)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>进程</th><th>到达</th><th>服务</th>{result.stats.processes.some((row) => row.priority !== null) ? <th>优先级</th> : null}
                <th>剩余</th><th>状态</th><th>完成</th><th>周转</th><th>等待</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = String(row.id);
                const hasPriority = result.stats.processes.some((item) => item.priority !== null);
                return (
                  <tr
                    key={id}
                    data-state={String(row.state)}
                    data-selected={selected?.id === `os-proc-${id}` || undefined}
                    onClick={() => onSelect?.({ id: `os-proc-${id}`, label: `进程 ${id}`, kind: 'os_process' })}
                  >
                    <td><i style={{ background: color(id) }} />{id}</td>
                    <td>{formatNumber(Number(row.arrival))}</td>
                    <td>{formatNumber(Number(row.burst))}</td>
                    {hasPriority ? <td>{row.priority === null ? '—' : formatNumber(Number(row.priority))}</td> : null}
                    <td>{formatNumber(Number(row.remaining))}</td>
                    <td><b>{stateLabels[String(row.state)] ?? String(row.state)}</b></td>
                    <td>{row.finish === null ? '—' : formatNumber(Number(row.finish))}</td>
                    <td>{row.turnaround === null ? '—' : formatNumber(Number(row.turnaround))}</td>
                    <td>{row.waiting === null ? '—' : formatNumber(Number(row.waiting))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 页面置换                                                             */
/* ------------------------------------------------------------------ */

interface PageManual { mode: boolean; choices: number[] }

function PageCanvas({ result, frame, saved, onSave, readOnly }: {
  result: OsPageResult; frame: OsFrame;
} & ManualChildProps): ReactNode {
  const [pm, setPm] = useManualState<PageManual>(
    saved as PageManual | undefined, onSave, { mode: false, choices: [] });
  const ro = readOnly === true;
  const manualMode = ro ? saved?.mode === true : pm.mode;
  const choices = pm.choices;
  const setChoices = (updater: (current: number[]) => number[]): void =>
    setPm((m) => ({ ...m, choices: updater(m.choices) }));
  const setManualMode = (mode: boolean): void => setPm((m) => ({ ...m, mode }));
  const reference = read<string[]>(frame, 'reference', []);
  const cursor = read<number>(frame, 'cursor', -1);
  const framesCount = result.stats.frames_count;
  const initialFrames = result.stats.initial_frames;
  const aux = read<string[]>(frame, 'aux', []);
  const manual = useMemo(
    () => auditManualPageReplace(framesCount, initialFrames, reference, choices),
    [choices, framesCount, initialFrames, reference],
  );
  const divergence = useMemo(
    () => firstPageDivergence(choices, reference, framesCount, initialFrames, 'opt'),
    [choices, framesCount, initialFrames, reference],
  );
  const pending = choices.length;
  const currentPage = pending < reference.length ? reference[pending]! : null;
  const slots = manual.frames;
  const columns = reference.map((page, index) => {
    if (manualMode) {
      const row = manual.rows[index] ?? null;
      return { page, index, visible: row !== null, frames: row?.frames ?? null, hit: row?.hit ?? null,
        slot: row?.slot ?? null, evicted: row?.evicted ?? null, error: row?.error ?? null };
    }
    const source = result.frames[index + 1];
    return { page, index, visible: index <= cursor,
      frames: (source?.values.frames ?? null) as (string | null)[] | null,
      hit: (source?.values.hit ?? null) as boolean | null,
      slot: (source?.values.slot ?? null) as number | null,
      evicted: (source?.values.evicted ?? null) as string | null,
      error: null as string | null };
  });
  const optFaults = result.stats.compare.opt ?? null;
  return (
    <>
      {ro ? null : (
        <ModeSwitch title="推演模式" manual={manualMode} onAuto={() => setManualMode(false)}
          onManual={() => setManualMode(true)} manualLabel="我来手动置换 ✋"
          hint="逐次访问决定把页面装进哪个物理块；命中也必须点中它所在的块。" />
      )}
      <div className={styles.block}>
        <span className={styles.blockTitle}>
          {manualMode
            ? `访问序列与物理块 · 你的缺页 ${manual.faults} 次 / 命中 ${manual.hits} 次${ro ? '（分享回放）' : ''}`
            : `访问序列与物理块 · 缺页 ${String(read(frame, 'faults', 0))} 次 / 命中 ${String(read(frame, 'hits', 0))} 次`}
        </span>
        {initialFrames.length ? (
          <p className={styles.mono}>初始已装入：<MathText text={String(initialFrames.join('、') ?? '')} />（对它们的首次访问按命中计）</p>
        ) : null}
        <div className={styles.pageScroll}>
          <table className={styles.pageTable} aria-label={manualMode ? '手动页面置换表' : '页面置换过程表'}>
            <thead>
              <tr>
                <th>访问</th>
                {columns.map((column) => (
                  <th key={column.index}
                    data-now={!manualMode && column.index === cursor || undefined}
                    data-pending={manualMode && column.index === pending || undefined}
                    data-future={!manualMode && column.index > cursor || undefined}>
                    {column.page}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: framesCount }, (_, slot) => (
                <tr key={slot}>
                  <th>块 {slot + 1}</th>
                  {columns.map((column) => {
                    const value = column.visible ? column.frames?.[slot] : null;
                    const changed = column.visible && column.slot === slot && column.hit === false;
                    const errored = column.visible && column.error !== null && column.slot === slot;
                    return (
                      <td key={column.index} data-changed={changed || undefined}
                        data-now={!manualMode && column.index === cursor || undefined}
                        data-error={errored || undefined}
                        data-hit={column.visible && column.hit && column.slot === slot ? true : undefined}>
                        {column.visible ? value ?? '' : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className={styles.pageResult}>
                <th>结果</th>
                {columns.map((column) => (
                  <td key={column.index}
                    data-error={column.visible && column.error !== null || undefined}
                    data-fault={column.visible && column.error === null && column.hit === false ? true : undefined}
                    data-ok={column.visible && column.hit === true ? true : undefined}>
                    {!column.visible ? '' : column.error !== null ? '非法'
                      : column.hit ? '命中' : column.evicted !== null ? `换出 ${column.evicted}` : '缺页'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      {manualMode ? (
        <div className={styles.block}>
          <span className={styles.blockTitle}>
            {ro ? '学生的逐次置换选择与审计'
              : currentPage !== null ? `第 ${pending + 1} 次访问：页面 ${currentPage} —— 把它装入哪个物理块？` : '全部访问已处理完毕'}
          </span>
          {ro ? null : (
            <div className={styles.queue}>
              {Array.from({ length: framesCount }, (_, slot) => (
                <button
                  key={slot}
                  type="button"
                  className={styles.queueCell}
                  disabled={currentPage === null}
                  title={slots[slot] === null ? `块 ${slot + 1} 目前空闲` : `块 ${slot + 1} 现在装的是页面 ${slots[slot]}`}
                  onClick={() => setChoices((current) => [...current, slot])}
                >
                  块 {slot + 1} <small>{slots[slot] ?? '空'}</small>
                </button>
              ))}
              <button type="button" className={styles.queueCell} disabled={!choices.length}
                onClick={() => setChoices((current) => current.slice(0, -1))}>撤销一次</button>
              <button type="button" className={styles.queueCell} disabled={!choices.length}
                onClick={() => setChoices(() => [])}>重排</button>
            </div>
          )}
          <AuditIssues errors={manual.errors.map((error) => error.reason)} warnings={manual.warnings} />
          {manual.complete ? (
            <p className={styles.schedSummary}>
              完成：缺页 {manual.faults} 次 / 命中 {manual.hits} 次。
              {optFaults !== null ? `理论最优（OPT）为 ${optFaults} 次。` : ''}
            </p>
          ) : <p className={styles.schedSummary}>已处理 {manual.rows.length} / {reference.length} 次访问；全部处理完才能与内核算法对照。</p>}
          {divergence ? (
            <p className={styles.schedHint}>第 {divergence.index + 1} 次访问 {divergence.page}：你{divergence.manual}，OPT {divergence.reference}。</p>
          ) : manual.complete ? <p className={styles.schedHint}>你的逐次选择与 OPT 完全一致。</p> : null}
        </div>
      ) : null}
      <div className={styles.twoCols}>
        <div className={styles.block}>
          {manualMode ? (
            <>
              <span className={styles.blockTitle}>尚未访问的页面</span>
              <div className={styles.queue}>
                {reference.slice(manual.rows.length).length ? (
                  reference.slice(manual.rows.length).map((page, offset) => (
                    <span key={`${page}-${manual.rows.length + offset}`} className={styles.queueCell}
                      data-notready={offset > 0 || undefined}>{page}</span>
                  ))
                ) : <small>全部访问完毕</small>}
              </div>
              <span className={styles.blockTitle}>你的结果</span>
              <p className={styles.mono}>缺页 {manual.faults} 次 · 命中 {manual.hits} 次 · 已处理 {manual.rows.length}/{reference.length} 次访问</p>
            </>
          ) : (
            <>
              <span className={styles.blockTitle}>{read<string>(frame, 'aux_title', '') || '当前状态'}</span>
              <div className={styles.queue}>
                {aux.length ? aux.map((item) => <span key={item} className={styles.queueCell}>{item}</span>)
                  : <small>访问开始后显示算法的内部记录</small>}
              </div>
            </>
          )}
        </div>
        <CompareBars title={`${result.stats.frames_count} 个物理块 · 缺页次数对照`}
          values={manualMode && manual.complete ? { ...result.stats.compare, manual: manual.faults } : result.stats.compare}
          labels={manualMode && manual.complete ? { ...PAGE_LABELS, manual: '你的手动置换' } : PAGE_LABELS}
          current={manualMode && manual.complete ? 'manual' : result.algorithm} unit=" 次" />
      </div>
      <div className={styles.block}>
        <span className={styles.blockTitle}>
          工作集 W(t,Δ=<MathText text={String(result.stats.window ?? '')} />) · 最大 <MathText text={String(result.stats.max_working_set ?? '')} /> 页
          {result.stats.thrash ? ' · 可能抖动' : ''}
        </span>
        <div className={styles.queue}>
          {(read<string[]>(frame, 'working_set', []) as string[]).length
            ? read<string[]>(frame, 'working_set', []).map((page) => <span key={page} className={styles.queueCell}>{page}</span>)
            : <small>访问开始后显示最近 Δ 次访问涉及的页面</small>}
        </div>
      </div>
      <div className={styles.block}>
        <span className={styles.blockTitle}>{PAGE_LABELS[result.algorithm]?.split(' ')[1] ?? ''} · 缺页次数随物理块数的变化</span>
        <div className={styles.series}>
          {result.stats.series.slice(0, 8).map((item) => (
            <span key={item.frames} data-current={item.frames === framesCount || undefined}>
              <small><MathText text={String(item.frames ?? '')} /> 块</small>
              <b><MathText text={String(item.faults ?? '')} /></b>
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 磁盘调度                                                             */
/* ------------------------------------------------------------------ */

interface DiskManual { mode: boolean; picks: number[] }

function DiskCanvas({ result, frame, saved, onSave, readOnly }: {
  result: OsDiskResult; frame: OsFrame;
} & ManualChildProps): ReactNode {
  const [dm, setDm] = useManualState<DiskManual>(
    saved as DiskManual | undefined, onSave, { mode: false, picks: [] });
  const ro = readOnly === true;
  const manualMode = ro ? saved?.mode === true : dm.mode;
  const picks = dm.picks;
  const setPicks = (updater: (current: number[]) => number[]): void =>
    setDm((m) => ({ ...m, picks: updater(m.picks) }));
  const setManualMode = (mode: boolean): void => setDm((m) => ({ ...m, mode }));
  const full = result.stats.path;
  const requests = result.stats.requests;
  const head = result.stats.head;
  const kernelPath = read<number[]>(frame, 'path', [head]);
  const kernelRemaining = read<number[]>(frame, 'remaining', []);
  const kernelServed = read<number[]>(frame, 'served', []);
  const manual = useMemo(() => auditManualDiskOrder(head, requests, picks), [head, picks, requests]);
  const used = useMemo(() => new Set(manual.picks), [manual.picks]);
  const divergence = useMemo(() => firstDiskDivergence(manual.picks, requests, head, 'sstf'), [manual.picks, requests, head]);
  const remaining = manualMode ? requests.filter((_, index) => !used.has(index)) : kernelRemaining;
  const served = manualMode ? manual.served : kernelServed;
  const path = manualMode ? manual.path : kernelPath;
  const total = manualMode ? manual.total : Number(read(frame, 'total', 0));
  const max = Math.max(result.stats.max_track, 1);
  const width = 720;
  const left = 28;
  const right = 20;
  const rowH = 30;
  const height = 54 + Math.max(2, manualMode ? path.length : full.length) * rowH;
  const x = (position: number): number => left + (position / max) * (width - left - right);
  const y = (index: number): number => 40 + index * rowH;
  const points = (list: number[]): string => list.map((position, index) => `${x(position)},${y(index)}`).join(' ');
  const ticks = Array.from({ length: 6 }, (_, index) => Math.round((max / 5) * index));
  return (
    <>
      {ro ? null : (
        <ModeSwitch title="推演模式" manual={manualMode} onAuto={() => setManualMode(false)}
          onManual={() => setManualMode(true)} manualLabel="我来排服务顺序 ✋"
          hint="按你想要的顺序点选下一个要服务的磁道请求，轨迹与总移动实时累计。" />
      )}
      <div className={styles.block}>
        <span className={styles.blockTitle}>
          {manualMode ? `你的磁头轨迹 · 已服务 ${manual.served.length}/${requests.length} 个 · 累计 ${formatNumber(total)}${ro ? '（分享回放）' : ''}`
            : `磁头移动轨迹 · 累计 ${formatNumber(total)}`}
        </span>
        <svg viewBox={`0 0 ${width} ${height}`} className={styles.diskSvg} role="img" aria-label={manualMode ? '手动磁头移动轨迹图' : '磁头移动轨迹图'}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={x(tick)} x2={x(tick)} y1={26} y2={height - 10} className={styles.gridLine} />
              <text x={x(tick)} y={16} textAnchor="middle" className={styles.tickText}>{tick}</text>
            </g>
          ))}
          {requests.map((request, index) => (
            <circle key={`req-${index}`} cx={x(request)} cy={30} r={3.4}
              className={manualMode ? (used.has(index) ? styles.reqDone : styles.req)
                : kernelServed.includes(request) && kernelRemaining.indexOf(request) < 0 ? styles.reqDone : styles.req} />
          ))}
          {manualMode ? null : <polyline points={points(full)} className={styles.pathFuture} />}
          <polyline points={points(path)} className={manualMode ? styles.pathManual : styles.pathNow} />
          {path.map((position, index) => (
            <circle key={`p-${index}`} cx={x(position)} cy={y(index)} r={index === path.length - 1 ? 6 : 3.4}
              className={index === path.length - 1 ? styles.headDot : styles.pathDot} />
          ))}
          <text x={x(path[path.length - 1] ?? 0)} y={y(path.length - 1) - 10} textAnchor="middle" className={styles.headText}>
            {formatNumber(path[path.length - 1] ?? 0)}
          </text>
        </svg>
      </div>
      {manualMode ? (
        <div className={styles.block}>
          <span className={styles.blockTitle}>
            {ro ? '学生的服务顺序与审计'
              : manual.complete ? '全部请求服务完毕' : `点选下一个要服务的磁道（当前磁头在 ${formatNumber(path[path.length - 1] ?? head)}）`}
          </span>
          {ro ? null : (
            <div className={styles.queue}>
              {requests.map((value, index) => (
                <button
                  key={`req-${index}`}
                  type="button"
                  className={styles.queueCell}
                  disabled={used.has(index)}
                  title={used.has(index) ? `磁道 ${formatNumber(value)} 已服务` : `服务磁道 ${formatNumber(value)}`}
                  onClick={() => setPicks((current) => [...current, index])}
                >
                  {formatNumber(value)}
                </button>
              ))}
              <button type="button" className={styles.queueCell} disabled={!picks.length}
                onClick={() => setPicks((current) => current.slice(0, -1))}>撤销一个</button>
              <button type="button" className={styles.queueCell} disabled={!picks.length}
                onClick={() => setPicks(() => [])}>清空</button>
            </div>
          )}
          <AuditIssues errors={manual.errors} warnings={manual.complete ? [] : ['还有请求没有服务；全部点选完才能与内核算法对照。']} />
          {manual.complete ? (
            <p className={styles.schedSummary}>完成：总移动距离 {formatNumber(manual.total)}，平均寻道 {formatNumber(manual.total / Math.max(1, requests.length))}。</p>
          ) : null}
          {divergence ? (
            <p className={styles.schedHint}>第 {divergence.index + 1} 个服务：你选择磁道 {formatNumber(divergence.manual)}，SSTF 选择 {formatNumber(divergence.reference)}。</p>
          ) : manual.complete ? <p className={styles.schedHint}>你的服务顺序与 SSTF 完全一致。</p> : null}
        </div>
      ) : null}
      <div className={styles.twoCols}>
        <div className={styles.block}>
          <span className={styles.blockTitle}>尚未服务的请求</span>
          <div className={styles.queue}>
            {remaining.length ? remaining.map((value, index) => (
              <span key={`${value}-${index}`} className={styles.queueCell}>{formatNumber(value)}</span>
            )) : <small>全部服务完毕</small>}
          </div>
          <span className={styles.blockTitle}>已服务顺序</span>
          <p className={styles.mono}>{served.map((value) => formatNumber(value)).join(' → ') || '—'}</p>
        </div>
        <CompareBars title="同一请求序列 · 总移动距离对照"
          values={manualMode && manual.complete ? { ...result.stats.compare, manual: manual.total } : result.stats.compare}
          labels={manualMode && manual.complete ? { ...DISK_LABELS, manual: '你的手动顺序' } : DISK_LABELS}
          current={manualMode && manual.complete ? 'manual' : result.algorithm} unit="" />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 银行家算法                                                           */
/* ------------------------------------------------------------------ */

interface BankerManual { mode: boolean; picks: number[] }

function BankerCanvas({ result, frame, saved, onSave, readOnly }: {
  result: OsBankerResult; frame: OsFrame;
} & ManualChildProps): ReactNode {
  const [bm, setBm] = useManualState<BankerManual>(
    saved as BankerManual | undefined, onSave, { mode: false, picks: [] });
  const ro = readOnly === true;
  const manualMode = ro ? saved?.mode === true : bm.mode;
  const picks = bm.picks;
  const setPicks = (updater: (current: number[]) => number[]): void =>
    setBm((m) => ({ ...m, picks: updater(m.picks) }));
  const setManualMode = (mode: boolean): void => setBm((m) => ({ ...m, mode }));
  const names = result.stats.names;
  const state = result.stats.state;
  const manual = useMemo(
    () => auditManualBanker(state.available, state.allocation, state.need, picks, names),
    [names, picks, state.allocation, state.need, state.available],
  );
  const kernelRows = read<Record<string, unknown>[]>(frame, 'rows', []);
  const sequenceSoFar = result.frames.slice(0, frame.index + 1)
    .filter((item) => item.action === 'pick' && typeof item.values.picked === 'number')
    .map((item) => names[item.values.picked as number]!);
  const unsafeNow = frame.action === 'unsafe' || (frame.action === 'result' && !result.stats.safe);
  const kernelWork = read<number[]>(frame, 'work', []);
  const resources = read<string[]>(frame, 'resources', []);
  const picked = read<number | null>(frame, 'picked', null);
  const request = read<{ process: string; vector: number[] } | null>(frame, 'request', null);
  const vec = (values: number[]): string => values.map((value) => formatNumber(value)).join('  ');
  const work = manualMode ? manual.work : kernelWork;
  const rows = manualMode
    ? names.map((id, index) => ({ id, allocation: state.allocation[index]!, need: state.need[index]!, finished: manual.finished[index] }))
    : kernelRows;
  const stuck = manual.violation !== null;
  return (
    <>
      {ro ? null : (
        <ModeSwitch title="推演模式" manual={manualMode} onAuto={() => setManualMode(false)}
          onManual={() => setManualMode(true)} manualLabel="我来排安全序列 ✋"
          hint="依次点选一个此刻满足 Need ≤ Work 的进程；选错会指出缺口并中断。" />
      )}
      <div className={styles.block}>
        <span className={styles.blockTitle}>Work（可用资源）· 资源 {resources.join(' ')}</span>
        <div className={styles.workRow}>
          {work.map((value, index) => (
            <span key={index} className={styles.workCell}><small>{resources[index]}</small><b>{formatNumber(value)}</b></span>
          ))}
          {request ? <em>请求：{request.process} 要 ({vec(request.vector)})</em> : null}
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th>进程</th><th>Allocation</th><th>Need</th><th>状态</th></tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={String(row.id)}
                data-state={row.finished ? 'done'
                  : manualMode
                    ? (manual.violation?.name === String(row.id) || manual.duplicate?.name === String(row.id) ? 'invalid' : 'ready')
                    : picked === index ? 'running' : 'ready'}>
                <td>{String(row.id)}</td>
                <td className={styles.mono}>{vec(row.allocation as number[])}</td>
                <td className={styles.mono}>{vec(row.need as number[])}</td>
                <td><b>{row.finished ? '已完成'
                  : manualMode
                    ? (manual.violation?.name === String(row.id) ? 'Need > Work，无法完成'
                      : manual.duplicate?.name === String(row.id) ? '重复选入' : '等待')
                    : picked === index ? '本轮选中' : '等待'}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {manualMode ? (
        <div className={styles.block}>
          <span className={styles.blockTitle}>
            {ro ? '学生排出的序列与审计'
              : manual.safe ? '全部进程排完——你找到了一个安全序列'
                : stuck ? '序列中断：撤销一步重新选择'
                  : `第 ${picks.length + 1} 轮：点选一个 Need ≤ Work 的进程`}
          </span>
          {ro ? null : (
            <div className={styles.queue}>
              {names.map((name, index) => (
                <button
                  key={name}
                  type="button"
                  className={styles.queueCell}
                  disabled={manual.finished[index] || stuck || manual.safe}
                  title={`Need (${vec(state.need[index]!)}) · Allocation (${vec(state.allocation[index]!)})`}
                  onClick={() => setPicks((current) => [...current, index])}
                >
                  {name}
                </button>
              ))}
              <button type="button" className={styles.queueCell} disabled={!picks.length}
                onClick={() => setPicks((current) => current.slice(0, -1))}>撤销一步</button>
              <button type="button" className={styles.queueCell} disabled={!picks.length}
                onClick={() => setPicks(() => [])}>重排</button>
            </div>
          )}
          {manual.rows.length ? (
            <div className={styles.mono}>
              {manual.rows.map((row, index) => (
                <div key={index}>第 {index + 1} 轮：{row.name} 完成，Work ({vec(row.workBefore)}) → ({vec(row.workAfter)})</div>
              ))}
            </div>
          ) : null}
          {manual.violation ? (
            <p className={styles.schedSummary} role="alert">
              第 {manual.violation.step + 1} 轮选择 {manual.violation.name}：Need ({vec(manual.violation.need)}) 超过
              Work ({vec(manual.violation.work)})，还差 ({vec(manual.violation.deficient)})。
            </p>
          ) : null}
          <AuditIssues errors={manual.errors} warnings={manual.safe || manual.complete || stuck ? [] : ['序列还没有排完；安全序列必须包含全部进程。']} />
          {manual.safe ? (
            <p className={styles.schedHint}>
              你的安全序列：{manual.rows.map((row) => row.name).join(' → ')}。
              {result.stats.sequence && result.stats.sequence.join() !== manual.rows.map((row) => row.name).join()
                ? `内核给出的是另一个合法序列 ${result.stats.sequence.join(' → ')}；两种都对。`
                : '与内核给出的序列一致。'}
            </p>
          ) : null}
        </div>
      ) : (
        <div className={styles.block}>
          <span className={styles.blockTitle}>安全序列</span>
          <div className={styles.queue}>
            {sequenceSoFar.map((name, index) => (
              <span key={`${name}-${index}`} className={styles.queueCell}>{index + 1}. {name}</span>
            ))}
            {!sequenceSoFar.length ? <small>还没有进程被选中</small> : null}
            {unsafeNow ? <small>当前没有找到完整的安全序列</small> : null}
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 入口                                                                 */
/* ------------------------------------------------------------------ */

const KIND_TITLES: Record<string, string> = {
  cpu_schedule: 'CPU 调度', page_replace: '虚拟内存与页面置换', disk_schedule: '磁盘调度',
  banker: '银行家算法', os_basics: '操作系统基础', process_thread: '进程与线程', sync: '同步与互斥',
  deadlock: '死锁', memory_alloc: '连续内存分配', tlb: 'TLB 与访问性能',
  file_dir: '文件与目录', file_alloc: '文件存储与空间管理', device_mgmt: '磁盘与设备管理',
};

function genericText(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(' · ');
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function GenericOsCanvas({ frame }: { frame: OsFrame }): ReactNode {
  const entries = Object.entries(frame.values ?? {}).filter(([key]) => key !== 'reference');
  if (!entries.length) return null;
  return (
    <div className={styles.block}>
      <span className={styles.blockTitle}>当前状态</span>
      <div className={styles.mono}>
        {entries.map(([key, value]) => (
          <div key={key}><b>{key}</b>：{genericText(value)}</div>
        ))}
      </div>
    </div>
  );
}

function isPageResult(result: OsResult): result is OsPageResult {
  return result.osKind === 'page_replace' && 'frames_count' in result.stats;
}

export function OsCanvas({ result, step, selected, onSelect, manual, onManualChange, readOnly }: Props): ReactNode {
  const frame = result.frames[Math.max(0, Math.min(result.frames.length - 1, Math.round(step)))];
  if (!frame) return <div className={styles.empty} role="status">{result.reason || '等待核对题目数据。'}</div>;
  const slice = (key: string): ManualChildProps => ({
    saved: manual?.[key] as ManualChildProps['saved'],
    onSave: onManualChange ? (value) => onManualChange(key, value) : undefined,
    readOnly,
  });
  const page = isPageResult(result);
  const pageConcept = result.osKind === 'page_replace' && !page;
  const generic = pageConcept
    || !['cpu_schedule', 'page_replace', 'disk_schedule', 'banker'].includes(result.osKind);
  const algorithmLabel = generic ? ''
    : result.osKind === 'cpu_schedule' ? SCHED_LABELS[result.algorithm]
    : result.osKind === 'page_replace' ? PAGE_LABELS[result.algorithm]
      : result.osKind === 'disk_schedule' ? DISK_LABELS[result.algorithm] : '安全性算法';
  return (
    <section className={styles.canvas} aria-label={`${KIND_TITLES[result.osKind]}实验`}>
      <header className={styles.heading}>
        <strong>{KIND_TITLES[result.osKind]}{algorithmLabel ? ` · ${algorithmLabel}` : ''}</strong>
        <span><MathText text={String(result.headline ?? '')} /></span>
      </header>
      <div className={styles.layout}>
        <div className={styles.stage}>
          {result.osKind === 'cpu_schedule' ? <SchedCanvas result={result} frame={frame} selected={selected} onSelect={onSelect} {...slice('sched')} /> : null}
          {page ? <PageCanvas result={result} frame={frame} {...slice('page')} /> : null}
          {result.osKind === 'disk_schedule' ? <DiskCanvas result={result} frame={frame} {...slice('disk')} /> : null}
          {result.osKind === 'banker' ? <BankerCanvas result={result} frame={frame} {...slice('banker')} /> : null}
          {generic ? <GenericOsCanvas frame={frame} /> : null}
          <p className={styles.caption}><strong><MathText text={String(frame.label ?? '')} /></strong><MathText text={String(frame.detail ?? '')} /></p>
        </div>
        <aside className={styles.aside}>
          <Pseudocode result={result} frame={frame} />
          <ul className={styles.notes}>
            {result.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </aside>
      </div>
    </section>
  );
}

export default OsCanvas;

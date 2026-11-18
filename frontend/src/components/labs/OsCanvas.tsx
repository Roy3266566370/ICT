import { MathText } from './ProblemText';
import { useMemo, useState, type ReactNode } from 'react';
import { formatNumber } from '@/labs/expr';
import {
  auditManualSchedule,
  DISK_LABELS,
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

/* ------------------------------------------------------------------ */
/* CPU 调度                                                             */
/* ------------------------------------------------------------------ */

function SchedCanvas({ result, frame, selected, onSelect }: {
  result: OsSchedResult; frame: OsFrame; selected?: LabSelection | null; onSelect?: Props['onSelect'];
}): ReactNode {
  const [manualMode, setManualMode] = useState(false);
  const [timeline, setTimeline] = useState<(string | null)[]>([]);
  const [manualStep, setManualStep] = useState(1);
  const processes = result.stats.processes;
  const manual = useMemo(() => auditManualSchedule(processes, timeline, manualStep), [manualStep, processes, timeline]);
  const reference = useMemo(() => referenceScheduleGantt(processes, 'srtf', manualStep), [manualStep, processes]);
  const divergence = manual.complete ? firstScheduleDivergence(timeline, reference, manualStep) : null;
  const manualTime = Number((timeline.length * manualStep).toFixed(6));
  const earliestArrival = processes.length ? Math.min(...processes.map((process) => process.arrival)) : 0;
  const leadingIdle = (step: number): (string | null)[] =>
    Array.from({ length: Math.max(0, Math.ceil(earliestArrival / step - 1e-9)) }, () => null);
  const startManual = (): void => {
    setManualMode(true);
    setTimeline((current) => current.length ? current : leadingIdle(manualStep));
  };
  const changeStep = (step: number): void => {
    setManualStep(step);
    setTimeline(leadingIdle(step));
  };
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
  const span = Math.max(1e-9, makespan - start);
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
      <div className={styles.block}>
        <span className={styles.blockTitle}>调度模式</span>
        <div className={styles.queue}>
          <button type="button" className={styles.modeBtn} data-current={!manualMode || undefined} onClick={() => setManualMode(false)}>
            内核自动推演
          </button>
          <button type="button" className={styles.modeBtn} data-current={manualMode || undefined} onClick={startManual}>
            我来手动调度 ✋
          </button>
          {manualMode ? <small>每格 {formatNumber(manualStep)} 个时间单位；点击下方进程块填入当前时刻。</small> : null}
        </div>
      </div>
      <div className={styles.block}>
        <span className={styles.blockTitle}>
          {manualMode ? `手动甘特图 · 当前 t=${formatNumber(manualTime)}` : `甘特图 · t=${formatNumber(Number(read(frame, 'time', start)))}`}
        </span>
        <div className={styles.gantt} role="img" aria-label={manualMode ? '手动 CPU 甘特图' : 'CPU 甘特图'}>
          {full.map((seg, index) => (
            <div
              key={`${seg.start}-${index}`}
              className={styles.ganttSeg}
              data-state={manualMode ? (index === executed - 1 ? 'now' : 'done') : index < executed ? (index === executed - 1 ? 'now' : 'done') : 'future'}
              data-invalid={issueAt(seg) || undefined}
              style={{ left: `${pct(seg.start)}%`, width: `${pct(seg.end) - pct(seg.start)}%`, ['--seg' as string]: color(seg.id) }}
              title={`${seg.id ?? '空闲'}：${formatNumber(seg.start)}–${formatNumber(seg.end)}${issueAt(seg) ? '（非法调度）' : ''}${manualMode ? ' · 点击从此时刻重新调度' : ''}`}
              onClick={manualMode ? () => setTimeline((current) => current.slice(0, Math.max(0, Math.round(seg.start / manualStep)))) : undefined}
            >
              <span>{seg.id ?? '空闲'}</span>
            </div>
          ))}
        </div>
        <div className={styles.ganttAxis}>
          {[...full.map((seg) => seg.start), makespan].map((time, index) => {
            const left = pct(time);
            const show = left - lastLabel >= 4;
            if (show) lastLabel = left;
            return show ? <span key={`${time}-${index}`} style={{ left: `${left}%` }}>{formatNumber(time)}</span> : null;
          })}
        </div>
      </div>
      {manualMode ? (
        <div className={styles.block}>
          <span className={styles.blockTitle}>手动调度 · 点击进程填入 t={formatNumber(manualTime)}</span>
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
                title={`到达 ${formatNumber(row.arrival)}，服务 ${formatNumber(row.burst)}，剩余 ${formatNumber(row.remaining)}`}
                onClick={() => setTimeline((current) => [...current, row.id])}
              >
                {row.id} <small>{row.finish !== null ? '已完成' : `剩 ${formatNumber(row.remaining)}`}</small>
              </button>
            ))}
            <button type="button" className={styles.queueCell} onClick={() => setTimeline((current) => [...current, null])}>空闲</button>
            <button type="button" className={styles.queueCell} disabled={!timeline.length} onClick={() => setTimeline((current) => current.slice(0, -1))}>撤销一格</button>
            <button type="button" className={styles.queueCell} disabled={!timeline.length} onClick={() => setTimeline([])}>清空</button>
          </div>
          {manual.errors.length ? (
            <ul className={styles.schedIssues} role="alert">
              {manual.errors.map((error, index) => <li key={`${error.time}-${index}`}>{error.reason}</li>)}
            </ul>
          ) : null}
          {manual.warnings.length ? (
            <ul className={styles.schedWarnings}>
              {manual.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : null}
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

function PageCanvas({ result, frame }: { result: OsPageResult; frame: OsFrame }): ReactNode {
  const reference = read<string[]>(frame, 'reference', []);
  const cursor = read<number>(frame, 'cursor', -1);
  const framesCount = result.stats.frames_count;
  const aux = read<string[]>(frame, 'aux', []);
  const columns = reference.map((page, index) => {
    const source = result.frames[index + 1];
    return { page, index, state: source?.values.frames as (string | null)[], hit: source?.values.hit as boolean | null,
      slot: source?.values.slot as number | null, evicted: source?.values.evicted as string | null };
  });
  return (
    <>
      <div className={styles.block}>
        <span className={styles.blockTitle}>
          访问序列与物理块 · 缺页 {String(read(frame, 'faults', 0))} 次 / 命中 {String(read(frame, 'hits', 0))} 次
        </span>
        {result.stats.initial_frames.length ? (
          <p className={styles.mono}>初始已装入：<MathText text={String(result.stats.initial_frames.join('、') ?? '')} />（对它们的首次访问按命中计）</p>
        ) : null}
        <div className={styles.pageScroll}>
          <table className={styles.pageTable} aria-label="页面置换过程表">
            <thead>
              <tr>
                <th>访问</th>
                {columns.map((column) => (
                  <th key={column.index} data-now={column.index === cursor || undefined} data-future={column.index > cursor || undefined}>
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
                    const visible = column.index <= cursor;
                    const value = visible ? column.state[slot] : null;
                    const changed = visible && column.slot === slot && column.hit === false;
                    return (
                      <td key={column.index} data-changed={changed || undefined} data-now={column.index === cursor || undefined}
                        data-hit={visible && column.hit && column.slot === slot ? true : undefined}>
                        {visible ? value ?? '' : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className={styles.pageResult}>
                <th>结果</th>
                {columns.map((column) => (
                  <td key={column.index} data-fault={column.index <= cursor && column.hit === false ? true : undefined}
                    data-ok={column.index <= cursor && column.hit === true ? true : undefined}>
                    {column.index > cursor ? '' : column.hit ? '命中' : column.evicted !== null ? `换出 ${column.evicted}` : '缺页'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className={styles.twoCols}>
        <div className={styles.block}>
          <span className={styles.blockTitle}>{read<string>(frame, 'aux_title', '') || '当前状态'}</span>
          <div className={styles.queue}>
            {aux.length ? aux.map((item) => <span key={item} className={styles.queueCell}>{item}</span>)
              : <small>访问开始后显示算法的内部记录</small>}
          </div>
        </div>
        <CompareBars title={`${result.stats.frames_count} 个物理块 · 缺页次数对照`} values={result.stats.compare}
          labels={PAGE_LABELS} current={result.algorithm} unit=" 次" />
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

function DiskCanvas({ result, frame }: { result: OsDiskResult; frame: OsFrame }): ReactNode {
  const full = result.stats.path;
  const path = read<number[]>(frame, 'path', [result.stats.head]);
  const remaining = read<number[]>(frame, 'remaining', []);
  const served = read<number[]>(frame, 'served', []);
  const max = Math.max(result.stats.max_track, 1);
  const width = 720;
  const left = 28;
  const right = 20;
  const rowH = 30;
  const height = 54 + Math.max(2, full.length) * rowH;
  const x = (position: number): number => left + (position / max) * (width - left - right);
  const y = (index: number): number => 40 + index * rowH;
  const points = (list: number[]): string => list.map((position, index) => `${x(position)},${y(index)}`).join(' ');
  const ticks = Array.from({ length: 6 }, (_, index) => Math.round((max / 5) * index));
  return (
    <>
      <div className={styles.block}>
        <span className={styles.blockTitle}>
          磁头移动轨迹 · 累计 {formatNumber(Number(read(frame, 'total', 0)))}
        </span>
        <svg viewBox={`0 0 ${width} ${height}`} className={styles.diskSvg} role="img" aria-label="磁头移动轨迹图">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={x(tick)} x2={x(tick)} y1={26} y2={height - 10} className={styles.gridLine} />
              <text x={x(tick)} y={16} textAnchor="middle" className={styles.tickText}>{tick}</text>
            </g>
          ))}
          {result.stats.requests.map((request, index) => (
            <circle key={`req-${index}`} cx={x(request)} cy={30} r={3.4}
              className={served.includes(request) && remaining.indexOf(request) < 0 ? styles.reqDone : styles.req} />
          ))}
          <polyline points={points(full)} className={styles.pathFuture} />
          <polyline points={points(path)} className={styles.pathNow} />
          {path.map((position, index) => (
            <circle key={`p-${index}`} cx={x(position)} cy={y(index)} r={index === path.length - 1 ? 6 : 3.4}
              className={index === path.length - 1 ? styles.headDot : styles.pathDot} />
          ))}
          <text x={x(path[path.length - 1] ?? 0)} y={y(path.length - 1) - 10} textAnchor="middle" className={styles.headText}>
            {formatNumber(path[path.length - 1] ?? 0)}
          </text>
        </svg>
      </div>
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
        <CompareBars title="同一请求序列 · 总移动距离对照" values={result.stats.compare} labels={DISK_LABELS}
          current={result.algorithm} unit="" />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 银行家算法                                                           */
/* ------------------------------------------------------------------ */

function BankerCanvas({ result, frame }: { result: OsBankerResult; frame: OsFrame }): ReactNode {
  const rows = read<Record<string, unknown>[]>(frame, 'rows', []);
  const names = result.stats.names;
  const sequenceSoFar = result.frames.slice(0, frame.index + 1)
    .filter((item) => item.action === 'pick' && typeof item.values.picked === 'number')
    .map((item) => names[item.values.picked as number]!);
  const unsafeNow = frame.action === 'unsafe' || (frame.action === 'result' && !result.stats.safe);
  const work = read<number[]>(frame, 'work', []);
  const resources = read<string[]>(frame, 'resources', []);
  const picked = read<number | null>(frame, 'picked', null);
  const request = read<{ process: string; vector: number[] } | null>(frame, 'request', null);
  const vec = (values: number[]): string => values.map((value) => formatNumber(value)).join('  ');
  return (
    <>
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
              <tr key={String(row.id)} data-state={row.finished ? 'done' : picked === index ? 'running' : 'ready'}>
                <td>{String(row.id)}</td>
                <td className={styles.mono}>{vec(row.allocation as number[])}</td>
                <td className={styles.mono}>{vec(row.need as number[])}</td>
                <td><b>{row.finished ? '已完成' : picked === index ? '本轮选中' : '等待'}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

export function OsCanvas({ result, step, selected, onSelect }: Props): ReactNode {
  const frame = result.frames[Math.max(0, Math.min(result.frames.length - 1, Math.round(step)))];
  if (!frame) return <div className={styles.empty} role="status">{result.reason || '等待核对题目数据。'}</div>;
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
          {result.osKind === 'cpu_schedule' ? <SchedCanvas result={result} frame={frame} selected={selected} onSelect={onSelect} /> : null}
          {page ? <PageCanvas result={result} frame={frame} /> : null}
          {result.osKind === 'disk_schedule' ? <DiskCanvas result={result} frame={frame} /> : null}
          {result.osKind === 'banker' ? <BankerCanvas result={result} frame={frame} /> : null}
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

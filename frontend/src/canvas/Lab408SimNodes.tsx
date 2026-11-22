import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { NodeBodyProps } from './nodes.tsx';
import type { NodeType } from './types.ts';
import type { Manual408SubjectId } from '@/labs/manual408';
import { errorMessage } from '@/api/client';
import { evaluateLab408, type Lab408Evaluation } from '@/api/labs';
import {
  cacheTraceFrames,
  cpuScheduleFrames,
  parseInstructionList,
  parseProcessTable,
  parseTcpEvents,
  pipelineFrames,
  tcpCongestionFrames,
} from './lab408Sim.ts';
import styles from './lab408.module.css';

const ADDRESS_BITS = [24, 28, 32, 36, 40, 48] as const;
const BLOCK_BYTES = [8, 16, 32, 64, 128, 256] as const;
const CACHE_KB = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512] as const;
const WAYS = [1, 2, 4, 8, 16] as const;
const CPU_ALGOS = ['FCFS', 'SJF', 'SRTF', 'RR'] as const;
const GANTT_COLORS = ['#4F46E5', '#B8431F', '#1F7A3D', '#8A6D3B', '#3B6EA5', '#7B4FA0'] as const;

const CACHE_TEXT = '0x0, 0x40, 0x80, 0x0, 0x1000, 0x1040, 0x2000, 0x0';
const PIPELINE_TEXT = 'ADD R1,R2,R3\nSUB R4,R1,R5\nLW R6,0(R7)\nADD R8,R6,R9';
const CPU_TEXT = 'P1:0:5\nP2:1:3\nP3:2:1';
const TCP_TEXT = 'ack, ack, ack, ack, 3ack, timeout';

const roundInt = (value: number | undefined, fallback: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value ?? fallback)));

const fixed2 = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : '—');

function useFrameState(total: number): {
  index: number;
  playing: boolean;
  onIndex: (next: number) => void;
  onPlaying: (next: boolean) => void;
} {
  const [rawIndex, setRawIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = Math.max(0, total - 1);
  return {
    index: Math.max(0, Math.min(last, rawIndex)),
    playing,
    onIndex: next => setRawIndex(Math.max(0, Math.min(last, Math.round(next)))),
    onPlaying: setPlaying,
  };
}

export function Timeline(props: {
  total: number;
  index: number;
  playing: boolean;
  onIndex: (next: number) => void;
  onPlaying: (next: boolean) => void;
}): JSX.Element {
  const { total, index, playing, onIndex, onPlaying } = props;
  const last = Math.max(0, total - 1);
  const disabled = total <= 0;
  // 播放推进只依赖 total/playing，回调走 ref，避免每次父渲染重置定时器
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    if (!props.playing || props.total <= 0) return undefined;
    const timer = setInterval(() => {
      const current = latest.current;
      const end = Math.max(0, current.total - 1);
      if (current.index >= end) {
        current.onPlaying(false);
        return;
      }
      current.onIndex(current.index + 1);
    }, 700);
    return () => clearInterval(timer);
  }, [props.playing, props.total]);
  return (
    <div className={styles.timeline} data-timeline="1">
      <button type="button" className={styles.timelineBtn} aria-label="上一步" disabled={disabled}
        onClick={() => onIndex(Math.max(0, index - 1))}>◀</button>
      <button type="button" className={styles.timelineBtn} aria-label={playing ? '暂停' : '播放'} disabled={disabled}
        onClick={() => onPlaying(!playing)}>{playing ? '⏸' : '▶'}</button>
      <button type="button" className={styles.timelineBtn} aria-label="下一步" disabled={disabled}
        onClick={() => onIndex(Math.min(last, index + 1))}>▶</button>
      <button type="button" className={styles.timelineBtn} aria-label="重置" disabled={disabled}
        onClick={() => { onPlaying(false); onIndex(0); }}>↺</button>
      <span className={styles.timelineCount}>{index + 1}/{total}</span>
    </div>
  );
}

/** 把沙盘参数与简短输入拼成可被 evaluateLab408 解析的完整题干。 */
export function lab408Prompt(nodeType: NodeType, params: Record<string, number>, text: string): string {
  const t = text.trim();
  const int = (key: string, fallback: number): number => Math.round(params[key] ?? fallback);
  switch (nodeType) {
    case 'cacheSimLab':
      return `某 ${int('addrBits', 32)} 位计算机，Cache 数据区 ${int('cacheKB', 64)} KB，主存块 ${int('blockBytes', 64)} B，${int('ways', 4)} 路组相联。访问地址序列（十六进制）：${t}。求地址的 tag/index/offset 位段划分、逐次命中与 LRU 替换过程、命中率。`;
    case 'pipelineLab':
      return `5 级流水线 IF/ID/EX/MEM/WB，指令序列：\n${t}\n${int('forwarding', 1) ? '采用转发' : '不采用转发'}，画出时空图，指出 RAW 冲突、停顿周期与总周期数。`;
    case 'ieee754Lab':
      return `将 ${t} 表示为 IEEE 754 ${int('bits', 32)} 位浮点数，写出符号位、阶码（含偏移）、尾数与实际值。`;
    case 'cpuScheduleLab': {
      const algo = CPU_ALGOS[Math.max(0, Math.min(3, int('algo', 0)))] ?? 'FCFS';
      return `进程表（进程:到达时间:运行时间）：\n${t}\n采用 ${algo} 调度${algo === 'RR' ? `，时间片 ${int('quantum', 2)}` : ''}，求甘特图、各进程完成/周转/带权周转时间与平均值。`;
    }
    case 'bankerLab':
      return `银行家算法，可用资源、分配矩阵与需求矩阵如下：\n${t}\n判断系统是否安全，给出安全序列；若不安全，说明哪个进程无法满足。`;
    case 'tcpCongestionLab':
      return `TCP Reno 拥塞控制，初始 ssthresh=${int('ssthresh', 8)}，每个 RTT 的事件序列：${t}。写出每个 RTT 的 cwnd、ssthresh 与所处阶段（慢开始/拥塞避免/快恢复）。`;
    case 'slidingWindowLab': {
      const mode = int('mode', 0) === 1 ? '选择重传 SR' : '后退 N 帧 GBN';
      return `${mode} 滑动窗口，发送窗口大小 ${int('winSize', 4)}，丢帧序号：${t}。画出窗口推进、ACK 与超时重传的帧序列。`;
    }
    case 'dsStepLab': {
      const modes = ['二叉树的先序/中序/后序/层序遍历', 'KMP 字符串匹配', '快速排序与堆排序', 'Dijkstra 单源最短路径'];
      return `数据结构步进题：${modes[Math.max(0, Math.min(3, int('mode', 0)))]}。给定输入：${t || '使用画布中的默认示例'}。写出每一步的访问/比较/松弛过程与最终结果。`;
    }
    case 'dsTraversal':
      return `对一棵 6 节点二叉树（根 A，左子树 B，右子树 C；B 的左右孩子 D、E；C 的右孩子 F），写出${['先序', '中序', '后序', '层序'][Math.max(0, Math.min(3, int('order', 0)))]}遍历序列，并说明每一步的栈或队列状态。`;
    case 'pageReplace':
      return `页面置换：物理块数 ${int('capacity', 3)}，算法 ${int('algorithm', 0) === 1 ? 'LRU' : 'FIFO'}，页面访问序列 ${t || '3, 2, 1, 0, 3, 2, 4, 3, 2, 1'}。求每次访问的命中/缺页、被淘汰页面与缺页率。`;
    case 'ipSubnet':
      return `给定 192.168.1.0/24，划分为 /${int('prefix', 26)} 子网，取第 ${int('index', 0) + 1} 个。求子网掩码（二进制与点分十进制）、网络号、广播地址、可用主机范围与子网在 /24 中的地址占比。`;
    case 'cacheSplit':
      return `${int('addrBits', 32)} 位地址，主存块 ${int('blockBytes', 64)} B，Cache 数据区 ${int('cacheKB', 64)} KB，${int('ways', 4)} 路组相联。求 tag、index、offset 各占多少位，并写出每组行数。`;
    default:
      return t;
  }
}

export function CheckOriginalButton(props: {
  subject: Manual408SubjectId;
  text: string;
  nodeType?: NodeType;
  params?: Record<string, number>;
}): JSX.Element {
  const { subject, text, nodeType, params } = props;
  const prompt = nodeType ? lab408Prompt(nodeType, params ?? {}, text) : text;
  const [result, setResult] = useState<Lab408Evaluation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const check = async (): Promise<void> => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      setError('请先填写题目原文');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await evaluateLab408({ text: trimmed, subject }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.check}>
      <button type="button" className={styles.checkBtn} disabled={busy} onClick={() => void check()}>
        {busy ? '核对中…' : '按此参数核对原题'}
      </button>
      {nodeType ? <details className={styles.note}><summary>查看将提交的题干</summary><p>{prompt}</p></details> : null}
      {error ? <p className={styles.error} role="status">{error}</p> : null}
      {result ? <div className={styles.answer} role="status">{result.answer || result.status}</div> : null}
    </div>
  );
}

function ParamSelect({ label, value, options, suffix, onChange }: {
  label: string;
  value: number;
  options: readonly number[];
  suffix?: string;
  onChange: (value: number) => void;
}): JSX.Element {
  return <label className={styles.field}>{label}
    <select className={styles.select} aria-label={label} value={options.includes(value) ? value : options[0] ?? value}
      onChange={event => onChange(Number(event.target.value))}>
      {options.map(option => <option key={option} value={option}>{option}{suffix ?? ''}</option>)}
    </select>
  </label>;
}

function Readout({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return <div className={styles.readout}><span>{label}</span>{value}</div>;
}

function SourceText({ label, value, rows, onChange }: {
  label: string;
  value: string;
  rows?: number;
  onChange: (text: string) => void;
}): JSX.Element {
  return <label className={styles.field}>{label}
    <textarea className={styles.simInput} aria-label={label} rows={rows ?? 3} spellCheck={false}
      value={value} onChange={event => onChange(event.target.value)} />
  </label>;
}

export function CacheSimBody({ node, onParams, onText }: NodeBodyProps): JSX.Element {
  const addrBits = roundInt(node.params.addrBits, 32, 24, 48);
  const blockBytes = roundInt(node.params.blockBytes, 64, 8, 256);
  const cacheKB = roundInt(node.params.cacheKB, 64, 1, 512);
  const ways = roundInt(node.params.ways, 4, 1, 16);
  const text = node.text ?? CACHE_TEXT;
  const player = cacheTraceFrames(addrBits, blockBytes, cacheKB, ways, text);
  const total = player.frames.length;
  const state = useFrameState(total);
  const frame = total > 0 ? player.frames[state.index] : undefined;
  const lines = frame ? frame.sets[frame.index] ?? [] : [];
  return (
    <div className={styles.stage} data-lab408="cacheSimLab">
      <div className={styles.paramRow}>
        <ParamSelect label="地址位数" value={addrBits} options={ADDRESS_BITS} suffix=" 位"
          onChange={value => onParams?.({ addrBits: value })} />
        <ParamSelect label="块大小" value={blockBytes} options={BLOCK_BYTES} suffix=" B"
          onChange={value => onParams?.({ blockBytes: value })} />
        <ParamSelect label="Cache 容量" value={cacheKB} options={CACHE_KB} suffix=" KB"
          onChange={value => onParams?.({ cacheKB: value })} />
        <ParamSelect label="相联路数" value={ways} options={WAYS} suffix=" 路"
          onChange={value => onParams?.({ ways: value })} />
      </div>
      <SourceText label="访存地址（十六进制，逗号分隔）" value={text} rows={2}
        onChange={next => onText?.(next)} />
      {frame ? <>
        <Timeline total={total} index={state.index} playing={state.playing}
          onIndex={state.onIndex} onPlaying={state.onPlaying} />
        <div className={styles.chipRow}>
          <span className={styles.chip}>{frame.addrHex}</span>
          <span className={styles.chip}>tag {frame.tag}</span>
          <span className={styles.chip}>index {frame.index}</span>
          <span className={styles.chip}>offset {frame.offset}</span>
          <span className={`${styles.chip} ${frame.hit ? styles.chipHit : styles.chipMiss}`}>{frame.hit ? '命中' : '缺失'}</span>
        </div>
        <div className={styles.readoutGrid}>
          <Readout label="命中" value={<b data-readout="hits">{frame.hits}</b>} />
          <Readout label="缺失" value={<b data-readout="misses">{frame.misses}</b>} />
          <Readout label="命中率" value={<b>{fixed2((frame.hits / Math.max(1, frame.hits + frame.misses)) * 100)}%</b>} />
          <Readout label="换出 way" value={<b>{frame.evictedWay ?? '—'}</b>} />
        </div>
        <div className={styles.setCard}>
          <div className={styles.setTitle}>组 {frame.index} 的 {ways} 路</div>
          {lines.map((line, way) => (
            <div key={way}
              className={`${styles.setLine} ${frame.way === way ? styles.setLineOn : ''} ${frame.evictedWay === way ? styles.setEvicted : ''}`}>
              <span>way {way}</span>
              <span>tag {line.tag}</span>
              <span>{line.valid ? '有效' : '空闲'}</span>
              <span>lru {line.lru}</span>
            </div>
          ))}
        </div>
        <p className={styles.note}>{player.summary}{player.note ? ` · ${player.note}` : ''}</p>
</> : <p className={styles.warn}>{player.summary || '没有可解析的访存地址'}</p>}

      <CheckOriginalButton subject="computer_organization" text={text} nodeType="cacheSimLab" params={node.params} />
    </div>
  );
}

export function PipelineBody({ node, onParams, onText }: NodeBodyProps): JSX.Element {
  const forwarding = roundInt(node.params.forwarding, 1, 0, 1) === 1;
  const text = node.text ?? PIPELINE_TEXT;
  const instructions = parseInstructionList(text);
  const player = pipelineFrames(instructions, forwarding);
  const total = player.frames.length;
  const state = useFrameState(total);
  const frame = total > 0 ? player.frames[state.index] : undefined;
  const active = frame ?? player.frames[player.frames.length - 1];
  const cycles = active ? Math.max(0, active.stages.length - 1) : 0;
  return (
    <div className={styles.stage} data-lab408="pipelineLab">
      <label className={styles.field}>转发
        <input type="range" className={styles.slider} min={0} max={1} step={1} value={forwarding ? 1 : 0}
          aria-label="转发开关" onChange={event => onParams?.({ forwarding: Number(event.target.value) })} />
      </label>
      <SourceText label="指令序列（每行一条）" value={text} rows={4} onChange={next => onText?.(next)} />
      {total > 0 ? <>
        <Timeline total={total} index={state.index} playing={state.playing}
          onIndex={state.onIndex} onPlaying={state.onPlaying} />
        <table className={styles.pipeTable}>
          <thead><tr><th>指令</th>{Array.from({ length: cycles }, (_, c) => <th key={c}>{c + 1}</th>)}</tr></thead>
          <tbody>
            {instructions.map((instruction, i) => (
              <tr key={i}>
                <th>{instruction}</th>
                {Array.from({ length: cycles }, (_, c) => {
                  const stage = active?.stages[c + 1]?.[i] ?? null;
                  return <td key={c} className={stage ? styles.pipeCell : undefined}>{stage ?? ''}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.readoutGrid}>
          <Readout label="冲突" value={<b data-readout="conflicts">{active?.conflicts.length ?? 0}</b>} />
          <Readout label="停顿" value={<b data-readout="stalls">{active?.stalls.length ?? 0}</b>} />
          <Readout label="周期数" value={<b>{cycles}</b>} />
          <Readout label="排空" value={<b>{active?.drains ?? 0}</b>} />
        </div>
        {active && active.conflicts.length > 0 ? <ul className={styles.conflictList}>
          {active.conflicts.map((conflict, index) => <li key={index}>
            {instructions[conflict.a] ?? `#${conflict.a}`} → {instructions[conflict.b] ?? `#${conflict.b}`}：{conflict.register} RAW
          </li>)}
        </ul> : null}
        {active && active.stalls.length > 0
          ? <p className={styles.note}>停顿：{active.stalls.map(stall => `#${stall.instruction + 1}@${stall.cycle}`).join('、')}</p>
          : null}
        <p className={styles.note}>{player.summary}</p>
      </> : <p className={styles.warn}>{player.summary || '没有可解析的指令'}</p>}
      <CheckOriginalButton subject="computer_organization" text={text} nodeType="pipelineLab" params={node.params} />
    </div>
  );
}

export function CpuScheduleBody({ node, onParams, onText }: NodeBodyProps): JSX.Element {
  const algo = roundInt(node.params.algo, 0, 0, 3);
  const quantum = roundInt(node.params.quantum, 2, 1, 8);
  const text = node.text ?? CPU_TEXT;
  const processes = parseProcessTable(text);
  const player = cpuScheduleFrames(processes, CPU_ALGOS[algo] ?? 'FCFS', quantum);
  const total = player.frames.length;
  const state = useFrameState(total);
  const frame = total > 0 ? player.frames[state.index] : undefined;
  const gantt = frame?.gantt ?? player.gantt;
  const span = gantt.reduce((end, block) => Math.max(end, block.end), 0);
  const pids = processes.map(process => process.id);
  const totalTurnaround = player.metrics.length
    ? player.metrics.reduce((sum, item) => sum + item.turnaround, 0)
    : 0;
  return (
    <div className={styles.stage} data-lab408="cpuScheduleLab">
      <div className={styles.paramRow}>
        {CPU_ALGOS.map((label, index) => (
          <button key={label} type="button" className={styles.timelineBtn} aria-label={label} aria-pressed={algo === index}
            onClick={() => onParams?.({ algo: index })}>{label}</button>
        ))}
      </div>
      <label className={styles.field}>时间片 {quantum}
        <input type="range" className={styles.slider} min={1} max={8} step={1} value={quantum}
          aria-label="时间片" onChange={event => onParams?.({ quantum: Number(event.target.value) })} />
      </label>
      <SourceText label="进程表（pid:到达:运行）" value={text} rows={3}
        onChange={next => onText?.(next)} />
      {total > 0 ? <>
        <Timeline total={total} index={state.index} playing={state.playing}
          onIndex={state.onIndex} onPlaying={state.onPlaying} />
        <div className={styles.gantt} aria-label="CPU 调度甘特图">
          {gantt.map((block, index) => (
            <div key={`${block.pid}-${index}`} className={styles.ganttBlock}
              style={{
                width: `${span > 0 ? ((block.end - block.start) / span) * 100 : 0}%`,
                background: GANTT_COLORS[Math.max(0, pids.indexOf(block.pid)) % GANTT_COLORS.length],
              }}>
              {block.pid}
            </div>
          ))}
        </div>
        <div className={styles.chipRow}>
          <span className={styles.chip}>t = {frame?.tick ?? 0}</span>
          <span className={styles.chip}>运行 {frame?.running ?? '空闲'}</span>
          <span className={styles.chip}>就绪 {frame?.ready.length ? frame.ready.join('、') : '—'}</span>
        </div>
        <div className={styles.readoutGrid}>
          <Readout label="平均周转" value={<b data-readout="avgTurnaround">{fixed2(player.avgTurnaround)}</b>} />
          <Readout label="平均带权" value={<b data-readout="avgWeighted">{fixed2(player.avgWeighted)}</b>} />
          <Readout label="完工时刻" value={<b>{span}</b>} />
          <Readout label="周转合计" value={<b>{totalTurnaround}</b>} />
        </div>
        <p className={styles.note}>{player.summary}</p>
      </> : <p className={styles.warn}>{player.summary || '没有可解析的进程表'}</p>}
      <CheckOriginalButton subject="operating_system" text={text} nodeType="cpuScheduleLab" params={node.params} />
    </div>
  );
}

export function TcpCongestionBody({ node, onParams, onText }: NodeBodyProps): JSX.Element {
  const ssthresh = roundInt(node.params.ssthresh, 8, 1, 32);
  const text = node.text ?? TCP_TEXT;
  const player = tcpCongestionFrames(ssthresh, parseTcpEvents(text));
  const total = player.frames.length;
  const state = useFrameState(total);
  const frame = total > 0 ? player.frames[state.index] : undefined;
  const peak = Math.max(ssthresh, ...player.frames.map(item => item.cwnd), 1);
  const W = 320;
  const H = 110;
  const px = (rtt: number): number => 12 + (rtt / Math.max(1, total)) * (W - 24);
  const py = (cwnd: number): number => H - 10 - (cwnd / peak) * (H - 26);
  const points = player.frames.map(item => `${px(item.rtt)},${py(item.cwnd)}`).join(' ');
  return (
    <div className={styles.stage} data-lab408="tcpCongestionLab">
      <label className={styles.field}>慢开始门限 ssthresh {ssthresh}
        <input type="range" className={styles.slider} min={1} max={32} step={1} value={ssthresh}
          aria-label="慢开始门限" onChange={event => onParams?.({ ssthresh: Number(event.target.value) })} />
      </label>
      <SourceText label="事件序列（ack / 3ack / timeout）" value={text} rows={2}
        onChange={next => onText?.(next)} />
      {total > 0 ? <>
        <Timeline total={total} index={state.index} playing={state.playing}
          onIndex={state.onIndex} onPlaying={state.onPlaying} />
        <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="TCP 拥塞窗口曲线">
          <line x1={12} y1={H - 10} x2={W - 6} y2={H - 10} stroke="#D5CCB9" />
          <line x1={12} y1={6} x2={12} y2={H - 10} stroke="#D5CCB9" />
          <line x1={12} y1={py(ssthresh)} x2={W - 6} y2={py(ssthresh)} stroke="#B8431F" strokeDasharray="4 3" strokeWidth={1} />
          <polyline points={points} fill="none" stroke="#4F46E5" strokeWidth={1.6} strokeLinejoin="round" />
          {frame ? <circle cx={px(frame.rtt)} cy={py(frame.cwnd)} r={3} fill="#FF7A59" /> : null}
        </svg>
        <div className={styles.readoutGrid}>
          <Readout label="RTT" value={<b>{frame?.rtt ?? 0}</b>} />
          <Readout label="cwnd" value={<b data-readout="cwnd">{frame?.cwnd ?? 0}</b>} />
          <Readout label="ssthresh" value={<b data-readout="ssthresh">{frame?.ssthresh ?? ssthresh}</b>} />
          <Readout label="状态" value={<b>{frame?.state ?? '—'}</b>} />
        </div>
        <p className={styles.note}>{frame?.event ? `本帧事件：${frame.event} · ` : ''}{player.summary}</p>
      </> : <p className={styles.warn}>{player.summary || '没有可解析的事件'}</p>}
      <CheckOriginalButton subject="computer_network" text={text} nodeType="tcpCongestionLab" params={node.params} />
    </div>
  );
}
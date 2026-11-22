import { useEffect, useState } from 'react';
import type { NodeBodyProps } from './nodes.tsx';
import { CheckOriginalButton, Timeline } from './Lab408SimNodes.tsx';
import {
  bankerFrames,
  dsTraversalFrames,
  graphDijkstraFrames,
  ieee754Decode,
  kmpFrames,
  parseBankerText,
  parseSeqList,
  slidingWindowFrames,
  sortFrames,
  type BankerFrame,
  type GraphFrame,
  type KmpFrame,
  type SortFrame,
  type TreeFrame,
  type WindowFrame,
} from './lab408Sim.ts';
import { TRAVERSAL_LABELS, TREE_EDGES, TREE_VISUALS } from './lab408.ts';
import { fmt } from './math.ts';
import styles from './canvas.module.css';

const DS_MODE_LABELS = ['树遍历', 'KMP', '排序', 'Dijkstra'] as const;
const TREE_IDS = TREE_VISUALS.map(item => item.id);
const KMP_EXAMPLE = 'ABABABC|ABABC';
const SORT_EXAMPLE = '5,2,9,1,5,6';
const IEEE_EXAMPLE = '0x3fc00000';
const SEQ_EXAMPLE = '2';
const BANKER_EXAMPLE = 'available: 3,3,2\nallocation:\n0,1,0\n2,0,0\n3,0,2\n2,1,1\n0,0,2\nneed:\n7,4,3\n1,2,2\n6,0,0\n0,1,1\n4,3,1';
const GRAPH_EXAMPLE = {
  nodes: 6,
  edges: [
    [0, 1, 7], [0, 2, 9], [0, 5, 14], [1, 2, 10], [1, 3, 15],
    [2, 3, 11], [2, 5, 2], [3, 4, 6], [4, 5, 9],
  ] as const,
};
const CATEGORY_LABELS = { normal: '规格化', denorm: '非规格化', inf: '无穷', nan: 'NaN', zero: '零' } as const;
const EVENT_LABELS = { send: '发送', ack: '确认', timeout: '超时', drop: '丢帧' } as const;

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const raw = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, raw));
}

function TreeStepView({ frame }: { frame: TreeFrame }): JSX.Element {
  const positions = new Map(TREE_VISUALS.map(item => [item.id, item]));
  return <div>
    <svg className={styles.objSvg} viewBox="0 0 200 118" role="img" aria-label="步进二叉树遍历">
      {TREE_EDGES.map(([from, to]) => {
        const a = positions.get(from), b = positions.get(to);
        if (!a || !b) return null;
        return <line key={`${from}${to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#C9BFA8" strokeWidth={1.4} />;
      })}
      {TREE_VISUALS.map(item => {
        const visitOrder = frame.visited.indexOf(item.id);
        const active = frame.activeId === item.id;
        return <g key={item.id}>
          <circle cx={item.x} cy={item.y} r={13} fill="#F7F2E5" stroke={active ? '#B8431F' : '#B9AF98'} strokeWidth={active ? 3 : 1.2} />
          <text x={item.x} y={item.y + 1} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="#121B27">{item.id}</text>
          {visitOrder >= 0 ? <text x={item.x + 11} y={item.y - 7} textAnchor="middle" fontSize="8" fill="#B8431F" fontWeight={700}>{visitOrder + 1}</text> : null}
        </g>;
      })}
    </svg>
    <div className={styles.miniRead}>栈/队列：<b className={styles.mono} data-readout="stackOrQueue">{`[${frame.stackOrQueue.join(', ')}]`}</b></div>
  </div>;
}

function KmpStepView({ frame }: { frame: KmpFrame }): JSX.Element {
  return <div>
    <div className={styles.miniRead}>i = <b data-readout="i">{frame.i}</b> · j = <b data-readout="j">{frame.j}</b> · 命中 <b data-readout="matched">{frame.matched ? '是' : '否'}</b> · 位移 <b data-readout="shiftedBy">{frame.shiftedBy}</b></div>
    <div className={styles.miniRead}>next 前缀函数：<b className={styles.mono} data-readout="next">{`[${frame.next.join(', ')}]`}</b></div>
  </div>;
}

function SortStepView({ frame }: { frame: SortFrame }): JSX.Element {
  return <div>
    <div className={styles.readouts}>
      {frame.values.map((value, i) => {
        const settled = frame.sorted.includes(i);
        const mark = settled ? '定位' : frame.pivot === i ? '基准' : frame.compare?.includes(i) ? '比较' : frame.swap?.includes(i) ? '交换' : '';
        return <div key={i} className={styles.ro} style={mark ? { outline: '2px solid #B8431F' } : undefined}>
          <span>{i}{mark ? ` · ${mark}` : ''}</span><b>{value}</b>
        </div>;
      })}
    </div>
    <div className={styles.miniRead}>已定位 <b data-readout="sorted">{frame.sorted.length}</b> / {frame.values.length}{frame.heapEnd === null ? '' : ` · 堆尾 ${frame.heapEnd}`}</div>
  </div>;
}

function GraphStepView({ frame }: { frame: GraphFrame }): JSX.Element {
  return <div>
    <table className={styles.simTable}>
      <thead><tr><th>节点</th>{frame.dist.map((_, i) => <th key={i}>{i}</th>)}</tr></thead>
      <tbody>
        <tr>
          <th>dist</th>
          {frame.dist.map((value, i) => <td key={i} style={frame.active === i ? { fontWeight: 700, color: '#B8431F' } : undefined}>{value}</td>)}
        </tr>
        <tr><th>prev</th>{frame.prev.map((value, i) => <td key={i}>{value === null ? '—' : value}</td>)}</tr>
      </tbody>
    </table>
    <div className={styles.miniRead}>已确定 <b className={styles.mono} data-readout="visited">{`[${frame.visited.join(', ')}]`}</b> · 本轮松弛 <b data-readout="relaxed">{frame.relaxed === null ? '—' : frame.relaxed}</b></div>
  </div>;
}

export function DsStepBody({ node, onParams, onText }: NodeBodyProps): JSX.Element {
  const mode = clampInt(node.params.mode, 0, 0, 3);
  const order = clampInt(node.params.order, 0, 0, 3);
  const text = node.text ?? (mode === 1 ? KMP_EXAMPLE : mode === 2 ? SORT_EXAMPLE : '');
  const traversal = mode === 0 ? dsTraversalFrames(order, TREE_IDS) : null;
  const kmp = mode === 1 ? splitKmp(text) : null;
  const sort = mode === 2 ? sortFrames(parseSortValues(text), 'quicksort') : null;
  const graph = mode === 3 ? graphDijkstraFrames(GRAPH_EXAMPLE, 0) : null;
  const active = traversal ?? kmp ?? sort ?? graph;
  const total = active?.frames.length ?? 0;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const resetKey = `${mode}|${order}|${text}`;
  useEffect(() => { setIndex(0); setPlaying(false); }, [resetKey]);
  const cursor = total > 0 ? Math.min(index, total - 1) : 0;
  const frame = active?.frames[cursor];
  return <div data-lab408="dsStepLab">
    <div className={styles.presets}>
      {DS_MODE_LABELS.map((label, value) => <button key={label} type="button" aria-pressed={mode === value} onClick={() => onParams?.({ mode: value })}>{label}</button>)}
    </div>
    {mode === 0 ? <div className={styles.presets}>
      {TRAVERSAL_LABELS.map((label, value) => <button key={label} type="button" aria-pressed={order === value} onClick={() => onParams?.({ order: value })}>{label}</button>)}
    </div> : null}
    {mode === 1 || mode === 2 ? <label className={styles.inlineField}>{mode === 1 ? 'text|pattern' : '待排序序列'}
      <input className={styles.sequenceInput} aria-label="步进输入" value={text} onChange={event => onText?.(event.target.value)} />
    </label> : null}
    <div className={styles.miniRead}>{active?.summary ?? '暂无步进帧'}</div>
    <Timeline total={total} index={cursor} playing={playing} onIndex={setIndex} onPlaying={setPlaying} />
    {frame && traversal ? <TreeStepView frame={frame as TreeFrame} /> : null}
    {frame && kmp ? <KmpStepView frame={frame as KmpFrame} /> : null}
    {frame && sort ? <SortStepView frame={frame as SortFrame} /> : null}
    {frame && graph ? <GraphStepView frame={frame as GraphFrame} /> : null}
    <CheckOriginalButton subject="algorithm" text={text} nodeType="dsStepLab" params={node.params} />
  </div>;
}

function splitKmp(text: string): ReturnType<typeof kmpFrames> {
  const [rawText = '', rawPattern = ''] = text.split('|');
  return kmpFrames(rawText.trim(), rawPattern.trim());
}

function parseSortValues(text: string): number[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split(/[,\s;]+/).map(part => Number(part)).filter(value => Number.isFinite(value));
}

export function Ieee754Body({ node, onParams, onText }: NodeBodyProps): JSX.Element {
  const bits = node.params.bits === 64 ? 64 : 32;
  const text = node.text ?? IEEE_EXAMPLE;
  const result = ieee754Decode(text, bits);
  const expWidth = bits === 64 ? 11 : 8;
  const mantissaWidth = bits === 64 ? 52 : 23;
  return <div data-lab408="ieee754Lab">
    <div className={styles.presets}>
      {[32, 64].map(value => <button key={value} type="button" aria-pressed={bits === value} onClick={() => onParams?.({ bits: value })}>{value} 位</button>)}
    </div>
    <label className={styles.inlineField}>浮点表示
      <input className={styles.sequenceInput} aria-label="IEEE754 输入" value={text} onChange={event => onText?.(event.target.value)} />
    </label>
    <div className={styles.segBar} aria-label="IEEE754 位段划分">
      <span style={{ flex: 1, background: '#4F46E5' }}>S {result.signBit}</span>
      <span style={{ flex: expWidth, background: '#B8431F' }}>E {result.expBits}</span>
      <span style={{ flex: mantissaWidth, background: '#9AA3AF' }}>M {result.mantissaBits}</span>
    </div>
    <div className={styles.miniRead}><b className={styles.mono} data-readout="sign">{result.signBit}</b> | <b className={styles.mono} data-readout="exp">{result.expBits.toString(2).padStart(expWidth, '0')}</b> | <b className={styles.mono} data-readout="mantissa">{result.mantissaBits.toString(2).padStart(mantissaWidth, '0')}</b></div>
    <div className={styles.readouts}>
      <div className={styles.ro}><span>类别</span><b data-readout="category">{CATEGORY_LABELS[result.category]}</b></div>
      <div className={styles.ro}><span>实际值</span><b data-readout="value">{fmt(result.actualValue)}</b></div>
      <div className={styles.ro}><span>绝对误差</span><b data-readout="error">{result.error === null ? '精确' : fmt(result.error)}</b></div>
      <div className={styles.ro}><span>指数（去偏）</span><b data-readout="biasExp">{result.biasExp}</b></div>
    </div>
    <CheckOriginalButton subject="computer_organization" text={text} nodeType="ieee754Lab" params={node.params} />
  </div>;
}

function BankerStepView({ frame }: { frame: BankerFrame }): JSX.Element {
  return <div>
    <div className={styles.miniRead}>Work：<b className={styles.mono} data-readout="work">{`[${frame.work.join(', ')}]`}</b></div>
    <div className={styles.miniRead}>Finish：<b className={styles.mono} data-readout="finish">{frame.finish.map(value => (value ? 'T' : 'F')).join(' ')}</b> · 安全序列 <b className={styles.mono} data-readout="sequence">{`[${frame.sequence.join(', ')}]`}</b></div>
    <div className={styles.miniRead}>结论 <b data-readout="safe">{frame.safe ? '安全' : '不安全'}</b> · 试探 <b data-readout="trial">{frame.trial === null ? '—' : frame.trial}</b></div>
    <div className={styles.miniRead}>{frame.note}</div>
  </div>;
}

export function BankerBody({ node, onParams, onText }: NodeBodyProps): JSX.Element {
  const available0 = clampInt(node.params.available0, 3, 0, 9);
  const text = node.text ?? BANKER_EXAMPLE;
  const parsed = parseBankerText(text.trim() ? text : BANKER_EXAMPLE);
  const available = parsed.available.length > 0 ? [available0, ...parsed.available.slice(1)] : [available0];
  const player = bankerFrames(available, parsed.allocation, parsed.need);
  const total = player.frames.length;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const resetKey = `${available.join(',')}|${text}`;
  useEffect(() => { setIndex(0); setPlaying(false); }, [resetKey]);
  const cursor = total > 0 ? Math.min(index, total - 1) : 0;
  const frame = player.frames[cursor];
  return <div data-lab408="bankerLab">
    <label className={styles.inlineField}>可用资源 A
      <input type="range" className={styles.slider} min={0} max={9} step={1} value={available0} aria-label="可用资源 A" onChange={event => onParams?.({ available0: Number(event.target.value) })} />
    </label>
    <label className={styles.inlineField}>资源表
      <textarea className={styles.workbenchText} rows={8} aria-label="银行家资源表" value={text} onChange={event => onText?.(event.target.value)} />
    </label>
    <div className={styles.miniRead}>Available：<b className={styles.mono}>{`[${available.join(', ')}]`}</b></div>
    <table className={styles.simTable}>
      <thead><tr><th>进程</th><th>Allocation</th><th>Need</th></tr></thead>
      <tbody>
        {parsed.allocation.map((row, i) => <tr key={i}>
          <th>P{i}</th><td className={styles.mono}>{row.join(', ')}</td><td className={styles.mono}>{parsed.need[i]?.join(', ') ?? '—'}</td>
        </tr>)}
      </tbody>
    </table>
    <div className={styles.miniRead}>{player.summary}</div>
    <Timeline total={total} index={cursor} playing={playing} onIndex={setIndex} onPlaying={setPlaying} />
    {frame ? <BankerStepView frame={frame} /> : null}
    <CheckOriginalButton subject="operating_system" text={text} nodeType="bankerLab" params={node.params} />
  </div>;
}

function WindowStepView({ frame }: { frame: WindowFrame }): JSX.Element {
  return <div>
    <div className={styles.miniRead}>事件 <b data-readout="event">{EVENT_LABELS[frame.event]}</b> · 发送窗口 <b className={styles.mono} data-readout="sendWindow">{`[${frame.sendWindow.join(', ')}]`}</b></div>
    <div className={styles.miniRead}>接收窗口 <b className={styles.mono} data-readout="recvWindow">{`[${frame.recvWindow.join(', ')}]`}</b></div>
    <div className={styles.miniRead}>在途 <b className={styles.mono} data-readout="inFlight">{`[${frame.inFlight.join(', ')}]`}</b> · 已确认 <b className={styles.mono} data-readout="acked">{`[${frame.acked.join(', ')}]`}</b></div>
  </div>;
}

export function SlidingWindowBody({ node, onParams, onText }: NodeBodyProps): JSX.Element {
  const winSize = clampInt(node.params.winSize, 4, 1, 8);
  const mode = clampInt(node.params.mode, 0, 0, 1);
  const text = node.text ?? SEQ_EXAMPLE;
  const dropped = parseSeqList(text);
  const player = slidingWindowFrames(winSize, mode === 1 ? 'SR' : 'GBN', dropped);
  const total = player.frames.length;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const resetKey = `${winSize}|${mode}|${text}`;
  useEffect(() => { setIndex(0); setPlaying(false); }, [resetKey]);
  const cursor = total > 0 ? Math.min(index, total - 1) : 0;
  const frame = player.frames[cursor];
  return <div data-lab408="slidingWindowLab">
    <div className={styles.presets}>
      {(['GBN', 'SR'] as const).map((label, value) => <button key={label} type="button" aria-pressed={mode === value} onClick={() => onParams?.({ mode: value })}>{label}</button>)}
    </div>
    <label className={styles.inlineField}>窗口大小 {winSize}
      <input type="range" className={styles.slider} min={1} max={8} step={1} value={winSize} aria-label="窗口大小" onChange={event => onParams?.({ winSize: Number(event.target.value) })} />
    </label>
    <label className={styles.inlineField}>丢帧序号
      <input className={styles.sequenceInput} aria-label="丢帧序号" value={text} onChange={event => onText?.(event.target.value)} />
    </label>
    <div className={styles.miniRead}>{player.summary}</div>
    <Timeline total={total} index={cursor} playing={playing} onIndex={setIndex} onPlaying={setPlaying} />
    {frame ? <WindowStepView frame={frame} /> : null}
    <CheckOriginalButton subject="computer_network" text={text} nodeType="slidingWindowLab" params={node.params} />
  </div>;
}
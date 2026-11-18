import { useState } from 'react';
import type { NodeBodyProps } from './nodes.tsx';
import { fmt } from './math.ts';
import { MANUAL_408_SUBJECTS } from '@/labs/manual408';
import { errorMessage } from '@/api/client';
import { evaluateLab408, type Lab408Evaluation } from '@/api/labs';
import {
  PAGE_ALGORITHMS,
  PAGE_REFERENCE,
  TRAVERSAL_LABELS,
  TREE_EDGES,
  TREE_VISUALS,
  cacheSplit,
  pageReplacement,
  parseReference,
  subnetInfo,
  treeTraversal,
} from './lab408.ts';
import styles from './canvas.module.css';

const ADDRESS_BITS = [24, 28, 32, 36, 40, 48];
const BLOCK_BYTES = [8, 16, 32, 64, 128, 256];
const CACHE_KB = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
const WAYS = [1, 2, 4, 8, 16];

function ParamSelect({ label, value, options, suffix, onChange }: {
  label: string;
  value: number;
  options: readonly number[];
  suffix?: string;
  onChange: (value: number) => void;
}): JSX.Element {
  return <label className={styles.inlineField}>{label}
    <select aria-label={label} value={options.includes(value) ? value : options[0] ?? value} onChange={event => onChange(Number(event.target.value))}>
      {options.map(option => <option key={option} value={option}>{option}{suffix ?? ''}</option>)}
    </select>
  </label>;
}

export function DsTraversalBody({ node, onParams }: NodeBodyProps): JSX.Element {
  const order = Math.max(0, Math.min(3, Math.round(node.params.order ?? 0)));
  const sequence = treeTraversal(order);
  const visits = new Map(sequence.map((id, index) => [id, index + 1]));
  const positions = new Map(TREE_VISUALS.map(item => [item.id, item]));
  return <div>
    <div className={styles.presets}>
      {TRAVERSAL_LABELS.map((label, index) => <button key={label} type="button" aria-pressed={order === index} onClick={() => onParams?.({ order: index })}>{label}</button>)}
    </div>
    <svg className={styles.objSvg} viewBox="0 0 200 118" role="img" aria-label={`二叉树${TRAVERSAL_LABELS[order]}遍历`}>
      {TREE_EDGES.map(([from, to]) => {
        const a = positions.get(from), b = positions.get(to);
        if (!a || !b) return null;
        return <line key={`${from}${to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#C9BFA8" strokeWidth={1.4} />;
      })}
      {TREE_VISUALS.map(item => <g key={item.id}>
        <circle cx={item.x} cy={item.y} r={13} fill="#F7F2E5" stroke="#B9AF98" strokeWidth={1.2} />
        <text x={item.x} y={item.y + 1} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="#121B27">{item.id}</text>
        <text x={item.x + 11} y={item.y - 7} textAnchor="middle" fontSize="8" fill="#B8431F" fontWeight={700}>{visits.get(item.id)}</text>
      </g>)}
    </svg>
    <div className={styles.miniRead}>{TRAVERSAL_LABELS[order]}：<b className={styles.live}>{sequence.join(' → ')}</b></div>
  </div>;
}

export function CacheSplitBody({ node, onParams }: NodeBodyProps): JSX.Element {
  const addrBits = Math.round(node.params.addrBits ?? 32);
  const blockBytes = Math.round(node.params.blockBytes ?? 64);
  const cacheKB = Math.round(node.params.cacheKB ?? 64);
  const ways = Math.round(node.params.ways ?? 4);
  const result = cacheSplit(addrBits, blockBytes, cacheKB, ways);
  return <div>
    <div className={styles.fieldGrid}>
      <ParamSelect label="地址位数" value={addrBits} options={ADDRESS_BITS} suffix=" 位" onChange={value => onParams?.({ addrBits: value })} />
      <ParamSelect label="块大小" value={blockBytes} options={BLOCK_BYTES} suffix=" B" onChange={value => onParams?.({ blockBytes: value })} />
      <ParamSelect label="Cache 容量" value={cacheKB} options={CACHE_KB} suffix=" KB" onChange={value => onParams?.({ cacheKB: value })} />
      <ParamSelect label="相联路数" value={ways} options={WAYS} suffix=" 路" onChange={value => onParams?.({ ways: value })} />
    </div>
    {result.valid ? <>
      <div className={styles.segBar} aria-label="Cache 地址位段划分">
        {result.tag > 0 ? <span style={{ flex: result.tag, background: '#4F46E5' }}>tag {result.tag}</span> : null}
        {result.index > 0 ? <span style={{ flex: result.index, background: '#B8431F' }}>index {result.index}</span> : null}
        <span style={{ flex: result.offset, background: '#9AA3AF' }}>offset {result.offset}</span>
      </div>
      <div className={styles.readouts}>
        <div className={styles.ro}><span>块数</span><b>{result.blocks}</b></div>
        <div className={styles.ro}><span>组数</span><b>{result.sets}</b></div>
        <div className={styles.ro}><span>offset</span><b>{result.offset} 位</b></div>
        <div className={styles.ro}><span>index</span><b>{result.index} 位</b></div>
        <div className={styles.ro}><span>tag</span><b>{result.tag} 位</b></div>
        <div className={styles.ro}><span>地址合计</span><b>{addrBits} 位</b></div>
      </div>
    </> : <p className={styles.badRead}>{result.message}</p>}
  </div>;
}

export function PageReplaceBody({ node, onParams, onText }: NodeBodyProps): JSX.Element {
  const algorithm = Math.max(0, Math.min(2, Math.round(node.params.algorithm ?? 0)));
  const capacity = Math.max(1, Math.min(4, Math.round(node.params.capacity ?? 3)));
  const reference = parseReference(node.text);
  const result = pageReplacement(algorithm, capacity, reference);
  const name = PAGE_ALGORITHMS[algorithm] ?? 'FIFO';
  const fifo3 = pageReplacement(0, 3, reference).faults;
  const fifo4 = pageReplacement(0, 4, reference).faults;
  const note = algorithm === 0
    ? fifo4 > fifo3
      ? `FIFO 从 3 块增到 4 块：缺页 ${fifo3} → ${fifo4}，出现 Belady 异常。`
      : `FIFO 在本题序列上 3 块/4 块缺页为 ${fifo3}/${fifo4}，未出现 Belady 异常。`
    : algorithm === 1
      ? 'LRU 属栈式算法，增加物理块不会让缺页次数增加。'
      : 'OPT 预知未来访问，是缺页次数的理论下界。';
  return <div>
    <div className={styles.pageControls}>
      <div className={styles.presets}>
        {PAGE_ALGORITHMS.map((label, index) => <button key={label} type="button" aria-pressed={algorithm === index} onClick={() => onParams?.({ algorithm: index })}>{label}</button>)}
      </div>
      <label className={styles.inlineField}>物理块
        <select aria-label="物理块数" value={capacity} onChange={event => onParams?.({ capacity: Number(event.target.value) })}>
          {[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
    </div>
    <label className={styles.inlineField}>访问序列
      <input
        className={styles.sequenceInput}
        value={node.text ?? PAGE_REFERENCE.join(',')}
        aria-label="页面访问序列"
        onChange={event => onText?.(event.target.value)}
      />
    </label>
    <div className={styles.pageWrap}>
      <table className={styles.pageTable}>
        <thead><tr><th>访问</th>{result.steps.map((step, index) => <th key={index}>{step.page}</th>)}</tr></thead>
        <tbody>
          {Array.from({ length: capacity }, (_, slot) => <tr key={slot}>
            <th>{slot + 1}</th>
            {result.steps.map((step, index) => {
              const value = step.frames[slot];
              return <td key={index} className={step.fault && value === step.page ? styles.pageFault : undefined}>{value ?? '·'}</td>;
            })}
          </tr>)}
          <tr><th>缺页</th>{result.steps.map((step, index) => <td key={index} className={step.fault ? styles.pageFault : styles.pageHit}>{step.fault ? '×' : '·'}</td>)}</tr>
        </tbody>
      </table>
    </div>
    <div className={styles.miniRead}>{name}：缺页 <b className={styles.live}>{result.faults}</b> / {reference.length} 次 · 命中 {result.hits} 次 · {fmt(result.rate * 100, 1)}%</div>
    <div className={styles.miniRead}>{note}</div>
  </div>;
}

export function IpSubnetBody({ node, onParams }: NodeBodyProps): JSX.Element {
  const info = subnetInfo(node.params.prefix ?? 26, node.params.index ?? 0);
  const block = 2 ** (32 - info.prefix);
  return <div>
    <div className={styles.fieldGrid}>
      <ParamSelect label="前缀长度" value={info.prefix} options={[24, 25, 26, 27, 28, 29, 30]} suffix="" onChange={value => onParams?.({ prefix: value, index: Math.min(info.index, 2 ** (value - 24) - 1) })} />
      <label className={styles.inlineField}>子网序号 {info.index + 1}/{info.count}
        <input type="range" className={styles.slider} min={0} max={info.count - 1} step={1} value={info.index} aria-label="子网序号" onChange={event => onParams?.({ index: Number(event.target.value) })} />
      </label>
    </div>
    <div className={`${styles.readouts} ${styles.readoutsOne}`}>
      <div className={styles.ro}><span>网络地址</span><b className={styles.mono}>{info.network}</b></div>
      <div className={styles.ro}><span>广播地址</span><b className={styles.mono}>{info.broadcast}</b></div>
      <div className={styles.ro}><span>子网掩码</span><b className={styles.mono}>{info.mask}</b></div>
      <div className={styles.ro}><span>可用范围</span><b className={styles.mono}>{info.first} ～ {info.last}</b></div>
      <div className={styles.ro}><span>可用主机</span><b>{info.hosts}</b></div>
      <div className={styles.ro}><span>子网数</span><b>{info.count}</b></div>
    </div>
    <div className={styles.miniRead}>基于 192.168.1.0/24 · 每个子网 {block} 个地址</div>
  </div>;
}

export function Lab408WorkbenchBody({ node, onParams, onText }: NodeBodyProps): JSX.Element {
  const subjectIndex = Math.max(0, Math.min(MANUAL_408_SUBJECTS.length - 1, Math.round(node.params.subjectIndex ?? 0)));
  const subject = MANUAL_408_SUBJECTS[subjectIndex] ?? MANUAL_408_SUBJECTS[0]!;
  const flatTypes = subject.groups.flatMap(group => group.types);
  const typeIndex = Math.max(0, Math.min(Math.max(0, flatTypes.length - 1), Math.round(node.params.typeIndex ?? 0)));
  const selected = flatTypes[typeIndex] ?? flatTypes[0];
  const text = node.text ?? selected?.template ?? '';
  const [result, setResult] = useState<Lab408Evaluation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  let cursor = 0;
  const indexedGroups = subject.groups.map(group => ({
    label: group.label,
    types: group.types.map(type => ({ type, index: cursor++ })),
  }));

  const changeSubject = (value: number): void => {
    const next = MANUAL_408_SUBJECTS[value];
    if (!next) return;
    const first = next.groups[0]?.types[0];
    onParams?.({ subjectIndex: value, typeIndex: 0 });
    onText?.(first?.template ?? '');
    setResult(null);
    setError('');
  };

  const changeType = (value: number): void => {
    const next = flatTypes[value];
    if (!next) return;
    onParams?.({ typeIndex: value });
    onText?.(next.template);
    setResult(null);
    setError('');
  };

  const editText = (value: string): void => {
    onText?.(value);
    setResult(null);
    setError('');
  };

  const solve = async (): Promise<void> => {
    if (!text.trim()) {
      setError('请先选择题型或填写题目原文');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await evaluateLab408({ text: text.trim(), subject: subject.id }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return <div>
    <div className={styles.fieldGrid}>
      <label className={styles.inlineField}>科目
        <select aria-label="408 工作台科目" value={subjectIndex} disabled={busy} onChange={event => changeSubject(Number(event.target.value))}>
          {MANUAL_408_SUBJECTS.map((item, index) => <option key={item.id} value={index}>{item.label}</option>)}
        </select>
      </label>
      <label className={styles.inlineField}>题型
        <select aria-label="408 工作台题型" value={typeIndex} disabled={busy} onChange={event => changeType(Number(event.target.value))}>
          {indexedGroups.map(group => <optgroup key={group.label} label={group.label}>
            {group.types.map(item => <option key={item.type.id} value={item.index}>{item.type.label}</option>)}
          </optgroup>)}
        </select>
      </label>
    </div>
    <textarea className={styles.workbenchText} aria-label="408 工作台题目原文" rows={4} value={text} disabled={busy}
      onChange={event => editText(event.target.value)}
      placeholder="选择题型会填入完整模板；请按原题替换数据，保留全部条件。" />
    <div className={styles.workbenchActions}>
      <button type="button" className={styles.tbtn} disabled={busy || !selected}
        onClick={() => { if (selected) editText(selected.template); }}>恢复模板</button>
      <button type="button" className={styles.tbtn} disabled={busy || !text.trim()} onClick={() => void solve()}>
        {busy ? '内核求解中…' : '求解'}
      </button>
    </div>
    {error ? <p className={styles.workbenchError} role="status">{error}</p> : null}
    {result ? <div className={styles.workbenchResult}>
      <div className={`${styles.workbenchStatus} ${result.status === 'ready' ? styles.workbenchOk : styles.workbenchWarn}`}>
        {result.status === 'ready' ? '内核已计算' : '条件未完整'} · {selected?.label ?? result.kind ?? '408'}
      </div>
      {result.answer ? <div className={styles.workbenchAnswer}>{result.answer}</div> : null}
      {result.blocking.length > 0 ? <ul className={styles.workbenchList}>
        {result.blocking.map(item => <li key={item.id}>{item.question}</li>)}
      </ul> : null}
      {result.steps.length > 0 ? <ol className={styles.workbenchList}>
        {result.steps.slice(0, 4).map(step => <li key={step.id}><b>{step.title}</b>{step.detail ? `：${step.detail}` : ''}</li>)}
      </ol> : null}
      {result.limitations.length > 0 ? <details>
        <summary>限制与说明</summary>
        <ul className={styles.workbenchList}>{result.limitations.map(item => <li key={item}>{item}</li>)}</ul>
      </details> : null}
    </div> : <div className={styles.miniRead}>选择科目与题型后，按完整题目原文调用本地内核；缺失条件不会被补造。</div>}
  </div>;
}

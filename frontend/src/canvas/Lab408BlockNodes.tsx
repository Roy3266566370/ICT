import { useEffect, useState } from 'react';
import type { NodeBodyProps, NodeDef } from './nodes.tsx';
import type { NodeType, PortSpec } from './types.ts';
import {
  arrayFromParams,
  cacheMap,
  DEFAULT_GRAPH_TEXT,
  graphOf,
  memoryAddressStream,
  parseGraph,
  shortestPathSteps,
  sortRace,
  translateAddresses,
  type AlgoData,
  type GraphData,
} from './lab408Blocks.ts';
import {
  BarChart,
  BLOCK_COLORS,
  KpiRow,
  LineChart,
  Notice,
  RangeControl,
  SelectControl,
} from './BlockPrimitives.tsx';
import styles from './blocks.module.css';

const algoOut = (label: string): PortSpec => ({ id: 'out', label, kind: 'algoData' });
const algoIn = (label: string): PortSpec => ({ id: 'in', label, kind: 'algoData' });

function algoValue(props: NodeBodyProps): AlgoData | null {
  const value = props.values.in;
  return value?.kind === 'algoData' ? value : null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '当前输入无法计算。';
}

function hex(value: number): string {
  return '0x' + Math.max(0, Math.round(value)).toString(16).toUpperCase();
}

function arrayOf(data: AlgoData | null): number[] {
  return data?.mode === 'array' ? (data.values ?? []) : [];
}

function addressesOf(data: AlgoData | null): number[] {
  return data?.mode === 'addrStream' ? (data.addresses ?? []) : [];
}

function GraphSvg({ graph, activeEdges = [], visited = [], current = null, ariaLabel = '带权图' }: {
  graph: GraphData;
  activeEdges?: string[];
  visited?: string[];
  current?: string | null;
  ariaLabel?: string;
}): JSX.Element {
  const count = Math.max(1, graph.nodes.length);
  const positions = new Map<string, { x: number; y: number }>();
  graph.nodes.forEach((node, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
    positions.set(node, { x: 150 + Math.cos(angle) * 78, y: 82 + Math.sin(angle) * 58 });
  });
  return <svg className={styles.chart} viewBox="0 0 300 164" role="img" aria-label={ariaLabel}>
    {graph.edges.map((edge) => {
      const from = positions.get(edge.u);
      const to = positions.get(edge.v);
      if (!from || !to) return null;
      const key = `${edge.u}-${edge.v}-${edge.w}`;
      const active = activeEdges.includes(key);
      return <g key={key}>
        <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={active ? '#0d9488' : '#cbd5e1'} strokeWidth={active ? 2.5 : 1.1} />
        <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 3} textAnchor="middle" fill={active ? '#0d9488' : '#8c95a4'}>{edge.w}</text>
      </g>;
    })}
    {graph.nodes.map((node) => {
      const point = positions.get(node)!;
      const active = node === current;
      const seen = visited.includes(node);
      return <g key={node}>
        <circle cx={point.x} cy={point.y} r={active ? 12 : 10} fill={active ? '#0d9488' : seen ? '#4f46e522' : '#fff'}
          stroke={active ? '#0d9488' : seen ? '#4f46e5' : '#8c95a4'} strokeWidth="1.5" />
        <text x={point.x} y={point.y + 3} textAnchor="middle" fill={active ? '#fff' : '#2f3a49'}>{node}</text>
      </g>;
    })}
  </svg>;
}

export function ArraySourceBody(props: NodeBodyProps): JSX.Element {
  const { node, onParams, onText, inCard } = props;
  let data: AlgoData | null = null;
  let error = '';
  try {
    data = arrayFromParams(node.params, node.text ?? '');
  } catch (cause) {
    error = errorText(cause);
  }
  const values = arrayOf(data);
  return <div className={styles.root}>
    {error ? <Notice>{error}</Notice> : <BarChart labels={values.map((_, index) => String(index + 1))} values={values} compact={inCard} ariaLabel="数组源数值柱状图" />}
    <div className={styles.tagRow}>
      <span className={styles.tag}>{['随机数组', '升序数组', '降序数组', '手动数组'][Math.round(node.params.mode ?? 0)] ?? '数组'}</span>
      <span className={styles.tag}>{values.length} 项</span>
    </div>
    {!inCard && <div className={styles.controls}>
      <SelectControl label="生成方式" value={node.params.mode ?? 0} options={['随机', '升序', '降序', '手动']} onChange={(value) => onParams?.({ mode: value })} />
      <RangeControl label="数组长度" value={node.params.length ?? 12} min={4} max={40} step={1} onChange={(value) => onParams?.({ length: value })} />
      <RangeControl label="随机种子" value={node.params.seed ?? 7} min={1} max={9999} step={1} onChange={(value) => onParams?.({ seed: value })} />
      {Math.round(node.params.mode ?? 0) === 3 ? <label className={`${styles.field} ${styles.wide}`}>手动数组
        <textarea className={styles.textarea} rows={4} value={node.text ?? ''} spellCheck={false}
          onChange={(event) => onText?.(event.currentTarget.value)} placeholder="3 1 4 1 5 9" />
      </label> : null}
      <p className={styles.tip}>输出 algoData 可接排序竞赛、图算法或作为后续数组题型的输入；随机数组由固定种子复现。</p>
    </div>}
  </div>;
}

export function SortCompareViewBody(props: NodeBodyProps): JSX.Element {
  const { inCard } = props;
  const data = algoValue(props);
  const [active, setActive] = useState(0);
  if (!data || data.mode !== 'array' || !data.values?.length) return <Notice>把「序列输入源」的 algoData 输出接到排序对比仪。</Notice>;
  const races = sortRace(data.values);
  const race = races[Math.min(active, races.length - 1)]!;
  const maxComparisons = Math.max(1, ...races.map((item) => item.comparisons));
  const maxSwaps = Math.max(1, ...races.map((item) => item.swaps));
  const maxStep = Math.max(1, ...race.steps);
  return <div className={styles.root}>
    <BarChart labels={races.map((item) => item.name)} values={races.map((item) => item.comparisons)} compact={inCard}
      ariaLabel="三种排序算法比较次数对比" />
    <div className={styles.barList}>{races.map((item, index) => <div key={item.name} className={styles.barRow}>
      <span>{item.name}</span>
      <div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${(item.comparisons / maxComparisons) * 100}%`, background: BLOCK_COLORS[index % BLOCK_COLORS.length] }} /></div>
      <b>{item.comparisons}</b>
    </div>)}</div>
    {!inCard && <>
      <div className={styles.presets} role="group" aria-label="选择排序算法">
        {races.map((item, index) => <button key={item.name} type="button" aria-pressed={active === index} onClick={() => setActive(index)}>{item.name}</button>)}
      </div>
      <div className={styles.stepBar} aria-label={`${race.name} 步进柱状图`}>{race.steps.map((value, index) => (
        <i key={index} style={{ height: `${Math.max(4, (value / maxStep) * 100)}%`, background: BLOCK_COLORS[active % BLOCK_COLORS.length] }} />
      ))}</div>
      <KpiRow items={[
        { label: '比较次数', value: String(race.comparisons) },
        { label: '交换/写入', value: String(race.swaps) },
        { label: '总操作步', value: String(race.steps[race.steps.length - 1] ?? 0) },
      ]} />
      <table className={styles.table}>
        <thead><tr><th>算法</th><th>比较</th><th>交换/写入</th><th>相对比较</th><th>相对交换</th></tr></thead>
        <tbody>{races.map((item) => <tr key={item.name}><td>{item.name}</td><td>{item.comparisons}</td><td>{item.swaps}</td>
          <td>{(item.comparisons / maxComparisons).toFixed(2)}</td><td>{(item.swaps / maxSwaps).toFixed(2)}</td></tr>)}</tbody>
      </table>
      <p className={styles.tip}>归并排序的“交换”列统计写入次数；快速排序使用末位枢轴。相同输入下比较次数会随实现细节变化。</p>
    </>}
  </div>;
}

export function GraphSourceBody(props: NodeBodyProps): JSX.Element {
  const { node, onText, inCard } = props;
  let graph: GraphData | null = null;
  let error = '';
  try {
    graph = parseGraph(node.text?.trim() ? node.text : DEFAULT_GRAPH_TEXT);
  } catch (cause) {
    error = errorText(cause);
  }
  return <div className={styles.root}>
    {error ? <Notice>{error}</Notice> : graph ? <GraphSvg graph={graph} ariaLabel="带权图源" /> : null}
    {!inCard && <>
      <label className={`${styles.field} ${styles.wide}`}>边表（u v w）
        <textarea className={styles.textarea} rows={6} value={node.text ?? DEFAULT_GRAPH_TEXT} spellCheck={false}
          onChange={(event) => onText?.(event.currentTarget.value)} placeholder={'A B 4\nA C 2'} />
      </label>
      <div className={styles.presets}>
        <button type="button" onClick={() => onText?.(DEFAULT_GRAPH_TEXT)}>恢复示例图</button>
        <button type="button" onClick={() => onText?.('1 2 7\n2 3 2\n1 3 6\n3 4 4\n2 4 9')}>四节点样例</button>
      </div>
      <p className={styles.tip}>每行 u v w，支持空格/逗号分隔；输出 algoData 可同时接 Dijkstra 与 MST 视图。</p>
    </>}
  </div>;
}

export function ShortestPathViewBody(props: NodeBodyProps): JSX.Element {
  const { node, onParams, inCard } = props;
  const data = algoValue(props);
  const graph = graphOf(data);
  const algorithm = Math.round(node.params.algorithm ?? 0) === 1 ? 1 : 0;
  const sourceIndex = graph ? Math.max(0, Math.min(graph.nodes.length - 1, Math.round(node.params.sourceIndex ?? 0))) : 0;
  const source = graph?.nodes[sourceIndex] ?? graph?.nodes[0] ?? '';
  const result = graph ? shortestPathSteps(graph, algorithm, source) : null;
  const signature = JSON.stringify(data);
  const [step, setStep] = useState(0);
  const last = Math.max(0, (result?.frames.length ?? 1) - 1);
  useEffect(() => { setStep(0); }, [signature, algorithm, sourceIndex]);
  if (!graph || !result) return <Notice>把「带权图源」的 algoData(graph) 输出接到最短路径 / MST 视图。</Notice>;
  const frame = result.frames[Math.min(step, last)];
  const visited = frame?.visited ?? [];
  const active = frame?.active ?? [];
  return <div className={styles.root}>
    <GraphSvg graph={graph} activeEdges={active} visited={visited} current={frame?.current ?? source} ariaLabel={algorithm ? 'Prim 最小生成树步进' : 'Dijkstra 最短路径步进'} />
    <KpiRow items={[
      { label: algorithm ? 'MST 总权' : '源点', value: algorithm ? `Σ ${result.totalWeight}` : source },
      { label: '已确定', value: `${visited.length}/${graph.nodes.length}` },
      { label: '当前步', value: `${Math.min(step, last) + 1}/${last + 1}` },
    ]} />
    {!inCard && <>
      <SelectControl label="算法" value={algorithm} options={['Dijkstra 最短路径', 'Prim 最小生成树']} onChange={(value) => onParams?.({ algorithm: value })} />
      <SelectControl label="源点" value={sourceIndex} options={graph.nodes} onChange={(value) => onParams?.({ sourceIndex: value })} />
      <RangeControl label="推进一步" value={Math.min(step, last)} min={0} max={last} step={1} onChange={setStep} />
      <p className={styles.tip}>{frame?.note ?? '没有可用的推演帧'}</p>
      {algorithm === 0 ? <table className={styles.table}>
        <thead><tr><th>节点</th><th>最短路</th></tr></thead>
        <tbody>{graph.nodes.map((nodeLabel) => <tr key={nodeLabel}><td>{nodeLabel}</td><td>{Number.isFinite(result.distances[nodeLabel]) ? result.distances[nodeLabel] : '∞'}</td></tr>)}</tbody>
      </table> : <table className={styles.table}>
        <thead><tr><th>接入边</th><th>权值</th></tr></thead>
        <tbody>{result.edges.map((edge) => <tr key={`${edge.u}-${edge.v}-${edge.w}`}><td>{edge.u} — {edge.v}</td><td>{edge.w}</td></tr>)}</tbody>
      </table>}
    </>}
  </div>;
}

export function MemAddrSourceBody(props: NodeBodyProps): JSX.Element {
  const { node, onParams, onText, inCard } = props;
  let data: AlgoData | null = null;
  let error = '';
  try {
    data = memoryAddressStream(node.params, node.text ?? '');
  } catch (cause) {
    error = errorText(cause);
  }
  const addresses = addressesOf(data);
  return <div className={styles.root}>
    {error ? <Notice>{error}</Notice> : <LineChart labels={addresses.map((_, index) => `#${index + 1}`)} series={[{ name: '地址', values: addresses }]} compact={inCard} ariaLabel="访存地址流" />}
    <div className={styles.tagRow}>
      <span className={styles.tag}>{['生成地址流', '手动地址流'][Math.round(node.params.mode ?? 0)] ?? '地址流'}</span>
      <span className={styles.tag}>{addresses.length} 次访存</span>
    </div>
    {!inCard && <div className={styles.controls}>
      <SelectControl label="生成方式" value={node.params.mode ?? 0} options={['基址 + 步长', '手动输入']} onChange={(value) => onParams?.({ mode: value })} />
      <RangeControl label="访存次数" value={node.params.count ?? 16} min={1} max={60} step={1} onChange={(value) => onParams?.({ count: value })} />
      <RangeControl label="基址" value={node.params.base ?? 4096} min={0} max={65535} step={256} onChange={(value) => onParams?.({ base: value })} format={(value) => hex(value)} />
      <RangeControl label="步长" value={node.params.stride ?? 96} min={1} max={8192} step={1} onChange={(value) => onParams?.({ stride: value })} />
      {Math.round(node.params.mode ?? 0) === 1 ? <label className={`${styles.field} ${styles.wide}`}>手动地址
        <textarea className={styles.textarea} rows={4} value={node.text ?? ''} spellCheck={false}
          onChange={(event) => onText?.(event.currentTarget.value)} placeholder="0 64 128 4096" />
      </label> : null}
      <p className={styles.tip}>同一地址流可以同时接 TLB/页表翻译视图与 Cache 映射视图，观察虚实地址转换和组相联命中。</p>
    </div>}
  </div>;
}

export function AddrTranslateViewBody(props: NodeBodyProps): JSX.Element {
  const { node, onParams, inCard } = props;
  const addresses = addressesOf(algoValue(props));
  if (!addresses.length) return <Notice>把「访存地址流源」的 algoData(addrStream) 输出接到 TLB / 页表视图。</Notice>;
  const result = translateAddresses(addresses, {
    pageSize: node.params.pageSize ?? 256,
    tlbEntries: node.params.tlbEntries ?? 4,
    policy: node.params.policy ?? 0,
  });
  return <div className={styles.root}>
    <KpiRow items={[
      { label: 'TLB 命中', value: String(result.tlbHits), tone: result.tlbHits > 0 ? 'good' : 'warn' },
      { label: '页表走查', value: String(result.pageWalks) },
      { label: '命中率', value: `${Math.round((result.tlbHits / Math.max(1, result.rows.length)) * 100)}%` },
    ]} />
    <table className={styles.table}>
      <thead><tr><th>虚地址</th><th>VPN</th><th>页内偏移</th><th>PFN</th><th>物理地址</th><th>状态</th></tr></thead>
      <tbody>{result.rows.slice(0, inCard ? 8 : 24).map((row, index) => <tr key={`${row.address}-${index}`}>
        <td>{hex(row.address)}</td><td>{row.vpn}</td><td>{row.offset}</td><td>{row.pfn}</td><td>{hex(row.physical)}</td>
        <td style={{ color: row.tlbHit ? '#0f766e' : '#b15236' }}>{row.tlbHit ? '命中' : '走表'}</td>
      </tr>)}</tbody>
    </table>
    {!inCard && <div className={styles.controls}>
      <SelectControl label="页大小" value={[64, 128, 256, 512, 1024, 2048, 4096].indexOf(node.params.pageSize ?? 256)} options={['64 B', '128 B', '256 B', '512 B', '1 KB', '2 KB', '4 KB']}
        onChange={(value) => onParams?.({ pageSize: [64, 128, 256, 512, 1024, 2048, 4096][value] ?? 256 })} />
      <RangeControl label="TLB 表项" value={node.params.tlbEntries ?? 4} min={1} max={8} step={1} onChange={(value) => onParams?.({ tlbEntries: value })} />
      <SelectControl label="替换策略" value={node.params.policy ?? 0} options={['FIFO', 'LRU']} onChange={(value) => onParams?.({ policy: value })} />
      <div className={styles.tagRow}>{result.tlb.map((vpn, index) => <span key={`${vpn}-${index}`} className={styles.tag}>#{index} VPN {vpn}</span>)}</div>
      <p className={styles.tip}>PFN 由固定页表演示映射生成；表格展示 TLB 命中或页表走查结果，不宣称真实操作系统页表布局。</p>
    </div>}
  </div>;
}

export function CacheMapViewBody(props: NodeBodyProps): JSX.Element {
  const { node, onParams, inCard } = props;
  const addresses = addressesOf(algoValue(props));
  if (!addresses.length) return <Notice>把「访存地址流源」的 algoData(addrStream) 输出接到 Cache 映射视图。</Notice>;
  const result = cacheMap(addresses, {
    blockBytes: node.params.blockBytes ?? 64,
    cacheKB: node.params.cacheKB ?? 4,
    ways: node.params.ways ?? 2,
    policy: node.params.policy ?? 1,
  });
  const offsetBits = Math.max(0, Math.round(Math.log2(node.params.blockBytes ?? 64)));
  const indexBits = Math.max(0, Math.log2(result.sets));
  const tagBits = Math.max(0, 32 - offsetBits - indexBits);
  const totalBits = Math.max(1, offsetBits + indexBits + tagBits);
  return <div className={styles.root}>
    <svg className={styles.chart} viewBox="0 0 300 48" role="img" aria-label="Cache 地址划分">
      {[
        { label: `tag ${tagBits}`, bits: tagBits, fill: '#4f46e5' },
        { label: `index ${indexBits}`, bits: indexBits, fill: '#b15236' },
        { label: `offset ${offsetBits}`, bits: offsetBits, fill: '#8c95a4' },
      ].map((part, index, list) => {
        const before = list.slice(0, index).reduce((sum, item) => sum + item.bits, 0);
        const x = 20 + before / totalBits * 260;
        const width = Math.max(12, part.bits / totalBits * 260);
        return <g key={part.label}><rect x={x} y="10" width={width} height="24" rx="3" fill={part.fill} opacity="0.82" />
          <text x={x + width / 2} y="26" textAnchor="middle" fill="#fff">{part.label}</text></g>;
      })}
      <text x="20" y="45">{result.blocks} 块 · {result.sets} 组 · {result.ways} 路</text>
    </svg>
    <KpiRow items={[
      { label: '命中', value: String(result.hits), tone: result.hits > 0 ? 'good' : 'warn' },
      { label: '缺失', value: String(result.misses) },
      { label: '命中率', value: `${(result.hitRate * 100).toFixed(1)}%` },
    ]} />
    <table className={styles.table}>
      <thead><tr><th>地址</th><th>tag</th><th>组</th><th>块内偏移</th><th>状态</th><th>驱逐 tag</th></tr></thead>
      <tbody>{result.rows.slice(0, inCard ? 8 : 24).map((row, index) => <tr key={`${row.address}-${index}`}>
        <td>{hex(row.address)}</td><td>{row.tag}</td><td>{row.index}</td><td>{row.offset}</td>
        <td style={{ color: row.hit ? '#0f766e' : '#b15236' }}>{row.hit ? '命中' : '缺失'}</td>
        <td>{row.evictedTag === null ? '—' : row.evictedTag}</td>
      </tr>)}</tbody>
    </table>
    {!inCard && <div className={styles.controls}>
      <SelectControl label="块大小" value={[8, 16, 32, 64, 128, 256].indexOf(node.params.blockBytes ?? 64)} options={['8 B', '16 B', '32 B', '64 B', '128 B', '256 B']}
        onChange={(value) => onParams?.({ blockBytes: [8, 16, 32, 64, 128, 256][value] ?? 64 })} />
      <SelectControl label="Cache 容量" value={[1, 2, 4, 8, 16, 32].indexOf(node.params.cacheKB ?? 4)} options={['1 KB', '2 KB', '4 KB', '8 KB', '16 KB', '32 KB']}
        onChange={(value) => onParams?.({ cacheKB: [1, 2, 4, 8, 16, 32][value] ?? 4 })} />
      <SelectControl label="组相联路数" value={[1, 2, 4, 8].indexOf(node.params.ways ?? 2)} options={['1 路', '2 路', '4 路', '8 路']}
        onChange={(value) => onParams?.({ ways: [1, 2, 4, 8][value] ?? 2 })} />
      <SelectControl label="替换策略" value={node.params.policy ?? 1} options={['FIFO', 'LRU']} onChange={(value) => onParams?.({ policy: value })} />
      <p className={styles.tip}>按 32 位地址展示 tag/index/offset；tag 与组内路逐一比较，缺失时按所选策略替换并记录被驱逐的 tag。</p>
    </div>}
  </div>;
}

export const LAB408_BLOCK_DEFS: Partial<Record<NodeType, NodeDef>> = {
  arraySource: { title: '序列输入源', badge: '源', width: 320, outputs: [algoOut('数组')], Body: ArraySourceBody },
  sortCompareView: { title: '排序步进对比仪', badge: '视图', width: 340, inputs: [algoIn('数组')], Body: SortCompareViewBody },
  graphSource: { title: '带权图源', badge: '源', width: 320, outputs: [algoOut('图')], Body: GraphSourceBody },
  shortestPathView: { title: '最短路 / MST 步进', badge: '视图', width: 340, inputs: [algoIn('图')], Body: ShortestPathViewBody },
  memAddrSource: { title: '访存地址流源', badge: '源', width: 320, outputs: [algoOut('地址流')], Body: MemAddrSourceBody },
  addrTranslateView: { title: 'TLB / 页表翻译', badge: '视图', width: 340, inputs: [algoIn('地址流')], Body: AddrTranslateViewBody },
  cacheMapView: { title: 'Cache 映射视图', badge: '视图', width: 340, inputs: [algoIn('地址流')], Body: CacheMapViewBody },
};

export const LAB408_BLOCK_DEFAULTS: Partial<Record<NodeType, Record<string, number>>> = {
  arraySource: { mode: 0, length: 12, seed: 7 },
  sortCompareView: {},
  graphSource: {},
  shortestPathView: { algorithm: 0, sourceIndex: 0 },
  memAddrSource: { mode: 0, count: 16, base: 4096, stride: 96, seed: 7 },
  addrTranslateView: { pageSize: 256, tlbEntries: 4, policy: 0 },
  cacheMapView: { blockBytes: 64, cacheKB: 4, ways: 2, policy: 1 },
};

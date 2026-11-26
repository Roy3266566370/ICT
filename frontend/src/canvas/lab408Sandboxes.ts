/** 408 计算机综合全景沙盘（第一批：4 科各 1 个旗舰章）。
 *
 * 每章画布 = 任务卡 + 1–2 个可编辑输入源（图源/序列源/滑杆）+ 3 块 aiRuleBlock 对照视图；
 * 一个源头经连线同时驱动多个视角，panel 已预设仪器态。
 * 布局约定沿用 physicsSandboxes：col1 x=40 任务与源头，col2 x=420 主视觉，col3 x=840 核对。
 * 第二批（DS/CO 其余 6 章）在 lab408SandboxesDsCo.ts，（OS/CN 其余 6 章）在 lab408SandboxesOsCn.ts。
 */
import { board, control, node, rule, slider, sliderParam } from './calculusSandboxDoc.ts';
import { lab408SandboxDsCoDoc, type Lab408SandboxDsCoKind } from './lab408SandboxesDsCo.ts';
import { lab408SandboxOsCnDoc, type Lab408SandboxOsCnKind } from './lab408SandboxesOsCn.ts';
import {
  addrSplitRule, amatRaceRule, allocFragRule, beladyRaceRule, cacheGridRule, cwndCurveRule,
  floydMatrixRule, handshakeRule, mstVsSptRule, pageGridRule, topoCpmRule, winLimitRule,
} from './lab408SandboxRules.ts';
import type { CanvasDoc } from './types.ts';

export type Lab408SandboxFlagshipKind = 'ds03-graphs' | 'co02-memory-cache' | 'os03-memory-vm' | 'cn03-tcp-transport';
export type Lab408SandboxKind = Lab408SandboxFlagshipKind | Lab408SandboxDsCoKind | Lab408SandboxOsCnKind;

const SANDBOX_KINDS: readonly Lab408SandboxKind[] = [
  'ds01-linear-string', 'ds02-trees', 'ds03-graphs', 'ds04-search-sort',
  'co01-data-alu', 'co02-memory-cache', 'co03-isa-cpu', 'co04-pipeline-io',
  'os01-process-sched', 'os02-sync-deadlock', 'os03-memory-vm', 'os04-file-io',
  'cn01-phys-datalink', 'cn02-ip-routing', 'cn03-tcp-transport', 'cn04-app-fullpath',
];

export function isLab408SandboxKind(kind: string | null): kind is Lab408SandboxKind {
  return kind !== null && (SANDBOX_KINDS as readonly string[]).includes(kind);
}

export function lab408SandboxDoc(kind: Lab408SandboxKind, title: string): CanvasDoc {
  switch (kind) {
    case 'ds03-graphs': return graphsSandbox(title);
    case 'co02-memory-cache': return memoryCacheSandbox(title);
    case 'os03-memory-vm': return memoryVmSandbox(title);
    case 'cn03-tcp-transport': return tcpTransportSandbox(title);
    case 'ds01-linear-string':
    case 'ds02-trees':
    case 'ds04-search-sort':
    case 'co01-data-alu':
    case 'co03-isa-cpu':
    case 'co04-pipeline-io':
      return lab408SandboxDsCoDoc(kind, title);
    default: return lab408SandboxOsCnDoc(kind, title);
  }
}

const CLASSIC_GRAPH = 'A B 4\nA C 2\nB C 1\nB D 5\nC D 8\nC E 10\nD E 2\nE F 3';
const AOE_GRAPH = 'v1 v2 6\nv1 v3 4\nv1 v4 5\nv2 v5 1\nv3 v5 1\nv4 v6 2\nv5 v7 9\nv5 v8 7\nv6 v8 4\nv8 v9 2\nv7 v9 4';
const STAR_GRAPH = 'S A 2\nS B 3\nS C 5\nS D 7\nA B 10';

/* ---------- DS 旗舰 · 第 5 章：图的遍历、生成树与最短路径 ---------- */

function graphsSandbox(title: string): CanvasDoc {
  const startNode = slider('startNode', '起点序号', 430, 0, 0, 5, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '最短路树≠最小生成树？\n改边表文本，三视图同算：\nPrim vs Dijkstra 逐帧、\nFloyd 热图、拓扑+关键路径。'),
    node('graphSrc', 'graphSource', 40, 190, {}, CLASSIC_GRAPH),
    startNode,
    rule('mstVsSpt', 420, 40, {
      title: 'Prim MST vs Dijkstra SPT', summary: '同一图源同一起点：Prim 按割集选边，Dijkstra 按 dist 锁点——两棵树经常不同。',
      preferredView: 'graph', code: mstVsSptRule,
      controls: [control('start', '起点序号回落', 0, 0, 11, 1)],
      presets: [
        { label: '经典带权图', text: CLASSIC_GRAPH, params: {} },
        { label: '工程网 AOE', text: AOE_GRAPH, params: {} },
        { label: '星形图(两树相同)', text: STAR_GRAPH, params: {} },
      ],
      auxiliaryKind: 'scalar', presetSource: 'text',
    }),
    rule('distMatrix', 420, 430, {
      title: '邻接矩阵 → Floyd 距离矩阵', summary: '逐中间点 k 迭代距离热图，∞ 标 99+；最后输出全源最短路表。',
      preferredView: 'grid', code: floydMatrixRule,
      controls: [],
      presets: [
        { label: '经典带权图', text: CLASSIC_GRAPH, params: {} },
        { label: '工程网 AOE', text: AOE_GRAPH, params: {} },
        { label: '星形图', text: STAR_GRAPH, params: {} },
      ],
      presetSource: 'text',
    }),
    rule('topoCpm', 840, 200, {
      title: '拓扑排序 + AOE 关键路径', summary: '把边表当有向工程网：Kahn 出队序列、ve/vl 与松弛 0 的关键活动。',
      preferredView: 'timeline', code: topoCpmRule,
      controls: [],
      presets: [
        { label: '工程网 AOE', text: AOE_GRAPH, params: {} },
        { label: '经典带权图', text: CLASSIC_GRAPH, params: {} },
        { label: '星形图', text: STAR_GRAPH, params: {} },
      ],
      presetSource: 'text',
    }),
  ], [
    ['graphSrc', 'mstVsSpt'], ['graphSrc', 'distMatrix'], ['graphSrc', 'topoCpm'], ['startNode', 'mstVsSpt', 'aux'],
  ], ['mstVsSpt', 'distMatrix', 'topoCpm'], [
    sliderParam(startNode),
    { node_id: 'mstVsSpt', param_key: 'start', label: '起点序号', min: 0, max: 11, step: 1 },
  ]);
}

/* ---------- CO 旗舰 · 第 3 章：主存、Cache 映射与虚拟存储全链路 ---------- */

const ADDR_LOCALITY = '0 64 0 64 128 0 192 0 64 128 0 64';
const ADDR_THRASH = '0 1024 0 1024 0 1024 0 1024 0 1024 0 1024';
const ADDR_STRIDE = '0 512 1024 1536 2048 2560 3072 3584';

function memoryCacheSandbox(title: string): CanvasDoc {
  const assoc = slider('assoc', '相联路数 (1/2/4/8)', 400, 1, 1, 8, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '直接映射为何全 Miss？\n改地址流或拖路数，看\ntag/index/offset 切分、\n组相联网格与 AMAT 竞赛。'),
    node('addrSrc', 'memAddrSource', 40, 185, { mode: 1, count: 12 }, ADDR_THRASH),
    assoc,
    rule('addrSplit', 420, 40, {
      title: '虚→物理地址位段切分', summary: '每次访存：VPN→PFN 页表翻译，物理地址再切 tag/index/offset 三段。',
      preferredView: 'shapes', code: addrSplitRule,
      controls: [
        control('pageSize', '页大小 (B)', 256, 64, 8192, 1),
        control('blockBytes', '块大小 (B)', 64, 8, 1024, 1),
        control('cacheKB', 'Cache 容量 (KB)', 4, 1, 1024, 1),
        control('ways', '路数回落', 4, 1, 16, 1),
      ],
      presets: [
        { label: '局部性良好序列', text: ADDR_LOCALITY, params: {} },
        { label: '抖动冲突序列', text: ADDR_THRASH, params: {} },
        { label: '大步长扫描流', text: ADDR_STRIDE, params: {} },
      ],
      presetSource: 'text',
    }),
    rule('cacheGrid', 420, 430, {
      title: '组相联 Hit/Miss 逐帧网格', summary: '同一地址流：行=组、列=路，逐帧看装入、命中与 LRU 淘汰。',
      preferredView: 'grid', code: cacheGridRule,
      controls: [
        control('blockBytes', '块大小 (B)', 64, 8, 1024, 1),
        control('cacheKB', '演示容量 (KB)', 1, 1, 1024, 1),
        control('ways', '路数回落', 2, 1, 16, 1),
        control('policy', '替换策略(0=FIFO,1=LRU)', 1, 0, 1, 1),
      ],
      presets: [
        { label: '抖动冲突序列', text: ADDR_THRASH, params: {} },
        { label: '局部性良好序列', text: ADDR_LOCALITY, params: {} },
        { label: '大步长扫描流', text: ADDR_STRIDE, params: {} },
      ],
      auxiliaryKind: 'scalar', presetSource: 'text',
    }),
    rule('amatRace', 840, 180, {
      title: '1/2/4/8 路命中率与 AMAT', summary: '同地址流扫路数：命中率上升边际递减，AMAT 给出综合判决。',
      preferredView: 'chart', code: amatRaceRule,
      controls: [
        control('blockBytes', '块大小 (B)', 64, 8, 1024, 1),
        control('cacheKB', '演示容量 (KB)', 1, 1, 1024, 1),
        control('hitCyc', '命中周期', 1, 1, 8, 1),
        control('missPen', '缺失罚时', 40, 4, 200, 4),
      ],
      presets: [
        { label: '抖动冲突序列', text: ADDR_THRASH, params: {} },
        { label: '局部性良好序列', text: ADDR_LOCALITY, params: {} },
        { label: '大步长扫描流', text: ADDR_STRIDE, params: {} },
      ],
      presetSource: 'text',
    }),
  ], [
    ['addrSrc', 'addrSplit'], ['addrSrc', 'cacheGrid'], ['addrSrc', 'amatRace'],
    ['assoc', 'cacheGrid', 'aux'],
  ], ['addrSplit', 'cacheGrid', 'amatRace'], [
    sliderParam(assoc),
    { node_id: 'cacheGrid', param_key: 'cacheKB', label: '演示容量 KB', min: 1, max: 8, step: 1 },
    { node_id: 'amatRace', param_key: 'missPen', label: '缺失罚时', min: 4, max: 200, step: 4 },
  ]);
}

/* ---------- OS 旗舰 · 第 3 章：内存分配、分页与页面置换 ---------- */

const REF_BELADY = '1 2 3 4 1 2 5 1 2 3 4 5';
const REF_LOCALITY = '1 2 3 1 2 3 4 5 4 5 1 2';
const REF_SWEEP = '1 2 3 4 5 1 2 3 4 5 1 2';

function memoryVmSandbox(title: string): CanvasDoc {
  const frames = slider('frames', '物理页框数', 400, 3, 3, 6, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '加页框反而更多缺页？\n经典 Belady 序列直出异常；\n再换 FF/BF/WF 看碎片。'),
    node('refSeq', 'pageRefSource', 40, 185, { mode: 3, count: 12, maxPage: 9, seed: 7 }, REF_BELADY),
    frames,
    rule('pageGrid', 420, 40, {
      title: '页框置换逐帧网格', summary: '行=物理框、列=时间，缺页格染红；FIFO/LRU/OPT 随时切换。',
      preferredView: 'grid', code: pageGridRule,
      controls: [
        control('algo', '算法(0=FIFO,1=LRU,2=OPT,3=Clock)', 0, 0, 3, 1),
        control('frames', '页框回落', 3, 1, 6, 1),
      ],
      presets: [
        { label: 'FIFO · Belady', params: { algo: 0 }, text: REF_BELADY },
        { label: 'LRU · 同串', params: { algo: 1 }, text: REF_BELADY },
        { label: 'OPT · 同串', params: { algo: 2 }, text: REF_BELADY },
      ],
      auxiliaryKind: 'scalar', presetSource: 'text',
    }),
    rule('beladyRace', 420, 430, {
      title: '四算法缺页竞赛 × 页框扫描', summary: 'OPT/LRU/FIFO/Clock 缺页数同台，3→4 框直击 Belady 异常。',
      preferredView: 'chart', code: beladyRaceRule,
      controls: [control('frames', '页框回落', 3, 1, 6, 1)],
      presets: [
        { label: 'Belady 经典串', params: {}, text: REF_BELADY },
        { label: '强局部性串', params: {}, text: REF_LOCALITY },
        { label: '循环扫描串', params: {}, text: REF_SWEEP },
      ],
      auxiliaryKind: 'scalar', presetSource: 'text',
    }),
    rule('allocFrag', 840, 180, {
      title: 'FF/BF/WF 碎片对照', summary: '同一作业序列喂三种连续分配策略，放置成败与外碎片一眼可见。',
      preferredView: 'shapes', code: allocFragRule,
      textLabel: '孔洞与作业（holes:… jobs:…，留空走场景预设）',
      controls: [control('variant', '场景(0=经典,1=紧孔洞,2=大作业)', 0, 0, 2, 1)],
      presets: [
        { label: '教科书经典', params: { variant: 0 } },
        { label: '碎片紧孔洞', params: { variant: 1 } },
        { label: '大作业失败', params: { variant: 2 } },
      ],
    }),
  ], [
    ['refSeq', 'pageGrid'], ['refSeq', 'beladyRace'],
    ['frames', 'pageGrid', 'aux'], ['frames', 'beladyRace', 'aux'],
  ], ['pageGrid', 'beladyRace', 'allocFrag'], [
    sliderParam(frames),
    { node_id: 'pageGrid', param_key: 'algo', label: '置换算法', min: 0, max: 3, step: 1 },
    { node_id: 'allocFrag', param_key: 'variant', label: '分配场景', min: 0, max: 2, step: 1 },
  ]);
}

/* ---------- CN 旗舰 · 第 5 章：TCP 连接管理、流量与拥塞控制 ---------- */

function tcpTransportSandbox(title: string): CanvasDoc {
  const ssthresh = slider('ssthresh', '初始 ssthresh', 240, 8, 4, 24, 1);
  const rwnd = slider('rwnd', '接收窗口 rwnd', 390, 16, 6, 32, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '超时与 3-ACK 有何不同？\ncwnd 锯齿：翻倍→线性→\n归 1 或减半；rwnd 卡住\nmin(cwnd,rwnd) 上限。'),
    ssthresh, rwnd,
    rule('cwndCurve', 420, 40, {
      title: 'Reno 拥塞窗口锯齿', summary: '慢开始每 RTT 翻倍，达 ssthresh 转线性；超时 cwnd=1，3-ACK 快恢复减半。',
      preferredView: 'chart', code: cwndCurveRule,
      controls: [
        control('ssthresh', 'ssthresh 回落', 8, 4, 24, 1),
        control('rounds', 'RTT 轮数', 24, 6, 40, 1),
        control('lossAt', '丢包所在 RTT', 10, 2, 38, 1),
        control('lossType', '丢包类型(0=3ACK,1=超时)', 0, 0, 1, 1),
      ],
      presets: [
        { label: '3-ACK 快恢复', params: { lossType: 0, lossAt: 10 } },
        { label: '超时打回 1', params: { lossType: 1, lossAt: 10, ssthresh: 8 } },
        { label: '高门限长跑', params: { ssthresh: 20, lossAt: 18 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'ssthresh' },
    }),
    rule('handshake', 420, 430, {
      title: '三次握手 / 四次挥手', summary: 'seq/ack 报文时序与状态机迁移；TIME_WAIT 等 2MSL。',
      preferredView: 'shapes', code: handshakeRule,
      controls: [control('rwnd', '通告窗口回落', 16, 1, 64, 1)],
      presets: [
        { label: 'rwnd=6 小窗', params: { rwnd: 6 } },
        { label: 'rwnd=16 标准', params: { rwnd: 16 } },
        { label: 'rwnd=32 大窗', params: { rwnd: 32 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'rwnd' },
    }),
    rule('winLimit', 840, 180, {
      title: '发送窗 min(cwnd,rwnd)', summary: '在途字节受两端窗口最小值约束；接收窗卡脖子时管道利用率骤降。',
      preferredView: 'timeline', code: winLimitRule,
      controls: [
        control('rwnd', 'rwnd 回落', 16, 2, 64, 1),
        control('ssthresh', 'ssthresh 回落', 8, 2, 24, 1),
        control('rounds', 'RTT 轮数', 24, 6, 40, 1),
        control('lossAt', '丢包 RTT', 10, 2, 38, 1),
      ],
      presets: [
        { label: 'rwnd=6 限流', params: { rwnd: 6 } },
        { label: 'rwnd=16 标准', params: { rwnd: 16 } },
        { label: 'rwnd=32 放开', params: { rwnd: 32 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'rwnd' },
    }),
  ], [
    ['ssthresh', 'cwndCurve'], ['ssthresh', 'winLimit', 'aux'], ['rwnd', 'handshake'], ['rwnd', 'winLimit'],
  ], ['cwndCurve', 'handshake', 'winLimit'], [
    sliderParam(ssthresh), sliderParam(rwnd),
    { node_id: 'cwndCurve', param_key: 'lossType', label: '丢包类型', min: 0, max: 1, step: 1 },
    { node_id: 'cwndCurve', param_key: 'lossAt', label: '丢包 RTT', min: 2, max: 38, step: 1 },
  ]);
}

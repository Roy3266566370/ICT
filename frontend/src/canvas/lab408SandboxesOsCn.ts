/** 408 全景沙盘（第二批下）：操作系统 os01/os02/os04 + 计算机网络 cn01/cn02/cn04。
 * 模式同 lab408Sandboxes.ts：源头（序列源/滑杆）一驱多，aiRuleBlock 出视图。
 */
import { board, control, node, rule, slider, sliderParam } from './calculusSandboxDoc.ts';
import {
  arqRaceRule, bankerRule, csmaRule, diskTraceRule, dnsHttpRule, fragRule, inodeRule,
  manchesterRule, pvSimRule, ripOspfRule, rttRaceRule, schedGanttRule, schedRaceRule,
  stackRule, subnetRule,
} from './lab408SandboxRulesOsCn.ts';
import type { CanvasDoc } from './types.ts';

export type Lab408SandboxOsCnKind =
  | 'os01-process-sched' | 'os02-sync-deadlock' | 'os04-file-io'
  | 'cn01-phys-datalink' | 'cn02-ip-routing' | 'cn04-app-fullpath';

export function lab408SandboxOsCnDoc(kind: Lab408SandboxOsCnKind, title: string): CanvasDoc {
  switch (kind) {
    case 'os01-process-sched': return processSchedSandbox(title);
    case 'os02-sync-deadlock': return syncDeadlockSandbox(title);
    case 'os04-file-io': return fileIoSandbox(title);
    case 'cn01-phys-datalink': return physDatalinkSandbox(title);
    case 'cn02-ip-routing': return ipRoutingSandbox(title);
    default: return appFullpathSandbox(title);
  }
}

/* ---------- OS 第 1–2 章：进程状态与 CPU 调度 ---------- */

const PROC_TAB = '0 8 1 4 2 9 3 5';
const PROC_TAB2 = '0 3 0 6 2 2 4 4';

function processSchedSandbox(title: string): CanvasDoc {
  const q = slider('q', 'RR 时间片 q', 400, 2, 1, 8, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '进程表(到达,服务)成对\n驱动四算法甘特与指标；\n拖时间片看 RR 抖动。'),
    node('procTab', 'arraySource', 40, 185, { mode: 3, length: 8 }, PROC_TAB),
    q,
    rule('schedGantt', 420, 40, {
      title: '四算法甘特推演', summary: 'FCFS/SJF/SRTF/RR 逐单位推进：就绪队列选择与抢占边界。',
      preferredView: 'timeline', code: schedGanttRule,
      controls: [control('algo', '算法(0FCFS/1SJF/2SRTF/3RR)', 0, 0, 3, 1)],
      presets: [
        { label: 'FCFS', params: { algo: 0 } },
        { label: 'SJF', params: { algo: 1 } },
        { label: 'SRTF 抢占', params: { algo: 2 } },
        { label: 'RR q=2', params: { algo: 3, q: 2 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'algo', auxiliaryParam: 'q' },
    }),
    rule('schedRace', 840, 200, {
      title: '调度指标擂台', summary: '同进程表跑四算法：平均周转、带权周转与切换次数对账。',
      preferredView: 'chart', code: schedRaceRule,
      controls: [],
      presets: [
        { label: '经典进程表', params: {}, text: PROC_TAB },
        { label: '全 0 到达', params: {}, text: PROC_TAB2 },
        { label: '长作业压轴', params: {}, text: '0 24 0 3 0 3' },
      ],
      auxiliaryKind: 'scalar', presetSource: 'text',
    }),
  ], [
    ['procTab', 'schedGantt'], ['procTab', 'schedRace'], ['q', 'schedGantt', 'aux'], ['q', 'schedRace', 'aux'],
  ], ['schedGantt', 'schedRace'], [
    sliderParam(q),
    { node_id: 'schedGantt', param_key: 'algo', label: '调度算法', min: 0, max: 3, step: 1 },
  ]);
}

/* ---------- OS 第 2 章：PV 同步互斥与银行家 ---------- */

function syncDeadlockSandbox(title: string): CanvasDoc {
  const buf = slider('buf', '缓冲区容量 n', 400, 2, 1, 6, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '拖缓冲区大小看信号量演化；\n切错序复现「持锁等资源」\n死锁；银行家验安全序列。'),
    buf,
    rule('pvSim', 420, 40, {
      title: 'PV 生产者消费者逐帧', summary: 'empty/full/mutex 三信号量；正确顺序先资源后互斥。',
      preferredView: 'shapes', code: pvSimRule,
      controls: [control('buf', '容量回落', 2, 1, 6, 1), control('wrong', '颠倒 P 序?', 0, 0, 1, 1), control('steps', '事件数', 10, 4, 14, 1)],
      presets: [
        { label: '正确顺序', params: { wrong: 0 } },
        { label: '颠倒→死锁', params: { wrong: 1, buf: 2, steps: 6 } },
      ],
      presetSource: { param: 'buf' },
    }),
    rule('banker', 840, 200, {
      title: '银行家安全序列推演', summary: 'Need≤Available 逐进程放行；调 Available 观察安全/不安全翻转。',
      preferredView: 'table', code: bankerRule,
      controls: [control('a', 'Available A', 3, 0, 9, 1), control('b', 'Available B', 3, 0, 9, 1), control('c', 'Available C', 2, 0, 9, 1)],
      presets: [
        { label: '经典安全例 (3,3,2)', params: { a: 3, b: 3, c: 2 } },
        { label: '资源充裕 (7,7,7)', params: { a: 7, b: 7, c: 7 } },
        { label: '临界资源 (1,0,0)', params: { a: 1, b: 0, c: 0 } },
      ],
    }),
  ], [
    ['buf', 'pvSim'],
  ], ['pvSim', 'banker'], [
    sliderParam(buf),
    { node_id: 'pvSim', param_key: 'wrong', label: '颠倒 P 序', min: 0, max: 1, step: 1 },
    { node_id: 'banker', param_key: 'a', label: '可用资源 A', min: 0, max: 9, step: 1 },
  ]);
}

/* ---------- OS 第 4–5 章：文件索引与磁盘调度 ---------- */

const TRK_SEQ = '55 58 39 18 90 160 150 38 184';
const TRK_SEQ2 = '98 183 37 122 14 124 65 67';

function fileIoSandbox(title: string): CanvasDoc {
  const head = slider('head', '初始磁头位置', 330, 50, 0, 199, 1);
  const blk = slider('blk', '磁盘块大小 KB', 460, 4, 1, 8, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '磁道请求流驱动四寻道\n算法轨迹擂台；块大小\n核算 inode 混合索引。'),
    node('trkSeq', 'pageRefSource', 40, 185, { mode: 3, count: 9, maxPage: 199 }, TRK_SEQ),
    head, blk,
    rule('diskTrace', 420, 40, {
      title: 'FCFS/SSTF/SCAN/C-SCAN', summary: '同序列同初始磁头：轨迹、最长跳与总寻道一次比完。',
      preferredView: 'timeline', code: diskTraceRule,
      controls: [control('head', '磁头回落', 50, 0, 199, 1)],
      presets: [
        { label: '教科序列', params: {}, text: TRK_SEQ },
        { label: '严书例序列', params: {}, text: TRK_SEQ2 },
        { label: '两端拉扯', params: {}, text: '10 190 20 180 30 170 40' },
      ],
      auxiliaryKind: 'scalar', presetSource: 'text',
    }),
    rule('inode', 840, 180, {
      title: 'UNIX inode 混合索引', summary: '直接 10 + 一/二/三级间接：按块大小算最大文件与用量。',
      preferredView: 'shapes', code: inodeRule,
      controls: [control('blk', '块大小回落', 4, 1, 8, 1), control('fileKB', '文件大小 KB', 20000, 1, 1000000, 1000)],
      presets: [
        { label: '1KB 块', params: { blk: 1 } },
        { label: '4KB 块', params: { blk: 4 } },
        { label: '小文件直连', params: { fileKB: 20 } },
      ],
      presetSource: { param: 'blk' },
    }),
  ], [
    ['trkSeq', 'diskTrace'], ['head', 'diskTrace', 'aux'], ['blk', 'inode'],
  ], ['diskTrace', 'inode'], [
    sliderParam(head), sliderParam(blk),
    { node_id: 'inode', param_key: 'fileKB', label: '文件大小 KB', min: 1, max: 1000000, step: 1000 },
  ]);
}

/* ---------- CN 第 2–3 章：编码、滑动窗口与 CSMA/CD ---------- */

function physDatalinkSandbox(title: string): CanvasDoc {
  const dist = slider('dist', '链路距离 km', 330, 1, 0.1, 10, 0.1);
  const rate = slider('rate', '速率 Mbps', 460, 100, 10, 1000, 10);
  const delay = slider('delay', '传播时延（帧时）', 590, 3, 1, 8, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '链路距离驱动 CSMA/CD\n争用期；时延滑杆喂 ARQ\n重传；编码看三种波形。'),
    dist, rate, delay,
    rule('csma', 420, 40, {
      title: 'CSMA/CD 争用期', summary: '最坏情形 τ−ε 抢发：2τ 内才检测冲突 → 最短帧长。',
      preferredView: 'shapes', code: csmaRule,
      controls: [control('dist', '距离回落', 1, 0.1, 10, 0.1), control('mbps', '速率回落', 100, 10, 1000, 10)],
      presets: [
        { label: '1km/100M', params: { dist: 1, mbps: 100 } },
        { label: '5km/1000M', params: { dist: 5, mbps: 1000 } },
        { label: '10km/10M', params: { dist: 10, mbps: 10 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'dist' },
    }),
    rule('arqRace', 420, 430, {
      title: '停等 / GBN / SR', summary: '同一丢帧点看三种 ARQ 重传策略与信道利用率。',
      preferredView: 'chart', code: arqRaceRule,
      controls: [control('delay', '时延回落', 3, 1, 8, 1), control('frames', '总帧数', 6, 4, 10, 1), control('lossAt', '丢帧#', 3, 1, 10, 1)],
      presets: [
        { label: '第3帧丢失', params: { lossAt: 3, delay: 3 } },
        { label: '首帧即丢', params: { lossAt: 1, delay: 4 } },
        { label: '末帧丢失', params: { lossAt: 6, frames: 6 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'delay' },
    }),
    rule('manchester', 840, 200, {
      title: 'NRZ/曼彻斯特/差分', summary: '同比特流三种编码波形：中点跳变自带时钟。',
      preferredView: 'shapes', code: manchesterRule,
      textLabel: '比特流（0/1）',
      controls: [control('variant', '内置流(0/1/2)', 0, 0, 2, 1)],
      presets: [
        { label: '10110011', params: { variant: 0 } },
        { label: '01001110', params: { variant: 1 } },
        { label: '11110000 连码', params: { variant: 2 } },
      ],
    }),
  ], [
    ['dist', 'csma'], ['rate', 'csma', 'aux'], ['delay', 'arqRace'],
  ], ['csma', 'arqRace', 'manchester'], [
    sliderParam(dist), sliderParam(rate), sliderParam(delay),
    { node_id: 'arqRace', param_key: 'lossAt', label: '丢帧序号', min: 1, max: 10, step: 1 },
  ]);
}

/* ---------- CN 第 4 章：IPv4 子网、分片与路由收敛 ---------- */

function ipRoutingSandbox(title: string): CanvasDoc {
  const plen = slider('plen', '前缀长度 /8–30', 330, 26, 8, 30, 1);
  const mtu = slider('mtu', '链路 MTU 字节', 460, 1500, 256, 9000, 100);
  const hops = slider('hops', '断链距离（跳）', 590, 3, 1, 6, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '前缀长切分网络/主机位；\nMTU 驱动分片偏移表；\n断链看 RIP/OSPF 收敛。'),
    plen, mtu, hops,
    rule('subnet', 420, 40, {
      title: 'CIDR 子网位段', summary: '掩码切网络/主机位：网络号、广播地址与可用主机数。',
      preferredView: 'shapes', code: subnetRule,
      controls: [control('plen', '前缀回落', 26, 8, 30, 1), control('c', 'IP 第3段', 1, 0, 255, 1), control('d', 'IP 第4段', 37, 0, 255, 1)],
      presets: [
        { label: '/26 四子网', params: { plen: 26 } },
        { label: '/28 小网段', params: { plen: 28 } },
        { label: '/8 大网', params: { plen: 8 } },
      ],
      presetSource: { param: 'plen' },
    }),
    rule('frag', 420, 430, {
      title: 'IP 分片与片偏移', summary: '4000B 数据报过 MTU：总长/偏移字段(÷8)/MF 标志逐片核算。',
      preferredView: 'table', code: fragRule,
      controls: [control('mtu', 'MTU 回落', 1500, 256, 9000, 100), control('size', '数据报大小', 4000, 256, 9000, 100)],
      presets: [
        { label: 'MTU 1500', params: { mtu: 1500 } },
        { label: 'MTU 576 碎片多', params: { mtu: 576, size: 4000 } },
        { label: '巨型 MTU 不分片', params: { mtu: 9000, size: 4000 } },
      ],
      presetSource: { param: 'mtu' },
    }),
    rule('ripOspf', 840, 200, {
      title: '断链收敛 RIP vs OSPF', summary: 'RIP 距离向量慢收敛（坏消息传得慢），OSPF 泛洪 LSA 两轮重算。',
      preferredView: 'chart', code: ripOspfRule,
      controls: [control('hops', '断链跳数回落', 3, 1, 6, 1)],
      presets: [
        { label: '近端断链', params: { hops: 2 } },
        { label: '典型断链', params: { hops: 3 } },
        { label: '远端断链', params: { hops: 5 } },
      ],
      presetSource: { param: 'hops' },
    }),
  ], [
    ['plen', 'subnet'], ['mtu', 'frag'], ['hops', 'ripOspf'],
  ], ['subnet', 'frag', 'ripOspf'], [
    sliderParam(plen), sliderParam(mtu), sliderParam(hops),
    { node_id: 'frag', param_key: 'size', label: '数据报大小', min: 256, max: 9000, step: 100 },
  ]);
}

/* ---------- CN 第 6 章：DNS、HTTP 与五层全栈贯通 ---------- */

function appFullpathSandbox(title: string): CanvasDoc {
  const rtt = slider('rtt', 'RTT (ms)', 330, 30, 5, 200, 5);
  const objs = slider('objs', '页面对象数', 460, 4, 2, 8, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, 'RTT 同驱 DNS 跳数与\nHTTP 连接模式耗时；\n封装视图看逐层加首。'),
    rtt, objs,
    rule('dnsHttp', 420, 40, {
      title: 'DNS+HTTP 总耗时', summary: '递归 DNS 多跳 + 非持久/持久/流水线三种连接模式对账。',
      preferredView: 'timeline', code: dnsHttpRule,
      controls: [control('rtt', 'RTT 回落', 30, 5, 200, 5), control('objs', '对象回落', 4, 2, 8, 1), control('dns', 'DNS 跳数', 3, 2, 4, 1)],
      presets: [
        { label: '局域网 RTT', params: { rtt: 10 } },
        { label: '城域 RTT', params: { rtt: 30 } },
        { label: '跨洋 RTT', params: { rtt: 150 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'rtt' },
    }),
    rule('stackRule', 420, 430, {
      title: '五层封装逐层加首', summary: '报文→段→数据报→帧→比特：每层加什么首部一图看清。',
      preferredView: 'shapes', code: stackRule,
      textLabel: '应用层载荷（如 GET /index.html）',
      controls: [control('focus', '聚焦层(-1=全部)', -1, -1, 4, 1)],
      presets: [
        { label: '全栈', params: { focus: -1 } },
        { label: '聚焦传输层', params: { focus: 1 } },
        { label: '聚焦链路层', params: { focus: 3 } },
      ],
    }),
    rule('rttRace', 840, 200, {
      title: 'DNS 递归 vs 迭代', summary: '同一 RTT：递归由本地 DNS 跑腿多跳，迭代客户自行逐跳。',
      preferredView: 'chart', code: rttRaceRule,
      controls: [control('rtt', 'RTT 回落', 30, 5, 200, 5)],
      presets: [
        { label: 'RTT 10', params: { rtt: 10 } },
        { label: 'RTT 30', params: { rtt: 30 } },
        { label: 'RTT 100', params: { rtt: 100 } },
      ],
      presetSource: { param: 'rtt' },
    }),
  ], [
    ['rtt', 'dnsHttp'], ['objs', 'dnsHttp', 'aux'], ['rtt', 'rttRace'],
  ], ['dnsHttp', 'stackRule', 'rttRace'], [
    sliderParam(rtt), sliderParam(objs),
    { node_id: 'stackRule', param_key: 'focus', label: '聚焦层', min: -1, max: 4, step: 1 },
  ]);
}

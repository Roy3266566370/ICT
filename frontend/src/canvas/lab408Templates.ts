import { MANUAL_408_SUBJECTS } from '../labs/manual408.ts';
import { nextId } from './math.ts';
import { build408Pipeline } from './lab408Pipeline.ts';
import type { CanvasDoc, CanvasNode, NodeType } from './types.ts';

export interface Lab408Topic {
  id: 'l01' | 'l02' | 'l03' | 'l04';
  name: string;
  lead: string;
}

export type Lab408Kind =
  | 'dsTraversal' | 'avl' | 'kmpSort' | 'graphAlgo' | 'cacheSimLab' | 'pipelineLab' | 'ieee754Lab'
  | 'cpuScheduleLab' | 'bankerLab' | 'pageReplace' | 'tcpCongestionLab' | 'slidingWindowLab' | 'ipSubnet';

export type Lab408WorkbenchKind = 'dsWorkbench' | 'coWorkbench' | 'osWorkbench' | 'netWorkbench';
export type Lab408TemplateKind = Lab408Kind | Lab408WorkbenchKind;

export type Lab408Preview =
  | 'tree' | 'kmp' | 'sort' | 'graph' | 'cache' | 'pipeline' | 'ieee'
  | 'split' | 'cpu' | 'banker' | 'page' | 'tcp' | 'window' | 'subnet';

export interface Lab408Template {
  kind: Lab408Kind;
  topic: Lab408Topic['id'];
  name: string;
  desc: string;
  tag: string;
  question: string;
  steps: string;
  observation: string;
  keywords: readonly string[];
  preview: Lab408Preview;
}

export const LAB408_TOPICS: readonly Lab408Topic[] = [
  { id: 'l01', name: '专题 01 · 数据结构', lead: '从树遍历、哈夫曼编码与 AVL 旋转，到 KMP、排序和图算法的逐帧推演。' },
  { id: 'l02', name: '专题 02 · 组成原理', lead: '从虚拟地址到 Cache，观察流水线转发和定点、浮点数的位级表示。' },
  { id: 'l03', name: '专题 03 · 操作系统', lead: 'CPU 调度甘特图、银行家安全序列、页面置换与 Belady 异常，末尾是 13 个题型的全题型工作台。' },
  { id: 'l04', name: '专题 04 · 计算机网络', lead: '从 TCP 窗口、GBN / SR 重传，到 IPv4 子网、分片与路由匹配。' },
];

export const LAB408_TEMPLATES: readonly Lab408Template[] = [
  {
    kind: 'dsTraversal',
    topic: 'l01',
    name: '树遍历与哈夫曼编码',
    desc: '逐帧观察四种遍历的工作栈与队列，并用自定义权值构建哈夫曼树。',
    tag: '408 · 数据结构',
    question: '同一棵二叉树，为什么四种遍历得到不同序列？根结点分别在什么时候被访问？',
    steps: '1. 依次切到先序、中序、后序、层序。\n2. 记录 A、B、C 在每个序列中的位置。\n3. 只用「根、左、右」的访问时机解释差异。',
    observation: '层序使用队列。哈夫曼编码每轮合并权重最小的两棵子树。',
    keywords: ['二叉树', '遍历', '先序', '中序', '后序', '层序', '栈', '队列', 'Huffman', 'WPL'],
    preview: 'tree',
  },
  {
    kind: 'avl',
    topic: 'l01',
    name: 'AVL 平衡树旋转',
    desc: '跟踪 BST 插入、平衡因子和 LL、RR、LR、RL 旋转。',
    tag: '408 · 数据结构',
    question: '插入新节点后，哪位祖先最先失衡？',
    steps: '试试 30,20,10，再把序列改成 30,10,20。沿管线检查 BF 与旋转后的结构。',
    observation: '同向失衡需要单旋，内侧失衡需要双旋。',
    keywords: ['AVL', '平衡树', '旋转', 'BST', 'BF'],
    preview: 'tree',
  },
  {
    kind: 'kmpSort',
    topic: 'l01',
    name: 'KMP 匹配与排序步进',
    desc: '对比 next 与 nextval 的指针回退，逐帧跟踪快速排序和堆排序。',
    tag: '408 · 数据结构 · 步进',
    question: 'nextval 跳过了哪些无效比较？两种排序分别在哪里交换？',
    steps: '分别检查匹配和排序分支，换一组含重复字符或重复数值的输入再观察。',
    observation: 'KMP 回退模式串指针。快速排序围绕枢轴分区，堆排序通过下滤重建堆。',
    keywords: ['KMP', 'next', 'nextval', '快速排序', '堆排序', '步进'],
    preview: 'sort',
  },
  {
    kind: 'graphAlgo',
    topic: 'l01',
    name: '图算法逐步推演',
    desc: '对照 Dijkstra、Prim 与拓扑排序的选点、松弛和入度变化。',
    tag: '408 · 数据结构',
    question: '最短路径树和最小生成树为什么可能不同？',
    steps: '编辑边权、切换算法，逐步对照图上的高亮与内部表格。',
    observation: 'Dijkstra 比较从源点出发的距离，Prim 比较连接生成树的边权，拓扑排序每次取入度为零的顶点。',
    keywords: ['Dijkstra', 'Prim', '拓扑排序', '松弛', '最短路径', '最小生成树'],
    preview: 'graph',
  },
  {
    kind: 'cacheSimLab',
    topic: 'l02',
    name: '虚拟存储 → Cache 全链路',
    desc: '从 CPU 访存，经 TLB 和页表转换，再检查地址位段、组相联和 AMAT。',
    tag: '408 · 组成原理',
    question: '同一地址序列命中与否，由 tag 比较和组内路数共同决定——哪几次访存发生了替换？',
    steps: '先查看 TLB 如何产生物理地址。在地址切分模块改变块大小或路数，再检查 Cache 组表和命中率。',
    observation: 'offset 由块大小决定，组索引由组数决定，tag 是剩余高位；组内命中看 tag 匹配，缺失时按 LRU 淘汰。',
    keywords: ['Cache', 'TLB', '页表', '组相联', '映射', 'tag', '组索引', 'LRU', '命中率', 'AMAT'],
    preview: 'cache',
  },
  {
    kind: 'pipelineLab',
    topic: 'l02',
    name: '5 级流水线时空图',
    desc: '按指令序列画时空图，开关数据转发比较停顿与总周期数。',
    tag: '408 · 组成原理',
    question: '关掉转发后，相邻指令的数据相关会引入几个气泡？总周期数相差多少？',
    steps: '1. 默认开启转发，记下总周期数。\n2. 关闭转发重算，比较时空图里的停顿格。\n3. 找出 LW 与随后 ADD 之间的相关链。',
    observation: '理想流水每周期启动一条指令；数据相关未转发时需要停顿，转发可把停顿缩到最少。',
    keywords: ['流水线', '时空图', '数据相关', '转发', '停顿', 'CPI'],
    preview: 'pipeline',
  },
  {
    kind: 'ieee754Lab',
    topic: 'l02',
    name: '定点数与 IEEE 754 位级拆解',
    desc: '双向转换十进制和原始位模式，比较补码定点、浮点位段与舍入误差。',
    tag: '408 · 组成原理',
    question: '同一个位模式在 32 位与 64 位格式下为什么有不同的真值？偏移量从哪来？',
    steps: '1. 解码 0x3fc00000，核对符号、阶码与实际指数。\n2. 把位宽切到 64 位，比较阶码位数与偏移量。\n3. 用公式 (−1)^s × 1.M × 2^(E−bias) 复算真值。',
    observation: '单精度阶码 8 位偏移 127，双精度 11 位偏移 1023；尾数隐含前导 1，位段长度之和等于总位宽。',
    keywords: ['IEEE754', '浮点数', '阶码', '尾数', '偏移量', '真值'],
    preview: 'ieee',
  },
  {
    kind: 'cpuScheduleLab',
    topic: 'l03',
    name: 'CPU 调度甘特图对比',
    desc: '同一组进程切换 FCFS、SJF、SRTF 与 RR，逐帧画出甘特图并比较周转时间。',
    tag: '408 · 操作系统',
    question: '同一组到达时间与服务时间，为什么四种调度算法的平均周转时间不同？时间片大小改变了什么？',
    steps: '1. 依次切换四种算法，记录平均周转时间。\n2. 把时间片从 2 改到 1，观察 RR 的切换次数。\n3. 对比非抢占与抢占算法在同一进程表上的差异。',
    observation: 'SJF / SRTF 让短作业先走，平均周转时间更小；RR 用时间片保证响应，切换次数随时片变小而增多。',
    keywords: ['调度', 'FCFS', 'SJF', 'SRTF', '轮转', '时间片', '周转时间', '甘特图'],
    preview: 'cpu',
  },
  {
    kind: 'bankerLab',
    topic: 'l03',
    name: '银行家算法安全序列',
    desc: '用可用资源、Allocation 与 Need 矩阵推安全序列，比较不同可用量下是否卡死。',
    tag: '408 · 操作系统',
    question: '可用资源减少到多少时，同一组进程就找不到安全序列？安全序列唯一吗？',
    steps: '1. 用默认可用量求一条安全序列。\n2. 把可用量往下调，找出开始不安全的临界值。\n3. 记录每次试探失败的原因。',
    observation: '安全判定按「需求量 ≤ 可用量」逐个推进，推进后回收其已分配资源；找不到可推进进程即不安全。',
    keywords: ['银行家算法', '安全状态', '安全序列', '死锁避免', 'Allocation', 'Need'],
    preview: 'banker',
  },
  {
    kind: 'pageReplace',
    topic: 'l03',
    name: '页面置换与 Belady 异常',
    desc: '同一访问序列对比 FIFO / LRU / OPT，并排核对 3 块与 4 块的缺页数。',
    tag: '408 · 操作系统',
    question: '同样 3 个物理块，为什么三种算法的缺页次数不同？FIFO 增加物理块一定会更好吗？',
    steps: '1. 依次切换三种算法，记录缺页次数。\n2. 将物理块从 3 改为 4，比较 FIFO 的缺页数。\n3. 找出每个置换时刻被淘汰的页面及理由。',
    observation: 'LRU 淘汰最久未使用页；OPT 淘汰未来最久才使用的页；FIFO 只看装入顺序，会出现 Belady 异常。',
    keywords: ['页面置换', 'FIFO', 'LRU', 'OPT', '缺页', 'Belady 异常'],
    preview: 'page',
  },
  {
    kind: 'tcpCongestionLab',
    topic: 'l04',
    name: 'TCP 拥塞控制与流量控制',
    desc: '注入 ACK、三个冗余 ACK 和超时，对照拥塞窗口与接收窗口。',
    tag: '408 · 计算机网络',
    question: '三个重复确认与超时分别把窗口和阈值改成多少？为什么快重传后可以直接进入拥塞避免？',
    steps: '1. 按默认阈值走完 ack、3ack 与 timeout 序列。\n2. 记录每帧的 cwnd 与 ssthresh。\n3. 把阈值调小，比较曲线拐点。',
    observation: '慢开始每 RTT 窗口翻倍；到达阈值转入拥塞避免按线性增长；3 个重复 ACK 触发快重传并把阈值减半，超时把窗口降回 1。',
    keywords: ['TCP', '拥塞控制', '慢开始', '拥塞避免', '快重传', '快恢复', 'cwnd', 'ssthresh'],
    preview: 'tcp',
  },
  {
    kind: 'slidingWindowLab',
    topic: 'l04',
    name: 'GBN / SR 滑动窗口',
    desc: '同一丢帧序列分别用后退 N 帧与选择重传推进窗口，比较重传个数。',
    tag: '408 · 计算机网络',
    question: '同样丢了一个帧，为什么 GBN 要重传一串而 SR 只补一个？窗口上限分别受什么约束？',
    steps: '1. 选 GBN 走完默认序列，记下重传的帧号。\n2. 切到 SR，比较重传个数与接收缓存。\n3. 调窗口大小，观察序号空间的约束。',
    observation: 'GBN 接收端只按序确认，出错后回退重传后续所有帧；SR 缓存乱序帧并只重传出错帧。',
    keywords: ['滑动窗口', 'GBN', 'SR', '后退 N 帧', '选择重传', '序号', '重传'],
    preview: 'window',
  },
  {
    kind: 'ipSubnet',
    topic: 'l04',
    name: 'IPv4 子网、分片与路由匹配',
    desc: '查看 32 位掩码，用 MTU 推演分片，再按目的地址查找最长前缀。',
    tag: '408 · 计算机网络',
    question: '前缀长度变化时，子网数量、网络地址、广播地址和可用地址占比怎样变化？',
    steps: '1. 选择 /26，记录 4 个子网的网络地址与广播地址。\n2. 把子网序号从 0 调到 3。\n3. 改成 /30，观察每个子网只剩 2 个可用地址。',
    observation: '子网块大小 = 2^(32−前缀)；网络地址是块起点，广播地址是块终点，可用地址去掉首尾。',
    keywords: ['子网划分', '前缀', '掩码', '网络地址', '广播地址', 'CIDR'],
    preview: 'subnet',
  },
];

export interface Lab408WorkbenchTemplate {
  kind: Lab408WorkbenchKind;
  topic: Lab408Topic['id'];
  name: string;
  desc: string;
  tag: string;
  question: string;
  steps: string;
  observation: string;
  preview: Lab408Preview;
  subjectIndex: number;
  typeId: string;
}

export const LAB408_WORKBENCH_TEMPLATES: readonly Lab408WorkbenchTemplate[] = [
  {
    kind: 'dsWorkbench',
    topic: 'l01',
    name: '数据结构全题型工作台',
    desc: '覆盖 18 个数据结构题型；选择题型、改原文，调用本地内核。',
    tag: '408 · 数据结构 · 全题型',
    question: '把排序、树、图、查找或复杂度题改写后，内核还能给出一致结论吗？',
    steps: '1. 在工作台切换到排序、树图或查找题型。\n2. 按原题改写数据与要求。\n3. 求解后核对答案、步骤与限制。',
    observation: '同一工作台可切换该科目的全部题型；换题会重置模板，需要重新填入原题条件。',
    preview: 'sort',
    subjectIndex: 0,
    typeId: 'ds_sort',
  },
  {
    kind: 'coWorkbench',
    topic: 'l02',
    name: '组成原理全题型工作台',
    desc: '覆盖 12 个组成原理题型；从 Cache、浮点到流水线都可直接求解。',
    tag: '408 · 组成原理 · 全题型',
    question: '数据表示、存储层次和流水线的结论能否在同一画布里逐项复核？',
    steps: '1. 选择题型（Cache、浮点、流水线等）。\n2. 修改位数、时钟或容量。\n3. 对照答案和内核步骤。',
    observation: '不同题型需要完整条件；地址位数、块大小、CPI 等缺失时内核会保留阻塞原因。',
    preview: 'cache',
    subjectIndex: 1,
    typeId: 'co_pipeline',
  },
  {
    kind: 'osWorkbench',
    topic: 'l03',
    name: '操作系统全题型工作台',
    desc: '覆盖 13 个操作系统题型；调度、置换、文件与磁盘都可切换。',
    tag: '408 · 操作系统 · 全题型',
    question: '同一组进程或页面序列，换算法后内核能否给出可比较的指标？',
    steps: '1. 选择题型（调度、置换、文件、磁盘等）。\n2. 修改进程表、访问序列或权限。\n3. 核对周转、缺页或访问时间。',
    observation: '调度与置换题依赖完整表格和序列；缺数据时不会猜测，结果会标为条件未完整。',
    preview: 'cpu',
    subjectIndex: 2,
    typeId: 'os_cpu_schedule',
  },
  {
    kind: 'netWorkbench',
    topic: 'l04',
    name: '计算机网络全题型工作台',
    desc: '覆盖 17 个计算机网络题型；子网、路由、TCP 与应用层都可求解。',
    tag: '408 · 计算机网络 · 全题型',
    question: '从地址划分到 TCP 拥塞控制，各层结论能否用同一套确定性内核核对？',
    steps: '1. 选择题型（子网、路由、TCP、HTTP 等）。\n2. 修改地址、窗口或报文数据。\n3. 核对答案与计算步骤。',
    observation: '网络题目的单位、首部长度和连接方式会直接影响结果；请保留原题全部参数。',
    preview: 'subnet',
    subjectIndex: 3,
    typeId: 'net_tcp_control',
  },
];

export function isLab408Kind(value: string): value is Lab408Kind {
  return LAB408_TEMPLATES.some(template => template.kind === value);
}

export function isLab408WorkbenchKind(value: string): value is Lab408WorkbenchKind {
  return LAB408_WORKBENCH_TEMPLATES.some(template => template.kind === value);
}

export function lab408TemplateDoc(kind: Lab408TemplateKind): CanvasDoc {
  if (isLab408WorkbenchKind(kind)) return lab408WorkbenchDoc(kind);
  const template = LAB408_TEMPLATES.find((item) => item.kind === kind);
  if (!template) throw new Error(`未知 408 模板：${kind}`);
  return build408Pipeline(kind, template.name, `探究：${template.question}\n搭建：${template.steps}\n观察：${template.observation}`);
}

export function lab408WorkbenchDoc(kind: Lab408WorkbenchKind): CanvasDoc {
  const template = LAB408_WORKBENCH_TEMPLATES.find(item => item.kind === kind);
  if (!template) throw new Error(`未知 408 模板：${kind}`);
  const subject = MANUAL_408_SUBJECTS[template.subjectIndex];
  if (!subject) throw new Error('408 工作台科目不存在');
  const types = subject.groups.flatMap(group => group.types);
  const found = types.findIndex(type => type.id === template.typeId);
  const typeIndex = found >= 0 ? found : 0;
  const selected = types[typeIndex];
  const nodes: CanvasNode[] = [];
  const add = (type: NodeType, x: number, y: number, params: Record<string, number> = {}, text?: string): CanvasNode => {
    const node: CanvasNode = { id: nextId('n'), type, x, y, params, ...(text !== undefined ? { text } : {}) };
    nodes.push(node);
    return node;
  };
  add('textNote', 35, 25, {}, `${template.name}\n探究：${template.question}`);
  add('textNote', 355, 25, {}, `动手搭建\n${template.steps}`);
  add('textNote', 675, 25, {}, `预期观察\n${template.observation}\n全题型：可在工作台内切换科目与题型。`);
  const workbench = add('lab408Workbench', 80, 320, { subjectIndex: template.subjectIndex, typeIndex }, selected?.template ?? '');
  add('textNote', 35, 980, {}, '我的观察记录\n我改了哪些参数：\n我先预测：\n实际观察到：\n哪些条件缺失时内核拒绝计算：');
  return {
    version: 1,
    title: template.name,
    zoom: 0.9,
    nodes,
    wires: [],
    strokes: [],
    panel: { title: template.name, view_node_ids: [workbench.id], exposed_params: [] },
  };
}

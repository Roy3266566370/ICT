import { MANUAL_408_SUBJECTS } from '../labs/manual408.ts';
import { nextId } from './math.ts';
import type { CanvasDoc, CanvasNode, NodeType } from './types.ts';

export type Lab408Kind = 'dsTraversal' | 'cacheSplit' | 'pageReplace' | 'ipSubnet';
export type Lab408WorkbenchKind = 'dsWorkbench' | 'coWorkbench' | 'osWorkbench' | 'netWorkbench';
export type Lab408TemplateKind = Lab408Kind | Lab408WorkbenchKind;

export interface Lab408Template {
  kind: Lab408Kind;
  name: string;
  desc: string;
  tag: string;
  question: string;
  steps: string;
  observation: string;
  node: NodeType;
  params: Record<string, number>;
}

export const LAB408_TEMPLATES: readonly Lab408Template[] = [
  {
    kind: 'dsTraversal',
    name: '二叉树遍历：一棵树的四种读法',
    desc: '切换先序、中序、后序与层序，比较同一棵树的访问序列。',
    tag: '408 · 数据结构',
    question: '同一棵二叉树，为什么四种遍历得到不同序列？根结点分别在什么时候被访问？',
    steps: '1. 依次点击先序、中序、后序、层序。\n2. 记录 A、B、C 在每个序列中的位置。\n3. 只用“根、左、右”的访问时机解释差异。',
    observation: '先序根最先；中序根在左右子树之间；后序根最后；层序按层从左到右。',
    node: 'dsTraversal',
    params: { order: 0 },
  },
  {
    kind: 'cacheSplit',
    name: 'Cache 地址：tag / index / offset',
    desc: '调地址位数、块大小、Cache 容量与路数，观察地址三段的位数变化。',
    tag: '408 · 组成原理',
    question: '块大小、Cache 容量和相联路数分别影响哪一段地址？',
    steps: '1. 固定 32 位地址，观察块大小翻倍时 offset 的变化。\n2. 修改 Cache 容量，观察 index 位数。\n3. 修改路数，观察 index 与 tag 如何重新分配。',
    observation: 'offset 由块大小决定；index 由组数决定；tag 补齐剩余位数，三段之和始终等于地址位数。',
    node: 'cacheSplit',
    params: { addrBits: 32, blockBytes: 64, cacheKB: 64, ways: 4 },
  },
  {
    kind: 'pageReplace',
    name: '页面置换：FIFO / LRU / OPT',
    desc: '同一访问序列，三种置换算法的缺页次数不同。',
    tag: '408 · 操作系统',
    question: '同样 3 个物理块，为什么三种算法的缺页次数不同？FIFO 增加物理块一定会更好吗？',
    steps: '1. 依次切换三种算法，记录缺页次数。\n2. 将物理块从 3 改为 4，比较 FIFO 的缺页数。\n3. 找出每个置换时刻被淘汰的页面及理由。',
    observation: 'LRU 淘汰最久未使用页；OPT 淘汰未来最久才使用的页；FIFO 只看装入顺序，会出现 Belady 异常。',
    node: 'pageReplace',
    params: { algorithm: 0, capacity: 3 },
  },
  {
    kind: 'ipSubnet',
    name: 'IPv4 子网划分：网络地址与广播地址',
    desc: '把 192.168.1.0/24 划成 /25～/30 子网，核对每个子网的边界。',
    tag: '408 · 计算机网络',
    question: '前缀长度变化时，子网数量、网络地址和广播地址怎样变化？',
    steps: '1. 选择 /26，记录 4 个子网的网络地址与广播地址。\n2. 把子网序号从 0 调到 3。\n3. 改成 /30，观察每个子网只有 2 个可用地址。',
    observation: '子网块大小 = 2^(32−前缀)；网络地址是块起点，广播地址是块终点；可用主机地址去掉首尾。',
    node: 'ipSubnet',
    params: { prefix: 26, index: 0 },
  },
];

export interface Lab408WorkbenchTemplate {
  kind: Lab408WorkbenchKind;
  name: string;
  desc: string;
  tag: string;
  question: string;
  steps: string;
  observation: string;
  subjectIndex: number;
  typeId: string;
}

export const LAB408_WORKBENCH_TEMPLATES: readonly Lab408WorkbenchTemplate[] = [
  {
    kind: 'dsWorkbench',
    name: '数据结构全题型工作台',
    desc: '覆盖 18 个数据结构题型；选择题型、改原文，调用本地内核。',
    tag: '408 · 数据结构 · 全题型',
    question: '把排序、树、图、查找或复杂度题改写后，内核还能给出一致结论吗？',
    steps: '1. 在工作台切换到排序、树图或查找题型。\n2. 按原题改写数据与要求。\n3. 求解后核对答案、步骤与限制。',
    observation: '同一工作台可切换该科目的全部题型；换题会重置模板，需要重新填入原题条件。',
    subjectIndex: 0,
    typeId: 'ds_sort',
  },
  {
    kind: 'coWorkbench',
    name: '组成原理全题型工作台',
    desc: '覆盖 12 个组成原理题型；从 Cache、浮点到流水线都可直接求解。',
    tag: '408 · 组成原理 · 全题型',
    question: '数据表示、存储层次和流水线的结论能否在同一画布里逐项复核？',
    steps: '1. 选择题型（Cache、浮点、流水线等）。\n2. 修改位数、时钟或容量。\n3. 对照答案和内核步骤。',
    observation: '不同题型需要完整条件；地址位数、块大小、CPI 等缺失时内核会保留阻塞原因。',
    subjectIndex: 1,
    typeId: 'co_pipeline',
  },
  {
    kind: 'osWorkbench',
    name: '操作系统全题型工作台',
    desc: '覆盖 13 个操作系统题型；调度、置换、文件与磁盘都可切换。',
    tag: '408 · 操作系统 · 全题型',
    question: '同一组进程或页面序列，换算法后内核能否给出可比较的指标？',
    steps: '1. 选择题型（调度、置换、文件、磁盘等）。\n2. 修改进程表、访问序列或权限。\n3. 核对周转、缺页或访问时间。',
    observation: '调度与置换题依赖完整表格和序列；缺数据时不会猜测，结果会标为条件未完整。',
    subjectIndex: 2,
    typeId: 'os_cpu_schedule',
  },
  {
    kind: 'netWorkbench',
    name: '计算机网络全题型工作台',
    desc: '覆盖 17 个计算机网络题型；子网、路由、TCP 与应用层都可求解。',
    tag: '408 · 计算机网络 · 全题型',
    question: '从地址划分到 TCP 拥塞控制，各层结论能否用同一套确定性内核核对？',
    steps: '1. 选择题型（子网、路由、TCP、HTTP 等）。\n2. 修改地址、窗口或报文数据。\n3. 核对答案与计算步骤。',
    observation: '网络题目的单位、首部长度和连接方式会直接影响结果；请保留原题全部参数。',
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
  const template = LAB408_TEMPLATES.find(item => item.kind === kind);
  if (!template) throw new Error('408 模板不存在');
  const nodes: CanvasNode[] = [];
  const add = (type: NodeType, x: number, y: number, params: Record<string, number> = {}, text?: string): CanvasNode => {
    const node: CanvasNode = { id: nextId('n'), type, x, y, params, ...(text !== undefined ? { text } : {}) };
    nodes.push(node);
    return node;
  };
  add('textNote', 35, 25, {}, `${template.name}\n探究：${template.question}`);
  add('textNote', 355, 25, {}, `动手搭建\n${template.steps}`);
  add('textNote', 675, 25, {}, `预期观察\n${template.observation}`);
  add(template.node, 80, 320, template.params);
  add('textNote', 35, 900, {}, '我的观察记录\n我改了哪些参数：\n我先预测：\n实际观察到：\n哪些结果需要用公式或证明解释：');
  return { version: 1, title: template.name, zoom: 0.9, nodes, wires: [], strokes: [] };
}

export function lab408WorkbenchDoc(kind: Lab408WorkbenchKind): CanvasDoc {
  const template = LAB408_WORKBENCH_TEMPLATES.find(item => item.kind === kind);
  if (!template) throw new Error('408 工作台模板不存在');
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
  add('lab408Workbench', 80, 320, { subjectIndex: template.subjectIndex, typeIndex }, selected?.template ?? '');
  add('textNote', 35, 980, {}, '我的观察记录\n我改了哪些参数：\n我先预测：\n实际观察到：\n哪些条件缺失时内核拒绝计算：');
  return { version: 1, title: template.name, zoom: 0.9, nodes, wires: [], strokes: [] };
}

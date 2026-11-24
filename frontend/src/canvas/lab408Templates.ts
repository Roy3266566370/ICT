import { build408Pipeline } from './lab408Pipeline.ts';
import type { CanvasDoc } from './types.ts';

export interface Lab408Topic {
  id: 'l01' | 'l02' | 'l03' | 'l04';
  name: string;
  lead: string;
}

export type Lab408Kind =
  | 'dsTraversal' | 'avl' | 'kmpSort' | 'graphAlgo' | 'cacheSimLab' | 'pipelineLab' | 'ieee754Lab'
  | 'cpuScheduleLab' | 'bankerLab' | 'pageReplace' | 'tcpCongestionLab' | 'slidingWindowLab' | 'ipSubnet'
  | 'btreeLab' | 'hashTableLab' | 'cpuDatapathLab' | 'aluBoothLab'
  | 'diskScheduleLab' | 'pvSyncLab' | 'csmaCdLab' | 'routingLab';

export type Lab408Preview =
  | 'tree' | 'kmp' | 'sort' | 'graph' | 'cache' | 'pipeline' | 'ieee'
  | 'split' | 'cpu' | 'banker' | 'page' | 'tcp' | 'window' | 'subnet'
  | 'btree' | 'hash' | 'datapath' | 'booth' | 'disk' | 'pv' | 'csma' | 'routing';

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
  { id: 'l01', name: '专题 01 · 数据结构', lead: '树遍历、哈夫曼与 AVL 之外，再看 B/B+ 树分裂、散列冲突、KMP、排序与图算法。' },
  { id: 'l02', name: '专题 02 · 组成原理', lead: '从虚拟地址、Cache、流水线到 CPU 数据通路、补码溢出与 Booth 乘法。' },
  { id: 'l03', name: '专题 03 · 操作系统', lead: 'CPU 调度、银行家、页面置换之外，再看磁盘寻道与 PV 生产者消费者死锁。' },
  { id: 'l04', name: '专题 04 · 计算机网络', lead: '从 TCP 窗口、GBN / SR、IPv4 子网，到 CSMA/CD 冲突检测与 RIP / OSPF 收敛。' },
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
  {
    kind: 'btreeLab',
    topic: 'l01',
    name: 'B 树 / B+ 树插入分裂',
    desc: '逐次插入、节点分裂、关键字上移，并对比 B 树与 B+ 树的查找路径。',
    tag: '408 · 数据结构 · 树',
    question: '节点关键字超过 m−1 时如何提取中间键上移并分裂？B+ 树与 B 树在非叶节点和叶子链表上有什么区别？',
    steps: '1. 选择 3/4/5 阶与 B/B+ 树。\n2. 逐步插入序列，观察分裂前后节点。\n3. 输入目标关键字，核对查找路径与比较次数。',
    observation: 'B 树内部节点也保存关键字；B+ 树内部节点只做分隔，查找总落到叶子。',
    keywords: ['B 树', 'B+ 树', '分裂', '阶数', '查找路径', '关键字'],
    preview: 'btree',
  },
  {
    kind: 'hashTableLab',
    topic: 'l01',
    name: '散列表冲突与 ASL 对比',
    desc: '线性探测、二次探测与链地址法逐次插入，对比成功/失败 ASL。',
    tag: '408 · 数据结构 · 查找',
    question: '装填因子 α 升高时，为什么线性探测会出现二次聚集？链地址法如何缓解？',
    steps: '1. 选择表长与除留余数 p。\n2. 切换三种冲突策略，逐步插入。\n3. 对照成功 ASL、失败 ASL 与最大探测次数。',
    observation: '线性探测容易形成连续聚集；二次探测打散探测序列；链地址法把冲突放到链上。',
    keywords: ['散列表', '哈希', '线性探测', '二次探测', '链地址法', 'ASL', '装填因子'],
    preview: 'hash',
  },
  {
    kind: 'cpuDatapathLab',
    topic: 'l02',
    name: 'CPU 指令周期与数据通路',
    desc: 'ADD / LW / SW / BEQ 的逐拍数据通路、控制信号与 CPI 对照。',
    tag: '408 · 组成原理 · CPU',
    question: '执行 LW、ADD、SW、BEQ 时数据经过哪些部件？哪些控制信号被拉高？',
    steps: '1. 选择指令与单/多周期模式。\n2. 逐拍查看活跃部件与控制信号。\n3. 对比单周期与多周期的 CPI 和总延迟。',
    observation: '多周期把一条指令拆成 IF/ID/EX/MEM/WB，每拍只激活必要部件；单周期所有部件在一个长周期内完成。',
    keywords: ['CPU', '数据通路', '指令周期', '控制信号', 'CPI', '单周期', '多周期'],
    preview: 'datapath',
  },
  {
    kind: 'aluBoothLab',
    topic: 'l02',
    name: '补码溢出与 Booth 乘法',
    desc: '双符号位判定加减溢出，Booth 一位乘逐拍展示部分积与移位。',
    tag: '408 · 组成原理 · 运算',
    question: '双符号位 01/10 如何瞬间判定正负溢出？Booth 乘法为什么能直接处理补码？',
    steps: '1. 选择位宽与操作数。\n2. 切到补码加减，逐位观察进位和双符号位。\n3. 切到 Booth 乘法，逐拍查看 A、Q、Q₋₁ 与动作。',
    observation: '双符号位 01 表示正溢出，10 表示负溢出；Booth 根据 Q₀Q₋₁ 选择 +X、−X 或只移位。',
    keywords: ['补码', '溢出', '双符号位', 'Booth', '乘法', '部分积'],
    preview: 'booth',
  },
  {
    kind: 'diskScheduleLab',
    topic: 'l03',
    name: '磁盘寻道算法轨迹对比',
    desc: 'FCFS / SSTF / SCAN / C-SCAN 的磁头轨迹、总寻道与单次最大跨越。',
    tag: '408 · 操作系统 · 磁盘',
    question: '同一组磁道请求，为什么 SSTF 可能饥饿？SCAN 与 C-SCAN 的折返差异在哪里？',
    steps: '1. 输入磁道序列与初始磁头。\n2. 选择方向与主展示算法。\n3. 对照四种算法的总寻道、平均寻道与最大跨越。',
    observation: 'SSTF 每次选最近磁道；SCAN 到端点后折返；C-SCAN 单向扫描后回到另一端重新开始。',
    keywords: ['磁盘调度', 'FCFS', 'SSTF', 'SCAN', 'C-SCAN', '寻道长度'],
    preview: 'disk',
  },
  {
    kind: 'pvSyncLab',
    topic: 'l03',
    name: 'PV 信号量与生产者消费者',
    desc: '逐帧缓冲区、empty/full/mutex 与阻塞队列，错误顺序直接演示死锁。',
    tag: '408 · 操作系统 · 同步',
    question: '把 P(mutex) 和 P(empty) 的顺序写反，系统会在哪一帧卡死？',
    steps: '1. 设置缓冲区大小与事件脚本。\n2. 先选正确顺序，观察一进一出。\n3. 切到错误顺序，定位持锁等待的死锁帧。',
    observation: '正确顺序先申请资源再进入临界区；先 P(mutex) 会持锁等待资源，消费者无法获取互斥锁而永久阻塞。',
    keywords: ['PV 操作', '信号量', '生产者消费者', '互斥', '死锁', '缓冲区'],
    preview: 'pv',
  },
  {
    kind: 'csmaCdLab',
    topic: 'l04',
    name: 'CSMA/CD 冲突检测与最短帧长',
    desc: '总线传播、碰撞时刻、检测窗口与二进制指数退避，一眼看出短帧漏检。',
    tag: '408 · 计算机网络 · 链路层',
    question: '为什么以太网要规定最短帧长？帧发得太短时，冲突信号还没返回会发生什么？',
    steps: '1. 设置总线长度、带宽、帧长与 B 站延迟。\n2. 查看 A/B 信号时间轴与碰撞点。\n3. 比较发送时延与争用期，判断是否可靠检测。',
    observation: '发送时延必须覆盖争用期 2τ，冲突信号才能被检测到；帧太短会先发完，冲突漏检。',
    keywords: ['CSMA/CD', '争用期', '最短帧长', '冲突检测', '二进制指数退避', '以太网'],
    preview: 'csma',
  },
  {
    kind: 'routingLab',
    topic: 'l04',
    name: 'RIP 与 OSPF 收敛对比',
    desc: '断链后 RIP 距离向量计数到无穷，OSPF 链路状态一轮重算最短路。',
    tag: '408 · 计算机网络 · 网络层',
    question: '链路断开后，为什么 RIP 会出现坏消息传得慢，而 OSPF 能迅速重算？',
    steps: '1. 选择故障注入与水平分割。\n2. 查看 RIP 每轮路由表与计数增长。\n3. 切到 OSPF，对照收敛轮次与报文范围。',
    observation: 'RIP 只与邻居交换距离向量，拓扑信息传播慢；OSPF 泛洪链路状态并各自运行 Dijkstra。',
    keywords: ['RIP', 'OSPF', '距离向量', '链路状态', '计数到无穷', '水平分割', '收敛'],
    preview: 'routing',
  },
];

export function isLab408Kind(value: string): value is Lab408Kind {
  return LAB408_TEMPLATES.some(template => template.kind === value);
}

export function lab408TemplateDoc(kind: Lab408Kind): CanvasDoc {
  const template = LAB408_TEMPLATES.find((item) => item.kind === kind);
  if (!template) throw new Error(`未知 408 模板：${kind}`);
  return build408Pipeline(kind, template.name, `探究：${template.question}\n搭建：${template.steps}\n观察：${template.observation}`);
}

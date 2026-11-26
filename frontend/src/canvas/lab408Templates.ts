import { build408Pipeline } from './lab408Pipeline.ts';
import { isLab408SandboxKind, lab408SandboxDoc, type Lab408SandboxKind } from './lab408Sandboxes.ts';
import type { CanvasDoc } from './types.ts';

export interface Lab408Topic {
  id: 'l01' | 'l02' | 'l03' | 'l04';
  name: string;
  lead: string;
}

/** 旧版单点流水线模板 kind（仍可通过 ?template= 打开，见 legacy 标记）。 */
export type Lab408PipelineKind =
  | 'dsTraversal' | 'avl' | 'kmpSort' | 'graphAlgo' | 'cacheSimLab' | 'pipelineLab' | 'ieee754Lab'
  | 'cpuScheduleLab' | 'bankerLab' | 'pageReplace' | 'tcpCongestionLab' | 'slidingWindowLab' | 'ipSubnet'
  | 'btreeLab' | 'hashTableLab' | 'cpuDatapathLab' | 'aluBoothLab'
  | 'diskScheduleLab' | 'pvSyncLab' | 'csmaCdLab' | 'routingLab';

export type Lab408Kind = Lab408PipelineKind | Lab408SandboxKind;

export type Lab408Preview =
  | 'tree' | 'kmp' | 'sort' | 'graph' | 'cache' | 'pipeline' | 'ieee'
  | 'split' | 'cpu' | 'banker' | 'page' | 'tcp' | 'window' | 'subnet'
  | 'btree' | 'hash' | 'datapath' | 'booth' | 'disk' | 'pv' | 'csma' | 'routing' | 'dnsStack';

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
  formula?: string;
  panorama?: true;
  legacy?: true;
}

export const LAB408_TOPICS: readonly Lab408Topic[] = [
  { id: 'l01', name: '专题 01 · 数据结构', lead: '一组输入同时驱动遍历/哈夫曼/AVL、Prim 与 Dijkstra、B 树分裂与散列聚集、三排序擂台。' },
  { id: 'l02', name: '专题 02 · 组成原理', lead: 'IEEE 754 位段、补码溢出、Cache 组相联、数据通路与 5 级流水线——同一参数多视角互证。' },
  { id: 'l03', name: '专题 03 · 操作系统', lead: '进程表驱动四调度甘特、PV 错序死锁复现、页框数直击 Belady 异常、磁头轨迹擂台。' },
  { id: 'l04', name: '专题 04 · 计算机网络', lead: '链路参数驱动编码/ARQ/CSMA、子网位段与路由收敛、cwnd 锯齿、五层全栈贯通。' },
];

/** 一源多路全景沙盘（置顶可见）。旧 21 个单点流水线模板保留在下方 legacy 区以兼容已保存作品与链接。 */
const sandboxEntry = (
  kind: Lab408SandboxKind, topic: Lab408Topic['id'],
  name: string, desc: string, tag: string,
  question: string, steps: string, observation: string,
  keywords: readonly string[], preview: Lab408Template['preview'], formula: string,
): Lab408Template => ({
  kind, topic, name, desc, tag, question, steps, observation, keywords, preview, formula, panorama: true,
});

export const LAB408_TEMPLATES: readonly Lab408Template[] = [
  sandboxEntry('ds01-linear-string', 'l01', '线性表、栈队列与 KMP',
    '序列源同驱表达式双栈、循环队列指针与 KMP 三算法回退擂台。',
    '408 · 数据结构 · 全景沙盘 · 第 1–3 章',
    '栈和循环队列的指针什么时候重合？nextval 为什么比 next 少回退？',
    '改序列源看栈队列指针演化；换模式串对比朴素/next/nextval 的比较次数与回退轨迹。',
    '循环队列用 (rear+1)%m=front 判满；nextval 在 next[j] 字符相同时继续前跳，削掉无效比较。',
    ['线性表', '栈', '循环队列', 'KMP', 'next', 'nextval'], 'kmp', 'next[j] ← nextval[j]'),
  sandboxEntry('ds02-trees', 'l01', '二叉树、哈夫曼与 AVL',
    '同一插入序列喂 BST 四遍历、哈夫曼合并与 AVL 旋转修复。',
    '408 · 数据结构 · 全景沙盘 · 第 4 章',
    '同序列为什么四种遍历次序不同？30,20,10 和 30,10,20 的旋转差在哪？',
    '改插入序列看四遍历栈/队列演化、哈夫曼逐轮合并最小两堆、AVL 单双旋修复。',
    '遍历差在根的访问时机；哈夫曼 WPL 最小；LL/RR 单旋，LR/RL 先旋子树再旋根。',
    ['二叉树', '遍历', '哈夫曼', 'WPL', 'AVL', '旋转'], 'tree', 'WPL = Σ wᵢ·lᵢ'),
  sandboxEntry('ds03-graphs', 'l01', '图的遍历、生成树与最短路',
    '一张边表同时驱动 Prim/Dijkstra 擂台、Floyd 热图与拓扑+关键路径。',
    '408 · 数据结构 · 全景沙盘 · 第 5 章',
    '最短路径树和最小生成树为什么可能不同？AOE 网里哪条路径卡住工期？',
    '改边表文本三视图同步重算；拖起点对比 Prim 割集选边与 Dijkstra 逐点锁定；看 Floyd 矩阵与关键路径松弛。',
    'Prim 选跨割最小边，Dijkstra 锁最小 dist；Floyd 经 k 中转松弛；关键活动松弛为 0 即瓶颈。',
    ['图', 'Prim', 'Kruskal', 'Dijkstra', 'Floyd', '拓扑排序', '关键路径'], 'graph', 'd[v] ← min(d[v], d[u]+w)'),
  sandboxEntry('ds04-search-sort', 'l01', 'B 树、散列与内部排序',
    '同一序列驱动 B 树分裂、散列探测热图与快排/堆排/归并擂台。',
    '408 · 数据结构 · 全景沙盘 · 第 6–7 章',
    '装填因子升高时线性探测为何聚集？同序列快排为何退化成链表？',
    '改序列与阶数看 B 树中间键上移分裂；调装填因子看探测聚集爆发；三排序逐帧计比较交换。',
    'B 树 m 阶分裂上推中键；α 越大探测链越长且一次聚集；快排遇有序序列退化 O(n²)。',
    ['B 树', 'B+ 树', '散列', '线性探测', 'ASL', '快速排序', '堆排序'], 'sort', 'α = n/m · ASL'),
  sandboxEntry('co01-data-alu', 'l02', '数据表示、IEEE 754 与 ALU',
    '数值输入同时拆解 IEEE 位段、双符号位溢出与 Booth 乘法逐拍。',
    '408 · 组成原理 · 全景沙盘 · 第 1–2 章',
    '阶码全 0 与全 1 边界各代表什么？双符号位 01/10 如何一票判溢出？',
    '拨阶码滑杆看非规格化、±∞、NaN 切换；改操作数看双符号位判定与 Booth 移位表。',
    'E=0 非规格化（隐含 0.M）、E=全 1 为 ∞/NaN；双符号位 01 正溢出、10 负溢出。',
    ['原码', '补码', 'IEEE754', '阶码', '溢出', '双符号位', 'Booth'], 'ieee', 'x = (−1)ˢ × M × 2ᴱ'),
  sandboxEntry('co02-memory-cache', 'l02', '主存、Cache 映射与虚拟存储',
    '地址流同时喂位段切分、组相联网格与路数-AMAT 擂台。',
    '408 · 组成原理 · 全景沙盘 · 第 3 章',
    '同一地址流为什么直接映射全 Miss 而 2 路立刻全 Hit？AMAT 由哪三部分构成？',
    '换地址流预设看局部性/抖动差异；拖路数看组相联网格淘汰变化与命中率-AMAT 曲线。',
    'tag/index/offset 由容量与路数切分；组内 tag 全比较，LRU 淘汰最旧；AMAT=命中+缺失率×罚时。',
    ['Cache', 'TLB', '页表', '组相联', 'LRU', 'AMAT', '地址切分'], 'cache', 'AMAT = tₕ + p×tₚ'),
  sandboxEntry('co03-isa-cpu', 'l02', '指令系统与 CPU 数据通路',
    '指令选择同步点亮寻址方式、数据通路逐拍与控制信号真值表。',
    '408 · 组成原理 · 全景沙盘 · 第 4–5 章',
    'LOAD/ADD/BEQ 经过数据通路的哪些部件？各寻址方式的有效地址怎么算？',
    '切换指令类型逐拍点亮 PC→IR→ALU→Reg 通路，对照控制信号表与 EA 公式。',
    '立即/直接/间接/基址寻址各给不同 EA；五阶段 IF/ID/EX/MEM/WB 每拍只激活必要部件。',
    ['指令', '寻址方式', '数据通路', '控制信号', '微操作'], 'datapath', 'EA = (Rx) + D'),
  sandboxEntry('co04-pipeline-io', 'l02', '5 级流水线、总线与 I/O',
    '同一指令流驱动时空图、转发开关 CPI 对比与三 I/O 方式占用。',
    '408 · 组成原理 · 全景沙盘 · 第 5–7 章',
    '关掉转发后 Load-Use 相关多出几个气泡？DMA 凭什么把 CPU 占用压到极低？',
    '开关转发对照时空图气泡与 CPI；比较程序查询/中断/DMA 的 CPU 占用时间轴。',
    '转发可消多数 RAW 停顿但 Load-Use 仍需 1 气泡；DMA 只在开始结束打扰 CPU。',
    ['流水线', '数据冒险', '转发', '气泡', '中断', 'DMA'], 'pipeline', 'CPI = 周期数/指令数'),
  sandboxEntry('os01-process-sched', 'l03', '进程状态与 CPU 调度',
    '同一进程表驱动 FCFS/SJF/SRTF/RR 甘特与周转指标擂台。',
    '408 · 操作系统 · 全景沙盘 · 第 1–2 章',
    '时间片从 4 调到 1，RR 响应变快的代价是什么？',
    '改进程表（数组成对：到达,服务）与时间片，看四算法甘特、周转/带权周转与切换次数。',
    'SJF/SRTF 平均周转最小但可能饥饿；RR 时间片小则响应快、切换开销大。',
    ['进程', '调度', 'FCFS', 'SJF', 'RR', '周转时间', '甘特图'], 'cpu', '周转 = 完成 − 到达'),
  sandboxEntry('os02-sync-deadlock', 'l03', 'PV 同步互斥与银行家',
    '缓冲区参数同步驱动 PV 逐帧演化、错序死锁复现与安全序列推演。',
    '408 · 操作系统 · 全景沙盘 · 第 2 章',
    'P(mutex) 和 P(empty) 颠倒后，系统在哪一帧永久卡死？',
    '调缓冲区大小与事件脚本看信号量值、阻塞队列；切错序触发死锁；银行家试探安全序列。',
    '先申请资源再进临界区；颠倒后持锁等资源死锁；安全判定按 Need≤Available 逐进程推进。',
    ['PV', '信号量', '生产者消费者', '死锁', '银行家'], 'pv', 'Need = Max − Alloc'),
  sandboxEntry('os03-memory-vm', 'l03', '内存分配、分页与页面置换',
    'Belady 序列同驱页框网格、四算法缺页竞赛与 FF/BF/WF 碎片。',
    '408 · 操作系统 · 全景沙盘 · 第 3 章',
    '物理块从 3 加到 4，为什么 FIFO 缺页反而变多？',
    '换序列预设看 Belady 异常 9→10；拖页框数看四种算法缺页曲线分岔；切分配场景看碎片。',
    'FIFO 非栈式算法有 Belady 异常；OPT 最优下界，LRU 近似最优；FF/BF/WF 外碎片各异。',
    ['页面置换', 'FIFO', 'LRU', 'OPT', 'Clock', 'Belady'], 'page', 'FIFO / LRU / OPT'),
  sandboxEntry('os04-file-io', 'l03', '文件索引与磁盘调度',
    '同一磁道序列驱动四寻道算法轨迹擂台、inode 索引与位示图。',
    '408 · 操作系统 · 全景沙盘 · 第 4–5 章',
    'SSTF 最近优先为何仍可能饥饿？UNIX 混合索引的最大文件多大？',
    '改磁道序列与初始磁头看 FCFS/SSTF/SCAN/C-SCAN 轨迹与总寻道；切块大小算 inode 容量。',
    'SSTF 贪心最近可能饥饿远侧请求；SCAN 往返电梯；多级索引 10+2^10+2^20+2^30 块。',
    ['磁盘调度', 'SSTF', 'SCAN', 'inode', '混合索引', '位示图'], 'disk', '总寻道 = Σ|Δtrack|'),
  sandboxEntry('cn01-phys-datalink', 'l04', '编码、滑动窗口与 CSMA/CD',
    '链路参数同驱曼彻斯特编码、停等/GBN/SR 利用率与争用期检测。',
    '408 · 计算机网络 · 全景沙盘 · 第 2–3 章',
    '拉长链路后，多长的帧才能保证冲突被检测到？GBN 为何一次回退重传一串？',
    '拖链路距离看 2τ 争用期与最小帧长变化；对比三种 ARQ 丢帧重传轨迹与信道利用率。',
    'L_min = 2τR；曼彻斯特中点跳变；GBN 累计确认回退 N，SR 只补出错帧。',
    ['曼彻斯特', 'CRC', 'GBN', 'SR', 'CSMA/CD', '争用期'], 'csma', 'L_min = 2τ·R'),
  sandboxEntry('cn02-ip-routing', 'l04', 'IPv4 子网、分片与路由收敛',
    '拓扑源同驱 CIDR 位段、RIP 计数到无穷与 OSPF 秒级收敛。',
    '408 · 计算机网络 · 全景沙盘 · 第 4 章',
    '断链后 RIP 为何坏消息传得慢，OSPF 却一轮重算？分片偏移为什么以 8B 为单位？',
    '切网络拓扑与断链看 RIP 轮次膨胀与 OSPF 泛洪重算；调前缀长度看子网位段与分片表。',
    'RIP 只和邻居换向量慢收敛；OSPF 泛洪链路状态各自 Dijkstra；片偏移字段 13 位以 8B 计量。',
    ['CIDR', '子网', '分片', 'RIP', 'OSPF', '最长前缀'], 'routing', '偏移 × 8B'),
  sandboxEntry('cn03-tcp-transport', 'l04', 'TCP 连接管理、流量与拥塞控制',
    'ssthresh/rwnd 双滑杆同驱 cwnd 锯齿、握手挥手时序与窗口限流。',
    '408 · 计算机网络 · 全景沙盘 · 第 5 章',
    '超时和三个冗余 ACK 对 cwnd 和 ssthresh 的处理差在哪？',
    '拖 ssthresh 看锯齿拐点；切丢包类型对比归 1 与减半；看 min(cwnd,rwnd) 限流与状态机时序。',
    '慢开始指数翻倍、拥塞避免线性+1；超时 ssthresh=cwnd/2、cwnd=1；快恢复 cwnd=ssthresh。',
    ['TCP', '拥塞控制', '慢开始', '快重传', '滑动窗口', 'TIME_WAIT'], 'tcp', 'cwnd ← cwnd+1/cwnd'),
  sandboxEntry('cn04-app-fullpath', 'l04', 'DNS、HTTP 与五层全栈贯通',
    'RTT 与连接模式同驱 DNS/HTTP 时序、报文逐层封装与耗时擂台。',
    '408 · 计算机网络 · 全景沙盘 · 第 6 章',
    '持久连接与流水线为什么能把总 RTT 腰斩？报文穿过五层各加了什么首部？',
    '切非持久/持久/流水线 HTTP 对比总 RTT；看 DNS 递归跳转与五层加/去首部动画。',
    '非持久每对象 TCP+HTTP 两 RTT；持久复用连接省握手；流水线并发请求再省一轮。',
    ['DNS', 'HTTP', 'RTT', '持久连接', '协议栈', '封装'], 'dnsStack', 'RTT × n → 2 RTT'),

  {
    kind: 'dsTraversal', legacy: true,
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
    kind: 'avl', legacy: true,
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
    kind: 'kmpSort', legacy: true,
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
    kind: 'graphAlgo', legacy: true,
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
    kind: 'cacheSimLab', legacy: true,
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
    kind: 'pipelineLab', legacy: true,
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
    kind: 'ieee754Lab', legacy: true,
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
    kind: 'cpuScheduleLab', legacy: true,
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
    kind: 'bankerLab', legacy: true,
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
    kind: 'pageReplace', legacy: true,
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
    kind: 'tcpCongestionLab', legacy: true,
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
    kind: 'slidingWindowLab', legacy: true,
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
    kind: 'ipSubnet', legacy: true,
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
    kind: 'btreeLab', legacy: true,
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
    kind: 'hashTableLab', legacy: true,
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
    kind: 'cpuDatapathLab', legacy: true,
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
    kind: 'aluBoothLab', legacy: true,
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
    kind: 'diskScheduleLab', legacy: true,
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
    kind: 'pvSyncLab', legacy: true,
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
    kind: 'csmaCdLab', legacy: true,
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
    kind: 'routingLab', legacy: true,
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

/** 目录与活页插件展示的 408 模板：只有 4 科 × 4 章全景沙盘。 */
export const VISIBLE_LAB408_TEMPLATES: readonly Lab408Template[] =
  LAB408_TEMPLATES.filter((template) => !template.legacy);

export function isLab408Kind(value: string): value is Lab408Kind {
  return LAB408_TEMPLATES.some(template => template.kind === value);
}

export function lab408TemplateDoc(kind: Lab408Kind): CanvasDoc {
  const template = LAB408_TEMPLATES.find((item) => item.kind === kind);
  if (!template) throw new Error(`未知 408 模板：${kind}`);
  if (isLab408SandboxKind(kind)) return lab408SandboxDoc(kind, template.name);
  return build408Pipeline(kind, template.name, `探究：${template.question}\n搭建：${template.steps}\n观察：${template.observation}`);
}

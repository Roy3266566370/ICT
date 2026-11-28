# 定象坊 · 408 专题实验扩充与增强实施方案

> **目标读者**：负责具体编码落地的执行 Agent  
> **背景**：原 4 个「408 全题型工作台」已从目录移除。当前 408 专题保留 13 个独立逐帧实验（数据结构 4、组成原理 3、操作系统 3、计算机网络 3）。本方案旨在**补齐 8 个高可视化、真内核驱动的单点实验**（扩充至 21 个，每科 5~6 个），同时**增强现有 13 个实验的情景预设与活页嵌入体验**。

---

## 一、 现状架构与必须遵守的接入规范

408 实验采用声明式多阶段管线架构，**无需新建独立 React 节点组件**，所有新实验均通过注册管线 stage 自动获得画布编排、仪表台主舞台（`InstrumentStage`）、时间轴播放及通文册插件嵌入能力：

| 文件 | 职责 |
| :--- | :--- |
| `frontend/src/canvas/lab408PipelineTypes.ts` | 定义 `DiagramKind`、`PipelineControl`、`PipelineFrame`、`PipelineStage`、`PipelineDefinition` |
| `frontend/src/canvas/lab408PipelineDs.ts` | 数据结构管线实现（`dsPipelines`） |
| `frontend/src/canvas/lab408PipelineCo.ts` | 组成原理管线实现（`coPipelines`） |
| `frontend/src/canvas/lab408PipelineOs.ts` | 操作系统管线实现（`osPipelines`） |
| `frontend/src/canvas/lab408PipelineNet.ts` | 计算机网络管线实现（`netPipelines`） |
| `frontend/src/canvas/lab408Pipeline.ts` | 汇总四科管线，提供 `find408Stage` / `evaluate408Stage` / `build408Pipeline` |
| `frontend/src/canvas/lab408Templates.ts` | 维护 `Lab408Kind`、`LAB408_TOPICS`、`LAB408_TEMPLATES`、`Lab408Preview` |
| `frontend/src/canvas/templateCatalog.ts` | 维护 `workshopFormulas` 公式展示映射 |
| `frontend/src/pages/WorkshopPage.tsx` | 维护 `Lab408Preview` 对应的模板卡片缩略图 SVG |
| `frontend/src/canvas/InstrumentStage.tsx` | 维护 `processStages`（主过程阶段与辅助对比阶段的映射，用于主舞台自动选图） |

### 强制约束
1. **纯前端真实计算**：所有新实验的 `stage.run(...)` 必须是确定性算法逐帧推演，禁止写死假帧或编造结果；非法输入抛出可读的中文 `Error` 信息。
2. **完整接线**：每新增 1 个 `Lab408Kind`，必须同步更新以下 **6 处**：
   - 对应学科的 `lab408Pipeline{Ds|Co|Os|Net}.ts`
   - `lab408Templates.ts`（`Lab408Kind`、`LAB408_TEMPLATES`，按需扩展 `Lab408Preview`）
   - `templateCatalog.ts`（`workshopFormulas`）
   - `InstrumentStage.tsx`（`processStages` 映射，确保主舞台默认展示最核心的图形/时间轴/对比阶段）
   - `WorkshopPage.tsx`（如有新增 `preview` 枚举，补齐卡片缩略图 SVG）
   - 对应单元测试文件 `lab408Pipeline{Ds|Co|Os|Net}.test.ts`

---

## 二、 阶段 0：残留清理（先做，预计 5 分钟）

在 `frontend/src/canvas/lab408Templates.ts` 中清理移除工作台后的残留：
1. 删除未使用的 `import { MANUAL_408_SUBJECTS } from '../labs/manual408.ts';` 与 `Lab408WorkbenchKind` / `Lab408TemplateKind` 类型。
2. 修改 `LAB408_TOPICS` 中 `l03` 的 `lead` 文案，去掉 `"末尾是 13 个题型的全题型工作台。"`。
3. 核查 `WorkshopPage.tsx` 与 `lab408Pipeline*.test.ts` 中是否还有已删除的 `LAB408_WORKBENCH_TEMPLATES` 引用并清理。

---

## 三、 阶段 1：新增 8 个高可视化单点实验（分 4 批按学科落地）

每个实验统一采用 **3~4 个 Stage 的清晰管线**：`输入与参数源（source）` → `核心逐帧算法推演（主舞台）` → `对比/统计读数（summary / chart）`。

### 批次 A：数据结构（`lab408PipelineDs.ts`，`topic: 'l01'`）

#### A1. `btreeLab` · B 树 / B+ 树插入分裂与查找
- **核心教学问题**：节点关键字超过 `m-1` 时如何提取中间键上移并分裂？B+ 树与 B 树在非叶节点和叶子链表上有什么区别？
- **输入与控件**：
  - `text`：逗号分隔的插入关键字序列（默认 `10,20,5,6,12,30,7,17,25,3`）
  - `order`（阶数 `m`）：选项 `3 阶 / 4 阶 / 5 阶`
  - `variant`（结构模式）：选项 `0: B 树` / `1: B+ 树`
  - `target`（查找关键字）：滑杆或数值
- **管线 Stage**：
  1. `input`（`source`）：解析序列、校验阶数与合法整数。
  2. `insert`（`tree` / `graph`）：每插入一个关键字输出 1 帧（若触发分裂则额外输出分裂前/分裂后对比帧），`graph` 节点展示每个块内的关键字列表（如 `[5|6|7]`），高亮当前访问路径与新分裂节点。
  3. `metrics`（`summary`）：展示树高、节点总数、分裂次数、目标关键字查找路径长度。
- **公式栏**：`⌈m/2⌉ − 1 ≤ k ≤ m − 1`

#### A2. `hashTableLab` · 散列表冲突解决与 ASL 对比
- **核心教学问题**：装填因子 `α` 升高时，为什么线性探测会出现“二次聚集”导致查找长度飙升？链地址法如何缓解？
- **输入与控件**：
  - `text`：关键字序列（默认 `19,14,23,1,68,20,84,27,55,11,10,79`）
  - `tableSize`（表长 `m`）：滑杆 `7 ~ 19`（默认 `13`）
  - `modP`（除留余数 `p`）：滑杆 `5 ~ 17`（默认 `13`）
  - `strategy`（冲突策略）：`0: 线性探测` / `1: 二次探测` / `2: 链地址法`
- **管线 Stage**：
  1. `input`（`source`）：解析序列并校验 `p ≤ m`。
  2. `probe`（`array`）：逐个插入关键字，表格/网格高亮初次散列槽位、探测偏移步数与最终落位。
  3. `compare`（`chart` + `summary`）：同组输入下直接对比三种策略的**成功 ASL**、**失败 ASL**、**最大探测次数**与**当前装填因子 α**。
- **公式栏**：`H(key) = key mod p · α = n / m`

---

### 批次 B：计算机组成原理（`lab408PipelineCo.ts`，`topic: 'l02'`）

#### B1. `cpuDatapathLab` · CPU 指令周期与数据通路流光
- **核心教学问题**：执行 `LW`、`ADD`、`SW`、`BEQ` 时，数据在 `PC → MAR → MDR → IR → 寄存器堆 → ALU` 之间经过了哪些拍？哪些控制信号被拉高？
- **输入与控件**：
  - `inst`（指令类型）：`0: ADD R3, R1, R2` / `1: LW R2, 4(R1)` / `2: SW R2, 4(R1)` / `3: BEQ R1, R2, offset`
  - `mode`（周期模式）：`0: 单周期` / `1: 多周期（逐拍）`
- **管线 Stage**：
  1. `program`（`source`）：展示指令汇编、机器码位段（OP / rs / rt / rd / imm）与初始寄存器值。
  2. `datapath`（`graph`）：用 `graph` 节点表示 `PC / IMEM / RegFile / ALU / DMEM / Mux`，每拍高亮当前活跃部件与有效数据边（`active: true`），附带控制信号表（`RegWrite / ALUSrc / MemRead / MemWrite / Branch`）。
  3. `cycles`（`summary`）：对比该指令在单周期与多周期下的 CPI、关键路径延迟与活跃部件数。
- **公式栏**：`取指 IF → 译码 ID → 执行 EX → 访存 MEM → 写回 WB`

#### B2. `aluBoothLab` · 补码加减溢出与 Booth 乘法
- **核心教学问题**：双符号位 `01` / `10` 如何瞬间判定正负溢出？Booth 乘法为什么能直接处理补码而不用单独处理符号位？
- **输入与控件**：
  - `mode`（运算模式）：`0: 双符号位补码加减` / `1: Booth 一位乘`
  - `x`（操作数 X）：滑杆 `-15 ~ 15`（默认 `11`）
  - `y`（操作数 Y）：滑杆 `-15 ~ 15`（默认 `-6`）
  - `bits`（位宽）：`0: 5 位` / `1: 6 位` / `2: 8 位`
- **管线 Stage**：
  1. `operands`（`bits`）：展示 X、Y 的原码、补码、双符号位变形补码。
  2. `steps`（`grid`）：逐拍记录部分积 `A`、乘数寄存器 `Q`、附加位 `Q₋₁`、判定规则（`01→+X`、`10→−X`、`00/11→仅算术右移`）及溢出标志。
  3. `verify`（`summary`）：二进制结果转十进制并与真值 `X ± Y` 或 `X × Y` 自动核对。
- **公式栏**：`[X+Y]补 = [X]补 + [Y]补 (mod 2ⁿ)`

---

### 批次 C：操作系统（`lab408PipelineOs.ts`，`topic: 'l03'`）

#### C1. `diskScheduleLab` · 磁盘寻道算法轨迹对比
- **核心教学问题**：同一组磁道请求序列，为什么 SSTF 寻道最短却可能饥饿？SCAN 与 C-SCAN 的折返差异在哪里？
- **输入与控件**：
  - `text`：磁道请求序列（默认 `98,183,37,122,14,124,65,67`）
  - `head`（初始磁头位置）：滑杆 `0 ~ 199`（默认 `53`）
  - `dir`（初始移动方向）：`0: 向磁道号增大方向` / `1: 向磁道号减小方向`
  - `algo`（主展示算法）：`0: FCFS` / `1: SSTF` / `2: SCAN（电梯）` / `3: C-SCAN`
- **管线 Stage**：
  1. `requests`（`source`）：解析磁道序列（校验 `0 ~ 199`）与初始磁头位置。
  2. `trace`（`chart`）：逐帧推进磁头访问轨迹，`series` 绘制磁道号变化折线，每帧标出本次移动距离与累计寻道长度。
  3. `compare`（`summary`）：同组请求下四算法并排对照表（总寻道长度、平均寻道长度、最大单次跨越）。
- **公式栏**：`平均寻道长度 = Σ|trackᵢ − trackᵢ₋₁| / n`

#### C2. `pvSyncLab` · PV 信号量与生产者-消费者（含死锁演示）
- **核心教学问题**：如果把 `P(mutex)` 和 `P(empty)` 的顺序写反，系统会在哪一帧彻底卡死？
- **输入与控件**：
  - `capacity`（缓冲区大小）：滑杆 `2 ~ 6`（默认 `3`）
  - `orderMode`（PV 顺序）：`0: 正确顺序（先资源后互斥）` / `1: 错误顺序（先互斥后资源 · 触发死锁）`
  - `text`：操作事件脚本（如 `P,P,P,P,C,C`，`P`=生产者到达、`C`=消费者到达）
- **管线 Stage**：
  1. `script`（`source`）：解析到达序列与缓冲区初始信号量 `empty = N, full = 0, mutex = 1`。
  2. `sim`（`queue` / `grid`）：逐帧展示缓冲区槽位占用、`empty / full / mutex` 实时数值、阻塞等待队列以及死锁高亮警告。
  3. `audit`（`summary`）：统计完成生产/消费次数、阻塞次数、是否发生死锁及成因定位。
- **公式栏**：`P(S): S←S−1 · V(S): S←S+1`

---

### 批次 D：计算机网络（`lab408PipelineNet.ts`，`topic: 'l04'`）

#### D1. `csmaCdLab` · CSMA/CD 冲突检测与最短帧长
- **核心教学问题**：为什么以太网规定最短帧长为 64 字节？帧发得太短时，冲突信号还没传回来会发生什么？
- **输入与控件**：
  - `distance`（总线长度 m）：滑杆 `100 ~ 2500`（默认 `1000`）
  - `rate`（带宽 Mbps）：`0: 10 Mbps` / `1: 100 Mbps`
  - `frameBytes`（帧长 Bytes）：滑杆 `16 ~ 128`（默认 `64`）
  - `delayB`（B 站发帧相对延迟 μs）：滑杆 `0 ~ 10`（默认 `2`）
- **管线 Stage**：
  1. `link`（`source`）：计算单程传播时延 `τ = d / v`（`v = 2×10⁸ m/s`）、争用期 `2τ` 与发送时延 `T_trans`。
  2. `timeline`（`pipeline` / `network`）：按时间步模拟 A、B 两站信号波在总线上的相向传播、碰撞点、碰撞信号回传与是否检测成功（`T_trans ≥ 2τ`），若检测成功则演示二进制指数退避区间 `[0, 2^k − 1]`。
  3. `verdict`（`summary`）：对比当前帧长与理论最短帧长 `L_min = 2τ × R`，直接给出「可可靠检测冲突」或「帧已发完，冲突漏检」结论。
- **公式栏**：`L_min = 2τ · R`

#### D2. `routingLab` · RIP 距离向量 vs OSPF 链路状态收敛
- **核心教学问题**：链路断开后，为什么 RIP 会出现“坏消息传得慢 / 计数到无穷（16 跳）”，而 OSPF 能迅速重新计算最短路？
- **输入与控件**：
  - `fault`（故障注入）：`0: 正常拓扑` / `1: 断开关键链路 R1–R2`
  - `splitHorizon`（水平分割开关）：`0: 关闭` / `1: 开启`
  - `protocol`（主视图协议）：`0: RIP（距离向量）` / `1: OSPF（链路状态）`
- **管线 Stage**：
  1. `topology`（`graph`）：展示 4~5 节点路由器拓扑与链路开销（故障边标红断开）。
  2. `converge`（`grid` + `graph`）：按轮次逐帧展示各路由器路由表更新（目的网、下一跳、跳数/开销），高亮路由环路与 `16（不可达）` 计数过程。
  3. `compare`（`summary`）：对比 RIP 与 OSPF 的收敛轮次、控制报文范围与是否存在环路风险。
- **公式栏**：`Dₓ(y) = minᵥ { c(x,v) + Dᵥ(y) }`

---

## 四、 阶段 2：现有 13 个 408 实验的情景预设与体验增强

在保持现有管线计算逻辑兼容的前提下，为 `PipelineStage` 增加可选的 `presets?: { label: string; text?: string; params: Record<string, number> }[]`（注意 `InstrumentStage.tsx` 第 701 行已支持读取 `sourceDef.presets` 并自动在右侧精密控制舱渲染预设按钮！），为以下高频实验补全经典教学预设：

| 实验 `kind` | 建议补齐的情景预设（直接复用 `InstrumentStage` 已有预设栏） |
| :--- | :--- |
| `pageReplace` | `Belady 异常经典 (1,2,3,4,1,2,5,1,2,3,4,5)` / `局部性良好` / `循环扫描颠簸` |
| `cacheSimLab` | `顺序访问（空间局部性）` / `同组冲突颠簸` / `增大路数消除冲突` |
| `cpuScheduleLab` | `护航效应（长作业先到）` / `短作业抢占（SRTF）` / `小时间片高频切换` |
| `tcpCongestionLab` | `正常慢开始→拥塞避免` / `3-ACK 快重传快恢复` / `超时重回 cwnd=1` |
| `avl` | `LL 右单旋 (30,20,10)` / `LR 先左后右双旋 (30,10,20)` / `RL 双旋 (10,30,20)` |
| `bankerLab` | `存在安全序列` / `减少可用资源触发不安全` |
| `slidingWindowLab` | `无丢帧满窗口` / `中间帧丢失（GBN vs SR 对比）` |

---

## 五、 验收标准与测试清单

执行 Agent 每完成一个批次，必须运行并全部通过以下检查：

1. **单元测试**：
   ```bash
   cd frontend
   node --test src/canvas/lab408PipelineDs.test.ts src/canvas/lab408PipelineCo.test.ts src/canvas/lab408PipelineOs.test.ts src/canvas/lab408PipelineNet.test.ts
   ```
   每个新增实验至少覆盖 3 个断言：
   - 默认参数正常运行且生成多帧与有效数值结论；
   - 关键边界/典型考题场景（如 B 树分裂、哈希高装填因子、补码溢出、PV 顺序写反死锁、CSMA/CD 短帧漏检、RIP 断链计数到 16）输出正确结果；
   - 非法输入抛出清晰的中文错误提示而非 `NaN` / 崩溃。
2. **类型与构建验证**：
   ```bash
   cd frontend
   npm run typecheck
   npx vite build
   ```
3. **UI 与活页联动人工/视觉自检**：
   - 在 `/workshop?subject=lab408` 下 4 个专题共显示 **21 个** 实验卡片，缩略图与公式栏无缺失；
   - 随机打开每个新实验：主舞台图表/表格/时间轴渲染正常，无内部溢出；
   - 在通文册中将其作为插件嵌入并切换 `compact` / `stage_only` 模式，确认布局清晰可用。

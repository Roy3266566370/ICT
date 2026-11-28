import type { StudyStage } from './studyStages.ts';
import type { PipelineResult } from './lab408PipelineTypes.ts';
import type { ScienceResult } from './sciencePipelineTypes.ts';
import type { DeepPanoramaKind } from './deepPanoramaTypes.ts';
/**
 * types.ts —— 万象画布数据模型
 *
 * 画布 = 节点（活对象/便签）+ 连线（对象间数据流）+ 墨迹（自由手写）三层。
 *
 * 端口协议：
 *  - 节点通过命名输出端口广播 `PortValue`，输入端口按 `Wire.toPort` 接收；
 *  - `PortValue` 是判别联合：matrix2（2×2 矩阵）、scalar（标量）……后续可扩展；
 *  - 端口可声明 kind 约束（PortSpec.kind），不兼容的端口不允许连线；
 *  - 求值见 engine.ts：沿连线向源回溯，支持 源→变换→视图 多级链。
 */

export interface DatasetPoint { x: number; y: number; label: number; split: 'train' | 'validation' }

export interface RuleControlSpec {
  key: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: number; label: string }[];
}

export interface RulePreset {
  label: string;
  text?: string;
  params: Record<string, number>;
}

export type PortValue =
  | { kind: 'lab408Data'; pipeline: string; stage: string; result: PipelineResult; error?: string }
  | {
      kind: 'deepData';
      pipeline: DeepPanoramaKind;
      stage: string;
      /** 沿连线向下游透传的当前超参、情景与播放帧 */
      params: Record<string, number>;
      frame: number;
      /** 由 deepPanoramaEngine 计算出的本阶段强类型产物，供下游积木直接消费 */
      state: Record<string, unknown>;
    }
  | { kind: 'physicsData'; pipeline: string; stage: string; result: ScienceResult; error?: string }
  | { kind: 'calculusData'; pipeline: string; stage: string; result: ScienceResult; error?: string }
  | { kind: 'businessData'; pipeline: string; stage: string; result: ScienceResult; error?: string }
  | {
      kind: 'series';
      title: string;
      unit?: string;
      labels: string[];
      values: number[];
      secondary?: { name: string; values: number[] }[];
    }
  | {
      kind: 'field2d';
      mode: 'electric' | 'magnetic' | 'optics';
      sources: Array<{ kind: string; x: number; y: number; strength: number; radius?: number }>;
    }
  | {
      kind: 'algoData';
      mode: 'array' | 'graph' | 'addrStream';
      values?: number[];
      edges?: Array<{ u: string; v: string; w: number }>;
      addresses?: number[];
    }
  | {
      kind: 'customFrames';
      title: string;
      controls: RuleControlSpec[];
      result: PipelineResult;
      error?: string;
      elapsedMs?: number;
    }
  | { kind: 'tensor2d'; data: number[][] }
  | { kind: 'dataset2d'; points: DatasetPoint[]; featureMap?: 'linear' | 'quadratic' }
  | { kind: 'function'; expression: string; a: number; b: number; c: number }
  | { kind: 'function2d'; expression: string; a: number; b: number }
  | { kind: 'vectorFunction2d'; p: string; q: string }
  | { kind: 'matrix2'; a: number; b: number; c: number; d: number }
  | { kind: 'scalar'; v: number }
  | { kind: 'body'; x: number; y: number; vx: number; vy: number;
      ke?: number; pe?: number;
      fx?: number; fy?: number; ax?: number; ay?: number;
      theta?: number; omega?: number; altX?: number; altY?: number };

export type ValueKind = PortValue['kind'];

export type NodeType =
  | StudyStage
  | 'activationProbe' | 'optimizerArena' | 'attentionAB' | 'kvCache'
  | 'dataset2dSource' | 'pixelGridSource' | 'tokenSeqSource'
  | 'linearOp' | 'activationOp' | 'residualJoin' | 'normOp' | 'conv2dOp' | 'attentionOp'
  | 'mlpTrainer' | 'boundaryView' | 'matrixHeatmapView' | 'gradFlowMeter'
  | 'svmLab' | 'resnetLab' | 'sequenceMemory' | 'multiheadLab' | 'autoencoderLab' | 'diffusionLab' | 'qLearningLab'
  | 'functionSource' | 'functionPlot' | 'limitProbe' | 'derivative' | 'integral' | 'taylor'
  // 高数进阶：变上限积分、傅里叶、斜率场/ODE、二元函数与二重积分
  | 'ftcView' | 'fourierLab' | 'odeSlopeField' | 'func2dSource' | 'gradientContour' | 'doubleIntegralView' | 'vectorFieldSource'
  // 高数/线代自由组合扩展：函数复合、SVD 分解、线性方程组、概率分布
  | 'funcCombineOp' | 'svdDecomposeOp' | 'linearSolveView' | 'probDistSource'
  // 源：只有输出
  | 'matrixSource'   // 矩阵源（可编辑 2×2 → 广播 matrix2）
  | 'slider'         // 滑杆源（标量）
  | 'ticker'         // 时间源（0→1 循环广播 scalar，驱动自动动画）
  | 'delayRegister'  // 状态延迟寄存器（跨时间步反馈记忆积木）
  // 变换：有输入有输出
  | 'rotor'          // 旋转矩阵器（scalar 圈数 → 旋转矩阵）
  | 'matmul'         // 矩阵乘法器（A、B 两个矩阵输入 → A×B）
  // 视图：只有输入
  | 'transformView'  // 变换视图（网格/椭圆/列向量）
  | 'fieldView'      // 向量场（矩阵作为场的箭头图）
  | 'detGauge'       // det 仪表
  | 'eigRead'        // 特征值读数
  | 'squareView'     // 单位正方形的像（面积 = |det|）
  | 'quiz'           // 预测闸门（先猜 |det|，再揭示真值）
  | 'spark'          // 记录仪（数值历史火花线，画布有记忆）
  // 文字 / 自包含
  | 'textNote'       // 便签
  | 'latexNote'      // 公式卡（LaTeX 即输即渲染）
  | 'cobweb'         // 蛛网图（逻辑斯蒂迭代，自包含混沌演示）
  // 力学实验台：闭式解天体（确定性，f(params,t) 纯函数）
  | 'projectile'     // 抛体（v0/角度/g → 实时 body 状态）
  | 'springOsc'      // 弹簧振子（k/m/x0 → 简谐运动 body）
  | 'pendulum'       // 单摆（L/θ0/g → 小角摆动 body）
  | 'trailView'      // 轨迹仪（累积 body 位置历史 → 轨迹线）
  | 'energyMeter'    // 能量表（body 的 ke/pe 实时条形）
  | 'inclineLab'     // 斜面实验台（角度/摩擦系数 → 静摩擦临界与滑动）
  | 'collisionLab'   // 一维碰撞实验台（质量/初速/恢复系数 → 碰撞前后动量能量）
  | 'resonanceLab'   // 阻尼受迫共振实验台（k/m/c/F0/ω_d → 稳态振幅）
  | 'waveLab'        // 波场实验台（振幅/频率/波长 → 行波或驻波采样）
  // 408 专题：自带结论的确定性小实验
  | 'dsTraversal'    // 二叉树四种遍历
  | 'cacheSplit'     // Cache 地址 tag/index/offset 划分
  | 'pageReplace'    // FIFO / LRU / OPT 页面置换
  | 'ipSubnet'       // IPv4 子网划分
  | 'arraySource' | 'sortCompareView' | 'graphSource' | 'shortestPathView'
  | 'memAddrSource' | 'addrTranslateView' | 'cacheMapView'
  | 'pageRefSource' | 'bitSliceView' // 高频沉淀：页面/磁道序列源、位段拆解器
  | 'lab408Workbench' // 408 全题型工作台：科目 → 题型 → 原文 → 本地内核
  | 'lab408Stage'     // 408 数据流模块，payload 指向管线和环节
  | 'physicsStage'    // 大学物理数据流模块
  | 'calculusStage'   // 高等数学数据流模块
  | 'businessStage'   // 办公决策数据流模块
  | 'cacheSimLab'     // Cache 组相联访存步进仿真
  | 'pipelineLab'     // 5 级流水线时空图与冲突
  | 'ieee754Lab'      // IEEE754 位段解码
  | 'cpuScheduleLab'  // CPU 调度甘特图对比
  | 'bankerLab'       // 银行家算法安全序列
  | 'tcpCongestionLab' // TCP 拥塞窗口曲线
  | 'slidingWindowLab' // GBN / SR 滑动窗口
  | 'dsStepLab'       // 数据结构步进器（树 / KMP / 排序 / Dijkstra）
  // 自制积木（Scratch 自定义积木）：封装子图，边界端口对外接线
  | 'composite'      // 复合节点（内含 sub 子图）
  | 'portIn'         // 积木内部：入口边界节点（仅出现在 sub.nodes）
  | 'portOut'        // 积木内部：出口边界节点
  // 自包含仿真（活页建议/AI 设计物化而来）：数据载荷在 payload JSON 中
  | 'attentionSim'   // 注意力教学实验（query/温度/因果掩码 → 权重表）
  | 'pageLabSim'     // AI 交互模型（page_lab 程序 + 滑块组）
  // AI 创造引擎：自然语言规则方块 + 通用多形态舞台
  | 'aiRuleBlock' | 'universalStageView'
  // 深度学习现代机制：损失对比、LoRA、量化、LLM 采样
  | 'lossProbeOp' | 'loraAdapterOp' | 'quantProbeOp' | 'samplingDecoderView'
  // 办公决策：业务表格、增长曲线、情景分叉、折现、加权决策、瀑布 KPI
  | 'bizTableSource' | 'bizGrowthSource' | 'bizScenarioFork' | 'bizDiscountOp' | 'bizDecisionMatrix' | 'bizWaterfallView'
  // 大学物理扩展：场源、场视图、RLC、光学台、热机循环
  | 'emFieldSource' | 'emFieldView' | 'rlcCircuitLab' | 'opticsBench' | 'thermoCycle'
  // 深度学习全景沙盘：多阶段连线模块与遗留单节点编排式实验台
  | 'deepStage'
  | 'deepPanoramaStage';

export interface PortSpec {
  id: string;
  label: string;
  /** 输出类型或输入的单一类型。输入没有 kind 和 accepts 时接收任意类型。 */
  kind?: ValueKind;
  accepts?: readonly ValueKind[];
}

/** 复合节点对外的端口声明：id = 内部边界节点（portIn/portOut）id = 外层接线端口 id */
export interface CompositePort {
  id: string;
  dir: 'in' | 'out';
  label: string;
  kind?: ValueKind;
}

/** 复合积木透出到外壳卡片直接调节的参数声明 */
export interface ExposedParam {
  /** 内部目标节点 id */
  nodeId: string;
  /** 内部参数 key（如 'v' / 'zeta'） */
  paramKey: string;
  /** 展示在外壳上的标签 */
  label: string;
  min?: number;
  max?: number;
  step?: number;
}

/** 封装子图：内部节点坐标保持绝对值（展开即原样还原），端口节点参与内部连线 */
export interface CompositeSub {
  nodes: CanvasNode[];
  wires: Wire[];
  ports: CompositePort[];
  /** 透出到外壳卡片直接调节的关键参数（建议默认勾选最多 4 个） */
  exposedParams?: ExposedParam[];
  /** 指定某个内部可视化节点作为外壳封面缩略视图 */
  previewNodeId?: string;
  /** 一句话模块说明 */
  summary?: string;
}

export interface CanvasNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  /** 自定义卡片尺寸：右下角拖出的宽/高；缺省时宽取类型默认值、高随内容自适应 */
  w?: number;
  h?: number;
  /** 节点自身参数（矩阵元素、滑杆值、周期、开关……） */
  params: Record<string, number>;
  /** 便签 / 公式源文本 / 积木名 */
  text?: string;
  /** 自包含仿真节点的数据载荷 JSON（pageLabSim 的模型、attentionSim 的教学数据等） */
  payload?: string;
  /** type === 'composite' 时的封装子图 */
  sub?: CompositeSub;
}

export interface Wire {
  id: string;
  from: string;
  /** 源输出端口 id，缺省 'out' */
  fromPort?: string;
  to: string;
  /** 目标输入端口 id，缺省 'in'；一个输入端口至多一条线 */
  toPort?: string;
}

export interface InkStroke {
  id: string;
  color: string;
  width: number;
  points: [number, number][]; // 画布坐标（未缩放）
}

export type CanvasTool = 'select' | 'pen' | 'erase';

/** 仪器面板：嵌入活页时以精简模式呈现的契约。
 *  view_node_ids 是主观察节点；exposed_params 把内部节点参数外露成面板控件。
 *  引用缺失的节点/参数键由嵌入端降级为警告，不静默丢弃。 */
export interface CanvasPanelParam {
  node_id: string;
  param_key: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
}

export type CockpitLayoutMode = 'auto' | 'hero-stack' | 'grid' | 'bento-3';

export interface CanvasPanel {
  title?: string;
  exposed_params: CanvasPanelParam[];
  view_node_ids: string[];
  read_only_layout?: boolean;
  cockpit_layout?: CockpitLayoutMode;
}

export interface CanvasDoc {
  version: 1;
  title: string;
  nodes: CanvasNode[];
  wires: Wire[];
  strokes: InkStroke[];
  zoom: number;
  panel?: CanvasPanel;
}

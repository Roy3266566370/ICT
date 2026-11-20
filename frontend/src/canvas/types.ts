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

export type PortValue =
  | { kind: 'function'; expression: string; a: number; b: number; c: number }
  | { kind: 'matrix2'; a: number; b: number; c: number; d: number }
  | { kind: 'scalar'; v: number }
  | { kind: 'body'; x: number; y: number; vx: number; vy: number; ke?: number; pe?: number };

export type ValueKind = PortValue['kind'];

export type NodeType =
  | 'functionSource' | 'functionPlot' | 'limitProbe' | 'derivative' | 'integral' | 'taylor'
  // 源：只有输出
  | 'matrixSource'   // 矩阵源（可编辑 2×2 → 广播 matrix2）
  | 'slider'         // 滑杆源（标量）
  | 'ticker'         // 时间源（0→1 循环广播 scalar，驱动自动动画）
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
  // 408 专题：自带结论的确定性小实验
  | 'dsTraversal'    // 二叉树四种遍历
  | 'cacheSplit'     // Cache 地址 tag/index/offset 划分
  | 'pageReplace'    // FIFO / LRU / OPT 页面置换
  | 'ipSubnet'       // IPv4 子网划分
  | 'lab408Workbench' // 408 全题型工作台：科目 → 题型 → 原文 → 本地内核
  // 自制积木（Scratch 自定义积木）：封装子图，边界端口对外接线
  | 'composite'      // 复合节点（内含 sub 子图）
  | 'portIn'         // 积木内部：入口边界节点（仅出现在 sub.nodes）
  | 'portOut'        // 积木内部：出口边界节点
  // 自包含仿真（活页建议/AI 设计物化而来）：数据载荷在 payload JSON 中
  | 'attentionSim'   // 注意力教学实验（query/温度/因果掩码 → 权重表）
  | 'pageLabSim';    // AI 交互模型（page_lab 程序 + 滑块组）

export interface PortSpec {
  id: string;
  label: string;
  /** 输入端口：声明接收的值类型；输出端口：声明广播的值类型。缺省表示任意。 */
  kind?: ValueKind;
}

/** 复合节点对外的端口声明：id = 内部边界节点（portIn/portOut）id = 外层接线端口 id */
export interface CompositePort {
  id: string;
  dir: 'in' | 'out';
  label: string;
  kind?: ValueKind;
}

/** 封装子图：内部节点坐标保持绝对值（展开即原样还原），端口节点参与内部连线 */
export interface CompositeSub {
  nodes: CanvasNode[];
  wires: Wire[];
  ports: CompositePort[];
}

export interface CanvasNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
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

export interface CanvasPanel {
  title?: string;
  exposed_params: CanvasPanelParam[];
  view_node_ids: string[];
  read_only_layout?: boolean;
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

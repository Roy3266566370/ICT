/** 408 全景沙盘（第二批上）：数据结构 ds01/ds02/ds04 + 组成原理 co01/co03/co04。
 * 模式同 lab408Sandboxes.ts：源头（数组源/滑杆）一驱多，aiRuleBlock 出视图。
 */
import { board, control, node, rule, slider, sliderParam } from './calculusSandboxDoc.ts';
import {
  addrModeRule, avlRule, boothRule, btreeRule, cpiRaceRule, datapathRule, exprStackRule,
  hashProbeRule, huffmanRule, ieee754Rule, ioModeRule, kmpRaceRule, microopRule, overflowRule,
  pipelineGanttRule, queueCycleRule, sortRaceRule, traversalRule,
} from './lab408SandboxRulesDsCo.ts';
import type { CanvasDoc } from './types.ts';

export type Lab408SandboxDsCoKind =
  | 'ds01-linear-string' | 'ds02-trees' | 'ds04-search-sort'
  | 'co01-data-alu' | 'co03-isa-cpu' | 'co04-pipeline-io';

export function lab408SandboxDsCoDoc(kind: Lab408SandboxDsCoKind, title: string): CanvasDoc {
  switch (kind) {
    case 'ds01-linear-string': return linearStringSandbox(title);
    case 'ds02-trees': return treesSandbox(title);
    case 'ds04-search-sort': return searchSortSandbox(title);
    case 'co01-data-alu': return dataAluSandbox(title);
    case 'co03-isa-cpu': return isaCpuSandbox(title);
    default: return pipelineIoSandbox(title);
  }
}

/* ---------- DS 第 1–3 章：线性表、栈队列与 KMP ---------- */

function linearStringSandbox(title: string): CanvasDoc {
  const cap = slider('cap', '循环队列容量 m', 400, 6, 4, 10, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '改序列源驱动入队/出队；\n换表达式看双栈求值；\n换文本-模式串比 KMP 三法。'),
    node('arrSrc', 'arraySource', 40, 185, { mode: 3, length: 14 }, '10 20 30 40 50 60 70 80'),
    cap,
    rule('exprStack', 420, 40, {
      title: '中缀表达式双栈求值', summary: '运算数栈与运算符栈逐步演化，优先级低的先出栈算。',
      preferredView: 'shapes', code: exprStackRule,
      textLabel: '中缀表达式（+ - * / 与小数）',
      controls: [control('variant', '内置式(0/1/2)', 0, 0, 2, 1)],
      presets: [
        { label: '3+4*2-6/2', params: { variant: 0 } },
        { label: '8-3*2+10/5', params: { variant: 1 } },
        { label: '7*2+8/4-3', params: { variant: 2 } },
      ],
    }),
    rule('queueCycle', 420, 430, {
      title: '循环队列指针演化', summary: '入队序列喂进容量 m 的环阵；(rear+1)%m=front 判满拒入。',
      preferredView: 'shapes', code: queueCycleRule,
      controls: [control('cap', '容量回落', 6, 4, 10, 1)],
      presets: [
        { label: '递增序列', params: {}, text: '10 20 30 40 50 60 70 80' },
        { label: '短序列', params: {}, text: '1 2 3' },
        { label: '填满再溢出', params: {}, text: '5 5 5 5 5 5 5 5 5 5 5 5 5 5' },
      ],
      auxiliaryKind: 'scalar', presetSource: 'text',
    }),
    rule('kmpRace', 840, 200, {
      title: '朴素 vs KMP·next vs nextval', summary: '同一文本-模式串三法比较：nextval 把等值位继续前跳，最省比较。',
      preferredView: 'chart', code: kmpRaceRule,
      textLabel: '文本串⏎模式串（小写字母）',
      controls: [control('variant', '内置串(0/1/2)', 0, 0, 2, 1)],
      presets: [
        { label: 'ababc 经典', params: { variant: 0 } },
        { label: 'aaaab 退化', params: { variant: 1 } },
        { label: 'abcabe 混合', params: { variant: 2 } },
      ],
    }),
  ], [
    ['arrSrc', 'queueCycle'], ['cap', 'queueCycle', 'aux'],
  ], ['exprStack', 'queueCycle', 'kmpRace'], [
    sliderParam(cap),
    { node_id: 'exprStack', param_key: 'variant', label: '表达式', min: 0, max: 2, step: 1 },
    { node_id: 'kmpRace', param_key: 'variant', label: '文本-模式串', min: 0, max: 2, step: 1 },
  ]);
}

/* ---------- DS 第 4 章：二叉树、哈夫曼与 AVL ---------- */

const BST_SEQ = '30 20 40 10 25 35 50 5';
const BST_SEQ2 = '50 30 70 20 40 60 80 10 35';
const BST_LLR = '30 20 10';

function treesSandbox(title: string): CanvasDoc {
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '同一插入序列驱动三视图：\n四遍历栈演、哈夫曼合并、\nAVL 失衡旋转修复。'),
    node('seq', 'arraySource', 40, 185, { mode: 3, length: 8 }, BST_SEQ),
    rule('traversal', 420, 40, {
      title: 'BST 四种遍历', summary: '切先/中/后/层序：看根的访问时机与栈/队列演化。',
      preferredView: 'graph', code: traversalRule,
      controls: [control('order', '遍历(0先1中2后3层)', 1, 0, 3, 1)],
      presets: [
        { label: '中序=有序输出', params: { order: 1 } },
        { label: '先序还原建树', params: { order: 0 } },
        { label: '层序 BFS', params: { order: 3 } },
        { label: '换序列 LL 链', params: {}, text: BST_LLR },
      ],
      presetSource: 'text',
    }),
    rule('huffman', 420, 430, {
      title: '哈夫曼树逐轮合并', summary: '同一序列当权值：每轮并最小两堆，终帧核算 WPL。',
      preferredView: 'graph', code: huffmanRule,
      controls: [],
      presets: [
        { label: '等差权值', params: {}, text: BST_SEQ },
        { label: '悬殊权值', params: {}, text: '1 2 3 4 20 30 40' },
        { label: '近等权', params: {}, text: '7 8 9 10 11 12' },
      ],
      presetSource: 'text',
    }),
    rule('avl', 840, 200, {
      title: 'AVL 插入与旋转', summary: '同序列喂平衡树：bf>1 即定位 LL/RR/LR/RL 并旋修复。',
      preferredView: 'graph', code: avlRule,
      controls: [],
      presets: [
        { label: '触发 LL', params: {}, text: BST_LLR },
        { label: '触发 LR', params: {}, text: '30 10 20' },
        { label: '均衡序列', params: {}, text: BST_SEQ2 },
      ],
      presetSource: 'text',
    }),
  ], [
    ['seq', 'traversal'], ['seq', 'huffman'], ['seq', 'avl'],
  ], ['traversal', 'huffman', 'avl'], [
    { node_id: 'traversal', param_key: 'order', label: '遍历次序', min: 0, max: 3, step: 1 },
  ]);
}

/* ---------- DS 第 6–7 章：B 树、散列与内部排序 ---------- */

const KEY_SEQ = '38 49 65 76 97 110 13 27 49 55 4';
const KEY_SEQ2 = '10 20 30 40 50 60 70';
const SORT_SEQ = '49 38 65 97 76 13 27 49 55 4';

function searchSortSandbox(title: string): CanvasDoc {
  const mOrd = slider('mOrd', 'B 树阶数 m', 330, 3, 3, 5, 1);
  const alfa = slider('alfa', '装填因子 α×10', 490, 7, 2, 10, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '同一键序列喂三擂台：\nB 树分裂、散列聚集、\n三排序比次数。'),
    node('keys', 'arraySource', 40, 185, { mode: 3, length: 11 }, KEY_SEQ),
    mOrd, alfa,
    rule('btree', 420, 40, {
      title: 'm 阶 B 树插入分裂', summary: '键溢出即上推中键分裂；拖 m 看高度变化。',
      preferredView: 'graph', code: btreeRule,
      controls: [control('order', '阶数回落', 3, 3, 5, 1)],
      presets: [
        { label: '3 阶 2-3 树', params: { order: 3 } },
        { label: '5 阶更矮', params: { order: 5 } },
        { label: '递增触发链式分裂', params: {}, text: KEY_SEQ2 },
      ],
      auxiliaryKind: 'scalar', presetSource: 'text',
    }),
    rule('hashProbe', 420, 430, {
      title: '线性探测聚集热图', summary: '键 % 表长散列；α 越大聚集链越长、ASL 越差。',
      preferredView: 'grid', code: hashProbeRule,
      controls: [control('size', '表长回落', 11, 5, 16, 1), control('alpha', 'α×10 回落', 7, 2, 10, 1)],
      presets: [
        { label: '教科序列', params: {}, text: KEY_SEQ },
        { label: '全同余聚集', params: {}, text: '11 22 33 44 55 66' },
        { label: '随机散列', params: {}, text: '3 17 42 8 91 27 63' },
      ],
      auxiliaryKind: 'scalar', presetSource: 'text',
    }),
    rule('sortRace', 840, 200, {
      title: '快排/堆排/归并擂台', summary: '同数组三种排序：比较与交换/写入计数对账。',
      preferredView: 'chart', code: sortRaceRule,
      controls: [],
      presets: [
        { label: '经典乱序', params: {}, text: SORT_SEQ },
        { label: '已排序·快排退化', params: {}, text: '10 20 30 40 50 60 70 80' },
        { label: '逆序', params: {}, text: '80 70 60 50 40 30 20 10' },
      ],
      presetSource: 'text',
    }),
  ], [
    ['keys', 'btree'], ['keys', 'hashProbe'], ['keys', 'sortRace'],
    ['mOrd', 'btree', 'aux'], ['alfa', 'hashProbe', 'aux'],
  ], ['btree', 'hashProbe', 'sortRace'], [
    sliderParam(mOrd), sliderParam(alfa),
    { node_id: 'hashProbe', param_key: 'size', label: '散列表长', min: 5, max: 16, step: 1 },
  ]);
}

/* ---------- CO 第 1–2 章：数据表示、IEEE 754 与 ALU ---------- */

function dataAluSandbox(title: string): CanvasDoc {
  const expo = slider('expo', '阶码 E (0–255)', 330, 126, 0, 255, 1);
  const operand = slider('operand', '操作数 X/A', 490, 60, -64, 63, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '阶码滑杆扫 IEEE 边界；\n操作数滑杆同驱补码溢出\n与 Booth 逐拍乘法。'),
    expo, operand,
    rule('ieee754', 420, 40, {
      title: 'IEEE 754 位级拆解', summary: 'S/E/M 三段：E=0 非规格化、E=255 ∞/NaN、中间规格化。',
      preferredView: 'shapes', code: ieee754Rule,
      controls: [
        control('expo', '阶码回落', 126, 0, 255, 1),
        control('frac', '尾数 M', 2097152, 0, 8388607, 65536),
        control('sign', '符号位', 0, 0, 1, 1),
      ],
      presets: [
        { label: '1.0 规格化', params: { expo: 127, frac: 0 } },
        { label: '非规格化', params: { expo: 0, frac: 4194304 } },
        { label: '+∞', params: { expo: 255, frac: 0 } },
        { label: 'NaN', params: { expo: 255, frac: 1 } },
      ],
      presetSource: { param: 'expo' },
    }),
    rule('overflow', 420, 430, {
      title: '双符号位溢出判定', summary: '补码加/减：sf1⊕sf0=1 即溢出（01 正溢、10 负溢）。',
      preferredView: 'table', code: overflowRule,
      controls: [
        control('width', '字长', 8, 4, 8, 1),
        control('a', 'A 回落', 60, -128, 127, 1),
        control('b', 'B', 70, -128, 127, 1),
        control('sub', '减法?', 0, 0, 1, 1),
      ],
      presets: [
        { label: '60+70 正溢出', params: { a: 60, b: 70, sub: 0 } },
        { label: '-60-70 负溢出', params: { a: -60, b: 70, sub: 1 } },
        { label: '100-30 正常', params: { a: 100, b: 30, sub: 1 } },
      ],
      presetSource: { param: 'a' },
    }),
    rule('booth', 840, 200, {
      title: 'Booth 补码一位乘', summary: 'A/Q/Q₋₁ 逐拍：01 加 X、10 减 X、其余只算术右移。',
      preferredView: 'table', code: boothRule,
      controls: [
        control('width', '字长', 8, 4, 8, 1),
        control('x', '被乘数回落', 5, -128, 127, 1),
        control('y', '乘数', -3, -128, 127, 1),
      ],
      presets: [
        { label: '5×(-3)', params: { x: 5, y: -3 } },
        { label: '(-5)×3', params: { x: -5, y: 3 } },
        { label: '7×7', params: { x: 7, y: 7 } },
      ],
      presetSource: { param: 'x' },
    }),
  ], [
    ['expo', 'ieee754'], ['operand', 'overflow'], ['operand', 'booth'],
  ], ['ieee754', 'overflow', 'booth'], [
    sliderParam(expo), sliderParam(operand),
    { node_id: 'overflow', param_key: 'b', label: '操作数 B', min: -128, max: 127, step: 1 },
    { node_id: 'booth', param_key: 'y', label: '乘数 Y', min: -8, max: 7, step: 1 },
  ]);
}

/* ---------- CO 第 4–5 章：指令系统与 CPU 数据通路 ---------- */

function isaCpuSandbox(title: string): CanvasDoc {
  const instr = slider('instr', '指令 0LOAD 1ADD 2STORE 3BEQ', 330, 0, 0, 3, 1);
  const mode = slider('mode', '寻址方式 0-5', 490, 3, 0, 5, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '指令滑杆同驱数据通路与\n控制信号表；寻址滑杆扫\nEA 六种算法。'),
    instr, mode,
    rule('addrMode', 420, 40, {
      title: '六种寻址方式 EA', summary: '立即/直接/寄存器/间接/基址/变址：访存级数与 EA 公式对照。',
      preferredView: 'shapes', code: addrModeRule,
      controls: [
        control('mode', '方式回落', 3, 0, 5, 1),
        control('reg', '寄存器值', 100, 0, 300, 10),
        control('disp', '偏移 D', 20, 0, 200, 5),
        control('mem', '内存值', 777, 0, 999, 1),
      ],
      presets: [
        { label: '立即', params: { mode: 0 } },
        { label: '直接', params: { mode: 1 } },
        { label: '寄存器间接', params: { mode: 3 } },
        { label: '基址/变址', params: { mode: 4 } },
      ],
      presetSource: { param: 'mode' },
    }),
    rule('datapath', 420, 430, {
      title: '单总线数据通路逐拍', summary: 'IF/ID/EX/MEM/WB 五拍点亮 PC→MAR→M→MDR→IR→ALU→Reg。',
      preferredView: 'shapes', code: datapathRule,
      controls: [control('instr', '指令回落', 0, 0, 3, 1)],
      presets: [
        { label: 'LOAD 访存', params: { instr: 0 } },
        { label: 'ADD 纯运算', params: { instr: 1 } },
        { label: 'STORE 写回', params: { instr: 2 } },
        { label: 'BEQ 分支', params: { instr: 3 } },
      ],
      presetSource: { param: 'instr' },
    }),
    rule('microop', 840, 200, {
      title: '控制信号真值表', summary: '同指令按阶段列出 PCout/MARin/Read/ALUop/RegWrite 电平。',
      preferredView: 'table', code: microopRule,
      controls: [control('instr', '指令回落', 0, 0, 3, 1)],
      presets: [
        { label: 'LOAD', params: { instr: 0 } },
        { label: 'ADD', params: { instr: 1 } },
        { label: 'STORE', params: { instr: 2 } },
        { label: 'BEQ', params: { instr: 3 } },
      ],
      presetSource: { param: 'instr' },
    }),
  ], [
    ['instr', 'datapath'], ['instr', 'microop'], ['mode', 'addrMode'],
  ], ['addrMode', 'datapath', 'microop'], [
    sliderParam(instr), sliderParam(mode),
    { node_id: 'addrMode', param_key: 'reg', label: '寄存器值', min: 0, max: 300, step: 10 },
  ]);
}

/* ---------- CO 第 5–7 章：5 级流水线、总线与 I/O ---------- */

function pipelineIoSandbox(title: string): CanvasDoc {
  const fwd = slider('fwd', '转发开关 (0关/1开)', 330, 1, 0, 1, 1);
  const blocks = slider('blocks', 'I/O 传输块数', 490, 4, 1, 10, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '转发开关同驱时空图与\nCPI 对照；块数滑杆比\n三种 I/O 方式 CPU 占用。'),
    fwd, blocks,
    rule('pipelineGantt', 420, 40, {
      title: '5 级流水线时空图', summary: 'IF/ID/EX/MEM/WB 泳道；RAW 冒险与 Load-Use 气泡一目了然。',
      preferredView: 'timeline', code: pipelineGanttRule,
      textLabel: '指令流（LW/ADD/SUB/SW/BEQ，每行一条）',
      controls: [control('fwd', '转发电平回落', 1, 0, 1, 1), control('variant', '内置流(0/1/2)', 0, 0, 2, 1)],
      presets: [
        { label: '开转发', params: { fwd: 1 } },
        { label: '关转发看气泡', params: { fwd: 0 } },
        { label: 'Load-Use 链', params: { variant: 2, fwd: 1 } },
      ],
      presetSource: { param: 'fwd' },
    }),
    rule('cpiRace', 420, 430, {
      title: '转发开关 CPI 对照', summary: '同指令流开/关转发各跑一遍：停顿拍与 CPI 直接对账。',
      preferredView: 'chart', code: cpiRaceRule,
      textLabel: '指令流（每行一条，留空走内置）',
      controls: [control('variant', '内置流(0/1/2)', 0, 0, 2, 1)],
      presets: [
        { label: '经典冒险流', params: { variant: 0 } },
        { label: 'ALU 相关流', params: { variant: 1 } },
        { label: 'Load-Use 链', params: { variant: 2 } },
      ],
    }),
    rule('ioMode', 840, 200, {
      title: '三种 I/O 方式 CPU 占用', summary: '程序查询全程占用 → 中断按次打扰 → DMA 只在开始结束现身。',
      preferredView: 'timeline', code: ioModeRule,
      controls: [control('blocks', '块数回落', 4, 1, 10, 1)],
      presets: [
        { label: '小块传输', params: { blocks: 2 } },
        { label: '中块传输', params: { blocks: 4 } },
        { label: '大块传输', params: { blocks: 8 } },
      ],
      presetSource: { param: 'blocks' },
    }),
  ], [
    ['fwd', 'pipelineGantt'], ['blocks', 'ioMode'],
  ], ['pipelineGantt', 'cpiRace', 'ioMode'], [
    sliderParam(fwd), sliderParam(blocks),
    { node_id: 'pipelineGantt', param_key: 'variant', label: '指令流', min: 0, max: 2, step: 1 },
  ]);
}

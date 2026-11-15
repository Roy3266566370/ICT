/**
 * 自然语言指令的本地解析。
 *
 * 只识别实验室已经登记的操作（调参、单步、情景、模式），把自由文本变成确定动作；
 * 不在浏览器里执行模型生成的脚本。无法识别的句子交给右侧导师继续处理。
 */

import type { LabMode, LabSubject } from './types.ts';

export type LabCommand =
  | { kind: 'set-param'; key: string; value: number | string; message: string }
  | { kind: 'scale-param'; key: string; factor: number; message: string }
  | { kind: 'step'; value: number; message: string }
  | { kind: 'step-forward'; message: string }
  | { kind: 'step-back'; message: string }
  | { kind: 'toggle-play'; message: string }
  | { kind: 'reset-playback'; message: string }
  | { kind: 'reset-original'; message: string }
  | { kind: 'save-scenario'; message: string }
  | { kind: 'compare'; message: string }
  | { kind: 'mode'; value: LabMode; message: string }
  | { kind: 'unknown'; message: string };

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

export function parseChineseNumber(raw: string): number | null {
  const text = raw.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (!text) return null;
  if (text === '十') return 10;
  if (text.includes('十')) {
    const [left, right] = text.split('十');
    const tens = left ? CN_DIGITS[left] : 1;
    const ones = right ? CN_DIGITS[right] : 0;
    if (tens === undefined || ones === undefined) return null;
    return tens * 10 + ones;
  }
  let value = 0;
  for (const char of text) {
    const digit = CN_DIGITS[char];
    if (digit === undefined) return null;
    value = value * 10 + digit;
  }
  return value;
}

function normalize(text: string): string {
  return text
    .trim()
    .replace(/[，。；]/g, ',')
    .replace(/：/g, ':')
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

const LEARNING = /(?:学习率|步长|eta|η)\s*(?:调到|调为|设为|设置为|改成|改为|到|为|=)?\s*(-?\d+(?:\.\d+)?)/i;
const STEP = /(?:停|停到|停在|到|第)\s*([0-9一二两三四五六七八九十]+)\s*(?:次|步|轮|个)?\s*(?:迭代|epoch|步)?/i;

export function parseLabCommand(raw: string, subject: LabSubject): LabCommand {
  const text = normalize(raw);
  if (!text) return { kind: 'unknown', message: '请输入一条操作或问题。' };

  if (/(暂停|停止播放)/.test(text)) return { kind: 'toggle-play', message: '暂停播放。' };
  if (/(播放|开始演示|继续播放|运行轨迹)/.test(text)) return { kind: 'toggle-play', message: '开始播放执行轨迹。' };
  if (/(下一步|单步|前进)/.test(text)) return { kind: 'step-forward', message: '前进一个记录。' };
  if (/(上一步|后退|回退)/.test(text)) return { kind: 'step-back', message: '回到上一个记录。' };
  if (/(重置播放|回到开头|回到初始)/.test(text)) return { kind: 'reset-playback', message: '已回到轨迹开头。' };

  if (/(完整讲解|改成讲解|查看解答)/.test(text)) {
    return { kind: 'mode', value: 'solution', message: '已切换到完整讲解。' };
  }
  if (/(引导解题|引导模式|给我提示)/.test(text)) {
    return { kind: 'mode', value: 'guided', message: '已切换到引导解题。' };
  }
  if (/(自主探索|自己探索|让我自己来)/.test(text)) {
    return { kind: 'mode', value: 'explore', message: '已切换到自主探索。' };
  }
  if (/(恢复原题|原题条件|重置实验)/.test(text)) {
    return { kind: 'reset-original', message: '已恢复原题识别条件。' };
  }
  if (/(对照|比较不同|对比情景|对照实验)/.test(text)) {
    return { kind: 'compare', message: '已打开情景对照。' };
  }
  if (/(保留当前|保存情景|保存当前轨迹|建立对照)/.test(text)) {
    return { kind: 'save-scenario', message: '已把当前条件保存为一个探索情景。' };
  }

  const axisStep = text.match(/(?:停在|停到|到)\s*(n|h)\s*=\s*(\d+(?:\.\d+)?)/i);
  if (axisStep) {
    return {
      kind: 'set-param',
      key: axisStep[1]!.toLowerCase(),
      value: Number(axisStep[2]),
      message: `把 ${axisStep[1]} 设为 ${axisStep[2]}。`,
    };
  }

  const stepMatch = text.match(STEP);
  if (
    stepMatch &&
    !/(学习率|初始|起点|分割|迭代次数|训练轮|epoch|输入|目标|时间片|物理块|页框|块数|方向)/i.test(text.split(stepMatch[0]!)[0] ?? '')
  ) {
    const value = parseChineseNumber(stepMatch[1]!);
    if (value !== null) {
      const zeroBased = /停在|停到/.test(text) ? value : value;
      return { kind: 'step', value: Math.max(0, zeroBased), message: `停在执行记录的第 ${value} 步。` };
    }
  }

  const rate = text.match(LEARNING);
  const rateKey = subject === 'calculus' ? 'h' : subject === 'deep_learning' ? 'learning_rate' : 'learning_rate';
  if (rate) {
    return {
      kind: 'set-param',
      key: rateKey,
      value: Number(rate[1]),
      message: `把${subject === 'calculus' ? '差商步长' : '学习率'}设为 ${rate[1]}。`,
    };
  }
  if (/(学习率|步长).*(调大|增大|大一点)/.test(text)) {
    return { kind: 'scale-param', key: rateKey, factor: 1.5, message: '把学习率调大 1.5×。' };
  }
  if (/(学习率|步长).*(调小|减小|小一点)/.test(text)) {
    return { kind: 'scale-param', key: rateKey, factor: 0.6, message: '把学习率调小到 0.6×。' };
  }

  if (subject === 'optimization') {
    const initial = text.match(/(?:初始点|初始值|起点|x\s*0?)\s*(?:调到|设为|设置为|改成|改为|为|=|到)?\s*(-?\d+(?:\.\d+)?)/i);
    if (initial) {
      return { kind: 'set-param', key: 'x0', value: Number(initial[1]), message: `把初始点设为 ${initial[1]}。` };
    }
    const iterations = text.match(/(?:迭代次数|迭代|步数)\s*(?:调到|设为|设置为|改成|为|=|到)?\s*(\d+)/);
    if (iterations) {
      return { kind: 'set-param', key: 'iterations', value: Number(iterations[1]), message: `把迭代次数设为 ${iterations[1]}。` };
    }
  }

  if (subject === 'calculus') {
    const n = text.match(/(?:分割数|份数|矩形数|n)\s*(?:调到|设为|设置为|改成|为|=|到)?\s*(\d+)/i);
    if (n) return { kind: 'set-param', key: 'n', value: Number(n[1]), message: `把分割数设为 ${n[1]}。` };
    const limits = text.match(/(?:区间|从)\s*(-?\d+(?:\.\d+)?)\s*(?:到|~|-)\s*(-?\d+(?:\.\d+)?)/);
    if (limits) {
      return {
        kind: 'set-param',
        key: 'upper',
        value: Number(limits[2]),
        message: `把积分上限设为 ${limits[2]}（下限在控制条中同步调整）。`,
      };
    }
  }

  if (subject === 'deep_learning') {
    const epochs = text.match(/(?:训练轮数|轮数|epoch)\s*(?:调到|设为|设置为|改成|为|=|到)?\s*(\d+)/i);
    if (epochs) {
      return { kind: 'set-param', key: 'epochs', value: Number(epochs[1]), message: `把训练轮数设为 ${epochs[1]}。` };
    }
    const input = text.match(/x\s*([12])\s*(?:=|为|改成|改为)\s*(-?\d+(?:\.\d+)?)/i);
    if (input) {
      return {
        kind: 'set-param',
        key: `input_${input[1]}`,
        value: Number(input[2]),
        message: `把输入 x${input[1]} 设为 ${input[2]}。`,
      };
    }
  }

  if (subject === 'algorithm') {
    const start = text.match(/(?:起点|从)\s*([A-Za-z0-9_\u4e00-\u9fa5]{1,8})\s*(?:开始)?/);
    if (start) {
      return { kind: 'set-param', key: 'start', value: start[1]!, message: `把 BFS 起点设为 ${start[1]}。` };
    }
  }

  if (subject === 'linear_algebra') {
    if (/(若尔当|约旦|jordan|rref|行最简)/i.test(text)) {
      return { kind: 'set-param', key: 'method', value: 'jordan', message: '改用高斯-若尔当消元（一步化到行最简形）。' };
    }
    if (/(高斯消元|普通消元)/.test(text)) {
      return { kind: 'set-param', key: 'method', value: 'gauss', message: '改用高斯消元（上三角 + 回代）。' };
    }
    if (/(不选主元|按顺序取主元|不做主元)/.test(text)) {
      return { kind: 'set-param', key: 'pivoting', value: 'none', message: '改为主元策略：按顺序取第一个非零元。' };
    }
    if (/(部分主元|选主元|最大主元)/.test(text)) {
      return { kind: 'set-param', key: 'pivoting', value: 'partial', message: '改用部分主元：每列选绝对值最大者。' };
    }
    if (/(交换顺序|b·a|b×a|ba 顺序)/i.test(text)) {
      return { kind: 'set-param', key: 'order', value: 'ba', message: '改为计算 B·A，可对照矩阵乘法不满足交换律。' };
    }
    if (/(换回来|a·b|a×b|ab 顺序)/i.test(text)) {
      return { kind: 'set-param', key: 'order', value: 'ab', message: '改回计算 A·B。' };
    }
    const scalar = text.match(/(?:数乘|k)\s*(?:调到|设为|为|=|取)?\s*(-?\d+(?:\.\d+)?)/i);
    if (scalar) {
      return { kind: 'set-param', key: 'scalar', value: Number(scalar[1]), message: `把数乘系数 k 设为 ${scalar[1]}。` };
    }
  }

  if (subject === 'operating_system') {
    const quantum = text.match(/时间片(?:大小|长度)?\s*(?:调到|调为|设为|设置为|改为|改成|为|=|取|到)?\s*(\d+(?:\.\d+)?)/);
    if (quantum) return { kind: 'set-param', key: 'quantum', value: Number(quantum[1]), message: `把时间片 q 设为 ${quantum[1]}。` };
    const frames = text.match(/(?:物理块|页框|块数)\s*(?:数)?\s*(?:调到|调为|设为|设置为|改为|改成|增加到|为|=|取|到)?\s*(\d+)/);
    if (frames) return { kind: 'set-param', key: 'frames', value: Number(frames[1]), message: `把物理块数设为 ${frames[1]}。` };
    if (/(回扫).*(不计|不算)/.test(text)) {
      return { kind: 'set-param', key: 'return_cost', value: 'skip', message: '回扫距离不计入总移动距离。' };
    }
    if (/(回扫).*(计入|计算|算入)/.test(text)) {
      return { kind: 'set-param', key: 'return_cost', value: 'count', message: '回扫距离计入总移动距离。' };
    }
    if (/(增大方向|磁道号增大|磁道号增加|向外)/.test(text)) {
      return { kind: 'set-param', key: 'direction', value: 'up', message: '改为先向磁道号增大的方向移动。' };
    }
    if (/(减小方向|磁道号减小|磁道号减少|向内)/.test(text)) {
      return { kind: 'set-param', key: 'direction', value: 'down', message: '改为先向磁道号减小的方向移动。' };
    }
    if (/(忽略请求|只检查当前|不看请求)/.test(text)) {
      return { kind: 'set-param', key: 'request_mode', value: 'ignore', message: '只检查当前状态是否安全，不处理资源请求。' };
    }
    if (/(应用请求|检查请求|试分配)/.test(text)) {
      return { kind: 'set-param', key: 'request_mode', value: 'apply', message: '先判断资源请求能否满足，再试分配并检查安全。' };
    }
    if (/(改用|换成|切换|使用|采用|改为|改成|换)/.test(text)) {
      const choices: [RegExp, string, string][] = [
        [/c[-_ ]?look/i, 'clook', 'C-LOOK'], [/c[-_ ]?scan|循环扫描/i, 'cscan', 'C-SCAN'], [/look/i, 'look', 'LOOK'],
        [/scan|电梯/i, 'scan', 'SCAN'], [/sstf|最短寻道/i, 'sstf', 'SSTF'],
        [/srtf|最短剩余|抢占/i, 'srtf', 'SRTF'], [/sjf|短作业/i, 'sjf', 'SJF'],
        [/时间片轮转|轮转|round.?robin|\brr\b/i, 'rr', '时间片轮转 RR'], [/优先级/, 'priority', '优先级调度'],
        [/fifo|先进先出/i, 'fifo', 'FIFO'], [/lru|最近最久/i, 'lru', 'LRU'], [/\bopt\b|最佳置换/i, 'opt', 'OPT'],
        [/fcfs|先来先服务/i, 'fcfs', '先来先服务 FCFS'],
      ];
      const hit = choices.find(([pattern]) => pattern.test(text));
      if (hit) return { kind: 'set-param', key: 'algorithm', value: hit[1], message: `改用 ${hit[2]}。` };
    }
  }

  if (/保留.*再换|先保留.*再|换一个初始点/.test(text)) {
    return { kind: 'save-scenario', message: '已保留当前轨迹；接下来修改参数会建立新的探索情景。' };
  }

  return {
    kind: 'unknown',
    message: '这句话不是已登记的操作。可以直接问我“为什么往这个方向移动”或“下一步是什么”。',
  };
}

export const COMMAND_EXAMPLES: Record<LabSubject, string[]> = {
  calculus: ['把分割数设为 16', '停在 n=32', '完整讲解'],
  optimization: ['把学习率调到 0.05', '停在第三次迭代', '保留当前轨迹，再换一个初始点'],
  algorithm: ['下一步', '从 B 开始', '完整讲解'],
  deep_learning: ['把学习率调到 0.05', '训练轮数设为 12', '停在第三次迭代'],
  linear_algebra: ['下一步', '换若尔当消元', '不选主元', '完整讲解'],
  operating_system: ['下一步', '改用最短剩余时间优先', '物理块设为 4', '完整讲解'],
  computer_organization: ['下一步', '完整讲解'],
  computer_network: ['完整讲解'],
  unknown: ['下一步', '完整讲解'],
};

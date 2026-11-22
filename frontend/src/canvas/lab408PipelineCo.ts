import { cacheSplit } from './lab408.ts';
import { cacheTraceFrames, ieee754Decode, parseInstructionList } from './lab408Sim.ts';
import type { PipelineDefinition, PipelineFrame, PipelineResult } from './lab408PipelineTypes.ts';

const hex32 = (value: number) => '0x' + value.toString(16).padStart(8, '0');
const result = (data: Record<string, unknown>, frames: PipelineFrame[]): PipelineResult => ({ data, frames });
const table = (title: string, columns: string[], rows: (string | number)[][], summary?: string): PipelineFrame =>
  ({ title, columns, rows, summary });

const cache: PipelineDefinition = { stages: [
  {
    id: 'source', title: 'CPU 访存流', diagram: 'source',
    text: '0x00001000, 0x00001004, 0x00002000, 0x00003000, 0x00001000',
    textLabel: '32 位虚拟地址序列（十进制或 0x 十六进制，空格或逗号分隔）',
    run: ({ text }) => {
      const tokens = text.trim().split(/[\s,，、;；]+/).filter(Boolean);
      if (!tokens.length || tokens.length > 48 || tokens.some((t) => !/^(?:0x[\da-f]+|\d+)$/i.test(t) || Number(t) > 0xffffffff)) {
        throw new Error('请输入 1–48 个有效的 32 位无符号地址。');
      }
      const addresses = tokens.map(Number);
      return result({ addresses }, addresses.map((addr, index) => table(
        'CPU 发出访存请求', ['序号', '虚拟地址', '虚拟页号', '页内偏移'],
        [[index + 1, hex32(addr), addr >>> 12, addr & 0xfff]],
      )));
    },
  },
  {
    id: 'translation', title: 'TLB / 页表', diagram: 'grid', inputs: ['source'],
    text: '1=8\n2=9\n3=10', textLabel: '页表映射（每行 虚拟页号=物理页框，支持十六进制）',
    controls: [
      { key: 'entries', label: 'TLB 表项数', value: 4, min: 1, max: 8, step: 1 },
      { key: 'strict', label: '未列出的页', value: 0, options: [{ value: 0, label: '恒等映射' }, { value: 1, label: '缺页' }] },
    ],
    run: ({ text, params, upstream }) => {
      const virtual = upstream[0]!.addresses as number[];
      const mapping = new Map<number, number>();
      for (const line of text.trim().split(/[\n;；]+/).filter(Boolean)) {
        const match = line.trim().match(/^(0x[\da-f]+|\d+)\s*=\s*(0x[\da-f]+|\d+)$/i);
        if (!match || Number(match[1]) > 0xfffff || Number(match[2]) > 0xfffff) throw new Error('页号与页框须为 20 位，格式为「页号=页框」。');
        mapping.set(Number(match[1]), Number(match[2]));
      }
      const tlb = new Map<number, number>();
      const addresses: (number | null)[] = [];
      const frames = virtual.map((addr) => {
        const page = addr >>> 12;
        const offset = addr & 0xfff;
        const hit = tlb.has(page);
        const pageFrame = tlb.get(page) ?? mapping.get(page) ?? (params.strict ? null : page);
        const physical = pageFrame === null ? null : pageFrame * 4096 + offset;
        addresses.push(physical);
        if (pageFrame !== null) {
          tlb.delete(page);
          tlb.set(page, pageFrame);
          if (tlb.size > params.entries!) tlb.delete(tlb.keys().next().value!);
        }
        return table(pageFrame === null ? '缺页' : hit ? 'TLB 命中' : 'TLB 未命中，查询页表',
          ['虚拟地址', '虚拟页号', '物理页框', '页内偏移', '物理地址', 'TLB（旧 → 新）'],
          [[hex32(addr), page, pageFrame ?? '缺页', offset, physical === null ? '—' : hex32(physical), [...tlb.keys()].join(' → ')]],
          '4 KiB 页，TLB 按最近最少使用淘汰。');
      });
      return result({ addresses }, frames);
    },
  },
  {
    id: 'split', title: '地址切分', diagram: 'bits', inputs: ['translation'],
    controls: [
      { key: 'block', label: '块大小 B', value: 16, options: [4, 8, 16, 32, 64, 128].map((value) => ({ value, label: String(value) })) },
      { key: 'capacity', label: 'Cache 容量 KiB', value: 1, options: [1, 2, 4, 8].map((value) => ({ value, label: String(value) })) },
      { key: 'ways', label: '相联路数', value: 2, options: [1, 2, 4, 8].map((value) => ({ value, label: String(value) })) },
    ],
    run: ({ params, upstream }) => {
      const addresses = upstream[0]!.addresses as (number | null)[];
      const { block = 16, capacity = 1, ways = 2 } = params;
      const bits = cacheSplit(32, block, capacity, ways);
      if (!bits.valid) throw new Error(bits.message);
      const frames = addresses.map((address) => {
        if (address === null) return { title: '等待缺页处理', summary: '没有物理地址，跳过本次 Cache 访问。' };
        const binary = address.toString(2).padStart(32, '0');
        return table('物理地址的 32 位切分',
          ['物理地址', `Tag · ${bits.tag} 位`, `Index · ${bits.index} 位`, `Offset · ${bits.offset} 位`],
          [[hex32(address), binary.slice(0, bits.tag), binary.slice(bits.tag, bits.tag + bits.index) || '—', binary.slice(-bits.offset)]],
          `${bits.sets} 组 × ${ways} 路，每块 ${block} B。`);
      });
      return result({ addresses, block, capacity, ways, bits }, frames);
    },
  },
  {
    id: 'cache', title: 'Cache 组相联表', diagram: 'grid', inputs: ['split'],
    controls: [{ key: 'inspect', label: '查看组号（-1 跟踪当前组）', value: -1, min: -1, max: 2047, step: 1 }],
    run: ({ params, upstream }) => {
      const { addresses, block, capacity, ways } = upstream[0] as {
        addresses: (number | null)[]; block: number; capacity: number; ways: number;
      };
      const translated = addresses.filter((a): a is number => a !== null);
      const trace = translated.length ? cacheTraceFrames(32, block, capacity, ways, translated.map(hex32).join(' ')).frames : [];
      let step = 0;
      let hits = 0;
      let misses = 0;
      const counts: { hits: number; misses: number; fault: boolean }[] = [];
      const frames: PipelineFrame[] = addresses.map((address) => {
        const current = address === null ? undefined : trace[step++];
        if (current) ({ hits, misses } = current);
        counts.push({ hits, misses, fault: address === null });
        if (address === null || !current) return { title: '跳过 Cache', summary: '本次访存缺页，Cache 内容保持不变。' };
        const group = Math.floor(address / block) % current.sets.length;
        const inspect = Math.min(Math.floor(params.inspect ?? -1), current.sets.length - 1);
        const shown = inspect < 0 ? group : inspect;
        return {
          ...table(current.hit ? 'Hit · 命中' : 'Miss · 缺失', ['组', '路', '有效位 V', 'Tag', 'LRU 时间戳'],
            current.sets[shown]!.map((line, way) => [shown, way, Number(line.valid), line.valid ? hex32(line.tag) : '—', line.lru]),
            `${current.addrHex} 访问第 ${group} 组 · ${current.evictedWay === null ? '未淘汰' : '淘汰第 ' + current.evictedWay + ' 路'}`),
          highlightRows: shown === group && current.way !== null ? [current.way] : [],
        };
      });
      return result({ counts }, frames);
    },
  },
  {
    id: 'amat', title: '命中率与 AMAT', diagram: 'chart', inputs: ['cache'],
    controls: [
      { key: 'hitTime', label: '命中时间 ns', value: 1, min: 0.1, max: 1000, step: 0.1 },
      { key: 'penalty', label: '额外缺失开销 ns', value: 60, min: 0, max: 5000, step: 1 },
    ],
    run: ({ params, upstream }) => {
      const counts = upstream[0]!.counts as { hits: number; misses: number; fault: boolean }[];
      const rates = counts.map(({ hits, misses }) => hits + misses ? 100 * hits / (hits + misses) : 0);
      return result({ rates }, counts.map(({ hits, misses, fault }, index) => ({
        ...table('累计命中率与平均访存时间', ['命中', '缺失', '命中率', 'AMAT（ns）'],
          [[hits, misses, hits + misses ? rates[index]!.toFixed(2) + '%' : '—',
            hits + misses ? ((params.hitTime ?? 1) + misses / (hits + misses) * (params.penalty ?? 60)).toFixed(2) : '—']],
          `AMAT = 命中时间 + 缺失率 × 额外缺失开销。${fault ? '当前请求因缺页未计入 Cache 统计。' : ''}`),
        series: [{ label: '命中率 (%)', values: rates.slice(0, index + 1) }],
      })));
    },
  },
] };

interface Instruction {
  label: string;
  dest: string;
  reads: string[];
  load: boolean;
}
interface Dependency { producer: number; consumer: number; register: string; load: boolean }

const pipeline: PipelineDefinition = { stages: [
  {
    id: 'source', title: '汇编指令源', diagram: 'source',
    text: 'ADD R1,R2,R3\nSUB R4,R1,R5\nLW R6,0(R7)\nADD R8,R6,R9',
    textLabel: '每行一条指令，支持整数运算、立即数运算、加载和保存，寄存器写 R0–R31',
    run: ({ text }) => {
      const lines = parseInstructionList(text);
      if (!text.trim() || lines.length > 24) throw new Error('请填写 1–24 条指令。');
      const instructions = lines.map((label): Instruction => {
        const op = label.split(/\s+/, 1)[0]!.toUpperCase();
        const reg = (label.toUpperCase().match(/\bR\d+\b/g) ?? []);
        const load = /^(LW|LD|LH|LB)$/.test(op);
        const store = /^(SW|SD|SH|SB)$/.test(op);
        const immediate = /^(ADDI|ANDI|ORI|XORI|SLTI)$/.test(op);
        if ((!load && !store && !immediate && !/^(ADD|SUB|AND|OR|XOR|SLT)$/.test(op))
          || reg.some((r) => Number(r.slice(1)) > 31)
          || reg.length !== (load || store || immediate ? 2 : 3)) throw new Error(`不支持的指令：${label}`);
        return { label, dest: store || reg[0] === 'R0' ? '' : reg[0]!, reads: store ? reg : reg.slice(1), load };
      });
      return result({ instructions }, [table('待执行指令', ['序号', '汇编', '读取', '写入'],
        instructions.map(({ label, reads, dest }, i) => [i + 1, label, reads.join(', '), dest || '—']))]);
    },
  },
  {
    id: 'hazards', title: 'RAW 冒险检测', diagram: 'array', inputs: ['source'],
    run: ({ upstream }) => {
      const instructions = upstream[0]!.instructions as Instruction[];
      const lastWriter = new Map<string, number>();
      const dependencies: Dependency[] = [];
      instructions.forEach(({ reads, dest }, consumer) => {
        for (const register of new Set(reads)) {
          const producer = lastWriter.get(register);
          if (producer !== undefined) dependencies.push({ producer, consumer, register, load: instructions[producer]!.load });
        }
        if (dest) lastWriter.set(dest, consumer);
      });
      const rows = dependencies.map(({ producer, consumer, register, load }) =>
        [instructions[producer]!.label, instructions[consumer]!.label, register, load ? 'Load-Use' : 'ALU RAW']);
      return result({ instructions, dependencies }, rows.length ? rows.map((_, i) => ({
        ...table('真实数据依赖', ['生产者', '消费者', '寄存器', '类型'], rows), highlightRows: [i],
      })) : [{ title: '无 RAW 依赖' }]);
    },
  },
  {
    id: 'forwarding', title: '旁路转发', diagram: 'switch', inputs: ['hazards'],
    controls: [{ key: 'forwarding', label: '转发设置', value: 1, options: [{ value: 1, label: '开启' }, { value: 0, label: '关闭' }] }],
    run: ({ params, upstream }) => {
      const enabled = !!params.forwarding;
      return result({ ...upstream[0], enabled }, [{ title: enabled ? '旁路转发已开启' : '旁路转发已关闭',
        summary: enabled ? 'ALU 结果可转发到下一条指令的 EX。相邻 Load-Use 仍需等待一拍。' : '消费者在生产者写回 WB 的周期才可读到结果。' }]);
    },
  },
  {
    id: 'timing', title: '5 级时空矩阵', diagram: 'pipeline', inputs: ['forwarding'],
    run: ({ upstream }) => {
      const { instructions, dependencies, enabled } = upstream[0] as {
        instructions: Instruction[]; dependencies: Dependency[]; enabled: boolean;
      };
      const idCycles: number[] = [];
      const stages: string[][] = [];
      let bubbles = 0;
      for (let i = 0; i < instructions.length; i += 1) {
        const previous = idCycles[i - 1] ?? 1;
        const expected = previous + 1;
        const required = dependencies.filter((link) => link.consumer === i)
          .map(({ producer, load }) => idCycles[producer]! + (enabled ? load ? 2 : 1 : 3));
        const id = Math.max(expected, ...required);
        idCycles.push(id);
        bubbles += id - expected;
        stages.push([...Array(previous - 1).fill(''), 'IF', ...Array(id - expected).fill('停'), 'ID', 'EX', 'MEM', 'WB']);
      }
      const cycles = idCycles.at(-1)! + 3;
      const frames = Array.from({ length: cycles }, (_, index) => {
        const end = index + 1;
        const start = Math.max(0, end - 11);
        return table(`第 ${end} 周期`, ['指令', ...Array.from({ length: end - start }, (_, col) => 'C' + (start + col + 1))],
          instructions.map(({ label }, i) => [label, ...Array.from({ length: end - start }, (_, col) => stages[i]![start + col] || '—')]),
          `完成需 ${cycles} 周期 · 共 ${bubbles} 个停顿拍。`);
      });
      return result({ cycles, bubbles, count: instructions.length }, frames);
    },
  },
  {
    id: 'cpi', title: 'CPI 与加速比', diagram: 'summary', inputs: ['timing'],
    run: ({ upstream }) => {
      const { cycles, bubbles, count } = upstream[0] as { cycles: number; bubbles: number; count: number };
      return result({ cycles, bubbles, count }, [table('流水线性能', ['指令数', '周期数', '停顿拍', 'CPI', '相对串行加速比'],
        [[count, cycles, bubbles, (cycles / count).toFixed(3), (count * 5 / cycles).toFixed(3)]],
        '串行基线按每条指令独占 5 拍。模型只计数据冒险，假设指令与数据存储分离。')]);
    },
  },
] };

function decimalRatio(text: string): { num: bigint; den: bigint } | null {
  const parts = text.match(/^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!parts || !(parts[2] || parts[3])) return null;
  const digits = (parts[2] ?? '') + (parts[3] ?? '');
  const decimalPower = Number(parts[4] ?? 0) - (parts[3]?.length ?? 0);
  if (Math.abs(decimalPower) > 1000 || digits.length > 400) return null;
  return {
    num: (parts[1] === '-' ? -1n : 1n) * BigInt(digits) * 10n ** BigInt(Math.max(0, decimalPower)),
    den: 10n ** BigInt(Math.max(0, -decimalPower)),
  };
}

function ratioError(num: bigint, denom: bigint): string {
  if (num === 0n) return '0';
  const n = (num < 0n ? -num : num).toString();
  const d = denom.toString();
  const head = (s: string) => Number(s.slice(0, 15)) / 10 ** (Math.min(s.length, 15) - 1);
  const ratio = head(n) / head(d);
  const [coef, power] = ratio.toExponential(7).split('e');
  return `${num < 0n ? '-' : ''}${coef}e${Number(power) + n.length - d.length}`;
}

function decimalError(text: string, raw: bigint, bits: 32 | 64): string {
  const given = decimalRatio(text);
  if (!given) return '—';
  const mantissaWidth = bits === 32 ? 23n : 52n;
  const exponentWidth = bits === 32 ? 8n : 11n;
  const maxExp = (1n << exponentWidth) - 1n;
  const exponent = (raw >> mantissaWidth) & maxExp;
  if (exponent === maxExp) return '—';
  const fraction = raw & ((1n << mantissaWidth) - 1n);
  const binaryPower = Number(exponent || 1n) - (bits === 32 ? 127 : 1023) - Number(mantissaWidth);
  const stored = (raw >> BigInt(bits - 1) ? -1n : 1n) * (fraction + (exponent ? 1n << mantissaWidth : 0n))
    * (1n << BigInt(Math.max(0, binaryPower)));
  const base2 = 1n << BigInt(Math.max(0, -binaryPower));
  return ratioError(stored * given.den - given.num * base2, base2 * given.den);
}

const numeric: PipelineDefinition = { stages: [
  {
    id: 'source', title: '数值 / 十六进制源', diagram: 'source', text: '0.1',
    textLabel: '十进制、±Infinity、NaN，或 0x 开头的原始位模式',
    run: ({ text }) => {
      const input = text.trim();
      if (input.length > 420 || !/^(?:0x[\da-f]+|[+-]?(?:Infinity|NaN|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?))$/i.test(input)) {
        throw new Error('请输入十进制数、Infinity、NaN 或有效的十六进制位模式。');
      }
      return result({ input }, [table('数值输入', ['输入', '方向'], [[input, /^0x/i.test(input) ? '原始位 → 数值' : '十进制 → 二进制']])]);
    },
  },
  {
    id: 'width', title: '32 / 64 位宽切分', diagram: 'bits', inputs: ['source'],
    controls: [
      { key: 'bits', label: '格式位宽', value: 32, options: [32, 64].map((value) => ({ value, label: String(value) })) },
      { key: 'fixed', label: '数值格式', value: 0, options: [{ value: 0, label: 'IEEE 754' }, { value: 1, label: '补码定点' }] },
      { key: 'fraction', label: '定点小数位数', value: 8, min: 0, max: 52, step: 1 },
    ],
    run: ({ params, upstream }) => {
      const input = upstream[0]!.input as string;
      const bits = params.bits === 64 ? 64 : 32;
      const limit = 1n << BigInt(bits);
      const fraction = Math.max(0, Math.min(bits - 1, Math.floor(params.fraction ?? 8)));
      const bytes = new DataView(new ArrayBuffer(8));
      let raw: bigint;
      if (/^0x/i.test(input)) {
        raw = BigInt(input);
        if (raw >= limit) throw new Error(`位模式超出 ${bits} 位，请切换位宽。`);
      } else if (params.fixed) {
        const given = decimalRatio(input);
        if (!given) throw new Error('请输入有限十进制数，指数绝对值不得超过 1000。');
        const scaled = (given.num < 0n ? -given.num : given.num) << BigInt(fraction);
        const low = scaled / given.den;
        const remainder = 2n * (scaled % given.den);
        const magnitude = remainder > given.den || (remainder === given.den && low % 2n !== 0n) ? low + 1n : low;
        const rounded = given.num < 0n ? -magnitude : magnitude;
        if (rounded < -limit / 2n || rounded >= limit / 2n) throw new Error('该数值超出了所选定点格式的范围。');
        raw = BigInt.asUintN(bits, rounded);
      } else {
        const number = /nan$/i.test(input) ? NaN : /infinity$/i.test(input) ? (input.startsWith('-') ? -Infinity : Infinity) : Number(input);
        if (bits === 32) bytes.setFloat32(0, number); else bytes.setFloat64(0, number);
        raw = bits === 32 ? BigInt(bytes.getUint32(0)) : bytes.getBigUint64(0);
      }
      const hex = '0x' + raw.toString(16).padStart(bits / 4, '0');
      const binary = raw.toString(2).padStart(bits, '0');
      return result({ input, bits, hex, binary, fixed: !!params.fixed, fraction }, [
        table('精确原始位模式', ['格式', '十六进制', '二进制'], [[params.fixed ? `Q · ${fraction} 个小数位` : `binary${bits}`, hex, binary]]),
      ]);
    },
  },
  {
    id: 'fields', title: '符号 · 阶码 · 尾数', diagram: 'bits', inputs: ['width'],
    run: ({ upstream }) => {
      const input = upstream[0]!;
      const { binary, bits, fixed, fraction } = input as { binary: string; bits: 32 | 64; fixed: boolean; fraction: number };
      const divider = fixed ? bits - fraction : bits === 32 ? 9 : 12;
      return result(input, [table(fixed ? '补码位权分解' : 'IEEE 754 位段',
        [fixed ? '符号位（负权）' : '符号', fixed ? '整数位' : '阶码', fixed ? '小数位' : '尾数'],
        [[binary[0]!, binary.slice(1, divider) || '—', binary.slice(divider) || '—']])]);
    },
  },
  {
    id: 'value', title: '真值与精度误差', diagram: 'summary', inputs: ['fields'],
    run: ({ upstream }) => {
      const { input, hex, bits, fixed, fraction } = upstream[0] as {
        input: string; hex: string; bits: 32 | 64; fixed: boolean; fraction: number;
      };
      const raw = BigInt(hex);
      if (fixed) {
        const signed = BigInt.asIntN(bits, raw);
        const exact = signed * 5n ** BigInt(fraction);
        const digits = (exact < 0n ? -exact : exact).toString().padStart(fraction + 1, '0');
        const value = (exact < 0n ? '-' : '') + (fraction ? `${digits.slice(0, -fraction)}.${digits.slice(-fraction)}` : digits);
        const given = decimalRatio(input);
        const divisor = 1n << BigInt(fraction);
        const error = given ? ratioError(signed * given.den - given.num * divisor, given.den * divisor) : '—';
        return result({ value }, [table('补码定点真值', ['真值', '定点误差', '量化步长'], [[value, error, 2 ** -fraction]])]);
      }
      const info = ieee754Decode(hex, bits);
      const name = { normal: '规格化', denorm: '非规格化', inf: '无穷', nan: 'NaN', zero: '零' }[info.category];
      const value = Object.is(info.actualValue, -0) ? '-0' : String(info.actualValue);
      const error = /^0x/i.test(input) ? '—' : decimalError(input, raw, bits);
      return result({ value, category: info.category }, [table('真值与舍入误差', ['分类', '真值', '实际指数', '存储值 − 输入值'],
        [[name, value, info.category === 'normal' || info.category === 'denorm' ? info.biasExp : '—', error]])]);
    },
  },
] };

export const coPipelines: Record<string, PipelineDefinition> = { cacheSimLab: cache, pipelineLab: pipeline, ieee754Lab: numeric };

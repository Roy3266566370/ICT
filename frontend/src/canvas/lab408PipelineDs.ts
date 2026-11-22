import { sortFrames } from './lab408Sim.ts';
import type { PipelineDefinition, PipelineFrame, PipelineResult, PipelineStage } from './lab408PipelineTypes.ts';

type BinaryNode = {
  id: string;
  label: string;
  left?: BinaryNode;
  right?: BinaryNode;
};

function binaryForest(roots: BinaryNode[], active: string[] = [], edgeLabels?: [string, string]): PipelineFrame['graph'] {
  const nodes: NonNullable<PipelineFrame['graph']>['nodes'] = [];
  const edges: NonNullable<PipelineFrame['graph']>['edges'] = [];
  let deepest = 0;
  function walk(node: BinaryNode, depth: number) {
    deepest = Math.max(depth, deepest);
    if (node.left) {
      walk(node.left, depth + 1);
      edges.push({ from: node.id, to: node.left.id, label: edgeLabels?.[0], active: active.includes(node.left.id) });
    }
    nodes.push({ id: node.id, label: node.label, x: nodes.length, y: depth, active: active.includes(node.id) });
    if (node.right) {
      walk(node.right, depth + 1);
      edges.push({ from: node.id, to: node.right.id, label: edgeLabels?.[1], active: active.includes(node.right.id) });
    }
  }
  roots.forEach(root => walk(root, 0));
  for (const node of nodes) {
    node.x = nodes.length === 1 ? 50 : 8 + node.x * 84 / (nodes.length - 1);
    node.y = deepest === 0 ? 50 : 10 + node.y * 80 / deepest;
  }
  return { nodes, edges };
}

const tokens = (text: string): string[] => text.split(/[\s,，、;；]+/).filter(Boolean);
const option = (key: string, label: string, labels: string[]) => ({
  key, label, value: 0, options: labels.map((name, value) => ({ value, label: name })),
});

function invalid(title: string, summary: string): PipelineResult {
  return { data: {}, frames: [{ title, summary }] };
}

function traceView(id: string, title: string, diagram: PipelineStage['diagram'], input: string, visual: boolean): PipelineStage {
  return {
    id, title, diagram, inputs: [input],
    run({ upstream }) {
      const trace = upstream[0]?.trace as PipelineFrame[] | undefined;
      if (!trace?.length) return invalid('等待推演记录', '请先提供有效的算法输入。');
      const frames = trace.map(({ title, summary, graph, columns, rows, highlightRows }) =>
        visual ? { title, summary, graph } : { title, summary, columns, rows, highlightRows });
      return { data: upstream[0]!, frames };
    },
  };
}

const treeInput: PipelineStage = {
  id: 'treeInput', title: '二叉树输入', diagram: 'tree',
  text: 'A B C D E _ F', textLabel: '层序节点（_ 为空，子节点下标为 2i+1、2i+2）',
  run({ text }) {
    const labels = tokens(text);
    if (!labels.length || labels.length > 31 || labels[0] === '_') {
      return invalid('请输入树节点', '填写 1–31 个层序位置，根节点必填。');
    }
    const nodes = labels.map((label, index) => label === '_' ? undefined : { id: String(index), label } as BinaryNode);
    for (const [index, node] of nodes.entries()) {
      if (!node) continue;
      if (index > 0 && !nodes[Math.floor((index - 1) / 2)]) {
        return invalid('层序位置无效', `节点 ${node.label} 的父节点为空。`);
      }
      node.left = nodes[index * 2 + 1];
      node.right = nodes[index * 2 + 2];
    }
    const root = nodes[0]!;
    return {
      data: { root },
      frames: [{ title: '二叉树', graph: binaryForest([root]), columns: ['层序下标', '标记'],
        rows: labels.map((label, index) => [index, label]) }],
    };
  },
};

const traversal: PipelineStage = {
  id: 'traversal', title: '遍历引擎', diagram: 'pipeline', inputs: ['treeInput'],
  controls: [option('order', '遍历顺序', ['先序', '中序', '后序', '层序'])],
  run({ params, upstream }) {
    const tree = upstream[0]?.root as BinaryNode | undefined;
    if (!tree) return invalid('等待二叉树', '连接有效的二叉树输入。');
    const root = tree;
    const order = params.order ?? 0;
    const work: BinaryNode[] = [root];
    const visited: string[] = [];
    const frames: PipelineFrame[] = [];
    function record(title: string, active?: BinaryNode) {
      frames.push({
        title, summary: title, graph: binaryForest([root], active ? [active.id] : []),
        columns: ['状态', '节点顺序'],
        rows: [[order === 3 ? '队首 → 队尾' : '栈底 → 栈顶', work.map(node => node.label).join(' → ') || '空'],
          ['已访问', visited.join(' → ') || '空']],
      });
    }
    if (order === 3) {
      record(`根节点 ${root.label} 入队`, root);
      while (work.length) {
        const current = work.shift()!;
        visited.push(current.label);
        const children = [current.left, current.right].filter((node): node is BinaryNode => !!node);
        work.push(...children);
        record(`${current.label} 出队并访问${children.length ? `，${children.map(node => node.label).join('、')} 入队` : ''}`, current);
      }
    } else {
      work.pop();
      function walk(node: BinaryNode) {
        work.push(node);
        record(`${node.label} 入栈`, node);
        function visit() {
          visited.push(node.label);
          record(`访问 ${node.label}`, node);
        }
        if (order === 0) visit();
        if (node.left) walk(node.left);
        if (order === 1) visit();
        if (node.right) walk(node.right);
        if (order === 2) visit();
        work.pop();
        record(`${node.label} 出栈`, node);
      }
      walk(root);
    }
    record('遍历完成');
    return { data: { visited, trace: frames }, frames: frames.map(({ title, summary }) => ({ title, summary })) };
  },
};

type Weight = { symbol: string; weight: number };
type HuffmanNode = BinaryNode & { weight: number; symbol?: string; left?: HuffmanNode; right?: HuffmanNode };

const weights: PipelineStage = {
  id: 'weights', title: 'Huffman 权值输入', diagram: 'array',
  text: 'A:5 B:9 C:12 D:13 E:16 F:45', textLabel: '符号:权值（用空格分隔）',
  run({ text }) {
    const entries = tokens(text.replaceAll('：', ':'));
    const items = entries.map((entry, index) => {
      const parts = entry.split(':');
      const [symbol, value] = parts.length === 1 ? [String.fromCharCode(65 + index), parts[0]] : parts;
      return { symbol, weight: parts.length > 2 || !value ? NaN : Number(value) };
    });
    if (!items.length || items.length > 12 || items.some(({ symbol, weight }) => !symbol || !Number.isSafeInteger(weight) || weight <= 0 || weight > 1e9)
      || new Set(items.map(item => item.symbol)).size !== items.length) {
      return invalid('请检查权值', '填写 1–12 个不同符号，权值为 1–10⁹ 的整数。');
    }
    return { data: { items }, frames: [{
      title: '叶节点权值', columns: ['符号', '权值'], rows: items.map(({ symbol, weight }) => [symbol, weight]),
    }] };
  },
};

const huffmanMerge: PipelineStage = {
  id: 'huffmanMerge', title: '最小权值合并', diagram: 'tree', inputs: ['weights'],
  run({ upstream }) {
    const items = upstream[0]?.items as Weight[] | undefined;
    if (!items?.length) return invalid('等待权值', '连接有效的 Huffman 权值输入。');
    const queue: HuffmanNode[] = items.map(({ symbol, weight }, index) => ({ id: String(index), label: `${symbol}:${weight}`, symbol, weight }));
    const frames: PipelineFrame[] = [];
    let id = queue.length;
    const sort = () => queue.sort((left, right) => left.weight - right.weight || Number(left.id) - Number(right.id));
    function record(title: string, summary: string, active: string[] = []) {
      frames.push({
        title, summary, graph: binaryForest(queue, active),
        columns: ['队列位置', '子树根', '权值'], rows: queue.map((node, index) => [index, node.label, node.weight]),
        highlightRows: queue.flatMap((node, index) => active.includes(node.id) ? [index] : []),
      });
    }
    sort();
    record('初始权值队列', '队首保留最小权值。');
    while (queue.length > 1) {
      const left = queue.shift()!;
      const right = queue.shift()!;
      const weight = left.weight + right.weight;
      const parent = { id: String(id++), label: String(weight), weight, left, right };
      queue.push(parent);
      sort();
      record('合并两个最小根', `${left.weight} + ${right.weight} = ${weight}`, [left.id, right.id, parent.id]);
    }
    return { data: { root: queue[0] }, frames };
  },
};

const huffmanCodes: PipelineStage = {
  id: 'huffmanCodes', title: 'Huffman 编码与 WPL', diagram: 'tree', inputs: ['huffmanMerge'],
  run({ upstream }) {
    const root = upstream[0]?.root as HuffmanNode | undefined;
    if (!root) return invalid('等待 Huffman 树', '连接最小权值合并模块。');
    const entries: [string, string, number, number, number][] = [];
    const frames: PipelineFrame[] = [];
    let wpl = 0;
    function walk(node: HuffmanNode, path: string, ancestors: string[]) {
      const active = [...ancestors, node.id];
      if (node.symbol !== undefined) {
        const contribution = node.weight * path.length;
        wpl += contribution;
        entries.push([node.symbol, path || '0', node.weight, path.length, contribution]);
        frames.push({
          title: `获得编码 ${node.symbol}`, summary: `${node.symbol} = ${path || '0'} · 累计 WPL = ${wpl}`,
          graph: binaryForest([root!], active, ['0', '1']),
          columns: ['符号', '编码', '权值', '深度', 'WPL 项'], rows: [...entries], highlightRows: [entries.length - 1],
        });
      }
      if (node.left) walk(node.left, `${path}0`, active);
      if (node.right) walk(node.right, `${path}1`, active);
    }
    walk(root, '', []);
    return { data: { codes: Object.fromEntries(entries.map(([symbol, code]) => [symbol, code])), wpl }, frames };
  },
};

function numberInput(id: string, title: string, text: string, actions?: PipelineStage['actions']): PipelineStage {
  return {
    id, title, diagram: 'array', text, textLabel: '整数序列（用空格或逗号分隔）', actions,
    run({ text }) {
      const values = tokens(text).map(Number);
      if (!values.length || values.length > 31 || values.some(value => !Number.isSafeInteger(value))) {
        return invalid('请检查整数序列', '填写 1–31 个有效整数。');
      }
      return { data: { values }, frames: [{ title, columns: ['下标', '值'], rows: values.map((value, index) => [index, value]) }] };
    },
  };
}

type AvlNode = BinaryNode & { key: number; left?: AvlNode; right?: AvlNode };
type AvlEvent = { phase: 'insert' | 'balance' | 'rotate' | 'final'; frame: PipelineFrame };
const avlHeight = (node?: AvlNode): number => node ? 1 + Math.max(avlHeight(node.left), avlHeight(node.right)) : 0;
const balance = (node: AvlNode): number => avlHeight(node.left) - avlHeight(node.right);

function rotateLeft(node: AvlNode): AvlNode {
  const promoted = node.right!;
  node.right = promoted.left;
  promoted.left = node;
  return promoted;
}

function rotateRight(node: AvlNode): AvlNode {
  const promoted = node.left!;
  node.left = promoted.right;
  promoted.right = node;
  return promoted;
}

const avlInsert: PipelineStage = {
  id: 'avlInsert', title: 'BST 插入', diagram: 'tree', inputs: ['avlInput'],
  run({ upstream }) {
    const values = upstream[0]?.values as number[] | undefined;
    if (!values?.length) return invalid('等待插入序列', '连接有效的整数序列。');
    let root: AvlNode | undefined;
    const trace: AvlEvent[] = [];
    const rotations: string[] = [];
    function record(phase: AvlEvent['phase'], title: string, summary: string, active: number[] = []) {
      if (!root) return;
      const rows: number[][] = [];
      function collect(node: AvlNode) {
        if (node.left) collect(node.left);
        rows.push([node.key, avlHeight(node), balance(node)]);
        if (node.right) collect(node.right);
      }
      collect(root);
      trace.push({
        phase,
        frame: {
          title, summary, graph: binaryForest([root], active.map(String)),
          columns: ['关键字', '子树高度', 'BF = 左高 − 右高'],
          rows, highlightRows: rows.flatMap(([key], index) => active.includes(key!) ? [index] : []),
        },
      });
    }
    for (const key of values) {
      const path: AvlNode[] = [];
      let current = root;
      while (current && current.key !== key) {
        path.push(current);
        current = key < current.key ? current.left : current.right;
      }
      if (current) {
        record('insert', `跳过重复键 ${key}`, 'AVL 使用互异关键字。', [key]);
        continue;
      }
      const leaf = { id: String(key), label: String(key), key };
      const parent = path.at(-1);
      if (!parent) root = leaf;
      else if (key < parent.key) parent.left = leaf;
      else parent.right = leaf;
      record('insert', `插入 ${key}`, '按照二叉搜索树规则插入叶节点。', [key]);
      if (!parent) record('balance', `检查节点 ${key}`, 'BF = 0', [key]);
      for (let index = path.length - 1; index >= 0; index -= 1) {
        const node = path[index]!;
        const factor = balance(node);
        record('balance', `检查节点 ${node.key}`, `BF = ${factor}`, [node.key]);
        if (Math.abs(factor) <= 1) continue;
        const leftHeavy = factor > 0;
        const child = (leftHeavy ? node.left : node.right)!;
        const double = leftHeavy ? balance(child) < 0 : balance(child) > 0;
        const rotation = leftHeavy ? (double ? 'LR' : 'LL') : (double ? 'RL' : 'RR');
        rotations.push(rotation);
        record('rotate', `${rotation} 失衡`, `节点 ${node.key} 的 BF = ${factor}。`, [node.key, child.key]);
        if (double) {
          if (leftHeavy) node.left = rotateLeft(child);
          else node.right = rotateRight(child);
          record('rotate', `${rotation} 第一次旋转`, `以 ${child.key} 为支点${leftHeavy ? '左旋' : '右旋'}。`, [node.key, child.key]);
        }
        const promoted = leftHeavy ? rotateRight(node) : rotateLeft(node);
        const ancestor = path[index - 1];
        if (!ancestor) root = promoted;
        else if (node.key < ancestor.key) ancestor.left = promoted;
        else ancestor.right = promoted;
        record('rotate', `${rotation} 恢复平衡`, `以 ${node.key} 为支点${leftHeavy ? '右旋' : '左旋'}，${promoted.key} 成为子树根。`, [node.key, promoted.key]);
        break;
      }
    }
    record('final', 'AVL 插入完成', '所有节点的平衡因子均在 −1 至 1 之间。');
    const frames = trace.filter(event => event.phase === 'insert').map(event => event.frame);
    return { data: { root: root?.key, rotations, trace }, frames };
  },
};

function avlView(id: string, title: string, input: string, phase: AvlEvent['phase']): PipelineStage {
  return {
    id, title, inputs: [input], diagram: 'tree',
    run({ upstream }) {
      const trace = upstream[0]?.trace as AvlEvent[] | undefined;
      if (!trace?.length) return invalid('等待 AVL 推演', '连接上游 AVL 模块。');
      const frames = trace.filter(event => event.phase === phase).map(event => event.frame);
      if (!frames.length) {
        frames.push({ ...trace.at(-1)!.frame, title: '无需旋转', summary: '每次插入后均保持 AVL 平衡。' });
      }
      return { data: upstream[0]!, frames };
    },
  };
}

const matchInput: PipelineStage = {
  id: 'matchInput', title: '主串与模式串', diagram: 'array',
  text: 'AAAABAAAC\nAAAC', textLabel: '第 1 行为主串，第 2 行为模式串',
  run({ text }) {
    const [sourceText, patternText, ...extra] = text.trim().split(/\r?\n/).map(line => line.trim());
    const source = Array.from(sourceText ?? '');
    const pattern = Array.from(patternText ?? '');
    if (!source.length || !pattern.length || source.length > 64 || pattern.length > 24 || extra.length) {
      return invalid('请检查主串和模式串', '主串支持 1–64 字符，模式串支持 1–24 字符。');
    }
    return { data: { source, pattern }, frames: [{
      title: '字符串输入', columns: ['字段', '字符序列', '长度'],
      rows: [['主串', source.join(' '), source.length], ['模式串', pattern.join(' '), pattern.length]],
    }] };
  },
};

const kmpTable: PipelineStage = {
  id: 'kmpTable', title: 'next / nextval 表', diagram: 'array', inputs: ['matchInput'],
  run({ upstream }) {
    const source = upstream[0]?.source as string[] | undefined;
    const pattern = upstream[0]?.pattern as string[] | undefined;
    if (!source || !pattern?.length) return invalid('等待字符串', '连接有效的主串与模式串。');
    const next = [-1];
    const nextval = [-1];
    const frames: PipelineFrame[] = [];
    function record(index: number, summary: string) {
      frames.push({
        title: `计算模式位置 ${index}`, summary, columns: ['位置 j', 'P[j]', 'next[j]', 'nextval[j]'],
        rows: pattern!.map((char, position) => [position, char, next[position] ?? '·', nextval[position] ?? '·']),
        highlightRows: [index],
      });
    }
    record(0, '使用下标从 0 开始的定义，首项为 −1。');
    for (let index = 1; index < pattern.length; index += 1) {
      let candidate = next[index - 1]!;
      while (candidate >= 0 && pattern[index - 1] !== pattern[candidate]) candidate = next[candidate]!;
      const border = candidate + 1;
      const repeated = pattern[index] === pattern[border];
      next.push(border);
      nextval.push(repeated ? nextval[border]! : border);
      record(index, repeated
        ? `P[${index}] = P[${border}]，跳过必然再次失配的位置 ${border}。`
        : `可复用的真前后缀长度为 ${border}。`);
    }
    return { data: { source, pattern, next, nextval }, frames };
  },
};

const kmpMatch: PipelineStage = {
  id: 'kmpMatch', title: 'KMP 指针对齐与回退', diagram: 'array', inputs: ['kmpTable'],
  controls: [option('nextval', '回退表', ['next', 'nextval'])],
  run({ params, upstream }) {
    const source = upstream[0]?.source as string[] | undefined;
    const pattern = upstream[0]?.pattern as string[] | undefined;
    const table = upstream[0]?.[params.nextval === 1 ? 'nextval' : 'next'] as number[] | undefined;
    if (!source?.length || !pattern?.length || !table?.length) return invalid('等待回退表', '连接 next / nextval 表。');
    let i = 0;
    let j = 0;
    let comparisons = 0;
    let fallbacks = 0;
    const frames: PipelineFrame[] = [];
    const counts: StepCount[] = [];
    function record(title: string, summary: string) {
      counts.push({ comparisons, swaps: 0, fallbacks });
      const offset = i - Math.max(j, 0);
      frames.push({
        title, summary: `${summary} · i = ${i} · j = ${j} · 比较 ${comparisons} 次`,
        columns: ['主串下标', '主串字符', '对齐后的模式串', '指针'],
        rows: source!.map((char, index) => [
          index, char, pattern![index - offset] ?? '·', index === i ? (j < 0 ? 'i' : 'i / j') : '',
        ]),
        highlightRows: i < source!.length ? [i] : [],
      });
    }
    record('初始对齐', '从两个串的首字符开始。');
    while (i < source.length && j < pattern.length) {
      if (j < 0) {
        i += 1;
        j = 0;
        record('推进主串', '模式指针为 −1，主串指针前进一步。');
        continue;
      }
      comparisons += 1;
      if (source[i] === pattern[j]) {
        const char = source[i];
        i += 1;
        j += 1;
        record('字符相等', `${char} 匹配，两个指针前进一步。`);
      } else {
        const previous = j;
        j = table[j]!;
        fallbacks += 1;
        record('模式指针回退', `保持 i，j 从 ${previous} 回退到 ${j}。`);
      }
    }
    const match = j === pattern.length ? i - j : -1;
    record(match < 0 ? '主串中没有匹配' : `匹配起点 ${match}`, match < 0 ? '主串已扫描完毕。' : '模式串已全部匹配。');
    return { data: { match, comparisons, counts }, frames };
  },
};

type StepCount = { comparisons: number; swaps: number; fallbacks: number };

function heapTree(values: number[], lastIndex: number, active: number[]): PipelineFrame['graph'] {
  function subtree(index: number): BinaryNode | undefined {
    if (index > lastIndex) return undefined;
    return {
      id: String(index), label: String(values[index]),
      left: subtree(index * 2 + 1), right: subtree(index * 2 + 2),
    };
  }
  const root = subtree(0);
  return binaryForest(root ? [root] : [], active.map(String));
}

const sort: PipelineStage = {
  id: 'sort', title: '快速排序 / 堆排序', diagram: 'chart', inputs: ['sortInput'],
  controls: [option('algorithm', '排序算法', ['快速排序', '堆排序'])],
  run({ params, upstream }) {
    const values = upstream[0]?.values as number[] | undefined;
    if (!values?.length) return invalid('等待排序数据', '连接有效的数组输入。');
    const heap = params.algorithm === 1;
    const player = sortFrames(values, heap ? 'heapsort' : 'quicksort');
    let comparisons = 0;
    let swaps = 0;
    const counts: StepCount[] = [{ comparisons, swaps, fallbacks: 0 }];
    const frames: PipelineFrame[] = [{
      title: heap ? '初始堆区' : '初始数组', columns: ['下标', '值', '状态'],
      rows: values.map((value, index) => [index, value, heap ? '待建堆' : '待排序']),
      series: [{ label: '数组', values }],
      ...(heap && { graph: heapTree(values, values.length - 1, []) }),
    }];
    player.frames.forEach(({ values, compare, swap, pivot, heapEnd, sorted, bounds }, index) => {
      if (compare) comparisons += 1;
      if (swap) swaps += 1;
      counts.push({ comparisons, swaps, fallbacks: 0 });
      const pivotPosition = swap && swap[1] === pivot ? swap[0] : pivot;
      const affected = compare ?? swap ?? (pivotPosition === null ? [] : [pivotPosition]);
      const target = swap?.[1];
      const after = player.frames[index + 1]?.sorted;
      const extracted = heap && target !== undefined && after?.includes(target) && !sorted.includes(target) ? target : null;
      const lastHeapIndex = extracted === null ? heapEnd : extracted - 1;
      const final = index === player.frames.length - 1;
      const partition = bounds ? ` · low = ${bounds[0]} · high = ${bounds[1]}` : '';
      frames.push({
        title: final ? '排序完成' : swap ? `交换下标 ${swap.join('、')}` : compare ? `比较下标 ${compare.join('、')}` : '定位元素',
        summary: final ? player.summary : pivotPosition !== null ? `枢轴下标 ${pivotPosition}${partition}`
          : lastHeapIndex !== null ? `堆区下标 0–${lastHeapIndex}` : '',
        columns: ['下标', '值', '状态'],
        rows: values.map((value, position) => [
          position, value, sorted.includes(position) || position === extracted ? '已定位'
            : position === pivotPosition ? '枢轴' : lastHeapIndex !== null && position <= lastHeapIndex ? '堆区'
              : bounds && position >= bounds[0] && position <= bounds[1] ? '当前分区' : '待排序',
        ]),
        highlightRows: affected, series: [{ label: '数组', values }],
        ...(heap && lastHeapIndex !== null && { graph: heapTree(values, lastHeapIndex, affected) }),
      });
    });
    return { data: { values: player.frames.at(-1)?.values, counts }, frames };
  },
};

const statistics: PipelineStage = {
  id: 'statistics', title: '比较、交换与回退统计', diagram: 'summary', inputs: ['kmpMatch', 'sort'],
  run({ upstream }) {
    const match = upstream[0]?.counts as StepCount[] | undefined;
    const sort = upstream[1]?.counts as StepCount[] | undefined;
    if (!match?.length || !sort?.length) return invalid('等待比较统计', '连接有效的 KMP 和排序推演。');
    const total = Math.max(match.length, sort.length);
    const frames = Array.from({ length: total }, (_, index): PipelineFrame => {
      const kmp = match[Math.min(index, match.length - 1)]!;
      const sorting = sort[Math.min(index, sort.length - 1)]!;
      return {
        title: `累计计数 · 第 ${index + 1} 步`, columns: ['推演', '比较', '交换', '回退'],
        rows: [
          ['KMP', kmp.comparisons, kmp.swaps, kmp.fallbacks],
          ['排序', sorting.comparisons, sorting.swaps, sorting.fallbacks],
        ],
      };
    });
    return { data: { match: match.at(-1), sort: sort.at(-1) }, frames };
  },
};

type Edge = { from: string; to: string; weight: number };
type WeightedGraph = { vertices: string[]; edges: Edge[] };

function drawGraph(
  graph: WeightedGraph, active: string[] = [], activeEdges: Edge[] = [], directed = false,
): PipelineFrame['graph'] {
  return {
    nodes: graph.vertices.map((id, index) => {
      const angle = (index / graph.vertices.length - 0.25) * Math.PI * 2;
      const radius = graph.vertices.length === 1 ? 0 : 38;
      return { id, label: id, x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle), active: active.includes(id) };
    }),
    edges: graph.edges.map(edge => ({
      from: edge.from, to: edge.to, label: directed ? `${edge.weight} →` : String(edge.weight),
      active: activeEdges.includes(edge),
    })),
  };
}

const graphInput: PipelineStage = {
  id: 'graphInput', title: '图的边表', diagram: 'graph',
  text: 'A B 7\nA C 9\nA F 14\nB C 10\nB D 15\nC D 11\nC F 2\nD E 6\nF E 9',
  textLabel: '每行填写 起点 终点 权重；也可单独填写顶点',
  run({ text }) {
    const vertices = new Set<string>();
    const edges: Edge[] = [];
    for (const line of text.split(/\r?\n|[;；]/).filter(item => item.trim())) {
      const [from, to, value = '1', ...extra] = tokens(line.replace(/->|→|[:：]/g, ' '));
      const weight = Number(value);
      if (!from || extra.length || !Number.isSafeInteger(weight) || Math.abs(weight) > 1e9) {
        return invalid('请检查边表', '每条边需填写两个顶点与可选整数权重。');
      }
      vertices.add(from);
      if (to) {
        vertices.add(to);
        edges.push({ from, to, weight });
      }
    }
    if (!vertices.size || vertices.size > 12 || edges.length > 32) {
      return invalid('请检查图规模', '图需包含 1–12 个顶点，最多 32 条边。');
    }
    const graph = { vertices: [...vertices], edges };
    return { data: { graph }, frames: [{
      title: '输入图', summary: `起点序号 ${graph.vertices.map((vertex, index) => `${index} = ${vertex}`).join(' · ')}`,
      graph: drawGraph(graph), columns: ['起点', '终点', '权重'],
      rows: edges.map(({ from, to, weight }) => [from, to, weight]),
    }] };
  },
};

function topology(graph: WeightedGraph): PipelineResult {
  const { vertices, edges } = graph;
  const indegree = new Map(vertices.map(vertex => [vertex, 0]));
  for (const { to } of edges) indegree.set(to, indegree.get(to)! + 1);
  const queue = vertices.filter(vertex => indegree.get(vertex) === 0);
  const order: string[] = [];
  const frames: PipelineFrame[] = [];
  function record(title: string, summary: string, active?: string, edge?: Edge) {
    frames.push({
      title, summary: `${summary} · 队列 ${queue.join(' → ') || '空'} · 输出 ${order.join(' → ') || '空'}`,
      columns: ['顶点', '入度', '状态'],
      graph: drawGraph(graph, edge ? [edge.from, edge.to] : active ? [active] : [], edge ? [edge] : [], true),
      rows: vertices.map(vertex => [vertex, indegree.get(vertex)!, order.includes(vertex) ? '已输出' : queue.includes(vertex) ? '在队列' : '等待']),
      highlightRows: active ? [vertices.indexOf(active)] : [],
    });
  }
  record('初始化入度', '入度为 0 的顶点入队。');
  while (queue.length) {
    const active = queue.shift()!;
    order.push(active);
    record(`选中顶点 ${active}`, '出队并输出。', active);
    for (const edge of edges.filter(edge => edge.from === active)) {
      const newDegree = indegree.get(edge.to)! - 1;
      indegree.set(edge.to, newDegree);
      if (newDegree === 0) queue.push(edge.to);
      record(`删除 ${active} → ${edge.to}`, `${edge.to} 入度降至 ${newDegree}${newDegree === 0 ? ' 并入队' : ''}。`, edge.to, edge);
    }
  }
  const cycle = order.length < vertices.length;
  record(cycle ? '检测到有向环' : '拓扑排序完成', cycle ? '队列已空，仍有顶点未输出。' : '所有顶点已输出。');
  return { data: { order, cycle, indegrees: Object.fromEntries(indegree) }, frames };
}

function minimumPaths(graph: WeightedGraph, start: string, prim: boolean, directed: boolean): PipelineResult {
  const { vertices, edges } = graph;
  if (!prim && edges.some(edge => edge.weight < 0)) {
    return invalid('Dijkstra 要求非负边权', '请将边权改为非负整数，或选择 Prim。');
  }
  const distances = new Map(vertices.map(vertex => [vertex, vertex === start ? 0 : Infinity]));
  const incoming = new Map<string, { edge: Edge; from: string }>();
  const chosen = new Set<string>();
  const tree: Edge[] = [];
  const frames: PipelineFrame[] = [];
  function record(title: string, summary: string, active?: string, edge?: Edge) {
    frames.push({
      title, summary,
      columns: ['顶点', prim ? '最小接入边权' : '距离', '前驱', '状态'],
      graph: drawGraph(graph, edge ? [edge.from, edge.to] : active ? [active] : [], edge ? [...tree, edge] : tree, directed),
      rows: vertices.map(vertex => {
        const distance = distances.get(vertex)!;
        return [vertex, distance === Infinity ? '∞' : distance, incoming.get(vertex)?.from ?? '—', chosen.has(vertex) ? '已选定' : '候选'];
      }),
      highlightRows: active ? [vertices.indexOf(active)] : [],
    });
  }
  let weight = 0;
  record('初始化', `从顶点 ${start} 出发。`, start);
  while (chosen.size < vertices.length) {
    let active: string | undefined;
    let minimum = Infinity;
    for (const vertex of vertices) {
      const candidate = distances.get(vertex)!;
      if (!chosen.has(vertex) && candidate < minimum) {
        active = vertex;
        minimum = candidate;
      }
    }
    if (!active) break;
    chosen.add(active);
    const chosenEdge = incoming.get(active)?.edge;
    if (chosenEdge) {
      tree.push(chosenEdge);
      if (prim) weight += chosenEdge.weight;
    }
    record(`选定顶点 ${active}`, prim ? `接入边权 ${minimum} · 当前总权重 ${weight}` : `确定最短距离 ${minimum}`, active, chosenEdge);
    for (const edge of edges) {
      const target = edge.from === active ? edge.to : !directed && edge.to === active ? edge.from : undefined;
      if (!target || chosen.has(target)) continue;
      const previous = distances.get(target)!;
      const candidate = prim ? edge.weight : minimum + edge.weight;
      if (candidate >= previous) continue;
      distances.set(target, candidate);
      incoming.set(target, { edge, from: active });
      record(`更新 ${target}`, `${active} → ${target} · ${previous === Infinity ? '∞' : previous} → ${candidate}`, target, edge);
    }
  }
  const connected = chosen.size === vertices.length;
  record(prim ? 'Prim 完成' : 'Dijkstra 完成', prim
    ? connected ? `最小生成树总权重 ${weight}。` : `图不连通，起点所在分量的生成树权重 ${weight}。`
    : `已确定 ${chosen.size} 个可达顶点的最短距离。`);
  return {
    data: prim ? { weight, connected, edges: tree } : {
      distances: Object.fromEntries([...distances].map(([vertex, distance]) => [vertex, distance === Infinity ? '∞' : distance])),
      predecessors: Object.fromEntries(vertices.map(vertex => [vertex, incoming.get(vertex)?.from ?? null])),
    },
    frames,
  };
}

const graphRun: PipelineStage = {
  id: 'graphRun', title: '图算法引擎', diagram: 'pipeline', inputs: ['graphInput'],
  controls: [
    option('algorithm', '算法', ['Dijkstra', 'Prim', '拓扑排序']),
    { key: 'start', label: '起点序号', value: 0, min: 0, max: 11, step: 1 },
    option('undirected', 'Dijkstra 边方向', ['有向', '无向']),
  ],
  run({ params, upstream }) {
    const graph = upstream[0]?.graph as WeightedGraph | undefined;
    if (!graph?.vertices.length) return invalid('等待边表', '连接有效的图输入。');
    const start = graph.vertices[Math.min(graph.vertices.length - 1, Math.max(0, Math.round(params.start ?? 0)))] ?? graph.vertices[0]!;
    const prim = params.algorithm === 1;
    const result = params.algorithm === 2 ? topology(graph) : minimumPaths(graph, start, prim, !prim && params.undirected !== 1);
    return {
      data: { ...result.data, trace: result.frames },
      frames: result.frames.map(({ title, summary }) => ({ title, summary })),
    };
  },
};

export const dsPipelines: Record<string, PipelineDefinition> = {
  dsTraversal: { stages: [
    treeInput, traversal,
    traceView('traversalTree', '二叉树访问位置', 'tree', 'traversal', true),
    traceView('traversalWork', '遍历栈 / 队列', 'queue', 'traversal', false),
    weights, huffmanMerge, huffmanCodes,
  ] },
  avl: { stages: [
    numberInput('avlInput', 'AVL 插入序列', '30 10 20 40 50 25', [{ label: '插入 45', append: '45' }]),
    avlInsert,
    avlView('avlBalance', '平衡因子检查', 'avlInsert', 'balance'),
    avlView('avlRotate', 'LL / RR / LR / RL 旋转', 'avlBalance', 'rotate'),
    avlView('avlFinal', '最终 AVL 树', 'avlRotate', 'final'),
  ] },
  kmpSort: { stages: [
    matchInput, kmpTable, kmpMatch, numberInput('sortInput', '待排序数组', '5 2 9 1 5 6'), sort, statistics,
  ] },
  graphAlgo: { stages: [
    graphInput, graphRun,
    traceView('graphColor', '图上选点与边高亮', 'graph', 'graphRun', true),
    traceView('graphState', '距离 / 接入边权 / 入度', 'grid', 'graphRun', false),
  ] },
};

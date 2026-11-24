import test from 'node:test';
import assert from 'node:assert/strict';
import { dsPipelines } from './lab408PipelineDs.ts';
import { build408Pipeline } from './lab408Pipeline.ts';
import { evalOutput, makeCtx } from './engine.ts';

function run(key: string, stageId: string, text = '', params: Record<string, number> = {}, upstream: Record<string, unknown>[] = []) {
  const stage = dsPipelines[key]?.stages.find(candidate => candidate.id === stageId);
  assert.ok(stage, `${key} 缺少实验模块 ${stageId}`);
  return stage.run({ text, params, upstream });
}

test('编辑树后按四种顺序遍历，层序逐步出队和入队', () => {
  const source = run('dsTraversal', 'treeInput', 'R A B _ C').data;
  const cases = [
    ['R', 'A', 'C', 'B'], ['A', 'C', 'R', 'B'],
    ['C', 'A', 'B', 'R'], ['R', 'A', 'B', 'C'],
  ];
  for (const [order, expected] of cases.entries()) {
    const result = run('dsTraversal', 'traversal', '', { order }, [source]);
    assert.deepEqual(result.data.visited, expected);
    assert.ok(result.frames.some(frame => frame.summary?.includes(order === 3 ? '入队' : '入栈')));
  }
  const engine = run('dsTraversal', 'traversal', '', { order: 3 }, [source]).data;
  const queueFrames = run('dsTraversal', 'traversalWork', '', {}, [engine]).frames;
  assert.ok(queueFrames.some(frame => frame.rows?.some(row => row.includes('A → B'))));
});

test('Huffman 逐轮合并最小权值并由树生成前缀编码和 WPL', () => {
  const input = run('dsTraversal', 'weights', 'X:2 Y:3 Z:7').data;
  const merge = run('dsTraversal', 'huffmanMerge', '', {}, [input]);
  assert.ok(merge.frames.some(frame => frame.summary?.includes('2 + 3 = 5')));
  const codes = run('dsTraversal', 'huffmanCodes', '', {}, [merge.data]);
  assert.deepEqual(codes.data.codes, { X: '00', Y: '01', Z: '1' });
  assert.equal(codes.data.wpl, 17);
});

test('AVL 四类失衡分别记录失衡 BF 和旋转后的树', () => {
  for (const [input, rotation] of [['30 20 10', 'LL'], ['10 20 30', 'RR'], ['30 10 20', 'LR'], ['10 30 20', 'RL']]) {
    const source = run('avl', 'avlInput', input).data;
    const result = run('avl', 'avlInsert', '', {}, [source]);
    assert.equal(result.data.root, 20);
    assert.deepEqual(result.data.rotations, [rotation]);
    const balance = run('avl', 'avlBalance', '', {}, [result.data]);
    const rotate = run('avl', 'avlRotate', '', {}, [balance.data]);
    const final = run('avl', 'avlFinal', '', {}, [rotate.data]);
    assert.ok(balance.frames.some(frame => frame.rows?.some(row => Math.abs(row[2] as number) === 2)));
    assert.deepEqual(final.frames.at(-1)?.rows, [[10, 1, 0], [20, 2, 0], [30, 1, 0]]);
  }
});

test('KMP nextval 减少重复字符的回退，命中位置与 next 相同', () => {
  const source = run('kmpSort', 'matchInput', 'AAAABAAAC\nAAAC').data;
  const table = run('kmpSort', 'kmpTable', '', {}, [source]);
  assert.deepEqual(table.data.next, [-1, 0, 1, 2]);
  assert.deepEqual(table.data.nextval, [-1, -1, -1, 2]);
  const ordinary = run('kmpSort', 'kmpMatch', '', { nextval: 0 }, [table.data]);
  const optimized = run('kmpSort', 'kmpMatch', '', { nextval: 1 }, [table.data]);
  assert.equal(ordinary.data.match, 5);
  assert.equal(optimized.data.match, 5);
  assert.ok(Number(optimized.data.comparisons) < Number(ordinary.data.comparisons));
  assert.ok(optimized.frames.some(frame => frame.summary?.includes('保持 i')));
});

test('快排显示枢轴，堆排序显示堆区，终态均使用编辑后的数组', () => {
  const source = run('kmpSort', 'sortInput', '4 -1 4 0').data;
  const quick = run('kmpSort', 'sort', '', { algorithm: 0 }, [source]);
  const heap = run('kmpSort', 'sort', '', { algorithm: 1 }, [source]);
  assert.deepEqual(quick.data.values, [-1, 0, 4, 4]);
  assert.deepEqual(heap.data.values, [-1, 0, 4, 4]);
  assert.ok(quick.frames.some(frame => frame.summary?.includes('枢轴')));
  assert.ok(heap.frames.some(frame => frame.summary?.includes('堆区')));
  const pivotSwap = quick.frames.find(frame => frame.title.includes('交换下标 1、3'));
  assert.deepEqual(pivotSwap?.rows?.find(row => row[2] === '枢轴'), [1, 0, '枢轴']);
  assert.ok(quick.frames.some(frame => frame.summary?.includes('low = 0 · high = 3')));
  const heapFrame = heap.frames.find(frame => frame.graph?.nodes.length === 4);
  assert.equal(heapFrame?.graph?.edges.length, 3);
  assert.ok(heap.frames.some(frame => frame.title === '比较下标 0、2'));
  assert.equal(heap.frames.at(-1)?.graph?.nodes.length ?? 0, 0);
});

test('Dijkstra 松弛较短路径，Prim 取最小生成树，拓扑排序递减入度', () => {
  const source = run('graphAlgo', 'graphInput', 'A B 7\nA C 2\nC B 1\nD').data;
  const shortest = run('graphAlgo', 'graphRun', '', { algorithm: 0, start: 0 }, [source]);
  assert.deepEqual(shortest.data.distances, { A: 0, B: 3, C: 2, D: '∞' });
  const diagram = run('graphAlgo', 'graphColor', '', {}, [shortest.data]);
  assert.ok(diagram.frames.some(frame => frame.graph?.edges.some(edge => edge.from === 'C' && edge.to === 'B' && edge.active)));
  const spanning = run('graphAlgo', 'graphRun', '', { algorithm: 1, start: 0 }, [source]);
  assert.equal(spanning.data.weight, 3);
  assert.equal(spanning.data.connected, false);
  const topology = run('graphAlgo', 'graphRun', '', { algorithm: 2 }, [source]);
  assert.deepEqual(topology.data.order, ['A', 'D', 'C', 'B']);
  assert.deepEqual(topology.data.indegrees, { A: 0, B: 0, C: 0, D: 0 });
  const cycle = run('graphAlgo', 'graphInput', 'A B\nB A').data;
  assert.equal(run('graphAlgo', 'graphRun', '', { algorithm: 2 }, [cycle]).data.cycle, true);
});

test('遍历结果分别显示二叉树和工作栈，断开工作栈连线会停止该模块', () => {
  const doc = build408Pipeline('dsTraversal', '测试', '');
  const tree = doc.nodes.find(node => node.payload === 'dsTraversal/traversalTree')!;
  const stack = doc.nodes.find(node => node.payload === 'dsTraversal/traversalWork')!;
  assert.ok(tree && stack);
  const context = makeCtx(doc, new Map());
  const treeResult = evalOutput(context, tree.id);
  const stackResult = evalOutput(context, stack.id);
  assert.ok(treeResult?.kind === 'lab408Data' && treeResult.result.frames.some(frame => frame.graph?.nodes.length === 6));
  assert.ok(stackResult?.kind === 'lab408Data' && stackResult.result.frames.some(frame => frame.rows?.some(row => row.includes('栈底 → 栈顶'))));
  const separated = makeCtx({ ...doc, wires: doc.wires.filter(wire => wire.to !== stack.id) }, new Map());
  const disconnected = evalOutput(separated, stack.id);
  assert.ok(disconnected?.kind === 'lab408Data' && disconnected.error);
});

test('AVL 的插入、BF、旋转和终态沿独立模块传递同一棵树', () => {
  const input = run('avl', 'avlInput', '30 10 20').data;
  const insertion = run('avl', 'avlInsert', '', {}, [input]);
  const balance = run('avl', 'avlBalance', '', {}, [insertion.data]);
  const rotate = run('avl', 'avlRotate', '', {}, [balance.data]);
  const final = run('avl', 'avlFinal', '', {}, [rotate.data]);
  assert.equal(insertion.frames.filter(frame => frame.title.startsWith('插入')).length, 3);
  assert.ok(balance.frames.some(frame => frame.summary?.includes('BF = 2')));
  assert.ok(rotate.frames.some(frame => frame.title === 'LR 第一次旋转'));
  assert.deepEqual(final.frames.at(-1)?.rows, [[10, 1, 0], [20, 2, 0], [30, 1, 0]]);
});

test('图染色与状态表共享同一步的松弛记录', () => {
  const input = run('graphAlgo', 'graphInput', 'A B 7\nA C 2\nC B 1').data;
  const solver = run('graphAlgo', 'graphRun', '', {}, [input]);
  const graph = run('graphAlgo', 'graphColor', '', {}, [solver.data]);
  const table = run('graphAlgo', 'graphState', '', {}, [solver.data]);
  const step = graph.frames.findIndex(frame => frame.graph?.edges.some(edge => edge.from === 'C' && edge.to === 'B' && edge.active));
  assert.ok(step >= 0);
  assert.deepEqual(table.frames[step]?.rows?.find(row => row[0] === 'B'), ['B', 3, 'C', '候选']);
});

test('字符串与排序链汇合后显示逐帧累计比较、交换与回退次数', () => {
  const strings = run('kmpSort', 'matchInput', 'AAAABAAAC\nAAAC').data;
  const table = run('kmpSort', 'kmpTable', '', {}, [strings]).data;
  const match = run('kmpSort', 'kmpMatch', '', { nextval: 1 }, [table]).data;
  const numbers = run('kmpSort', 'sortInput', '3 1 2').data;
  const sorted = run('kmpSort', 'sort', '', {}, [numbers]).data;
  const stats = run('kmpSort', 'statistics', '', {}, [match, sorted]);
  assert.deepEqual(stats.frames.at(-1)?.rows, [['KMP', 11, 0, 3], ['排序', 2, 2, 0]]);
  assert.ok(stats.frames.some(frame => frame.rows?.some(row => row[0] === '排序' && row[1] === 1 && row[2] === 0)));
});

test('B 树逐次插入产生分裂帧，B+ 树可切换且目标查找路径正确', () => {
  const source = run('btreeLab', 'input', '10,20,5,6,12,30,7,17,25,3', { order: 0, variant: 0, target: 17 }).data;
  const inserted = run('btreeLab', 'insert', '', {}, [source]);
  assert.ok(inserted.frames.length > source.values.length);
  assert.ok(Number(inserted.data.splitCount) >= 1);
  const metrics = run('btreeLab', 'metrics', '', {}, [inserted.data]);
  assert.match(JSON.stringify(metrics.frames), /命中/);
  const bp = run('btreeLab', 'input', '10,20,5,6,12,30,7,17,25,3', { order: 1, variant: 1, target: 20 }).data;
  const bpInsert = run('btreeLab', 'insert', '', {}, [bp]);
  assert.ok(Number(bpInsert.data.splitCount) >= 1);
  assert.throws(() => run('btreeLab', 'input', '10,10', {}, []), /重复/);
});

test('散列表对比线性、二次与链地址 ASL，并报告满表场景', () => {
  const source = run('hashTableLab', 'input', '19,14,23,1,68,20,84,27,55,11,10,79', { tableSize: 17, modP: 13, strategy: 0 }).data;
  const probe = run('hashTableLab', 'probe', '', {}, [source]);
  assert.equal(probe.frames.length, 12);
  assert.ok(Number(probe.data.metrics.success) > 0);
  const compare = run('hashTableLab', 'compare', '', {}, [source]);
  assert.equal(compare.frames[0]?.rows?.length, 3);
  assert.ok(compare.frames[0]?.rows?.every((row) => row[1] !== '表满'));
  const full = run('hashTableLab', 'input', '19,14,23,1,68,20,84,27,55,11,10,79', { tableSize: 13, modP: 13 }).data;
  assert.match(JSON.stringify(run('hashTableLab', 'compare', '', {}, [full]).frames), /表满/);
  assert.throws(() => run('hashTableLab', 'input', '1,2', { tableSize: 7, modP: 19 }, []), /不能大于/);
});
